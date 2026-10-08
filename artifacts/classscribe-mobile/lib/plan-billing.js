const BILLING_SOURCES = new Set(['web', 'app_store', 'play_store', 'test_store']);

export function billingSourceName(source) {
  return ({
    web: 'the web',
    app_store: 'the App Store',
    play_store: 'Google Play',
    test_store: 'RevenueCat Test Store',
  })[source] || '';
}

export function billingSourceGuidance(source) {
  return ({
    web: 'This subscription is billed through the web. Manage it through ClassScribe web billing; in-app purchases are paused to prevent a second subscription.',
    app_store: 'This subscription is billed through the Apple App Store. Manage it from your Apple subscriptions; changes must use an iPhone or iPad signed in to the purchasing Apple ID.',
    play_store: 'This subscription is billed through Google Play. Manage it from Google Play subscriptions on a device signed in to the purchasing Google account.',
    test_store: 'This is a RevenueCat Test Store subscription, not a live store plan. In an installed Debug preview, Student → Pro can be tested; Pro → Student cannot take effect while Pro is active. Use the RevenueCat Test Store controls to reset or end the test entitlement before downgrading. A management link is available only if RevenueCat provides one.',
  })[source] || 'The billing source could not be identified. Purchases are paused until the library server can verify where this plan is billed.';
}

export function nativeStoreForPlatform(platform) {
  return platform === 'ios' ? 'app_store' : platform === 'android' ? 'play_store' : null;
}

export function getBillingActionBlock(status, action, platform, options = {}) {
  if (!status) return '';
  if (status.billingConflict) {
    return 'This library has subscriptions in more than one billing system. Purchases are paused to prevent duplicate charges. Contact support to resolve the billing conflict.';
  }
  if (status.plan === 'free') return '';
  if (!status.billingSource) {
    return 'The library server could not identify where this paid plan is billed. Purchases are paused to prevent duplicate charges; refresh your plan status or contact support.';
  }
  if (action === 'native_purchase') {
    if (status.billingSource === 'test_store') {
      const isTestStoreUpgrade = options.testStorePreview === true &&
        (platform === 'ios' || platform === 'android') &&
        status.plan === 'student' &&
        options.targetPlan === 'pro';
      if (isTestStoreUpgrade) return '';
      if (status.plan === 'pro' && options.targetPlan === 'student') {
        return 'A RevenueCat Test Store Pro entitlement stays active until it is reset or ended, so a Student downgrade cannot take effect now. Use the RevenueCat Test Store controls to reset/end the entitlement, then refresh this plan page.';
      }
      return 'This RevenueCat Test Store subscription cannot be changed from this build. Use the RevenueCat Test Store controls; purchases are blocked here to prevent a duplicate subscription.';
    }
    if (status.billingSource === 'web') {
      return 'This plan is billed through the web. Manage it on the web; in-app purchases are paused to prevent a second subscription.';
    }
    const nativeStore = nativeStoreForPlatform(platform);
    if (status.billingSource === 'app_store' || status.billingSource === 'play_store') {
      if (status.billingSource !== nativeStore) {
        return `This plan is billed through ${billingSourceName(status.billingSource)}. Manage it on a device that uses ${billingSourceName(status.billingSource)}; changing stores here could create a second subscription.`;
      }
      return '';
    }
    if (!BILLING_SOURCES.has(status.billingSource)) {
      return 'The billing source is not recognized. Purchases are paused until the library server can verify where this plan is billed.';
    }
    return '';
  }
  if (action === 'stripe_checkout' && status.billingSource === 'web') {
    return 'This library already has an active web subscription. Stripe checkout cannot change an active plan; use Manage subscription to see whether billing management supports plan changes.';
  }
  if (action === 'stripe_checkout' && status.billingSource && status.billingSource !== 'web') {
    return `This plan is billed through ${billingSourceName(status.billingSource)}. Manage it there; web checkout is paused to prevent a second subscription.`;
  }
  return '';
}