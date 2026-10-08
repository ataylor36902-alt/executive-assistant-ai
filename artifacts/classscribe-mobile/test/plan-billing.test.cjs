const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { billingSourceGuidance, billingSourceName, getBillingActionBlock, nativeStoreForPlatform } = require('../.plan-billing-test.cjs');
const { isRevenueCatTestStore, isUnsafeRevenueCatTestStoreRelease, revenueCatApiKeyName } = require('../.revenuecat-environment-test.cjs');

const plans = readFileSync('app/plans.js', 'utf8');
const revenuecat = readFileSync('lib/revenuecat.js', 'utf8');
const billing = readFileSync('lib/billing.js', 'utf8');

test('billing source labels are human-readable and match the API contract', () => {
  assert.equal(billingSourceName('web'), 'the web');
  assert.equal(billingSourceName('app_store'), 'the App Store');
  assert.equal(billingSourceName('play_store'), 'Google Play');
  assert.equal(billingSourceName('test_store'), 'RevenueCat Test Store');
  for (const source of ['web', 'app_store', 'play_store', 'test_store']) {
    assert.notEqual(billingSourceGuidance(source), '');
  }
  assert.match(billingSourceGuidance('test_store'), /Pro → Student cannot take effect while Pro is active/);
  assert.match(billingSourceGuidance('app_store'), /Apple App Store/);
  assert.match(billingSourceGuidance('play_store'), /Google Play/);
  assert.match(plans, /testID="billing-source-guidance"/);
  assert.equal(nativeStoreForPlatform('ios'), 'app_store');
  assert.equal(nativeStoreForPlatform('android'), 'play_store');
  assert.match(billing, /BILLING_SOURCES = new Set\(\['web', 'app_store', 'play_store', 'test_store', null\]\)/);
  assert.match(billing, /typeof value\.billingConflict !== 'boolean'/);
  assert.match(billing, /value\.renewalStatus !== null && !isRevenueCatRenewalStatus\(value\.renewalStatus\)/);
});

test('web-billed plans block native purchases and direct students to web management', () => {
  const status = { plan: 'student', billingSource: 'web', billingConflict: false };
  assert.match(getBillingActionBlock(status, 'native_purchase', 'ios'), /billed through the web/);
  assert.match(plans, /Open web subscription management/);
  assert.match(plans, /webPlansUrl\(\)/);
});

test('native billing blocks Stripe and blocks purchases on a different native store', () => {
  const status = { plan: 'pro', billingSource: 'app_store', billingConflict: false };
  assert.match(getBillingActionBlock(status, 'stripe_checkout', 'web'), /billed through the App Store/);
  assert.match(getBillingActionBlock(status, 'native_purchase', 'android'), /second subscription/);
  assert.equal(getBillingActionBlock(status, 'native_purchase', 'ios'), '');
  assert.match(plans, /native-billing-on-web/);
});

test('billing conflicts conservatively pause both purchase systems', () => {
  const status = { plan: 'student', billingSource: 'play_store', billingConflict: true };
  assert.match(getBillingActionBlock(status, 'native_purchase', 'android'), /Purchases are paused/);
  assert.match(getBillingActionBlock(status, 'stripe_checkout', 'web'), /Purchases are paused/);
  assert.match(getBillingActionBlock({ plan: 'student', billingSource: null }, 'stripe_checkout', 'web'), /could not identify where this paid plan is billed/);
});

test('EAS preview and production use platform keys; unsafe Test Store release configuration is rejected', () => {
  const releasePreview = { environment: 'production', devMode: false, expoGo: false };
  assert.equal(isRevenueCatTestStore(releasePreview), false);
  assert.equal(revenueCatApiKeyName({ ...releasePreview, platform: 'ios' }), 'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY');
  assert.equal(revenueCatApiKeyName({ ...releasePreview, platform: 'android' }), 'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY');
  assert.equal(revenueCatApiKeyName({ environment: 'test_store', devMode: true, expoGo: false, platform: 'ios' }), 'EXPO_PUBLIC_REVENUECAT_TEST_API_KEY');
  assert.equal(isUnsafeRevenueCatTestStoreRelease({ environment: 'test_store', devMode: false, expoGo: false }), true);
  assert.equal(revenueCatApiKeyName({ environment: 'test_store', devMode: false, expoGo: false, platform: 'ios' }), null);
  assert.equal(revenueCatApiKeyName({ environment: 'production', devMode: false, expoGo: false, platform: 'ios' }), 'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY');
  assert.equal(revenueCatApiKeyName({ environment: 'production', devMode: false, expoGo: false, platform: 'android' }), 'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY');
  assert.equal(revenueCatApiKeyName({ environment: 'production', devMode: false, expoGo: true, platform: 'ios' }), 'EXPO_PUBLIC_REVENUECAT_TEST_API_KEY');
  assert.equal(isUnsafeRevenueCatTestStoreRelease({ environment: 'test_store', devMode: false, expoGo: true }), false);
  const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
  assert.equal(eas.build.preview.env.EXPO_PUBLIC_REVENUECAT_ENVIRONMENT, 'production');
  assert.equal(eas.build.production.env.EXPO_PUBLIC_REVENUECAT_ENVIRONMENT, 'production');
  assert.match(revenuecat, /release-compiled build is configured with the RevenueCat Test Store key/);
  assert.match(revenuecat, /isUnsafeRevenueCatTestStoreRelease\(\{ environment, devMode: __DEV__, expoGo \}\)/);
  assert.doesNotMatch(revenuecat, /process\.env\[keyName\]/);
});

