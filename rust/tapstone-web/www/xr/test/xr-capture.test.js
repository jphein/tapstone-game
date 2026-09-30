// xr_capture (tools/xr_capture): the check that judges a capture, run on real ffmpeg output. A clip
// rendered at 15 fps and converted to the 30 fps delivery must pass on duration, frame count and size,
// and still FAIL the source-rate floor, because a converted clip's 30 fps is duplicated frames (the
// honest-footage question is how many frames the page really drew). The silent clip must fail audio.
//
// XR_CAPTURE_LIVE=1 adds the real thing: capture.mjs records 8 s of the page in its own Chromium on the
// B60 (dev server up with `dev up --headless --no-open`; see capture.mjs), and the MP4 must hold
// 8 s at 30 fps, 1920x1080, from a source that drew at least 25 fps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe, check, deliverArgs, DELIVERY } from '../tools/xr_capture/video.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'xr-capture-test-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);

// A 4 s WebM like MediaRecorder's (VP8 + Opus, and live: no duration in the header, which is what
// MediaRecorder writes), drawn at `fps`, with a tone or with silence.
function source(name, fps, audible) {
  const out = join(dir, name);
  ff('-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=${fps}:duration=4`,
    '-f', 'lavfi', '-i', audible ? 'sine=frequency=440:duration=4' : 'anullsrc=r=48000:cl=mono', '-t', '4',
    '-c:v', 'libvpx', '-deadline', 'realtime', '-b:v', '2M', '-c:a', 'libopus', '-live', '1', '-f', 'webm', out);
  return out;
}

test('a WebM with no duration in its header is measured from its packets', async () => {
  const src = source('d.webm', 15, true);
  const header = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString().trim();
  assert.equal(header, 'N/A', 'the fixture must lack a duration, as MediaRecorder output does');
  const s = await probe(src, { countFrames: true });
  assert.ok(Math.abs(s.duration - 4) <= 0.1, `duration ${s.duration}`);
  assert.equal(s.video.frames, 60);
});

// Chromium's own MediaRecorder output (a 320x180 canvas counting frames, 2 s at 30 fps, VP8 + Opus,
// recorded with Playwright's Chromium): no duration in the header, and ffprobe's CSV packet lines end
// in a comma, which read as NaN once and made an 18 fps capture measure 0.03 s long and pass.
test('real MediaRecorder output is measured from its packets', async () => {
  const src = join(here, 'fixtures/mediarecorder-2s.webm');
  const s = await probe(src, { countFrames: true });
  assert.ok(Math.abs(s.duration - 2) <= 0.1, `duration ${s.duration}`);
  assert.equal(s.video.frames, 61);
  assert.ok(s.video.frames / s.duration > 25 && s.video.frames / s.duration < 35);
});

test('a 30 fps source converts to a delivery clip that passes every check', async () => {
  const src = source('a.webm', 30, true);
  const mp4 = join(dir, 'a.mp4');
  ff(...deliverArgs(src, mp4));
  const s = await probe(src, { countFrames: true });
  const d = await probe(mp4, { countFrames: true });
  assert.equal(d.video.width, DELIVERY.width);
  assert.equal(d.video.height, DELIVERY.height);
  assert.equal(d.video.fps, 30);
  assert.ok(Math.abs(d.video.frames - 120) <= 2, `frames ${d.video.frames}`);
  assert.deepEqual(check({ source: s, delivery: d, seconds: 4 }), []);
});

test('a 15 fps source passes duration and frames but fails the source-rate floor', async () => {
  const src = source('b.webm', 15, true);
  const mp4 = join(dir, 'b.mp4');
  ff(...deliverArgs(src, mp4));
  const s = await probe(src, { countFrames: true });
  const d = await probe(mp4, { countFrames: true });
  assert.equal(d.video.fps, 30);
  assert.ok(Math.abs(d.video.frames - 120) <= 2, `the delivery is still 30 fps: ${d.video.frames}`);
  const problems = check({ source: s, delivery: d, seconds: 4 });
  assert.equal(problems.length, 1, problems.join('; '));
  assert.match(problems[0], /source drew 15\.\d fps/);
});

