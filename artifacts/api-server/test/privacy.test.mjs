import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { inflateRawSync } from "node:zlib";
import privacyRouter from "../src/routes/privacy.ts";
import privacyConsentsRouter from "../src/routes/privacy-consents.ts";
import { processPrivacyDeletionOutboxItem } from "../src/lib/privacy-deletion.ts";
import { privacyConsentConfig } from "../src/lib/privacy-config.ts";
import { runPrivacyRetentionJob } from "../src/jobs/privacy-retention.ts";
import {
  classscribeCreditProviderIntentsTable,
  classscribeCreditSubscriptionPaymentRevocationsTable,
  classscribeCreditSubscriptionPeriodsTable,
  classscribeCreditTransactionsTable,
  classscribeLegacyDocumentsTable,
  classscribePrivacyDeletionOutboxTable,
  classscribePrivacyProfilesTable,
  classscribePrivacyTombstonesTable,
  eduCourseFileCleanupTable,
  coursesTable, eduMaterialsTable, eduAssignmentsTable,
  classscribePrivacyRetentionWarningsTable, isCourseCleanupGuardInstalled,
  readPrivacyTestRows,
  resetPrivacyTestDb,
  seedPrivacyTestRows,
} from "./fixtures/privacy-db.mjs";
import { deletedPrivacyTestUsers, resetPrivacyTestClerk, setPrivacyRetentionTestUsers } from "./fixtures/privacy-auth.mjs";
import { setPrivacyProviderAppUserId } from "./fixtures/privacy-billing.mjs";
import { readPrivacyConnectorRequests, setPrivacyConnectorResponses } from "./fixtures/privacy-connectors.mjs";

