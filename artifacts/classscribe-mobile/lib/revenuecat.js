import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { STORE_REPLACEMENT_MODE } from 'react-native-purchases';
import { getRevenueCatIdentity, getUid } from './api';
import { isRevenueCatTestStore, isUnsafeRevenueCatTestStoreRelease, revenueCatApiKeyName } from './revenuecat-environment';
import { getCreditsCurrencyCacheTag, selectCreditsVirtualCurrency, shouldInvalidateCreditsCurrencyCache } from './credits-currency';

let revenueCatQueue = Promise.resolve();
const virtualCurrenciesCacheKey = () => `cs_revenuecat_virtual_currencies_${Platform.OS}`;

function enqueue(operation) {
  const result = revenueCatQueue.then(operation, operation);
  revenueCatQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function isRevenueCatPreviewMode() {
  return isRevenueCatTestStore({
    environment: process.env.EXPO_PUBLIC_REVENUECAT_ENVIRONMENT,
    devMode: __DEV__,
    expoGo: Constants.executionEnvironment === 'storeClient',
  });
}

export function isRevenueCatExpoGo() {
  return Constants.executionEnvironment === 'storeClient';
}

function publicApiKey() {
  if (Platform.OS === 'web') {
    throw new Error('In-app purchases are available in the ClassScribe iOS and Android apps.');
  }
  const environment = process.env.EXPO_PUBLIC_REVENUECAT_ENVIRONMENT;
  const expoGo = Constants.executionEnvironment === 'storeClient';
  if (isUnsafeRevenueCatTestStoreRelease({ environment, devMode: __DEV__, expoGo })) {
    throw new Error('This release-compiled build is configured with the RevenueCat Test Store key, which RevenueCat intentionally rejects in release apps. Use the App Store or Google Play key for installed previews. Test Store purchases require a local Debug build; Expo Go cannot make purchases.');
  }
  const keyName = revenueCatApiKeyName({
    platform: Platform.OS,
    environment,
    devMode: __DEV__,
    expoGo,
  });
  const key = keyName === 'EXPO_PUBLIC_REVENUECAT_TEST_API_KEY'
    ? process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY
    : keyName === 'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
      : keyName === 'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY'
        ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
        : null;
  if (!key) {
    throw new Error('RevenueCat is not configured for this app environment. Check the public mobile API key settings.');
  }
  return key;
}

async function configureLibrary(libraryCode) {
  if (libraryCode !== getUid()) {
    throw { code: 'library_changed', message: 'The active library changed. Reopen its plan page to continue.' };
  }
  const apiKey = publicApiKey();
  const { appUserId } = await getRevenueCatIdentity(libraryCode);
  if (libraryCode !== getUid()) {
    throw { code: 'library_changed', message: 'The active library changed. Reopen its plan page to continue.' };
  }

  if (!await Purchases.isConfigured()) {
    Purchases.configure({ apiKey, appUserID: appUserId });
  } else if (await Purchases.getAppUserID() !== appUserId) {
    await Purchases.logIn(appUserId);
  }

  if (libraryCode !== getUid()) {
    throw { code: 'library_changed', message: 'The active library changed. Reopen its plan page to continue.' };
  }
}

export function getRevenueCatOfferings(libraryCode) {
  return enqueue(async () => {
    await configureLibrary(libraryCode);
    const offerings = await Purchases.getOfferings();
    if (libraryCode !== getUid()) {
      throw { code: 'library_changed', message: 'The active library changed. Reopen its plan page to continue.' };
    }
    return offerings;
  });
}

export function purchaseRevenueCatPackage(libraryCode, packageToPurchase, previousProductIdentifier, targetTier) {
  return enqueue(async () => {
    await configureLibrary(libraryCode);
    if (libraryCode !== getUid()) {
      throw { code: 'library_changed', message: 'The active library changed. Reopen its plan page to continue.' };
    }
    if (Platform.OS === 'android' && previousProductIdentifier) {
      const replacementMode = targetTier === 'downgrade'
        ? STORE_REPLACEMENT_MODE.DEFERRED
        : STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION;
      return Purchases.purchasePackage(packageToPurchase, null, {
        oldProductIdentifier: previousProductIdentifier,
        replacementMode,
      });
    }
    return Purchases.purchasePackage(packageToPurchase);
  });
}

export function getRevenueCatVirtualCurrencies(libraryCode, currencyCode) {
  return enqueue(async () => {
    if (typeof currencyCode !== 'string' || !currencyCode.trim()) {
      throw new Error('The server did not identify the active Credits currency. Refresh Credits before continuing.');
    }
    await configureLibrary(libraryCode);
    const cacheTag = getCreditsCurrencyCacheTag(
      libraryCode,
      currencyCode,
      Constants.expoConfig?.version || Constants.nativeAppVersion,
      Platform.OS,
    );
    const key = virtualCurrenciesCacheKey();
    const previousTag = await AsyncStorage.getItem(key);
    if (shouldInvalidateCreditsCurrencyCache(previousTag, cacheTag)) {
      await Purchases.invalidateVirtualCurrenciesCache();
      await AsyncStorage.setItem(key, cacheTag);
    }
    const currencies = await Purchases.getVirtualCurrencies();
    if (libraryCode !== getUid()) {
      throw { code: 'library_changed', message: 'The active library changed. Reopen Credits to continue.' };
    }
    return selectCreditsVirtualCurrency(currencies, currencyCode.trim());
  });
}

export function invalidateRevenueCatVirtualCurrenciesCache(libraryCode) {
  return enqueue(async () => {
    await configureLibrary(libraryCode);
    await Purchases.invalidateVirtualCurrenciesCache();
    if (libraryCode !== getUid()) {
      throw { code: 'library_changed', message: 'The active library changed. Reopen Credits to continue.' };
    }
  });
}

export function getRevenueCatCustomerInfo(libraryCode) {
  return enqueue(async () => {
    await configureLibrary(libraryCode);
    const customerInfo = await Purchases.getCustomerInfo();
    if (libraryCode !== getUid()) {
      throw { code: 'library_changed', message: 'The active library changed. Reopen its plan page to continue.' };
    }
    return customerInfo;
  });
}

export function showRevenueCatManageSubscriptions(libraryCode) {
  return enqueue(async () => {
    await configureLibrary(libraryCode);
    if (libraryCode !== getUid()) {
      throw { code: 'library_changed', message: 'The active library changed. Reopen its plan page to continue.' };
    }
    return Purchases.showManageSubscriptions();
  });
}

export function restoreRevenueCatPurchases(libraryCode) {
  return enqueue(async () => {
    await configureLibrary(libraryCode);
    if (libraryCode !== getUid()) {
      throw { code: 'library_changed', message: 'The active library changed. Reopen its plan page to continue.' };
    }
    return Purchases.restorePurchases();
  });
}