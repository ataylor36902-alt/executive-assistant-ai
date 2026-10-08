import { getRevenueCatPages, revenueCatRequest } from "./revenuecatClient";

// Migration/status tool, NOT a release gate: default mode accepts former packages.
// Before Android release, run check-classscribe-android-store-identity.ts instead.
const previousPackages = ["com.classscribe.app", "app.replit.classscribe"];
const targetPackage = "com.edmitainvest.classscribe";

type App = {
  id: string;
  type: string;
  play_store?: { package_name?: string };
};
type Product = { id: string; app_id: string; store_identifier: string };

async function main(): Promise<void> {
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  const appId = process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID;
  if (!projectId || !appId) throw new Error("android_app_identifiers_missing");
  const path = `/v2/projects/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(appId)}`;
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--confirm-not-uploaded")) {
    throw new Error("android_first_upload_confirmation_required");
  }

  const before = await revenueCatRequest<App>(path);
  if (before.id !== appId || before.type !== "play_store") {
    throw new Error("android_app_identity_mismatch");
  }
  const packageName = before.play_store?.package_name;
  if (!packageName || (!previousPackages.includes(packageName) && packageName !== targetPackage)) {
    throw new Error("android_package_unexpected");
  }
  if (!apply || packageName === targetPackage) {
    console.log(JSON.stringify({
      appId, packageName, targetPackage,
      status: packageName === targetPackage ? "already_aligned" : "change_available",
      changed: false,
    }, null, 2));
    return;
  }

  // Compare keys internally; never log any key or provider response body.
  const keysBefore = await revenueCatRequest<unknown>(`${path}/public_api_keys`);
  const productsBefore = await getRevenueCatPages<Product>(
    `/v2/projects/${encodeURIComponent(projectId)}/products?limit=100&app_id=${encodeURIComponent(appId)}`,
  );

  // Exactly one partial update, with no credential, product, or offering writes.
  // A lost response must be checked with GET, never blindly retried.
  let updateStatus: string | null = null;
  try {
    await revenueCatRequest<App>(path, "POST", {
      play_store: { package_name: targetPackage },
    });
  } catch (error) {
    const status = error instanceof Error
      ? /RevenueCat API request failed \((\d{3})\)/.exec(error.message)?.[1]
      : undefined;
    updateStatus = status ? `http_${status}` : "response_uncertain";
  }

  const after = await revenueCatRequest<App>(path);
  if (after.id !== appId || after.type !== "play_store" ||
      after.play_store?.package_name !== targetPackage) {
    throw new Error(`android_update_not_confirmed_${updateStatus ?? "unexpected_response"}`);
  }
  const keysAfter = await revenueCatRequest<unknown>(`${path}/public_api_keys`);
  const productsAfter = await getRevenueCatPages<Product>(
    `/v2/projects/${encodeURIComponent(projectId)}/products?limit=100&app_id=${encodeURIComponent(appId)}`,
  );
  const productSnapshot = (products: Product[]) => JSON.stringify(
    products.filter((product) => product.app_id === appId)
      .map(({ id, app_id, store_identifier }) => ({ id, app_id, store_identifier }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
  const keysUnchanged = JSON.stringify(keysBefore) === JSON.stringify(keysAfter);
  const productsUnchanged = productSnapshot(productsBefore) === productSnapshot(productsAfter);
  if (!keysUnchanged || !productsUnchanged) {
    throw new Error("android_related_configuration_changed_review_required");
  }
  console.log(JSON.stringify({
    appId,
    packageName: after.play_store.package_name,
    changed: true,
    keysUnchanged,
    productsUnchanged,
    iosTouched: false,
    ...(updateStatus ? { updateResponse: updateStatus, verifiedByReadback: true } : {}),
  }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const status = /RevenueCat API request failed \((\d{3})\)/.exec(message)?.[1];
  // Only our fixed error codes and HTTP status are safe to display.
  const code = message.startsWith("android_")
    ? message
    : status ? `revenuecat_http_${status}` : "android_configuration_check_failed";
  console.error(`ClassScribe Android alignment stopped (${code}).`);
  process.exitCode = 1;
});