let server;
let baseUrl;
before(async () => {
  delete process.env.REVENUECAT_PROJECT_ID;
  resetPrivacyTestDb();
  resetPrivacyTestClerk();
  const app = express();
  app.use(express.json());
  app.use(privacyRouter);
  app.use(privacyConsentsRouter);
  server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test("privacy config is public and returns consent terms and retention", async () => {
  const response = await fetch(`${baseUrl}/privacy/config`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.consent.version, "2025-01");
  assert.equal(body.consent.statements.length, 2);
  assert.ok(body.retention.backups.includes("owner must verify"));
});

test("account deletion stays pending until course file cleanup finishes, including blocked keys", async () => {
  const courseId = "00000000-0000-0000-0000-000000000118";
  const item = {
    id: "course-files-outbox", libraryHash: "course-files-fixture", userId: null,
    providerAppUserId: null, providerProjectId: null, attempts: "0",
    pendingProviders: [`edu-course-files:${courseId}`],
  };
  seedPrivacyTestRows(classscribePrivacyDeletionOutboxTable, [item]);
  seedPrivacyTestRows(eduCourseFileCleanupTable, [{ id: "blocked-fixture", courseId, blocked: true }]);
  assert.equal(await processPrivacyDeletionOutboxItem(item), true);
  const [pending] = readPrivacyTestRows(classscribePrivacyDeletionOutboxTable);
  assert.equal(pending.lastErrorCode, "edu_course_files_pending");
  assert.deepEqual(pending.pendingProviders, item.pendingProviders);
  seedPrivacyTestRows(eduCourseFileCleanupTable, []);
  assert.equal(await processPrivacyDeletionOutboxItem(pending), false);
  assert.equal(readPrivacyTestRows(classscribePrivacyDeletionOutboxTable).length, 0);
});

test("standalone retention installs course inventory guard without prior API startup", async () => {
  resetPrivacyTestDb();
  resetPrivacyTestClerk();
  const now = new Date("2030-01-01T00:00:00Z");
  const userId = "retention-course-fixture";
  const courseId = "00000000-0000-0000-0000-000000000119";
  const libraryCode = `u_${Buffer.from(`classscribe-free:${userId}`).toString("hex").slice(0, 32)}`;
  const libraryHash = createHash("sha256").update(libraryCode).digest("hex");
  const key = `edu-files/${courseId}/materials/00000000-0000-0000-0000-000000000120`;
  seedPrivacyTestRows(coursesTable, [{ id: courseId, ownerId: userId, eduEnabled: true }]);
  seedPrivacyTestRows(eduMaterialsTable, [{ courseId, fileKey: key }]);
  seedPrivacyTestRows(eduAssignmentsTable, [{ courseId, fileKey: key }, { courseId, fileKey: null }]);
  seedPrivacyTestRows(classscribePrivacyRetentionWarningsTable, [{
    userId, libraryHash, warningSentAt: new Date("2029-11-01"), scheduledDeleteAt: new Date("2029-12-01"),
  }]);
  setPrivacyRetentionTestUsers([{ id: userId, lastSignInAt: new Date("2027-12-01").getTime() }]);
  const oldEnabled = process.env.PRIVACY_RETENTION_JOB_ENABLED;
  const oldApply = process.env.PRIVACY_RETENTION_APPLY;
  process.env.PRIVACY_RETENTION_JOB_ENABLED = "true";
  process.env.PRIVACY_RETENTION_APPLY = "true";
  try {
    assert.equal(isCourseCleanupGuardInstalled(), false);
    const result = await runPrivacyRetentionJob(now);
    assert.equal(result.deleted, 1);
    assert.equal(isCourseCleanupGuardInstalled(), true);
    assert.equal(readPrivacyTestRows(coursesTable).length, 0);
    assert.equal(readPrivacyTestRows(eduMaterialsTable).length, 0);
    const inventory = readPrivacyTestRows(eduCourseFileCleanupTable);
    assert.equal(inventory.length, 1);
    assert.equal(inventory[0].fileKey, key);
    assert.ok(readPrivacyTestRows(classscribePrivacyDeletionOutboxTable)[0].pendingProviders.includes(`edu-course-files:${courseId}`));
  } finally {
    if (oldEnabled === undefined) delete process.env.PRIVACY_RETENTION_JOB_ENABLED;
    else process.env.PRIVACY_RETENTION_JOB_ENABLED = oldEnabled;
    if (oldApply === undefined) delete process.env.PRIVACY_RETENTION_APPLY;
    else process.env.PRIVACY_RETENTION_APPLY = oldApply;
    resetPrivacyTestDb();
    resetPrivacyTestClerk();
  }
});

test("delete requires a fresh Clerk first-factor claim and does not call Clerk otherwise", async () => {
  const response = await fetch(`${baseUrl}/privacy/delete`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": "stale-test-account", "x-test-fva": "11" },
    body: JSON.stringify({ confirmation: "DELETE", confirmActiveSubscription: false }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(deletedPrivacyTestUsers(), []);
});

test("age endpoint accepts only an age band and stores minor privacy defaults without DOB", async () => {
  const headers = { "content-type": "application/json", "x-test-user": "age-band-test" };
  const invalid = await fetch(`${baseUrl}/privacy/age`, {
    method: "POST", headers, body: JSON.stringify({ birthDate: "2008-06-01" }),
  });
  assert.equal(invalid.status, 400);

  const saved = await fetch(`${baseUrl}/privacy/age`, {
    method: "POST", headers, body: JSON.stringify({ ageBand: "13-17" }),
  });
  assert.equal(saved.status, 200);
  const [profile] = readPrivacyTestRows(classscribePrivacyProfilesTable);
  assert.equal(profile.ageBand, "13-17");
  assert.deepEqual(profile.defaults, {
    sharing: "off", publicProfiles: "off", schoolLevel: "HighSchool", discussionName: "firstName",
  });
  assert.equal("birthDate" in profile, false);
});

test("signed-in privacy writes reject an X-CS-User code that is not the resolved linked library", async () => {
  const response = await fetch(`${baseUrl}/privacy/age`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": "owned-library-test", "x-cs-user": "u_unrelatedlibrarycode1234" },
    body: JSON.stringify({ ageBand: "18+" }),
  });
  assert.equal(response.status, 403);
});

test("private ZIP is rate limited, downloadable, and revoked after isolated deletion", async () => {
  const headers = { "content-type": "application/json", "x-test-user": "disposable-privacy-test", "x-test-fva": "0" };
  const created = await fetch(`${baseUrl}/privacy/export`, { method: "POST", headers, body: "{}" });
  assert.equal(created.status, 201);
  const { url, expiresAt } = await created.json();
  assert.ok(url.startsWith("/api/privacy/export/download/"));
  assert.ok(new Date(expiresAt).getTime() > Date.now());

  const rateLimited = await fetch(`${baseUrl}/privacy/export`, { method: "POST", headers, body: "{}" });
  assert.equal(rateLimited.status, 429, await rateLimited.text());

  const download = await fetch(new URL(url.replace("/api", ""), baseUrl));
  assert.equal(download.status, 200);
  const archive = Buffer.from(await download.arrayBuffer());
  assert.equal(archive.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(download.headers.get("content-type"), "application/zip");

  const deleted = await fetch(`${baseUrl}/privacy/delete`, {
    method: "POST", headers,
    body: JSON.stringify({ confirmation: "DELETE", confirmActiveSubscription: false }),
  });
  assert.equal(deleted.status, 200);
  const deletionBody = await deleted.json();
  assert.equal(deletionBody.deleted, true);
  assert.equal(deletionBody.providersPending, true);
  assert.equal(deletionBody.backupDays, 30);
  assert.match(deletionBody.providerDependency, /RevenueCat deletion remains queued/);
  assert.deepEqual(deletedPrivacyTestUsers(), ["disposable-privacy-test"]);

  const revokedDownload = await fetch(new URL(url.replace("/api", ""), baseUrl));
  assert.equal(revokedDownload.status, 404);
});

test("unlinked legacy bearer can read status, export, save consent, and delete only its own library", async () => {
  resetPrivacyTestDb();
  resetPrivacyTestClerk();
  const code = "u_AnonLegacyLibrary123456";
  const libraryHash = createHash("sha256").update(code).digest("hex");
  const profilePath = `data/users/${code}/profile`;
  seedPrivacyTestRows(classscribeLegacyDocumentsTable, [{
    path: profilePath, data: { displayName: "Legacy owner" }, createdAt: new Date(), updatedAt: new Date(),
  }]);
  seedPrivacyTestRows(classscribeCreditTransactionsTable, [{
    id: "credit-row", eventId: "private-provider-event-id", libraryHash, amount: 8,
    reason: "private study guide content", source: "study-guide", date: new Date(),
    metadata: { responseText: "must not survive" },
  }]);
  seedPrivacyTestRows(classscribeCreditProviderIntentsTable, [{
    id: "provider-intent", libraryHash, eventHash: "e".repeat(64), amount: 8,
    reasonHash: "r".repeat(64), source: "stripe-pack", status: "pending", errorCode: null,
    createdAt: new Date(), updatedAt: new Date(),
  }]);
  seedPrivacyTestRows(classscribeCreditSubscriptionPeriodsTable, [{
    id: "subscription-period", libraryHash, periodStart: new Date("2026-01-01T00:00:00Z"),
    periodEnd: new Date("2026-02-01T00:00:00Z"), highWaterPlan: "pro", grantedAmount: 8,
    paymentHashes: ["p".repeat(64)], status: "pending", revokedPaymentHash: null, revokedAt: null,
    pendingEventId: "private-pending-event", pendingPaymentHash: "q".repeat(64),
    pendingPlan: "pro", pendingAmount: 8, pendingSource: "revenuecat",
    createdAt: new Date(), updatedAt: new Date(),
  }]);
  seedPrivacyTestRows(classscribeCreditSubscriptionPaymentRevocationsTable, [{
    id: "revocation-row", libraryHash, paymentHash: "p".repeat(64), eventHash: "e".repeat(64),
    source: "revenuecat", createdAt: new Date(),
  }]);
  const headers = {
    authorization: `Bearer ${code}`,
    "x-cs-user": code,
    "content-type": "application/json",
  };

  const mismatch = await fetch(`${baseUrl}/privacy/status`, {
    headers: { ...headers, "x-cs-user": "u_DifferentLegacyLibrary123" },
  });
  assert.equal(mismatch.status, 403);

  const status = await fetch(`${baseUrl}/privacy/status`, { headers });
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.ageBand, null);
  assert.equal(statusBody.reauthenticationRequired, false);

  const exported = await fetch(`${baseUrl}/privacy/export`, {
    method: "POST", headers, body: "{}",
  });
  assert.equal(exported.status, 201);
  assert.ok((await exported.json()).url.startsWith("/api/privacy/export/download/"));

  const consent = await fetch(`${baseUrl}/privacy/consents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sessionId: "legacySession_123",
      lectureId: "legacyLecture1",
      courseId: "legacyCourse1",
      ...privacyConsentConfig,
      platform: "web",
      appVersion: "1.0",
      accommodation: false,
    }),
  });
  assert.equal(consent.status, 201, await consent.text());

  const deleted = await fetch(`${baseUrl}/privacy/delete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmation: "DELETE", confirmActiveSubscription: false }),
  });
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).deleted, true);
  assert.equal(readPrivacyTestRows(classscribePrivacyTombstonesTable).length, 1);
  assert.deepEqual(deletedPrivacyTestUsers(), []);
  const [retainedTransaction] = readPrivacyTestRows(classscribeCreditTransactionsTable);
  assert.equal(retainedTransaction.amount, 8);
  assert.equal(retainedTransaction.reason, "retained financial transaction");
  assert.equal(retainedTransaction.source, "privacy_retention");
  assert.deepEqual(retainedTransaction.metadata, {});
  assert.notEqual(retainedTransaction.eventId, "private-provider-event-id");
  const [closedIntent] = readPrivacyTestRows(classscribeCreditProviderIntentsTable);
  assert.equal(closedIntent.status, "cancelled");
  assert.equal(closedIntent.errorCode, "credit_account_deleted");
  const [closedPeriod] = readPrivacyTestRows(classscribeCreditSubscriptionPeriodsTable);
  assert.equal(closedPeriod.status, "revoked");
  assert.equal(closedPeriod.highWaterPlan, null);
  assert.equal(closedPeriod.pendingEventId, null);
  assert.equal(closedPeriod.pendingAmount, null);
  assert.equal(readPrivacyTestRows(classscribeCreditSubscriptionPaymentRevocationsTable).length, 1);
});

