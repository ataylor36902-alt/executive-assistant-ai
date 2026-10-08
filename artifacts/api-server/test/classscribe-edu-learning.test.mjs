import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, pool, coursesTable, courseMembersTable, eduAssignmentsTable, eduSubmissionsTable,
  classscribeEduLicenseGrantsTable, classscribeEduClientLicensesTable, classscribeEduClientSessionsTable,
  classscribeEduCourseLicenseBindingsTable,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import eduLearningRouter from "../src/routes/classscribe-edu-learning.ts";
import { eduGradebookCsv } from "../src/lib/edu-gradebook-csv.ts";
import { requireEduCredential, requireEduCourseAgreement } from "../src/routes/classscribe-edu.ts";
import {
  eduDiscussionRepliesTable, eduDiscussionTopicsTable,
} from "../../../lib/db/src/schema/classscribe-edu-learning.ts";
import { absentGradebookStatus } from "../src/lib/edu-gradebook-status.ts";

test("absent gradebook states compare exact instants, including timezone offsets", () => {
  const now = Date.parse("2026-10-08T12:00:00.000Z");
  assert.equal(absentGradebookStatus(null, now), "no_deadline");
  assert.equal(absentGradebookStatus(new Date(now - 1), now), "missing");
  assert.equal(absentGradebookStatus(new Date(now), now), "not_submitted");
  assert.equal(absentGradebookStatus(new Date(now + 1), now), "not_submitted");
  assert.equal(absentGradebookStatus(new Date("2026-10-08T08:00:00-04:00"), now), "not_submitted");
  assert.equal(absentGradebookStatus(new Date("2026-10-08T13:59:59.999+02:00"), now), "missing");
});

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = text.startsWith("\uFEFF") ? 1 : 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && ch === ",") { row.push(value); value = ""; }
    else if (!quoted && ch === "\r" && text[i + 1] === "\n") {
      row.push(value); rows.push(row); row = []; value = ""; i++;
    } else value += ch;
  }
  assert.equal(quoted, false);
  return rows;
}

test("gradebook CSV escapes text, preserves zero scores and empty rosters", () => {
  const book = {
    assignments: [{ id: "a", title: '=SUM(1,2)\n"Lab"', points: 10 }],
    students: [{
      studentId: "@student", name: 'Élodie, "Example"\r\nSecond line',
      grades: [{ assignmentId: "a", score: 0, status: "graded" }],
      totals: { earned: 0, possible: 10, gradedCount: 1, ungradedCount: 0, missingCount: 0 },
    }],
  };
  const csv = eduGradebookCsv(book);
  assert.ok(csv.startsWith("\uFEFF"));
  const [header, student] = parseCsv(csv);
  assert.equal(header[2], '\'=SUM(1,2)\n"Lab" [a] points');
  assert.deepEqual(student, [
    "'@student", 'Élodie, "Example"\r\nSecond line', "10", "0", "graded", "0", "10", "1", "0", "0",
  ]);
  for (const name of ["=1+1", "+1", "-1", "@SUM(A1)", "  =1", "\ttext", "\rtext", "\ntext"]) {
    book.students[0].name = name;
    assert.equal(parseCsv(eduGradebookCsv(book))[1][1], `'${name}`);
  }
  book.students = [];
  assert.equal(parseCsv(eduGradebookCsv(book)).length, 1);
  book.assignments = [];
  assert.deepEqual(parseCsv(eduGradebookCsv(book))[0], [
    "Student ID", "Student name", "Graded points earned", "Graded points possible",
    "Graded assignments", "Ungraded assignments", "Missing assignments",
  ]);
});

