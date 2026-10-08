import { writeFile } from "node:fs/promises";
import {
  getRevenueCatPages,
  revenueCatRequest,
} from "./revenuecatClient";

const PROJECT_NAME = "ClassScribe";
const OFFERING_LOOKUP_KEY = "default";
const ENTITLEMENTS = [
  { key: "classscribe_student", name: "ClassScribe Student" },
  { key: "classscribe_pro", name: "ClassScribe Pro" },
] as const;
const PLANS = [
  {
    key: "student",
    name: "ClassScribe Student",
    identifier: "classscribe_student_monthly",
    amountMicros: 7_990_000,
    entitlement: "classscribe_student",
    packageKey: "student_monthly",
  },
  {
    key: "pro",
    name: "ClassScribe Pro",
    identifier: "classscribe_pro_monthly",
    amountMicros: 12_990_000,
    entitlement: "classscribe_pro",
    packageKey: "pro_monthly",
  },
] as const;

type RevenueCatResource = {
  id: string;
  name?: string;
  lookup_key?: string;
  type?: string;
  app_id?: string;
  store_identifier?: string;
  is_current?: boolean;
  key?: string;
};

function projectPath(projectId: string, suffix: string): string {
  return `/v2/projects/${encodeURIComponent(projectId)}${suffix}`;
}

async function ensureProject(): Promise<RevenueCatResource> {
  const projects = await getRevenueCatPages<RevenueCatResource>(
    "/v2/projects?limit=100",
  );
  const existing = projects.find((project) => project.name === PROJECT_NAME);
  if (existing) return existing;
  return revenueCatRequest<RevenueCatResource>("/v2/projects", "POST", {
    name: PROJECT_NAME,
  });
}

async function ensureApp(
  projectId: string,
  apps: RevenueCatResource[],
  type: "test_store" | "app_store" | "play_store",
): Promise<RevenueCatResource> {
  const existing = apps.find((app) => app.type === type);
  if (existing) return existing;

  const appDetails =
    type === "app_store"
      ? {
          name: "ClassScribe iOS",
          type,
          app_store: { bundle_id: "com.classscribe.app" },
        }
      : type === "play_store"
        ? {
            name: "ClassScribe Android",
            type,
            play_store: { package_name: "com.edmitainvest.classscribe" },
          }
        : { name: "ClassScribe Test Store", type };

  return revenueCatRequest<RevenueCatResource>(
    projectPath(projectId, "/apps"),
    "POST",
    appDetails,
  );
}

async function ensureProduct(
  projectId: string,
  products: RevenueCatResource[],
  app: RevenueCatResource,
  plan: (typeof PLANS)[number],
  store: "test_store" | "app_store" | "play_store",
): Promise<RevenueCatResource> {
  const storeIdentifier =
    store === "play_store"
      ? `${plan.identifier}:monthly`
      : plan.identifier;
  const existing = products.find(
    (product) =>
      product.app_id === app.id &&
      product.store_identifier === storeIdentifier,
  );
  if (existing) return existing;

  return revenueCatRequest<RevenueCatResource>(
    projectPath(projectId, "/products"),
    "POST",
    {
      app_id: app.id,
      store_identifier: storeIdentifier,
      type: "subscription",
      display_name: plan.name,
      ...(store === "test_store"
        ? {
            subscription: { duration: "P1M" },
            title: plan.name,
          }
        : {}),
    },
  );
}

async function ensureEntitlement(
  projectId: string,
  lookupKey: string,
  displayName: string,
  entitlements: RevenueCatResource[],
): Promise<RevenueCatResource> {
  const existing = entitlements.find(
    (entitlement) => entitlement.lookup_key === lookupKey,
  );
  if (existing) return existing;
  return revenueCatRequest<RevenueCatResource>(
    projectPath(projectId, "/entitlements"),
    "POST",
    { lookup_key: lookupKey, display_name: displayName },
  );
}

async function attachProductsToEntitlement(
  projectId: string,
  entitlement: RevenueCatResource,
  productIds: string[],
): Promise<void> {
  try {
    await revenueCatRequest(
      projectPath(
        projectId,
        `/entitlements/${encodeURIComponent(entitlement.id)}/actions/attach_products`,
      ),
      "POST",
      { product_ids: productIds },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /already|cannot attach|unprocessable/i.test(error.message)
    ) {
      return;
    }
    throw error;
  }
}

async function ensureOffering(
  projectId: string,
  offerings: RevenueCatResource[],
): Promise<RevenueCatResource> {
  let offering = offerings.find(
    (offering) => offering.lookup_key === OFFERING_LOOKUP_KEY,
  );
  if (!offering) {
    offering = await revenueCatRequest<RevenueCatResource>(
      projectPath(projectId, "/offerings"),
      "POST",
      {
        lookup_key: OFFERING_LOOKUP_KEY,
        display_name: "ClassScribe plans",
      },
    );
  }
  if (offering.is_current) return offering;
  return revenueCatRequest<RevenueCatResource>(
    projectPath(projectId, `/offerings/${encodeURIComponent(offering.id)}`),
    "PATCH",
    { is_current: true },
  );
}

async function ensurePackage(
  projectId: string,
  offering: RevenueCatResource,
  packages: RevenueCatResource[],
  plan: (typeof PLANS)[number],
): Promise<RevenueCatResource> {
  const existing = packages.find(
    (item) => item.lookup_key === plan.packageKey,
  );
  if (existing) return existing;
  return revenueCatRequest<RevenueCatResource>(
    projectPath(
      projectId,
      `/offerings/${encodeURIComponent(offering.id)}/packages`,
    ),
    "POST",
    {
      lookup_key: plan.packageKey,
      display_name: `${plan.name} monthly`,
    },
  );
}

