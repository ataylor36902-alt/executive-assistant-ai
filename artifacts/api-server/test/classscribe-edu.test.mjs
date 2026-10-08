import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, pool, coursesTable, courseMembersTable, eduMaterialsTable, eduAssignmentsTable, eduSubmissionsTable, notesTable,
  classscribeEduLicenseGrantsTable, classscribeEduClientLicensesTable, classscribeEduClientFailedAttemptsTable,
  classscribeEduCourseLicenseBindingsTable,
   classscribeEduInstitutionAgreementsTable, classscribeEduInstructorAuditTable,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import eduRouter, { requireEduCredential, requireEduCourseAgreement } from "../src/routes/classscribe-edu.ts";
import eduLearningRouter from "../src/routes/classscribe-edu-learning.ts";
import { hashEduClientPin, fingerprintEduRateLimitScope } from "../src/lib/classscribe-edu-client-credentials.ts";
import classscribeRouter from "../src/routes/classscribe.ts";
import notesRouter from "../src/routes/notes.ts";
import gradesRouter from "../src/routes/grades.ts";
import { ObjectStorageService } from "../src/lib/objectStorage.ts";
import { eduExpiryWarning } from "../src/lib/edu-expiry-warning.ts";

test("EDU expiry warning is opt-in and bounded by the verified, unrevoked agreement", () => {
  const expiresAt = new Date("2026-11-01T12:00:00.000Z");
  const startsAt = new Date("2026-10-02T12:00:00.000Z");
  const agreement = { expiresAt, verifiedAt: new Date("2026-01-01Z"), revokedAt: null, expiryWarningEnabled: true };
  assert.deepEqual(eduExpiryWarning(agreement, startsAt), { enabled: true, startsAt, due: true });
  assert.equal(eduExpiryWarning(agreement, new Date(startsAt.getTime() - 1)).due, false);
  assert.equal(eduExpiryWarning(agreement, new Date(expiresAt.getTime() - 1)).due, true);
  assert.equal(eduExpiryWarning(agreement, expiresAt).due, false);
  assert.equal(eduExpiryWarning(agreement, new Date(expiresAt.getTime() + 1)).due, false);
  assert.equal(eduExpiryWarning({ ...agreement, expiryWarningEnabled: false }, startsAt).due, false);
  assert.equal(eduExpiryWarning({ ...agreement, revokedAt: startsAt }, startsAt).due, false);
  assert.equal(eduExpiryWarning({ ...agreement, verifiedAt: expiresAt }, startsAt).due, false);
});

