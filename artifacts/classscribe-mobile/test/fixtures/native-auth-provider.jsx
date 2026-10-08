// These hooks are deliberately NOT the required-auth UI hook stand-ins.
export { useAuth, useUser, useClerk, useSignIn, useSignUp, ClerkLoaded, ClerkLoading, ClerkFailed } from '@clerk/react';
export { useSSO } from './required-auth-ui';

export let nativeClient;
export const providerOptions = [];
export function setNativeClient(client) {
  nativeClient = client;
  providerOptions.length = 0;
}
export function getClerkInstance(options) {
  providerOptions.push(options);
  return nativeClient;
}
// Hardware session synchronization is outside this JS smoke check. The actual
// Expo provider still delegates to Clerk's headless initialization lifecycle.
export function useSyncableTokenCache({ tokenCache }) { return tokenCache; }
export function useNativeClientBootstrap() { return { isMountedRef: { current: true }, isNativeClientReady: false }; }
export function useNativeClientEventSync() {}
export function NativeClientSync() { return null; }
export function maybeCompleteAuthSession() {}
