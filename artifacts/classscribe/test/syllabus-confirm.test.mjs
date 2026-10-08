import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const start = "let SYLLABUS_REVIEW=null;", end = "/* ---------- modals: email / export / share ---------- */";
const source = readFileSync(new URL("../web-src/4_views.js", import.meta.url), "utf8");
const served = readFileSync(new URL("../web-public/index.html", import.meta.url), "utf8");
const section = text => text.slice(text.indexOf(start), text.indexOf(end));
test("supported live browser syllabus flow stays identical to its editable source", () => {
  assert.equal(section(source), section(served));
  assert.ok(section(served).includes("syllabus/confirm"));
});

for (const [name, text] of [["source", source], ["served", served]]) {
  function client() {
    const calls = [], notices = [], due = { value: "2026-10-22" }, checkbox = { dataset: { sylDate: "0" } };
    const status = { textContent: "" }, button = { disabled: false, isConnected: true };
    const S = { uid: "library-one", mode: "db", courses: {}, assignments: {} };
    const ctx = {
      ACT: {}, S, uid: () => "import-one", curSemester: () => "Fall 2026",
      course: id => S.courses[id], toast: message => notices.push(message),
      $: selector => selector === "#syl-review-error" ? status : due,
      $$: selector => selector === "[data-syl-date]:checked" ? [checkbox] : [checkbox, due],
      requestApi: async (...args) => {
        calls.push(args);
        return { course: { id: "course-one", code: "BIO 101", syllabusDates: [{ linkStatus: "linked", due: "2026-10-22" }] },
          assignments: [{ id: "assignment-one", courseId: "course-one", dateConfirmed: true, due: "2026-10-22" }] };
      },
      closeModal: () => { ctx.closed = true; }, go: view => { ctx.view = view; }, schedule() {},
      plural: (n, label) => `${n} ${label}`,
    };
    runInNewContext(section(text), ctx);
    runInNewContext(`SYLLABUS_REVIEW={libraryId:S.uid,importId:'import-one',courseId:'course-one',existingId:'',
      course:{code:'BIO 101'},modules:[],assignments:[{title:'Midterm',type:'exam',due:'2026-10-15'}]};`, ctx);
    return { ctx, calls, notices, due, status, button, S };
  }
  test(`${name}: corrected dates use server-confirmed output, not optimistic per-item writes`, async () => {
    const c = client();
    await c.ctx.ACT.saveSyllabus(c.button);
    assert.equal(c.calls[0][0], "/api/");
    assert.equal(c.calls[0][1], "syllabus/confirm");
    assert.equal(c.calls[0][3].assignments[0].due, "2026-10-22");
    assert.deepEqual(Array.from(c.calls[0][3].selectedDates), [0]);
    assert.equal(c.S.assignments["assignment-one"].due, "2026-10-22");
    assert.equal(c.ctx.view.tab, "assign");
    assert.equal(c.ctx.closed, true);
  });
  test(`${name}: save failures keep review and stable retry identity without claiming success`, async () => {
    const c = client(), request = c.ctx.requestApi;
    c.ctx.requestApi = async (...args) => { c.calls.push(args); throw new Error("Connection interrupted"); };
    await c.ctx.ACT.saveSyllabus(c.button);
    assert.equal(Object.keys(c.S.courses).length, 0);
    assert.equal(c.ctx.closed, undefined);
    assert.match(c.status.textContent, /Connection interrupted.*Retry/);
    const first = JSON.stringify(c.calls[0][3]);
    c.due.value = "2026-12-12";
    c.ctx.requestApi = request;
    await c.ctx.ACT.saveSyllabus(c.button);
    assert.equal(JSON.stringify(c.calls[1][3]), first);
  });
  test(`${name}: library switches cannot apply an old confirmation response`, async () => {
    const c = client(), request = c.ctx.requestApi;
    c.ctx.requestApi = async (...args) => { const result = await request(...args); c.S.uid = "library-two"; return result; };
    await c.ctx.ACT.saveSyllabus(c.button);
    assert.equal(Object.keys(c.S.courses).length, 0);
    assert.equal(c.ctx.closed, undefined);
  });
  test(`${name}: selecting an empty date leaves editable review and makes no request`, async () => {
    const c = client();
    c.due.value = "";
    await c.ctx.ACT.saveSyllabus(c.button);
    assert.equal(c.calls.length, 0);
    assert.match(c.status.textContent, /Enter a date/);
    assert.equal(c.due.disabled, undefined);
  });
  test(`${name}: a rejected date can be corrected without discarding review choices`, async () => {
    const c = client(), request = c.ctx.requestApi;
    c.ctx.requestApi = async () => { throw Object.assign(new Error("Invalid calendar date"), { status: 400 }); };
    await c.ctx.ACT.saveSyllabus(c.button);
    assert.equal(c.due.disabled, false);
    c.due.value = "2026-10-23";
    c.ctx.requestApi = request;
    await c.ctx.ACT.saveSyllabus(c.button);
    assert.equal(c.calls[0][3].assignments[0].due, "2026-10-23");
  });
  test(`${name}: closing review while saving cannot reopen or navigate the current screen`, async () => {
    const c = client(), request = c.ctx.requestApi;
    c.ctx.requestApi = async (...args) => { const result = await request(...args); c.button.isConnected = false; return result; };
    await c.ctx.ACT.saveSyllabus(c.button);
    assert.equal(c.ctx.closed, undefined);
    assert.equal(c.ctx.view, undefined);
  });
}
