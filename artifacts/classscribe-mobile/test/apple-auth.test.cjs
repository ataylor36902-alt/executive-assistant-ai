const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APPLE_UNAVAILABLE_COPY,
  appleErrorMessage,
  appleSignInMode,
  appleStrategyAvailability,
  appleUnavailableMessage,
  isProviderConnected,
  shouldUseMobileOAuthRedirect,
  verifyAppleAccountLink,
} = require('../.apple-auth-test.cjs');

test('native Apple authentication is used only for installed iOS builds', () => {
  assert.equal(appleSignInMode('ios', false), 'native');
  assert.equal(appleSignInMode('ios', true), 'oauth');
  assert.equal(appleSignInMode('android', false), 'oauth');
  assert.equal(appleSignInMode('web', false), 'oauth');
});

test('Apple availability is detected from Clerk social provider strategies when present', () => {
  assert.equal(appleStrategyAvailability(['oauth_apple', 'oauth_google']), true);
  assert.equal(appleStrategyAvailability(['oauth_google']), false);
  assert.equal(appleStrategyAvailability(undefined), null);
});

test('mobile OAuth redirects retain the app scheme for iOS Google and Android providers', () => {
  assert.equal(shouldUseMobileOAuthRedirect('ios', 'oauth_google', false), true);
  assert.equal(shouldUseMobileOAuthRedirect('android', 'oauth_apple', false), true);
  assert.equal(shouldUseMobileOAuthRedirect('ios', 'oauth_apple', true), true);
  assert.equal(shouldUseMobileOAuthRedirect('ios', 'oauth_apple', false), false);
  assert.equal(shouldUseMobileOAuthRedirect('web', 'oauth_google', false), false);
});

test('Apple cancellation is explained without hiding Clerk errors', () => {
  assert.match(appleErrorMessage({ code: 'ERR_REQUEST_CANCELED' }, () => 'generic'), /was canceled/);
  assert.equal(appleErrorMessage({ errors: [{ longMessage: 'Apple provider is not enabled' }] }, (error) => error.errors[0].longMessage), 'Apple provider is not enabled');
});

test('unavailable copy includes the real Clerk error when one exists', () => {
  assert.equal(appleUnavailableMessage(null, () => ''), APPLE_UNAVAILABLE_COPY);
  const clerkError = { errors: [{ longMessage: 'Apple OAuth is disabled by the instance' }] };
  assert.match(appleUnavailableMessage(clerkError, (error) => error.errors[0].longMessage), /Apple OAuth is disabled by the instance/);
});

test('connected providers normalize strategy values and require verified status', () => {
  assert.equal(isProviderConnected([{ provider: 'oauth_apple', verification: { status: 'verified' } }], 'apple'), true);
  assert.equal(isProviderConnected([{ providerSlug: () => 'google', verification: { status: 'verified' } }], 'google'), true);
  assert.equal(isProviderConnected([{ provider: 'oauth_apple', verification: { status: 'unverified' } }], 'apple'), false);
  assert.equal(isProviderConnected([{ provider: 'oauth_apple' }], 'apple'), false);
  assert.equal(isProviderConnected([{ provider: 'github' }], 'apple'), false);
});

test('Apple linking is successful only after Clerk verifies it for the same user', () => {
  const sameUser = { id: 'user_123', externalAccounts: [{ provider: 'apple', verification: { status: 'verified' } }] };
  assert.equal(verifyAppleAccountLink('user_123', sameUser), true);
  assert.throws(() => verifyAppleAccountLink('user_123', { id: 'user_other', externalAccounts: [{ provider: 'apple', verification: { status: 'verified' } }] }), /account changed/);
  assert.throws(() => verifyAppleAccountLink('user_123', { id: 'user_123', externalAccounts: [{ provider: 'apple', verification: { status: 'unverified' } }] }), /has not verified/);
});