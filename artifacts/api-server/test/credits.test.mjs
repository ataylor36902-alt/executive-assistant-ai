import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  classscribeCreditActionsTable,
  classscribeCreditProviderIntentsTable,
  classscribeCreditSubscriptionPaymentRevocationsTable,
  classscribeCreditSubscriptionPeriodsTable,
  classscribeCreditTransactionsTable,
  classscribeLegacyDocumentsTable,
  classscribePrivacyTombstonesTable,
  db,
  pool,
} from "@workspace/db";
import {
  CreditsError,
  adjustCreditsForLibraryCode,
  fulfillCreditCheckout,
  reconcileCreditPackCharge,
  getCreditsStatus,
  grantMonthlySubscriptionCredits,
  reverseMonthlySubscriptionCredits,
  grantWelcomeCreditsForNewLink,
  processCreditsRevenueCatWebhook,
  getCreditActionState,
  reserveCreditsForAction,
  completeCreditAction,
  refundCreditAction,
} from "../src/lib/classscribe-credits.ts";
import { creditsConfig } from "../src/lib/credits-config.ts";
import { refundedPackCredits } from "../src/lib/credits-pack-refunds.ts";
import {
  subscriptionPeriodGrantDecision,
  subscriptionPeriodGrantKey,
  subscriptionPeriodReversalAmount,
} from "../src/lib/credits-subscription-periods.ts";
import { rotateLibraryBillingIdentity } from "../src/lib/classscribe-billing.ts";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const accountPath = (libraryHash) => `private/classscribe-billing/accounts/${libraryHash}`;
const migrationControlPath = "private/classscribe-billing/credits-migration-control";
const clearProviderIntents = async (...libraryHashes) => {
  if (libraryHashes.length) {
    await db.delete(classscribeCreditProviderIntentsTable)
      .where(inArray(classscribeCreditProviderIntentsTable.libraryHash, libraryHashes));
  }
};
const originalCreditsApiKey = process.env.REVENUECAT_CREDITS_API_KEY;
delete process.env.REVENUECAT_CREDITS_API_KEY;
let originalMigrationControl;

before(async () => {
  const [existing] = await db.select({ data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, migrationControlPath)).limit(1);
  originalMigrationControl = existing ? { exists: true, data: existing.data } : { exists: false };
  await db.insert(classscribeLegacyDocumentsTable).values({
    path: migrationControlPath,
    data: {
      maintenance: true,
      activeCurrency: "CRD",
      serverSubscriptionGrantReady: false,
      version: "credits-test-crd-legacy",
    },
  }).onConflictDoUpdate({
    target: classscribeLegacyDocumentsTable.path,
    set: {
      data: {
        maintenance: true,
        activeCurrency: "CRD",
        serverSubscriptionGrantReady: false,
        version: "credits-test-crd-legacy",
      },
      updatedAt: new Date(),
    },
  });
});

test("monthly subscription period policy is idempotent across sources and preserves upgrade high-water", () => {
  const start = new Date("2025-01-01T00:00:00.000Z");
  const student = subscriptionPeriodGrantDecision("student", null, 0, false);
  assert.deepEqual(student, { amount: 10, highWaterPlan: "student" });
  const grantKey = subscriptionPeriodGrantKey("a".repeat(64), "student", start);
  assert.equal(subscriptionPeriodGrantKey("a".repeat(64), "student", start), grantKey,
    "RevenueCat and Stripe use the same library/plan/period key");
  assert.equal(subscriptionPeriodGrantDecision("student", "student", 10, false).amount, 0,
    "same-period replay cannot grant twice");
  assert.equal(subscriptionPeriodGrantDecision("pro", "student", 10, false).amount, 20,
    "mid-period Student to Pro upgrade grants only the difference");
  assert.equal(subscriptionPeriodGrantDecision("student", "pro", 30, false).amount, 0,
    "downgrades do not claw back the Pro high-water");
  assert.equal(subscriptionPeriodGrantDecision("student", "pro", 30, true).amount, 0,
    "a refunded period cannot be reopened by a paid-event replay");
  assert.equal(subscriptionPeriodReversalAmount(7, 30), 7,
    "refunds clamp to the actual nonnegative provider balance");
  assert.equal(subscriptionPeriodReversalAmount(0, 30), 0,
    "refunds never create a negative or unlimited balance");
});

