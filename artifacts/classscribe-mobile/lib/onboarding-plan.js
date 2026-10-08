export function isConfirmedPaidPlan(status) {
  return ['student', 'pro'].includes(status?.plan) && ['active', 'trialing'].includes(status?.status);
}

export function isOnboardingPlanReady(profile, status) {
  return isConfirmedPaidPlan(status) ||
    (profile?.onboardingPlanChoice === 'free' && status?.plan === 'free');
}

export function needsOnboardingPlan(profile) {
  return profile?.onboardingPlanPending === true;
}

export function canChooseFreePlan({ isOnboarding, hasProfile, libraryMatches, purchaseBusy }) {
  return !!isOnboarding && !!hasProfile && !!libraryMatches && !purchaseBusy;
}