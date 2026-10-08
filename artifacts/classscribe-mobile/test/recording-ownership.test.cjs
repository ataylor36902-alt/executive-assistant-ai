const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { files, File } = require('./fixtures/media-storage-native.cjs');
const { hasRecordingOwnershipPath, recordingCaptureDirectories, markRecordingOwner, readRecordingOwner, recoverableRootAudio } = require('../.recording-ownership-test.cjs');
const hash = (code) => createHash('sha256').update(code).digest('hex');
const scope = (code) => `file:///documents/lectures/by-library/${hash(code)}`;

test('interrupted root and cache recordings retain only non-sensitive owner metadata across scans', async () => {
  files.clear();
  for (const uri of ['file:///documents/recording.m4a', 'file:///cache/recording.m4a']) {
    files.set(uri, Buffer.from('private audio'));
    await markRecordingOwner(uri, 'library-secret-A');
    assert.equal(await readRecordingOwner(uri), hash('library-secret-A'));
    assert.equal((await recoverableRootAudio([new File(uri)], [scope('library-secret-A')]))[0].legacy, false);
    assert.deepEqual(await recoverableRootAudio([new File(uri)], [scope('library-secret-B')]), []);
  }
  const metadata = [...files.entries()].filter(([uri]) => uri.includes('/recording-owners/'));
  assert.equal(metadata.length, 2);
  for (const [uri, data] of metadata) {
    assert.doesNotMatch(uri + data.toString(), /library-secret|private audio|recording\.m4a/);
    assert.deepEqual(Object.keys(JSON.parse(data)), ['version', 'owner']);
  }
});

test('missing metadata remains manual legacy; ownerless cache is not offered; scans never mutate audio', async () => {
  files.clear();
  const uri = 'file:///documents/old.wav';
  files.set(uri, Buffer.from('audio'));
  const before = [...files.entries()];
  assert.equal(await readRecordingOwner(uri), null);
  assert.equal((await recoverableRootAudio([new File(uri)], [scope('A')]))[0].legacy, true);
  assert.deepEqual(await recoverableRootAudio([new File(uri)], [scope('B')], { allowLegacy: false }), []);
  assert.deepEqual([...files.entries()], before);
});

test('invalid or unreadable metadata is never treated as legacy and cannot be overwritten', async () => {
  files.clear();
  const uri = 'file:///documents/private.wav';
  await markRecordingOwner(uri, 'A');
  const metadataUri = [...files.keys()][0];
  for (const damaged of ['{', '{"version":1,"owner":"raw-code"}', '{"version":2,"owner":"' + hash('A') + '"}']) {
    files.set(metadataUri, Buffer.from(damaged));
    await assert.rejects(readRecordingOwner(uri));
    await assert.rejects(recoverableRootAudio([new File(uri)], [scope('B')]));
    await assert.rejects(markRecordingOwner(uri, 'B'));
  }
});

test('owner cannot be changed, and authorized code-replacement scopes still find interrupted audio', async () => {
  files.clear();
  const uri = 'file:///documents/owned.wav';
  await markRecordingOwner(uri, 'old-code');
  await markRecordingOwner(uri, 'old-code');
  await assert.rejects(markRecordingOwner(uri, 'other-code'), /different library/);
  assert.equal((await recoverableRootAudio([new File(uri)], [scope('new-code'), scope('old-code')])).length, 1);
  await assert.rejects(markRecordingOwner(null, 'old-code'), /local storage path/);
});

test('native recording is owned before capture begins and save uses its original library', () => {
  const source = readFileSync('app/record.js', 'utf8');
  const prepare = source.indexOf('await recorder.prepareToRecordAsync()');
  const ownership = source.indexOf('await markRecordingOwner(recorder.uri, consentLibrary)');
  const capture = source.indexOf('recorder.record()', prepare);
  assert.ok(prepare < ownership && ownership < capture);
  assert.match(source, /lectureStorageDirectory\(library, id\)/);
  assert.match(source, /recordingLibraryRef\.current = consentLibrary/);
});

test('iOS ExpoAudio and Android Audio paths can start only after durable ownership is saved', async () => {
  const { createRecorderLifecycle } = await import('../lib/recorder-lifecycle.js');
  for (const root of ['documents', 'cache']) {
    for (const platformFolder of ['ExpoAudio', 'Audio']) {
      files.clear();
      const uri = `file:///${root}/${platformFolder}/recording-123.m4a`;
      const native = { uri, prepared: false, captured: false,
        async prepareToRecordAsync() { this.prepared = true; },
        getStatus() { return { canRecord: this.prepared, isRecording: this.captured, url: this.uri }; },
        record() {
          assert.ok([...files.keys()].some(path => path.includes('/recording-owners/')));
          this.captured = true;
        },
      };
      const recorder = createRecorderLifecycle(() => native);
      await recorder.prepareToRecordAsync();
      await markRecordingOwner(recorder.uri, 'original-library');
      recorder.record();
      assert.equal(native.captured, true);
      assert.equal(await readRecordingOwner(uri), hash('original-library'));
      assert.equal((await recoverableRootAudio([new File(uri)], [scope('original-library')])).length, 1);
      assert.deepEqual(await recoverableRootAudio([new File(uri)], [scope('different-library')]), []);
    }
  }
  assert.deepEqual(recordingCaptureDirectories('file:///documents/').map(dir => dir.uri),
    ['file:///documents', 'file:///documents/ExpoAudio', 'file:///documents/Audio']);
  for (const path of ['lectures/id/audio.m4a', 'Other/audio.m4a', 'Audio/deeper/audio.m4a', 'Audio/..']) {
    assert.equal(hasRecordingOwnershipPath(`file:///documents/${path}`), false);
  }
});
