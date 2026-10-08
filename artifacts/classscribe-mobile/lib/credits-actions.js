import { Platform } from 'react-native';
import { getCreditsStatus, getUid } from './api';
import { getRevenueCatVirtualCurrencies, invalidateRevenueCatVirtualCurrenciesCache, isRevenueCatExpoGo } from './revenuecat';
import { isUnsafeRevenueCatTestStoreRelease } from './revenuecat-environment';
import { getCreditsCurrencyCode } from './credits-currency';

export function isCreditsRequired(error) {
  return error?.code === 'credits_required' && !!error?.requestId;
}

export async function refreshCreditsAfterAction(libraryCode) {
  if (!libraryCode || libraryCode !== getUid()) {
    throw new Error('The active library changed before Credits could be refreshed.');
  }
  let warning = '';
  const nativeStoreAvailable = Platform.OS !== 'web' && !isRevenueCatExpoGo() &&
    !isUnsafeRevenueCatTestStoreRelease({
      environment: process.env.EXPO_PUBLIC_REVENUECAT_ENVIRONMENT,
      devMode: __DEV__,
      expoGo: false,
    });
  if (nativeStoreAvailable) {
    try {
      await invalidateRevenueCatVirtualCurrenciesCache(libraryCode);
    } catch {
      warning = 'The action is complete, but the store Credits balance could not be refreshed yet.';
    }
  }
  const status = await getCreditsStatus(libraryCode);
  if (nativeStoreAvailable && !warning) {
    try {
      await getRevenueCatVirtualCurrencies(libraryCode, getCreditsCurrencyCode(status));
    } catch {
      warning = 'The action is complete, but the store Credits balance could not be refreshed yet.';
    }
  }
  return { status, warning };
}