test("bearer access rejects forged or linked library codes and cannot delete a linked library", async () => {
  resetPrivacyTestDb();
  const code = "u_LinkedLegacyLibrary123456";
  const libraryHash = (await import("node:crypto")).createHash("sha256").update(code).digest("hex");
  seedPrivacyTestRows(classscribeLegacyDocumentsTable, [
    { path: `data/users/${code}/profile`, data: {}, createdAt: new Date(), updatedAt: new Date() },
    { path: `private/library-links/owners/${libraryHash}`, data: { encrypted: true }, createdAt: new Date(), updatedAt: new Date() },
  ]);
  const response = await fetch(`${baseUrl}/privacy/delete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${code}`,
      "x-cs-user": code,
      "content-type": "application/json",
    },
    body: JSON.stringify({ confirmation: "DELETE", confirmActiveSubscription: false }),
  });
  assert.equal(response.status, 403);
  assert.equal(readPrivacyTestRows(classscribePrivacyTombstonesTable).length, 0);

  const forged = await fetch(`${baseUrl}/privacy/status`, {
    headers: { authorization: "Bearer u_NotAnExistingLibrary1234", "x-cs-user": "u_NotAnExistingLibrary1234" },
  });
  assert.equal(forged.status, 403);
});

test("RevenueCat DELETE 200 is queued, confirmation polls only GET, and GET 404 completes the outbox", async () => {
  resetPrivacyTestDb();
  const previousApiKey = process.env.REVENUECAT_CREDITS_API_KEY;
  delete process.env.REVENUECAT_CREDITS_API_KEY;
  setPrivacyConnectorResponses([{ status: 200 }, { status: 200 }, { status: 404 }]);
  const customerPath = "/v2/projects/project_privacy_test/customers/app-user-privacy-test";
  const outbox = {
    id: "privacy-deletion-confirmation-test",
    libraryHash: "library-hash",
    userId: null,
    providerAppUserId: "app-user-privacy-test",
    providerProjectId: "project_privacy_test",
    pendingProviders: ["revenuecat"],
    attempts: "0",
    nextAttemptAt: new Date(),
    lastErrorCode: null,
    createdAt: new Date(),
  };
  seedPrivacyTestRows(classscribePrivacyDeletionOutboxTable, [outbox]);
  try {
    assert.equal(await processPrivacyDeletionOutboxItem(outbox), true);
    let [pending] = readPrivacyTestRows(classscribePrivacyDeletionOutboxTable);
    assert.deepEqual(pending.pendingProviders, ["revenuecat-confirm"]);
    assert.equal(pending.providerProjectId, "project_privacy_test");
    assert.equal(pending.providerAppUserId, "app-user-privacy-test");
    assert.equal(pending.lastErrorCode, "revenuecat_delete_confirmation_pending");

    assert.equal(await processPrivacyDeletionOutboxItem(pending), true);
    [pending] = readPrivacyTestRows(classscribePrivacyDeletionOutboxTable);
    assert.deepEqual(pending.pendingProviders, ["revenuecat-confirm"]);

    assert.equal(await processPrivacyDeletionOutboxItem(pending), false);
    assert.deepEqual(readPrivacyTestRows(classscribePrivacyDeletionOutboxTable), []);
    assert.deepEqual(readPrivacyConnectorRequests(), [
      { method: "DELETE", path: customerPath },
      { method: "GET", path: customerPath },
      { method: "GET", path: customerPath },
    ]);
  } finally {
    if (previousApiKey === undefined) delete process.env.REVENUECAT_CREDITS_API_KEY;
    else process.env.REVENUECAT_CREDITS_API_KEY = previousApiKey;
  }
});

