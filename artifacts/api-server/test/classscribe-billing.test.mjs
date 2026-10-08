import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray, like } from "drizzle-orm";
import {
  classscribeLegacyDocumentsTable,
  courseMembersTable,
  coursesTable,
  db,
  lecturesTable,
  pool,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import classscribeRouter from "../src/routes/classscribe.ts";
import libraryLinkRouter from "../src/routes/library-link.ts";
import {
  freeBillingIdentityForOwner,
  getLibraryBillingStatus,
  reserveRecordingUsage,
} from "../src/lib/classscribe-billing.ts";
import { setFailTranscription, transcriptionCalls } from "./fixtures/modern-transcription-ai.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

function oneSecondWav() {
  const sampleRate = 8_000;
  const dataSize = sampleRate;
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + dataSize, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(dataSize, 40);
  return bytes.toString("base64");
}

test("modern course creation and transcription enforce linked plans and safe Free fallback", async () => {
  const freeOwner = `clerk_free_${randomUUID()}`;
  const paidOwner = `clerk_paid_${randomUUID()}`;
  const paidCode = `u_${randomUUID().replaceAll("-", "")}`;
  const freeCode = freeBillingIdentityForOwner(freeOwner);
  const paidFallbackCode = freeBillingIdentityForOwner(paidOwner);
  const paidLibraryHash = hash(paidCode);
  const paidPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const freeUsagePrefix = `private/classscribe-billing/usage/${hash(freeCode)}/%`;
  const paidFallbackUsagePrefix = `private/classscribe-billing/usage/${hash(paidFallbackCode)}/%`;
  const paidUsagePrefix = `private/classscribe-billing/usage/${paidLibraryHash}/%`;
  const profilePath = `data/users/${paidCode}/profile`;
  const accountPath = `private/classscribe-billing/accounts/${paidLibraryHash}`;
  const accountMappingPath = `private/library-links/accounts/${hash(paidOwner)}`;
  const ownerMappingPath = `private/library-links/owners/${hash(paidCode)}`;
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "modern-billing-route-test-secret";
  const previousCallCount = transcriptionCalls.length;
  setFailTranscription(false);
  const routeErrors = [];

  const makeOwnerData = async (ownerId, prefix) => {
    const courses = await db.insert(coursesTable).values(
      [0, 1, 2].map((index) => ({
        name: `${prefix} course ${index + 1}`,
        subject: "TEST",
        term: "Test",
        color: "#000000",
        inviteCode: `${prefix}-${randomUUID()}`,
        ownerId,
      })),
    ).returning();
    await db.insert(courseMembersTable).values(courses.map((course) => ({
      courseId: course.id,
      userId: ownerId,
    })));
    const [lecture] = await db.insert(lecturesTable).values({
      courseId: courses[0].id,
      createdBy: ownerId,
      title: `${prefix} lecture`,
      professor: "Test",
      lectureDate: new Date(),
    }).returning();
    const [failureLecture] = await db.insert(lecturesTable).values({
      courseId: courses[0].id,
      createdBy: ownerId,
      title: `${prefix} failure lecture`,
      professor: "Test",
      lectureDate: new Date(),
    }).returning();
    return { courses, lecture, failureLecture };
  };

  const app = express();
  app.use(express.json({ limit: "40mb" }));
  app.use((req, _res, next) => {
    req.log = {
      warn() {},
      error(...args) { routeErrors.push(args); },
    };
    next();
  });
  app.use("/api", (req, res, next) => {
    if (!getAuth(req).userId) return res.status(401).json({ error: "Unauthorized" });
    next();
  });
  app.use("/api", libraryLinkRouter);
  app.use("/api", classscribeRouter);
  const server = app.listen(0, "127.0.0.1");
  const listening = new Promise((resolve) => server.once("listening", resolve));
  let freeData;
  let paidData;
  let usageAfterSuccess;

  try {
    freeData = await makeOwnerData(freeOwner, "free");
    paidData = await makeOwnerData(paidOwner, "paid");
    await db.insert(classscribeLegacyDocumentsTable).values([
      { path: profilePath, data: { name: "Paid test library" } },
      {
        path: accountPath,
        data: {
          libraryHash: paidLibraryHash,
          billingAccountId: randomUUID(),
          plan: "pro",
          status: "active",
          periodEnd: paidPeriodEnd,
        },
      },
    ]);
    await reserveRecordingUsage(freeCode, 5 * 60 * 60);
    await reserveRecordingUsage(paidFallbackCode, 60);
    await listening;

    const base = `http://127.0.0.1:${server.address().port}/api`;
    const headers = (ownerId) => ({
      "Content-Type": "application/json",
      "x-test-user": ownerId,
    });
    const freeCourse = await fetch(`${base}/courses`, {
      method: "POST",
      headers: headers(freeOwner),
      body: JSON.stringify({
        name: "Attempted Free fourth course",
        subject: "TEST",
        term: "Test",
        color: "#000000",
        plan: "pro",
      }),
    });
    assert.equal(freeCourse.status, 402);
    assert.equal((await freeCourse.json()).code, "plan_limit");

    const link = await fetch(`${base}/library-link`, {
      method: "POST",
      headers: headers(paidOwner),
      body: JSON.stringify({ code: paidCode }),
    });
    assert.equal(link.status, 200);
    delete process.env.SESSION_SECRET;
    const unreadableLinkCourse = await fetch(`${base}/courses`, {
      method: "POST",
      headers: headers(paidOwner),
      body: JSON.stringify({
        name: "Unverified paid course",
        subject: "TEST",
        term: "Test",
        color: "#000000",
      }),
    });
    assert.equal(unreadableLinkCourse.status, 402);
    process.env.SESSION_SECRET = "modern-billing-route-test-secret";
    const paidCourse = await fetch(`${base}/courses`, {
      method: "POST",
      headers: headers(paidOwner),
      body: JSON.stringify({
        name: "Paid fourth course",
        subject: "TEST",
        term: "Test",
        color: "#000000",
      }),
    });
    assert.equal(paidCourse.status, 201);

    const wav = oneSecondWav();
    const transcribe = (ownerId, lectureId) => fetch(`${base}/lectures/${lectureId}/transcribe`, {
      method: "POST",
      headers: headers(ownerId),
      body: JSON.stringify({
        audioBase64: wav,
        fileName: "lecture.wav",
        mimeType: "audio/wav",
      }),
    });
    const freeTranscription = await transcribe(freeOwner, freeData.lecture.id);
    assert.equal(freeTranscription.status, 402);
    assert.equal((await freeTranscription.json()).code, "plan_limit");
    assert.equal(transcriptionCalls.length, previousCallCount);

    const paidTranscription = await transcribe(paidOwner, paidData.lecture.id);
    assert.equal(paidTranscription.status, 200);
    assert.deepEqual(await paidTranscription.json(), {
      transcript: "A verified mock transcript.",
    });
    assert.equal(transcriptionCalls.length, previousCallCount + 1);
    assert.equal((await getLibraryBillingStatus(paidCode)).transcriptionCountUsed, 1);
    const [linkedUsage] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(like(classscribeLegacyDocumentsTable.path, paidUsagePrefix))
      .limit(1);
    usageAfterSuccess = Number(linkedUsage.data.seconds);
    assert.ok(usageAfterSuccess > 60 && usageAfterSuccess <= 62);
    const [migratedFreeUsage] = await db.select({ path: classscribeLegacyDocumentsTable.path })
      .from(classscribeLegacyDocumentsTable)
      .where(like(classscribeLegacyDocumentsTable.path, paidFallbackUsagePrefix))
      .limit(1);
    assert.equal(migratedFreeUsage, undefined);

    setFailTranscription(true);
    const failedTranscription = await transcribe(paidOwner, paidData.failureLecture.id);
    assert.equal(failedTranscription.status, 503);
    assert.equal(routeErrors.length, 1, JSON.stringify(routeErrors));
    const [usageAfterFailure] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(like(classscribeLegacyDocumentsTable.path, paidUsagePrefix))
      .limit(1);
    assert.equal(Number(usageAfterFailure.data.seconds), usageAfterSuccess);
    assert.equal((await getLibraryBillingStatus(paidCode)).transcriptionCountUsed, 1);
    assert.equal(transcriptionCalls.length, previousCallCount + 2);

    setFailTranscription(false);
    for (let index = 0; index < 59; index += 1) {
      const repeatedLectureTranscription = await transcribe(paidOwner, paidData.lecture.id);
      assert.equal(repeatedLectureTranscription.status, 200);
    }
    const atCapStatus = await getLibraryBillingStatus(paidCode);
    assert.equal(atCapStatus.transcriptionCountUsed, 60);
    const callsAtCap = transcriptionCalls.length;
    const overCapRepeatedLecture = await transcribe(paidOwner, paidData.lecture.id);
    assert.equal(overCapRepeatedLecture.status, 402);
    assert.equal((await overCapRepeatedLecture.json()).code, "plan_limit");
    assert.equal(transcriptionCalls.length, callsAtCap);
  } finally {
    setFailTranscription(false);
    server.close();
    if (freeData) {
      await db.delete(coursesTable).where(inArray(coursesTable.id, freeData.courses.map((course) => course.id)));
    }
    if (paidData) {
      await db.delete(coursesTable).where(inArray(coursesTable.id, paidData.courses.map((course) => course.id)));
    }
    const paths = [profilePath, accountPath, accountMappingPath, ownerMappingPath];
    for (const path of paths) {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, path));
    }
    for (const path of [freeUsagePrefix, paidFallbackUsagePrefix, paidUsagePrefix]) {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(like(classscribeLegacyDocumentsTable.path, path));
    }
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    await pool.end();
  }
});