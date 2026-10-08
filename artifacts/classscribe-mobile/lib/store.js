// App-wide data: profile, courses, lectures, assignments, notes, weak-area stats.
// Reads/writes the ClassScribe server; keeps an offline copy on the phone.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Appearance, Platform, useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { Directory, File, Paths } from 'expo-file-system';
import { aiJSON, checkLibrary, db, errMsg, finishRecordingReservation, getBillingStatus, getUid, health, initApi, libPath, newSyncCode, rotateSyncCode, setServer as apiSetServer, setUid as apiSetUid, transcribe } from './api';
import { rotateWithRecovery } from './rotation';
import { analysisPrompt, cleanAnalysis, hasContent, lectureNotesText } from './logic';
import { EXAMPLE_MEETINGS } from './schedule';
import { buildExamples, EX_NOTES } from './examples';
import {
  applySyncedRecords, collectPendingRecords, isReplacedSyncCodeError, libraryCacheKey,
  libraryDeletesKey, libraryPendingProfileKey, libraryProfileKey, mergeRemoteRecords, syncPendingRecords,
} from './store-sync';
import { setActiveTheme } from './theme';
import { isCreditsRequired, refreshCreditsAfterAction } from './credits-actions';
import { getPrivacyConsentReceipt, removeLectureConsents } from './privacy';
import { libraryAudioDirectory, removeDurableLectureAudio, scopeLinkedLectureAudio } from './lecture-media';
import appearanceTokens from './appearance-tokens.json';
import { createNoteSaver } from './note-saving';

const COLS = ['courses', 'lectures', 'assignments', 'notes', 'stats'];
const legacyProfileMigratedKey = (uid) => `cs_profile_migrated_v2_${uid}`;
const pendingRecordingFinishesKey = (uid) => `cs_pending_recording_finishes_v1_${uid}`;
const audioScopesKey = (uid) => `cs_audio_previous_scopes_${uid}`;
const Ctx = createContext(null);
const ThemeCtx = createContext('light');
const empty = () => ({ courses: {}, lectures: {}, assignments: {}, notes: {}, stats: {} });
const validAppearance = (value) => ['auto', 'light', 'dark'].includes(value) ? value : 'auto';
function makeExamples() {
  const e = buildExamples();
  Object.entries(EXAMPLE_MEETINGS).forEach(([id, m]) => { if (e.courses[id]) e.courses[id].meetings = m; });
  return { ...e, notes: EX_NOTES(), stats: {} };
}
async function readPendingRecordingFinishes(uid) {
  const raw = await AsyncStorage.getItem(pendingRecordingFinishesKey(uid));
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Saved recording confirmations could not be read.');
  return parsed.filter((item) => item && typeof item.recordingId === 'string' && item.recordingId && item.lecture && item.lecture.id === item.recordingId);
}
async function writePendingRecordingFinishes(uid, pending) {
  const key = pendingRecordingFinishesKey(uid);
  if (pending.length) await AsyncStorage.setItem(key, JSON.stringify(pending));
  else await AsyncStorage.removeItem(key);
}

