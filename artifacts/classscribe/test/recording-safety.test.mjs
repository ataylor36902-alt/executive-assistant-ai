import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const files = [
  new URL("../web-src/5_capture_lecture.js", import.meta.url),
  new URL("../web-public/index.html", import.meta.url),
];

function section(file, start, end) {
  const text = readFileSync(file, "utf8");
  const a = text.indexOf(start);
  const b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing recording section in ${file.pathname}`);
  return text.slice(a, b);
}

for (const file of files) {
  const label = file.pathname.includes("web-public") ? "served browser app" : "browser source";

  test(`${label}: uploaded audio keeps captured captions and earlier transcripts`, () => {
    const context = { ACT: {}, document: { addEventListener() {} } };
    runInNewContext(section(file, "function mergeAudioTranscript(", "async function transcribeInto("), context);
    const existing = [
      { t: 1, s: "P", x: "Captured caption", source: "caption" },
      { t: 3, s: "P", x: "Previous transcript", source: "transcription" },
      { t: 5, s: "S", x: "Typed note" },
    ];
    context.existing = existing;
    const added = runInNewContext("mergeAudioTranscript(existing,[{t:2,x:'Uploaded audio'}],'imported')", context);
    assert.deepEqual(JSON.parse(JSON.stringify(added)), [
      existing[0],
      { t: 2, s: "P", x: "Uploaded audio", source: "imported" },
      existing[1],
      existing[2],
    ]);
    assert.match(readFileSync(file, "utf8"), /transcribeInto\(id,a,null,'imported'\)/);
    const retried = runInNewContext("mergeAudioTranscript(existing,[{t:2,x:'Retry result'}],'transcription')", context);
    assert.deepEqual(JSON.parse(JSON.stringify(retried)), [
      { t: 2, s: "P", x: "Retry result", source: "transcription" },
      existing[2],
    ]);
  });

  test(`${label}: leaving capture during microphone permission stops the eventual stream`, async () => {
    let grantPermission;
    let constructed = 0;
    let stopped = 0;
    let reservationReleaseCalls = 0;
    class Recorder {
      constructor() { constructed++; }
      static isTypeSupported() { return false; }
    }
    const viewFile = file.pathname.includes("web-public")
      ? file : new URL("../web-src/4_views.js", import.meta.url);
    const context = {
      navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grantPermission = resolve; }) } },
      MediaRecorder: Recorder,
      window: { addEventListener() {}, scrollTo() {} },
      Blob, setTimeout, clearInterval,
      releaseRecordingReservation(session, quiet) {
        reservationReleaseCalls++;
        assert.equal(session.step, "live");
        assert.equal(quiet, true);
        return Promise.resolve(true);
      },
    };
    runInNewContext(`let SES={step:'live',running:true}; const S={view:{name:'capture'}}; const $=()=>null;
      let LEAVE=null,TICK=null,DEMO=null; const render=()=>{}; const toast=()=>{};\n` +
      section(viewFile, "function go(v){", "/* ---------- HOME ---------- */") +
      section(file, "const MIC=", "/* ---------- recorded audio kept"), context);
    const starting = runInNewContext("micStart(SES)", context);
    runInNewContext("go({name:'home'})", context);
    grantPermission({ getTracks: () => [{ stop() { stopped++; } }] });
    await starting;
    assert.equal(constructed, 0);
    assert.equal(stopped, 1);
    assert.equal(reservationReleaseCalls, 1);
    assert.equal(runInNewContext("MIC.state", context), "off");
  });

  test(`${label}: permission arriving after stop cannot start a recording`, async () => {
    let grantPermission;
    let constructed = 0;
    let stopped = 0;
    class Recorder {
      constructor() { constructed++; }
      static isTypeSupported() { return false; }
    }
    const context = {
      navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grantPermission = resolve; }) } },
      MediaRecorder: Recorder,
      window: { addEventListener() {} },
      Blob, setTimeout,
    };
    const code = `let SES={step:'live',running:true}; const S={view:{name:'capture'}}; const $=()=>null;\n` +
      section(file, "const MIC=", "/* ---------- recorded audio kept");
    runInNewContext(code, context);
    const starting = runInNewContext("micStart(SES)", context);
    await runInNewContext("micStop()", context);
    runInNewContext("SES=null; S.view.name='home'", context);
    grantPermission({ getTracks: () => [{ stop() { stopped++; } }] });
    await starting;
    assert.equal(constructed, 0);
    assert.equal(stopped, 1);
    assert.equal(runInNewContext("MIC.state", context), "off");
  });

  test(`${label}: recorder construction failure releases the microphone`, async () => {
    let stopped = 0;
    let attempts = 0;
    let reservationReleaseCalls = 0;
    class BrokenRecorder {
      constructor() { attempts++; throw new Error("unsupported codec"); }
      static isTypeSupported() { return false; }
    }
    const context = {
      navigator: { mediaDevices: { getUserMedia: async () => ({
        getTracks: () => [{ stop() { stopped++; } }],
      }) } },
      MediaRecorder: BrokenRecorder,
      window: { addEventListener() {} },
      Blob, setTimeout,
      releaseRecordingReservation(session, quiet) {
        reservationReleaseCalls++;
        assert.equal(session.step, "live");
        assert.equal(quiet, true);
        return Promise.resolve(true);
      },
    };
    runInNewContext(`let SES={step:'live',running:true}; const S={view:{name:'capture'}}; const $=()=>null;\n` +
      section(file, "const MIC=", "/* ---------- recorded audio kept"), context);
    await runInNewContext("micStart(SES)", context);
    assert.equal(attempts, 2);
    assert.equal(stopped, 1);
    assert.equal(reservationReleaseCalls, 1);
    assert.equal(runInNewContext("MIC.state", context), "unsupported");
  });

  test(`${label}: audio is saved only when the IndexedDB write commits`, async () => {
    let transaction;
    let closes = 0;
    const db = {
      transaction() {
        transaction = { objectStore: () => ({ put() {} }) };
        return transaction;
      },
      close() { closes++; },
    };
    const context = { audioDB: async () => db };
    runInNewContext(section(file, "async function audioSave(", "async function audioLoad("), context);

    let settled = false;
    const pending = runInNewContext("audioSave('lecture', {})", context).then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    transaction.oncomplete();
    await pending;
    assert.equal(settled, true);
    assert.equal(closes, 1);

    const failed = runInNewContext("audioSave('lecture', {})", context);
    await new Promise(resolve => setImmediate(resolve));
    transaction.error = new Error("storage full");
    transaction.onabort();
    await assert.rejects(failed, /storage full/);
    assert.equal(closes, 2);
  });
}