const { test } = require('node:test');
const assert = require('node:assert/strict');
const { files } = require('./fixtures/media-storage-native.cjs');
const { libraryAudioDirectory, scopeLinkedLectureAudio } = require('../.lecture-media-scope-test.cjs');

test('linked legacy audio is copied without deleting its source or exposing the sync code', async () => {
  files.clear();
  const original = 'file:///documents/lecture-old.m4a';
  files.set(original, Buffer.from('audio'));
  const scoped = await scopeLinkedLectureAudio({ id: 'lecture1', audioUri: original, audioName: 'lecture-old.m4a' }, 'secret-code');
  assert.equal(files.has(original), true);
  assert.equal(files.get(scoped.audioUri).toString(), 'audio');
  assert.equal(scoped.legacyAudioUri, original);
  assert.doesNotMatch(scoped.audioUri, /secret-code/);
  assert.strictEqual(await scopeLinkedLectureAudio(scoped, 'secret-code'), scoped);
});

test('a different library cannot automatically claim scoped audio, except after authorized code replacement', async () => {
  files.clear();
  const oldRoot = (await libraryAudioDirectory('old-code')).uri;
  const source = `${oldRoot}/lecture2/audio.m4a`;
  files.set(source, Buffer.from('audio'));
  const lecture = { id: 'lecture2', audioUri: source, audioName: 'audio.m4a' };
  assert.strictEqual(await scopeLinkedLectureAudio(lecture, 'other-code'), lecture);
  const rotated = await scopeLinkedLectureAudio(lecture, 'new-code', [oldRoot]);
  assert.equal(files.has(source), true);
  assert.equal(files.get(rotated.audioUri).toString(), 'audio');
  assert.notEqual(rotated.audioUri, source);
});