import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import Stripe from "stripe";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  classscribeCreditActionsTable,
  classscribeCreditProviderIntentsTable,
  classscribeCreditSubscriptionPaymentRevocationsTable,
  classscribeCreditSubscriptionPeriodsTable,
  classscribeCreditTransactionsTable,
  classscribeLegacyDocumentsTable,
  db,
  pool,
} from "@workspace/db";
import { validUid } from "./classscribe-legacy-access";
import {
  getStripeConnectionWebhookSecret,
  getStripeConnectionLivemode,
  getUncachableStripeClient,
  getStripeSync,
  StripeConnectionError,
} from "./stripeClient";
import { hasRevenueCatCreditsApiKey, revenueCatRequest } from "./revenuecat-request";

export type PaidPlan = "student" | "pro";
export type Plan = "free" | PaidPlan;
export type RevenueCatRenewalStatus =
  | "will_renew"
  | "will_not_renew"
  | "will_change_product"
  | "will_pause"
  | "requires_price_increase_consent"
  | "has_already_renewed";
export type BillingStatus = {
  plan: Plan;
  status: string;
  billingSource: "web" | "app_store" | "play_store" | "test_store" | null;
  billingConflict: boolean;
  renewalStatus?: RevenueCatRenewalStatus;
  periodEnd?: string;
  recordingHoursUsed: number;
  recordingHoursLimit: number;
  courseLimit: number | null;
  recordingCountUsed: number;
  recordingCountLimit: number;
  transcriptionCountUsed: number;
  transcriptionCountLimit: number;
  askCountUsed: number;
  askCountLimit: number | null;
  askCountRemaining: number | null;
  askResetAt: string;
  cancelAtPeriodEnd?: boolean;
};
export type BillingReadiness =
  | { ready: true; mode: "test" | "live" }
  | { ready: false; mode: null; code: string; message: string };

type BillingAccount = {
  libraryHash: string;
  billingAccountId?: string;
  creditsWelcomeLibraryHash?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  plan?: Plan;
  status?: string;
  periodStart?: string;
  periodEnd?: string;
  stripeVerifiedAt?: string;
  cancelAtPeriodEnd?: boolean;
  lastStripeEventCreated?: number;
  pendingCheckoutAttemptId?: string;
  pendingCheckoutPlan?: PaidPlan;
  pendingCheckoutPriceId?: string;
  pendingCheckoutReturnUrl?: string;
  pendingCheckoutCreatedAt?: string;
  pendingCheckoutSessionId?: string;
  revenueCat?: RevenueCatEntitlement;
};

type RevenueCatEntitlement = {
  plan: PaidPlan | "free";
  status: "active" | "expired" | "inactive";
  periodEnd?: string;
  productIdentifier?: string;
  store?: string;
  projectId: string;
  appId?: string;
  verifiedAt: string;
  customerLookupNotFound?: boolean;
  renewalStatus?: RevenueCatRenewalStatus;
};

type LegacyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const documents = classscribeLegacyDocumentsTable;
const hashLibraryCode = (code: string): string =>
  createHash("sha256").update(code).digest("hex");
export const freeBillingIdentityForOwner = (accountId: string): string =>
  `u_${createHash("sha256").update(`classscribe-free:${accountId}`).digest("hex").slice(0, 32)}`;
const billingAccountPath = (libraryHash: string): string =>
  `private/classscribe-billing/accounts/${libraryHash}`;
const billingEventPath = (eventId: string): string =>
  `private/classscribe-billing/events/${eventId}`;
const billingAliasPath = (libraryHash: string): string =>
  `private/classscribe-billing/aliases/${libraryHash}`;
const usagePath = (libraryHash: string, month: string): string =>
  `private/classscribe-billing/usage/${libraryHash}/${month}`;
const revokedPath = (libraryCode: string): string =>
  `revoked/${hashLibraryCode(libraryCode)}`;

export const planConfiguration: Record<Plan, {
  recordingHours: number;
  courseLimit: number | null;
  recordingCount: number;
  transcriptionCount: number;
}> = {
  free: { recordingHours: 5, courseLimit: 3, recordingCount: 5, transcriptionCount: 5 },
  student: { recordingHours: 40, courseLimit: null, recordingCount: 20, transcriptionCount: 20 },
  pro: { recordingHours: 120, courseLimit: null, recordingCount: 60, transcriptionCount: 60 },
};
let stripeSyncReady = false;
let stripeLivemode = false;
let stripeReadinessError = "stripe_initialization_not_run";

export class StripeSetupError extends Error {
  constructor(public readonly code: string) {
    super("Stripe billing setup is unavailable.");
    this.name = "StripeSetupError";
  }
}

export function assertStripeWebhookMode(eventLivemode: boolean, connectedLivemode: boolean): void {
  if (eventLivemode !== connectedLivemode) {
    throw new StripeSetupError("stripe_webhook_mode_mismatch");
  }
}

export function stripeSetupErrorCode(error: unknown): string {
  if (error instanceof StripeSetupError || error instanceof StripeConnectionError) {
    return error.code;
  }
  return "stripe_initialization_failed";
}

export function isStripeSyncReady(): boolean {
  return stripeSyncReady;
}

export function getBillingReadiness(): BillingReadiness {
  return stripeSyncReady
    ? { ready: true, mode: stripeLivemode ? "live" : "test" }
    : {
        ready: false,
        mode: null,
        code: stripeReadinessError,
        message: "Stripe checkout and billing management are unavailable. Please try again later.",
      };
}

function utcUsageMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function utcAskResetAt(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function usageAskResetAt(month: unknown): string {
  if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) {
    const [year, monthNumber] = month.split("-").map(Number);
    if (monthNumber >= 1 && monthNumber <= 12) {
      return new Date(Date.UTC(year, monthNumber, 1)).toISOString();
    }
  }
  return utcAskResetAt();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type EffectiveEntitlement = {
  plan: Plan;
  status: string;
  billingSource: BillingStatus["billingSource"];
  billingConflict: boolean;
  renewalStatus?: RevenueCatRenewalStatus;
  periodEnd?: string;
  cancelAtPeriodEnd?: boolean;
};

function effectiveEntitlement(account: BillingAccount | undefined, now = Date.now()): EffectiveEntitlement {
  const stripeExpiry = account?.periodEnd ? Date.parse(account.periodEnd) : undefined;
  const activeStripe =
    (account?.status === "active" || account?.status === "trialing") &&
    (account.plan === "student" || account.plan === "pro") &&
    stripeExpiry !== undefined &&
    Number.isFinite(stripeExpiry) &&
    stripeExpiry > now
      ? {
          plan: account.plan,
          status: account.status,
          billingSource: "web" as const,
          periodEnd: account.periodEnd,
          cancelAtPeriodEnd: account.cancelAtPeriodEnd ?? false,
        }
      : undefined;

  const revenueCat = account?.revenueCat;
  const revenueCatExpiry = revenueCat?.periodEnd
    ? Date.parse(revenueCat.periodEnd)
    : undefined;
  const activeRevenueCat =
    revenueCat?.status === "active" &&
    (revenueCat.plan === "student" || revenueCat.plan === "pro") &&
    revenueCatExpiry !== undefined &&
    Number.isFinite(revenueCatExpiry) &&
    revenueCatExpiry > now
      ? {
          plan: revenueCat.plan,
          status: "active",
          billingSource: (revenueCatStore(revenueCat.store) ?? null) as BillingStatus["billingSource"],
          ...(revenueCat.renewalStatus
            ? {
                renewalStatus: revenueCat.renewalStatus,
                cancelAtPeriodEnd: revenueCat.renewalStatus === "will_not_renew" ||
                  revenueCat.renewalStatus === "will_pause",
              }
            : {}),
          periodEnd: revenueCat.periodEnd,
        }
      : undefined;

  const activeCandidates: Array<{
    plan: PaidPlan;
    status: string;
    billingSource: BillingStatus["billingSource"];
    renewalStatus?: RevenueCatRenewalStatus;
    periodEnd?: string;
    cancelAtPeriodEnd?: boolean;
  }> = [];
  if (activeStripe) {
    activeCandidates.push({
      plan: activeStripe.plan,
      status: activeStripe.status,
      billingSource: activeStripe.billingSource,
      ...(activeStripe.periodEnd ? { periodEnd: activeStripe.periodEnd } : {}),
      cancelAtPeriodEnd: activeStripe.cancelAtPeriodEnd,
    });
  }
  if (activeRevenueCat) activeCandidates.push(activeRevenueCat);
  const active = activeCandidates
    .sort((left, right) => (left.plan === "pro" ? 2 : 1) - (right.plan === "pro" ? 2 : 1))
    .at(-1);
  if (active) {
    return {
      plan: active.plan,
      status: active.status,
      billingSource: active.billingSource,
      ...(active.renewalStatus ? { renewalStatus: active.renewalStatus } : {}),
      billingConflict: Boolean(activeStripe && activeRevenueCat),
      ...(typeof active.periodEnd === "string" ? { periodEnd: active.periodEnd } : {}),
      ...(typeof active.cancelAtPeriodEnd === "boolean"
        ? { cancelAtPeriodEnd: active.cancelAtPeriodEnd }
        : {}),
    };
  }

  const expiredRevenueCat =
    revenueCat?.status === "expired" ||
    (revenueCat?.status === "active" &&
      revenueCatExpiry !== undefined &&
      Number.isFinite(revenueCatExpiry) &&
      revenueCatExpiry <= now);
  const expiredStripe =
    (account?.status === "active" || account?.status === "trialing") &&
    (account.plan === "student" || account.plan === "pro") &&
    stripeExpiry !== undefined &&
    Number.isFinite(stripeExpiry) &&
    stripeExpiry <= now;
  return {
    plan: "free",
    billingSource: null,
    billingConflict: false,
    status: account?.status === "canceled" || account?.status === "past_due"
      ? account.status
      : expiredRevenueCat || expiredStripe
        ? "expired"
        : account?.status ?? revenueCat?.status ?? "inactive",
    ...(typeof account?.periodEnd === "string"
      ? { periodEnd: account.periodEnd }
      : typeof revenueCat?.periodEnd === "string"
        ? { periodEnd: revenueCat.periodEnd }
        : {}),
  };
}

async function resolveCurrentBillingHash(
  libraryHash: string,
  query: Pick<typeof db, "select"> | LegacyTransaction = db,
): Promise<string> {
  let current = libraryHash;
  const seen = new Set<string>();
  for (let depth = 0; depth < 32; depth += 1) {
    if (seen.has(current)) throw new Error("ClassScribe billing identity alias loop detected.");
    seen.add(current);
    const [alias] = await query.select({ data: documents.data })
      .from(documents)
      .where(eq(documents.path, billingAliasPath(current)))
      .limit(1);
    const next = asRecord(alias?.data).toHash;
    if (!isLibraryHash(next)) return current;
    current = next;
  }
  throw new Error("ClassScribe billing identity alias chain is too long.");
}

async function getBillingAccount(
  query: Pick<typeof db, "select"> | LegacyTransaction,
  libraryHash: string,
): Promise<BillingAccount | undefined> {
  const [row] = await query.select({ data: documents.data })
    .from(documents)
    .where(eq(documents.path, billingAccountPath(libraryHash)))
    .limit(1);
  const value = asRecord(row?.data);
  if (typeof value.libraryHash !== "string") return undefined;
  return value as BillingAccount;
}

async function assertLibraryActive(libraryCode: string): Promise<void> {
  const [revoked] = await db.select({ path: documents.path })
    .from(documents)
    .where(eq(documents.path, revokedPath(libraryCode)))
    .limit(1);
  if (revoked) {
    throw new BillingError(403, "not_granted", "This sync code has been replaced.");
  }
}

export class BillingError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function safeRevenueCatFailureDetail(
  response: Response,
  appUserId: string,
  projectId: string,
): Promise<string> {
  try {
    const body = asRecord(await response.clone().json());
    const nestedError = asRecord(body.error);
    const codeValue = body.error_code ?? body.code ?? nestedError.error_code ?? nestedError.code;
    const messageValue = body.message ?? body.error_description ??
      nestedError.message ?? (typeof body.error === "string" ? body.error : undefined);
    const code = typeof codeValue === "string" &&
      /^[A-Za-z0-9_.:-]{1,80}$/.test(codeValue)
      ? codeValue
      : undefined;
    const message = typeof messageValue === "string"
      ? messageValue
        .replaceAll(appUserId, "[redacted customer]")
        .replaceAll(projectId, "[redacted project]")
        .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]+\b/gi, "[redacted credential]")
        .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[redacted id]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180)
      : undefined;
    return [
      `HTTP ${response.status}`,
      ...(code ? [`code ${code}`] : []),
      ...(message ? [message] : []),
    ].join("; ");
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function ensureRevenueCatCustomer(appUserId: string): Promise<{ project: string; customer: string }> {
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  if (!projectId) {
    throw new BillingError(
      503,
      "revenuecat_not_configured",
      "RevenueCat customer provisioning is not configured for this environment.",
    );
  }
  if (!/^[0-9A-Za-z_-]{1,1500}$/.test(appUserId)) {
    throw new BillingError(503, "revenuecat_customer_invalid", "The RevenueCat customer identity is invalid.");
  }
  const projectPath = `/v2/projects/${encodeURIComponent(projectId)}`;
  const revenueCatScopeGuidance = hasRevenueCatCreditsApiKey()
    ? "The configured server-only API key must include customer read/write and purchases read/write permissions."
    : "The connected OAuth scopes do not provide customer/purchases read-write access; reauthorization cannot add it. Configure the server-only REVENUECAT_CREDITS_API_KEY with customer read/write and purchases read/write permissions.";
  const customerReadScopeMessage =
    `RevenueCat customer verification requires customer_information:customers:read_write. ${revenueCatScopeGuidance}`;
  const request = async (path: string, method: "GET" | "POST", body?: unknown): Promise<Response> => {
    try {
      return await revenueCatRequest(path, {
        method,
        ...(body ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        } : {}),
      });
    } catch {
      throw new BillingError(
        503,
        "revenuecat_customer_unavailable",
        "RevenueCat could not provision or verify the credits customer. Please retry.",
      );
    }
  };
  const loadCustomer = async (): Promise<Record<string, unknown> | undefined> => {
    const response = await request(
      `${projectPath}/customers?search=${encodeURIComponent(appUserId)}&limit=100`,
      "GET",
    );
    if (!response.ok) {
      if (response.status === 403) {
        throw new BillingError(
          503,
          "revenuecat_customer_read_scope_missing",
          customerReadScopeMessage,
        );
      }
      throw new BillingError(503, "revenuecat_customer_unavailable", "RevenueCat could not verify the customer. Please retry.");
    }
    let result: unknown;
    try { result = await response.json(); } catch {
      throw new BillingError(503, "revenuecat_response_invalid", "RevenueCat returned an unreadable customer response.");
    }
    const customerList = asRecord(result);
    if (!Array.isArray(customerList.items)) {
      throw new BillingError(503, "revenuecat_response_invalid", "RevenueCat returned an invalid customer list.");
    }
    const customers = customerList.items.map(asRecord);
    if (customers.some((item) => item.project_id !== projectId)) {
      throw new BillingError(
        503,
        "revenuecat_project_mismatch",
        "RevenueCat returned a customer from an unexpected project.",
      );
    }
    const matches = customers.filter((item) => item.project_id === projectId);
    if (matches.length > 1) {
      throw new BillingError(503, "revenuecat_customer_ambiguous", "RevenueCat returned an ambiguous customer identity.");
    }
    if (matches.length === 0) return undefined;
    const customer = matches[0]!;
    if (customer.object !== "customer" || typeof customer.id !== "string" || customer.id.length === 0) {
      throw new BillingError(503, "revenuecat_customer_invalid", "RevenueCat returned an invalid customer identity.");
    }
    return customer;
  };
  const verifyAlias = async (customer: Record<string, unknown>): Promise<void> => {
    const response = await request(
      `${projectPath}/customers/${encodeURIComponent(String(customer.id))}/aliases?limit=100`,
      "GET",
    );
    if (!response.ok) {
      if (response.status === 403) {
        throw new BillingError(
          503,
          "revenuecat_customer_read_scope_missing",
          customerReadScopeMessage,
        );
      }
      throw new BillingError(503, "revenuecat_customer_unverified", "RevenueCat could not verify the customer identity.");
    }
    let result: unknown;
    try { result = await response.json(); } catch {
      throw new BillingError(503, "revenuecat_response_invalid", "RevenueCat returned an unreadable customer alias response.");
    }
    const aliasList = asRecord(result);
    if (!Array.isArray(aliasList.items)) {
      throw new BillingError(503, "revenuecat_response_invalid", "RevenueCat returned an invalid customer alias list.");
    }
    if (!aliasList.items.map(asRecord).some((alias) =>
      alias.object === "customer.alias" && alias.id === appUserId)) {
      throw new BillingError(503, "revenuecat_customer_unverified", "RevenueCat did not confirm the customer identity.");
    }
  };

  const existing = await loadCustomer();
  if (existing) {
    await verifyAlias(existing);
    return { project: projectId, customer: existing.id as string };
  }

  const createResponse = await request(`${projectPath}/customers`, "POST", { id: appUserId });
  if (!createResponse.ok && createResponse.status !== 409) {
    const providerDetail = await safeRevenueCatFailureDetail(createResponse, appUserId, projectId);
    if (createResponse.status === 403) {
      throw new BillingError(
        503,
        "revenuecat_customer_write_scope_missing",
        `RevenueCat customer creation requires customer_information:customers:read_write (${providerDetail}). ${revenueCatScopeGuidance}`,
      );
    }
    throw new BillingError(
      503,
      "revenuecat_customer_create_failed",
      `RevenueCat could not create the credits customer (${providerDetail}).`,
    );
  }
  if (createResponse.ok) {
    let created: unknown;
    try { created = await createResponse.json(); } catch {
      throw new BillingError(503, "revenuecat_response_invalid", "RevenueCat returned an unreadable created-customer response.");
    }
    const customer = asRecord(created);
    if (createResponse.status !== 201 || customer.object !== "customer" ||
      customer.id !== appUserId || customer.project_id !== projectId) {
      throw new BillingError(
        503,
        "revenuecat_customer_unverified",
        "RevenueCat did not confirm the newly created customer identity.",
      );
    }
    await verifyAlias(customer);
    return { project: projectId, customer: appUserId };
  }

  // A concurrent creation may win the unique-ID race; accept it only after
  // the search result and aliases endpoint verify the exact app-user ID.
  const racedCustomer = await loadCustomer();
  if (!racedCustomer) {
    throw new BillingError(503, "revenuecat_customer_missing", "RevenueCat has not created the customer yet.");
  }
  await verifyAlias(racedCustomer);
  return { project: projectId, customer: racedCustomer.id as string };
}

