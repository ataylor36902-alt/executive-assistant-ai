import { createHash } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { pool } from "@workspace/db";
import {
  assertMigrationCutoverReady,
  assertTransferMayBeRetried,
  buildPackOnlyGrantPlan,
  buildAtomicTransfer,
  type ProductGrant,
  canonicalMigrationKey,
  migrationMatches,
  transferPhaseAfterRequest,
  type MigrationEntryPhase,
} from "./credits-migration-adapter";

const PROJECT_NAME = "ClassScribe";
const CURRENCY_NAME = "Scribe Credits";
const STATE_PATH = "private/classscribe-billing/credits-migration-control";
const ACCOUNT_PREFIX = "private/classscribe-billing/accounts/";
const ALIAS_PREFIX = "private/classscribe-billing/aliases/";
const MIGRATION_PREFIX = "private/classscribe-billing/credits-migration-entries/";
const connectors = new ReplitConnectors();
let projectConfigQueue: Promise<void> = Promise.resolve();
let customerCurrencyQueue: Promise<void> = Promise.resolve();
let nextProjectConfigRequestAt = 0;
let nextCustomerCurrencyRequestAt = 0;
const migrationStateApiUrl = new URL(
  "../../artifacts/api-server/src/lib/credits-migration-state.ts",
  import.meta.url,
).href;
const migrationStateApi = await import(migrationStateApiUrl) as {
  getCreditsMigrationState(): Promise<CreditsMigrationState>;
  saveCreditsMigrationState(state: CreditsMigrationState): Promise<void>;
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
const creditsConfigUrl = new URL(
  "../../artifacts/api-server/src/lib/credits-config.ts",
  import.meta.url,
).href;
const { creditsConfig } = await import(creditsConfigUrl) as {
  creditsConfig: {
    currency: { code: string; name: string };
    offeringIdentifier: string;
    packs: Array<{ id: string; credits: number; priceCents: number }>;
    monthlyBonus: { student: number; pro: number };
  };
};

type CurrencyCode = "CRD" | "CREDITS";
type CatalogProductGrant = {
  product_ids?: string[];
  amount?: number;
  trial_amount?: number;
  expire_at_cycle_end?: boolean;
};
type CreditsMigrationState = {
  maintenance: boolean;
  activeCurrency: CurrencyCode;
  serverSubscriptionGrantReady: boolean;
  version: string;
};
type Resource = {
  id: string;
  name?: string;
  code?: string;
  state?: string;
  type?: string;
  app_id?: string;
  app_user_id?: string;
  store_identifier?: string;
  lookup_key?: string;
  is_current?: boolean;
  aliases?: string[];
  product_grants?: CatalogProductGrant[];
};
type ProductLink = { product?: Resource; product_id?: string };
type MigrationEntry = {
  libraryHash: string;
  customerId: string;
  idempotencyKey: string;
  phase: MigrationEntryPhase;
  before: { CRD: number; CREDITS: number };
  after?: { CRD: number; CREDITS: number };
  originalCrdBalance: number;
  ledgerTotalBefore: number;
  updatedAt: string;
  errorCode?: string;
};
type AccountRow = {
  libraryHash: string;
  billingAccountId: string;
  sourceLibraryHashes: string[];
};
type CustomerPlan = {
  customerId: string;
  libraryHash: string;
  sourceLibraryHashes: string[];
  before: { CRD: number; CREDITS: number };
  entry?: MigrationEntry;
};
type GrantClassification = {
  target: ProductGrant[];
  classifiedProductIds: Set<string>;
  products: Resource[];
  offeringSnapshot: {
    id: string;
    packageIds: string[];
    current: boolean;
    packages: Array<{ id: string; lookupKey?: string; productIds: string[] }>;
  }[];
  productIdsBefore: string[];
  currencies: Resource[];
};

class RevenueCatRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
  ) {
    super(`RevenueCat HTTP ${status} for ${method} ${safeProviderPath(path)}`);
  }
}

function safeProviderPath(path: string): string {
  return path.replace(/\/customers\/[^/]+/g, "/customers/[redacted]");
}

async function paceRevenueCatRequest(path: string): Promise<void> {
  const isCustomerCurrency = /\/customers\/[^/]+\/virtual_currencies(?:\/|\?|$)/.test(path);
  const interval = isCustomerCurrency ? 130 : 1_050;
  const queue = isCustomerCurrency ? customerCurrencyQueue : projectConfigQueue;
  const nextAt = isCustomerCurrency
    ? nextCustomerCurrencyRequestAt
    : nextProjectConfigRequestAt;
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  if (isCustomerCurrency) customerCurrencyQueue = queue.then(() => current);
  else projectConfigQueue = queue.then(() => current);
  await queue;
  const delay = Math.max(0, nextAt - Date.now());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  if (isCustomerCurrency) nextCustomerCurrencyRequestAt = Date.now() + interval;
  else nextProjectConfigRequestAt = Date.now() + interval;
  release();
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function projectPath(projectId: string, suffix: string): string {
  return `/v2/projects/${encodeURIComponent(projectId)}${suffix}`;
}

async function rcRequest<T>(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    await paceRevenueCatRequest(path);
    if (usesCreditsCustomerApi(path)) {
      response = await revenueCatRequest(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(Object.keys(headers).length ? { headers } : {}),
      });
    } else {
      response = await connectors.proxy("revenuecat", path, {
        method,
        ...(body === undefined ? {} : { body }),
        ...(Object.keys(headers).length ? { headers } : {}),
      });
    }
  } catch {
    throw new Error("RevenueCat request outcome is unknown; no provider response was received.");
  }
  if (!response.ok) {
    throw new RevenueCatRequestError(response.status, method, path);
  }
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("RevenueCat returned an unreadable response.");
  }
}

