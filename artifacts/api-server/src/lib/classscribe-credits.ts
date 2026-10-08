import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Stripe from "stripe";
import {
  classscribeCreditActionsTable,
  classscribeCreditProviderIntentsTable,
  classscribeCreditSubscriptionPaymentRevocationsTable,
  classscribeCreditTransactionsTable,
  classscribeCreditSubscriptionPeriodsTable,
  classscribeLegacyDocumentsTable,
  classscribePrivacyTombstonesTable,
  db,
} from "@workspace/db";
import { validUid } from "./classscribe-legacy-access";
import { ensureRevenueCatCustomer, getRevenueCatAppUserId } from "./classscribe-billing";
import { creditsConfig } from "./credits-config";
import { refundedPackCredits } from "./credits-pack-refunds";
import {
  canonicalPeriodDate,
  isPaidStoreSubscriptionPeriod,
  planFromStoreProductIdentifier,
  storeSubscriptionProductForEvent,
  subscriptionPeriodGrantDecision,
  subscriptionPeriodGrantKey,
  subscriptionPeriodReversalAmount,
  subscriptionPeriodScopeKey,
  verifiedSubscriptionSnapshotMatches,
  type SubscriptionCreditPlan,
} from "./credits-subscription-periods";
import { getCreditsMigrationState } from "./credits-migration-state";
import { hasRevenueCatCreditsApiKey, revenueCatRequest } from "./revenuecat-request";

const ledger = classscribeCreditTransactionsTable;
const actions = classscribeCreditActionsTable;
const documents = classscribeLegacyDocumentsTable;
const subscriptionPeriods = classscribeCreditSubscriptionPeriodsTable;
const providerIntents = classscribeCreditProviderIntentsTable;
const paymentRevocations = classscribeCreditSubscriptionPaymentRevocationsTable;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const accountPath = (value: string) => `private/classscribe-billing/accounts/${value}`;
const aliasPath = (value: string) => `private/classscribe-billing/aliases/${value}`;