export async function getRevenueCatAppUserId(libraryCode: string): Promise<string> {
  if (!validUid(libraryCode)) {
    throw new BillingError(403, "not_granted", "Not allowed.");
  }
  await assertLibraryActive(libraryCode);
  const initialHash = hashLibraryCode(libraryCode);

  return db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(initialHash, tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const [revoked] = await tx.select({ path: documents.path })
      .from(documents)
      .where(eq(documents.path, revokedPath(libraryCode)))
      .limit(1);
    if (revoked) {
      throw new BillingError(403, "not_granted", "This sync code has been replaced.");
    }
    const existing = await getBillingAccount(tx, libraryHash);
    if (existing?.billingAccountId) {
      if (/^[a-f0-9]{64}$/.test(existing.creditsWelcomeLibraryHash ?? "")) {
        return existing.billingAccountId;
      }
      const account = {
        ...existing,
        creditsWelcomeLibraryHash: libraryHash,
      };
      await tx.update(documents).set({ data: account, updatedAt: new Date() })
        .where(eq(documents.path, billingAccountPath(libraryHash)));
      return existing.billingAccountId;
    }

    const billingAccountId = randomUUID();
    const account: BillingAccount = {
      ...existing,
      libraryHash,
      billingAccountId,
      creditsWelcomeLibraryHash: libraryHash,
      plan: existing?.plan ?? "free",
      status: existing?.status ?? "inactive",
    };
    await tx.insert(documents).values({
      path: billingAccountPath(libraryHash),
      data: account,
    }).onConflictDoUpdate({
      target: documents.path,
      set: { data: account, updatedAt: new Date() },
    });
    return billingAccountId;
  });
}

type RevenueCatSnapshot = {
  project: unknown;
  apps: unknown[];
  products: unknown[];
  customer?: unknown;
  customerLookupNotFound?: boolean;
  activeEntitlements: unknown;
  subscriptions: unknown;
};
type RevenueCatSnapshotLoader = (appUserId: string) => Promise<RevenueCatSnapshot>;

const revenueCatPlanByEntitlement: Record<string, PaidPlan> = {
  classscribe_student: "student",
  classscribe_pro: "pro",
  student: "student",
  pro: "pro",
};

function planForRevenueCatProduct(productIdentifier: unknown): PaidPlan | undefined {
  if (typeof productIdentifier !== "string") return undefined;
  const normalized = productIdentifier.replace(/:monthly$/, "");
  if (normalized === "classscribe_student_monthly" || normalized === "student_monthly") return "student";
  if (normalized === "classscribe_pro_monthly" || normalized === "pro_monthly") return "pro";
  return undefined;
}

function revenueCatStore(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (["app_store", "mac_app_store"].includes(normalized)) return "app_store";
  if (normalized === "play_store") return "play_store";
  if (normalized === "test_store") return "test_store";
  return undefined;
}

function activeRevenueCatExpiration(value: unknown, now: number): {
  active: boolean;
  periodEnd?: string;
} {
  // ClassScribe sells recurring plans only. Unknown/no expiry must not create
  // an indefinite entitlement from an incomplete provider response.
  if (typeof value !== "string" && typeof value !== "number") return { active: false };
  const numeric = typeof value === "number" ? value : Number(value);
  const expiresAt = Number.isFinite(numeric) && numeric > 0
    ? numeric < 100_000_000_000
      ? numeric * 1000
      : numeric
    : typeof value === "string"
      ? Date.parse(value)
      : Number.NaN;
  if (!Number.isFinite(expiresAt)) return { active: false };
  return {
    active: expiresAt > now,
    periodEnd: new Date(expiresAt).toISOString(),
  };
}

function listItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asRecord);
  const items = asRecord(value).items;
  return Array.isArray(items) ? items.map(asRecord) : [];
}

const revenueCatRenewalStatuses = new Set<RevenueCatRenewalStatus>([
  "will_renew",
  "will_not_renew",
  "will_change_product",
  "will_pause",
  "requires_price_increase_consent",
  "has_already_renewed",
]);

function normalizeRevenueCatSubscriber(
  snapshot: RevenueCatSnapshot,
  projectId: string,
  appUserId: string,
  now = Date.now(),
): RevenueCatEntitlement {
  const project = asRecord(snapshot.project);
  if (project.id !== projectId) {
    throw new BillingError(
      503,
      "revenuecat_project_mismatch",
      "RevenueCat returned data for an unexpected project.",
    );
  }
  const customer = asRecord(snapshot.customer);
  const activeEntitlements = listItems(snapshot.activeEntitlements);
  const subscriptions = listItems(snapshot.subscriptions);
  const appsById = new Map(snapshot.apps.map((item) => {
    const app = asRecord(item);
    return [app.id, app] as const;
  }));
  const products = snapshot.products.map(asRecord);
  const expiredCandidates: Array<{ plan: PaidPlan; periodEnd: string }> = [];
  const candidates: Array<{
    plan: PaidPlan;
    periodEnd?: string;
    productIdentifier: string;
    store: string;
    appId: string;
    renewalStatus?: RevenueCatRenewalStatus;
  }> = [];

  if (customer.app_user_id !== appUserId) {
    return {
      plan: "free",
      status: "inactive",
      projectId,
      verifiedAt: new Date(now).toISOString(),
    };
  }

  for (const entitlement of activeEntitlements) {
    const entitlementPlan = revenueCatPlanByEntitlement[String(entitlement.lookup_key)];
    if (!entitlementPlan) continue;
    const productId = entitlement.product_id;
    const productRecord = products.find((item) =>
      (typeof productId === "string" && item.id === productId) ||
      (typeof entitlement.product_identifier === "string" &&
        item.store_identifier === entitlement.product_identifier),
    );
    if (!productRecord) continue;
    const productIdentifier = productRecord.store_identifier;
    const productPlan = planForRevenueCatProduct(productIdentifier);
    if (productPlan !== entitlementPlan || typeof productIdentifier !== "string") continue;
    const subscription = subscriptions.find((item) =>
      (typeof productId === "string" && item.product_id === productId) ||
      item.product_identifier === productIdentifier,
    );
    if (!subscription) continue;
    const store = revenueCatStore(subscription.store);
    if (!store) continue;
    const storeAppVariable: Record<string, string | undefined> = {
      test_store: process.env.REVENUECAT_TEST_STORE_APP_ID,
      app_store: process.env.REVENUECAT_APPLE_APP_STORE_APP_ID,
      play_store: process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID,
    };
    const appId = storeAppVariable[store];
    if (!appId) continue;
    const expectedAppType = store === "app_store"
      ? "app_store"
      : store === "play_store"
        ? "play_store"
        : "test_store";
    if (appsById.get(appId)?.type !== expectedAppType) continue;
    if (productRecord.app_id !== appId) continue;
    if (
      typeof subscription.app_id === "string" &&
      subscription.app_id !== appId
    ) continue;
    const subscriptionStatus = String(subscription.status ?? "").toLowerCase();
    if (!["active", "trialing", "grace_period", "in_grace_period"].includes(subscriptionStatus)) continue;

    const entitlementExpiry = activeRevenueCatExpiration(entitlement.expires_at, now);
    const subscriptionExpiry = activeRevenueCatExpiration(subscription.expires_at, now);
    const graceExpiry = activeRevenueCatExpiration(subscription.grace_period_expires_at, now);
    const periodEnd = [entitlementExpiry.periodEnd, subscriptionExpiry.periodEnd, graceExpiry.periodEnd]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    const isActive = entitlementExpiry.active &&
      (subscriptionExpiry.active || graceExpiry.active);
    if (!isActive) {
      const expiredPeriodEnd = [
        entitlementExpiry.periodEnd,
        subscriptionExpiry.periodEnd,
        graceExpiry.periodEnd,
      ]
        .filter((value): value is string => Boolean(value))
        .filter((value) => Date.parse(value) <= now)
        .sort()
        .at(-1);
      if (expiredPeriodEnd) expiredCandidates.push({ plan: entitlementPlan, periodEnd: expiredPeriodEnd });
      continue;
    }
    candidates.push({
      plan: entitlementPlan,
      ...(periodEnd ? { periodEnd } : {}),
      productIdentifier,
      store,
      appId,
      ...(typeof subscription.auto_renewal_status === "string" &&
        revenueCatRenewalStatuses.has(subscription.auto_renewal_status as RevenueCatRenewalStatus)
        ? { renewalStatus: subscription.auto_renewal_status as RevenueCatRenewalStatus }
        : {}),
    });
  }

  const winner = candidates
    .sort((left, right) => (left.plan === "pro" ? 2 : 1) - (right.plan === "pro" ? 2 : 1))
    .at(-1);
  if (!winner) {
    const expired = expiredCandidates
      .sort((left, right) => (left.plan === "pro" ? 2 : 1) - (right.plan === "pro" ? 2 : 1))
      .at(-1);
    return {
      plan: "free",
      status: expired ? "expired" : "inactive",
      ...(expired ? { periodEnd: expired.periodEnd } : {}),
      projectId,
      verifiedAt: new Date(now).toISOString(),
    };
  }
  return {
    plan: winner.plan,
    status: "active",
    ...(winner.periodEnd ? { periodEnd: winner.periodEnd } : {}),
    productIdentifier: winner.productIdentifier,
    store: winner.store,
    projectId,
    appId: winner.appId,
    ...(winner.renewalStatus ? { renewalStatus: winner.renewalStatus } : {}),
    verifiedAt: new Date(now).toISOString(),
  };
}

