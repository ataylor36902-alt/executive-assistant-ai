// External web checkout is only offered in browsers and the iOS development
// preview. Installed iPhone apps continue to use Apple's in-app purchases.
export function usesWebPlanCheckout(platform, expoGo) {
  return platform === 'web' || (platform === 'ios' && expoGo === true);
}
