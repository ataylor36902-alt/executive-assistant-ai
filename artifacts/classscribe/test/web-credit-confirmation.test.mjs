import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const coreFiles = [
  new URL("../web-src/3_core.js", import.meta.url),
  new URL("../web-public/index.html", import.meta.url),
];
const captureFiles = [
  new URL("../web-src/5_capture_lecture.js", import.meta.url),
  new URL("../web-public/index.html", import.meta.url),
];

for (const file of coreFiles) {
  const label = file.pathname.includes("web-public") ? "served browser app" : "browser source";
  test(`${label} transcription captures and forwards the current library code`, async () => {
    const source = readFileSync(file, "utf8");
    const start = source.indexOf("function installCreditAwareTranscription(){");
    const end = source.indexOf("async function billingRecordingAction(", start);
    assert.ok(start >= 0 && end > start, "credit-aware transcription wrapper exists");

    let currentCode = "library-one";
    let request;
    const context = {
      window: { CS_TRANSCRIBE: async () => [] },
      FileReader: class {
        readAsDataURL() {
          this.result = "data:audio/webm;base64,YQ==";
          this.onload();
        }
      },
      billingUserCode: () => currentCode,
      creditActionPost: async (path, body, label, options) => {
        request = { path, body, label, options };
        currentCode = "library-two";
        return { segments: [{ t: 1, x: "speech" }] };
      },
    };

    runInNewContext(source.slice(start, end) + "\ninstallCreditAwareTranscription();", context);
    const consent = {
      consentId: "00000000-0000-4000-8000-000000000000",
      recordingId: "recording-1", sessionId: "recording-1",
      lectureId: "lecture-1", courseId: "course-1",
    };
    const segments = await context.window.CS_TRANSCRIBE({ size: 1, type: "audio/webm" }, consent);

    assert.deepEqual(JSON.parse(JSON.stringify(segments)), [{ t: 1, x: "speech" }]);
    assert.equal(request.path, "/api/transcribe");
    assert.equal(request.options.userCode, "library-one");
    assert.equal(request.options.includeQuotedCost, true);
    assert.equal(request.options.isCurrent(), false);
    assert.equal(request.body.consentId, consent.consentId);
    assert.equal(request.body.recordingId, consent.recordingId);
  });
}

for (const file of captureFiles) {
  const label = file.pathname.includes("web-public") ? "served browser app" : "browser source";
  test(`${label} allows transcription-hour quotes but blocks exhausted transcription counts`, async () => {
    const source = readFileSync(file, "utf8");
    const start = source.indexOf("async function processLecture(");
    const end = source.indexOf("ACT.recDiscard=", start);
    assert.ok(start >= 0 && end > start, "lecture transcription processing exists");

    let transcriptCalls = 0;
    let savedLecture = { id: "lecture-1", segs: [], slides: [] };
    const context = {
      S: { busy: {} },
      window: { CS_TRANSCRIBE: async () => { transcriptCalls++; return [{ t: 1, x: "speech" }]; } },
      lecture: () => savedLecture,
      put: async (_kind, value) => { savedLecture = value; },
      transcriptionLimitReached: () => true,
      transcriptionCountLimitReached: () => false,
      transcriptionCountNotice: () => "Count limit reached",
      lectureNotesText: () => "",
      billingUserCode: () => "library-one",
      loadBillingStatus: async () => {},
      render() {},
      toast() {},
      AI: async () => null,
      analyze() {},
    };
    runInNewContext(source.slice(start, end), context);
    await context.processLecture("lecture-1", { size: 1 });
    assert.equal(transcriptCalls, 1, "hours-limit status must be sent to the server for a credit quote");

    transcriptCalls = 0;
    savedLecture = { id: "lecture-1", segs: [], slides: [] };
    context.transcriptionCountLimitReached = () => true;
    await context.processLecture("lecture-1", { size: 1 });
    assert.equal(transcriptCalls, 0, "the successful-transcription count quota remains a client-side block");
  });
}

for (const file of captureFiles) {
  const label = file.pathname.includes("web-public") ? "served browser app" : "browser source";
  test(`${label} allows paid plans to request a credit quote after their included count allowance is used`, () => {
    const source = readFileSync(file.pathname.includes("web-public")
      ? file : new URL("../web-src/3_core.js", import.meta.url), "utf8");
    const start = source.indexOf("function transcriptionCountLimitReached(){");
    const end = source.indexOf("function recordingCountNotice(){", start);
    assert.ok(start >= 0 && end > start);
    let plan = "pro";
    const context = {
      monthlyCountLimit: () => 60,
      transcriptionCountUsed: () => 60,
      currentBillingStatus: () => ({ plan }),
    };
    runInNewContext(source.slice(start, end), context);
    assert.equal(context.transcriptionCountLimitReached(), false,
      "Pro's exhausted allowance must reach server-side payment confirmation, not disable transcription");
    plan = "student";
    assert.equal(context.transcriptionCountLimitReached(), false, "Student also reaches a credit quote");
    plan = "free";
    assert.equal(context.transcriptionCountLimitReached(), true, "Free keeps its count policy");
  });
}