export class CreditsError extends Error {
  providerAdjustmentNotApplied = false;

  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

function tagDefinitelyUnappliedProviderError(error: unknown): CreditsError {
  const tagged = error instanceof CreditsError
    ? error
    : new CreditsError(503, "revenuecat_pre_adjustment_unavailable",
      "RevenueCat could not prepare the customer for a credits adjustment.");
  tagged.providerAdjustmentNotApplied = true;
  return tagged;
}

type CreditProvider = {
  balance(appUserId: string): Promise<number>;
  adjust(appUserId: string, amount: number, reason: string, eventId: string): Promise<void>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function revenueCatCustomer(appUserId: string): Promise<{ project: string; customer: string }> {
  try {
    return await ensureRevenueCatCustomer(appUserId);
  } catch (error) {
    if (error instanceof CreditsError) throw error;
    const billingError = error as { code?: unknown; message?: unknown };
    throw new CreditsError(
      503,
      typeof billingError.code === "string" ? billingError.code : "revenuecat_customer_unavailable",
      typeof billingError.message === "string"
        ? billingError.message
        : "RevenueCat could not provision or verify the credits customer. Please retry.",
    );
  }
}

function missingRevenueCatPurchasesScopeMessage(): string {
  return hasRevenueCatCreditsApiKey()
    ? "The configured server-only RevenueCat API key must include customer_information:purchases:read_write."
    : "The connected RevenueCat OAuth scopes do not provide customer_information:purchases:read_write; reauthorization cannot add it. Configure the server-only REVENUECAT_CREDITS_API_KEY with customer read/write and purchases read/write permissions.";
}

const revenueCatProvider: CreditProvider = {
  async balance(appUserId) {
    const { project, customer } = await revenueCatCustomer(appUserId);
    const response = await revenueCatRequest(
      `/v2/projects/${encodeURIComponent(project)}/customers/${encodeURIComponent(customer)}/virtual_currencies?include_empty_balances=true&limit=100`,
      { method: "GET" },
    );
    if (response.status === 403) {
      throw new CreditsError(503, "revenuecat_purchases_scope_missing", missingRevenueCatPurchasesScopeMessage());
    }
    if (!response.ok) throw new CreditsError(503, "revenuecat_unavailable", "RevenueCat could not verify your credits.");
    const result = record(await response.json());
    const items = Array.isArray(result.items) ? result.items.map(record) : [];
    const currencyCode = await getCreditsRuntimeTarget();
    const item = items.find((entry) => entry.currency_code === currencyCode);
    if (!item || !Number.isSafeInteger(item.balance) || Number(item.balance) < 0) {
      throw new CreditsError(503, "revenuecat_balance_invalid", "RevenueCat returned an invalid credits balance.");
    }
    return Number(item.balance);
  },
  async adjust(appUserId, amount, reason, eventId) {
    let project: string;
    let customer: string;
    let currencyCode: "CRD" | "CREDITS";
    try {
      ({ project, customer } = await revenueCatCustomer(appUserId));
      currencyCode = await getCreditsRuntimeTarget();
    } catch (error) {
      throw tagDefinitelyUnappliedProviderError(error);
    }
    const response = await revenueCatRequest(
      `/v2/projects/${encodeURIComponent(project)}/customers/${encodeURIComponent(customer)}/virtual_currencies/transactions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": eventId,
        },
        body: JSON.stringify({
          adjustments: { [currencyCode]: amount },
          reference: eventId,
        }),
      },
    );
    if (response.status === 422) {
      const direction = amount < 0 ? "debit" : "grant";
      throw new CreditsError(
        422,
        amount < 0 ? "insufficient_credits" : "revenuecat_adjustment_rejected",
        `RevenueCat rejected the ${direction} of ${Math.abs(amount)} Scribe Credits. Refresh the balance and try again.`,
      );
    }
    if (response.status === 401) {
      throw new CreditsError(503, "revenuecat_auth_rejected",
        "RevenueCat rejected the server credits credentials; no adjustment was applied.");
    }
    if (response.status === 403) {
      throw new CreditsError(503, "revenuecat_purchases_scope_missing", missingRevenueCatPurchasesScopeMessage());
    }
    if (!response.ok) throw new CreditsError(503, "revenuecat_adjustment_failed", "RevenueCat could not update credits. Please retry.");
  },
};

function libraryHashForCode(code: string): string {
  if (!validUid(code)) throw new CreditsError(403, "not_granted", "Not allowed.");
  return hash(code);
}

async function isRevoked(code: string): Promise<boolean> {
  const [row] = await db.select({ path: documents.path }).from(documents)
    .where(eq(documents.path, `revoked/${hash(code)}`)).limit(1);
  return Boolean(row);
}

async function authorizeLibrary(code: string): Promise<string> {
  const libraryHash = await canonicalLibraryHash(libraryHashForCode(code));
  if (await isRevoked(code)) throw new CreditsError(403, "not_granted", "This library code has been replaced.");
  await assertCreditsLibraryNotDeleted(libraryHash);
  return libraryHash;
}

export type CreditsSubscriptionPeriodReadiness = {
  ready: boolean;
  reason?: string;
};

/**
 * Fail-closed rollout contract for the Stripe and store subscription grant
 * paths. The persistent control record is intentionally not inferred from
 * environment defaults or catalog assumptions.
 */
export async function getCreditsSubscriptionPeriodReadiness(): Promise<CreditsSubscriptionPeriodReadiness> {
  const state = await getCreditsMigrationState();
  if (state.maintenance || state.version === "legacy-v1") {
    return { ready: false, reason: "credits_maintenance_pending" };
  }
  if (state.activeCurrency !== "CREDITS") {
    return { ready: false, reason: "credits_migration_incomplete" };
  }
  if (!state.serverSubscriptionGrantReady) {
    return { ready: false, reason: "store_subscription_autogrants_attached" };
  }
  return { ready: true };
}

export async function getCreditsRuntimeTarget(): Promise<"CRD" | "CREDITS"> {
  const state = await getCreditsMigrationState();
  if (state.maintenance || state.version === "legacy-v1") return "CRD";
  return state.activeCurrency === "CREDITS" ? creditsConfig.selectorTarget : "CRD";
}

async function canonicalLibraryHash(initial: string): Promise<string> {
  let current = initial;
  const seen = new Set<string>();
  for (let depth = 0; depth < 32; depth += 1) {
    if (seen.has(current)) throw new CreditsError(503, "billing_identity_invalid", "Library billing identity is unavailable.");
    seen.add(current);
    const [row] = await db.select({ data: documents.data }).from(documents)
      .where(eq(documents.path, aliasPath(current))).limit(1);
    const next = record(row?.data).toHash;
    if (typeof next !== "string" || !/^[a-f0-9]{64}$/.test(next)) return current;
    current = next;
  }
  throw new CreditsError(503, "billing_identity_invalid", "Library billing identity is unavailable.");
}

async function resolveSubscriptionLibraryIdentity(value: string): Promise<{
  libraryHash: string;
  appUserId: string;
}> {
  if (validUid(value)) {
    const libraryHash = await authorizeLibrary(value);
    return {
      libraryHash,
      appUserId: await getRevenueCatAppUserId(value),
    };
  }
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new CreditsError(403, "not_granted", "Not allowed.");
  }
  const libraryHash = await canonicalLibraryHash(value);
  await assertCreditsLibraryNotDeleted(libraryHash);
  const [account] = await db.select({ data: documents.data }).from(documents)
    .where(eq(documents.path, accountPath(libraryHash))).limit(1);
  const appUserId = record(account?.data).billingAccountId;
  if (typeof appUserId !== "string" || appUserId.length === 0 || appUserId.length > 200) {
    throw new CreditsError(403, "not_granted", "This verified billing identity has no linked credits account.");
  }
  return { libraryHash, appUserId };
}

async function assertCreditsLibraryNotDeleted(libraryHash: string): Promise<void> {
  const [tombstone] = await db.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
    .from(classscribePrivacyTombstonesTable)
    .where(eq(classscribePrivacyTombstonesTable.libraryHash, libraryHash)).limit(1);
  if (tombstone) {
    throw new CreditsError(403, "credit_account_deleted", "This library’s credits account has been deleted.");
  }
}

async function persistTransaction(input: {
  libraryHash: string;
  eventId: string;
  amount: number;
  reason: string;
  source: string;
  date?: Date;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(ledger).values({
    id: randomUUID(),
    eventId: input.eventId,
    libraryHash: input.libraryHash,
    amount: input.amount,
    reason: input.reason,
    source: input.source,
    ...(input.date ? { date: input.date } : {}),
    metadata: input.metadata ?? {},
  }).onConflictDoNothing({ target: ledger.eventId });
}

async function grantForLibrary(
  libraryHash: string,
  appUserId: string,
  amount: number,
  reason: string,
  source: string,
  eventId: string,
  provider: CreditProvider = revenueCatProvider,
  metadata: Record<string, unknown> = {},
  capRefundDebitToBalance = false,
): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount === 0 || !eventId || eventId.length > 200) {
    throw new CreditsError(400, "invalid_adjustment", "Invalid credit adjustment.");
  }
  await assertCreditsLibraryNotDeleted(libraryHash);
  const intentId = hash(eventId);
  const eventHash = hash(eventId);
  const reasonHash = hash(reason);
  const reserved = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits-event:${intentId}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits:${libraryHash}`}, 0))`);
    const [tombstone] = await tx.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
      .from(classscribePrivacyTombstonesTable)
      .where(eq(classscribePrivacyTombstonesTable.libraryHash, libraryHash)).limit(1);
    if (tombstone) throw new CreditsError(403, "credit_account_deleted", "This library’s credits account has been deleted.");
    const [prior] = await tx.select({ eventId: ledger.eventId, libraryHash: ledger.libraryHash }).from(ledger)
      .where(eq(ledger.eventId, eventId)).limit(1);
    if (prior) {
      if (prior.libraryHash !== libraryHash) {
        throw new CreditsError(409, "credit_event_collision", "This credit event is already assigned to another library.");
      }
      return false;
    }
    const [existingIntent] = await tx.select().from(providerIntents)
      .where(eq(providerIntents.id, intentId)).limit(1);
    if (existingIntent) {
      if (existingIntent.libraryHash !== libraryHash || existingIntent.eventHash !== eventHash ||
        existingIntent.amount !== amount || existingIntent.reasonHash !== reasonHash ||
        existingIntent.source !== source) {
        throw new CreditsError(409, "credit_event_collision", "This credit event was already reserved with different details.");
      }
      if (existingIntent.status === "completed") return false;
      if (existingIntent.status === "cancelled") {
        throw new CreditsError(403, "credit_account_deleted", "This library’s credits account has been deleted.");
      }
      if (existingIntent.status !== "retryable") {
        throw new CreditsError(503, "credit_adjustment_uncertain",
          "A prior provider adjustment has an unknown outcome and will not be automatically repeated.");
      }
      await tx.update(providerIntents).set({
        status: "pending",
        errorCode: null,
        updatedAt: new Date(),
      }).where(eq(providerIntents.id, intentId));
      return true;
    }
    await tx.insert(providerIntents).values({
      id: intentId,
      libraryHash,
      eventHash,
      amount,
      reasonHash,
      source,
      status: "pending",
    });
    return true;
  });
  if (!reserved) return;

  let failure: unknown;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits:${libraryHash}`}, 0))`);
      const [tombstone] = await tx.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
        .from(classscribePrivacyTombstonesTable)
        .where(eq(classscribePrivacyTombstonesTable.libraryHash, libraryHash)).limit(1);
      const [intent] = await tx.select().from(providerIntents)
        .where(eq(providerIntents.id, intentId)).limit(1);
      if (tombstone) {
        if (intent?.status === "pending") {
          await tx.update(providerIntents).set({ status: "cancelled", errorCode: "credit_account_deleted", updatedAt: new Date() })
            .where(eq(providerIntents.id, intentId));
        }
        failure = new CreditsError(403, "credit_account_deleted", "This library’s credits account has been deleted.");
        return;
      }
      if (!intent || intent.status !== "pending") {
        failure = new CreditsError(503, "credit_adjustment_uncertain",
          "The provider adjustment intent needs reconciliation and will not be automatically repeated.");
        return;
      }
      if (amount < 0) {
        let balance: number;
        try {
          balance = await provider.balance(appUserId);
        } catch (error) {
          await tx.update(providerIntents).set({
            status: "retryable",
            errorCode: "balance_unavailable",
            updatedAt: new Date(),
          }).where(eq(providerIntents.id, intentId));
          failure = error;
          return;
        }
        if (capRefundDebitToBalance) {
          // An action may have consumed credits after refund reconciliation
          // first read the wallet. Recheck under the common credit write lock,
          // persist the capped amount before the provider write, and do not
          // leave a refund waiting to debit an unrelated future purchase.
          amount = -Math.min(Math.abs(amount), Math.max(0, balance));
          await tx.update(providerIntents).set({ amount, updatedAt: new Date() })
            .where(eq(providerIntents.id, intentId));
          if (amount === 0) {
            await tx.update(providerIntents).set({ status: "completed", updatedAt: new Date() })
              .where(eq(providerIntents.id, intentId));
            return;
          }
        }
        if (balance + amount < 0) {
          await tx.update(providerIntents).set({
            status: "retryable",
            errorCode: "insufficient_credits",
            updatedAt: new Date(),
          }).where(eq(providerIntents.id, intentId));
          failure = new CreditsError(
            422,
            "insufficient_credits",
            `You need ${Math.abs(amount)} Scribe Credits but have ${balance}. Add a credit pack to continue.`,
          );
          return;
        }
      }
      try {
        await provider.adjust(appUserId, amount, reason, eventId);
      } catch (error) {
        const code = error instanceof CreditsError ? error.code : "";
        const definitelyNotApplied = error instanceof CreditsError && (error.providerAdjustmentNotApplied || [
          "revenuecat_auth_rejected",
          "revenuecat_purchases_scope_missing",
          "revenuecat_customer_read_scope_missing",
          "revenuecat_customer_write_scope_missing",
          "insufficient_credits",
          "revenuecat_adjustment_rejected",
        ].includes(code));
        await tx.update(providerIntents).set({
          status: definitelyNotApplied ? "retryable" : "uncertain",
          errorCode: /^[a-z0-9_-]{1,80}$/.test(code) ? code : "provider_outcome_unknown",
          updatedAt: new Date(),
        }).where(eq(providerIntents.id, intentId));
        failure = definitelyNotApplied
          ? error
          : new CreditsError(503, "credit_adjustment_uncertain",
            "The provider adjustment outcome is unknown; it has been held for reconciliation and will not be retried automatically.");
        return;
      }
      await tx.insert(ledger).values({
        id: randomUUID(), eventId, libraryHash, amount, reason, source, metadata,
      }).onConflictDoNothing({ target: ledger.eventId });
      await tx.update(providerIntents).set({
        status: "completed",
        errorCode: null,
        updatedAt: new Date(),
      }).where(eq(providerIntents.id, intentId));
    });
  } catch {
    // The durable pending row predates the provider POST. A failed ledger
    // commit therefore remains blocked instead of issuing a duplicate POST.
    throw new CreditsError(503, "credit_adjustment_uncertain",
      "The provider may have applied this adjustment; its durable record is pending reconciliation and will not be retried automatically.");
  }
  if (failure) throw failure;
}

export async function getCreditsStatus(code: string, provider: CreditProvider = revenueCatProvider) {
  const libraryHash = await authorizeLibrary(code);
  const appUserId = await ensureWelcomeCredits(libraryHash, code, provider);
  const [balance, rows] = await Promise.all([
    provider.balance(appUserId),
    db.select().from(ledger).where(eq(ledger.libraryHash, libraryHash))
      .orderBy(desc(ledger.date)).limit(100),
  ]);
  const runtimeTarget = await getCreditsRuntimeTarget();
  return {
    balance,
    runtimeTarget,
    currency: { ...creditsConfig.currency, code: runtimeTarget },
    offeringIdentifier: creditsConfig.offeringIdentifier,
    packs: creditsConfig.packs,
    costs: creditsConfig.costs,
    monthlyBonus: creditsConfig.monthlyBonus,
    history: rows.map((row) => ({
      id: row.id,
      date: row.date.toISOString(),
      amount: row.amount,
      reason: row.reason,
      source: row.source,
    })),
  };
}

export async function getCreditsBalanceForLibrary(
  code: string,
  provider: CreditProvider = revenueCatProvider,
): Promise<number> {
  const libraryHash = await authorizeLibrary(code);
  const appUserId = await ensureWelcomeCredits(libraryHash, code, provider);
  return provider.balance(appUserId);
}

export type CreditActionClaim = {
  actionId: string;
  replay: boolean;
  resumed?: boolean;
  response?: unknown;
};

type CreditActionStatus = "reserved" | "debited" | "refunding" | "completed" | "failed";

const actionDebitEventId = (actionId: string) => `credits-action-${actionId}-debit`;
const actionRefundEventId = (actionId: string) => `credits-action-${actionId}-refund`;

async function resolveCreditActionId(
  code: string,
  libraryHash: string,
  action: string,
  requestId: string,
): Promise<string> {
  const billingIdentity = await getRevenueCatAppUserId(code);
  const stableId = hash(`${billingIdentity}:${action}:${requestId}`);
  // Legacy actions used the library hash. Rotation moves their ownership but
  // must not change their IDs or the associated provider debit/refund references.
  const ancestors = await db.execute<{ library_hash: string }>(sql`
    with recursive identities(library_hash, depth) as (
      select ${libraryHash}::text, 0
      union all
      select ${documents.data}->>'fromHash', identities.depth + 1
      from identities join ${documents}
        on ${documents.path} = ${aliasPath("")} || (${documents.data}->>'fromHash')
        and ${documents.data}->>'toHash' = identities.library_hash
      where identities.depth < 32
        and ${documents.data}->>'fromHash' ~ '^[a-f0-9]{64}$'
    )
    select distinct library_hash from identities
  `);
  const candidateIds = [
    stableId,
    ...ancestors.rows.map(({ library_hash }) => hash(`${library_hash}:${action}:${requestId}`)),
  ];
  const [existing] = await db.select({ id: actions.id }).from(actions)
    .where(and(eq(actions.libraryHash, libraryHash), inArray(actions.id, candidateIds))).limit(1);
  return existing?.id ?? stableId;
}

async function lockCreditAction(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], actionId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credit-action:${actionId}`}, 0))`);
  const [action] = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
  return action;
}

function actionCreditState(response: unknown): string | undefined {
  const state = record(response).creditState;
  return typeof state === "string" ? state : undefined;
}

async function creditActionStatus(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actionId: string,
  expectedCost?: number,
): Promise<"missing" | "not_debited" | "debited" | "refund_pending" | "completed" | "failed"> {
  const action = await lockCreditAction(tx, actionId);
  if (!action) return "missing";
  if (action.status === "completed") return "completed";
  if (action.status === "failed") return "failed";
  const [debit] = await tx.select({
    amount: ledger.amount,
    libraryHash: ledger.libraryHash,
  }).from(ledger).where(eq(ledger.eventId, actionDebitEventId(actionId))).limit(1);
  if (!debit || debit.libraryHash !== action.libraryHash ||
    (expectedCost !== undefined && debit.amount !== -expectedCost)) return "not_debited";
  if (actionCreditState(action.response) === "refund_pending") return "refund_pending";
  if (actionCreditState(action.response) !== "debited") {
    await tx.update(actions).set({
      response: { creditState: "debited" },
      updatedAt: new Date(),
    }).where(eq(actions.id, actionId));
  }
  return "debited";
}

export async function getCreditActionState(
  code: string,
  action: string,
  requestId: string,
  requestHash?: string,
): Promise<{ actionId: string; status: CreditActionStatus; response?: unknown } | undefined> {
  const libraryHash = await authorizeLibrary(code);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId) ||
    !/^[a-z][a-z0-9-]{1,40}$/.test(action)) {
    throw new CreditsError(400, "invalid_argument", "Invalid credit action identity.");
  }
  const actionId = await resolveCreditActionId(code, libraryHash, action, requestId);
  const [existing] = await db.select().from(actions)
    .where(and(eq(actions.id, actionId), eq(actions.libraryHash, libraryHash))).limit(1);
  if (!existing) return undefined;
  if (existing.action !== action || (requestHash !== undefined && existing.requestHash !== requestHash)) {
    throw new CreditsError(409, "idempotency_key_reused", "This request ID was already used for a different action.");
  }
  let status = existing.status as CreditActionStatus;
  if (status === "reserved") {
    const resolvedStatus = await db.transaction((tx) => creditActionStatus(tx, actionId));
    if (resolvedStatus === "missing") return undefined;
    status = resolvedStatus === "not_debited"
      ? "reserved"
      : resolvedStatus === "refund_pending"
        ? "refunding"
        : resolvedStatus;
  }
  return {
    actionId,
    status,
    ...(existing.status === "completed" && existing.response !== null ? { response: existing.response } : {}),
  };
}

export async function reserveCreditsForAction(
  code: string,
  action: string,
  requestId: string,
  requestHash: string,
  cost: number,
  options: { resumeReserved?: boolean } = {},
): Promise<CreditActionClaim> {
  const libraryHash = await authorizeLibrary(code);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId) ||
    !/^[a-f0-9]{64}$/.test(requestHash) ||
    !Number.isSafeInteger(cost) || cost <= 0 ||
    !/^[a-z][a-z0-9-]{1,40}$/.test(action)) {
    throw new CreditsError(400, "invalid_argument", "A valid confirmed credit action is required.");
  }
  const appUserId = await ensureWelcomeCredits(libraryHash, code);
  const actionId = await resolveCreditActionId(code, libraryHash, action, requestId);
  const decision = await db.transaction(async (tx) => {
    const existing = await lockCreditAction(tx, actionId);
    if (existing) {
      if (existing.libraryHash !== libraryHash) {
        throw new CreditsError(403, "not_granted", "Not allowed.");
      }
      if (existing.requestHash !== requestHash || existing.action !== action) {
        throw new CreditsError(409, "idempotency_key_reused", "This request ID was already used for a different action.");
      }
      if (existing.status === "completed") {
        return { replay: true as const, response: existing.response };
      }
      if (existing.status === "failed") {
        throw new CreditsError(409, "action_failed_new_id_required", "This confirmed action failed and was refunded. Use a new request ID to retry.");
      }
      if (actionCreditState(existing.response) === "refund_pending") {
        throw new CreditsError(409, "credit_action_refunding", "This confirmed action is being refunded. Please retry shortly.");
      }
      if (options.resumeReserved) {
        if (actionCreditState(existing.response) !== "debited") {
          throw new CreditsError(409, "credit_action_not_debited", "The confirmed action has not completed its credit debit.");
        }
        await tx.update(actions).set({ updatedAt: new Date() }).where(eq(actions.id, actionId));
        return { replay: false as const, resumed: true as const };
      }
      if (Date.now() - existing.updatedAt.getTime() < 10 * 60_000) {
        throw new CreditsError(409, "action_in_progress", "This confirmed action is already in progress.");
      }
      await tx.update(actions).set({ updatedAt: new Date() }).where(eq(actions.id, actionId));
      return { replay: false as const };
    }
    await tx.insert(actions).values({
      id: actionId,
      libraryHash,
      action,
      requestHash,
      status: "reserved",
    });
    return { replay: false as const };
  });
  if (decision.replay) return { actionId, replay: true, response: decision.response };
  if (decision.resumed) return { actionId, replay: false, resumed: true };
  try {
    await grantForLibrary(
      libraryHash,
      appUserId,
      -cost,
      `${action} credit use`,
      "spend",
      actionDebitEventId(actionId),
    );
    const debitState = await db.transaction((tx) => creditActionStatus(tx, actionId, cost));
    if (debitState !== "debited") {
      throw new CreditsError(409, "credit_action_not_debited", "The confirmed action debit could not be verified.");
    }
  } catch (error) {
    if (error instanceof CreditsError && error.code === "insufficient_credits") {
      await db.delete(actions).where(eq(actions.id, actionId));
    }
    throw error;
  }
  return { actionId, replay: false };
}

export async function completeCreditAction(actionId: string, response: unknown): Promise<void> {
  await db.transaction(async (tx) => {
    const status = await creditActionStatus(tx, actionId);
    if (status === "completed") return;
    if (status === "refund_pending" || status === "failed") {
      throw new CreditsError(409, "credit_action_already_refunded", "This credit action can no longer be completed.");
    }
    if (status !== "debited") {
      throw new CreditsError(409, "credit_action_not_debited", "This credit action cannot complete before its debit is recorded.");
    }
    await tx.update(actions).set({ status: "completed", response, updatedAt: new Date() })
      .where(eq(actions.id, actionId));
  });
}

export async function refundCreditAction(
  code: string,
  actionId: string,
  cost: number,
  action: string,
): Promise<boolean> {
  const libraryHash = await authorizeLibrary(code);
  const refundStatus = await db.transaction(async (tx) => {
    const current = await lockCreditAction(tx, actionId);
    if (!current) return "not_debited" as const;
    if (current.libraryHash !== libraryHash) {
      throw new CreditsError(403, "not_granted", "Not allowed.");
    }
    if (current.status === "completed" || current.status === "failed") return "finished" as const;
    const [debit] = await tx.select({
      amount: ledger.amount,
      libraryHash: ledger.libraryHash,
    }).from(ledger).where(eq(ledger.eventId, actionDebitEventId(actionId))).limit(1);
    if (!debit || debit.libraryHash !== current.libraryHash || debit.amount !== -cost) {
      return "not_debited" as const;
    }
    if (actionCreditState(current.response) === "refund_pending" &&
      Date.now() - current.updatedAt.getTime() < 10 * 60_000) {
      throw new CreditsError(409, "credit_action_refund_in_progress", "The credit refund is already in progress.");
    }
    await tx.update(actions).set({
      response: { creditState: "refund_pending" },
      updatedAt: new Date(),
    }).where(eq(actions.id, actionId));
    return "refund" as const;
  });
  if (refundStatus === "finished" || refundStatus === "not_debited") return false;
  await refundCredits(
    code,
    cost,
    `${action} failed; credits refunded`,
    actionRefundEventId(actionId),
  );
  await db.transaction(async (tx) => {
    const current = await lockCreditAction(tx, actionId);
    if (current?.status === "completed") {
      throw new CreditsError(409, "credit_action_already_completed", "The credit action was completed before the refund.");
    }
    if (current?.status === "reserved" && actionCreditState(current.response) === "refund_pending") {
      await tx.update(actions).set({
        status: "failed",
        response: { creditState: "refunded" },
        updatedAt: new Date(),
      }).where(eq(actions.id, actionId));
    }
  });
  return true;
}

export async function grantWelcomeCreditsForNewLink(
  code: string,
  provider: CreditProvider = revenueCatProvider,
): Promise<void> {
  const libraryHash = await authorizeLibrary(code);
  await ensureWelcomeCredits(libraryHash, code, provider);
}

export async function grantMonthlySubscriptionCredits(input: {
  libraryCode: string;
  plan: SubscriptionCreditPlan;
  periodStart: number;
  periodEnd: number;
  source: "stripe" | "revenuecat";
  eventId: string;
  paymentId: string;
}): Promise<void> {
  const readiness = await getCreditsSubscriptionPeriodReadiness();
  if (!readiness.ready) {
    throw new CreditsError(
      503,
      readiness.reason ?? "credits_migration_not_ready",
      "Monthly Scribe Credit grants are paused until the credits migration and subscription catalog are verified.",
    );
  }
  if (!input || (input.plan !== "student" && input.plan !== "pro") ||
    (input.source !== "stripe" && input.source !== "revenuecat") ||
    !input.eventId || input.eventId.length > 200 ||
    !input.paymentId || input.paymentId.length > 200 ||
    !Number.isSafeInteger(input.periodStart) || !Number.isSafeInteger(input.periodEnd)) {
    throw new CreditsError(400, "invalid_subscription_period", "Invalid verified subscription billing period.");
  }
  const start = canonicalPeriodDate(input.periodStart);
  const end = canonicalPeriodDate(input.periodEnd);
  if (start >= end) throw new CreditsError(400, "invalid_subscription_period", "The subscription period end must follow its start.");
  const { libraryHash, appUserId } = await resolveSubscriptionLibraryIdentity(input.libraryCode);
  await assertCreditsLibraryNotDeleted(libraryHash);
  await grantMonthlySubscriptionCreditsForLibrary({
    libraryHash,
    appUserId,
    plan: input.plan,
    periodStart: start,
    periodEnd: end,
    source: input.source,
    eventId: input.eventId,
    paymentId: input.paymentId,
  });
}

async function grantMonthlySubscriptionCreditsForLibrary(input: {
  libraryHash: string;
  appUserId: string;
  plan: SubscriptionCreditPlan;
  periodStart: Date;
  periodEnd: Date;
  source: "stripe" | "revenuecat";
  eventId: string;
  paymentId: string;
}): Promise<void> {
  const start = input.periodStart;
  const end = input.periodEnd;
  const paymentHash = hash(input.paymentId);
  const reservation = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits:${input.libraryHash}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits-period:${input.libraryHash}:${end.toISOString()}`}, 0))`);
    const [deleted] = await tx.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
      .from(classscribePrivacyTombstonesTable)
      .where(eq(classscribePrivacyTombstonesTable.libraryHash, input.libraryHash)).limit(1);
    if (deleted) throw new CreditsError(403, "credit_account_deleted", "This library’s credits account has been deleted.");
    const [revokedPayment] = await tx.select({ id: paymentRevocations.id })
      .from(paymentRevocations).where(and(
        eq(paymentRevocations.libraryHash, input.libraryHash),
        eq(paymentRevocations.paymentHash, paymentHash),
      )).limit(1);
    if (revokedPayment) return { skip: true as const };
    let [period] = await tx.select().from(subscriptionPeriods)
      .where(and(
        eq(subscriptionPeriods.libraryHash, input.libraryHash),
        eq(subscriptionPeriods.periodEnd, end),
      )).limit(1);
    if (!period) {
      const id = subscriptionPeriodScopeKey(input.libraryHash, start);
      [period] = await tx.insert(subscriptionPeriods).values({
        id,
        libraryHash: input.libraryHash,
        periodStart: start,
        periodEnd: end,
        paymentHashes: [],
        status: "active",
        grantedAmount: 0,
      }).onConflictDoNothing().returning();
      if (!period) {
        [period] = await tx.select().from(subscriptionPeriods)
          .where(eq(subscriptionPeriods.id, id)).limit(1);
      }
    }
    if (!period) throw new CreditsError(503, "credits_period_unavailable", "The subscription credit period could not be reserved.");
    if (period.status === "revoked") return { skip: true as const };
    if (period.status === "pending" || period.status === "uncertain") {
      throw new CreditsError(503,
        period.status === "uncertain" ? "credits_period_uncertain" : "credits_period_pending",
        "A Scribe Credit update for this billing period is awaiting provider reconciliation; it will not be blindly retried.");
    }
    const grantDecision = subscriptionPeriodGrantDecision(
      input.plan,
      period.highWaterPlan,
      period.grantedAmount,
      false,
    );
    const amount = grantDecision.amount;
    if (amount === 0) {
      const paymentHashes = Array.isArray(period.paymentHashes) ? period.paymentHashes : [];
      if (!paymentHashes.includes(paymentHash)) {
        await tx.update(subscriptionPeriods).set({
          paymentHashes: [...paymentHashes, paymentHash],
          highWaterPlan: grantDecision.highWaterPlan,
          updatedAt: new Date(),
        }).where(eq(subscriptionPeriods.id, period.id));
      }
      return { skip: true as const };
    }
    const key = subscriptionPeriodGrantKey(input.libraryHash, input.plan, period.periodStart);
    await tx.update(subscriptionPeriods).set({
      status: "pending",
      pendingEventId: key,
      pendingPaymentHash: paymentHash,
      pendingPlan: input.plan,
      pendingAmount: amount,
      pendingSource: input.source,
      updatedAt: new Date(),
    }).where(eq(subscriptionPeriods.id, period.id));
    return {
      skip: false as const,
      periodId: period.id,
      eventId: key,
      amount,
      highWaterPlan: grantDecision.highWaterPlan,
      periodStart: period.periodStart,
      periodEnd: end,
    };
  });
  if (reservation.skip) return;

  // The intent transaction above is committed before this transaction can
  // issue a provider write. Unknown outcomes retain pending and are never retried.
  let failure: unknown;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits:${input.libraryHash}`}, 0))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits-period:${input.libraryHash}:${end.toISOString()}`}, 0))`);
      const [deleted] = await tx.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
        .from(classscribePrivacyTombstonesTable)
        .where(eq(classscribePrivacyTombstonesTable.libraryHash, input.libraryHash)).limit(1);
      const [revokedPayment] = await tx.select({ id: paymentRevocations.id })
        .from(paymentRevocations).where(and(
          eq(paymentRevocations.libraryHash, input.libraryHash),
          eq(paymentRevocations.paymentHash, paymentHash),
        )).limit(1);
      const [period] = await tx.select().from(subscriptionPeriods)
        .where(eq(subscriptionPeriods.id, reservation.periodId)).limit(1);
      if (deleted) {
        if ((period?.status === "pending" || period?.status === "uncertain") &&
          period.pendingEventId === reservation.eventId) {
          await tx.update(subscriptionPeriods).set({
            status: "revoked",
            revokedPaymentHash: paymentHash,
            revokedAt: new Date(),
            pendingEventId: null,
            pendingPaymentHash: null,
            pendingPlan: null,
            pendingAmount: null,
            pendingSource: null,
            updatedAt: new Date(),
          }).where(eq(subscriptionPeriods.id, period.id));
        }
        failure = new CreditsError(403, "credit_account_deleted", "This library’s credits account has been deleted.");
        return;
      }
      if (revokedPayment) {
        if ((period?.status === "pending" || period?.status === "uncertain") &&
          period.pendingEventId === reservation.eventId) {
          await tx.update(subscriptionPeriods).set({
            status: "revoked",
            revokedPaymentHash: paymentHash,
            revokedAt: new Date(),
            pendingEventId: null,
            pendingPaymentHash: null,
            pendingPlan: null,
            pendingAmount: null,
            pendingSource: null,
            updatedAt: new Date(),
          }).where(eq(subscriptionPeriods.id, period.id));
        }
        return;
      }
      if (!period || period.status !== "pending" || period.pendingEventId !== reservation.eventId) {
        failure = new CreditsError(503, "credits_period_intent_lost", "The Scribe Credit grant needs reconciliation.");
        return;
      }
      try {
        await revenueCatProvider.adjust(
          input.appUserId,
          reservation.amount,
          `${input.plan} monthly Scribe Credits`,
          reservation.eventId,
        );
      } catch (error) {
        const code = error instanceof CreditsError ? error.code : "";
        const definitelyNotApplied = error instanceof CreditsError && (error.providerAdjustmentNotApplied || [
          "revenuecat_auth_rejected",
          "revenuecat_purchases_scope_missing",
          "revenuecat_customer_read_scope_missing",
          "revenuecat_customer_write_scope_missing",
          "insufficient_credits",
          "revenuecat_adjustment_rejected",
        ].includes(code));
        if (definitelyNotApplied) {
          await tx.update(subscriptionPeriods).set({
            status: "active",
            pendingEventId: null,
            pendingPaymentHash: null,
            pendingPlan: null,
            pendingAmount: null,
            pendingSource: null,
            updatedAt: new Date(),
          }).where(eq(subscriptionPeriods.id, period.id));
          failure = error;
        } else {
          await tx.update(subscriptionPeriods).set({
            status: "uncertain",
            updatedAt: new Date(),
          }).where(eq(subscriptionPeriods.id, period.id));
          failure = new CreditsError(503, "credits_period_pending",
            "The RevenueCat adjustment outcome is unknown; this period is held for reconciliation and will not be retried.");
        }
        return;
      }
      const paymentHashes = Array.isArray(period.paymentHashes) ? period.paymentHashes : [];
      await tx.insert(ledger).values({
        id: randomUUID(),
        eventId: reservation.eventId,
        libraryHash: input.libraryHash,
        amount: reservation.amount,
        reason: `${input.plan} monthly Scribe Credit grant`,
        source: input.source,
        metadata: {
          eventHash: hash(input.eventId),
          paymentHash,
          plan: input.plan,
          periodStart: reservation.periodStart.toISOString(),
          periodEnd: end.toISOString(),
        },
      }).onConflictDoNothing({ target: ledger.eventId });
      await tx.update(subscriptionPeriods).set({
        status: "active",
        highWaterPlan: reservation.highWaterPlan,
        grantedAmount: period.grantedAmount + reservation.amount,
        paymentHashes: paymentHashes.includes(paymentHash) ? paymentHashes : [...paymentHashes, paymentHash],
        pendingEventId: null,
        pendingPaymentHash: null,
        pendingPlan: null,
        pendingAmount: null,
        pendingSource: null,
        updatedAt: new Date(),
      }).where(eq(subscriptionPeriods.id, period.id));
    });
  } catch {
    throw new CreditsError(503, "credits_period_pending",
      "The provider may have applied this Scribe Credit grant; its durable intent is pending reconciliation and will not be retried.");
  }
  if (failure) throw failure;
}

