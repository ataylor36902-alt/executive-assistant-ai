import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db, coursesTable, courseMembersTable, classscribeEduLicenseGrantsTable, classscribeEduClientLicensesTable,
  classscribeEduClientSessionsTable, classscribeEduCourseLicenseBindingsTable,
  classscribePrivacyDeletionOutboxTable, pool,
} from "@workspace/db";
import {
  eduLecturesTable,
} from "../../../lib/db/src/schema/classscribe-edu-media.ts";
import { pauseNextTranscription, setFailTranscription } from "./fixtures/edu-managed-transcription.mjs";
import { setFailDelete, storedObjectKeys } from "./fixtures/edu-object-storage.mjs";
import eduMediaRouter from "../src/routes/classscribe-edu-media.ts";
import { processPrivacyDeletionOutboxItem } from "../src/lib/privacy-deletion.ts";
import { getAuth } from "@clerk/express";
import { requireEduCredential, requireEduCourseAgreement } from "../src/routes/classscribe-edu.ts";

test("EDU media is course/group scoped; private uploads and retries stay authorized", async () => {
  const owner = `edu-media-owner-${randomUUID()}`;
  const otherOwner = `edu-media-other-${randomUUID()}`;
  const member = `edu-media-member-${randomUUID()}`;
  const removedMember = `edu-media-removed-${randomUUID()}`;
  const outsider = `edu-media-outsider-${randomUUID()}`;
  const otherAgreementOwner = `edu-media-other-agreement-owner-${randomUUID()}`;
  const foreignAgreementMember = `edu-media-foreign-member-${randomUUID()}`;
  const agreementA = "test:edu-media";
  const agreementB = "test:edu-media-other";
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => { req.log = { error() {}, warn() {} }; next(); });
  app.use("/api", (req, res, next) => getAuth(req).userId ? next() : res.status(401).end());
  app.use("/api/edu", requireEduCredential);
  app.use("/api/edu/courses/:id", requireEduCourseAgreement);
  app.use("/api", eduMediaRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/edu`;
  const request = async (path, user, method = "GET", body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "x-test-user": user, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : response.headers.get("content-type")?.includes("json")
        ? await response.json() : await response.text(),
    };
  };
  let course;
  let otherCourse;
  let lectureId;
  let sourceId;
  const clientLicenseIds = [];
  try {
    await db.insert(classscribeEduLicenseGrantsTable).values([
      { userId: owner, signedAgreementRef: agreementA, approvedAt: new Date(Date.now() - 1000), expiresAt },
      { userId: otherOwner, signedAgreementRef: agreementA, approvedAt: new Date(Date.now() - 1000), expiresAt },
      { userId: otherAgreementOwner, signedAgreementRef: agreementB, approvedAt: new Date(Date.now() - 1000), expiresAt },
    ]);
    const [licenseA] = await db.insert(classscribeEduClientLicensesTable).values({
      ownerUserId: owner,
      licenseNumber: `EDU-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`,
      signedAgreementRef: agreementA,
      pinHash: "test-only-pin-hash",
      expiresAt,
    }).returning();
    const [licenseB] = await db.insert(classscribeEduClientLicensesTable).values({
      ownerUserId: otherAgreementOwner,
      licenseNumber: `EDU-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`,
      signedAgreementRef: agreementB,
      pinHash: "test-only-pin-hash",
      expiresAt,
    }).returning();
    clientLicenseIds.push(licenseA.id, licenseB.id);
    await db.insert(classscribeEduClientSessionsTable).values([
      ...[owner, otherOwner, member, removedMember, outsider].map(userId => ({
        licenseId: licenseA.id, userId, clerkSessionId: `sess_${userId}`,
        signedAgreementRef: agreementA, expiresAt,
      })),
      {
        licenseId: licenseB.id, userId: foreignAgreementMember,
        clerkSessionId: `sess_${foreignAgreementMember}`, signedAgreementRef: agreementB, expiresAt,
      },
    ]);
    [course] = await db.insert(coursesTable).values({
      name: "Media course", subject: "BIO", term: "Fall", color: "#000000",
      inviteCode: randomUUID(), ownerId: owner, eduEnabled: true,
    }).returning();
    [otherCourse] = await db.insert(coursesTable).values({
      name: "Other media course", subject: "CHEM", term: "Fall", color: "#000000",
      inviteCode: randomUUID(), ownerId: otherOwner, eduEnabled: true,
    }).returning();
    await db.insert(classscribeEduCourseLicenseBindingsTable).values([
      { courseId: course.id, signedAgreementRef: agreementA },
      { courseId: otherCourse.id, signedAgreementRef: agreementA },
    ]);
    await db.insert(courseMembersTable).values([
      { courseId: course.id, userId: member },
      { courseId: course.id, userId: removedMember },
      { courseId: course.id, userId: foreignAgreementMember },
      { courseId: otherCourse.id, userId: member },
    ]);
    const groupResponse = await request(`/courses/${course.id}/groups`, owner, "POST", { name: "Lab group" });
    assert.equal(groupResponse.status, 201);
    const groupId = groupResponse.body.group.id;
    const secondGroup = (await request(`/courses/${course.id}/groups`, owner, "POST", { name: "Seminar group" })).body.group;
    const otherGroup = (await request(`/courses/${otherCourse.id}/groups`, otherOwner, "POST", { name: "Other group" })).body.group;
    assert.equal((await request(`/courses/${course.id}/groups/${groupId}/members`, owner, "PUT", {
      memberIds: [member],
    })).status, 200);
    assert.equal((await request(`/courses/${course.id}/groups/${secondGroup.id}/members`, owner, "PUT", {
      memberIds: [removedMember],
    })).status, 200);
    const instructorGroups = await request(`/courses/${course.id}/groups`, owner);
    assert.deepEqual(instructorGroups.body.groups.find(group => group.id === groupId).memberIds, [member]);
    assert.deepEqual(instructorGroups.body.groups.find(group => group.id === secondGroup.id).memberIds, [removedMember]);
    const studentGroups = await request(`/courses/${course.id}/groups`, member);
    assert.equal(studentGroups.body.groups.length, 1);
    assert.deepEqual(studentGroups.body.groups[0].memberIds, [member]);
    assert.equal(studentGroups.body.groups[0].id, groupId);
    assert.equal((await request(`/courses/${course.id}/groups`, foreignAgreementMember)).status, 404);
    assert.equal((await request(`/courses/${course.id}/lectures`, foreignAgreementMember)).status, 404);

    const draft = await request(`/courses/${course.id}/lectures`, owner, "POST", { title: "Cell membranes" });
    assert.equal(draft.status, 201);
    lectureId = draft.body.lecture.id;
    const invalidCrossCourseShare = await request(`/courses/${course.id}/lectures/${lectureId}/share`, owner, "POST", {
      groupIds: [otherGroup.id],
    });
    assert.equal(invalidCrossCourseShare.status, 400);

    const originalBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const originalApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://managed-provider.test";
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-only-not-a-real-key";
    const audioBytes = Buffer.alloc(24);
    audioBytes.write("ftyp", 4, "ascii");
    const audio = { audio: audioBytes.toString("base64"), mime: "audio/mp4", filename: "lecture.m4a" };
    let replacementAudioBytes = audioBytes;
    try {
      setFailDelete(true);
      setFailTranscription(true);
      const failed = await request(`/courses/${course.id}/lectures/${lectureId}/transcribe`, owner, "POST", audio);
      assert.equal(failed.status, 503);
      assert.equal(failed.body.cleanupPending, true);
      const pendingAudioCleanup = (await db.select().from(classscribePrivacyDeletionOutboxTable))
        .find(row => row.pendingProviders.some(provider =>
          provider.startsWith(`storage:edu-media/${course.id}/lectures/${lectureId}/`)));
      assert.ok(pendingAudioCleanup);
      const queuedKey = pendingAudioCleanup.pendingProviders[0].slice("storage:".length);
      assert.match(queuedKey, new RegExp(`^edu-media/${course.id}/lectures/${lectureId}/[0-9a-f-]+$`, "i"));
      assert.deepEqual(
        storedObjectKeys().filter(key => key.startsWith(`edu-media/${course.id}/lectures/${lectureId}/`)),
        [queuedKey],
      );
      assert.equal((await db.select({
        status: eduLecturesTable.transcriptionStatus, audioObjectKey: eduLecturesTable.audioObjectKey,
      }).from(eduLecturesTable)
        .where(eq(eduLecturesTable.id, lectureId)))[0].status, "failed");
      assert.equal((await db.select({ audioObjectKey: eduLecturesTable.audioObjectKey }).from(eduLecturesTable)
        .where(eq(eduLecturesTable.id, lectureId)))[0].audioObjectKey, null);
      setFailDelete(false);
      assert.equal(await processPrivacyDeletionOutboxItem(pendingAudioCleanup), false);
      assert.equal(storedObjectKeys().includes(queuedKey), false);
      assert.equal((await db.select().from(classscribePrivacyDeletionOutboxTable))
        .some(row => row.id === pendingAudioCleanup.id), false);
      setFailTranscription(false);
      const retried = await request(`/courses/${course.id}/lectures/${lectureId}/transcribe`, owner, "POST", audio);
      assert.equal(retried.status, 200);
      assert.equal(retried.body.lecture.transcript, "A verified mock transcript.");
      assert.equal(Object.hasOwn(retried.body.lecture, "audioObjectKey"), false);
      assert.deepEqual(storedObjectKeys().filter(key => key.startsWith(`edu-media/${course.id}/lectures/${lectureId}/`)), []);
      assert.equal((await request(`/courses/${course.id}/lectures/${lectureId}/audio`, owner)).status, 404);

      const otherDraft = await request(`/courses/${otherCourse.id}/lectures`, otherOwner, "POST", {
        title: "License revocation during transcription",
      });
      const otherLectureId = otherDraft.body.lecture.id;
      const transcriptionGate = pauseNextTranscription();
      const pendingTranscription = request(
        `/courses/${otherCourse.id}/lectures/${otherLectureId}/transcribe`, otherOwner, "POST", audio,
      );
      await transcriptionGate.started;
      await db.delete(classscribeEduLicenseGrantsTable)
        .where(eq(classscribeEduLicenseGrantsTable.userId, otherOwner));
      transcriptionGate.release();
      const revokedResponse = await pendingTranscription;
      assert.equal(revokedResponse.status, 403);
      let revokedLecture;
      for (let attempt = 0; attempt < 20; attempt++) {
        [revokedLecture] = await db.select({
          status: eduLecturesTable.transcriptionStatus, transcript: eduLecturesTable.transcript,
        }).from(eduLecturesTable).where(eq(eduLecturesTable.id, otherLectureId));
        if (revokedLecture.status === "failed") break;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.equal(revokedLecture.status, "failed");
      assert.equal(revokedLecture.transcript, null);
      await db.insert(classscribeEduLicenseGrantsTable).values({
        userId: otherOwner, signedAgreementRef: agreementB,
        approvedAt: new Date(Date.now() - 1000), expiresAt,
      });
      await db.update(classscribeEduClientSessionsTable).set({
        licenseId: licenseB.id,
        signedAgreementRef: agreementB,
        expiresAt,
      }).where(eq(classscribeEduClientSessionsTable.userId, otherOwner));
      assert.equal((await request(`/courses/${otherCourse.id}/groups`, otherOwner)).status, 404);

      replacementAudioBytes = Buffer.from(audioBytes);
      replacementAudioBytes[12] = 7;
      const replacementAudio = { ...audio, audio: replacementAudioBytes.toString("base64"), filename: "replacement.m4a" };
      setFailTranscription(true);
      const failedReplacement = await request(
        `/courses/${course.id}/lectures/${lectureId}/transcribe`, owner, "POST", replacementAudio,
      );
      assert.equal(failedReplacement.status, 503);
      const failedLecture = (await db.select({
        status: eduLecturesTable.transcriptionStatus, transcript: eduLecturesTable.transcript,
      }).from(eduLecturesTable).where(eq(eduLecturesTable.id, lectureId)))[0];
      assert.equal(failedLecture.status, "failed");
      assert.equal(failedLecture.transcript, null);
      assert.equal((await db.select({ audioObjectKey: eduLecturesTable.audioObjectKey }).from(eduLecturesTable)
        .where(eq(eduLecturesTable.id, lectureId)))[0].audioObjectKey, null);
      assert.deepEqual(storedObjectKeys().filter(key => key.startsWith(`edu-media/${course.id}/lectures/${lectureId}/`)), []);
      setFailTranscription(false);
      const replacementRetry = await request(
        `/courses/${course.id}/lectures/${lectureId}/transcribe`, owner, "POST", replacementAudio,
      );
      assert.equal(replacementRetry.status, 200);
      assert.equal(replacementRetry.body.lecture.transcript, "A verified mock transcript.");
      const tooLargeAudio = Buffer.alloc(21 * 1024 * 1024).toString("base64");
      assert.equal((await request(`/courses/${course.id}/lectures/${lectureId}/transcribe`, owner, "POST", {
        audio: tooLargeAudio, mime: "audio/mp4", filename: "too-large.m4a",
      })).status, 413);
    } finally {
      setFailTranscription(false);
      setFailDelete(false);
      if (originalBaseUrl === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = originalBaseUrl;
      if (originalApiKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = originalApiKey;
    }

    const pdf = Buffer.from("%PDF-1.4\nTest PDF");
    const privateUpload = await request(`/courses/${course.id}/sources/uploads`, owner, "POST", {
      title: "Private instructor file", filename: "private.pdf", mime: "application/pdf",
      data: pdf.toString("base64"),
    });
    assert.equal(privateUpload.status, 201);
    assert.equal(privateUpload.body.source.visibility, "private");
    assert.deepEqual(privateUpload.body.source.groupIds, []);
    const classUpload = await request(`/courses/${course.id}/sources/uploads`, owner, "POST", {
      title: "Whole class handout", filename: "class.pdf", mime: "application/pdf",
      data: pdf.toString("base64"), visibility: "class",
    });
    assert.equal(classUpload.status, 201);
    assert.equal(classUpload.body.source.visibility, "class");
    const invalidImplicitClass = await request(`/courses/${course.id}/sources/links`, owner, "POST", {
      title: "Ambiguous link", url: "https://example.edu/resource", groupIds: [],
    });
    assert.equal(invalidImplicitClass.status, 400);
    const privateLink = await request(`/courses/${course.id}/sources/links`, owner, "POST", {
      title: "Private instructor link", url: "https://example.edu/private",
    });
    assert.equal(privateLink.status, 201);
    assert.equal(privateLink.body.source.visibility, "private");
    const classLink = await request(`/courses/${course.id}/sources/links`, owner, "POST", {
      title: "Class reading", url: "https://example.edu/reading", visibility: "class",
    });
    assert.equal(classLink.status, 201);
    assert.equal(classLink.body.source.visibility, "class");
    const uploaded = await request(`/courses/${course.id}/sources/uploads`, owner, "POST", {
      title: "Lab handout", filename: "handout.pdf", mime: "application/pdf",
      data: pdf.toString("base64"), visibility: "groups", groupIds: [groupId],
    });
    assert.equal(uploaded.status, 201);
    sourceId = uploaded.body.source.id;
    assert.equal(Object.hasOwn(uploaded.body.source, "objectKey"), false);
    assert.deepEqual(uploaded.body.source.groupIds, [groupId]);
    assert.equal((await request(`/courses/${course.id}/sources/${privateUpload.body.source.id}/download`, member)).status, 404);
    assert.equal((await request(`/courses/${course.id}/sources/${privateUpload.body.source.id}/download`, removedMember)).status, 404);
    assert.equal((await request(`/courses/${course.id}/sources/${classUpload.body.source.id}/download`, member)).body, pdf.toString());
    assert.equal((await request(`/courses/${course.id}/sources/${sourceId}/download`, removedMember)).status, 404);
    assert.equal((await request(`/courses/${course.id}/sources/${sourceId}/download`, outsider)).status, 404);
    assert.equal((await request(`/courses/${course.id}/sources/${sourceId}/download`, member)).body, pdf.toString());

    assert.equal((await request(`/courses/${course.id}/lectures/${lectureId}/share`, owner, "POST", {
      groupIds: [groupId, secondGroup.id],
    })).status, 200);
    const ownerLecture = (await request(`/courses/${course.id}/lectures`, owner)).body.lectures[0];
    assert.deepEqual([...ownerLecture.groupIds].sort(), [groupId, secondGroup.id].sort());
    const memberLecture = (await request(`/courses/${course.id}/lectures`, member)).body.lectures[0];
    assert.deepEqual(memberLecture.groupIds, [groupId]);
    const secondGroupLecture = (await request(`/courses/${course.id}/lectures`, removedMember)).body.lectures[0];
    assert.deepEqual(secondGroupLecture.groupIds, [secondGroup.id]);
    assert.equal((await request(`/courses/${otherCourse.id}/lectures`, member)).status, 404);
    assert.equal((await request(`/courses/${course.id}/lectures`, outsider)).status, 404);
    const memberSources = (await request(`/courses/${course.id}/sources`, member)).body.sources;
    assert.deepEqual(memberSources.map(source => source.visibility).sort(), ["class", "class", "groups"]);
    assert.deepEqual(memberSources.find(source => source.id === sourceId).groupIds, [groupId]);
    assert.equal(memberSources.some(source => source.id === privateLink.body.source.id), false);
    const secondGroupSources = (await request(`/courses/${course.id}/sources`, removedMember)).body.sources;
    assert.deepEqual(secondGroupSources.map(source => source.visibility).sort(), ["class", "class"]);
    assert.equal((await request(`/courses/${course.id}/lectures/${lectureId}/audio`, member)).status, 404);

    await request(`/courses/${course.id}/groups/${groupId}/members`, owner, "PUT", { memberIds: [removedMember] });
    const groupsAfterRosterRemoval = await request(`/courses/${course.id}/groups`, member);
    assert.equal(groupsAfterRosterRemoval.body.groups.length, 0);
    const groupsForNewMember = await request(`/courses/${course.id}/groups`, removedMember);
    assert.deepEqual(groupsForNewMember.body.groups.map(group => group.id).sort(), [secondGroup.id, groupId].sort());
    assert.deepEqual(groupsForNewMember.body.groups.map(group => group.memberIds), [[removedMember], [removedMember]]);
    assert.equal((await request(`/courses/${course.id}/lectures`, member)).body.lectures.length, 0);
    assert.equal((await request(`/courses/${course.id}/sources`, member)).body.sources.length, 2);
    assert.equal((await request(`/courses/${course.id}/sources/${sourceId}/download`, member)).status, 404);
    assert.equal((await request(`/courses/${course.id}/sources/${sourceId}/download`, removedMember)).body, pdf.toString());
    const groupsForLectureAfterRemoval = (await request(`/courses/${course.id}/lectures`, removedMember)).body.lectures[0].groupIds;
    assert.deepEqual([...groupsForLectureAfterRemoval].sort(), [groupId, secondGroup.id].sort());
    assert.equal((await request(`/courses/${course.id}/lectures/${lectureId}/audio`, member)).status, 404);
    assert.equal((await request(`/courses/${course.id}/sources/${sourceId}/download`, member)).status, 404);
    await request(`/courses/${course.id}/lectures/${lectureId}/share`, owner, "POST", { groupIds: [] });
    assert.equal((await request(`/courses/${course.id}/lectures`, removedMember)).body.lectures.length, 0);
    assert.equal((await request(`/courses/${course.id}/lectures/${lectureId}/audio`, removedMember)).status, 404);
  } finally {
    await server.close();
    if (course) await db.delete(coursesTable).where(eq(coursesTable.id, course.id));
    if (otherCourse) await db.delete(coursesTable).where(eq(coursesTable.id, otherCourse.id));
    await db.delete(classscribeEduLicenseGrantsTable).where(eq(classscribeEduLicenseGrantsTable.userId, owner));
    await db.delete(classscribeEduLicenseGrantsTable).where(eq(classscribeEduLicenseGrantsTable.userId, otherOwner));
    await db.delete(classscribeEduLicenseGrantsTable).where(eq(classscribeEduLicenseGrantsTable.userId, otherAgreementOwner));
    if (clientLicenseIds.length) {
      await db.delete(classscribeEduClientLicensesTable)
        .where(inArray(classscribeEduClientLicensesTable.id, clientLicenseIds));
    }
    await pool.end();
  }
});