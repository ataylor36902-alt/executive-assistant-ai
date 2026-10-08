import { getRevenueCatPages, revenueCatRequest } from "./revenuecatClient";

type Resource = {
  id: string;
  name?: string;
  display_name?: string;
  lookup_key?: string;
  type?: string;
  app_id?: string;
  store_identifier?: string;
  is_current?: boolean;
  subscription?: { duration?: string | null };
};

type Price = { amount_micros?: number; currency?: string };
type ProductLink = { product?: Resource; product_id?: string };
type ProductList = { items?: Resource[] };
type PackageProductList = { items?: ProductLink[] };

const PROJECT_NAME = "ClassScribe";
const plans = [
  {
    lookupKey: "student",
    legacyLookupKey: "classscribe_student",
    name: "ClassScribe Student",
    entitlementDisplayName: "ClassScribe Student access",
    testStoreIdentifier: "student_monthly",
    testStoreDisplayName: "ClassScribe Student Test Store",
    amountMicros: 7_990_000,
    legacyStoreIdentifiers: {
      test_store: ["classscribe_student_monthly"],
      app_store: ["classscribe_student_monthly"],
      play_store: ["classscribe_student_monthly:monthly"],
    },
    packageKey: "student_monthly",
  },
  {
    lookupKey: "pro",
    legacyLookupKey: "classscribe_pro",
    name: "ClassScribe Pro",
    entitlementDisplayName: "ClassScribe Pro access",
    testStoreIdentifier: "pro_monthly",
    testStoreDisplayName: "ClassScribe Pro Test Store",
    amountMicros: 12_990_000,
    legacyStoreIdentifiers: {
      test_store: ["classscribe_pro_monthly"],
      app_store: ["classscribe_pro_monthly"],
      play_store: ["classscribe_pro_monthly:monthly"],
    },
    packageKey: "pro_monthly",
  },
] as const;

const projectPath = (projectId: string, suffix: string) =>
  `/v2/projects/${encodeURIComponent(projectId)}${suffix}`;

