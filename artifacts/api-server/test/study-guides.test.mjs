import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, classscribeCreditActionsTable, classscribeCreditTransactionsTable,
  classscribeLegacyDocumentsTable, coursesTable, courseMembersTable, lecturesTable, notesTable, studyGuidesTable,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import router from "../src/routes/study-guides.ts";
import { calls, setFailStudyGuide } from "./fixtures/study-guide-ai.mjs";
import { freeBillingIdentityForOwner } from "../src/lib/classscribe-billing.ts";

const hash = (value) => createHash("sha256").update(value).digest("hex");

async function grantPro(accountId) {
  const identity = freeBillingIdentityForOwner(accountId);
  const libraryHash = hash(identity);
  const path = `private/classscribe-billing/accounts/${libraryHash}`;
  await db.insert(classscribeLegacyDocumentsTable).values({
    path,
    data: {
      libraryHash,
      plan: "pro",
      status: "active",
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  return path;
}

test("an authenticated student generates and reloads a private guide from lectures and their own notes", async () => {
  const owner = `guide-owner-${randomUUID()}`;
  const classmate = `guide-classmate-${randomUUID()}`;
  const freeReader = `guide-free-${randomUUID()}`;
  const outsider = `guide-outsider-${randomUUID()}`;
  const app = express();
  app.use(express.json());
  app.use("/api", (req, res, next) => {
    if (!getAuth(req).userId) return res.status(401).json({ error: "Unauthorized" });
    next();
  }, router);
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/courses`;
  const request = async (courseId, user, method = "GET", body) => {
    const response = await fetch(`${url}/${courseId}/study-guide`, {
      method,
      headers: {
        ...(user ? { "x-test-user": user } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  let course;
  let emptyCourse;
  const billingPaths = [];
  const priorProjectId = process.env.REVENUECAT_PROJECT_ID;
  const priorProxy = globalThis.__scribeProxy;
  const priorFetch = globalThis.fetch;
  const balances = new Map();
  const adjustmentKeys = new Set();
  process.env.REVENUECAT_PROJECT_ID = "credits-guide-test";
  globalThis.__scribeProxy = async (_connector, path, options = {}) => {
    const url = new URL(path, "https://revenuecat.test");
    const appUserId = url.searchParams.get("search");
    if (url.pathname.endsWith("/customers") && options.method === "GET") {
      balances.set(appUserId, balances.get(appUserId) ?? 10);
      return { ok: true, status: 200, async json() { return { object: "list", items: [{
        object: "customer", id: `customer-${appUserId}`, project_id: "credits-guide-test",
        first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
        last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
      }] }; } };
    }
    if (url.pathname.endsWith("/aliases") && options.method === "GET") {
      const customerId = url.pathname.split("/").at(-2);
      return { ok: true, status: 200, async json() { return { object: "list", items: [{
        object: "customer.alias", id: customerId.slice("customer-".length), created_at: Date.now(),
      }] }; } };
    }
    if (url.pathname.endsWith("/virtual_currencies") && options.method === "GET") {
      const customerId = url.pathname.split("/").at(-2);
      const balance = balances.get(customerId.slice("customer-".length)) ?? 10;
      return { ok: true, status: 200, async json() { return { object: "list", items: ["CRD", "CREDITS"].map(currency_code => ({
        object: "virtual_currency_balance", currency_code, balance,
        description: "Scribe Credits", name: "Scribe Credits",
      })) }; } };
    }
    if (url.pathname.endsWith("/virtual_currencies/transactions") && options.method === "POST") {
      const eventId = new Headers(options.headers).get("Idempotency-Key");
      const customerId = url.pathname.split("/").at(-3);
      const userId = customerId.slice("customer-".length);
      if (!adjustmentKeys.has(eventId)) {
        adjustmentKeys.add(eventId);
        const body = JSON.parse(options.body);
        assert.equal(body.reference, eventId);
        assert.equal(Object.keys(body.adjustments).length, 1);
        assert.ok(["CRD", "CREDITS"].includes(Object.keys(body.adjustments)[0]));
        const amount = Object.values(body.adjustments)[0];
        assert.ok(Number.isSafeInteger(amount));
        balances.set(userId, (balances.get(userId) ?? 10) + amount);
      }
      return { ok: true, status: 200, async json() { return {}; } };
    }
    throw new Error(`Unexpected RevenueCat test request: ${path}`);
  };
  // The configured server-key path uses HTTP instead of the connector.
  // Keep synthetic balances and debits isolated from the live provider.
  globalThis.fetch = (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    return url.hostname === "api.revenuecat.com"
      ? globalThis.__scribeProxy("revenuecat", url.pathname + url.search, options)
      : priorFetch(input, options);
  };
  try {
    billingPaths.push(await grantPro(owner), await grantPro(classmate));
    [course] = await db.insert(coursesTable).values({
      name: "Study guide test", subject: "TEST", term: "Autumn",
      color: "#000000", inviteCode: randomUUID(), ownerId: owner,
    }).returning();
    [emptyCourse] = await db.insert(coursesTable).values({
      name: "Empty test", subject: "TEST", term: "Autumn",
      color: "#000000", inviteCode: randomUUID(), ownerId: owner,
    }).returning();
    await db.insert(courseMembersTable).values([
      { courseId: course.id, userId: classmate },
      { courseId: course.id, userId: freeReader },
    ]);
    const [lecture] = await db.insert(lecturesTable).values({
      courseId: course.id, title: "Cell division", professor: "Dr Test",
      lectureDate: new Date("2026-09-24T12:00:00Z"),
      summary: "Mitosis separates chromosomes.",
    }).returning();
    await db.insert(notesTable).values([
      { courseId: course.id, userId: owner, title: "My reminder", markdownBody: "Remember the spindle." },
      { courseId: course.id, userId: classmate, title: "Classmate secret", markdownBody: "Do not share this note." },
    ]);

    assert.equal((await request(course.id, null)).status, 401);
    assert.deepEqual((await request(course.id, owner)).body, { guide: null });
    const generated = await request(course.id, owner, "POST");
    assert.equal(generated.status, 200);
    assert.match(generated.body.content, /Mock guide/);
    assert.equal(calls.at(-1).store, false);
    assert.deepEqual(generated.body.sources, [{ id: lecture.id, title: lecture.title }]);
    assert.equal(calls.length, 1);
    const prompt = calls[0].messages.find(message => message.role === "user").content;
    assert.match(prompt, /Mitosis separates chromosomes/);
    assert.match(prompt, /Remember the spindle/);
    assert.doesNotMatch(prompt, /Do not share this note|Classmate secret/);

    // Fresh GETs are the data loaded by both clients after a page/app reload.
    const webReload = await request(course.id, owner);
    const phoneReload = await request(course.id, owner);
    for (const result of [webReload, phoneReload]) {
      assert.equal(result.status, 200);
      assert.equal(result.body.guide.id, generated.body.id);
      assert.equal(result.body.guide.content, generated.body.content);
      assert.deepEqual(result.body.guide.sources, generated.body.sources);
    }
    if (process.env.GUIDE_TEST_FIXTURE) {
      writeFileSync(process.env.GUIDE_TEST_FIXTURE, JSON.stringify(webReload.body), { mode: 0o600 });
    }
    assert.deepEqual((await request(course.id, classmate)).body, { guide: null });
    assert.equal((await request(course.id, freeReader)).status, 403);
    const creditsRequired = await request(course.id, freeReader, "POST");
    assert.equal(creditsRequired.status, 402);
    assert.equal(creditsRequired.body.code, "credits_required");
    assert.equal(creditsRequired.body.cost, 3);
    assert.equal(creditsRequired.body.action, "studyGuide");
    const requestId = creditsRequired.body.requestId;
    const freeIdentity = freeBillingIdentityForOwner(freeReader);
    const freeIdentityHash = hash(freeIdentity);
    const [freeAccount] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, `private/classscribe-billing/accounts/${freeIdentityHash}`));
    const creditsAppUserId = freeAccount.data.billingAccountId;
    balances.set(creditsAppUserId, 2);
    const lowBalance = await request(course.id, freeReader, "POST", { useCredits: true, requestId });
    assert.equal(lowBalance.status, 422);
    assert.equal(lowBalance.body.code, "insufficient_credits");
    assert.equal(balances.get(creditsAppUserId), 2);

    balances.set(creditsAppUserId, 10);
    setFailStudyGuide(true);
    const failedGuide = await request(course.id, freeReader, "POST", { useCredits: true, requestId });
    assert.equal(failedGuide.status, 502);
    assert.equal(balances.get(creditsAppUserId), 10, "failed generation must refund the debit");
    setFailStudyGuide(false);
    const failedRetry = await request(course.id, freeReader, "POST", { useCredits: true, requestId });
    assert.equal(failedRetry.status, 409, "a refunded failed action must not be replayed free");

    const successfulRequestId = randomUUID();
    const generatedWithCredits = await request(course.id, freeReader, "POST", {
      useCredits: true,
      requestId: successfulRequestId,
    });
    assert.equal(generatedWithCredits.status, 200);
    assert.equal(balances.get(creditsAppUserId), 7);
    const callsAfterSuccess = calls.length;
    const successfulRetry = await request(course.id, freeReader, "POST", {
      useCredits: true,
      requestId: successfulRequestId,
    });
    assert.equal(successfulRetry.status, 200);
    assert.equal(successfulRetry.body.id, generatedWithCredits.body.id);
    assert.equal(balances.get(creditsAppUserId), 7, "an idempotent retry must not charge again");
    assert.equal(calls.length, callsAfterSuccess, "an idempotent retry must not rerun generation");
    assert.equal((await request(course.id, outsider)).status, 404);
    assert.equal((await request(course.id, outsider, "POST")).status, 404);
    const callsBeforeUnauthorized = calls.length;
    assert.equal(calls.length, callsBeforeUnauthorized, "unauthorized requests must not use AI");

    const empty = await request(emptyCourse.id, owner, "POST");
    assert.equal(empty.status, 422);
    assert.match(empty.body.error, /Add a lecture transcript or a course note/);
    assert.equal(calls.length, callsBeforeUnauthorized, "empty courses must not use AI");
    assert.deepEqual((await request(emptyCourse.id, owner)).body, { guide: null });
  } finally {
    if (course) await db.delete(coursesTable).where(eq(coursesTable.id, course.id));
    if (emptyCourse) await db.delete(coursesTable).where(eq(coursesTable.id, emptyCourse.id));
    if (billingPaths.length) {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(inArray(classscribeLegacyDocumentsTable.path, billingPaths));
    }
    const freeLibraryHash = hash(freeBillingIdentityForOwner(freeReader));
    await db.delete(classscribeCreditActionsTable)
      .where(eq(classscribeCreditActionsTable.libraryHash, freeLibraryHash));
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, freeLibraryHash));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, `private/classscribe-billing/accounts/${freeLibraryHash}`));
    server.close();
    if (priorProjectId === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProjectId;
    if (priorProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = priorProxy;
    globalThis.fetch = priorFetch;
    await pool.end();
  }
});