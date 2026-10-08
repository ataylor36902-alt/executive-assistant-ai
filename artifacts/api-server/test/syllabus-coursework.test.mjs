import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import express from "express";
import { eq } from "drizzle-orm";
import { db, pool, coursesTable, courseMembersTable, syllabusAssignmentsTable, syllabusAssignmentCompletionsTable } from "@workspace/db";
import { matchCoursework, personalAssignments } from "../src/lib/syllabus-coursework.ts";
import router from "../src/routes/classscribe.ts";
import { getAuth } from "@clerk/express";

test("completion is per student and matching replacement retains its identity", async () => {
  const owner = `coursework-owner-${randomUUID()}`;
  const classmate = `coursework-member-${randomUUID()}`;
  const [course] = await db.insert(coursesTable).values({
    name: "Coursework test", subject: "TEST", term: "Test", color: "#000000",
    inviteCode: randomUUID(), ownerId: owner,
  }).returning();
  try {
    await db.insert(courseMembersTable).values({ courseId: course.id, userId: classmate });
    const [assignment] = await db.insert(syllabusAssignmentsTable).values({
      courseId: course.id, title: " Read chapter 1 ", type: "reading",
      sourceText: "Read chapter 1", position: 0, dueDate: "2026-10-01",
    }).returning();
    await db.insert(syllabusAssignmentCompletionsTable).values({ userId: owner, assignmentId: assignment.id });

    assert.equal((await personalAssignments([assignment], owner))[0].completed, true);
    assert.equal((await personalAssignments([assignment], classmate))[0].completed, false);

    const replacement = { title: "read   chapter 1", type: "reading", dueDate: "2026-10-03" };
    assert.equal(matchCoursework([assignment], [replacement]).get(0), assignment.id);
    await db.update(syllabusAssignmentsTable).set({ ...replacement, position: 0 }).where(eq(syllabusAssignmentsTable.id, assignment.id));
    const [updated] = await db.select().from(syllabusAssignmentsTable).where(eq(syllabusAssignmentsTable.id, assignment.id));
    assert.equal((await personalAssignments([updated], owner))[0].completed, true);
    assert.equal((await personalAssignments([updated], classmate))[0].completed, false);

    await db.insert(syllabusAssignmentCompletionsTable).values({ userId: classmate, assignmentId: assignment.id });
    await db.delete(syllabusAssignmentCompletionsTable).where(eq(syllabusAssignmentCompletionsTable.userId, owner));
    assert.equal((await personalAssignments([updated], owner))[0].completed, false);
    assert.equal((await personalAssignments([updated], classmate))[0].completed, true);

    assert.equal(matchCoursework([updated], [{ title: "Different reading", type: "reading", dueDate: null }]).size, 0);
    assert.equal(matchCoursework([updated], [replacement, replacement]).size, 0);
    await db.delete(syllabusAssignmentsTable).where(eq(syllabusAssignmentsTable.id, assignment.id));
    assert.equal((await db.select().from(syllabusAssignmentCompletionsTable).where(eq(syllabusAssignmentCompletionsTable.assignmentId, assignment.id))).length, 0);
  } finally {
    await db.delete(coursesTable).where(eq(coursesTable.id, course.id));
  }
});