async function fetchRevenueCatSnapshot(appUserId: string): Promise<RevenueCatSnapshot> {
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  if (!projectId) {
    throw new BillingError(
      503,
      "revenuecat_not_configured",
      "RevenueCat verification is not configured for this environment.",
    );
  }
  const connectors = new ReplitConnectors();
  const getJson = async (path: string, allowNotFound = false): Promise<unknown> => {
    let response: Response;
    try {
      response = await connectors.proxy("revenuecat", path, { method: "GET" });
    } catch {
      throw new BillingError(
        503,
        "revenuecat_unavailable",
        "RevenueCat could not verify the subscription. Please retry.",
      );
    }
    if (!response.ok) {
      if (allowNotFound && response.status === 404) return undefined;
      throw new BillingError(
        503,
        "revenuecat_unavailable",
        "RevenueCat could not verify the subscription. Please retry.",
      );
    }
    try {
      return await response.json();
    } catch {
      throw new BillingError(
        503,
        "revenuecat_response_invalid",
        "RevenueCat returned an unreadable subscription response.",
      );
    }
  };
  const getAllItems = async (
    path: string,
    allowNotFound = false,
    onNotFound?: () => void,
  ): Promise<Record<string, unknown>[]> => {
    const items: Record<string, unknown>[] = [];
    const seenPages = new Set<string>();
    let nextPage: string | undefined = path;
    while (nextPage) {
      if (seenPages.has(nextPage) || seenPages.size >= 100) {
        throw new BillingError(
          503,
          "revenuecat_pagination_invalid",
          "RevenueCat returned an invalid subscription page sequence.",
        );
      }
      seenPages.add(nextPage);
      const result = await getJson(nextPage, allowNotFound && seenPages.size === 1);
      if (result === undefined) {
        onNotFound?.();
        return items;
      }
      const response = asRecord(result);
      items.push(...listItems(response));
      nextPage = typeof response.next_page === "string" && response.next_page
        ? response.next_page
        : undefined;
    }
    return items;
  };
  const projectPath = `/v2/projects/${encodeURIComponent(projectId)}`;
  let customerLookupNotFound = false;
  const [projects, apps, products, customers] = await Promise.all([
    getAllItems("/v2/projects?limit=100"),
    getAllItems(`${projectPath}/apps?limit=100`),
    getAllItems(`${projectPath}/products?limit=100`),
    getAllItems(
      `${projectPath}/customers?search=${encodeURIComponent(appUserId)}&limit=100`,
      true,
      () => { customerLookupNotFound = true; },
    ),
  ]);
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    throw new BillingError(
      503,
      "revenuecat_project_mismatch",
      "RevenueCat could not confirm the configured project.",
    );
  }
  const matchingCustomers = customers.filter((item) => item.project_id === projectId);
  if (customers.length > 0 && matchingCustomers.length === 0) {
    throw new BillingError(
      503,
      "revenuecat_customer_unverified",
      "RevenueCat returned an invalid customer identity.",
    );
  }
  if (matchingCustomers.length > 1) {
    throw new BillingError(
      503,
      "revenuecat_customer_ambiguous",
      "RevenueCat returned an ambiguous customer identity.",
    );
  }
  let customer = matchingCustomers[0];
  let activeEntitlements: Record<string, unknown>[] = [];
  let subscriptions: Record<string, unknown>[] = [];
  if (customer) {
    if (typeof customer.id !== "string" || !customer.id) {
      throw new BillingError(
        503,
        "revenuecat_customer_invalid",
        "RevenueCat returned an invalid customer identity.",
      );
    }
    const customerPath = `${projectPath}/customers/${encodeURIComponent(customer.id)}`;
    const [aliases, customerEntitlements, customerSubscriptions] = await Promise.all([
      getAllItems(`${customerPath}/aliases?limit=100`),
      getAllItems(`${customerPath}/active_entitlements?limit=100`),
      getAllItems(`${customerPath}/subscriptions?limit=100`),
    ]);
    if (!aliases.some((alias) => alias.id === appUserId)) {
      throw new BillingError(
        503,
        "revenuecat_customer_unverified",
        "RevenueCat could not verify the requested customer identity.",
      );
    }
    customer = { ...customer, app_user_id: appUserId };
    activeEntitlements = customerEntitlements;
    subscriptions = customerSubscriptions;
  }
  return {
    project,
    apps,
    products,
    customer,
    ...(customerLookupNotFound ? { customerLookupNotFound: true } : {}),
    activeEntitlements,
    subscriptions,
  };
}

export async function refreshRevenueCatBillingStatus(
  libraryCode: string,
  loadSnapshot: RevenueCatSnapshotLoader = fetchRevenueCatSnapshot,
): Promise<BillingStatus> {
  if (!validUid(libraryCode)) {
    throw new BillingError(403, "not_granted", "Not allowed.");
  }
  await assertLibraryActive(libraryCode);
  const billingAccountId = await getRevenueCatAppUserId(libraryCode);
  const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode));
  await refreshRevenueCatForBillingAccount(libraryHash, billingAccountId, loadSnapshot);
  return getLibraryBillingStatus(libraryCode);
}

async function refreshRevenueCatForBillingAccount(
  libraryHash: string,
  billingAccountId: string,
  loadSnapshot: RevenueCatSnapshotLoader,
): Promise<void> {
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  if (!projectId) {
    throw new BillingError(
      503,
      "revenuecat_not_configured",
      "RevenueCat verification is not configured for this environment.",
    );
  }
  const currentLibraryHash = await resolveCurrentBillingHash(libraryHash);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${currentLibraryHash}`}, 0))`);
    const account = await getBillingAccount(tx, currentLibraryHash);
    if (!account || account.billingAccountId !== billingAccountId) {
      throw new BillingError(
        409,
        "billing_identity_changed",
        "The library billing identity changed. Please retry.",
      );
    }
    // Keep provider fetch and persistence under one per-library lock. Otherwise
    // an older, slower request could overwrite a newer RevenueCat snapshot.
    const snapshot = await loadSnapshot(billingAccountId);
    if (
      snapshot.customerLookupNotFound &&
      account.revenueCat &&
      !account.revenueCat.customerLookupNotFound
    ) {
      throw new BillingError(
        503,
        "revenuecat_customer_unavailable",
        "RevenueCat could not confirm the existing customer. Please retry.",
      );
    }
    const normalizedEntitlement = normalizeRevenueCatSubscriber(
      snapshot,
      projectId,
      billingAccountId,
    );
    const revenueCatEntitlement: RevenueCatEntitlement = {
      ...normalizedEntitlement,
      ...(snapshot.customerLookupNotFound ? { customerLookupNotFound: true } : {}),
    };
    const updatedAccount: BillingAccount = {
      ...account,
      revenueCat: revenueCatEntitlement,
    };
    await tx.insert(documents).values({
      path: billingAccountPath(currentLibraryHash),
      data: updatedAccount,
    }).onConflictDoUpdate({
      target: documents.path,
      set: { data: updatedAccount, updatedAt: new Date() },
    });
  });
}

const revenueCatUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findBillingAccountForRevenueCatId(appUserId: string): Promise<string | undefined> {
  const prefix = "private/classscribe-billing/accounts/";
  const rows = await db.select({ path: documents.path, data: documents.data })
    .from(documents)
    .where(like(documents.path, `${prefix}%`));
  const hashes = new Set<string>();
  for (const row of rows) {
    const match = row.path.match(/^private\/classscribe-billing\/accounts\/([a-f0-9]{64})$/);
    if (!match || asRecord(row.data).billingAccountId !== appUserId) continue;
    hashes.add(await resolveCurrentBillingHash(match[1]));
  }
  if (hashes.size !== 1) return undefined;
  const libraryHash = [...hashes][0];
  if (!libraryHash) return undefined;
  const account = await getBillingAccount(db, libraryHash);
  return account?.billingAccountId === appUserId ? libraryHash : undefined;
}

/**
 * RevenueCat webhook bodies are only identity hints. The provider snapshot is
 * fetched again and normalized through the same verification path as refreshes.
 * Unknown/ambiguous app user IDs are safely acknowledged without library data.
 */
export async function processRevenueCatWebhook(
  payload: unknown,
  loadSnapshot: RevenueCatSnapshotLoader = fetchRevenueCatSnapshot,
): Promise<void> {
  const root = asRecord(payload);
  const event = asRecord(root.event);
  const rawAppUserId = event.app_user_id;
  if (typeof rawAppUserId !== "string" || !revenueCatUuidPattern.test(rawAppUserId)) {
    throw new BillingError(400, "invalid_revenuecat_event", "Invalid RevenueCat webhook event.");
  }
  const appUserId = rawAppUserId.toLowerCase();
  const libraryHash = await findBillingAccountForRevenueCatId(appUserId);
  if (!libraryHash) return;
  await refreshRevenueCatForBillingAccount(libraryHash, appUserId, loadSnapshot);
}

export async function revalidateExpiredStripeEntitlement(
  libraryCode: string,
  stripeClient?: Stripe,
  force = false,
): Promise<void> {
  if (!validUid(libraryCode)) {
    throw new BillingError(403, "not_granted", "Not allowed.");
  }
  await assertLibraryActive(libraryCode);
  const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode));
  const account = await getBillingAccount(db, libraryHash);
  if (
    !account?.stripeSubscriptionId ||
    !account.stripeCustomerId ||
    (!force && (account.status !== "active" && account.status !== "trialing")) ||
    (!force && account.plan !== "student" && account.plan !== "pro")
  ) return;

  const now = Date.now();
  const stripeExpiry = account.periodEnd ? Date.parse(account.periodEnd) : Number.NaN;
  if (!force && Number.isFinite(stripeExpiry) && stripeExpiry > now) return;

  const revenueCat = account.revenueCat;
  const revenueCatExpiry = revenueCat?.periodEnd ? Date.parse(revenueCat.periodEnd) : Number.NaN;
  const revenueCatIsActive =
    revenueCat?.status === "active" &&
    (revenueCat.plan === "student" || revenueCat.plan === "pro") &&
    Number.isFinite(revenueCatExpiry) &&
    revenueCatExpiry > now;
  const tier = (plan: Plan): number => plan === "pro" ? 2 : plan === "student" ? 1 : 0;
  if (!force && revenueCatIsActive && tier(revenueCat.plan) >= tier(account.plan ?? "free")) return;

  const lastVerifiedAt = account.stripeVerifiedAt ? Date.parse(account.stripeVerifiedAt) : Number.NaN;
  if (
    !force &&
    Number.isFinite(stripeExpiry) &&
    stripeExpiry <= now &&
    Number.isFinite(lastVerifiedAt) &&
    now - lastVerifiedAt < 10_000
  ) return;

  let stripe: Stripe;
  let liveSubscription: Stripe.Subscription;
  let plan: Plan;
  try {
    stripe = stripeClient ?? await getUncachableStripeClient();
    liveSubscription = await stripe.subscriptions.retrieve(account.stripeSubscriptionId);
    const liveCustomerId = typeof liveSubscription.customer === "string"
      ? liveSubscription.customer
      : liveSubscription.customer.id;
    if (liveSubscription.id !== account.stripeSubscriptionId || liveCustomerId !== account.stripeCustomerId) {
      throw new BillingError(
        503,
        "stripe_subscription_mismatch",
        "Stripe could not verify the library subscription.",
      );
    }
    plan = await getSubscriptionPlan(stripe, liveSubscription);
  } catch (error) {
    if (error instanceof BillingError) {
      if (!force && revenueCatIsActive && error.httpStatus === 503) return;
      throw error;
    }
    if (!force && revenueCatIsActive) return;
    const code = error instanceof StripeConnectionError
      ? error.code
      : "stripe_revalidation_unavailable";
    throw new BillingError(
      503,
      code,
      "Stripe could not verify the current subscription. Please retry shortly.",
    );
  }

  const stripePeriod = verifiedStripePeriod(liveSubscription);
  const stripeVerifiedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const latest = await getBillingAccount(tx, libraryHash);
    if (
      !latest ||
      latest.stripeCustomerId !== account.stripeCustomerId ||
      latest.stripeSubscriptionId !== account.stripeSubscriptionId ||
      latest.lastStripeEventCreated !== account.lastStripeEventCreated ||
      latest.plan !== account.plan ||
      latest.status !== account.status ||
      latest.periodEnd !== account.periodEnd
    ) return;
    const updatedAccount: BillingAccount = {
      ...latest,
      plan,
      status: liveSubscription.status,
      // A missing live period must not retain a previously paid period.
      periodStart: stripePeriod.periodStart,
      periodEnd: stripePeriod.periodEnd,
      cancelAtPeriodEnd: stripePeriod.cancelAtPeriodEnd,
      stripeVerifiedAt,
    };
    await tx.insert(documents).values({
      path: billingAccountPath(libraryHash),
      data: updatedAccount,
    }).onConflictDoUpdate({
      target: documents.path,
      set: { data: updatedAccount, updatedAt: new Date() },
    });
  });
}

export async function getLibraryBillingStatus(
  libraryCode: string,
  stripeClient?: Stripe,
  forceStripeRefresh = false,
): Promise<BillingStatus> {
  if (!validUid(libraryCode)) {
    throw new BillingError(403, "not_granted", "Not allowed.");
  }
  await assertLibraryActive(libraryCode);
  await revalidateExpiredStripeEntitlement(libraryCode, stripeClient, forceStripeRefresh);
  const month = utcUsageMonth();
  return db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    await expireStaleUsageReservations(tx, libraryHash);
    const account = await getBillingAccount(tx, libraryHash);
    const { usage } = await loadUsage(tx, libraryHash, month);
    return statusForUsage(account, usage);
  });
}

export async function mergeFreeOwnerUsageIntoLibrary(
  accountId: string,
  libraryCode: string,
): Promise<void> {
  if (!validUid(libraryCode) || !accountId) {
    throw new BillingError(403, "not_granted", "Not allowed.");
  }
  const freeHash = hashLibraryCode(freeBillingIdentityForOwner(accountId));
  const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode));
  if (freeHash === libraryHash) return;
  const month = utcUsageMonth();
  const freePath = usagePath(freeHash, month);
  const linkedPath = usagePath(libraryHash, month);
  const lockKeys = [`billing:${freeHash}`, `billing:${libraryHash}`].sort();
  await db.transaction(async (tx) => {
    for (const key of lockKeys) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
    const [freeRow] = await tx.select({ data: documents.data })
      .from(documents)
      .where(eq(documents.path, freePath))
      .limit(1);
    if (!freeRow) return;
    const [linkedRow] = await tx.select({ data: documents.data })
      .from(documents)
      .where(eq(documents.path, linkedPath))
      .limit(1);
    const freeUsage = asRecord(freeRow.data);
    const linkedUsage = asRecord(linkedRow?.data);
    const seconds = Math.max(0, Number(freeUsage.seconds) || 0) +
      Math.max(0, Number(linkedUsage.seconds) || 0);
    const reservations = {
      ...asRecord(linkedUsage.reservations),
      ...asRecord(freeUsage.reservations),
    };
    const recordingCountUsed =
      Math.max(0, Number(freeUsage.recordingCountUsed) || 0) +
      Math.max(0, Number(linkedUsage.recordingCountUsed) || 0);
    const transcriptionCountUsed =
      Math.max(0, Number(freeUsage.transcriptionCountUsed) || 0) +
      Math.max(0, Number(linkedUsage.transcriptionCountUsed) || 0);
    const recordingIds = [...new Set([
      ...(Array.isArray(linkedUsage.recordingIds) ? linkedUsage.recordingIds.filter((id): id is string => typeof id === "string") : []),
      ...(Array.isArray(freeUsage.recordingIds) ? freeUsage.recordingIds.filter((id): id is string => typeof id === "string") : []),
    ])];
    const transcriptionIds = [...new Set([
      ...(Array.isArray(linkedUsage.transcriptionIds) ? linkedUsage.transcriptionIds.filter((id): id is string => typeof id === "string") : []),
      ...(Array.isArray(freeUsage.transcriptionIds) ? freeUsage.transcriptionIds.filter((id): id is string => typeof id === "string") : []),
    ])];
    const mergedRecordingCount = Array.isArray(freeUsage.recordingIds) && Array.isArray(linkedUsage.recordingIds)
      ? recordingIds.length
      : recordingCountUsed;
    const mergedTranscriptionCount = Array.isArray(freeUsage.transcriptionIds) && Array.isArray(linkedUsage.transcriptionIds)
      ? transcriptionIds.length
      : transcriptionCountUsed;
    await tx.insert(documents).values({
      path: linkedPath,
      data: {
        libraryHash, month, seconds,
        recordingCountUsed: mergedRecordingCount,
        transcriptionCountUsed: mergedTranscriptionCount,
        recordingIds, transcriptionIds, reservations,
      },
    }).onConflictDoUpdate({
      target: documents.path,
      set: {
        data: {
          libraryHash, month, seconds,
          recordingCountUsed: mergedRecordingCount,
          transcriptionCountUsed: mergedTranscriptionCount,
          recordingIds, transcriptionIds, reservations,
        },
        updatedAt: new Date(),
      },
    });
    await tx.delete(documents).where(eq(documents.path, freePath));
  });
}

