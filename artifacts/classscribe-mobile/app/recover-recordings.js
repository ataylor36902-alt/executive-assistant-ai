import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Alert } from '../lib/notify';
import { Directory, File, Paths } from 'expo-file-system';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useStore } from '../lib/store';
import { getUid } from '../lib/api';
import { isRecoveryAudio, unlinkedAudio } from '../lib/recovery-audio';
import { scopeLinkedLectureAudio } from '../lib/lecture-media';
import { hasRecordingOwnershipPath, markRecordingOwner, recordingCaptureDirectories, recoverableRootAudio } from '../lib/recording-ownership';
import { createRecoveryDeviceFixture } from '../test/recovery-device-fixture';
import { C } from '../lib/theme';
import { curSemester, uid } from '../lib/util';
import { Btn, Screen, Section, s } from '../components/ui';
import { RecordingConsentSheet } from '../components/RecordingConsentSheet';
import { getPrivacyConsentReceipt } from '../lib/privacy';

const PREVIEW_LOAD_TIMEOUT_MS = 15000;
const PREVIEW_ERROR = 'This recording cannot be previewed. It may be damaged or use an unsupported audio format. You can skip it and recover other recordings. The file will stay on this phone.';
const PREVIEW_TIMEOUT = 'This recording did not finish loading. It may be damaged or use an unsupported audio format. You can skip it and recover other recordings. The file will stay on this phone.';

function Preview({ uri, failed, onFailure, onClose }) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const loadError = !!status.error || ['error', 'failed'].includes(status.playbackState);
  useEffect(() => {
    if (loadError) onFailure(uri, PREVIEW_ERROR);
  }, [uri, loadError, onFailure]);
  useEffect(() => {
    if (status.isLoaded || loadError || failed) return;
    const timer = setTimeout(() => onFailure(uri, PREVIEW_TIMEOUT), PREVIEW_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [uri, status.isLoaded, loadError, failed, onFailure]);

  if (failed || loadError) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
      <Btn title={!status.isLoaded ? 'Loading audio…' : status.playing ? 'Pause' : 'Play'} kind="secondary" small
        disabled={!status.isLoaded}
        onPress={() => {
          try { status.playing ? player.pause() : player.play(); }
          catch { onFailure(uri, PREVIEW_ERROR); }
        }} />
      <Btn title="Close preview" kind="plain" small onPress={onClose} />
    </View>
  );
}

