import React, { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar as NativeStatusBar, Switch, Text, TextInput, View } from 'react-native';
import { Alert } from '../lib/notify';
import { KeyboardAwareScrollViewCompat } from '../components/KeyboardAwareScrollViewCompat';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { useAuth } from '@clerk/expo';
import { useKeepAwake } from 'expo-keep-awake';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { useStore } from '../lib/store';
import { useBillingStatus } from '../lib/billing';
import { currentClass } from '../lib/schedule';
import { aiImage, errMsg, finishRecordingReservation, getUid, releaseRecordingReservation, reserveRecording } from '../lib/api';
import { C, courseColor, mono } from '../lib/theme';
import { curSemester, fmtT, nowMs, stampDate, stampsToLinks, todayISO, uid } from '../lib/util';
import { File } from 'expo-file-system';
import { lectureStorageDirectory } from '../lib/lecture-media';
import { markRecordingOwner } from '../lib/recording-ownership';
import { Btn, Seg, s } from '../components/ui';
import { goBack } from '../components/BackButton';
import { CreditsConfirmSheet } from '../components/CreditsConfirmSheet';
import { isCreditsRequired, refreshCreditsAfterAction } from '../lib/credits-actions';
import { flushPrivacyConsents, getPrivacyConfig, queuePrivacyConsent, removeQueuedPrivacyConsent, savePrivacyConsent } from '../lib/privacy';
import { useLectureRecorder } from '../lib/use-lecture-recorder';

// Recorder output is written to app documents so its original URI remains durable if renaming fails.
// Mono, 32 kbps AAC keeps a 50-minute lecture around 12 MB (under typical transcription upload limits).
const REC_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, sampleRate: 22050, numberOfChannels: 1, bitRate: 32000, isMeteringEnabled: true, directory: 'document' };

function KeepAwake() { useKeepAwake(); return null; }
const KeepScreenOn = Platform.OS === 'web' ? () => null : KeepAwake;

function PermissionSwitch({ value, onValueChange, label, testID }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', minWidth: 64, minHeight: 44, gap: 4, flexShrink: 0 }}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: C.sec, true: C.accent }}
        thumbColor={value ? C.accentText : C.cell}
        ios_backgroundColor={C.sec}
        accessibilityLabel={label}
        accessibilityHint="Turn on only if this statement applies."
        testID={testID}
      />
      <Text accessible={false} style={{ color: value ? C.accent : C.sec, fontSize: 12, fontWeight: '700' }}>
        {value ? 'On' : 'Off'}
      </Text>
    </View>
  );
}

