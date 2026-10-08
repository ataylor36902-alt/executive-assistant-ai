import React from 'react';
export default React;

const hookState = [];
let hookCursor = 0;
export const controls = [];
export const textInputs = [];
export const inputAccessories = [];
export const scrollViews = [];
export let clerkPublishableKey = 'pk_test_required_auth';
export const redirectCalls = [];
export const asyncStorageEntries = new Map();
// SecureStore outlives simulated JS process restarts; React hook state does not.
const secureTokens = new Map();
export const AFTER_FIRST_UNLOCK = 'after-first-unlock';
export const isNative = () => true;
export const getItemAsync = async (key) => secureTokens.get(key) ?? null;
export const setItemAsync = async (key, value) => { secureTokens.set(key, value); };
export const deleteItemAsync = async (key) => { secureTokens.delete(key); };

export function resetRequiredAuthUI({ key = 'pk_test_required_auth', isSignedIn = false, loaded = true, platform = 'ios', isExpoGo = false, appleStrategies = ['oauth_apple', 'oauth_google'], ...overrides } = {}) {
  hookState.length = 0;
  hookCursor = 0;
  controls.length = 0;
  textInputs.length = 0;
  inputAccessories.length = 0;
  scrollViews.length = 0;
  redirectCalls.length = 0;
  asyncStorageEntries.clear();
  globalThis.__requiredAuthAsyncStorage = asyncStorageEntries;
  clerkPublishableKey = key;

  const state = { isSignedIn, loaded, platform, isExpoGo, appleStrategies, user: { primaryEmailAddress: { emailAddress: 'student@example.edu' } } };
  const signIn = {
    status: 'complete',
    supportedSecondFactors: [{ strategy: 'email_code' }],
    reset: async () => { signIn.status = 'needs_identifier'; return {}; },
    create: async ({ identifier }) => { state.resetEmail = identifier; return {}; },
    resetPasswordEmailCode: {
      sendCode: async () => {
        state.resetCodesSent = (state.resetCodesSent || 0) + 1;
        if (state.resetSendPending) await state.resetSendPending;
        if (state.resetSendError) return { error: state.resetSendError };
        return {};
      },
      verifyCode: async ({ code }) => {
        if (code !== '123456') return { error: { errors: [{ message: 'Incorrect reset code' }] } };
        signIn.status = 'needs_new_password';
        return {};
      },
      submitPassword: async ({ password }) => {
        state.resetPasswordInput = { password };
        if (password.length < 8) return { error: { errors: [{ message: 'Password is too weak' }] } };
        signIn.status = 'complete';
        return {};
      },
    },
    password: async (params) => {
      state.signInPasswordInput = params;
      signIn.status = state.signInStatusAfterPassword || 'complete';
      return {};
    },
    finalize: async ({ navigate }) => {
      state.isSignedIn = true;
      await navigate({ session: state.session || {} });
      return {};
    },
    mfa: {
      sendEmailCode: async () => ({}),
      verifyEmailCode: async () => {
        signIn.status = state.signInStatusAfterVerification || 'complete';
        return {};
      },
    },
  };
  const signUp = {
    status: 'complete',
    password: async (params) => {
      state.signUpPasswordInput = params;
      signUp.status = state.signUpStatusAfterPassword || 'complete';
      return {};
    },
    finalize: async ({ navigate }) => {
      state.isSignedIn = true;
      await navigate({ session: state.session || {} });
      return {};
    },
    verifications: {
      sendEmailCode: async () => ({}),
      verifyEmailCode: async () => {
        signUp.status = state.signUpStatusAfterVerification || 'complete';
        return {};
      },
    },
  };
  Object.assign(state, overrides, { signIn, signUp });
  if (overrides.signIn) Object.assign(signIn, overrides.signIn);
  if (overrides.signUp) Object.assign(signUp, overrides.signUp);
  if (!state.startSSOFlow) {
    state.startSSOFlow = async (params) => {
      state.ssoCalls = [...(state.ssoCalls || []), params];
      return {
        createdSessionId: 'auth-session',
        setActive: async ({ navigate }) => {
          state.isSignedIn = true;
          await navigate({ session: state.session || {} });
          return {};
        },
      };
    };
  }
  if (!state.startAppleAuthenticationFlow) {
    state.startAppleAuthenticationFlow = async () => {
      state.appleCalls = (state.appleCalls || 0) + 1;
      return {
        createdSessionId: 'apple-auth-session',
        setActive: async ({ navigate }) => {
          state.isSignedIn = true;
          await navigate({ session: state.session || {} });
          return {};
        },
      };
    };
  }
  globalThis.__requiredAuthState = state;
  return state;
}

export function beginRequiredAuthRender() {
  hookCursor = 0;
  controls.length = 0;
  textInputs.length = 0;
  inputAccessories.length = 0;
  scrollViews.length = 0;
}

