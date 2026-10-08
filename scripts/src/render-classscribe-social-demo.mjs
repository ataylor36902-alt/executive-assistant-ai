import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = process.cwd();
const input = path.join(root, 'attached_assets/0_ClassScribe-Zora-Facebook-Widescreen-1920x1080-Original-Stat_1791295108410.mp4');
const sourceAssets = path.join(root, 'attached_assets/classscribe-zora');
const baseOutput = path.join(root, 'attached_assets/classscribe-social-demo');
const variantArg = process.argv.find(arg => arg.startsWith('--variant='));
const variant = variantArg?.split('=')[1] ?? null;
if (variant !== null && !['A', 'B'].includes(variant)) throw new Error('Variant must be A or B.');
const output = variant ? path.join(baseOutput, 'conversion-update', `variant-${variant}`) : baseOutput;
const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const regular = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const logo = path.join(root, 'artifacts/classscribe/web-public/classscribe-logo-white.png');
const website = process.argv[2];
if (!website || new URL(website).protocol !== 'https:') throw new Error('Pass the verified public website URL.');
const domain = new URL(website).host;
const refreshEnding = process.argv.includes('--refresh-ending');
if (variant && refreshEnding) throw new Error('Use --variant separately from --refresh-ending.');
const tracked = new URL(website);
tracked.searchParams.set('utm_source', 'meta_ad');
tracked.searchParams.set('utm_medium', 'video');
tracked.searchParams.set('utm_campaign', 'launch');
await fs.mkdir(output, { recursive: true });

async function ff(args) {
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-filter_complex_threads', '2', '-filter_threads', '2', '-y', ...args], {
    maxBuffer: 4 * 1024 * 1024,
  });
}
async function text(name, value) {
  const file = path.join(output, `${name}.txt`);
  await fs.writeFile(file, value);
  return file;
}
function draw(file, y, size = 60, color = 'white', bold = true) {
  return `drawtext=fontfile='${bold ? font : regular}':textfile='${file}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}`;
}
const scenes = [
  { name: 'opening', start: 0, length: 5, duration: 5, crop: '1060:1080:0:0', scale: '840:856', x: 120, y: 560,
    lines: [['Your lectures.', 410, 66], ['Organized.', 490, 76]], footer: 'Demonstration footage • sample app data' },
  { name: 'record', start: 8, length: 3, duration: 7, crop: '800:1080:1040:0', scale: '830:1120', x: 125, y: 380,
    lines: [['Record lectures.', 410, 64]], footer: 'Record only with required permission.' },
  { name: 'notes', start: 11, length: 3, duration: 7, crop: '800:1080:1040:0', scale: '830:1120', x: 125, y: 380,
    lines: [['Review your notes.', 410, 61]], footer: 'Demonstration footage • sample app data' },
  { name: 'guide', start: 14, length: 3, duration: 6, crop: '800:1080:1040:0', scale: '830:1120', x: 125, y: 380,
    lines: [['Build study guides.', 410, 61]], footer: 'Study tools require Student or Pro.' },
  { name: 'ending', start: 17, length: 3, duration: 5, crop: '930:1080:0:0', scale: '560:650', x: 260, y: 420,
    lines: [['Try ClassScribe', 1130, 66], [domain, 1220, 43]], footer: 'Student / Pro study tools • plan limits apply' },
];
if (variant === 'B') {
  // Only the opening text differs between the A/B exports.
  scenes[0].lines = [
    ['Missed half your lecture', 397, 56],
    ['trying to take notes?', 473, 56],
  ];
}
if (variant) {
  // Keep the five-second CTA; display the requested tracking suffix separately
  // from the larger, readable domain. Video pixels themselves are not links.
  scenes[4].lines = [
    ['Try ClassScribe', 1100, 66], [domain, 1200, 43],
    ['?utm_source=meta_ad&utm_medium=video', 1260, 25],
    ['&utm_campaign=launch', 1292, 25],
  ];
}
const segments = [];
for (const [index, scene] of scenes.entries()) {
  const segment = path.join(output, `segment-${index}.mp4`);
  const canReuse = variant === 'A' ? [0, 1, 2].includes(index) : variant === 'B' && index !== 0;
  if (canReuse) {
    const cache = variant === 'A' ? baseOutput : path.join(baseOutput, 'conversion-update', 'variant-A');
    await fs.copyFile(path.join(cache, `segment-${index}.mp4`), segment);
    segments.push(segment);
    continue;
  }
  if (refreshEnding && index !== scenes.length - 1) {
    await fs.access(segment);
    segments.push(segment);
    continue;
  }
  console.log(`Rendering ${scene.name}: ${scene.duration}s`);
  const source = `crop=${scene.crop},scale=${scene.scale}:flags=lanczos,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${scene.duration - scene.length}`;
  let filter = `[0:v]${source}[shot];[1:v]scale=680:-1[logo];`;
  filter += `color=c=0x092f23:s=1080x1920:r=30:d=${scene.duration}[bg];`;
  filter += `[bg][shot]overlay=x=${scene.x}:y=${scene.y}:shortest=1[scene];`;
  filter += '[scene][logo]overlay=x=200:y=270[branded];';
  const overlays = [];
  for (const [line, y, size] of scene.lines) {
    overlays.push(draw(await text(`${index}-headline-${y}`, line), y, size));
  }
  // Disclosures are not baked into the crop: keep them visible in portrait.
  overlays.push('drawbox=x=65:y=1415:w=950:h=105:color=0x092f23:t=fill');
  overlays.push(draw(await text(`${index}-footer`, scene.footer), 1434, 29, '0xC5DED2', false));
  if (scene.name === 'guide') {
    overlays.push(draw(await text('guide-limits', 'Plan limits apply • demonstration data'), 1477, 26, '0xC5DED2', false));
    if (variant) {
      // Badge sits above the demonstrated phone screen. No timing claim is made.
      overlays.push("drawbox=x=220:y=510:w=640:h=82:color=0x1D7254@0.95:t=fill:enable='gte(t,0.8)'");
      overlays.push(
        `drawtext=fontfile='${font}':textfile='${await text('result-check', '✓')}':fontsize=54:fontcolor=0x7AEBB0:x=257:y='520+12*exp(-10*max(0,t-0.8))':alpha='min(1,max(0,(t-0.8)/0.3))'`,
      );
      overlays.push(
        draw(await text('result-label', 'Study guide ready'), 533, 38) +
        ":alpha='min(1,max(0,(t-0.8)/0.3))'",
      );
    }
  }
  filter += `[branded]${overlays.join(',')}[video]`;
  await ff(['-ss', String(scene.start), '-t', String(scene.length), '-i', input,
    '-i', logo, '-filter_complex', filter, '-map', '[video]', '-an',
    '-t', String(scene.duration), '-c:v', 'libx264', '-preset', 'fast', '-crf', '19',
    '-pix_fmt', 'yuv420p', '-r', '30', '-threads', '2', segment]);
  segments.push(segment);
}