test("privacy deletion dependency distinguishes RevenueCat authentication 401 from project-scope 403", async () => {
  const previousProjectId = process.env.REVENUECAT_PROJECT_ID;
  const previousApiKey = process.env.REVENUECAT_CREDITS_API_KEY;
  process.env.REVENUECAT_PROJECT_ID = "project_privacy_test";
  delete process.env.REVENUECAT_CREDITS_API_KEY;
  setPrivacyProviderAppUserId("app-user-privacy-test");
  try {
    for (const { status, expectedCode, expectedMessage, expectedProvider } of [
      {
        status: 200,
        expectedCode: "revenuecat_delete_confirmation_pending",
        expectedMessage: /(?=.*accepted)(?=.*awaiting provider confirmation)/i,
        expectedProvider: "revenuecat-confirm",
      },
      {
        status: 401,
        expectedCode: "revenuecat_authentication_failed",
        expectedMessage: /credentials were rejected \(HTTP 401\)/,
        expectedProvider: "revenuecat",
      },
      {
        status: 403,
        expectedCode: "revenuecat_project_scope_denied",
        expectedMessage: /lacks customer access .*HTTP 403/,
        expectedProvider: "revenuecat",
      },
    ]) {
      resetPrivacyTestDb();
      resetPrivacyTestClerk();
      setPrivacyConnectorResponses([{ status }]);
      const response = await fetch(`${baseUrl}/privacy/delete`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": `provider-error-${status}`, "x-test-fva": "0" },
        body: JSON.stringify({ confirmation: "DELETE", confirmActiveSubscription: false }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.providersPending, true);
      assert.match(body.providerDependency, expectedMessage);
      const [pending] = readPrivacyTestRows(classscribePrivacyDeletionOutboxTable);
      assert.equal(pending.lastErrorCode, expectedCode);
      assert.deepEqual(pending.pendingProviders, [expectedProvider]);
    }
  } finally {
    setPrivacyProviderAppUserId(undefined);
    if (previousProjectId === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = previousProjectId;
    if (previousApiKey === undefined) delete process.env.REVENUECAT_CREDITS_API_KEY;
    else process.env.REVENUECAT_CREDITS_API_KEY = previousApiKey;
  }
});

test("ZIP export renders synthetic anonymous-web legacy courses, lectures, notes, assignments, grades, and guides", async () => {
  resetPrivacyTestDb();
  const userId = "legacy-export-owner";
  const code = `u_${Buffer.from(`classscribe-free:${userId}`).toString("hex").slice(0, 32)}`;
  const prefix = `data/users/${code}/lib`;
  seedPrivacyTestRows(classscribeLegacyDocumentsTable, [
    { path: `data/users/${code}/profile`, data: { firstName: "Legacy" } },
    {
      path: `${prefix}/courses/course-a`,
      data: {
        id: "course-a", code: "BIO 101", name: "Biology", semester: "Fall 2025", color: 2, created: 1760000000000,
        guides: { final: { text: "Legacy course guide text", at: 1760000100000 } },
      },
    },
    {
      path: `${prefix}/lectures/lecture-a`,
      data: {
        id: "lecture-a", courseId: "course-a", title: "Legacy lecture title", date: "2025-10-10",
        duration: 1800, speakers: { P: "Dr. Legacy" }, segs: [{ t: 3, x: "Legacy transcript segment." }],
        analysis: { summary: "Legacy summary.", keyPoints: ["Legacy key point."], terms: [{ term: "Cell", def: "Basic unit of life." }] },
        myNotes: "My legacy lecture notes.", reviewed: true, created: 1760000200000,
      },
    },
    {
      path: `${prefix}/notes/note-a`,
      data: { id: "note-a", title: "Legacy note title", body: "Legacy markdown note body.", courseId: "course-a", pinned: true, created: 1760000300000, updated: 1760000400000 },
    },
    {
      path: `${prefix}/assignments/assignment-a`,
      data: { id: "assignment-a", courseId: "course-a", title: "Legacy assignment", type: "homework", due: "2025-11-01", done: false },
    },
    {
      path: `${prefix}/gradebooks/course-a`,
      data: {
        courseId: "course-a", credits: 3, weights: { assignment: 100, project: 0, quiz: 0, test: 0 },
        items: [{ id: "grade-item", title: "Legacy exam", type: "test", earned: 90, possible: 100 }],
        finalPercent: 90, version: 1,
      },
    },
  ]);

  const created = await fetch(`${baseUrl}/privacy/export`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": userId, "x-test-fva": "0" },
    body: "{}",
  });
  assert.equal(created.status, 201);
  const { url } = await created.json();
  const download = await fetch(new URL(url.replace("/api", ""), baseUrl));
  assert.equal(download.status, 200);
  const archive = Buffer.from(await download.arrayBuffer());
  const entries = new Map();
  let offset = 0;
  while (offset + 30 < archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const filenameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const contentOffset = offset + 30 + filenameLength + extraLength;
    const filename = archive.subarray(offset + 30, offset + 30 + filenameLength).toString("utf8");
    const compressed = archive.subarray(contentOffset, contentOffset + compressedSize);
    entries.set(filename, (method === 8 ? inflateRawSync(compressed) : compressed).toString("utf8"));
    offset = contentOffset + compressedSize;
  }
  assert.match(entries.get("lectures.md"), /Legacy lecture title/);
  assert.match(entries.get("lectures.md"), /2025-10-10/);
  assert.match(entries.get("lectures.md"), /Legacy transcript segment/);
  assert.match(entries.get("lectures.md"), /My legacy lecture notes/);
  assert.match(entries.get("notes.md"), /Legacy markdown note body/);
  assert.match(entries.get("courses.json"), /Legacy course guide text/);
  assert.match(entries.get("assignments.csv"), /Legacy assignment/);
  assert.match(entries.get("grades.csv"), /Legacy exam/);
  assert.match(entries.get("guides.json"), /Legacy course guide text/);
});

test("seven-year retention purges all new financial records by their creation dates", async () => {
  resetPrivacyTestDb();
  const oldDate = new Date("2010-01-01T00:00:00Z");
  const recentDate = new Date("2029-01-01T00:00:00Z");
  seedPrivacyTestRows(classscribeCreditTransactionsTable, [
    { id: "old-ledger", date: oldDate }, { id: "recent-ledger", date: recentDate },
  ]);
  seedPrivacyTestRows(classscribeCreditProviderIntentsTable, [
    { id: "old-intent", createdAt: oldDate }, { id: "recent-intent", createdAt: recentDate },
  ]);
  seedPrivacyTestRows(classscribeCreditSubscriptionPaymentRevocationsTable, [
    { id: "old-revocation", createdAt: oldDate }, { id: "recent-revocation", createdAt: recentDate },
  ]);
  seedPrivacyTestRows(classscribeCreditSubscriptionPeriodsTable, [
    { id: "old-period", createdAt: oldDate }, { id: "recent-period", createdAt: recentDate },
  ]);
  const previousEnabled = process.env.PRIVACY_RETENTION_JOB_ENABLED;
  const previousApply = process.env.PRIVACY_RETENTION_APPLY;
  process.env.PRIVACY_RETENTION_JOB_ENABLED = "true";
  process.env.PRIVACY_RETENTION_APPLY = "true";
  try {
    const result = await runPrivacyRetentionJob(new Date("2030-01-01T00:00:00Z"));
    assert.equal(result.locked, true);
  } finally {
    if (previousEnabled === undefined) delete process.env.PRIVACY_RETENTION_JOB_ENABLED;
    else process.env.PRIVACY_RETENTION_JOB_ENABLED = previousEnabled;
    if (previousApply === undefined) delete process.env.PRIVACY_RETENTION_APPLY;
    else process.env.PRIVACY_RETENTION_APPLY = previousApply;
  }
  assert.deepEqual(readPrivacyTestRows(classscribeCreditTransactionsTable).map(row => row.id), ["recent-ledger"]);
  assert.deepEqual(readPrivacyTestRows(classscribeCreditProviderIntentsTable).map(row => row.id), ["recent-intent"]);
  assert.deepEqual(readPrivacyTestRows(classscribeCreditSubscriptionPaymentRevocationsTable).map(row => row.id), ["recent-revocation"]);
  assert.deepEqual(readPrivacyTestRows(classscribeCreditSubscriptionPeriodsTable).map(row => row.id), ["recent-period"]);
});