async function attachProductsToPackage(
  projectId: string,
  pkg: RevenueCatResource,
  productIds: string[],
): Promise<void> {
  try {
    await revenueCatRequest(
      projectPath(
        projectId,
        `/packages/${encodeURIComponent(pkg.id)}/actions/attach_products`,
      ),
      "POST",
      {
        products: productIds.map((product_id) => ({
          product_id,
          eligibility_criteria: "all",
        })),
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /already|cannot attach|unprocessable/i.test(error.message)
    ) {
      return;
    }
    throw error;
  }
}

async function ensureTestStorePrice(
  projectId: string,
  productId: string,
  amountMicros: number,
): Promise<void> {
  try {
    await revenueCatRequest(
      projectPath(
        projectId,
        `/products/${encodeURIComponent(productId)}/test_store_prices`,
      ),
      "POST",
      { prices: [{ amount_micros: amountMicros, currency: "USD" }] },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /already exists|resource_already_exists/i.test(error.message)
    ) {
      return;
    }
    throw error;
  }
}

async function getPublicApiKey(
  projectId: string,
  appId: string,
): Promise<string> {
  const keys = await getRevenueCatPages<RevenueCatResource>(
    projectPath(
      projectId,
      `/apps/${encodeURIComponent(appId)}/public_api_keys?limit=100`,
    ),
  );
  const key = keys.find((item) => typeof item.key === "string")?.key;
  if (!key) {
    throw new Error(`RevenueCat has no public API key configured for app ${appId}.`);
  }
  return key;
}

async function seedClassScribeRevenueCat(): Promise<void> {
  const project = await ensureProject();
  const projectId = project.id;
  const apps = await getRevenueCatPages<RevenueCatResource>(
    projectPath(projectId, "/apps?limit=100"),
  );
  const testStore = await ensureApp(projectId, apps, "test_store");
  const appStore = await ensureApp(projectId, apps, "app_store");
  const playStore = await ensureApp(projectId, apps, "play_store");
  const products = await getRevenueCatPages<RevenueCatResource>(
    projectPath(projectId, "/products?limit=100"),
  );
  const productsByPlan = new Map<
    (typeof PLANS)[number]["key"],
    RevenueCatResource[]
  >();

  for (const plan of PLANS) {
    const planProducts = [
      await ensureProduct(projectId, products, testStore, plan, "test_store"),
      await ensureProduct(projectId, products, appStore, plan, "app_store"),
      await ensureProduct(projectId, products, playStore, plan, "play_store"),
    ];
    productsByPlan.set(plan.key, planProducts);
    await ensureTestStorePrice(
      projectId,
      planProducts[0].id,
      plan.amountMicros,
    );
  }

  const entitlements = await getRevenueCatPages<RevenueCatResource>(
    projectPath(projectId, "/entitlements?limit=100"),
  );
  for (const entitlementConfig of ENTITLEMENTS) {
    const entitlement = await ensureEntitlement(
      projectId,
      entitlementConfig.key,
      entitlementConfig.name,
      entitlements,
    );
    const plan = PLANS.find(
      (item) => item.entitlement === entitlementConfig.key,
    );
    if (!plan) throw new Error(`No plan configured for ${entitlementConfig.key}.`);
    await attachProductsToEntitlement(
      projectId,
      entitlement,
      (productsByPlan.get(plan.key) ?? []).map((product) => product.id),
    );
  }

  const offerings = await getRevenueCatPages<RevenueCatResource>(
    projectPath(projectId, "/offerings?limit=100"),
  );
  const offering = await ensureOffering(projectId, offerings);
  const packages = await getRevenueCatPages<RevenueCatResource>(
    projectPath(
      projectId,
      `/offerings/${encodeURIComponent(offering.id)}/packages?limit=100`,
    ),
  );
  for (const plan of PLANS) {
    const pkg = await ensurePackage(projectId, offering, packages, plan);
    await attachProductsToPackage(
      projectId,
      pkg,
      (productsByPlan.get(plan.key) ?? []).map((product) => product.id),
    );
  }

  const publicKeys = {
    EXPO_PUBLIC_REVENUECAT_TEST_API_KEY: await getPublicApiKey(
      projectId,
      testStore.id,
    ),
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: await getPublicApiKey(
      projectId,
      appStore.id,
    ),
    EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: await getPublicApiKey(
      projectId,
      playStore.id,
    ),
  };
  const keysOutputPath = process.env.REVENUECAT_PUBLIC_KEYS_OUTPUT_PATH;
  if (keysOutputPath) {
    await writeFile(keysOutputPath, JSON.stringify(publicKeys), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  console.log(
    JSON.stringify({
      status: "configured",
      projectId,
      testStoreAppId: testStore.id,
      appStoreAppId: appStore.id,
      playStoreAppId: playStore.id,
      entitlementIds: ENTITLEMENTS.map((item) => item.key),
      productIds: Object.fromEntries(
        [...productsByPlan.entries()].map(([key, items]) => [
          key,
          items.map((item) => item.id),
        ]),
      ),
      offeringId: offering.id,
      packageIds: packages.map((item) => item.id),
      appStorePricesConfigured: false,
      playStorePricesConfigured: false,
      publicKeysWritten: Boolean(keysOutputPath),
    }),
  );
}

seedClassScribeRevenueCat().catch((error: unknown) => {
  console.error(
    "ClassScribe RevenueCat setup failed:",
    error instanceof Error ? error.message : "Unknown RevenueCat API error",
  );
  process.exitCode = 1;
});