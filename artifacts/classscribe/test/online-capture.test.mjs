import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const files = ['web-src/5_capture_lecture.js', 'web-public/index.html'];
function harness(path, display) {
  const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const section = text.slice(text.indexOf('const MIC='), text.indexOf('/* ---------- recorded audio kept', text.indexOf('const MIC=')));
  let microphoneRequests = 0, releases = 0, recordedTracks = [];
  class Stream {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(stream) { recordedTracks = stream.getTracks(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; this.ondataavailable?.({ data: new Blob(['test audio']) }); }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.onstop?.(); }
  }
  const context = {
    navigator: { userAgent: 'Chrome/130', mediaDevices: {
      getDisplayMedia: async options => { assert.equal(options.systemAudio, 'exclude'); return display; },
      getUserMedia: async () => { microphoneRequests++; throw Error('Unexpected microphone'); },
    } },
    window: { isSecureContext: true, addEventListener() {}, CS_TRANSCRIBE() {},
      SpeechRecognition: class { constructor() { throw Error('Unexpected microphone captions'); } } },
    MediaStream: Stream, MediaRecorder: Recorder, Blob, Date,
    setTimeout() {}, render() {}, releaseRecordingReservation() { releases++; },
  };
  runInNewContext(`let SES={step:'live',running:true,audioSource:'online',acc:0,resumeAt:Date.now()};
    const S={view:{name:'capture'}};const $=()=>null;const PRIVACY_CONFIG={};
    ${section}`, context);
  return { context, run: code => runInNewContext(code, context), counts: () => ({ microphoneRequests, releases, recordedTracks }) };
}
function track(kind, surface = 'browser') {
  return { kind, readyState: 'live', stopped: 0, listener: null,
    getSettings() { return { displaySurface: surface }; },
    stop() { this.stopped++; this.readyState = 'ended'; },
    addEventListener(event, fn) { if(event === 'ended') this.listener = fn; },
  };
}
function display(audio = [track('audio')], video = track('video')) {
  return { audio, video, getTracks: () => [...audio, video], getAudioTracks: () => audio, getVideoTracks: () => [video] };
}
for(const path of files) {
  test(`${path}: cancelling the chooser is explicit and never requests the microphone`, async () => {
    const h = harness(path, display());
    h.context.navigator.mediaDevices.getDisplayMedia = async () => {
      const error = new Error('Permission denied'); error.name = 'NotAllowedError'; throw error;
    };
    await assert.rejects(h.run('prepareOnlineCapture()'), /cancelled or blocked.*Nothing was recorded/);
    assert.equal(h.counts().microphoneRequests, 0);
    assert.equal(h.counts().releases, 0);
  });
  test(`${path}: no shared audio fails explicitly and releases the tab`, async () => {
    const stream = display([]);
    const h = harness(path, stream);
    await assert.rejects(h.run('prepareOnlineCapture()'), /No tab audio was shared/);
    assert.equal(stream.video.stopped, 1);
    assert.equal(h.counts().microphoneRequests, 0);
  });
  test(`${path}: window or screen sharing is rejected`, async () => {
    const stream = display(undefined, track('video', 'window'));
    const h = harness(path, stream);
    await assert.rejects(h.run('prepareOnlineCapture()'), /Choose a browser tab/);
    assert.ok(stream.getTracks().every(t => t.stopped > 0));
  });
  test(`${path}: online recording uses audio only, no microphone or captions, and saves a blob`, async () => {
    const stream = display(), h = harness(path, stream);
    h.context.display = stream;
    h.run('SES.sharedTabStream=display');
    await h.run('micStart(SES)');
    assert.deepEqual(h.counts().recordedTracks.map(t => t.kind), ['audio']);
    assert.equal(h.counts().microphoneRequests, 0);
    assert.equal(h.run('MIC.wantCaptions'), false);
    assert.equal(h.run('MIC.state'), 'on');
    const blob = await h.run('micStop()');
    assert.ok(blob.size > 0);
    assert.ok(stream.getTracks().every(t => t.stopped > 0));
  });
  test(`${path}: ending sharing pauses safely and retains captured audio`, async () => {
    const stream = display(), h = harness(path, stream);
    h.context.display = stream;
    h.run('SES.sharedTabStream=display');
    await h.run('micStart(SES)');
    stream.video.listener();
    assert.equal(h.run('SES.running'), false);
    assert.equal(h.run('MIC.state'), 'ended');
    assert.match(h.run('micNoteHTML()'), /Audio already captured is retained/);
    assert.ok((await h.run('micStop()')).size > 0);
  });
  test(`${path}: ended audio before start releases the reservation without microphone fallback`, async () => {
    const stream = display(), h = harness(path, stream);
    stream.audio[0].readyState = 'ended';
    h.context.display = stream;
    h.run('SES.sharedTabStream=display');
    await h.run('micStart(SES)');
    assert.equal(h.counts().releases, 1);
    assert.equal(h.counts().microphoneRequests, 0);
    assert.ok(stream.video.stopped > 0);
  });
  test(`${path}: mobile and unsupported browsers cannot start online capture`, () => {
    const h = harness(path, display());
    h.context.navigator.userAgent = 'Firefox/130';
    assert.equal(h.run('onlineCaptureSupported()'), false);
    h.context.navigator.userAgent = 'Chrome/130 Android Mobile';
    assert.equal(h.run('onlineCaptureSupported()'), false);
    h.context.navigator.userAgent = 'Chrome/130';
    h.context.window.isSecureContext = false;
    assert.equal(h.run('onlineCaptureSupported()'), false);
  });
}
test('source and served capture sections stay aligned', () => {
  const source = readFileSync(new URL('../web-src/5_capture_lecture.js', import.meta.url), 'utf8');
  const served = readFileSync(new URL('../web-public/index.html', import.meta.url), 'utf8');
  const cut = s => s.slice(s.indexOf('const MIC='), s.indexOf('/* ---------- recorded audio kept', s.indexOf('const MIC=')));
  assert.equal(cut(source), cut(served));
  for(const name of ['../web-src/6_study_social.js', '../web-public/index.html']) {
    const s = readFileSync(new URL(name, import.meta.url), 'utf8');
    const start = s.indexOf("if(k==='startRec'){"), section = s.slice(start, s.indexOf("if(k==='welcome'||k==='account')", start));
    assert.ok(section.indexOf('await prepareOnlineCapture()') < section.indexOf('await persistRecordingConsent('));
    assert.match(section, /finally\{if\(!handedOff\)stopCaptureTracks\(sharedTabStream\)/);
    assert.match(section, /if\(f.dataset.starting\)return/);
  }
});
