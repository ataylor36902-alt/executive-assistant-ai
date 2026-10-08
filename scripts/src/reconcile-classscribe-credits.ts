import { pool } from "@workspace/db";
import { canonicalizeMigrationEntries } from "./credits-migration-adapter";
import { validateNightlyReconcilerEnvironment } from "./credits-nightly-report";

const PROJECT_NAME = "ClassScribe";
const MIGRATION_PREFIX = "private/classscribe-billing/credits-migration-entries/";
const ACCOUNT_PREFIX = "private/classscribe-billing/accounts/";
const ALIAS_PREFIX = "private/classscribe-billing/aliases/";
let projectRequestQueue: Promise<void> = Promise.resolve();
let currencyRequestQueue: Promise<void> = Promise.resolve();
let nextProjectRequestAt = 0;
let nextCurrencyRequestAt = 0;
const migrationStateApiUrl = new URL(
  "../../artifacts/api-server/src/lib/credits-migration-state.ts",
  import.meta.url,
).href;
const migrationStateApi = await import(migrationStateApiUrl) as {
  getCreditsMigrationState(): Promise<{
    maintenance: boolean;
    activeCurrency: "CRD" | "CREDITS";
    serverSubscriptionGrantReady: boolean;
    version: string;
  }>;
};
const revenueCatRequestUrl = new URL(
  "../../artifacts/api-server/src/lib/revenuecat-request.ts",
  import.meta.url,
).href;
const { revenueCatRequest } = await import(revenueCatRequestUrl) as {
  revenueCatRequest(
    path: string,
    options: {
      method: "GET" | "POST" | "DELETE";
      headers?: Record<string, string>;
      body?: string;
    },
  ): Promise<Response>;
};

type Resource = {
  id: string;
  name?: string;
  code?: string;
  app_user_id?: string;
  aliases?: string[];
};
type AccountIdentity = { libraryHash: string };
type MigrationEntry = {
  libraryHash: string;
  customerId: string;
  phase: string;
  before: { CRD: number; CREDITS: number };
  after?: { CRD: number; CREDITS: number };
  originalCrdBalance: number;
  ledgerTotalBefore: number;
};
type Balance = { CRD: number; CREDITS: number };

class RevenueCatReadError extends Error {
  constructor(public readonly status: number, method: string, path: string) {
    const safePath = path.replace(/\/customers\/[^/]+/g, "/customers/[redacted]");
    super(`RevenueCat HTTP ${status} for ${method} ${safePath}`);
  }
}

function projectPath(projectId: string, suffix: string): string {
  return `/v2/projects/${encodeURIComponent(projectId)}${suffix}`;
}

async function rcRequest<T>(path: string): Promise<T> {
  let response: Response;
  try {
    const customerCurrency = /\/customers\/[^/]+\/virtual_currencies(?:\/|\?|$)/.test(path);
    const interval = customerCurrency ? 130 : 1_050;
    const queue = customerCurrency ? currencyRequestQueue : projectRequestQueue;
    const nextAt = customerCurrency ? nextCurrencyRequestAt : nextProjectRequestAt;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    if (customerCurrency) currencyRequestQueue = queue.then(() => current);
    else projectRequestQueue = queue.then(() => current);
    await queue;
    const delay = Math.max(0, nextAt - Date.now());
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (customerCurrency) nextCurrencyRequestAt = Date.now() + interval;
    else nextProjectRequestAt = Date.now() + interval;
    release();
    response = await revenueCatRequest(path, { method: "GET" });
  } catch {
    throw new Error("RevenueCat read outcome is unknown.");
  }
  if (!response.ok) throw new RevenueCatReadError(response.status, "GET", path);
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("RevenueCat returned an unreadable reconciliation response.");
  }
}

