import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import express from "express";
import { eq, like } from "drizzle-orm";
import {
  db,
  classscribeLegacyDocumentsTable,
  classscribeConsentsTable,
  classscribeCreditTransactionsTable,
  classscribeCreditSubscriptionPeriodsTable,
} from "@workspace/db";
import legacyRouter from "../src/routes/classscribe-legacy.ts";
import revenueCatWebhookRouter, {
  expectedRevenueCatWebhookAuthorization,
} from "../src/routes/revenuecat-webhook.ts";
import {
  assertStripeWebhookMode,
  createLibraryCheckoutWithStripe,
  ensureRevenueCatCustomer,
  getRevenueCatAppUserId,
  getLibraryBillingStatus,
  isStripeSyncReady,
  processBillingEvent,
  refreshRevenueCatBillingStatus,
  releaseRecordingUsage,
  reserveAskUsage,
  finishAskUsage,
  releaseAskUsage,
  reserveRecordingUsage,
  reserveTranscriptionUsage,
  finishTranscriptionUsage,
  releaseTranscriptionUsage,
} from "../src/lib/classscribe-billing.ts";
import { getUncachableStripeClient, StripeConnectionError } from "../src/lib/stripeClient.ts";
import { privacyConsentConfig } from "../src/lib/privacy-config.ts";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const freshLibraryCode = () => `u_${randomUUID().replaceAll("-", "")}`;
const creditsMigrationControlPath = "private/classscribe-billing/credits-migration-control";
const setCreditsMigrationControlCurrency = async (activeCurrency) => {
  const [previous] = await db.select({
    data: classscribeLegacyDocumentsTable.data,
    updatedAt: classscribeLegacyDocumentsTable.updatedAt,
  }).from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, creditsMigrationControlPath))
    .limit(1);
  const data = {
    maintenance: false,
    activeCurrency,
    serverSubscriptionGrantReady: true,
    version: "billing-test-ready",
  };
  await db.insert(classscribeLegacyDocumentsTable).values({
    path: creditsMigrationControlPath,
    data,
  }).onConflictDoUpdate({
    target: classscribeLegacyDocumentsTable.path,
    set: { data },
  });
  return async () => {
    if (previous) {
      await db.update(classscribeLegacyDocumentsTable)
        .set({ data: previous.data, updatedAt: previous.updatedAt })
        .where(eq(classscribeLegacyDocumentsTable.path, creditsMigrationControlPath));
    } else {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, creditsMigrationControlPath));
    }
  };
};
const stripeSubscriptionInvoiceLine = (subscriptionId, priceId, start, end, proration = false) => ({
  parent: {
    type: "subscription_item_details",
    subscription_item_details: { subscription: subscriptionId, proration },
  },
  pricing: { type: "price_details", price_details: { price: priceId } },
  period: { start, end },
});
const originalCreditsApiKey = process.env.REVENUECAT_CREDITS_API_KEY;
delete process.env.REVENUECAT_CREDITS_API_KEY;
after(() => {
  if (originalCreditsApiKey === undefined) delete process.env.REVENUECAT_CREDITS_API_KEY;
  else process.env.REVENUECAT_CREDITS_API_KEY = originalCreditsApiKey;
});
const mockRevenueCatCustomer = (projectId) => async (_connector, path, options = {}) => {
  const url = new URL(path, "https://revenuecat.test");
  if (url.pathname.endsWith("/customers") && options.method === "POST") {
    const body = JSON.parse(options.body);
    return Response.json({
      object: "customer", id: body.id, project_id: projectId,
      first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
      last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
    }, { status: 201 });
  }
  if (url.pathname.endsWith("/customers") && options.method === "GET") {
    const appUserId = url.searchParams.get("search");
    return Response.json({ object: "list", items: [{
      object: "customer", id: `customer-${appUserId}`, project_id: projectId,
      first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
      last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
    }] });
  }
  if (url.pathname.endsWith("/aliases") && options.method === "GET") {
    const customerId = url.pathname.split("/").at(-2);
    return Response.json({ object: "list", items: [{
      object: "customer.alias", id: customerId.replace(/^customer-/, ""), created_at: Date.now(),
    }] });
  }
  throw new Error(`Unexpected RevenueCat customer provisioning request: ${path}`);
};
const freeRevenueCatSnapshot = async (appUserId) => ({
  project: { id: process.env.REVENUECAT_PROJECT_ID },
  apps: [],
  products: [],
  customer: { app_user_id: appUserId },
  activeEntitlements: { items: [] },
  subscriptions: { items: [] },
});

test("Stripe webhook environment validation accepts matching live and test events only", () => {
  assert.doesNotThrow(() => assertStripeWebhookMode(true, true));
  assert.doesNotThrow(() => assertStripeWebhookMode(false, false));
  for (const [eventMode, connectionMode] of [[true, false], [false, true], [undefined, true]]) {
    assert.throws(() => assertStripeWebhookMode(eventMode, connectionMode), error =>
      error.code === "stripe_webhook_mode_mismatch");
  }
});

test("Stripe credentials accept live and test keys but reject invalid or conflicting credentials", async () => {
  const originalFetch = globalThis.fetch;
  const previousHostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const previousIdentity = process.env.REPL_IDENTITY;
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors.billing-test.example";
  process.env.REPL_IDENTITY = "billing-test-identity";
  try {
    for (const key of ["sk_live_not-a-real-secret", "rk_live_not-a-real-secret", "sk_test_not-a-real-secret", "rk_test_not-a-real-secret"]) {
      globalThis.fetch = async () => Response.json({ items: [{ settings: { secret: key } }] });
      assert.ok(await getUncachableStripeClient());
    }
    for (const secret of ["pk_live_not-a-real-secret", "invalid-not-a-real-secret", ""]) {
      globalThis.fetch = async () => Response.json({ items: [{ settings: { secret } }] });
      await assert.rejects(getUncachableStripeClient(), error =>
        error instanceof StripeConnectionError && error.code === "stripe_api_key_missing_or_invalid");
    }
    globalThis.fetch = async () => Response.json({ items: [{
      settings: { secret: "sk_live_not-a-real-secret", api_key: "sk_test_not-a-real-secret" },
    }] });
    await assert.rejects(getUncachableStripeClient(), error =>
      error instanceof StripeConnectionError && error.code === "stripe_api_key_fields_conflict");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousHostname === undefined) delete process.env.REPLIT_CONNECTORS_HOSTNAME;
    else process.env.REPLIT_CONNECTORS_HOSTNAME = previousHostname;
    if (previousIdentity === undefined) delete process.env.REPL_IDENTITY;
    else process.env.REPL_IDENTITY = previousIdentity;
  }
});

test("library billing status, free course limit, and usage survive sync-code rotation", async () => {
  const previousProjectId = process.env.REVENUECAT_PROJECT_ID;
  delete process.env.REVENUECAT_PROJECT_ID;
  const code = freshLibraryCode();
  const nextCode = freshLibraryCode();
  const codeHash = hash(code);
  const nextHash = hash(nextCode);
  const paths = [
    `data/users/${code}/%`,
    `data/users/${nextCode}/%`,
    `revoked/${codeHash}`,
    `revoked/${nextHash}`,
    `private/classscribe-billing/accounts/${codeHash}`,
    `private/classscribe-billing/accounts/${nextHash}`,
    `private/classscribe-billing/aliases/${codeHash}`,
    `private/classscribe-billing/aliases/${nextHash}`,
    `private/classscribe-billing/usage/${codeHash}/%`,
    `private/classscribe-billing/usage/${nextHash}/%`,
  ];
  const app = express();
  app.use(express.json());
  app.use("/api", legacyRouter);
  const server = app.listen(0, "127.0.0.1");
  const listening = new Promise((resolve) => server.once("listening", resolve));

  try {
    await listening;
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const getStatus = (libraryCode) =>
      fetch(`${base}/billing/status`, { headers: { "X-CS-User": libraryCode } });
    const setCourse = (libraryCode, courseId) =>
      fetch(`${base}/db/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CS-User": libraryCode },
        body: JSON.stringify({
          path: `data/users/${libraryCode}/lib/courses/${courseId}`,
          data: { id: courseId },
        }),
      });

    const initial = await getStatus(code);
    assert.equal(initial.status, 200);
    const resetAt = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString();
    assert.deepEqual(await initial.json(), {
      plan: "free",
      status: "inactive",
      billingSource: null,
      billingConflict: false,
      recordingHoursUsed: 0,
      recordingHoursLimit: 5,
      courseLimit: 3,
      recordingCountUsed: 0,
      recordingCountLimit: 5,
      transcriptionCountUsed: 0,
      transcriptionCountLimit: 5,
      askCountUsed: 0,
      askCountLimit: 1,
      askCountRemaining: 1,
      askResetAt: resetAt,
      billingReadiness: {
        ready: false,
        mode: null,
        code: "stripe_initialization_not_run",
        message: "Stripe checkout and billing management are unavailable. Please try again later.",
      },
    });
    const refreshedStatusResponse = await fetch(`${base}/billing/status?refresh=1`, {
      headers: { "X-CS-User": code },
    });
    assert.equal(refreshedStatusResponse.status, 200);
    assert.equal((await refreshedStatusResponse.json()).plan, "free");
    assert.equal((await fetch(`${base}/billing/status?refresh=true`, {
      headers: { "X-CS-User": code },
    })).status, 400);
    for (const id of ["course-1", "course-2", "course-3"]) {
      assert.equal((await setCourse(code, id)).status, 200);
    }
    const overLimit = await setCourse(code, "course-4");
    assert.equal(overLimit.status, 402);
    assert.equal((await overLimit.json()).code, "plan_limit");

    for (let index = 0; index < 5; index += 1) {
      const reservation = await reserveRecordingUsage(code, 3600);
      assert.equal(reservation.allowed, true);
      assert.match(reservation.month, /^\d{4}-\d{2}$/);
    }
    const [rotated] = await Promise.all([
      fetch(`${base}/db/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CS-User": code },
        body: JSON.stringify({ confirm: true, nextCode }),
      }),
      releaseRecordingUsage(code, 3600),
    ]);
    assert.equal(rotated.status, 200);
    assert.equal((await rotated.json()).code, nextCode);
    assert.equal((await getStatus(code)).status, 403);
    const afterRotation = await getStatus(nextCode);
    const rotatedStatusBody = await afterRotation.json();
    assert.equal(afterRotation.status, 200, JSON.stringify(rotatedStatusBody));
    assert.equal(rotatedStatusBody.recordingHoursUsed, 4);

    const unsupportedClientPrice = await fetch(`${base}/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CS-User": nextCode },
      body: JSON.stringify({ plan: "student", priceId: "price_client_supplied" }),
    });
    assert.equal(unsupportedClientPrice.status, 400);
  } finally {
    if (previousProjectId === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = previousProjectId;
    server.close();
    for (const path of paths) {
      if (path.includes("%")) {
        await db.delete(classscribeLegacyDocumentsTable)
          .where(like(classscribeLegacyDocumentsTable.path, path));
      } else {
        await db.delete(classscribeLegacyDocumentsTable)
          .where(eq(classscribeLegacyDocumentsTable.path, path));
      }
    }
  }
});

test("Student Ask quota is atomic, monthly, idempotent by fingerprint, and releases provider failures", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const month = new Date().toISOString().slice(0, 7);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const usagePath = `private/classscribe-billing/usage/${libraryHash}/${month}`;
  await db.insert(classscribeLegacyDocumentsTable).values({
    path: accountPath,
    data: {
      libraryHash,
      plan: "student",
      status: "active",
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    },
  });
  try {
    const first = await reserveAskUsage(code, "round-1", "Explain the chain rule");
    assert.equal(first.allowed, true);
    if (!first.allowed) throw new Error("Expected Ask reservation");
    assert.equal(first.alreadyCounted, false);
    const pendingStatus = await getLibraryBillingStatus(code);
    assert.equal(pendingStatus.askCountUsed, 0);
    assert.equal(pendingStatus.askCountRemaining, 25);
    await finishAskUsage(code, "round-1", "Explain the chain rule", first.reservationToken, "end_turn", [], first.month);

    const duplicate = await reserveAskUsage(code, "round-1", "Explain the chain rule");
    assert.equal(duplicate.allowed, false);
    if (!duplicate.allowed) assert.equal(duplicate.limit, "continuation");
    const newQuestionWithReusedId = await reserveAskUsage(code, "round-1", "A changed first question");
    assert.equal(newQuestionWithReusedId.allowed, true);
    if (!newQuestionWithReusedId.allowed) throw new Error("Reusing an askId with another fingerprint is a new ask");
    await releaseAskUsage(code, "round-1", "A changed first question", newQuestionWithReusedId.reservationToken, newQuestionWithReusedId.month);
    const newIdForSameQuestion = await reserveAskUsage(code, "different-id", "Explain the chain rule");
    assert.equal(newIdForSameQuestion.allowed, true);
    if (!newIdForSameQuestion.allowed) throw new Error("A separate askId is a new ask, even for repeated text");
    await releaseAskUsage(code, "different-id", "Explain the chain rule", newIdForSameQuestion.reservationToken, newIdForSameQuestion.month);
    const statusAfterSuccess = await getLibraryBillingStatus(code);
    assert.equal(statusAfterSuccess.askCountUsed, 1);
    assert.equal(statusAfterSuccess.askCountRemaining, 24);

    const failed = await reserveAskUsage(code, "failed-round", "A provider error should release this");
    assert.equal(failed.allowed, true);
    if (!failed.allowed) throw new Error("Expected failed-round reservation");
    await releaseAskUsage(code, "failed-round", "A provider error should release this", failed.reservationToken, failed.month);
    const retry = await reserveAskUsage(code, "failed-round", "A provider error should release this");
    assert.equal(retry.allowed, true);
    if (!retry.allowed) throw new Error("Expected retry reservation after release");
    await finishAskUsage(code, "failed-round", "A provider error should release this", retry.reservationToken, "end_turn", [], retry.month);

    const reservations = await Promise.all(Array.from({ length: 30 }, (_, index) =>
      reserveAskUsage(code, `parallel-${index}`, `Concurrent distinct question ${index}`),
    ));
    const allowed = reservations.filter((result) => result.allowed && !result.alreadyCounted);
    const denied = reservations.filter((result) => !result.allowed && result.limit === "askCount");
    assert.equal(allowed.length, 23);
    assert.equal(denied.length, 7);
    await Promise.all(allowed.map((result, index) => {
      if (!result.allowed || !result.reservationToken) return Promise.resolve();
      const reservationIndex = reservations.indexOf(result);
      return finishAskUsage(code, `parallel-${reservationIndex}`, `Concurrent distinct question ${reservationIndex}`, result.reservationToken, "end_turn", [], result.month);
    }));
    const finalStatus = await getLibraryBillingStatus(code);
    assert.equal(finalStatus.askCountUsed, 25);
    assert.equal(finalStatus.askCountRemaining, 0);
    assert.match(finalStatus.askResetAt, /^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    const exhausted = await reserveAskUsage(code, "over-limit", "One more unique question");
    assert.equal(exhausted.allowed, false);
    if (!exhausted.allowed) assert.equal(exhausted.limit, "askCount");
  } finally {
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, usagePath));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
  }
});

test("dedicated Ask charges only a successful first provider round and retries safely", async () => {
  const code = freshLibraryCode();
  const roundCode = freshLibraryCode();
  const libraryHash = hash(code);
  const roundLibraryHash = hash(roundCode);
  const month = new Date().toISOString().slice(0, 7);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const roundAccountPath = `private/classscribe-billing/accounts/${roundLibraryHash}`;
  const usagePath = `private/classscribe-billing/usage/${libraryHash}/${month}`;
  const roundUsagePath = `private/classscribe-billing/usage/${roundLibraryHash}/${month}`;
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const originalApiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  await db.insert(classscribeLegacyDocumentsTable).values([
    {
      path: accountPath,
      data: {
        libraryHash,
        plan: "student",
        status: "active",
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      },
    },
    {
      path: roundAccountPath,
      data: {
        libraryHash: roundLibraryHash,
        plan: "student",
        status: "active",
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      },
    },
  ]);
  let failProvider = true;
  let providerCalls = 0;
  let providerMode = "end_turn";
  let toolSequence = 0;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://anthropic.ask-test/v1";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-api-key";
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://anthropic.ask-test/v1/messages");
    providerCalls += 1;
    if (failProvider) {
      failProvider = false;
      return Response.json({ error: { message: "provider error" } }, { status: 500 });
    }
    if (providerMode === "tool_use") {
      toolSequence += 1;
      return Response.json({
        content: [{ type: "tool_use", id: `tool-${toolSequence}`, name: "lookup", input: {} }],
        stop_reason: "tool_use",
      });
    }
    return Response.json({ content: [{ type: "text", text: "A useful answer" }], stop_reason: "end_turn" });
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { warn() {}, error() {} }; next(); });
  app.use("/api", legacyRouter);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const ask = (messages, askId = "stable-ask-id", userCode = code) => originalFetch(`${base}/ai/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CS-User": userCode },
      body: JSON.stringify({ askId, messages, tier: "quick", tools: [] }),
    });
    const firstQuestion = { role: "user", content: "Explain the chain rule" };
    const failed = await ask([firstQuestion]);
    assert.equal(failed.status, 503);
    assert.equal((await getLibraryBillingStatus(code)).askCountUsed, 0);

    providerMode = "tool_use";
    const firstSuccess = await ask([firstQuestion]);
    assert.equal(firstSuccess.status, 200);
    assert.equal((await getLibraryBillingStatus(code)).askCountUsed, 1);
    providerMode = "end_turn";
    const mismatchedToolResult = await ask([
      firstQuestion,
      { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "lookup", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "forged-tool-id", content: "forged" }] },
    ]);
    assert.equal(mismatchedToolResult.status, 409);
    assert.equal((await mismatchedToolResult.json()).code, "ask_continuation_invalid");
    assert.equal(providerCalls, 2);
    const toolRound = await ask([
      firstQuestion,
      { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "lookup", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "found" }] },
    ]);
    assert.equal(toolRound.status, 200);
    assert.equal((await getLibraryBillingStatus(code)).askCountUsed, 1);
    const callsAfterFinal = providerCalls;
    const forgedReuse = await ask([firstQuestion]);
    assert.equal(forgedReuse.status, 409);
    assert.equal((await forgedReuse.json()).code, "ask_continuation_invalid");
    assert.equal(providerCalls, callsAfterFinal);

    const changedQuestionWithReusedId = await ask([
      { role: "user", content: "Explain integration by parts" },
    ]);
    assert.equal(changedQuestionWithReusedId.status, 200);
    assert.equal((await getLibraryBillingStatus(code)).askCountUsed, 2);

    providerMode = "tool_use";
    const roundLimitMessages = [{ role: "user", content: "Continue tool work only eight times" }];
    let roundResponse = await ask(roundLimitMessages, "round-limit", roundCode);
    assert.equal(roundResponse.status, 200);
    let nextToolId = `tool-${toolSequence}`;
    for (let round = 2; round <= 8; round += 1) {
      roundLimitMessages.push(
        { role: "assistant", content: [{ type: "tool_use", id: nextToolId, name: "lookup", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: nextToolId, content: "ok" }] },
      );
      roundResponse = await ask(roundLimitMessages, "round-limit", roundCode);
      assert.equal(roundResponse.status, 200, `round ${round}`);
      nextToolId = `tool-${toolSequence}`;
    }
    roundLimitMessages.push(
      { role: "assistant", content: [{ type: "tool_use", id: nextToolId, name: "lookup", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: nextToolId, content: "ok" }] },
    );
    const ninthRound = await ask(roundLimitMessages, "round-limit", roundCode);
    assert.equal(ninthRound.status, 409);
    assert.equal((await ninthRound.json()).code, "ask_round_limit");
    assert.equal(providerCalls, 12);
    assert.equal((await getLibraryBillingStatus(code)).askCountUsed, 2);
    assert.equal((await getLibraryBillingStatus(roundCode)).askCountUsed, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    else process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = originalBaseUrl;
    if (originalApiKey === undefined) delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
    else process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = originalApiKey;
    await new Promise((resolve) => server.close(resolve));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, usagePath));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, roundUsagePath));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, roundAccountPath));
  }
});