export async function reverseMonthlySubscriptionCredits(input: {
  libraryCode: string;
  source: "stripe" | "revenuecat";
  paymentId: string;
  eventId: string;
}): Promise<void> {
  if (!input?.paymentId || input.paymentId.length > 200 || !input.eventId ||
    input.eventId.length > 200 || (input.source !== "stripe" && input.source !== "revenuecat")) {
    throw new CreditsError(400, "invalid_subscription_reversal", "Invalid verified subscription reversal.");
  }
  const { libraryHash, appUserId } = await resolveSubscriptionLibraryIdentity(input.libraryCode);
  await reverseMonthlySubscriptionCreditsForLibrary({
    libraryHash,
    appUserId,
    source: input.source,
    paymentId: input.paymentId,
    eventId: input.eventId,
  });
}

async function reverseMonthlySubscriptionCreditsForLibrary(input: {
  libraryHash: string;
  appUserId: string;
  source: "stripe" | "revenuecat";
  paymentId: string;
  eventId: string;
}): Promise<void> {
  const { libraryHash, appUserId } = input;
  await assertCreditsLibraryNotDeleted(libraryHash);
  const paymentHash = hash(input.paymentId);
  const revocationId = hash(`${libraryHash}:${paymentHash}`);
  const reversalId = `credits-monthly-reversal-${revocationId}`;
  const readiness = await getCreditsSubscriptionPeriodReadiness().catch(() => ({
    ready: false,
    reason: "credits_migration_state_unavailable",
  }));
  const reservation = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits:${libraryHash}`}, 0))`);
    const [deleted] = await tx.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
      .from(classscribePrivacyTombstonesTable)
      .where(eq(classscribePrivacyTombstonesTable.libraryHash, libraryHash)).limit(1);
    if (deleted) throw new CreditsError(403, "credit_account_deleted", "This library’s credits account has been deleted.");
    await tx.insert(paymentRevocations).values({
      id: revocationId,
      libraryHash,
      paymentHash,
      eventHash: hash(input.eventId),
      source: input.source,
    }).onConflictDoNothing({ target: paymentRevocations.id });
    const periods = await tx.select().from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.libraryHash, libraryHash));
    const matches = periods.filter((period) =>
      (Array.isArray(period.paymentHashes) && period.paymentHashes.includes(paymentHash)) ||
      period.pendingPaymentHash === paymentHash);
    if (!matches.length) return { skip: true as const };
    if (matches.length !== 1) {
      return { skip: true as const, blockedReason: "subscription_payment_ambiguous" };
    }
    const period = matches[0]!;
    if (period.status === "revoked") return { skip: true as const };
    if (period.status === "pending" || period.status === "uncertain") {
      // The grant's provider transaction shares the library lock. If it is
      // still pending here, preserve the tombstone; grant finalization checks it.
      if (period.pendingPaymentHash === paymentHash) return { skip: true as const };
      return {
        skip: true as const,
        blockedReason: period.status === "uncertain" ? "credits_period_uncertain" : "credits_period_pending",
      };
    }
    if (!readiness.ready) {
      return { skip: true as const, blockedReason: readiness.reason ?? "credits_migration_not_ready" };
    }
    await tx.update(subscriptionPeriods).set({
      status: "pending",
      pendingEventId: reversalId,
      pendingPaymentHash: paymentHash,
      pendingPlan: null,
      pendingAmount: null,
      pendingSource: input.source,
      updatedAt: new Date(),
    }).where(eq(subscriptionPeriods.id, period.id));
    return { skip: false as const, periodId: period.id, periodEnd: period.periodEnd };
  });
  if (reservation.skip) {
    if (reservation.blockedReason) {
      if (reservation.blockedReason === "subscription_payment_ambiguous") {
        throw new CreditsError(409, reservation.blockedReason, "The refunded payment is linked to multiple credit periods.");
      }
      if (reservation.blockedReason === "credits_period_pending") {
        throw new CreditsError(503, reservation.blockedReason,
          "A Scribe Credit update for this billing period is awaiting reconciliation.");
      }
      if (reservation.blockedReason === "credits_period_uncertain") {
        throw new CreditsError(503, reservation.blockedReason,
          "The prior provider adjustment outcome is unknown; this refund is held for manual reconciliation.");
      }
      throw new CreditsError(503, reservation.blockedReason,
        "Monthly Scribe Credit reversals are paused until the credits migration is verified.");
    }
    return;
  }

  let failure: unknown;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits:${libraryHash}`}, 0))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits-period:${libraryHash}:${reservation.periodEnd.toISOString()}`}, 0))`);
      const [deleted] = await tx.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
        .from(classscribePrivacyTombstonesTable)
        .where(eq(classscribePrivacyTombstonesTable.libraryHash, libraryHash)).limit(1);
      const [period] = await tx.select().from(subscriptionPeriods)
        .where(eq(subscriptionPeriods.id, reservation.periodId)).limit(1);
      if (deleted) {
        if (period?.status === "pending" && period.pendingEventId === reversalId) {
          await tx.update(subscriptionPeriods).set({
            status: "revoked",
            revokedPaymentHash: paymentHash,
            revokedAt: new Date(),
            pendingEventId: null,
            pendingPaymentHash: null,
            pendingPlan: null,
            pendingAmount: null,
            pendingSource: null,
            updatedAt: new Date(),
          }).where(eq(subscriptionPeriods.id, period.id));
        }
        failure = new CreditsError(403, "credit_account_deleted", "This library’s credits account has been deleted.");
        return;
      }
      if (!period || period.status !== "pending" || period.pendingEventId !== reversalId) {
        failure = new CreditsError(503, "credits_period_intent_lost", "The credit reversal needs reconciliation.");
        return;
      }
      let debit: number;
      try {
        const balance = await revenueCatProvider.balance(appUserId);
        debit = subscriptionPeriodReversalAmount(balance, period.grantedAmount);
      } catch (error) {
        await tx.update(subscriptionPeriods).set({
          status: "active",
          pendingEventId: null,
          pendingPaymentHash: null,
          pendingPlan: null,
          pendingAmount: null,
          pendingSource: null,
          updatedAt: new Date(),
        }).where(eq(subscriptionPeriods.id, period.id));
        failure = error;
        return;
      }
      if (debit > 0) {
        try {
          await revenueCatProvider.adjust(appUserId, -debit, "Subscription payment refunded", reversalId);
        } catch (error) {
          const code = error instanceof CreditsError ? error.code : "";
          const definitelyNotApplied = error instanceof CreditsError && (error.providerAdjustmentNotApplied || [
            "revenuecat_auth_rejected",
            "revenuecat_purchases_scope_missing",
            "revenuecat_customer_read_scope_missing",
            "revenuecat_customer_write_scope_missing",
            "insufficient_credits",
            "revenuecat_adjustment_rejected",
          ].includes(code));
          if (definitelyNotApplied) {
            await tx.update(subscriptionPeriods).set({
              status: "active",
              pendingEventId: null,
              pendingPaymentHash: null,
              pendingPlan: null,
              pendingAmount: null,
              pendingSource: null,
              updatedAt: new Date(),
            }).where(eq(subscriptionPeriods.id, period.id));
            failure = error;
          } else {
            await tx.update(subscriptionPeriods).set({
              status: "uncertain",
              updatedAt: new Date(),
            }).where(eq(subscriptionPeriods.id, period.id));
            failure = new CreditsError(503, "credits_period_pending",
              "The refund adjustment outcome is unknown; the period is held for reconciliation and will not be retried.");
          }
          return;
        }
        await tx.insert(ledger).values({
          id: randomUUID(),
          eventId: reversalId,
          libraryHash,
          amount: -debit,
          reason: "Subscription payment refunded",
          source: input.source,
          metadata: {
            eventHash: hash(input.eventId),
            paymentHash,
            periodIdHash: hash(period.id),
          },
        }).onConflictDoNothing({ target: ledger.eventId });
      }
      await tx.update(subscriptionPeriods).set({
        status: "revoked",
        revokedPaymentHash: paymentHash,
        revokedAt: new Date(),
        pendingEventId: null,
        pendingPaymentHash: null,
        pendingPlan: null,
        pendingAmount: null,
        pendingSource: null,
        updatedAt: new Date(),
      }).where(eq(subscriptionPeriods.id, period.id));
    });
  } catch {
    throw new CreditsError(503, "credits_period_pending",
      "The provider may have applied this refund adjustment; its durable intent is pending reconciliation and will not be retried.");
  }
  if (failure) throw failure;
}

/**
 * Kept as a compatibility symbol for older billing deployments. Invoice IDs
 * alone cannot identify a billing period, so granting without period bounds
 * is intentionally disabled; callers must use grantMonthlySubscriptionCredits.
 */
export async function grantStripeInvoiceRenewalBonus(
  _libraryHash: string,
  _appUserId: string,
  _plan: SubscriptionCreditPlan,
  _invoiceId: string,
): Promise<void> {
  throw new CreditsError(503, "subscription_period_required", "Stripe subscription grants require verified period start and end timestamps.");
}

async function ensureWelcomeCredits(
  libraryHash: string,
  code: string,
  provider: CreditProvider = revenueCatProvider,
): Promise<string> {
  const appUserId = await getRevenueCatAppUserId(code);
  const [account] = await db.select({ data: documents.data }).from(documents)
    .where(eq(documents.path, accountPath(libraryHash))).limit(1);
  const storedWelcomeHash = record(account?.data).creditsWelcomeLibraryHash;
  const welcomeHash = typeof storedWelcomeHash === "string" && /^[a-f0-9]{64}$/.test(storedWelcomeHash)
    ? storedWelcomeHash
    : libraryHash;
  await grantForLibrary(libraryHash, appUserId, creditsConfig.welcomeBonus, "Welcome credits", "welcome",
    `credits-welcome-${welcomeHash}`, provider);
  return appUserId;
}

export async function createCreditCheckout(
  code: string,
  packId: unknown,
  returnUrl: unknown,
): Promise<{ url: string }> {
  const libraryHash = await authorizeLibrary(code);
  const pack = creditsConfig.packs.find((item) => item.id === packId);
  if (!pack || typeof returnUrl !== "string" || returnUrl.length > 2_000) {
    throw new CreditsError(400, "invalid_argument", "Choose a valid credit pack and return URL.");
  }
  let url: URL;
  try { url = new URL(returnUrl); } catch {
    throw new CreditsError(400, "invalid_argument", "Enter a valid return URL.");
  }
  const allowedHosts = (process.env.REPLIT_DOMAINS ?? "").split(",").map((host) => host.trim()).filter(Boolean);
  if (url.protocol !== "https:" || !allowedHosts.includes(url.host)) {
    throw new CreditsError(400, "invalid_argument", "The return URL must use this application’s secure domain.");
  }
  const appUserId = await ensureWelcomeCredits(libraryHash, code);
  const stripe = await getUncachableStripeClient();
  const price = await discoverCreditPrice(stripe, pack);
  const success = new URL(url);
  success.searchParams.set("credits", "success");
  success.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  const cancel = new URL(url);
  cancel.searchParams.set("credits", "cancel");
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      price: price.id,
      quantity: 1,
    }],
    success_url: success.toString(),
    cancel_url: cancel.toString(),
    client_reference_id: libraryHash,
    metadata: {
      classscribe_credits_pack: pack.id,
      pack_id: pack.id,
      credits: String(pack.credits),
      classscribe_library_hash: libraryHash,
      classscribe_rc_app_user_id: appUserId,
    },
  }, { idempotencyKey: `classscribe-credits-${libraryHash}-${pack.id}-${randomUUID()}` });
  if (!session.url) throw new CreditsError(503, "checkout_unavailable", "Stripe did not return a checkout URL.");
  return { url: session.url };
}

async function discoverCreditPrice(
  stripe: Stripe,
  pack: (typeof creditsConfig.packs)[number],
): Promise<Stripe.Price> {
  const prices = await stripe.prices.list({ active: true, limit: 100 });
  const candidates: Stripe.Price[] = [];
  for (const price of prices.data) {
    const metadata = price.metadata;
    if (metadata.pack_id !== pack.id && metadata.credits !== String(pack.credits)) continue;
    const product = typeof price.product === "string"
      ? await stripe.products.retrieve(price.product)
      : price.product;
    if ("deleted" in product && product.deleted) {
      throw new CreditsError(503, "credit_price_mismatch", "Stripe credit pack product is unavailable.");
    }
    const productMetadata = product.metadata;
    if (metadata.pack_id !== pack.id || metadata.credits !== String(pack.credits) ||
      productMetadata.pack_id !== pack.id || productMetadata.credits !== String(pack.credits)) {
      throw new CreditsError(503, "credit_price_mismatch", "Stripe credit pack metadata does not match server configuration.");
    }
    if (!price.active || !product.active || price.type !== "one_time" ||
      price.currency !== "usd" || price.unit_amount !== pack.priceCents) {
      throw new CreditsError(503, "credit_price_mismatch", "Stripe credit pack price does not match server configuration.");
    }
    candidates.push(price);
  }
  if (candidates.length !== 1) {
    throw new CreditsError(503, "credit_price_unavailable", "The configured Stripe credit pack is unavailable or ambiguous.");
  }
  return candidates[0]!;
}

export async function fulfillCreditCheckout(
  session: Stripe.Checkout.Session,
  provider: CreditProvider = revenueCatProvider,
  stripeClient?: Stripe,
): Promise<void> {
  if (!session.id) {
    throw new CreditsError(400, "invalid_checkout_event", "Stripe credit checkout did not include a session ID.");
  }
  const stripe = stripeClient ?? await getUncachableStripeClient();
  const verifiedSession = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items.data.price.product"],
  });
  const metadata = verifiedSession.metadata ?? {};
  const initialHash = metadata.classscribe_library_hash;
  const appUserId = metadata.classscribe_rc_app_user_id;
  const pack = creditsConfig.packs.find((item) => item.id === metadata.classscribe_credits_pack);
  if (verifiedSession.id !== session.id ||
    !initialHash || !/^[a-f0-9]{64}$/.test(initialHash) ||
    !appUserId || !pack || verifiedSession.payment_status !== "paid" ||
    verifiedSession.mode !== "payment" || verifiedSession.amount_total !== pack.priceCents ||
    verifiedSession.metadata?.pack_id !== pack.id ||
    verifiedSession.metadata?.credits !== String(pack.credits) ||
    verifiedSession.client_reference_id !== initialHash ||
    verifiedSession.currency !== "usd") {
    throw new CreditsError(400, "invalid_checkout_event", "Stripe credit checkout did not match a configured pack.");
  }
  const lineItems = verifiedSession.line_items?.data ?? [];
  if (lineItems.length !== 1 || lineItems[0]?.quantity !== 1) {
    throw new CreditsError(400, "invalid_checkout_event", "Stripe credit checkout must contain one configured pack.");
  }
  const configuredPrice = await discoverCreditPrice(stripe, pack);
  const purchasedPrice = lineItems[0]?.price;
  if (!purchasedPrice || typeof purchasedPrice === "string" || purchasedPrice.id !== configuredPrice.id) {
    throw new CreditsError(400, "invalid_checkout_event", "Stripe credit checkout price did not match the configured pack.");
  }
  const purchasedProduct = purchasedPrice.product;
  const purchasedProductId = typeof purchasedProduct === "string" ? purchasedProduct : purchasedProduct?.id;
  const configuredProductId = typeof configuredPrice.product === "string"
    ? configuredPrice.product
    : configuredPrice.product.id;
  if (purchasedProductId !== configuredProductId) {
    throw new CreditsError(400, "invalid_checkout_event", "Stripe credit checkout product did not match the configured pack.");
  }
  const libraryHash = await canonicalLibraryHash(initialHash);
  const [account] = await db.select({ data: documents.data }).from(documents)
    .where(eq(documents.path, accountPath(libraryHash))).limit(1);
  if (record(account?.data).billingAccountId !== appUserId) {
    throw new CreditsError(400, "invalid_checkout_event", "Stripe checkout customer did not match the library.");
  }
  // Serialize completion and refund notifications independently of a library
  // code: the checkout identity survives device changes and code rotation.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`stripe-pack:${session.id}`}, 0))`);
    const paymentIntentId = typeof verifiedSession.payment_intent === "string"
      ? verifiedSession.payment_intent : verifiedSession.payment_intent?.id;
    if (!paymentIntentId) throw new CreditsError(400, "invalid_checkout_event", "Credit checkout has no verified payment.");
    const payment = await stripe.paymentIntents.retrieve(paymentIntentId);
    const chargeId = typeof payment.latest_charge === "string" ? payment.latest_charge : payment.latest_charge?.id;
    if (payment.id !== paymentIntentId || payment.status !== "succeeded" || !chargeId) {
      throw new CreditsError(400, "invalid_checkout_event", "Credit checkout payment has not succeeded.");
    }
    const charge = await stripe.charges.retrieve(chargeId);
    const chargePaymentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (charge.id !== chargeId || chargePaymentId !== paymentIntentId ||
        charge.paid !== true || charge.currency !== "usd" || charge.amount !== pack.priceCents) {
      throw new CreditsError(400, "invalid_checkout_event", "Credit checkout charge does not match its payment.");
    }
    let revokedCredits: number;
    try {
      revokedCredits = refundedPackCredits(pack.credits, pack.priceCents, charge.amount_refunded, charge.disputed);
    } catch {
      throw new CreditsError(400, "invalid_checkout_event", "Credit checkout refund amounts are invalid.");
    }
    const purchaseEvent = `stripe-checkout-${session.id}`;
    const refundEvent = (target: number) => `stripe-pack-refund-${session.id}-${target}`;
    const events = [purchaseEvent, ...Array.from({ length: pack.credits }, (_, i) => refundEvent(i + 1))];
    const rows = await tx.select().from(ledger)
      .where(and(eq(ledger.libraryHash, libraryHash), inArray(ledger.eventId, events)));
    // Financial ledger rows must be nonzero. Store no-balance-change delivery
    // and revocation markers separately, without a raw library or customer ID.
    const statePath = `private/classscribe-billing/credit-pack-state/${hash(session.id)}`;
    const [stateDocument] = await tx.select({ data: documents.data }).from(documents)
      .where(eq(documents.path, statePath)).limit(1);
    const state = record(stateDocument?.data);
    const priorPurchase = rows.some(row => row.eventId === purchaseEvent) || state.delivered === true;
    const priorRevoked = Math.max(Number(state.revokedCredits) || 0,
      ...rows.map(row => Number(record(row.metadata).revokedCredits) || 0));
    const saveState = async () => {
      await tx.insert(documents).values({ path: statePath,
        data: { delivered: true, revokedCredits: Math.max(priorRevoked, revokedCredits) },
      }).onConflictDoUpdate({ target: documents.path, set: {
        data: { delivered: true, revokedCredits: Math.max(priorRevoked, revokedCredits) }, updatedAt: new Date(),
      } });
    };
    const [pending] = await tx.select().from(providerIntents)
      .where(and(eq(providerIntents.libraryHash, libraryHash),
        inArray(providerIntents.id, events.map(hash)),
        sql`${providerIntents.status} not in ('completed', 'retryable')`)).limit(1);
    if (pending) throw new CreditsError(503, "credit_adjustment_uncertain",
      "This pack has a pending provider adjustment. Its outcome must be reconciled before another grant or refund.");
    const metadata = { checkoutId: session.id, packId: pack.id, revokedCredits };
    if (!priorPurchase) {
      // Do not grant refunded credits even when the refund arrives before
      // checkout completion. A state marker records no-op delivery durably.
      const [grantIntent] = await tx.select().from(providerIntents)
        .where(eq(providerIntents.id, hash(purchaseEvent))).limit(1);
      const available = pack.credits - revokedCredits;
      if (grantIntent && grantIntent.amount !== available) {
        throw new CreditsError(503, "credit_adjustment_uncertain", "The pack payment changed while its delivery was pending.");
      }
      if (available > 0) {
        await grantForLibrary(libraryHash, appUserId, available, `${pack.name} purchase`, "stripe",
          purchaseEvent, provider, metadata);
      } else {
        await assertCreditsLibraryNotDeleted(libraryHash);
      }
      await saveState();
      return;
    }
    if (revokedCredits <= priorRevoked) return;
    const eventId = refundEvent(revokedCredits);
    const [intent] = await tx.select().from(providerIntents).where(eq(providerIntents.id, hash(eventId))).limit(1);
    const balance = intent ? null : await provider.balance(appUserId);
    if (balance !== null && (!Number.isSafeInteger(balance) || balance < 0)) {
      throw new CreditsError(503, "credits_unavailable", "The credit balance could not be verified for this refund.");
    }
    // Already consumed credits cannot be taken back; remove remaining eligible
    // credits without creating a negative wallet or changing other plan limits.
    const debit = intent ? -intent.amount : Math.min(balance!, revokedCredits - priorRevoked);
    if (debit > 0) {
      await grantForLibrary(libraryHash, appUserId, -debit, "Credit pack payment refunded or disputed",
        "stripe", eventId, provider, metadata, true);
    } else {
      await assertCreditsLibraryNotDeleted(libraryHash);
    }
    await saveState();
  });
}

