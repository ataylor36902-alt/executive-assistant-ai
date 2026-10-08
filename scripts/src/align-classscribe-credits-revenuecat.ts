import { getRevenueCatPages, revenueCatRequest } from "./revenuecatClient";

type Product = {
  id: string;
  app_id?: string;
  store_identifier?: string;
  type?: string;
  state?: string;
};
type Offering = {
  id: string;
  lookup_key?: string;
  display_name?: string;
  is_current?: boolean;
};
type Package = {
  id: string;
  lookup_key?: string;
  display_name?: string;
};
type ProductLink = { product?: Product; product_id?: string };
type ProductList = { items?: Array<Product | ProductLink> };
type ProductGrant = {
  product_ids?: string[];
  amount?: number;
  trial_amount?: number;
  expire_at_cycle_end?: boolean;
};
type Currency = {
  code?: string;
  name?: string;
  product_grants?: ProductGrant[];
};
type CreditsConfig = {
  currency: { code: string; name: string };
  offeringIdentifier: string;
  packs: Array<{
    id: string;
    credits: number;
    priceCents: number;
    name: string;
    label: string;
  }>;
};

const PROJECT_NAME = "ClassScribe";
const configUrl = new URL(
  "../../artifacts/api-server/src/lib/credits-config.ts",
  import.meta.url,
).href;
const { creditsConfig } = (await import(configUrl)) as {
  creditsConfig: CreditsConfig;
};
const PACKS = creditsConfig.packs.map((pack) => ({
  ...pack,
  displayName: pack.label ? `${pack.name} (${pack.label})` : pack.name,
  obsoleteLookupKey: `$rc_custom_${pack.id}`,
}));

const projectPath = (projectId: string, suffix: string) =>
  `/v2/projects/${encodeURIComponent(projectId)}${suffix}`;

function uniqueMatch<T>(
  items: T[],
  predicate: (item: T) => boolean,
  description: string,
): T | undefined {
  const matches = items.filter(predicate);
  if (matches.length > 1) {
    throw new Error(`Multiple entries match ${description}; no writes made.`);
  }
  return matches[0];
}

async function packageProducts(
  projectId: string,
  pkg: Package,
): Promise<Product[]> {
  const response = await revenueCatRequest<ProductList>(
    projectPath(projectId, `/packages/${encodeURIComponent(pkg.id)}/products`),
  );
  return (response.items ?? []).flatMap((entry) => {
    if ("product" in entry && entry.product) return [entry.product];
    if ("id" in entry) return [entry];
    return [];
  });
}

