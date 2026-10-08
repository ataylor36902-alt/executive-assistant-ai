import React from 'react';
import { createStoreSwitch, createProfileLoader } from 'native-store-switch';
export default React;

const CODE_A = 'u_AAAAAAAAAAAAAAAAAAAA';
const CODE_B = 'u_BBBBBBBBBBBBBBBBBBBB';
export const codes = { first: CODE_A, different: CODE_B };
const libraries = new Map([[CODE_A, { firstName: 'Ada', lastName: 'Student' }], [CODE_B, { firstName: 'Grace', lastName: 'Student' }]]);
const links = new Map();
const devices = new Map();
let device;
let hooks = [];
let cursor = 0;
let effects = [];
export const controls = [];
export const inputs = [];
export const requests = [];
export const router = {
  path: '/welcome',
  replace(path) { this.path = typeof path === 'string' ? path : path.pathname; },
  push(path) { this.path = path; },
};
export const C = new Proxy({}, { get: () => '#123456' });
export const s = { label: {}, input: {} };
export const clerkPublishableKey = 'pk_test_native_harness';
export const Platform = { OS: 'ios' };
export const Alert = {
  last: null,
  alert(title, message, actions) { this.last = { title, message, actions }; },
};
export const storage = {
  async getItem(key) { return device.storage.get(key) || null; },
  async setItem(key, value) { device.storage.set(key, value); },
  async removeItem(key) { device.storage.delete(key); },
  async multiRemove(keys) { keys.forEach(key => device.storage.delete(key)); },
};
export function reset() {
  process.env.EXPO_PUBLIC_SERVER_URL = 'https://classscribe.test';
  libraries.set(CODE_A, { firstName: 'Ada', lastName: 'Student' });
  libraries.set(CODE_B, { firstName: 'Grace', lastName: 'Student' });
  links.clear();
  devices.clear();
  requests.length = 0;
  global.fetch = async (url, options) => {
    if (url !== 'https://classscribe.test/api/library-link') throw new Error(`Unexpected request: ${url}`);
    const account = options.headers.Authorization?.replace(/^Bearer /, '');
    requests.push({ account, method: options.method, body: options.body });
    if (!account) return reply(401, { error: 'Unauthorized' });
    if (options.method === 'GET') return reply(200, links.has(account) ? { linked: true, code: links.get(account) } : { linked: false });
    const { code } = JSON.parse(options.body);
    if (!libraries.has(code)) return reply(400, { error: 'Library code is invalid' });
    if (links.has(account) && links.get(account) !== code) return reply(409, { error: 'This account is already linked elsewhere' });
    if ([...links.values()].includes(code) && links.get(account) !== code) return reply(409, { error: 'This library is already linked elsewhere' });
    links.set(account, code);
    return reply(200, { linked: true });
  };
  openDevice('first');
}
function reply(status, body) {
  return { ok: status < 400, status, json: async () => body };
}
export function openDevice(id, { code, account } = {}) {
  if (!devices.has(id)) devices.set(id, {
    code: code || (id === 'first' ? CODE_A : `u_${id.padEnd(20, 'X')}`),
    account: account || 'test-account',
    profile: code ? libraries.get(code) || null : null,
    storage: new Map(),
    failSwitch: false,
    switchCalls: [],
    profileChanges: [],
  });
  device = devices.get(id);
  hooks = [];
  cursor = 0;
  effects = [];
  router.path = '/welcome';
  return device;
}
export function current() { return device; }
export function link(account, code) { links.set(account, code); }
export function mountScreen() { hooks = []; cursor = 0; effects = []; }
export function beginRender() { cursor = 0; controls.length = 0; inputs.length = 0; effects = []; }
export async function runEffects() {
  const queued = effects;
  effects = [];
  for (const effect of queued) effect();
  // The screens run their async lookup inside an effect; let it and its finally handlers settle.
  for (let i = 0; i < 80; i++) await Promise.resolve();
}
export function useState(initial) {
  const index = cursor++;
  if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
  return [hooks[index], value => {
    hooks[index] = typeof value === 'function' ? value(hooks[index]) : value;
  }];
}
export function useRef(initial) {
  const index = cursor++;
  if (!(index in hooks)) hooks[index] = { current: initial };
  return hooks[index];
}
export function useEffect(effect, deps) {
  const index = cursor++;
  const prior = hooks[index];
  if (!prior || deps.some((value, i) => value !== prior[i])) {
    hooks[index] = deps;
    effects.push(effect);
  }
}
export function useAuth() {
  return {
    isSignedIn: !!device.account,
    userId: device.account || null,
    sessionId: device.account ? (device.sessionId || `session-${device.account}`) : null,
    getToken: async () => device.account,
  };
}
export function useLocalSearchParams() { return device.params || {}; }
export function useResolvedTheme() { return 'light'; }
export function useStore() {
  const mine = () => ({ courses: {}, lectures: {}, assignments: {}, notes: {}, stats: {} });
  const context = {
    AsyncStorage: storage,
    getUid: () => device.code,
    checkLibrary: async code => {
      if (device.switchGate) await device.switchGate;
      return !device.failSwitch && libraries.has(code);
    },
    apiSetUid: async code => {
      device.code = code;
      if (device.uidSaveGate) {
        const gate = device.uidSaveGate;
        device.uidSaveGate = null;
        await gate;
      }
    },
    status: { syncCodeReplaced: false },
    writes: { current: new Set() },
    profileRef: { current: device.profile },
    mineRef: { current: mine() },
    showEx: false,
    validAppearance: value => value || 'auto',
    libraryCacheKey: code => `cache:${code}`,
    libraryProfileKey: code => `profile:${code}`,
    legacyProfileMigratedKey: code => `migrated:${code}`,
    libraryDeletesKey: code => `deletes:${code}`,
    libraryPendingProfileKey: code => `pendingProfile:${code}`,
    COLS: ['courses', 'lectures', 'assignments', 'notes', 'stats'],
    failedWrites: { current: new Map() },
    failedDeletes: { current: new Map() },
    profilePending: { current: new Map() },
    empty: mine,
    setProfile: value => { device.profile = value; device.profileChanges.push(value); },
    setShowExState: () => {},
    setAppearanceChoiceState: () => {},
    setMine: () => {},
    setStatus: () => {},
    db: { get: async path => {
      const code = path.split('/')[2];
      if (device.profileLoadGate) await device.profileLoadGate;
      return libraries.get(code) || null;
    } },
    refresh: async assertCurrent => { assertCurrent?.(); return true; },
  };
  context.loadProfile = createProfileLoader(context);
  const switchLibrary = createStoreSwitch(context);
  return {
    profile: device.profile,
    status: { uid: device.code, server: 'https://classscribe.test', loading: false },
    setServer: async () => {},
    saveProfile: async value => {
      if (device.profileSaveGate) await device.profileSaveGate;
      device.profile = value;
      libraries.set(device.code, value);
    },
    switchLibrary: async (code, options) => {
      device.switchCalls.push(code);
      return switchLibrary(code, options);
    },
  };
}
export const getServer = () => 'https://classscribe.test';
export const getUid = () => device.code;
export const validSyncCode = code => /^u_[A-Za-z0-9]{10,40}$/.test(code);
export const curSemester = () => 'Fall 2026';
export const goBack = (fallback = '/account') => { router.path = fallback; };
export const SafeAreaView = ({ children }) => <div>{children}</div>;
export const View = SafeAreaView;
export const ScrollView = SafeAreaView;
export const KeyboardAvoidingView = SafeAreaView;
export const KeyboardAwareScrollViewCompat = SafeAreaView;
export const Image = () => <span />;
export const Text = ({ children }) => <span>{children}</span>;
export function TextInput(props) { inputs.push(props); return <input placeholder={props.placeholder} />; }
export function Switch(props) { controls.push({ label: props.accessibilityLabel, press: () => props.onValueChange(true) }); return <button>{props.accessibilityLabel}</button>; }
export function Btn({ title, onPress, disabled, busy }) {
  controls.push({ label: title, press: onPress, disabled, busy });
  return <button>{title}</button>;
}
export function ProfileFields({ set }) {
  controls.push({ label: 'Set name', press: () => set(p => ({ ...p, firstName: 'Ada', lastName: 'Student' })) });
  return <div>Profile fields</div>;
}
export function OptionalSignIn({ onContinue, notice, continueLabel, recoverOnly }) {
  controls.push({ label: continueLabel || 'Continue', press: () => onContinue({ fromAuth: true }) });
  return <div>{recoverOnly ? 'Recover library' : 'Account sign-in'} {notice}</div>;
}