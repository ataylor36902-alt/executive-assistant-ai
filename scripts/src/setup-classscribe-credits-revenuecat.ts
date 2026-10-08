import { getRevenueCatPages, revenueCatRequest } from "./revenuecatClient";

const PROJECT_NAME = "ClassScribe";
const CURRENCY = { code: "CRD", name: "Scribe Credits" } as const;
type ServerCreditsConfig = {
  currency: { code: string; name: string };
  offeringIdentifier: string;
  packs: {
    id: string;
    credits: number;
    priceCents: number;
    name: string;
    label: string;
  }[];
  monthlyBonus: { student: number; pro: number };
};
const creditsConfigUrl = new URL(
  "../../artifacts/api-server/src/lib/credits-config.ts",
  import.meta.url,
).href;
const { creditsConfig } = (await import(creditsConfigUrl)) as {
  creditsConfig: ServerCreditsConfig;
};
const CREDIT_PACKS = creditsConfig.packs.map((pack) => ({
  key: pack.id,
  productDisplayName: pack.name,
  packageDisplayName: pack.label
    ? `${pack.name} (${pack.label})`
    : pack.name,
  amount: pack.credits,
  amountMicros: pack.priceCents * 10_000,
}));
const SUBSCRIPTION_PLANS = [
  {
    testStoreIdentifier: "student_monthly",
    appStoreIdentifier: "classscribe_student_monthly",
    playStoreIdentifier: "classscribe_student_monthly:monthly",
    amount: creditsConfig.monthlyBonus.student,
  },
  {
    testStoreIdentifier: "pro_monthly",
    appStoreIdentifier: "classscribe_pro_monthly",
    playStoreIdentifier: "classscribe_pro_monthly:monthly",
    amount: creditsConfig.monthlyBonus.pro,
  },
] as const;

type Resource = {
  id: string;
  name?: string;
  display_name?: string;
  lookup_key?: string;
  type?: string;
  app_id?: string;
  app_user_id?: string;
  store_identifier?: string;
  is_current?: boolean;
  state?: string;
  code?: string;
  product_grants?: ProductGrant[];
  subscription?: { duration?: string | null };
};
type ProductGrant = {
  product_ids?: string[];
  amount?: number;
  trial_amount?: number;
  expire_at_cycle_end?: boolean;
};
type ProductLink = { product?: Resource; product_id?: string };
type ProductList = { items?: Array<Resource | ProductLink> };
type Price = { amount_micros?: number; currency?: string };
type ProductTarget = {
  product: Resource;
  amount: number;
  kind: "credit_pack" | "subscription";
  priceMicros?: number;
  expireAtCycleEnd: boolean;
};

const projectPath = (projectId: string, suffix: string) =>
  `/v2/projects/${encodeURIComponent(projectId)}${suffix}`;

function readProductLinks(list: ProductList): Resource[] {
  return (list.items ?? []).flatMap((entry) => {
    if ("product" in entry && entry.product) return [entry.product];
    if ("id" in entry) return [entry];
    return [];
  });
}

async function getProductLinks(
  projectId: string,
  resource: "packages",
  resourceId: string,
): Promise<Resource[]> {
  return readProductLinks(
    await revenueCatRequest<ProductList>(
      projectPath(
        projectId,
        `/${resource}/${encodeURIComponent(resourceId)}/products`,
      ),
    ),
  );
}

async function getTestStorePrices(
  projectId: string,
  productId: string,
): Promise<Price[]> {
  const prices = await revenueCatRequest<Price[]>(
    projectPath(
      projectId,
      `/products/${encodeURIComponent(productId)}/test_store_prices`,
    ),
  );
  return Array.isArray(prices) ? prices : [];
}

function assertUniqueMatch<T>(
  items: T[],
  predicate: (item: T) => boolean,
  description: string,
): T | undefined {
  const matches = items.filter(predicate);
  if (matches.length > 1) {
    throw new Error(`Multiple catalog entries match ${description}; no writes made.`);
  }
  return matches[0];
}

function verifyExistingGrantIsManaged(
  grant: ProductGrant,
  managedProductIds: Set<string>,
): void {
  const grantProductIds = grant.product_ids ?? [];
  if (
    grantProductIds.length === 0 ||
    grantProductIds.some((productId) => !managedProductIds.has(productId))
  ) {
    throw new Error(
      "CRD already grants currency to products outside this setup; refusing to replace its grants.",
    );
  }
}