test("saved recording reservations are monthly, idempotent, and releasable", async () => {
  const code = freshLibraryCode();
  const usagePrefix = `private/classscribe-billing/usage/${hash(code)}/%`;
  const profilePath = `data/users/${code}/profile`;
  const priorProject = process.env.REVENUECAT_PROJECT_ID;
  const priorProxy = globalThis.__scribeProxy;
  const restoreCreditsControl = await setCreditsMigrationControlCurrency("CRD");
  const projectId = "rc-recording-test";
  const lectureId = `recording-lecture-${randomUUID()}`;
  const courseId = `recording-course-${randomUUID()}`;
  const consentIds = new Map();
  let balance = 0;
  process.env.REVENUECAT_PROJECT_ID = projectId;
  const customerMock = mockRevenueCatCustomer(projectId);
  globalThis.__scribeProxy = async (connector, path, options = {}) => {
    const url = new URL(path, "https://revenuecat.test");
    if (url.pathname.endsWith("/virtual_currencies") && options.method === "GET") {
      return Response.json({ object: "list", items: [{
        object: "virtual_currency_balance", currency_code: "CRD", balance,
        description: "Scribe Credits", name: "Scribe Credits",
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies/transactions") && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.adjustments, { CRD: 5 });
      balance += body.adjustments.CRD;
      return Response.json({ object: "virtual_currency_transaction", id: "recording-welcome" });
    }
    return customerMock(connector, path, options);
  };
  const app = express();
  app.use(express.json());
  app.use("/api", legacyRouter);
  const server = app.listen(0, "127.0.0.1");
  const listening = new Promise((resolve) => server.once("listening", resolve));
  try {
    await listening;
    await db.insert(classscribeLegacyDocumentsTable).values({
      path: profilePath,
      data: { id: code },
    }).onConflictDoNothing();
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (action, recordingId) => {
      const body = { recordingId };
      if (action === "reserve") {
        let consentId = consentIds.get(recordingId);
        if (!consentId) {
          consentId = randomUUID();
          consentIds.set(recordingId, consentId);
        }
        await db.insert(classscribeConsentsTable).values({
          id: consentId,
          libraryHash: hash(code),
          sessionId: recordingId,
          lectureId,
          courseId,
          version: privacyConsentConfig.version,
          statements: [...privacyConsentConfig.statements],
          platform: "web",
          appVersion: "billing-test",
          accommodation: false,
        }).onConflictDoNothing();
        Object.assign(body, { consentId, sessionId: recordingId, lectureId, courseId });
      }
      return fetch(`${base}/billing/recordings/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CS-User": code,
          Authorization: `Bearer ${code}`,
        },
        body: JSON.stringify(body),
      });
    };
    const month = new Date().toISOString().slice(0, 7);
    await db.insert(classscribeLegacyDocumentsTable).values({
      path: `private/classscribe-billing/usage/${hash(code)}/${month}`,
      data: {
        libraryHash: hash(code),
        month,
        seconds: 0,
        recordingCountUsed: 0,
        transcriptionCountUsed: 0,
        reservations: {
          "recording:stale-id": {
            kind: "recording",
            createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
          },
        },
      },
    }).onConflictDoNothing();
    assert.equal((await fetch(`${base}/billing/status`, {
      headers: { "X-CS-User": code },
    })).status, 200);
    const staleReservation = await request("reserve", "stale-id");
    assert.equal(
      staleReservation.status,
      200,
      staleReservation.status === 200 ? undefined : await staleReservation.clone().text(),
    );

    const duplicate = await Promise.all([
      request("reserve", "same-recording"),
      request("reserve", "same-recording"),
    ]);
    assert.ok(duplicate.every((response) => response.status === 200));
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await request("reserve", `recording-${index}`)).status, 200);
    }
    const capped = await request("reserve", "recording-over-limit");
    assert.equal(capped.status, 402);
    const creditQuote = await capped.json();
    assert.equal(creditQuote.code, "credits_required");
    assert.equal(creditQuote.balance, 5);

    const finished = await request("finish", "same-recording");
    assert.equal(finished.status, 200);
    assert.equal((await request("finish", "same-recording")).status, 200);
    const statusResponse = await fetch(`${base}/billing/status`, {
      headers: { "X-CS-User": code },
    });
    const status = await statusResponse.json();
    assert.equal(status.recordingCountUsed, 1);
    assert.equal(typeof status.recordingCountLimit, "number");
    assert.equal(status.transcriptionCountUsed, 0);

    assert.equal((await request("release", "recording-0")).status, 200);
    assert.equal((await request("reserve", "replacement")).status, 200);
  } finally {
    server.close();
    await db.delete(classscribeLegacyDocumentsTable)
      .where(like(classscribeLegacyDocumentsTable.path, usagePrefix));
    await db.delete(classscribeConsentsTable)
      .where(eq(classscribeConsentsTable.libraryHash, hash(code)));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, profilePath));
    await restoreCreditsControl();
    if (priorProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProject;
    if (priorProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = priorProxy;
  }
});

test("late finish claims its original month after expiry and returns plan_limit when that month is full", async () => {
  const availableCode = freshLibraryCode();
  const fullCode = freshLibraryCode();
  const usagePrefix = (code) => `private/classscribe-billing/usage/${hash(code)}/%`;
  const priorDate = new Date();
  priorDate.setUTCDate(1);
  priorDate.setUTCMonth(priorDate.getUTCMonth() - 1);
  const priorMonth = priorDate.toISOString().slice(0, 7);
  const createdAt = new Date(Date.parse(`${priorMonth}-15T12:00:00.000Z`)).toISOString();
  const usagePath = (code) => `private/classscribe-billing/usage/${hash(code)}/${priorMonth}`;
  const app = express();
  app.use(express.json());
  app.use("/api", legacyRouter);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    for (const [code, full] of [[availableCode, false], [fullCode, true]]) {
      await db.insert(classscribeLegacyDocumentsTable).values({
        path: usagePath(code),
        data: {
          libraryHash: hash(code),
          month: priorMonth,
          seconds: 0,
          recordingCountUsed: full ? 5 : 0,
          recordingIds: full ? ["old-1", "old-2", "old-3", "old-4", "old-5"] : [],
          transcriptionCountUsed: 0,
          reservations: {
            "recording:late-local-save": { kind: "recording", createdAt },
          },
        },
      });
    }
    const finish = (code) => fetch(`http://127.0.0.1:${server.address().port}/api/billing/recordings/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CS-User": code },
      body: JSON.stringify({ recordingId: "late-local-save" }),
    });
    const lateFinish = await finish(availableCode);
    assert.equal(lateFinish.status, 200);
    const lateResult = await lateFinish.json();
    assert.equal(lateResult.billing.recordingCountUsed, 1);
    const [claimedPriorMonth] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, usagePath(availableCode)));
    assert.equal(claimedPriorMonth.data.recordingCountUsed, 1);
    assert.deepEqual(claimedPriorMonth.data.recordingIds, ["late-local-save"]);

    const fullMonthFinish = await finish(fullCode);
    assert.equal(fullMonthFinish.status, 402);
    assert.equal((await fullMonthFinish.json()).code, "plan_limit");
    const [fullPriorMonth] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, usagePath(fullCode)));
    assert.equal(fullPriorMonth.data.recordingCountUsed, 5);
    assert.equal(fullPriorMonth.data.reservations["recording:late-local-save"].kind, "expired_recording");
  } finally {
    server.close();
    await Promise.all([availableCode, fullCode].map((code) =>
      db.delete(classscribeLegacyDocumentsTable).where(like(classscribeLegacyDocumentsTable.path, usagePrefix(code))),
    ));
  }
});

