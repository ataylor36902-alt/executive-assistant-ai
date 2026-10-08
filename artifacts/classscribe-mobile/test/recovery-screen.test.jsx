import test from 'node:test';
import { createHash } from 'node:crypto';
import { markRecordingOwner } from '../lib/recording-ownership';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RecoverRecordings from '../app/recover-recordings';
import { beginRender, endRender, consentSheets, controls, files, players, remount, resetRecovery, runMountEffects, store } from './fixtures/recovery-ui';

function render() {
  beginRender();
  const markup = renderToStaticMarkup(<RecoverRecordings />);
  endRender();
  return markup;
}
function press(id) {
  const control = controls.find(c => c.testID === id || c.accessibilityLabel === id);
  assert.ok(control, `missing control: ${id}`);
  assert.notEqual(control.disabled, true, `${id} disabled`);
  return control.onPress();
}

test('root and cache ownership gates recovery before previews or selection; legacy stays manual', async () => {
  resetRecovery();
  const hash = code => createHash('sha256').update(code).digest('hex');
  store.audioRecoveryScopes = async code => [`file:///documents/lectures/by-library/${hash(code)}`];
  const mine = 'file:///documents/ExpoAudio/mine.m4a';
  const theirs = 'file:///documents/Audio/theirs.m4a';
  const cacheMine = 'file:///cache/Audio/cache-mine.m4a';
  const cacheOther = 'file:///cache/ExpoAudio/cache-other.m4a';
  const legacy = 'file:///documents/legacy.wav';
  for (const uri of [mine, theirs, cacheMine, cacheOther, legacy, 'file:///cache/unknown.wav']) files.set(uri, { size: 100 });
  await markRecordingOwner(mine, 'test-library');
  await markRecordingOwner(cacheMine, 'test-library');
  await markRecordingOwner(theirs, 'other-library');
  await markRecordingOwner(cacheOther, 'other-library');
  const before = [...files.entries()];
  render();
  await runMountEffects();
  let markup = render();
  for (const name of ['mine.m4a', 'cache-mine.m4a', 'legacy.wav']) assert.ok(controls.some(c => c.testID === `recover-select-${name}`), `${name}: ${markup}`);
  assert.doesNotMatch(markup, /theirs\.m4a|cache-other\.m4a|unknown\.wav/);
  assert.equal(controls.find(c => c.testID === 'recover-select-legacy.wav').accessibilityState.checked, false);
  assert.deepEqual([...files.entries()], before);
  assert.equal(store.transcriptionCalls.length, 0);
  store.status.uid = 'other-library';
  remount();
  render();
  await runMountEffects();
  markup = render();
  assert.match(markup, /theirs\.m4a/);
  assert.match(markup, /cache-other\.m4a/);
  assert.doesNotMatch(markup, /mine\.m4a/);
  assert.match(markup, /legacy\.wav/);
});

test('an empty scan confirms completion and each tap shows a new scan result without changing files', async () => {
  resetRecovery();
  assert.doesNotMatch(render(), /No unlinked audio files found/);
  await runMountEffects();
  let markup = render();
  assert.match(markup, /Scan 1 complete at/);
  assert.match(markup, /Checked 0 saved audio files; 0 available for recovery/);
  assert.match(markup, /No unlinked audio files found/);
  await press('recover-scan');
  markup = render();
  assert.match(markup, /Scan 2 complete at/);
  assert.equal(files.size, 0);
  assert.equal(store.transcriptionCalls.length, 0);
});

test('scan feedback distinguishes audio already in Library from audio available for recovery', async () => {
  resetRecovery();
  files.set('file:///documents/already-saved.m4a', { size: 100 });
  files.set('file:///documents/orphan.wav', { size: 100 });
  files.set('file:///documents/empty.wav', { size: 0 });
  files.set('file:///documents/note.txt', { size: 100 });
  store.records.lectures.linked = { id: 'linked', audioUri: 'file:///documents/already-saved.m4a' };
  const originalFiles = [...files.entries()];
  render();
  await runMountEffects();
  const markup = render();
  assert.match(markup, /Checked 2 saved audio files; 1 available for recovery/);
  assert.match(markup, /1 already linked to your library/);
  assert.ok(controls.some(c => c.testID === 'recover-select-orphan.wav'));
  assert.ok(!controls.some(c => c.testID === 'recover-select-already-saved.m4a'));
  assert.deepEqual([...files.entries()], originalFiles);
  assert.equal(store.transcriptionCalls.length, 0);
});

