export function canContinueFromSignIn({ required, isSignedIn, taskBlocked = false, verificationPending = false }) {
  return !taskBlocked && !verificationPending && (!required || isSignedIn === true);
}

export function canShowProfileSetup({ clerkConfigured, isSignedIn, accountReady }) {
  return clerkConfigured === true && isSignedIn === true && accountReady === true;
}