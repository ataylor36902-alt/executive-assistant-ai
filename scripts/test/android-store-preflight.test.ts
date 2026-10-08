import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  checkAndroidStoreIdentity,
  runAndroidStorePreflight,
  type AndroidStorePreflightAdapter,
} from "../src/android-store-preflight";

const env = {
  REVENUECAT_PROJECT_ID: "project-fixture",
  REVENUECAT_GOOGLE_PLAY_STORE_APP_ID: "google-fixture",
};
const packageName = "com.edmitainvest.classscribe";
const sensitive = "fixture-credential-never-print";

/** Entirely in-memory provider; unexpected methods/endpoints fail instead of using a network. */
function fixture() {
  const state = {
    config: { expo: { android: { package: packageName }, ios: { bundleIdentifier: "com.classscribe.app" } } },
    apps: [
      { id: env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID, type: "play_store", play_store: { package_name: packageName } },
      { id: "apple-fixture", type: "app_store", app_store: { bundle_id: "app.replit.classscribe" } },
    ],
    keys: [{ id: "key-fixture", key: sensitive }],
    products: [{ id: "product-fixture", app_id: "google-fixture", store_identifier: "student_monthly" }],
    associations: [{ customer: "synthetic-customer", product_id: "product-fixture" }],
  };
  const calls: { path: string; method: string }[] = [];
  const adapter: AndroidStorePreflightAdapter = {
    readConfig: async () => structuredClone(state.config),
    request: async (path, method) => {
      calls.push({ path, method });
      assert.equal(method, "GET", "preflight must never mutate resources");
      assert.equal(path, "/v2/projects/project-fixture/apps/google-fixture", "no key/product/iOS endpoint reads");
      return structuredClone(state.apps[0]);
    },
  };
  return { state, calls, adapter };
}

async function runFixture(
  configure: (f: ReturnType<typeof fixture>) => void = () => {},
  selectedEnv: Parameters<typeof runAndroidStorePreflight>[0] = env,
) {
  const f = fixture();
  configure(f);
  const before = structuredClone(f.state);
  const logs: string[] = [];
  const errors: string[] = [];
  const code = await runAndroidStorePreflight(selectedEnv, f.adapter, {
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  });
  // Keys, products, subscription associations, both app identities and source config preserved.
  assert.deepEqual(f.state, before);
  assert.ok(f.calls.every(({ method }) => method === "GET"));
  assert.ok(f.calls.length <= 1, "no retries or fallback app discovery");
  assert.ok(![...logs, ...errors].join("\n").includes(sensitive));
  return { ...f, code, logs, errors };
}

test("matching Android identity passes and preserves keys, products, associations and divergent iOS", async () => {
  const result = await runFixture();
  assert.equal(result.code, 0);
  assert.equal(result.logs.length, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(result.calls.length, 1);
});

for (const formerPackage of ["com.classscribe.app", "app.replit.classscribe", "com.wrong.app"]) {
  test(`provider package ${formerPackage} fails strict release gate`, async () => {
    const result = await runFixture((f) => {
      f.state.apps[0].play_store!.package_name = formerPackage;
    });
    assert.equal(result.code, 1);
    assert.match(result.errors[0], /android_package_mismatch/);
    assert.deepEqual(result.logs, []);
  });
}

test("comparison uses current source package, not a hardcoded migration target", async () => {
  const result = await runFixture((f) => {
    f.state.config.expo.android.package = "org.future.classscribe";
    f.state.apps[0].play_store!.package_name = "org.future.classscribe";
  });
  assert.equal(result.code, 0);
});

test("source mismatch fails even if provider has the expected migration target", async () => {
  const result = await runFixture((f) => { f.state.config.expo.android.package = "com.wrong.app"; });
  assert.equal(result.code, 1);
  assert.match(result.errors[0], /android_package_mismatch/);
});

test("stale selected app ID fails without looking up or selecting another app", async () => {
  const result = await runFixture((f) => {
    f.adapter.request = async (path, method) => {
      f.calls.push({ path, method });
      assert.equal(path, "/v2/projects/project-fixture/apps/stale-fixture");
      throw new Error(`RevenueCat API request failed (404): ${sensitive}`);
    };
  }, { ...env, REVENUECAT_GOOGLE_PLAY_STORE_APP_ID: "stale-fixture" });
  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 1);
  assert.match(result.errors[0], /android_verification_unavailable/);
});

test("different returned app ID fails even when package matches", async () => {
  const result = await runFixture((f) => { f.state.apps[0].id = "different-fixture"; });
  assert.equal(result.code, 1);
  assert.match(result.errors[0], /android_app_id_mismatch/);
});

for (const type of ["app_store", "test_store", "stripe"]) {
  test(`selected ${type} app fails even with a matching play_store field`, async () => {
    const result = await runFixture((f) => { f.state.apps[0].type = type; });
    assert.equal(result.code, 1);
    assert.match(result.errors[0], /android_app_type_mismatch/);
  });
}

