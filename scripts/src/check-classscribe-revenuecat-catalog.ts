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
  duration?: string;
};

const path = (projectId: string, suffix: string) =>
  `/v2/projects/${encodeURIComponent(projectId)}${suffix}`;

async function main() {
  const projects = await getRevenueCatPages<Resource>("/v2/projects?limit=100");
  const project = projects.find((item) => item.name === "ClassScribe");
  if (!project) throw new Error("RevenueCat project ClassScribe was not found.");

  const [apps, products, entitlements, offerings] = await Promise.all([
    getRevenueCatPages<Resource>(path(project.id, "/apps?limit=100")),
    getRevenueCatPages<Resource>(path(project.id, "/products?limit=100")),
    getRevenueCatPages<Resource>(path(project.id, "/entitlements?limit=100")),
    getRevenueCatPages<Resource>(path(project.id, "/offerings?limit=100")),
  ]);
  const productDetails = await Promise.all(
    products.map(async (product) => {
      let prices: unknown = "not a test-store product";
      if (apps.find((app) => app.id === product.app_id)?.type === "test_store") {
        prices = await revenueCatRequest(
          path(
            project.id,
            `/products/${encodeURIComponent(product.id)}/test_store_prices`,
          ),
        );
      }
      return { ...product, test_store_prices: prices };
    }),
  );

  const offeringDetails = await Promise.all(
    offerings.map(async (offering) => {
      const packages = await getRevenueCatPages<Resource>(
        path(
          project.id,
          `/offerings/${encodeURIComponent(offering.id)}/packages?limit=100`,
        ),
      );
      const packageDetails = await Promise.all(
        packages.map(async (pkg) => ({
          ...pkg,
          products: await revenueCatRequest(
            path(project.id, `/packages/${encodeURIComponent(pkg.id)}/products`),
          ),
        })),
      );
      return { ...offering, packages: packageDetails };
    }),
  );
  const entitlementDetails = await Promise.all(
    entitlements.map(async (entitlement) => ({
      ...entitlement,
      products: await revenueCatRequest(
        path(
          project.id,
          `/entitlements/${encodeURIComponent(entitlement.id)}/products`,
        ),
      ),
    })),
  );
  const webhookIntegrations = await getRevenueCatPages<{
    id: string;
    name?: string;
    app_id?: string;
    environment?: string;
    event_types?: string[];
  }>(path(project.id, "/integrations/webhooks?limit=100"));

  console.log(
    JSON.stringify(
      {
        project: { id: project.id, name: project.name },
        apps: apps.map(({ id, name, type }) => ({ id, name, type })),
        products: productDetails,
        entitlements: entitlementDetails,
        offerings: offeringDetails,
        webhookIntegrations: webhookIntegrations.map(
          ({ id, name, app_id, environment, event_types }) => ({
            id,
            name,
            app_id,
            environment,
            event_types,
          }),
        ),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(
    "RevenueCat catalog check failed:",
    error instanceof Error ? error.message : "Unknown RevenueCat API error",
  );
  process.exitCode = 1;
});