const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
type UsageReservation = {
  kind: "recording" | "expired_recording" | "transcription";
  createdAt: string;
  durationSeconds?: number;
};

function normalizedCount(value: unknown): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function cleanupExpiredReservations(data: Record<string, unknown>, now = Date.now()): boolean {
  const reservations = asRecord(data.reservations);
  let changed = false;
  let seconds = Math.max(0, Number(data.seconds) || 0);
  for (const [id, raw] of Object.entries(reservations)) {
    const reservation = asRecord(raw) as UsageReservation;
    const createdAt = Date.parse(String(reservation.createdAt ?? ""));
    if (!Number.isFinite(createdAt) || now - createdAt < RESERVATION_TTL_MS) continue;
    if (reservation.kind === "transcription") {
      seconds = Math.max(0, seconds - normalizedCount(reservation.durationSeconds));
      delete reservations[id];
    } else if (reservation.kind === "recording") {
      reservations[id] = { ...reservation, kind: "expired_recording" };
    } else {
      continue;
    }
    changed = true;
  }
  if (changed) {
    data.reservations = reservations;
    data.seconds = seconds;
  }
  const asks = asRecord(data.askReservations);
  let asksChanged = false;
  for (const [fingerprint, raw] of Object.entries(asks)) {
    const createdAt = Date.parse(String(asRecord(raw).createdAt ?? ""));
    if (!Number.isFinite(createdAt) || now - createdAt < RESERVATION_TTL_MS) continue;
    delete asks[fingerprint];
    asksChanged = true;
  }
  if (asksChanged) data.askReservations = asks;
  return changed || asksChanged;
}

function statusForUsage(
  account: BillingAccount | undefined,
  usage: Record<string, unknown>,
): BillingStatus {
  const entitlement = effectiveEntitlement(account);
  const limits = planConfiguration[entitlement.plan];
  const usedSeconds = Math.max(0, Number(usage.seconds) || 0);
  return {
    plan: entitlement.plan,
    status: entitlement.status,
    billingSource: entitlement.billingSource,
    billingConflict: entitlement.billingConflict,
    ...(entitlement.renewalStatus ? { renewalStatus: entitlement.renewalStatus } : {}),
    ...(entitlement.periodEnd ? { periodEnd: entitlement.periodEnd } : {}),
    recordingHoursUsed: Math.round((usedSeconds / 3600) * 100) / 100,
    recordingHoursLimit: limits.recordingHours,
    courseLimit: limits.courseLimit,
    recordingCountUsed: normalizedCount(usage.recordingCountUsed),
    recordingCountLimit: limits.recordingCount,
    transcriptionCountUsed: normalizedCount(usage.transcriptionCountUsed),
    transcriptionCountLimit: limits.transcriptionCount,
    askCountUsed: normalizedCount(usage.askCountUsed),
    askCountLimit: entitlement.plan === "pro" ? null : entitlement.plan === "student" ? 25 : 1,
    askCountRemaining: entitlement.plan === "pro"
      ? null
      : Math.max(0, (entitlement.plan === "student" ? 25 : 1) - normalizedCount(usage.askCountUsed)),
    askResetAt: usageAskResetAt(usage.month),
    ...(typeof entitlement.cancelAtPeriodEnd === "boolean"
      ? { cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd }
      : {}),
  };
}

async function loadUsage(tx: LegacyTransaction, libraryHash: string, month: string) {
  await expireStaleUsageReservations(tx, libraryHash);
  const path = usagePath(libraryHash, month);
  const [row] = await tx.select({ data: documents.data })
    .from(documents).where(eq(documents.path, path)).limit(1);
  const usage: Record<string, unknown> = { ...asRecord(row?.data), libraryHash, month };
  const cleaned = cleanupExpiredReservations(usage);
  if (cleaned) {
    await tx.insert(documents).values({ path, data: usage }).onConflictDoUpdate({
      target: documents.path,
      set: { data: usage, updatedAt: new Date() },
    });
  }
  return { path, usage };
}

async function expireStaleUsageReservations(
  tx: LegacyTransaction,
  libraryHash: string,
): Promise<void> {
  const prefix = `private/classscribe-billing/usage/${libraryHash}/`;
  const rows = await tx.select({ path: documents.path, data: documents.data })
    .from(documents).where(like(documents.path, `${prefix}%`));
  for (const row of rows) {
    const usage: Record<string, unknown> = { ...asRecord(row.data) };
    if (!cleanupExpiredReservations(usage)) continue;
    await saveUsage(tx, row.path, usage);
  }
}

async function saveUsage(
  tx: LegacyTransaction,
  path: string,
  usage: Record<string, unknown>,
): Promise<void> {
  await tx.insert(documents).values({ path, data: usage }).onConflictDoUpdate({
    target: documents.path,
    set: { data: usage, updatedAt: new Date() },
  });
}

export type AskUsageReservation =
  | { allowed: true; month: string; alreadyCounted: boolean; reservationToken?: string; requiresCredits?: boolean }
  | {
      allowed: false;
      status: BillingStatus;
      limit: "askCount" | "plan" | "inProgress" | "continuation" | "roundLimit";
    };

function askUsageKey(askId: string, firstQuestion: string): {
  key: string;
  requestHash: string;
  fingerprint: string;
} {
  const requestHash = createHash("sha256").update(askId).digest("hex");
  const fingerprint = createHash("sha256").update(firstQuestion.trim().normalize("NFC")).digest("hex");
  return {
    key: createHash("sha256").update(`${requestHash}:${fingerprint}`).digest("hex"),
    requestHash,
    fingerprint,
  };
}

export async function reserveAskUsage(
  libraryCode: string,
  askId: string,
  firstQuestion: string,
  toolResultIds: string[] = [],
  useCredits = false,
): Promise<AskUsageReservation> {
  if (!validUid(libraryCode)) throw new BillingError(403, "not_granted", "Not allowed.");
  await assertLibraryActive(libraryCode);
  await revalidateExpiredStripeEntitlement(libraryCode);
  const month = utcUsageMonth();
  const { key: askKey, requestHash, fingerprint } = askUsageKey(askId, firstQuestion);
  const reservationToken = randomUUID();
  return db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const [revoked] = await tx.select({ path: documents.path })
      .from(documents).where(eq(documents.path, revokedPath(libraryCode))).limit(1);
    if (revoked) throw new BillingError(403, "not_granted", "This sync code has been replaced.");
    const account = await getBillingAccount(tx, libraryHash);
    const plan = effectiveEntitlement(account).plan;
    const { path, usage } = await loadUsage(tx, libraryHash, month);
    const status = statusForUsage(account, usage);
    const completed = asRecord(usage.askFingerprints);
    const pending = asRecord(usage.askReservations);
    if (pending[askKey] !== undefined) {
      return { allowed: false, status, limit: "inProgress" };
    }
    const previous = asRecord(completed[askKey]);
    const isContinuation = completed[askKey] !== undefined;
    if (isContinuation) {
      if (previous.final !== false) {
        return { allowed: false, status, limit: "continuation" };
      }
      if (normalizedCount(previous.rounds) >= 8) {
        return { allowed: false, status, limit: "roundLimit" };
      }
      const expected = Array.isArray(previous.expectedToolUseIds)
        ? previous.expectedToolUseIds.filter((id): id is string => typeof id === "string")
        : [];
      const provided = [...new Set(toolResultIds)];
      const issued = Array.isArray(previous.issuedToolUseIds)
        ? previous.issuedToolUseIds.filter((id): id is string => typeof id === "string")
        : expected;
      if (
        !expected.length ||
        expected.some((id) => !provided.includes(id)) ||
        provided.some((id) => !issued.includes(id))
      ) {
        return { allowed: false, status, limit: "continuation" };
      }
    } else if (plan === "student" || plan === "free") {
      const pendingCount = Object.values(pending)
        .filter((value) => asRecord(value).isNewAsk !== false).length;
      if (normalizedCount(usage.askCountUsed) + pendingCount >= (plan === "free" ? 1 : 25)) {
        return { allowed: false, status, limit: "askCount" };
      }
    }
    if (plan === "free" && !useCredits) return { allowed: false, status, limit: "plan" };
    pending[askKey] = {
      requestHash,
      fingerprint,
      reservationToken,
      isNewAsk: !isContinuation,
      freeCreditQuestion: plan === "free",
      round: isContinuation ? normalizedCount(previous.rounds) + 1 : 1,
      createdAt: new Date().toISOString(),
    };
    usage.askReservations = pending;
    await saveUsage(tx, path, usage);
    return { allowed: true, month, alreadyCounted: isContinuation, reservationToken, requiresCredits: plan === "free" };
  });
}

export async function finishAskUsage(
  libraryCode: string,
  askId: string,
  firstQuestion: string,
  reservationToken: string,
  stopReason: string,
  toolUseIds: string[],
  month = utcUsageMonth(),
): Promise<void> {
  if (stopReason === "tool_use" && (
    !toolUseIds.length ||
    toolUseIds.some((id) => !id) ||
    new Set(toolUseIds).size !== toolUseIds.length
  )) {
    throw new Error("AI provider returned an invalid tool-use continuation.");
  }
  const { key: askKey } = askUsageKey(askId, firstQuestion);
  await db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const { path, usage } = await loadUsage(tx, libraryHash, month);
    const pending = asRecord(usage.askReservations);
    const reservation = asRecord(pending[askKey]);
    if (reservation.reservationToken !== reservationToken) return;
    delete pending[askKey];
    const completed = asRecord(usage.askFingerprints);
    const isNewAsk = reservation.isNewAsk !== false;
    const previous = asRecord(completed[askKey]);
    const previousIssued = Array.isArray(previous.issuedToolUseIds)
      ? previous.issuedToolUseIds.filter((id): id is string => typeof id === "string")
      : [];
    if (isNewAsk) {
      usage.askCountUsed = normalizedCount(usage.askCountUsed) + 1;
    }
    completed[askKey] = {
      requestHash: reservation.requestHash,
      fingerprint: reservation.fingerprint,
      freeCreditQuestion: reservation.freeCreditQuestion === true,
      rounds: isNewAsk ? 1 : normalizedCount(previous.rounds) + 1,
      final: stopReason !== "tool_use",
      expectedToolUseIds: stopReason === "tool_use" ? toolUseIds : [],
      issuedToolUseIds: [...new Set([...previousIssued, ...toolUseIds])],
      completedAt: new Date().toISOString(),
    };
    usage.askReservations = pending;
    usage.askFingerprints = completed;
    await saveUsage(tx, path, usage);
  });
}

export async function releaseAskUsage(
  libraryCode: string,
  askId: string,
  firstQuestion: string,
  reservationToken: string,
  month = utcUsageMonth(),
  refundFreeQuestion = false,
): Promise<void> {
  const { key: askKey } = askUsageKey(askId, firstQuestion);
  await db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const { path, usage } = await loadUsage(tx, libraryHash, month);
    const pending = asRecord(usage.askReservations);
    const completed = asRecord(usage.askFingerprints);
    // A refunded Free question must not consume the sole monthly slot.
    if (refundFreeQuestion && asRecord(completed[askKey]).freeCreditQuestion === true) {
      delete completed[askKey];
      usage.askFingerprints = completed;
      usage.askCountUsed = Math.max(0, normalizedCount(usage.askCountUsed) - 1);
    } else if (asRecord(pending[askKey]).reservationToken !== reservationToken) return;
    delete pending[askKey];
    usage.askReservations = pending;
    await saveUsage(tx, path, usage);
  });
}

export async function reserveRecordingCount(
  libraryCode: string,
  recordingId: string,
  allowOverage = false,
): Promise<{ allowed: true; status: BillingStatus; overage?: boolean } | { allowed: false; status: BillingStatus }> {
  if (!validUid(libraryCode)) throw new BillingError(403, "not_granted", "Not allowed.");
  await assertLibraryActive(libraryCode);
  await revalidateExpiredStripeEntitlement(libraryCode);
  const month = utcUsageMonth();
  return db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const [revoked] = await tx.select({ path: documents.path })
      .from(documents).where(eq(documents.path, revokedPath(libraryCode))).limit(1);
    if (revoked) throw new BillingError(403, "not_granted", "This sync code has been replaced.");
    const account = await getBillingAccount(tx, libraryHash);
    const { path, usage } = await loadUsage(tx, libraryHash, month);
    const reservationId = `recording:${recordingId}`;
    const reservations = asRecord(usage.reservations);
    const existing = asRecord(reservations[reservationId]);
    const recorded = normalizedCount(usage.recordingCountUsed);
    if (existing.kind === "recording" ||
      (Array.isArray(usage.recordingIds) && usage.recordingIds.includes(recordingId))) {
      return { allowed: true, status: statusForUsage(account, usage) };
    }
    const plan = effectiveEntitlement(account).plan;
    const pending = Object.values(reservations).filter((item) => asRecord(item).kind === "recording").length;
    const status = statusForUsage(account, usage);
    const overage = recorded + pending >= planConfiguration[plan].recordingCount;
    if (overage && !allowOverage) {
      return { allowed: false, status };
    }
    reservations[reservationId] = { kind: "recording", createdAt: new Date().toISOString() } satisfies UsageReservation;
    usage.reservations = reservations;
    await saveUsage(tx, path, usage);
    return { allowed: true, status, ...(overage ? { overage: true } : {}) };
  });
}

