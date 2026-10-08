import React from 'react';
export default React;

// Run the real screen and its callbacks; only native/service boundaries are fake.
let hooks = [];
let cursor = 0;
let focus;
export const env = {};
export const controls = [];
export const inputs = [];
export function reset({ uid = 'library-a', courses = [], data, params = {} } = {}) {
  hooks = [];
  Object.assign(env, {
    uid, courses, data, params, calls: [], saves: [],
    billing: { loading: false, status: { plan: 'student', status: 'active' } },
    list: async () => env.data,
    save: async () => env.data,
  });
}
export function beginRender() { cursor = 0; controls.length = 0; inputs.length = 0; }
export function focusScreen() { return focus(); }
export const useState = initial => {
  const index = cursor++;
  if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
  return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
};
export const useRef = value => useState({ current: value })[0];
export const useCallback = fn => fn;
// Leaving effects pending intentionally tests the render before identity effects.
export const useEffect = () => {};
export const useFocusEffect = fn => { focus = fn; };
export const useStore = () => ({
  status: { uid: env.uid }, courses: () => env.courses,
  course: id => env.courses.find(c => c.id === id), assignmentsOf: () => [],
});
export const useBillingStatus = () => env.billing;
export const getUid = () => env.uid;
export const listStudentGrades = async () => { env.calls.push(env.uid); return env.list(); };
export const saveStudentGrades = async book => { env.saves.push(book); return env.save(book); };
export const errMsg = error => error.message;
export const useLocalSearchParams = () => env.params;
export const useSafeAreaInsets = () => ({ top: 24, bottom: 0 });
export const Stack = { Screen: () => null };
export const router = { push() {}, replace() {} };
export const Platform = { OS: 'ios' };
export const StyleSheet = { hairlineWidth: 1 };
export const C = new Proxy({}, { get: () => '#123456' });
export const mono = {};
export const courseColor = () => '#123456';
export const Ionicons = () => null;
export const Alert = { alert: (_title, _message, actions) => actions?.find(a => a.text === 'Remove')?.onPress() };
export const Image = () => <i>guidance-portrait</i>;
export const Text = ({ children }) => <span>{children}</span>;
export const View = ({ children }) => <div>{children}</div>;
export const Screen = View;
export const RefreshControl = () => null;
export const Pressable = ({ children, onPress, testID, accessibilityLabel }) => {
  controls.push({ title: testID || accessibilityLabel, onPress });
  return <div>{children}</div>;
};
export const Btn = ({ title, onPress, disabled }) => {
  controls.push({ title, onPress, disabled });
  return <span>{title}</span>;
};
export const TextInput = props => { inputs.push(props); return <span>{props.value}</span>; };