for (const [plan, count, hours] of [["student", 20, 40], ["pro", 60, 120]]) {
test(`${plan} transcription overage requires confirmation and charges one duration when count and hours are exhausted`, async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const month = new Date().toISOString().slice(0, 7);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const usagePath = `private/classscribe-billing/usage/${libraryHash}/${month}`;
  try {
    await db.insert(classscribeLegacyDocumentsTable).values([
      { path: accountPath, data: { libraryHash, plan, status: "active",
        periodEnd: new Date(Date.now() + 30 * 86400_000).toISOString() } },
      { path: usagePath, data: { month, seconds: hours * 3600 + 1800,
        transcriptionCountUsed: count, recordingCountUsed: count } },
    ]);
    const blocked = await reserveTranscriptionUsage(code, 600, "pro-no-credit-confirmation");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.limit, "transcriptionCount");
    assert.equal(blocked.overageSeconds, 600, "quote only the new attempt, not historical paid hours");
    assert.equal(blocked.status.recordingHoursLimit, hours);
    assert.equal(blocked.status.recordingCountLimit, count);
    assert.equal(blocked.status.transcriptionCountLimit, count);
    const confirmed = await reserveTranscriptionUsage(code, 600, "pro-credit-confirmed", true);
    assert.equal(confirmed.allowed, true);
    assert.equal(confirmed.overageSeconds, 600, "exhausting both allowances must not double charge");
    const concurrent = await reserveTranscriptionUsage(code, 600, "pro-credit-confirmed", true);
    assert.equal(concurrent.allowed, false);
    assert.equal(concurrent.limit, "inProgress");
    await releaseTranscriptionUsage(code, "pro-credit-confirmed", confirmed.month);
    const rolledBack = await getLibraryBillingStatus(code);
    assert.equal(rolledBack.transcriptionCountUsed, count);
    assert.equal(rolledBack.recordingHoursUsed, hours + 0.5);
    const completed = await reserveTranscriptionUsage(code, 900, "pro-credit-success", true);
    assert.equal(completed.allowed, true);
    assert.equal(completed.overageSeconds, 900);
    await finishTranscriptionUsage(code, "pro-credit-success", completed.month);
    const replay = await reserveTranscriptionUsage(code, 900, "pro-credit-success", true);
    assert.equal(replay.allowed, true);
    assert.equal(replay.alreadyCompleted, true);
    assert.equal((await getLibraryBillingStatus(code)).transcriptionCountUsed, count + 1);
    const next = await reserveTranscriptionUsage(code, 600, "pro-next-without-confirmation");
    assert.equal(next.allowed, false, "Paid plans never get an automatic free bypass after paying once");
  } finally {
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, usagePath));
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, accountPath));
  }
});
}

test("Student count-only overage leaves saved recordings and course limits unchanged; a new month restores included usage", async () => {
  const code = freshLibraryCode(), libraryHash = hash(code);
  const month = new Date().toISOString().slice(0, 7);
  const prior = new Date();
  prior.setUTCDate(1);
  prior.setUTCMonth(prior.getUTCMonth() - 1);
  const priorMonth = prior.toISOString().slice(0, 7);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const usagePath = `private/classscribe-billing/usage/${libraryHash}/${month}`;
  const priorPath = `private/classscribe-billing/usage/${libraryHash}/${priorMonth}`;
  try {
    await db.insert(classscribeLegacyDocumentsTable).values([
      { path: accountPath, data: { libraryHash, plan: "student", status: "active",
        periodEnd: new Date(Date.now() + 30 * 86400_000).toISOString() } },
      { path: priorPath, data: { month: priorMonth, seconds: 40 * 3600,
        transcriptionCountUsed: 25, recordingCountUsed: 25 } },
    ]);
    const fresh = await reserveTranscriptionUsage(code, 600, "included-new-month");
    assert.equal(fresh.allowed, true);
    assert.equal(fresh.overageSeconds, undefined, "last month's paid overage does not carry into base usage");
    await releaseTranscriptionUsage(code, "included-new-month", fresh.month);
    await db.update(classscribeLegacyDocumentsTable).set({ data: {
      month, seconds: 600, transcriptionCountUsed: 20, recordingCountUsed: 3,
    } }).where(eq(classscribeLegacyDocumentsTable.path, usagePath));
    const quote = await reserveTranscriptionUsage(code, 601, "count-only-quote");
    assert.equal(quote.allowed, false);
    assert.equal(quote.limit, "transcriptionCount");
    assert.equal(quote.overageSeconds, 601, "a count overage pays the new duration even with hours left");
    const confirmed = await reserveTranscriptionUsage(code, 601, "count-only-confirmed", true);
    assert.equal(confirmed.allowed, true);
    assert.equal(confirmed.overageSeconds, 601);
    await finishTranscriptionUsage(code, "count-only-confirmed", confirmed.month);
    const status = await getLibraryBillingStatus(code);
    assert.equal(status.recordingCountUsed, 3);
    assert.equal(status.recordingCountLimit, 20);
    assert.equal(status.courseLimit, null);
    assert.equal(status.transcriptionCountUsed, 21);
    // An expired subscription must not keep the paid count-overage capability.
    await db.update(classscribeLegacyDocumentsTable).set({ data: {
      libraryHash, plan: "student", status: "inactive",
    } }).where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    const inactive = await reserveTranscriptionUsage(code, 600, "expired-paid", true);
    assert.equal(inactive.allowed, false);
    assert.equal(inactive.limit, "transcriptionCount");
    assert.equal(inactive.status.plan, "free");
  } finally {
    for (const path of [usagePath, priorPath, accountPath]) {
      await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path));
    }
  }
});

test("Student transcription endpoint quotes exhausted counts and rejects stale confirmation costs without consuming usage", async () => {
  const code = freshLibraryCode(), libraryHash = hash(code);
  const month = new Date().toISOString().slice(0, 7);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const usagePath = `private/classscribe-billing/usage/${libraryHash}/${month}`;
  const priorProject = process.env.REVENUECAT_PROJECT_ID;
  const priorProxy = globalThis.__scribeProxy;
  process.env.REVENUECAT_PROJECT_ID = "student-extra-usage-test";
  const customerProxy = mockRevenueCatCustomer(process.env.REVENUECAT_PROJECT_ID);
  globalThis.__scribeProxy = async (connector, path, options = {}) => {
    if (path.includes("/virtual_currencies/transactions")) return Response.json({});
    if (path.includes("/virtual_currencies")) return Response.json({ object: "list", items: [
      { currency_code: "CRD", balance: 10 }, { currency_code: "CREDITS", balance: 10 },
    ] });
    return customerProxy(connector, path, options);
  };
  const wav = Buffer.alloc(44 + 8_000, 128);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + 8_000, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8_000, 24); wav.writeUInt32LE(8_000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
  wav.write("data", 36); wav.writeUInt32LE(8_000, 40);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { warn() {}, error() {}, info() {} }; next(); });
  app.use("/api", legacyRouter);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    await db.insert(classscribeLegacyDocumentsTable).values([
      { path: accountPath, data: { libraryHash, plan: "student", status: "active",
        periodEnd: new Date(Date.now() + 30 * 86400_000).toISOString() } },
      { path: usagePath, data: { month, seconds: 600, transcriptionCountUsed: 20, recordingCountUsed: 2 } },
    ]);
    const body = { audio: wav.toString("base64"), mime: "audio/wav", timed: false };
    const post = async (options = {}) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/transcribe`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-CS-User": code },
        body: JSON.stringify({ ...body, ...options }),
      });
      return { status: response.status, body: await response.json() };
    };
    const quote = await post();
    assert.equal(quote.status, 402);
    assert.equal(quote.body.code, "credits_required");
    assert.equal(quote.body.cost, 1);
    assert.equal(quote.body.overageSeconds, 1);
    assert.match(quote.body.error, /included transcriptions/);
    const stale = await post({ useCredits: true, requestId: quote.body.requestId, cost: 2 });
    assert.equal(stale.status, 402);
    assert.equal(stale.body.code, "credits_required");
    assert.equal(stale.body.cost, 1);
    const status = await getLibraryBillingStatus(code);
    assert.equal(status.transcriptionCountUsed, 20);
    assert.equal(status.recordingCountUsed, 2);
    assert.equal(status.recordingHoursUsed, 0.17);
    const [usage] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, usagePath));
    assert.equal(usage.data.seconds, 600, "stale confirmation must release its reserved second exactly");
  } finally {
    await new Promise(resolve => server.close(resolve));
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, usagePath));
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    await db.delete(classscribeCreditTransactionsTable).where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    if (priorProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProject;
    if (priorProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = priorProxy;
  }
});

test("transcription hour credit quotes do not charge previously paid overage again", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const month = new Date().toISOString().slice(0, 7);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const usagePath = `private/classscribe-billing/usage/${libraryHash}/${month}`;
  try {
    await db.insert(classscribeLegacyDocumentsTable).values({
      path: accountPath, data: { libraryHash, plan: "pro", status: "active",
        periodEnd: new Date(Date.now() + 30 * 86400_000).toISOString() },
    });
    for (const [seconds, duration, expectedExtra] of [
      [120 * 3600 - 60, 120, 60], [120 * 3600 + 1800, 600, 600],
    ]) {
      await db.insert(classscribeLegacyDocumentsTable).values({
        path: usagePath, data: { month, seconds, transcriptionCountUsed: 0 },
      }).onConflictDoUpdate({ target: classscribeLegacyDocumentsTable.path,
        set: { data: { month, seconds, transcriptionCountUsed: 0 } } });
      const quote = await reserveTranscriptionUsage(code, duration, "hour-credit-quote");
      assert.equal(quote.allowed, false);
      assert.equal(quote.limit, "recordingHours");
      assert.equal(quote.overageSeconds, expectedExtra);
      const confirmed = await reserveTranscriptionUsage(code, duration, "hour-credit-confirmed", true);
      assert.equal(confirmed.allowed, true);
      assert.equal(confirmed.overageSeconds, expectedExtra);
      await releaseTranscriptionUsage(code, "hour-credit-confirmed", confirmed.month);
    }
  } finally {
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, usagePath));
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, accountPath));
  }
});

test("transcription reservations atomically enforce count and hour limits and roll back failures", async () => {
  const code = freshLibraryCode();
  const usagePrefix = `private/classscribe-billing/usage/${hash(code)}/%`;
  try {
    for (let index = 0; index < 5; index += 1) {
      const reservation = await reserveTranscriptionUsage(code, 60, `successful-${index}`);
      assert.equal(reservation.allowed, true);
      await finishTranscriptionUsage(code, `successful-${index}`, reservation.month);
    }
    const capped = await reserveTranscriptionUsage(code, 60, "sixth-transcription");
    assert.equal(capped.allowed, false);
    if (!capped.allowed) assert.equal(capped.limit, "transcriptionCount");

    const statusBeforeRollback = await getLibraryBillingStatus(code);
    assert.equal(statusBeforeRollback.transcriptionCountUsed, 5);
    assert.equal(statusBeforeRollback.recordingHoursUsed, 0.08);

    // Release a pending reservation as a failed provider request: neither its
    // count slot nor its reserved duration remains charged.
    const rollbackCode = freshLibraryCode();
    const pending = await reserveTranscriptionUsage(rollbackCode, 3600, "provider-failure");
    assert.equal(pending.allowed, true);
    await releaseTranscriptionUsage(rollbackCode, "provider-failure", pending.month);
    const rolledBack = await getLibraryBillingStatus(rollbackCode);
    assert.equal(rolledBack.transcriptionCountUsed, 0);
    assert.equal(rolledBack.recordingHoursUsed, 0);
    await db.delete(classscribeLegacyDocumentsTable)
      .where(like(classscribeLegacyDocumentsTable.path, `private/classscribe-billing/usage/${hash(rollbackCode)}/%`));
  } finally {
    await db.delete(classscribeLegacyDocumentsTable)
      .where(like(classscribeLegacyDocumentsTable.path, usagePrefix));
  }
});

test("concurrent checkout requests reuse one Stripe session per library", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const previousDomain = process.env.REPLIT_DOMAINS;
  const previousRevenueCatProjectId = process.env.REVENUECAT_PROJECT_ID;
  process.env.REPLIT_DOMAINS = "billing-test.example";
  process.env.REVENUECAT_PROJECT_ID = "rc_checkout_test";
  const sessionsByKey = new Map();
  const stripe = {
    products: {
      list: async () => ({
        data: [
          { id: "prod_student", metadata: { classscribe_plan: "student" } },
          { id: "prod_pro", metadata: { classscribe_plan: "pro" } },
        ],
      }),
    },
    prices: {
      list: async ({ product }) => ({
        data: [{
          id: product === "prod_student" ? "price_student" : "price_pro",
          currency: "usd",
          unit_amount: product === "prod_student" ? 799 : 1299,
          recurring: { interval: "month" },
          metadata: { classscribe_plan: product === "prod_student" ? "student" : "pro" },
        }],
      }),
    },
    customers: {
      create: async () => ({ id: "cus_billing_test" }),
    },
    checkout: {
      sessions: {
        create: async (params, options) => {
          if (!sessionsByKey.has(options.idempotencyKey)) {
            const session = {
              id: `cs_${sessionsByKey.size + 1}`,
              status: "open",
              url: `https://checkout.stripe.test/${sessionsByKey.size + 1}`,
              metadata: params.metadata,
              customer: params.customer,
            };
            sessionsByKey.set(options.idempotencyKey, session);
          }
          return sessionsByKey.get(options.idempotencyKey);
        },
        retrieve: async (id) => [...sessionsByKey.values()].find((session) => session.id === id),
        list: async () => ({ data: [] }),
      },
    },
  };

  try {
    const results = await Promise.all([
      createLibraryCheckoutWithStripe(code, "student", "/", stripe, freeRevenueCatSnapshot),
      createLibraryCheckoutWithStripe(code, "student", "/", stripe, freeRevenueCatSnapshot),
    ]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(sessionsByKey.size, 1);
    const [account] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath))
      .limit(1);
    assert.match(account.data.billingAccountId, /^[0-9a-f-]{36}$/);
    await assert.rejects(
      createLibraryCheckoutWithStripe(code, "pro", "/", stripe, freeRevenueCatSnapshot),
      (error) => error.httpStatus === 409,
    );
    assert.equal(sessionsByKey.size, 1);
  } finally {
    if (previousDomain === undefined) delete process.env.REPLIT_DOMAINS;
    else process.env.REPLIT_DOMAINS = previousDomain;
    if (previousRevenueCatProjectId === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = previousRevenueCatProjectId;
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
  }
});

