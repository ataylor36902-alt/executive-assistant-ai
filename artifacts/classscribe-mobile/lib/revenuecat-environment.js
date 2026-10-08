export function revenueCatApiKeyName({ platform, environment, devMode, expoGo }) {
  if (platform === 'web') return null;
  if (isUnsafeRevenueCatTestStoreRelease({ environment, devMode, expoGo })) return null;
  const testStore = environment === 'test_store' || expoGo || (devMode && environment !== 'production');
  if (testStore) return 'EXPO_PUBLIC_REVENUECAT_TEST_API_KEY';
  if (platform === 'ios') return 'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY';
  if (platform === 'android') return 'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY';
  return null;
}

export function isUnsafeRevenueCatTestStoreRelease({ environment, devMode, expoGo }) {
  return environment === 'test_store' && !devMode && !expoGo;
}

export function isRevenueCatTestStore({ environment, devMode, expoGo }) {
  return environment === 'test_store' || expoGo || (devMode && environment !== 'production');
}