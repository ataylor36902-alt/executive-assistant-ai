const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { canChooseFreePlan, isOnboardingPlanReady, needsOnboardingPlan } = require('../.plan-onboarding-test.cjs');

const plans = readFileSync('app/plans.js', 'utf8');
const api = readFileSync('lib/api.js', 'utf8');
const billing = readFileSync('lib/billing.js', 'utf8');
const renewalCopy = readFileSync('lib/renewal-copy.js', 'utf8');
const welcome = readFileSync('app/welcome.js', 'utf8');
const tabLayout = readFileSync('app/(tabs)/_layout.js', 'utf8');
const rootLayout = readFileSync('app/_layout.js', 'utf8');

test('new libraries need an explicit choice; legacy libraries are not interrupted', () => {
  assert.equal(needsOnboardingPlan({ onboardingPlanPending: true }), true);
  assert.equal(needsOnboardingPlan({}), false);
  assert.equal(needsOnboardingPlan({ onboardingPlanPending: false }), false);
  assert.equal(isOnboardingPlanReady({ onboardingPlanPending: true }, { plan: 'free', status: 'inactive' }), false);
  assert.equal(isOnboardingPlanReady({ onboardingPlanChoice: 'free' }, { plan: 'free', status: 'inactive' }), true);
  assert.equal(isOnboardingPlanReady({ onboardingPlanChoice: 'free' }, { plan: 'free', status: 'expired' }), true);
  assert.equal(isOnboardingPlanReady({ onboardingPlanChoice: 'free' }, null), false);
});

test('paid onboarding requires an active server-confirmed subscription', () => {
  assert.equal(isOnboardingPlanReady({}, { plan: 'student', status: 'active' }), true);
  assert.equal(isOnboardingPlanReady({}, { plan: 'pro', status: 'trialing' }), true);
  for (const status of ['past_due', 'unpaid', 'canceled', 'incomplete']) {
    assert.equal(isOnboardingPlanReady({}, { plan: 'student', status }), false);
  }
  assert.equal(isOnboardingPlanReady({ onboardingPlanChoice: 'student' }, { plan: 'free', status: 'inactive' }), false);
});

test('Free remains actionable while billing is loading or has failed, but not for another library', () => {
  assert.equal(canChooseFreePlan({ isOnboarding: true, hasProfile: true, libraryMatches: true, purchaseBusy: '' }), true);
  assert.equal(canChooseFreePlan({ isOnboarding: true, hasProfile: true, libraryMatches: false, purchaseBusy: '' }), false);
  assert.equal(canChooseFreePlan({ isOnboarding: true, hasProfile: true, libraryMatches: true, purchaseBusy: 'free' }), false);
  assert.equal(canChooseFreePlan({ isOnboarding: true, hasProfile: false, libraryMatches: true, purchaseBusy: '' }), false);
  assert.match(plans, /const currentBilling = await billing\.refresh\(\)/);
  assert.match(plans, /if \(currentBilling\.plan !== 'free'\)/);
});

test('profile setup and home navigation require completing plan choice', () => {
  assert.match(welcome, /onboardingPlanPending: true/);
  assert.match(tabLayout, /if \(needsOnboardingPlan\(profile\)\) return <Redirect/);
  assert.match(plans, /onChooseFree=\{chooseFree\}/);
  assert.match(plans, /if \(isOnboarding && st\.profile === null\) return <Redirect href="\/welcome" \/>/);
  assert.match(plans, /await st\.saveProfile\(\{ onboardingPlanChoice: 'free', onboardingPlanPending: false \}\)/);
  assert.match(plans, /if \(libraryCode === getUid\(\)\) router\.replace\('\/home'\)/);
  assert.match(plans, /await st\.saveProfile\(\{ onboardingPlanChoice: verifiedBilling\.plan, onboardingPlanPending: false \}\)/);
  assert.match(plans, /const planReady = isOnboarding && !!st\.profile && isOnboardingPlanReady\(st\.profile, verifiedBilling\)/);
  assert.doesNotMatch(plans, /title="Continue to your library" onPress=\{\(\) => router\.replace\('\/home'\)\}/);
});

