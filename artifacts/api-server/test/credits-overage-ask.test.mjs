import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import {
  classscribeCreditActionsTable,
  classscribeCreditProviderIntentsTable,
  classscribeCreditTransactionsTable,
  classscribeLegacyDocumentsTable,
  coursesTable,
  courseMembersTable,
  db,
  lecturesTable,
  pool,
} from "@workspace/db";
import { freeBillingIdentityForOwner, getLibraryBillingStatus as getBillingStatus, reserveAskUsage, finishAskUsage, releaseAskUsage } from "../src/lib/classscribe-billing.ts";
import askRouter from "../src/routes/classscribeAsk.ts";
import legacyRouter from "../src/routes/classscribe-legacy.ts";
import { askCalls, setFailAsk } from "./fixtures/ask-test-ai.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

test("Ask overage charges only after confirmation, refunds failures, and caches idempotent success", async () => {
  const userId = `ask-credit-owner-${randomUUID()}`;
  const identity = freeBillingIdentityForOwner(userId);
  const libraryHash = hash(identity);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const month = new Date().toISOString().slice(0, 7);
  const usagePath = `private/classscribe-billing/usage/${libraryHash}/${month}`;
  const priorProjectId = process.env.REVENUECAT_PROJECT_ID;
  const priorProxy = globalThis.__scribeProxy;
  const originalFetch = globalThis.fetch;
  const balances = new Map();
  const eventIds = new Set();
  let legacyMode = "answer";
  let legacyCalls = 0;
  process.env.REVENUECAT_PROJECT_ID = "ask-overage-test";
  globalThis.__scribeProxy = async (_connector, path, options = {}) => {
    const url = new URL(path, "https://revenuecat.test");
    const appUserId = url.searchParams.get("search");
    if (url.pathname.endsWith("/customers") && options.method === "GET") {
      balances.set(appUserId, balances.get(appUserId) ?? 5);
      return { ok: true, status: 200, async json() { return { object: "list", items: [{
        object: "customer", id: `customer-${appUserId}`, project_id: "ask-overage-test",
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
      return {
        ok: true,
        status: 200,
        async json() {
          return { object: "list", items: ["CRD", "CREDITS"].map(currency_code => ({
            object: "virtual_currency_balance", currency_code,
            balance: balances.get(customerId.slice("customer-".length)) ?? 5,
            description: "Scribe Credits", name: "Scribe Credits",
          })) };
        },
      };
    }
    if (url.pathname.endsWith("/virtual_currencies/transactions") && options.method === "POST") {
      const customerId = url.pathname.split("/").at(-3);
      const user = customerId.slice("customer-".length);
      const eventId = new Headers(options.headers).get("Idempotency-Key");
      if (!eventIds.has(eventId)) {
        eventIds.add(eventId);
        const body = JSON.parse(options.body);
        assert.equal(body.reference, eventId);
        assert.equal(Object.keys(body.adjustments).length, 1);
        assert.ok(["CRD", "CREDITS"].includes(Object.keys(body.adjustments)[0]));
        const amount = Object.values(body.adjustments)[0];
        assert.ok(Number.isSafeInteger(amount));
        balances.set(user, (balances.get(user) ?? 5) + amount);
      }
      return { ok: true, status: 200, async json() { return {}; } };
    }
    throw new Error(`Unexpected RevenueCat request ${path}`);
  };
  // Isolate both the secret-key HTTP transport and the connector transport.
  globalThis.fetch = (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/v1/messages")) {
      legacyCalls++;
      return Promise.resolve(new Response(JSON.stringify(legacyMode === "fail" ? { error: "Synthetic provider failure" } : {
        content: legacyMode === "tools"
          ? [{ type: "tool_use", id: "tool-1", name: "search", input: {} }]
          : [{ type: "text", text: "Synthetic Free Ask answer" }],
        stop_reason: legacyMode === "tools" ? "tool_use" : "end_turn",
      }), { status: legacyMode === "fail" ? 503 : 200, headers: { "content-type": "application/json" } }));
    }
    return parsed.hostname === "api.revenuecat.com"
      ? globalThis.__scribeProxy("revenuecat", parsed.pathname + parsed.search, options)
      : originalFetch(url, options);
  };

  const [course] = await db.insert(coursesTable).values({
    name: "Ask credits", subject: "TEST", term: "Fall", color: "#000000",
    inviteCode: randomUUID(), ownerId: userId,
  }).returning();
  const [lecture] = await db.insert(lecturesTable).values({
    courseId: course.id, createdBy: userId, title: "Mitosis",
    professor: "Test", lectureDate: new Date(), summary: "Mitosis separates chromosomes during cell division.",
  }).returning();
  await db.insert(courseMembersTable).values({ courseId: course.id, userId });
  await db.insert(classscribeLegacyDocumentsTable).values([
    {
      path: accountPath,
      data: {
        libraryHash, plan: "student", status: "active",
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      },
    },
    { path: usagePath, data: { askCountUsed: 25, askFingerprints: {}, askReservations: {} } },
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { warn() {}, error() {}, info() {} };
    next();
  });
  app.use("/api", askRouter);
  app.use("/api", legacyRouter);
  const server = app.listen(0);
  const endpoint = `http://127.0.0.1:${server.address().port}/api/classscribe/ask`;
  const postAsk = async (body) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": userId },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const baseBody = { question: "Explain mitosis", courseId: course.id };
    const prompt = await postAsk(baseBody);
    assert.equal(prompt.status, 402);
    assert.equal(prompt.body.code, "credits_required");
    assert.equal(prompt.body.cost, 1);
    assert.equal(prompt.body.action, "askQuestion");
    assert.equal(askCalls.length, 0);

    const [account] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    const appUserId = account.data.billingAccountId;
    balances.set(appUserId, 0);
    const requestId = prompt.body.requestId;
    const insufficient = await postAsk({ ...baseBody, useCredits: true, requestId });
    assert.equal(insufficient.status, 422);
    assert.equal(insufficient.body.code, "insufficient_credits");
    assert.equal(balances.get(appUserId), 0);
    assert.equal(askCalls.length, 0);

    balances.set(appUserId, 5);
    const successful = await postAsk({ ...baseBody, useCredits: true, requestId });
    assert.equal(successful.status, 200);
    assert.match(successful.body.answer, /Mitosis separates chromosomes/);
    assert.equal(askCalls.at(-1).store, false);
    assert.equal(balances.get(appUserId), 4);
    const callCount = askCalls.length;
    const retry = await postAsk({ ...baseBody, useCredits: true, requestId });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body, successful.body);
    assert.equal(balances.get(appUserId), 4);
    assert.equal(askCalls.length, callCount);

    const failedRequestId = randomUUID();
    setFailAsk(true);
    const beforeFailure = balances.get(appUserId);
    const failed = await postAsk({ ...baseBody, useCredits: true, requestId: failedRequestId });
    assert.equal(failed.status, 502);
    assert.equal(balances.get(appUserId), beforeFailure, "provider failure must refund Ask credit");

    // Free: no included question; exactly one credit-paid question per UTC month.
    setFailAsk(false);
    const [updatedAccount] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    await db.update(classscribeLegacyDocumentsTable).set({
      data: { ...updatedAccount.data, plan: "free", status: "active" },
    }).where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    await db.update(classscribeLegacyDocumentsTable).set({
      data: { month, askCountUsed: 0, askFingerprints: {}, askReservations: {} },
    }).where(eq(classscribeLegacyDocumentsTable.path, usagePath));
    const freeStatus = await getBillingStatus(identity);
    assert.equal(freeStatus.plan, "free");
    assert.equal(freeStatus.askCountLimit, 1);
    assert.equal(freeStatus.askCountRemaining, 1);
    const freeBalance = balances.get(appUserId);
    const freeCalls = askCalls.length;
    const freeQuote = await postAsk(baseBody);
    assert.equal(freeQuote.status, 402);
    assert.equal(freeQuote.body.code, "credits_required");
    assert.equal(freeQuote.body.cost, 1);
    assert.match(freeQuote.body.error, /one Ask question per month/);
    assert.equal(balances.get(appUserId), freeBalance);
    assert.equal(askCalls.length, freeCalls, "an unconfirmed Free Ask must not call AI");

    balances.set(appUserId, 0);
    const noCredits = await postAsk({ ...baseBody, useCredits: true, requestId: freeQuote.body.requestId });
    assert.equal(noCredits.status, 422);
    assert.equal((await getBillingStatus(identity)).askCountRemaining, 1, "insufficient credits release the monthly slot");
    balances.set(appUserId, freeBalance);

    setFailAsk(true);
    const freeFailure = await postAsk({ ...baseBody, useCredits: true, requestId: randomUUID() });
    assert.equal(freeFailure.status, 502);
    assert.equal(balances.get(appUserId), freeBalance, "failed Free Ask refunds its credit");
    assert.equal((await getBillingStatus(identity)).askCountRemaining, 1);
    setFailAsk(false);

    const freeIds = [randomUUID(), randomUUID()];
    const concurrent = await Promise.all(freeIds.map(requestId => postAsk({ ...baseBody, useCredits: true, requestId })));
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 429], "concurrent clients share the single monthly slot");
    assert.equal(balances.get(appUserId), freeBalance - 1);
    assert.equal((await getBillingStatus(identity)).askCountRemaining, 0);
    const winner = concurrent.findIndex(r => r.status === 200);
    const freeReplay = await postAsk({ ...baseBody, useCredits: true, requestId: freeIds[winner] });
    assert.equal(freeReplay.status, 200);
    assert.deepEqual(freeReplay.body, concurrent[winner].body);
    assert.equal(balances.get(appUserId), freeBalance - 1, "replaying Free success must not debit again");
    const second = await postAsk({ ...baseBody, useCredits: true, requestId: randomUUID() });
    assert.equal(second.status, 429);
    assert.equal(second.body.code, "ask_limit_reached");
    assert.equal(balances.get(appUserId), freeBalance - 1, "credits cannot bypass the monthly Free cap");
    const postLegacy = async body => {
      const response = await fetch(endpoint.replace("/classscribe/ask", "/ai/ask"), {
        method: "POST", headers: { "content-type": "application/json", "X-CS-User": identity },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const legacyBase = { messages: [{ role: "user", content: "Explain mitosis" }], askId: randomUUID() };
    assert.equal((await postLegacy(legacyBase)).status, 429, "phone/browser legacy Ask shares the modern monthly cap");

    // Prior-month usage must not consume the current month's slot.
    const oldUsagePath = `private/classscribe-billing/usage/${libraryHash}/2000-01`;
    await db.insert(classscribeLegacyDocumentsTable).values({
      path: oldUsagePath, data: { month: "2000-01", askCountUsed: 1 },
    });
    try {
      await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, usagePath));
      assert.equal((await getBillingStatus(identity)).askCountRemaining, 1);
      const paidRound = await reserveAskUsage(identity, "free-tool-round", "Explain mitosis", [], true);
      assert.equal(paidRound.allowed, true);
      assert.equal(paidRound.requiresCredits, true);
      await finishAskUsage(identity, "free-tool-round", "Explain mitosis", paidRound.reservationToken, "tool_use", ["tool-1"], paidRound.month);
      const continuation = await reserveAskUsage(identity, "free-tool-round", "Explain mitosis", ["tool-1"], true);
      assert.equal(continuation.allowed, true, "internal tool rounds remain part of the same Free question");
      assert.equal(continuation.alreadyCounted, true);
      await releaseAskUsage(identity, "free-tool-round", "Explain mitosis", continuation.reservationToken, continuation.month, true);
      assert.equal((await getBillingStatus(identity)).askCountRemaining, 1, "refunded tool-round failures restore the Free slot");
      const legacyQuote = await postLegacy(legacyBase);
      assert.equal(legacyQuote.status, 402);
      assert.equal(legacyQuote.body.code, "credits_required");
      assert.equal(legacyQuote.body.cost, 1);
      assert.equal(legacyCalls, 0, "unconfirmed legacy Ask must not call the provider");

      const beforeLegacy = balances.get(appUserId);
      legacyMode = "tools";
      const legacyPaid = { ...legacyBase, useCredits: true };
      const toolReply = await postLegacy(legacyPaid);
      assert.equal(toolReply.status, 200);
      assert.equal(balances.get(appUserId), beforeLegacy - 1);
      const continued = {
        ...legacyPaid,
        messages: [...legacyBase.messages, { role: "assistant", content: toolReply.body.content },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "Synthetic source" }] }],
      };
      legacyMode = "fail";
      assert.equal((await postLegacy(continued)).status, 503);
      assert.equal(balances.get(appUserId), beforeLegacy, "failed legacy continuation refunds the single charge");
      assert.equal((await getBillingStatus(identity)).askCountRemaining, 1);

      legacyMode = "tools";
      const newPaid = { ...legacyPaid, askId: randomUUID() };
      const newToolReply = await postLegacy(newPaid);
      assert.equal(newToolReply.status, 200);
      legacyMode = "answer";
      const answerRequest = { ...continued, askId: newPaid.askId };
      const answerReply = await postLegacy(answerRequest);
      assert.equal(answerReply.status, 200);
      assert.equal((await getBillingStatus(identity)).askCountUsed, 1);
      assert.equal(balances.get(appUserId), beforeLegacy - 1, "all tool rounds cost one credit in total");
      const callsBeforeReplay = legacyCalls;
      const legacyReplay = await postLegacy(answerRequest);
      assert.equal(legacyReplay.status, 200);
      assert.deepEqual(legacyReplay.body, answerReply.body);
      assert.equal(legacyCalls, callsBeforeReplay);
      assert.equal(balances.get(appUserId), beforeLegacy - 1);
      assert.equal((await postLegacy({ ...legacyPaid, askId: randomUUID() })).status, 429);
    } finally {
      await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, oldUsagePath));
    }
  } finally {
    setFailAsk(false);
    server.close();
    await db.delete(classscribeCreditActionsTable)
      .where(eq(classscribeCreditActionsTable.libraryHash, libraryHash));
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    await db.delete(classscribeCreditProviderIntentsTable)
      .where(eq(classscribeCreditProviderIntentsTable.libraryHash, libraryHash));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, usagePath));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    await db.delete(coursesTable).where(eq(coursesTable.id, course.id));
    if (priorProjectId === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProjectId;
    if (priorProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = priorProxy;
    globalThis.fetch = originalFetch;
    await pool.end();
  }
});