export async function reconcileCreditPackCharge(
  charge: Stripe.Charge,
  stripe: Stripe,
  provider: CreditProvider = revenueCatProvider,
): Promise<boolean> {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return false;
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 100 });
  const packs = sessions.data.filter(session => session.metadata?.classscribe_credits_pack);
  if (!packs.length) return false;
  if (packs.length !== 1 || sessions.has_more) {
    throw new CreditsError(503, "invalid_checkout_event", "The refunded pack payment is ambiguous.");
  }
  const sessionPaymentId = typeof packs[0]!.payment_intent === "string"
    ? packs[0]!.payment_intent : packs[0]!.payment_intent?.id;
  if (sessionPaymentId !== paymentIntentId) {
    throw new CreditsError(400, "invalid_checkout_event", "The refunded pack does not belong to this payment.");
  }
  await fulfillCreditCheckout(packs[0]!, provider, stripe);
  return true;
}

export async function processCreditsRevenueCatWebhook(payload: unknown): Promise<void> {
  const event = record(record(payload).event);
  const eventId = typeof event.id === "string" ? event.id : "";
  const appUserId = typeof event.app_user_id === "string" ? event.app_user_id : "";
  const type = typeof event.type === "string" ? event.type : "";
  if (!eventId || !appUserId) throw new CreditsError(400, "invalid_revenuecat_event", "Invalid RevenueCat credits event.");
  const libraryHash = await findLibraryHashForAppUser(appUserId);
  if (!libraryHash) return;
  const subscriptionLibraryHash = await canonicalLibraryHash(libraryHash);
  await assertCreditsLibraryNotDeleted(subscriptionLibraryHash);
  const currencyCode = await getCreditsRuntimeTarget();
  const adjustments = Array.isArray(event.adjustments) ? event.adjustments.map(record) : [];
  const matchingCurrencyAdjustments = (code: "CRD" | "CREDITS") => adjustments.filter((adjustment) =>
    (record(adjustment.currency).code === code ||
      record(adjustment.currency).currency_code === code) &&
    Number.isSafeInteger(adjustment.amount));
  const activeCurrencyAdjustments = matchingCurrencyAdjustments(currencyCode);
  // Keep signed provider history complete across the CRD -> CREDITS cutover.
  // If a provider event contains both codes, prefer the migration's active
  // currency so one event is never double-counted in the history ledger.
  const currencyAdjustments = activeCurrencyAdjustments.length > 0
    ? activeCurrencyAdjustments
    : matchingCurrencyAdjustments(currencyCode === "CRD" ? "CREDITS" : "CRD");
  const adjustmentAmount = currencyAdjustments.reduce((total, adjustment) =>
    total + Number(adjustment.amount), 0);
  const legacyAmount = typeof event.virtual_currency_amount === "number" &&
      Number.isSafeInteger(event.virtual_currency_amount)
    ? event.virtual_currency_amount
    : 0;
  const purchaseEvent = ["INITIAL_PURCHASE", "RENEWAL", "NON_RENEWING_PURCHASE"].includes(type);
  const amount = adjustments.length > 0
    ? currencyAdjustments.length > 0 && Number.isSafeInteger(adjustmentAmount)
      ? adjustmentAmount
      : 0
    : purchaseEvent
      ? legacyAmount
      : 0;
  const virtualCurrencyTransactionId = typeof event.virtual_currency_transaction_id === "string" &&
      event.virtual_currency_transaction_id.length > 0
    ? event.virtual_currency_transaction_id
    : eventId;
  const source = typeof event.source === "string" ? event.source : "";
  const reference = typeof event.reference === "string" && event.reference.length <= 200
    ? event.reference
    : undefined;
  if (amount !== 0) {
    if (reference) {
      const [directGrant] = await db.select({ eventId: ledger.eventId }).from(ledger)
        .where(eq(ledger.eventId, reference)).limit(1);
      if (directGrant) return;
    }
    const eventDate = typeof event.event_timestamp_ms === "number" &&
        Number.isFinite(event.event_timestamp_ms)
      ? new Date(event.event_timestamp_ms)
      : undefined;
    await persistTransaction({
      libraryHash,
      eventId: `revenuecat-${virtualCurrencyTransactionId}`,
      amount,
      reason: source === "expiration"
        ? "RevenueCat virtual currency expiration"
        : amount < 0
          ? "RevenueCat virtual currency refund or debit"
          : "RevenueCat virtual currency purchase",
      source: "revenuecat",
      ...(eventDate && !Number.isNaN(eventDate.getTime()) ? { date: eventDate } : {}),
      metadata: {
        productId: event.product_id,
        eventType: type,
        ...(source ? { revenueCatSource: source } : {}),
        ...(reference ? { reference } : {}),
        virtualCurrencyTransactionId,
      },
    });
  }
  const productId = storeSubscriptionProductForEvent(type, event.product_id, event.new_product_id);
  const plan = planFromStoreProductIdentifier(productId);
  const readiness = await getCreditsSubscriptionPeriodReadiness();
  const eventPrice = typeof event.price === "number"
    ? event.price
    : event.price_in_purchased_currency;
  if (readiness.ready && plan && typeof productId === "string" &&
    ["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE"].includes(type) &&
    isPaidStoreSubscriptionPeriod(eventPrice, event.period_type)) {
    const periodStart = event.purchased_at_ms;
    const periodEnd = event.expiration_at_ms;
    const paymentId = [event.transaction_id, event.original_transaction_id, event.store_transaction_id]
      .find((candidate) => typeof candidate === "string" && candidate.length > 0 && candidate.length <= 200);
    if (typeof periodStart === "number" && Number.isSafeInteger(periodStart) &&
      typeof periodEnd === "number" && Number.isSafeInteger(periodEnd) &&
      typeof paymentId === "string" &&
      await hasVerifiedPaidRevenueCatSubscription(subscriptionLibraryHash, plan, productId, periodEnd)) {
      await grantMonthlySubscriptionCreditsForLibrary({
        libraryHash: subscriptionLibraryHash,
        appUserId,
        plan,
        periodStart: canonicalPeriodDate(periodStart),
        periodEnd: canonicalPeriodDate(periodEnd),
        source: "revenuecat",
        eventId,
        paymentId,
      });
    }
  }
  const cancellationReason = typeof event.cancel_reason === "string"
    ? event.cancel_reason
    : typeof event.cancellation_reason === "string"
      ? event.cancellation_reason
      : "";
  const verifiedRefundEvent = ["REFUND", "CHARGEBACK"].includes(type) ||
    (type === "CANCELLATION" && ["CUSTOMER_SUPPORT", "REFUNDED", "CHARGEBACK"].includes(cancellationReason));
  if (verifiedRefundEvent) {
    const paymentId = [event.transaction_id, event.original_transaction_id, event.store_transaction_id]
      .find((candidate) => typeof candidate === "string" && candidate.length > 0 && candidate.length <= 200);
    if (typeof paymentId === "string") {
      await reverseMonthlySubscriptionCreditsForLibrary({
        libraryHash: subscriptionLibraryHash,
        appUserId,
        source: "revenuecat",
        paymentId,
        eventId,
      });
    }
  }
  if (!purchaseEvent) return;
}