test("checkout accepts the exact injected Expo preview host without allowing other origins", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const previousDomain = process.env.REPLIT_DOMAINS;
  const previousExpoDomain = process.env.REPLIT_EXPO_DEV_DOMAIN;
  const previousRevenueCatProjectId = process.env.REVENUECAT_PROJECT_ID;
  process.env.REPLIT_DOMAINS = "billing-test.example";
  process.env.REPLIT_EXPO_DEV_DOMAIN = "classscribe-preview.expo.dev";
  process.env.REVENUECAT_PROJECT_ID = "rc_checkout_test";
  let sessionParams;
  const stripe = {
    products: {
      list: async () => ({
        data: [{ id: "prod_student", metadata: { classscribe_plan: "student" } }],
      }),
    },
    prices: {
      list: async () => ({
        data: [{
          id: "price_student",
          currency: "usd",
          unit_amount: 799,
          recurring: { interval: "month" },
          metadata: { classscribe_plan: "student" },
        }],
      }),
    },
    customers: { create: async () => ({ id: "cus_expo_preview_test" }) },
    checkout: {
      sessions: {
        create: async (params) => {
          sessionParams = params;
          return { id: "cs_expo_preview_test", status: "open", url: "https://checkout.stripe.test/expo" };
        },
      },
    },
  };

  try {
    const checkout = await createLibraryCheckoutWithStripe(
      code,
      "student",
      "https://classscribe-preview.expo.dev/plans",
      stripe,
      freeRevenueCatSnapshot,
    );
    assert.equal(checkout.url, "https://checkout.stripe.test/expo");
    assert.equal(new URL(sessionParams.success_url).origin, "https://classscribe-preview.expo.dev");
    assert.equal(new URL(sessionParams.success_url).pathname, "/plans");
    assert.equal(new URL(sessionParams.cancel_url).origin, "https://classscribe-preview.expo.dev");

    await assert.rejects(
      createLibraryCheckoutWithStripe(code, "student", "https://attacker.example/plans", stripe, freeRevenueCatSnapshot),
      (error) => error.httpStatus === 400 && error.code === "invalid_argument",
    );

    process.env.REPLIT_EXPO_DEV_DOMAIN = "https://attacker.example/path";
    await assert.rejects(
      createLibraryCheckoutWithStripe(code, "student", "https://attacker.example/plans", stripe, freeRevenueCatSnapshot),
      (error) => error.httpStatus === 400 && error.code === "invalid_argument",
    );
  } finally {
    if (previousDomain === undefined) delete process.env.REPLIT_DOMAINS;
    else process.env.REPLIT_DOMAINS = previousDomain;
    if (previousExpoDomain === undefined) delete process.env.REPLIT_EXPO_DEV_DOMAIN;
    else process.env.REPLIT_EXPO_DEV_DOMAIN = previousExpoDomain;
    if (previousRevenueCatProjectId === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = previousRevenueCatProjectId;
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
  }
});

test("checkout blocks a freshly verified native purchase and fails closed on RevenueCat provider errors", async () => {
  const code = freshLibraryCode();
  const failingCode = freshLibraryCode();
  const notFoundCode = freshLibraryCode();
  const accountPaths = [code, failingCode, notFoundCode].map((libraryCode) =>
    `private/classscribe-billing/accounts/${hash(libraryCode)}`);
  const envKeys = ["REPLIT_DOMAINS", "REVENUECAT_PROJECT_ID", "REVENUECAT_TEST_STORE_APP_ID"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.REPLIT_DOMAINS = "billing-test.example";
  process.env.REVENUECAT_PROJECT_ID = "rc_checkout_native";
  process.env.REVENUECAT_TEST_STORE_APP_ID = "rc_checkout_native_test";
  let checkoutSessionCreates = 0;
  let lastCheckoutSession;
  const stripe = {
    products: {
      list: async () => ({ data: [{ id: "prod_student", metadata: { classscribe_plan: "student" } }] }),
    },
    prices: {
      list: async () => ({
        data: [{
          id: "price_student",
          currency: "usd",
          unit_amount: 799,
          recurring: { interval: "month" },
          metadata: { classscribe_plan: "student" },
        }],
      }),
    },
    customers: { create: async () => ({ id: "cus_checkout_native_test" }) },
    checkout: {
      sessions: {
        create: async () => {
          checkoutSessionCreates += 1;
          lastCheckoutSession = {
            id: `cs_checkout_${checkoutSessionCreates}`,
            status: "open",
            url: "https://checkout.stripe.test/session",
          };
          return lastCheckoutSession;
        },
        retrieve: async () => lastCheckoutSession,
        list: async () => ({ data: [] }),
      },
    },
  };
  const nativeSnapshot = async (appUserId) => ({
    project: { id: "rc_checkout_native" },
    apps: [{ id: "rc_checkout_native_test", type: "test_store" }],
    products: [{
      id: "rc_checkout_native_student",
      app_id: "rc_checkout_native_test",
      store_identifier: "classscribe_student_monthly",
    }],
    customer: { id: "rc_checkout_native_customer", app_user_id: appUserId },
    activeEntitlements: { items: [{
      lookup_key: "classscribe_student",
      product_id: "rc_checkout_native_student",
      expires_at: Date.now() + 30 * 24 * 60 * 60_000,
    }] },
    subscriptions: { items: [{
      product_id: "rc_checkout_native_student",
      store: "TEST_STORE",
      status: "active",
      expires_at: Date.now() + 30 * 24 * 60 * 60_000,
      app_id: "rc_checkout_native_test",
    }] },
  });

  try {
    await assert.rejects(
      createLibraryCheckoutWithStripe(code, "student", "/", stripe, nativeSnapshot),
      (error) => error.httpStatus === 409 && error.code === "already_subscribed",
    );
    assert.equal(checkoutSessionCreates, 0);
    await assert.rejects(
      createLibraryCheckoutWithStripe(
        code,
        "student",
        "/",
        stripe,
        async (appUserId) => ({
          ...await freeRevenueCatSnapshot(appUserId),
          customerLookupNotFound: true,
        }),
      ),
      (error) => error.httpStatus === 503 && error.code === "revenuecat_customer_unavailable",
    );
    assert.equal(checkoutSessionCreates, 0);

    await assert.rejects(
      createLibraryCheckoutWithStripe(
        failingCode,
        "student",
        "/",
        stripe,
        async () => { throw new Error("RevenueCat unavailable"); },
      ),
    );
    assert.equal(checkoutSessionCreates, 0);

    const customerNotFoundSnapshot = async (appUserId) => ({
      ...await freeRevenueCatSnapshot(appUserId),
      customerLookupNotFound: true,
    });
    const freshFreeCheckout = await createLibraryCheckoutWithStripe(
      notFoundCode,
      "student",
      "/",
      stripe,
      customerNotFoundSnapshot,
    );
    assert.equal(freshFreeCheckout.url, "https://checkout.stripe.test/session");
    assert.equal(checkoutSessionCreates, 1);
    const retriedFreshFreeCheckout = await createLibraryCheckoutWithStripe(
      notFoundCode,
      "student",
      "/",
      stripe,
      customerNotFoundSnapshot,
    );
    assert.equal(retriedFreshFreeCheckout.url, freshFreeCheckout.url);
    assert.equal(checkoutSessionCreates, 1);
  } finally {
    for (const path of accountPaths) {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, path));
    }
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (typeof value === "string") process.env[key] = value;
      else delete process.env[key];
    }
  }
});

test("Student and Pro checkout returns unlock only their purchasing libraries after verified webhooks", async () => {
  const studentCode = freshLibraryCode();
  const proCode = freshLibraryCode();
  const outsiderCode = freshLibraryCode();
  const codes = [studentCode, proCode, outsiderCode];
  const eventIds = codes.slice(0, 2).map(() => `evt_${randomUUID()}`);
  const spoofEventId = `evt_${randomUUID()}`;
  const previousDomain = process.env.REPLIT_DOMAINS;
  const previousRevenueCatProjectId = process.env.REVENUECAT_PROJECT_ID;
  process.env.REPLIT_DOMAINS = "billing-test.example";
  process.env.REVENUECAT_PROJECT_ID = "rc_checkout_test";
  const sessions = new Map();
  const subscriptions = new Map();
  const checkoutCalls = [];
  const stripe = {
    products: {
      list: async () => ({
        data: ["student", "pro"].map((plan) => ({
          id: `prod_${plan}`,
          metadata: { classscribe_plan: plan },
        })),
      }),
      retrieve: async (id) => ({
        metadata: { classscribe_plan: id === "prod_pro" ? "pro" : "student" },
      }),
    },
    prices: {
      list: async ({ product }) => {
        const plan = product === "prod_pro" ? "pro" : "student";
        return { data: [{
          id: `price_${plan}`,
          currency: "usd",
          unit_amount: plan === "pro" ? 1299 : 799,
          recurring: { interval: "month" },
          metadata: { classscribe_plan: plan },
        }] };
      },
    },
    customers: {
      create: async (params) => ({
        id: `cus_${params.metadata.classscribe_library_hash.slice(0, 16)}`,
      }),
    },
    checkout: {
      sessions: {
        create: async (params, options) => {
          checkoutCalls.push({ params, options });
          const id = `cs_fixture_${checkoutCalls.length}`;
          const session = {
            id,
            status: "open",
            url: `https://checkout.stripe.test/${id}`,
            mode: "subscription",
            customer: params.customer,
            metadata: params.metadata,
            subscription: `sub_fixture_${checkoutCalls.length}`,
          };
          sessions.set(id, session);
          const plan = params.line_items[0].price.slice("price_".length);
          subscriptions.set(session.subscription, {
            id: session.subscription,
            customer: session.customer,
            status: "active",
            items: { data: [{
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
              price: {
                product: `prod_${plan}`,
                currency: "usd",
                unit_amount: plan === "pro" ? 1299 : 799,
                recurring: { interval: "month" },
              },
            }] },
            cancel_at_period_end: false,
          });
          return session;
        },
        list: async () => ({ data: [] }),
      },
    },
    subscriptions: {
      retrieve: async (id) => {
        assert.ok(subscriptions.has(id), `unknown test subscription ${id}`);
        return subscriptions.get(id);
      },
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api", legacyRouter);
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const status = async (code) => {
      const response = await fetch(`${base}/billing/status`, {
        headers: { "X-CS-User": code },
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const purchases = [[studentCode, "student"], [proCode, "pro"]];
    for (const [code, plan] of purchases) {
      const checkout = await createLibraryCheckoutWithStripe(
        code,
        plan,
        "/?tab=account",
        stripe,
        freeRevenueCatSnapshot,
      );
      assert.equal(checkout.url, `https://checkout.stripe.test/cs_fixture_${checkoutCalls.length}`);
    }
    assert.equal(checkoutCalls.length, 2);
    for (const [index, [code, plan]] of purchases.entries()) {
      const { params, options } = checkoutCalls[index];
      assert.equal(params.mode, "subscription");
      assert.deepEqual(params.line_items, [{ price: `price_${plan}`, quantity: 1 }]);
      assert.equal(params.client_reference_id, hash(code));
      assert.deepEqual(params.subscription_data.metadata, {
        classscribe_library_hash: hash(code),
        classscribe_plan: plan,
      });
      assert.match(options.idempotencyKey, new RegExp(`^classscribe-checkout-${hash(code)}-`));
      const success = new URL(params.success_url);
      assert.equal(success.origin, "https://billing-test.example");
      assert.equal(success.searchParams.get("tab"), "account");
      assert.equal(success.searchParams.get("billing"), "success");
      assert.equal(success.searchParams.get("session_id"), "{CHECKOUT_SESSION_ID}");
      assert.equal(new URL(params.cancel_url).searchParams.get("billing"), "cancel");
    }

    // A browser landing on the success URL cannot grant itself access.
    for (const code of codes) assert.equal((await status(code)).plan, "free");
    const studentSession = [...sessions.values()][0];
    const event = (id, session) => ({
      id,
      created: Math.floor(Date.now() / 1000),
      type: "checkout.session.completed",
      data: { object: session },
    });
    await processBillingEvent(event(spoofEventId, {
      ...studentSession,
      metadata: { ...studentSession.metadata, classscribe_library_hash: hash(outsiderCode) },
    }), stripe);
    assert.equal((await status(outsiderCode)).plan, "free");

    for (const [index, [code, plan]] of purchases.entries()) {
      const session = [...sessions.values()][index];
      session.status = "complete";
      // A claimed plan in webhook metadata must not override the Stripe product/price.
      const completed = event(eventIds[index], {
        ...session,
        metadata: { ...session.metadata, classscribe_plan: plan === "pro" ? "student" : "pro" },
      });
      await processBillingEvent(completed, stripe);
      await processBillingEvent(completed, stripe); // Stripe can retry the same delivery.
      const billing = await status(code);
      assert.equal(billing.plan, plan);
      assert.equal(billing.status, "active");
      assert.equal(billing.billingSource, "web");
      assert.equal(billing.billingConflict, false);
      assert.equal(billing.recordingHoursLimit, plan === "pro" ? 120 : 40);
      assert.equal(billing.recordingCountLimit, plan === "pro" ? 60 : 20);
      assert.equal(billing.transcriptionCountLimit, plan === "pro" ? 60 : 20);
      const [account] = await db.select({ data: classscribeLegacyDocumentsTable.data })
        .from(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, `private/classscribe-billing/accounts/${hash(code)}`));
      assert.equal(account.data.stripeSubscriptionId, session.subscription);
      assert.equal(account.data.pendingCheckoutSessionId, undefined);
      assert.equal((await status(outsiderCode)).plan, "free");
    }
    assert.equal((await status(studentCode)).plan, "student");
    assert.equal((await status(proCode)).plan, "pro");
  } finally {
    server.close();
    if (previousDomain === undefined) delete process.env.REPLIT_DOMAINS;
    else process.env.REPLIT_DOMAINS = previousDomain;
    if (previousRevenueCatProjectId === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = previousRevenueCatProjectId;
    for (const code of codes) {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, `private/classscribe-billing/accounts/${hash(code)}`));
    }
    for (const id of [...eventIds, spoofEventId]) {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, `private/classscribe-billing/events/${id}`));
    }
  }
});

test("older subscription events cannot roll back newer verified entitlement", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const customerId = "cus_event_order_test";
  const subscriptionId = "sub_event_order_test";
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const eventPaths = [100, 300, 200].map((created) =>
    `private/classscribe-billing/events/evt_order_${created}`,
  );
  let liveStatus = "active";
  await db.insert(classscribeLegacyDocumentsTable).values({
    path: accountPath,
    data: {
      libraryHash,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      plan: "student",
      status: "active",
      lastStripeEventCreated: 0,
    },
  }).onConflictDoNothing();
  const subscription = () => ({
    id: subscriptionId,
    customer: customerId,
    metadata: { classscribe_library_hash: libraryHash },
    status: liveStatus,
    items: {
      data: [{
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_592_000,
        price: { product: "prod_student", currency: "usd", unit_amount: 799, recurring: { interval: "month" } },
      }],
    },
    cancel_at_period_end: false,
  });
  const stripe = {
    subscriptions: { retrieve: async () => subscription() },
    products: { retrieve: async () => ({ metadata: { classscribe_plan: "student" } }) },
  };
  const event = (id, created, type = "customer.subscription.updated") => ({
    id,
    created,
    type,
    data: { object: { id: subscriptionId, customer: customerId, metadata: { classscribe_library_hash: libraryHash } } },
  });

  try {
    await processBillingEvent(event("evt_order_100", 100), stripe);
    liveStatus = "canceled";
    await processBillingEvent(event("evt_order_300", 300, "customer.subscription.deleted"), stripe);
    liveStatus = "active";
    await processBillingEvent(event("evt_order_200", 200), stripe);

    const [account] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath))
      .limit(1);
    assert.equal(account.data.status, "canceled");
    assert.equal(account.data.plan, "free");
    assert.equal(account.data.lastStripeEventCreated, 300);
  } finally {
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    for (const path of eventPaths) {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, path));
    }
  }
});