test('active web subscriptions use Stripe management instead of another checkout', () => {
  const status = { plan: 'student', billingSource: 'web', billingConflict: false };
  assert.match(getBillingActionBlock(status, 'stripe_checkout', 'web'), /active web subscription/);
  assert.match(plans, /button-manage-web-plan/);
  assert.match(plans, /Manage web subscription/);
});

test('Test Store upgrades are permitted only for Student to Pro in installed Debug preview mode', () => {
  const status = { plan: 'student', billingSource: 'test_store', billingConflict: false };
  for (const platform of ['ios', 'android']) {
    assert.match(getBillingActionBlock(status, 'native_purchase', platform), /cannot be changed from this build/);
    assert.equal(getBillingActionBlock(status, 'native_purchase', platform, {
      testStorePreview: true,
      targetPlan: 'pro',
    }), '');
    assert.match(getBillingActionBlock(status, 'native_purchase', platform, {
      testStorePreview: false,
      targetPlan: 'pro',
    }), /cannot be changed from this build/);
    assert.match(getBillingActionBlock(status, 'native_purchase', platform, {
      testStorePreview: true,
      targetPlan: 'student',
    }), /cannot be changed from this build/);
  }
  assert.match(getBillingActionBlock(status, 'native_purchase', 'web', {
    testStorePreview: true,
    targetPlan: 'pro',
  }), /cannot be changed from this build/);
  const proStatus = { ...status, plan: 'pro' };
  for (const platform of ['ios', 'android']) {
    assert.match(getBillingActionBlock(proStatus, 'native_purchase', platform, {
      testStorePreview: true,
      targetPlan: 'student',
    }), /cannot take effect now/);
  }
  assert.match(plans, /__DEV__ && isRevenueCatPreviewMode\(\)/);
  assert.match(plans, /testStorePreview,\s*targetPlan: plan\.id/);
  assert.doesNotMatch(plans, /Plan changes unavailable/);
  assert.match(plans, /RevenueCat did not provide a management link/);
  assert.match(plans, /Use the RevenueCat Test Store controls to reset or end the test entitlement/);
  assert.match(plans, /the library server has not confirmed \$\{planName\(plan\.id\)\} yet/);
  assert.doesNotMatch(plans, /Alert\.alert/);
});

test('native same-store subscription changes use the latest status and Google replacement modes', () => {
  assert.equal(getBillingActionBlock(
    { plan: 'student', billingSource: 'app_store', billingConflict: false },
    'native_purchase',
    'ios',
    { targetPlan: 'pro' },
  ), '');
  assert.equal(getBillingActionBlock(
    { plan: 'student', billingSource: 'play_store', billingConflict: false },
    'native_purchase',
    'android',
    { targetPlan: 'pro' },
  ), '');
  assert.match(plans, /billing\.refresh\(\{ forceRefresh: true \}\)/);
  assert.match(plans, /getBillingActionBlock\(freshStatus, 'native_purchase', Platform\.OS, \{/);
  assert.match(plans, /getBillingActionBlock\(purchaseStatus, 'native_purchase', Platform\.OS, \{/);
  assert.match(plans, /activeSubscriptions\.length !== 1/);
  assert.match(revenuecat, /STORE_REPLACEMENT_MODE\.DEFERRED/);
  assert.match(revenuecat, /STORE_REPLACEMENT_MODE\.WITH_TIME_PRORATION/);
  assert.match(revenuecat, /oldProductIdentifier: previousProductIdentifier/);
});

test('paid native plans can manage subscriptions and installed builds show store prices', () => {
  assert.match(plans, /status\.plan !== 'free' \? \(/);
  assert.match(plans, /customerInfo\.managementURL/);
  assert.match(plans, /showRevenueCatManageSubscriptions/);
  assert.match(plans, /pkg\?\.product\?\.priceString/);
  assert.match(plans, /Test mode: this is a RevenueCat preview purchase/);
  assert.match(plans, /Restore purchases/);
});