test('a scan waiting for storage shows Checking and disables repeated taps until completion', async () => {
  resetRecovery();
  let finish;
  store.audioRecoveryScopes = () => new Promise(resolve => { finish = resolve; });
  render();
  await runMountEffects();
  const pending = render();
  assert.match(pending, /Checking…/);
  assert.equal(controls.find(c => c.testID === 'recover-scan').disabled, true);
  assert.doesNotMatch(pending, /No unlinked audio files found|Scan 1 complete/);
  finish([]);
  await new Promise(resolve => setImmediate(resolve));
  const completed = render();
  assert.match(completed, /Scan 1 complete/);
  assert.equal(controls.find(c => c.testID === 'recover-scan').disabled, false);
});

test('a library that is not ready explains the blocked scan instead of claiming no recordings exist', async () => {
  for (const state of [{ loading: true, uid: 'test-library' }, { loading: false, uid: null }]) {
    resetRecovery();
    Object.assign(store.status, state);
    render();
    await runMountEffects();
    render();
    await press('recover-scan');
    const markup = render();
    assert.match(markup, state.loading ? /Your library is still loading/ : /Open your library first/);
    assert.doesNotMatch(markup, /No unlinked audio files found|Scan 1 complete/);
    assert.equal(store.transcriptionCalls.length, 0);
  }
});

test('a storage failure is shown as an error rather than a successful empty scan', async () => {
  resetRecovery();
  store.audioRecoveryScopes = async () => { throw new Error('Storage read failed'); };
  render();
  await runMountEffects();
  const markup = render();
  assert.match(markup, /Could not check this phone’s recordings: Storage read failed/);
  assert.doesNotMatch(markup, /No unlinked audio files found|Scan 1 complete/);
  assert.equal(controls.find(c => c.testID === 'recover-scan').disabled, false);
});

test('recovery screen scans document root, previews audio, restores into a personal course and excludes the linked file after remount', async () => {
  resetRecovery();
  const orphan = 'file:///documents/recovery-test.wav';
  files.set(orphan, { size: 16044, modified: 1770000000000 });
  files.set('file:///documents/note.txt', { size: 10 });
  files.set('file:///documents/lectures/unlinked.m4a', { size: 100 });
  store.records.courses.example = { id: 'example', name: 'Example', ex: true };
  store.records.courses.personal = { id: 'personal', name: 'My biology course', ex: false };
  store.records.lectures.linked = { id: 'linked', audioUri: 'file:///documents/linked.m4a', audioName: 'linked.m4a' };
  files.set('file:///documents/linked.m4a', { size: 100 });

  render();
  await runMountEffects();
  let markup = render();
  assert.match(markup, /recovery-test\.wav/);
  assert.doesNotMatch(markup, />linked\.m4a</);
  assert.match(markup, /unlinked\.m4a/); // Legacy nested files have no owner.
  assert.ok(!controls.some(c => c.testID === 'recover-course-example'));

  press('recover-preview-recovery-test.wav');
  render();
  assert.equal(players.at(-1).source.uri, orphan);
  press('Play');
  assert.equal(players.at(-1).playing, true);
  press('recover-select-recovery-test.wav');
  render();
  press('recover-course-personal');
  markup = render();
  assert.match(markup, /Transcription requests from recovery: 0/);
  assert.equal(controls.find(c => c.testID === 'recover-transcription').accessibilityState.checked, false);
  await press('recover-restore');
  markup = render();
  assert.match(markup, /1 recording restored/);
  assert.match(markup, /Transcription requests from recovery: 0/);
  assert.equal(store.transcriptionCalls.length, 0);
  const recovered = Object.values(store.records.lectures).find(l => l.legacyAudioUri === orphan);
  assert.ok(recovered);
  assert.equal(recovered.courseId, 'personal');
  assert.equal(recovered.audioName, 'recovery-test.wav');
  assert.equal(recovered.ex, false);
  assert.equal(files.has(orphan), true);

  remount(); // Persisted library and document files remain after an app restart.
  render();
  await runMountEffects();
  markup = render();
  assert.doesNotMatch(markup, /recovery-test\.wav/);
  assert.doesNotMatch(markup, /recovery-test\.wav/);
});

