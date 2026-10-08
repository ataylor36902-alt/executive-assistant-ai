import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as Speech from 'expo-speech';
import { File } from 'expo-file-system';
import { useStore } from '../../../lib/store';
import { askAI, db, errMsg, getUid, listStudentGrades, newAskId, searchPrivateEvidence, transcribe } from '../../../lib/api';
import { material, missedConceptReview, searchAssignments, searchLectures, topicCounts } from '../../../lib/logic';
import { C } from '../../../lib/theme';
import { todayISO } from '../../../lib/util';
import { appendVoiceTranscript, beginVoiceRecording, createSpeechPlayback, finishVoiceQuestion } from '../../../lib/ask-voice';
import { citationKey, firstAssignmentCitation, firstLectureCitation, firstNoteCitation, isFiniteRealSeconds, validateAskCitations } from '../../../lib/ask-citations';
import { Md } from '../../../components/ui';
import { CreditsConfirmSheet } from '../../../components/CreditsConfirmSheet';
import { isCreditsRequired, refreshCreditsAfterAction } from '../../../lib/credits-actions';
import { useBillingStatus } from '../../../lib/billing';
import { ExamFeatureAccessNotice, useExamFeatureAccess } from '../../../components/ExamFeatureAccess';

const VOICE_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000, isMeteringEnabled: true };
const PLAYBACK_ERROR = 'Could not play the spoken answer. The written answer is above.';
const PLAYBACK_TIMEOUT_ERROR = 'Audio could not finish playing. The written answer is above. You can start voice again or type your next question.';

function removeTemporaryAudio(uri) {
  if (!uri) return;
  try {
    if (Platform.OS === 'web') {
      if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
    } else {
      const file = new File(uri);
      if (file.exists) file.delete();
    }
  } catch (e) {
    console.warn('Could not remove temporary voice question audio', e);
  }
}

function evidenceForHit(hit, evidence) {
  if (hit.kind === 'lecture') evidence.set(citationKey('lecture', hit.l.id, Number(hit.t)), { kind: 'lecture', id: hit.l.id, seconds: Number(hit.t) });
  else evidence.set(citationKey('note', hit.n.id), { kind: 'note', id: hit.n.id });
}