function usesCreditsCustomerApi(path: string): boolean {
  return /^\/v2\/projects(?:\?[^#]*)?$/.test(path) ||
    /^\/v2\/projects\/[^/]+\/customers(?:\?[^#]*)?$/.test(path) ||
    /^\/v2\/projects\/[^/]+\/customers\/[^/]+\/virtual_currencies(?:\/transactions)?(?:\?[^#]*)?$/.test(path);
}

async function rcPages<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  const seen = new Set<string>();
  let next: string | undefined = path;
  while (next) {
    if (seen.has(next) || seen.size > 10_000) {
      throw new Error("RevenueCat pagination did not terminate safely.");
    }
    seen.add(next);
    const page: { items?: T[]; next_page?: string } =
      await rcRequest<{ items?: T[]; next_page?: string }>(next);
    result.push(...(page.items ?? []));
    next = typeof page.next_page === "string" && page.next_page.length
      ? page.next_page
      : undefined;
  }
  return result;
}

function unique<T>(
  values: T[],
  predicate: (value: T) => boolean,
  what: string,
): T | undefined {
  const matches = values.filter(predicate);
  if (matches.length > 1) throw new Error(`Ambiguous ${what}; migration stopped.`);
  return matches[0];
}

function requireBalance(value: unknown, description: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`RevenueCat returned an invalid ${description} balance.`);
  }
  return Number(value);
}

async function providerBalances(
  projectId: string,
  customerId: string,
): Promise<{ CRD: number; CREDITS: number }> {
  const entries = await rcPages<Record<string, unknown>>(
    projectPath(
      projectId,
      `/customers/${encodeURIComponent(customerId)}/virtual_currencies?include_empty_balances=true&limit=100`,
    ),
  );
  const old = entries.filter((item) => item.currency_code === "CRD");
  const next = entries.filter((item) => item.currency_code === "CREDITS");
  if (old.length > 1 || next.length > 1) {
    throw new Error("RevenueCat returned duplicate currency balances.");
  }
  return {
    CRD: old.length ? requireBalance(old[0]?.balance, "CRD") : 0,
    CREDITS: next.length ? requireBalance(next[0]?.balance, "CREDITS") : 0,
  };
}

async function loadCanonicalAccounts(): Promise<{
  accounts: AccountRow[];
  aliases: Map<string, string>;
}> {
  const [accountResult, aliasResult] = await Promise.all([
    pool.query<{ path: string; data: unknown }>(
      "select path, data from classscribe_legacy_documents where left(path, char_length($1)) = $1",
      [ACCOUNT_PREFIX],
    ),
    pool.query<{ path: string; data: unknown }>(
      "select path, data from classscribe_legacy_documents where left(path, char_length($1)) = $1",
      [ALIAS_PREFIX],
    ),
  ]);
  const accountDocuments = accountResult.rows;
  const aliasDocuments = aliasResult.rows;
  const aliases = new Map<string, string>();
  for (const row of aliasDocuments) {
    const source = row.path.slice(ALIAS_PREFIX.length);
    const target = safeObject(row.data).toHash;
    if (/^[a-f0-9]{64}$/.test(source)) {
      if (typeof target !== "string" || !/^[a-f0-9]{64}$/.test(target)) {
        throw new Error("A billing identity alias has an invalid target.");
      }
      aliases.set(source, target);
    }
  }
  const canonicalize = (initial: string) => {
    let current = initial;
    const seen = new Set<string>();
    while (aliases.has(current)) {
      if (seen.has(current)) throw new Error("A billing identity alias cycle was found.");
      seen.add(current);
      current = aliases.get(current)!;
    }
    return current;
  };
  const byCanonical = new Map<string, { ids: Set<string>; sources: Set<string> }>();
  for (const row of accountDocuments) {
    const libraryHash = row.path.slice(ACCOUNT_PREFIX.length);
    if (!/^[a-f0-9]{64}$/.test(libraryHash)) continue;
    const billingAccountId = safeObject(row.data).billingAccountId;
    if (typeof billingAccountId !== "string" || !billingAccountId.trim()) continue;
    const canonical = canonicalize(libraryHash);
    const identity = byCanonical.get(canonical) ?? {
      ids: new Set<string>(),
      sources: new Set<string>(),
    };
    identity.ids.add(billingAccountId);
    identity.sources.add(libraryHash);
    byCanonical.set(canonical, identity);
  }
  const accounts: AccountRow[] = [];
  for (const [libraryHash, identity] of byCanonical) {
    if (identity.ids.size !== 1) {
      throw new Error(`Ambiguous stored billing identity for library ${libraryHash}.`);
    }
    for (const source of aliases.keys()) {
      if (canonicalize(source) === libraryHash) identity.sources.add(source);
    }
    accounts.push({
      libraryHash,
      billingAccountId: [...identity.ids][0]!,
      sourceLibraryHashes: [...identity.sources],
    });
  }
  return { accounts, aliases };
}

function customerIds(customer: Resource): string[] {
  return [
    customer.id,
    customer.app_user_id,
    ...(Array.isArray(customer.aliases)
      ? customer.aliases.filter((alias): alias is string => typeof alias === "string")
      : []),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

async function inventoryCustomers(
  projectId: string,
  accounts: AccountRow[],
  allowExistingCredits: boolean,
): Promise<CustomerPlan[]> {
  const customers = await rcPages<Resource>(
    projectPath(projectId, "/customers?limit=100"),
  );
  const idsSeen = new Set<string>();
  const canonicalById = new Map<string, AccountRow[]>();
  for (const account of accounts) {
    const list = canonicalById.get(account.billingAccountId) ?? [];
    list.push(account);
    canonicalById.set(account.billingAccountId, list);
  }
  const mapped = new Map<string, { customer: Resource; libraryHash: string }>();
  for (const customer of customers) {
    if (typeof customer.id !== "string" || !customer.id) {
      throw new Error("RevenueCat customer inventory contained an invalid identity.");
    }
    if (idsSeen.has(customer.id)) throw new Error("RevenueCat customer inventory duplicated a customer ID.");
    idsSeen.add(customer.id);
    const libraryCandidates = new Set<string>();
    for (const id of customerIds(customer)) {
      for (const account of canonicalById.get(id) ?? []) libraryCandidates.add(account.libraryHash);
    }
    if (libraryCandidates.size > 1) {
      throw new Error("A RevenueCat customer maps to multiple canonical libraries.");
    }
    if (libraryCandidates.size === 1) {
      const libraryHash = [...libraryCandidates][0]!;
      const prior = mapped.get(libraryHash);
      if (prior && prior.customer.id !== customer.id) {
        throw new Error(`Multiple RevenueCat customer IDs map to library ${libraryHash}.`);
      }
      mapped.set(libraryHash, {
        customer,
        libraryHash,
      });
    }
  }
  const plans: CustomerPlan[] = [];
  for (const customer of customers) {
    const match = [...mapped.values()].find((entry) => entry.customer.id === customer.id);
    const before = await providerBalances(projectId, customer.id);
    if (!match) {
      if (before.CRD !== 0 || before.CREDITS !== 0) {
        throw new Error("An unmapped RevenueCat customer has a non-zero credit balance; no migration writes made.");
      }
      continue;
    }
    if (!allowExistingCredits && before.CREDITS !== 0) {
      throw new Error(`Library ${match.libraryHash} already has CREDITS; refusing to overwrite or double-count.`);
    }
    const account = accounts.find((item) => item.libraryHash === match.libraryHash);
    plans.push({
      customerId: customer.id,
      libraryHash: match.libraryHash,
      sourceLibraryHashes: account?.sourceLibraryHashes ?? [match.libraryHash],
      before,
    });
  }
  for (const account of accounts) {
    if (!mapped.has(account.libraryHash)) {
      const hasRcCustomerAlias = customers.some((customer) =>
        customerIds(customer).includes(account.billingAccountId),
      );
      if (hasRcCustomerAlias) {
        throw new Error(`Customer alias resolution is ambiguous for library ${account.libraryHash}.`);
      }
      // No customer exists yet. A customer is provisioned by the server only
      // after an operation; there is no provider identity to migrate.
    }
  }
  return plans.sort((left, right) => left.libraryHash.localeCompare(right.libraryHash));
}

function expectedStoreIdentifier(store: string, plan: "student" | "pro"): boolean {
  if (plan === "student") {
    return store === "student_monthly" ||
      store === "classscribe_student_monthly" ||
      store === "classscribe_student_monthly:monthly";
  }
  return store === "pro_monthly" ||
    store === "classscribe_pro_monthly" ||
    store === "classscribe_pro_monthly:monthly";
}

function targetGrantPlan(
  products: Resource[],
): { grants: ProductGrant[]; packProductIds: Set<string>; classifiedProductIds: Set<string> } {
  const appById = new Map(products.map((product) => [product.id, product.app_id]));
  const appIds = new Set(products.map((product) => product.app_id).filter((id): id is string => Boolean(id)));
  const packPlan = buildPackOnlyGrantPlan(products, creditsConfig.packs);
  const subscriptionProducts = products.filter((product) =>
    product.type === "subscription" &&
    (
      expectedStoreIdentifier(product.store_identifier ?? "", "student") ||
      expectedStoreIdentifier(product.store_identifier ?? "", "pro")
    ),
  );
  for (const plan of ["student", "pro"] as const) {
    const matching = subscriptionProducts.filter((product) =>
      expectedStoreIdentifier(product.store_identifier ?? "", plan),
    );
    if (!matching.length) {
      throw new Error(`The ${plan} subscription product is missing; refusing catalog edits.`);
    }
    for (const product of matching) {
      if (!product.id || !appById.get(product.id) || product.state === "inactive") {
        throw new Error("An expected subscription product is inactive or invalid.");
      }
    }
  }
  if (!appIds.size) throw new Error("The RevenueCat catalog has no store applications.");
  for (const productId of packPlan.productIds) {
    const product = products.find((item) => item.id === productId);
    if (!product || !product.id || !appById.get(product.id) || product.state === "inactive") {
      throw new Error("An expected credit-pack product is inactive or invalid.");
    }
  }
  return {
    grants: packPlan.grants,
    packProductIds: packPlan.productIds,
    classifiedProductIds: new Set([
      ...packPlan.productIds,
      ...subscriptionProducts.map((product) => product.id),
    ]),
  };
}

function classifyCurrentGrants(
  currencies: Resource[],
  products: Resource[],
  expectedIds: Set<string>,
): void {
  const knownProducts = new Map(products.map((product) => [product.id, product]));
  for (const currency of currencies) {
    if (currency.code !== "CRD" && currency.code !== "CREDITS") continue;
    for (const grant of currency.product_grants ?? []) {
      const ids = grant.product_ids ?? [];
      if (!ids.length) throw new Error(`Currency ${currency.code} has a grant without products.`);
      for (const id of ids) {
        const product = knownProducts.get(id);
        if (!product || !expectedIds.has(id)) {
          throw new Error(`Currency ${currency.code} references an unclassified product; no catalog associations will be removed.`);
        }
        if (
          product.type !== "subscription" &&
          !(product.type === "consumable" && creditsConfig.packs.some((pack) => pack.id === product.store_identifier))
        ) {
          throw new Error(`Currency ${currency.code} references unsupported product ${id}.`);
        }
      }
    }
  }
}

async function loadCatalog(projectId: string): Promise<GrantClassification> {
  const [apps, products, offerings, currencies] = await Promise.all([
    rcPages<Resource>(projectPath(projectId, "/apps?limit=100")),
    rcPages<Resource>(projectPath(projectId, "/products?limit=100")),
    rcPages<Resource>(projectPath(projectId, "/offerings?limit=100")),
    rcPages<Resource>(projectPath(projectId, "/virtual_currencies?limit=100")),
  ]);
  const knownAppIds = new Set(apps.map((app) => app.id));
  if (products.some((product) => product.app_id && !knownAppIds.has(product.app_id))) {
    throw new Error("The product catalog references an unknown app; owner review is required.");
  }
  const oldCurrency = unique(currencies, (currency) => currency.code === "CRD", "CRD currency");
  if (
    !oldCurrency ||
    oldCurrency.name !== CURRENCY_NAME ||
    (oldCurrency.state !== "active" && oldCurrency.state !== "inactive")
  ) {
    throw new Error("The CRD / Scribe Credits currency is missing or mismatched.");
  }
  const creditsCurrency = unique(currencies, (currency) => currency.code === "CREDITS", "CREDITS currency");
  if (
    creditsCurrency &&
    (creditsCurrency.name !== CURRENCY_NAME || creditsCurrency.state !== "active")
  ) {
    throw new Error("Existing CREDITS currency has the wrong name.");
  }
  if (creditsCurrency?.state === "inactive") {
    throw new Error("CREDITS is archived; owner review is required before migration.");
  }

  const currentOfferings = offerings.filter((offering) => offering.is_current === true);
  const currentDefault = unique(
    currentOfferings,
    (offering) => offering.lookup_key === "default",
    "current default offering",
  );
  if (!currentDefault || currentOfferings.length !== 1) {
    throw new Error("The current subscription offering is unexpected or ambiguous.");
  }
  const offeringSnapshot: GrantClassification["offeringSnapshot"] = [];
  for (const offering of offerings) {
    const packages = await rcPages<Resource>(
      projectPath(projectId, `/offerings/${encodeURIComponent(offering.id)}/packages?limit=100`),
    );
    const packageSnapshots = await Promise.all(packages.map(async (pkg) => ({
      id: pkg.id,
      lookupKey: pkg.lookup_key,
      productIds: await getPackageProductIds(projectId, pkg.id),
    })));
    offeringSnapshot.push({
      id: offering.id,
      packageIds: packages.map((pkg) => pkg.id).sort(),
      current: offering.is_current === true,
      packages: packageSnapshots,
    });
  }

  const target = targetGrantPlan(products);
  classifyCurrentGrants(currencies, products, target.classifiedProductIds);
  const defaultSnapshot = offeringSnapshot.find((item) => item.current);
  const creditsOffering = unique(
    offerings,
    (offering) => offering.lookup_key === creditsConfig.offeringIdentifier,
    "credits offering",
  );
  if (!creditsOffering || creditsOffering.is_current) {
    throw new Error("A separate, non-current credits offering is required for the packs.");
  }
  const packSnapshot = offeringSnapshot.find((item) => item.id === creditsOffering.id);
  const unsupportedPackages = (packSnapshot?.packages ?? []).filter(
    (pkg) => !creditsConfig.packs.some((pack) => pack.id === pkg.lookupKey),
  );
  if (unsupportedPackages.length) {
    throw new Error("The credits offering contains unsupported packages; owner review is required.");
  }
  for (const pack of creditsConfig.packs) {
    const pkg = unique(
      packSnapshot?.packages ?? [],
      (item) => item.lookupKey === pack.id,
      `credits package ${pack.id}`,
    );
    const matchingProducts = products.filter(
      (product) => product.type === "consumable" && product.store_identifier === pack.id,
    );
    if (
      !pkg ||
      !matchingProducts.length ||
      matchingProducts.some((product) => !pkg.productIds.includes(product.id)) ||
      pkg.productIds.some((id) => !matchingProducts.some((product) => product.id === id))
    ) {
      throw new Error(`Credits package ${pack.id} product links are missing or ambiguous.`);
    }
  }
  for (const plan of ["student", "pro"] as const) {
    const packageKey = `${plan}_monthly`;
    const pkg = unique(
      defaultSnapshot?.packages ?? [],
      (item) => item.lookupKey === packageKey,
      `default subscription package ${packageKey}`,
    );
    const matchingProducts = products.filter(
      (product) =>
        product.type === "subscription" &&
        expectedStoreIdentifier(product.store_identifier ?? "", plan),
    );
    if (
      !pkg ||
      !matchingProducts.length ||
      matchingProducts.some((product) => !pkg.productIds.includes(product.id))
    ) {
      throw new Error(`Default ${packageKey} product links are missing or ambiguous.`);
    }
  }
  const productIdsBefore = products.map((product) => product.id).sort();
  return {
    target: target.grants,
    classifiedProductIds: target.classifiedProductIds,
    products,
    offeringSnapshot,
    productIdsBefore,
    currencies,
  };
}

async function getPackageProductIds(projectId: string, packageId: string): Promise<string[]> {
  const items = await rcPages<Resource | ProductLink>(
    projectPath(projectId, `/packages/${encodeURIComponent(packageId)}/products`),
  );
  return items
    .flatMap((item) => {
      const product = (item as ProductLink).product;
      if (product?.id) return [product.id];
      const productId = (item as ProductLink).product_id;
      if (typeof productId === "string") return [productId];
      return typeof (item as Resource).id === "string" ? [(item as Resource).id] : [];
    })
    .sort();
}

async function loadEntry(libraryHash: string): Promise<MigrationEntry | undefined> {
  const result = await pool.query<{ data: unknown }>(
    "select data from classscribe_legacy_documents where path = $1 limit 1",
    [`${MIGRATION_PREFIX}${libraryHash}`],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const data = safeObject(row.data);
  const before = safeObject(data.before);
  const after = data.after === undefined ? undefined : safeObject(data.after);
  if (
    data.libraryHash !== libraryHash ||
    typeof data.customerId !== "string" ||
    data.idempotencyKey !== canonicalMigrationKey(libraryHash) ||
    typeof data.phase !== "string" ||
    !["prepared", "transfer-pending", "transfer-uncertain", "transferred", "verified"].includes(data.phase) ||
    !Number.isSafeInteger(before.CRD) ||
    Number(before.CRD) < 0 ||
    before.CREDITS !== 0 ||
    !Number.isSafeInteger(before.CREDITS) ||
    data.originalCrdBalance !== before.CRD ||
    !Number.isSafeInteger(data.ledgerTotalBefore) ||
    (after !== undefined &&
      (!Number.isSafeInteger(after.CRD) ||
        Number(after.CRD) < 0 ||
        !Number.isSafeInteger(after.CREDITS) ||
        Number(after.CREDITS) < 0)) ||
    (data.phase === "verified" &&
      (!after ||
        after.CRD !== 0 ||
        after.CREDITS !== data.originalCrdBalance))
  ) {
    throw new Error(`Stored migration entry for library ${libraryHash} is invalid.`);
  }
  return data as unknown as MigrationEntry;
}

async function saveEntry(entry: MigrationEntry): Promise<void> {
  await pool.query(
    `insert into classscribe_legacy_documents(path, data)
     values ($1, $2::jsonb)
     on conflict (path) do update set data = excluded.data, updated_at = now()`,
    [`${MIGRATION_PREFIX}${entry.libraryHash}`, JSON.stringify(entry)],
  );
}

async function ledgerTotalForLibrary(libraryHashes: string[]): Promise<number> {
  const result = await pool.query<{ total: string | number }>(
    "select coalesce(sum(amount), 0)::bigint as total from classscribe_credit_transactions where library_hash = any($1::text[])",
    [libraryHashes],
  );
  const total = Number(result.rows[0]?.total ?? 0);
  if (!Number.isSafeInteger(total)) {
    throw new Error(`Stored credit history is outside the safe integer range for library set ${libraryHashes.join(",")}.`);
  }
  return total;
}

async function inspectAndExecute(
  apply: boolean,
  verifiedReferenceLibraryHash?: string,
): Promise<void> {
  const projects = await rcPages<Resource>("/v2/projects?limit=100");
  const project = unique(projects, (item) => item.name === PROJECT_NAME, "ClassScribe project");
  if (!project) throw new Error("RevenueCat ClassScribe project was not found.");

  // All auth/readability, identity, balance, product-classification, and current
  // offering checks finish before the first database or provider mutation.
  const control = await migrationStateApi.getCreditsMigrationState();
  const accountsResult = await loadCanonicalAccounts();
  const [customers, catalog] = await Promise.all([
    inventoryCustomers(
      project.id,
      accountsResult.accounts,
      control.activeCurrency === "CREDITS" || control.maintenance,
    ),
    loadCatalog(project.id),
  ]);
  const entries = await Promise.all(customers.map(async (customer) => ({
    ...customer,
    entry: await loadEntry(customer.libraryHash),
  })));
  if (
    verifiedReferenceLibraryHash &&
    !entries.some((item) =>
      item.libraryHash === verifiedReferenceLibraryHash &&
      item.entry &&
      ["transfer-pending", "transfer-uncertain"].includes(item.entry.phase),
    )
  ) {
    throw new Error("The supplied provider-reference confirmation does not match a pending migration library.");
  }
  if (control.activeCurrency === "CREDITS" && !control.maintenance) {
    if (!control.serverSubscriptionGrantReady) {
      throw new Error("CREDITS is active but server subscription-grant readiness is false; owner review required.");
    }
    for (const item of entries) {
      if (item.entry && item.entry.phase !== "verified") {
        throw new Error(`Previously migrated balance did not verify for library ${item.libraryHash}.`);
      }
    }
    await verifyCatalogReadback(project.id, catalog);
    if (apply) {
      if (process.env.REVENUECAT_CREDITS_MIGRATION_WRITE_ACCESS_VERIFIED !== "yes") {
        throw new Error(
          "Archive apply blocked: owner must independently verify project-scoped RevenueCat write permissions. No writes were made.",
        );
      }
      await finishArchiveIfNeeded(project.id);
    }
    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      status: "already-migrated",
      activeCurrency: control.activeCurrency,
      serverSubscriptionGrantReady: control.serverSubscriptionGrantReady,
      libraryCount: customers.length,
      libraries: customers.map((item) => ({ libraryHash: item.libraryHash, crdBalance: item.before.CRD })),
    }, null, 2));
    return;
  }
  if (control.activeCurrency !== "CRD") {
    throw new Error("Migration control is in an unsupported currency state; owner review required.");
  }
  if (catalog.currencies.find((currency) => currency.code === "CRD")?.state !== "active") {
    throw new Error("The legacy CRD currency is not active while control state still selects CRD.");
  }

  for (const item of entries) {
    if (item.entry && item.entry.customerId !== item.customerId) {
      throw new Error(`Stored provider identity changed for library ${item.libraryHash}.`);
    }
    if (item.entry && !Number.isSafeInteger(item.entry.ledgerTotalBefore)) {
      throw new Error(`Stored ledger baseline is missing for library ${item.libraryHash}.`);
    }
    if (
      item.entry &&
      ["transfer-pending", "transfer-uncertain"].includes(item.entry.phase)
    ) {
      const externallyVerified =
        verifiedReferenceLibraryHash === item.libraryHash &&
        ["transfer-pending", "transfer-uncertain"].includes(item.entry.phase);
      if (apply && !externallyVerified) {
        throw new Error(
          `A pending/ambiguous transfer for library ${item.libraryHash} needs provider-reference verification before apply; no migration writes made.`,
        );
      }
    }
    if (!item.entry) {
      if (item.before.CREDITS !== 0) {
        throw new Error(`Library ${item.libraryHash} has pre-existing CREDITS; refusing to overwrite or double-count.`);
      }
      continue;
    }
    if (item.entry.phase === "prepared") {
      if (
        item.entry.before.CRD !== item.before.CRD ||
        item.entry.before.CREDITS !== item.before.CREDITS ||
        item.entry.before.CREDITS !== 0
      ) {
        throw new Error(`Balances changed after the migration baseline for library ${item.libraryHash}.`);
      }
    } else if (item.entry.phase === "transferred" || item.entry.phase === "verified") {
      if (!migrationMatches(
        item.before.CRD,
        item.before.CREDITS,
        item.entry.originalCrdBalance,
      )) {
        throw new Error(`Transferred balance did not verify for library ${item.libraryHash}; no migration writes made.`);
      }
    } else if (verifiedReferenceLibraryHash === item.libraryHash) {
      if (!migrationMatches(
        item.before.CRD,
        item.before.CREDITS,
        item.entry.originalCrdBalance,
      )) {
        throw new Error(`Provider reference was confirmed but final balances do not match for library ${item.libraryHash}.`);
      }
    }
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    status: "preflight-passed",
    project: PROJECT_NAME,
    currencyPlan: {
      source: "CRD",
      destination: "CREDITS",
      destinationName: CURRENCY_NAME,
      destinationCreateIfMissing: !catalog.currencies.some((item) => item.code === "CREDITS"),
      grants: catalog.target.map((grant) => ({
        productCount: grant.product_ids?.length ?? 0,
        amount: grant.amount,
        trialAmount: grant.trial_amount,
        expireAtCycleEnd: grant.expire_at_cycle_end,
      })),
      currentOfferingUnchanged: true,
      productIdsUnchanged: true,
    },
    libraryCount: entries.length,
    libraries: entries.map((item) => ({
      libraryHash: item.libraryHash,
      crdBalance: item.before.CRD,
      creditsBalance: item.before.CREDITS,
      phase: item.entry?.phase ?? (item.before.CRD === 0 ? "zero-balance" : "not-started"),
      idempotencyKey: canonicalMigrationKey(item.libraryHash),
    })),
    noLibraryIdentifiersOrProviderTokensLogged: true,
  };
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (process.env.REVENUECAT_CREDITS_MIGRATION_WRITE_ACCESS_VERIFIED !== "yes") {
    throw new Error(
      "Apply blocked: owner must first independently verify project-scoped RevenueCat customer transaction and virtual-currency write permissions. No database/provider writes were made.",
    );
  }
  if (control.maintenance && control.version === "invalid-control-record") {
    throw new Error("Malformed migration control state; owner review required.");
  }

  const maintenanceState: CreditsMigrationState = {
    maintenance: true,
    activeCurrency: "CRD",
    serverSubscriptionGrantReady: false,
    version: control.version,
  };
  await migrationStateApi.saveCreditsMigrationState(maintenanceState);
  await prepareCatalogForTransfers(project.id);

  for (const customer of entries) {
    let entry = customer.entry;
    if (!entry) {
      const ledgerTotalBefore = await ledgerTotalForLibrary(customer.sourceLibraryHashes);
      entry = {
        libraryHash: customer.libraryHash,
        customerId: customer.customerId,
        idempotencyKey: canonicalMigrationKey(customer.libraryHash),
        phase: "prepared",
        before: customer.before,
        originalCrdBalance: customer.before.CRD,
        ledgerTotalBefore,
        updatedAt: new Date().toISOString(),
      };
      await saveEntry(entry);
    }
    if (entry.phase === "verified") continue;
    if (entry.phase === "transferred") {
      const afterSuccessfulResponse = await providerBalances(project.id, customer.customerId);
      if (!migrationMatches(
        afterSuccessfulResponse.CRD,
        afterSuccessfulResponse.CREDITS,
        entry.originalCrdBalance,
      )) {
        throw new Error(`Successful transfer response has not reached the expected balances for library ${customer.libraryHash}; no transfer was repeated.`);
      }
      entry = {
        ...entry,
        phase: "verified",
        after: afterSuccessfulResponse,
        updatedAt: new Date().toISOString(),
      };
      await saveEntry(entry);
      continue;
    }
    if (
      verifiedReferenceLibraryHash === customer.libraryHash &&
      ["transfer-pending", "transfer-uncertain"].includes(entry.phase)
    ) {
      const externallyVerifiedBalance = await providerBalances(project.id, customer.customerId);
      if (!migrationMatches(
        externallyVerifiedBalance.CRD,
        externallyVerifiedBalance.CREDITS,
        entry.originalCrdBalance,
      )) {
        throw new Error(`Provider reference was confirmed but final balances do not match for library ${customer.libraryHash}.`);
      }
      entry = {
        ...entry,
        phase: "verified",
        after: externallyVerifiedBalance,
        updatedAt: new Date().toISOString(),
      };
      await saveEntry(entry);
      continue;
    }
    if (entry.originalCrdBalance === 0) {
      const current = await providerBalances(project.id, customer.customerId);
      if (current.CRD !== 0 || current.CREDITS !== 0) {
        throw new Error(`Zero-balance library ${customer.libraryHash} changed during migration.`);
      }
      entry = { ...entry, phase: "verified", after: current, updatedAt: new Date().toISOString() };
      await saveEntry(entry);
      continue;
    }
    assertTransferMayBeRetried(entry.phase, false);
    const current = await providerBalances(project.id, customer.customerId);
    if (
      current.CRD !== entry.before.CRD ||
      current.CREDITS !== entry.before.CREDITS ||
      current.CREDITS !== 0
    ) {
      throw new Error(`Balances changed after migration preflight for library ${customer.libraryHash}; no transfer was repeated.`);
    }
    entry = { ...entry, phase: "transfer-pending", updatedAt: new Date().toISOString() };
    await saveEntry(entry);
    const request = buildAtomicTransfer(customer.libraryHash, entry.originalCrdBalance);
    try {
      await rcRequest(
        projectPath(project.id, `/customers/${encodeURIComponent(customer.customerId)}/virtual_currencies/transactions`),
        "POST",
        request,
        {
          "content-type": "application/json",
          "Idempotency-Key": entry.idempotencyKey,
        },
      );
    } catch (error) {
      const outcome =
        error instanceof RevenueCatRequestError && error.status >= 400 && error.status < 500 &&
        error.status !== 408 && error.status !== 429
          ? "definitive-rejection"
          : "ambiguous";
      entry = {
        ...entry,
        phase: transferPhaseAfterRequest(outcome),
        errorCode: error instanceof RevenueCatRequestError ? `http_${error.status}` : "transport_outcome_unknown",
        updatedAt: new Date().toISOString(),
      };
      await saveEntry(entry);
      if (error instanceof RevenueCatRequestError && (error.status === 401 || error.status === 403)) {
        throw new Error("RevenueCat authorization failed during transfer; migration is paused for owner review.");
      }
      throw new Error(
        outcome === "ambiguous"
          ? `Transfer outcome is ambiguous for library ${customer.libraryHash}. It will not be retried without provider history reference verification.`
          : `RevenueCat rejected the transfer for library ${customer.libraryHash}; migration stopped.`,
      );
    }
    entry = { ...entry, phase: "transferred", updatedAt: new Date().toISOString() };
    await saveEntry(entry);
    const after = await providerBalances(project.id, customer.customerId);
    if (!migrationMatches(after.CRD, after.CREDITS, entry.originalCrdBalance)) {
      throw new Error(`Post-transfer balances did not verify for library ${customer.libraryHash}; maintenance remains active.`);
    }
    entry = { ...entry, phase: "verified", after, updatedAt: new Date().toISOString() };
    await saveEntry(entry);
  }

  for (const item of entries) {
    const entry = await loadEntry(item.libraryHash);
    if (!entry || entry.phase !== "verified") {
      throw new Error(`Library ${item.libraryHash} has not completed balance verification.`);
    }
    const beforeCatalog = await providerBalances(project.id, entry.customerId);
    if (!migrationMatches(beforeCatalog.CRD, beforeCatalog.CREDITS, entry.originalCrdBalance)) {
      throw new Error(`Pre-catalog balance verification failed for library ${item.libraryHash}; maintenance remains active.`);
    }
  }

  await applyCatalogPlan(project.id, catalog);
  for (const item of entries) {
    const entry = await loadEntry(item.libraryHash);
    if (!entry || entry.phase !== "verified") {
      throw new Error(`Library ${item.libraryHash} has not completed balance verification.`);
    }
    const after = await providerBalances(project.id, entry.customerId);
    if (!migrationMatches(after.CRD, after.CREDITS, entry.originalCrdBalance)) {
      throw new Error(`Final balance verification failed for library ${item.libraryHash}; maintenance remains active.`);
    }
    entry.after = after;
    entry.updatedAt = new Date().toISOString();
    await saveEntry(entry);
  }

  const catalogStatus = await verifyCatalogReadback(project.id, catalog);
  assertMigrationCutoverReady({
    allBalancesVerified: true,
    catalogReadbackVerified: catalogStatus.catalogReadbackVerified,
    subscriptionGrantsAbsent: catalogStatus.subscriptionGrantsAbsent,
  });
  const nextVersion = `credits-v2-${sha256(`${control.version}:${new Date().toISOString()}`).slice(0, 16)}`;
  await migrationStateApi.saveCreditsMigrationState({
    maintenance: false,
    activeCurrency: "CREDITS",
    serverSubscriptionGrantReady: true,
    version: nextVersion,
  });
  await finishArchiveIfNeeded(project.id);
  console.log(JSON.stringify({
    mode: "apply",
    status: "verified",
    activeCurrency: "CREDITS",
    stateVersion: nextVersion,
    libraryCount: entries.length,
    allBalancesVerified: true,
    catalogReadbackVerified: true,
    archivedCurrencyState: "inactive",
  }, null, 2));
}

async function applyCatalogPlan(
  projectId: string,
  before: GrantClassification,
): Promise<{ catalogReadbackVerified: boolean; subscriptionGrantsAbsent: boolean }> {
  const credits = await rcRequest<Resource>(
    projectPath(projectId, "/virtual_currencies/CREDITS"),
  );
  if (credits.name !== CURRENCY_NAME || credits.state === "inactive") {
    throw new Error("CREDITS readback failed before product grants were applied.");
  }
  await rcRequest(
    projectPath(projectId, "/virtual_currencies/CREDITS"),
    "POST",
    { name: CURRENCY_NAME, product_grants: before.target },
  );

  return verifyCatalogReadback(projectId, before);
}

async function prepareCatalogForTransfers(projectId: string): Promise<void> {
  const currencies = await rcPages<Resource>(
    projectPath(projectId, "/virtual_currencies?limit=100"),
  );
  const existingCredits = unique(currencies, (item) => item.code === "CREDITS", "CREDITS currency");
  if (!existingCredits) {
    await rcRequest(
      projectPath(projectId, "/virtual_currencies"),
      "POST",
      {
        code: "CREDITS",
        name: CURRENCY_NAME,
        description: "ClassScribe Scribe Credits.",
      },
    );
  }
  // Pause product grants in both currencies while customer balances move. The
  // source grants are detached before transfers; target grants are restored only
  // after every transfer is verified.
  await rcRequest(
    projectPath(projectId, "/virtual_currencies/CREDITS"),
    "POST",
    { name: CURRENCY_NAME, product_grants: [] },
  );
  await rcRequest(
    projectPath(projectId, "/virtual_currencies/CRD"),
    "POST",
    { name: CURRENCY_NAME, product_grants: [] },
  );
  const after = await rcPages<Resource>(
    projectPath(projectId, "/virtual_currencies?limit=100"),
  );
  const oldCurrency = unique(after, (item) => item.code === "CRD", "CRD currency after detachment");
  const targetCurrency = unique(after, (item) => item.code === "CREDITS", "CREDITS currency after detachment");
  if (
    !oldCurrency ||
    !targetCurrency ||
    (oldCurrency.product_grants ?? []).length ||
    (targetCurrency.product_grants ?? []).length
  ) {
    throw new Error("Product-grant detachment did not verify; maintenance remains active.");
  }
}

async function verifyCatalogReadback(
  projectId: string,
  before: GrantClassification,
): Promise<{ catalogReadbackVerified: boolean; subscriptionGrantsAbsent: boolean }> {
  const currencies = await rcPages<Resource>(projectPath(projectId, "/virtual_currencies?limit=100"));
  const verifiedOld = unique(currencies, (item) => item.code === "CRD", "verified CRD");
  const verifiedCredits = unique(currencies, (item) => item.code === "CREDITS", "verified CREDITS");
  if (
    !verifiedOld ||
    !verifiedCredits ||
    verifiedOld.name !== CURRENCY_NAME ||
    verifiedCredits.name !== CURRENCY_NAME ||
    (verifiedOld.state !== "active" && verifiedOld.state !== "inactive") ||
    verifiedCredits.state !== "active" ||
    (verifiedOld.product_grants ?? []).length !== 0 ||
    JSON.stringify(normalizeGrants(verifiedCredits.product_grants)) !==
      JSON.stringify(normalizeGrants(before.target))
  ) {
    throw new Error("Virtual-currency product-grant catalog readback did not match.");
  }
  const productById = new Map(before.products.map((product) => [product.id, product]));
  if ((verifiedCredits.product_grants ?? []).some((grant) =>
    (grant.product_ids ?? []).some((productId) => productById.get(productId)?.type === "subscription"),
  )) {
    throw new Error("CREDITS still has a subscription product grant; server grants must be authoritative.");
  }
  const [products, offerings] = await Promise.all([
    rcPages<Resource>(projectPath(projectId, "/products?limit=100")),
    rcPages<Resource>(projectPath(projectId, "/offerings?limit=100")),
  ]);
  const productSignature = (items: Resource[]) => items
    .map((item) => [
      item.id,
      item.app_id ?? "",
      item.store_identifier ?? "",
      item.type ?? "",
      item.state ?? "",
    ].join("\u0000"))
    .sort()
    .join("\u0001");
  if (
    products.map((item) => item.id).sort().join(",") !== before.productIdsBefore.join(",") ||
    productSignature(products) !== productSignature(before.products)
  ) {
    throw new Error("Catalog readback found a changed product inventory.");
  }
  const current = offerings.filter((item) => item.is_current === true);
  if (current.length !== 1 || current[0]?.lookup_key !== "default") {
    throw new Error("The current subscription offering changed during currency migration.");
  }
  for (const expected of before.offeringSnapshot) {
    const offering = offerings.find((item) => item.id === expected.id);
    if (!offering || offering.is_current !== expected.current) {
      throw new Error("A RevenueCat offering changed during currency migration.");
    }
    const packages = await rcPages<Resource>(
      projectPath(projectId, `/offerings/${encodeURIComponent(expected.id)}/packages?limit=100`),
    );
    if (packages.map((item) => item.id).sort().join(",") !== expected.packageIds.join(",")) {
      throw new Error("Offering package readback did not match the preflight snapshot.");
    }
    for (const expectedPackage of expected.packages) {
      const productIds = await getPackageProductIds(projectId, expectedPackage.id);
      if (productIds.join(",") !== expectedPackage.productIds.join(",")) {
        throw new Error("Package product links changed during currency migration.");
      }
    }
  }
  return {
    catalogReadbackVerified: true,
    subscriptionGrantsAbsent: true,
  };
}

function normalizeGrants(grants: CatalogProductGrant[] | undefined): unknown[] {
  return (grants ?? [])
    .map((grant) => ({
      product_ids: [...(grant.product_ids ?? [])].sort(),
      amount: grant.amount,
      trial_amount: grant.trial_amount,
      expire_at_cycle_end: grant.expire_at_cycle_end,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

async function finishArchiveIfNeeded(projectId: string): Promise<void> {
  const path = projectPath(projectId, "/virtual_currencies/CRD");
  const current = await rcRequest<Resource>(path);
  if (current.state === "inactive") return;
  if (current.state !== "active" || (current.product_grants ?? []).length !== 0) {
    throw new Error("CRD is not in a verified archivable state; it was not archived.");
  }
  await rcRequest(
    projectPath(projectId, "/virtual_currencies/CRD/actions/archive"),
    "POST",
  );
  const archived = await rcRequest<Resource>(path);
  if (archived.state !== "inactive") {
    throw new Error("RevenueCat did not verify CRD as inactive after archive.");
  }
}

async function main(): Promise<void> {
  if (
    creditsConfig.currency.code !== "CRD" ||
    creditsConfig.currency.name !== CURRENCY_NAME ||
    creditsConfig.packs.length !== 3 ||
    creditsConfig.offeringIdentifier !== "credits" ||
    creditsConfig.monthlyBonus.student !== 10 ||
    creditsConfig.monthlyBonus.pro !== 30 ||
    creditsConfig.packs.some((pack) =>
      !Number.isSafeInteger(pack.credits) ||
      pack.credits <= 0 ||
      !Number.isSafeInteger(pack.priceCents) ||
      pack.priceCents <= 0
    ) ||
    JSON.stringify(
      creditsConfig.packs
        .map((pack) => [pack.id, pack.credits])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ) !== JSON.stringify([
      ["credits_10", 10],
      ["credits_30", 30],
      ["credits_75", 75],
    ])
  ) {
    throw new Error("Credits configuration does not match the guarded migration plan.");
  }
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const referenceArg = args.find((arg) => arg.startsWith("--verified-reference="));
  const verifiedReferenceLibraryHash = referenceArg?.slice("--verified-reference=".length);
  const unknownArgs = args.filter((arg) =>
    arg !== "--apply" && !arg.startsWith("--verified-reference="),
  );
  if (unknownArgs.length) throw new Error(`Unsupported argument: ${unknownArgs[0]}`);
  if (referenceArg && (!verifiedReferenceLibraryHash || !/^[a-f0-9]{64}$/.test(verifiedReferenceLibraryHash))) {
    throw new Error("--verified-reference requires the 64-character canonical library hash.");
  }
  if (referenceArg && !apply) {
    throw new Error("--verified-reference can only be used together with explicit --apply.");
  }
  await inspectAndExecute(apply, verifiedReferenceLibraryHash);
}

main().catch((error: unknown) => {
  if (error instanceof RevenueCatRequestError) {
    if (error.status === 401 || error.status === 403) {
      console.error(`ClassScribe migration stopped: RevenueCat returned HTTP ${error.status} for ${error.method} ${error.path}; no apply-stage writes were made.`);
    } else {
      console.error(`ClassScribe migration stopped: RevenueCat returned HTTP ${error.status} for ${error.method} ${error.path}.`);
    }
  } else {
    console.error(
      "ClassScribe migration stopped:",
      error instanceof Error ? error.message : "Unknown error.",
    );
  }
  process.exitCode = 1;
});