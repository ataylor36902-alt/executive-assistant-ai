const test = require('node:test');
const assert = require('node:assert/strict');
const { billingPeriodMessage, isRevenueCatRenewalStatus } = require('../.renewal-copy-test.cjs');

const date = 'Aug 20, 2027';
const nativeStatus = (renewalStatus) => ({
  plan: 'student',
  billingSource: 'app_store',
  renewalStatus,
});

test('validates RevenueCat v2 auto-renewal statuses', () => {
  for (const value of ['will_renew', 'will_not_renew', 'will_change_product', 'will_pause', 'requires_price_increase_consent']) {
    assert.equal(isRevenueCatRenewalStatus(value), true);
  }
  assert.equal(isRevenueCatRenewalStatus('unknown_status'), false);
});

test('RevenueCat will_not_renew retains access through the period end', () => {
  assert.equal(
    billingPeriodMessage(nativeStatus('will_not_renew'), date),
    ` · cancels ${date} (paid access continues until then)`,
  );
  assert.equal(
    billingPeriodMessage(nativeStatus('will_not_renew'), ''),
    ' · cancels at period end (paid access continues until then)',
  );
});

test('RevenueCat scheduled plan changes are not described as renewal or cancellation', () => {
  const message = billingPeriodMessage(nativeStatus('will_change_product'), date);
  assert.equal(message, ` · plan changes ${date}`);
  assert.doesNotMatch(message, /renews|cancels/);
});

test('RevenueCat pause and price-increase consent states are explained clearly', () => {
  assert.equal(
    billingPeriodMessage(nativeStatus('will_pause'), date),
    ` · pauses ${date} (paid access continues until then)`,
  );
  assert.equal(
    billingPeriodMessage(nativeStatus('will_pause'), ''),
    ' · pauses after this period (paid access continues until then)',
  );
  assert.equal(
    billingPeriodMessage(nativeStatus('requires_price_increase_consent'), date),
    ` · renewal needs your price-increase consent by ${date}`,
  );
  assert.equal(
    billingPeriodMessage(nativeStatus('requires_price_increase_consent'), ''),
    ' · renewal needs your consent to the price increase',
  );
});

test('RevenueCat will_renew and Stripe cancellation semantics remain intact', () => {
  assert.equal(billingPeriodMessage(nativeStatus('will_renew'), date), ` · renews ${date}`);
  assert.equal(
    billingPeriodMessage({ plan: 'pro', billingSource: 'web', renewalStatus: 'will_renew', cancelAtPeriodEnd: true }, date),
    ` · cancels ${date} (paid access continues until then)`,
  );
  assert.equal(
    billingPeriodMessage({ plan: 'pro', billingSource: 'web', renewalStatus: 'will_not_renew', cancelAtPeriodEnd: false }, date),
    ` · renews ${date}`,
  );
});