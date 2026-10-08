import React from 'react';

const hookState = [];
let hookCursor = 0;
let effects = [];
export const controls = [];
export const textInputs = [];
export const storageEntries = new Map();
export const files = [];
export const events = [];
export const exportRequests = [];
export const deletionRequests = [];
export const statusRequests = [];
export const shareCalls = [];
export const router = {
  path: '/account',
  replace(path) { this.path = path; events.push(['router.replace', path]); },
  push(path) { this.path = path; events.push(['router.push', path]); },
};

const initialLibraryCode = 'u_privacy_test_1234567890';
const defaultStatus = {
  ageBand: '18+',
  provider: 'none',
  activeSubscription: false,
  reauthenticationRequired: true,
};
let state;
const asyncStorage = {
  async getAllKeys() { return [...storageEntries.keys()]; },
  async multiRemove(keys) {
    events.push(['storage.multiRemove', [...keys]]);
    for (const key of keys) storageEntries.delete(key);
  },
};
export default asyncStorage;

export function resetPrivacySettings({
  platform = 'ios',
  isSignedIn = true,
  status = {},
  uid = initialLibraryCode,
  deletionResult = { deleted: true, providersPending: false, backupDays: 30 },
  exportTicket = { url: '/private-export', expiresAt: '2030-01-01T00:00:00.000Z' },
  session = {},
} = {}) {
  hookState.length = 0;
  hookCursor = 0;
  effects = [];
  controls.length = 0;
  textInputs.length = 0;
  files.length = 0;
  events.length = 0;
  exportRequests.length = 0;
  deletionRequests.length = 0;
  statusRequests.length = 0;
  shareCalls.length = 0;
  storageEntries.clear();
  state = {
    platform,
    isSignedIn,
    uid,
    server: 'https://classscribe.invalid',
    status: { ...defaultStatus, ...status },
    deletionResult,
    exportTicket,
    session: {
      startVerification: async ({ level }) => {
        events.push(['session.startVerification', level]);
        return { supportedFirstFactors: [{ strategy: 'email_code', emailAddressId: 'email_test' }] };
      },
      prepareFirstFactorVerification: async parameters => {
        events.push(['session.prepareFirstFactorVerification', parameters]);
      },
      attemptFirstFactorVerification: async parameters => {
        events.push(['session.attemptFirstFactorVerification', parameters]);
        return { status: 'complete' };
      },
      verifyWithPasskey: async () => {
        events.push(['session.verifyWithPasskey']);
        return { status: 'complete' };
      },
      ...session,
    },
    getTokenCalls: [],
    signOutCalls: 0,
    clearedLibraries: [],
    imageCacheClears: 0,
    fetchImplementation: async url => { throw new Error(`Unexpected isolated download request: ${url}`); },
    shareAvailable: true,
    shareFailure: null,
  };
  globalThis.__privacySettingsState = state;
  globalThis.fetch = (...args) => state.fetchImplementation(...args);
  router.path = '/account';
  return state;
}

export function beginRender() {
  hookCursor = 0;
  effects = [];
  controls.length = 0;
  textInputs.length = 0;
}

export async function runEffects() {
  const pending = effects;
  effects = [];
  for (const effect of pending) effect();
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
}

