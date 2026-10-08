import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../lib/recorder-lifecycle.js', import.meta.url), 'utf8');
const { createRecorderLifecycle, recordingOptionsForPlatform } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function device() {
  const calls = [];
  let invalid = false;
  const native = {
    get id() { throw new Error('Native id must not be read'); },
    get isRecording() { throw new Error('Native recording getter must not be read'); },
    get uri() { if (invalid) throw new Error('Native object missing'); return 'file:///documents/lecture.m4a'; },
    getStatus() { if (invalid) throw new Error('Native object missing'); return { isRecording: calls.includes('record') && !calls.includes('stop'), durationMillis: 2500 }; },
    async prepareToRecordAsync() { calls.push('prepare'); },
    record() { calls.push('record'); },
    pause() { calls.push('pause'); },
    async stop() { calls.push('stop'); },
    release() { calls.push('release'); invalid = true; },
  };
  return { native, calls, invalidate() { invalid = true; } };
}
test('setup and render status never allocate or read native recorder getters', () => {
  let creates = 0;
  const controller = createRecorderLifecycle(() => { creates++; return device().native; });
  assert.equal(controller.getStatus().durationMillis, 0);
  assert.equal(controller.isRecording, false);
  assert.equal(controller.uri, null);
  controller.poll();
  controller.dispose();
  assert.equal(creates, 0);
});
test('recording begins only on prepare, with durable URI and duration snapshots', async () => {
  const d = device();
  const controller = createRecorderLifecycle(() => d.native);
  await controller.prepareToRecordAsync();
  controller.record();
  assert.equal(controller.isRecording, true);
  assert.equal(controller.getStatus().durationMillis, 2500);
  await controller.stop();
  assert.equal(controller.uri, 'file:///documents/lecture.m4a');
  assert.deepEqual(d.calls, ['prepare', 'record', 'stop']);
});
test('a vanished native object cannot crash render and retains the last audio path', async () => {
  const d = device();
  const controller = createRecorderLifecycle(() => d.native);
  await controller.prepareToRecordAsync();
  controller.record();
  d.invalidate();
  assert.doesNotThrow(() => controller.poll());
  assert.match(controller.getStatus().error, /recording device is unavailable/);
  assert.equal(controller.getStatus().durationMillis, 2500);
  assert.equal(controller.uri, 'file:///documents/lecture.m4a');
  assert.doesNotThrow(() => controller.isRecording);
});
test('paused recording is stopped before release and repeated cleanup is safe', async () => {
  const d = device();
  const controller = createRecorderLifecycle(() => d.native);
  await controller.prepareToRecordAsync();
  controller.record();
  controller.pause();
  controller.dispose();
  controller.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(d.calls, ['prepare', 'record', 'pause', 'stop', 'release']);
});
test('a failed status read after starting still allows the caller to stop the microphone', async () => {
  const d = device();
  const controller = createRecorderLifecycle(() => d.native);
  await controller.prepareToRecordAsync();
  d.native.record = () => { d.calls.push('record'); d.invalidate(); };
  assert.throws(() => controller.record(), /Native object missing/);
  assert.equal(controller.isRecording, true);
  await assert.rejects(controller.stop(), /Native object missing/);
  assert.ok(d.calls.includes('stop'));
});
test('effect cleanup/reactivation creates a new native instance instead of reusing a released object', async () => {
  const devices = [device(), device()];
  let creates = 0;
  const controller = createRecorderLifecycle(() => devices[creates++].native);
  await controller.prepareToRecordAsync();
  controller.dispose();
  await new Promise(resolve => setImmediate(resolve));
  controller.activate();
  await controller.prepareToRecordAsync();
  controller.record();
  assert.equal(creates, 2);
  assert.equal(controller.isRecording, true);
});
test('native and browser encoder options preserve the SDK platform option shape', () => {
  const options = { extension: '.m4a', sampleRate: 22050, numberOfChannels: 1, bitRate: 32000, isMeteringEnabled: true, directory: 'document', ios: { outputFormat: 'aac' }, web: { mimeType: 'audio/webm' } };
  assert.equal(recordingOptionsForPlatform(options, 'ios').directory, 'document');
  assert.equal(recordingOptionsForPlatform(options, 'ios').outputFormat, 'aac');
  assert.equal(recordingOptionsForPlatform(options, 'ios').bitRate, 32000);
  assert.equal(recordingOptionsForPlatform(options, 'web').mimeType, 'audio/webm');
  assert.equal(recordingOptionsForPlatform(options, 'web').directory, undefined);
});