export async function finishRecordingCount(
  libraryCode: string,
  recordingId: string,
): Promise<{ finished: true; status: BillingStatus } | {
  finished: false;
  status: BillingStatus;
  limitReached?: boolean;
}> {
  if (!validUid(libraryCode)) throw new BillingError(403, "not_granted", "Not allowed.");
  await assertLibraryActive(libraryCode);
  const month = utcUsageMonth();
  return db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const account = await getBillingAccount(tx, libraryHash);
    await expireStaleUsageReservations(tx, libraryHash);
    const prefix = `private/classscribe-billing/usage/${libraryHash}/`;
    const rows = await tx.select({ path: documents.path, data: documents.data })
      .from(documents).where(like(documents.path, `${prefix}%`));
    const reservationId = `recording:${recordingId}`;
    const matched = rows.find((row) => {
      const data = asRecord(row.data);
      return asRecord(data.reservations)[reservationId] !== undefined ||
        (Array.isArray(data.recordingIds) && data.recordingIds.includes(recordingId));
    });
    const targetMonth = matched?.path.slice(prefix.length) ?? month;
    const { path, usage } = await loadUsage(tx, libraryHash, targetMonth);
    const reservations = asRecord(usage.reservations);
    const reservation = asRecord(reservations[reservationId]);
    const completedIds = Array.isArray(usage.recordingIds) ? usage.recordingIds.filter((id): id is string => typeof id === "string") : [];
    if (completedIds.includes(recordingId)) {
      return { finished: true, status: statusForUsage(account, usage) };
    }
    if (reservation.kind !== "recording" && reservation.kind !== "expired_recording") {
      return { finished: false, status: statusForUsage(account, usage) };
    }
    if (reservation.kind === "expired_recording") {
      const plan = effectiveEntitlement(account).plan;
      const pending = Object.values(reservations)
        .filter((item) => asRecord(item).kind === "recording").length;
      if (normalizedCount(usage.recordingCountUsed) + pending >= planConfiguration[plan].recordingCount) {
        return { finished: false, status: statusForUsage(account, usage), limitReached: true };
      }
    }
    delete reservations[reservationId];
    completedIds.push(recordingId);
    usage.reservations = reservations;
    usage.recordingIds = completedIds;
    usage.recordingCountUsed = normalizedCount(usage.recordingCountUsed) + 1;
    await saveUsage(tx, path, usage);
    return { finished: true, status: statusForUsage(account, usage) };
  });
}

export async function releaseRecordingCount(
  libraryCode: string,
  recordingId: string,
): Promise<boolean> {
  if (!validUid(libraryCode)) throw new BillingError(403, "not_granted", "Not allowed.");
  await assertLibraryActive(libraryCode);
  return db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const reservationId = `recording:${recordingId}`;
    await expireStaleUsageReservations(tx, libraryHash);
    const prefix = `private/classscribe-billing/usage/${libraryHash}/`;
    const rows = await tx.select({ path: documents.path, data: documents.data })
      .from(documents).where(like(documents.path, `${prefix}%`));
    const matched = rows.find((row) =>
      asRecord(asRecord(row.data).reservations)[reservationId] !== undefined,
    );
    if (!matched) return false;
    const targetMonth = matched.path.slice(prefix.length);
    const { path, usage } = await loadUsage(tx, libraryHash, targetMonth);
    const reservations = asRecord(usage.reservations);
    const kind = asRecord(reservations[reservationId]).kind;
    if (kind !== "recording" && kind !== "expired_recording") return false;
    delete reservations[reservationId];
    usage.reservations = reservations;
    await saveUsage(tx, path, usage);
    return true;
  });
}

export async function reserveTranscriptionUsage(
  libraryCode: string,
  durationSeconds: number,
  transcriptionId: string,
  allowOverage = false,
): Promise<
  | { allowed: true; month: string; alreadyCompleted: boolean; overageSeconds?: number }
  | { allowed: false; status: BillingStatus; limit: "transcriptionCount" | "recordingHours" | "inProgress"; overageSeconds?: number }
> {
  if (!validUid(libraryCode)) throw new BillingError(403, "not_granted", "Not allowed.");
  await assertLibraryActive(libraryCode);
  await revalidateExpiredStripeEntitlement(libraryCode);
  const month = utcUsageMonth();
  return db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const account = await getBillingAccount(tx, libraryHash);
    const { path, usage } = await loadUsage(tx, libraryHash, month);
    const reservationId = `transcription:${transcriptionId}`;
    const reservations = asRecord(usage.reservations);
    const reservation = asRecord(reservations[reservationId]);
    const status = statusForUsage(account, usage);
    if (reservation.kind === "transcription") {
      return { allowed: false, status, limit: "inProgress" };
    }
    const plan = effectiveEntitlement(account).plan;
    const completedCount = normalizedCount(usage.transcriptionCountUsed);
    if (Array.isArray(usage.transcriptionIds) && usage.transcriptionIds.includes(transcriptionId)) {
      return { allowed: true, month, alreadyCompleted: true };
    }
    const pendingCount = Object.values(reservations).filter((item) => asRecord(item).kind === "transcription").length;
    const seconds = Math.max(0, Number(usage.seconds) || 0);
    const countOverage = completedCount + pendingCount >= planConfiguration[plan].transcriptionCount;
    // Paid plans' successful-transcription caps are included allowances, not a free
    // bypass or a dead end: a confirmed credit action pays for the whole attempt.
    const paidCountOverage = plan === "student" || plan === "pro";
    if (countOverage && (!paidCountOverage || !allowOverage))
      return { allowed: false, status, limit: "transcriptionCount",
        ...(paidCountOverage ? { overageSeconds: durationSeconds } : {}) };
    const includedSeconds = planConfiguration[plan].recordingHours * 3600;
    // Charge only this attempt's extra time, never previously paid overage.
    // When both caps are exhausted, charge the duration once, not twice.
    const overageSeconds = countOverage ? durationSeconds :
      Math.max(0, seconds + durationSeconds - includedSeconds) - Math.max(0, seconds - includedSeconds);
    if (overageSeconds > 0 && !allowOverage)
      return { allowed: false, status, limit: "recordingHours", overageSeconds };
    reservations[reservationId] = {
      kind: "transcription",
      createdAt: new Date().toISOString(),
      durationSeconds,
    } satisfies UsageReservation;
    usage.reservations = reservations;
    usage.seconds = seconds + durationSeconds;
    await saveUsage(tx, path, usage);
    return {
      allowed: true,
      month,
      alreadyCompleted: false,
      ...(overageSeconds > 0 ? { overageSeconds } : {}),
    };
  });
}

export async function finishTranscriptionUsage(
  libraryCode: string,
  transcriptionId: string,
  month = utcUsageMonth(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const { path, usage } = await loadUsage(tx, libraryHash, month);
    const reservations = asRecord(usage.reservations);
    const reservationId = `transcription:${transcriptionId}`;
    if (asRecord(reservations[reservationId]).kind !== "transcription") return;
    delete reservations[reservationId];
    const completedIds = Array.isArray(usage.transcriptionIds)
      ? usage.transcriptionIds.filter((id): id is string => typeof id === "string")
      : [];
    if (!completedIds.includes(transcriptionId)) {
      completedIds.push(transcriptionId);
      usage.transcriptionCountUsed = normalizedCount(usage.transcriptionCountUsed) + 1;
    }
    usage.transcriptionIds = completedIds;
    usage.reservations = reservations;
    await saveUsage(tx, path, usage);
  });
}

export async function releaseTranscriptionUsage(
  libraryCode: string,
  transcriptionId: string,
  month = utcUsageMonth(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const { path, usage } = await loadUsage(tx, libraryHash, month);
    const reservations = asRecord(usage.reservations);
    const reservationId = `transcription:${transcriptionId}`;
    const reservation = asRecord(reservations[reservationId]);
    if (reservation.kind !== "transcription") return;
    delete reservations[reservationId];
    usage.reservations = reservations;
    usage.seconds = Math.max(0, (Number(usage.seconds) || 0) - normalizedCount(reservation.durationSeconds));
    await saveUsage(tx, path, usage);
  });
}

export async function reserveRecordingUsage(
  libraryCode: string,
  durationSeconds: number,
): Promise<{ allowed: true; month: string } | { allowed: false; status: BillingStatus }> {
  await revalidateExpiredStripeEntitlement(libraryCode);
  const month = utcUsageMonth();
  return db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const [revoked] = await tx.select({ path: documents.path })
      .from(documents)
      .where(eq(documents.path, revokedPath(libraryCode)))
      .limit(1);
    if (revoked) {
      throw new BillingError(403, "not_granted", "This sync code has been replaced.");
    }
    const account = await getBillingAccount(tx, libraryHash);
    const plan = effectiveEntitlement(account).plan;
    const limitSeconds = planConfiguration[plan].recordingHours * 3600;
    const path = usagePath(libraryHash, month);
    const { usage } = await loadUsage(tx, libraryHash, month);
    const currentSeconds = Math.max(0, Number(usage.seconds) || 0);
    if (currentSeconds + durationSeconds > limitSeconds) {
      return {
        allowed: false,
        status: statusForUsage(account, usage),
      };
    }
    usage.seconds = currentSeconds + durationSeconds;
    await saveUsage(tx, path, usage);
    return { allowed: true, month };
  });
}

export async function releaseRecordingUsage(
  libraryCode: string,
  durationSeconds: number,
  month = utcUsageMonth(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const path = usagePath(libraryHash, month);
    const { usage } = await loadUsage(tx, libraryHash, month);
    usage.seconds = Math.max(0, (Number(usage.seconds) || 0) - durationSeconds);
    await saveUsage(tx, path, usage);
  });
}

export async function enforceLegacyCourseLimit(
  tx: LegacyTransaction,
  libraryCode: string,
  courseDocumentPath: string,
): Promise<boolean> {
  const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode), tx);
  const account = await getBillingAccount(tx, libraryHash);
  const plan = effectiveEntitlement(account).plan;
  const courseLimit = planConfiguration[plan].courseLimit;
  if (courseLimit === null) return true;

  const [existing] = await tx.select({ path: documents.path })
    .from(documents)
    .where(eq(documents.path, courseDocumentPath))
    .limit(1);
  if (existing) return true;
  const prefix = `data/users/${libraryCode}/lib/courses/`;
  const rows = await tx.select({ path: documents.path })
    .from(documents)
    .where(and(like(documents.path, `${prefix}%`), sql`length(${documents.path}) > ${prefix.length}`))
    .limit(courseLimit + 1);
  return rows.length < courseLimit;
}

async function findMonthlyPrice(
  stripe: Stripe,
  plan: PaidPlan,
): Promise<Stripe.Price> {
  const products = await stripe.products.list({ active: true, limit: 100 });
  const product = products.data.find((item) =>
    item.metadata.classscribe_plan === plan,
  );
  if (!product) {
    throw new BillingError(
      503,
      "billing_not_configured",
      `The ${plan === "student" ? "Student" : "Pro"} subscription price is not set up in Stripe.`,
    );
  }
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const amount = plan === "student" ? 799 : 1299;
  const price = prices.data.find((item) =>
    item.currency === "usd" &&
    item.unit_amount === amount &&
    item.recurring?.interval === "month" &&
    item.metadata.classscribe_plan === plan,
  );
  if (!price) {
    throw new BillingError(
      503,
      "billing_not_configured",
      `The ${plan === "student" ? "Student" : "Pro"} monthly price is not set up in Stripe.`,
    );
  }
  return price;
}

async function findUniqueMonthlyPrice(
  stripe: Stripe,
  plan: PaidPlan,
): Promise<Stripe.Price | undefined> {
  const products = await stripe.products.list({ active: true, limit: 100 });
  const candidates = products.data.filter((product) =>
    product.metadata.classscribe_plan === plan,
  );
  if (candidates.length !== 1) return undefined;
  const prices = await stripe.prices.list({
    product: candidates[0]!.id,
    active: true,
    limit: 100,
  });
  const amount = plan === "student" ? 799 : 1299;
  const matches = prices.data.filter((price) =>
    price.currency === "usd" &&
    price.unit_amount === amount &&
    price.recurring?.interval === "month" &&
    price.metadata.classscribe_plan === plan,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function applicationOrigin(returnUrl?: unknown): { origin: string; returnUrl: string } {
  const publicDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!publicDomain) {
    throw new BillingError(
      503,
      "billing_not_configured",
      "A public ClassScribe domain is required to start Stripe checkout.",
    );
  }
  const origin = new URL(`https://${publicDomain}`).origin;
  const allowedOrigins = new Set([origin]);
  const expoPreviewDomain = process.env.REPLIT_EXPO_DEV_DOMAIN?.trim();
  if (expoPreviewDomain) {
    // This value is injected by Replit for the active Expo preview. Accept a
    // bare DNS name only; do not let a URL/path in the environment expand the
    // return-URL allowlist to an arbitrary origin.
    const isDnsName = expoPreviewDomain.length <= 253 &&
      expoPreviewDomain.split(".").every((label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label),
      );
    if (isDnsName) allowedOrigins.add(`https://${expoPreviewDomain.toLowerCase()}`);
  }
  const requested = typeof returnUrl === "string" && returnUrl
    ? returnUrl
    : "/";
  let resolved: URL;
  try {
    resolved = new URL(requested, origin);
  } catch {
    throw new BillingError(400, "invalid_argument", "Invalid billing return URL.");
  }
  if (!allowedOrigins.has(resolved.origin)) {
    throw new BillingError(400, "invalid_argument", "Billing return URL must stay on ClassScribe.");
  }
  return { origin, returnUrl: resolved.toString() };
}

async function getOrCreateCustomer(
  stripe: Stripe,
  libraryCode: string,
  libraryHash: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const [revoked] = await tx.select({ path: documents.path })
      .from(documents)
      .where(eq(documents.path, revokedPath(libraryCode)))
      .limit(1);
    if (revoked) {
      throw new BillingError(403, "not_granted", "This sync code has been replaced.");
    }
    const existing = await getBillingAccount(tx, libraryHash);
    if (existing?.stripeCustomerId) {
      if (!existing.billingAccountId) {
        const updatedAccount = { ...existing, billingAccountId: randomUUID() };
        await tx.insert(documents).values({
          path: billingAccountPath(libraryHash),
          data: updatedAccount,
        }).onConflictDoUpdate({
          target: documents.path,
          set: { data: updatedAccount, updatedAt: new Date() },
        });
      }
      return existing.stripeCustomerId;
    }

    const customer = await stripe.customers.create(
      { metadata: { classscribe_library_hash: libraryHash } },
      { idempotencyKey: `classscribe-customer-${libraryHash}` },
    );
    await tx.insert(documents).values({
      path: billingAccountPath(libraryHash),
      data: {
        libraryHash,
        billingAccountId: existing?.billingAccountId ?? randomUUID(),
        stripeCustomerId: customer.id,
        plan: existing?.plan ?? "free",
        status: existing?.status ?? "inactive",
      },
    }).onConflictDoUpdate({
      target: documents.path,
      set: {
        data: {
          ...existing,
          libraryHash,
          stripeCustomerId: customer.id,
        },
        updatedAt: new Date(),
      },
    });
    return customer.id;
  });
}

