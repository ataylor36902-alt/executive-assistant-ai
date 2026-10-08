const assert = require('node:assert/strict');
const test = require('node:test');
const { selectCreditsOffering } = require('../.credits-status-test.cjs');

test('Credits selects the server-named offering instead of RevenueCat current', () => {
  const creditsOffering = { identifier: 'classscribe-credits' };
  const subscriptionOffering = { identifier: 'default-subscriptions' };
  const selected = selectCreditsOffering({
    current: subscriptionOffering,
    all: { 'classscribe-credits': creditsOffering, default: subscriptionOffering },
  }, { offeringIdentifier: 'classscribe-credits' });
  assert.equal(selected, creditsOffering);
});

test('Credits defaults only to the dedicated credits offering when the status has no identifier', () => {
  const creditsOffering = { identifier: 'credits' };
  const selected = selectCreditsOffering({
    current: { identifier: 'subscription' },
    all: { credits: creditsOffering },
  }, {});
  assert.equal(selected, creditsOffering);
});

test('missing Credits offering reports an explicit unavailable error without using current', () => {
  assert.throws(
    () => selectCreditsOffering({ current: { identifier: 'subscription' }, all: {} }, { offeringIdentifier: 'credits' }),
    /Credits store offering "credits" is unavailable/,
  );
});