import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { eq, like } from "drizzle-orm";
import { db, pool, classscribeLegacyDocumentsTable as documents } from "@workspace/db";
import syllabusRouter from "../src/routes/classscribe-syllabus-confirm.ts";
import { privacyWriteLockMiddleware } from "../src/middlewares/privacy-write-lock";

test("live-library syllabus confirmation is atomic, scoped, selective, and replay-safe", async () => {
  const uid = `u_${randomUUID().replaceAll("-", "")}`, other = `u_${randomUUID().replaceAll("-", "")}`;
  const root = `data/users/${uid}/lib`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { error() {} }; next(); });
  app.use(privacyWriteLockMiddleware);
  app.use(syllabusRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const request = async (body, code = uid) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/syllabus/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(code ? { "X-CS-User": code } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const input = {
    importId: "review-one", courseId: "biology", existing: false,
    course: { code: "BIO 101", name: "Biology", professor: "Dr. Test", semester: "Fall 2026" },
    modules: ["Cells"],
    assignments: [
      { title: "Midterm", type: "exam", due: "2026-10-15" },
      { title: "Paper", type: "project", due: "2026-10-20" },
      { title: "Reading", type: "reading", due: "" },
    ],
    selectedDates: [0],
  };
  const row = async path => (await db.select().from(documents).where(eq(documents.path, path)))[0]?.data;
  try {
    assert.equal((await request(input, null)).status, 401);
    assert.equal((await request({ ...input, assignments: [{ ...input.assignments[0], due: "2026-02-30" }] })).status, 400);
    assert.equal((await request({ ...input, selectedDates: [9] })).status, 400);
    assert.equal((await request({ ...input, selectedDates: [0, 0] })).status, 400);
    assert.equal((await request({ ...input, selectedDates: [2] })).status, 400);
    assert.equal(await row(`${root}/courses/biology`), undefined);
    const saved = await request(input);
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.assignments.map(a => [a.due, a.dateConfirmed]), [["2026-10-15", true], ["", false], ["", false]]);
    assert.equal(saved.body.course.syllabusDates[0].linkStatus, "linked");
    assert.deepEqual(await row(`${root}/courses/biology`), saved.body.course, "read immediately after reply sees committed confirmation");
    for (const a of saved.body.assignments) assert.deepEqual(await row(`${root}/assignments/${a.id}`), a);
    assert.deepEqual((await request(input)).body, saved.body, "retry reuses imported assignment identities");
    assert.equal((await request({ ...input, selectedDates: [1] })).status, 409);
    assert.equal((await request({ ...input, existing: true }, other)).status, 409, "cannot confirm another library's course");

    const completed = { ...saved.body.assignments[0], done: true, grade: 95 };
    await db.update(documents).set({ data: completed }).where(eq(documents.path, `${root}/assignments/${completed.id}`));
    const newer = await request({
      ...input, importId: "review-two", existing: true,
      assignments: [
        { title: " MIDTERM ", type: "exam", due: "2026-11-01" },
        { title: "Lab   report", type: "homework", due: "2026-11-02" },
        { title: "lab report", type: "homework", due: "2026-11-03" },
      ], selectedDates: [0, 1, 2],
    });
    assert.equal(newer.status, 200);
    assert.deepEqual(newer.body.course.syllabusDates.map(d => d.linkStatus), ["ambiguous", "ambiguous", "ambiguous"]);
    assert.ok(newer.body.assignments.every(a => !a.due && !a.dateConfirmed));
    assert.deepEqual(await row(`${root}/assignments/${completed.id}`), completed, "existing grades and completion survive");
    const reloaded = await row(`${root}/courses/biology`);
    assert.deepEqual(reloaded.syllabusDates, newer.body.course.syllabusDates, "ambiguity remains visible after reload");

    assert.equal((await request({ ...input, importId: "two", courseId: "second" })).status, 200);
    assert.equal((await request({ ...input, importId: "three", courseId: "third" })).status, 200);
    assert.equal((await request({ ...input, importId: "four", courseId: "fourth" })).status, 402);
    assert.equal(await row(`${root}/courses/fourth`), undefined);
    const revokedPath = `revoked/${createHash("sha256").update(uid).digest("hex")}`;
    await db.insert(documents).values({ path: revokedPath, data: {} });
    assert.equal((await request(input)).status, 403);
  } finally {
    await db.delete(documents).where(like(documents.path, `data/users/${uid}/%`));
    await db.delete(documents).where(eq(documents.path, `revoked/${createHash("sha256").update(uid).digest("hex")}`));
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