test("verified Stripe subscription-cycle invoices grant the Student/Pro bonus once", async () => {
  const previousProjectId = process.env.REVENUECAT_PROJECT_ID;
  const previousProxy = globalThis.__scribeProxy;
  const restoreCreditsControl = await setCreditsMigrationControlCurrency("CREDITS");
  const projectId = "rc-stripe-renewal-test";
  process.env.REVENUECAT_PROJECT_ID = projectId;
  const adjustments = [];
  let creditBalance = 0;
  globalThis.__scribeProxy = async (_connector, path, options = {}) => {
    const url = new URL(path, "https://revenuecat.test");
    if (url.pathname.endsWith("/customers") && options.method === "GET") {
      const appUserId = url.searchParams.get("search");
      return Response.json({ object: "list", items: [{
        object: "customer", id: `customer-${appUserId}`, project_id: projectId,
        first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
        last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
      }] });
    }
    if (url.pathname.endsWith("/aliases") && options.method === "GET") {
      const customerId = url.pathname.split("/").at(-2);
      return Response.json({ object: "list", items: [{
        object: "customer.alias", id: customerId.replace(/^customer-/, ""), created_at: Date.now(),
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies") && options.method === "GET") {
      return Response.json({ object: "list", items: [{ currency_code: "CREDITS", balance: creditBalance }] });
    }
    if (url.pathname.endsWith("/virtual_currencies/transactions") && options.method === "POST") {
      const transaction = JSON.parse(options.body);
      adjustments.push(transaction);
      creditBalance += Number(transaction.adjustments?.CREDITS ?? 0);
      return Response.json({ object: "virtual_currency_transaction", id: `rc-tx-${adjustments.length}` });
    }
    throw new Error(`Unexpected RevenueCat Stripe renewal request: ${path}`);
  };

  const cases = [
    { plan: "student", bonus: 10 },
    { plan: "pro", bonus: 30 },
  ];
  const cleanupPaths = [];
  const cleanupLibraryHashes = [];
  try {
    for (const { plan, bonus } of cases) {
      const libraryHash = hash(freshLibraryCode());
      const billingAccountId = randomUUID();
      const customerId = `cus_${plan}_renewal_${randomUUID()}`;
      const subscriptionId = `sub_${plan}_renewal_${randomUUID()}`;
      const invoiceId = `in_${plan}_renewal_${randomUUID()}`;
      const initialInvoiceId = `in_${plan}_initial_${randomUUID()}`;
      let currentCreditInvoiceId = invoiceId;
      const eventId = `evt_${plan}_renewal_${randomUUID()}`;
      const initialEventId = `evt_${plan}_initial_${randomUUID()}`;
      const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
      const adjustmentStart = adjustments.length;
      cleanupPaths.push(
        accountPath,
        `private/classscribe-billing/events/${eventId}`,
        `private/classscribe-billing/events/${initialEventId}`,
      );
      cleanupLibraryHashes.push(libraryHash);
      const priceId = `price_${plan}_renewal`;
      let activePlan = plan;
      let activePriceId = priceId;
      const proPriceId = `price_pro_upgrade_${libraryHash.slice(0, 8)}`;
      const configuredProPriceId = plan === "pro" ? priceId : proPriceId;
      let stripeCustomerLibraryHash = libraryHash;
      let ambiguousPriceSet = false;
      let ambiguousProductSet = false;
      await db.insert(classscribeLegacyDocumentsTable).values({
        path: accountPath,
        data: {
          libraryHash,
          billingAccountId,
          stripeCustomerId: customerId,
          plan: "free",
          status: "free",
          pendingCheckoutPlan: plan,
          pendingCheckoutPriceId: priceId,
        },
      }).onConflictDoNothing();

      let periodStart = 1_700_000_000;
      let periodEnd = 1_702_592_000;
      let invoice = {
        id: initialInvoiceId,
        customer: customerId,
        parent: {
          type: "subscription_details",
          subscription_details: {
            subscription: subscriptionId,
            metadata: { classscribe_library_hash: libraryHash },
          },
        },
        status: "paid",
        amount_paid: plan === "student" ? 799 : 1299,
        currency: "usd",
        billing_reason: "subscription_create",
        lines: { data: [stripeSubscriptionInvoiceLine(
          subscriptionId, priceId, periodStart, periodEnd,
        )] },
      };
      const stripe = {
        customers: {
          retrieve: async (id) => ({
            id,
            deleted: false,
            metadata: { classscribe_library_hash: stripeCustomerLibraryHash },
          }),
        },
        invoices: { retrieve: async (id) => {
          assert.equal(id, invoice.id);
          return invoice;
        } },
        invoicePayments: {
          list: async (params) => {
            const requestedInvoiceId = params.invoice;
            const requestedPaymentIntentId = params.payment?.type === "payment_intent"
              ? params.payment.payment_intent
              : undefined;
            const invoiceFilterMatches = requestedInvoiceId === undefined ||
              requestedInvoiceId === invoice.id;
            const paymentIntentFilterMatches = requestedPaymentIntentId === undefined ||
              requestedPaymentIntentId === `pi_${invoice.id}`;
            if (invoice.status !== "paid" ||
              (!requestedInvoiceId && !requestedPaymentIntentId) ||
              !invoiceFilterMatches || !paymentIntentFilterMatches) {
              return { data: [] };
            }
            return { data: [{
              id: `inpay_${invoice.id}`,
              invoice: invoice.id,
              status: "paid",
              amount_paid: invoice.amount_paid,
              currency: invoice.currency,
              payment: { type: "payment_intent", payment_intent: `pi_${invoice.id}` },
            }] };
          },
        },
        subscriptions: {
          retrieve: async () => ({
            id: subscriptionId,
            customer: customerId,
            metadata: { classscribe_library_hash: libraryHash },
            status: "active",
            items: { data: [{
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_592_000,
              price: {
                id: activePriceId,
                product: `prod_${activePlan}`,
                currency: "usd",
                unit_amount: activePlan === "student" ? 799 : 1299,
                recurring: { interval: "month" },
              },
            }, ...(ambiguousPriceSet ? [{
              price: {
                id: `price_ambiguous_${plan}`,
                product: `prod_${plan}`,
                currency: "usd",
                unit_amount: plan === "student" ? 799 : 1299,
                recurring: { interval: "month" },
              },
            }] : [])] },
          }),
        },
        products: {
          retrieve: async (id) => ({
            id,
            metadata: { classscribe_plan: id === "prod_pro" ? "pro" : "student" },
          }),
          list: async () => ({ data: [
            { id: "prod_student", metadata: { classscribe_plan: "student" } },
            ...(activePlan === "pro" ? [{ id: "prod_pro", metadata: { classscribe_plan: "pro" } }] : []),
            ...(ambiguousProductSet
              ? [{
                id: `prod_${activePlan}_duplicate`,
                metadata: { classscribe_plan: activePlan },
              }]
              : []),
          ] }),
        },
        prices: {
          list: async ({ product }) => ({
            data: product === "prod_pro"
              ? [{
                id: configuredProPriceId,
                currency: "usd",
                unit_amount: 1299,
                recurring: { interval: "month" },
                metadata: { classscribe_plan: "pro" },
              }]
              : [{
                id: priceId,
                currency: "usd",
                unit_amount: 799,
                recurring: { interval: "month" },
                metadata: { classscribe_plan: "student" },
              }],
          }),
          retrieve: async (id) => id === configuredProPriceId
            ? {
              id, product: "prod_pro", currency: "usd", unit_amount: 1299,
              recurring: { interval: "month" }, metadata: { classscribe_plan: "pro" },
            }
            : {
              id, product: "prod_student", currency: "usd", unit_amount: 799,
              recurring: { interval: "month" }, metadata: { classscribe_plan: "student" },
            },
        },
        charges: {
          retrieve: async (id) => ({
            id,
            payment_intent: `pi_${currentCreditInvoiceId}`,
            customer: customerId,
            metadata: {},
            currency: "usd",
            amount: 1299,
            amount_refunded: 799,
            refunded: true,
            disputed: true,
          }),
        },
        disputes: {
          retrieve: async (id) => ({
            id, charge: `ch_${currentCreditInvoiceId}`, status: "under_review",
          }),
        },
      };
      await processBillingEvent({
        id: initialEventId,
        created: Math.floor(Date.now() / 1000),
        type: "invoice.paid",
        data: { object: { id: initialInvoiceId, customer: customerId } },
      }, stripe);
      assert.deepEqual(
        adjustments.slice(adjustmentStart).map((request) => request.adjustments),
        [{ CREDITS: bonus }],
      );
      periodStart += 2_592_000;
      periodEnd += 2_592_000;
      invoice = {
        ...invoice,
        id: invoiceId,
        billing_reason: "subscription_cycle",
        lines: { data: [stripeSubscriptionInvoiceLine(
          subscriptionId, priceId, periodStart, periodEnd,
        )] },
      };
      const event = {
        id: eventId,
        created: Math.floor(Date.now() / 1000),
        type: "invoice.paid",
        data: { object: { id: invoiceId, customer: customerId } },
      };
      await processBillingEvent(event, stripe);
      await processBillingEvent(event, stripe);
      assert.equal(adjustments.length, adjustmentStart + 2, "the same paid cycle invoice is granted once");
      assert.deepEqual(adjustments.at(-1).adjustments, { CREDITS: bonus });

      const ledgerRows = await db.select().from(classscribeCreditTransactionsTable)
        .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
      assert.deepEqual(ledgerRows.map((row) => row.amount).sort((left, right) => left - right), [bonus, bonus]);
      assert.ok(ledgerRows.every((row) => row.source === "stripe"));
      const periodRows = await db.select().from(classscribeCreditSubscriptionPeriodsTable)
        .where(eq(classscribeCreditSubscriptionPeriodsTable.libraryHash, libraryHash));
      assert.equal(periodRows.length, 2);

      const adjustmentCount = adjustments.length;
      let excludedIndex = 0;
      const deliverExcludedInvoice = async (overrides, type = "invoice.paid") => {
        const excludedInvoiceId = `in_${plan}_excluded_${excludedIndex}_${randomUUID()}`;
        const excludedEventId = `evt_${plan}_excluded_${excludedIndex++}_${randomUUID()}`;
        cleanupPaths.push(`private/classscribe-billing/events/${excludedEventId}`);
        invoice = { ...invoice, id: excludedInvoiceId, customer: customerId, ...overrides };
        await processBillingEvent({
          id: excludedEventId,
          created: Math.floor(Date.now() / 1000) + excludedIndex,
          type,
          data: { object: { id: excludedInvoiceId, customer: invoice.customer } },
        }, stripe);
      };
      await deliverExcludedInvoice({ status: "open" });
      await deliverExcludedInvoice({ status: "open" }, "invoice.payment_failed");
      await deliverExcludedInvoice({
        status: "paid",
        billing_reason: "subscription_cycle",
        lines: { data: [stripeSubscriptionInvoiceLine(
          subscriptionId, priceId, periodStart, periodEnd, true,
        )] },
      });
      stripeCustomerLibraryHash = hash(freshLibraryCode());
      await deliverExcludedInvoice({ customer: `cus_unrelated_${randomUUID()}` });
      stripeCustomerLibraryHash = libraryHash;
      ambiguousProductSet = true;
      await deliverExcludedInvoice({
        status: "paid",
        billing_reason: "subscription_cycle",
        lines: { data: [stripeSubscriptionInvoiceLine(
          subscriptionId, priceId, periodStart, periodEnd,
        )] },
      });
      ambiguousProductSet = false;
      ambiguousPriceSet = true;
      await assert.rejects(
        deliverExcludedInvoice({
          status: "paid",
          billing_reason: "subscription_cycle",
          lines: { data: [stripeSubscriptionInvoiceLine(
            subscriptionId, priceId, periodStart, periodEnd,
          )] },
        }),
        (error) => error.code === "stripe_price_unrecognized",
      );
      ambiguousPriceSet = false;
      assert.equal(adjustments.length, adjustmentCount);

      if (plan === "student") {
        activePlan = "pro";
        activePriceId = configuredProPriceId;
        const subscriptionUpdateEvent = {
          id: `evt_${plan}_upgrade_subscription_${randomUUID()}`,
          created: Math.floor(Date.now() / 1000) + 10,
          type: "customer.subscription.updated",
          data: { object: {
            id: subscriptionId,
            customer: customerId,
            metadata: { classscribe_library_hash: libraryHash },
          } },
        };
        cleanupPaths.push(`private/classscribe-billing/events/${subscriptionUpdateEvent.id}`);
        await processBillingEvent(subscriptionUpdateEvent, stripe);

        const upgradeInvoiceId = `in_${plan}_upgrade_${randomUUID()}`;
        currentCreditInvoiceId = upgradeInvoiceId;
        invoice = {
          ...invoice,
          id: upgradeInvoiceId,
          billing_reason: "subscription_update",
          amount_paid: 500,
          lines: { data: [stripeSubscriptionInvoiceLine(
            subscriptionId, configuredProPriceId, periodStart, periodEnd, true,
          )] },
        };
        const upgradeEvent = {
          id: `evt_${plan}_upgrade_paid_${randomUUID()}`,
          created: Math.floor(Date.now() / 1000) + 11,
          type: "invoice.paid",
          data: { object: { id: upgradeInvoiceId, customer: customerId } },
        };
        cleanupPaths.push(`private/classscribe-billing/events/${upgradeEvent.id}`);
        await processBillingEvent(upgradeEvent, stripe);
        assert.deepEqual(adjustments.at(-1).adjustments, { CREDITS: 20 },
          "a paid Student-to-Pro proration tops the current period up by the difference");

        const disputeChargeId = `ch_${upgradeInvoiceId}`;
        creditBalance = 5;
        await processBillingEvent({
          id: `evt_${plan}_dispute_${randomUUID()}`,
          created: Math.floor(Date.now() / 1000) + 12,
          type: "charge.dispute.created",
          data: { object: { id: `dp_${randomUUID()}`, charge: disputeChargeId } },
        }, stripe);
        assert.deepEqual(adjustments.at(-1).adjustments, { CREDITS: -5 },
          "a chargeback reverses no more than the verified available balance");
        const afterDisputeCount = adjustments.length;
        await processBillingEvent({
          id: `evt_${plan}_refund_${randomUUID()}`,
          created: Math.floor(Date.now() / 1000) + 13,
          type: "charge.refunded",
          data: { object: { id: disputeChargeId } },
        }, stripe);
        assert.equal(adjustments.length, afterDisputeCount,
          "a later refund signal cannot reverse the same period twice");
      }
    }
  } finally {
    for (const libraryHash of cleanupLibraryHashes) {
      await db.delete(classscribeCreditTransactionsTable)
        .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
      await db.delete(classscribeCreditSubscriptionPeriodsTable)
        .where(eq(classscribeCreditSubscriptionPeriodsTable.libraryHash, libraryHash));
    }
    for (const path of cleanupPaths) {
      await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path));
    }
    await restoreCreditsControl();
    if (previousProjectId === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = previousProjectId;
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});

test("unrecognized active Stripe price is surfaced instead of silently downgrading to Free", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const customerId = "cus_unrecognized_price_test";
  const subscriptionId = "sub_unrecognized_price_test";
  const eventId = `evt_${randomUUID()}`;
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const eventPath = `private/classscribe-billing/events/${eventId}`;
  await db.insert(classscribeLegacyDocumentsTable).values({
    path: accountPath,
    data: {
      libraryHash,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      plan: "student",
      status: "active",
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    },
  }).onConflictDoNothing();
  const stripe = {
    subscriptions: {
      retrieve: async () => ({
        id: subscriptionId,
        customer: customerId,
        status: "active",
        items: { data: [{
          price: {
            product: "prod_unconfigured",
            currency: "usd",
            unit_amount: 799,
            recurring: { interval: "month" },
          },
        }] },
      }),
    },
    products: { retrieve: async () => ({ metadata: {} }) },
  };
  try {
    await assert.rejects(
      processBillingEvent({
        id: eventId,
        created: Math.floor(Date.now() / 1000),
        type: "customer.subscription.updated",
        data: { object: { id: subscriptionId, customer: customerId, metadata: { classscribe_library_hash: libraryHash } } },
      }, stripe),
      (error) => error.code === "stripe_price_unrecognized",
    );
    const [account] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath))
      .limit(1);
    assert.equal(account.data.plan, "student");
    const [processedEvent] = await db.select({ path: classscribeLegacyDocumentsTable.path })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, eventPath))
      .limit(1);
    assert.equal(processedEvent, undefined);
  } finally {
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, eventPath));
  }
});

