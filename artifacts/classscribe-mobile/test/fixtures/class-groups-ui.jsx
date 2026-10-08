import React from 'react';
export default React;

let hooks = [];
let cursor = 0;
let focus;
let currentStore;
let currentUid;
let rejectPost = false;
export const controls = [];
export const inputs = [];
export const queries = [];
export const documents = { posts: [], shared: [] };
export const sharedCache = new Map();
export const router = { push: () => {} };
export const Platform = { OS: 'ios' };
export const C = new Proxy({}, { get: () => '#123456' });
export const Stack = { Screen: ({ options }) => options?.headerRight?.() || null };
export const Ionicons = () => null;
export const Alert = { alert: (_title, _message, actions) => actions?.find(a => ['Switch', 'Share'].includes(a.text))?.onPress() };
export const useState = (initial) => {
  const i = cursor++;
  if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
  return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }];
};
export const useRef = (value) => useState({ current: value })[0];
export const useCallback = (fn) => fn;
export const useMemo = (fn) => fn();
export const useEffect = () => {};
export const useFocusEffect = (fn) => { focus = fn; };
export function beginRender() { cursor = 0; controls.length = 0; inputs.length = 0; }
export function focusScreen() { return focus(); }
export function resetHooks() { hooks = []; cursor = 0; }
export function session(uid, courses) {
  currentUid = uid;
  hooks = [];
  cursor = 0;
  currentStore = {
    courses: () => courses,
    status: { server: 'connected' },
    put: (_collection, course) => {
      const index = courses.findIndex(c => c.id === course.id);
      courses[index] = course;
    },
    lecturesOf: () => [],
    lecture: id => currentStore.lectureItem?.id === id ? currentStore.lectureItem : null,
    isMine: () => true,
    jobs: {},
    all: () => ({}),
    course: id => courses.find(c => c.id === id),
  };
}
export function setLecture(lecture) { currentStore.lectureItem = lecture; }
export function failNextPost() { rejectPost = true; }
export const useStore = () => currentStore;
export const getUid = () => currentUid;
export const errMsg = error => error.message;
export const db = {
  async list(collection, where) {
    queries.push({ collection, where });
    if (!where || where.length !== 1 || where[0][0] !== 'code' || where[0][1] !== '==') throw Error('unfiltered read');
    return documents[collection].filter(d => d.data.code === where[0][2]);
  },
  async add(collection, data) {
    if (rejectPost) { rejectPost = false; throw Error('Could not send'); }
    documents[collection].push({ id: `${collection}-${documents[collection].length}`, data });
  },
  async set(path, data) {
    const [collection, id] = path.split('/');
    documents[collection].push({ id, data });
  },
  async get() { return null; },
};
export const useLocalSearchParams = () => ({ id: 'lecture-a' });
export const File = class { constructor() { this.exists = false; } };
export const Paths = { document: '' };
export const useAudioPlayer = () => ({});
export const useAudioPlayerStatus = () => ({ isLoaded: false });
export const createLectureAudioSeeker = () => ({ setLoaded: () => {} });
export const formatLectureTimestamp = () => '';
export const isSeekableLectureTimestamp = () => false;
export const lectureLinkTimestamp = () => null;
export const basicLectureAnalysis = async () => ({});
export const hasContent = () => false;
export const lectureNotesText = () => '';
export const Share = { share: async () => {} };
export const isAvailableAsync = async () => false;
export const composeAsync = async () => {};
export const mono = {};
export const fmtLong = date => date;
export const spkName = () => 'Instructor';
export const uid = () => 'note';
export const goBack = () => {};
export const stampDate = () => '';
export const courseColor = () => '#123456';
export const s = { h1: {}, label: {} };
export const showActions = ({ actions }) => {
  for (const action of actions) controls.push({ title: action.label, onPress: action.onPress });
};
let generated = 0;
export const randomUUID = () => `aaaaaaaa-bbbb-cccc-dddd-${String(++generated).padStart(12, '0')}`;
export const setStringAsync = async () => {};
export const aiText = async () => '';
export const material = () => '';
export const codeKey = code => code;
export const fmtD = date => date;
export const fmtT = time => String(time);
export const Btn = ({ title, onPress, disabled }) => {
  controls.push({ title, onPress, disabled });
  return null;
};
export const Seg = ({ options, onChange }) => {
  for (const [value, title] of options) controls.push({ title, onPress: () => onChange(value) });
  return null;
};
export const Row = ({ title }) => <span>{title}</span>;
export const Empty = ({ text }) => <span>{text}</span>;
export const Md = ({ text }) => <span>{text}</span>;
export const Section = ({ children }) => <div>{children}</div>;
export const Card = Section;
export const Chip = () => null;
export const ActivityIndicator = () => null;
export const Switch = () => null;
export const Text = ({ children }) => <span>{children}</span>;
export const View = ({ children }) => <div>{children}</div>;
export const ScrollView = View;
export const KeyboardAvoidingView = View;
export const Pressable = ({ children, onPress, accessibilityLabel }) => {
  if (onPress) controls.push({ title: accessibilityLabel || (typeof children === 'object' ? children?.props?.children : children), onPress });
  return <div>{children}</div>;
};
export const TextInput = ({ value, onChangeText, accessibilityLabel, placeholder }) => {
  inputs.push({ title: accessibilityLabel || placeholder, value, onChangeText });
  return <span>{value}</span>;
};