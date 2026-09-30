// video.mjs: what xr_capture delivers and how a capture is judged, on ffprobe's reading of the files.
// The delivery is always 30 fps; the SOURCE (MediaRecorder's WebM) keeps the rate the page really drew,
// so the honest-footage floor is checked there: a converted clip's 30 fps may be duplicated frames.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const DELIVERY = { fps: 30, width: 1920, height: 1080 };
export const FLOOR = { sourceFps: 25, loudDb: -50, toleranceS: 0.5 };

// ffmpeg arguments turning a capture into the delivery MP4 (H.264 + AAC, constant 30 fps): the
// picture and sound from `src`, or the sound from a separate `audio` file starting at the same instant.
export function deliverArgs(src, out, audio) {
  return ['-i', src, ...(audio ? ['-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-shortest'] : []),
    '-vf', `fps=${DELIVERY.fps},scale=${DELIVERY.width}:${DELIVERY.height}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-movflags', '+faststart', out];
}

const rate = (r) => {
  const [n, d] = String(r ?? '0/1').split('/').map(Number);
  return d ? n / d : 0;
};

// { duration, video: { width, height, fps, frames }, audio: { codec, maxDb } | null }. MediaRecorder's
// WebM carries no duration, so without one the last video packet's time plus one frame is used.
export async function probe(path, { countFrames = false } = {}) {
  const { stdout } = await run('ffprobe', ['-v', 'error', ...(countFrames ? ['-count_frames'] : []), '-show_streams', '-show_format', '-of', 'json', path], { maxBuffer: 1 << 26 });
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  let duration = Number(j.format?.duration);
  if (!Number.isFinite(duration)) {
    // JSON, not CSV: MediaRecorder's packet lines end in a comma, and Number() reads those as NaN.
    const { stdout: pk } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'json', path], { maxBuffer: 1 << 28 });
    const t = JSON.parse(pk).packets.map((x) => Number(x.pts_time)).filter(Number.isFinite);
    duration = t.length ? Math.max(...t) - Math.min(...t) + 1 / (rate(v.avg_frame_rate) || DELIVERY.fps) : 0;
  }
  const frames = Number(v.nb_read_frames ?? v.nb_frames);
  let audio = null;
  if (a) {
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', path, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
    const m = /max_volume: (-?[\d.]+|-inf) dB/.exec(stderr);
    audio = { codec: a.codec_name, maxDb: m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null };
  }
  return { duration, video: { width: v.width, height: v.height, fps: rate(v.avg_frame_rate), frames: Number.isFinite(frames) ? frames : null }, audio };
}

// Every way the capture falls short, as sentences; [] means it passes. `seconds` is the length the
// page recorded; `audible` demands sound on the delivery (the voice clips the page played).
export function check({ source, delivery, seconds, audible = false, minSourceFps = FLOOR.sourceFps, tolerance = FLOOR.toleranceS }) {
  const p = [];
  const d = delivery.video;
  if (d.width !== DELIVERY.width || d.height !== DELIVERY.height) p.push(`size ${d.width}x${d.height}, expected ${DELIVERY.width}x${DELIVERY.height}`);
  if (d.fps !== DELIVERY.fps) p.push(`rate ${d.fps} fps, expected ${DELIVERY.fps}`);
  if (seconds != null) {
    if (Math.abs(delivery.duration - seconds) > tolerance) p.push(`duration ${delivery.duration.toFixed(2)} s, expected ${seconds}`);
    const want = Math.round(seconds * DELIVERY.fps);
    if (d.frames == null || Math.abs(d.frames - want) > tolerance * DELIVERY.fps) p.push(`frames ${d.frames}, expected ${want}`);
  }
  const drew = source.video.frames / source.duration;
  if (!(drew >= minSourceFps)) p.push(`source drew ${drew.toFixed(1)} fps, below ${minSourceFps}`);
  if (audible) {
    if (!delivery.audio) p.push('no audio stream');
    else if (!(delivery.audio.maxDb > FLOOR.loudDb)) p.push(`audio is silent (max ${delivery.audio.maxDb} dB)`);
  }
  return p;
}
