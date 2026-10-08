// Browser-only signed-in fixture. No Clerk credentials or live EDU data are used.
import { useSyncExternalStore } from 'react';

let identity = { userId: 'student-fixture', sessionId: 'session-fixture' };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => identity;
declare global {
  interface Window {
    __eduSwitchAccount: (userId: string, sessionId?: string) => void;
  }
}
window.__eduSwitchAccount = (userId, sessionId = `session-${userId}`) => {
  identity = { userId, sessionId };
  listeners.forEach(listener => listener());
};
// Keep the callback stable across account changes, just like an auth SDK can.
const getToken = async () => `fixture-token-${identity.userId}`;
const signOut = async () => {};
export function useAuth() {
  return { isLoaded: true, isSignedIn: true, ...useSyncExternalStore(subscribe, snapshot), getToken, signOut };
}
export function useUser() {
  const { userId } = useSyncExternalStore(subscribe, snapshot);
  return { user: { id: userId, fullName: userId === 'student-fixture' ? 'Test Student' : 'Second Student' } };
}
export function UserButton() { return null; }
export function SignIn() { return null; }
export function SignUp() { return null; }