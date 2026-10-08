import { getRevenueCatPages, revenueCatRequest } from "./revenuecatClient";

type RevenueCatApp = {
  id: string;
  type?: string;
  name?: string;
  app_store?: Record<string, unknown>;
};
type RevenueCatProduct = { app_id?: string; store_identifier?: string };

async function main(): Promise<void> {
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  const appId = process.env.REVENUECAT_APPLE_APP_STORE_APP_ID;
  if (!projectId || !appId) {
    throw new Error("ClassScribe RevenueCat iOS app identifiers are not configured.");
  }

  const app = await revenueCatRequest<RevenueCatApp>(
    `/v2/projects/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(appId)}`,
  );
  if (app.id !== appId || app.type !== "app_store") {
    throw new Error("The configured RevenueCat app is not the expected iOS app.");
  }

  const settings = app.app_store ?? {};
  const products = await getRevenueCatPages<RevenueCatProduct>(
    `/v2/projects/${encodeURIComponent(projectId)}/products?limit=100`,
  );
  console.log(JSON.stringify({
    appId: app.id,
    appName: app.name,
    appType: app.type,
    bundleId: typeof settings.bundle_id === "string" ? settings.bundle_id : null,
    inAppPurchaseKeyConfigured:
      typeof settings.subscription_key_configured === "boolean"
        ? settings.subscription_key_configured
        : null,
    appStoreConnectKeyConfigured:
      typeof settings.app_store_connect_api_key_configured === "boolean"
        ? settings.app_store_connect_api_key_configured
        : null,
    iosProductCount: products.filter((product) => product.app_id === appId).length,
    settingNames: Object.keys(settings).filter((name) =>
      !/secret|token|private|credential|key|certificate/i.test(name)),
  }));
}

main().catch((error: unknown) => {
  console.error(
    "Could not inspect ClassScribe's iOS purchase settings:",
    error instanceof Error ? error.name : "unknown",
  );
  process.exitCode = 1;
});