export default function Record() {
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top || (Platform.OS === 'ios' ? 59 : NativeStatusBar.currentHeight || 24);
  const screenStyle = { flex: 1, backgroundColor: C.bg, paddingTop: topInset, paddingLeft: insets.left, paddingRight: insets.right };
  const st = useStore();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const billing = useBillingStatus(st.status.uid);
  const courses = st.courses();
  const [recorder, rs] = useLectureRecorder(REC_OPTIONS, 200);
  const [step, setStep] = useState('setup');
  const [cid, setCid] = useState(() => { const now = currentClass(courses); return params.courseId || (now && now.c.id) || (courses[0] && courses[0].id) || ''; });
  const [title, setTitle] = useState('');
  const [module, setModule] = useState('');
  const [c1, setC1] = useState(false);
  const [c2, setC2] = useState(false);
  const [accommodation, setAccommodation] = useState(false);
  const [consentConfig, setConsentConfig] = useState(null);
  const [consentConfigError, setConsentConfigError] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [courseError, setCourseError] = useState('');
  const [authRecovery, setAuthRecovery] = useState('');
  const setupLibraryRef = useRef(st.status.uid);
  const [creditsPrompt, setCreditsPrompt] = useState(null);
  const [creditsPromptVisible, setCreditsPromptVisible] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);
  const [starting, setStarting] = useState(false);
  const [finishRetryNeeded, setFinishRetryNeeded] = useState(false);
  const [finishBusy, setFinishBusy] = useState(false);
  const [savedLectureId, setSavedLectureId] = useState('');
  const [releaseRetryNeeded, setReleaseRetryNeeded] = useState(false);
  const [saveFailure, setSaveFailure] = useState('');
  const [paused, setPaused] = useState(false);
  const [pane, setPane] = useState('lines');
  const [segs, setSegs] = useState([]);
  const [marks, setMarks] = useState([]);
  const [slides, setSlides] = useState([]);
  const [line, setLine] = useState('');
  const [lineStart, setLineStart] = useState(null);
  const [spk, setSpk] = useState('P');
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState('');
  const [levels, setLevels] = useState(() => Array(36).fill(0.05));
  const scrollRef = useRef(null);
  const saving = useRef(false);
  const startingRef = useRef(false);
  const recordingIdRef = useRef(null);
  const recordingLibraryRef = useRef(null);
  const consentSessionRef = useRef(null);
  const reservationPendingRef = useRef(false);
  const creditsReservationRef = useRef(false);
  const localAudioSavedRef = useRef(false);
  const pendingLectureRef = useRef(null);
  const audioMoveWarningRef = useRef('');
  const mountedRef = useRef(true);
  const exitAfterReleaseRef = useRef(false);
  const newCourseDraftId = useRef(null);
  const now = () => Math.round((rs.durationMillis || 0) / 1000);

  useEffect(() => {
    if (rs.error) setCourseError(rs.error);
  }, [rs.error]);

  // Sample the input level a few times a second for the meter.
  useEffect(() => {
    if (step !== 'live') return undefined;
    const t = setInterval(() => {
      const st2 = recorder.getStatus();
      if (!st2.isRecording || typeof st2.metering !== 'number') return;
      const v = Math.max(0.05, Math.min(1, (st2.metering + 60) / 60));
      setLevels((l) => [...l.slice(1), v]);
    }, 200);
    return () => clearInterval(t);
  }, [step, recorder]);

  async function releasePendingReservation() {
    const recordingId = recordingIdRef.current;
    if (!reservationPendingRef.current || !recordingId) return true;
    try {
      await releaseRecordingReservation(recordingId);
      reservationPendingRef.current = false;
      const refundedCredits = creditsReservationRef.current;
      creditsReservationRef.current = false;
      if (!localAudioSavedRef.current) {
        recordingIdRef.current = null;
        consentSessionRef.current = null;
      }
      setReleaseRetryNeeded(false);
      if (refundedCredits) {
        try {
          const update = await refreshCreditsAfterAction(st.status.uid);
          if (update.warning) setCourseError(update.warning);
        } catch {
          setCourseError('The reservation was released, but your Credits balance could not be refreshed yet.');
        }
      }
      await billing.refresh();
      return true;
    } catch {
      await billing.refresh();
      setReleaseRetryNeeded(true);
      return false;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // The recorder hook owns stop-before-release cleanup. Do not read a
      // native shared object after that hook has begun disposing it.
      if (reservationPendingRef.current && !localAudioSavedRef.current && recordingIdRef.current) {
        const shouldRefreshCredits = creditsReservationRef.current;
        const libraryCode = st.status.uid;
        releaseRecordingReservation(recordingIdRef.current)
          .then(() => shouldRefreshCredits ? refreshCreditsAfterAction(libraryCode) : null)
          .catch(() => {});
      }
    };
  }, [recorder]);

  useEffect(() => {
    st.retryPendingRecordingFinishes();
  }, [st.retryPendingRecordingFinishes]);

  useEffect(() => {
    let active = true;
    getPrivacyConfig().then((config) => {
      if (!active) return;
      if (!config?.consent?.version || !Array.isArray(config.consent.statements) || config.consent.statements.length !== 2 || config.consent.statements.some((statement) => typeof statement !== 'string' || !statement)) {
        throw new Error('The server returned incomplete recording-consent text. Recording is unavailable until it is fixed.');
      }
      setConsentConfig(config.consent);
      setConsentConfigError(config.offlineCached ? 'Using the last successfully loaded consent text while offline.' : '');
    }).catch((error) => { if (active) setConsentConfigError(error.message || 'Recording consent text could not be loaded.'); });
    const libraryCode = st.status.uid;
    flushPrivacyConsents(libraryCode, getToken).catch(() => {});
    return () => { active = false; };
  }, [getToken, st.status.uid, st.retryPendingRecordingFinishes]);

  useEffect(() => {
    const libraryCode = st.status.uid;
    if (!libraryCode) return undefined;
    let active = true;
    const flush = () => {
      if (!active || libraryCode !== getUid()) return;
      flushPrivacyConsents(libraryCode, getToken).catch((error) => {
        if (active && libraryCode === getUid()) setCourseError(`Saved recording consent is waiting to sync: ${error.message || 'check your connection and try again.'}`);
      });
    };
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') flush(); });
    const timer = setInterval(flush, 30000);
    return () => { active = false; subscription.remove(); clearInterval(timer); };
  }, [getToken, st.status.uid]);

  async function start(creditConfirmation = null) {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setCourseError('');
    setAuthRecovery('');
    try {
      if (!isLoaded) throw new Error('Your account session is still loading. Wait a moment, then tap Start recording again.');
      if (setupLibraryRef.current !== getUid() || st.status.uid !== getUid()) {
        throw new Error('Your library changed. Reopen Record in the library you want to use. Recording has not started.');
      }
      await import('../lib/ai-consent').then(({ ensureAiConsent }) => ensureAiConsent());
      await st.retryPendingRecordingFinishes();
      await billing.refresh();
      if (reservationPendingRef.current && !await releasePendingReservation()) {
        setCourseError('A previous recording reservation is still pending. Retry releasing it before starting another recording.');
        return;
      }
      let courseId = cid;
      const picked = st.course(courseId);
      if (picked && picked.ex) {
        // Your recordings are always saved: example courses are copied into your library first.
        const mineAlready = st.courses().find((x) => !x.ex && x.code === picked.code);
        if (mineAlready) {
          if (mineAlready._pending && !await saveCourse(mineAlready)) return;
          courseId = mineAlready.id;
        } else {
          const copy = { id: uid(), code: picked.code, name: picked.name, professor: picked.professor || '', semester: picked.semester || curSemester(), color: picked.color || 0, created: nowMs(), meetings: picked.meetings || [] };
          if (!await saveCourse(copy)) return;
          courseId = copy.id;
        }
        setCid(courseId);
      }
      if (!courseId || courseId === '__new') {
        if (!newCode.trim() || !newName.trim()) {
          setCourseError('Enter a course code and name.');
          return;
        }
        const c = { id: newCourseDraftId.current || (newCourseDraftId.current = uid()), code: newCode.trim().toUpperCase(), name: newName.trim(), professor: '', semester: (st.profile && st.profile.term) || curSemester(), color: courses.length % 6, created: Date.now() };
        if (!await saveCourse(c)) return;
        newCourseDraftId.current = null;
        courseId = c.id; setCid(c.id);
      }
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone access is off', 'Allow microphone access for ClassScribe in Settings to record lectures.');
        return;
      }
      if (!consentSessionRef.current || consentSessionRef.current.courseId !== courseId) {
        const recordingId = uid();
        consentSessionRef.current = { recordingId, sessionId: recordingId, courseId };
        recordingIdRef.current = recordingId;
      }
      const { recordingId, sessionId } = consentSessionRef.current;
      if (!consentConfig) throw new Error(consentConfigError || 'Load the server’s recording-consent text before recording.');
      const consentRecord = {
        sessionId,
        lectureId: recordingId,
        courseId,
        version: consentConfig.version,
        statements: [...consentConfig.statements],
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version || 'unknown',
        accommodation,
      };
      const consentLibrary = st.status.uid;
      await queuePrivacyConsent(consentLibrary, consentRecord);
      let consentReceipt;
      try {
        consentReceipt = await savePrivacyConsent(consentRecord, getToken, consentLibrary, { signedIn: isSignedIn });
        await removeQueuedPrivacyConsent(consentLibrary, consentRecord.sessionId);
      } catch (consentError) {
        if (consentLibrary !== getUid()) throw new Error('The active library changed while recording consent was saving.');
        if (!['offline', 'timeout', 'no_server'].includes(consentError?.code)) {
          await removeQueuedPrivacyConsent(consentLibrary, consentRecord.sessionId);
          throw consentError;
        }
        // Keep the immutable consent payload on this library for an idempotent retry.
        throw new Error('Your recording consent is saved on this phone and will retry when online. The recording has not started yet.');
      }
      if (!consentReceipt?.consentId || consentReceipt.sessionId !== sessionId) {
        throw new Error('The server did not confirm consent for this exact recording session. Recording was not started.');
      }
      if (creditConfirmation && (creditConfirmation.libraryCode !== getUid() || creditConfirmation.libraryCode !== st.status.uid)) {
        throw new Error('Your library changed. Reopen Record before confirming a Credits reservation.');
      }
      try {
        creditsReservationRef.current = !!creditConfirmation;
        await reserveRecording(recordingId, creditConfirmation
          ? { useCredits: true, requestId: creditConfirmation.requestId, consentId: consentReceipt.consentId, sessionId: consentReceipt.sessionId, lectureId: consentReceipt.lectureId, courseId: consentReceipt.courseId }
          : { consentId: consentReceipt.consentId, sessionId: consentReceipt.sessionId, lectureId: consentReceipt.lectureId, courseId: consentReceipt.courseId });
        reservationPendingRef.current = true;
      } catch (error) {
        if (error?.code === 'offline' || error?.code === 'timeout') reservationPendingRef.current = true;
        else creditsReservationRef.current = false;
        throw error;
      }
      if (creditConfirmation) {
        try {
          const update = await refreshCreditsAfterAction(st.status.uid);
          if (update.warning) setCourseError(update.warning);
        } catch {
          setCourseError('Recording is starting, but your Credits balance could not be refreshed yet.');
        }
      }
      await billing.refresh();
      if (!mountedRef.current) {
        await releasePendingReservation();
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true, allowsBackgroundRecording: true });
      await recorder.prepareToRecordAsync();
      if (consentLibrary !== getUid()) throw new Error('The active library changed before recording started.');
      recordingLibraryRef.current = consentLibrary;
      if (Platform.OS !== 'web') await markRecordingOwner(recorder.uri, consentLibrary);
      if (!mountedRef.current || consentLibrary !== getUid()) throw new Error('The recording screen or library changed before recording started.');
      recorder.record();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setStep('live');
    } catch (error) {
      if (['auth_required', 'auth_session_failed', 'library_mismatch'].includes(error?.code)) setAuthRecovery(error.code);
      if (recorder.isRecording) await recorder.stop().catch(() => {});
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      if (isCreditsRequired(error)) {
        setCreditsPrompt({ ...error, libraryCode: st.status.uid });
        setCreditsPromptVisible(true);
      } else if (reservationPendingRef.current) {
        const released = await releasePendingReservation();
        setCourseError(released
          ? errMsg(error)
          : `${errMsg(error)} The pending reservation could not be released; retry cleanup before recording again.`);
      } else {
        setCourseError(errMsg(error));
      }
      await billing.refresh();
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }
  function confirmCreditsReservation() {
    if (!creditsPrompt) return;
    const request = creditsPrompt;
    setCreditsPromptVisible(false);
    setCreditsPrompt(null);
    start({ requestId: request.requestId, libraryCode: request.libraryCode });
  }
  async function saveCourse(course) {
    setSavingCourse(true);
    setCourseError('');
    try {
      await st.putCourse(course);
      return true;
    } catch (error) {
      setCourseError(error?.message || (error?.code === 'plan_limit'
        ? 'Your current plan has reached its course limit. Your course details are still here.'
        : 'The server could not confirm this course. Your draft is still here; try again.'));
      return false;
    } finally {
      setSavingCourse(false);
    }
  }
  function togglePause() {
    try {
      if (paused) { recorder.record(); setPaused(false); } else { recorder.pause(); setPaused(true); }
    } catch (error) {
      setCourseError(errMsg(error));
    }
    Haptics.selectionAsync().catch(() => {});
  }
  function bookmark() {
    setMarks((m) => [...m, now()]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
  function addLine() {
    const x = line.trim(); if (!x) return;
    setSegs((a) => [...a, { t: lineStart ?? now(), s: spk, x }].sort((p, q) => p.t - q.t));
    setLine(''); setLineStart(null);
    setTimeout(() => scrollRef.current && scrollRef.current.scrollToEnd({ animated: true }), 50);
  }
  async function snapSlide() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Camera access is off', 'Allow camera access in Settings to snap slides.');
    const t = now();
    const r = await ImagePicker.launchCameraAsync({ quality: 0.4, base64: true });
    if (r.canceled || !r.assets || !r.assets[0]) return;
    const a = r.assets[0];
    const slide = { t, text: 'Reading the slide…' };
    setSlides((x) => [...x, slide]);
    let text = `Photo taken at ${fmtT(t)}.`;
    try { text = (await aiImage('This is a photo of a lecture slide or whiteboard. Transcribe its key text and summarize it in under 60 words. Plain text, no preamble.', a.base64, a.mimeType || 'image/jpeg')).trim(); } catch { /* AI unavailable */ }
    setSlides((x) => x.map((sl) => (sl === slide ? { t, text } : sl)));
  }
  function insertStamp() { setNotes((n) => (n && !n.endsWith('\n') ? n + '\n' : n) + `[${stampDate(todayISO())} · ${fmtT(now())}] `); }

  async function finishSavedRecording() {
    const recordingId = recordingIdRef.current;
    if (!recordingId || !reservationPendingRef.current || !localAudioSavedRef.current || finishBusy) return;
    setFinishBusy(true);
    setProgress('Confirming saved recording…');
    try {
      if (!pendingLectureRef.current) throw new Error('The saved lecture details are unavailable. Keep this screen open and retry.');
      await st.saveRecordingFinishIntent(pendingLectureRef.current);
      await finishRecordingReservation(recordingId);
      reservationPendingRef.current = false;
      if (creditsReservationRef.current) {
        creditsReservationRef.current = false;
        try {
          const update = await refreshCreditsAfterAction(st.status.uid);
          if (update.warning) setProgress(update.warning);
        } catch {
          setProgress('Recording saved. Your Credits balance could not be refreshed yet.');
        }
      }
      localAudioSavedRef.current = false;
      recordingIdRef.current = null;
      consentSessionRef.current = null;
      pendingLectureRef.current = null;
      await st.clearRecordingFinishIntent(recordingId).catch(() => {});
      setFinishRetryNeeded(false);
      await billing.refresh();
      if (audioMoveWarningRef.current) {
        setSavedLectureId(recordingId);
        setProgress(`${audioMoveWarningRef.current} The server confirmed this saved recording.`);
      } else {
        router.replace(`/lecture/${recordingId}`);
      }
    } catch (error) {
      await billing.refresh();
      setProgress(`${audioMoveWarningRef.current ? `${audioMoveWarningRef.current} ` : ''}Recording saved on this phone, but the server could not confirm it: ${errMsg(error)}`);
      setFinishRetryNeeded(true);
      saving.current = false;
    } finally {
      setFinishBusy(false);
    }
  }

  async function retryRelease() {
    if (await releasePendingReservation()) {
      setCourseError('');
      if (exitAfterReleaseRef.current) {
        exitAfterReleaseRef.current = false;
        router.replace('/home');
      }
    } else {
      setCourseError('The recording reservation is still pending. Check your connection and retry cleanup.');
    }
  }

  async function stopAndSave() {
    if (saving.current) return;
    saving.current = true;
    const duration = now();
    setStep('saving'); setProgress('Saving…');
    try {
      try { await recorder.stop(); } catch { /* already stopped */ }
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      const id = recordingIdRef.current;
      if (!id || !reservationPendingRef.current) throw new Error('The server reservation is missing, so this recording cannot be confirmed.');
      const library = recordingLibraryRef.current;
      if (!library || library !== getUid()) throw new Error('The library changed. The audio stays on this phone and can be recovered in its original library.');
      // Keep the audio in the app's documents so it survives and can be played back.
      let uri = recorder.uri || null; let audioName = '';
      let moveWarning = '';
      if (uri) {
        try {
          const folder = await lectureStorageDirectory(library, id);
          if (library !== getUid()) throw new Error('The active library changed while saving.');
          folder.create({ intermediates: true, idempotent: true });
          const source = new File(uri);
          const dest = new File(folder, `audio${REC_OPTIONS.extension || '.m4a'}`);
          await source.move(dest, { overwrite: true });
          uri = dest.uri; audioName = dest.name;
        }
        catch {
          audioName = uri.split('/').pop();
          moveWarning = 'The audio could not be moved to its final filename. The original recording path is preserved in this lecture.';
        }
      }
      const audioExists = !!uri && (Platform.OS === 'web' || new File(uri).exists);
      if (!audioExists) throw new Error('The audio file could not be saved on this device.');
      if (library !== getUid()) throw new Error('The library changed. Recover the audio in its original library.');
      localAudioSavedRef.current = true;
      audioMoveWarningRef.current = moveWarning;
      const c = st.course(cid) || {};
      const lec = { id, courseId: cid, title: title.trim() || 'Lecture ' + todayISO(), date: todayISO(), module: module.trim(), duration: Math.max(duration, 1), speakers: { P: c.professor || 'Professor', S: 'Student', G: 'Guest' }, segs, marks, slides, analysis: null, reviewed: false, created: nowMs(), ex: false, audioName, audioUri: uri || '', ...(moveWarning ? { audioSaveWarning: moveWarning } : {}) };
      pendingLectureRef.current = lec;
      await st.saveRecordingFinishIntent(lec);
      if (notes.trim()) st.put('notes', { id: uid(), courseId: cid, lectureId: id, title: lec.title + ' — my notes', body: stampsToLinks(notes, id), pinned: false, created: nowMs(), updated: nowMs(), ex: false });
      st.processRecording(lec, uri);
      await finishSavedRecording();
    } catch (error) {
      if (localAudioSavedRef.current) {
        setProgress(`Recording saved on this phone, but server confirmation needs a retry: ${errMsg(error)}`);
        setFinishRetryNeeded(true);
      } else {
        const released = await releasePendingReservation();
        setSaveFailure(`${errMsg(error)}${released ? '' : ' The server reservation could not be released; retry cleanup.'}`);
        setStep('save-error');
      }
      saving.current = false;
    }
  }
  function leaveRecording() {
    router.replace('/home');
  }
  function cancelSetup() {
    goBack();
  }
  async function discardRecording() {
    if (!await releasePendingReservation()) {
      exitAfterReleaseRef.current = true;
      setCourseError('Could not release the server reservation, so cancellation is waiting. Check your connection and retry cleanup.');
      setReleaseRetryNeeded(true);
      return;
    }
    try { await recorder.stop(); } catch { /* already stopped */ }
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    leaveRecording();
  }
  function discard() {
    const message = 'The audio and anything you typed will be deleted.';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Discard this recording?\n\n${message}`)) discardRecording();
      return;
    }
    Alert.alert('Discard this recording?', message, [
      { text: 'Keep recording', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discardRecording },
    ]);
  }

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 'setup') cancelSetup();
      else if (step === 'live') discard();
      return true;
    });
    return () => subscription.remove();
  }, [step]);

  if (step === 'setup') {
    const ready = c1 && c2 && (cid && cid !== '__new' ? true : newCode.trim() && newName.trim());
    return (
      <SafeAreaView edges={['bottom']} style={screenStyle}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, height: 44 }}>
          <Pressable onPress={cancelSetup} accessibilityRole="button" accessibilityLabel="Back" testID="record-back" hitSlop={8} style={{ minWidth: 74, minHeight: 44, flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="chevron-back" size={22} color={C.accent} />
            <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ color: C.accent, fontSize: 17 }}>Back</Text>
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.ink }}>Record a lecture</Text>
          <View style={{ width: 74, flexShrink: 0 }} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <KeyboardAwareScrollViewCompat bottomOffset={120} keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>Course</Text>
            <View style={{ backgroundColor: C.cell, borderRadius: 10, overflow: 'hidden' }}>
              {[...courses, { id: '__new', code: 'New course', name: '' }].map((c, i, arr) => (
                <Pressable key={c.id} onPress={() => { setCid(c.id); setCourseError(''); }} accessibilityRole="radio" accessibilityState={{ selected: cid === c.id }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16 }}>
                  <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: c.id === '__new' ? C.faint : courseColor(c) }} />
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingRight: 16, borderBottomWidth: i < arr.length - 1 ? 0.5 : 0, borderBottomColor: C.sep }}>
                    <Text style={{ flex: 1, fontSize: 17, color: C.ink }}>{c.code}{c.name ? <Text style={{ color: C.sec }}>{'  ' + c.name}</Text> : null}</Text>
                    {cid === c.id ? <Ionicons name="checkmark" size={20} color={C.accent} /> : null}
                  </View>
                </Pressable>
              ))}
            </View>
            {cid === '__new' || !cid ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput value={newCode} onChangeText={(value) => { setNewCode(value); setCourseError(''); }} editable={!savingCourse} placeholder="Code (HIST 150)" placeholderTextColor={C.faint} autoCapitalize="characters" style={[s.input, { flex: 1 }]} />
                <TextInput value={newName} onChangeText={(value) => { setNewName(value); setCourseError(''); }} editable={!savingCourse} placeholder="Course name" placeholderTextColor={C.faint} style={[s.input, { flex: 1.4 }]} />
              </View>
            ) : null}
            <Text style={s.label}>Lecture</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="Title, e.g. Meiosis" placeholderTextColor={C.faint} style={s.input} />
            <TextInput value={module} onChangeText={setModule} placeholder="Unit or module (optional)" placeholderTextColor={C.faint} style={s.input} />
            <Text style={s.label}>Recording consent</Text>
            <Text style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>
              Read the statements below, then turn on both required switches to agree. The accommodation switch is optional.
            </Text>
              <View style={{ backgroundColor: C.cell, borderRadius: 10, paddingHorizontal: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: C.sep }}>
                <Text style={{ flex: 1, fontSize: 15, color: C.ink, lineHeight: 20 }}>{consentConfig?.statements?.[0] || 'Loading the current permission text…'}</Text>
                <PermissionSwitch value={c1} onValueChange={setC1} label="Required: I have permission to record" testID="record-consent-permission" />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
                <Text style={{ flex: 1, fontSize: 15, color: C.ink, lineHeight: 20 }}>{consentConfig?.statements?.[1] || 'Loading the current privacy text…'}</Text>
                <PermissionSwitch value={c2} onValueChange={setC2} label="Required: I agree to the Privacy Policy" testID="record-consent-privacy" />
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.cell, borderRadius: 10, padding: 14 }}>
              <Text style={{ flex: 1, fontSize: 14, color: C.ink, lineHeight: 20 }}>I have an accommodation related to recording (optional)</Text>
              <PermissionSwitch value={accommodation} onValueChange={setAccommodation} label="Optional: accommodation related to recording" testID="record-consent-accommodation" />
            </View>
            {consentConfigError ? <Text accessibilityRole="alert" style={{ color: consentConfig?.offlineCached ? C.sec : C.warn, fontSize: 13, lineHeight: 19 }}>{consentConfigError}</Text> : null}
            {billing.status && (typeof billing.status.recordingCountUsed === 'number' || typeof billing.status.transcriptionCountUsed === 'number') ? (
              <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>
                {typeof billing.status.recordingCountUsed === 'number' && typeof billing.status.recordingCountLimit === 'number'
                  ? `${billing.status.recordingCountUsed} of ${billing.status.recordingCountLimit} monthly saved recordings used. `
                  : ''}
                {typeof billing.status.transcriptionCountUsed === 'number' && typeof billing.status.transcriptionCountLimit === 'number'
                  ? `${billing.status.transcriptionCountUsed} of ${billing.status.transcriptionCountLimit} monthly successful transcriptions used.`
                  : ''}
              </Text>
            ) : null}
            {courseError ? <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 14, lineHeight: 20 }}>{courseError}</Text> : null}
            {authRecovery ? <Btn
              title={authRecovery === 'library_mismatch' ? 'Check library in Account' : isSignedIn ? 'Verify sign-in for recording' : 'Sign in to continue'}
              kind="secondary"
              testID="record-sign-in-recovery"
              onPress={() => {
                Keyboard.dismiss();
                if (authRecovery === 'library_mismatch') router.push('/account');
                else router.push({ pathname: '/account-sign-in', params: { recordingRecovery: '1' } });
              }}
            /> : null}
            {releaseRetryNeeded ? <Btn title="Retry reservation cleanup" kind="secondary" onPress={retryRelease} /> : null}
            <Btn title="Start recording" kind="rec" icon="mic" disabled={!isLoaded || !ready || !consentConfig || savingCourse || starting || releaseRetryNeeded} busy={savingCourse || starting} onPress={() => start()} />
          </KeyboardAwareScrollViewCompat>
        </KeyboardAvoidingView>
        <CreditsConfirmSheet
          request={creditsPrompt}
          visible={creditsPromptVisible}
          busy={starting}
          onConfirm={confirmCreditsReservation}
          onCancel={() => { setCreditsPromptVisible(false); setCreditsPrompt(null); }}
        />
      </SafeAreaView>
    );
  }

  if (step === 'saving' || step === 'save-error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={step === 'save-error' ? 'alert-circle-outline' : 'sparkles'} size={30} color={step === 'save-error' ? C.warn : C.accent} /></View>
        <Text accessibilityRole={saveFailure ? 'alert' : undefined} style={{ fontSize: 17, fontWeight: '600', color: C.ink, textAlign: 'center' }}>{step === 'save-error' ? saveFailure : progress}</Text>
        {step === 'saving' && !finishRetryNeeded && !savedLectureId ? <Text style={{ fontSize: 14, color: C.sec, textAlign: 'center' }}>Keep ClassScribe open until this finishes.</Text> : null}
        {finishRetryNeeded ? <Btn title="Retry server confirmation" icon="refresh" busy={finishBusy} onPress={finishSavedRecording} /> : null}
        {savedLectureId ? <Btn title="Open saved lecture" onPress={() => router.replace(`/lecture/${savedLectureId}`)} /> : null}
        {releaseRetryNeeded ? <Btn title="Retry reservation cleanup" kind="secondary" onPress={retryRelease} /> : null}
        {step === 'save-error' && !releaseRetryNeeded ? <Btn title="Return to your library" kind="secondary" onPress={leaveRecording} /> : null}
      </SafeAreaView>
    );
  }

  const c = st.course(cid) || {};
  const items = [...segs.map((g) => ({ k: 's', t: g.t, g })), ...marks.map((t) => ({ k: 'm', t: t + 0.01 })), ...slides.map((sl) => ({ k: 'sl', t: sl.t + 0.02, sl }))].sort((a, b) => a.t - b.t);
  return (
    <SafeAreaView edges={['bottom']} style={screenStyle}>
      <KeepScreenOn />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, height: 44 }}>
        <Pressable onPress={discard} accessibilityRole="button" accessibilityLabel="Discard recording and leave" testID="record-discard" hitSlop={8} style={{ minWidth: 84, minHeight: 44, justifyContent: 'center' }}><Text style={{ color: C.rec, fontSize: 17 }}>Discard</Text></Pressable>
        <Text style={{ fontSize: 17, fontWeight: '600', color: C.ink }} numberOfLines={1}>{c.code} · {title || 'Lecture'}</Text>
        <Pressable onPress={stopAndSave} accessibilityRole="button"><Text style={{ color: C.accent, fontSize: 17, fontWeight: '600' }}>Save</Text></Pressable>
      </View>
      <View style={{ alignItems: 'center', gap: 6, marginTop: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: paused ? C.fill : C.recSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: paused ? C.sec : C.rec }} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: paused ? C.sec : C.rec }}>{paused ? 'Paused' : 'Recording · consent confirmed'}</Text>
        </View>
        <Text style={[{ fontSize: 54, fontWeight: '300', color: C.ink }, mono]}>{fmtT(now())}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 56 }} accessibilityElementsHidden>
          {levels.map((v, i) => <View key={i} style={{ width: 4, borderRadius: 2, height: 4 + v * 50, backgroundColor: paused ? C.faint : i > 28 ? C.rec : C.recSoft }} />)}
        </View>
      </View>
      {courseError ? (
        <View style={{ marginHorizontal: 16, marginTop: 8, gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 14, textAlign: 'center' }}>{courseError}</Text>
          {releaseRetryNeeded ? <Btn title="Retry reservation cleanup" kind="secondary" onPress={retryRelease} /> : null}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20, marginTop: 10 }}>
        <Pressable onPress={bookmark} accessibilityLabel="Bookmark this moment" style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.hiSoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="star" size={24} color={C.hiInk} /></Pressable>
        <Pressable onPress={togglePause} accessibilityLabel={paused ? 'Resume' : 'Pause'} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={paused ? 'play' : 'pause'} size={24} color={C.ink} /></Pressable>
        <Pressable onPress={stopAndSave} accessibilityLabel="Stop and save" style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: C.recSoft, backgroundColor: C.rec, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 26, height: 26, borderRadius: 6, backgroundColor: C.white }} /></Pressable>
        <Pressable onPress={snapSlide} accessibilityLabel="Snap slide or board" style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="camera" size={24} color={C.ink} /></Pressable>
      </View>
      <Seg style={{ marginTop: 16 }} value={pane} onChange={setPane} options={[['lines', 'What’s said'], ['notes', 'My notes']]} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={10}>
        {pane === 'lines' ? (
          <View style={{ flex: 1, margin: 16, marginBottom: 8, backgroundColor: C.cell, borderRadius: 14 }}>
            <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 12, gap: 8 }}>
              {!items.length ? <Text style={{ color: C.sec, fontSize: 14 }}>The audio is recording. {'\n'}Optional: type or dictate key lines below (tap the keyboard’s mic), and they’ll be timestamped. The full transcript is made when you save, if transcription is set up on your server.</Text> : null}
              {items.map((it, i) => it.k === 'm'
                ? <View key={'m' + i} style={{ flexDirection: 'row', gap: 6, backgroundColor: C.hiSoft, padding: 6, borderRadius: 8, alignItems: 'center' }}><Ionicons name="star" size={14} color={C.hiInk} /><Text style={{ color: C.hiInk, fontWeight: '600', fontSize: 13 }}>Bookmarked · {fmtT(it.t)}</Text></View>
                : it.k === 'sl'
                  ? <View key={'sl' + i} style={{ flexDirection: 'row', gap: 6, padding: 8, borderRadius: 8, borderWidth: 0.5, borderColor: C.sep }}><Ionicons name="image-outline" size={16} color={C.sec} /><Text style={{ flex: 1, fontSize: 13, color: C.ink }}>{fmtT(it.sl.t)} · {it.sl.text}</Text></View>
                  : <View key={'s' + i} style={{ flexDirection: 'row', gap: 10 }}><Text style={[{ color: C.sec, fontSize: 12, width: 40 }, mono]}>{fmtT(it.g.t)}</Text><Text style={{ flex: 1, fontSize: 15, color: C.ink }}><Text style={{ fontWeight: '700', color: it.g.s === 'P' ? C.accent : it.g.s === 'S' ? C.blue : C.orange }}>{({ P: 'PROF', S: 'STUDENT', G: 'GUEST' })[it.g.s]}  </Text>{it.g.x}</Text></View>)}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 6, padding: 8, borderTopWidth: 0.5, borderTopColor: C.sep, alignItems: 'center' }}>
              <Pressable onPress={() => setSpk(spk === 'P' ? 'S' : spk === 'S' ? 'G' : 'P')} accessibilityLabel="Change speaker" style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: C.fill }}><Text style={{ fontWeight: '700', fontSize: 12, color: C.ink }}>{({ P: 'PROF', S: 'STUDENT', G: 'GUEST' })[spk]}</Text></Pressable>
              <TextInput value={line} onChangeText={(v) => { if (lineStart == null && v.trim()) setLineStart(now()); setLine(v); }} onSubmitEditing={addLine} returnKeyType="done" blurOnSubmit={false} placeholder="Type or dictate a line" placeholderTextColor={C.faint} style={{ flex: 1, fontSize: 16, paddingVertical: 8, color: C.ink }} />
              <Pressable onPress={addLine} accessibilityLabel="Add line"><Ionicons name="arrow-up-circle" size={30} color={C.accent} /></Pressable>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, margin: 16, marginBottom: 8, backgroundColor: C.cell, borderRadius: 14, padding: 12, gap: 8 }}>
            <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Your own notes. They’re saved to Notes, linked to this lecture." placeholderTextColor={C.faint} style={{ flex: 1, fontSize: 16, color: C.ink, textAlignVertical: 'top' }} />
            <Btn title="Insert timestamp" kind="secondary" icon="time-outline" small onPress={insertStamp} />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
