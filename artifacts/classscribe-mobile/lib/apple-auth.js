export const APPLE_UNAVAILABLE_COPY = "Sign in with Apple isn't available here yet — use Google or email. Apple is not enabled for this Clerk environment.";

export function appleSignInMode(platform, isExpoGo) {
  return platform === 'ios' && !isExpoGo ? 'native' : 'oauth';
}

export function appleStrategyAvailability(socialProviderStrategies) {
  if (!Array.isArray(socialProviderStrategies)) return null;
  return socialProviderStrategies.includes('oauth_apple');
}

export function shouldUseMobileOAuthRedirect(platform, strategy, isExpoGo) {
  if (platform === 'web') return false;
  if (platform === 'ios' && strategy === 'oauth_apple' && !isExpoGo) return false;
  return true;
}

export function isAppleStrategyUnavailableError(error) {
  const code = error?.errors?.[0]?.code || error?.error?.errors?.[0]?.code || error?.code;
  return typeof code === 'string' && /(?:oauth_)?strategy_(?:not_enabled|disabled)/i.test(code);
}

export function appleUnavailableMessage(error, getMessage) {
  if (!error) return APPLE_UNAVAILABLE_COPY;
  const detail = getMessage(error);
  return detail
    && detail !== 'Sign-in could not be completed. Please try again.'
    && detail !== 'Apple could not be linked. Try again.'
    ? `${APPLE_UNAVAILABLE_COPY} Clerk reported: ${detail}`
    : APPLE_UNAVAILABLE_COPY;
}

export function appleErrorMessage(error, getMessage) {
  const code = error?.code || error?.errorCode || error?.errors?.[0]?.code;
  if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED' || code === 'CANCELED') {
    return 'Apple sign-in was canceled. No account or library was changed.';
  }
  return getMessage(error);
}

export function isProviderConnected(accounts, provider) {
  return (accounts || []).some((account) => {
    const accountProvider = typeof account?.providerSlug === 'function'
      ? account.providerSlug()
      : account?.provider;
    const verified = account?.verification?.status === 'verified';
    return verified && (accountProvider === provider || accountProvider === `oauth_${provider}`);
  });
}

export function verifyAppleAccountLink(originalUserId, refreshedUser) {
  if (!refreshedUser || refreshedUser.id !== originalUserId) {
    throw new Error('The signed-in account changed unexpectedly. Your library was not changed; review the account before continuing.');
  }
  if (!isProviderConnected(refreshedUser.externalAccounts, 'apple')) {
    throw new Error('Apple authorization returned, but Clerk has not verified the connection yet. Your current account and library remain unchanged; refresh and check again.');
  }
  return true;
}