// Existing production assets supply the uploaded commercial's narrator/music.
// No new voice, lip-sync, cloned identity, or third-party media is introduced.
const audio = path.join(output, 'retimed-audio.m4a');
if (variant) await fs.copyFile(path.join(baseOutput, 'retimed-audio.m4a'), audio);
else if (!refreshEnding) await ff(['-i', path.join(sourceAssets, 'narration.mp3'),
  '-stream_loop', '-1', '-i', path.join(sourceAssets, 'music.mp3'), '-filter_complex',
  '[0:a]asplit=5[a0][a1][a2][a3][a4];' +
  '[a0]atrim=start=0:end=3.45,asetpts=PTS-STARTPTS,adelay=400|400[v0];' +
  '[a1]atrim=start=3.45:end=4.68,asetpts=PTS-STARTPTS,adelay=5400|5400[v1];' +
  '[a2]atrim=start=4.68:end=5.90,asetpts=PTS-STARTPTS,adelay=12400|12400[v2];' +
  '[a3]atrim=start=5.90:end=9.75,asetpts=PTS-STARTPTS,adelay=19200|19200[v3];' +
  '[a4]atrim=start=9.75,asetpts=PTS-STARTPTS,adelay=25300|25300[v4];' +
  '[v0][v1][v2][v3][v4]amix=inputs=5:normalize=0,apad,atrim=duration=30[voice];' +
  '[1:a]atrim=duration=30,asetpts=PTS-STARTPTS,volume=0.13,afade=t=in:d=0.6,afade=t=out:st=28.4:d=1.6[music];' +
  '[voice][music]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=7,atrim=duration=30[a]',
  '-map', '[a]', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', audio]);

const list = path.join(output, 'segments.txt');
await fs.writeFile(list, segments.map(file => `file '${file}'`).join('\n'));
const silent = path.join(output, 'portrait-picture.mp4');
await ff(['-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v', '-c:v', 'copy', silent]);

// Captions reflect the retained narration, not the earlier unfilmed script.
const captions = [
  [0.4, 1.9, 'Meet ClassScribe.'], [1.9, 3.9, 'Your lectures, organized.'],
  [5.4, 6.8, 'Record lectures.'], [12.4, 13.9, 'Review your notes.'],
  [19.2, 20.7, 'Build study guides.'], [20.7, 23.4, 'And ask questions from your course materials.'],
  [25.5, 26.4, 'ClassScribe.'], [26.4, 29.7, 'Record. Review. Remember.'],
];
function assTime(t) {
  const cs = Math.round(t * 100);
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}
const ass = path.join(output, 'captions.ass');
await fs.writeFile(ass, '[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n' +
  '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
  'Style: Default,DejaVu Sans,39,&H00FFFFFF,&H00FFFFFF,&H9010271C,&H9010271C,0,0,0,0,100,100,0,0,3,3,0,2,95,95,550,1\n' +
  '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
  captions.map(([start, end, line]) => `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${line}`).join('\n'));
if (variant) {
  const srtTime = t => assTime(t).replace(/^\d+/, hour => hour.padStart(2, '0')).replace(/\.(\d{2})$/, ',$10');
  await fs.writeFile(path.join(output, `ClassScribe-${variant}-captions.srt`),
    captions.map(([start, end, line], index) =>
      `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${line}\n`).join('\n'));
}
const final = path.join(output, variant
  ? `ClassScribe-30s-Variant-${variant}.mp4`
  : 'ClassScribe-Product-Demo-30s-Vertical.mp4');
await ff(['-i', silent, '-i', audio, '-vf', `ass='${ass}'`, '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-threads', '2',
  '-c:a', 'copy', '-t', '30', '-movflags', '+faststart', final]);

const probe = JSON.parse((await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', final])).stdout);
const video = probe.streams.find(s => s.codec_type === 'video');
const sound = probe.streams.find(s => s.codec_type === 'audio');
if (video.width !== 1080 || video.height !== 1920 || video.codec_name !== 'h264' ||
    sound?.codec_name !== 'aac' || Math.abs(Number(probe.format.duration) - 30) > 0.05) {
  throw new Error('Final export validation failed.');
}
await fs.writeFile(path.join(output, 'export-info.json'), JSON.stringify({
  input: path.relative(root, input), output: path.relative(root, final), duration: probe.format.duration,
  width: video.width, height: video.height, videoCodec: video.codec_name, audioCodec: sound.codec_name,
  website, edits: scenes.map(({name,start,length,duration}) => ({name,start,length,duration})),
  ...(variant ? { variant, trackedUrl: tracked.href, hook: scenes[0].lines.map(line => line[0]).join(' '),
    resultBadge: 'Study guide ready — animated checkmark at 19.8 seconds',
    closingVoice: 'Original narration retained; extracted ending transcribed as Classscribe. Record. Review. Remember.' } : {}),
  notes: 'Extracted from supplied commercial. Longer product holds use the last frame. No flashcard or quiz footage was available.',
}, null, 2));
if (variant === 'A') {
  await fs.writeFile(path.join(baseOutput, 'conversion-update', 'ClassScribe-Posting-Caption.txt'),
    `Your lectures, organized.\n\nRecord lectures, review your notes, and build study guides from your course materials with ClassScribe.\n\nTry ClassScribe:\n${tracked.href}\n\nStudy tools require Student or Pro. Plan limits apply. Record only with required permission. Video shows demonstration data.\n\n#ClassScribe #StudyTips #CollegeLife\n\n--- POSTING NOTES (not part of the caption) ---\n` +
    `Use the same caption, audience, and placement for both videos so only the on-screen hook changes.\n` +
    `For a paid Meta ad, set the destination/website CTA to the full URL above. Instagram organic-caption URLs are generally not tappable; use the profile link or a supported link placement instead.\n` +
    `The same requested UTM URL is used in both videos. Distinguish Variant A/B through ad names or separate tracking if you later run a test. UTMs do not add conversion tracking by themselves.\n` +
    `No posts, paid campaigns, hosting changes, or landing-page changes were made.\n`);
}
console.log(JSON.stringify({file: path.relative(root, final), duration: probe.format.duration, width: video.width, height: video.height, bytes: probe.format.size}));