test("EDU gradebook and discussions enforce course membership, row privacy, and topic locks", async () => {
  const owner = `edu-learning-owner-${randomUUID()}`;
  const student = `edu-learning-student-${randomUUID()}`;
  const classmate = `edu-learning-classmate-${randomUUID()}`;
  const outsider = `edu-learning-outsider-${randomUUID()}`;
  const otherAgreementOwner = `edu-learning-other-owner-${randomUUID()}`;
  const foreignAgreementMember = `edu-learning-foreign-member-${randomUUID()}`;
  const agreementA = "fixture:signed-agreement";
  const agreementB = "fixture:other-signed-agreement";
  const courseIds = [];
  const assignmentIds = [];
  const topicIds = [];
  const replyIds = [];
  const clientLicenseIds = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { error() {}, warn() {} }; next(); });
  app.use("/api", (req, res, next) => {
    if (!getAuth(req).userId) return res.status(401).json({ error: "Unauthorized" });
    next();
  });
  app.use("/api/edu", requireEduCredential);
  app.use("/api/edu/courses/:id", requireEduCourseAgreement);
  app.use("/api", eduLearningRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/edu`;
  const request = async (path, user, method = "GET", body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(user ? { "x-test-user": user } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status, headers: response.headers,
      body: response.status === 204 ? null : response.headers.get("content-type")?.startsWith("text/csv")
        ? await response.text() : await response.json(),
    };
  };

  try {
    await db.insert(classscribeEduLicenseGrantsTable).values([
      {
        userId: owner,
        signedAgreementRef: agreementA,
        approvedAt: new Date(Date.now() - 1_000),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      {
        userId: otherAgreementOwner,
        signedAgreementRef: agreementB,
        approvedAt: new Date(Date.now() - 1_000),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    ]);
    const [licenseA] = await db.insert(classscribeEduClientLicensesTable).values({
      ownerUserId: owner,
      licenseNumber: `EDU-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`,
      signedAgreementRef: agreementA,
      pinHash: "test-only-pin-hash",
      expiresAt: new Date(Date.now() + 86_400_000),
    }).returning();
    const [licenseB] = await db.insert(classscribeEduClientLicensesTable).values({
      ownerUserId: otherAgreementOwner,
      licenseNumber: `EDU-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`,
      signedAgreementRef: agreementB,
      pinHash: "test-only-pin-hash",
      expiresAt: new Date(Date.now() + 86_400_000),
    }).returning();
    clientLicenseIds.push(licenseA.id, licenseB.id);
    const expiresAt = new Date(Date.now() + 86_400_000);
    await db.insert(classscribeEduClientSessionsTable).values([
      ...[owner, student, classmate, outsider].map(userId => ({
        licenseId: licenseA.id, userId, clerkSessionId: `sess_${userId}`,
        signedAgreementRef: agreementA, expiresAt,
      })),
      {
        licenseId: licenseB.id, userId: foreignAgreementMember,
        clerkSessionId: `sess_${foreignAgreementMember}`, signedAgreementRef: agreementB, expiresAt,
      },
    ]);
    const [courseA] = await db.insert(coursesTable).values({
      name: "Learning course A", subject: "Science", term: "Fall", color: "#123456",
      inviteCode: randomUUID().toUpperCase(), ownerId: owner, eduEnabled: true,
    }).returning();
    const [courseB] = await db.insert(coursesTable).values({
      name: "Learning course B", subject: "History", term: "Fall", color: "#654321",
      inviteCode: randomUUID().toUpperCase(), ownerId: owner, eduEnabled: true,
    }).returning();
    courseIds.push(courseA.id, courseB.id);
    await db.insert(classscribeEduCourseLicenseBindingsTable).values([
      { courseId: courseA.id, signedAgreementRef: agreementA },
      { courseId: courseB.id, signedAgreementRef: agreementA },
    ]);
    await db.insert(courseMembersTable).values([
      { courseId: courseA.id, userId: student },
      { courseId: courseA.id, userId: classmate },
      { courseId: courseA.id, userId: foreignAgreementMember },
      { courseId: courseB.id, userId: student },
    ]);
    const [assignment] = await db.insert(eduAssignmentsTable).values({
      courseId: courseA.id, title: "Lab", instructions: "Explain it.", points: 10,
    }).returning();
    const [crossAssignment] = await db.insert(eduAssignmentsTable).values({
      courseId: courseB.id, title: "Other-course lab", instructions: "Private.", points: 7,
    }).returning();
    const [weightedAssignment] = await db.insert(eduAssignmentsTable).values({
      courseId: courseA.id, title: "Final project", instructions: "Build it.", points: 30,
    }).returning();
    assignmentIds.push(assignment.id, crossAssignment.id, weightedAssignment.id);
    // These text-only fixtures need no attachment columns.
    await db.execute(sql`insert into classscribe_edu_submissions
      (assignment_id, student_id, text, score, feedback) values
      (${assignment.id}, ${student}, 'Graded answer', 8, 'Good.'),
      (${assignment.id}, ${classmate}, 'Not graded yet', null, null),
      (${weightedAssignment.id}, ${student}, 'Final answer', 15, null),
      (${crossAssignment.id}, ${student}, 'Different class', 7, null)`);
    const [topic] = await db.insert(eduDiscussionTopicsTable).values({
      courseId: courseA.id, creatorId: student, title: "Study question", body: "How does this work?",
    }).returning();
    const [crossTopic] = await db.insert(eduDiscussionTopicsTable).values({
      courseId: courseB.id, creatorId: student, title: "Private topic", body: "Other course content.",
    }).returning();
    topicIds.push(topic.id, crossTopic.id);

    const ownerBook = await request(`/courses/${courseA.id}/gradebook`, owner);
    assert.equal(ownerBook.status, 200);
    assert.deepEqual(ownerBook.body.assignments.map(row => row.id).sort(), [assignment.id, weightedAssignment.id].sort());
    assert.equal(ownerBook.body.students.length, 3);
    const graded = ownerBook.body.students.find(row => row.studentId === student);
    assert.equal(graded.grades.find(row => row.assignmentId === assignment.id).status, "graded");
    assert.equal(graded.grades.find(row => row.assignmentId === weightedAssignment.id).score, 15);
    assert.equal(graded.totals.earned, 23);
    assert.equal(graded.totals.possible, 40);
    const ungraded = ownerBook.body.students.find(row => row.studentId === classmate);
    assert.equal(ungraded.grades.find(row => row.assignmentId === assignment.id).status, "ungraded");
    assert.equal(ungraded.grades.find(row => row.assignmentId === weightedAssignment.id).status, "no_deadline");
    assert.equal(ungraded.totals.earned, 0);
    assert.equal(ungraded.totals.possible, 0);
    assert.equal(ungraded.totals.ungradedCount, 1);
    assert.equal(ungraded.totals.missingCount, 0);
    assert.equal(ungraded.totals.noDeadlineCount, 1);
    assert.equal(ungraded.totals.notSubmittedCount, 0);
    const studentBook = await request(`/courses/${courseA.id}/gradebook`, student);
    assert.equal(studentBook.status, 200);
    assert.equal(studentBook.body.students.length, 1);
    assert.equal(studentBook.body.students[0].studentId, student);
    assert.equal(studentBook.body.students[0].grades.length, 2);
    const classmateBook = await request(`/courses/${courseA.id}/gradebook`, classmate);
    assert.equal(classmateBook.body.students.length, 1);
    assert.equal(classmateBook.body.students[0].studentId, classmate);
    // Hold the read clock fixed so equality and one-millisecond boundaries
    // exercise the actual endpoint for both instructor and student.
    const readTime = Date.now();
    const realNow = Date.now;
    try {
      Date.now = () => readTime;
      for (const [dueAt, status, counts] of [
        [null, "no_deadline", [0, 0, 1]],
        [new Date(readTime + 1), "not_submitted", [0, 1, 0]],
        [new Date(readTime), "not_submitted", [0, 1, 0]],
        [new Date(readTime - 1), "missing", [1, 0, 0]],
      ]) {
        await db.update(eduAssignmentsTable).set({ dueAt }).where(eq(eduAssignmentsTable.id, weightedAssignment.id));
        const instructorResponse = await request(`/courses/${courseA.id}/gradebook`, owner);
        const learnerResponse = await request(`/courses/${courseA.id}/gradebook`, classmate);
        assert.equal(instructorResponse.status, 200);
        assert.equal(learnerResponse.status, 200);
        const instructorRow = instructorResponse.body.students.find(row => row.studentId === classmate);
        assert.deepEqual(learnerResponse.body.students[0], instructorRow);
        assert.equal(instructorRow.grades.find(row => row.assignmentId === weightedAssignment.id).status, status);
        assert.deepEqual(instructorRow.totals, {
          earned: 0, possible: 0, gradedCount: 0, ungradedCount: 1,
          missingCount: counts[0], notSubmittedCount: counts[1], noDeadlineCount: counts[2],
        });
        const submittedRow = instructorResponse.body.students.find(row => row.studentId === student);
        assert.equal(submittedRow.grades.find(row => row.assignmentId === weightedAssignment.id).status, "graded");
        assert.equal(submittedRow.totals.earned, 23);
        assert.equal(submittedRow.totals.possible, 40);
        assert.equal(instructorRow.grades.find(row => row.assignmentId === assignment.id).status, "ungraded");
      }
    } finally {
      Date.now = realNow;
    }
    const otherCourseBook = await request(`/courses/${courseB.id}/gradebook`, owner);
    assert.deepEqual(otherCourseBook.body.assignments.map(row => row.id), [crossAssignment.id]);
    assert.equal(otherCourseBook.body.students[0].totals.earned, 7);
    assert.equal((await request(`/courses/${courseA.id}/gradebook`, outsider)).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/gradebook`, foreignAgreementMember)).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/gradebook`, null)).status, 401);

    const exported = await request(`/courses/${courseA.id}/gradebook/export`, owner);
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(exported.headers.get("cache-control"), "private, no-store");
    assert.equal(exported.headers.get("content-disposition"), `attachment; filename="gradebook-${courseA.id}.csv"`);
    const [csvHeaders, ...csvRows] = parseCsv(exported.body);
    assert.equal(csvRows.length, 3);
    assert.equal(csvHeaders.length, 13);
    const gradedCsv = csvRows.find(row => row[0] === student);
    const awaitingCsv = csvRows.find(row => row[0] === classmate);
    const index = (a, field) => csvHeaders.indexOf(`${a.title} [${a.id}] ${field}`);
    assert.equal(gradedCsv[index(assignment, "points")], "10");
    assert.equal(gradedCsv[index(assignment, "score")], "8");
    assert.equal(gradedCsv[index(weightedAssignment, "score")], "15");
    assert.deepEqual(gradedCsv.slice(-5), ["23", "40", "2", "0", "0"]);
    assert.equal(awaitingCsv[index(assignment, "score")], "");
    assert.equal(awaitingCsv[index(assignment, "status")], "ungraded");
    assert.equal(awaitingCsv[index(weightedAssignment, "status")], "missing");
    assert.deepEqual(awaitingCsv.slice(-5), ["0", "0", "0", "1", "1"]);
    assert.ok(!exported.body.includes(crossAssignment.id));
    const exportedB = await request(`/courses/${courseB.id}/gradebook/export`, owner);
    assert.equal(exportedB.status, 200);
    const [headersB, ...rowsB] = parseCsv(exportedB.body);
    assert.equal(rowsB.length, 1);
    assert.equal(rowsB[0][0], student);
    assert.ok(headersB.some(header => header.includes(crossAssignment.id)));
    assert.ok(!exportedB.body.includes(weightedAssignment.id));
    assert.ok(!exportedB.body.includes(classmate));
    for (const member of [student, classmate]) {
      const denied = await request(`/courses/${courseA.id}/gradebook/export`, member);
      assert.equal(denied.status, 403);
      assert.ok(!JSON.stringify(denied.body).includes(classmate));
    }
    for (const user of [outsider, foreignAgreementMember]) {
      assert.equal((await request(`/courses/${courseA.id}/gradebook/export`, user)).status, 404);
    }
    assert.equal((await request(`/courses/${courseA.id}/gradebook/export`, null)).status, 401);
    assert.equal((await request(`/courses/not-a-course/gradebook/export`, owner)).status, 404);
    assert.equal((await request(`/courses/${randomUUID()}/gradebook/export`, owner)).status, 404);
    // An empty course still downloads useful CSV headers (and roster-only rows).
    await db.delete(eduAssignmentsTable).where(eq(eduAssignmentsTable.id, crossAssignment.id));
    const noAssignments = await request(`/courses/${courseB.id}/gradebook/export`, owner);
    assert.equal(noAssignments.status, 200);
    assert.equal(parseCsv(noAssignments.body).length, 2);
    assert.equal(parseCsv(noAssignments.body)[1].length, 7);
    await db.delete(courseMembersTable).where(eq(courseMembersTable.courseId, courseB.id));
    const empty = await request(`/courses/${courseB.id}/gradebook/export`, owner);
    assert.equal(empty.status, 200);
    assert.equal(parseCsv(empty.body).length, 1);
    await db.update(classscribeEduLicenseGrantsTable).set({ revokedAt: new Date() })
      .where(eq(classscribeEduLicenseGrantsTable.userId, owner));
    assert.equal((await request(`/courses/${courseA.id}/gradebook/export`, owner)).status, 403);
    await db.update(classscribeEduLicenseGrantsTable).set({ revokedAt: null })
      .where(eq(classscribeEduLicenseGrantsTable.userId, owner));

    const listed = await request(`/courses/${courseA.id}/discussions`, student);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.topics.map(item => item.id), [topic.id]);
    assert.equal((await request(`/courses/${courseA.id}/discussions`, foreignAgreementMember)).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/discussions/${crossTopic.id}/replies`, student)).status, 404);
    const createdTopic = await request(`/courses/${courseA.id}/discussions`, classmate, "POST", {
      title: "Follow-up", body: "Another plain-text prompt.",
    });
    assert.equal(createdTopic.status, 201);
    topicIds.push(createdTopic.body.topic.id);
    const createdReply = await request(`/courses/${courseA.id}/discussions/${topic.id}/replies`, classmate, "POST", {
      body: "Here is a reply.",
    });
    assert.equal(createdReply.status, 201);
    replyIds.push(createdReply.body.reply.id);
    assert.equal((await request(`/courses/${courseA.id}/discussions/${topic.id}/replies`, outsider)).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/discussions/${topic.id}/replies`, student, "POST", { body: "x".repeat(10_001) })).status, 400);
    const locked = await request(`/courses/${courseA.id}/discussions/${topic.id}`, owner, "PATCH", { locked: true });
    assert.equal(locked.status, 200);
    assert.ok(locked.body.topic.lockedAt);
    assert.equal((await request(`/courses/${courseA.id}/discussions/${topic.id}/replies`, student, "POST", {
      body: "This should be rejected.",
    })).status, 409);
    assert.equal((await request(`/courses/${courseA.id}/discussions/${crossTopic.id}`, owner, "PATCH", {
      locked: true,
    })).status, 404);
    await db.update(classscribeEduLicenseGrantsTable).set({ signedAgreementRef: agreementB })
      .where(eq(classscribeEduLicenseGrantsTable.userId, owner));
    await db.update(classscribeEduClientSessionsTable).set({
      licenseId: licenseB.id,
      signedAgreementRef: agreementB,
      expiresAt,
    }).where(eq(classscribeEduClientSessionsTable.userId, owner));
    assert.equal((await request(`/courses/${courseA.id}/gradebook`, owner)).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/gradebook/export`, owner)).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/discussions`, owner)).status, 404);
  } finally {
    if (replyIds.length) await db.delete(eduDiscussionRepliesTable).where(inArray(eduDiscussionRepliesTable.id, replyIds));
    if (topicIds.length) await db.delete(eduDiscussionTopicsTable).where(inArray(eduDiscussionTopicsTable.id, topicIds));
    if (assignmentIds.length) await db.delete(eduAssignmentsTable).where(inArray(eduAssignmentsTable.id, assignmentIds));
    if (courseIds.length) await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
    await db.delete(classscribeEduLicenseGrantsTable).where(eq(classscribeEduLicenseGrantsTable.userId, owner));
    await db.delete(classscribeEduLicenseGrantsTable).where(eq(classscribeEduLicenseGrantsTable.userId, otherAgreementOwner));
    if (clientLicenseIds.length) {
      await db.delete(classscribeEduClientLicensesTable)
        .where(inArray(classscribeEduClientLicensesTable.id, clientLicenseIds));
    }
    server.close();
    await pool.end();
  }
});