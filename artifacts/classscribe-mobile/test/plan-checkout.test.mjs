import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../lib/plan-checkout.js', import.meta.url), 'utf8');
const { usesWebPlanCheckout } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('browser plans use Stripe, regardless of preview ownership metadata', () => {
  assert.equal(usesWebPlanCheckout('web', false), true);
  assert.equal(usesWebPlanCheckout('web', true), true);
});
test('iPhone development previews offer available web plans', () => {
  assert.equal(usesWebPlanCheckout('ios', true), true);
});
test('installed iPhone apps remain on native App Store purchases', () => {
  assert.equal(usesWebPlanCheckout('ios', false), false);
  assert.equal(usesWebPlanCheckout('ios', undefined), false);
});
test('Android does not gain a web purchase bypass', () => {
  assert.equal(usesWebPlanCheckout('android', true), false);
  assert.equal(usesWebPlanCheckout('android', false), false);
});
test('preview plan selection and confirmation use the same checkout channel', async () => {
  const plans = await readFile(new URL('../app/plans.js', import.meta.url), 'utf8');
  assert.match(plans, /webCheckout=\{webCheckout\}/);
  assert.match(plans, /onPress=\{webCheckout \? startStripeCheckout : purchase\}/);
  assert.match(plans, /webCheckout \? !webStripeReady/);
  assert.match(plans, /purchaseDisabled=\{webCheckout \? !!purchaseBusy/);
  assert.match(plans, /Retry checkout availability/);
  assert.match(plans, /await openStripeURL\(result.url, checkoutTab\)/);
  assert.match(plans, /await openStripeURL\(result.url, checkoutTab\);\s*setConfirmPackage\(null\)/);
  assert.match(plans, /Check the confirmation box above to enable/);
  assert.match(plans, /else return Linking.openURL/);
  assert.doesNotMatch(plans, /expoGo \? 'Coming soon'/);
  assert.doesNotMatch(plans, /Purchases are not available in Expo Go/);
});
