import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  classscribeLegacyDocumentsTable,
  db,
} from "@workspace/db";
import legacyRouter from "../src/routes/classscribe-legacy.ts";
import { calculateStudentGradeAverage, analyzeStudentGradebook } from "../src/lib/student-grades.ts";

const hash = (code) => createHash("sha256").update(code).digest("hex");
const futureEnd = () => new Date(Date.now() + 86_400_000).toISOString();

function gradebook(overrides = {}) {
  return {
    courseId: "course-one",
    credits: 3,
    weights: null,
    items: [{ id: "a1", title: "Assignment", type: "assignment", earned: 0, possible: 10 }],
    finalPercent: null,
    version: 0,
    ...overrides,
  };
}

test("student grade arithmetic keeps zero scores and weighted categories", () => {
  const zero = gradebook();
  assert.equal(calculateStudentGradeAverage(zero), 0);
  assert.deepEqual(analyzeStudentGradebook(zero), {
    averagePercent: 0,
    letter: "F",
    gradePoints: 0,
    byType: [
      { type: "assignment", averagePercent: 0 },
      { type: "project", averagePercent: null },
      { type: "quiz", averagePercent: null },
      { type: "test", averagePercent: null },
    ],
    isEstimate: true,
  });

  const weighted = gradebook({
    weights: { assignment: 50, project: 0, quiz: 0, test: 50 },
    items: [
      { id: "a1", title: "Assignment", type: "assignment", earned: 0, possible: 10 },
      { id: "t1", title: "Test", type: "test", earned: 80, possible: 100 },
    ],
  });
  assert.equal(calculateStudentGradeAverage(weighted), 40);
  const unequalPossible = gradebook({
    weights: { assignment: 50, project: 0, quiz: 0, test: 50 },
    items: [
      { id: "a1", title: "Short assignment", type: "assignment", earned: 9, possible: 10 },
      { id: "a2", title: "Long assignment", type: "assignment", earned: 0, possible: 90 },
      { id: "t1", title: "Test", type: "test", earned: 100, possible: 100 },
    ],
  });
  assert.equal(calculateStudentGradeAverage(unequalPossible), 54.5);
  assert.equal(analyzeStudentGradebook(unequalPossible).byType[0].averagePercent, 9);
  assert.equal(calculateStudentGradeAverage(gradebook({
    items: [
      { id: "a1", title: "Short assignment", type: "assignment", earned: 9, possible: 10 },
      { id: "a2", title: "Long assignment", type: "assignment", earned: 0, possible: 90 },
    ],
  })), 9);
  assert.equal(calculateStudentGradeAverage(gradebook({
    items: [{ id: "ungraded", title: "Not graded", type: "quiz", earned: null, possible: 10 }],
  })), null);
  assert.equal(calculateStudentGradeAverage(gradebook({
    finalPercent: 91,
    items: [{ id: "ungraded", title: "Not graded", type: "quiz", earned: null, possible: 10 }],
  })), null);
  assert.equal(analyzeStudentGradebook(gradebook({ finalPercent: 91 })).averagePercent, 91);
});