test('a silent capture fails the audio check; a wrong length fails the duration and frame checks', async () => {
  const src = source('c.webm', 30, false);
  const mp4 = join(dir, 'c.mp4');
  ff(...deliverArgs(src, mp4));
  const s = await probe(src, { countFrames: true });
  const d = await probe(mp4, { countFrames: true });
  assert.ok(d.audio, 'the silent clip still has an audio stream');
  const problems = check({ source: s, delivery: d, seconds: 4, audible: true });
  assert.equal(problems.length, 1, problems.join('; '));
  assert.match(problems[0], /silent/);
  const long = check({ source: s, delivery: d, seconds: 6 });
  assert.equal(long.length, 2, long.join('; '));
  assert.match(long.join(';'), /duration 4\.\d+ s, expected 6/);
  assert.match(long.join(';'), /frames 120, expected 180/);
});

test('live: capture.mjs records 8 s of the real page at 30 fps, 1920x1080', { skip: process.env.XR_CAPTURE_LIVE !== '1' && 'set XR_CAPTURE_LIVE=1 with an IWER dev server up' }, async () => {
  const out = join(dir, 'live.mp4');
  execFileSync(process.execPath, [join(here, '../tools/xr_capture/capture.mjs'), 'idle', '--seconds', '8', '--out', out], { stdio: ['ignore', 'inherit', 'inherit'], timeout: 300000 });
  assert.ok(existsSync(out));
  const side = JSON.parse(readFileSync(out.replace(/\.mp4$/, '.json'), 'utf8'));
  assert.deepEqual(side.problems, []);
  const d = await probe(out, { countFrames: true });
  assert.equal(d.video.width, 1920);
  assert.equal(d.video.height, 1080);
  assert.equal(d.video.fps, 30);
  assert.ok(Math.abs(d.duration - 8) <= 0.5, `duration ${d.duration}`);
  assert.ok(Math.abs(d.video.frames - 240) <= 15, `frames ${d.video.frames}`);
  assert.ok(side.source.video.frames / side.source.duration >= 25, `source fps ${side.source.video.frames / side.source.duration}`);
  assert.match(side.page.renderer, /./);
});

// The page keeps its match in localStorage ("coming back"), so a reload resumes it. A capture must
// start fresh: after a short played run leaves a journal behind, the next capture clears it and
// begins at the claim beat (without the clear it began mid-match, with no beat at all).
test('live: a capture after a played one starts a fresh match', { skip: process.env.XR_CAPTURE_LIVE !== '1' && 'set XR_CAPTURE_LIVE=1 with an IWER dev server up' }, async () => {
  const cap = (args, out) => execFileSync(process.execPath, [join(here, '../tools/xr_capture/capture.mjs'), ...args, '--out', out], { stdio: ['ignore', 'inherit', 'inherit'], timeout: 300000 });
  const played = join(dir, 'played.mp4'), fresh = join(dir, 'fresh.mp4');
  try { cap(['match', '--max', '12'], played); } catch { /* a 12 s run may fail the audio or rate check; only its journal matters */ }
  const first = JSON.parse(readFileSync(played.replace(/\.mp4$/, '.json'), 'utf8'));
  assert.ok(first.game.stats.taps >= 1, `the played run must leave taps in the journal: ${first.game.stats.taps}`);
  cap(['idle', '--seconds', '3'], fresh);
  const side = JSON.parse(readFileSync(fresh.replace(/\.mp4$/, '.json'), 'utf8'));
  assert.equal(side.install.journal, 'cleared');
  assert.equal(side.page.beat, 'claim');
});

// Every take leaves a sidecar, a failed one included: two takes that failed on 2026-09-28 left no
// record of when they stalled. An unknown GPU fails inside the capture (no dev server needed), and
// the JSON must still say so.
test('a capture that errors still writes its sidecar', () => {
  const out = join(dir, 'broken.mp4');
  let code = 0;
  try {
    execFileSync(process.execPath, [join(here, '../tools/xr_capture/capture.mjs'), 'idle', '--seconds', '1', '--gpu', 'rtx', '--out', out], { stdio: 'ignore', timeout: 60000 });
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 2);
  const side = JSON.parse(readFileSync(out.replace(/\.mp4$/, '.json'), 'utf8'));
  assert.equal(side.outcome, 'error');
  assert.equal(side.gpu, 'rtx');
  assert.match(side.error, /unknown GPU|iwsdk dev status/);
  assert.ok(side.wall.started && side.wall.ended);
});