test("authenticated syllabus routes keep enrolled students' check-offs private through replacement", async () => {
  const owner = `coursework-owner-${randomUUID()}`;
  const first = `coursework-first-${randomUUID()}`;
  const second = `coursework-second-${randomUUID()}`;
  const outsider = `coursework-outsider-${randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use("/api", (req, res, next) => {
    if (!getAuth(req).userId) return res.status(401).json({ error: "Unauthorized" });
    next();
  }, router);
  const server = app.listen(0, "127.0.0.1");
  let course;
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (path, user, method = "GET", data) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...(user ? { "x-test-user": user } : {}), ...(data ? { "content-type": "application/json" } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    [course] = await db.insert(coursesTable).values({
      name: "Coursework route test", subject: "TEST", term: "Autumn", color: "#000000",
      inviteCode: randomUUID(), ownerId: owner,
    }).returning();
    await db.insert(courseMembersTable).values([
      { courseId: course.id, userId: first },
      { courseId: course.id, userId: second },
    ]);
    const syllabus = `/courses/${course.id}/syllabus`;
    const list = "/syllabus/assignments";
    const quote = "Read chapter 1. Submit old quiz. Complete new project.";
    const uiFixtures = {};
    let confirmationInput;
    let confirmationResponse;
    const pending = async () => {
      await db.update(coursesTable).set({
        syllabusPendingObjectPath: `/objects/syllabi/${course.id}/${randomUUID()}`,
        syllabusPendingFilename: "course.txt", syllabusPendingMimeType: "text/plain",
        syllabusPendingParsedText: quote,
      }).where(eq(coursesTable.id, course.id));
    };
    const confirm = async (assignments, dates = []) => {
      await pending();
      confirmationInput = {
        name: "Coursework route test", subject: "TEST", term: "Autumn",
        selectedDates: dates, selectedModules: [], selectedAssignments: assignments,
      };
      const result = await request(`${syllabus}/confirm`, owner, "POST", confirmationInput);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      confirmationResponse = result.body;
      return result.body.assignments;
    };
    const assertSavedLinks = async (scenario, statuses, dueDates) => {
      assert.deepEqual(confirmationResponse.dates.map(d => d.linkStatus), statuses, "confirmation reports link status");
      assert.deepEqual(confirmationResponse.assignments.map(a => a.dueDate), dueDates);
      const reloaded = await request(syllabus, owner);
      assert.equal(reloaded.status, 200);
      assert.deepEqual(reloaded.body.dates, confirmationResponse.dates, "fresh GET retains every date and its warning status");
      assert.deepEqual(reloaded.body.assignments, confirmationResponse.assignments, "fresh GET retains coursework due dates");
      const overview = await request(list, owner);
      assert.equal(overview.status, 200);
      assert.deepEqual(
        overview.body.filter(a => a.courseId === course.id).map(a => a.dueDate),
        dueDates, "coursework overview must not show guessed due dates",
      );
      uiFixtures[scenario] = { input: confirmationInput, confirmed: confirmationResponse, reloaded: reloaded.body };
    };
    const read = { title: "Read chapter 1", type: "reading", dueDate: null, sourceText: "Read chapter 1" };
    const oldQuiz = { title: "Submit old quiz", type: "quiz", dueDate: null, sourceText: "Submit old quiz" };
    const [reading, removed] = await confirm([read, oldQuiz]);
    const completion = id => `/syllabus/assignments/${id}/completion`;
    const assertViews = async (user, expected) => {
      const detail = await request(syllabus, user);
      const overview = await request(list, user);
      assert.equal(detail.status, 200);
      assert.equal(overview.status, 200);
      for (const assignments of [detail.body.assignments, overview.body.filter(a => a.courseId === course.id)]) {
        assert.deepEqual(Object.fromEntries(assignments.map(a => [a.id, a.completed])), expected);
      }
      assert.ok(overview.body.some(a => a.id === reading.id && a.courseName === "Coursework route test"));
    };

    assert.equal((await request(syllabus, null)).status, 401);
    assert.equal((await request(list, null)).status, 401);
    assert.equal((await request(completion(reading.id), null, "PUT", { completed: true })).status, 401);
    assert.equal((await request(syllabus, outsider)).status, 404);
    assert.ok(!(await request(list, outsider)).body.some(a => a.courseId === course.id));
    assert.equal((await request(completion(reading.id), outsider, "PUT", { completed: true })).status, 404);
    await assertViews(first, { [reading.id]: false, [removed.id]: false });
    await assertViews(second, { [reading.id]: false, [removed.id]: false });

    assert.deepEqual(await request(completion(reading.id), first, "PUT", { completed: true }), { status: 200, body: { completed: true } });
    assert.deepEqual(await request(completion(removed.id), second, "PUT", { completed: true }), { status: 200, body: { completed: true } });
    await assertViews(first, { [reading.id]: true, [removed.id]: false });
    await assertViews(second, { [reading.id]: false, [removed.id]: true });
    assert.deepEqual(await request(completion(reading.id), second, "PUT", { completed: false }), { status: 200, body: { completed: false } });
    await assertViews(first, { [reading.id]: true, [removed.id]: false });
    assert.equal((await db.select().from(syllabusAssignmentCompletionsTable).where(eq(syllabusAssignmentCompletionsTable.assignmentId, reading.id)))[0].userId, first);

    const replacement = await confirm([
      { ...read, title: "  read   CHAPTER 1  " },
      { title: "Complete new project", type: "project", dueDate: null, sourceText: "Complete new project" },
    ], [{ title: "read CHAPTER 1", kind: "assignment", dueDate: "2026-10-03", sourceText: "Read chapter 1" }]);
    assert.equal(replacement[0].id, reading.id, "unambiguous title/type match retains identity despite a date change");
    assert.equal(replacement[0].dueDate, "2026-10-03", "date title matches despite different internal whitespace");
    assert.equal((await request(syllabus, owner)).body.dates[0].linkStatus, "linked");
    await assertSavedLinks("unique", ["linked"], ["2026-10-03", null]);
    assert.equal(replacement[0].completed, false, "owner does not inherit a student's completion");
    assert.notEqual(replacement[1].id, removed.id);
    assert.equal((await db.select().from(syllabusAssignmentCompletionsTable).where(eq(syllabusAssignmentCompletionsTable.assignmentId, removed.id))).length, 0);
    assert.equal((await request(completion(removed.id), second, "PUT", { completed: true })).status, 404);
    await assertViews(first, { [reading.id]: true, [replacement[1].id]: false });
    await assertViews(second, { [reading.id]: false, [replacement[1].id]: false });

    const ambiguous = await confirm(
      [{ ...read, title: "Read   chapter 1" }],
      [
        { title: "Read chapter 1", kind: "assignment", dueDate: "2026-10-04", sourceText: "Read chapter 1" },
        { title: "  read   CHAPTER 1 ", kind: "assignment", dueDate: "2026-10-05", sourceText: "Read chapter 1" },
      ],
    );
    assert.equal(ambiguous[0].id, reading.id, "unique coursework identity remains stable");
    assert.equal(ambiguous[0].dueDate, null, "ambiguous equivalent date titles are not guessed");
    assert.deepEqual((await request(syllabus, owner)).body.dates.map(d => d.linkStatus), ["ambiguous", "ambiguous"]);
    await assertSavedLinks("repeatedDates", ["ambiguous", "ambiguous"], [null]);
    await assertViews(first, { [reading.id]: true });
    await assertViews(second, { [reading.id]: false });

    const duplicateCoursework = await confirm(
      [
        { ...read, title: "Read chapter 1" },
        { ...read, title: " read   CHAPTER 1 ", type: "homework" },
      ],
      [{ title: " read CHAPTER 1 ", kind: "assignment", dueDate: "2026-10-06", sourceText: "Read chapter 1" }],
    );
    assert.equal(duplicateCoursework[0].id, reading.id);
    assert.equal(duplicateCoursework[0].dueDate, null, "date is not guessed when multiple coursework items share its title");
    assert.equal(duplicateCoursework[1].dueDate, null);
    assert.equal((await request(syllabus, owner)).body.dates[0].linkStatus, "ambiguous");
    await assertSavedLinks("repeatedCoursework", ["ambiguous"], [null, null]);
    await assertViews(first, { [reading.id]: true, [duplicateCoursework[1].id]: false });
    await assertViews(second, { [reading.id]: false, [duplicateCoursework[1].id]: false });
    const standalone = await confirm(
      [{ ...read, title: "Read chapter 1" }],
      [{ title: "Complete new project", kind: "assignment", dueDate: "2026-10-07", sourceText: "Complete new project" }],
    );
    assert.equal(standalone[0].dueDate, null);
    assert.equal((await request(syllabus, owner)).body.dates[0].linkStatus, "standalone");
    await assertSavedLinks("unmatched", ["standalone"], [null]);
    if (process.env.SYLLABUS_UI_FIXTURE) {
      writeFileSync(process.env.SYLLABUS_UI_FIXTURE, JSON.stringify(uiFixtures));
    }
  } finally {
    if (course) await db.delete(coursesTable).where(eq(coursesTable.id, course.id));
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});