export async function createLibraryCheckoutWithStripe(
  libraryCode: string,
  requestedPlan: unknown,
  requestedReturnUrl?: unknown,
  stripeClient?: Stripe,
  loadRevenueCatSnapshot: RevenueCatSnapshotLoader = fetchRevenueCatSnapshot,
): Promise<{ url: string }> {
  if (!validUid(libraryCode)) {
    throw new BillingError(403, "not_granted", "Not allowed.");
  }
  if (requestedPlan !== "student" && requestedPlan !== "pro") {
    throw new BillingError(400, "invalid_argument", "Choose the Student or Pro plan.");
  }
  await assertLibraryActive(libraryCode);
  await revalidateExpiredStripeEntitlement(libraryCode, stripeClient);
  const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode));
  const { returnUrl: requestedReturn } = applicationOrigin(requestedReturnUrl);
  const stripe = stripeClient ?? await getUncachableStripeClient();
  const price = await findMonthlyPrice(stripe, requestedPlan);
  const customerId = await getOrCreateCustomer(stripe, libraryCode, libraryHash);
  const billingAccountId = await getRevenueCatAppUserId(libraryCode);
  const revenueCatLibraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode));
  await refreshRevenueCatForBillingAccount(
    revenueCatLibraryHash,
    billingAccountId,
    loadRevenueCatSnapshot,
  );
  // The transaction below rechecks this just-fetched state under the same
  // per-library lock before reserving or creating a Stripe checkout session.
  const attempt = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const [revoked] = await tx.select({ path: documents.path })
      .from(documents)
      .where(eq(documents.path, revokedPath(libraryCode)))
      .limit(1);
    if (revoked) throw new BillingError(403, "not_granted", "This sync code has been replaced.");
    const account = await getBillingAccount(tx, libraryHash);
    if (effectiveEntitlement(account).plan !== "free") {
      throw new BillingError(
        409,
        "already_subscribed",
        "This library already has an active plan. Use Manage billing to change or cancel it.",
      );
    }
    if (
      account?.pendingCheckoutPlan &&
      account.pendingCheckoutPlan !== requestedPlan
    ) {
      throw new BillingError(
        409,
        "checkout_in_progress",
        "This library already has a checkout in progress. Finish or cancel it before choosing another plan.",
      );
    }

    let expiredCheckout = false;
    if (account?.pendingCheckoutSessionId) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(
          account.pendingCheckoutSessionId,
        );
        if (existingSession.status === "open" && existingSession.url) {
          return { session: existingSession, account, attemptId: account.pendingCheckoutAttemptId };
        }
        if (existingSession.status === "complete") {
          throw new BillingError(
            409,
            "checkout_processing",
            "Checkout is complete and the plan is being verified. Refresh billing status before starting another checkout.",
          );
        }
        if (existingSession.status === "expired") expiredCheckout = true;
      } catch (error) {
        if (error instanceof BillingError) throw error;
        if (error instanceof Stripe.errors.StripeAPIError && error.statusCode === 404) {
          expiredCheckout = true;
        } else {
          throw new BillingError(
            503,
            "billing_unavailable",
            "Could not verify the existing Stripe checkout. Please retry shortly.",
          );
        }
      }
    }

    let pendingAttemptId = account?.pendingCheckoutAttemptId;
    let pendingPlan = account?.pendingCheckoutPlan;
    let pendingPriceId = account?.pendingCheckoutPriceId;
    let pendingReturnUrl = account?.pendingCheckoutReturnUrl;
    const createdAt = account?.pendingCheckoutCreatedAt
      ? Date.parse(account.pendingCheckoutCreatedAt)
      : Number.NaN;

    if (!expiredCheckout && pendingAttemptId && pendingPlan && pendingPriceId && pendingReturnUrl) {
      if (pendingPlan !== requestedPlan) {
        throw new BillingError(
          409,
          "checkout_in_progress",
          "This library already has a checkout in progress. Finish or cancel it before choosing another plan.",
        );
      }
      if (Number.isFinite(createdAt) && Date.now() - createdAt < 23 * 60 * 60 * 1000) {
        const sessions = await stripe.checkout.sessions.list({
          customer: customerId,
          status: "open",
          limit: 100,
        });
        const recoveredSession = sessions.data.find((session) =>
          session.metadata?.classscribe_library_hash === libraryHash &&
          session.metadata?.classscribe_plan === pendingPlan,
        );
        if (recoveredSession?.url) {
          const recoveredAccount = {
            ...account,
            libraryHash,
            stripeCustomerId: customerId,
            pendingCheckoutSessionId: recoveredSession.id,
          };
          await tx.insert(documents).values({
            path: billingAccountPath(libraryHash),
            data: recoveredAccount,
          }).onConflictDoUpdate({
            target: documents.path,
            set: { data: recoveredAccount, updatedAt: new Date() },
          });
          return { session: recoveredSession, account: recoveredAccount, attemptId: pendingAttemptId };
        }
        return {
          create: true as const,
          attemptId: pendingAttemptId,
          plan: pendingPlan,
          priceId: pendingPriceId,
          returnUrl: pendingReturnUrl,
        };
      }
    }

    pendingAttemptId = randomUUID();
    pendingPlan = requestedPlan;
    pendingPriceId = price.id;
    pendingReturnUrl = requestedReturn;
    const pendingAccount: BillingAccount = {
      ...account,
      libraryHash,
      stripeCustomerId: customerId,
      pendingCheckoutAttemptId: pendingAttemptId,
      pendingCheckoutPlan: pendingPlan,
      pendingCheckoutPriceId: pendingPriceId,
      pendingCheckoutReturnUrl: pendingReturnUrl,
      pendingCheckoutCreatedAt: new Date().toISOString(),
      pendingCheckoutSessionId: undefined,
    };
    await tx.insert(documents).values({
      path: billingAccountPath(libraryHash),
      data: pendingAccount,
    }).onConflictDoUpdate({
      target: documents.path,
      set: { data: pendingAccount, updatedAt: new Date() },
    });
    return {
      create: true as const,
      attemptId: pendingAttemptId,
      plan: pendingPlan,
      priceId: pendingPriceId,
      returnUrl: pendingReturnUrl,
    };
  });
  if ("session" in attempt) {
    if (!attempt.session?.url) {
      throw new BillingError(503, "billing_unavailable", "Stripe did not return a checkout URL.");
    }
    return { url: attempt.session.url };
  }

  const success = new URL(attempt.returnUrl);
  success.searchParams.set("billing", "success");
  success.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  const cancel = new URL(attempt.returnUrl);
  cancel.searchParams.set("billing", "cancel");
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: attempt.priceId, quantity: 1 }],
        success_url: success.toString(),
        cancel_url: cancel.toString(),
        client_reference_id: libraryHash,
        metadata: {
          classscribe_library_hash: libraryHash,
          classscribe_plan: attempt.plan,
        },
        subscription_data: {
          metadata: {
            classscribe_library_hash: libraryHash,
            classscribe_plan: attempt.plan,
          },
        },
      },
      { idempotencyKey: `classscribe-checkout-${libraryHash}-${attempt.attemptId}` },
    );
  } catch {
    throw new BillingError(
      503,
      "billing_unavailable",
      "Stripe could not start checkout. Retry shortly; an existing checkout will be reused if one was created.",
    );
  }
  if (!session.url) {
    throw new BillingError(503, "billing_unavailable", "Stripe did not return a checkout URL.");
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const account = await getBillingAccount(tx, libraryHash);
    if (account?.pendingCheckoutAttemptId !== attempt.attemptId) return;
    const updatedAccount = { ...account, pendingCheckoutSessionId: session.id };
    await tx.insert(documents).values({
      path: billingAccountPath(libraryHash),
      data: updatedAccount,
    }).onConflictDoUpdate({
      target: documents.path,
      set: { data: updatedAccount, updatedAt: new Date() },
    });
  });
  return { url: session.url };
}

export async function createLibraryCheckout(
  libraryCode: string,
  requestedPlan: unknown,
  requestedReturnUrl?: unknown,
): Promise<{ url: string }> {
  if (!stripeSyncReady) {
    throw new BillingError(
      503,
      "billing_not_configured",
      "Stripe checkout is unavailable until its signed webhook and data sync are configured.",
    );
  }
  return createLibraryCheckoutWithStripe(libraryCode, requestedPlan, requestedReturnUrl);
}

export async function createLibraryPortalSession(
  libraryCode: string,
  requestedReturnUrl?: unknown,
): Promise<{ url: string }> {
  if (!stripeSyncReady) {
    throw new BillingError(
      503,
      "billing_not_configured",
      "Stripe billing management is unavailable until its signed webhook and data sync are configured.",
    );
  }
  if (!validUid(libraryCode)) {
    throw new BillingError(403, "not_granted", "Not allowed.");
  }
  await assertLibraryActive(libraryCode);
  const libraryHash = await resolveCurrentBillingHash(hashLibraryCode(libraryCode));
  const account = await getBillingAccount(db, libraryHash);
  if (
    !account?.stripeCustomerId ||
    !account.stripeSubscriptionId ||
    effectiveEntitlement(account).billingSource !== "web"
  ) {
    throw new BillingError(
      404,
      "billing_not_found",
      "This library has no active web-owned Stripe subscription to manage.",
    );
  }
  const { returnUrl } = applicationOrigin(requestedReturnUrl);
  const stripe = await getUncachableStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

function isLibraryHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function getLiveSubscription(
  stripe: Stripe,
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId);
}

async function identifyInvoiceLibrary(
  stripe: Stripe,
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): Promise<{ libraryHash: string; account?: BillingAccount } | undefined> {
  const customerId = typeof customer === "string" ? customer : customer?.id;
  if (!customerId) return undefined;
  const stripeCustomer = typeof customer === "string"
    ? await stripe.customers.retrieve(customerId)
    : customer;
  if (!stripeCustomer) return undefined;
  if ("deleted" in stripeCustomer && stripeCustomer.deleted) return undefined;
  const libraryHash = stripeCustomer.metadata.classscribe_library_hash;
  if (!isLibraryHash(libraryHash)) return undefined;
  const currentLibraryHash = await resolveCurrentBillingHash(libraryHash);
  return { libraryHash: currentLibraryHash, account: await getBillingAccount(db, currentLibraryHash) };
}

async function getSubscriptionPlan(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<Plan> {
  const status = subscription.status;
  const item = subscription.items.data.length === 1 ? subscription.items.data[0] : undefined;
  if (status !== "active" && status !== "trialing") return "free";
  if (!item) {
    throw new BillingError(
      503,
      "stripe_price_unrecognized",
      "Stripe could not verify the active subscription price.",
    );
  }
  const productId = typeof item.price.product === "string"
    ? item.price.product
    : item.price.product.id;
  const product = await stripe.products.retrieve(productId);
  const candidate = product.metadata.classscribe_plan;
  const expectedAmount = candidate === "student" ? 799 : candidate === "pro" ? 1299 : null;
  if (
    (candidate === "student" || candidate === "pro") &&
    item.price.currency === "usd" &&
    item.price.unit_amount === expectedAmount &&
    item.price.recurring?.interval === "month"
  ) {
    return candidate;
  }
  throw new BillingError(
    503,
    "stripe_price_unrecognized",
    "Stripe could not verify the active subscription price.",
  );
}

function verifiedStripePeriod(subscription: Stripe.Subscription): {
  periodStart?: string;
  periodEnd?: string;
  cancelAtPeriodEnd: boolean;
} {
  const currentItem = subscription.items.data[0];
  const periodStart = currentItem?.current_period_start
    ? currentItem.current_period_start * 1000
    : undefined;
  const itemPeriodEnd = currentItem?.current_period_end
    ? currentItem.current_period_end * 1000
    : undefined;
  const cancelAt = typeof subscription.cancel_at === "number" &&
    Number.isFinite(subscription.cancel_at)
      ? subscription.cancel_at * 1000
      : undefined;
  const cancellationScheduledByPeriodEnd =
    cancelAt !== undefined &&
    itemPeriodEnd !== undefined &&
    cancelAt <= itemPeriodEnd;
  const periodEnd = cancellationScheduledByPeriodEnd
    ? Math.min(cancelAt, itemPeriodEnd)
    : itemPeriodEnd;
  return {
    ...(periodStart !== undefined ? { periodStart: new Date(periodStart).toISOString() } : {}),
    ...(periodEnd !== undefined ? { periodEnd: new Date(periodEnd).toISOString() } : {}),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true ||
      cancellationScheduledByPeriodEnd,
  };
}

function stripeObjectId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const id = asRecord(value).id;
  return typeof id === "string" ? id : undefined;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const legacyId = stripeObjectId(asRecord(invoice).subscription);
  if (legacyId) return legacyId;
  const parent = asRecord(invoice.parent);
  return stripeObjectId(asRecord(parent.subscription_details).subscription);
}

function invoicePaymentObjectId(payment: Stripe.InvoicePayment): string | undefined {
  return stripeObjectId(payment.payment.payment_intent) ??
    stripeObjectId(payment.payment.charge);
}

