import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const variant = process.argv[2] ?? 'B';
if (!['A', 'B'].includes(variant)) throw new Error('Choose variant A or B.');
const directory = path.resolve(`attached_assets/classscribe-social-demo/conversion-update/variant-${variant}`);
const original = path.join(directory, `ClassScribe-30s-Variant-${variant}.mp4`);
const video = path.join(directory, `ClassScribe-30s-Variant-${variant}-Clean-End-Card.mp4`);
const mp3 = path.join(directory, `ClassScribe-30s-Variant-${variant}.mp3`);
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'classscribe-end-card-'));

async function ff(args) {
  return exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror',
    '-filter_complex_threads', '2', '-filter_threads', '2', '-y', ...args],
  { maxBuffer: 2 * 1024 * 1024 });
}
async function probe(file) {
  const { stdout } = await exec('ffprobe',
    ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]);
  return JSON.parse(stdout);
}
try {
  const prefix = path.join(scratch, 'first-25-seconds.mp4');
  // The existing export has a closed-GOP keyframe at exactly 25 seconds.
  // Copy the first 750 frames without re-encoding or changing their captions.
  await ff(['-i', original, '-map', '0:v:0', '-an', '-frames:v', '750', '-c:v', 'copy', prefix]);
  const prefixInfo = await probe(prefix);
  if (prefixInfo.streams[0].nb_read_frames !== '750' ||
      Math.abs(Number(prefixInfo.format.duration) - 25) > 0.01) {
    throw new Error('The untouched 25-second prefix failed validation.');
  }
  const ending = path.join(scratch, 'clean-ending.mp4');
  const ass = path.join(directory, 'captions.ass');
  // Remove only the two small tracking-parameter lines from the silent end card,
  // then burn its existing captions at their original absolute timeline times.
  const filter = `drawbox=x=150:y=1250:w=780:h=77:color=0x092f23:t=fill,` +
    `setpts=PTS+25/TB,ass='${ass}',setpts=PTS-25/TB`;
  await ff(['-i', path.join(directory, 'segment-4.mp4'), '-vf', filter,
    '-an', '-t', '5', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19',
    '-pix_fmt', 'yuv420p', '-r', '30', '-threads', '2', ending]);
  const list = path.join(scratch, 'concat.txt');
  await fs.writeFile(list, `file '${prefix}'\nfile '${ending}'\n`);
  await ff(['-f', 'concat', '-safe', '0', '-i', list,
    '-i', path.join(directory, 'retimed-audio.m4a'),
    '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-t', '30',
    '-movflags', '+faststart', video]);
  if (variant === 'B') {
    await ff(['-i', video, '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame',
      '-b:a', '192k', '-t', '30', '-metadata', `title=ClassScribe — Variant ${variant}`, mp3]);
  }

  const info = await probe(video);
  const picture = info.streams.find(stream => stream.codec_type === 'video');
  const sound = info.streams.find(stream => stream.codec_type === 'audio');
  if (picture?.width !== 1080 || picture.height !== 1920 ||
      picture.nb_read_frames !== '900' || sound?.codec_name !== 'aac' ||
      Math.abs(Number(info.format.duration) - 30) > 0.05) {
    throw new Error('The final video failed its format or duration check.');
  }
  const [before, after] = await Promise.all([
    ff(['-i', original, '-map', '0:v:0', '-an', '-f', 'framemd5', '-']),
    ff(['-i', video, '-map', '0:v:0', '-an', '-f', 'framemd5', '-']),
  ]);
  const hashes = value => value.stdout.split('\n')
    .filter(line => /^\d+\s*,/.test(line)).map(line => line.split(',').at(-1).trim());
  const oldFrames = hashes(before);
  const newFrames = hashes(after);
  if (newFrames.length !== 900 ||
      oldFrames.slice(0, 750).some((hash, index) => hash !== newFrames[index])) {
    throw new Error('Frame comparison found a change before the end card.');
  }
  if (variant === 'B') {
    const audioInfo = await probe(mp3);
    if (audioInfo.streams[0].codec_name !== 'mp3' ||
        Math.abs(Number(audioInfo.format.duration) - 30) > 0.1) {
      throw new Error('MP3 validation failed.');
    }
  }
  await ff(['-ss', '29', '-i', video, '-frames:v', '1',
    path.join(directory, `ClassScribe-Variant-${variant}-Clean-End-Card.jpg`)]);
  console.log(JSON.stringify({
    video: path.relative(process.cwd(), video),
    ...(variant === 'B' ? { mp3: path.relative(process.cwd(), mp3) } : {}),
    duration: info.format.duration, frames: newFrames.length,
    first25Seconds: '750 decoded frames identical to the previous export',
    endCard: 'Small UTM overlay removed; readable domain and captions retained',
  }));
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