function serializeGrant(grant: ProductTarget): ProductGrant {
  return {
    product_ids: [grant.product.id],
    amount: grant.amount,
    trial_amount: 0,
    expire_at_cycle_end: grant.expireAtCycleEnd,
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  if (
    !CREDIT_PACKS.length ||
    CREDIT_PACKS.some(
      (pack) =>
        !pack.key ||
        !pack.productDisplayName ||
        !Number.isSafeInteger(pack.amount) ||
        pack.amount < 1 ||
        !Number.isSafeInteger(pack.amountMicros) ||
        pack.amountMicros < 1,
    ) ||
    new Set(CREDIT_PACKS.map((pack) => pack.key)).size !==
      CREDIT_PACKS.length ||
    !Number.isSafeInteger(SUBSCRIPTION_PLANS[0].amount) ||
    SUBSCRIPTION_PLANS[0].amount < 1 ||
    !Number.isSafeInteger(SUBSCRIPTION_PLANS[1].amount) ||
    SUBSCRIPTION_PLANS[1].amount < 1
  ) {
    throw new Error("The server credits configuration has invalid pack or bonus values.");
  }
  if (
    apply &&
    (creditsConfig.currency.code !== CURRENCY.code ||
      creditsConfig.currency.name !== CURRENCY.name)
  ) {
    throw new Error(
      `Server credits config uses currency ${creditsConfig.currency.code} (${creditsConfig.currency.name}), but the verified RevenueCat setup uses ${CURRENCY.code} (${CURRENCY.name}); reconcile the currency before applying any further changes.`,
    );
  }
  const projects = await getRevenueCatPages<Resource>("/v2/projects?limit=100");
  const project = projects.find((item) => item.name === PROJECT_NAME);
  if (!project) throw new Error(`RevenueCat project ${PROJECT_NAME} was not found.`);

  const [apps, products, offerings, currencies] = await Promise.all([
    getRevenueCatPages<Resource>(projectPath(project.id, "/apps?limit=100")),
    getRevenueCatPages<Resource>(
      projectPath(project.id, "/products?limit=100"),
    ),
    getRevenueCatPages<Resource>(
      projectPath(project.id, "/offerings?limit=100"),
    ),
    getRevenueCatPages<Resource>(
      projectPath(project.id, "/virtual_currencies?limit=100"),
    ),
  ]);
  const appByType = new Map(apps.map((app) => [app.type, app]));
  const testStore = appByType.get("test_store");
  const appStore = appByType.get("app_store");
  const playStore = appByType.get("play_store");
  if (!testStore) throw new Error("ClassScribe Test Store is missing; no writes made.");

  const subscriptionOffering = assertUniqueMatch(
    offerings,
    (item) => item.lookup_key === "default" && item.is_current === true,
    "the current default subscription offering",
  );
  if (!subscriptionOffering) {
    throw new Error(
      "The current default subscription offering is missing; no writes made.",
    );
  }
  const creditsOffering = assertUniqueMatch(
    offerings,
    (item) => item.lookup_key === creditsConfig.offeringIdentifier,
    `offering ${creditsConfig.offeringIdentifier}`,
  );
  if (creditsOffering?.is_current) {
    throw new Error(
      "The credits offering is current; refusing to alter the current subscription offering.",
    );
  }
  const subscriptionPackages = await getRevenueCatPages<Resource>(
    projectPath(
      project.id,
      `/offerings/${encodeURIComponent(subscriptionOffering.id)}/packages?limit=100`,
    ),
  );
  const packages = creditsOffering
    ? await getRevenueCatPages<Resource>(
        projectPath(
          project.id,
          `/offerings/${encodeURIComponent(creditsOffering.id)}/packages?limit=100`,
        ),
      )
    : [];
  for (const pkg of packages) {
    if (!CREDIT_PACKS.some((pack) => pack.key === pkg.lookup_key)) {
      throw new Error(
        `Credits offering contains unmanaged package ${pkg.lookup_key}; no writes made.`,
      );
    }
  }
  for (const key of ["student_monthly", "pro_monthly"]) {
    if (!subscriptionPackages.some((item) => item.lookup_key === key)) {
      throw new Error(
        `Current subscription offering is missing ${key}; no writes made to avoid disrupting existing plans.`,
      );
    }
  }

  const existingCurrency = assertUniqueMatch(
    currencies,
    (item) => item.code === CURRENCY.code,
    `currency ${CURRENCY.code}`,
  );
  const targets: ProductTarget[] = [];
  const packProducts: Array<{
    pack: (typeof CREDIT_PACKS)[number];
    product: Resource;
    prices: Price[];
    pkg?: Resource;
    attachedProducts: Resource[];
  }> = [];

  for (const pack of CREDIT_PACKS) {
    const product = assertUniqueMatch(
      products,
      (item) =>
        item.app_id === testStore.id &&
        item.store_identifier === pack.key,
      `Test Store product ${pack.key}`,
    );
    if (
      product &&
      (product.type !== "consumable" || product.state === "inactive")
    ) {
      throw new Error(
        `Existing Test Store ${pack.key} is not an active one-time product; no writes made.`,
      );
    }
    const prices = product
      ? await getTestStorePrices(project.id, product.id)
      : [];
    const usdPrices = prices.filter((price) => price.currency === "USD");
    if (usdPrices.some((price) => price.amount_micros !== pack.amountMicros)) {
      throw new Error(
        `Existing Test Store product ${pack.key} has a conflicting immutable USD price; no writes made.`,
      );
    }
    const pkg = packages.find((item) => item.lookup_key === pack.key);
    const attachedProducts = pkg
      ? await getProductLinks(project.id, "packages", pkg.id)
      : [];
    if (
      pkg &&
      attachedProducts.some(
        (attached) =>
          attached.app_id === testStore.id && attached.id !== product?.id,
      )
    ) {
      throw new Error(
        `Current offering package ${pack.key} already has a different Test Store product; no writes made.`,
      );
    }
    if (product) {
      targets.push({
        product,
        amount: pack.amount,
        kind: "credit_pack",
        priceMicros: pack.amountMicros,
        expireAtCycleEnd: false,
      });
    }
    packProducts.push({ pack, product: product!, prices, pkg, attachedProducts });
  }

  for (const pack of CREDIT_PACKS) {
    for (const [app, storeIdentifier] of [
      [appStore, pack.key],
      [playStore, pack.key],
    ] as const) {
      if (!app) continue;
      const product = assertUniqueMatch(
        products,
        (item) =>
          item.app_id === app.id &&
          item.store_identifier === storeIdentifier,
        `${app.type} one-time product ${storeIdentifier}`,
      );
      if (!product) continue;
      if (product.type !== "consumable" || product.state === "inactive") {
        throw new Error(
          `Existing ${app.type} ${storeIdentifier} is not an active one-time product; no writes made.`,
        );
      }
      targets.push({
        product,
        amount: pack.amount,
        kind: "credit_pack",
        priceMicros: pack.amountMicros,
        expireAtCycleEnd: false,
      });
    }
  }

  for (const plan of SUBSCRIPTION_PLANS) {
    const identifiersByApp = [
      [testStore, plan.testStoreIdentifier],
      [appStore, plan.appStoreIdentifier],
      [playStore, plan.playStoreIdentifier],
    ] as const;
    for (const [app, storeIdentifier] of identifiersByApp) {
      if (!app) continue;
      const product = assertUniqueMatch(
        products,
        (item) =>
          item.app_id === app.id &&
          item.store_identifier === storeIdentifier,
        `${app.type} subscription ${storeIdentifier}`,
      );
      if (
        !product ||
        product.type !== "subscription" ||
        product.state === "inactive" ||
        (app.type === "test_store" &&
          product.subscription?.duration !== "P1M")
      ) {
        throw new Error(
          `Expected active monthly ${app.type} subscription ${storeIdentifier}; no writes made.`,
        );
      }
      targets.push({
        product,
        amount: plan.amount,
        kind: "subscription",
        expireAtCycleEnd: false,
      });
    }
  }

  for (const pack of CREDIT_PACKS) {
    const product = products.find(
      (item) =>
        item.app_id === testStore.id &&
        item.store_identifier === pack.key,
    );
    if (!product) continue;
    const pkg = packages.find((item) => item.lookup_key === pack.key);
    if (pkg) continue;
    const conflictingPackage = packages.find(
      (item) =>
        item.lookup_key === pack.key ||
        item.display_name === pack.packageDisplayName,
    );
    if (conflictingPackage) {
      throw new Error(
        `Current offering has an ambiguous package for ${pack.key}; no writes made.`,
      );
    }
  }

  const managedProductIds = new Set(targets.map(({ product }) => product.id));
  if (existingCurrency) {
    for (const grant of existingCurrency.product_grants ?? []) {
      verifyExistingGrantIsManaged(grant, managedProductIds);
    }
  }

  const currentPackageLinks = await Promise.all(
    packages.map(async (pkg) => ({
      pkg,
      products: await getProductLinks(project.id, "packages", pkg.id),
    })),
  );
  for (const target of targets.filter((item) => item.kind === "credit_pack")) {
    const packKey = CREDIT_PACKS.find(
      (pack) => pack.key === target.product.store_identifier,
    )?.key;
    const link = currentPackageLinks.find(
      ({ pkg }) =>
        pkg.lookup_key === packKey,
    );
    if (
      link?.products.some(
        (item) =>
          item.app_id === target.product.app_id &&
          item.id !== target.product.id,
      )
    ) {
      throw new Error(
        `A current offering credits package has a conflicting product; no writes made.`,
      );
    }
  }

  const desiredGrants = targets.map(serializeGrant);
  const preflight = {
    project: { id: project.id, name: project.name },
    mode: apply ? "apply" : "inspect-only",
    serverCreditsConfig: {
      currencyCode: creditsConfig.currency.code,
      currencyName: creditsConfig.currency.name,
      offeringIdentifier: creditsConfig.offeringIdentifier,
      packs: CREDIT_PACKS.map(({
        key,
        productDisplayName,
        packageDisplayName,
        amount,
        amountMicros,
      }) => ({
        key,
        productDisplayName,
        packageDisplayName,
        amount,
        priceCents: amountMicros / 10_000,
      })),
      monthlyBonus: {
        student: SUBSCRIPTION_PLANS[0].amount,
        pro: SUBSCRIPTION_PLANS[1].amount,
      },
    },
    currency: existingCurrency
      ? {
          code: existingCurrency.code,
          name: existingCurrency.name,
          productGrants: existingCurrency.product_grants ?? [],
        }
      : null,
    subscriptionOffering: {
      id: subscriptionOffering.id,
      isCurrent: true,
      packages: subscriptionPackages.map(({ id, lookup_key, display_name }) => ({
        id,
        lookup_key,
        display_name,
      })),
    },
    creditsOffering: creditsOffering
      ? {
          id: creditsOffering.id,
          lookupKey: creditsOffering.lookup_key,
          isCurrent: creditsOffering.is_current,
        }
      : null,
    creditPackages: packages.map(({ id, lookup_key, display_name }) => ({
      id,
      lookup_key,
      display_name,
    })),
    creditProducts: packProducts.map(({ pack, product, prices, pkg }) => ({
      code: pack.key,
      productId: product?.id ?? null,
      type: product?.type ?? null,
      usdPrices: prices.filter((price) => price.currency === "USD"),
      packageId: pkg?.id ?? null,
    })),
    subscriptionGrants: targets
      .filter((target) => target.kind === "subscription")
      .map(({ product, amount, expireAtCycleEnd }) => ({
        productId: product.id,
        appId: product.app_id,
        storeIdentifier: product.store_identifier,
        amount,
        expiresAtCycleEnd: expireAtCycleEnd,
      })),
    plannedProductGrants: desiredGrants,
  };

  if (!apply) {
    console.log(JSON.stringify(preflight, null, 2));
    return;
  }

  let preparedCreditsOffering = creditsOffering;
  if (!preparedCreditsOffering) {
    preparedCreditsOffering = await revenueCatRequest<Resource>(
      projectPath(project.id, "/offerings"),
      "POST",
      {
        lookup_key: creditsConfig.offeringIdentifier,
        display_name: "Scribe Credits",
      },
    );
  }

  const readyTargets: ProductTarget[] = [];
  for (let index = 0; index < CREDIT_PACKS.length; index += 1) {
    const pack = CREDIT_PACKS[index]!;
    const packState = packProducts[index]!;
    let product = packState.product;
    if (!product) {
      product = await revenueCatRequest<Resource>(
        projectPath(project.id, "/products"),
        "POST",
        {
          app_id: testStore.id,
          store_identifier: pack.key,
          type: "consumable",
          display_name: pack.productDisplayName,
          title: pack.productDisplayName,
        },
      );
    }
    if (
      !packState.prices.some(
        (price) =>
          price.currency === "USD" &&
          price.amount_micros === pack.amountMicros,
      )
    ) {
      await revenueCatRequest(
        projectPath(
          project.id,
          `/products/${encodeURIComponent(product.id)}/test_store_prices`,
        ),
        "POST",
        {
          prices: [{ amount_micros: pack.amountMicros, currency: "USD" }],
        },
      );
    }
    readyTargets.push({
      product,
      amount: pack.amount,
      kind: "credit_pack",
      priceMicros: pack.amountMicros,
      expireAtCycleEnd: false,
    });

    let pkg = packState.pkg;
    if (!pkg) {
      pkg = await revenueCatRequest<Resource>(
        projectPath(
          project.id,
          `/offerings/${encodeURIComponent(preparedCreditsOffering.id)}/packages`,
        ),
        "POST",
        {
          lookup_key: pack.key,
          display_name: pack.packageDisplayName,
        },
      );
    } else if (pkg.display_name !== pack.packageDisplayName) {
      pkg = await revenueCatRequest<Resource>(
        projectPath(
          project.id,
          `/packages/${encodeURIComponent(pkg.id)}`,
        ),
        "POST",
        { display_name: pack.packageDisplayName },
      );
    }
    const attached = await getProductLinks(project.id, "packages", pkg.id);
    if (!attached.some((item) => item.id === product.id)) {
      const sameAppProduct = attached.find(
        (item) => item.app_id === product.app_id,
      );
      if (sameAppProduct) {
        throw new Error(
          `Package ${pack.key} changed after preflight; refusing to detach its existing product.`,
        );
      }
      await revenueCatRequest(
        projectPath(
          project.id,
          `/packages/${encodeURIComponent(pkg.id)}/actions/attach_products`,
        ),
        "POST",
        {
          products: [
            { product_id: product.id, eligibility_criteria: "all" },
          ],
        },
      );
    }
  }

  for (const target of targets.filter(
    (item) =>
      item.kind === "credit_pack" && item.product.app_id !== testStore.id,
  )) {
    const pkg = await getRevenueCatPages<Resource>(
      projectPath(
        project.id,
        `/offerings/${encodeURIComponent(preparedCreditsOffering.id)}/packages?limit=100`,
      ),
    ).then((items) =>
      items.find((item) => item.lookup_key === target.product.store_identifier),
    );
    if (!pkg) continue;
    const attached = await getProductLinks(project.id, "packages", pkg.id);
    if (!attached.some((item) => item.id === target.product.id)) {
      await revenueCatRequest(
        projectPath(
          project.id,
          `/packages/${encodeURIComponent(pkg.id)}/actions/attach_products`,
        ),
        "POST",
        {
          products: [
            {
              product_id: target.product.id,
              eligibility_criteria: "all",
            },
          ],
        },
      );
    }
  }

  const fullTargets = [
    ...new Map(
      [...readyTargets, ...targets].map((target) => [
        target.product.id,
        target,
      ]),
    ).values(),
  ];
  const finalGrants = fullTargets.map(serializeGrant);
  let savedCurrency = existingCurrency;
  if (!savedCurrency) {
    savedCurrency = await revenueCatRequest<Resource>(
      projectPath(project.id, "/virtual_currencies"),
      "POST",
      {
        code: CURRENCY.code,
        name: CURRENCY.name,
        description: "Credits for ClassScribe features and study tools.",
        product_grants: finalGrants,
      },
    );
  } else {
    await revenueCatRequest(
      projectPath(
        project.id,
        `/virtual_currencies/${encodeURIComponent(CURRENCY.code)}`,
      ),
      "POST",
      { name: CURRENCY.name, product_grants: finalGrants },
    );
  }

  const verifiedCurrency = await revenueCatRequest<Resource>(
    projectPath(
      project.id,
      `/virtual_currencies/${encodeURIComponent(CURRENCY.code)}`,
    ),
  );
  const verifiedProducts = await getRevenueCatPages<Resource>(
    projectPath(project.id, "/products?limit=100"),
  );
  const verifiedPackages = await getRevenueCatPages<Resource>(
    projectPath(
      project.id,
      `/offerings/${encodeURIComponent(preparedCreditsOffering.id)}/packages?limit=100`,
    ),
  );
  const verifiedProductGrants = verifiedCurrency.product_grants ?? [];
  const verifiedPackagesByKey = await Promise.all(
    verifiedPackages
      .filter((pkg) => CREDIT_PACKS.some((pack) => pack.key === pkg.lookup_key))
      .map(async (pkg) => ({
        lookupKey: pkg.lookup_key,
        displayName: pkg.display_name,
        products: await getProductLinks(project.id, "packages", pkg.id),
      })),
  );
  const verifiedPackReadback = await Promise.all(
    CREDIT_PACKS.map(async (pack) => {
      const product = verifiedProducts.find(
        (item) =>
          item.app_id === testStore.id &&
          item.store_identifier === pack.key,
      );
      const prices = product
        ? await getTestStorePrices(project.id, product.id)
        : [];
      return { pack, product, prices };
    }),
  );
  const missingGrants = fullTargets.filter(
    (target) =>
      !verifiedProductGrants.some(
        (grant) =>
          grant.product_ids?.includes(target.product.id) &&
          grant.amount === target.amount &&
          grant.trial_amount === 0 &&
          grant.expire_at_cycle_end === target.expireAtCycleEnd,
      ),
  );
  const missingPackages = CREDIT_PACKS.filter((pack) => {
    const product = verifiedPackReadback.find(
      (item) => item.pack.key === pack.key,
    )?.product;
    return (
      !product ||
      product.type !== "consumable" ||
      !verifiedPackReadback
        .find((item) => item.pack.key === pack.key)
        ?.prices.some(
          (price) =>
            price.currency === "USD" &&
            price.amount_micros === pack.amountMicros,
        ) ||
      !verifiedPackagesByKey.some(
        (pkg) =>
          pkg.lookupKey === pack.key &&
          pkg.displayName === pack.packageDisplayName &&
          pkg.products.some((item) => item.id === product.id),
      )
    );
  });
  if (missingGrants.length || missingPackages.length) {
    throw new Error(
      "Remote verification did not match the requested credits catalog; inspect RevenueCat before retrying.",
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "verified",
        project: { id: project.id, name: project.name },
        currency: {
          code: verifiedCurrency.code,
          name: verifiedCurrency.name,
          productGrants: verifiedProductGrants.map((grant) => ({
            productIds: grant.product_ids,
            amount: grant.amount,
            trialAmount: grant.trial_amount,
            expireAtCycleEnd: grant.expire_at_cycle_end,
          })),
        },
        subscriptionOffering: subscriptionOffering.id,
        creditsOffering: preparedCreditsOffering.id,
        creditPacks: CREDIT_PACKS.map((pack) => ({
          code: pack.key,
          productId: verifiedPackReadback.find(
            (item) => item.pack.key === pack.key,
          )?.product?.id,
          type: verifiedPackReadback.find(
            (item) => item.pack.key === pack.key,
          )?.product?.type,
          usdPrice: verifiedPackReadback
            .find((item) => item.pack.key === pack.key)
            ?.prices.find(
              (price) =>
                price.currency === "USD" &&
                price.amount_micros === pack.amountMicros,
            )
            ? `$${(pack.amountMicros / 1_000_000).toFixed(2)}`
            : null,
          amount: pack.amount,
          packageId: verifiedPackages.find(
            (item) => item.lookup_key === pack.key,
          )?.id,
        })),
        subscriptionGrants: fullTargets
          .filter((target) => target.kind === "subscription")
          .map(({ product, amount, expireAtCycleEnd }) => ({
            appId: product.app_id,
            productId: product.id,
            storeIdentifier: product.store_identifier,
            amount,
            trialAmount: 0,
            expireAtCycleEnd,
          })),
        productionCreditStoreProductsDiscovered: fullTargets
          .filter(
            (target) =>
              target.kind === "credit_pack" &&
              target.product.app_id !== testStore.id,
          )
          .map(({ product }) => ({
            appId: product.app_id,
            productId: product.id,
            storeIdentifier: product.store_identifier,
          })),
        nonCreditPackagesChanged: false,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const request = message.match(
    /RevenueCat API request failed \((\d{3})\) for (\w+) ([^:]+):/,
  );
  const responseText = message.slice(message.indexOf(": ") + 2);
  let validation = "";
  try {
    const response = JSON.parse(responseText) as {
      error?: { type?: unknown; param?: unknown; message?: unknown };
      type?: unknown;
      param?: unknown;
      message?: unknown;
    };
    const type = response.error?.type ?? response.type;
    const param = response.error?.param ?? response.param;
    const rawDetail = response.error?.message ?? response.message;
    const detail =
      typeof rawDetail === "string"
        ? rawDetail
            .replace(/\b(?:sk|pk)_[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
            .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
            .slice(0, 240)
        : "";
    if (typeof type === "string" || typeof param === "string") {
      validation = ` (${[
        type,
        param,
        detail,
      ]
        .filter((item) => typeof item === "string" && item.length > 0)
        .join(", ")})`;
    }
  } catch {
    // Do not print raw provider responses; they can contain sensitive data.
  }
  console.error(
    "ClassScribe credits RevenueCat setup failed:",
    request
      ? `RevenueCat API returned HTTP ${request[1]} for ${request[2]} ${request[3]}${validation}.`
      : message || "Unknown API error.",
  );
  process.exitCode = 1;
});