export function useState(initialValue) {
  const index = hookCursor++;
  if (!(index in hookState)) {
    hookState[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
  }
  return [
    hookState[index],
    (nextValue) => {
      hookState[index] = typeof nextValue === 'function' ? nextValue(hookState[index]) : nextValue;
    },
  ];
}

export const useEffect = () => {};
export const useRef = (value) => useState(() => ({ current: value }))[0];
export const useId = React.useId;
export const Platform = { get OS() { return globalThis.__requiredAuthState?.platform || 'ios'; } };
export const Keyboard = { dismiss() { globalThis.__requiredAuthState.keyboardDismissCalls = (globalThis.__requiredAuthState.keyboardDismissCalls || 0) + 1; } };
export const C = new Proxy({}, { get: () => '#123456' });
export const s = { label: {}, input: {} };
export const Alert = { alert(...args) { (globalThis.__requiredAuthState.alerts ||= []).push(args); } };
export function Ionicons() { return null; }
export const router = {
  replace(path) { (globalThis.__requiredAuthState.navigation ||= []).push(['replace', path]); },
  push(path) { (globalThis.__requiredAuthState.navigation ||= []).push(['push', path]); },
};

export function useAuth() {
  return { isSignedIn: globalThis.__requiredAuthState?.loaded === false ? undefined : !!globalThis.__requiredAuthState?.isSignedIn, isLoaded: globalThis.__requiredAuthState?.loaded !== false };
}
export function useUser() {
  const state = globalThis.__requiredAuthState || {};
  return { isLoaded: state.loaded !== false, isSignedIn: !!state.isSignedIn, user: state.user || null };
}
export function useSignIn() {
  return { signIn: globalThis.__requiredAuthState.signIn };
}
export function useSignUp() {
  return { signUp: globalThis.__requiredAuthState.signUp };
}
export function useSSO() {
  return { startSSOFlow: globalThis.__requiredAuthState.startSSOFlow };
}
export function useClerk() {
  return {
    __internal_environment: { userSettings: { socialProviderStrategies: globalThis.__requiredAuthState?.appleStrategies } },
    signOut: async () => {
      const state = globalThis.__requiredAuthState;
      state.signOutCalls = (state.signOutCalls || 0) + 1;
      if (state.signOutError) throw state.signOutError;
      if (state.signOutPending) await state.signOutPending;
      globalThis.__requiredAuthState.isSignedIn = false;
    },
  };
}
export function useSignInWithApple() {
  return { startAppleAuthenticationFlow: globalThis.__requiredAuthState.startAppleAuthenticationFlow };
}

export function ClerkLoaded({ children }) {
  return globalThis.__requiredAuthState?.loaded === false ? null : children;
}
export function ClerkLoading({ children }) {
  return globalThis.__requiredAuthState?.loaded === false ? children : null;
}

function childText(children) {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childText).join('');
  if (React.isValidElement(children)) return childText(children.props.children);
  return '';
}

export function Pressable(props) {
  controls.push({
    ...props,
    authLabel: props.accessibilityLabel || props.title || childText(props.children),
  });
  return <button type="button">{props.children}</button>;
}
export function Btn({ title, onPress, ...props }) {
  return <Pressable {...props} onPress={onPress} accessibilityLabel={title}><Text>{title}</Text></Pressable>;
}
export function Text({ children }) {
  return <span>{children}</span>;
}
export function View({ children }) {
  return <div>{children}</div>;
}
export function Image() {
  return <span />;
}
export const SafeAreaView = View;
export const ScrollView = View;
export const KeyboardAvoidingView = View;
export function KeyboardAwareScrollViewCompat({ children, ...props }) {
  scrollViews.push(props);
  return <div>{children}</div>;
}
export function InputAccessoryView({ children, ...props }) {
  inputAccessories.push(props);
  return <div>{children}</div>;
}
export function TextInput(props) {
  textInputs.push(props);
  return <input placeholder={props.placeholder} />;
}
export function Switch() {
  return null;
}
export function ActivityIndicator() {
  return <span>Loading</span>;
}
export function ProfileFields() {
  return <View />;
}

export function useStore() {
  return {
    status: { loading: false, server: '' },
    saveProfile: async () => {},
    setServer: async () => {},
    switchLibrary: async () => true,
  };
}
export async function savePrivacyAge() {}
export async function linkCurrentLibrary() {}
export function validSyncCode(value) {
  return /^u_/.test(value);
}
export function curSemester() {
  return 'Fall 2026';
}
export const makeRedirectUri = (options) => {
  redirectCalls.push(options);
  return 'classscribe-mobile://auth';
};
export function maybeCompleteAuthSession() {}
export const warmUpAsync = async () => {};
export const coolDownAsync = async () => {};