test("EDU permissions isolate instructor, members, outsiders, grades, and private notes", async () => {
  const generatedClient = readFileSync(resolve(process.cwd(), "../../lib/api-client-react/src/generated/api.ts"), "utf8");
  const assignmentDeleteUrl = generatedClient.match(/export const getDeleteEduAssignmentUrl =[\s\S]*?return `([^`]+)`/)?.[1];
  assert.equal(assignmentDeleteUrl, "/api/edu/courses/${id}/assignments/${itemId}");
  const owner = `edu-owner-${randomUUID()}`;
  const student = `edu-student-${randomUUID()}`;
  const classmate = `edu-classmate-${randomUUID()}`;
  const otherOwner = `edu-other-owner-${randomUUID()}`;
  const otherSchoolOwner = `edu-other-school-${randomUUID()}`;
  const outsider = `edu-outsider-${randomUUID()}`;
  const unlicensedOwner = `edu-unlicensed-${randomUUID()}`;
  const joinedStudent = `edu-joined-student-${randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.set("trust proxy", true);
  app.use((req, _res, next) => { req.log = { error() {}, warn() {} }; next(); });
  const requireAuth = (req, res, next) => {
    if (!getAuth(req).userId) return res.status(401).json({ error: "Unauthorized" });
    next();
  };
  app.use("/api/edu", requireAuth, requireEduCredential);
  app.use("/api/edu/courses/:id", requireEduCourseAgreement);
  app.use("/api", requireAuth, eduRouter);
  app.use("/api", requireAuth, eduLearningRouter);
  app.use("/api", requireAuth, classscribeRouter);
  app.use("/api", requireAuth, notesRouter);
  app.use("/api", requireAuth, gradesRouter);
  const server = app.listen(0);
  const apiBase = `http://127.0.0.1:${server.address().port}/api`;
  const base = `${apiBase}/edu`;
  const request = async (path, user, method = "GET", body, sessionId, ipAddress) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(user ? { "x-test-user": user } : {}),
        ...(sessionId ? { "x-test-session": sessionId } : {}),
        ...(ipAddress ? { "x-forwarded-for": ipAddress } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = response.status === 204 ? "" : await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; }
    catch { throw new Error(`${method} ${path} as ${user}: ${response.status} ${text.slice(0, 600)}`); }
    return { status: response.status, body: payload };
  };
  const privateRequest = async (path, user, method = "GET", body) => {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: { ...(user ? { "x-test-user": user } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  let courseA;
  let courseB;
  let courseC;
  let createdCourse;
  let unlicensedCourse;
  let unboundCourse;
  const noteIds = [];
  const files = new Map();
  const oldUpload = ObjectStorageService.prototype.uploadObject;
  const oldGet = ObjectStorageService.prototype.getObjectEntityFile;
  const oldDelete = ObjectStorageService.prototype.deleteObject;
  ObjectStorageService.prototype.deleteObject = async path => { files.delete(path.slice("/objects/".length)); };
  ObjectStorageService.prototype.uploadObject = async (key, bytes, mime) => { files.set(key, { bytes, mime }); };
  ObjectStorageService.prototype.getObjectEntityFile = async path => {
    const key = path.slice("/objects/".length);
    const stored = files.get(key);
    if (!stored) throw new Error("File missing");
    return {
      createReadStream: () => Readable.from([stored.bytes]),
      delete: async () => { files.delete(key); },
    };
  };
  const licenseNumber = `EDU-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`;
  const secondLicenseNumber = `EDU-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`;
  const clientPin = "1234567890";
  const pinAttacker = `edu-pin-attacker-${randomUUID()}`;
  try {
    // Clear only institutional rows left by an interrupted run of this fixture.
    await db.delete(classscribeEduInstitutionAgreementsTable).where(inArray(
      classscribeEduInstitutionAgreementsTable.signedAgreementRef,
      ["fixture:shared-institution-agreement", "fixture:other-school-agreement"],
    ));
    const grantExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(classscribeEduLicenseGrantsTable).values([
      { userId: owner, signedAgreementRef: "fixture:shared-institution-agreement", approvedAt: new Date(Date.now() - 1000), expiresAt: grantExpiresAt },
      { userId: otherOwner, signedAgreementRef: "fixture:shared-institution-agreement", approvedAt: new Date(Date.now() - 1000), expiresAt: grantExpiresAt },
      { userId: otherSchoolOwner, signedAgreementRef: "fixture:other-school-agreement", approvedAt: new Date(Date.now() - 1000), expiresAt: grantExpiresAt },
    ]);
    await db.insert(classscribeEduClientLicensesTable).values({
      licenseNumber,
      ownerUserId: owner,
      signedAgreementRef: "fixture:shared-institution-agreement",
      pinHash: await hashEduClientPin(clientPin),
      expiresAt: grantExpiresAt,
    });
    assert.deepEqual((await request("/access", outsider)).body, {
      canCreateCourse: false, canJoinLicensedCourse: false, needsCredentials: true, canManageSchool: false,
    });
    const eduUsers = [owner, otherOwner, student, classmate, outsider, unlicensedOwner, joinedStudent, otherSchoolOwner];
    for (const eduUser of eduUsers) {
      assert.equal((await request("/courses", eduUser)).status, 403);
      const activated = await request("/activate", eduUser, "POST", { licenseNumber, clientPin });
      assert.equal(activated.status, 200);
    }
    [courseA] = await db.insert(coursesTable).values({
      name: "EDU A", subject: "BIO", term: "Fall", color: "#000000",
      inviteCode: randomUUID().toUpperCase(), ownerId: owner, eduEnabled: true,
    }).returning();
    [courseB] = await db.insert(coursesTable).values({
      name: "EDU B", subject: "CHEM", term: "Fall", color: "#000000",
      inviteCode: randomUUID().toUpperCase(), ownerId: otherOwner, eduEnabled: true,
    }).returning();
    [courseC] = await db.insert(coursesTable).values({
      name: "Different EDU school", subject: "HIST", term: "Fall", color: "#000000",
      inviteCode: randomUUID().toUpperCase(), ownerId: otherSchoolOwner, eduEnabled: true,
    }).returning();
    [unlicensedCourse] = await db.insert(coursesTable).values({
      name: "Unlicensed preserved course", subject: "HIST", term: "Fall", color: "#000000",
      inviteCode: randomUUID().toUpperCase(), ownerId: unlicensedOwner, eduEnabled: true,
    }).returning();
    [unboundCourse] = await db.insert(coursesTable).values({
      name: "Legacy unbound course", subject: "HIST", term: "Fall", color: "#000000",
      inviteCode: randomUUID().toUpperCase(), ownerId: otherOwner, eduEnabled: true,
    }).returning();
    await db.insert(classscribeEduCourseLicenseBindingsTable).values([
      { courseId: courseA.id, signedAgreementRef: "fixture:shared-institution-agreement" },
      { courseId: courseB.id, signedAgreementRef: "fixture:shared-institution-agreement" },
      { courseId: courseC.id, signedAgreementRef: "fixture:other-school-agreement" },
      { courseId: unlicensedCourse.id, signedAgreementRef: "fixture:shared-institution-agreement" },
    ]);
    await db.insert(courseMembersTable).values([
      { courseId: courseA.id, userId: student },
      { courseId: courseA.id, userId: classmate },
    ]);
    await db.insert(courseMembersTable).values({ courseId: courseB.id, userId: student });
    await db.insert(courseMembersTable).values({ courseId: courseC.id, userId: student });
    const created = await request("/courses", owner, "POST", {
      name: "Created EDU course", subject: "ART", term: "Spring", ownerId: otherOwner,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.course.ownerId, owner);
    [createdCourse] = await db.select().from(coursesTable).where(eq(coursesTable.id, created.body.course.id));
    assert.equal(createdCourse.eduEnabled, true);
    assert.deepEqual(await request("/access", outsider), {
      status: 200,
       body: { canCreateCourse: false, canJoinLicensedCourse: true, needsCredentials: false, canManageSchool: false },
    });
    const deniedCreation = await request("/courses", unlicensedOwner, "POST", { name: "No license" });
    assert.equal(deniedCreation.status, 403);
    assert.deepEqual(deniedCreation.body, {
      code: "edu_license_required",
      error: "An approved EDU license agreement is required to create or manage EDU courses.",
    });
    assert.equal((await request(`/courses/${unlicensedCourse.id}`, unlicensedOwner)).status, 403);
    assert.equal((await request(`/courses/${unboundCourse.id}`, otherOwner)).status, 404);
    assert.equal((await request("/join", otherOwner, "POST", { inviteCode: unboundCourse.inviteCode })).status, 404);
    assert.equal((await db.select().from(coursesTable).where(eq(coursesTable.id, unlicensedCourse.id))).length, 1);
    const privateCourseList = await privateRequest("/courses", owner);
    assert.equal(privateCourseList.status, 200);
    assert.equal(privateCourseList.body.some(item => item.id === courseA.id || item.id === createdCourse.id), false);
    assert.equal(privateCourseList.body.length, 0);
    assert.equal((await privateRequest("/courses", student)).body.length, 0);
    assert.equal((await privateRequest(`/courses/${courseA.id}/lectures`, owner)).status, 404);
    assert.equal((await privateRequest("/lectures", owner, "POST", {
      courseId: courseA.id, title: "Private library write", professor: "Dr. EDU", lectureDate: new Date().toISOString(),
    })).status, 404);
    assert.equal((await privateRequest("/notes", student, "POST", {
      title: "Private linked note", markdownBody: "No EDU course leakage.", courseId: courseA.id,
    })).status, 404);
    assert.equal((await privateRequest(`/courses/${courseA.id}/grades`, student)).status, 404);
    const [assignment] = await db.insert(eduAssignmentsTable).values({
      courseId: courseA.id, title: "Lab report", instructions: "Explain the data.", points: 20,
    }).returning();
    const [crossCourseAssignment] = await db.insert(eduAssignmentsTable).values({
      courseId: courseB.id, title: "Other course", instructions: "Private.", points: 10,
    }).returning();
    const [courseBSubmission] = await db.insert(eduSubmissionsTable).values({
      assignmentId: crossCourseAssignment.id, studentId: student, text: "Course B private answer",
    }).returning();
    const [firstSubmission] = await db.insert(eduSubmissionsTable).values({
      assignmentId: assignment.id, studentId: student, text: "Student A's private answer",
    }).returning();
    await db.insert(eduSubmissionsTable).values({
      assignmentId: assignment.id, studentId: classmate, text: "Classmate's private answer",
    });
    const [studentNote] = await db.insert(notesTable).values({
      courseId: courseA.id, userId: student, title: "Private student note", markdownBody: "Must survive EDU cleanup.",
    }).returning();
    noteIds.push(studentNote.id);

    assert.equal((await request("/courses", null)).status, 401);
    const ownerCourses = await request("/courses", owner);
    assert.equal(ownerCourses.status, 200);
    assert.equal(ownerCourses.body.courses.find(item => item.id === courseA.id).role, "instructor");
    const studentCourses = await request("/courses", student);
    assert.equal(studentCourses.body.courses.find(item => item.id === courseA.id).role, "student");
    assert.equal(studentCourses.body.courses.find(item => item.id === courseB.id).role, "student");
    assert.deepEqual(new Set(studentCourses.body.courses.map(item => item.id)), new Set([courseA.id, courseB.id]));
    assert.equal(studentCourses.body.courses.some(item => item.id === courseC.id), false);
    assert.equal((await request(`/courses/${courseC.id}`, student)).status, 404);
    assert.equal((await request("/join", student, "POST", { inviteCode: courseC.inviteCode })).status, 404);
    assert.equal((await request("/courses", student, "GET", undefined, `sess_${owner}`)).status, 403);
    assert.equal((await request("/courses", `${student}-replay`, "GET", undefined, `sess_${owner}`)).status, 403);
    assert.equal((await request("/access", owner)).body.canCreateCourse, true);

    const ownerDetail = await request(`/courses/${courseA.id}`, owner);
    assert.deepEqual(new Set(ownerDetail.body.roster.map(member => member.userId)), new Set([student, classmate]));
    assert.deepEqual(new Set(ownerDetail.body.roster.map(member => member.name)), new Set([student, classmate]));
    const studentDetail = await request(`/courses/${courseA.id}`, student);
    assert.equal("roster" in studentDetail.body, false);
    assert.equal("mySubmission" in studentDetail.body.assignments[0], true);
    assert.equal(studentDetail.body.assignments[0].mySubmission.id, firstSubmission.id);
    assert.equal(JSON.stringify(studentDetail.body).includes("Classmate's private answer"), false);
    const noLicenseStudentJoin = await request("/join", joinedStudent, "POST", { inviteCode: courseA.inviteCode });
    assert.equal(noLicenseStudentJoin.status, 200);
    const joinedStudentDetail = await request(`/courses/${courseA.id}`, joinedStudent);
    assert.equal(joinedStudentDetail.body.role, "student");
    assert.equal(joinedStudentDetail.body.assignments.some(item => item.mySubmission), false);
    assert.equal((await request(`/courses/${courseA.id}`, outsider)).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/assignments/${crossCourseAssignment.id}/submissions`, owner)).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/assignments/${assignment.id}/submissions`, student)).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/assignments/${assignment.id}/submissions`, outsider)).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/announcements`, student, "POST", { title: "Student attempt", body: "Nope" })).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/materials`, student, "POST", { title: "Bad link", url: "javascript:alert(1)" })).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/materials`, owner, "POST", { title: "Bad scheme", url: "ftp://example.org/file" })).status, 400);
    const fileInput = { filename: "lecture.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-1.4\nclass file").toString("base64") };
    assert.equal((await request(`/courses/${courseA.id}/materials/uploads`, student, "POST", { ...fileInput, title: "Not allowed" })).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/materials/uploads`, owner, "POST", { ...fileInput, title: "Wrong format", data: Buffer.from("<script>").toString("base64") })).status, 400);
    const fileMaterial = await request(`/courses/${courseA.id}/materials/uploads`, owner, "POST", { ...fileInput, title: "Lecture file" });
    assert.equal(fileMaterial.status, 201);
    assert.equal(fileMaterial.body.material.filename, "lecture.pdf");
    assert.equal(JSON.stringify(fileMaterial.body).includes("fileKey"), false);
    const fileMaterialId = fileMaterial.body.material.id;
    const filePath = `/courses/${courseA.id}/materials/${fileMaterialId}/file`;
    const rawFileRequest = (path, user) => fetch(`${base}${path}`, { headers: { "x-test-user": user } });
    assert.equal((await rawFileRequest(filePath, outsider)).status, 404);
    assert.equal((await rawFileRequest(`/courses/${courseB.id}/materials/${fileMaterialId}/file`, student)).status, 404);
    const downloadedMaterial = await rawFileRequest(filePath, student);
    assert.equal(downloadedMaterial.status, 200);
    assert.equal(await downloadedMaterial.text(), "%PDF-1.4\nclass file");
    assert.equal(downloadedMaterial.headers.get("cache-control"), "private, no-store");
    assert.equal((await db.select().from(eduMaterialsTable).where(eq(eduMaterialsTable.id, fileMaterialId)))[0].fileKey.startsWith(`edu-files/${courseA.id}/`), true);
    const visibleMaterial = (await request(`/courses/${courseA.id}`, student)).body.materials.find(item => item.id === fileMaterialId);
    assert.equal(visibleMaterial.filename, "lecture.pdf");
    assert.equal(JSON.stringify(visibleMaterial).includes("fileKey"), false);
    const createdAssignment = await request(`/courses/${courseA.id}/assignments`, owner, "POST", {
      title: "New EDU task", instructions: "Write a response.", dueAt: "2026-11-03T18:30:00.000Z", points: 5,
    });
    assert.equal(createdAssignment.status, 201);
    const attachmentPath = `/courses/${courseA.id}/assignments/${createdAssignment.body.assignment.id}`;
    assert.equal((await request(`${attachmentPath}/attachment`, student, "POST", fileInput)).status, 404);
    assert.equal((await request(`${attachmentPath}/attachment`, owner, "POST", fileInput)).status, 200);
    assert.equal((await request(`${attachmentPath}/attachment`, owner, "POST", fileInput)).status, 409);
    assert.equal((await rawFileRequest(`${attachmentPath}/file`, outsider)).status, 404);
    assert.equal((await rawFileRequest(`/courses/${courseB.id}/assignments/${createdAssignment.body.assignment.id}/file`, student)).status, 404);
    assert.equal((await rawFileRequest(`${attachmentPath}/file`, student)).status, 200);
    assert.equal((await request(`/courses/${courseA.id}`, student)).body.assignments.find(a => a.id === createdAssignment.body.assignment.id).filename, "lecture.pdf");
    assert.equal((await request(`${attachmentPath}/attachment`, owner, "DELETE")).status, 204);
    assert.equal((await rawFileRequest(`${attachmentPath}/file`, student)).status, 404);
    assert.equal((await request(`${attachmentPath}/attachment`, owner, "POST", fileInput)).status, 200);
    assert.equal((await request(attachmentPath, owner, "DELETE")).status, 204);
    assert.equal((await rawFileRequest(`${attachmentPath}/file`, student)).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/materials/${fileMaterialId}`, owner, "DELETE")).status, 204);
    assert.equal((await rawFileRequest(filePath, student)).status, 404);
    assert.equal(files.size, 0);
    assert.equal(new Date(createdAssignment.body.assignment.dueAt).toISOString(), "2026-11-03T18:30:00.000Z");
    assert.equal((await request(`/courses/${courseA.id}/assignments`, owner, "POST", {
      title: "Bad date", instructions: "No.", dueAt: "tomorrow", points: 5,
    })).status, 400);
    assert.equal((await request(`/courses/${courseA.id}/assignments`, owner, "POST", {
      title: "Impossible date", instructions: "No.", dueAt: "2026-02-31T18:30:00.000Z", points: 5,
    })).status, 400);

    const listedSubmissions = await request(`/courses/${courseA.id}/assignments/${assignment.id}/submissions`, owner);
    assert.equal(listedSubmissions.status, 200);
    assert.equal(listedSubmissions.body.submissions.length, 2);
    const editedSubmission = await request(`/courses/${courseA.id}/assignments/${assignment.id}/submission`, student, "POST", {
      text: "Student A's revised private answer",
    });
    assert.equal(editedSubmission.status, 200);
    assert.equal(editedSubmission.body.submission.id, firstSubmission.id);
    assert.equal(new Date(editedSubmission.body.submission.submittedAt).toISOString(), firstSubmission.submittedAt.toISOString());
    const graded = await request(
      `/courses/${courseA.id}/assignments/${assignment.id}/submissions/${firstSubmission.id}`,
      owner, "PATCH", { score: 18, feedback: "Good work." },
    );
    assert.equal(graded.status, 200);
    assert.equal(new Date(graded.body.submission.submittedAt).toISOString(), firstSubmission.submittedAt.toISOString());
    assert.equal((await request(`/courses/${courseA.id}/assignments/${assignment.id}`, owner, "PATCH", { points: 17 })).status, 400);
    assert.equal((await request(
      `/courses/${courseA.id}/assignments/${assignment.id}/submissions/${firstSubmission.id}`,
      student, "PATCH", { score: 0, feedback: "Tamper" },
    )).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/assignments/${assignment.id}/submission`, student, "POST", { text: "Changed after grade" })).status, 409);
    const afterGrade = await request(`/courses/${courseA.id}`, student);
    assert.equal(afterGrade.body.assignments[0].mySubmission.score, 18);
    assert.equal(JSON.stringify(afterGrade.body).includes("Classmate's private answer"), false);
    const classmateDetail = await request(`/courses/${courseA.id}`, classmate);
    assert.equal(classmateDetail.body.assignments[0].mySubmission.score, null);
    assert.equal(classmateDetail.body.assignments[0].mySubmission.id !== firstSubmission.id, true);
    assert.equal(JSON.stringify(classmateDetail.body).includes("Student A's private answer"), false);
    // Removing one classroom membership must deny grades/course details without
    // revoking the student's school credentials or deleting their private notes.
    assert.equal((await request(`/courses/${courseA.id}/gradebook`, student)).status, 200);
    await db.delete(courseMembersTable).where(and(
      eq(courseMembersTable.courseId, courseA.id), eq(courseMembersTable.userId, student),
    ));
    const removedAccess = await request("/access", student);
    assert.equal(removedAccess.status, 200);
    assert.equal(removedAccess.body.needsCredentials, false);
    assert.equal((await request("/courses", student)).body.courses.some(item => item.id === courseA.id), false);
    for (const path of [`/courses/${courseA.id}`, `/courses/${courseA.id}/gradebook`]) {
      const removedResponse = await request(path, student);
      assert.equal(removedResponse.status, 404, `removed membership must deny ${path}`);
      assert.equal(JSON.stringify(removedResponse.body).includes("Good work."), false);
      assert.equal("assignments" in removedResponse.body, false);
      assert.equal("students" in removedResponse.body, false);
    }
    assert.equal((await request(`/courses/${courseA.id}/assignments/${assignment.id}/submission`, student, "POST", { text: "Removed student" })).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/gradebook`, classmate)).status, 200);
    assert.equal((await db.select().from(notesTable).where(eq(notesTable.id, studentNote.id))).length, 1);
    await db.insert(courseMembersTable).values({ courseId: courseA.id, userId: student });
    assert.equal((await request(
      `/courses/${courseA.id}/assignments/${assignment.id}/submissions/${firstSubmission.id}`,
      outsider, "PATCH", { score: 17, feedback: "No" },
    )).status, 404);
    assert.equal((await request(
      `/courses/${courseA.id}/assignments/${assignment.id}/submissions/${firstSubmission.id}`,
      owner, "PATCH", { score: 21, feedback: "Too high" },
    )).status, 400);

    const invite = await request(`/courses/${courseA.id}/invite`, owner, "POST");
    assert.ok(invite.body.inviteCode);
    const modernEduJoin = await privateRequest("/courses/join", `${outsider}-modern-edu-bypass`, "POST", { code: courseA.inviteCode });
    assert.equal(modernEduJoin.status, 404);
    assert.equal((await db.select().from(courseMembersTable).where(and(
      eq(courseMembersTable.courseId, courseA.id),
      eq(courseMembersTable.userId, `${outsider}-modern-edu-bypass`),
    ))).length, 0);
    const joined = await request("/join", outsider, "POST", { inviteCode: invite.body.inviteCode });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.body.course.ownerId, owner);
    assert.equal((await request(`/courses/${courseA.id}`, outsider)).body.role, "student");
    const oldInviteCode = invite.body.inviteCode;
    const rotated = await request(`/courses/${courseA.id}/invite/rotate`, owner, "POST");
    assert.equal(rotated.status, 200);
    assert.ok(rotated.body.inviteCode);
    assert.notEqual(rotated.body.inviteCode, oldInviteCode);
    assert.equal((await request(`/courses/${courseA.id}/invite/rotate`, student, "POST")).status, 404);
    assert.equal((await request(`/courses/${courseA.id}/invite/rotate`, outsider, "POST")).status, 404);
    const afterRotationUser = `${outsider}-after-rotation`;
    assert.equal((await request("/activate", afterRotationUser, "POST", { licenseNumber, clientPin })).status, 200);
    assert.equal((await request("/join", afterRotationUser, "POST", { inviteCode: oldInviteCode })).status, 404);
    assert.equal((await privateRequest("/courses/join", `${outsider}-modern-after-rotation`, "POST", { code: oldInviteCode })).status, 404);
    const newInviteJoin = await request("/join", afterRotationUser, "POST", { inviteCode: rotated.body.inviteCode });
    assert.equal(newInviteJoin.status, 200);
    assert.equal(newInviteJoin.body.course.ownerId, owner);

    const submissionsWithIdentity = await request(`/courses/${courseA.id}/assignments/${assignment.id}/submissions`, owner);
    assert.equal(submissionsWithIdentity.status, 200);
    const namedStudents = submissionsWithIdentity.body.submissions.map(submission => submission.studentName);
    assert.ok(namedStudents.includes(student));
    assert.ok(namedStudents.includes(classmate));
    assert.equal(new Set(namedStudents).size, 2);
    assert.equal((await request(`/courses/${courseA.id}/assignments/${assignment.id}`, owner, "DELETE")).status, 204);
    assert.equal((await db.select().from(notesTable).where(eq(notesTable.id, studentNote.id))).length, 1);
    assert.equal((await db.select().from(eduSubmissionsTable).where(eq(eduSubmissionsTable.assignmentId, assignment.id))).length, 0);

    await db.insert(courseMembersTable).values({ courseId: courseB.id, userId: student }).onConflictDoNothing();
    await db.update(classscribeEduLicenseGrantsTable).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(classscribeEduLicenseGrantsTable.userId, otherOwner));
    assert.equal((await request(`/courses/${courseB.id}`, otherOwner)).status, 403);
    assert.equal((await request("/courses", otherOwner)).body.courses.some(item => item.id === courseB.id), false);
    assert.equal((await request(`/courses/${courseB.id}/invite`, otherOwner, "POST")).status, 403);
    assert.equal((await request(`/courses/${courseB.id}/assignments/${crossCourseAssignment.id}/submissions`, otherOwner)).status, 403);
    assert.equal((await request(
      `/courses/${courseB.id}/assignments/${crossCourseAssignment.id}/submissions/${courseBSubmission.id}`,
      otherOwner, "PATCH", { score: 8, feedback: "Expired owner" },
    )).status, 403);
    assert.equal((await request(`/courses/${courseB.id}`, student)).status, 404);
    assert.equal((await request("/courses", student)).body.courses.some(item => item.id === courseB.id), false);
    assert.equal((await request(`/courses/${courseB.id}/assignments/${crossCourseAssignment.id}/submission`, student, "POST", { text: "Blocked" })).status, 404);
    assert.equal((await request(`/courses/${courseB.id}/assignments/${crossCourseAssignment.id}/submissions`, student)).status, 404);
    assert.equal((await request(
      `/courses/${courseB.id}/assignments/${crossCourseAssignment.id}/submissions/${courseBSubmission.id}`,
      student, "PATCH", { score: 1, feedback: "Blocked" },
    )).status, 404);
    assert.equal((await request("/join", outsider, "POST", { inviteCode: courseB.inviteCode })).status, 404);
    assert.equal((await db.select().from(coursesTable).where(eq(coursesTable.id, courseB.id))).length, 1);

    const bruteForceIp = "198.51.100.47";
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await request("/activate", pinAttacker, "POST", {
        licenseNumber, clientPin: "0000000000",
      }, undefined, bruteForceIp)).status, 403);
    }
    assert.equal((await request("/activate", pinAttacker, "POST", {
      licenseNumber, clientPin,
    }, undefined, bruteForceIp)).status, 429);

    const [revokedAssignment] = await db.insert(eduAssignmentsTable).values({
      courseId: courseA.id, title: "Revocation check", instructions: "Private.", points: 10,
    }).returning();
    const [revokedSubmission] = await db.insert(eduSubmissionsTable).values({
      assignmentId: revokedAssignment.id, studentId: student, text: "Revocation check answer",
    }).returning();

    const originalSelect = db.select;
    try {
      db.select = () => { throw new Error("fixture license verifier failure"); };
      assert.equal((await request("/access", outsider)).status, 503);
      assert.equal((await request("/courses", outsider, "POST", { name: "Fail closed" })).status, 503);
      assert.equal((await request("/courses", outsider)).status, 503);
      assert.equal((await request(`/courses/${courseA.id}/invite`, owner, "POST")).status, 503);
      assert.equal((await request(`/courses/${courseA.id}/assignments/${revokedAssignment.id}/submissions`, owner)).status, 503);
      assert.equal((await request(
        `/courses/${courseA.id}/assignments/${revokedAssignment.id}/submissions/${revokedSubmission.id}`,
        owner, "PATCH", { score: 1, feedback: "DB unavailable" },
      )).status, 503);
    } finally {
      db.select = originalSelect;
    }

    // A verified school's administrator may approve only exact accounts under
    // their own agreement; a student or another school's instructor cannot.
    const newInstructor = `user_${randomUUID().replaceAll("-", "")}`;
    const anotherInstructor = `user_${randomUUID().replaceAll("-", "")}`;
    const schoolExpiry = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await db.insert(classscribeEduInstitutionAgreementsTable).values([
      { signedAgreementRef: "fixture:shared-institution-agreement", adminUserId: owner, expiresAt: schoolExpiry },
      { signedAgreementRef: "fixture:other-school-agreement", adminUserId: otherSchoolOwner, expiresAt: schoolExpiry },
    ]);
    await db.insert(classscribeEduClientLicensesTable).values({
      licenseNumber: secondLicenseNumber, ownerUserId: otherSchoolOwner,
      signedAgreementRef: "fixture:other-school-agreement", pinHash: await hashEduClientPin(clientPin),
      expiresAt: schoolExpiry,
    });
    assert.equal((await request("/activate", otherSchoolOwner, "POST", { licenseNumber: secondLicenseNumber, clientPin })).status, 200);
    assert.equal((await request("/access", otherSchoolOwner)).body.canManageSchool, true);
    assert.equal((await request("/access", owner)).body.canManageSchool, true);
    assert.equal((await request("/access", student)).body.canManageSchool, false);
    assert.equal((await request("/school", student)).status, 403);
    const initialSchool = await request("/school", owner);
    assert.equal(initialSchool.body.expiryWarning.enabled, false);
    assert.equal(initialSchool.body.expiryWarning.due, false);
    for (const user of [student, otherOwner]) {
      assert.equal((await request("/school/expiry-warning", user, "PATCH", { enabled: true })).status, 403);
    }
    for (const body of [{}, { enabled: "true" }, { enabled: true, expiresAt: grantExpiresAt.toISOString() }]) {
      assert.equal((await request("/school/expiry-warning", owner, "PATCH", body)).status, 400);
    }
    const enabledWarning = await request("/school/expiry-warning", owner, "PATCH", { enabled: true });
    assert.equal(enabledWarning.status, 200);
    assert.equal(enabledWarning.body.enabled, true);
    assert.equal(enabledWarning.body.due, true);
    assert.equal(enabledWarning.body.startsAt, new Date(schoolExpiry.getTime() - 30 * 86400000).toISOString());
    assert.deepEqual((await request("/school", owner)).body.expiryWarning, enabledWarning.body);
    assert.equal((await request("/school", owner)).body.expiresAt, schoolExpiry.toISOString());
    assert.equal((await request("/school", otherSchoolOwner)).body.expiryWarning.enabled, false);
    const laterExpiry = new Date(Date.now() + 60 * 86400000);
    await db.update(classscribeEduInstitutionAgreementsTable).set({ expiresAt: laterExpiry })
      .where(eq(classscribeEduInstitutionAgreementsTable.signedAgreementRef, "fixture:shared-institution-agreement"));
    const rescheduled = (await request("/school", owner)).body.expiryWarning;
    assert.equal(rescheduled.enabled, true);
    assert.equal(rescheduled.due, false);
    assert.equal(rescheduled.startsAt, new Date(laterExpiry.getTime() - 30 * 86400000).toISOString());
    await db.update(classscribeEduInstitutionAgreementsTable).set({ expiresAt: schoolExpiry })
      .where(eq(classscribeEduInstitutionAgreementsTable.signedAgreementRef, "fixture:shared-institution-agreement"));
    assert.equal((await request("/school/expiry-warning", owner, "PATCH", { enabled: false })).body.due, false);
    assert.equal((await request("/school", owner)).body.expiryWarning.enabled, false);
    await request("/school/expiry-warning", owner, "PATCH", { enabled: true });
    assert.equal((await request("/school/instructors", student, "POST", { userId: newInstructor })).status, 403);
    assert.equal((await request("/school/instructors", otherOwner, "POST", { userId: newInstructor })).status, 403);
    assert.equal((await request("/school/instructors", owner, "POST", { userId: student })).status, 400);
    assert.equal((await request("/school/instructors", owner, "POST", { userId: otherSchoolOwner })).status, 400);
    const approved = await request("/school/instructors", owner, "POST", { userId: newInstructor });
    assert.equal(approved.status, 201);
    assert.equal(approved.body.issuerUserId, owner);
    assert.equal(approved.body.signedAgreementRef, "fixture:shared-institution-agreement");
    assert.equal((await request("/school/instructors", owner, "POST", { userId: newInstructor })).status, 409);
    assert.equal((await request("/school/instructors", otherSchoolOwner, "POST", { userId: newInstructor })).status, 409);
    assert.equal((await request(`/school/instructors/${newInstructor}`, otherSchoolOwner, "DELETE")).status, 404);
    assert.equal((await request("/school", otherSchoolOwner)).body.instructors.length, 0);
    assert.equal((await request("/courses", newInstructor)).status, 403);
    assert.equal((await request("/activate", newInstructor, "POST", { licenseNumber, clientPin })).status, 200);
    assert.equal((await request("/courses", newInstructor, "POST", { name: "School class" })).status, 201);
    const schoolCourse = (await db.select().from(coursesTable).where(eq(coursesTable.ownerId, newInstructor)))[0];
    assert.equal((await request(`/courses/${schoolCourse.id}`, newInstructor)).status, 200);
    assert.equal((await request(`/school/instructors/${newInstructor}`, student, "DELETE")).status, 403);
    assert.equal((await request(`/school/instructors/${newInstructor}`, otherOwner, "DELETE")).status, 403);
    assert.equal((await request(`/school/instructors/${newInstructor}`, owner, "DELETE")).status, 204);
    assert.equal((await request(`/courses/${schoolCourse.id}`, newInstructor)).status, 403);
    assert.equal((await request(`/courses/${schoolCourse.id}`, student)).status, 404);
    assert.equal((await db.select().from(coursesTable).where(eq(coursesTable.id, schoolCourse.id))).length, 1);
    assert.deepEqual((await db.select().from(classscribeEduInstructorAuditTable)
      .where(eq(classscribeEduInstructorAuditTable.instructorUserId, newInstructor))).map(row => row.action), ["approved", "revoked"]);
    assert.equal((await request("/school/instructors", owner, "POST", { userId: anotherInstructor })).status, 201);
    // History uses the append-only audit, not the latest grant, and must include
    // past administrators while never accepting another agreement's cursor.
    assert.equal((await request("/school/instructor-history", student)).status, 403);
    assert.equal((await request("/school/instructor-history", otherOwner)).status, 403);
    assert.equal((await request("/school/instructor-history", outsider)).status, 403);
    assert.equal((await request("/school/instructor-history", undefined)).status, 401);
    const history = await request("/school/instructor-history?limit=1", owner);
    assert.equal(history.status, 200);
    const historyResponse = await fetch(`${base}/school/instructor-history`, { headers: { "x-test-user": owner } });
    assert.equal(historyResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(history.body.signedAgreementRef, "fixture:shared-institution-agreement");
    assert.equal(history.body.events.length, 1);
    assert.equal(history.body.events[0].instructorUserId, anotherInstructor);
    assert.equal(history.body.events[0].issuerUserId, owner);
    assert.equal(history.body.events[0].action, "approved");
    assert.ok(history.body.events[0].occurredAt);
    const older = await request(`/school/instructor-history?limit=1&cursor=${history.body.nextCursor}`, owner);
    assert.equal(older.status, 200);
    assert.equal(older.body.events[0].action, "revoked");
    assert.equal(older.body.events[0].instructorUserId, newInstructor);
    assert.equal(older.body.events[0].expiresAt, null);
    const oldest = await request(`/school/instructor-history?limit=1&cursor=${older.body.nextCursor}`, owner);
    assert.equal(oldest.body.events[0].action, "approved");
    assert.equal(oldest.body.nextCursor, null);
    assert.deepEqual((await request("/school/instructor-history", otherSchoolOwner)).body.events, []);
    assert.equal((await request(`/school/instructor-history?cursor=${history.body.nextCursor}`, otherSchoolOwner)).status, 400);
    for (const query of ["limit=0", "limit=101", "limit=1.5", "limit=nope", "limit=1&limit=2", "cursor=nope", `cursor=${randomUUID()}`]) {
      assert.equal((await request(`/school/instructor-history?${query}`, owner)).status, 400, query);
    }
    // Equal timestamps use an ID tie-breaker; appending newer events cannot
    // shift already-issued continuation pages. Different issuers remain visible.
    const tiedAt = new Date(Date.now() + 1000);
    const [tieA, tieB] = await db.insert(classscribeEduInstructorAuditTable).values([
      { signedAgreementRef: "fixture:shared-institution-agreement", issuerUserId: "former-admin", instructorUserId: anotherInstructor, action: "approved", occurredAt: tiedAt },
      { signedAgreementRef: "fixture:shared-institution-agreement", issuerUserId: owner, instructorUserId: anotherInstructor, action: "revoked", occurredAt: tiedAt },
    ]).returning();
    const tiedIds = [tieA.id, tieB.id].sort().reverse();
    const tiedFirst = await request("/school/instructor-history?limit=1", owner);
    assert.equal(tiedFirst.body.events[0].id, tiedIds[0]);
    const [appended] = await db.insert(classscribeEduInstructorAuditTable).values({
      signedAgreementRef: "fixture:shared-institution-agreement", issuerUserId: owner,
      instructorUserId: anotherInstructor, action: "approved", occurredAt: new Date(tiedAt.getTime() + 1000),
    }).returning();
    const tiedNext = await request(`/school/instructor-history?limit=1&cursor=${tiedFirst.body.nextCursor}`, owner);
    assert.equal(tiedNext.body.events[0].id, tiedIds[1]);
    assert.ok((await request("/school/instructor-history", owner)).body.events.some(event => event.issuerUserId === "former-admin"));
    await db.delete(classscribeEduInstructorAuditTable).where(inArray(classscribeEduInstructorAuditTable.id, [tieA.id, tieB.id, appended.id]));
    await db.update(classscribeEduInstitutionAgreementsTable).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(classscribeEduInstitutionAgreementsTable.signedAgreementRef, "fixture:shared-institution-agreement"));
    assert.equal((await request("/courses", owner)).status, 403);
    assert.equal((await request("/courses", student)).status, 403);
    assert.equal((await request("/school/expiry-warning", owner, "PATCH", { enabled: false })).status, 403);
    assert.equal((await request("/school/instructor-history", owner)).status, 403);
    assert.equal((await request("/school/instructors", owner, "POST", { userId: `user_${randomUUID().replaceAll("-", "")}` })).status, 403);
    await db.update(classscribeEduInstitutionAgreementsTable).set({ expiresAt: schoolExpiry })
      .where(eq(classscribeEduInstitutionAgreementsTable.signedAgreementRef, "fixture:shared-institution-agreement"));
    await db.update(classscribeEduInstitutionAgreementsTable).set({ revokedAt: new Date() })
      .where(eq(classscribeEduInstitutionAgreementsTable.signedAgreementRef, "fixture:shared-institution-agreement"));
    assert.equal((await request("/courses", owner)).status, 403);
    assert.equal((await request("/courses", newInstructor)).status, 403);
    assert.equal((await request("/school/instructor-history", owner)).status, 403);
    assert.equal((await request(`/courses/${courseA.id}`, student)).status, 403);
    assert.equal((await request("/school/expiry-warning", owner, "PATCH", { enabled: false })).status, 403);
    await db.delete(coursesTable).where(eq(coursesTable.id, schoolCourse.id));
    await db.delete(classscribeEduInstructorAuditTable).where(inArray(classscribeEduInstructorAuditTable.instructorUserId, [newInstructor, anotherInstructor]));
    await db.delete(classscribeEduLicenseGrantsTable).where(inArray(classscribeEduLicenseGrantsTable.userId, [newInstructor, anotherInstructor]));

    await db.update(classscribeEduLicenseGrantsTable).set({ revokedAt: new Date() })
      .where(eq(classscribeEduLicenseGrantsTable.userId, owner));
    assert.equal((await request(`/courses/${courseA.id}`, owner)).status, 403);
    assert.equal((await request("/courses", owner)).status, 403);
    assert.equal((await request(`/courses/${courseA.id}/invite`, owner, "POST")).status, 403);
    assert.equal((await request(`/courses/${courseA.id}/assignments/${revokedAssignment.id}/submissions`, owner)).status, 403);
    assert.equal((await request(
      `/courses/${courseA.id}/assignments/${revokedAssignment.id}/submissions/${revokedSubmission.id}`,
      owner, "PATCH", { score: 1, feedback: "Revoked owner" },
    )).status, 403);
    assert.equal((await request(`/courses/${courseA.id}`, student)).status, 403);
    assert.equal((await request("/courses", student)).status, 403);
    assert.equal((await request(`/courses/${courseA.id}/assignments/${revokedAssignment.id}/submission`, student, "POST", { text: "Blocked" })).status, 403);
    assert.equal((await request(`/courses/${courseA.id}/assignments/${revokedAssignment.id}/submissions`, student)).status, 403);
    assert.equal((await request(
      `/courses/${courseA.id}/assignments/${revokedAssignment.id}/submissions/${revokedSubmission.id}`,
      student, "PATCH", { score: 1, feedback: "Blocked" },
    )).status, 403);
    assert.equal((await db.select().from(coursesTable).where(eq(coursesTable.id, courseA.id))).length, 1);

    await db.delete(coursesTable).where(eq(coursesTable.id, courseA.id));
    assert.equal((await db.select().from(notesTable).where(eq(notesTable.id, studentNote.id)))[0].courseId, null);
  } finally {
    ObjectStorageService.prototype.uploadObject = oldUpload;
    ObjectStorageService.prototype.getObjectEntityFile = oldGet;
    ObjectStorageService.prototype.deleteObject = oldDelete;
    if (courseA) await db.delete(coursesTable).where(eq(coursesTable.id, courseA.id));
    if (courseB) await db.delete(coursesTable).where(eq(coursesTable.id, courseB.id));
    if (courseC) await db.delete(coursesTable).where(eq(coursesTable.id, courseC.id));
    if (createdCourse) await db.delete(coursesTable).where(eq(coursesTable.id, createdCourse.id));
    if (unlicensedCourse) await db.delete(coursesTable).where(eq(coursesTable.id, unlicensedCourse.id));
    if (unboundCourse) await db.delete(coursesTable).where(eq(coursesTable.id, unboundCourse.id));
    await db.delete(classscribeEduLicenseGrantsTable)
      .where(inArray(classscribeEduLicenseGrantsTable.userId, [owner, otherOwner, otherSchoolOwner]));
    await db.delete(classscribeEduInstitutionAgreementsTable).where(inArray(
      classscribeEduInstitutionAgreementsTable.signedAgreementRef,
      ["fixture:shared-institution-agreement", "fixture:other-school-agreement"],
    ));
    await db.delete(classscribeEduClientLicensesTable)
      .where(inArray(classscribeEduClientLicensesTable.licenseNumber, [licenseNumber, secondLicenseNumber]));
    await db.delete(classscribeEduClientFailedAttemptsTable).where(inArray(
      classscribeEduClientFailedAttemptsTable.scopeHash,
      [
        fingerprintEduRateLimitScope(`account:${pinAttacker}:${licenseNumber}`),
        fingerprintEduRateLimitScope("ip:198.51.100.47"),
      ],
    ));
    if (noteIds.length) await db.delete(notesTable).where(and(eq(notesTable.userId, student), eq(notesTable.id, noteIds[0])));
    server.close();
    await pool.end();
  }
});