for (const plan of ["student", "pro"]) {
  test(`${plan} renewal failures revoke only the affected library and a paid renewal restores limits`, async () => {
    const code = freshLibraryCode();
    const otherCode = freshLibraryCode();
    const libraryHash = hash(code);
    const otherHash = hash(otherCode);
    const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
    const otherPath = `private/classscribe-billing/accounts/${otherHash}`;
    const customerId = `cus_${plan}_payment_failure`;
    const subscriptionId = `sub_${plan}_payment_failure`;
    const priceId = `price_${plan}_payment_failure`;
    const productId = `prod_${plan}_payment_failure`;
    const now = Math.floor(Date.now() / 1000);
    const periodStart = now - 60;
    const periodEnd = now + 30 * 24 * 60 * 60;
    const iso = (seconds) => new Date(seconds * 1000).toISOString();
    const eventPaths = [];
    let sequence = 0;
    let reads = 0;
    let live = {
      id: subscriptionId, object: "subscription", customer: customerId,
      status: "active", cancel_at_period_end: false,
      metadata: { classscribe_library_hash: libraryHash },
      items: { data: [{
        current_period_start: periodStart, current_period_end: periodEnd,
        price: {
          id: priceId, product: productId, currency: "usd",
          unit_amount: plan === "student" ? 799 : 1299,
          recurring: { interval: "month" },
        },
      }] },
    };
    const invoice = {
      id: `in_${plan}_renewal`, object: "invoice", customer: customerId,
      status: "open", amount_paid: 0, currency: "usd",
      billing_reason: "subscription_cycle",
      parent: { type: "subscription_details", subscription_details: { subscription: subscriptionId } },
      lines: { data: [stripeSubscriptionInvoiceLine(subscriptionId, priceId, periodStart, periodEnd)] },
    };
    // Only explicit fixture reads are available: no checkout, payment, network,
    // or credit-provider operation can accidentally charge a real customer.
    const stripe = {
      customers: { retrieve: async (id) => {
        assert.equal(id, customerId);
        return { id, metadata: { classscribe_library_hash: libraryHash } };
      } },
      subscriptions: { retrieve: async (id) => {
        assert.equal(id, subscriptionId);
        reads += 1;
        return structuredClone(live);
      } },
      products: { retrieve: async (id) => {
        assert.equal(id, productId);
        return { id, metadata: { classscribe_plan: plan } };
      } },
      invoices: { retrieve: async (id) => {
        assert.equal(id, invoice.id);
        return structuredClone(invoice);
      } },
    };
    const event = (type, object, created) => {
      const id = `evt_renewal_${randomUUID()}`;
      eventPaths.push(`private/classscribe-billing/events/${id}`);
      return { id, livemode: false, created: created ?? now + ++sequence, type, data: { object } };
    };
    const subscriptionEvent = () => event("customer.subscription.updated", {
      ...structuredClone(live), status: "active",
    });
    const expectedLimits = (paid) => ({
      recordingHoursLimit: paid ? plan === "student" ? 40 : 120 : 5,
      courseLimit: paid ? null : 3,
      recordingCountLimit: paid ? plan === "student" ? 20 : 60 : 5,
      transcriptionCountLimit: paid ? plan === "student" ? 20 : 60 : 5,
      askCountLimit: paid ? plan === "student" ? 25 : null : 1,
    });
    const savedAccount = async (path) => {
      const [row] = await db.select({ data: classscribeLegacyDocumentsTable.data })
        .from(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, path)).limit(1);
      return row.data;
    };
    const app = express();
    app.use(express.json());
    app.use("/api", legacyRouter);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const otherAccount = {
      libraryHash: otherHash, stripeCustomerId: `cus_${plan}_unaffected`,
      stripeSubscriptionId: `sub_${plan}_unaffected`, plan, status: "active",
      periodStart: iso(periodStart), periodEnd: iso(periodEnd),
      stripeVerifiedAt: iso(now),
    };
    const assertStatus = async (paid, status, end = live.items.data[0].current_period_end, useFixture = false) => {
      let billing;
      if (useFixture) {
        // Missing periods require a fresh provider read on every status request.
        billing = await getLibraryBillingStatus(code, stripe);
      } else {
        const response = await fetch(`${base}/billing/status`, { headers: { "X-CS-User": code } });
        assert.equal(response.status, 200);
        billing = await response.json();
      }
      assert.equal(billing.plan, paid ? plan : "free");
      assert.equal(billing.status, status);
      assert.equal(billing.billingSource, paid ? "web" : null);
      assert.equal(billing.billingConflict, false);
      assert.equal(billing.periodEnd, end ? iso(end) : undefined);
      for (const [key, value] of Object.entries(expectedLimits(paid))) assert.equal(billing[key], value, key);
      const unaffected = await fetch(`${base}/billing/status`, { headers: { "X-CS-User": otherCode } });
      assert.equal(unaffected.status, 200);
      assert.equal((await unaffected.json()).plan, plan);
      assert.deepEqual(await savedAccount(otherPath), otherAccount);
    };
    try {
      await db.insert(classscribeLegacyDocumentsTable).values([
        { path: accountPath, data: { libraryHash, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, plan: "free", status: "inactive" } },
        { path: otherPath, data: otherAccount },
      ]);
      // Establish verified paid access from a live subscription, not checkout.
      await processBillingEvent(subscriptionEvent(), stripe);
      await assertStatus(true, "active");
      assert.ok((await savedAccount(accountPath)).stripeVerifiedAt);
      const paidReservation = await reserveRecordingUsage(code, 6 * 3600);
      assert.equal(paidReservation.allowed, true);
      await releaseRecordingUsage(code, 6 * 3600, paidReservation.month);

      // A failed invoice alone does not override an active live subscription.
      await processBillingEvent(event("invoice.payment_failed", structuredClone(invoice)), stripe);
      await assertStatus(true, "active");
      live.status = "past_due";
      live.items.data[0].current_period_start = periodEnd;
      live.items.data[0].current_period_end = periodEnd + 30 * 24 * 60 * 60;
      const failure = event("invoice.payment_failed", structuredClone(invoice));
      await processBillingEvent(failure, stripe);
      await assertStatus(false, "past_due");
      const savedFailure = await savedAccount(accountPath);
      assert.equal(savedFailure.periodStart, iso(periodEnd));
      const readsAfterFailure = reads;
      await processBillingEvent(failure, stripe);
      assert.equal(reads, readsAfterFailure);
      assert.deepEqual(await savedAccount(accountPath), savedFailure);
      const deniedReservation = await reserveRecordingUsage(code, 6 * 3600);
      assert.equal(deniedReservation.allowed, false);
      assert.equal(deniedReservation.status.plan, "free");

      // The event's stale active status cannot override live unpaid/canceled.
      for (const status of ["unpaid", "canceled"]) {
        live.status = status;
        await processBillingEvent(subscriptionEvent(), stripe);
        await assertStatus(false, status);
      }
      // Even an active status cannot extend access past the live paid period.
      live.status = "active";
      live.items.data[0].current_period_start = now - 30 * 24 * 60 * 60;
      live.items.data[0].current_period_end = now - 1;
      await processBillingEvent(subscriptionEvent(), stripe);
      await assertStatus(false, "expired");
      // Active without a valid period also cannot reuse the original paid end.
      live.status = "active";
      delete live.items.data[0].current_period_start;
      delete live.items.data[0].current_period_end;
      await processBillingEvent(subscriptionEvent(), stripe);
      await getLibraryBillingStatus(code, stripe, true);
      await assertStatus(false, "active", undefined, true);
      const missingPeriod = await savedAccount(accountPath);
      assert.equal(missingPeriod.periodStart, undefined);
      assert.equal(missingPeriod.periodEnd, undefined);

      // Recovery is a successful recurring invoice, not an initial checkout.
      live.items.data[0].current_period_start = now - 30;
      live.items.data[0].current_period_end = periodEnd + 30 * 24 * 60 * 60;
      invoice.status = "paid";
      invoice.amount_paid = plan === "student" ? 799 : 1299;
      invoice.lines.data = [stripeSubscriptionInvoiceLine(subscriptionId, priceId,
        live.items.data[0].current_period_start, live.items.data[0].current_period_end)];
      const recovery = event("invoice.paid", structuredClone(invoice));
      await processBillingEvent(recovery, stripe);
      await assertStatus(true, "active");
      const recoveredAccount = await savedAccount(accountPath);
      await processBillingEvent(recovery, stripe);
      assert.deepEqual(await savedAccount(accountPath), recoveredAccount);
      const recoveredReservation = await reserveRecordingUsage(code, 6 * 3600);
      assert.equal(recoveredReservation.allowed, true);
      await releaseRecordingUsage(code, 6 * 3600, recoveredReservation.month);
      // Older failures and invoices for another subscription cannot revoke it.
      live.status = "past_due";
      await processBillingEvent(event("invoice.payment_failed", structuredClone(invoice), now), stripe);
      const unrelated = structuredClone(invoice);
      unrelated.parent.subscription_details.subscription = "sub_unrelated_renewal";
      await processBillingEvent(event("invoice.payment_failed", unrelated), stripe);
      await assertStatus(true, "active", recoveredAccount.periodEnd ? Date.parse(recoveredAccount.periodEnd) / 1000 : undefined);
      assert.deepEqual(await savedAccount(accountPath), recoveredAccount);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      for (const path of [accountPath, otherPath, ...eventPaths]) {
        await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path));
      }
      for (const ownerHash of [libraryHash, otherHash]) {
        await db.delete(classscribeLegacyDocumentsTable)
          .where(like(classscribeLegacyDocumentsTable.path, `private/classscribe-billing/usage/${ownerHash}/%`));
      }
    }
  });
}

test("Stripe entitlements expire at period end and recover renewed access without webhooks", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const usagePrefix = `private/classscribe-billing/usage/${libraryHash}/%`;
  const oldPeriodEnd = new Date(Date.now() - 60_000).toISOString();
  let liveStatus = "active";
  let livePeriodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const stripe = {
    subscriptions: {
      retrieve: async (id) => ({
        id,
        customer: "cus_period_end_test",
        status: liveStatus,
        cancel_at_period_end: false,
        items: {
          data: [{
            current_period_start: Math.floor(Date.now() / 1000) - 60,
            current_period_end: livePeriodEnd,
            price: {
              product: "prod_period_end_test",
              currency: "usd",
              unit_amount: 1299,
              recurring: { interval: "month" },
            },
          }],
        },
      }),
    },
    products: {
      retrieve: async () => ({ metadata: { classscribe_plan: "pro" } }),
    },
  };
  await db.insert(classscribeLegacyDocumentsTable).values({
    path: accountPath,
    data: {
      libraryHash,
      billingAccountId: randomUUID(),
      stripeCustomerId: "cus_period_end_test",
      stripeSubscriptionId: "sub_period_end_test",
      plan: "student",
      status: "active",
      periodEnd: oldPeriodEnd,
      stripeVerifiedAt: oldPeriodEnd,
      lastStripeEventCreated: 10,
    },
  }).onConflictDoNothing();

  try {
    // A paid library remains usable from its verified entitlement when Stripe
    // webhook initialization is unavailable; expiration revalidation is direct.
    assert.equal(isStripeSyncReady(), false);
    const renewed = await getLibraryBillingStatus(code, stripe);
    assert.equal(renewed.plan, "pro");
    assert.equal(renewed.recordingHoursLimit, 120);
    assert.ok(Date.parse(renewed.periodEnd) > Date.now());
    assert.equal((await getLibraryBillingStatus(code)).plan, "pro");

    assert.equal((await reserveRecordingUsage(code, 120 * 3600)).allowed, true);
    const overLimit = await reserveRecordingUsage(code, 1);
    assert.equal(overLimit.allowed, false);
    assert.equal(overLimit.status.plan, "pro");

    const [renewedAccount] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath))
      .limit(1);
    await db.update(classscribeLegacyDocumentsTable)
      .set({
        data: {
          ...renewedAccount.data,
          periodEnd: oldPeriodEnd,
          stripeVerifiedAt: oldPeriodEnd,
        },
      })
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    liveStatus = "canceled";
    livePeriodEnd = Math.floor(Date.now() / 1000) - 60;
    const expired = await getLibraryBillingStatus(code, stripe);
    assert.equal(expired.plan, "free");
    assert.equal(expired.status, "canceled");
    assert.equal(expired.recordingHoursLimit, 5);
    assert.equal(expired.courseLimit, 3);
  } finally {
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(like(classscribeLegacyDocumentsTable.path, usagePrefix));
  }
});