async function findLibraryHashForAppUser(appUserId: string): Promise<string | undefined> {
  const prefix = "private/classscribe-billing/accounts/";
  const matches = await db.select({ path: documents.path, data: documents.data }).from(documents)
    .where(sql`${documents.path} like ${`${prefix}%`}`);
  const found = matches.filter((row) => record(row.data).billingAccountId === appUserId)
    .map((row) => row.path.slice(prefix.length))
    .filter((value) => /^[a-f0-9]{64}$/.test(value));
  return found.length === 1 ? found[0] : undefined;
}

async function hasVerifiedPaidRevenueCatSubscription(
  libraryHash: string,
  plan: SubscriptionCreditPlan,
  productId: string,
  periodEndMs: number,
): Promise<boolean> {
  const [account] = await db.select({ data: documents.data }).from(documents)
    .where(eq(documents.path, accountPath(libraryHash))).limit(1);
  const snapshot = record(record(account?.data).revenueCat);
  const expectedProjectId = process.env.REVENUECAT_PROJECT_ID;
  if (!expectedProjectId) return false;
  return verifiedSubscriptionSnapshotMatches({
    snapshot,
    plan,
    productId,
    periodEndMs,
    expectedProjectId,
    nowMs: Date.now(),
  });
}

export async function grantCreditsForLibraryCode(
  code: string,
  amount: number,
  reason: string,
  source: "admin" | "promo" | "referral",
  eventId: string = randomUUID(),
): Promise<void> {
  await adjustCreditsForLibraryCode(code, amount, reason, source, eventId);
}

