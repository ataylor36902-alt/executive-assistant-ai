import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../lib/store';
import { ai, studyAI, errMsg, getUid } from '../lib/api';
import { companionResult, material, missedConceptReview, weakList } from '../lib/logic';
import { C } from '../lib/theme';
import { plural } from '../lib/util';
import { Btn, Md } from '../components/ui';
import { ExamFeatureAccessNotice, useExamFeatureAccess } from '../components/ExamFeatureAccess';
import { isFinalsStudy } from '../lib/study-scope';

export default function Tutor() {
  const p = useLocalSearchParams();
  const st = useStore();
  const requestedCourseId = Array.isArray(p.courseId) ? p.courseId[0] : p.courseId;
  const selectedCourse = st.courses().find((course) => !course.ex && course.id === requestedCourseId);
  const courseId = selectedCourse?.id || '';
  const scopedLectureIds = new Set(courseId ? st.lecturesOf(courseId).map((lecture) => lecture.id) : []);
  const missedReviews = missedConceptReview(courseId ? st.statsOf(courseId) : null, 6);
  const lecs = courseId
    ? p.lectureIds
      ? String(p.lectureIds).split(',').filter((id) => scopedLectureIds.has(id)).map((id) => st.lecture(id)).filter(Boolean)
      : st.lecturesOf(courseId).filter((l) => !p.before || l.date <= p.before)
    : [];
  const courseNotes = courseId ? st.notesOf(courseId) : [];
  const sourceNotes = courseNotes.filter((note) => ['syllabus', 'reading', 'study-guide'].includes(note.sourceType) && String(note.body || '').trim());
  const weak = weakList(courseId ? st.statsOf(courseId) : null).map((w) => w.concept);
  const [turns, setTurns] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState({ r: 0, w: 0 });
  const scroller = useRef(null);
  const busyRef = useRef(false);
  const requestSequence = useRef(0);
  const requestController = useRef(null);
  const answerSequence = useRef(0);
  const processedAnswers = useRef(new Set());
  const contextKey = JSON.stringify([st.status.uid, getUid(), courseId, p.mode || 'quiz', lecs.map((lecture) => lecture.id)]);
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;
  const observedContext = useRef(contextKey);
  useEffect(() => {
    if (observedContext.current === contextKey) return;
    observedContext.current = contextKey;
    requestSequence.current++;
    requestController.current?.abort();
    requestController.current = null;
    busyRef.current = false;
    processedAnswers.current.clear();
    setBusy(false);
    setTurns([]);
    setInput('');
    setScore({ r: 0, w: 0 });
  }, [contextKey]);
  const mode = p.mode || 'quiz';
  const finalsMode = isFinalsStudy({ examId: p.examId, lectureIds: p.lectureIds, before: p.before });
  const advancedMode = mode === 'teach' || mode === 'weak';
  const access = useExamFeatureAccess(advancedMode ? 'advanced' : 'study', finalsMode);
  const title = mode === 'teach' ? 'Teach me' : mode === 'weak' ? 'Weak areas' : 'Quiz me';

  useFocusEffect(useCallback(() => () => {
    requestSequence.current++;
    requestController.current?.abort();
    requestController.current = null;
    busyRef.current = false;
    setBusy(false);
  }, []));

  async function run(next, answerId = null) {
    if (busyRef.current) return;
    const requestId = ++requestSequence.current;
    const requestUid = getUid();
    const requestCourseId = courseId;
    const requestContext = contextKey;
    if (!requestUid || requestUid !== st.status.uid) {
      setTurns([...next, { role: 'assistant', content: 'Your library is switching. Reopen this tutor in the current library before continuing.', shown: 'Your library is switching. Reopen this tutor in the current library before continuing.', error: true }]);
      return;
    }
    const controller = new AbortController();
    requestController.current = controller;
    const isCurrentRequest = () => requestId === requestSequence.current
      && requestUid === getUid()
      && requestCourseId === courseId
      && requestContext === contextRef.current;
    const assertCurrent = () => {
      if (!isCurrentRequest()) throw { code: 'cancelled', message: 'The tutor reply was cancelled because its course or library changed.' };
    };
    busyRef.current = true;
    setBusy(true); setTurns(next);
    try {
      const courseMaterial = material(lecs, courseNotes, 24000, st.course);
      const r = advancedMode ? await ai(next.map(t => ({ role: t.role, content: t.content })), { signal: controller.signal, assertCurrent }) : await studyAI('companion', {
        material: courseMaterial,
        replies: next.filter(t => t.role === 'assistant').map(t => t.shown || t.content).slice(-20),
        answers: next.filter(t => t.role === 'user').slice(0, -1).map(t => t.content).slice(-20),
        answer: answerId === null ? '' : next[next.length - 1].content,
      }, controller.signal);
      assertCurrent();
      if (!isCurrentRequest()) return;
      const result = companionResult(r.text, answerId !== null ? next[next.length - 1].content : null, courseMaterial);
      const grade = answerId !== null && !processedAnswers.current.has(answerId) ? result.grade : null;
      if (grade) {
        processedAnswers.current.add(answerId);
        if (requestCourseId) st.record(requestCourseId, grade.concept, grade.correct);
        setScore((sc) => ({ r: sc.r + Number(grade.correct), w: sc.w + Number(!grade.correct) }));
      }
      setTurns([...next, { role: 'assistant', content: r.text, shown: result.shown }]);
      st.markReviewed(lecs.filter((l) => st.isMine(l) && l.courseId === courseId).map((l) => l.id));
    } catch (e) {
      if (isCurrentRequest()) setTurns([...next, { role: 'assistant', content: errMsg(e), shown: errMsg(e), error: true }]);
    } finally {
      if (requestId === requestSequence.current) {
        requestController.current = null;
        setBusy(false);
        busyRef.current = false;
        setTimeout(() => scroller.current && scroller.current.scrollToEnd({ animated: true }), 80);
      }
    }
  }
  function start() {
    if (advancedMode) {
      const intro = mode === 'teach' ? 'Teach this material in 4-6 short parts, checking understanding after each part.' : `Quiz weak areas: ${weak.join(', ')}`;
      run([{ role: 'user', content: `You are ClassScribe's course tutor. Use ONLY the selected course material. ${intro} Ask one question at a time, wait for an answer, then start with Correct. or Incorrect., give "Correct answer: ..." and explain why. Append <<result concept="short concept name" correct="yes">> or <<result concept="short concept name" correct="no">> only after grading.\n\nMATERIAL:${material(lecs, courseNotes, 24000, st.course)}`, hidden: true }]);
    } else run([]);
  }
  function send() {
    const t = input.trim(); if (!t || busyRef.current) return;
    setInput(''); run([...turns.filter((x) => !x.error), { role: 'user', content: t }], ++answerSequence.current);
  }

  if (!access.allowed) return <ExamFeatureAccessNotice billing={access} requiredPlan={access.requiredPlan} />;

  return (
    <>
      <Stack.Screen options={{ title, headerRight: () => <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} accessibilityLabel={`${score.r} correct, ${score.w} incorrect`} style={{ color: C.sec, fontWeight: '600', maxWidth: 90 }}>✓ {score.r}  ✗ {score.w}</Text> }} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView ref={scroller} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 12 }}>
          {!turns.length ? (
            <View style={{ backgroundColor: C.cell, borderRadius: 14, padding: 16, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Image source={require('../assets/images/terence-tao-cartoon.png')} accessibilityLabel="Cartoon portrait inspired by Dr. Terence Tao" resizeMode="contain" style={{ width: 72, height: 72 }} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink }}>Your study companion</Text>
                  <Text style={{ fontSize: 12, color: C.sec }}>Inspired by Dr. Terence Tao. An illustrated tribute; ClassScribe AI asks and answers, not Dr. Tao.</Text>
                </View>
              </View>
              <Text style={{ fontSize: 16, lineHeight: 22, color: C.ink }}>{mode === 'teach' ? 'Work through the lecture in short parts, then check your understanding.' : 'Answer one question at a time. Get a correct or incorrect result, the correct answer, and an explanation. Missed concepts go to your weak areas.'}</Text>
              <Text style={{ fontSize: 13, color: C.sec }}>Using {plural(lecs.length, 'lecture')}{sourceNotes.length ? ` and ${plural(sourceNotes.length, 'course source')}` : ''}.</Text>
              <Btn title="Start questions" icon="play" onPress={start} disabled={!lecs.length && !sourceNotes.length} />
            </View>
          ) : null}
          {turns.filter((t) => !t.hidden).map((t, i) => t.role === 'user'
            ? <View key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: C.accent, borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 }}><Text style={{ color: C.accentText, fontSize: 16 }}>{t.content}</Text></View>
            : <View key={i} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '96%' }}>
              <Image source={require('../assets/images/terence-tao-avatar.png')} accessible={false} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.accentSoft }} />
              <View style={{ flexShrink: 1, backgroundColor: C.cell, borderRadius: 18, borderBottomLeftRadius: 4, padding: 12 }}>
                <Text style={{ color: C.sec, fontSize: 11, fontWeight: '700', marginBottom: 5 }}>ClassScribe study companion</Text>
                <Md text={t.shown} getLecture={(id) => lecs.find((lecture) => lecture.id === id)} />
              </View>
            </View>)}
          {turns.length > 1 ? (
            <View style={{ backgroundColor: C.cell, borderRadius: 14, padding: 14, gap: 8 }}>
              <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{missedReviews.length ? 'Missed concepts to review' : 'Practice review'}</Text>
              {missedReviews.map((item) => (
                <View key={item.concept} style={{ gap: 3 }}>
                  <Text style={{ color: C.ink, fontWeight: '600' }}>{item.concept} · missed {item.missed} of {item.attempts} recorded attempts</Text>
                  <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>{item.steps.join(' ')}</Text>
                </View>
              ))}
              {!missedReviews.length ? <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>No missed-concept practice results are recorded for this course yet.</Text> : null}
            </View>
          ) : null}
           {busy ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Image source={require('../assets/images/terence-tao-avatar.png')} accessible={false} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.accentSoft }} /><Text style={{ color: C.sec }}>Thinking…</Text></View> : null}
        </ScrollView>
        {turns.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, margin: 12, marginBottom: 28, backgroundColor: C.cell, borderRadius: 22, paddingLeft: 14, padding: 4 }}>
            <TextInput value={input} onChangeText={setInput} onSubmitEditing={send} returnKeyType="send" blurOnSubmit={false} editable={!busy} placeholder="Your answer" placeholderTextColor={C.faint} multiline={false} style={{ flex: 1, fontSize: 17, paddingVertical: 8, color: C.ink }} />
            <Pressable onPress={send} disabled={!input.trim() || busy} accessibilityLabel="Send" style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: input.trim() && !busy ? C.accent : C.fill, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="arrow-up" size={20} color={input.trim() && !busy ? C.accentText : C.sec} /></Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </>
  );
}