async function rcPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  const visited = new Set<string>();
  let next: string | undefined = path;
  while (next) {
    if (visited.has(next) || visited.size > 10_000) {
      throw new Error("RevenueCat pagination did not terminate safely.");
    }
    visited.add(next);
    const page: { items?: T[]; next_page?: string } =
      await rcRequest<{ items?: T[]; next_page?: string }>(next);
    items.push(...(page.items ?? []));
    next = typeof page.next_page === "string" && page.next_page ? page.next_page : undefined;
  }
  return items;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isBalance(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

async function readBalances(projectId: string, customerId: string): Promise<Balance> {
  const items = await rcPages<Record<string, unknown>>(
    projectPath(
      projectId,
      `/customers/${encodeURIComponent(customerId)}/virtual_currencies?include_empty_balances=true&limit=100`,
    ),
  );
  const crd = items.filter((item) => item.currency_code === "CRD");
  const credits = items.filter((item) => item.currency_code === "CREDITS");
  if (crd.length > 1 || credits.length > 1) {
    throw new Error("RevenueCat returned duplicate virtual-currency balances.");
  }
  const crdBalance = crd.length ? crd[0]?.balance : 0;
  const creditsBalance = credits.length ? credits[0]?.balance : 0;
  if (!isBalance(crdBalance) || !isBalance(creditsBalance)) {
    throw new Error("RevenueCat returned an invalid virtual-currency balance.");
  }
  return { CRD: crdBalance, CREDITS: creditsBalance };
}

async function loadMigrationEntries(): Promise<MigrationEntry[]> {
  const result = await pool.query<{ path: string; data: unknown }>(
    "select path, data from classscribe_legacy_documents where left(path, char_length($1)) = $1",
    [MIGRATION_PREFIX],
  );
  const rows = result.rows;
  const byLibrary = new Map<string, MigrationEntry>();
  for (const row of rows) {
    const libraryHash = row.path.slice(MIGRATION_PREFIX.length);
    const data = record(row.data);
    if (
      !/^[a-f0-9]{64}$/.test(libraryHash) ||
      data.libraryHash !== libraryHash ||
      typeof data.customerId !== "string" ||
      data.phase !== "verified" ||
      !data.after ||
      !isBalance(record(data.after).CRD) ||
      !isBalance(record(data.after).CREDITS) ||
      !isBalance(data.originalCrdBalance) ||
      !Number.isSafeInteger(data.ledgerTotalBefore)
    ) {
      throw new Error("A durable migration baseline is incomplete; reconciliation stopped.");
    }
    if (byLibrary.has(libraryHash)) throw new Error("Migration baseline contains a duplicate library identity.");
    byLibrary.set(libraryHash, data as unknown as MigrationEntry);
  }
  return [...byLibrary.values()];
}

async function currentLedgerTotals(): Promise<Map<string, number>> {
  const result = await pool.query<{
    library_hash: string;
    amount: number;
    metadata: unknown;
  }>("select library_hash, amount, metadata from classscribe_credit_transactions");
  const rows = result.rows;
  const totals = new Map<string, number>();
  for (const row of rows) {
    const reference = record(row.metadata).reference;
    // Migration adjustments are already represented in each saved provider
    // balance baseline. Their RevenueCat webhook must never count as a second
    // independent application grant.
    if (typeof reference === "string" && reference.startsWith("migrate-crd-")) continue;
    totals.set(row.library_hash, (totals.get(row.library_hash) ?? 0) + row.amount);
  }
  return totals;
}

async function loadAccountIdentities(): Promise<{
  accountsByProviderId: Map<string, AccountIdentity>;
  canonicalize: (hash: string) => string;
}> {
  const [accounts, aliases] = await Promise.all([
    pool.query<{ path: string; data: unknown }>(
      "select path, data from classscribe_legacy_documents where left(path, char_length($1)) = $1",
      [ACCOUNT_PREFIX],
    ),
    pool.query<{ path: string; data: unknown }>(
      "select path, data from classscribe_legacy_documents where left(path, char_length($1)) = $1",
      [ALIAS_PREFIX],
    ),
  ]);
  const aliasMap = new Map<string, string>();
  for (const row of aliases.rows) {
    const source = row.path.slice(ALIAS_PREFIX.length);
    const target = record(row.data).toHash;
    if (/^[a-f0-9]{64}$/.test(source)) {
      if (typeof target !== "string" || !/^[a-f0-9]{64}$/.test(target)) {
        throw new Error("A billing identity alias has an invalid target.");
      }
      aliasMap.set(source, target);
    }
  }
  const canonicalize = (initial: string) => {
    let current = initial;
    const seen = new Set<string>();
    while (aliasMap.has(current)) {
      if (seen.has(current)) throw new Error("A billing identity alias cycle was found.");
      seen.add(current);
      current = aliasMap.get(current)!;
    }
    return current;
  };
  const merged = new Map<string, Set<string>>();
  for (const row of accounts.rows) {
    const initialHash = row.path.slice(ACCOUNT_PREFIX.length);
    if (!/^[a-f0-9]{64}$/.test(initialHash)) continue;
    const billingAccountId = record(row.data).billingAccountId;
    if (typeof billingAccountId !== "string" || !billingAccountId) continue;
    const libraryHash = canonicalize(initialHash);
    const ids = merged.get(libraryHash) ?? new Set<string>();
    ids.add(billingAccountId);
    merged.set(libraryHash, ids);
  }
  const accountsByProviderId = new Map<string, AccountIdentity>();
  for (const [libraryHash, ids] of merged) {
    if (ids.size !== 1) {
      throw new Error(`Ambiguous stored billing identity for library ${libraryHash}.`);
    }
    const providerId = [...ids][0]!;
    const existing = accountsByProviderId.get(providerId);
    if (existing && existing.libraryHash !== libraryHash) {
      throw new Error("A RevenueCat identity maps to multiple canonical libraries.");
    }
    accountsByProviderId.set(providerId, { libraryHash });
  }
  return { accountsByProviderId, canonicalize };
}

async function main(): Promise<void> {
  // No direct-CLI bypass or fallback to the scheduler's own managed database.
  if (!validateNightlyReconcilerEnvironment(process.env)) {
    throw new Error("Reconciliation requires the owner-approved nightly runner.");
  }
  const session = await pool.query<{ default_transaction_read_only: string }>(
    "show default_transaction_read_only",
  );
  if (session.rows[0]?.default_transaction_read_only !== "on") {
    throw new Error("Nightly reconciliation requires read-only database sessions.");
  }
  const state = await migrationStateApi.getCreditsMigrationState();
  if (state.maintenance) {
    console.log(JSON.stringify({
      status: "maintenance",
      migrationStateVersion: state.version,
      reconciled: false,
      detail: "Reconciliation skipped while credits migration maintenance is active.",
      writes: 0,
    }, null, 2));
    return;
  }
  if (state.activeCurrency !== "CREDITS" || !state.serverSubscriptionGrantReady) {
    throw new Error("Credits currency migration is not verified and ready; nightly reconciliation cannot run.");
  }

  const projects = await rcPages<Resource>("/v2/projects?limit=100");
  const projectMatches = projects.filter((project) => project.name === PROJECT_NAME &&
    (!process.env.REVENUECAT_PROJECT_ID || project.id === process.env.REVENUECAT_PROJECT_ID));
  if (projectMatches.length !== 1) throw new Error("RevenueCat ClassScribe project is missing or ambiguous.");
  const project = projectMatches[0]!;
  // Uncertain writes can exist even when current balances happen to agree.
  // Pending writes are reported only after an hour, not during normal processing.
  const uncertain = await pool.query<{
    library_hash: string; source: string; status: string; count: string;
  }>(`
    select library_hash, source, status, count(*)::text as count from (
      select library_hash, 'provider_adjustment' as source, status
      from classscribe_credit_provider_intents
      where status = 'uncertain' or (status = 'pending' and updated_at < now() - interval '1 hour')
      union all
      select library_hash, 'subscription_period' as source, status
      from classscribe_credit_subscription_periods
      where status = 'uncertain' or (status = 'pending' and updated_at < now() - interval '1 hour')
    ) held group by library_hash, source, status
  `);
  if (uncertain.rows.some((row) => !/^[a-f0-9]{64}$/.test(row.library_hash))) {
    throw new Error("A pending credit adjustment has an invalid hashed identity.");
  }
  const uncertainAdjustments = uncertain.rows.map((row) => ({
    libraryHash: row.library_hash,
    source: row.source,
    status: row.status,
    count: Number(row.count),
  }));
  const [customers, entries, rawLedgerTotals, accountIdentities] = await Promise.all([
    rcPages<Resource>(projectPath(project.id, "/customers?limit=100")),
    loadMigrationEntries(),
    currentLedgerTotals(),
    loadAccountIdentities(),
  ]);
  const customerIds = new Set<string>();
  for (const customer of customers) {
    if (!customer.id || customerIds.has(customer.id)) {
      throw new Error("RevenueCat customer inventory has a missing or duplicated ID.");
    }
    customerIds.add(customer.id);
  }
  const migratedEntries = canonicalizeMigrationEntries(
    entries,
    accountIdentities.canonicalize,
  );
  const libraryByCustomer = new Map<string, string>();
  const ledgerTotals = new Map<string, number>();
  for (const [sourceHash, amount] of rawLedgerTotals) {
    const canonicalHash = accountIdentities.canonicalize(sourceHash);
    ledgerTotals.set(canonicalHash, (ledgerTotals.get(canonicalHash) ?? 0) + amount);
  }
  for (const entry of entries) {
    if (!customerIds.has(entry.customerId)) {
      throw new Error(`RevenueCat customer required by migration baseline is missing for library ${entry.libraryHash}.`);
    }
  }

  const mismatches: Array<{
    libraryHash: string;
    providerCrd: number;
    expectedCrd: number;
    providerCredits: number;
    expectedCredits: number;
    deltaFromApplicationLedger: number;
  }> = [];
  let untrackedNonzeroCustomers = 0;
  let ambiguousCustomers = 0;
  for (const customer of customers) {
    const balance = await readBalances(project.id, customer.id);
    const candidateLibraries = new Set<string>();
    const identities = [
      customer.id,
      customer.app_user_id,
      ...(customer.aliases ?? []),
    ].filter((value): value is string => typeof value === "string");
    for (const identity of identities) {
      const account = accountIdentities.accountsByProviderId.get(identity);
      if (account) candidateLibraries.add(account.libraryHash);
    }
    if (candidateLibraries.size > 1) {
      ambiguousCustomers += 1;
      continue;
    }
    if (candidateLibraries.size === 0) {
      if (balance.CRD !== 0 || balance.CREDITS !== 0) untrackedNonzeroCustomers += 1;
      continue;
    }
    const libraryHash = [...candidateLibraries][0]!;
    const previousCustomer = libraryByCustomer.get(libraryHash);
    if (previousCustomer && previousCustomer !== customer.id) {
      ambiguousCustomers += 1;
      continue;
    }
    libraryByCustomer.set(libraryHash, customer.id);
    const entry = migratedEntries.get(libraryHash);
    const canonicalLedgerTotal = ledgerTotals.get(libraryHash) ?? 0;
    const ledgerDelta = entry
      ? canonicalLedgerTotal - entry.ledgerTotalBefore
      : canonicalLedgerTotal;
    const expectedCredits = entry
      ? entry.after!.CREDITS + ledgerDelta
      : canonicalLedgerTotal;
    if (!Number.isSafeInteger(expectedCredits) || expectedCredits < 0) {
      throw new Error(`Application ledger is invalid for library ${libraryHash}.`);
    }
    if (balance.CRD !== 0 || balance.CREDITS !== expectedCredits) {
      mismatches.push({
        libraryHash,
        providerCrd: balance.CRD,
        expectedCrd: 0,
        providerCredits: balance.CREDITS,
        expectedCredits,
        deltaFromApplicationLedger: ledgerDelta,
      });
    }
  }
  const finalState = await migrationStateApi.getCreditsMigrationState();
  if (finalState.maintenance) {
    console.log(JSON.stringify({
      status: "maintenance",
      migrationStateVersion: finalState.version,
      reconciled: false,
      detail: "Reconciliation discarded because migration maintenance became active during the check.",
      writes: 0,
    }, null, 2));
    return;
  }
  if (finalState.activeCurrency !== "CREDITS" || !finalState.serverSubscriptionGrantReady ||
      finalState.version !== state.version) {
    throw new Error("Credits readiness changed during reconciliation; no balance conclusion is available.");
  }
  console.log(JSON.stringify({
    status: mismatches.length || untrackedNonzeroCustomers || ambiguousCustomers || uncertainAdjustments.length ? "mismatch" : "verified",
    migrationStateVersion: state.version,
    activeCurrency: state.activeCurrency,
    serverSubscriptionGrantReady: state.serverSubscriptionGrantReady,
    customersInventoried: customers.length,
    librariesReconciled: entries.length,
    mismatchCount: mismatches.length,
    mismatches,
    untrackedNonzeroCustomerCount: untrackedNonzeroCustomers,
    ambiguousCustomerMappingCount: ambiguousCustomers,
    uncertainAdjustmentCount: uncertainAdjustments.reduce((sum, row) => sum + row.count, 0),
    uncertainAdjustments,
    historyBasis: "migration balance baseline plus post-baseline credit ledger delta; RevenueCat virtual-currency API exposes balances and transaction creation, not a transaction-history list",
    nativePurchaseGrantsIncludedFromRevenueCatWebhookLedger: true,
    migrationReferenceWebhookDuplicatesExcluded: true,
    writesOrAutomaticFixes: 0,
    libraryIdentifiersHashed: true,
    untrackedProviderIdentitiesLogged: false,
  }, null, 2));
  if (mismatches.length || untrackedNonzeroCustomers || ambiguousCustomers || uncertainAdjustments.length) process.exitCode = 2;
}

main().catch((error: unknown) => {
  if (error instanceof RevenueCatReadError) {
    console.error(`ClassScribe credits reconciliation failed: RevenueCat returned HTTP ${error.status} for ${error.message.split(" for ").at(-1)}.`);
  } else {
    console.error(
      "ClassScribe credits reconciliation failed:",
      "The read-only check could not finish. Check database access, migration baselines, identity mappings, and provider read permissions.",
    );
  }
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});