const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTIVE_CREDITS_CURRENCY_CODE,
  LEGACY_CREDITS_CURRENCY_CODE,
  getCreditsCurrencyCacheTag,
  getCreditsCurrencyCode,
  getDisplayedCreditsBalance,
  selectCreditsVirtualCurrency,
  shouldInvalidateCreditsCurrencyCache,
} = require('../.credits-currency-test.cjs');
const fs = require('node:fs');
const path = require('node:path');

test('uses the server active currency code and only selects that virtual currency', () => {
  const serverStatus = { currencyCode: 'CREDITS', currency: { code: 'CRD' } };
  const currencies = { all: { CREDITS: { balance: 42 }, CRD: { balance: 0 } } };

  assert.equal(getCreditsCurrencyCode(serverStatus), 'CREDITS');
  assert.deepEqual(selectCreditsVirtualCurrency(currencies, getCreditsCurrencyCode(serverStatus)), { balance: 42 });
  assert.equal(selectCreditsVirtualCurrency(currencies, 'UNRELATED'), null);
});

test('preserves the legacy currency while migration is pending and selects CREDITS when complete', () => {
  assert.equal(getCreditsCurrencyCode({ currency: { code: 'CRD' }, currencyMigrationComplete: false }), LEGACY_CREDITS_CURRENCY_CODE);
  assert.equal(getCreditsCurrencyCode({ currency: { code: 'CRD' }, currencyMigrationComplete: true }), ACTIVE_CREDITS_CURRENCY_CODE);
  assert.equal(getCreditsCurrencyCode({ migrationComplete: true }), ACTIVE_CREDITS_CURRENCY_CODE);
});

test('a zero native snapshot never replaces a verified positive server balance during migration', () => {
  assert.equal(getDisplayedCreditsBalance(27, 0, true), 27);
  assert.equal(getDisplayedCreditsBalance(0, 0, true), 0);
  assert.equal(getDisplayedCreditsBalance(27, 0, false), 27);
});

test('currency cache tag changes across app versions, libraries, platforms, and currency switches', () => {
  const tag = getCreditsCurrencyCacheTag('library-a', 'CREDITS', '2.0.0', 'ios');

  assert.equal(shouldInvalidateCreditsCurrencyCache(tag, tag), false);
  assert.notEqual(tag, getCreditsCurrencyCacheTag('library-a', 'CRD', '2.0.0', 'ios'));
  assert.notEqual(tag, getCreditsCurrencyCacheTag('library-a', 'CREDITS', '2.0.1', 'ios'));
  assert.notEqual(tag, getCreditsCurrencyCacheTag('library-b', 'CREDITS', '2.0.0', 'ios'));
  assert.notEqual(tag, getCreditsCurrencyCacheTag('library-a', 'CREDITS', '2.0.0', 'android'));
  assert.equal(shouldInvalidateCreditsCurrencyCache(tag, getCreditsCurrencyCacheTag('library-a', 'CRD', '2.0.0', 'ios')), true);
});

test('native VC reads are targeted and server grants explicitly invalidate SDK caching', () => {
  const revenuecat = fs.readFileSync(path.join(__dirname, '../lib/revenuecat.js'), 'utf8');
  const actions = fs.readFileSync(path.join(__dirname, '../lib/credits-actions.js'), 'utf8');

  assert.match(revenuecat, /selectCreditsVirtualCurrency\(currencies, currencyCode\.trim\(\)\)/);
  assert.match(revenuecat, /Purchases\.invalidateVirtualCurrenciesCache\(\)/);
  assert.match(actions, /await invalidateRevenueCatVirtualCurrenciesCache\(libraryCode\)/);
  assert.match(actions, /getRevenueCatVirtualCurrencies\(libraryCode, getCreditsCurrencyCode\(status\)\)/);
});