test("paid sync-code gradebook endpoints enforce plan, input, ownership, and versions", async () => {
  const studentCode = `u_${randomUUID().replaceAll("-", "")}`;
  const freeCode = `u_${randomUUID().replaceAll("-", "")}`;
  const otherCode = `u_${randomUUID().replaceAll("-", "")}`;
  const paths = [];
  for (const [code, plan, status] of [
    [studentCode, "student", "active"],
    [freeCode, "free", "inactive"],
    [otherCode, "student", "active"],
  ]) {
    const libraryHash = hash(code);
    const path = `private/classscribe-billing/accounts/${libraryHash}`;
    paths.push(path);
    await db.insert(classscribeLegacyDocumentsTable).values({
      path,
      data: { libraryHash, plan, status, periodEnd: futureEnd() },
    }).onConflictDoUpdate({
      target: classscribeLegacyDocumentsTable.path,
      set: { data: { libraryHash, plan, status, periodEnd: futureEnd() } },
    });
  }
  const ownedCourse = `data/users/${studentCode}/lib/courses/course-one`;
  const foreignCourse = `data/users/${studentCode}/lib/courses/course-foreign`;
  const assignmentPath = `data/users/${studentCode}/lib/assignments/work-one`;
  const wrongCourseAssignment = `data/users/${studentCode}/lib/assignments/work-other`;
  paths.push(ownedCourse, foreignCourse, assignmentPath, wrongCourseAssignment);
  await db.insert(classscribeLegacyDocumentsTable).values([
    { path: ownedCourse, data: { id: "course-one", name: "Biology" } },
    { path: foreignCourse, data: { id: "course-foreign", name: "Chemistry" } },
  ]).onConflictDoUpdate({
    target: classscribeLegacyDocumentsTable.path,
    set: { data: { name: "test course" } },
  });
  await db.insert(classscribeLegacyDocumentsTable).values([
    { path: assignmentPath, data: { id: "work-one", courseId: "course-one", title: "Project", type: "project" } },
    { path: wrongCourseAssignment, data: { id: "work-other", courseId: "course-foreign", title: "Quiz", type: "quiz" } },
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { warn() {}, error() {} }; next(); });
  app.use("/api", legacyRouter);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const post = (path, code, body) => fetch(`http://127.0.0.1:${port}/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CS-User": code },
      body: JSON.stringify(body),
    });

    const free = await post("/student/grades/list", freeCode, {});
    assert.equal(free.status, 403);

    const invalid = await post("/student/grades/save", studentCode, {
      gradebook: gradebook({ weights: { assignment: 50, project: 0, quiz: 0, test: 0 } }),
    });
    assert.equal(invalid.status, 400);
    const invalidDate = await post("/student/grades/save", studentCode, {
      gradebook: gradebook({ items: [{
        id: "a1", title: "Assignment", type: "assignment", earned: 0, possible: 10, date: "2025-02-30",
      }] }),
    });
    assert.equal(invalidDate.status, 400);

    const foreign = await post("/student/grades/save", otherCode, { gradebook: gradebook() });
    assert.equal(foreign.status, 404);

    const isolated = await post("/student/grades/list", otherCode, {});
    assert.equal(isolated.status, 200);
    assert.deepEqual((await isolated.json()).courses, []);

    const saved = await post("/student/grades/save", studentCode, { gradebook: gradebook() });
    assert.equal(saved.status, 200);
    const savedData = await saved.json();
    assert.deepEqual(Object.keys(savedData).sort(), ["courses", "summary"]);
    assert.deepEqual(Object.keys(savedData.courses[0]).sort(), ["analysis", "gradebook"]);
    assert.deepEqual(Object.keys(savedData.courses[0].gradebook).sort(), [
      "courseId", "credits", "finalPercent", "items", "version", "weights",
    ]);
    assert.deepEqual(Object.keys(savedData.courses[0].gradebook.items[0]).sort(), [
      "date", "earned", "id", "possible", "title", "type",
    ]);
    assert.deepEqual(Object.keys(savedData.courses[0].analysis).sort(), [
      "averagePercent", "byType", "gradePoints", "isEstimate", "letter",
    ]);
    assert.deepEqual(Object.keys(savedData.summary).sort(), ["countedCredits", "estimatedGpa"]);
    assert.equal(savedData.courses[0].gradebook.version, 1);
    assert.equal(savedData.courses[0].gradebook.items[0].earned, 0);
    assert.equal(savedData.courses[0].gradebook.items[0].date, null);
    assert.equal(savedData.courses[0].analysis.averagePercent, 0);
    assert.equal(savedData.summary.estimatedGpa, 0);
    assert.equal(savedData.summary.countedCredits, 3);

    const linked = { id: "project-score", assignmentId: "work-one", title: "Project snapshot", type: "project", earned: null, possible: 100, date: null };
    const invalidLink = await post("/student/grades/save", studentCode, { gradebook: gradebook({ version: 1, items: [linked, { ...linked, id: "other-score" }] }) });
    assert.equal(invalidLink.status, 400);
    const foreignLink = await post("/student/grades/save", studentCode, { gradebook: gradebook({ version: 1, items: [{ ...linked, assignmentId: "work-other" }] }) });
    assert.equal(foreignLink.status, 400);
    const missingLink = await post("/student/grades/save", studentCode, { gradebook: gradebook({ version: 1, items: [{ ...linked, assignmentId: "missing-work" }] }) });
    assert.equal(missingLink.status, 400);
    const linkedSave = await post("/student/grades/save", studentCode, { gradebook: gradebook({ version: 1, items: [linked] }) });
    assert.equal(linkedSave.status, 200);
    assert.equal((await linkedSave.json()).courses[0].analysis.averagePercent, null);
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, assignmentPath));
    const retained = await post("/student/grades/save", studentCode, { gradebook: gradebook({ version: 2, items: [{ ...linked, earned: 84 }] }) });
    assert.equal(retained.status, 200);
    const retainedData = await retained.json();
    assert.equal(retainedData.courses[0].gradebook.items[0].title, "Project snapshot");
    assert.equal(retainedData.courses[0].gradebook.items[0].assignmentId, "work-one");
    assert.equal(retainedData.courses[0].analysis.averagePercent, 84);
    const relinkDuplicate = await post("/student/grades/save", studentCode, { gradebook: gradebook({ version: 3, items: [{ ...linked, id: "another-score" }] }) });
    assert.equal(relinkDuplicate.status, 400);
    const stale = await post("/student/grades/save", studentCode, { gradebook: gradebook() });
    assert.equal(stale.status, 409);
    const raw = await post("/db/get", studentCode, {
      path: `data/users/${studentCode}/lib/gradebooks/course-one`,
    });
    assert.equal(raw.status, 403);
    const list = await post("/student/grades/list", studentCode, {});
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), retainedData);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.delete(classscribeLegacyDocumentsTable).where(inArray(classscribeLegacyDocumentsTable.path, [
      ...paths,
      `data/users/${studentCode}/lib/gradebooks/course-one`,
    ]));
  }
});