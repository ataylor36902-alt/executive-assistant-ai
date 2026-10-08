import React from 'react';
export default React;

let states = [];
let cursor = 0;
let effects = [];
export let store;
export const controls = [];
export const files = new Map();
export const players = [];
export const consentSheets = [];

export function resetRecovery() {
  for (const state of states) state?.cleanup?.();
  states = [];
  files.clear();
  players.length = 0;
  controls.length = 0;
  consentSheets.length = 0;
  store = {
    status: { loading: false, uid: 'test-library' },
    profile: { term: 'Fall 2026' },
    records: { courses: {}, lectures: {} },
    transcriptionCalls: [],
    previousScopes: [],
    async audioRecoveryScopes(code) {
      return [`${Paths.document}lectures/by-library/${code}`, ...this.previousScopes];
    },
    all(col) { return this.records[col]; },
    courses() { return Object.values(this.records.courses); },
    async put(col, value) { this.records[col][value.id] = value; },
    processRecording(...args) { this.transcriptionCalls.push(args); },
  };
}
export function beginRender() {
  cursor = 0;
  effects = [];
  controls.length = 0;
}
export async function runMountEffects() {
  const pending = effects;
  effects = [];
  await Promise.all(pending.map(fn => fn()));
  // React effects launch async scans without returning them. Drain the action
  // through an event-loop turn, including the ownership reads in that scan.
  await new Promise(resolve => setImmediate(resolve));
}
export function endRender() {
  for (const state of states.slice(cursor)) state?.cleanup?.();
  states.length = cursor;
}
export function remount() {
  for (const state of states) state?.cleanup?.();
  states = [];
}
export function useState(initial) {
  const index = cursor++;
  if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
  return [states[index], value => {
    states[index] = typeof value === 'function' ? value(states[index]) : value;
  }];
}
export function useRef(value) {
  const index = cursor++;
  if (!(index in states)) states[index] = { current: value };
  return states[index];
}
export function useCallback(fn, deps) {
  const index = cursor++;
  if (!states[index] || deps.some((dep, i) => dep !== states[index].deps[i])) states[index] = { fn, deps };
  return states[index].fn;
}
export function useEffect(fn, deps) {
  const index = cursor++;
  const previous = states[index];
  if (!previous || !deps || deps.some((dep, i) => dep !== previous.deps?.[i])) {
    const state = { deps, cleanup: previous?.cleanup };
    states[index] = state;
    effects.push(() => {
      state.cleanup?.();
      state.cleanup = fn();
    });
  }
}
export const Platform = { OS: 'ios' };
export const Paths = { document: 'file:///documents/', cache: 'file:///cache/' };
export class File {
  constructor(uri, name) { this.uri = name ? uri.uri.replace(/\/+$/, '') + '/' + name : uri; }
  get name() { return this.uri.split('/').at(-1); }
  get exists() { return files.has(this.uri); }
  get size() { return files.get(this.uri)?.size || 0; }
  get modificationTime() { return files.get(this.uri)?.modified || 0; }
  get creationTime() { return this.modificationTime; }
  write(text) { files.set(this.uri, { size: text.length, text }); }
  async text() { return files.get(this.uri)?.text; }
}
export class Directory {
  constructor(uri, ...parts) {
    this.uri = uri + (uri.endsWith('/') ? '' : '/') + parts.join('/');
    if (!parts.length) this.uri = uri;
    this.name = this.uri.split('/').filter(Boolean).at(-1);
  }
  get exists() { return this.uri === Paths.document || [...files.keys()].some(uri => uri.startsWith(this.uri.replace(/\/+$/, '') + '/')); }
  create() {}
  list() {
    const prefix = this.uri.endsWith('/') ? this.uri : this.uri + '/';
    const children = new Map();
    for (const uri of files.keys()) {
      if (!uri.startsWith(prefix)) continue;
      const rest = uri.slice(prefix.length);
      const part = rest.split('/')[0];
      children.set(part, rest.includes('/') ? new Directory(prefix + part) : new File(uri));
    }
    return [...children.values()];
  }
}
export async function libraryAudioDirectory(code) { return new Directory(`${Paths.document}lectures/by-library/${code}`); }
export async function scopeLinkedLectureAudio(lecture, code) {
  const prefix = `${Paths.document}lectures/by-library/${code}/`;
  if (lecture.audioUri.startsWith(prefix)) return lecture;
  const uri = `${prefix}${lecture.id}/${lecture.audioName}`;
  files.set(uri, files.get(lecture.audioUri));
  return { ...lecture, legacyAudioUri: lecture.audioUri, audioUri: uri };
}
export function useAudioPlayer(source) {
  const index = cursor++;
  if (states[index]?.source.uri === source.uri) return states[index];
  const player = {
    source, playing: false, play() { this.playing = true; },
    pause() { this.playing = false; },
  };
  states[index] = player;
  players.push(player);
  return player;
}
export function useAudioPlayerStatus(player) {
  return { isLoaded: true, playing: player.playing, ...files.get(player.source.uri)?.status };
}
export function useStore() { return store; }
export function getUid() { return store.status.uid; }
export async function getPrivacyConsentReceipt() { return null; }
export function RecordingConsentSheet(props) {
  consentSheets.push(props);
  return <div>Fresh recording-consent confirmation</div>;
}
export const C = new Proxy({}, { get: () => '#123456' });
export const s = { h1: {}, input: {} };
export const curSemester = () => 'Fall 2026';
let nextId = 0;
export const uid = () => `recovery-test-${++nextId}`;
export function createRecoveryDeviceFixture() { throw new Error('Only the on-phone fixture uses real Expo file APIs.'); }
export const Alert = { alert() {} };
export function Text({ children }) { return <span>{children}</span>; }
export function View({ children }) { return <div>{children}</div>; }
export function Pressable(props) {
  controls.push(props);
  return <button type="button">{props.children}</button>;
}
export function TextInput(props) {
  controls.push(props);
  return <input placeholder={props.placeholder} />;
}
export function Btn({ title, onPress, ...props }) {
  return <Pressable {...props} onPress={onPress} accessibilityLabel={title}><Text>{title}</Text></Pressable>;
}
export function Screen({ children }) { return <main>{children}</main>; }
export function Section({ children }) { return <section>{children}</section>; }