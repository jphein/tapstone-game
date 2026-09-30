"""The promo page's video block (site/promo/index.html): what a browser needs to play it, caption it and
describe it, and nothing that reaches off the site.  python3 -m unittest tools/test_promo_page.py"""
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / 'site'
PAGE = SITE / 'promo' / 'index.html'


class Tags(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []  # (tag, attrs dict, depth-path of enclosing tags)
        self.stack = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs), tuple(self.stack)))
        if tag not in ('source', 'track', 'img', 'meta', 'link', 'br', 'input'):
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in self.stack:
            while self.stack.pop() != tag:
                pass


def parse(html):
    t = Tags()
    t.feed(html)
    return t.tags


def cues(vtt):
    """[(start s, end s, text)] from a WebVTT file; raises on a malformed header or timing line."""
    if not vtt.startswith('WEBVTT'):
        raise ValueError('no WEBVTT header')
    out = []
    for block in vtt.strip().split('\n\n')[1:]:
        lines = block.split('\n')
        timing = next((l for l in lines if '-->' in l), None)
        if timing is None:
            continue  # a NOTE block
        m = re.fullmatch(r'(\d\d):(\d\d):(\d\d\.\d{3}) --> (\d\d):(\d\d):(\d\d\.\d{3})', timing)
        if not m:
            raise ValueError(f'bad timing line: {timing}')
        h1, m1, s1, h2, m2, s2 = m.groups()
        text = '\n'.join(lines[lines.index(timing) + 1:]).strip()
        out.append((int(h1) * 3600 + int(m1) * 60 + float(s1), int(h2) * 3600 + int(m2) * 60 + float(s2), text))
    return out


class PromoVideo(unittest.TestCase):
    def setUp(self):
        self.html = PAGE.read_text()
        self.tags = parse(self.html)
        videos = [t for t in self.tags if t[0] == 'video']
        self.assertEqual(len(videos), 1, 'one promo video')
        self.video = videos[0][1]
        self.inside = [t for t in self.tags if 'video' in t[2]]

    def test_player_attributes(self):
        for a in ('controls', 'playsinline'):
            self.assertIn(a, self.video)
        self.assertEqual(self.video.get('preload'), 'none', 'nothing heavy loads before play')
        self.assertNotIn('autoplay', self.video)
        self.assertEqual(self.video.get('poster'), '/media/promo-poster.jpg')

    def test_a_source_for_each_size(self):
        srcs = [t[1] for t in self.inside if t[0] == 'source']
        self.assertEqual([s['src'] for s in srcs], ['/media/promo-720.mp4', '/media/promo.mp4'])
        self.assertTrue(all(s.get('type') == 'video/mp4' for s in srcs))
        self.assertIn('media', srcs[0], 'the 720p source is chosen on narrow screens only')
        self.assertNotIn('media', srcs[-1], 'the last source takes every other screen')

    def test_captions_track_is_a_valid_ordered_vtt(self):
        tracks = [t[1] for t in self.inside if t[0] == 'track']
        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0].get('kind'), 'captions')
        self.assertEqual(tracks[0].get('srclang'), 'en')
        path = SITE / tracks[0]['src'].lstrip('/')
        c = cues(path.read_text())
        self.assertGreaterEqual(len(c), 1)
        for (a, b, text), nxt in zip(c, c[1:] + [None]):
            self.assertLess(a, b)
            self.assertTrue(text)
            if nxt:
                self.assertLessEqual(b, nxt[0], 'cues must not overlap')

    def test_description_and_fallback(self):
        target = self.video.get('aria-describedby')
        self.assertTrue(target and f'id="{target}"' in self.html)
        fig = next(t[1] for t in self.tags if t[0] == 'figure' and 'film-frame' in t[1].get('class', ''))
        self.assertIn('art', fig['class'].split(), 'shares the missing-picture panel')
        self.assertGreater(len(fig.get('data-alt', '')), 40, 'the panel says what the video shows')

    def test_no_request_leaves_the_site(self):
        for tag, attrs, _ in self.tags:
            for k in ('src', 'href', 'poster'):
                v = attrs.get(k)
                if v:
                    self.assertFalse(re.match(r'^(https?:)?//', v), f'<{tag} {k}="{v}"> reaches off the site')

    def test_the_cue_parser_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            cues('1\n00:00:01.000 --> 00:00:02.000\nno header')
        with self.assertRaises(ValueError):
            cues('WEBVTT\n\n1\n0:01 --> 0:02\nshort timings')


if __name__ == '__main__':
    unittest.main()