export async function adjustCreditsForLibraryCode(
  code: string,
  amount: number,
  reason: string,
  source: "admin" | "promo" | "referral" | "spend" | "refund",
  eventId: string = randomUUID(),
  provider: CreditProvider = revenueCatProvider,
): Promise<void> {
  const libraryHash = await authorizeLibrary(code);
  const appUserId = await getRevenueCatAppUserId(code);
  if (!reason.trim() || reason.length > 200) throw new CreditsError(400, "invalid_argument", "A short reason is required.");
  await grantForLibrary(libraryHash, appUserId, amount, reason.trim(), source, eventId, provider);
}

export async function refundCredits(
  code: string,
  amount: number,
  reason: string,
  eventId: string,
  provider: CreditProvider = revenueCatProvider,
): Promise<void> {
  if (amount <= 0) throw new CreditsError(400, "invalid_adjustment", "Refund amount must be positive.");
  await adjustCreditsForLibraryCode(code, amount, reason, "refund", eventId, provider);
}

export async function spendCredits(
  code: string,
  amount: number,
  reason: string,
  eventId: string,
  provider: CreditProvider = revenueCatProvider,
): Promise<void> {
  if (amount <= 0) throw new CreditsError(400, "invalid_adjustment", "Spend amount must be positive.");
  await adjustCreditsForLibraryCode(code, -amount, reason, "spend", eventId, provider);
}

export { revenueCatProvider };

async function getUncachableStripeClient(): Promise<Stripe> {
  const { getUncachableStripeClient: loadStripe } = await import("./stripeClient");
  return loadStripe();
}