export function StoreProvider({ children }) {
  const nativeColorScheme = useColorScheme();
  const [webColorScheme, setWebColorScheme] = useState(() =>
    Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setWebColorScheme(media.matches ? 'dark' : 'light');
    update();
    if (media.addEventListener) {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);
  const systemColorScheme = Platform.OS === 'web' ? webColorScheme : nativeColorScheme;
  const [mine, setMine] = useState(empty);
  const [ex, setEx] = useState(makeExamples);
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = none yet
  const [appearanceChoice, setAppearanceChoiceState] = useState('auto');
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [showEx, setShowExState] = useState(false);
  const [status, setStatus] = useState({ server: '', uid: '', online: false, loading: true, error: '', syncCodeReplaced: false });
  const [jobs, setJobs] = useState({}); // lectureId → { text, error }
  const mineRef = useRef(mine);
  const writes = useRef(new Set());
  const cacheWrites = useRef(new Map());
  const noteSaver = useRef(null);
  const failedWrites = useRef(new Map());
  const failedDeletes = useRef(new Map());
  const profileRef = useRef(profile);
  const profilePending = useRef(new Map());
  const profileQueue = useRef(Promise.resolve());
  const profileFlushRef = useRef(() => Promise.resolve());
  const profilePullRef = useRef(() => Promise.resolve());
  const pendingFinishRetryRef = useRef(() => Promise.resolve());
  const pendingFinishRetryInFlight = useRef(false);
  const audioMigrationInFlight = useRef(false);
  const exRef = useRef(ex);
  const resolvedTheme = appearanceChoice === 'dark' ? 'dark' : appearanceChoice === 'light' ? 'light' : systemColorScheme === 'dark' ? 'dark' : 'light';
  setActiveTheme(resolvedTheme);
  useEffect(() => { mineRef.current = mine; exRef.current = ex; });
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => {
    if (appearanceReady && Platform.OS === 'web' && typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.colorScheme = resolvedTheme;
      document.documentElement.style.setProperty('--cs-tabbar-bg', appearanceTokens[resolvedTheme].card);
      document.documentElement.style.setProperty('--cs-tabbar-line', appearanceTokens[resolvedTheme].separator);
      if (!document.getElementById('cs-tabbar-appearance')) {
        const style = document.createElement('style');
        style.id = 'cs-tabbar-appearance';
        style.textContent = 'div:has(> [role="tablist"]) { background-color: var(--cs-tabbar-bg) !important; border-top-color: var(--cs-tabbar-line) !important; }';
        document.head.appendChild(style);
      }
    }
    if (appearanceReady && Platform.OS !== 'web' && typeof Appearance.setColorScheme === 'function') {
      Appearance.setColorScheme(appearanceChoice === 'auto' ? null : appearanceChoice);
    }
    if (appearanceReady && Platform.OS !== 'web') {
      SystemUI.setBackgroundColorAsync(appearanceTokens[resolvedTheme].phoneBg).catch(() => {});
    }
  }, [appearanceChoice, appearanceReady, resolvedTheme]);

  const saveCache = useCallback((m, uid = getUid(), confirm = false) => {
    const raw = JSON.stringify(m);
    // Serialize snapshots so a slow older write cannot replace a newer draft.
    const previous = cacheWrites.current.get(uid) || Promise.resolve();
    const save = previous.catch(() => {}).then(async () => {
      await AsyncStorage.setItem(libraryCacheKey(uid), raw);
      if (uid === getUid()) await AsyncStorage.setItem('cs_cache', raw).catch(() => {});
    });
    cacheWrites.current.set(uid, save);
    save.finally(() => { if (cacheWrites.current.get(uid) === save) cacheWrites.current.delete(uid); }).catch(() => {});
    return confirm ? save : save.catch(() => {});
  }, []);

  const refresh = useCallback(async (assertCurrent) => {
    const uid = getUid();
    const notesAtRefresh = { ...mineRef.current.notes };
    try {
      assertCurrent?.();
      await profilePullRef.current(assertCurrent);
      assertCurrent?.();
      await profileFlushRef.current().catch(() => {});
      const [results, deletesRaw] = await Promise.all([
        Promise.all(COLS.map((c) => db.list(`data/users/${uid}/lib/${c}`))),
        AsyncStorage.getItem(libraryDeletesKey(uid)),
      ]);
      if (uid !== getUid()) return false;
      assertCurrent?.();
      let pendingDeletes = {};
      try {
        const stored = JSON.parse(deletesRaw || '{}');
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) pendingDeletes = stored;
      } catch { /* keep syncing the rest of the library if a tombstone cache is damaged */ }
      const memoryDeletes = failedDeletes.current.get(uid) || {};
      for (const [col, ids] of Object.entries(memoryDeletes)) {
        pendingDeletes[col] = { ...(pendingDeletes[col] || {}), ...(ids || {}) };
      }
      const next = mergeRemoteRecords(COLS, results, mineRef.current, pendingDeletes);
      const pendingSync = await syncPendingRecords(COLS, next, (col, id, clean) =>
        col === 'notes' && noteSaver.current?.isBusy(uid, id)
          ? false : db.set(`data/users/${uid}/lib/${col}/${id}`, clean));
      const syncErrors = pendingSync.failed.map((item) => item.error);
      for (const [col, ids] of Object.entries(pendingDeletes)) {
        for (const id of Object.keys(ids || {})) {
          try {
            await db.del(`data/users/${uid}/lib/${col}/${id}`);
            delete pendingDeletes[col][id];
          } catch (e) {
            syncErrors.push(e);
            /* retry the delete on a later refresh without reviving its remote copy */
          }
        }
      }
      const hasDeletes = Object.values(pendingDeletes).some((ids) => Object.keys(ids || {}).length);
      if (hasDeletes) {
        failedDeletes.current.set(uid, pendingDeletes);
        await AsyncStorage.setItem(libraryDeletesKey(uid), JSON.stringify(pendingDeletes));
      } else {
        failedDeletes.current.delete(uid);
        await AsyncStorage.removeItem(libraryDeletesKey(uid));
      }
      const synced = applySyncedRecords(next, pendingSync.written);
      if (uid !== getUid()) return false;
      assertCurrent?.();
      // Preserve note edits/acknowledgements made while refresh was in flight.
      for (const [id, note] of Object.entries(mineRef.current.notes)) {
        if (note !== notesAtRefresh[id]) synced.notes[id] = note;
      }
      mineRef.current = synced;
      setMine(synced);
      saveCache(synced, uid);
      const writeError = syncErrors[0];
      const revoked = syncErrors.some((error) => isReplacedSyncCodeError(error));
      setStatus((s) => ({
        ...s,
        online: !revoked,
        error: writeError?.message || '',
        syncCodeReplaced: s.syncCodeReplaced || revoked,
      }));
      await pendingFinishRetryRef.current().catch(() => {});
      assertCurrent?.();
      return true;
    } catch (e) {
      assertCurrent?.();
      if (uid !== getUid()) return false;
      const replaced = isReplacedSyncCodeError(e);
      setStatus((s) => ({
        ...s,
        online: false,
        error: e.message || '',
        syncCodeReplaced: s.syncCodeReplaced || replaced,
      }));
      return false;
    }
  }, [saveCache]);

  const loadProfile = useCallback(async (assertCurrent) => {
    const uid = getUid();
    assertCurrent?.();
    try {
      const migrated = await AsyncStorage.getItem(legacyProfileMigratedKey(uid));
      if (migrated !== '1') {
        const [scoped, legacyRaw, legacyPending, scopedPendingRaw] = await Promise.all([
          AsyncStorage.getItem(libraryProfileKey(uid)),
          AsyncStorage.getItem('cs_profile'),
          AsyncStorage.getItem('cs_profile_pending'),
          AsyncStorage.getItem(libraryPendingProfileKey(uid)),
        ]);
        const legacy = JSON.parse(legacyRaw || 'null');
        let cached = JSON.parse(scoped || 'null');
        if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
          cached = { ...legacy, ...(cached || {}) };
          await AsyncStorage.setItem(libraryProfileKey(uid), JSON.stringify(cached));
          if (legacyPending === '1') {
            const scopedPending = JSON.parse(scopedPendingRaw || '{}');
            const patch = { ...legacy, ...(scopedPending && typeof scopedPending === 'object' && !Array.isArray(scopedPending) ? scopedPending : {}) };
            await AsyncStorage.setItem(libraryPendingProfileKey(uid), JSON.stringify(patch));
          }
        }
        await AsyncStorage.setItem(legacyProfileMigratedKey(uid), '1');
        await AsyncStorage.multiRemove(['cs_profile', 'cs_profile_pending']);
      }
    } catch { /* leave legacy data available to retry migration next time */ }
    let p = null;
    try { p = await db.get(`data/users/${uid}/profile`); } catch { /* offline */ }
    if (!p) { try { p = JSON.parse((await AsyncStorage.getItem(libraryProfileKey(uid))) || 'null'); } catch { p = null; } }
    try {
      const pending = JSON.parse((await AsyncStorage.getItem(libraryPendingProfileKey(uid))) || '{}');
      if (pending && typeof pending === 'object' && !Array.isArray(pending)) {
        profilePending.current.set(uid, { ...pending, ...(profilePending.current.get(uid) || {}) });
      }
    } catch { /* keep the in-memory pending patch */ }
    if (uid !== getUid()) return null;
    const merged = { ...(p || {}), ...(profilePending.current.get(uid) || {}) };
    let legacyHidden = false;
    try { legacyHidden = (await AsyncStorage.getItem('cs_hideEx')) === '1'; } catch { /* profile preference remains authoritative */ }
    if (uid !== getUid()) return null;
    if (legacyHidden && typeof merged.showExamples !== 'boolean') {
      const updated = Date.now();
      const patch = { showExamples: false, showExamplesUpdated: updated, updated };
      const pending = { ...(profilePending.current.get(uid) || {}), ...patch };
      profilePending.current.set(uid, pending);
      Object.assign(merged, patch);
      await AsyncStorage.setItem(libraryPendingProfileKey(uid), JSON.stringify(pending)).catch(() => {});
    }
    if (uid !== getUid()) return null;
    assertCurrent?.();
    const next = p || Object.keys(merged).length ? merged : null;
    profileRef.current = next;
    setProfile(next);
    setShowExState(typeof merged.showExamples === 'boolean' ? merged.showExamples : !legacyHidden);
    if (typeof merged.showExamples === 'boolean') await AsyncStorage.removeItem('cs_hideEx').catch(() => {});
    setAppearanceChoiceState(validAppearance(next && next.appearance));
    if (next) await AsyncStorage.setItem(libraryProfileKey(uid), JSON.stringify(next)).catch(() => {});
    return next;
  }, []);

  const persistProfilePatch = useCallback((uid, patch) => {
    const pending = { ...(profilePending.current.get(uid) || {}), ...patch };
    profilePending.current.set(uid, pending);
    return AsyncStorage.setItem(libraryPendingProfileKey(uid), JSON.stringify(pending));
  }, []);

  const flushProfilePatches = useCallback((uid = getUid()) => {
    const run = async () => {
      while (uid === getUid()) {
        const pending = profilePending.current.get(uid);
        if (!pending || !Object.keys(pending).length) return;
        const batch = { ...pending };
        await db.update(`data/users/${uid}/profile`, batch);
        // A library switch may happen during the request. Keep this library's
        // pending patch intact for its next activation instead of applying it
        // to the newly selected profile/cache.
        if (uid !== getUid()) return;
        const latest = profilePending.current.get(uid) || {};
        Object.keys(batch).forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(latest, key) && JSON.stringify(latest[key]) === JSON.stringify(batch[key])) delete latest[key];
        });
        if (Object.keys(latest).length) profilePending.current.set(uid, latest);
        else profilePending.current.delete(uid);
        await AsyncStorage.setItem(libraryPendingProfileKey(uid), JSON.stringify(latest));
        if (uid !== getUid()) return;
        const merged = { ...(profileRef.current || {}) };
        Object.keys(batch).forEach((key) => {
          if (!Object.prototype.hasOwnProperty.call(latest, key)) merged[key] = batch[key];
        });
        profileRef.current = merged;
        setProfile(merged);
        await AsyncStorage.setItem(libraryProfileKey(uid), JSON.stringify(merged));
      }
    };
    const task = profileQueue.current.catch(() => {}).then(run);
    const tracked = task.catch((e) => {
      if (uid === getUid()) {
        const replaced = isReplacedSyncCodeError(e);
        setStatus((s) => ({
          ...s,
          online: replaced ? false : s.online,
          error: e.message || s.error,
          syncCodeReplaced: s.syncCodeReplaced || replaced,
        }));
      }
      throw e;
    });
    profileQueue.current = tracked.catch(() => {});
    return tracked;
  }, []);

  const queueProfilePatch = useCallback(async (patch) => {
    const uid = getUid();
    const cleanPatch = { ...patch, updated: Date.now() };
    const merged = { ...(profileRef.current || {}), ...cleanPatch };
    profileRef.current = merged;
    setProfile(merged);
    if (Object.prototype.hasOwnProperty.call(cleanPatch, 'appearance')) setAppearanceChoiceState(validAppearance(merged.appearance));
    const pendingWrite = persistProfilePatch(uid, cleanPatch);
    await AsyncStorage.setItem(libraryProfileKey(uid), JSON.stringify(merged));
    await pendingWrite;
    return flushProfilePatches(uid);
  }, [flushProfilePatches, persistProfilePatch]);
  useEffect(() => { profileFlushRef.current = () => flushProfilePatches(); }, [flushProfilePatches]);
  useEffect(() => { profilePullRef.current = (assertCurrent) => loadProfile(assertCurrent); }, [loadProfile]);

  useEffect(() => {
    (async () => {
      // Apply the last selected mode from this library's scoped cache before
      // mounting screens, so cold starts don't briefly paint the wrong theme.
      try {
        const savedUid = await AsyncStorage.getItem('cs_uid');
        if (savedUid) {
          const cached = JSON.parse((await AsyncStorage.getItem(libraryProfileKey(savedUid))) || 'null');
          const choice = validAppearance(cached && cached.appearance);
          setAppearanceChoiceState(choice);
          if (Platform.OS !== 'web' && typeof Appearance.setColorScheme === 'function') {
            Appearance.setColorScheme(choice === 'auto' ? null : choice);
          }
          if (Platform.OS !== 'web') {
            const mode = choice === 'auto' ? (systemColorScheme === 'dark' ? 'dark' : 'light') : choice;
            await SystemUI.setBackgroundColorAsync(appearanceTokens[mode].phoneBg).catch(() => {});
          }
        }
      } catch { /* use Automatic until a profile copy is available */ }
      setAppearanceReady(true);
      const { server, uid } = await initApi();
      try {
        const scoped = await AsyncStorage.getItem(libraryCacheKey(uid));
        const c = JSON.parse(scoped || (await AsyncStorage.getItem('cs_cache')) || 'null');
        if (c) { const cached = { ...empty(), ...c }; mineRef.current = cached; setMine(cached); }
      } catch { /* ignore */ }
      setStatus((s) => ({ ...s, server, uid }));
      await loadProfile();
      if (server) await refresh();
      setStatus((s) => ({ ...s, loading: false }));
    })();
  }, [loadProfile, refresh]);

  // Saves on the phone immediately; syncs to the server in the background (retried on next refresh if offline).
  const isExampleRecord = useCallback((col, obj) => {
    if (!obj) return false;
    if (obj.ex || exRef.current[col]?.[obj.id]) return true;
    const courseId = col === 'courses' ? obj.id : col === 'stats' ? obj.id : obj.courseId;
    if (courseId && exRef.current.courses[courseId]?.ex) return true;
    return !!(obj.lectureId && exRef.current.lectures[obj.lectureId]?.ex);
  }, []);

  const saveNote = useCallback((obj, onLocalSaved, libraryCode = getUid()) => {
    if (isExampleRecord('notes', obj)) return Promise.resolve({ localSaved: false, synced: false, error: new Error('Example notes are read-only.') });
    if (libraryCode === getUid()) failedWrites.current.delete(`notes:${obj.id}`);
    if (!noteSaver.current) noteSaver.current = createNoteSaver({
      getLibrary: getUid,
      getRecord: (id) => mineRef.current.notes[id],
      applyRecord: (record) => {
        const next = { ...mineRef.current, notes: { ...mineRef.current.notes, [record.id]: record } };
        mineRef.current = next;
        setMine(next);
      },
      persistLocal: (uid) => saveCache(mineRef.current, uid, true),
      writeRemote: (uid, record) => db.set(`data/users/${uid}/lib/notes/${record.id}`, record),
    });
    const write = noteSaver.current.save(obj, { libraryCode, onLocalSaved });
    writes.current.add(write);
    write.finally(() => writes.current.delete(write)).catch(() => {});
    return write;
  }, [isExampleRecord, saveCache]);

  const put = useCallback(async (col, obj) => {
    // Examples are display-only. Resolve by both record ID and parent course so
    // callers cannot make a writable copy by clearing its `ex` flag.
    if (isExampleRecord(col, obj)) return obj;
    if (col === 'notes') { await saveNote(obj); return; }
    const uid = getUid();
    setMine((m) => { const n = { ...m, [col]: { ...m[col], [obj.id]: obj } }; saveCache(n, uid); return n; });
    const key = `${col}:${obj.id}`;
    const write = db.set(`data/users/${uid}/lib/${col}/${obj.id}`, obj).then(() => {
      failedWrites.current.delete(key);
    }).catch((e) => {
      failedWrites.current.set(key, { col, obj });
      const pending = { ...obj, _pending: true };
      setMine((m) => { const n = { ...m, [col]: { ...m[col], [obj.id]: pending } }; saveCache(n, uid); return n; });
      if (uid === getUid()) {
        const replaced = isReplacedSyncCodeError(e);
        setStatus((s) => ({
          ...s,
          online: replaced ? false : s.online,
          error: e.message || s.error,
          syncCodeReplaced: s.syncCodeReplaced || replaced,
        }));
      }
    });
    writes.current.add(write);
    write.finally(() => writes.current.delete(write));
  }, [isExampleRecord, saveCache, saveNote]);

  const saveRecordingFinishIntent = useCallback(async (lecture) => {
    const uid = getUid();
    if (!lecture || typeof lecture.id !== 'string' || !lecture.id) throw new Error('A saved lecture ID is required before confirming its recording.');
    const pending = await readPendingRecordingFinishes(uid);
    const nextPending = [...pending.filter((item) => item.recordingId !== lecture.id), { recordingId: lecture.id, lecture }];
    await writePendingRecordingFinishes(uid, nextPending);

    const next = { ...mineRef.current, lectures: { ...mineRef.current.lectures, [lecture.id]: lecture } };
    mineRef.current = next;
    setMine(next);
    const raw = JSON.stringify(next);
    await AsyncStorage.setItem(libraryCacheKey(uid), raw);
    if (uid === getUid()) await AsyncStorage.setItem('cs_cache', raw);
    await put('lectures', lecture);
    return lecture.id;
  }, [put]);

  const clearRecordingFinishIntent = useCallback(async (recordingId) => {
    const uid = getUid();
    const pending = await readPendingRecordingFinishes(uid);
    await writePendingRecordingFinishes(uid, pending.filter((item) => item.recordingId !== recordingId));
  }, []);

  const audioRecoveryScopes = useCallback(async (uid = getUid()) => {
    const current = (await libraryAudioDirectory(uid)).uri;
    const root = new Directory(Paths.document, 'lectures', 'by-library').uri.replace(/\/+$/, '') + '/';
    const saved = JSON.parse((await AsyncStorage.getItem(audioScopesKey(uid))) || '[]');
    if (!Array.isArray(saved)) throw new Error('Recording scope history could not be read.');
    // A damaged local preference must never turn a recovery scan into an
    // arbitrary filesystem traversal.
    const previous = saved.filter((uri) => typeof uri === 'string'
      && uri.startsWith(root) && /^[a-f0-9]{64}\/?$/.test(uri.slice(root.length)));
    return [...new Set([current, ...previous])];
  }, []);

  const migrateLinkedAudio = useCallback(async () => {
    if (Platform.OS === 'web' || audioMigrationInFlight.current) return;
    const uid = getUid();
    if (!uid) return;
    audioMigrationInFlight.current = true;
    try {
      const previousScopes = (await audioRecoveryScopes(uid)).slice(1);
      for (const lecture of Object.values(mineRef.current.lectures)) {
        if (uid !== getUid()) break;
        const scoped = await scopeLinkedLectureAudio(lecture, uid, previousScopes);
        if (uid !== getUid()) break;
        if (scoped === lecture) continue;
        // Update the durable confirmation intent before the server write. A
        // crash or offline session can then retry with the copied URI.
        const pending = await readPendingRecordingFinishes(uid);
        await writePendingRecordingFinishes(uid, pending.map((item) =>
          item.recordingId === lecture.id ? { ...item, lecture: scoped } : item));
        if (uid !== getUid()) break;
        await put('lectures', scoped);
      }
    } catch {
      // Keep old references and audio intact. A later activation retries.
    } finally { audioMigrationInFlight.current = false; }
  }, [put, audioRecoveryScopes]);

  useEffect(() => {
    if (status.uid && !status.loading) migrateLinkedAudio();
  }, [status.uid, status.loading, mine, migrateLinkedAudio]);

  const retryPendingRecordingFinishes = useCallback(async () => {
    if (pendingFinishRetryInFlight.current) return;
    const uid = getUid();
    pendingFinishRetryInFlight.current = true;
    let attempted = false;
    try {
      const pending = await readPendingRecordingFinishes(uid);
      for (const item of pending) {
        if (uid !== getUid()) return;
        const { recordingId, lecture } = item;
        attempted = true;
        const current = mineRef.current;
        const savedLecture = current.lectures[recordingId]?.audioUri ? current.lectures[recordingId] : lecture;
        if (Platform.OS !== 'web' && (!savedLecture.audioUri || !new File(savedLecture.audioUri).exists)) continue;
        const next = { ...current, lectures: { ...current.lectures, [recordingId]: savedLecture } };
        mineRef.current = next;
        setMine(next);
        const raw = JSON.stringify(next);
        await AsyncStorage.setItem(libraryCacheKey(uid), raw);
        if (uid === getUid()) await AsyncStorage.setItem('cs_cache', raw);
        await put('lectures', savedLecture);
        try {
          await finishRecordingReservation(recordingId);
          if (uid !== getUid()) return;
          const remaining = await readPendingRecordingFinishes(uid);
          await writePendingRecordingFinishes(uid, remaining.filter((entry) => entry.recordingId !== recordingId));
        } catch {
          // Keep the intent (and its lecture/audio URI) for the next retry.
        }
      }
    } catch {
      // A damaged or temporarily unavailable local queue must not discard its reservation.
    } finally {
      if (attempted && uid === getUid()) await getBillingStatus(uid).catch(() => {});
      pendingFinishRetryInFlight.current = false;
    }
  }, [put]);

  useEffect(() => {
    pendingFinishRetryRef.current = retryPendingRecordingFinishes;
    return () => { pendingFinishRetryRef.current = () => Promise.resolve(); };
  }, [retryPendingRecordingFinishes]);

  useEffect(() => {
    if (status.uid && !status.loading) retryPendingRecordingFinishes();
  }, [status.uid, status.loading, retryPendingRecordingFinishes]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') retryPendingRecordingFinishes();
    });
    return () => subscription.remove();
  }, [retryPendingRecordingFinishes]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') retryPendingRecordingFinishes();
    }, 30000);
    return () => clearInterval(timer);
  }, [retryPendingRecordingFinishes]);

  const putCourse = useCallback(async (obj) => {
    if (isExampleRecord('courses', obj)) throw new Error('Example courses cannot be saved as library courses.');
    const uid = getUid();
    const key = `courses:${obj.id}`;
    const clean = { ...obj };
    delete clean._pending;
    try {
      await db.set(`data/users/${uid}/lib/courses/${obj.id}`, clean);
    } catch (error) {
      if (uid !== getUid()) throw { code: 'library_changed', message: 'The active library changed while this course was saving. Reopen the original library to check its status.' };
      if (error?.code === 'plan_limit') {
        failedWrites.current.delete(key);
        setMine((m) => {
          if (!m.courses[obj.id]?._pending) return m;
          const courses = { ...m.courses };
          delete courses[obj.id];
          const n = { ...m, courses };
          saveCache(n);
          return n;
        });
        throw error;
      }
      if (['no_server', 'offline', 'timeout', 'unavailable'].includes(error?.code)) {
        // Keep an offline copy for later sync without making a second server
        // request that could conceal a plan_limit response.
        const pending = { ...clean, _pending: true };
        failedWrites.current.set(key, { col: 'courses', obj: pending });
        setMine((m) => {
          const n = { ...m, courses: { ...m.courses, [pending.id]: pending } };
          saveCache(n);
          return n;
        });
        throw {
          code: 'offline_pending',
          message: 'The server could not confirm this course. A copy is saved on this device and will sync when you are online; retry to confirm it.',
        };
      }
      throw error;
    }
    if (uid !== getUid()) throw { code: 'library_changed', message: 'The active library changed while this course was saving. Reopen the original library to check its status.' };
    failedWrites.current.delete(key);
    setMine((m) => {
      const n = { ...m, courses: { ...m.courses, [clean.id]: clean } };
      saveCache(n);
      return n;
    });
    return clean;
  }, [isExampleRecord, saveCache]);

  const del = useCallback(async (col, id) => {
    const existing = mineRef.current[col]?.[id] || exRef.current[col]?.[id] || (col === 'courses' ? { id } : col === 'stats' ? { id } : null);
    if (isExampleRecord(col, existing)) return;
    const uid = getUid();
    if (col === 'lectures') await removeLectureConsents(uid, id).catch(() => {});
    setMine((m) => { const c = { ...m[col] }; delete c[id]; const n = { ...m, [col]: c }; saveCache(n, uid); return n; });
    try { await db.del(`data/users/${uid}/lib/${col}/${id}`); }
    catch (e) {
      const pending = failedDeletes.current.get(uid) || {};
      pending[col] = { ...(pending[col] || {}), [id]: true };
      failedDeletes.current.set(uid, pending);
      try {
        const key = libraryDeletesKey(uid);
        const stored = JSON.parse((await AsyncStorage.getItem(key)) || '{}');
        const saved = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
        saved[col] = { ...(saved[col] || {}), [id]: true };
        await AsyncStorage.setItem(key, JSON.stringify(saved));
      } catch { /* the in-memory tombstone remains available for recovery during this session */ }
      if (uid === getUid()) {
        const replaced = isReplacedSyncCodeError(e);
        setStatus((s) => ({ ...s, online: replaced ? false : s.online, error: e.message || s.error, syncCodeReplaced: s.syncCodeReplaced || replaced }));
      }
    }
  }, [isExampleRecord, saveCache]);

  const saveProfile = useCallback(async (patch) => {
    // Account and welcome edits must not choose preferences implicitly.
    const { homeLayout, appearance, showExamples, showExamplesUpdated, ...profileFields } = patch;
    return queueProfilePatch(profileFields);
  }, [queueProfilePatch]);
  const saveHomeLayoutChoice = useCallback(async (layout) => {
    const choice = ['class-first', 'study-first', 'simple'].includes(layout) ? layout : 'class-first';
    return queueProfilePatch({ homeLayout: choice });
  }, [queueProfilePatch]);
  const setAppearanceChoice = useCallback(async (value) => {
    const choice = validAppearance(value);
    setAppearanceChoiceState(choice);
    return queueProfilePatch({ appearance: choice });
  }, [queueProfilePatch]);

  const setServer = useCallback(async (url, { refreshData = true } = {}) => {
    const s = await apiSetServer(url);
    setStatus((st) => ({ ...st, server: s }));
    if (!refreshData) return true;
    await loadProfile();
    return refresh();
  }, [loadProfile, refresh]);

  const clearDeletedLibrary = useCallback(async (deletedUid) => {
    if (!deletedUid || deletedUid !== getUid()) throw new Error('The active library changed. Reopen Account before clearing local data.');
    await Promise.all([...writes.current, profileQueue.current]);
    if (deletedUid !== getUid()) throw new Error('The active library changed before its local data could be cleared.');
    const audioDirectory = await libraryAudioDirectory(deletedUid);
    if (audioDirectory.exists) audioDirectory.delete();
    await Promise.all(Object.values(mineRef.current.lectures || {}).map((lecture) => removeDurableLectureAudio(lecture.audioUri)));
    const keys = await AsyncStorage.getAllKeys();
    const scoped = keys.filter((key) => key.endsWith(`_${deletedUid}`));
    await AsyncStorage.multiRemove([...scoped, 'cs_cache', 'cs_profile', 'cs_profile_pending', 'cs_hideEx']);
    if (deletedUid !== getUid()) throw new Error('The active library changed before its local data could be cleared.');
    const nextUid = newSyncCode();
    await apiSetUid(nextUid);
    const cleared = empty();
    mineRef.current = cleared;
    profileRef.current = null;
    setMine(cleared);
    setProfile(null);
    setShowExState(false);
    setAppearanceChoiceState('auto');
    failedWrites.current.clear();
    failedDeletes.current.delete(deletedUid);
    profilePending.current.delete(deletedUid);
    setJobs({});
    setStatus((current) => ({ ...current, uid: nextUid, online: false, error: '', syncCodeReplaced: false }));
  }, []);

  const switchLibrary = useCallback(async (code, { assertCurrent } = {}) => {
    assertCurrent?.();
    // A pending code replacement may already have committed remotely. Keep
    // its durable recovery marker and finish that replacement before leaving.
    if (await AsyncStorage.getItem('cs_rotation')) return false;
    if (!await checkLibrary(code)) return false;
    assertCurrent?.();
    if (code === getUid()) return refresh(assertCurrent);
    const oldCode = getUid();
    const recovering = status.syncCodeReplaced;
    await Promise.all([...writes.current]);
    const oldProfile = profileRef.current;
    const oldMine = mineRef.current;
    const oldShowEx = showEx;
    const oldAppearance = validAppearance(oldProfile && oldProfile.appearance);
    const oldCache = await AsyncStorage.getItem('cs_cache');
    await AsyncStorage.setItem(libraryCacheKey(oldCode), JSON.stringify(oldMine));
    let pendingRecords = recovering ? collectPendingRecords(COLS, oldMine, failedWrites.current) : empty();
    let pendingDeletes = {};
    let pendingProfile = { ...(profilePending.current.get(oldCode) || {}) };
    if (recovering) {
      try {
        const stored = JSON.parse((await AsyncStorage.getItem(libraryDeletesKey(oldCode))) || '{}');
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) pendingDeletes = stored;
      } catch { /* keep any in-memory work recoverable */ }
      const oldMemoryDeletes = failedDeletes.current.get(oldCode) || {};
      Object.keys(oldMemoryDeletes).forEach((col) => {
        pendingDeletes[col] = { ...(pendingDeletes[col] || {}), ...(oldMemoryDeletes[col] || {}) };
      });
      try {
        const stored = JSON.parse((await AsyncStorage.getItem(libraryPendingProfileKey(oldCode))) || '{}');
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) pendingProfile = { ...pendingProfile, ...stored };
      } catch { /* keep any in-memory profile patch */ }
      if (await AsyncStorage.getItem('cs_profile_pending') === '1') {
        try {
          const legacy = JSON.parse((await AsyncStorage.getItem('cs_profile')) || 'null');
          if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) pendingProfile = { ...legacy, ...pendingProfile };
        } catch { /* ignore malformed legacy profile data */ }
      }
      try {
        const destinationCache = JSON.parse((await AsyncStorage.getItem(libraryCacheKey(code))) || 'null');
        if (destinationCache) {
          const destinationPending = collectPendingRecords(COLS, destinationCache);
          COLS.forEach((col) => Object.assign(pendingRecords[col], destinationPending[col]));
        }
        const destinationDeletes = JSON.parse((await AsyncStorage.getItem(libraryDeletesKey(code))) || '{}');
        if (destinationDeletes && typeof destinationDeletes === 'object' && !Array.isArray(destinationDeletes)) {
          Object.keys(destinationDeletes).forEach((col) => {
            pendingDeletes[col] = { ...(pendingDeletes[col] || {}), ...(destinationDeletes[col] || {}) };
          });
        }
        const destinationProfile = JSON.parse((await AsyncStorage.getItem(libraryPendingProfileKey(code))) || '{}');
        if (destinationProfile && typeof destinationProfile === 'object' && !Array.isArray(destinationProfile)) {
          pendingProfile = { ...pendingProfile, ...destinationProfile };
        }
      } catch { /* recovery still carries all readable local changes */ }
    }
    let switched = false;
    try {
      assertCurrent?.();
      await apiSetUid(code);
      switched = true;
      assertCurrent?.();
      if (recovering) {
        if (Object.keys(pendingProfile).length) {
          profilePending.current.set(code, pendingProfile);
          await AsyncStorage.setItem(libraryPendingProfileKey(code), JSON.stringify(pendingProfile));
        }
        if (Object.values(pendingDeletes).some((ids) => Object.keys(ids || {}).length)) {
          await AsyncStorage.setItem(libraryDeletesKey(code), JSON.stringify(pendingDeletes));
        }
      }
      await AsyncStorage.multiRemove(['cs_cache', 'cs_profile', 'cs_profile_pending']);
      assertCurrent?.();
      profileRef.current = null;
      setProfile(null);
      setShowExState(false);
      setAppearanceChoiceState('auto');
      mineRef.current = pendingRecords;
      setMine(pendingRecords);
      failedWrites.current.clear();
      setStatus((st) => ({ ...st, uid: code, syncCodeReplaced: false, error: '' }));
      await loadProfile(assertCurrent);
      assertCurrent?.();
      const loaded = await refresh(assertCurrent);
      assertCurrent?.();
      if (!loaded && !recovering) throw new Error('Could not load the library');
      return true;
    } catch (error) {
      let sessionValid = true;
      try { assertCurrent?.(); } catch { sessionValid = false; }
      if (recovering && switched && sessionValid) {
        setStatus((st) => ({ ...st, uid: code, online: false, syncCodeReplaced: false }));
        return true;
      }
      await apiSetUid(oldCode);
      if (oldCache) await AsyncStorage.setItem('cs_cache', oldCache);
      else await AsyncStorage.removeItem('cs_cache');
      profileRef.current = oldProfile;
      setProfile(oldProfile);
      setShowExState(oldShowEx);
      setAppearanceChoiceState(oldAppearance);
      mineRef.current = oldMine;
      setMine(oldMine);
      setStatus((st) => ({ ...st, uid: oldCode, online: false }));
      if (!sessionValid) throw error;
      return false;
    }
  }, [loadProfile, refresh, status.syncCodeReplaced, showEx]);

  const replaceSyncCode = useCallback(async () => {
    const nextCode = await rotateWithRecovery({
      storage: AsyncStorage, oldCode: getUid(), createCode: newSyncCode,
      rotate: rotateSyncCode, activate: async (nextCode) => {
        // A replacement is the same library, unlike a switch. Preserve its
        // prior scope authorization across restarts and interrupted retries.
        const oldCode = getUid();
        const oldScope = (await libraryAudioDirectory(oldCode)).uri;
        const oldScopes = JSON.parse((await AsyncStorage.getItem(audioScopesKey(oldCode))) || '[]');
        const nextScopes = JSON.parse((await AsyncStorage.getItem(audioScopesKey(nextCode))) || '[]');
        await AsyncStorage.setItem(audioScopesKey(nextCode),
          JSON.stringify([...new Set([...(Array.isArray(oldScopes) ? oldScopes : []),
            ...(Array.isArray(nextScopes) ? nextScopes : []), oldScope])]));
        await apiSetUid(nextCode);
      },
      uploadPending: async () => {
        // Do not strand offline notes on the old identity. A failed upload
        // keeps this device on its current code so the student can retry.
        await Promise.all([...writes.current]);
        await flushProfilePatches(getUid());
        if (await AsyncStorage.getItem('cs_profile_pending') === '1') {
          const localProfile = JSON.parse((await AsyncStorage.getItem('cs_profile')) || 'null');
          if (localProfile) {
            const legacyProfile = { ...localProfile };
            delete legacyProfile.homeLayout;
            delete legacyProfile.showExamples;
            delete legacyProfile.showExamplesUpdated;
            await db.update(`data/users/${getUid()}/profile`, legacyProfile);
            await db.set(`members/${getUid()}`, { name: [localProfile.firstName, localProfile.lastName].filter(Boolean).join(' '), school: localProfile.school || '', at: Date.now() });
            await AsyncStorage.removeItem('cs_profile_pending');
          }
        }
        const pendingItems = new Map(failedWrites.current);
        for (const col of COLS) for (const item of Object.values(mineRef.current[col])) {
          if (item._pending) pendingItems.set(`${col}:${item.id}`, { col, obj: item });
        }
        for (const [key, { col, obj }] of pendingItems) {
          const { _pending, ...clean } = obj;
          await db.set(libPath(col) + '/' + obj.id, clean);
          failedWrites.current.delete(key);
        }
        const deleteKey = libraryDeletesKey(getUid());
        const deleteRaw = await AsyncStorage.getItem(deleteKey);
        const pendingDeletes = JSON.parse(deleteRaw || '{}');
        const memoryDeletes = failedDeletes.current.get(getUid()) || {};
        Object.keys(memoryDeletes).forEach((col) => {
          pendingDeletes[col] = { ...(pendingDeletes[col] || {}), ...(memoryDeletes[col] || {}) };
        });
        for (const [col, ids] of Object.entries(pendingDeletes || {})) {
          for (const id of Object.keys(ids || {})) {
            await db.del(`data/users/${getUid()}/lib/${col}/${id}`);
            delete pendingDeletes[col][id];
          }
        }
        if (Object.values(pendingDeletes || {}).some((ids) => Object.keys(ids || {}).length)) {
          failedDeletes.current.set(getUid(), pendingDeletes);
          await AsyncStorage.setItem(deleteKey, JSON.stringify(pendingDeletes));
        } else {
          failedDeletes.current.delete(getUid());
          await AsyncStorage.removeItem(deleteKey);
        }
      },
    });
    failedWrites.current.clear();
    // Keep the offline copy: the documents moved, not deleted.
    setMine((m) => {
      const n = Object.fromEntries(COLS.map((col) => [col, Object.fromEntries(
        Object.entries(m[col]).map(([id, item]) => { const { _pending, ...clean } = item; return [id, clean]; }),
      )]));
      saveCache(n);
      return n;
    });
    setStatus((st) => ({ ...st, uid: nextCode, syncCodeReplaced: false, error: '' }));
    await loadProfile();
    await refresh();
    return nextCode;
  }, [loadProfile, refresh, saveCache, flushProfilePatches]);

  // After a recording is saved: transcribe it (if the server can) and analyze it (if AI is on), in the background.
  const processRecording = useCallback(async (lecture, uri, savedCourse, creditConfirmation = null) => {
    const requestLibrary = creditConfirmation?.libraryCode || getUid();
    const id = lecture.id;
    const setJob = (v) => setJobs((j) => { const n = { ...j }; if (v) n[id] = v; else delete n[id]; return n; });
    let l = lecture;
    let creditsRefreshWarning = '';
    let consentTranscriptionWarning = '';
    const course = savedCourse || mineRef.current.courses[l.courseId] || exRef.current.courses[l.courseId] || {};
    const info = await health();
    if (requestLibrary !== getUid()) return;
    if (!info) { setJob({ error: 'Saved on this phone. Transcription and key points will need the ClassScribe server; open the lecture later and choose Analyze.' }); return; }
    if (uri && info.transcribe) {
      const consentReceipt = await getPrivacyConsentReceipt(requestLibrary, l.id, l.courseId);
      if (!consentReceipt) {
        consentTranscriptionWarning = 'This recording has no matching saved consent receipt. Its audio was not uploaded.';
      } else {
        setJob({ text: 'Transcribing the recording…' });
        try {
          if (requestLibrary !== getUid()) throw new Error('The active library changed. Reopen this lecture before confirming Credits.');
          const r = await transcribe(uri, {
            timed: true,
            libraryCode: requestLibrary,
            recordingId: consentReceipt.sessionId,
            lectureId: consentReceipt.lectureId,
            courseId: consentReceipt.courseId,
            consentId: consentReceipt.consentId,
            sessionId: consentReceipt.sessionId,
            ...(creditConfirmation ? { useCredits: true, requestId: creditConfirmation.requestId } : {}),
          });
          if (requestLibrary !== getUid()) return;
          l = { ...l, segs: [...(r.segments || []).map((g) => ({ t: Number.isFinite(g.t) ? g.t : null, s: 'P', x: g.x })), ...(l.segs || [])].sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity)) };
          put('lectures', l);
          if (creditConfirmation) {
            try {
              const update = await refreshCreditsAfterAction(requestLibrary);
              creditsRefreshWarning = update.warning;
            } catch {
              creditsRefreshWarning = 'Transcription finished, but your Credits balance could not be refreshed yet.';
            }
          }
        } catch (e) {
          if (isCreditsRequired(e)) setJob({ error: 'Transcription needs Credits confirmation.', creditsRequired: { ...e, libraryCode: getUid() } });
          else setJob({ error: 'Recording saved, but transcription didn’t finish: ' + errMsg(e) });
          return;
        }
      }
    }
    const notesText = lectureNotesText(l, Object.values(mineRef.current.notes));
    if (info.ai && hasContent(l, notesText)) {
      if (requestLibrary !== getUid()) return;
      setJob({ text: 'Finding key points, terms and assignments…' });
      try {
        const an = cleanAnalysis(await aiJSON(analysisPrompt(l, course, notesText)));
        if (requestLibrary !== getUid()) return;
        l = { ...l, analysis: an }; put('lectures', l);
        an.assignments.forEach((x, i) => { if (x.title) put('assignments', { id: l.id + '-a' + i, courseId: l.courseId, title: x.title, type: x.type || 'homework', due: /^\d{4}-\d\d-\d\d$/.test(x.due || '') ? x.due : '', dueSource: 'ai', dateConfirmed: false, lectureId: l.id, t: x.t || 0, done: false, ex: !!l.ex }); });
      } catch (e) { setJob({ error: 'Recording saved. Key points didn’t finish: ' + errMsg(e) }); return; }
    } else if (!(l.segs || []).length && uri && !info.transcribe) {
      setJob({ error: 'Recording saved. Connect a transcription provider to get a transcript and key points.' }); return;
    }
    setJob(consentTranscriptionWarning ? { error: consentTranscriptionWarning } : creditsRefreshWarning ? { error: creditsRefreshWarning } : null);
  }, [put]);
  const clearJob = useCallback((id) => setJobs((j) => { const n = { ...j }; delete n[id]; return n; }), []);

  const setShowEx = useCallback(async (v) => {
    const choice = !!v;
    setShowExState(choice);
    if (choice) await AsyncStorage.removeItem('cs_hideEx').catch(() => {});
    const updated = Date.now();
    return queueProfilePatch({ showExamples: choice, showExamplesUpdated: updated });
  }, [queueProfilePatch]);

  const value = useMemo(() => {
    const all = (col) => (showEx ? { ...ex[col], ...mine[col] } : mine[col]);
    const courses = () => Object.values(all('courses')).sort((a, b) => (a.created || 0) - (b.created || 0));
    const course = (id) => mine.courses[id] || ex.courses[id];
    const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.created || 0) - (b.created || 0));
    const lecturesOf = (cid) => Object.values(all('lectures')).filter((l) => !cid || l.courseId === cid).sort(byDate);
    const lecture = (id) => mine.lectures[id] || ex.lectures[id];
    const assignmentsOf = (cid) => Object.values(all('assignments')).filter((a) => !cid || a.courseId === cid).sort((a, b) => ((a.due || '9') < (b.due || '9') ? -1 : 1));
    const notesOf = (cid) => Object.values(all('notes')).filter((n) => !cid || n.courseId === cid).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updated || 0) - (a.updated || 0));
    const note = (id) => mine.notes[id] || ex.notes[id];
    const statsOf = (cid) => mine.stats[cid] || ex.stats[cid] || { id: cid, concepts: {} };
    const isMineRecord = (col, obj) => !!(obj && mine[col]?.[obj.id] && !isExampleRecord(col, obj));
    const isMine = (l) => isMineRecord('lectures', l);
    const record = (cid, concept, ok) => {
      if (!cid || !concept) return;
      const st = JSON.parse(JSON.stringify(statsOf(cid)));
      st.id = cid; st.ex = !!(course(cid) || {}).ex; st.concepts = st.concepts || {};
      const k = String(concept).trim();
      const c = st.concepts[k] || { r: 0, w: 0 };
      if (ok) c.r++; else c.w++;
      c.last = Date.now(); st.concepts[k] = c;
      put('stats', st);
    };
    const markReviewed = (ids) => ids.forEach((id) => { const l = lecture(id); if (l && !l.reviewed) put('lectures', { ...l, reviewed: true }); });
    return { profile, saveProfile, saveHomeLayoutChoice, appearance: validAppearance(profile && profile.appearance != null ? profile.appearance : appearanceChoice), resolvedTheme, setAppearanceChoice, status, refresh, put, saveNote, putCourse, del, showEx, setShowEx, setServer, switchLibrary, replaceSyncCode, clearDeletedLibrary, jobs, processRecording, clearJob, audioRecoveryScopes, saveRecordingFinishIntent, clearRecordingFinishIntent, retryPendingRecordingFinishes, all, courses, course, lecturesOf, lecture, assignmentsOf, notesOf, note, statsOf, isMine, isMineRecord, record, markReviewed };
  }, [mine, ex, profile, appearanceChoice, resolvedTheme, showEx, status, jobs, put, saveNote, putCourse, del, refresh, saveProfile, saveHomeLayoutChoice, setAppearanceChoice, setServer, switchLibrary, replaceSyncCode, clearDeletedLibrary, setShowEx, processRecording, clearJob, audioRecoveryScopes, saveRecordingFinishIntent, clearRecordingFinishIntent, retryPendingRecordingFinishes, isExampleRecord]);

  return <ThemeCtx.Provider value={resolvedTheme}><Ctx.Provider value={value}>{appearanceReady ? children : null}</Ctx.Provider></ThemeCtx.Provider>;
}
export const useStore = () => useContext(Ctx);
export const useResolvedTheme = () => useContext(ThemeCtx);
