/** Read-only adapter: the preflight cannot request writes or enumerate credentials. */
export type AndroidStorePreflightAdapter = {
  readConfig(): Promise<unknown>;
  request(path: string, method: "GET"): Promise<unknown>;
};

const messages = {
  android_identifiers_missing: "Configure REVENUECAT_PROJECT_ID and REVENUECAT_GOOGLE_PLAY_STORE_APP_ID.",
  android_config_unreadable: "Cannot read the checked-in mobile app.json.",
  android_package_missing: "app.json must declare a valid expo.android.package.",
  android_verification_unavailable: "Cannot verify the selected RevenueCat app. Release check failed closed; restore access and rerun.",
  android_app_response_unreadable: "RevenueCat did not return a readable app identity.",
  android_app_id_mismatch: "RevenueCat returned a different app ID. Check REVENUECAT_GOOGLE_PLAY_STORE_APP_ID.",
  android_app_type_mismatch: "The selected RevenueCat app is not a Google Play (play_store) app.",
  android_package_mismatch: "expo.android.package does not match the selected RevenueCat Google Play package. Resolve the Android mismatch before release.",
} as const;

class PreflightError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

export async function checkAndroidStoreIdentity(
  env: { REVENUECAT_PROJECT_ID?: string; REVENUECAT_GOOGLE_PLAY_STORE_APP_ID?: string },
  adapter: AndroidStorePreflightAdapter,
  timeoutMs = 30_000,
): Promise<void> {
  const projectId = env.REVENUECAT_PROJECT_ID;
  const appId = env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID;
  if (!nonempty(projectId) || !nonempty(appId)) {
    throw new PreflightError("android_identifiers_missing");
  }
  let config: unknown;
  try {
    config = await adapter.readConfig();
  } catch {
    throw new PreflightError("android_config_unreadable");
  }
  const androidPackage = record(record(record(config)?.expo)?.android)?.package;
  if (!nonempty(androidPackage) || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(androidPackage)) {
    throw new PreflightError("android_package_missing");
  }

  let response: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    response = await Promise.race([
      adapter.request(`/v2/projects/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(appId)}`, "GET"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
  } catch {
    // Provider errors can contain response bodies and credentials; never forward them.
    throw new PreflightError("android_verification_unavailable");
  } finally {
    clearTimeout(timer);
  }
  const app = record(response);
  if (!nonempty(app?.id) || !nonempty(app?.type)) {
    throw new PreflightError("android_app_response_unreadable");
  }
  if (app.id !== appId) throw new PreflightError("android_app_id_mismatch");
  if (app.type !== "play_store") throw new PreflightError("android_app_type_mismatch");
  const storePackage = record(app.play_store)?.package_name;
  if (!nonempty(storePackage)) throw new PreflightError("android_app_response_unreadable");
  if (storePackage !== androidPackage) throw new PreflightError("android_package_mismatch");
}

/** Fixed messages only: never print identifiers, config contents or provider responses. */
export async function runAndroidStorePreflight(
  env: Parameters<typeof checkAndroidStoreIdentity>[0],
  adapter: AndroidStorePreflightAdapter,
  output: { log(message: string): void; error(message: string): void },
): Promise<0 | 1> {
  try {
    await checkAndroidStoreIdentity(env, adapter);
    output.log("ClassScribe Android store identity preflight passed (read-only; iOS unchanged).");
    return 0;
  } catch (error) {
    const code = error instanceof PreflightError ? error.code : "android_verification_unavailable";
    output.error(`ClassScribe Android store identity preflight failed (${code}): ${messages[code]}`);
    return 1;
  }
}