test("forced billing refresh reads Stripe cancellation and keeps paid access through period end", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const periodEnd = new Date(Math.floor((Date.now() + 20 * 24 * 60 * 60_000) / 1000) * 1000).toISOString();
  const cancelAt = Math.floor(Date.parse(periodEnd) / 1000) - 24 * 60 * 60;
  const stripe = {
    subscriptions: {
      retrieve: async (id) => {
        assert.equal(id, "sub_cancel_refresh_test");
        return {
          id,
          customer: "cus_cancel_refresh_test",
          status: "active",
          cancel_at_period_end: false,
          cancel_at: cancelAt,
          canceled_at: Math.floor(Date.now() / 1000),
          items: { data: [{
            current_period_start: Math.floor(Date.now() / 1000) - 60,
            current_period_end: Math.floor(Date.parse(periodEnd) / 1000),
            price: {
              product: "prod_cancel_refresh_test",
              currency: "usd",
              unit_amount: 799,
              recurring: { interval: "month" },
            },
          }] },
        };
      },
    },
    products: {
      retrieve: async () => ({ metadata: { classscribe_plan: "student" } }),
    },
  };
  await db.insert(classscribeLegacyDocumentsTable).values({
    path: accountPath,
    data: {
      libraryHash,
      stripeCustomerId: "cus_cancel_refresh_test",
      stripeSubscriptionId: "sub_cancel_refresh_test",
      plan: "student",
      status: "active",
      periodEnd,
      cancelAtPeriodEnd: false,
    },
  }).onConflictDoNothing();

  try {
    // Ordinary status reads do not make extra Stripe requests while the stored
    // verified entitlement remains current.
    const ordinaryStatus = await getLibraryBillingStatus(code, stripe);
    assert.equal(ordinaryStatus.plan, "student");
    assert.equal(ordinaryStatus.cancelAtPeriodEnd, false);

    const refreshedStatus = await getLibraryBillingStatus(code, stripe, true);
    assert.equal(refreshedStatus.plan, "student");
    assert.equal(refreshedStatus.status, "active");
    assert.equal(refreshedStatus.cancelAtPeriodEnd, true);
    assert.equal(Date.parse(refreshedStatus.periodEnd), cancelAt * 1000);
    assert.equal(refreshedStatus.recordingHoursLimit, 40);

    const [saved] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath))
      .limit(1);
    assert.equal(saved.data.cancelAtPeriodEnd, true);
  } finally {
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
  }
});

test("subscription webhook maps cancel_at at current period end into scheduled cancellation", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const customerId = "cus_cancel_at_webhook_test";
  const subscriptionId = "sub_cancel_at_webhook_test";
  const eventId = `evt_${randomUUID()}`;
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const eventPath = `private/classscribe-billing/events/${eventId}`;
  const periodEnd = Math.floor((Date.now() + 18 * 24 * 60 * 60_000) / 1000);
  await db.insert(classscribeLegacyDocumentsTable).values({
    path: accountPath,
    data: {
      libraryHash,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      plan: "student",
      status: "active",
      periodEnd: new Date(periodEnd * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    },
  }).onConflictDoNothing();
  const stripe = {
    subscriptions: {
      retrieve: async () => ({
        id: subscriptionId,
        customer: customerId,
        status: "active",
        cancel_at_period_end: false,
        cancel_at: periodEnd,
        canceled_at: Math.floor(Date.now() / 1000),
        items: { data: [{
          current_period_start: Math.floor(Date.now() / 1000) - 60,
          current_period_end: periodEnd,
          price: {
            product: "prod_cancel_at_webhook_test",
            currency: "usd",
            unit_amount: 799,
            recurring: { interval: "month" },
          },
        }] },
      }),
    },
    products: {
      retrieve: async () => ({ metadata: { classscribe_plan: "student" } }),
    },
  };

  try {
    await processBillingEvent({
      id: eventId,
      created: Math.floor(Date.now() / 1000),
      type: "customer.subscription.updated",
      data: {
        object: {
          id: subscriptionId,
          customer: customerId,
          metadata: { classscribe_library_hash: libraryHash },
        },
      },
    }, stripe);

    const status = await getLibraryBillingStatus(code);
    assert.equal(status.plan, "student");
    assert.equal(status.cancelAtPeriodEnd, true);
    assert.equal(Date.parse(status.periodEnd), periodEnd * 1000);
    const [account] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath))
      .limit(1);
    assert.equal(account.data.cancelAtPeriodEnd, true);
  } finally {
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, eventPath));
  }
});