test('only the active library scoped directory appears; ownerless legacy audio remains a manual choice', async () => {
  resetRecovery();
  files.set('file:///documents/lectures/by-library/test-library/l1/audio.m4a', { size: 100 });
  files.set('file:///documents/lectures/by-library/another-library/l2/audio.m4a', { size: 100 });
  files.set('file:///documents/lectures/old-l3/audio.m4a', { size: 100 });
  render();
  await runMountEffects();
  const markup = render();
  assert.match(markup, /Older file · library unknown/);
  assert.match(markup, /New recordings are kept separate/);
  assert.ok(controls.some(c => c.testID === 'recover-select-audio.m4a'));
  assert.equal((markup.match(/audio\.m4a/g) || []).length, 2);
  store.status.uid = 'another-library';
  render();
  await runMountEffects();
  const switched = render();
  assert.equal((switched.match(/audio\.m4a/g) || []).length, 2);
  assert.doesNotMatch(switched, /test-library/);
});

test('an orphan in an authorized prior scope stays recoverable after replacing the library code', async () => {
  resetRecovery();
  const oldScope = 'file:///documents/lectures/by-library/old-code';
  files.set(`${oldScope}/unlinked/audio.wav`, { size: 100 });
  files.set('file:///documents/lectures/by-library/unrelated/unlinked/audio.wav', { size: 100 });
  store.status.uid = 'replacement-code';
  store.previousScopes = [oldScope];
  render();
  await runMountEffects();
  const markup = render();
  assert.match(markup, /audio\.wav/);
  assert.equal((markup.match(/audio\.wav/g) || []).length, 1);
  press('recover-select-audio.wav');
  render();
  await press('recover-restore');
  const restored = Object.values(store.records.lectures).find(l => l.legacyAudioUri === `${oldScope}/unlinked/audio.wav`);
  assert.ok(restored);
  assert.match(restored.audioUri, /replacement-code/);
  assert.equal(files.has(`${oldScope}/unlinked/audio.wav`), true);
});

test('recovered transcription waits for a fresh explicit consent confirmation and cancellation leaves audio untouched', async () => {
  resetRecovery();
  const orphan = 'file:///documents/legacy-recording.m4a';
  files.set(orphan, { size: 900, modified: 1770000000000 });
  render();
  await runMountEffects();
  render();
  press('recover-select-legacy-recording.m4a');
  render();
  press('recover-transcription');
  render();
  await press('recover-restore');
  render();
  assert.equal(store.transcriptionCalls.length, 0);
  assert.match(render(), /Fresh recording-consent confirmation/);
  const consent = consentSheets.at(-1);
  assert.equal(consent.lectureId, consent.sessionId);
  assert.equal(consent.courseId, Object.values(store.records.lectures).find((item) => item.legacyAudioUri === orphan).courseId);
  consent.onConfirmed();
  consent.onClose();
  render();
  assert.equal(store.transcriptionCalls.length, 1);
  assert.equal(files.has(orphan), true);

  resetRecovery();
  const cancelledOrphan = 'file:///documents/cancelled-recording.m4a';
  files.set(cancelledOrphan, { size: 900, modified: 1770000000000 });
  render();
  await runMountEffects();
  render();
  press('recover-select-cancelled-recording.m4a');
  render();
  press('recover-transcription');
  render();
  await press('recover-restore');
  render();
  assert.equal(store.transcriptionCalls.length, 0);
  const cancelConsent = consentSheets.at(-1);
  cancelConsent.onClose();
  render();
  assert.equal(store.transcriptionCalls.length, 0);
  assert.equal(files.has(cancelledOrphan), true);
});

