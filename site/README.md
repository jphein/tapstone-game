# site/ — tapstone.realm.watch

Static card pages. Every inscribed tag points at `https://tapstone.realm.watch/c/<slug>/`.
Served by Caddy on ubox0 from `/srv/tapstone.realm.watch` (file_server, LE cert via
Cloudflare DNS challenge).

`media/` is gitignored — the clips come from the magic repo (`art/<slug>/`, built by
`tools/cardart.py`). The set 1 clips (Cinder Whelp, Reef Archer, Tidecaller, Ember Castle) come from
katana's `scratch/cardart-run/art/<slug>/veo.mp4`, the same tool run from project scratch; copy each
to `site/media/<slug>.mp4` before the rsync. Set 1's pages, their `art.webp`, the headset's
`rust/tapstone-web/www/xr/public/cards/*.webp` and the two promo cards' paintings are written by
`tools/card_art.py build <art dir> --video <slugs>` from those full-size paintings, which stay in
scratch and out of git (`python3 -m unittest tools/test_card_art.py` checks what's committed). Deploy:

```sh
~/Projects/realm-sigil/static/build.sh --name tapstone --description "Tapstone card pages" \
  --realm fantasy --repo https://github.com/jphein/tapstone-game --html site/c/<slug>/index.html
mv version.json site/   # build.sh writes it to the cwd
rsync -az --delete --exclude /competition/ site/ ubox0:~/tapstone-site/
ssh ubox0 'sudo rsync -a --delete --exclude /competition/ ~/tapstone-site/ /srv/tapstone.realm.watch/ && sudo chmod -R a+rX /srv/tapstone.realm.watch'
```

`--exclude /competition/` keeps the frozen contest build (`docs/runbooks/contest-freeze.md`) out of
both syncs: `site/` has no `competition/`, so `--delete` alone would wipe it on the next card deploy.

**The promo page** (`site/promo/`, #131) is stamped the same way, from the repo root, before the
rsync above. Keep `site/version.json` from the card-page build; the promo page carries its sigil
in its meta tag only:

```sh
~/Projects/realm-sigil/static/build.sh --name tapstone --description "Tapstone promo page" \
  --realm fantasy --repo https://github.com/jphein/tapstone-game --html site/promo/index.html
rm version.json
```

Its art (`site/promo/art/*.svg`) comes from the promo-art branch.

**The promo video** (`site/media/promo.mp4`, `promo-720.mp4`, `promo-poster.jpg`) is gitignored like the
card clips. It lives on katana, with its SHA256SUMS, cut script and shot list, in
`scratch/contest-video/promo/` (`PROMO-NOTES.md` beside it). Copy the three files to `site/media/` before the
rsync, then check them with `sha256sum -c`. Every gameplay frame is a real IWER capture of the headset build,
and there is no AI-generated video. The captions (`site/promo/promo.vtt`) are committed. Without the media, the
page shows the video's description in the missing-picture panel (`promo.js`). `node tools/promo_page_check.mjs
<media dir>` checks the block in a browser, and `python3 -m unittest tools/test_promo_page.py` checks the markup. A missing picture shows its alt
text in a framed panel (`promo.js`), so the page still reads before the art lands.