async function invoicePaymentId(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<string | undefined> {
  const legacyPaymentIntent = stripeObjectId(asRecord(invoice).payment_intent);
  if (legacyPaymentIntent) return legacyPaymentIntent;
  const payments = await stripe.invoicePayments.list({
    invoice: invoice.id,
    status: "paid",
    limit: 100,
  });
  const associated = payments.data.filter((payment) =>
    payment.status === "paid" &&
    payment.currency === invoice.currency &&
    Number(payment.amount_paid) > 0 &&
    stripeObjectId(payment.invoice) === invoice.id
  );
  return associated.length === 1 ? invoicePaymentObjectId(associated[0]!) : undefined;
}

async function grantVerifiedStripeRenewalBonus(
  invoiceEvent: Stripe.Invoice,
  stripe: Stripe,
): Promise<string | undefined> {
  const eventInvoiceId = invoiceEvent.id;
  if (!eventInvoiceId) return undefined;
  const invoice = await stripe.invoices.retrieve(eventInvoiceId);
  const amountPaid = Number(invoice.amount_paid);
  if (
    invoice.id !== eventInvoiceId ||
    invoice.status !== "paid" ||
    !Number.isSafeInteger(amountPaid) ||
    amountPaid <= 0 ||
    invoice.currency !== "usd" ||
    !["subscription_cycle", "subscription_create", "subscription_update"].includes(
      String(invoice.billing_reason),
    )
  ) return undefined;

  const subscriptionId = invoiceSubscriptionId(invoice);
  const customerId = stripeObjectId(invoice.customer);
  if (!subscriptionId || !customerId) return undefined;
  const identified = await identifyInvoiceLibrary(stripe, invoice.customer);
  const libraryHash = identified?.libraryHash;
  const account = identified?.account;
  if (
    !libraryHash ||
    !account ||
    account.stripeCustomerId !== customerId ||
    !account.billingAccountId ||
    (account.revenueCat?.status === "active" && account.revenueCat.plan !== "free")
  ) return undefined;

  const subscription = await getLiveSubscription(stripe, subscriptionId);
  const liveCustomerId = stripeObjectId(subscription.customer);
  if (
    liveCustomerId !== customerId ||
    subscription.status !== "active" ||
    subscription.items.data.length !== 1
  ) return undefined;
  const plan = await getSubscriptionPlan(stripe, subscription);
  if (plan === "free") return undefined;
  const configuredPrice = await findUniqueMonthlyPrice(stripe, plan);
  const currentItem = subscription.items.data[0];
  if (!configuredPrice || currentItem?.price.id !== configuredPrice.id) {
    return undefined;
  }
  const subscriptionLibraryHash = subscription.metadata.classscribe_library_hash;
  if (
    !isLibraryHash(subscriptionLibraryHash) ||
    await resolveCurrentBillingHash(subscriptionLibraryHash) !== libraryHash
  ) return undefined;
  const linkedSubscription = account.stripeSubscriptionId === subscriptionId &&
    account.plan === plan;
  const pendingInitialSubscription = invoice.billing_reason === "subscription_create" &&
    !account.stripeSubscriptionId &&
    account.plan === "free" &&
    account.status !== "active" &&
    account.status !== "trialing" &&
    account.pendingCheckoutPlan === plan &&
    account.pendingCheckoutPriceId === configuredPrice.id;
  const paidMidperiodUpgrade = invoice.billing_reason === "subscription_update" &&
    account.stripeSubscriptionId === subscriptionId;
  if (!linkedSubscription && !pendingInitialSubscription && !paidMidperiodUpgrade) return undefined;

  const matchingLines = invoice.lines.data
    .map((line) => line as unknown as Record<string, unknown>)
    .filter((line) => {
      const parent = asRecord(line.parent);
      const subscriptionDetails = asRecord(parent.subscription_item_details);
      const pricing = asRecord(line.pricing);
      const priceDetails = asRecord(pricing.price_details);
      const priceId = stripeObjectId(line.price) ?? stripeObjectId(priceDetails.price);
      const lineSubscriptionId = stripeObjectId(line.subscription) ??
        stripeObjectId(subscriptionDetails.subscription);
      const isProration = line.proration === true || subscriptionDetails.proration === true;
      return priceId === configuredPrice.id &&
        lineSubscriptionId === subscription.id &&
        (invoice.billing_reason === "subscription_update" || !isProration);
    });
  if (matchingLines.length !== 1) return undefined;
  const lineData = matchingLines[0]!;

  const linePeriod = asRecord(lineData.period);
  const lineStart = Number(linePeriod.start);
  const lineEnd = Number(linePeriod.end);
  const livePeriod = verifiedStripePeriod(subscription);
  const periodStart = Number.isSafeInteger(lineStart) && lineStart > 0
    ? new Date(lineStart * 1000).toISOString()
    : livePeriod.periodStart;
  const periodEnd = Number.isSafeInteger(lineEnd) && lineEnd > 0
    ? new Date(lineEnd * 1000).toISOString()
    : livePeriod.periodEnd;
  if (!periodStart || !periodEnd || Date.parse(periodStart) >= Date.parse(periodEnd)) return undefined;

  const paymentId = await invoicePaymentId(stripe, invoice);
  if (!paymentId) return undefined;
  const { grantMonthlySubscriptionCredits } = await import("./classscribe-credits");
  await grantMonthlySubscriptionCredits({
    libraryCode: libraryHash,
    plan,
    periodStart: Date.parse(periodStart),
    periodEnd: Date.parse(periodEnd),
    source: "stripe",
    eventId: invoice.id,
    paymentId,
  });
  return subscriptionId;
}

function stripePeriodFromInvoiceLine(
  invoice: Stripe.Invoice,
  subscriptionId: string,
  priceId: string,
): { periodStart: string; periodEnd: string } | undefined {
  const line = invoice.lines.data
    .map((entry) => entry as unknown as Record<string, unknown>)
    .find((entry) => {
      const parent = asRecord(entry.parent);
      const subscriptionDetails = asRecord(parent.subscription_item_details);
      const pricing = asRecord(entry.pricing);
      const priceDetails = asRecord(pricing.price_details);
      const lineSubscriptionId = stripeObjectId(entry.subscription) ??
        stripeObjectId(subscriptionDetails.subscription);
      const linePriceId = stripeObjectId(entry.price) ?? stripeObjectId(priceDetails.price);
      const isProration = entry.proration === true || subscriptionDetails.proration === true;
      return lineSubscriptionId === subscriptionId &&
        linePriceId === priceId &&
        (invoice.billing_reason === "subscription_update" || !isProration);
    });
  const linePeriod = asRecord(line?.period);
  const start = Number(linePeriod.start ?? invoice.period_start);
  const end = Number(linePeriod.end ?? invoice.period_end);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end <= start) {
    return undefined;
  }
  return {
    periodStart: new Date(start * 1000).toISOString(),
    periodEnd: new Date(end * 1000).toISOString(),
  };
}

async function verifiedInvoiceForCharge(
  stripe: Stripe,
  charge: Stripe.Charge,
): Promise<{ invoice: Stripe.Invoice; paymentId: string } | undefined> {
  const chargeId = charge.id;
  const paymentIntentId = stripeObjectId(charge.payment_intent);
  const chargeRecord = asRecord(charge);
  const chargeMetadata = asRecord(charge.metadata);
  const legacyInvoiceId = stripeObjectId(chargeRecord.invoice);
  const trustedInvoiceId = typeof chargeMetadata.classscribe_invoice_id === "string"
    ? chargeMetadata.classscribe_invoice_id
    : undefined;

  if (paymentIntentId) {
    const associatedPayments = await stripe.invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: paymentIntentId },
      status: "paid",
      limit: 100,
    });
    const invoiceIds = [...new Set(associatedPayments.data
      .filter((payment) =>
        payment.status === "paid" &&
        Number(payment.amount_paid) > 0 &&
        stripeObjectId(payment.payment.payment_intent) === paymentIntentId
      )
      .map((payment) => stripeObjectId(payment.invoice))
      .filter((id): id is string => Boolean(id)))];
    const selectedId = legacyInvoiceId ?? trustedInvoiceId;
    if (selectedId && !invoiceIds.includes(selectedId)) return undefined;
    if (invoiceIds.length !== 1) return undefined;
    const invoiceId = invoiceIds[0]!;
    const invoice = await stripe.invoices.retrieve(invoiceId);
    if (invoice.id !== invoiceId) return undefined;
    return { invoice, paymentId: paymentIntentId };
  }

  const legacyOrTrustedInvoiceId = legacyInvoiceId ?? trustedInvoiceId;
  if (!legacyOrTrustedInvoiceId) return undefined;
  const associatedPayments = await stripe.invoicePayments.list({
    invoice: legacyOrTrustedInvoiceId,
    status: "paid",
    limit: 100,
  });
  const associatedCharge = associatedPayments.data.filter((payment) =>
    payment.status === "paid" &&
    Number(payment.amount_paid) > 0 &&
    stripeObjectId(payment.invoice) === legacyOrTrustedInvoiceId &&
    stripeObjectId(payment.payment.charge) === chargeId
  );
  if (associatedCharge.length !== 1) return undefined;
  const invoice = await stripe.invoices.retrieve(legacyOrTrustedInvoiceId);
  if (invoice.id !== legacyOrTrustedInvoiceId) return undefined;
  return { invoice, paymentId: chargeId };
}

async function reverseVerifiedStripeSubscriptionPeriod(
  event: Stripe.Event,
  stripe: Stripe,
): Promise<void> {
  const isRefund = event.type === "charge.refunded";
  const supportedDispute = [
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.funds_withdrawn",
    "charge.dispute.closed",
  ].includes(event.type);
  if (!isRefund && !supportedDispute) return;

  const eventObject = event.data.object as unknown as Record<string, unknown>;
  let chargeId = isRefund ? stripeObjectId(eventObject) : stripeObjectId(eventObject.charge);
  let disputeState: string | undefined;
  if (supportedDispute) {
    const disputeId = stripeObjectId(eventObject);
    if (!disputeId) return;
    const dispute = await stripe.disputes.retrieve(disputeId);
    if (dispute.id !== disputeId) return;
    disputeState = dispute.status;
    chargeId = stripeObjectId(dispute.charge) ?? chargeId;
  }
  if (!chargeId) return;
  const charge = await stripe.charges.retrieve(chargeId);
  if (charge.id !== chargeId) return;
  if (isRefund && charge.refunded !== true && !(Number(charge.amount_refunded) > 0)) return;
  if (supportedDispute &&
    (charge.disputed !== true ||
      !["needs_response", "under_review", "lost", "warning_needs_response", "warning_under_review"]
        .includes(disputeState ?? ""))) return;

  const verifiedPaymentInvoice = await verifiedInvoiceForCharge(stripe, charge);
  if (!verifiedPaymentInvoice) {
    const { reconcileCreditPackCharge } = await import("./classscribe-credits");
    await reconcileCreditPackCharge(charge, stripe);
    return;
  }
  const { invoice, paymentId } = verifiedPaymentInvoice;
  const amountPaid = Number(invoice.amount_paid);
  const subscriptionId = invoiceSubscriptionId(invoice);
  const customerId = stripeObjectId(invoice.customer);
  if (
    invoice.status !== "paid" ||
    !Number.isSafeInteger(amountPaid) ||
    amountPaid <= 0 ||
    invoice.currency !== "usd" ||
    !subscriptionId ||
    !customerId ||
    stripeObjectId(charge.customer) !== customerId ||
    charge.currency !== "usd" ||
    !Number.isSafeInteger(charge.amount) ||
    charge.amount <= 0
  ) return;

  const identified = await identifyInvoiceLibrary(stripe, invoice.customer);
  const libraryHash = identified?.libraryHash;
  const account = identified?.account;
  if (!libraryHash || !account || account.stripeCustomerId !== customerId || !account.billingAccountId) return;
  const subscription = await getLiveSubscription(stripe, subscriptionId);
  if (
    stripeObjectId(subscription.customer) !== customerId ||
    !isLibraryHash(subscription.metadata.classscribe_library_hash) ||
    await resolveCurrentBillingHash(subscription.metadata.classscribe_library_hash) !== libraryHash
  ) return;

  const [studentPrice, proPrice] = await Promise.all([
    findUniqueMonthlyPrice(stripe, "student"),
    findUniqueMonthlyPrice(stripe, "pro"),
  ]);
  const configuredPrices = [studentPrice, proPrice].filter(
    (price): price is Stripe.Price => Boolean(price),
  );
  const matchingLines = invoice.lines.data
    .map((line) => line as unknown as Record<string, unknown>)
    .filter((line) => {
      const parent = asRecord(line.parent);
      const subscriptionDetails = asRecord(parent.subscription_item_details);
      const pricing = asRecord(line.pricing);
      const priceDetails = asRecord(pricing.price_details);
      const lineSubscriptionId = stripeObjectId(line.subscription) ??
        stripeObjectId(subscriptionDetails.subscription);
      const isProration = line.proration === true || subscriptionDetails.proration === true;
      const linePriceId = stripeObjectId(line.price) ?? stripeObjectId(priceDetails.price);
      return lineSubscriptionId === subscriptionId &&
        (invoice.billing_reason === "subscription_update" || !isProration) &&
        configuredPrices.some((price) => price.id === linePriceId);
    });
  if (matchingLines.length !== 1) return;
  const matchingLine = matchingLines[0]!;
  const linePricing = asRecord(matchingLine.pricing);
  const linePriceDetails = asRecord(linePricing.price_details);
  const priceId = stripeObjectId(matchingLine.price) ?? stripeObjectId(linePriceDetails.price);
  const price = configuredPrices.find((candidate) => candidate.id === priceId);
  const plan = price?.metadata.classscribe_plan;
  if (!priceId || (plan !== "student" && plan !== "pro")) return;
  const period = stripePeriodFromInvoiceLine(invoice, subscriptionId, priceId);
  if (!period) return;

  const { reverseMonthlySubscriptionCredits } = await import("./classscribe-credits");
  await reverseMonthlySubscriptionCredits({
    libraryCode: libraryHash,
    source: "stripe",
    eventId: event.id,
    paymentId,
  });
}