for (const response of [
  null, undefined, "", "<html>gateway failure</html>", [], {},
  { id: 5, type: "play_store" },
  { id: "google-fixture", type: "play_store" },
  { id: "google-fixture", type: "play_store", play_store: { package_name: null } },
  { id: "google-fixture", type: "play_store", play_store: { package_name: "" } },
]) {
  test(`unreadable identity fails: ${JSON.stringify(response)}`, async () => {
    const result = await runFixture((f) => { f.adapter.request = async () => response; });
    assert.equal(result.code, 1);
    assert.match(result.errors[0], /android_app_response_unreadable/);
  });
}

for (const error of [
  new SyntaxError(`Unreadable JSON ${sensitive}`),
  new Error(`RevenueCat API request failed (401): ${sensitive}`),
  new Error(`RevenueCat API request failed (500): ${sensitive}`),
  new Error(`android_spoofed_error ${sensitive}`),
  sensitive,
]) {
  test(`provider failures are sanitized (${error instanceof Error ? error.name : "non-Error"})`, async () => {
    const result = await runFixture((f) => { f.adapter.request = async () => { throw error; }; });
    assert.equal(result.code, 1);
    assert.match(result.errors[0], /android_verification_unavailable/);
  });
}

test("unresponsive provider times out rather than hanging the gate", async () => {
  const f = fixture();
  const before = structuredClone(f.state);
  f.adapter.request = async () => new Promise(() => {});
  await assert.rejects(checkAndroidStoreIdentity(env, f.adapter, 5), /Cannot verify/);
  assert.deepEqual(f.state, before);
});

for (const selectedEnv of [
  {}, { REVENUECAT_PROJECT_ID: "project-fixture" },
  { REVENUECAT_GOOGLE_PLAY_STORE_APP_ID: "google-fixture" },
  { ...env, REVENUECAT_PROJECT_ID: " " },
  { ...env, REVENUECAT_GOOGLE_PLAY_STORE_APP_ID: " google-fixture " },
]) {
  test(`missing/invalid environment selection fails before provider access: ${JSON.stringify(selectedEnv)}`, async () => {
    const result = await runFixture(() => {}, selectedEnv);
    assert.equal(result.code, 1);
    assert.match(result.errors[0], /android_identifiers_missing/);
    assert.equal(result.calls.length, 0);
  });
}

test("unreadable source config fails without provider access or raw errors", async () => {
  const result = await runFixture((f) => {
    f.adapter.readConfig = async () => { throw new Error(sensitive); };
  });
  assert.equal(result.code, 1);
  assert.match(result.errors[0], /android_config_unreadable/);
  assert.equal(result.calls.length, 0);
});

for (const config of [null, {}, { expo: { android: {} } }, { expo: { android: { package: " bad " } } }]) {
  test(`invalid source config fails before provider access: ${JSON.stringify(config)}`, async () => {
    const result = await runFixture((f) => { f.adapter.readConfig = async () => config; });
    assert.equal(result.code, 1);
    assert.match(result.errors[0], /android_package_missing/);
    assert.equal(result.calls.length, 0);
  });
}

test("request path safely encodes the explicit project and app identifiers", async () => {
  const f = fixture();
  f.adapter.request = async (path, method) => {
    assert.equal(method, "GET");
    assert.equal(path, "/v2/projects/project%2Ffixture/apps/google%3Ffixture");
    return { ...f.state.apps[0], id: "google?fixture" };
  };
  await checkAndroidStoreIdentity({
    REVENUECAT_PROJECT_ID: "project/fixture",
    REVENUECAT_GOOGLE_PLAY_STORE_APP_ID: "google?fixture",
  }, f.adapter);
});

test("CLI returns nonzero for missing selection and rejects mutation flags without connecting", () => {
  const cli = new URL("../src/check-classscribe-android-store-identity.ts", import.meta.url);
  for (const args of [[], ["--apply"], ["--confirm-not-uploaded"]]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", cli.pathname, ...args], {
      cwd: new URL("..", import.meta.url),
      env: { PATH: process.env.PATH },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, args.length ? /always read-only/ : /android_identifiers_missing/);
  }
});

test("production CLI uses existing RevenueCat client and source URL, not the alignment mutation tool", async () => {
  const source = await readFile(new URL("../src/check-classscribe-android-store-identity.ts", import.meta.url), "utf8");
  assert.match(source, /import\("\.\/revenuecatClient"\)/);
  assert.match(source, /revenueCatRequest<unknown>\(path, method\)/);
  assert.match(source, /new URL\("\.\.\/\.\.\/artifacts\/classscribe-mobile\/app\.json", import\.meta\.url\)/);
  assert.doesNotMatch(source, /align-classscribe-android|POST|DELETE|public_api_keys/);
});
