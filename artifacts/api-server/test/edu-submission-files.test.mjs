import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { getAuth } from "@clerk/express";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, coursesTable, courseMembersTable, eduAssignmentsTable, eduSubmissionsTable,
  classscribeEduLicenseGrantsTable, classscribeEduClientLicensesTable,
  classscribeEduClientSessionsTable, classscribeEduCourseLicenseBindingsTable,
  classscribePrivacyDeletionOutboxTable,
} from "@workspace/db";
import router, { requireEduCredential, requireEduCourseAgreement } from "../src/routes/classscribe-edu.ts";
import { retrySubmissionFileCleanup } from "../src/lib/edu-submission-files.ts";
import { pauseNextUpload, setFailUpload, setFailDelete, storedObjectKeys } from "./fixtures/edu-object-storage.mjs";

test("student submission files stay private, immutable after grading, and clean up on every lifecycle path", async () => {
  const prefix = `submission-test-${randomUUID()}`;
  const [owner, student, classmate, outsider, foreignStudent, foreignOwner] =
    ["owner", "student", "classmate", "outsider", "foreign", "foreign-owner"].map(role => `${prefix}-${role}`);
  const users = [owner, student, classmate, outsider, foreignStudent, foreignOwner];
  const agreement = `test:${prefix}`;
  const expiresAt = new Date(Date.now() + 86400000);
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use((req, _res, next) => { req.log = { error() {}, warn() {} }; next(); });
  app.use("/api", (req, res, next) => getAuth(req).userId ? next() : res.status(401).json({ error: "Unauthorized" }));
  app.use("/api/edu", requireEduCredential);
  app.use("/api/edu/courses/:id", requireEduCourseAgreement);
  app.use("/api", router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/edu`;
  async function request(path, user = student, method = "GET", body) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { ...(user ? { "x-test-user": user } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, headers: response.headers,
      body: response.status === 204 ? null : response.headers.get("Content-Type")?.includes("json")
        ? await response.json() : await response.text() };
  }
  const attachment = (content = "private student work", filename = "work.txt") => ({
    filename, mimeType: "text/plain", data: Buffer.from(content).toString("base64"),
  });
  const courseIds = [];
  let licenseId;
  try {
    await db.insert(classscribeEduLicenseGrantsTable).values([owner, foreignOwner].map(userId => ({
      userId, signedAgreementRef: agreement, approvedAt: new Date(Date.now() - 1000), expiresAt,
    })));
    const [license] = await db.insert(classscribeEduClientLicensesTable).values({
      ownerUserId: owner, licenseNumber: prefix, signedAgreementRef: agreement,
      pinHash: "fixture-only", expiresAt,
    }).returning();
    licenseId = license.id;
    await db.insert(classscribeEduClientSessionsTable).values(users.map(userId => ({
      licenseId, userId, clerkSessionId: `sess_${userId}`, signedAgreementRef: agreement, expiresAt,
    })));
    const courses = await db.insert(coursesTable).values([owner, foreignOwner].map(ownerId => ({
      ownerId, eduEnabled: true, name: "Submission privacy test", subject: "BIO",
      term: "Fall", color: "#000000", inviteCode: randomUUID(),
    }))).returning();
    const [course, foreignCourse] = courses;
    courseIds.push(...courses.map(c => c.id));
    await db.insert(classscribeEduCourseLicenseBindingsTable).values(courses.map(c => ({
      courseId: c.id, signedAgreementRef: agreement,
    })));
    await db.insert(courseMembersTable).values([
      { courseId: course.id, userId: student }, { courseId: course.id, userId: classmate },
      { courseId: foreignCourse.id, userId: foreignStudent },
    ]);
    const [assignment, secondAssignment, foreignAssignment] = await db.insert(eduAssignmentsTable).values([
      { courseId: course.id, title: "Essay", instructions: "Submit work", points: 100 },
      { courseId: course.id, title: "Other essay", instructions: "Submit work", points: 100 },
      { courseId: foreignCourse.id, title: "Foreign essay", instructions: "Submit work", points: 100 },
    ]).returning();
    const path = `/courses/${course.id}/assignments/${assignment.id}`;
    assert.equal((await request(`${path}/submission`, null, "POST", { text: "", attachment: attachment() })).status, 401);
    for (const user of [owner, outsider, foreignStudent]) {
      assert.equal((await request(`${path}/submission`, user, "POST", { text: "", attachment: attachment() })).status, 404);
    }
    const first = await request(`${path}/submission`, student, "POST", { text: "", attachment: attachment() });
    assert.equal(first.status, 200);
    assert.equal(first.body.submission.filename, "work.txt");
    assert.equal("fileKey" in first.body.submission, false);
    const submissionId = first.body.submission.id;
    const download = `${path}/submissions/${submissionId}/file`;
    for (const user of [student, owner]) {
      const response = await request(download, user);
      assert.equal(response.status, 200);
      assert.equal(response.body, "private student work");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.match(response.headers.get("content-disposition"), /^attachment;/);
    }
    for (const user of [classmate, outsider, foreignStudent, foreignOwner]) {
      assert.equal((await request(download, user)).status, 404);
    }
    assert.equal((await request(download, null)).status, 401);
    assert.equal((await request(`/courses/${course.id}/assignments/${secondAssignment.id}/submissions/${submissionId}/file`, owner)).status, 404);
    assert.equal((await request(`/courses/${foreignCourse.id}/assignments/${foreignAssignment.id}/submissions/${submissionId}/file`, foreignOwner)).status, 404);
    const ownCourse = await request(`/courses/${course.id}`);
    assert.equal(ownCourse.body.assignments.find(a => a.id === assignment.id).mySubmission.filename, "work.txt");
    const classmateCourse = await request(`/courses/${course.id}`, classmate);
    assert.equal(classmateCourse.body.assignments.find(a => a.id === assignment.id).mySubmission, undefined);
    const instructorList = await request(`${path}/submissions`, owner);
    assert.equal(instructorList.body.submissions[0].filename, "work.txt");
    assert.equal("fileKey" in instructorList.body.submissions[0], false);
    assert.equal((await request(`${path}/submissions`, classmate)).status, 404);

    // Text-only edits retain the file; malformed uploads leave both text and bytes intact.
    assert.equal((await request(`${path}/submission`, student, "POST", { text: "Updated text" })).status, 200);
    for (const invalid of [
      { ...attachment(), filename: "../work.txt" },
      { ...attachment(), filename: "work.exe" },
      { ...attachment(), mimeType: "text/html" },
      { ...attachment(), data: "AA=A" },
      { ...attachment(), data: "" },
      { filename: "fake.pdf", mimeType: "application/pdf", data: Buffer.from("not a pdf").toString("base64") },
      attachment("x".repeat(10 * 1024 * 1024 + 1)),
    ]) {
      assert.equal((await request(`${path}/submission`, student, "POST", { text: "Should not save", attachment: invalid })).status, 400);
    }
    assert.equal((await request(download)).body, "private student work");
    const originalKey = storedObjectKeys()[0];
    setFailUpload(true);
    assert.equal((await request(`${path}/submission`, student, "POST", { text: "Failed", attachment: attachment("new bytes") })).status, 503);
    setFailUpload(false);
    assert.deepEqual(storedObjectKeys(), [originalKey]);
    assert.equal((await request(download)).body, "private student work");
    assert.equal((await request(`${path}/submission`, student, "POST", { text: "", attachment: null })).status, 400);
    setFailDelete(true);
    const replacement = await request(`${path}/submission`, student, "POST", { text: "", attachment: attachment("replacement", "new.txt") });
    assert.equal(replacement.status, 200);
    assert.equal(replacement.body.cleanupPending, true);
    assert.equal((await request(download)).body, "replacement");
    const [queued] = await db.select().from(classscribePrivacyDeletionOutboxTable)
      .where(eq(classscribePrivacyDeletionOutboxTable.libraryHash, "edu-submission-file"));
    assert.ok(queued.pendingProviders.includes(`storage:${originalKey}`));
    setFailDelete(false);
    await db.update(classscribePrivacyDeletionOutboxTable).set({ nextAttemptAt: new Date(0) })
      .where(eq(classscribePrivacyDeletionOutboxTable.id, queued.id));
    await retrySubmissionFileCleanup();
    assert.equal((await db.select().from(classscribePrivacyDeletionOutboxTable)
      .where(eq(classscribePrivacyDeletionOutboxTable.id, queued.id))).length, 0);
    assert.equal(storedObjectKeys().includes(originalKey), false);
    const removed = await request(`${path}/submission`, student, "POST", { text: "Text remains", attachment: null });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.submission.filename, null);
    assert.equal((await request(download)).status, 404);
    assert.equal(storedObjectKeys().length, 0);

    // At the size boundary the decoder works without regex recursion failures.
    assert.equal((await request(`${path}/submission`, student, "POST", {
      text: "", attachment: attachment("x".repeat(10 * 1024 * 1024)),
    })).status, 200);
    assert.equal((await request(`${path}/submission`, classmate, "DELETE")).status, 404);
    assert.equal((await request(`${path}/submission`, student, "DELETE")).status, 200);
    assert.equal(storedObjectKeys().length, 0);
    assert.equal((await db.select().from(eduSubmissionsTable).where(eq(eduSubmissionsTable.id, submissionId))).length, 0);

    // Concurrent replacement and grading serialize on the assignment, and grading
    // freezes the file that was actually committed, not a stale candidate.
    const next = await request(`${path}/submission`, student, "POST", { text: "", attachment: attachment() });
    const nextId = next.body.submission.id;
    const pause = pauseNextUpload();
    const pendingReplacement = request(`${path}/submission`, student, "POST", {
      text: "", attachment: attachment("final submitted bytes"),
    });
    await pause.entered;
    const pendingGrade = request(`${path}/submissions/${nextId}`, owner, "PATCH", { score: 0, feedback: "Reviewed" });
    pause.release();
    assert.equal((await pendingReplacement).status, 200);
    assert.equal((await pendingGrade).status, 200);
    assert.equal((await request(`${path}/submission`, student, "POST", { text: "Change", attachment: attachment() })).status, 409);
    assert.equal((await request(`${path}/submission`, student, "POST", { text: "Change", attachment: null })).status, 409);
    assert.equal((await request(`${path}/submission`, student, "DELETE")).status, 409);
    assert.equal((await request(`${path}/submissions/${nextId}/file`, owner)).body, "final submitted bytes");
    await db.delete(courseMembersTable).where(eq(courseMembersTable.userId, student));
    assert.equal((await request(`${path}/submissions/${nextId}/file`)).status, 404);
    assert.equal((await request(`${path}/submissions/${nextId}/file`, owner)).status, 200);
    assert.equal((await request(path, owner, "DELETE")).status, 204);
    assert.equal(storedObjectKeys().length, 0);
    assert.equal((await request(`${path}/submissions/${nextId}/file`, owner)).status, 404);
  } finally {
    setFailUpload(false); setFailDelete(false);
    if (courseIds.length) await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
    await db.delete(classscribeEduClientSessionsTable).where(inArray(classscribeEduClientSessionsTable.userId, users));
    if (licenseId) await db.delete(classscribeEduClientLicensesTable).where(eq(classscribeEduClientLicensesTable.id, licenseId));
    await db.delete(classscribeEduLicenseGrantsTable).where(inArray(classscribeEduLicenseGrantsTable.userId, users));
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