function normalizeGrants(grants: ProductGrant[] | undefined): unknown[] {
  return (grants ?? [])
    .map((grant) => ({
      product_ids: [...(grant.product_ids ?? [])].sort(),
      amount: grant.amount,
      trial_amount: grant.trial_amount,
      expire_at_cycle_end: grant.expire_at_cycle_end,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  if (
    creditsConfig.currency.code !== "CRD" ||
    creditsConfig.currency.name !== "Scribe Credits" ||
    creditsConfig.offeringIdentifier !== "credits" ||
    PACKS.length !== 3 ||
    PACKS.some(
      (pack) =>
        !pack.id ||
        !pack.name ||
        !Number.isSafeInteger(pack.credits) ||
        pack.credits < 1 ||
        !Number.isSafeInteger(pack.priceCents) ||
        pack.priceCents < 1,
    ) ||
    new Set(PACKS.map((pack) => pack.id)).size !== PACKS.length
  ) {
    throw new Error("Credits configuration is invalid for RevenueCat alignment.");
  }

  const projects = await getRevenueCatPages<{ id: string; name?: string }>(
    "/v2/projects?limit=100",
  );
  const project = projects.find((item) => item.name === PROJECT_NAME);
  if (!project) throw new Error(`RevenueCat project ${PROJECT_NAME} was not found.`);

  const [apps, products, offerings, currencies] = await Promise.all([
    getRevenueCatPages<{ id: string; type?: string }>(
      projectPath(project.id, "/apps?limit=100"),
    ),
    getRevenueCatPages<Product>(
      projectPath(project.id, "/products?limit=100"),
    ),
    getRevenueCatPages<Offering>(
      projectPath(project.id, "/offerings?limit=100"),
    ),
    getRevenueCatPages<Currency>(
      projectPath(project.id, "/virtual_currencies?limit=100"),
    ),
  ]);
  const currentOffering = uniqueMatch(
    offerings,
    (offering) =>
      offering.lookup_key === "default" && offering.is_current === true,
    "current default subscription offering",
  );
  if (!currentOffering) {
    throw new Error("Current default subscription offering is missing; no writes made.");
  }
  const creditsOffering = uniqueMatch(
    offerings,
    (offering) => offering.lookup_key === creditsConfig.offeringIdentifier,
    "credits offering",
  );
  if (creditsOffering?.is_current) {
    throw new Error("Credits offering is current; no writes made.");
  }
  const currency = uniqueMatch(
    currencies,
    (item) => item.code === creditsConfig.currency.code,
    `currency ${creditsConfig.currency.code}`,
  );
  if (!currency || currency.name !== creditsConfig.currency.name) {
    throw new Error("Expected Scribe Credits currency is missing or mismatched; no writes made.");
  }

  const defaultPackages = await getRevenueCatPages<Package>(
    projectPath(
      project.id,
      `/offerings/${encodeURIComponent(currentOffering.id)}/packages?limit=100`,
    ),
  );
  for (const key of ["student_monthly", "pro_monthly"]) {
    if (!defaultPackages.some((pkg) => pkg.lookup_key === key)) {
      throw new Error(
        `Current default offering is missing ${key}; no writes made.`,
      );
    }
  }
  const creditsPackages = creditsOffering
    ? await getRevenueCatPages<Package>(
        projectPath(
          project.id,
          `/offerings/${encodeURIComponent(creditsOffering.id)}/packages?limit=100`,
        ),
      )
    : [];
  const recognizedPackageKeys = new Set([
    ...PACKS.map((pack) => pack.id),
    ...PACKS.map((pack) => pack.obsoleteLookupKey),
  ]);
  const unknownCreditsPackages = creditsPackages.filter(
    (pkg) => !recognizedPackageKeys.has(pkg.lookup_key ?? ""),
  );
  if (unknownCreditsPackages.length) {
    throw new Error(
      `Credits offering contains unmanaged packages (${unknownCreditsPackages.map((pkg) => pkg.lookup_key).join(", ")}); no writes made.`,
    );
  }

  const appTypes = new Map(apps.map((app) => [app.id, app.type]));
  const productIdsBefore = products.map((product) => product.id).sort();
  const productsByPack = new Map<string, Product[]>();
  const targets: Array<{
    pack: (typeof PACKS)[number];
    products: Product[];
    targetPackage?: Package;
    obsoletePackage?: Package;
    defaultPackage?: Package;
    targetLinks: Product[];
    obsoleteLinks: Product[];
    defaultLinks: Product[];
  }> = [];

  for (const pack of PACKS) {
    const packProducts = products.filter(
      (product) => product.store_identifier === pack.id,
    );
    const testStoreProduct = uniqueMatch(
      packProducts,
      (product) => appTypes.get(product.app_id ?? "") === "test_store",
      `Test Store product ${pack.id}`,
    );
    if (!testStoreProduct) {
      throw new Error(`Test Store product ${pack.id} is missing; no writes made.`);
    }
    if (
      packProducts.some(
        (product) => product.type !== "consumable" || product.state === "inactive",
      )
    ) {
      throw new Error(
        `Product ${pack.id} is not an active consumable in every store; no writes made.`,
      );
    }
    productsByPack.set(pack.id, packProducts);

    const targetPackage = uniqueMatch(
      creditsPackages,
      (pkg) => pkg.lookup_key === pack.id,
      `credits package ${pack.id}`,
    );
    const obsoletePackage = uniqueMatch(
      creditsPackages,
      (pkg) => pkg.lookup_key === pack.obsoleteLookupKey,
      `obsolete credits package ${pack.obsoleteLookupKey}`,
    );
    const defaultPackage = uniqueMatch(
      defaultPackages,
      (pkg) => pkg.lookup_key === pack.id,
      `default package ${pack.id}`,
    );
    const [targetLinks, obsoleteLinks, defaultLinks] = await Promise.all([
      targetPackage ? packageProducts(project.id, targetPackage) : [],
      obsoletePackage ? packageProducts(project.id, obsoletePackage) : [],
      defaultPackage ? packageProducts(project.id, defaultPackage) : [],
    ]);
    const validIds = new Set(packProducts.map((product) => product.id));
    for (const [label, links] of [
      ["credits", targetLinks],
      ["obsolete credits", obsoleteLinks],
      ["default", defaultLinks],
    ] as const) {
      if (links.some((product) => !validIds.has(product.id))) {
        throw new Error(
          `${label} package for ${pack.id} has a product outside its pack; no writes made.`,
        );
      }
    }
    targets.push({
      pack,
      products: packProducts,
      targetPackage,
      obsoletePackage,
      defaultPackage,
      targetLinks,
      obsoleteLinks,
      defaultLinks,
    });
  }

  const planned = {
    project: { id: project.id, name: project.name },
    mode: apply ? "apply" : "inspect-only",
    currentSubscriptionOffering: {
      id: currentOffering.id,
      lookupKey: currentOffering.lookup_key,
      packagesPreserved: defaultPackages
        .filter((pkg) => !PACKS.some((pack) => pack.id === pkg.lookup_key))
        .map((pkg) => ({ id: pkg.id, lookupKey: pkg.lookup_key })),
    },
    creditsOffering: creditsOffering
      ? { id: creditsOffering.id, lookupKey: creditsOffering.lookup_key }
      : null,
    packs: targets.map(
      ({
        pack,
        products: packProducts,
        targetPackage,
        obsoletePackage,
        defaultPackage,
      }) => ({
        id: pack.id,
        name: pack.name,
        label: pack.label,
        expectedStoreProducts: packProducts.map((product) => ({
          id: product.id,
          appType: appTypes.get(product.app_id ?? "") ?? null,
        })),
        creditsPackageId: targetPackage?.id ?? null,
        obsoleteCreditsPackageId: obsoletePackage?.id ?? null,
        defaultPackageIdToRemove: defaultPackage?.id ?? null,
      }),
    ),
    currencyGrantsUnchanged: true,
  };
  if (!apply) {
    console.log(JSON.stringify(planned, null, 2));
    return;
  }

  let alignedOffering = creditsOffering;
  if (!alignedOffering) {
    alignedOffering = await revenueCatRequest<Offering>(
      projectPath(project.id, "/offerings"),
      "POST",
      {
        lookup_key: creditsConfig.offeringIdentifier,
        display_name: "Scribe Credits",
      },
    );
    if (alignedOffering.is_current) {
      throw new Error(
        "RevenueCat made the new credits offering current; stop and restore the subscription offering before continuing.",
      );
    }
  }

  // Remove only the three old default-offering credit package records first.
  // Existing temporary credits packages keep the products attached until the
  // correctly keyed versions have been created and verified.
  for (const target of targets) {
    if (target.defaultPackage) {
      await revenueCatRequest(
        projectPath(
          project.id,
          `/packages/${encodeURIComponent(target.defaultPackage.id)}`,
        ),
        "DELETE",
      );
    }
  }

  for (const target of targets) {
    if (
      target.obsoletePackage &&
      target.obsoletePackage.display_name !== `Legacy ${target.pack.id}`
    ) {
      await revenueCatRequest(
        projectPath(
          project.id,
          `/packages/${encodeURIComponent(target.obsoletePackage.id)}`,
        ),
        "POST",
        { display_name: `Legacy ${target.pack.id}` },
      );
    }
  }

  const readyPackages = new Map<string, Package>();
  for (const target of targets) {
    let pkg = target.targetPackage;
    if (!pkg) {
      pkg = await revenueCatRequest<Package>(
        projectPath(
          project.id,
          `/offerings/${encodeURIComponent(alignedOffering.id)}/packages`,
        ),
        "POST",
        {
          lookup_key: target.pack.id,
          display_name: target.pack.displayName,
        },
      );
    } else if (pkg.display_name !== target.pack.displayName) {
      pkg = await revenueCatRequest<Package>(
        projectPath(
          project.id,
          `/packages/${encodeURIComponent(pkg.id)}`,
        ),
        "POST",
        { display_name: target.pack.displayName },
      );
    }
    readyPackages.set(target.pack.id, pkg);
    const attachedLinks = await packageProducts(project.id, pkg);
    const attachedIds = new Set(attachedLinks.map((product) => product.id));
    const productsToAttach = target.products.filter(
      (product) => !attachedIds.has(product.id),
    );
    if (productsToAttach.length) {
      await revenueCatRequest(
        projectPath(
          project.id,
          `/packages/${encodeURIComponent(pkg.id)}/actions/attach_products`,
        ),
        "POST",
        {
          products: productsToAttach.map((product) => ({
            product_id: product.id,
            eligibility_criteria: "all",
          })),
        },
      );
    }
  }

  for (const target of targets) {
    const pkg = readyPackages.get(target.pack.id)!;
    const attachedIds = new Set(
      (await packageProducts(project.id, pkg)).map((product) => product.id),
    );
    if (target.products.some((product) => !attachedIds.has(product.id))) {
      throw new Error(
        `Credits package ${target.pack.id} did not attach all existing store products; default packages were not removed.`,
      );
    }
  }

  for (const target of targets) {
    if (target.obsoletePackage) {
      await revenueCatRequest(
        projectPath(
          project.id,
          `/packages/${encodeURIComponent(target.obsoletePackage.id)}`,
        ),
        "DELETE",
      );
    }
  }
  const [verifiedOfferings, verifiedProducts, verifiedCurrencies] =
    await Promise.all([
      getRevenueCatPages<Offering>(
        projectPath(project.id, "/offerings?limit=100"),
      ),
      getRevenueCatPages<Product>(
        projectPath(project.id, "/products?limit=100"),
      ),
      getRevenueCatPages<Currency>(
        projectPath(project.id, "/virtual_currencies?limit=100"),
      ),
    ]);
  const verifiedCurrentOffering = uniqueMatch(
    verifiedOfferings,
    (offering) =>
      offering.lookup_key === "default" && offering.is_current === true,
    "preserved current default offering",
  );
  const verifiedCreditsOffering = uniqueMatch(
    verifiedOfferings,
    (offering) => offering.lookup_key === creditsConfig.offeringIdentifier,
    "credits offering",
  );
  if (
    !verifiedCurrentOffering ||
    verifiedCurrentOffering.id !== currentOffering.id ||
    !verifiedCreditsOffering ||
    verifiedCreditsOffering.id !== alignedOffering.id ||
    verifiedCreditsOffering.is_current
  ) {
    throw new Error("RevenueCat offering state did not verify after alignment.");
  }
  const [verifiedDefaultPackages, verifiedCreditsPackages] = await Promise.all([
    getRevenueCatPages<Package>(
      projectPath(
        project.id,
        `/offerings/${encodeURIComponent(verifiedCurrentOffering.id)}/packages?limit=100`,
      ),
    ),
    getRevenueCatPages<Package>(
      projectPath(
        project.id,
        `/offerings/${encodeURIComponent(verifiedCreditsOffering.id)}/packages?limit=100`,
      ),
    ),
  ]);
  const defaultPackageIdsExpected = defaultPackages
    .filter((pkg) => !PACKS.some((pack) => pack.id === pkg.lookup_key))
    .map((pkg) => pkg.id)
    .sort();
  if (
    JSON.stringify(verifiedDefaultPackages.map((pkg) => pkg.id).sort()) !==
    JSON.stringify(defaultPackageIdsExpected)
  ) {
    throw new Error(
      "Default offering package readback found an unexpected change; inspect RevenueCat.",
    );
  }
  const verifiedPackReadback = [];
  for (const pack of PACKS) {
    const pkg = uniqueMatch(
      verifiedCreditsPackages,
      (item) => item.lookup_key === pack.id,
      `verified credits package ${pack.id}`,
    );
    if (
      !pkg ||
      pkg.display_name !== pack.displayName
    ) {
      throw new Error(
        `Credits package ${pack.id} name did not verify after alignment.`,
      );
    }
    const attached = await packageProducts(project.id, pkg);
    const expectedIds = new Set(
      (productsByPack.get(pack.id) ?? []).map((product) => product.id),
    );
    if (
      attached.length !== expectedIds.size ||
      attached.some((product) => !expectedIds.has(product.id))
    ) {
      throw new Error(
        `Credits package ${pack.id} product associations did not verify.`,
      );
    }
    verifiedPackReadback.push({
      id: pack.id,
      packageId: pkg.id,
      displayName: pkg.display_name,
      productIds: attached.map((product) => product.id),
    });
  }
  if (
    verifiedCreditsPackages.length !== PACKS.length ||
    verifiedProducts.map((product) => product.id).sort().join(",") !==
      productIdsBefore.join(",")
  ) {
    throw new Error(
      "Credits offering contains unexpected packages or products changed; inspect RevenueCat.",
    );
  }
  const verifiedCurrency = uniqueMatch(
    verifiedCurrencies,
    (item) => item.code === creditsConfig.currency.code,
    `currency ${creditsConfig.currency.code}`,
  );
  if (
    !verifiedCurrency ||
    verifiedCurrency.name !== currency.name ||
    JSON.stringify(normalizeGrants(verifiedCurrency.product_grants)) !==
      JSON.stringify(normalizeGrants(currency.product_grants))
  ) {
    throw new Error("Scribe Credits grants changed during offering alignment.");
  }

  console.log(
    JSON.stringify(
      {
        status: "verified",
        project: project.name,
        currentSubscriptionOffering: {
          id: verifiedCurrentOffering.id,
          lookupKey: verifiedCurrentOffering.lookup_key,
          preservedPackageIds: verifiedDefaultPackages.map((pkg) => pkg.id),
        },
        creditsOffering: {
          id: verifiedCreditsOffering.id,
          lookupKey: verifiedCreditsOffering.lookup_key,
          isCurrent: verifiedCreditsOffering.is_current,
          packages: verifiedPackReadback,
        },
        removedDefaultCreditPackageIds: targets
          .map((target) => target.defaultPackage?.id)
          .filter((id): id is string => Boolean(id)),
        removedObsoleteCreditsPackageIds: targets
          .map((target) => target.obsoletePackage?.id)
          .filter((id): id is string => Boolean(id)),
        productsPreserved: true,
        currencyGrantsPreserved: true,
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
  const rawResponse = message.slice(message.indexOf(": ") + 2);
  let validation = "";
  try {
    const response = JSON.parse(rawResponse) as {
      error?: { type?: unknown; param?: unknown; message?: unknown };
      type?: unknown;
      param?: unknown;
      message?: unknown;
    };
    const type = response.error?.type ?? response.type;
    const param = response.error?.param ?? response.param;
    const detail = response.error?.message ?? response.message;
    const safeDetail =
      typeof detail === "string"
        ? detail
            .replace(/\b(?:sk|pk)_[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
            .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
            .slice(0, 240)
        : "";
    if (typeof type === "string" || typeof param === "string" || safeDetail) {
      validation = ` (${[type, param, safeDetail]
        .filter((item) => typeof item === "string" && item.length > 0)
        .join(", ")})`;
    }
  } catch {
    // Never print raw provider responses; they may contain sensitive values.
  }
  console.error(
    "ClassScribe credits offering alignment failed:",
    request
      ? `RevenueCat API returned HTTP ${request[1]} for ${request[2]} ${request[3]}${validation}.`
      : message || "Unknown RevenueCat API error.",
  );
  process.exitCode = 1;
});