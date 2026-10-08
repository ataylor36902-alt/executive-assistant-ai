const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { canContinueFromSignIn, canShowProfileSetup } = require('../.required-auth-test.cjs');

const welcome = readFileSync('app/welcome.js', 'utf8');
const signIn = readFileSync('components/OptionalSignIn.js', 'utf8');

test('required account setup blocks signed-out and unfinished sign-in sessions', () => {
  assert.equal(canContinueFromSignIn({ required: true, isSignedIn: false }), false);
  assert.equal(canContinueFromSignIn({ required: true, isSignedIn: undefined }), false);
  assert.equal(canContinueFromSignIn({ required: true, isSignedIn: true }), true);
  assert.equal(canContinueFromSignIn({ required: true, isSignedIn: true, taskBlocked: true }), false);
  assert.equal(canContinueFromSignIn({ required: true, isSignedIn: true, verificationPending: true }), false);
  assert.equal(canContinueFromSignIn({ required: false, isSignedIn: false }), true);
  assert.match(signIn, /canContinueFromSignIn\(\{ required, isSignedIn, taskBlocked, verificationPending: \['verify', 'mfa', 'reset-email', 'reset-code', 'reset-password'\]\.includes\(mode\) \}\)/);
});

test('welcome profile setup requires Clerk, an active session, and an explicit continue action', () => {
  assert.equal(canShowProfileSetup({ clerkConfigured: false, isSignedIn: true, accountReady: true }), false);
  assert.equal(canShowProfileSetup({ clerkConfigured: true, isSignedIn: false, accountReady: true }), false);
  assert.equal(canShowProfileSetup({ clerkConfigured: true, isSignedIn: true, accountReady: false }), false);
  assert.equal(canShowProfileSetup({ clerkConfigured: true, isSignedIn: true, accountReady: true }), true);
  assert.match(welcome, /if \(!clerkPublishableKey\)/);
  assert.match(welcome, /const profileSetupAllowed = canShowProfileSetup\(\{ clerkConfigured: true, isSignedIn, accountReady \}\)/);
  assert.match(welcome, /onContinue=\{\(\) => setAccountReady\(true\)\}/);
  assert.match(welcome, /if \(!requireAccount\(\)\) return;/);
});

test('Apple and Google sessions proceed only after Clerk activates a completed session', () => {
  assert.match(signIn, /startSSOFlow\(\{\s*strategy,/);
  assert.match(signIn, /if \(!createdSessionId \|\| !setActive\)/);
  assert.match(signIn, /setActive\(\{ session: createdSessionId, navigate: finish \}\)/);
  assert.match(signIn, /onContinue\(\{ fromAuth: true \}\)/);
  assert.match(signIn, /if \(session\?\.currentTask\)/);
  assert.match(signIn, /Continue with Apple/);
  assert.match(signIn, /Continue with Google/);
});

test('email sign-up requires verification when needed; returning email users still sign in', () => {
  assert.match(signIn, /signUp\.password\(\{\s*emailAddress: email\.trim\(\),\s*password,\s*unsafeMetadata: \{ ageBand: newAccountAgeBand \},\s*\}\)/);
  assert.match(signIn, /signIn\.password\(\{ emailAddress: email\.trim\(\), password \}\)/);
  assert.match(signIn, /useState\(required && !recoverOnly \? 'signup' : 'choose'\)/);
  assert.match(signIn, /onPress=\{\(\) => changeMode\('signin'\)\}/);
  assert.match(signIn, /signUp\.verifications\.verifyEmailCode\(\{ code: code\.trim\(\) \}\)/);
  assert.match(signIn, /if \(signUp\.status === 'complete'\) await completeSignUp\(\)/);
  assert.match(signIn, /else setError\('Account setup needs another step\./);
});

test('missing Clerk configuration shows a blocked state without a guest continuation', () => {
  assert.match(signIn, /required \? 'Account sign-in is unavailable on this build\./);
  assert.match(signIn, /canContinueFromSignIn\(\{ required, isSignedIn, taskBlocked, verificationPending: \['verify', 'mfa', 'reset-email', 'reset-code', 'reset-password'\]\.includes\(mode\) \}\)/);
  assert.match(signIn, /required\s*\?\s*'Create or sign in to a ClassScribe account before setting up your library\.'/);
});