export async function processBillingEvent(event: Stripe.Event, stripe: Stripe): Promise<void> {
  if (
    event.type === "charge.refunded" ||
    event.type === "charge.dispute.created" ||
    event.type === "charge.dispute.updated" ||
    event.type === "charge.dispute.funds_withdrawn" ||
    event.type === "charge.dispute.closed"
  ) {
    await reverseVerifiedStripeSubscriptionPeriod(event, stripe);
    return;
  }

  let libraryHash: string | undefined;
  let customerId: string | undefined;
  let subscriptionId: string | undefined;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "subscription") return;
    const rawSubscriptionId = session.subscription;
    subscriptionId = typeof rawSubscriptionId === "string" ? rawSubscriptionId : rawSubscriptionId?.id;
    customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    libraryHash = session.metadata?.classscribe_library_hash;
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    subscriptionId = subscription.id;
    customerId = typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
    libraryHash = subscription.metadata.classscribe_library_hash;
  } else if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    libraryHash = session.metadata?.classscribe_library_hash;
    if (!isLibraryHash(libraryHash) || !customerId) return;
    libraryHash = await resolveCurrentBillingHash(libraryHash);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`stripe-event:${event.id}`}, 0))`);
      const [processed] = await tx.select({ path: documents.path })
        .from(documents)
        .where(eq(documents.path, billingEventPath(event.id)))
        .limit(1);
      if (processed) return;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
      const account = await getBillingAccount(tx, libraryHash!);
      if (account && account.stripeCustomerId === customerId &&
        account.pendingCheckoutSessionId === session.id) {
        const updatedAccount: BillingAccount = {
          ...account,
          pendingCheckoutAttemptId: undefined,
          pendingCheckoutPlan: undefined,
          pendingCheckoutPriceId: undefined,
          pendingCheckoutReturnUrl: undefined,
          pendingCheckoutCreatedAt: undefined,
          pendingCheckoutSessionId: undefined,
        };
        await tx.insert(documents).values({
          path: billingAccountPath(libraryHash!),
          data: updatedAccount,
        }).onConflictDoUpdate({
          target: documents.path,
          set: { data: updatedAccount, updatedAt: new Date() },
        });
      }
      await tx.insert(documents).values({
        path: billingEventPath(event.id),
        data: { eventId: event.id, type: event.type, processedAt: new Date().toISOString() },
      });
    });
    return;
  } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const verifiedInvoiceSubscriptionId = event.type === "invoice.paid"
      ? await grantVerifiedStripeRenewalBonus(invoice, stripe)
      : undefined;
    const identified = await identifyInvoiceLibrary(stripe, invoice.customer);
    libraryHash = identified?.libraryHash;
    customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    const invoiceSubscription = invoiceSubscriptionId(invoice);
    // An invoice for a different subscription must not refresh this library's
    // linked entitlement, even when the customer has been reused.
    if (invoiceSubscription && identified?.account?.stripeSubscriptionId &&
      invoiceSubscription !== identified.account.stripeSubscriptionId) return;
    subscriptionId = verifiedInvoiceSubscriptionId ?? identified?.account?.stripeSubscriptionId;
  } else {
    return;
  }

  if (!isLibraryHash(libraryHash) || !customerId || !subscriptionId) return;
  libraryHash = await resolveCurrentBillingHash(libraryHash);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`stripe-event:${event.id}`}, 0))`);
    const [processed] = await tx.select({ path: documents.path })
      .from(documents)
      .where(eq(documents.path, billingEventPath(event.id)))
      .limit(1);
    if (processed) return;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${libraryHash}`}, 0))`);
    const account = await getBillingAccount(tx, libraryHash);
    if (!account || account.stripeCustomerId !== customerId) return;
    const lastEventCreated = Number(account.lastStripeEventCreated) || 0;
    if (event.created < lastEventCreated) {
      await tx.insert(documents).values({
        path: billingEventPath(event.id),
        data: { eventId: event.id, type: event.type, processedAt: new Date().toISOString() },
      });
      return;
    }
    if (
      account.stripeSubscriptionId &&
      account.stripeSubscriptionId !== subscriptionId &&
      (account.status === "active" || account.status === "trialing")
    ) {
      await tx.insert(documents).values({
        path: billingEventPath(event.id),
        data: { eventId: event.id, type: event.type, processedAt: new Date().toISOString() },
      });
      return;
    }
    const liveSubscription = await getLiveSubscription(stripe, subscriptionId);
    const liveCustomerId = typeof liveSubscription.customer === "string"
      ? liveSubscription.customer
      : liveSubscription.customer.id;
    if (liveSubscription.id !== subscriptionId || liveCustomerId !== customerId) return;
    const plan = await getSubscriptionPlan(stripe, liveSubscription);
    const stripePeriod = verifiedStripePeriod(liveSubscription);
    const accountData: BillingAccount = {
      ...account,
      libraryHash,
      stripeCustomerId: customerId,
      stripeSubscriptionId: liveSubscription.id,
      plan,
      status: liveSubscription.status,
      stripeVerifiedAt: new Date().toISOString(),
      lastStripeEventCreated: Math.max(lastEventCreated, event.created),
      pendingCheckoutAttemptId: undefined,
      pendingCheckoutPlan: undefined,
      pendingCheckoutPriceId: undefined,
      pendingCheckoutReturnUrl: undefined,
      pendingCheckoutCreatedAt: undefined,
      pendingCheckoutSessionId: undefined,
      periodStart: stripePeriod.periodStart,
      periodEnd: stripePeriod.periodEnd,
      cancelAtPeriodEnd: stripePeriod.cancelAtPeriodEnd,
    };
    await tx.insert(documents).values({
      path: billingAccountPath(libraryHash),
      data: accountData,
    }).onConflictDoUpdate({
      target: documents.path,
      set: { data: accountData, updatedAt: new Date() },
    });
    await tx.insert(documents).values({
      path: billingEventPath(event.id),
      data: { eventId: event.id, type: event.type, processedAt: new Date().toISOString() },
    });
  });
}

async function managedWebhookSigningSecret(): Promise<string> {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!domain) throw new StripeSetupError("public_domain_missing");
  const webhookUrl = `https://${domain}/api/stripe/webhook`;
  let result;
  try {
    result = await pool.query<{ secret: string | null }>(
      'select secret from "stripe"."_managed_webhooks" where url = $1 order by created desc limit 1',
      [webhookUrl],
    );
  } catch {
    throw new StripeSetupError("managed_webhook_secret_lookup_failed");
  }
  const secret = result.rows[0]?.secret;
  if (typeof secret !== "string" || !secret.startsWith("whsec_")) {
    throw new StripeSetupError("managed_webhook_signing_secret_missing");
  }

  const connectorSecret = await getStripeConnectionWebhookSecret();
  if (connectorSecret) {
    const expected = Buffer.from(secret);
    const supplied = Buffer.from(connectorSecret);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new StripeSetupError("managed_webhook_signing_secret_mismatch");
    }
  }
  return secret;
}

function verifyManagedWebhookSecretWithStripe(secret: string, livemode: boolean): { payload: Buffer; signature: string } {
  const stripe = new Stripe("sk_test_webhook_readiness_check");
  const payloadJson = JSON.stringify({
    id: "evt_classscribe_webhook_readiness",
    object: "event",
    api_version: "2025-10-29.clover",
    created: 0,
    data: { object: {} },
    livemode,
    pending_webhooks: 0,
    request: null,
    type: "classscribe.webhook.readiness",
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload: payloadJson, secret });
  const event = stripe.webhooks.constructEvent(payloadJson, signature, secret);
  if (event.id !== "evt_classscribe_webhook_readiness") {
    throw new StripeSetupError("managed_webhook_signature_verification_failed");
  }
  return { payload: Buffer.from(payloadJson), signature };
}

export async function processStripeWebhook(
  payload: Buffer,
  signature: string,
): Promise<void> {
  const secret = await managedWebhookSigningSecret();
  const stripe = await getUncachableStripeClient();
  const event = stripe.webhooks.constructEvent(payload, signature, secret);
  assertStripeWebhookMode(event.livemode, await getStripeConnectionLivemode());
  const sync = await getStripeSync();
  await sync.processWebhook(payload, signature);
  await processBillingEvent(event, stripe);
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.classscribe_credits_pack) {
      const { fulfillCreditCheckout } = await import("./classscribe-credits");
      await fulfillCreditCheckout(session);
    }
  }
}

export async function initializeStripeSync(): Promise<void> {
  stripeSyncReady = false;
  stripeReadinessError = "stripe_initialization_failed";
  const databaseUrl = process.env.DATABASE_URL;
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!databaseUrl) {
    stripeReadinessError = "database_url_missing";
    throw new StripeSetupError(stripeReadinessError);
  }
  if (!domain) {
    stripeReadinessError = "public_domain_missing";
    throw new StripeSetupError(stripeReadinessError);
  }
  try {
    const { runMigrations } = await import("stripe-replit-sync");
    await runMigrations({ databaseUrl });
  } catch {
    stripeReadinessError = "stripe_database_migrations_failed";
    throw new StripeSetupError("stripe_database_migrations_failed");
  }
  let sync;
  let stripe: Stripe;
  try {
    stripe = await getUncachableStripeClient();
    stripeLivemode = await getStripeConnectionLivemode();
    sync = await getStripeSync();
  } catch (error) {
    const setupError = error instanceof StripeConnectionError
      ? new StripeSetupError(error.code)
      : new StripeSetupError("stripe_client_initialization_failed");
    stripeReadinessError = setupError.code;
    throw setupError;
  }
  if (stripeLivemode) {
    try {
      const account = await stripe.accounts.retrieve(null);
      if (!account.charges_enabled) throw new StripeSetupError("stripe_live_account_not_ready");
    } catch (error) {
      stripeReadinessError = error instanceof StripeSetupError
        ? error.code
        : "stripe_live_account_check_failed";
      throw new StripeSetupError(stripeReadinessError);
    }
  }
  try {
    await findMonthlyPrice(stripe, "student");
    await findMonthlyPrice(stripe, "pro");
  } catch (error) {
    stripeReadinessError = error instanceof BillingError
      ? error.code
      : "stripe_plan_configuration_check_failed";
    throw new StripeSetupError(stripeReadinessError);
  }
  const webhookUrl = `https://${domain}/api/stripe/webhook`;
  try {
    await sync.findOrCreateManagedWebhook(webhookUrl);
  } catch {
    stripeReadinessError = "managed_webhook_setup_failed";
    throw new StripeSetupError("managed_webhook_setup_failed");
  }
  try {
    await sync.syncBackfill({ object: "all" });
  } catch {
    stripeReadinessError = "stripe_backfill_failed";
    throw new StripeSetupError("stripe_backfill_failed");
  }
  let probe: { payload: Buffer; signature: string };
  try {
    probe = verifyManagedWebhookSecretWithStripe(
      await managedWebhookSigningSecret(),
      await getStripeConnectionLivemode(),
    );
  } catch (error) {
    const setupError = error instanceof StripeSetupError || error instanceof StripeConnectionError
      ? error
      : new StripeSetupError("managed_webhook_signature_verification_failed");
    stripeReadinessError = setupError.code;
    throw setupError;
  }
  try {
    await sync.processWebhook(probe.payload, probe.signature);
  } catch {
    stripeReadinessError = "stripe_sync_webhook_verification_failed";
    throw new StripeSetupError("stripe_sync_webhook_verification_failed");
  }
  stripeSyncReady = true;
  stripeReadinessError = "";
}

export async function rotateLibraryBillingIdentity(
  tx: LegacyTransaction,
  oldLibraryHash: string,
  nextLibraryHash: string,
): Promise<void> {
  const lockKeys = [`billing:${oldLibraryHash}`, `billing:${nextLibraryHash}`].sort();
  for (const key of lockKeys) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
  const creditLockKeys = [`credits:${oldLibraryHash}`, `credits:${nextLibraryHash}`].sort();
  for (const key of creditLockKeys) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  const [existingCreditTransaction] = await tx.select({
    eventId: classscribeCreditTransactionsTable.eventId,
  }).from(classscribeCreditTransactionsTable)
    .where(eq(classscribeCreditTransactionsTable.libraryHash, nextLibraryHash))
    .limit(1);
  const [existingCreditAction] = await tx.select({
    id: classscribeCreditActionsTable.id,
  }).from(classscribeCreditActionsTable)
    .where(eq(classscribeCreditActionsTable.libraryHash, nextLibraryHash))
    .limit(1);
  const [existingCreditProviderIntent] = await tx.select({
    id: classscribeCreditProviderIntentsTable.id,
  }).from(classscribeCreditProviderIntentsTable)
    .where(eq(classscribeCreditProviderIntentsTable.libraryHash, nextLibraryHash))
    .limit(1);
  const [existingCreditSubscriptionPeriod] = await tx.select({
    id: classscribeCreditSubscriptionPeriodsTable.id,
  }).from(classscribeCreditSubscriptionPeriodsTable)
    .where(eq(classscribeCreditSubscriptionPeriodsTable.libraryHash, nextLibraryHash))
    .limit(1);
  const [existingCreditPaymentRevocation] = await tx.select({
    id: classscribeCreditSubscriptionPaymentRevocationsTable.id,
  }).from(classscribeCreditSubscriptionPaymentRevocationsTable)
    .where(eq(classscribeCreditSubscriptionPaymentRevocationsTable.libraryHash, nextLibraryHash))
    .limit(1);
  if (
    existingCreditTransaction ||
    existingCreditAction ||
    existingCreditProviderIntent ||
    existingCreditSubscriptionPeriod ||
    existingCreditPaymentRevocation
  ) {
    throw new Error("Credit records already exist for the replacement library code.");
  }

  const oldAccountPath = billingAccountPath(oldLibraryHash);
  const newAccountPath = billingAccountPath(nextLibraryHash);
  const [oldAccount] = await tx.select({ data: documents.data })
    .from(documents)
    .where(eq(documents.path, oldAccountPath))
    .limit(1);
  if (oldAccount) {
    const account = asRecord(oldAccount.data);
    const [newAccount] = await tx.select({ data: documents.data })
      .from(documents)
      .where(eq(documents.path, newAccountPath))
      .limit(1);
    if (newAccount) throw new Error("A billing account already exists for the replacement library code.");
    const stableWelcomeHash = account.creditsWelcomeLibraryHash;
    await tx.insert(documents).values({
      path: newAccountPath,
      data: {
        ...account,
        libraryHash: nextLibraryHash,
        creditsWelcomeLibraryHash: typeof stableWelcomeHash === "string" &&
          /^[a-f0-9]{64}$/.test(stableWelcomeHash)
          ? stableWelcomeHash
          : oldLibraryHash,
      },
    });
    await tx.delete(documents).where(eq(documents.path, oldAccountPath));
  }

  const oldUsagePrefix = `private/classscribe-billing/usage/${oldLibraryHash}/`;
  const usageRows = await tx.select({
    path: documents.path,
    data: documents.data,
  }).from(documents)
    .where(like(documents.path, `${oldUsagePrefix}%`));
  for (const row of usageRows) {
    const month = row.path.slice(oldUsagePrefix.length);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const targetPath = usagePath(nextLibraryHash, month);
    const [existingUsage] = await tx.select({ data: documents.data })
      .from(documents)
      .where(eq(documents.path, targetPath))
      .limit(1);
    if (existingUsage) {
      throw new Error("A usage record already exists for the replacement library code.");
    }
    await tx.insert(documents).values({
      path: targetPath,
      data: { ...asRecord(row.data), libraryHash: nextLibraryHash },
    });
    await tx.delete(documents).where(eq(documents.path, row.path));
  }

  await tx.update(classscribeCreditTransactionsTable)
    .set({ libraryHash: nextLibraryHash })
    .where(eq(classscribeCreditTransactionsTable.libraryHash, oldLibraryHash));
  await tx.update(classscribeCreditActionsTable)
    .set({ libraryHash: nextLibraryHash })
    .where(eq(classscribeCreditActionsTable.libraryHash, oldLibraryHash));
  await tx.update(classscribeCreditProviderIntentsTable)
    .set({ libraryHash: nextLibraryHash })
    .where(eq(classscribeCreditProviderIntentsTable.libraryHash, oldLibraryHash));
  await tx.update(classscribeCreditSubscriptionPeriodsTable)
    .set({ libraryHash: nextLibraryHash })
    .where(eq(classscribeCreditSubscriptionPeriodsTable.libraryHash, oldLibraryHash));
  await tx.update(classscribeCreditSubscriptionPaymentRevocationsTable)
    .set({ libraryHash: nextLibraryHash })
    .where(eq(classscribeCreditSubscriptionPaymentRevocationsTable.libraryHash, oldLibraryHash));

  const [existingAlias] = await tx.select({ path: documents.path })
    .from(documents)
    .where(eq(documents.path, billingAliasPath(oldLibraryHash)))
    .limit(1);
  if (existingAlias) throw new Error("A billing identity alias already exists for this library code.");
  await tx.insert(documents).values({
    path: billingAliasPath(oldLibraryHash),
    data: { fromHash: oldLibraryHash, toHash: nextLibraryHash },
  });
}

export async function getLibraryHashForCode(code: string): Promise<string> {
  if (!validUid(code)) {
    throw new BillingError(403, "not_granted", "Not allowed.");
  }
  await assertLibraryActive(code);
  return hashLibraryCode(code);
}
