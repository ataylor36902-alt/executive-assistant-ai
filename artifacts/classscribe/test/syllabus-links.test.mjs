import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const sourceFiles = [
  new URL("../web-src/4_views.js", import.meta.url),
  new URL("../web-public/index.html", import.meta.url),
];

for (const file of sourceFiles) {
  test(`syllabus import in ${file.pathname.includes("web-public") ? "served page" : "editable source"} keeps ambiguous dates standalone`, async () => {
    const text = readFileSync(file, "utf8");
    const start = text.indexOf("let SYLLABUS_REVIEW=null;");
    const end = text.indexOf("/* ---------- modals: email / export / share ---------- */", start);
    assert.ok(start !== -1 && end !== -1);
    const assignments = [];
    let savedCourse;
    let message = "";
    let selected = [];
    const ctx = {
      ACT: {}, S: { profile: null }, Object, Map, Set, Number,
      uid: (() => { let id = 0; return () => `id-${++id}`; })(),
      course: () => null,
      assignOf: () => assignments,
      $$: () => selected.map(i => ({ dataset: { sylDate: String(i) } })),
      put: async (table, data) => { if (table === "courses") savedCourse = data; else assignments.push(data); },
      closeModal: () => {}, go: () => {}, toast: value => { message = value; },
      $: () => null, curSemester: () => "Fall", allC: () => ({}), plural: () => "",
    };
    const context = createContext(ctx);
    runInContext(text.slice(start, end), context, { filename: file.pathname });
    const save = async (items, selection) => {
      selected = selection;
      assignments.length = 0;
      savedCourse = null;
      const review = { course: { code: "BIO 201" }, modules: [], assignments: items, existingId: "" };
      runInContext(`SYLLABUS_REVIEW=${JSON.stringify(review)}`, context);
      await ctx.ACT.saveSyllabus({ disabled: false });
      assert.ok(savedCourse, "course was saved");
      return savedCourse;
    };
    const repeated = [
      { title: "Final quiz", type: "quiz", due: "2026-10-04" },
      { title: " final   QUIZ ", type: "quiz", due: "2026-10-05" },
    ];
    let course = await save(repeated, [0, 1]);
    assert.deepEqual(Array.from(course.syllabusDates, d => d.linkStatus), ["ambiguous", "ambiguous"]);
    assert.deepEqual(assignments.map(a => a.due), ["", ""]);
    assert.match(message, /saved separately/);
    assert.equal(JSON.parse(JSON.stringify(course)).syllabusDates[0].linkStatus, "ambiguous", "warning persists after reload");

    course = await save(repeated, [0]);
    assert.equal(course.syllabusDates[0].linkStatus, "ambiguous", "one selected date still matches two coursework items");
    assert.equal(assignments[0].due, "");

    course = await save([{ title: "Lab report", type: "homework", due: "2026-10-06" }], [0]);
    assert.equal(course.syllabusDates[0].linkStatus, "linked");
    assert.equal(assignments[0].due, "2026-10-06");
    assert.equal(assignments[0].dateConfirmed, true);
    assert.match(text, /Confirmed syllabus dates/);
    assert.match(text, /Standalone syllabus date/);
  });
}