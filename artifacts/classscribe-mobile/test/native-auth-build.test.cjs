const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

// Execute the real build/config files in an isolated environment. Never read
// workspace secrets, spawn Metro, or make a network request.
function runMetro(env) {
  const config = { projectRoot: 'smoke-test' };
  const context = {
    process: { env: { ...env } }, URL, __dirname: path.resolve('.'),
    module: { exports: {} },
    require(name) {
      assert.equal(name, 'expo/metro-config');
      return { getDefaultConfig: () => config };
    },
  };
  vm.runInNewContext(readFileSync('metro.config.js', 'utf8'), context, { filename: 'metro.config.js' });
  assert.equal(context.module.exports, config);
  return context.process.env;
}

async function runBuild(env) {
  const calls = [];
  let healthChecks = 0;
  const source = readFileSync('scripts/build.js', 'utf8');
  // Stop before main's side effects, but execute the actual startMetro function.
  const mainCall = source.lastIndexOf('\nmain().catch(');
  assert.ok(mainCall > 0, 'build entrypoint must remain identifiable');
  const context = {
    process: { env: { ...env } }, URL, AbortSignal,
    __dirname: path.resolve('scripts'),
    console: { log() {}, error() {} },
    setTimeout: (callback) => { callback(); return 0; },
    fetch: async () => ({ ok: ++healthChecks > 1 }),
    require(name) {
      if (name === 'child_process') return {
        spawn(command, args, options) {
          calls.push({ command, args, options });
          return { stdout: new EventEmitter(), stderr: new EventEmitter() };
        },
      };
      return require(name);
    },
  };
  vm.runInNewContext(`${source.slice(0, mainCall)}
    globalThis.buildSmoke = { startMetro, getDeploymentDomain };`, context, { filename: 'scripts/build.js' });
  const domain = context.buildSmoke.getDeploymentDomain();
  await context.buildSmoke.startMetro(domain, 'public-test-repl');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'pnpm');
  assert.ok(calls[0].args.includes('expo'));
  return calls[0].options.env;
}

test('native Metro config bridges the managed key and absolute production proxy', () => {
  for (const origin of ['release.example.test', 'https://release.example.test/some/path']) {
    const env = runMetro({
      CLERK_PUBLISHABLE_KEY: 'pk_live_fake_build_fixture',
      CLERK_PROXY_URL: '/__clerk',
      REPLIT_INTERNAL_APP_DOMAIN: origin,
      EXPO_PUBLIC_SERVER_URL: 'https://development.example.test',
    });
    assert.equal(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, 'pk_live_fake_build_fixture');
    assert.equal(env.EXPO_PUBLIC_CLERK_PROXY_URL, 'https://release.example.test/__clerk');
  }
});

test('native Metro preserves explicit public settings and supports server/domain fallback', () => {
  const env = runMetro({
    CLERK_PUBLISHABLE_KEY: 'managed-fixture',
    CLERK_PROXY_URL: '/__clerk',
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'public-fixture',
    EXPO_PUBLIC_CLERK_PROXY_URL: 'https://explicit.example.test/__clerk',
  });
  assert.equal(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, 'public-fixture');
  assert.equal(env.EXPO_PUBLIC_CLERK_PROXY_URL, 'https://explicit.example.test/__clerk');
  for (const field of ['EXPO_PUBLIC_SERVER_URL', 'EXPO_PUBLIC_DOMAIN']) {
    assert.equal(runMetro({ CLERK_PROXY_URL: '/__clerk', [field]: 'fallback.example.test' }).EXPO_PUBLIC_CLERK_PROXY_URL,
      'https://fallback.example.test/__clerk');
  }
});

test('native Metro refuses a proxy without an origin and does not invent development proxy settings', () => {
  assert.throws(() => runMetro({ CLERK_PROXY_URL: '/__clerk' }), /no public server domain/);
  const env = runMetro({});
  assert.equal(env.EXPO_PUBLIC_CLERK_PROXY_URL, undefined);
  assert.equal(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, undefined);
});

test('static native build hands the release origin, managed key and proxy to the spawned Metro process', async () => {
  const env = await runBuild({
    REPLIT_INTERNAL_APP_DOMAIN: 'https://release.example.test',
    REPLIT_DEV_DOMAIN: 'development.example.test',
    CLERK_PROXY_URL: '/__clerk',
    CLERK_PUBLISHABLE_KEY: 'pk_live_fake_build_fixture',
  });
  assert.equal(env.EXPO_PUBLIC_SERVER_URL, 'https://release.example.test');
  assert.equal(env.EXPO_PUBLIC_DOMAIN, 'release.example.test');
  assert.equal(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, 'pk_live_fake_build_fixture');
  assert.equal(env.EXPO_PUBLIC_CLERK_PROXY_URL, 'https://release.example.test/__clerk');
  assert.equal(env.EXPO_PUBLIC_REPL_ID, 'public-test-repl');
  assert.equal(runMetro(env).EXPO_PUBLIC_CLERK_PROXY_URL, env.EXPO_PUBLIC_CLERK_PROXY_URL);
});

test('static development builds retain the public key fallback without enabling a production proxy', async () => {
  const env = await runBuild({
    EXPO_PUBLIC_DOMAIN: 'development.example.test',
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_fake_build_fixture',
  });
  assert.equal(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, 'pk_test_fake_build_fixture');
  assert.equal(env.EXPO_PUBLIC_CLERK_PROXY_URL, '');
});

test('root layout passes the public proxy and native token cache to Clerk without hiding the app behind loaded gates', () => {
  const layout = readFileSync('app/_layout.js', 'utf8');
  assert.match(layout, /<ClerkProvider[\s\S]*?publishableKey=\{clerkPublishableKey\}/);
  assert.match(layout, /tokenCache=\{Platform\.OS === 'web' \? undefined : tokenCache\}/);
  assert.match(layout, /proxyUrl=\{process\.env\.EXPO_PUBLIC_CLERK_PROXY_URL \|\| undefined\}/);
  assert.match(layout, /<ClerkProvider[\s\S]*?>\s*\{app\}\s*<\/ClerkProvider>/);
});
