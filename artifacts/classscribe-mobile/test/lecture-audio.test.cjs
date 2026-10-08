const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const {
  createLectureAudioSeeker,
  formatLectureTimestamp,
  isSeekableLectureTimestamp,
  lectureLinkTimestamp,
} = require('../.lecture-audio-test.cjs');
const { ControlledExpoAudio } = require('./fixtures/controlled-expo-audio.cjs');

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

test('mobile transcript displays untimed text without making it seekable', () => {
  const route = readFileSync(require.resolve('../app/lecture/[id].js'), 'utf8');
  const format = (seconds) => `${seconds}s`;

  assert.equal(isSeekableLectureTimestamp(21.5), true);
  assert.equal(formatLectureTimestamp(21.5, format), '21.5s');
  assert.equal(lectureLinkTimestamp('34.75'), 34.75);
  assert.equal(lectureLinkTimestamp(undefined), null);
  assert.equal(lectureLinkTimestamp('-1'), null);
  assert.equal(isSeekableLectureTimestamp(null), false);
  assert.equal(isSeekableLectureTimestamp(undefined), false);
  assert.equal(formatLectureTimestamp(null, format), '—');
  assert.equal(formatLectureTimestamp(-1, format), '—');
  assert.match(route, /formatLectureTimestamp\(g\.t, fmtT\)/);
  assert.match(route, /onPress=\{timed \? \(\) => seek\(g\.t\) : undefined\}/);
  assert.match(route, /Some transcript text has no audio timestamps/);
});

test('Expo timestamp link opened before load seeks and plays once the audio is ready', async () => {
  const player = new ControlledExpoAudio();
  const errors = [];
  const seeker = createLectureAudioSeeker(player, () => errors.push('failed'));

  assert.equal(seeker.seek(34.75), true);
  assert.deepEqual(player.seekCalls, []);
  assert.equal(player.playCalls, 0);

  player.load();
  seeker.setLoaded(true);
  await flushAsync();

  assert.deepEqual(player.seekCalls, [34.75]);
  assert.equal(player.playCalls, 1);
  assert.deepEqual(errors, []);
});

test('Expo timed transcript taps seek and play while loaded; untimed values do nothing', async () => {
  const player = new ControlledExpoAudio();
  const seeker = createLectureAudioSeeker(player);

  player.load();
  seeker.setLoaded(true);
  assert.equal(seeker.seek(12.5), true);
  assert.equal(seeker.seek(null), false);
  assert.equal(seeker.seek(-1), false);
  await flushAsync();

  assert.deepEqual(player.seekCalls, [12.5]);
  assert.equal(player.playCalls, 1);
});

test('Expo audio load keeps only the latest queued transcript timestamp', async () => {
  const player = new ControlledExpoAudio();
  const seeker = createLectureAudioSeeker(player);

  seeker.seek(10);
  seeker.seek(28);
  player.load();
  seeker.setLoaded(true);
  await flushAsync();

  assert.deepEqual(player.seekCalls, [28]);
  assert.equal(player.playCalls, 1);
});