test('onboarding plans offer a tappable route to account sign-in', () => {
  assert.match(plans, /isOnboarding \? \(\s*<>\s*<Text[^>]*>Change your level in Account whenever you like\.<\/Text>/);
  assert.match(plans, /testID="link-onboarding-account-sign-in"/);
  assert.match(plans, /onPress=\{\(\) => router\.push\('\/account-sign-in'\)\}/);
});

test('web plans use authenticated Stripe checkout and display the exact prices', () => {
  assert.match(plans, /isOnboarding \? 'Choose' : 'Upgrade to'/);
  assert.match(plans, /Student — \$7\.99\/month/);
  assert.match(plans, /Pro — \$12\.99\/month/);
  assert.match(plans, /billingReadiness\?\.ready === true/);
  assert.match(plans, /purchaseDisabled=\{webCheckout \? !!purchaseBusy/);
  assert.match(plans, /disabled=\{\(webCheckout \? !webStripeReady : !purchaseReady\)/);
  assert.match(plans, /Retry checkout availability/);
  assert.match(plans, /Upgrades aren't set up yet/);
  assert.match(plans, /button-retry-upgrade-readiness/);
  assert.match(plans, /Continue to secure checkout/);
  assert.match(plans, /billing\.refresh\(\)/);
  assert.match(plans, /result === 'success'/);
  assert.match(plans, /status\.plan !== 'free'/);
  assert.match(plans, /Manage subscription/);
  assert.match(plans, /window\.self !== window\.top/);
  assert.match(plans, /window\.location\.assign/);
  assert.match(api, /createStripeCheckout/);
  assert.match(api, /\/api\/billing\/checkout/);
  assert.match(api, /createStripePortal/);
  assert.match(api, /\/api\/billing\/portal/);
  assert.match(api, /if \(libraryCode !== UID\)/);
});

test('iPhone previews offer secure web checkout without calling native in-app purchases', () => {
  assert.match(plans, /usesWebPlanCheckout\(Platform\.OS, expoGo\)/);
  assert.match(plans, /Choose a plan above to open secure web checkout for this library/);
  assert.match(plans, /onPress=\{webCheckout \? startStripeCheckout : purchase\}/);
  assert.match(plans, /Store prices could not be loaded/);
  assert.match(plans, /canUseNativeRevenueCat/);
  assert.doesNotMatch(plans, /Purchases are not available in Expo Go/);
  assert.match(plans, /pkg\.identifier/);
  assert.match(plans, /isRevenueCatExpoGo/);
  assert.doesNotMatch(plans, /\bAlert(?:\.|\()/);
});

test('server-confirmed paid plan copy is consistent and billing readiness is preserved', () => {
  assert.match(plans, /function confirmedPlanMessage\(plan\)/);
  assert.match(plans, /confirmedPlanMessage\(status\.plan\)/);
  assert.match(plans, /confirmedPlanMessage\(confirmed\.plan\)/);
  assert.match(plans, /if \(result === 'success'\)/);
  assert.match(billing, /return value;/);
});

test('web portal return forces one refresh and shows cancellation timing without dropping paid access', () => {
  assert.match(api, /getBillingStatus\(libraryCode = UID, \{ forceRefresh = false \} = \{\}\)/);
  assert.match(api, /forceRefresh \? '\?refresh=1' : ''/);
  assert.match(billing, /getBillingStatus\(libraryCode, \{ forceRefresh \}\)/);
  assert.match(plans, /result === 'portal' && !portalRefreshStarted\.current/);
  assert.match(plans, /billing\.refresh\(\{ forceRefresh \}\)/);
  assert.match(renewalCopy, /status\.cancelAtPeriodEnd === true/);
  assert.match(renewalCopy, /cancels \$\{date\} \(paid access continues until then\)/);
  assert.match(renewalCopy, /renews \$\{date\}/);
});

test('Back from onboarding plans returns to account setup instead of looping through Home', () => {
  assert.match(rootLayout, /name="plans" options=\{\{ title: 'Plans', headerLeft: \(\) => <BackButton destination=\{needsOnboardingPlan\(profile\) \? '\/welcome' : undefined\} \/> \}\}/);
  assert.match(readFileSync('components/BackButton.js', 'utf8'), /destination \? \(\) => router\.replace\(destination\)/);
});