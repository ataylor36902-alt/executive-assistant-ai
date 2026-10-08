import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const files = [
  new URL("../web-src/6_study_social.js", import.meta.url),
  new URL("../web-src/7_notes.js", import.meta.url),
  new URL("../web-public/index.html", import.meta.url),
];

function read(file) {
  return readFileSync(file, "utf8");
}

function sourceSection(file, start, end) {
  const text = read(file);
  const a = text.indexOf(start);
  const b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing ${start} in ${file.pathname}`);
  return text.slice(a, b);
}

function studyFunctions(file) {
  const source = read(file);
  const start = source.indexOf("const COURSE_STUDY_ID=");
  const end = source.indexOf("function studyKey(", start);
  assert.ok(start >= 0 && end > start, `Missing study helpers in ${file.pathname}`);
  return source.slice(start, end);
}

function noteFunctions(file) {
  return sourceSection(file, "function capturePrivateSourceScope(", "ACT.importSource=");
}

const studyFiles = [files[0], files[2]];
const noteFiles = [files[1], files[2]];

for (const file of noteFiles) {
  test(`${file.pathname}: document import saves analysis, allows opt-out, and rejects a changed library`, async () => {
    for (const scenario of ["analyze", "no-ai", "switch-library", "ai-error"]) {
      const nodes = {
        "#source-course": { value: "course" },
        "#source-type": { value: "reading" },
        "#source-file": { files: [] },
        "#source-text": { value: "Cells contain DNA. Mitochondria produce energy." },
        "#source-title": { value: "Week 1 reading" },
        "#source-import-status": { textContent: "" },
        "#source-import-submit": { disabled: false },
        "#source-analyze": { checked: scenario !== "no-ai" },
      };
      const form = { isConnected: true, querySelector: selector => nodes[selector] };
      let submitHandler, aiCalls = 0, saved = null, closed = false, navigated;
      const context = {
        S: { uid: "original-library", mode: "db", notes: {} },
        SOURCE_NOTE_TYPES: ["reading", "syllabus", "study-guide"],
        $: selector => nodes[selector],
        document: { addEventListener: (_event, handler) => { submitHandler = handler; } },
        course: id => id === "course" ? { id, ex: false } : null,
        isExampleRecord: () => false,
        clone: value => JSON.parse(JSON.stringify(value)),
        schedule() {},
        uid: () => "source-id",
        NOTE_UI: {},
        closeModal: () => { closed = true; },
        go: value => { navigated = value; },
        toast() {},
        CS_STUDY: async (operation, payload) => {
          aiCalls++;
          assert.equal(operation, "source-summary");
          assert.equal(payload.material, nodes["#source-text"].value);
          if (scenario === "switch-library") context.S.uid = "another-library";
          if (scenario === "ai-error") throw new Error("Analysis unavailable; please retry.");
          return { summary: "Cell biology.", keyPoints: ["DNA is in cells.", "Mitochondria produce energy."] };
        },
        DB: { doc: path => ({ collection: name => ({ doc: id => ({ set: async value => { saved = { path, name, id, value }; } }) }) }) },
      };
      runInNewContext(noteFunctions(file), context);
      const importSection = sourceSection(file, "ACT.importSource=", "ACT.noteMode=");
      const handlerStart = importSection.indexOf("document.addEventListener('submit',async e=>{");
      assert.ok(handlerStart >= 0);
      runInNewContext(importSection.slice(handlerStart), context);
      await submitHandler({ target: { closest: () => form }, preventDefault() {} });
      if (scenario === "switch-library" || scenario === "ai-error") {
        assert.equal(saved, null);
        assert.equal(closed, false);
        assert.match(nodes["#source-import-status"].textContent, /changed|unavailable/);
      } else {
        assert.equal(saved.path, "data/users/original-library/lib");
        assert.equal(saved.value.body, nodes["#source-text"].value);
        assert.equal(closed, true);
        assert.equal(navigated.id, "source-id");
        if (scenario === "analyze") assert.equal(saved.value.sourceAnalysis.keyPoints.length, 2);
        else { assert.equal(aiCalls, 0); assert.equal(saved.value.sourceAnalysis, undefined); }
      }
      assert.equal(nodes["#source-import-submit"].disabled, scenario === "analyze" || scenario === "no-ai");
    }
  });
}

for (const file of studyFiles) {
  const label = file.pathname.includes("web-public") ? "served browser app" : "browser source";

  test(`${label}: source context distributes excerpts fairly and states omitted coverage`, () => {
    const sourceNotes = [
      { id: "one", title: "One", sourceType: "reading", body: "A".repeat(1400) },
      { id: "two", title: "Two", sourceType: "syllabus", body: "B".repeat(1400) },
      { id: "three", title: "Three", sourceType: "study-guide", body: "C".repeat(1400) },
    ];
    const context = { sourceNotesOf: () => sourceNotes };
    runInNewContext(studyFunctions(file), context);
    const result = runInNewContext("sourceNotesMaterial('course', 1200)", context);
    assert.equal(result.totalCount, 3);
    assert.equal(result.excerptedCount, 3);
    assert.ok(result.includedChars > 0);
    assert.ok(result.text.length <= 1200);
    for (const [index, letter] of ["A", "B", "C"].entries()) {
      assert.ok(result.text.includes(`title: ${["One", "Two", "Three"][index]}`));
      assert.ok(result.text.includes(letter.repeat(12)), `source ${letter} should receive a fair excerpt`);
    }
    assert.match(result.text, /Excerpted for AI context/);
    assert.match(runInNewContext("sourceCoveragePrompt(sourceNotesMaterial('course', 1200))", context), /3 private source notes.*3 were excerpted/s);
  });

  test(`${label}: no upcoming exam defaults to Student course study, not Finals`, () => {
    const context = {};
    runInNewContext(studyFunctions(file), context);
    assert.equal(runInNewContext("defaultExamStudyId([])", context), "__course_study__");
    assert.equal(runInNewContext("defaultExamStudyId([{id:'quiz-1'}])", context), "quiz-1");
    const source = read(file);
    assert.match(source, /if\(v\.examId===undefined\)v\.examId=defaultExamStudyId\(exams\)/);
    assert.match(source, /if\(v\.examId==='finals'&&examFeatureState\('finals'\)!=='allowed'\)/);
    assert.match(source, /const premiumState=examFeatureState\('studyTools'\)/);
  });

  test(`${label}: Student course-study route renders guide, cards, practice and tutor`, () => {
    const text = read(file);
    const start = text.indexOf("VIEWS.exam=v=>{");
    const end = text.indexOf("ACT.examBillingRetry=", start);
    assert.ok(start >= 0 && end > start, `Missing exam view in ${file.pathname}`);
    const context = {
      VIEWS: {},
      S: { courses: { course: { id: "course", code: "BIO 101", name: "Biology", guides: {} } }, busy: { guide: false } },
      coursesSorted: () => [{ id: "course", code: "BIO 101", name: "Biology" }],
      upcoming: () => [],
      course: id => id === "course" ? context.S.courses.course : null,
      assignOf: () => [],
      daysUntil: () => 30,
      allA: () => ({}),
      currentBillingStatus: () => ({ plan: "student" }),
      lecturesOf: () => [],
      topicCounts: () => [],
      weakList: () => [],
      sourceNotesOf: () => [],
      examFeatureState: feature => feature === "studyTools" ? "allowed" : "pro-required",
      examAccessNotice: () => "",
      goAttr: () => "data-nav",
      plural: (count, word) => `${count} ${word}`,
      esc: value => String(value || ""),
      fmtD: () => "",
      fmtLong: () => "",
      relDue: () => "",
      ic: () => "",
    };
    runInNewContext(studyFunctions(file), context);
    runInNewContext(text.slice(start, end), context);
    const view = { courseId: "course" };
    const html = runInNewContext("VIEWS.exam(view)", { ...context, view });
    assert.equal(view.examId, "__course_study__");
    assert.match(html, /Course study/);
    assert.match(html, /Generate study guide/);
    assert.match(html, /Flashcards/);
    assert.match(html, /Take a practice exam/);
    assert.match(html, /Study companion/);
    assert.match(html, /Finals Mode · Pro/);
  });
}

for (const file of noteFiles) {
  const label = file.pathname.includes("web-public") ? "served browser app" : "browser source";

  test(`${label}: import refuses a write after the active library changes`, async () => {
    const writes = [];
    const context = {
      S: { uid: "user-a", mode: "db", courses: { course: { id: "course" } }, notes: {} },
      DB: { doc(path) { return { collection() { return { doc(id) { return { set(value) { writes.push({ path, id, value }); } }; } }; } }; } },
      course(id) { return context.S.courses[id]; },
      isExampleRecord: () => false,
      clone: value => JSON.parse(JSON.stringify(value)),
      schedule() {},
      COLS: ["courses", "lectures", "assignments", "stats", "notes"],
      localStorage: { setItem() {} },
    };
    runInNewContext(noteFunctions(file), context);
    context.scope = runInNewContext("capturePrivateSourceScope('course')", context);
    context.S.uid = "user-b";
    context.S.courses = { course: { id: "course" } };
    await assert.rejects(
      runInNewContext("writePrivateSource({id:'note',courseId:'course'}, scope)", context),
      /active library or course changed/,
    );
    assert.equal(writes.length, 0);
  });

  test(`${label}: a pending acknowledged write stays scoped to the initiating UID`, async () => {
    let acknowledge;
    const writes = [];
    const context = {
      S: { uid: "user-a", mode: "db", courses: { course: { id: "course" } }, notes: {} },
      DB: { doc(path) { return { collection() { return { doc(id) { return { set(value) { writes.push({ path, id, value }); return new Promise(resolve => { acknowledge = resolve; }); } }; } }; } }; } },
      course(id) { return context.S.courses[id]; },
      isExampleRecord: () => false,
      clone: value => JSON.parse(JSON.stringify(value)),
      schedule() {},
      COLS: ["courses", "lectures", "assignments", "stats", "notes"],
      localStorage: { setItem() {} },
    };
    runInNewContext(noteFunctions(file), context);
    context.scope = runInNewContext("capturePrivateSourceScope('course')", context);
    const write = runInNewContext("writePrivateSource({id:'note',courseId:'course',body:'private'}, scope)", context);
    assert.equal(writes[0].path, "data/users/user-a/lib");
    context.S.uid = "user-b";
    context.S.courses = { course: { id: "course" } };
    acknowledge();
    assert.equal(await write, false);
    assert.deepEqual(Object.keys(context.S.notes), []);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "data/users/user-a/lib");
  });
}