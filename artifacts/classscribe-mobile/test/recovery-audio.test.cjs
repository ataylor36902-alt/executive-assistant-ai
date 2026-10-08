const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isRecoveryAudio, unlinkedAudio } = require('../.recovery-audio-test.cjs');

test('finds only nonempty audio not linked to an existing lecture', () => {
  const file = (name, size = 100) => ({ name, uri: `file:///documents/${name}`, size });
  const files = [
    file('lecture-old.m4a'), file('lecture-linked.m4a'), file('lecture-fallback.wav'),
    file('lecture-empty.mp3', 0), file('slide.jpg'), file('note.txt'), file('voice.webm'),
  ];
  const lectures = [
    { audioName: 'lecture-linked.m4a', audioUri: 'file:///documents/lecture-linked.m4a' },
    { audioName: '', audioUri: 'file:///documents/lecture-fallback.wav' },
  ];
  assert.deepEqual(unlinkedAudio(files, lectures).map((f) => f.name), ['lecture-old.m4a', 'voice.webm']);
  assert.equal(isRecoveryAudio('lecture-a.M4A'), true);
  assert.equal(isRecoveryAudio('photo.m4a.jpg'), false);
});

test('does not hide a root recording with the same name as an archived subdirectory file', () => {
  const root = { name: 'audio.m4a', uri: 'file:///documents/audio.m4a', size: 100 };
  assert.deepEqual(unlinkedAudio([root], [
    { audioName: 'audio.m4a', audioUri: 'file:///documents/lectures/id/audio.m4a' },
  ]), [root]);
  assert.deepEqual(unlinkedAudio([root], [{ audioName: 'audio.m4a' }]), []);
});

test('hides the old source after a linked recording is copied into its library', () => {
  const old = { name: 'recording.wav', uri: 'file:///documents/recording.wav', size: 100 };
  assert.deepEqual(unlinkedAudio([old], [{
    audioUri: 'file:///documents/lectures/by-library/hash/id/recording.wav',
    legacyAudioUri: old.uri,
  }]), []);
});