export function useState(initialValue) {
  const index = hookCursor++;
  if (!(index in hookState)) hookState[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
  return [hookState[index], value => {
    hookState[index] = typeof value === 'function' ? value(hookState[index]) : value;
  }];
}

export function useEffect(effect, dependencies) {
  const index = hookCursor++;
  const prior = hookState[index];
  if (!prior || dependencies.some((value, position) => value !== prior[position])) {
    hookState[index] = dependencies;
    effects.push(effect);
  }
}
export const useCallback = callback => callback;

export const Linking = { openURL: async url => events.push(['linking.openURL', url]) };
export const Platform = { get OS() { return state?.platform || 'ios'; } };
export const Text = ({ children }) => <span>{children}</span>;
export const View = ({ children }) => <div>{children}</div>;
export const Pressable = props => {
  controls.push({
    label: props.accessibilityLabel || props.title || textContent(props.children),
    onPress: props.onPress,
    disabled: props.disabled,
    role: props.accessibilityRole,
    state: props.accessibilityState,
  });
  return <button>{props.children}</button>;
};
export const TextInput = props => {
  textInputs.push(props);
  return <input placeholder={props.placeholder} />;
};

export const AsyncStorage = asyncStorage;
export const Paths = { cache: { uri: 'file://isolated-cache' } };
export class File {
  constructor(directory, name) {
    this.uri = `${directory.uri}/${name}`;
    this.name = name;
    this.exists = false;
    this.deleted = false;
    this.bytes = null;
    files.push(this);
  }
  create() {
    this.exists = true;
    events.push(['file.create', this.name]);
  }
  write(bytes) {
    this.bytes = bytes;
    events.push(['file.write', this.name, bytes.length]);
  }
  delete() {
    this.exists = false;
    this.deleted = true;
    events.push(['file.delete', this.name]);
  }
}
export const isAvailableAsync = async () => state.shareAvailable;
export const shareAsync = async (uri, options) => {
  events.push(['sharing.shareAsync', uri, options]);
  shareCalls.push({ uri, options });
  if (state.shareFailure) throw state.shareFailure;
};
export const Image = {
  clearDiskCache: async () => {
    state.imageCacheClears += 1;
    events.push(['image.clearDiskCache']);
  },
};

export const useAuth = () => ({
  getToken: async options => {
    state.getTokenCalls.push(options);
    events.push(['auth.getToken', options]);
    return options?.skipCache ? 'fresh-isolated-token' : 'isolated-token';
  },
  isSignedIn: state.isSignedIn,
});
export const useClerk = () => ({
  signOut: async () => {
    state.signOutCalls += 1;
    events.push(['clerk.signOut']);
  },
});
export const useSession = () => ({ session: state.session });
export const useStore = () => ({
  status: { uid: state.uid, server: state.server, loading: false },
  clearDeletedLibrary: async code => {
    state.clearedLibraries.push(code);
    events.push(['store.clearDeletedLibrary', code]);
    if (state.uid === code) state.uid = '';
  },
});
export const getUid = () => state.uid;
export async function getPrivacyStatus(getToken, libraryCode) {
  statusRequests.push({ libraryCode });
  events.push(['privacy.getPrivacyStatus', libraryCode]);
  await getToken();
  return state.status;
}
export async function requestPrivacyExport(getToken, libraryCode) {
  exportRequests.push({ libraryCode });
  events.push(['privacy.requestPrivacyExport', libraryCode]);
  await getToken();
  if (state.exportFailure) throw state.exportFailure;
  if (state.exportGate) await state.exportGate;
  return state.exportTicket;
}
export async function requestPrivacyDeletion(body, getToken, libraryCode) {
  const token = await getToken();
  const request = { body, token, libraryCode };
  deletionRequests.push(request);
  events.push(['privacy.requestPrivacyDeletion', body, libraryCode, token]);
  if (state.deletionFailure) throw state.deletionFailure;
  return state.deletionResult;
}

export const C = new Proxy({}, { get: () => '#123456' });
export const s = { input: {} };
export function Btn({ title, onPress, ...props }) {
  controls.push({ label: title, onPress, ...props });
  return <button>{title}</button>;
}
export function Screen({ children }) { return <main>{children}</main>; }
export function Section({ title, footer, children }) {
  return <section><h2>{title}</h2>{children}{footer ? <footer>{footer}</footer> : null}</section>;
}
export function PrivacySheet({ visible, title, children, actions }) {
  if (!visible) return null;
  return <aside><h2>{title}</h2>{children}{actions.map(action =>
    <Btn key={action.title} {...action} />)}</aside>;
}

function textContent(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (React.isValidElement(node)) return textContent(node.props.children);
  return '';
}