function localDate(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function RecoverRecordings() {
  const st = useStore();
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState({});
  const [titles, setTitles] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewErrors, setPreviewErrors] = useState({});
  const [courseId, setCourseId] = useState('');
  const [retryTranscription, setRetryTranscription] = useState(false);
  const [pendingConsent, setPendingConsent] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(0);
  const [transcriptionRequests, setTranscriptionRequests] = useState(0);
  const [fixtureName, setFixtureName] = useState('');
  const saving = useRef(false);
  const scanId = useRef(0);
  const scanAttempts = useRef(0);
  const lectures = st.all('lectures');
  const personalCourses = st.courses().filter((c) => !c.ex);
  const previewFailed = useCallback((uri, message) => {
    setPreviewErrors((old) => ({ ...old, [uri]: message }));
  }, []);

  function skipFile(uri) {
    setSelected((old) => ({ ...old, [uri]: false }));
    setFiles((old) => old.filter((f) => f.uri !== uri));
    setPreview((old) => old === uri ? null : old);
  }

  const scan = useCallback(async () => {
    if (Platform.OS === 'web') return;
    if (st.status.loading || !st.status.uid) {
      setScanResult(null);
      setError(st.status.loading
        ? 'Your library is still loading. Wait a moment, then scan again.'
        : 'Open your library first, then scan again. No recordings were changed.');
      return;
    }
    const library = st.status.uid;
    const request = ++scanId.current;
    const attempt = ++scanAttempts.current;
    setLoading(true);
    setError('');
    setScanResult(null);
    try {
      const scopes = await st.audioRecoveryScopes(library);
      const scopedDirectories = scopes.map((uri) => new Directory(uri));
      const legacy = new Directory(Paths.document, 'lectures');
      const audioFiles = (folder) => folder.exists ? folder.list().filter((f) => f instanceof File) : [];
      const scopedFiles = scopedDirectories.flatMap((scoped) => scoped.exists
        ? scoped.list().filter((entry) => entry instanceof Directory).flatMap(audioFiles)
        : []);
      const captureFiles = (path) => recordingCaptureDirectories(path).flatMap(audioFiles).filter((f) => isRecoveryAudio(f.name));
      const roots = await recoverableRootAudio(captureFiles(Paths.document), scopes);
      // Cache was never a legacy archive. Only explicitly owned cache audio is recoverable.
      const cached = Paths.cache ? await recoverableRootAudio(captureFiles(Paths.cache), scopes, { allowLegacy: false }) : [];
      const legacyFiles = legacy.exists
        ? [...audioFiles(legacy), ...legacy.list().filter((entry) => entry instanceof Directory && entry.name !== 'by-library').flatMap(audioFiles)]
        : [];
      const entries = [
        ...scopedFiles.map((f) => ({ file: f, legacy: false })),
        ...legacyFiles.map((f) => ({ file: f, legacy: true })),
        ...roots, ...cached,
      ].map(({ file: f, legacy: ownerless }) => ({
        uri: f.uri, name: f.name, size: f.size, modified: f.modificationTime || f.creationTime || null, ownerless,
      }));
      if (request !== scanId.current || getUid() !== library) return;
      const recoverable = unlinkedAudio(entries, Object.values(lectures));
      const audioCount = entries.filter((f) => isRecoveryAudio(f.name) && f.size > 0).length;
      setFiles(recoverable);
      setScanResult({ attempt, completedAt: new Date().toLocaleTimeString(), audioCount, recoverableCount: recoverable.length });
      setSelected({});
      setPreview(null);
      setPreviewErrors({});
    } catch (e) {
      if (request === scanId.current) setError(`Could not check this phone’s recordings: ${e.message || 'storage is unavailable'}`);
    } finally { if (request === scanId.current) setLoading(false); }
  }, [st.status.loading, st.status.uid, lectures]);

  // Scan only on entry / library change, not on every store update after a save.
  useEffect(() => {
    scanId.current++;
    scanAttempts.current = 0;
    setScanResult(null); setLoading(false); setError('');
    setFiles([]); setSelected({}); setPreview(null); setPreviewErrors({}); setDone(0);
    scan();
    return () => { scanId.current++; };
  }, [st.status.loading, st.status.uid]);

  async function restore() {
    if (saving.current) return;
    const chosen = files.filter((f) => selected[f.uri]);
    if (!chosen.length) return;
    const library = st.status.uid;
    saving.current = true;
    setLoading(true);
    setError('');
    setPreview(null);
    let restored = 0;
    const consentNeeded = [];
    try {
      const scopes = await st.audioRecoveryScopes(library);
      const previousScopes = scopes.slice(1);
      if (library !== getUid()) throw new Error('The library changed. Scan again before restoring.');
      let target = personalCourses.find((c) => c.id === courseId)
        || personalCourses.find((c) => c.code === 'RECOVERED' && c.name === 'Recovered recordings');
      for (const f of chosen) {
        if (library !== getUid()) throw new Error('The library changed. Scan again before restoring.');
        const audio = new File(f.uri);
        if (!audio.exists || !audio.size) {
          setError(`Skipped ${f.name}: the file is no longer available. Other selected files were still restored.`);
          continue;
        }
        if (hasRecordingOwnershipPath(f.uri)) {
          const allowed = await recoverableRootAudio([audio], scopes, { allowLegacy: f.ownerless });
          if (!allowed.length) throw new Error('This recording is no longer available to this library. Scan again.');
          // Manual selection claims legacy root audio before retaining a recovery copy.
          // Preserve metadata alongside the retained source; never delete or upload it.
          // Authorized sync-code replacement may retain the old owner hash.
          if (allowed[0].legacy) await markRecordingOwner(f.uri, library);
        }
        if (library !== getUid()) throw new Error('The library changed. Scan again before restoring.');
        if (!target) {
          target = { id: uid(), code: 'RECOVERED', name: 'Recovered recordings', professor: '',
            semester: (st.profile && st.profile.term) || curSemester(), color: personalCourses.length % 6, created: Date.now(), ex: false };
          await st.put('courses', target);
        }
        const date = localDate(f.modified);
        const candidateId = uid();
        const candidate = { id: candidateId, courseId: target.id, title: (titles[f.uri] || '').trim() || `Recovered recording · ${f.name}`,
          date, module: '', duration: 0, speakers: { P: 'Professor', S: 'Student', G: 'Guest' },
          segs: [], marks: [], slides: [], analysis: null, reviewed: false,
          created: f.modified || Date.now(), ex: false, audioName: f.name, audioUri: f.uri, recordingId: candidateId };
        const lecture = await scopeLinkedLectureAudio(candidate, library, previousScopes);
        if (library !== getUid()) throw new Error('The library changed. Scan again before restoring.');
        await st.put('lectures', lecture);
        restored++;
        if (retryTranscription) {
          const receipt = await getPrivacyConsentReceipt(library, lecture.id, lecture.courseId);
          if (receipt) {
            if (__DEV__) setTranscriptionRequests((count) => count + 1);
            st.processRecording(lecture, lecture.audioUri, target);
          } else {
            consentNeeded.push({ lecture, course: target });
          }
        }
      }
      if (consentNeeded.length) setPendingConsent(consentNeeded);
      setDone((count) => count + restored);
      setFiles((old) => old.filter((f) => !selected[f.uri]));
      setSelected({});
      if (!restored) setError('No files could be restored. Scan again to check which recordings are still on this phone.');
    } catch (e) { setError(`Recovery stopped: ${e.message || 'could not save the recording'}. Files were not deleted; scan again to retry.`); }
    finally { saving.current = false; setLoading(false); }
  }

  const chosenCount = files.filter((f) => selected[f.uri]).length;
  function createFixture(corrupt = false) {
    try {
      const name = createRecoveryDeviceFixture(corrupt === true);
      setFixtureName(name);
      scan();
    } catch (e) {
      setError(`Could not make test recording: ${e.message || 'storage is unavailable'}`);
    }
  }
  return (
    <Screen style={{ paddingBottom: 40 }}>
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={s.h1}>Recover recordings</Text>
        <Text style={{ color: C.sec, lineHeight: 21 }}>New recordings are kept separate for each library on this phone. Older files without an owner may belong to a different library: preview and select them manually only if they are yours. Audio stays on this phone unless you opt in below and confirm the current recording-consent terms for each restored recording.</Text>
        <Text style={{ color: C.sec, lineHeight: 21 }}>Typed notes and files no longer on this phone cannot be recovered here. Audio saved on another device must be checked on that device.</Text>
        {Platform.OS === 'web' ? <Text style={{ color: C.sec }}>This recovery scan only works in the phone app, not the browser.</Text>
          : <Btn title={loading ? 'Checking…' : 'Scan this phone again'} kind="secondary" disabled={loading} onPress={scan} testID="recover-scan" />}
        {scanResult && !loading && !error ? (
          <View style={{ gap: 4 }}>
            <Text testID="recover-scan-result" accessibilityLiveRegion="polite" style={{ color: C.accent, lineHeight: 21 }}>
              Scan {scanResult.attempt} complete at {scanResult.completedAt}. Checked {scanResult.audioCount} saved audio file{scanResult.audioCount === 1 ? '' : 's'}; {scanResult.recoverableCount} available for recovery.
            </Text>
            {scanResult.audioCount > scanResult.recoverableCount ? (
              <Text style={{ color: C.sec, lineHeight: 21 }}>
                {scanResult.audioCount - scanResult.recoverableCount} already linked to your library. Open those recordings from Library instead.
              </Text>
            ) : null}
          </View>
        ) : null}
        {__DEV__ && Platform.OS !== 'web' ? (
          <View style={{ gap: 6 }}>
            <Btn title="Create sample recording for recovery check" kind="secondary" onPress={createFixture} disabled={loading} testID="recover-create-sample" />
            <Btn title="Create damaged recording for recovery check" kind="secondary" onPress={() => createFixture(true)} disabled={loading} testID="recover-create-corrupt" />
            {!!fixtureName && <Text testID="recover-sample-name" style={{ color: C.sec }}>Sample: {fixtureName}</Text>}
            <Text testID="recover-transcription-requests" style={{ color: C.sec }}>Transcription requests from recovery: {transcriptionRequests}</Text>
          </View>
        ) : null}
        {!!error && <Text style={{ color: C.rec }}>{error}</Text>}
        {!!done && <Text testID="recover-complete" style={{ color: C.accent }}>{done} recording{done === 1 ? '' : 's'} restored to your library.</Text>}
      </View>
      {Platform.OS !== 'web' && scanResult && !loading && !files.length && !error
        ? <Text style={{ paddingHorizontal: 16, color: C.sec, lineHeight: 21 }}>{scanResult.recoverableCount === 0
          ? 'No unlinked audio files found for this library or in older phone storage. This scan only checks audio still saved inside ClassScribe on this phone.'
          : 'No recordings left to select from this scan. Scan again to check this phone.'}</Text> : null}
      {files.length ? (
        <>
          <Section title={`Found on this phone · ${files.length}`}>
            {files.map((f) => (
              <View key={f.uri} style={{ padding: 14, borderBottomWidth: 0.5, borderBottomColor: C.sep, gap: 4 }}>
                <Pressable onPress={() => setSelected((old) => ({ ...old, [f.uri]: !old[f.uri] }))}
                  accessibilityRole="checkbox" accessibilityState={{ checked: !!selected[f.uri] }} testID={`recover-select-${f.name}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ fontSize: 21, color: C.accent }}>{selected[f.uri] ? '☑' : '□'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.ink, fontWeight: '600' }} numberOfLines={2}>{f.name}</Text>
                    <Text style={{ color: C.sec, fontSize: 13 }}>{f.modified ? new Date(f.modified).toLocaleString() + ' · ' : ''}{(f.size / (1024 * 1024)).toFixed(1)} MB</Text>
                    {f.ownerless ? <Text style={{ color: C.warn, fontSize: 13 }}>Older file · library unknown — select manually</Text> : null}
                  </View>
                </Pressable>
                <Btn title={preview === f.uri ? 'Hide preview' : 'Preview audio'} kind="plain" small testID={`recover-preview-${f.name}`}
                  onPress={() => setPreview(preview === f.uri ? null : f.uri)} />
                {preview === f.uri ? <Preview key={f.uri} uri={f.uri} failed={!!previewErrors[f.uri]}
                  onFailure={previewFailed} onClose={() => setPreview(null)} /> : null}
                {previewErrors[f.uri] ? (
                  <View style={{ gap: 8 }}>
                    <Text testID={`recover-preview-error-${f.name}`} accessibilityRole="alert" style={{ color: C.rec, lineHeight: 21 }}>{previewErrors[f.uri]}</Text>
                    <Btn title="Skip this recording" kind="secondary" small testID={`recover-skip-${f.name}`} onPress={() => skipFile(f.uri)} />
                  </View>
                ) : null}
                {selected[f.uri] ? <TextInput style={[s.input, { backgroundColor: C.bg }]} value={titles[f.uri] || ''}
                  onChangeText={(text) => setTitles((old) => ({ ...old, [f.uri]: text }))}
                  placeholder="Lecture title (optional)" placeholderTextColor={C.faint} /> : null}
              </View>
            ))}
          </Section>
          <Section title="Restore into">
            <Pressable onPress={() => setCourseId('')} accessibilityRole="radio" accessibilityState={{ selected: !courseId }} testID="recover-new-course" style={{ padding: 16 }}>
              <Text style={{ color: C.ink }}> {!courseId ? '✓ ' : ''}Recovered recordings (new personal course)</Text>
            </Pressable>
            {personalCourses.map((c) => <Pressable key={c.id} onPress={() => setCourseId(c.id)}
              accessibilityRole="radio" accessibilityState={{ selected: courseId === c.id }} testID={`recover-course-${c.id}`} style={{ padding: 16, borderTopWidth: 0.5, borderTopColor: C.sep }}>
              <Text style={{ color: C.ink }}>{courseId === c.id ? '✓ ' : ''}{c.code} · {c.name}</Text>
            </Pressable>)}
          </Section>
          <View style={{ paddingHorizontal: 16, gap: 12, marginTop: 16 }}>
            <Pressable onPress={() => setRetryTranscription((v) => !v)} accessibilityRole="checkbox" testID="recover-transcription"
              accessibilityState={{ checked: retryTranscription }} style={{ flexDirection: 'row', gap: 10 }}>
              <Text style={{ color: C.accent, fontSize: 21 }}>{retryTranscription ? '☑' : '□'}</Text>
               <Text style={{ color: C.ink, flex: 1, lineHeight: 21 }}>After restoring, ask before uploading each selected recording. You must confirm the current recording-consent terms before transcription; leaving this off keeps audio on this phone only.</Text>
            </Pressable>
            <Btn title={`Restore ${chosenCount} selected recording${chosenCount === 1 ? '' : 's'}`} disabled={!chosenCount || loading} onPress={restore} testID="recover-restore" />
          </View>
        </>
      ) : null}
      {pendingConsent[0] ? (
        <RecordingConsentSheet
          key={pendingConsent[0].lecture.id}
          visible
          libraryCode={st.status.uid}
          lectureId={pendingConsent[0].lecture.id}
          courseId={pendingConsent[0].lecture.courseId}
          sessionId={pendingConsent[0].lecture.recordingId || pendingConsent[0].lecture.id}
          onClose={() => setPendingConsent((queue) => queue.slice(1))}
          onConfirmed={() => {
            if (__DEV__) setTranscriptionRequests((count) => count + 1);
            st.processRecording(pendingConsent[0].lecture, pendingConsent[0].lecture.audioUri, pendingConsent[0].course);
          }}
        />
      ) : null}
    </Screen>
  );
}