test("RevenueCat entitlements are verified server-side, combine with Stripe, and survive code rotation", async () => {
  const code = freshLibraryCode();
  const nextCode = freshLibraryCode();
  const libraryHash = hash(code);
  const nextHash = hash(nextCode);
  const billingAccountId = randomUUID();
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const paths = [
    accountPath,
    `private/classscribe-billing/accounts/${nextHash}`,
    `private/classscribe-billing/aliases/${libraryHash}`,
    `private/classscribe-billing/aliases/${nextHash}`,
    `revoked/${libraryHash}`,
    `revoked/${nextHash}`,
    `data/users/${code}/%`,
    `data/users/${nextCode}/%`,
  ];
  const envKeys = [
    "REVENUECAT_PROJECT_ID",
    "REVENUECAT_TEST_STORE_APP_ID",
    "REVENUECAT_APPLE_APP_STORE_APP_ID",
    "REVENUECAT_GOOGLE_PLAY_STORE_APP_ID",
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const previousProxy = globalThis.__scribeProxy;
  process.env.REVENUECAT_PROJECT_ID = "rc_project_test";
  process.env.REVENUECAT_TEST_STORE_APP_ID = "rc_test_app";
  process.env.REVENUECAT_APPLE_APP_STORE_APP_ID = "rc_ios_app";
  process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID = "rc_android_app";
  globalThis.__scribeProxy = mockRevenueCatCustomer(process.env.REVENUECAT_PROJECT_ID);

  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const snapshot = {
    project: { id: "rc_project_test" },
    apps: [
      { id: "rc_test_app", type: "test_store" },
      { id: "rc_ios_app", type: "app_store" },
      { id: "rc_android_app", type: "play_store" },
    ],
    products: [
      { id: "prod_pro_test", app_id: "rc_test_app", store_identifier: "classscribe_pro_monthly" },
      { id: "prod_pro_ios", app_id: "rc_ios_app", store_identifier: "classscribe_pro_monthly" },
      { id: "prod_pro_android", app_id: "rc_android_app", store_identifier: "classscribe_pro_monthly:monthly" },
    ],
    customer: {
      id: "cust_rc_ios_test",
      app_user_id: billingAccountId,
    },
    activeEntitlements: {
      object: "list",
      items: [{
        lookup_key: "classscribe_pro",
        product_id: "prod_pro_ios",
        expires_at: Date.parse(future) / 1000,
      }],
    },
    subscriptions: {
      object: "list",
      items: [{
        product_id: "prod_pro_ios",
        store: "APP_STORE",
        status: "active",
        expires_at: Date.parse(future) / 1000,
        app_id: "rc_ios_app",
      }],
    },
  };

  await db.insert(classscribeLegacyDocumentsTable).values({
    path: accountPath,
    data: {
      libraryHash,
      billingAccountId,
      stripeCustomerId: "cus_revenuecat_test",
      plan: "student",
      status: "active",
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    },
  }).onConflictDoNothing();

  const app = express();
  app.use(express.json());
  app.use("/api", legacyRouter);
  const server = app.listen(0, "127.0.0.1");
  const listening = new Promise((resolve) => server.once("listening", resolve));

  try {
    await listening;
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const identityResponse = await fetch(`${base}/billing/revenuecat/identity`, {
      headers: { "X-CS-User": code },
    });
    assert.equal(identityResponse.status, 200);
    const identity = await identityResponse.json();
    assert.equal(identity.appUserId, billingAccountId);
    assert.notEqual(identity.appUserId, code);

    const verifiedStatus = await refreshRevenueCatBillingStatus(code, async (appUserId) => {
      assert.equal(appUserId, billingAccountId);
      return snapshot;
    });
    assert.equal(verifiedStatus.plan, "pro");
    assert.equal(verifiedStatus.status, "active");
    assert.equal(verifiedStatus.billingSource, "app_store");
    assert.equal(verifiedStatus.billingConflict, true);
    assert.equal(verifiedStatus.recordingHoursLimit, 120);
    assert.equal(verifiedStatus.courseLimit, null);
    assert.equal("cancelAtPeriodEnd" in verifiedStatus, false);
    const proCourseWrites = await Promise.all(
      ["one", "two", "three", "four"].map((id) => fetch(`${base}/db/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CS-User": code },
        body: JSON.stringify({
          path: `data/users/${code}/lib/courses/${id}`,
          data: { id },
        }),
      })),
    );
    assert.ok(proCourseWrites.every((response) => response.status === 200));

    const forgedUid = await fetch(`${base}/billing/revenuecat/identity`, {
      headers: { "X-CS-User": "not-a-library-code" },
    });
    assert.equal(forgedUid.status, 403);

    const forgedPlan = await fetch(`${base}/billing/revenuecat/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CS-User": code },
      body: JSON.stringify({ plan: "pro" }),
    });
    assert.equal(forgedPlan.status, 400);
    const forgedIdentity = await fetch(`${base}/billing/revenuecat/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CS-User": code },
      body: JSON.stringify({ appUserId: "attacker-selected-id" }),
    });
    assert.equal(forgedIdentity.status, 400);
    assert.equal((await (await fetch(`${base}/billing/status`, {
      headers: { "X-CS-User": code },
    })).json()).plan, "pro");

    const rotated = await fetch(`${base}/db/rotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CS-User": code },
      body: JSON.stringify({ confirm: true, nextCode }),
    });
    assert.equal(rotated.status, 200);
    assert.equal((await rotated.json()).code, nextCode);
    assert.equal((await fetch(`${base}/billing/revenuecat/identity`, {
      headers: { "X-CS-User": code },
    })).status, 403);
    const rotatedIdentity = await fetch(`${base}/billing/revenuecat/identity`, {
      headers: { "X-CS-User": nextCode },
    });
    assert.equal((await rotatedIdentity.json()).appUserId, billingAccountId);
    assert.equal((await fetch(`${base}/billing/status`, {
      headers: { "X-CS-User": nextCode },
    }).then((response) => response.json())).plan, "pro");
  } finally {
    server.close();
    for (const path of paths) {
      if (path.includes("%")) {
        await db.delete(classscribeLegacyDocumentsTable)
          .where(like(classscribeLegacyDocumentsTable.path, path));
      } else {
        await db.delete(classscribeLegacyDocumentsTable)
          .where(eq(classscribeLegacyDocumentsTable.path, path));
      }
    }
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (typeof value === "string") process.env[key] = value;
      else delete process.env[key];
    }
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});

test("RevenueCat customer lookup uses the v2 search and alias schemas", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const priorProject = process.env.REVENUECAT_PROJECT_ID;
  const priorProxy = globalThis.__scribeProxy;
  process.env.REVENUECAT_PROJECT_ID = "rc-v2-customer-test";
  const paths = [];
  let createdAppUserId;
  let customerCreateCalls = 0;
  globalThis.__scribeProxy = async (_connector, path, options = {}) => {
    paths.push(path);
    const url = new URL(path, "https://revenuecat.test");
    if (url.pathname.endsWith("/customers") && options.method === "POST") {
      const request = JSON.parse(options.body);
      createdAppUserId = request.id;
      customerCreateCalls += 1;
      return Response.json({
        object: "customer", id: request.id, project_id: "rc-v2-customer-test",
        first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
        last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
      }, { status: 201 });
    }
    assert.equal(options.method, "GET");
    if (url.pathname === "/v2/projects") {
      return Response.json({ object: "list", items: [{ id: "rc-v2-customer-test" }] });
    }
    if (url.pathname.endsWith("/apps") || url.pathname.endsWith("/products") ||
      url.pathname.endsWith("/active_entitlements") || url.pathname.endsWith("/subscriptions")) {
      return Response.json({ items: [] });
    }
    if (url.pathname.endsWith("/customers")) {
      if (!createdAppUserId) return Response.json({ object: "list", items: [] });
      assert.equal(url.searchParams.get("search"), createdAppUserId);
      assert.equal(url.searchParams.has("app_user_id"), false);
      return Response.json({ object: "list", items: [{
        object: "customer", id: createdAppUserId, project_id: "rc-v2-customer-test",
        first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
        last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
      }] });
    }
    if (url.pathname.endsWith("/aliases")) {
      assert.equal(url.pathname, `/v2/projects/rc-v2-customer-test/customers/${createdAppUserId}/aliases`);
      return Response.json({ object: "list", items: [{
        object: "customer.alias", id: createdAppUserId, created_at: Date.now(),
      }] });
    }
    if (url.pathname.endsWith("/active_entitlements") || url.pathname.endsWith("/subscriptions")) {
      return Response.json({ object: "list", items: [] });
    }
    if (url.pathname.endsWith("/apps") || url.pathname.endsWith("/products")) {
      return Response.json({ object: "list", items: [] });
    }
    throw new Error(`Unexpected RevenueCat customer lookup path: ${path}`);
  };
  try {
    const appUserId = await getRevenueCatAppUserId(code);
    const provisionedCustomer = await ensureRevenueCatCustomer(appUserId);
    assert.deepEqual(provisionedCustomer, { project: "rc-v2-customer-test", customer: appUserId });
    const status = await refreshRevenueCatBillingStatus(code);
    assert.equal(status.plan, "free");
    assert.ok(paths.some((path) => path.includes("/customers?search=")));
    assert.ok(paths.some((path) => path.includes(`/customers/${createdAppUserId}/aliases`)));
    assert.equal(customerCreateCalls, 1, "a missing customer is created before the verified billing lookup");
  } finally {
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    if (priorProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProject;
    if (priorProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = priorProxy;
  }
});

test("RevenueCat refresh refuses unknown products and expired subscriptions", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const envKeys = [
    "REVENUECAT_PROJECT_ID",
    "REVENUECAT_TEST_STORE_APP_ID",
    "REVENUECAT_APPLE_APP_STORE_APP_ID",
    "REVENUECAT_GOOGLE_PLAY_STORE_APP_ID",
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const previousProxy = globalThis.__scribeProxy;
  process.env.REVENUECAT_PROJECT_ID = "rc_project_test";
  process.env.REVENUECAT_TEST_STORE_APP_ID = "rc_test_app";
  process.env.REVENUECAT_APPLE_APP_STORE_APP_ID = "rc_ios_app";
  process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID = "rc_android_app";
  globalThis.__scribeProxy = mockRevenueCatCustomer(process.env.REVENUECAT_PROJECT_ID);
  const past = new Date(Date.now() - 60_000).toISOString();
  const appUserId = await getRevenueCatAppUserId(code);
  const snapshot = {
    project: { id: "rc_project_test" },
    apps: [{ id: "rc_test_app", type: "test_store" }],
    products: [{ id: "prod_pro_test", app_id: "rc_test_app", store_identifier: "classscribe_pro_monthly" }],
    customer: {
      id: "cust_rc_test",
      app_user_id: appUserId,
    },
    activeEntitlements: {
      object: "list",
      items: [{
        lookup_key: "classscribe_pro",
        product_id: "prod_pro_test",
        expires_at: Date.parse(past) / 1000,
      }],
    },
    subscriptions: {
      object: "list",
      items: [{
        product_id: "prod_pro_test",
        store: "TEST_STORE",
        status: "active",
        expires_at: Date.parse(past) / 1000,
      }],
    },
  };
  try {
    const status = await refreshRevenueCatBillingStatus(code, async () => snapshot);
    assert.equal(status.plan, "free");
    assert.equal(status.status, "expired");
    assert.equal(status.courseLimit, 3);

    snapshot.products[0].store_identifier = "unrecognized_product";
    snapshot.activeEntitlements.items[0].expires_at = Date.now() + 60_000;
    snapshot.subscriptions.items[0].expires_at = Date.now() + 60_000;
    const unrecognized = await refreshRevenueCatBillingStatus(code, async () => snapshot);
    assert.equal(unrecognized.plan, "free");
    assert.equal(unrecognized.status, "inactive");

    snapshot.products[0].store_identifier = "classscribe_pro_monthly";
    snapshot.activeEntitlements = { object: "list", items: [] };
    snapshot.subscriptions = { object: "list", items: [] };
    snapshot.customer.active_entitlements = {
      items: [{
        lookup_key: "classscribe_pro",
        product_id: "prod_pro_test",
        expires_at: Date.now() + 60_000,
      }],
    };
    snapshot.customer.subscriptions = {
      items: [{
        product_id: "prod_pro_test",
        store: "TEST_STORE",
        status: "active",
        expires_at: Date.now() + 60_000,
      }],
    };
    const customerListOnly = await refreshRevenueCatBillingStatus(code, async () => snapshot);
    assert.equal(customerListOnly.plan, "free");
    assert.equal(customerListOnly.status, "inactive");

    snapshot.activeEntitlements.items = [{
      lookup_key: "classscribe_pro",
      product_id: "prod_pro_test",
      expires_at: Date.now() + 60_000,
    }];
    snapshot.subscriptions.items = [{
      product_id: "prod_pro_test",
      store: "TEST_STORE",
      status: "active",
    }];
    const missingExpiry = await refreshRevenueCatBillingStatus(code, async () => snapshot);
    assert.equal(missingExpiry.plan, "free");
    assert.equal(missingExpiry.status, "inactive");

    await assert.rejects(
      refreshRevenueCatBillingStatus(code, async () => ({
        ...snapshot,
        project: { id: "another-project" },
      })),
      (error) => error.httpStatus === 503 && error.code === "revenuecat_project_mismatch",
    );
  } finally {
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (typeof value === "string") process.env[key] = value;
      else delete process.env[key];
    }
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});

test("RevenueCat catalog aliases accept bare entitlements and Android monthly product IDs", async () => {
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const envKeys = [
    "REVENUECAT_PROJECT_ID",
    "REVENUECAT_TEST_STORE_APP_ID",
    "REVENUECAT_APPLE_APP_STORE_APP_ID",
    "REVENUECAT_GOOGLE_PLAY_STORE_APP_ID",
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const previousProxy = globalThis.__scribeProxy;
  process.env.REVENUECAT_PROJECT_ID = "rc_alias_project";
  process.env.REVENUECAT_TEST_STORE_APP_ID = "rc_alias_test";
  process.env.REVENUECAT_APPLE_APP_STORE_APP_ID = "rc_alias_ios";
  process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID = "rc_alias_android";
  globalThis.__scribeProxy = mockRevenueCatCustomer(process.env.REVENUECAT_PROJECT_ID);
  const appUserId = await getRevenueCatAppUserId(code);
  const future = Date.now() + 30 * 24 * 60 * 60_000;
  const snapshot = {
    project: { id: "rc_alias_project" },
    apps: [
      { id: "rc_alias_test", type: "test_store" },
      { id: "rc_alias_ios", type: "app_store" },
      { id: "rc_alias_android", type: "play_store" },
    ],
    products: [
      { id: "student_monthly", app_id: "rc_alias_test", store_identifier: "student_monthly" },
      { id: "pro_monthly", app_id: "rc_alias_android", store_identifier: "pro_monthly:monthly" },
    ],
    customer: { id: "rc_alias_customer", app_user_id: appUserId },
    activeEntitlements: { items: [{
      lookup_key: "student",
      product_id: "student_monthly",
      expires_at: future,
    }] },
    subscriptions: { items: [{
      product_id: "student_monthly",
      store: "TEST_STORE",
      status: "active",
      expires_at: future,
      app_id: "rc_alias_test",
    }] },
  };

  try {
    const student = await refreshRevenueCatBillingStatus(code, async () => snapshot);
    assert.equal(student.plan, "student");
    assert.equal(student.billingSource, "test_store");
    assert.equal(student.billingConflict, false);

    snapshot.activeEntitlements.items = [{
      lookup_key: "pro",
      product_id: "pro_monthly",
      expires_at: future,
    }];
    snapshot.subscriptions.items = [{
      product_id: "pro_monthly",
      store: "PLAY_STORE",
      status: "active",
      expires_at: future,
      app_id: "rc_alias_android",
    }];
    const androidPro = await refreshRevenueCatBillingStatus(code, async () => snapshot);
    assert.equal(androidPro.plan, "pro");
    assert.equal(androidPro.billingSource, "play_store");
    assert.equal(androidPro.recordingHoursLimit, 120);

    for (const [renewalStatus, shouldCancel] of [
      ["will_not_renew", true],
      ["will_pause", true],
      ["will_change_product", false],
      ["requires_price_increase_consent", false],
      ["will_renew", false],
      ["has_already_renewed", false],
    ]) {
      snapshot.subscriptions.items[0].auto_renewal_status = renewalStatus;
      const billing = await refreshRevenueCatBillingStatus(code, async () => snapshot);
      assert.equal(billing.plan, "pro", `${renewalStatus} preserves paid access`);
      assert.equal(billing.status, "active", `${renewalStatus} remains active through expiry`);
      assert.equal(billing.renewalStatus, renewalStatus);
      assert.equal(billing.cancelAtPeriodEnd, shouldCancel);
    }
  } finally {
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (typeof value === "string") process.env[key] = value;
      else delete process.env[key];
    }
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});

test("RevenueCat webhook is fail-closed, re-fetches verified state, and handles unknown, wrong-identity, sandbox, and replay events", async () => {
  const {
    processRevenueCatWebhook,
  } = await import("../src/lib/classscribe-billing.ts");
  const code = freshLibraryCode();
  const libraryHash = hash(code);
  const accountPath = `private/classscribe-billing/accounts/${libraryHash}`;
  const envKeys = [
    "REVENUECAT_PROJECT_ID",
    "REVENUECAT_TEST_STORE_APP_ID",
    "REVENUECAT_WEBHOOK_AUTH_HEADER",
    "SESSION_SECRET",
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const previousProxy = globalThis.__scribeProxy;
  process.env.REVENUECAT_PROJECT_ID = "rc_webhook_project";
  process.env.REVENUECAT_TEST_STORE_APP_ID = "rc_webhook_test";
  delete process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
  delete process.env.SESSION_SECRET;
  globalThis.__scribeProxy = mockRevenueCatCustomer(process.env.REVENUECAT_PROJECT_ID);
  const appUserId = await getRevenueCatAppUserId(code);
  const app = express();
  app.use("/api", revenueCatWebhookRouter);
  const server = app.listen(0, "127.0.0.1");
  const future = Date.now() + 30 * 24 * 60 * 60_000;
  const eventBody = {
    event: {
      app_user_id: appUserId,
      type: "INITIAL_PURCHASE",
      entitlement_id: "forged_body_value",
      product_id: "forged_body_value",
      environment: "SANDBOX",
    },
  };
  const snapshot = {
    project: { id: "rc_webhook_project" },
    apps: [{ id: "rc_webhook_test", type: "test_store" }],
    products: [{ id: "rc_webhook_product", app_id: "rc_webhook_test", store_identifier: "classscribe_student_monthly" }],
    customer: { id: "rc_webhook_customer", app_user_id: appUserId },
    activeEntitlements: { items: [{
      lookup_key: "classscribe_student",
      product_id: "rc_webhook_product",
      expires_at: future,
    }] },
    subscriptions: { items: [{
      product_id: "rc_webhook_product",
      store: "TEST_STORE",
      status: "active",
      expires_at: future,
      app_id: "rc_webhook_test",
    }] },
  };

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/revenuecat/webhook`;
    const postWebhook = (authorization, payload = eventBody) => fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(payload),
    });
    assert.equal((await postWebhook("secret")).status, 503);
    process.env.SESSION_SECRET = "unit-test-session-secret";
    const derivedAuthorization = createHmac("sha256", process.env.SESSION_SECRET)
      .update("classscribe-revenuecat-webhook-v1")
      .digest("hex");
    const expectedDerivedHeader = `Bearer ${derivedAuthorization}`;
    assert.equal(expectedRevenueCatWebhookAuthorization(), expectedDerivedHeader);
    assert.equal((await postWebhook(derivedAuthorization)).status, 401);
    assert.equal((await postWebhook(`Basic ${derivedAuthorization}`)).status, 401);
    assert.deepEqual(await (await postWebhook(expectedDerivedHeader, {
      event: { id: randomUUID(), app_user_id: randomUUID() },
    })).json(), { received: true });

    process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = "expected-secret";
    assert.equal((await postWebhook(derivedAuthorization)).status, 401);
    assert.equal((await postWebhook("incorrect-secret")).status, 401);
    assert.deepEqual(await (await postWebhook("expected-secret", {
      event: { id: randomUUID(), app_user_id: randomUUID(), environment: "SANDBOX" },
    })).json(), { received: true });

    let snapshotCalls = 0;
    const loadSnapshot = async (requestedId) => {
      snapshotCalls += 1;
      assert.equal(requestedId, appUserId);
      return snapshot;
    };
    await processRevenueCatWebhook(eventBody, loadSnapshot);
    await processRevenueCatWebhook(eventBody, loadSnapshot); // RevenueCat retries are safe and re-verified.
    assert.equal(snapshotCalls, 2);
    const sandboxStatus = await getLibraryBillingStatus(code);
    assert.equal(sandboxStatus.plan, "student");
    assert.equal(sandboxStatus.billingSource, "test_store");

    await processRevenueCatWebhook({
      event: { app_user_id: randomUUID() },
    }, async () => {
      assert.fail("Unknown RevenueCat customers must not trigger provider lookups.");
    });

    await processRevenueCatWebhook(eventBody, async () => ({
      ...snapshot,
      customer: { ...snapshot.customer, app_user_id: randomUUID() },
    }));
    const wrongIdentityStatus = await getLibraryBillingStatus(code);
    assert.equal(wrongIdentityStatus.plan, "free");
    assert.equal(wrongIdentityStatus.billingSource, null);
  } finally {
    server.close();
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (typeof value === "string") process.env[key] = value;
      else delete process.env[key];
    }
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});

test("RevenueCat refresh serializes provider reads with persistence to prevent reversed stale writes", async () => {
  const code = freshLibraryCode();
  const accountPath = `private/classscribe-billing/accounts/${hash(code)}`;
  const envKeys = ["REVENUECAT_PROJECT_ID", "REVENUECAT_TEST_STORE_APP_ID"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const previousProxy = globalThis.__scribeProxy;
  process.env.REVENUECAT_PROJECT_ID = "rc-serial-test";
  process.env.REVENUECAT_TEST_STORE_APP_ID = "rc_serialized_test";
  globalThis.__scribeProxy = mockRevenueCatCustomer(process.env.REVENUECAT_PROJECT_ID);
  const future = Date.now() + 30 * 24 * 60 * 60_000;
  const snapshotFor = (appUserId, plan) => {
    const productId = `rc_${plan}_product`;
    return {
      project: { id: "rc-serial-test" },
      apps: [{ id: "rc_serialized_test", type: "test_store" }],
      products: [{
        id: productId,
        app_id: "rc_serialized_test",
        store_identifier: `classscribe_${plan}_monthly`,
      }],
      customer: { id: "rc_serialized_customer", app_user_id: appUserId },
      activeEntitlements: { items: [{
        lookup_key: `classscribe_${plan}`,
        product_id: productId,
        expires_at: future,
      }] },
      subscriptions: { items: [{
        product_id: productId,
        store: "TEST_STORE",
        status: "active",
        expires_at: future,
        app_id: "rc_serialized_test",
      }] },
    };
  };
  let signalFirstFetch;
  const firstFetchStarted = new Promise((resolve) => { signalFirstFetch = resolve; });
  let releaseFirstFetch;
  const firstFetchGate = new Promise((resolve) => { releaseFirstFetch = resolve; });
  let secondFetchCalled = false;

  try {
    const firstRefresh = refreshRevenueCatBillingStatus(code, async (appUserId) => {
      signalFirstFetch();
      await firstFetchGate;
      return snapshotFor(appUserId, "student");
    });
    await firstFetchStarted;
    const secondRefresh = refreshRevenueCatBillingStatus(code, async (appUserId) => {
      secondFetchCalled = true;
      return snapshotFor(appUserId, "pro");
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(secondFetchCalled, false, "the second provider read must wait for the first commit");
    releaseFirstFetch();
    await Promise.all([firstRefresh, secondRefresh]);
    assert.equal((await getLibraryBillingStatus(code)).plan, "pro");
  } finally {
    releaseFirstFetch?.();
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath));
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (typeof value === "string") process.env[key] = value;
      else delete process.env[key];
    }
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});