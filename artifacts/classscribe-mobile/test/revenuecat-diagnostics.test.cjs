const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const {
  canUseNativeRevenueCat,
  formatRevenueCatError,
  logRevenueCatError,
} = require('../.revenuecat-diagnostics-test.cjs');

test('RevenueCat diagnostics prefer the exact underlying message and readable code', () => {
  const sdkError = {
    message: 'The purchase failed',
    underlyingErrorMessage: 'Billing service unavailable',
    readableErrorCode: 'STORE_PROBLEM',
  };
  assert.deepEqual(formatRevenueCatError(sdkError, 'purchase'), {
    friendlyMessage: 'The store couldn’t complete this purchase. Your current plan changes only after the library server confirms them. Please try again.',
    underlyingErrorMessage: 'Billing service unavailable',
    readableErrorCode: 'STORE_PROBLEM',
    message: 'The purchase failed',
  });
});

test('RevenueCat diagnostics fall back to the SDK message and provide operation-friendly copy', () => {
  assert.deepEqual(formatRevenueCatError(new Error('Catalog request failed'), 'offerings'), {
    friendlyMessage: 'We couldn’t load subscription options. Please try again. If the problem continues, contact support.',
    underlyingErrorMessage: '',
    readableErrorCode: '',
    message: 'Catalog request failed',
  });
  assert.match(formatRevenueCatError({}, 'restore').friendlyMessage, /Purchases couldn’t be restored/);
  assert.equal(formatRevenueCatError({ code: 23 }, 'offerings').readableErrorCode, '23');
});

test('RevenueCat error logging retains the full SDK error object and operation', () => {
  const originalError = { readableErrorCode: 'STORE_PROBLEM' };
  const previousConsoleError = console.error;
  let logged;
  console.error = (...args) => { logged = args; };
  try {
    logRevenueCatError('restore', originalError);
  } finally {
    console.error = previousConsoleError;
  }
  assert.equal(logged[0], 'RevenueCat restore failed');
  assert.deepEqual(logged[1], originalError);
  assert.notEqual(logged[1], originalError);
});

test('nested credentials and known token patterns are redacted in logged and displayed diagnostics', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const originalError = {
    message: `Store request failed with ${jwt}`,
    underlyingErrorMessage: 'The store rejected the request; authorization: Bearer top-level-secret',
    readableErrorCode: 'STORE_PROBLEM',
    apiKey: 'private-api-key-value',
    context: {
      refreshToken: 'refresh-token-value',
      nested: {
        authorization: 'Bearer nested-secret',
        reason: 'Payment method was declined',
      },
    },
  };
  const previousConsoleError = console.error;
  let logged;
  console.error = (...args) => { logged = args; };
  let details;
  try {
    details = logRevenueCatError('purchasePackage', originalError);
  } finally {
    console.error = previousConsoleError;
  }

  assert.equal(logged[0], 'RevenueCat purchasePackage failed');
  assert.equal(logged[1].apiKey, '[REDACTED]');
  assert.equal(logged[1].context.refreshToken, '[REDACTED]');
  assert.equal(logged[1].context.nested.authorization, '[REDACTED]');
  assert.equal(logged[1].context.nested.reason, 'Payment method was declined');
  assert.equal(logged[1].message, 'Store request failed with [REDACTED]');
  assert.equal(details.underlyingErrorMessage, 'The store rejected the request; authorization: Bearer [REDACTED]');
  assert.equal(details.readableErrorCode, 'STORE_PROBLEM');
  assert.equal(details.message, 'Store request failed with [REDACTED]');
  assert.doesNotMatch(JSON.stringify(logged[1]), /private-api-key-value|refresh-token-value|top-level-secret|nested-secret|eyJhbGci/);
  assert.doesNotMatch(JSON.stringify(details), /top-level-secret|eyJhbGci/);
});

test('RevenueCat Test Store and configured public keys are not exposed in diagnostics', () => {
  const configuredKey = 'other_public_key_value_123456';
  const testKey = 'test_abcdefghijklmnopqrstuvwxyz123456';
  const previous = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = configuredKey;
  try {
    const error = { message: `Key ${testKey}`, underlyingErrorMessage: `Store key ${configuredKey}`, readableErrorCode: 'CONFIGURATION_ERROR' };
    const previousConsoleError = console.error;
    let logged;
    console.error = (...args) => { logged = args; };
    let diagnostic;
    try { diagnostic = logRevenueCatError('getOfferings', error); }
    finally { console.error = previousConsoleError; }
    assert.doesNotMatch(JSON.stringify(logged), /test_abcdefghijklmnopqrstuvwxyz|other_public_key_value/);
    assert.doesNotMatch(JSON.stringify(diagnostic), /test_abcdefghijklmnopqrstuvwxyz|other_public_key_value/);
    assert.equal(diagnostic.readableErrorCode, 'CONFIGURATION_ERROR');
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
    else process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = previous;
  }
});

test('passive plans reloads do not clear purchase diagnostics; dismiss is explicit', () => {
  const plans = readFileSync('app/plans.js', 'utf8');
  const loadStart = plans.indexOf('const load = async () => {');
  const listenerStart = plans.indexOf('const subscription = AppState.addEventListener', loadStart);
  assert.notEqual(loadStart, -1);
  assert.notEqual(listenerStart, -1);
  const passiveLoad = plans.slice(loadStart, listenerStart);
  assert.doesNotMatch(passiveLoad, /setPurchaseError\(''\)|setPurchaseErrorDiagnostic\(null\)/);
  assert.match(passiveLoad, /if \(!retainedStoreError\.current\)/);
  assert.match(plans, /accessibilityLabel="Dismiss purchase error"/);
  assert.match(plans, /setPurchaseError\(''\); setPurchaseErrorDiagnostic\(null\);/);
});

test('native RevenueCat purchase SDK is disabled for web and Expo Go only', () => {
  assert.equal(canUseNativeRevenueCat({ platform: 'web', expoGo: false }), false);
  assert.equal(canUseNativeRevenueCat({ platform: 'ios', expoGo: true }), false);
  assert.equal(canUseNativeRevenueCat({ platform: 'android', expoGo: false }), true);
});