test('a corrupt recording shows a per-file error and can be skipped without blocking a healthy recovery', async () => {
  resetRecovery();
  const corrupt = 'file:///documents/damaged.wav';
  const healthy = 'file:///documents/healthy.wav';
  files.set(corrupt, { size: 9, status: { isLoaded: false, error: 'Decoder failed', playbackState: 'error' } });
  files.set(healthy, { size: 16044 });
  render();
  await runMountEffects();
  render();
  press('recover-select-damaged.wav');
  press('recover-select-healthy.wav');
  render();
  press('recover-preview-damaged.wav');
  render();
  await runMountEffects();
  let markup = render();
  assert.match(markup, /cannot be previewed/);
  assert.match(markup, /damaged or use an unsupported/);
  assert.doesNotMatch(markup, /Loading audio/);
  press('recover-preview-damaged.wav'); // Error remains when preview is hidden.
  assert.match(render(), /cannot be previewed/);
  press('recover-skip-damaged.wav');
  markup = render();
  assert.doesNotMatch(markup, /damaged\.wav/);
  assert.match(markup, /Restore 1 selected recording/);
  press('recover-preview-healthy.wav');
  render();
  press('Play');
  assert.equal(players.at(-1).playing, true);
  await press('recover-restore');
  assert.match(render(), /1 recording restored/);
  assert.equal(Object.values(store.records.lectures).length, 1);
  assert.equal(Object.values(store.records.lectures)[0].audioName, 'healthy.wav');
  assert.equal(files.has(corrupt), true);
  assert.equal(store.transcriptionCalls.length, 0);
  await press('recover-scan');
  markup = render();
  assert.match(markup, /damaged\.wav/);
  assert.doesNotMatch(markup, /cannot be previewed/);
});

test('a stalled load times out, while a healthy load cancels its timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  resetRecovery();
  const stalled = 'file:///documents/stalled.wav';
  files.set(stalled, { size: 9, status: { isLoaded: false, error: null, playbackState: 'unknown' } });
  render();
  await runMountEffects();
  render();
  press('recover-preview-stalled.wav');
  assert.match(render(), /Loading audio/);
  await runMountEffects();
  t.mock.timers.tick(15000);
  let markup = render();
  assert.match(markup, /did not finish loading/);
  assert.doesNotMatch(markup, /Loading audio/);
  press('recover-skip-stalled.wav');
  render();
  assert.equal(files.has(stalled), true);

  resetRecovery();
  files.set(stalled, { size: 16044, status: { isLoaded: false } });
  render();
  await runMountEffects();
  render();
  press('recover-preview-stalled.wav');
  render();
  await runMountEffects();
  files.get(stalled).status.isLoaded = true;
  render();
  await runMountEffects();
  t.mock.timers.tick(15000);
  markup = render();
  assert.doesNotMatch(markup, /did not finish loading/);
  press('Play');
  assert.equal(players.at(-1).playing, true);
  remount();
});

test('closing a loading preview cancels its timer and playback exceptions stay local to the file', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  resetRecovery();
  const uri = 'file:///documents/slow.wav';
  files.set(uri, { size: 100, status: { isLoaded: false } });
  render();
  await runMountEffects();
  render();
  press('recover-preview-slow.wav');
  render();
  await runMountEffects();
  press('Close preview');
  render();
  t.mock.timers.tick(15000);
  assert.doesNotMatch(render(), /did not finish loading/);
  files.get(uri).status.isLoaded = true;
  press('recover-preview-slow.wav');
  render();
  players.at(-1).play = () => { throw new Error('Native playback failed'); };
  press('Play');
  assert.match(render(), /cannot be previewed/);
  remount();
});