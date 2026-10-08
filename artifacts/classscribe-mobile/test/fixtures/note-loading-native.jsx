import React from 'react';

export const UID = 'note-loading-library';
export const NOTE_ID = 'delayed-note';
export const disk = new Map();
export const remote = new Map();
export const writes = [];
export const listeners = new Set();
export const gates = {};
export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
export function reset() {
  disk.clear(); remote.clear(); writes.length = 0; listeners.clear();
  gates.cache = deferred(); gates.remote = deferred();
  gates.offline = false;
  disk.set('cs_uid', UID);
}
const clone = value => JSON.parse(JSON.stringify(value));
export const storage = {
  async getItem(key) {
    if (key === `cs_cache_v2_${UID}`) await gates.cache.promise;
    return disk.get(key) ?? null;
  },
  async setItem(key, value) { disk.set(key, value); },
  async removeItem(key) { disk.delete(key); },
  async multiRemove(keys) { keys.forEach(key => disk.delete(key)); },
};
export const db = {
  async get() { return null; },
  async update() {},
  async list(path) {
    await gates.remote.promise;
    const prefix = `${path}/`;
    return [...remote.entries()].filter(([key]) => key.startsWith(prefix))
      .map(([key, data]) => ({ id: key.slice(prefix.length), data: clone(data) }));
  },
  async set(path, record) {
    writes.push({ path, record: clone(record) });
    if (gates.offline) throw new Error('Offline');
    remote.set(path, clone(record));
  },
  async del(path) { remote.delete(path); },
};
export const initApi = async () => ({ uid: UID, server: 'https://example.invalid' });
export const getUid = () => UID;
export const errMsg = error => error.message;
export const libPath = () => `data/users/${UID}/lib`;
export const setUid = async () => {};
export const setServer = async () => {};
export const newSyncCode = () => UID;
export const checkLibrary = async () => {};
export const rotateSyncCode = async () => {};
export const rotateWithRecovery = async () => {};
export const aiJSON = async () => {};
export const cleanSmartNote = async () => '';
export const finishRecordingReservation = async () => {};
export const getBillingStatus = async () => ({});
export const health = async () => ({});
export const transcribe = async () => {};
export const buildExamples = () => ({ courses: {}, lectures: {}, assignments: {}, stats: {} });
export const EX_NOTES = () => ({});
export const EXAMPLE_MEETINGS = {};
export const analysisPrompt = () => '';
export const cleanAnalysis = value => value;
export const hasContent = () => false;
export const lectureNotesText = () => '';
export const isCreditsRequired = () => false;
export const refreshCreditsAfterAction = async () => ({});
export const getPrivacyConsentReceipt = async () => null;
export const removeLectureConsents = async () => {};
export const libraryAudioDirectory = async () => ({ uri: 'file:///test', exists: false });
export const removeDurableLectureAudio = async () => {};
export const scopeLinkedLectureAudio = async lecture => lecture;
export const Directory = class {};
export const File = class {};
export const Paths = {};
export const setBackgroundColorAsync = async () => {};
export const setActiveTheme = () => {};
export const C = {};
export const courseColor = () => '';
export const nowMs = () => Date.now();
export const fmtD = value => value;
export const clockStamp = () => '12:00';
export const MAX_SOURCE_CHARS = 100000;
export const Alert = { alert() {} };
export const showActions = () => {};
export const goBack = () => {};
export const router = {};
export const useLocalSearchParams = () => ({ id: NOTE_ID });
export const Platform = { OS: 'web' };
export const Appearance = {};
export const useColorScheme = () => 'light';
export const AppState = {
  currentState: 'active',
  addEventListener(_, listener) {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  },
};
export const Share = { share: async () => {} };
const host = name => function Host(props) { return React.createElement(name, props, props.children); };
export const Text = host('Text');
export const TextInput = host('TextInput');
export const View = host('View');
export const Pressable = host('Pressable');
export const ScrollView = host('ScrollView');
export const KeyboardAvoidingView = host('KeyboardAvoidingView');
export const InputAccessoryView = host('InputAccessoryView');
export const Btn = host('Btn');
export const Chip = host('Chip');
export const Empty = host('Empty');
export const Md = host('Md');
export const Ionicons = host('Icon');
export const Stack = { Screen: ({ options }) => <>{options.headerRight?.()}</> };