test("monthly grants dedupe Stripe and store aliases, upgrade by 20, then reverse once at actual balance", async (t) => {
  const tableCheck = await db.execute(
    sql`select to_regclass('public.classscribe_credit_subscription_periods') as relation`,
  );
  if (!tableCheck.rows?.[0]?.relation) {
    t.skip("The credits subscription-period schema has not been migrated in this test database.");
    return;
  }
  const revocationTableCheck = await db.execute(
    sql`select to_regclass('public.classscribe_credit_subscription_payment_revocations') as relation`,
  );
  if (!revocationTableCheck.rows?.[0]?.relation) {
    t.skip("The subscription payment revocation schema has not been migrated in this test database.");
    return;
  }
  const oldLibraryHash = hash(`u_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  const currentLibraryHash = hash(`u_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  const preRotationLibraryHash = hash(`u_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  const postRotationLibraryHash = hash(`u_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  const appUserId = `rc-${randomUUID()}`;
  const projectId = "credits-period-policy-test";
  const apiKey = "test_only_fake_revenuecat_api_key";
  const accountPathFor = (libraryHash) => accountPath(libraryHash);
  const aliasPath = `private/classscribe-billing/aliases/${oldLibraryHash}`;
  const rotatedAliasPath = `private/classscribe-billing/aliases/${preRotationLibraryHash}`;
  const periodStart = Date.parse("2025-01-01T00:00:00.000Z");
  const periodEnd = Date.parse("2025-02-01T00:00:00.000Z");
  const [priorControl] = await db.select({ data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, migrationControlPath)).limit(1);
  const priorProject = process.env.REVENUECAT_PROJECT_ID;
  const priorApiKey = process.env.REVENUECAT_CREDITS_API_KEY;
  const priorFetch = globalThis.fetch;
  let balance = 0;
  const adjustments = [];
  process.env.REVENUECAT_PROJECT_ID = projectId;
  process.env.REVENUECAT_CREDITS_API_KEY = apiKey;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.toString() : input);
    if (url.pathname.endsWith("/customers") && init.method === "GET") {
      return Response.json({ object: "list", items: [{
        object: "customer", id: appUserId, project_id: projectId,
      }] });
    }
    if (url.pathname.endsWith("/aliases") && init.method === "GET") {
      return Response.json({ object: "list", items: [{
        object: "customer.alias", id: appUserId, created_at: Date.now(),
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies") && init.method === "GET") {
      return Response.json({ object: "list", items: [{
        object: "virtual_currency_balance", currency_code: "CREDITS", balance,
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies/transactions") && init.method === "POST") {
      const body = JSON.parse(init.body);
      const amount = body.adjustments.CREDITS;
      assert.equal(body.reference, new Headers(init.headers).get("Idempotency-Key"));
      adjustments.push({ amount, key: body.reference });
      balance += amount;
      return Response.json({ object: "virtual_currency_transaction", id: `tx-${adjustments.length}` });
    }
    throw new Error(`Unexpected monthly credits test request: ${url.pathname}`);
  };
  await db.insert(classscribeLegacyDocumentsTable).values([
    { path: accountPathFor(currentLibraryHash), data: { libraryHash: currentLibraryHash, billingAccountId: appUserId } },
    { path: accountPathFor(preRotationLibraryHash), data: { libraryHash: preRotationLibraryHash, billingAccountId: appUserId } },
    { path: aliasPath, data: { toHash: currentLibraryHash } },
  ]);
  await db.insert(classscribeLegacyDocumentsTable).values({
    path: migrationControlPath,
    data: {
      maintenance: false,
      activeCurrency: "CREDITS",
      serverSubscriptionGrantReady: true,
      version: "test-ready-v1",
    },
  }).onConflictDoUpdate({
    target: classscribeLegacyDocumentsTable.path,
    set: {
      data: {
        maintenance: false,
        activeCurrency: "CREDITS",
        serverSubscriptionGrantReady: true,
        version: "test-ready-v1",
      },
      updatedAt: new Date(),
    },
  });
  try {
    const common = { libraryCode: oldLibraryHash, periodStart, periodEnd };
    await reverseMonthlySubscriptionCredits({
      libraryCode: oldLibraryHash,
      source: "stripe",
      paymentId: "pi_refunded_before_paid",
      eventId: "refund-before-paid",
    });
    await grantMonthlySubscriptionCredits({
      ...common,
      plan: "student",
      source: "stripe",
      eventId: "paid-after-refund",
      paymentId: "pi_refunded_before_paid",
    });
    assert.equal(balance, 0, "a persisted refund tombstone blocks a later paid grant");
    assert.equal(adjustments.length, 0);

    const rotatedPaymentId = `pi_refunded_before_rotation_${randomUUID()}`;
    await reverseMonthlySubscriptionCredits({
      libraryCode: preRotationLibraryHash,
      source: "stripe",
      paymentId: rotatedPaymentId,
      eventId: `refund-before-rotation-${randomUUID()}`,
    });
    const oldRevocationId = hash(`${preRotationLibraryHash}:${hash(rotatedPaymentId)}`);
    await db.transaction((tx) => rotateLibraryBillingIdentity(
      tx,
      preRotationLibraryHash,
      postRotationLibraryHash,
    ));
    await grantMonthlySubscriptionCredits({
      libraryCode: preRotationLibraryHash,
      periodStart,
      periodEnd,
      plan: "student",
      source: "stripe",
      eventId: `paid-after-rotation-${randomUUID()}`,
      paymentId: rotatedPaymentId,
    });
    assert.equal(balance, 0, "a pre-rotation refund tombstone blocks the delayed grant");
    assert.equal(adjustments.length, 0, "the delayed post-rotation replay never reaches RevenueCat");
    const rotatedRevocation = await db.select().from(classscribeCreditSubscriptionPaymentRevocationsTable)
      .where(eq(classscribeCreditSubscriptionPaymentRevocationsTable.id, oldRevocationId));
    assert.equal(rotatedRevocation.length, 1);
    assert.equal(rotatedRevocation[0].libraryHash, postRotationLibraryHash,
      "rotation moves the revocation row while preserving its original primary key");
    const rotatedPeriods = await db.select().from(classscribeCreditSubscriptionPeriodsTable)
      .where(eq(classscribeCreditSubscriptionPeriodsTable.libraryHash, postRotationLibraryHash));
    assert.equal(rotatedPeriods.length, 0, "the delayed grant does not create a period after rotation");

    await grantMonthlySubscriptionCredits({
      ...common, plan: "student", source: "stripe", eventId: "in_student_1", paymentId: "pi_student_1",
    });
    await grantMonthlySubscriptionCredits({
      ...common, plan: "student", source: "revenuecat", eventId: "rc_student_1", paymentId: "store_tx_student_1",
    });
    await grantMonthlySubscriptionCredits({
      ...common,
      plan: "pro",
      periodStart: Date.parse("2025-01-15T00:00:00.000Z"),
      source: "revenuecat",
      eventId: "rc_upgrade_1",
      paymentId: "store_tx_pro_1",
    });
    await grantMonthlySubscriptionCredits({
      ...common,
      plan: "student",
      source: "stripe",
      eventId: "in_downgrade_1",
      paymentId: "pi_downgrade_1",
    });
    assert.equal(balance, 30, "Student grants 10 and Pro upgrade adds only 20");
    assert.deepEqual(adjustments.map(({ amount }) => amount), [10, 20],
      "cross-source replay and downgrade do not write duplicate credits");
    assert.equal(adjustments[0].key, subscriptionPeriodGrantKey(
      currentLibraryHash, "student", new Date(periodStart),
    ));

    balance -= 25; // Simulate five unspent credits remaining at refund time.
    await reverseMonthlySubscriptionCredits({
      libraryCode: oldLibraryHash,
      source: "stripe",
      paymentId: "pi_student_1",
      eventId: "chargeback_student_1",
    });
    assert.equal(balance, 0, "reversal clamps the debit to actual provider balance");
    assert.deepEqual(adjustments.map(({ amount }) => amount), [10, 20, -5]);

    await grantMonthlySubscriptionCredits({
      ...common, plan: "pro", source: "stripe", eventId: "paid-replay", paymentId: "pi_pro_replay",
    });
    await reverseMonthlySubscriptionCredits({
      libraryCode: oldLibraryHash,
      source: "revenuecat",
      paymentId: "pi_student_1",
      eventId: "duplicate_refund",
    });
    assert.equal(balance, 0, "paid-period and refund replays remain blocked after revocation");
    assert.equal(adjustments.length, 3);
    const periods = await db.select().from(classscribeCreditSubscriptionPeriodsTable)
      .where(eq(classscribeCreditSubscriptionPeriodsTable.libraryHash, currentLibraryHash));
    assert.equal(periods.length, 1);
    assert.equal(periods[0].status, "revoked");
    assert.equal(periods[0].highWaterPlan, "pro");
    assert.equal(periods[0].grantedAmount, 30);
    assert.equal(periods[0].revokedPaymentHash, hash("pi_student_1"));
    const entries = await db.select().from(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, currentLibraryHash));
    assert.deepEqual(entries.map((entry) => entry.amount).sort((a, b) => a - b), [-5, 10, 20]);
  } finally {
    if (priorProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProject;
    if (priorApiKey === undefined) delete process.env.REVENUECAT_CREDITS_API_KEY;
    else process.env.REVENUECAT_CREDITS_API_KEY = priorApiKey;
    globalThis.fetch = priorFetch;
    await db.delete(classscribeCreditSubscriptionPeriodsTable)
      .where(inArray(classscribeCreditSubscriptionPeriodsTable.libraryHash, [
        currentLibraryHash, postRotationLibraryHash,
      ]));
    await db.delete(classscribeCreditSubscriptionPaymentRevocationsTable)
      .where(inArray(classscribeCreditSubscriptionPaymentRevocationsTable.libraryHash, [
        currentLibraryHash, postRotationLibraryHash,
      ]));
    await db.delete(classscribeCreditTransactionsTable)
      .where(inArray(classscribeCreditTransactionsTable.libraryHash, [
        currentLibraryHash, postRotationLibraryHash,
      ]));
    await db.delete(classscribeLegacyDocumentsTable).where(inArray(classscribeLegacyDocumentsTable.path, [
      accountPathFor(currentLibraryHash),
      accountPathFor(preRotationLibraryHash),
      accountPathFor(postRotationLibraryHash),
      aliasPath,
      rotatedAliasPath,
    ]));
    if (priorControl) {
      await db.insert(classscribeLegacyDocumentsTable).values({
        path: migrationControlPath,
        data: priorControl.data,
      }).onConflictDoUpdate({
        target: classscribeLegacyDocumentsTable.path,
        set: { data: priorControl.data, updatedAt: new Date() },
      });
    } else {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, migrationControlPath));
    }
  }
});

after(async () => {
  if (originalMigrationControl !== undefined) {
    if (originalMigrationControl.exists) {
      await db.insert(classscribeLegacyDocumentsTable).values({
        path: migrationControlPath,
        data: originalMigrationControl.data,
      }).onConflictDoUpdate({
        target: classscribeLegacyDocumentsTable.path,
        set: { data: originalMigrationControl.data, updatedAt: new Date() },
      });
    } else {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, migrationControlPath));
    }
  }
  if (originalCreditsApiKey === undefined) delete process.env.REVENUECAT_CREDITS_API_KEY;
  else process.env.REVENUECAT_CREDITS_API_KEY = originalCreditsApiKey;
  await pool.end();
});

test("credit grants, spends, refunds, balance protection, and retries use stable events", async () => {
  const code = `u_${randomUUID().replaceAll("-", "")}`;
  const libraryHash = hash(code);
  const billingAccountId = randomUUID();
  const provider = {
    amount: 0,
    calls: [],
    async balance() { return this.amount; },
    async adjust(_appUserId, amount, reason, eventId) {
      this.calls.push({ amount, reason, eventId });
      this.amount += amount;
    },
  };
  await db.insert(classscribeLegacyDocumentsTable).values({
    path: accountPath(libraryHash),
    data: { libraryHash, billingAccountId },
  });
  try {
    await adjustCreditsForLibraryCode(code, 10, "test grant", "promo", "credits-test-grant", provider);
    await adjustCreditsForLibraryCode(code, 10, "test grant", "promo", "credits-test-grant", provider);
    assert.equal(provider.amount, 10);
    assert.equal(provider.calls.length, 1, "a repeated event must not adjust balance twice");

    await adjustCreditsForLibraryCode(code, -4, "test spend", "spend", "credits-test-spend", provider);
    assert.equal(provider.amount, 6);
    await assert.rejects(
      adjustCreditsForLibraryCode(code, -7, "excess spend", "spend", "credits-test-low", provider),
      (error) => error.code === "insufficient_credits" && error.status === 422 &&
        error.message.includes("7 Scribe Credits") && error.message.includes("have 6"),
    );
    assert.equal(provider.amount, 6, "a rejected spend must leave balance unchanged");

    await adjustCreditsForLibraryCode(code, 3, "test refund", "refund", "credits-test-refund", provider);
    assert.equal(provider.amount, 9);
    const rows = await db.select().from(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    assert.deepEqual(rows.map((row) => row.amount).sort((a, b) => a - b), [-4, 3, 10]);
  } finally {
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    await clearProviderIntents(libraryHash);
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath(libraryHash)));
  }
});

test("provider intents block ambiguous writes, allow known no-apply auth retries, and survive finalization failures", async (t) => {
  const intentTable = await db.execute(
    sql`select to_regclass('public.classscribe_credit_provider_intents') as relation`,
  );
  if (!intentTable.rows?.[0]?.relation) {
    t.skip("The durable provider-intent schema has not been migrated in this test database.");
    return;
  }
  const code = `u_${randomUUID().replaceAll("-", "")}`;
  const libraryHash = hash(code);
  const path = accountPath(libraryHash);
  const ambiguousEvent = `credits-ambiguous-${randomUUID()}`;
  const authEvent = `credits-auth-retry-${randomUUID()}`;
  const commitFailureEvent = `credits-commit-failure-${randomUUID()}`;
  await db.insert(classscribeLegacyDocumentsTable).values({
    path,
    data: { libraryHash, billingAccountId: randomUUID() },
  });

  const ambiguousProvider = {
    amount: 0,
    calls: 0,
    async balance() { return this.amount; },
    async adjust(_appUserId, amount) {
      this.calls += 1;
      this.amount += amount;
      throw new Error("simulated response loss after provider apply");
    },
  };
  const authProvider = {
    amount: 0,
    calls: 0,
    rejectAuth: true,
    async balance() { return this.amount; },
    async adjust(_appUserId, amount) {
      this.calls += 1;
      if (this.rejectAuth) {
        throw new CreditsError(503, "revenuecat_auth_rejected", "No adjustment was applied.");
      }
      this.amount += amount;
    },
  };
  const commitProvider = {
    amount: 0,
    calls: 0,
    async balance() { return this.amount; },
    async adjust(_appUserId, amount) {
      this.calls += 1;
      this.amount += amount;
    },
  };
  const originalTransaction = db.transaction.bind(db);
  try {
    await assert.rejects(
      adjustCreditsForLibraryCode(code, 4, "ambiguous", "promo", ambiguousEvent, ambiguousProvider),
      (error) => error.code === "credit_adjustment_uncertain",
    );
    await assert.rejects(
      adjustCreditsForLibraryCode(code, 4, "ambiguous", "promo", ambiguousEvent, ambiguousProvider),
      (error) => error.code === "credit_adjustment_uncertain",
    );
    assert.equal(ambiguousProvider.calls, 1, "an ambiguous provider result is never blindly posted again");

    await assert.rejects(
      adjustCreditsForLibraryCode(code, 3, "auth retry", "promo", authEvent, authProvider),
      (error) => error.code === "revenuecat_auth_rejected",
    );
    authProvider.rejectAuth = false;
    await adjustCreditsForLibraryCode(code, 3, "auth retry", "promo", authEvent, authProvider);
    assert.equal(authProvider.calls, 2, "a definite no-apply auth failure can be retried after credentials recover");
    assert.equal(authProvider.amount, 3);

    let transactionCount = 0;
    db.transaction = async (callback, ...args) => {
      transactionCount += 1;
      if (transactionCount === 3) {
        return originalTransaction(async (tx) => {
          await callback(tx);
          throw new Error("simulated ledger transaction failure after successful provider adjustment");
        }, ...args);
      }
      return originalTransaction(callback, ...args);
    };
    await assert.rejects(
      adjustCreditsForLibraryCode(code, 5, "commit failure", "promo", commitFailureEvent, commitProvider),
      (error) => error.code === "credit_adjustment_uncertain",
    );
    assert.equal(commitProvider.calls, 1);
    db.transaction = originalTransaction;
    await assert.rejects(
      adjustCreditsForLibraryCode(code, 5, "commit failure", "promo", commitFailureEvent, commitProvider),
      (error) => error.code === "credit_adjustment_uncertain",
    );
    assert.equal(commitProvider.calls, 1, "a committed pending intent prevents duplicate POST after ledger failure");

    await db.insert(classscribePrivacyTombstonesTable).values({ libraryHash });
    const deletedProvider = {
      calls: 0,
      async balance() { return 0; },
      async adjust() { this.calls += 1; },
    };
    await assert.rejects(
      adjustCreditsForLibraryCode(code, 5, "deleted account", "promo", `deleted-${randomUUID()}`, deletedProvider),
      (error) => error.code === "credit_account_deleted",
    );
    assert.equal(deletedProvider.calls, 0, "credit writes cannot recreate customers after privacy deletion");
  } finally {
    db.transaction = originalTransaction;
    await db.delete(classscribePrivacyTombstonesTable)
      .where(eq(classscribePrivacyTombstonesTable.libraryHash, libraryHash));
    await db.delete(classscribeCreditProviderIntentsTable)
      .where(eq(classscribeCreditProviderIntentsTable.libraryHash, libraryHash));
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path));
  }
});

test("a missing RevenueCat customer fails welcome credit grant without recording a false grant", async () => {
  const code = `u_${randomUUID().replaceAll("-", "")}`;
  const libraryHash = hash(code);
  const path = accountPath(libraryHash);
  const priorProject = process.env.REVENUECAT_PROJECT_ID;
  const priorApiKey = process.env.REVENUECAT_CREDITS_API_KEY;
  const priorProxy = globalThis.__scribeProxy;
  process.env.REVENUECAT_PROJECT_ID = "welcome-test";
  delete process.env.REVENUECAT_CREDITS_API_KEY;
  globalThis.__scribeProxy = async (_connector, requestPath, options = {}) => {
    const url = new URL(requestPath, "https://revenuecat.test");
    if (url.pathname.endsWith("/customers") && options.method === "GET") {
      assert.ok(url.searchParams.get("search"));
      return Response.json({ object: "list", items: [] });
    }
    if (url.pathname.endsWith("/customers") && options.method === "POST") {
      return Response.json({ message: "customer provisioning is forbidden" }, { status: 403 });
    }
    throw new Error(`Unexpected RevenueCat test request: ${requestPath}`);
  };
  try {
    await assert.rejects(
      grantWelcomeCreditsForNewLink(code),
      (error) => error.code === "revenuecat_customer_write_scope_missing" &&
        error.message.includes("customer_information:customers:read_write") &&
        error.message.includes("reauthorization cannot add it"),
    );
    const rows = await db.select().from(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    assert.equal(rows.length, 0, "a rejected RevenueCat grant must not be recorded as successful");
  } finally {
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    await clearProviderIntents(libraryHash);
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, path));
    if (priorProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProject;
    if (priorApiKey === undefined) delete process.env.REVENUECAT_CREDITS_API_KEY;
    else process.env.REVENUECAT_CREDITS_API_KEY = priorApiKey;
    if (priorProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = priorProxy;
  }
});

test("first credits status provisions a new RevenueCat customer and grants the welcome balance once", async () => {
  const code = `u_${randomUUID().replaceAll("-", "")}`;
  const libraryHash = hash(code);
  const path = accountPath(libraryHash);
  const priorProject = process.env.REVENUECAT_PROJECT_ID;
  const priorProxy = globalThis.__scribeProxy;
  let appUserId;
  let createCalls = 0;
  let welcomeGrantCalls = 0;
  let balance = 0;
  process.env.REVENUECAT_PROJECT_ID = "crd-zero-test";
  globalThis.__scribeProxy = async (_connector, requestPath, options = {}) => {
    const url = new URL(requestPath, "https://revenuecat.test");
    if (url.pathname.endsWith("/customers") && options.method === "GET") {
      appUserId = url.searchParams.get("search");
      if (createCalls === 0) return Response.json({ object: "list", items: [] });
      return Response.json({ object: "list", items: [{
        object: "customer", id: appUserId, project_id: "crd-zero-test",
        first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
        last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
      }] });
    }
    if (url.pathname.endsWith("/customers") && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.id, appUserId);
      createCalls += 1;
      return Response.json({
        object: "customer", id: body.id, project_id: "crd-zero-test",
        first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
        last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
      }, { status: 201 });
    }
    if (url.pathname.endsWith("/aliases") && options.method === "GET") {
      return Response.json({ object: "list", items: [{
        object: "customer.alias", id: appUserId, created_at: Date.now(),
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies") && options.method === "GET") {
      assert.equal(url.searchParams.get("include_empty_balances"), "true");
      return Response.json({ object: "list", items: [{
        object: "virtual_currency_balance", currency_code: "CRD", balance,
        description: "Scribe Credits", name: "Scribe Credits",
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies/transactions") && options.method === "POST") {
      const request = JSON.parse(options.body);
      assert.deepEqual(request.adjustments, { CRD: 5 });
      assert.equal(request.reference, `credits-welcome-${libraryHash}`);
      balance += 5;
      welcomeGrantCalls += 1;
      return Response.json({ object: "virtual_currency_transaction", id: "welcome-transaction" });
    }
    throw new Error(`Unexpected RevenueCat status request: ${requestPath}`);
  };
  try {
    const status = await getCreditsStatus(code);
    const repeated = await getCreditsStatus(code);
    assert.equal(status.balance, 5);
    assert.equal(repeated.balance, 5);
    assert.equal(createCalls, 1);
    assert.equal(welcomeGrantCalls, 1);
    const history = await db.select().from(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    assert.equal(history.length, 1);
    assert.equal(history[0].eventId, `credits-welcome-${libraryHash}`);
  } finally {
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    await clearProviderIntents(libraryHash);
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, path));
    if (priorProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProject;
    if (priorProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = priorProxy;
  }
});

test("OAuth credits permission failures return actionable purchases write-scope errors", async () => {
  const code = `u_${randomUUID().replaceAll("-", "")}`;
  const libraryHash = hash(code);
  const path = accountPath(libraryHash);
  const appUserId = randomUUID();
  const projectId = "credits-oauth-scope-test";
  const previousProject = process.env.REVENUECAT_PROJECT_ID;
  const previousProxy = globalThis.__scribeProxy;
  process.env.REVENUECAT_PROJECT_ID = projectId;
  globalThis.__scribeProxy = async (_connector, requestPath, options = {}) => {
    const url = new URL(requestPath, "https://revenuecat.test");
    if (url.pathname.endsWith("/customers") && options.method === "GET") {
      return Response.json({ object: "list", items: [{
        object: "customer",
        id: `customer-${appUserId}`,
        project_id: projectId,
        first_seen_at: Date.now(),
        last_seen_at: null,
        last_seen_app_version: null,
        last_seen_country: null,
        last_seen_platform: null,
        last_seen_platform_version: null,
      }] });
    }
    if (url.pathname.endsWith("/aliases") && options.method === "GET") {
      return Response.json({ object: "list", items: [{
        object: "customer.alias", id: appUserId, created_at: Date.now(),
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies/transactions") && options.method === "POST") {
      return Response.json({
        error_code: "missing_scope",
        message: "customer_information:purchases:read_write required",
      }, { status: 403 });
    }
    throw new Error(`Unexpected OAuth scope test request: ${requestPath}`);
  };
  await db.insert(classscribeLegacyDocumentsTable).values({
    path,
    data: { libraryHash, billingAccountId: appUserId },
  });
  try {
    await assert.rejects(
      getCreditsStatus(code),
      (error) => error.status === 503 &&
        error.code === "revenuecat_purchases_scope_missing" &&
        error.message.includes("customer_information:purchases:read_write") &&
        error.message.includes("reauthorization cannot add it"),
    );
    const rows = await db.select().from(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    assert.equal(rows.length, 0, "a denied VC adjustment must not be recorded as successful");
  } finally {
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    await clearProviderIntents(libraryHash);
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path));
    if (previousProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = previousProject;
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});

test("server-only RevenueCat API key provisions a customer and preserves transaction idempotency", async () => {
  const code = `u_${randomUUID().replaceAll("-", "")}`;
  const libraryHash = hash(code);
  const path = accountPath(libraryHash);
  const appUserId = randomUUID();
  const projectId = "credits-api-key-test";
  const fakeApiKey = "test_only_fake_revenuecat_api_key";
  const welcomeEventId = `credits-welcome-${libraryHash}`;
  const previousProject = process.env.REVENUECAT_PROJECT_ID;
  const previousApiKey = process.env.REVENUECAT_CREDITS_API_KEY;
  const previousFetch = globalThis.fetch;
  const previousProxy = globalThis.__scribeProxy;
  let customerCreated = false;
  const requests = [];
  process.env.REVENUECAT_PROJECT_ID = projectId;
  process.env.REVENUECAT_CREDITS_API_KEY = fakeApiKey;
  globalThis.__scribeProxy = () => {
    throw new Error("OAuth connector proxy must not be used when the server API key is configured");
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.toString() : input);
    const headers = new Headers(init.headers);
    assert.equal(url.origin, "https://api.revenuecat.com");
    assert.equal(url.toString().includes(fakeApiKey), false);
    assert.equal(headers.get("authorization"), `Bearer ${fakeApiKey}`);
    requests.push({ url, method: init.method, headers });

    if (url.pathname.endsWith("/customers") && init.method === "GET") {
      return Response.json({
        object: "list",
        items: customerCreated ? [{
          object: "customer",
          id: appUserId,
          project_id: projectId,
          first_seen_at: Date.now(),
          last_seen_at: null,
          last_seen_app_version: null,
          last_seen_country: null,
          last_seen_platform: null,
          last_seen_platform_version: null,
        }] : [],
      });
    }
    if (url.pathname.endsWith("/customers") && init.method === "POST") {
      assert.deepEqual(JSON.parse(init.body), { id: appUserId });
      customerCreated = true;
      return Response.json({
        object: "customer",
        id: appUserId,
        project_id: projectId,
        first_seen_at: Date.now(),
        last_seen_at: null,
        last_seen_app_version: null,
        last_seen_country: null,
        last_seen_platform: null,
        last_seen_platform_version: null,
      }, { status: 201 });
    }
    if (url.pathname.endsWith("/aliases") && init.method === "GET") {
      return Response.json({ object: "list", items: [{
        object: "customer.alias", id: appUserId, created_at: Date.now(),
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies/transactions") && init.method === "POST") {
      const transaction = JSON.parse(init.body);
      assert.equal(transaction.reference, welcomeEventId);
      assert.deepEqual(transaction.adjustments, { CRD: 5 });
      assert.equal(headers.get("idempotency-key"), welcomeEventId);
      return Response.json({ object: "virtual_currency_transaction", id: "api-key-welcome" });
    }
    if (url.pathname.endsWith("/virtual_currencies") && init.method === "GET") {
      return Response.json({ object: "list", items: [{
        object: "virtual_currency_balance",
        currency_code: "CRD",
        balance: 5,
        description: "Scribe Credits",
        name: "Scribe Credits",
      }] });
    }
    throw new Error(`Unexpected RevenueCat API-key request: ${url.pathname}`);
  };
  await db.insert(classscribeLegacyDocumentsTable).values({
    path,
    data: { libraryHash, billingAccountId: appUserId },
  });
  try {
    const first = await getCreditsStatus(code);
    const repeated = await getCreditsStatus(code);
    assert.equal(first.balance, 5);
    assert.equal(repeated.balance, 5);
    assert.equal(requests.filter(({ method, url }) =>
      method === "POST" && url.pathname.endsWith("/customers")).length, 1);
    assert.equal(requests.filter(({ method, url }) =>
      method === "POST" && url.pathname.endsWith("/virtual_currencies/transactions")).length, 1);
    assert.ok(requests.every(({ url }) =>
      url.pathname.startsWith(`/v2/projects/${projectId}/`)));
  } finally {
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.eventId, welcomeEventId));
    await clearProviderIntents(libraryHash);
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path));
    if (previousProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = previousProject;
    if (previousApiKey === undefined) delete process.env.REVENUECAT_CREDITS_API_KEY;
    else process.env.REVENUECAT_CREDITS_API_KEY = previousApiKey;
    globalThis.fetch = previousFetch;
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});

test("legacy welcome history and action identity survive library rotation without a second grant", async () => {
  const code = `u_${randomUUID().replaceAll("-", "")}`;
  const rotatedCode = `u_${randomUUID().replaceAll("-", "")}`;
  const unrelatedCode = `u_${randomUUID().replaceAll("-", "")}`;
  const libraryHash = hash(code);
  const rotatedHash = hash(rotatedCode);
  const unrelatedHash = hash(unrelatedCode);
  const path = accountPath(libraryHash);
  const appUserId = randomUUID();
  const actionId = randomUUID();
  const unrelatedActionId = randomUUID();
  const unrelatedEventId = `unrelated-credit-${randomUUID()}`;
  const providerIntentId = randomUUID();
  const providerIntentEventHash = hash(`rotation-provider-event-${randomUUID()}`);
  const providerIntentReasonHash = hash(`rotation-provider-reason-${randomUUID()}`);
  const subscriptionPaymentId = `pi_rotation_${randomUUID()}`;
  const paymentHash = hash(subscriptionPaymentId);
  const separatelyRevokedPaymentHash = hash(`pi_revoked_${randomUUID()}`);
  const paymentRevocationId = randomUUID();
  const paymentRevocationEventHash = hash(`rotation-revocation-event-${randomUUID()}`);
  const subscriptionPeriodId = randomUUID();
  const subscriptionPeriodStart = new Date("2025-01-01T00:00:00.000Z");
  const subscriptionPeriodEnd = new Date("2025-02-01T00:00:00.000Z");
  const readinessPath = "private/classscribe-billing/credits-migration-control";
  const [priorReadiness] = await db.select({
    data: classscribeLegacyDocumentsTable.data,
    updatedAt: classscribeLegacyDocumentsTable.updatedAt,
  })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, readinessPath))
    .limit(1);
  const requestHash = hash("rotation-action-request");
  const priorProject = process.env.REVENUECAT_PROJECT_ID;
  const priorProxy = globalThis.__scribeProxy;
  let balance = 0;
  let welcomeGrantCalls = 0;
  process.env.REVENUECAT_PROJECT_ID = "crd-existing-test";
  globalThis.__scribeProxy = async (_connector, requestPath, options = {}) => {
    const url = new URL(requestPath, "https://revenuecat.test");
    if (url.pathname.endsWith("/customers") && options.method === "GET") {
      assert.equal(url.searchParams.get("search"), appUserId);
      return Response.json({ object: "list", items: [{
        object: "customer", id: "rc-existing-customer", project_id: "crd-existing-test",
        first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
        last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
      }] });
    }
    if (url.pathname.endsWith("/aliases") && options.method === "GET") {
      assert.match(url.pathname, /\/customers\/rc-existing-customer\/aliases$/);
      return Response.json({ object: "list", items: [{
        object: "customer.alias", id: appUserId, created_at: Date.now(),
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies") && options.method === "GET") {
      return Response.json({ object: "list", items: [{
        object: "virtual_currency_balance", currency_code: "CRD", balance,
        description: "Scribe Credits", name: "Scribe Credits",
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies/transactions") && options.method === "POST") {
      const request = JSON.parse(options.body);
      assert.deepEqual(request.adjustments, { CRD: 5 });
      assert.equal(request.reference, `credits-welcome-${libraryHash}`);
      balance += 5;
      welcomeGrantCalls += 1;
      return Response.json({ object: "virtual_currency_transaction", id: "existing-welcome-transaction" });
    }
    throw new Error(`Unexpected RevenueCat existing-library request: ${requestPath}`);
  };
  await db.insert(classscribeLegacyDocumentsTable).values({
    path,
    data: { libraryHash, billingAccountId: appUserId },
  });
  await db.insert(classscribeCreditActionsTable).values({
    id: actionId,
    libraryHash,
    action: "study-guide",
    requestHash,
    status: "completed",
    response: { creditState: "debited", providerIdentity: "preserved" },
  });
  await db.insert(classscribeCreditActionsTable).values({
    id: unrelatedActionId,
    libraryHash: unrelatedHash,
    action: "study-guide",
    requestHash,
    status: "completed",
    response: { creditState: "debited" },
  });
  await db.insert(classscribeCreditTransactionsTable).values({
    id: randomUUID(),
    eventId: unrelatedEventId,
    libraryHash: unrelatedHash,
    amount: 1,
    reason: "Unrelated library credit",
    source: "test",
  });
  await db.insert(classscribeCreditProviderIntentsTable).values({
    id: providerIntentId,
    libraryHash,
    eventHash: providerIntentEventHash,
    amount: 10,
    reasonHash: providerIntentReasonHash,
    source: "stripe",
    status: "uncertain",
  });
  await db.insert(classscribeCreditSubscriptionPaymentRevocationsTable).values({
    id: paymentRevocationId,
    libraryHash,
    paymentHash: separatelyRevokedPaymentHash,
    eventHash: paymentRevocationEventHash,
    source: "stripe",
  });
  await db.insert(classscribeCreditSubscriptionPeriodsTable).values({
    id: subscriptionPeriodId,
    libraryHash,
    periodStart: subscriptionPeriodStart,
    periodEnd: subscriptionPeriodEnd,
    highWaterPlan: "student",
    grantedAmount: 10,
    paymentHashes: [paymentHash],
    status: "active",
  });
  try {
    const first = await getCreditsStatus(code);
    const repeated = await getCreditsStatus(code);
    assert.equal(first.balance, 5);
    assert.equal(repeated.balance, 5);
    await db.transaction((tx) => rotateLibraryBillingIdentity(tx, libraryHash, rotatedHash));
    const afterRotation = await getCreditsStatus(rotatedCode);
    assert.equal(afterRotation.balance, 5);
    assert.equal(welcomeGrantCalls, 1);
    const history = await db.select().from(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, rotatedHash));
    assert.equal(history.length, 1);
    assert.equal(history[0].eventId, `credits-welcome-${libraryHash}`);
    const oldHistory = await db.select().from(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    assert.equal(oldHistory.length, 0);
    const [migratedAction] = await db.select().from(classscribeCreditActionsTable)
      .where(eq(classscribeCreditActionsTable.id, actionId));
    assert.equal(migratedAction.libraryHash, rotatedHash);
    assert.equal(migratedAction.id, actionId);
    assert.deepEqual(migratedAction.response, {
      creditState: "debited",
      providerIdentity: "preserved",
    });
    const [migratedProviderIntent] = await db.select().from(classscribeCreditProviderIntentsTable)
      .where(eq(classscribeCreditProviderIntentsTable.id, providerIntentId));
    assert.equal(migratedProviderIntent.libraryHash, rotatedHash);
    assert.equal(migratedProviderIntent.id, providerIntentId);
    assert.equal(migratedProviderIntent.eventHash, providerIntentEventHash);
    assert.equal(migratedProviderIntent.reasonHash, providerIntentReasonHash);
    const [migratedPaymentRevocation] = await db.select()
      .from(classscribeCreditSubscriptionPaymentRevocationsTable)
      .where(eq(classscribeCreditSubscriptionPaymentRevocationsTable.id, paymentRevocationId));
    assert.equal(migratedPaymentRevocation.libraryHash, rotatedHash);
    assert.equal(migratedPaymentRevocation.paymentHash, separatelyRevokedPaymentHash);
    assert.equal(migratedPaymentRevocation.eventHash, paymentRevocationEventHash);
    const [migratedSubscriptionPeriod] = await db.select()
      .from(classscribeCreditSubscriptionPeriodsTable)
      .where(eq(classscribeCreditSubscriptionPeriodsTable.id, subscriptionPeriodId));
    assert.equal(migratedSubscriptionPeriod.libraryHash, rotatedHash);
    assert.equal(migratedSubscriptionPeriod.id, subscriptionPeriodId);
    assert.equal(migratedSubscriptionPeriod.periodEnd.toISOString(), subscriptionPeriodEnd.toISOString());
    assert.equal(migratedSubscriptionPeriod.grantedAmount, 10);
    assert.deepEqual(migratedSubscriptionPeriod.paymentHashes, [paymentHash]);
    assert.equal(migratedSubscriptionPeriod.status, "active");
    await db.insert(classscribeLegacyDocumentsTable).values({
      path: readinessPath,
      data: {
        maintenance: false,
        activeCurrency: "CREDITS",
        serverSubscriptionGrantReady: true,
        version: "rotation-test-ready",
      },
    }).onConflictDoUpdate({
      target: classscribeLegacyDocumentsTable.path,
      set: { data: {
        maintenance: false,
        activeCurrency: "CREDITS",
        serverSubscriptionGrantReady: true,
        version: "rotation-test-ready",
      } },
    });
    await grantMonthlySubscriptionCredits({
      libraryCode: rotatedCode,
      plan: "student",
      periodStart: subscriptionPeriodStart.getTime(),
      periodEnd: subscriptionPeriodEnd.getTime(),
      source: "stripe",
      eventId: "rotated-period-replay",
      paymentId: subscriptionPaymentId,
    });
    assert.equal(welcomeGrantCalls, 1, "the migrated period blocks a duplicate same-period grant");
    const periodsAfterReplay = await db.select().from(classscribeCreditSubscriptionPeriodsTable)
      .where(eq(classscribeCreditSubscriptionPeriodsTable.libraryHash, rotatedHash));
    assert.equal(periodsAfterReplay.length, 1);
    assert.equal(periodsAfterReplay[0].grantedAmount, 10);
    const [unrelatedAction] = await db.select().from(classscribeCreditActionsTable)
      .where(eq(classscribeCreditActionsTable.id, unrelatedActionId));
    assert.equal(unrelatedAction.libraryHash, unrelatedHash);
    const [unrelatedTransaction] = await db.select().from(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.eventId, unrelatedEventId));
    assert.equal(unrelatedTransaction.libraryHash, unrelatedHash);
  } finally {
    await db.delete(classscribeCreditTransactionsTable)
      .where(inArray(classscribeCreditTransactionsTable.eventId, [
        `credits-welcome-${libraryHash}`,
        unrelatedEventId,
      ]));
    await db.delete(classscribeCreditActionsTable)
      .where(inArray(classscribeCreditActionsTable.id, [actionId, unrelatedActionId]));
    await db.delete(classscribeCreditSubscriptionPaymentRevocationsTable)
      .where(eq(classscribeCreditSubscriptionPaymentRevocationsTable.id, paymentRevocationId));
    await db.delete(classscribeCreditSubscriptionPeriodsTable)
      .where(inArray(classscribeCreditSubscriptionPeriodsTable.libraryHash, [libraryHash, rotatedHash]));
    await db.delete(classscribeCreditProviderIntentsTable)
      .where(eq(classscribeCreditProviderIntentsTable.id, providerIntentId));
    await clearProviderIntents(libraryHash, rotatedHash, unrelatedHash);
    await db.delete(classscribeLegacyDocumentsTable)
      .where(inArray(classscribeLegacyDocumentsTable.path, [
        path,
        accountPath(rotatedHash),
        `private/classscribe-billing/aliases/${libraryHash}`,
      ]));
    if (priorReadiness) {
      await db.update(classscribeLegacyDocumentsTable)
        .set({ data: priorReadiness.data, updatedAt: priorReadiness.updatedAt })
        .where(eq(classscribeLegacyDocumentsTable.path, readinessPath));
    } else {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, readinessPath));
    }
    if (priorProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProject;
    if (priorProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = priorProxy;
  }
});

test("completed and pending credit actions survive repeated rotation with legacy event IDs and isolated wallets", async (t) => {
  for (const legacy of [false, true]) {
    await t.test(legacy ? "legacy hash-derived actions" : "stable billing-identity actions", async () => {
      const codes = Array.from({ length: 4 }, () => `u_${randomUUID().replaceAll("-", "")}`);
      const [code, rotatedCode, twiceRotatedCode, unrelatedCode] = codes;
      const hashes = codes.map(hash);
      const [libraryHash, rotatedHash, twiceRotatedHash, unrelatedHash] = hashes;
      const ownerId = randomUUID();
      const unrelatedId = randomUUID();
      const balances = new Map([[ownerId, 20], [unrelatedId, 20]]);
      const writes = [];
      const completedRequestId = `completed_${randomUUID()}`;
      const pendingRequestId = `pending_${randomUUID()}`;
      const requestHash = hash("synthetic-rotation-study-request");
      const cost = 2;
      const previousProxy = globalThis.__scribeProxy;
      const previousFetch = globalThis.fetch;
      const previousProject = process.env.REVENUECAT_PROJECT_ID;
      process.env.REVENUECAT_PROJECT_ID = "synthetic-credit-action-rotation";
      globalThis.fetch = async () => { throw new Error("Live HTTP is forbidden in credit rotation tests"); };
      globalThis.__scribeProxy = async (_connector, requestPath, options = {}) => {
        const url = new URL(requestPath, "https://revenuecat.test");
        if (url.pathname.endsWith("/customers") && options.method === "GET") {
          const id = url.searchParams.get("search");
          assert.ok(balances.has(id), "only synthetic billing identities may reach the provider");
          return Response.json({ object: "list", items: [{
            object: "customer", id, project_id: "synthetic-credit-action-rotation",
            first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
            last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
          }] });
        }
        const id = decodeURIComponent(url.pathname.match(/\/customers\/([^/]+)/)?.[1] ?? "");
        assert.ok(balances.has(id));
        if (url.pathname.endsWith("/aliases") && options.method === "GET") {
          return Response.json({ object: "list", items: [{
            object: "customer.alias", id, created_at: Date.now(),
          }] });
        }
        if (url.pathname.endsWith("/virtual_currencies") && options.method === "GET") {
          return Response.json({ object: "list", items: [{
            object: "virtual_currency_balance", currency_code: "CRD",
            balance: balances.get(id), name: "Scribe Credits", description: "Scribe Credits",
          }] });
        }
        if (url.pathname.endsWith("/virtual_currencies/transactions") && options.method === "POST") {
          const transaction = JSON.parse(options.body);
          const amount = transaction.adjustments.CRD;
          assert.ok(Number.isSafeInteger(amount));
          writes.push({ id, amount, eventId: transaction.reference });
          balances.set(id, balances.get(id) + amount);
          return Response.json({ object: "virtual_currency_transaction", id: randomUUID() });
        }
        throw new Error(`Unexpected synthetic provider request: ${requestPath}`);
      };
      try {
        await db.insert(classscribeLegacyDocumentsTable).values([
          { path: accountPath(libraryHash), data: {
            libraryHash, billingAccountId: ownerId,
          } },
          { path: accountPath(unrelatedHash), data: {
            libraryHash: unrelatedHash, billingAccountId: unrelatedId,
          } },
        ]);
        // The synthetic starting balances already include their welcome grant.
        await db.insert(classscribeCreditTransactionsTable).values(
          [libraryHash, unrelatedHash].map((value) => ({
            id: randomUUID(), eventId: `credits-welcome-${value}`, libraryHash: value,
            amount: 5, reason: "Welcome credits", source: "welcome",
          })),
        );
        // Create legacy actions at an intermediate identity, not only at the
        // original hash: historical rotations must remain discoverable too.
        if (legacy) {
          await db.transaction((tx) => rotateLibraryBillingIdentity(tx, libraryHash, rotatedHash));
        }
        const activeCode = legacy ? rotatedCode : code;
        const activeHash = legacy ? rotatedHash : libraryHash;
        const claim = async (requestId) => {
          if (!legacy) return reserveCreditsForAction(activeCode, "study-guide", requestId, requestHash, cost);
          const actionId = hash(`${activeHash}:study-guide:${requestId}`);
          await db.insert(classscribeCreditActionsTable).values({
            id: actionId, libraryHash: activeHash, action: "study-guide",
            requestHash, status: "reserved",
          });
          await adjustCreditsForLibraryCode(activeCode, -cost, "study-guide credit use", "spend",
            `credits-action-${actionId}-debit`);
          assert.equal((await getCreditActionState(activeCode, "study-guide", requestId, requestHash)).status, "debited");
          return { actionId };
        };
        const completed = await claim(completedRequestId);
        const pending = await claim(pendingRequestId);
        const savedResponse = { studyGuide: "Synthetic completed guide" };
        await completeCreditAction(completed.actionId, savedResponse);
        const unrelated = await reserveCreditsForAction(
          unrelatedCode, "study-guide", completedRequestId, requestHash, cost,
        );
        assert.notEqual(unrelated.actionId, completed.actionId);
        assert.equal(balances.get(ownerId), 16);
        assert.equal(balances.get(unrelatedId), 18);
        if (!legacy) {
          await db.transaction((tx) => rotateLibraryBillingIdentity(tx, libraryHash, rotatedHash));
        }
        await db.transaction((tx) => rotateLibraryBillingIdentity(tx, rotatedHash, twiceRotatedHash));
        // Mirror the rotation endpoint's bearer-code revocation.
        await db.insert(classscribeLegacyDocumentsTable).values(hashes.slice(0, 2).map((value) => ({
          path: `revoked/${value}`, data: { replaced: true },
        })));
        const writesBeforeReplay = writes.length;
        assert.deepEqual(await getCreditActionState(twiceRotatedCode, "study-guide", completedRequestId, requestHash), {
          actionId: completed.actionId, status: "completed", response: savedResponse,
        });
        assert.deepEqual(await reserveCreditsForAction(
          twiceRotatedCode, "study-guide", completedRequestId, requestHash, cost,
        ), { actionId: completed.actionId, replay: true, response: savedResponse });
        assert.equal(writes.length, writesBeforeReplay, "completed replay must not debit again");
        await assert.rejects(reserveCreditsForAction(
          twiceRotatedCode, "study-guide", completedRequestId, hash("different-content"), cost,
        ), (error) => error.code === "idempotency_key_reused");
        const pendingState = await getCreditActionState(twiceRotatedCode, "study-guide", pendingRequestId, requestHash);
        assert.equal(pendingState.actionId, pending.actionId);
        assert.equal(pendingState.status, "debited");
        assert.deepEqual(await reserveCreditsForAction(
          twiceRotatedCode, "study-guide", pendingRequestId, requestHash, cost, { resumeReserved: true },
        ), { actionId: pending.actionId, replay: false, resumed: true });
        assert.equal(writes.length, writesBeforeReplay, "resuming a debit must not charge twice");
        await assert.rejects(refundCreditAction(unrelatedCode, pending.actionId, cost, "study-guide"),
          (error) => error.code === "not_granted");
        assert.equal((await getCreditActionState(unrelatedCode, "study-guide", pendingRequestId)), undefined);
        assert.equal(await refundCreditAction(twiceRotatedCode, pending.actionId, cost, "study-guide"), true);
        assert.equal(await refundCreditAction(twiceRotatedCode, pending.actionId, cost, "study-guide"), false);
        assert.equal(writes.length, writesBeforeReplay + 1, "failed action is refunded exactly once");
        assert.equal((await getCreditActionState(twiceRotatedCode, "study-guide", pendingRequestId)).status, "failed");
        await assert.rejects(reserveCreditsForAction(
          twiceRotatedCode, "study-guide", pendingRequestId, requestHash, cost,
        ), (error) => error.code === "action_failed_new_id_required");
        await assert.rejects(getCreditActionState(code, "study-guide", completedRequestId),
          (error) => error.code === "not_granted");
        assert.equal(balances.get(ownerId), 18);
        assert.equal(balances.get(unrelatedId), 18);
        const ownerRows = await db.select().from(classscribeCreditTransactionsTable)
          .where(eq(classscribeCreditTransactionsTable.libraryHash, twiceRotatedHash));
        assert.deepEqual(ownerRows.map((row) => row.eventId).sort(), [
          `credits-action-${completed.actionId}-debit`,
          `credits-action-${pending.actionId}-debit`,
          `credits-action-${pending.actionId}-refund`,
          `credits-welcome-${libraryHash}`,
        ].sort());
        assert.equal((await db.select().from(classscribeCreditTransactionsTable)
          .where(inArray(classscribeCreditTransactionsTable.libraryHash, hashes.slice(0, 2)))).length, 0);
        assert.equal((await getCreditActionState(unrelatedCode, "study-guide", completedRequestId)).status, "debited");
      } finally {
        await db.delete(classscribeCreditTransactionsTable)
          .where(inArray(classscribeCreditTransactionsTable.libraryHash, hashes));
        await db.delete(classscribeCreditActionsTable)
          .where(inArray(classscribeCreditActionsTable.libraryHash, hashes));
        await clearProviderIntents(...hashes);
        await db.delete(classscribeLegacyDocumentsTable).where(inArray(classscribeLegacyDocumentsTable.path, [
          ...hashes.map(accountPath),
          ...hashes.map((value) => `private/classscribe-billing/aliases/${value}`),
          ...hashes.map((value) => `revoked/${value}`),
        ]));
        globalThis.__scribeProxy = previousProxy;
        globalThis.fetch = previousFetch;
        if (previousProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
        else process.env.REVENUECAT_PROJECT_ID = previousProject;
      }
    });
  }
});

test("RevenueCat v2 debit rejection preserves the requested amount in its 422 error", async () => {
  const code = `u_${randomUUID().replaceAll("-", "")}`;
  const libraryHash = hash(code);
  const path = accountPath(libraryHash);
  const priorProject = process.env.REVENUECAT_PROJECT_ID;
  const priorProxy = globalThis.__scribeProxy;
  let appUserId;
  process.env.REVENUECAT_PROJECT_ID = "credits-v2-test";
  globalThis.__scribeProxy = async (_connector, requestPath, options = {}) => {
    const url = new URL(requestPath, "https://revenuecat.test");
    if (url.pathname.endsWith("/customers") && options.method === "GET") {
      appUserId = url.searchParams.get("search");
      return Response.json({ object: "list", items: [{
        object: "customer", id: "customer-v2", project_id: "credits-v2-test",
        first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
        last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
      }] });
    }
    if (url.pathname.endsWith("/aliases") && options.method === "GET") {
      return Response.json({ object: "list", items: [{ object: "customer.alias", id: appUserId, created_at: Date.now() }] });
    }
    if (url.pathname.endsWith("/virtual_currencies") && options.method === "GET") {
      return Response.json({ object: "list", items: [{
        object: "virtual_currency_balance", currency_code: "CRD", balance: 10,
        description: "Scribe Credits", name: "Scribe Credits",
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies/transactions") && options.method === "POST") {
      const request = JSON.parse(options.body);
      assert.deepEqual(request.adjustments, { CRD: -2 });
      assert.equal(request.reference, options.headers["Idempotency-Key"]);
      return Response.json({ message: "insufficient balance" }, { status: 422 });
    }
    throw new Error(`Unexpected RevenueCat test request: ${requestPath}`);
  };
  try {
    await assert.rejects(
      adjustCreditsForLibraryCode(code, -2, "test spend", "spend", "credits-v2-rejected-debit"),
      (error) => error.status === 422 && error.code === "insufficient_credits" &&
        error.message.includes("2 Scribe Credits"),
    );
    const rows = await db.select().from(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    assert.equal(rows.length, 0, "a failed RevenueCat adjustment must not enter the DB ledger");
  } finally {
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    await clearProviderIntents(libraryHash);
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path));
    if (priorProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProject;
    if (priorProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = priorProxy;
  }
});

test("Stripe credit fulfillment verifies purchases and safely reconciles cumulative refunds, late delivery, disputes, and uncertain adjustments", async () => {
  const code = `u_${randomUUID().replaceAll("-", "")}`;
  const libraryHash = hash(code);
  const appUserId = randomUUID();
  const path = accountPath(libraryHash);
  const priceId = "price_scribe_credits_10";
  const productId = "prod_scribe_credits";
  const pack = creditsConfig.packs.find((item) => item.id === "credits_10");
  const configuredPrice = {
    id: priceId, active: true, type: "one_time", currency: "usd",
    unit_amount: pack.priceCents, metadata: { pack_id: pack.id, credits: String(pack.credits) },
    product: productId,
  };
  const configuredProduct = {
    id: productId, active: true,
    metadata: { pack_id: pack.id, credits: String(pack.credits) },
  };
  const provider = {
    amount: 0,
    async balance() { return this.amount; },
    async adjust(_appUserId, amount) { this.amount += amount; },
  };
  let retrievedSession;
  const sessionIds = [];
  let charge = { id: "ch_credit_test", payment_intent: "pi_credit_test", paid: true,
    amount: pack.priceCents, amount_refunded: 0, currency: "usd", disputed: false };
  const stripe = {
    paymentIntents: { async retrieve(id) {
      assert.equal(id, "pi_credit_test");
      return { id, status: "succeeded", latest_charge: charge.id };
    } },
    charges: { async retrieve(id) { assert.equal(id, charge.id); return charge; } },
    checkout: {
      sessions: {
        async retrieve(sessionId, options) {
          assert.equal(sessionId, retrievedSession.id);
          assert.deepEqual(options.expand, ["line_items.data.price.product"]);
          return retrievedSession;
        },
        async list(options) {
          assert.equal(options.payment_intent, "pi_credit_test");
          return { data: [retrievedSession], has_more: false };
        },
      },
    },
    prices: { async list() { return { data: [configuredPrice] }; } },
    products: { async retrieve(id) { assert.equal(id, productId); return configuredProduct; } },
  };
  const metadata = {
    classscribe_library_hash: libraryHash,
    classscribe_rc_app_user_id: appUserId,
    classscribe_credits_pack: pack.id,
    pack_id: pack.id,
    credits: String(pack.credits),
  };
  const baseSession = {
    id: `cs_credit_pack_${randomUUID()}`, metadata, client_reference_id: libraryHash,
    payment_intent: "pi_credit_test",
    payment_status: "paid", mode: "payment", amount_total: pack.priceCents, currency: "usd",
    line_items: { data: [{ quantity: 1, price: { id: priceId, product: productId } }] },
  };
  sessionIds.push(baseSession.id);
  await db.insert(classscribeLegacyDocumentsTable).values({
    path,
    data: { libraryHash, billingAccountId: appUserId },
  });
  try {
    retrievedSession = { ...baseSession, client_reference_id: hash("attacker-library") };
    await assert.rejects(
      fulfillCreditCheckout(baseSession, provider, stripe),
      (error) => error.code === "invalid_checkout_event",
    );
    retrievedSession = {
      ...baseSession,
      line_items: { data: [{ quantity: 1, price: { id: "price_forged", product: productId } }] },
    };
    await assert.rejects(
      fulfillCreditCheckout(baseSession, provider, stripe),
      (error) => error.code === "invalid_checkout_event",
    );
    assert.equal(provider.amount, 0);

    retrievedSession = baseSession;
    await Promise.all([
      fulfillCreditCheckout(baseSession, provider, stripe),
      fulfillCreditCheckout(baseSession, provider, stripe),
    ]);
    assert.equal(provider.amount, pack.credits, "a repeated verified session must not grant twice");
    const rows = await db.select().from(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, pack.credits);

    charge.amount_refunded = 50;
    assert.equal(await reconcileCreditPackCharge(charge, stripe, provider), true);
    const partial = refundedPackCredits(pack.credits, pack.priceCents, 50, false);
    assert.equal(provider.amount, pack.credits - partial);
    await reconcileCreditPackCharge(charge, stripe, provider);
    assert.equal(provider.amount, pack.credits - partial, "repeated refunds must not debit twice");
    charge.amount_refunded = pack.priceCents;
    await fulfillCreditCheckout(baseSession, provider, stripe);
    assert.equal(provider.amount, 0, "a cumulative full refund removes only remaining pack credits");
    await fulfillCreditCheckout(baseSession, provider, stripe);
    assert.equal(provider.amount, 0, "late completion cannot re-grant refunded credits");

    retrievedSession = { ...baseSession, id: `cs_refund_first_${randomUUID()}` };
    sessionIds.push(retrievedSession.id);
    await reconcileCreditPackCharge(charge, stripe, provider);
    await fulfillCreditCheckout(retrievedSession, provider, stripe);
    assert.equal(provider.amount, 0, "refund before delivery never grants spendable credits");

    retrievedSession = { ...baseSession, id: `cs_partial_first_${randomUUID()}` };
    sessionIds.push(retrievedSession.id);
    charge.amount_refunded = 50;
    await fulfillCreditCheckout(retrievedSession, provider, stripe);
    assert.equal(provider.amount, pack.credits - partial, "partial refund before delivery grants only eligible credits");
    provider.amount = 1;
    charge.amount_refunded = pack.priceCents;
    await fulfillCreditCheckout(retrievedSession, provider, stripe);
    assert.equal(provider.amount, 0, "refunds cannot create negative wallets");

    retrievedSession = { ...baseSession, id: `cs_disputed_${randomUUID()}` };
    sessionIds.push(retrievedSession.id);
    charge.amount_refunded = 0;
    await fulfillCreditCheckout(retrievedSession, provider, stripe);
    charge.disputed = true;
    await reconcileCreditPackCharge(charge, stripe, provider);
    assert.equal(provider.amount, 0, "disputed funds cannot leave usable credits");
    charge.disputed = false;
    await fulfillCreditCheckout(retrievedSession, provider, stripe);
    assert.equal(provider.amount, 0, "stale completion cannot undo revocation");

    retrievedSession = { ...baseSession, id: `cs_spend_during_refund_${randomUUID()}` };
    sessionIds.push(retrievedSession.id);
    await fulfillCreditCheckout(retrievedSession, provider, stripe);
    charge.amount_refunded = pack.priceCents;
    let balanceReads = 0;
    const concurrentSpendProvider = {
      async balance() {
        balanceReads++;
        if (balanceReads === 2) provider.amount = 0;
        return provider.amount;
      },
      async adjust(_user, amount) { assert.ok(provider.amount + amount >= 0); provider.amount += amount; },
    };
    await fulfillCreditCheckout(retrievedSession, concurrentSpendProvider, stripe);
    assert.equal(provider.amount, 0, "a concurrent spend must not leave a refund debit aimed at future purchases");
    provider.amount = 20;
    await fulfillCreditCheckout(retrievedSession, provider, stripe);
    assert.equal(provider.amount, 20, "replaying a no-balance refund cannot debit unrelated later credits");
    provider.amount = 0;

    retrievedSession = { ...baseSession, id: `cs_uncertain_${randomUUID()}` };
    sessionIds.push(retrievedSession.id);
    charge.amount_refunded = 0;
    await fulfillCreditCheckout(retrievedSession, provider, stripe);
    charge.amount_refunded = 50;
    let writes = 0;
    const uncertainProvider = {
      async balance() { return provider.amount; },
      async adjust(_user, amount) { writes++; provider.amount += amount; throw new Error("Response lost after adjustment"); },
    };
    await assert.rejects(fulfillCreditCheckout(retrievedSession, uncertainProvider, stripe),
      error => error.code === "credit_adjustment_uncertain");
    charge.amount_refunded = pack.priceCents;
    await assert.rejects(fulfillCreditCheckout(retrievedSession, uncertainProvider, stripe),
      error => error.code === "credit_adjustment_uncertain");
    assert.equal(writes, 1, "uncertain partial refunds block further cumulative adjustments");
  } finally {
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    await clearProviderIntents(libraryHash);
    for (const sessionId of sessionIds) {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, `private/classscribe-billing/credit-pack-state/${hash(sessionId)}`));
    }
    await db.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path));
  }
});

test("pack refund amounts are proportional, rounded up, bounded, and dispute-safe", () => {
  assert.equal(refundedPackCredits(10, 199, 0, false), 0);
  assert.equal(refundedPackCredits(10, 199, 1, false), 1);
  assert.equal(refundedPackCredits(10, 199, 199, false), 10);
  assert.equal(refundedPackCredits(75, 999, 0, true), 75);
  assert.throws(() => refundedPackCredits(10, 199, 200, false));
});

test("RevenueCat virtual-currency webhook history records signed expiry/refund adjustments and deduplicates", async () => {
  const code = `u_${randomUUID().replaceAll("-", "")}`;
  const libraryHash = hash(code);
  const path = accountPath(libraryHash);
  const appUserId = randomUUID();
  const suffix = randomUUID();
  const directReference = `test-direct-api-reference-${suffix}`;
  const [priorControl] = await db.select({ data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, migrationControlPath)).limit(1);
  await db.insert(classscribeLegacyDocumentsTable).values({
    path: migrationControlPath,
    data: {
      maintenance: false,
      activeCurrency: "CREDITS",
      serverSubscriptionGrantReady: true,
      version: "credits-test-verified-cutover",
    },
  }).onConflictDoUpdate({
    target: classscribeLegacyDocumentsTable.path,
    set: {
      data: {
        maintenance: false,
        activeCurrency: "CREDITS",
        serverSubscriptionGrantReady: true,
        version: "credits-test-verified-cutover",
      },
      updatedAt: new Date(),
    },
  });
  await db.insert(classscribeLegacyDocumentsTable).values({
    path,
    data: { libraryHash, billingAccountId: appUserId },
  });
  await db.insert(classscribeCreditTransactionsTable).values({
    id: randomUUID(),
    eventId: directReference,
    libraryHash,
    amount: 5,
    reason: "Direct API grant",
    source: "promo",
    metadata: {},
  });
  const expiration = {
    event: {
      id: `test-rc-expiration-event-${suffix}`,
      virtual_currency_transaction_id: `test-rc-expiration-transaction-${suffix}`,
      app_user_id: appUserId,
      type: "VIRTUAL_CURRENCY_TRANSACTION",
      source: "expiration",
      event_timestamp_ms: Date.now(),
      adjustments: [{ amount: -2, currency: { code: "CRD", name: "Scribe Credits" } }],
    },
  };
  const refund = {
    event: {
      id: `test-rc-refund-event-${suffix}`,
      virtual_currency_transaction_id: `test-rc-refund-transaction-${suffix}`,
      app_user_id: appUserId,
      type: "VIRTUAL_CURRENCY_TRANSACTION",
      source: "in_app_purchase",
      adjustments: [{ amount: -3, currency: { code: "CRD", name: "Scribe Credits" } }],
    },
  };
  const duplicateApiGrant = {
    event: {
      id: `test-rc-api-grant-event-${suffix}`,
      virtual_currency_transaction_id: `test-rc-api-grant-transaction-${suffix}`,
      reference: directReference,
      app_user_id: appUserId,
      type: "VIRTUAL_CURRENCY_TRANSACTION",
      source: "server_api",
      adjustments: [{ amount: 5, currency: { code: "CRD", name: "Scribe Credits" } }],
    },
  };
  try {
    await processCreditsRevenueCatWebhook(expiration);
    await processCreditsRevenueCatWebhook(expiration);
    await processCreditsRevenueCatWebhook(refund);
    await processCreditsRevenueCatWebhook(duplicateApiGrant);
    await processCreditsRevenueCatWebhook(expiration);
    await processCreditsRevenueCatWebhook(refund);
    const rows = await db.select().from(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    assert.deepEqual(rows.map((row) => row.amount).sort((a, b) => a - b), [-3, -2, 5]);
    assert.equal(rows.find((row) => row.eventId === `revenuecat-test-rc-expiration-transaction-${suffix}`).reason,
      "RevenueCat virtual currency expiration");
  } finally {
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, libraryHash));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, path));
    if (priorControl) {
      await db.insert(classscribeLegacyDocumentsTable).values({
        path: migrationControlPath,
        data: priorControl.data,
      }).onConflictDoUpdate({
        target: classscribeLegacyDocumentsTable.path,
        set: { data: priorControl.data, updatedAt: new Date() },
      });
    } else {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, migrationControlPath));
    }
  }
});