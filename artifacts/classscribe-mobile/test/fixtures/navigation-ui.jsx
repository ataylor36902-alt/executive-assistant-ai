import React from 'react';
export default React;
export const useState = initial => [initial === 'setup' ? (globalThis.__recordStep || 'setup') : (typeof initial === 'function' ? initial() : initial), () => {}];
export const useEffect = (effect, deps) => { if (deps?.length === 1 && typeof deps[0] === 'string') effect(); };
export const useRef = initial => ({ current: initial });

export const controls = [];
export const stacks = [];
export const router = {
  history: ['/home'],
  canGoBack() { return this.history.length > 1; },
  back() { this.history.pop(); },
  push(path) { this.history.push(path); },
  replace(path) { this.history[this.history.length - 1] = path; },
  navigate(path) { this.history = ['/home']; if (path !== '/home') this.history.push(path); },
};
export const C = new Proxy({}, { get: () => '#123456' });
export const useResolvedTheme = () => 'light';
export const useStore = () => ({
  resolvedTheme: 'light',
  status: { uid: 'test-library', online: false },
  profile: {},
  courses: () => [{ id: 'course-1', code: 'BIO', name: 'Biology' }],
  course: () => ({ id: 'course-1', code: 'BIO' }),
});
export const useLocalSearchParams = () => ({ courseId: 'course-1' });
export const safeInsets = { top: 24, bottom: 0, left: 0, right: 0 };
export const viewport = { width: 375, height: 812 };
export const useSafeAreaInsets = () => safeInsets;
export const useWindowDimensions = () => viewport;
export const headerTexts = [];
export const Platform = { OS: 'ios' };
export const NativeStatusBar = { currentHeight: 24 };
export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
export const Alert = {
  last: null,
  alert(title, message, actions) { this.last = { title, message, actions }; },
};
export const BackHandler = {
  handler: null,
  addEventListener(event, callback) {
    this.handler = callback;
    return { remove: () => { this.handler = null; } };
  },
};
export function Pressable(props) {
  controls.push(props);
  return <button>{props.children}</button>;
}
export const Text = (props) => {
  if (props.testID === 'navigation-header-title') headerTexts.push(props);
  return <span>{props.children}</span>;
};
export const View = ({ children }) => <div>{children}</div>;
export const SafeAreaView = View;
export const ScrollView = View;
export const KeyboardAvoidingView = View;
export const KeyboardAwareScrollViewCompat = View;
export const Keyboard = { dismiss() {} };
export const TextInput = () => null;
export const Switch = () => null;
export const Ionicons = () => null;
export const StatusBar = () => null;
export const GestureHandlerRootView = View;
export const KeyboardProvider = View;
export const StoreProvider = View;
export const ClerkProvider = View;
export class QueryClient {}
export const QueryClientProvider = View;
export const useAuth = () => ({ getToken: async () => null });
export const useBillingStatus = () => ({ status: null });
export const needsOnboardingPlan = () => false;
export const InAppNoticeHost = () => null;
export const AiConsentDialog = () => null;
export const CreditsConfirmSheet = () => null;
export const errMsg = error => error?.message || String(error);
export const getUid = () => 'test-library';
export const reserveRecording = async () => ({});
export const finishRecordingReservation = async () => ({});
export const releaseRecordingReservation = async () => ({});
export const lectureStorageDirectory = async () => ({});
export const isCreditsRequired = () => false;
export const refreshCreditsAfterAction = async () => ({});
export const flushPrivacyConsents = async () => {};
export const getPrivacyConfig = async () => ({ statements: ['Permission', 'Private use'] });
export const queuePrivacyConsent = () => {};
export const removeQueuedPrivacyConsent = () => {};
export const savePrivacyConsent = async () => ({});
export const tokenCache = {};
export const clerkPublishableKey = '';
export const ActionSheetHost = () => null;
export const LaunchIntro = () => null;
export function Stack({ screenOptions, children }) {
  stacks.push({ screenOptions, screens: React.Children.toArray(children).map(x => x.props) });
  return <>{children}</>;
}
Stack.Screen = () => null;
export const useAudioRecorder = () => ({
  stop: async () => { globalThis.__recorderStops = (globalThis.__recorderStops || 0) + 1; },
  getStatus: () => ({ isRecording: false }),
});
export const useAudioRecorderState = () => ({ durationMillis: 5000 });
export const useLectureRecorder = () => [useAudioRecorder(), { durationMillis: 5000 }];
export const RecordingPresets = { HIGH_QUALITY: {} };
export const useKeepAwake = () => {};
export const requestRecordingPermissionsAsync = async () => ({ granted: true });
export const setAudioModeAsync = async () => {};
export const Haptics = { notificationAsync: async () => {}, NotificationFeedbackType: { Success: 'success' } };
export const notificationAsync = Haptics.notificationAsync;
export const NotificationFeedbackType = Haptics.NotificationFeedbackType;
export const selectionAsync = async () => {};
export const impactAsync = async () => {};
export const ImpactFeedbackStyle = { Light: 'light' };
export const requestCameraPermissionsAsync = async () => ({ granted: false });
export const launchCameraAsync = async () => ({ canceled: true });
export const currentClass = () => null;
export const aiImage = async () => '';
export const courseColor = () => '#123456';
export const mono = {};
export const curSemester = () => '';
export const fmtT = () => '0:05';
export const nowMs = () => 1;
export const stampDate = () => '';
export const stampsToLinks = x => x;
export const todayISO = () => '2026-09-25';
export const uid = () => 'new-lecture';
export const File = class {};
export const Paths = {};
export const Btn = ({ title, onPress }) => <Pressable accessibilityLabel={title} onPress={onPress}><Text>{title}</Text></Pressable>;
export const Seg = () => null;
export const s = { label: {}, input: {} };