async function getProductLinks(
  projectId: string,
  resource: "entitlements" | "packages",
  resourceId: string,
): Promise<Resource[]> {
  const links = await revenueCatRequest<
    ProductList | PackageProductList
  >(
    projectPath(
      projectId,
      `/${resource}/${encodeURIComponent(resourceId)}/products`,
    ),
  );
  return (links.items ?? []).flatMap((link) => {
    if ("product" in link && link.product) return [link.product];
    if ("id" in link) return [link];
    return [];
  });
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

async function main() {
  const projects = await getRevenueCatPages<Resource>("/v2/projects?limit=100");
  const project = projects.find((item) => item.name === PROJECT_NAME);
  if (!project) throw new Error(`RevenueCat project ${PROJECT_NAME} was not found.`);

  const [apps, products, entitlements, offerings] = await Promise.all([
    getRevenueCatPages<Resource>(projectPath(project.id, "/apps?limit=100")),
    getRevenueCatPages<Resource>(projectPath(project.id, "/products?limit=100")),
    getRevenueCatPages<Resource>(
      projectPath(project.id, "/entitlements?limit=100"),
    ),
    getRevenueCatPages<Resource>(projectPath(project.id, "/offerings?limit=100")),
  ]);
  const appByType = new Map(apps.map((app) => [app.type, app]));
  for (const type of ["test_store", "app_store", "play_store"] as const) {
    if (!appByType.has(type)) {
      throw new Error(`ClassScribe ${type} app is missing; no catalog changes made.`);
    }
  }

  const offering = offerings.find(
    (item) => item.lookup_key === "default" && item.is_current,
  );
  if (!offering) {
    throw new Error("The current default offering is missing; no catalog changes made.");
  }
  const packages = await getRevenueCatPages<Resource>(
    projectPath(
      project.id,
      `/offerings/${encodeURIComponent(offering.id)}/packages?limit=100`,
    ),
  );

  // Preflight the whole target catalog before any write: never mutate an
  // existing immutable Test Store price or touch unrelated store products.
  const targets = await Promise.all(
    plans.map(async (plan) => {
      const pkg = packages.find((item) => item.lookup_key === plan.packageKey);
      if (!pkg) {
        throw new Error(
          `Offering package ${plan.packageKey} is missing; no catalog changes made.`,
        );
      }

      const testApp = appByType.get("test_store")!;
      const newTestProduct = products.find(
        (item) =>
          item.app_id === testApp.id &&
          item.store_identifier === plan.testStoreIdentifier,
      );
      const testStoreProducts = products.filter(
        (item) => item.app_id === testApp.id,
      );
      const legacyProducts = products.filter((product) => {
        const app = apps.find((candidate) => candidate.id === product.app_id);
        if (!app) return false;
        const identifiers = plan.legacyStoreIdentifiers[
          app.type as keyof typeof plan.legacyStoreIdentifiers
        ] as readonly string[] | undefined;
        return identifiers?.includes(product.store_identifier ?? "") ?? false;
      });
      if (legacyProducts.length !== 3) {
        throw new Error(
          `Expected the three existing store products for ${plan.lookupKey}; found ${legacyProducts.length}. No catalog changes made.`,
        );
      }
      const alias = entitlements.find(
        (item) => item.lookup_key === plan.lookupKey,
      );
      const oldEntitlement = entitlements.find(
        (item) => item.lookup_key === plan.legacyLookupKey,
      );
      if (!oldEntitlement) {
        throw new Error(
          `Legacy entitlement ${plan.legacyLookupKey} is missing; no catalog changes made.`,
        );
      }

      let prices: Price[] = [];
      if (newTestProduct) {
        prices = await getTestStorePrices(project.id, newTestProduct.id);
        const conflicting = prices.find(
          (price) =>
            price.currency === "USD" &&
            price.amount_micros !== plan.amountMicros,
        );
        if (conflicting) {
          throw new Error(
            `Existing Test Store product ${plan.testStoreIdentifier} has a conflicting immutable USD price; no catalog changes made.`,
          );
        }
      }

      return {
        plan,
        pkg,
        alias,
        legacyProducts,
        newTestProduct,
        prices,
      };
    }),
  );

  const productByPlan = new Map<string, Resource[]>();
  const aliasByPlan = new Map<string, Resource>();
  for (const target of targets) {
    const { plan } = target;
    let newTestProduct = target.newTestProduct;
    if (!newTestProduct) {
      newTestProduct = await revenueCatRequest<Resource>(
        projectPath(project.id, "/products"),
        "POST",
        {
          app_id: appByType.get("test_store")!.id,
          store_identifier: plan.testStoreIdentifier,
          type: "subscription",
          display_name: plan.testStoreDisplayName,
          title: plan.testStoreDisplayName,
          subscription: { duration: "P1M" },
        },
      );
    }

    if (
      !target.prices.some(
        (price) =>
          price.currency === "USD" && price.amount_micros === plan.amountMicros,
      )
    ) {
      await revenueCatRequest(
        projectPath(
          project.id,
          `/products/${encodeURIComponent(newTestProduct.id)}/test_store_prices`,
        ),
        "POST",
        {
          prices: [{ amount_micros: plan.amountMicros, currency: "USD" }],
        },
      );
    }

    let alias = target.alias;
    if (!alias) {
      alias = await revenueCatRequest<Resource>(
        projectPath(project.id, "/entitlements"),
        "POST",
        {
          lookup_key: plan.lookupKey,
          display_name: plan.entitlementDisplayName,
        },
      );
    }

    const allProducts = [...target.legacyProducts, newTestProduct];
    const attachedToAlias = await getProductLinks(
      project.id,
      "entitlements",
      alias.id,
    );
    const productIdsToAttach = allProducts
      .filter(
        (product) =>
          !attachedToAlias.some((attached) => attached.id === product.id),
      )
      .map((product) => product.id);
    if (productIdsToAttach.length) {
      await revenueCatRequest(
        projectPath(
          project.id,
          `/entitlements/${encodeURIComponent(alias.id)}/actions/attach_products`,
        ),
        "POST",
        { product_ids: productIdsToAttach },
      );
    }
    aliasByPlan.set(plan.lookupKey, alias);

    const attachedToPackage = await getProductLinks(
      project.id,
      "packages",
      target.pkg.id,
    );
    if (!attachedToPackage.some((product) => product.id === newTestProduct.id)) {
      try {
        await revenueCatRequest(
          projectPath(
            project.id,
            `/packages/${encodeURIComponent(target.pkg.id)}/actions/attach_products`,
          ),
          "POST",
          {
            products: [
              {
                product_id: newTestProduct.id,
                eligibility_criteria: "all",
              },
            ],
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const onePerStoreError =
          /one product.*(app|store)|only one.*(app|store)|already.*(product|store).*package|same app/i.test(
            message,
          );
        if (!onePerStoreError) throw error;

        const testAppId = appByType.get("test_store")!.id;
        const oldTestProduct = attachedToPackage.find(
          (product) =>
            product.app_id === testAppId && product.id !== newTestProduct!.id,
        );
        if (!oldTestProduct) throw error;
        await revenueCatRequest(
          projectPath(
            project.id,
            `/packages/${encodeURIComponent(target.pkg.id)}/actions/detach_products`,
          ),
          "POST",
          { product_ids: [oldTestProduct.id] },
        );
        try {
          await revenueCatRequest(
            projectPath(
              project.id,
              `/packages/${encodeURIComponent(target.pkg.id)}/actions/attach_products`,
            ),
            "POST",
            {
              products: [
                {
                  product_id: newTestProduct.id,
                  eligibility_criteria: "all",
                },
              ],
            },
          );
        } catch (attachError) {
          await revenueCatRequest(
            projectPath(
              project.id,
              `/packages/${encodeURIComponent(target.pkg.id)}/actions/attach_products`,
            ),
            "POST",
            {
              products: [
                {
                  product_id: oldTestProduct.id,
                  eligibility_criteria: "all",
                },
              ],
            },
          );
          throw attachError;
        }
      }
    }

    productByPlan.set(plan.lookupKey, allProducts);
  }

  const verified: Array<{
    lookupKey: string;
    aliasEntitlementId: string;
    testStoreProductId: string;
    usdMonthlyPrice: string;
    packageId: string;
    testStorePackageProductId: string;
    attachedAliasProductIds: string[];
  }> = [];
  for (const target of targets) {
    const productsForPlan = productByPlan.get(target.plan.lookupKey)!;
    const testProduct = productsForPlan.find(
      (product) =>
        product.app_id === appByType.get("test_store")!.id &&
        product.store_identifier === target.plan.testStoreIdentifier,
    )!;
    const alias = aliasByPlan.get(target.plan.lookupKey);
    const currentAlias = alias
      ? await getProductLinks(project.id, "entitlements", alias.id)
      : [];
    const currentPackage = await getProductLinks(
      project.id,
      "packages",
      target.pkg.id,
    );
    const priceList = await getTestStorePrices(project.id, testProduct.id);
    const rightPrice = priceList.some(
      (price) =>
        price.currency === "USD" &&
        price.amount_micros === target.plan.amountMicros,
    );
    if (
      !alias ||
      productsForPlan.some(
        (product) => !currentAlias.some((item) => item.id === product.id),
      ) ||
      !currentPackage.some((product) => product.id === testProduct.id) ||
      !rightPrice
    ) {
      throw new Error(
        `Remote verification failed for ${target.plan.lookupKey}; inspect the RevenueCat catalog before retrying.`,
      );
    }
    verified.push({
      lookupKey: target.plan.lookupKey,
      aliasEntitlementId: alias.id,
      testStoreProductId: testProduct.id,
      usdMonthlyPrice: `$${(target.plan.amountMicros / 1_000_000).toFixed(2)}`,
      packageId: target.pkg.id,
      testStorePackageProductId: testProduct.id,
      attachedAliasProductIds: currentAlias.map((item) => item.id),
    });
  }

  console.log(
    JSON.stringify(
      {
        status: "verified",
        projectId: project.id,
        currentOfferingId: offering.id,
        testStoreAppId: appByType.get("test_store")!.id,
        plans: verified,
        legacyProductsPreserved: true,
        legacyEntitlementsPreserved: true,
        nonTestStorePackageAssociationsChanged: false,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(
    "RevenueCat catalog alignment failed:",
    error instanceof Error ? error.message : "Unknown RevenueCat API error",
  );
  process.exitCode = 1;
});