export default function Ask() {
  const st = useStore();
  const params = useLocalSearchParams();
  const courses = st.courses().filter((course) => !course.ex);
  const initialCourseId = Array.isArray(params.courseId) ? params.courseId[0] : params.courseId;
  const [scope, setScope] = useState(initialCourseId && courses.some((course) => course.id === initialCourseId) ? initialCourseId : 'all');
  const [turns, setTurns] = useState([]);
  const [input, setInput] = useState(params.q ? String(params.q) : '');
  const [busy, setBusy] = useState('');
  const [retrievalMode, setRetrievalMode] = useState('semantic');
  const [searchCoverage, setSearchCoverage] = useState('');
  const [voice, setVoice] = useState('idle');
  const [voiceSession, setVoiceSession] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [quotaError, setQuotaError] = useState('');
  const [creditsPrompt, setCreditsPrompt] = useState(null);
  const [creditsPromptVisible, setCreditsPromptVisible] = useState(false);
  const [creditsBusy, setCreditsBusy] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);
  const [speakingTurn, setSpeakingTurn] = useState(null);
  const recorder = useAudioRecorder(VOICE_OPTIONS);
  const recording = useAudioRecorderState(recorder, 250);
  const speechPlayback = useRef(null);
  if (!speechPlayback.current) speechPlayback.current = createSpeechPlayback(Speech);
  const voiceOperation = useRef(false);
  const voiceRef = useRef('idle');
  const sessionRef = useRef(false);
  const voiceContextRef = useRef(null);
  const busyRef = useRef(false);
  const turnsRef = useRef([]);
  const askQuotaExhaustedRef = useRef(false);
  const stopVoiceAfterPlaybackRef = useRef(false);
  const heardSpeech = useRef(false);
  const lastSpeechAt = useRef(0);
  const meteringSeen = useRef(false);
  const scroller = useRef(null);
  const scopeRevision = useRef(0);
  const askAbortRef = useRef(null);
  const semesterScopes = [...new Set(courses.map((course) => String(course.semester || '').trim()).filter(Boolean))];
  const requestedSemester = scope.startsWith('semester:') ? scope.slice('semester:'.length) : '';
  const validCourseScope = scope !== 'all' && courses.some((course) => course.id === scope);
  const validSemesterScope = !validCourseScope && requestedSemester && semesterScopes.includes(requestedSemester);
  const selectedScope = validCourseScope ? scope : validSemesterScope ? `semester:${requestedSemester}` : 'all';
  const cid = selectedScope !== 'all' && !selectedScope.startsWith('semester:') ? selectedScope : null;
  const scopedCourses = selectedScope.startsWith('semester:')
    ? courses.filter((course) => String(course.semester || '').trim() === selectedScope.slice('semester:'.length))
    : cid ? courses.filter((course) => course.id === cid) : courses;
  const scopedCourseIds = new Set(scopedCourses.map((course) => course.id));
  const scopedLectures = st.lecturesOf().filter((lecture) => scopedCourseIds.has(lecture.courseId) && !lecture.ex && !lecture.sharedCopy && st.isMineRecord('lectures', lecture));
  const scopedNotes = st.notesOf().filter((note) => scopedCourseIds.has(note.courseId) && !note.ex && !note.sharedCopy && st.isMineRecord('notes', note));
  const scopedAssignments = st.assignmentsOf().filter((assignment) => scopedCourseIds.has(assignment.courseId) && !assignment.ex && !assignment.sharedCopy && st.isMineRecord('assignments', assignment));
  const renderedLibraryUidRef = useRef(st.status.uid);
  renderedLibraryUidRef.current = st.status.uid;
  const observedLibraryUidRef = useRef(st.status.uid);
  const scopeSnapshot = JSON.stringify([st.status.uid, selectedScope, retrievalMode, scopedCourses.map((course) => [course.id, course.groupCode || '', String(course.semester || '').trim()])]);
  useEffect(() => { setSearchCoverage(''); }, [scopeSnapshot]);
  const scopeSnapshotRef = useRef(scopeSnapshot);
  scopeSnapshotRef.current = scopeSnapshot;
  const observedScopeSnapshotRef = useRef(scopeSnapshot);
  const billing = useBillingStatus(st.status.uid);
  const askAccess = useExamFeatureAccess('study', false);
  const billingLibraryRef = useRef(st.status.uid);
  const billingLibraryMatches = billingLibraryRef.current === st.status.uid;
  useEffect(() => { billingLibraryRef.current = st.status.uid; }, [st.status.uid]);
  const gradeAccess = billingLibraryMatches && !!billing.status && ['student', 'pro'].includes(billing.status.plan) && ['active', 'trialing'].includes(billing.status.status) && getUid() === st.status.uid;
  const askPlanActive = billingLibraryMatches && !!askAccess.status
    && (askAccess.status.plan === 'free' || (['student', 'pro'].includes(askAccess.status.plan)
      && ['active', 'trialing'].includes(askAccess.status.status))) && getUid() === st.status.uid;
  const askQuotaExhausted = ['free', 'student'].includes(askAccess.status?.plan)
    && Number.isFinite(askAccess.status.askCountRemaining) && askAccess.status.askCountRemaining <= 0;
  askQuotaExhaustedRef.current = askQuotaExhausted || stopVoiceAfterPlaybackRef.current;
  const c0 = st.course(cid) || scopedCourses[0] || courses[0] || {};
  const prof = c0.professor || 'my professor';
  const sugg = [`What has ${prof} repeated the most?`, `What did ${prof} say about ${c0.code === 'CHEM 110' ? 'limiting reagents' : c0.ex ? 'mitosis' : 'the main topic'}?`, 'What’s due in the next two weeks?'];

  const changeVoice = (state) => { voiceRef.current = state; setVoice(state); };
  const showTurns = (next) => { turnsRef.current = next; setTurns(next); };
  const cancelCurrentAsk = () => {
    scopeRevision.current++;
    askAbortRef.current?.abort();
    askAbortRef.current = null;
    busyRef.current = false;
    setBusy('');
  };
  useEffect(() => {
    if (observedLibraryUidRef.current === st.status.uid) return;
    const previousUid = observedLibraryUidRef.current;
    observedLibraryUidRef.current = st.status.uid;
    if (!previousUid) return;
    endConversation();
    showTurns([]);
    setInput('');
    setScope('all');
  }, [st.status.uid]);
  useEffect(() => {
    if (observedScopeSnapshotRef.current === scopeSnapshot) return;
    observedScopeSnapshotRef.current = scopeSnapshot;
    endConversation();
    showTurns([]);
  }, [scopeSnapshot]);
  const changeScope = (nextScope) => {
    if (nextScope === selectedScope) return;
    setScope(nextScope);
  };

  function stopAnswerPlayback() {
    speechPlayback.current.stop();
    if (voiceRef.current === 'speaking') changeVoice('idle');
    setSpeakingTurn(null);
  }

  useFocusEffect(useCallback(() => {
    return () => {
      scopeRevision.current++;
      askAbortRef.current?.abort();
      askAbortRef.current = null;
      busyRef.current = false;
      setBusy('');
      sessionRef.current = false;
      voiceContextRef.current = null;
      setVoiceSession(false);
      speechPlayback.current.stop();
      if (recorder.isRecording) {
        voiceOperation.current = true;
        recorder.stop().then(() => removeTemporaryAudio(recorder.uri)).catch(console.warn).finally(() => { voiceOperation.current = false; });
        setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(console.warn);
      }
      voiceRef.current = 'idle';
      setVoice('idle');
    };
  }, [recorder]));

  useEffect(() => {
    if (voice !== 'recording') return;
    const ms = recording.durationMillis || 0;
    if (typeof recording.metering === 'number') {
      meteringSeen.current = true;
      if (recording.metering > -46) {
        heardSpeech.current = true;
        lastSpeechAt.current = Date.now();
      }
    }
    if (heardSpeech.current && ms > 4000 && Date.now() - lastSpeechAt.current > 2500) stopVoice();
  }, [voice, recording.durationMillis, recording.metering]);

  useEffect(() => {
    if (voice !== 'recording') return;
    // Metering is not available on every device. A spoken question must still
    // finish instead of listening indefinitely when silence cannot be detected.
    const noMetering = setTimeout(() => {
      if (!meteringSeen.current && voiceRef.current === 'recording') stopVoice();
    }, 10000);
    const maximum = setTimeout(() => {
      if (voiceRef.current === 'recording') stopVoice();
    }, 20000);
    return () => { clearTimeout(noMetering); clearTimeout(maximum); };
  }, [voice]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'background' && sessionRef.current) endConversation();
    });
    return () => listener.remove();
  }, []);

  async function startVoice() {
    if (voiceRef.current !== 'idle' || voiceOperation.current || busyRef.current || !sessionRef.current) return;
    voiceOperation.current = true;
    changeVoice('requesting');
    setVoiceError('');
    setOpenSettings(false);
    try {
      await import('../../../lib/ai-consent').then(({ ensureAiConsent }) => ensureAiConsent());
      const result = await beginVoiceRecording({
        requestPermission: requestRecordingPermissionsAsync,
        setAudioMode: setAudioModeAsync,
        prepareToRecord: () => recorder.prepareToRecordAsync(),
        record: () => recorder.record(),
        isActive: () => sessionRef.current,
      });
      if (result.status === 'cancelled') return;
      if (result.status === 'denied') {
        const permission = result.permission;
        setVoiceError('Microphone access is needed to ask a spoken question. You can still type below.');
        setOpenSettings(Platform.OS !== 'web' && permission.canAskAgain === false);
        sessionRef.current = false;
        setVoiceSession(false);
        return;
      }
      heardSpeech.current = false;
      lastSpeechAt.current = 0;
      meteringSeen.current = false;
      changeVoice('recording');
    } catch (e) {
      setVoiceError(e.message || 'Could not start recording. Please try again.');
      sessionRef.current = false;
      voiceContextRef.current = null;
      setVoiceSession(false);
    } finally {
      if (voiceRef.current === 'requesting') changeVoice('idle');
      voiceOperation.current = false;
    }
  }

  function startConversation() {
    if (sessionRef.current) return;
    const uid = getUid();
    if (!uid || uid !== st.status.uid) {
      setVoiceError('Your library is switching. Reopen Ask in the current library before using voice.');
      return;
    }
    stopAnswerPlayback();
    voiceContextRef.current = { uid, scopeRevision: scopeRevision.current, scopeSnapshot: scopeSnapshotRef.current };
    sessionRef.current = true;
    setVoiceSession(true);
    startVoice();
  }

  function endConversation() {
    cancelCurrentAsk();
    sessionRef.current = false;
    stopVoiceAfterPlaybackRef.current = false;
    voiceContextRef.current = null;
    setVoiceSession(false);
    speechPlayback.current.stop();
    setSpeakingTurn(null);
    if (voiceRef.current === 'recording') stopVoice(true);
    else if (voiceRef.current === 'speaking') changeVoice('idle');
  }

  async function stopVoice(discard = false) {
    if (voiceRef.current !== 'recording' || voiceOperation.current) return;
    const recordingContext = voiceContextRef.current;
    voiceOperation.current = true;
    changeVoice(discard ? 'idle' : 'transcribing');
    let words = '';
    try {
      const result = await finishVoiceQuestion({
        stopRecording: () => recorder.stop(),
        getUri: () => recorder.uri,
        transcribe: (uri, options) => transcribe(uri, { ...options, libraryCode: recordingContext?.uid }),
        removeTemporaryAudio,
        setAudioMode: setAudioModeAsync,
        discard,
      });
      words = result.text;
    } catch (e) {
      if (sessionRef.current && voiceContextRef.current === recordingContext) {
        if (isCreditsRequired(e) && e.audioUri) {
          setCreditsPrompt({
            ...e, kind: 'voice-transcription', audioUri: e.audioUri,
            libraryCode: recordingContext?.uid, scopeRevision: recordingContext?.scopeRevision,
            scopeSnapshot: recordingContext?.scopeSnapshot,
          });
          setCreditsPromptVisible(true);
        } else {
          setVoiceError(`${errMsg(e)} Please record again or type your question.`);
          sessionRef.current = false;
          voiceContextRef.current = null;
          setVoiceSession(false);
        }
      }
    } finally {
      changeVoice('idle');
      voiceOperation.current = false;
    }
    if (words && sessionRef.current && voiceContextRef.current === recordingContext
      && recordingContext.uid === getUid() && recordingContext.uid === renderedLibraryUidRef.current
      && recordingContext.scopeRevision === scopeRevision.current
      && recordingContext.scopeSnapshot === scopeSnapshotRef.current) {
      setInput((current) => appendVoiceTranscript(current, words));
    }
  }

  const tools = [
    { name: 'search_course_material', description: 'Search only this Ask scope: the student’s own lecture transcripts, private notes and imported course sources, and assignments. Cite lecture hits with their exact [[lectureId@seconds]] token, notes with [[note:noteId]], and assignments with [[assignment:assignmentId]].', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: async ({ query }, _assertCurrent, evidence) => {
        if (retrievalMode === 'semantic') {
          _assertCurrent?.();
          setBusy('Searching your private passages by meaning…');
          if (!scopedCourseIds.size) return { hits: [], notice: 'No owned courses in this scope.' };
          let result;
          try {
            result = await searchPrivateEvidence(query, [...scopedCourseIds], askAbortRef.current?.signal);
          } catch (error) {
            _assertCurrent?.();
            setSearchCoverage(errMsg(error));
            return { error: errMsg(error), hits: [] };
          }
          _assertCurrent?.();
          setSearchCoverage(result.notice || '');
          const hits = result.hits.filter(h => scopedCourseIds.has(h.courseId)).flatMap(h => {
            if (h.kind === 'lecture') {
              const lecture = scopedLectures.find(l => l.id === h.id);
              if (!lecture || !isFiniteRealSeconds(h.seconds) || ![...(lecture.segs || []), ...(lecture.slides || [])].some(s => Number(s.t) === h.seconds)) return [];
              evidence?.set(citationKey('lecture', h.id, h.seconds), { kind: 'lecture', id: h.id, seconds: h.seconds });
              return [{ ...h, lectureId: h.id, t: h.seconds, citation: `[[${h.id}@${h.seconds}]]` }];
            }
            if (h.kind === 'note' && scopedNotes.some(n => n.id === h.id)) {
              evidence?.set(citationKey('note', h.id), { kind: 'note', id: h.id });
              return [{ ...h, noteId: h.id, citation: `[[note:${h.id}]]` }];
            }
            if (h.kind === 'assignment' && scopedAssignments.some(a => a.id === h.id)) {
              evidence?.set(citationKey('assignment', h.id), { kind: 'assignment', id: h.id });
              return [{ ...h, assignmentId: h.id, citation: `[[assignment:${h.id}]]` }];
            }
            return [];
          });
          return { ...result, hits };
        }
        setBusy(`Searching for “${query}”…`);
        const hits = searchLectures(scopedLectures, scopedNotes, query, 10).filter((hit) =>
          hit.kind !== 'lecture' || isFiniteRealSeconds(hit.t)).map((h) => {
          if (h.kind === 'lecture') {
            const seconds = Number(h.t);
            const citation = `[[${h.l.id}@${seconds}]]`;
            evidence?.set(citationKey('lecture', h.l.id, seconds), { kind: 'lecture', id: h.l.id, seconds });
            return { kind: 'lecture', lectureId: h.l.id, citation, course: (st.course(h.l.courseId) || {}).code, title: h.l.title, date: h.l.date, t: seconds, passage: h.text };
          }
          const citation = `[[note:${h.n.id}]]`;
          evidence?.set(citationKey('note', h.n.id), { kind: 'note', id: h.n.id });
          return { kind: h.n.sourceType ? `private course source (${h.n.sourceType})` : 'student note', noteId: h.n.id, citation, course: (st.course(h.n.courseId) || {}).code, note: h.n.title, sourceName: h.n.sourceName || undefined, text: h.text };
        });
        const assignments = searchAssignments(scopedAssignments, query, 10).map((a) => {
          const citation = `[[assignment:${a.id}]]`;
          evidence?.set(citationKey('assignment', a.id), { kind: 'assignment', id: a.id });
          return { kind: 'assignment', assignmentId: a.id, citation, course: (st.course(a.courseId) || {}).code, title: a.title, type: a.type, due: a.due, done: !!a.done };
        });
        return { lecturesAndNotes: hits, assignments };
      } },
    { name: 'emphasis_report', description: 'Topics ranked by how many lectures discussed them, plus points the professor emphasized.', inputSchema: { type: 'object', properties: {} },
      execute: () => { setBusy('Counting what the professor emphasized…'); const lecs = scopedLectures.filter((l) => l.analysis); return { topics: topicCounts(lecs).slice(0, 12).map((t) => ({ topic: t.name, lectureCount: t.refs.length, refs: t.refs })), emphasized: lecs.flatMap((l) => (l.analysis.emphasized || []).map((e) => ({ lectureId: l.id, date: l.date, t: e.t, concept: e.concept, why: e.why }))) }; } },
    { name: 'list_assignments', description: 'Assignments, readings, quizzes and exams with due dates. Cite a listed item with its [[assignment:assignmentId]] token.', inputSchema: { type: 'object', properties: {} },
      execute: (_input, _assertCurrent, evidence) => scopedAssignments.map((a) => {
        const citation = `[[assignment:${a.id}]]`;
        evidence?.set(citationKey('assignment', a.id), { kind: 'assignment', id: a.id });
        return { assignmentId: a.id, citation, title: a.title, type: a.type, due: a.due, done: !!a.done, course: (st.course(a.courseId) || {}).code };
      }) },
    { name: 'get_lecture', description: 'Summary, key points and terms for one lecture.', inputSchema: { type: 'object', properties: { lectureId: { type: 'string' } }, required: ['lectureId'] },
      execute: ({ lectureId }) => { const l = scopedLectures.find((lecture) => lecture.id === lectureId); return l ? material([l], scopedNotes.filter((n) => n.courseId === l.courseId), 8000, st.course) : { unavailable: 'That lecture is not in the selected course scope.' }; } },
    { name: 'class_discussions', description: 'Read-only recent discussion posts for the selected course group(s), using only each selected course’s validated invite code.', inputSchema: { type: 'object', properties: {} },
      execute: async (_, assertCurrent = () => {}) => {
        const grouped = scopedCourses.filter((course) => !course.ex && /^g_[0-9a-f]{32}$/.test(course.groupCode || ''));
        if (!grouped.length) return { unavailable: cid ? 'This course has no valid class-group invite code. Join a class group in Classmates first.' : 'No selected course has a valid class-group invite code.' };
        const result = [];
        const unavailable = [];
        for (const course of grouped) {
          const code = course.groupCode;
          try {
            assertCurrent();
            const docs = await db.list('posts', [['code', '==', code]]);
            assertCurrent();
            const posts = docs.filter((doc) => doc.data && doc.data.code === code).map((doc) => ({
              author: doc.data.bot ? 'ClassScribe study session' : doc.data.by === getUid() ? 'you' : 'classmate',
              date: Number.isFinite(Number(doc.data.at)) && doc.data.at ? new Date(Number(doc.data.at)).toISOString() : null,
              text: String(doc.data.text || '').slice(0, 2500),
            })).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 25);
            result.push({ course: course.code, posts });
          } catch {
            unavailable.push(`${course.code}: discussion could not be loaded`);
          }
        }
        return { readOnly: true, groups: result, unavailable };
      } },
    { name: 'shared_course_material', description: 'Read-only shared notebook and shared lectures for selected course groups. Queries are filtered by the selected course’s validated invite code and every returned record is code-checked.', inputSchema: { type: 'object', properties: {} },
      execute: async (_, assertCurrent = () => {}) => {
        const grouped = scopedCourses.filter((course) => !course.ex && /^g_[0-9a-f]{32}$/.test(course.groupCode || ''));
        if (!grouped.length) return { unavailable: cid ? 'This course has no valid class-group invite code. Join a class group in Classmates first.' : 'No selected course has a valid class-group invite code.' };
        const result = [];
        const unavailable = [];
        for (const course of grouped) {
          const code = course.groupCode;
          try {
            assertCurrent();
            const sharedPromise = db.list('shared', [['code', '==', code]]);
            assertCurrent();
            const notebookPromise = db.get(`notebooks/${code}`, code);
            const [docs, notebook] = await Promise.all([sharedPromise, notebookPromise]);
            assertCurrent();
            const lectures = docs.filter((doc) => doc.data && doc.data.code === code).map((doc) => {
              const data = doc.data;
              const analysis = data.analysis || {};
              return {
                title: data.title || 'Shared lecture',
                date: data.date || null,
                summary: analysis.summary || '',
                keyPoints: analysis.keyPoints || [],
                emphasized: analysis.emphasized || [],
                terms: analysis.terms || [],
                transcript: (data.segs || []).slice(0, 50).map((segment) => String(segment.x || '').slice(0, 300)),
              };
            });
            result.push({
              course: course.code,
              notebook: notebook && notebook.code === code ? String(notebook.text || '').slice(0, 6000) : 'No shared notebook was found for this group.',
              sharedLectures: lectures,
            });
          } catch {
            unavailable.push(`${course.code}: shared material could not be loaded`);
          }
        }
        return { readOnly: true, groups: result, unavailable };
      } },
    { name: 'student_gradebook_scores', description: 'Read all assignment, project, quiz, and test entries plus the server-calculated course average and category averages from the student’s own paid Student/Pro gradebook. Never treat these as official grades.', inputSchema: { type: 'object', properties: {} },
      execute: async (_, assertCurrent = () => {}) => {
        if (!gradeAccess) return { unavailable: billing.loading || !billing.status ? 'The library plan could not be confirmed yet. Gradebook tools require a verified, active Student or Pro plan.' : 'Gradebook tools require an active Student or Pro plan. Open Plans for access details.' };
        try {
          assertCurrent();
          const data = await listStudentGrades();
          assertCurrent();
          if (getUid() !== st.status.uid) return { unavailable: 'The active library changed; reopen Ask in the current library.' };
          const rows = Array.isArray(data && data.courses) ? data.courses : [];
          const gradebooks = rows.filter((row) => scopedCourseIds.has(row.courseId || (row.gradebook || {}).courseId))
            .flatMap((row) => {
              const gradebook = row.gradebook || {};
              const courseId = row.courseId || gradebook.courseId;
              const course = courses.find((item) => item.id === courseId);
              if (!course) return [];
              const categories = ['assignment', 'project', 'quiz', 'test'];
              const byType = Array.isArray(row.analysis && row.analysis.byType) ? row.analysis.byType : [];
              return [{
                course: course.code,
                courseAveragePercent: row.analysis?.averagePercent ?? null,
                averageBasis: gradebook.finalPercent != null ? 'student-entered final percentage' : 'based on scored work so far',
                byCategory: categories.map((type) => ({
                  type,
                  averagePercent: byType.find((item) => item.type === type)?.averagePercent ?? null,
                })),
                entries: (gradebook.items || []).filter((item) => item && categories.includes(item.type)).map((item) => ({
                  title: item.title, type: item.type, date: item.date || null,
                  earned: item.earned ?? null, possible: item.possible ?? null,
                })),
              }];
            });
          return { source: 'student-entered gradebook', officialResult: false, courses: gradebooks };
        } catch (error) {
          return { unavailable: `The gradebook is temporarily unavailable: ${errMsg(error)}` };
        }
      } },
    { name: 'practice_missed_concepts', description: 'Read persisted quiz/flashcard practice statistics for this course scope and show measured misses with practical review actions.', inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const reviews = scopedCourses.flatMap((course) => missedConceptReview(st.statsOf(course.id)).map((review) => ({ course: course.code, ...review })));
        return { practiceStatistics: reviews.length ? reviews : 'No missed-concept practice results have been recorded in this scope yet.' };
      } },
  ];

  function speakAnswer(text, turnIndex) {
    const sessionReply = turnIndex === undefined && sessionRef.current;
    if (!sessionReply && turnIndex === undefined) return;
    if (!sessionReply && speakingTurn === turnIndex) {
      stopAnswerPlayback();
      return;
    }
    setVoiceError((current) => current === PLAYBACK_ERROR || current === PLAYBACK_TIMEOUT_ERROR ? '' : current);
    if (sessionReply) changeVoice('speaking');
    else setSpeakingTurn(turnIndex);
    speechPlayback.current.play(text, {
      onDone: () => {
        if (sessionReply && sessionRef.current && voiceRef.current === 'speaking') {
          changeVoice('idle');
          if (stopVoiceAfterPlaybackRef.current || askQuotaExhaustedRef.current) {
            stopVoiceAfterPlaybackRef.current = false;
            endConversation();
            return;
          }
          startVoice();
        } else {
          setSpeakingTurn(null);
        }
      },
      onStopped: () => {
        if (sessionReply && voiceRef.current === 'speaking') changeVoice('idle');
        setSpeakingTurn(null);
      },
      onError: (error) => {
        setSpeakingTurn(null);
        setVoiceError(error?.code === 'speech_timeout' ? PLAYBACK_TIMEOUT_ERROR : PLAYBACK_ERROR);
        if (sessionReply) endConversation();
      },
    });
  }

  function citedLecturePassage(text) {
    const citation = firstLectureCitation(text);
    if (!citation) return null;
    const lecture = scopedLectures.find((item) => item.id === citation.id);
    if (!lecture) return null;
    const segment = (lecture.segs || []).find((item) => isFiniteRealSeconds(item.t) && Number(item.t) === citation.seconds);
    return segment ? { lecture, segment, seconds: citation.seconds } : null;
  }

  function citedReviewSource(text) {
    const lecture = citedLecturePassage(text);
    if (lecture) return { kind: 'lecture', ...lecture };
    const noteCitation = firstNoteCitation(text);
    const note = noteCitation && scopedNotes.find((item) => item.id === noteCitation.id);
    if (note) return { kind: 'note', note };
    const assignmentCitation = firstAssignmentCitation(text);
    const assignment = assignmentCitation && scopedAssignments.find((item) => item.id === assignmentCitation.id);
    return assignment ? { kind: 'assignment', assignment } : null;
  }

  function reviewQuestion(source) {
    if (source.kind === 'lecture') {
      return {
        text: `Help me review the concept in this cited lecture passage: “${source.segment.x}” [[${source.lecture.id}@${source.seconds}]]. Explain the key idea using my own course materials and ask me one short recall question. Do not predict exam content or mastery.`,
        evidence: { kind: 'lecture', id: source.lecture.id, seconds: source.seconds },
      };
    }
    if (source.kind === 'note') {
      const excerpt = String(source.note.body || '').slice(0, 1200);
      return {
        text: `Help me review this cited private course note, “${source.note.title || 'Untitled note'}”: “${excerpt || source.note.title || 'No note text is recorded.'}” [[note:${source.note.id}]]. Explain only what this note and my own course material support, then ask one short recall question. Do not predict exam content or mastery.`,
        evidence: { kind: 'note', id: source.note.id },
      };
    }
    const assignment = source.assignment;
    return {
      text: `Help me review this cited assignment record: “${assignment.title}” (type: ${assignment.type || 'task'}${assignment.due ? `; due ${assignment.due}` : ''}) [[assignment:${assignment.id}]]. Use only the recorded details and my own related course material; do not invent missing requirements. Ask one short question about what I should verify. Do not predict exam content or mastery.`,
      evidence: { kind: 'assignment', id: assignment.id },
    };
  }

  async function send(text, fromVoice = sessionRef.current, focusedEvidence, confirmed = null) {
    const q = (text || input).trim();
    if (!q || busyRef.current || voiceRef.current !== 'idle') return;
    const requestScope = scopeRevision.current;
    const requestScopeSnapshot = scopeSnapshotRef.current;
    const citationEvidence = new Map();
    if (focusedEvidence) citationEvidence.set(
      citationKey(focusedEvidence.kind, focusedEvidence.id, focusedEvidence.seconds),
      focusedEvidence,
    );
    const requestUid = getUid();
    if (!requestUid || requestUid !== st.status.uid || requestUid !== renderedLibraryUidRef.current) {
      setVoiceError('Your library is switching. Reopen Ask in the current library before sending.');
      return;
    }
    if (fromVoice) {
      const voiceContext = voiceContextRef.current;
      if (!voiceContext || voiceContext.uid !== requestUid || voiceContext.scopeRevision !== requestScope || voiceContext.scopeSnapshot !== requestScopeSnapshot) {
        setVoiceError('The library or course scope changed during voice capture. Please record your question again.');
        sessionRef.current = false;
        voiceContextRef.current = null;
        setVoiceSession(false);
        return;
      }
    }
    const controller = new AbortController();
    askAbortRef.current = controller;
    const isCurrentRequest = () => requestUid === getUid()
      && requestUid === renderedLibraryUidRef.current
      && requestScope === scopeRevision.current
      && requestScopeSnapshot === scopeSnapshotRef.current;
    const assertCurrent = () => {
      if (!isCurrentRequest()) throw { code: 'cancelled', message: 'Ask was cancelled because the library or course scope changed.' };
    };
    const requestTools = tools.map((tool) => ({
      ...tool,
      execute: async (input) => {
        assertCurrent();
        const result = await tool.execute(input || {}, assertCurrent, citationEvidence);
        assertCurrent();
        return result;
      },
    }));
    const stableAskId = confirmed?.askId || newAskId();
    busyRef.current = true;
    const previousTurns = turnsRef.current;
    setQuotaError('');
    setInput('');
    const next = [...turnsRef.current, { role: 'user', content: q }];
    showTurns(next);
    setBusy('Thinking…');
    if (fromVoice) changeVoice('thinking');
    setTimeout(() => scroller.current && scroller.current.scrollToEnd({ animated: true }), 50);
    const pre = `You are ClassScribe, a study assistant with Class Memory. Today is ${todayISO()}.
Answer only from tool results in the selected scope: ${cid ? `${c0.code} only` : selectedScope.startsWith('semester:') ? `${selectedScope.slice('semester:'.length)} semester only` : 'all of the student’s own courses listed below'}.
Courses in scope: ${scopedCourses.map((c) => `${c.code} · ${c.name}`).join(' | ') || 'No personal courses are available in this scope'}.
For course content, search the student's own transcripts, private imported course sources, notes, and assignments first. Use class discussions/shared notebooks/shared lectures only when relevant and identify them as classmate-shared material, not verified instructor material; never cite shared class material as the student's personal source. Never share private source notes or generated study guides into class-group content. Use gradebook scores only if the paid tool returns them; they are student-entered, never official grades. Practice miss counts must come only from persisted practice statistics. Never infer mastery or predict exam content/results. If tools report that information is unavailable or no relevant results, explain that kindly and do not fill gaps with guesses or sample/example-course content. Never retrieve a record by an ID unless the scoped tool explicitly validates it. Cite each factual sentence grounded in an owned lecture passage with its exact [[LECTURE_ID@SECONDS]] token returned by search_course_material. Cite factual claims grounded in a private note or assignment with the exact [[note:NOTE_ID]] or [[assignment:ASSIGNMENT_ID]] token returned by search_course_material or list_assignments. Do not invent or alter citation tokens. Mention dates in words. Be concise; short markdown lists are fine.\n\nQuestion: `;
    let reply;
    try {
      const r = await askAI(next.map((t, i) => ({ role: t.role, content: i === 0 ? pre + t.content : t.content })), {
        tools: requestTools, signal: controller.signal, assertCurrent, askId: stableAskId,
        ...(confirmed ? { useCredits: true, requestId: confirmed.requestId } : {}),
      });
      reply = r.text;
      if (confirmed) {
        try {
          const update = await refreshCreditsAfterAction(requestUid);
          if (update.warning) setQuotaError(update.warning);
        } catch {
          setQuotaError('Your answer is complete, but your Credits balance could not be refreshed yet.');
        }
      }
      const refreshedBilling = await askAccess.refresh();
      const refreshedAskQuotaExhausted = ['free', 'student'].includes(refreshedBilling?.plan)
        && Number.isFinite(refreshedBilling.askCountRemaining) && refreshedBilling.askCountRemaining <= 0;
      askQuotaExhaustedRef.current = refreshedAskQuotaExhausted;
      if (fromVoice && refreshedAskQuotaExhausted) stopVoiceAfterPlaybackRef.current = true;
      assertCurrent();
    } catch (e) {
      if (isCurrentRequest()) {
        if (isCreditsRequired(e)) {
          showTurns(previousTurns);
          setInput(q);
          setCreditsPrompt({
            ...e, kind: 'ask', q, fromVoice, focusedEvidence, askId: stableAskId,
            libraryCode: requestUid, scopeRevision: requestScope, scopeSnapshot: requestScopeSnapshot,
          });
          setCreditsPromptVisible(true);
          if (fromVoice) {
            sessionRef.current = false;
            voiceContextRef.current = null;
            setVoiceSession(false);
            speechPlayback.current.stop();
            setSpeakingTurn(null);
            changeVoice('idle');
          }
          if (askAbortRef.current === controller) askAbortRef.current = null;
          setBusy('');
          busyRef.current = false;
          return;
        }
        const quotaReached = e?.code === 'ask_limit_reached';
        if (quotaReached) {
          await askAccess.refresh();
          if (!isCurrentRequest()) return;
          showTurns(previousTurns);
          setInput(q);
          setQuotaError(errMsg(e));
          if (fromVoice) {
            sessionRef.current = false;
            voiceContextRef.current = null;
            setVoiceSession(false);
            speechPlayback.current.stop();
            setSpeakingTurn(null);
            changeVoice('idle');
          }
          if (askAbortRef.current === controller) askAbortRef.current = null;
          setBusy('');
          busyRef.current = false;
          return;
        }
        const hits = searchLectures(scopedLectures, scopedNotes, q, 5).filter((hit) =>
          hit.kind !== 'lecture' || isFiniteRealSeconds(hit.t));
        const assignments = searchAssignments(scopedAssignments, q, 5);
        hits.forEach((h) => evidenceForHit(h, citationEvidence));
        assignments.forEach((a) => citationEvidence.set(citationKey('assignment', a.id), { kind: 'assignment', id: a.id }));
        reply = `${errMsg(e)}${hits.length ? '\n\nClosest passages from your course materials:\n' + hits.map((h) => h.kind === 'lecture' ? `- “${h.text}” [[${h.l.id}@${Number(h.t)}]]` : `- Your note “${h.n.title}”: “${h.text}” [[note:${h.n.id}]]`).join('\n') : ''}${assignments.length ? '\n\nRelated assignments:\n' + assignments.map((a) => `- ${a.title}${a.due ? ` · due ${a.due}` : ''} [[assignment:${a.id}]]`).join('\n') : ''}`;
      }
    }
    if (!isCurrentRequest()) {
      if (scopeRevision.current === requestScope) {
        cancelCurrentAsk();
        showTurns([]);
      }
      return;
    }
    if (askAbortRef.current === controller) askAbortRef.current = null;
    const checkedReply = validateAskCitations(reply, citationEvidence);
    reply = checkedReply.rejected
      ? `${checkedReply.text}\n\nUnverified citations were removed.`
      : checkedReply.text;
    showTurns([...next, { role: 'assistant', content: reply }]);
    setBusy('');
    busyRef.current = false;
    setTimeout(() => scroller.current && scroller.current.scrollToEnd({ animated: true }), 80);
    if (fromVoice && sessionRef.current) speakAnswer(reply);
  }

  function confirmCredits() {
    if (!creditsPrompt || creditsBusy) return;
    const prompt = creditsPrompt;
    if (prompt.kind === 'ask' && (prompt.libraryCode !== getUid() || prompt.libraryCode !== st.status.uid
      || prompt.scopeRevision !== scopeRevision.current || prompt.scopeSnapshot !== scopeSnapshotRef.current)) {
      setCreditsPromptVisible(false);
      setCreditsPrompt(null);
      setInput(prompt.q);
      setQuotaError('Your library or course scope changed. Review your question and send it again.');
      return;
    }
    setCreditsPromptVisible(false);
    setCreditsBusy(true);
    if (prompt.kind === 'voice-transcription') {
      (async () => {
        try {
          if (prompt.libraryCode !== getUid() || prompt.libraryCode !== st.status.uid) throw new Error('Your library changed. The captured audio was not sent again.');
          const result = await transcribe(prompt.audioUri, { useCredits: true, requestId: prompt.requestId, libraryCode: prompt.libraryCode });
          const words = (result?.segments || []).map((segment) => segment?.x).filter(Boolean).join(' ').trim();
          if (!words) throw new Error('No speech was detected. Please record again or type your question.');
          try { await refreshCreditsAfterAction(prompt.libraryCode); }
          catch { setVoiceError('Audio transcribed, but your Credits balance could not be refreshed yet.'); }
          removeTemporaryAudio(prompt.audioUri);
          setCreditsPrompt(null);
          if (prompt.scopeRevision === scopeRevision.current && prompt.scopeSnapshot === scopeSnapshotRef.current && prompt.libraryCode === getUid()) {
            setInput((current) => appendVoiceTranscript(current, words));
          }
          sessionRef.current = false;
          voiceContextRef.current = null;
          setVoiceSession(false);
        } catch (error) {
          if (isCreditsRequired(error)) {
            setCreditsPrompt({
              ...error, kind: 'voice-transcription', audioUri: prompt.audioUri,
              libraryCode: prompt.libraryCode, scopeRevision: prompt.scopeRevision,
              scopeSnapshot: prompt.scopeSnapshot,
            });
            setCreditsPromptVisible(true);
          } else {
            removeTemporaryAudio(prompt.audioUri);
            setCreditsPrompt(null);
            setVoiceError(`${errMsg(error)} Please record again or type your question.`);
          }
        } finally {
          setCreditsBusy(false);
        }
      })();
      return;
    }
    setCreditsPrompt(null);
    send(prompt.q, false, prompt.focusedEvidence, {
      requestId: prompt.requestId,
      askId: prompt.askId,
    }).finally(() => setCreditsBusy(false));
  }

  function cancelCreditsPrompt() {
    const prompt = creditsPrompt;
    setCreditsPromptVisible(false);
    setCreditsPrompt(null);
    if (prompt?.kind === 'voice-transcription') {
      removeTemporaryAudio(prompt.audioUri);
      sessionRef.current = false;
      voiceContextRef.current = null;
      setVoiceSession(false);
      setVoiceError('No Credits were used. The captured voice audio was discarded.');
    }
  }

  const voiceLabel = voice === 'recording' ? 'Listening…' : voice === 'transcribing' ? 'Transcribing…' : voice === 'thinking' ? 'Thinking…' : voice === 'speaking' ? 'Speaking…' : voice === 'requesting' ? 'Opening microphone…' : voiceSession ? input.trim() ? 'Review question below' : 'Voice conversation active' : 'Start voice conversation';

  if (!askPlanActive) return <ExamFeatureAccessNotice billing={askAccess} requiredPlan="student" />;
  return (
    <>
      <Stack.Screen options={{ title: 'Ask ClassScribe', headerRight: turns.length ? () => <Pressable onPress={() => { endConversation(); showTurns([]); }} hitSlop={8}><Text style={{ color: C.accent, fontSize: 17 }}>New</Text></Pressable> : undefined }} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView ref={scroller} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          {askAccess.status?.plan === 'pro' ? (
            <View style={{ padding: 12, borderRadius: 14, backgroundColor: C.accentSoft }}>
              <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>Pro · Unlimited Ask questions</Text>
            </View>
          ) : askAccess.status?.plan === 'free' ? (
            <View style={{ padding: 12, borderRadius: 14, backgroundColor: C.accentSoft, gap: 5 }}>
              <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>
                {askAccess.status.askCountRemaining > 0 ? 'Free · 1 monthly Ask question for 1 Scribe Credit' : 'Your monthly Free-plan Ask question is used'}
              </Text>
              <Text style={{ color: C.sec, fontSize: 12 }}>
                No upgrade required. You’ll confirm before spending a credit.
                {askAccess.status.askResetAt ? ` Resets ${new Date(askAccess.status.askResetAt).toLocaleDateString()}.` : ''}
              </Text>
              <Pressable onPress={() => router.push('/credits')} accessibilityRole="link">
                <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>View Scribe Credits →</Text>
              </Pressable>
            </View>
          ) : askAccess.status?.plan === 'student' && Number.isFinite(askAccess.status.askCountRemaining) ? (
            <View style={{ padding: 12, borderRadius: 14, backgroundColor: C.accentSoft, gap: 5 }}>
              <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>
                {askAccess.status.askCountRemaining > 0
                  ? `${askAccess.status.askCountRemaining} of 25 monthly Ask questions remaining`
                  : 'Your 25 monthly Ask questions are used'}
              </Text>
              {askAccess.status.askCountRemaining <= 0 ? (
                <>
                  <Text style={{ color: C.sec, fontSize: 12 }}>
                    {askAccess.status.askResetAt ? `Allowance resets ${new Date(askAccess.status.askResetAt).toLocaleDateString()}.` : 'Your monthly allowance will reset at the next billing cycle.'}
                    {' '}Upgrade to Pro for unlimited Ask questions.
                  </Text>
                  <Pressable onPress={() => router.push('/plans')} accessibilityRole="link" accessibilityLabel="View Pro plans">
                    <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>View plans →</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}
          {!turns.length ? (
            <View style={{ gap: 10, marginTop: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 }}>
                <Image source={require('../../../assets/images/katherine-johnson-cartoon.png')} accessibilityLabel="Cartoon portrait of Dr. Katherine Johnson" style={{ width: 66, height: 66 }} resizeMode="contain" />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ color: C.ink, fontSize: 15, fontWeight: '700' }}>Inspired by Dr. Katherine Johnson</Text>
                  <Text style={{ color: C.sec, fontSize: 12 }}>Illustrated tribute. Answers come from ClassScribe AI, not Dr. Johnson.</Text>
                </View>
              </View>
              <Pressable onPress={voice === 'recording' ? () => stopVoice() : startConversation} disabled={voiceSession && voice !== 'recording'} accessibilityRole="button" accessibilityLabel={voice === 'recording' ? 'Finish spoken question' : 'Start voice conversation'} style={{ backgroundColor: C.accentSoft, borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {voice === 'recording' ? <Ionicons name="mic" size={28} color={C.accent} /> : <Image source={require('../../../assets/images/katherine-johnson-avatar.png')} accessible={false} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.cell }} />}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.ink, fontSize: 17, fontWeight: '700' }}>{voiceLabel}</Text>
                   <Text style={{ color: C.sec, fontSize: 13 }}>{voice === 'recording' ? `${Math.round((recording.durationMillis || 0) / 1000)}s · pause after speaking or tap to finish` : voiceSession && input.trim() ? 'Review or edit your question below, then tap Send.' : 'Tap to speak, or type your question below.'}</Text>
                </View>
              </Pressable>
              <Text style={{ color: C.sec, fontSize: 12 }}>Voice audio is sent to your ClassScribe server for transcription.</Text>
            </View>
          ) : null}
          <Text style={{ color: C.sec, fontSize: 13, fontWeight: '600' }}>ANSWER FROM</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {[{ id: 'all', label: 'All courses' }, ...semesterScopes.map((semester) => ({ id: `semester:${semester}`, label: semester })), ...courses.map((course) => ({ id: course.id, label: course.code }))].map((option) => (
              <Pressable key={option.id} onPress={() => changeScope(option.id)} disabled={voiceSession} testID={`ask-scope-${option.id}`} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: selectedScope === option.id ? C.accent : C.cell }} accessibilityRole="button" accessibilityState={{ selected: selectedScope === option.id }}>
                <Text style={{ color: selectedScope === option.id ? C.accentText : C.ink, fontWeight: '600', fontSize: 14 }}>{option.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={{ color: C.sec, fontSize: 13, fontWeight: '600' }}>PASSAGE MATCHING</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[{ value: 'semantic', label: 'Meaning' }, { value: 'keyword', label: 'Keywords' }].map(option => (
              <Pressable key={option.value} disabled={!!busy || voiceSession} onPress={() => setRetrievalMode(option.value)} accessibilityRole="button" accessibilityState={{ selected: retrievalMode === option.value }} testID={`ask-matching-${option.value}`} style={{ padding: 10, borderRadius: 12, backgroundColor: retrievalMode === option.value ? C.accent : C.cell }}>
                <Text style={{ color: retrievalMode === option.value ? '#fff' : C.ink }}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: C.sec, fontSize: 12 }}>Meaning finds synonyms and paraphrases in saved private text. No separate content index or raw audio is stored.</Text>
          {searchCoverage ? <Text accessibilityRole="alert" style={{ color: C.sec, fontSize: 13 }}>{searchCoverage}</Text> : null}
          {!courses.length ? <Text style={{ color: C.sec, fontSize: 13 }}>Add a personal course to search your class materials.</Text> : null}
          {!turns.length ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: C.sec, fontSize: 15 }}>Answers are grounded in your selected course scope. Ask about your own lectures, notes, assignments, class-group material, scores, or practice areas.</Text>
              {sugg.map((q) => <Pressable key={q} onPress={() => send(q)} disabled={voiceSession} style={{ backgroundColor: C.cell, borderRadius: 14, padding: 12 }} accessibilityRole="button"><Text style={{ color: C.accent, fontSize: 15 }}>{q}</Text></Pressable>)}
            </View>
          ) : null}
          {turns.map((t, i) => {
            if (t.role === 'user') return <View key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: C.accent, borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 }}><Text style={{ color: C.accentText, fontSize: 16 }}>{t.content}</Text></View>;
            const review = citedReviewSource(t.content);
            const reviewLabel = review ? review.kind === 'lecture' ? 'Review cited concept' : review.kind === 'note' ? 'Review cited note' : 'Review cited assignment' : '';
            return <View key={i} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '96%' }}>
              <Image source={require('../../../assets/images/katherine-johnson-avatar.png')} accessible={false} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.accentSoft }} />
              <View style={{ flexShrink: 1, backgroundColor: C.cell, borderRadius: 18, borderBottomLeftRadius: 4, padding: 12 }}>
                <Text style={{ color: C.sec, fontSize: 11, fontWeight: '700', marginBottom: 5 }}>ClassScribe AI</Text>
                <Md text={t.content} getLecture={(id) => scopedLectures.find((lecture) => lecture.id === id && (lecture.segs || []).some((segment) => isFiniteRealSeconds(segment.t)))} getNote={(id) => scopedNotes.find((note) => note.id === id)} getAssignment={(id) => scopedAssignments.find((assignment) => assignment.id === id)} strictLectureCitations />
                {review ? <Pressable onPress={() => { const followup = reviewQuestion(review); send(followup.text, false, followup.evidence); }} disabled={!!busy || voiceSession} accessibilityRole="button" accessibilityLabel={reviewLabel} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingTop: 10, opacity: busy || voiceSession ? 0.45 : 1 }}>
                  <Ionicons name="refresh-outline" size={16} color={C.accent} /><Text style={{ color: C.accent, fontWeight: '600', fontSize: 13 }}>{reviewLabel}</Text>
                </Pressable> : null}
                <Pressable onPress={() => speakAnswer(t.content, i)} disabled={voiceSession} accessibilityRole="button" accessibilityLabel={speakingTurn === i ? 'Stop reading answer' : 'Read answer aloud'} hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: 6, opacity: voiceSession ? 0.45 : 1 }}>
                  <Ionicons name={speakingTurn === i ? 'stop-circle-outline' : 'volume-high-outline'} size={19} color={C.accent} />
                </Pressable>
              </View>
            </View>;
          })}
          {busy ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Image source={require('../../../assets/images/katherine-johnson-avatar.png')} accessible={false} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.accentSoft }} /><Text style={{ color: C.sec, fontSize: 14 }}>{busy}</Text></View> : null}
        </ScrollView>
         {voiceSession && turns.length ? <Pressable onPress={voice === 'recording' ? () => stopVoice() : undefined} accessibilityRole="button" accessibilityLabel={voice === 'recording' ? 'Finish spoken question' : voiceLabel} style={{ marginHorizontal: 12, padding: 10, backgroundColor: C.accentSoft, borderRadius: 12 }}><Text style={{ color: C.accent, fontWeight: '600' }}>{voiceLabel}{voice === 'recording' ? ` ${Math.round((recording.durationMillis || 0) / 1000)}s · Tap to finish` : ''}</Text></Pressable> : null}
        {voiceSession ? <Pressable onPress={endConversation} accessibilityRole="button" accessibilityLabel="End voice conversation" style={{ alignSelf: 'center', padding: 6 }}><Text style={{ color: C.rec }}>End voice conversation</Text></Pressable> : null}
        {voiceError ? <View style={{ marginHorizontal: 16, gap: 4 }}><Text style={{ color: C.rec }}>{voiceError}</Text>{openSettings ? <Pressable onPress={() => Linking.openSettings().catch(console.warn)} accessibilityRole="button"><Text style={{ color: C.accent }}>Open Settings</Text></Pressable> : null}</View> : null}
          {quotaError ? <View style={{ marginHorizontal: 16, padding: 12, borderRadius: 12, backgroundColor: C.accentSoft, gap: 6 }}>
            <Text accessibilityRole="alert" style={{ color: C.ink, fontSize: 13, lineHeight: 19 }}>{quotaError} Your question is back in the draft.</Text>
            {askAccess.status?.plan === 'student' ? <Pressable onPress={() => router.push('/plans')} accessibilityRole="link"><Text style={{ color: C.accent, fontWeight: '700' }}>View plans</Text></Pressable> : null}
          </View> : null}
        {voiceSession ? <Text style={{ color: C.sec, marginHorizontal: 16, fontSize: 12 }}>Voice audio is sent for transcription. The microphone stops when you end this conversation or leave Ask.</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, margin: 12, backgroundColor: C.cell, borderRadius: 22, paddingLeft: 14, padding: 4, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8 }}>
           <TextInput value={input} onChangeText={setInput} onSubmitEditing={() => send()} returnKeyType="send" blurOnSubmit={false} editable={voice === 'idle' && !busy} accessibilityLabel="Question" placeholder="Ask about your classes" placeholderTextColor={C.faint} multiline={false} style={{ flex: 1, fontSize: 17, paddingVertical: 8, color: C.ink }} />
          <Pressable onPress={voice === 'recording' ? () => stopVoice() : startConversation} disabled={voiceSession && voice !== 'recording'} accessibilityRole="button" accessibilityLabel={voice === 'recording' ? 'Finish spoken question' : 'Start voice conversation'} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: voice === 'recording' ? C.rec : C.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={voice === 'recording' ? 'stop' : 'mic'} size={19} color={voice === 'recording' ? C.white : C.accent} />
          </Pressable>
           <Pressable onPress={() => send()} disabled={!input.trim() || !!busy || voice !== 'idle'} accessibilityRole="button" accessibilityLabel="Send" style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: input.trim() && !busy && voice === 'idle' ? C.accent : C.fill, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-up" size={20} color={C.accentText} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <CreditsConfirmSheet
        request={creditsPrompt}
        visible={creditsPromptVisible}
        busy={creditsBusy}
        onConfirm={confirmCredits}
        onCancel={cancelCreditsPrompt}
      />
    </>
  );
}
