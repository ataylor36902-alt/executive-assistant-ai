export const ACTIVE_CREDITS_CURRENCY_CODE = 'CREDITS';
export const LEGACY_CREDITS_CURRENCY_CODE = 'CRD';

export function isCreditsCurrencyMigrationComplete(status) {
  return status?.currencyMigrationComplete === true ||
    status?.migrationComplete === true ||
    status?.currencyMigration?.complete === true ||
    status?.currencyMigration?.status === 'complete' ||
    status?.migration?.currency?.complete === true;
}

export function getCreditsCurrencyCode(status) {
  const statusCode = status?.currencyCode;
  if (typeof statusCode === 'string' && statusCode.trim()) return statusCode.trim();
  if (isCreditsCurrencyMigrationComplete(status)) return ACTIVE_CREDITS_CURRENCY_CODE;
  const legacyCode = status?.currency?.code;
  if (typeof legacyCode === 'string' && legacyCode.trim()) return legacyCode.trim();
  return LEGACY_CREDITS_CURRENCY_CODE;
}

export function getCreditsCurrencyCacheTag(libraryCode, currencyCode, appVersion, platform) {
  return [String(appVersion || 'unknown'), String(platform || 'unknown'), String(libraryCode || ''), String(currencyCode || '').trim()].join(':');
}

export function shouldInvalidateCreditsCurrencyCache(previousTag, nextTag) {
  return previousTag !== nextTag;
}

export function selectCreditsVirtualCurrency(currencies, currencyCode) {
  if (!currencyCode || !currencies?.all || typeof currencies.all !== 'object') return null;
  return currencies.all[currencyCode] || null;
}

export function getDisplayedCreditsBalance(statusBalance, nativeBalance, nativeCurrencyMatches) {
  if (!nativeCurrencyMatches || nativeBalance == null || !Number.isFinite(Number(nativeBalance))) return statusBalance;
  if (Number(nativeBalance) === 0 && Number.isFinite(Number(statusBalance)) && Number(statusBalance) > 0) return statusBalance;
  return Number(nativeBalance);
}