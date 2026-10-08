import React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../lib/store';
import { missedConceptReview, topicCounts, weakList } from '../lib/logic';
import { C } from '../lib/theme';
import { daysUntil, fmtD, fmtLong, plural, relDue } from '../lib/util';
import { Btn, Empty, Row, Screen, Section, Seg } from '../components/ui';
import { ExamFeatureAccessNotice, useExamFeatureAccess } from '../components/ExamFeatureAccess';
import { COURSE_STUDY_ID, resolveStudyExamId } from '../lib/study-scope';

function Stat({ n, label }) {
  return <View style={{ backgroundColor: C.cell, padding: 12, flexBasis: '33.33%', flexGrow: 1 }}><Text style={{ fontSize: 26, fontWeight: '700', color: C.ink }}>{n}</Text><Text style={{ fontSize: 12, color: C.sec }}>{label}</Text></View>;
}

export default function Exam() {
  const p = useLocalSearchParams();
  const st = useStore();
  const access = useExamFeatureAccess('study');
  const courses = st.courses();
  if (!courses.length) return <Screen>
    <Empty text="Exam Center holds your study guides, flashcards, and quizzes. Add a course and analyze a lecture to get started." />
    <View style={{ marginHorizontal: 16, marginTop: 12 }}><Btn title="Add a course" onPress={() => router.push('/course-new')} /></View>
  </Screen>;
  const upcomingExam = Object.values(st.all('assignments')).filter((a) => (a.type === 'exam' || a.type === 'quiz') && a.due && daysUntil(a.due) >= 0).sort((a, b) => (a.due < b.due ? -1 : 1))[0];
  const cid = p.courseId && st.course(p.courseId) ? p.courseId : upcomingExam ? upcomingExam.courseId : courses[0].id;
  const c = st.course(cid);
  const exams = st.assignmentsOf(cid).filter((a) => (a.type === 'exam' || a.type === 'quiz') && a.due && daysUntil(a.due) >= 0);
  const allCourseLectures = st.lecturesOf(cid);
  const sourceNotes = st.notesOf(cid).filter((note) => ['syllabus', 'reading', 'study-guide'].includes(note.sourceType) && String(note.body || '').trim());
  const courseStudyAvailable = !exams.length && !allCourseLectures.length && sourceNotes.length > 0;
  const examId = resolveStudyExamId({
    requestedExamId: p.examId,
    upcomingExamId: exams[0]?.id,
    hasSources: sourceNotes.length > 0,
    lectureCount: allCourseLectures.length,
  });
  const finalsMode = examId === 'finals';
  const isPro = !access.loading && access.status?.plan === 'pro';
  const studyAllowed = access.allowed && (!finalsMode || isPro);
  const ex = st.all('assignments')[examId];
  const lecs = allCourseLectures.filter((l) => !ex || l.date <= ex.due);
  const an = lecs.filter((l) => l.analysis);
  const topics = topicCounts(an);
  const weak = weakList(st.statsOf(cid));
  const missedReviews = missedConceptReview(st.statsOf(cid), 6);
  const terms = an.reduce((a, l) => a + (l.analysis.terms || []).length, 0);
  const emph = an.reduce((a, l) => a + (l.analysis.emphasized || []).length, 0);
  const forms = an.reduce((a, l) => a + (l.analysis.examples || []).filter((x) => /formula|process/.test(x.kind)).length, 0);
  const mins = Math.round(lecs.reduce((a, l) => a + (l.duration || 0), 0) / 60);
  const maxT = Math.max(1, ...topics.map((t) => t.refs.length));
  const go = (next) => router.setParams(next);
  const scope = { courseId: cid, examId, before: ex ? ex.due : '' };
  const studyScopes = [...exams, ...(courseStudyAvailable ? [{ id: COURSE_STUDY_ID, title: 'Course study' }] : []), { id: 'finals', title: 'Finals Mode' }];

  return (
    <Screen>
      {courses.length <= 3
        ? <Seg style={{ marginTop: 8 }} value={cid} onChange={(v) => go({ courseId: v, examId: '' })} options={courses.map((x) => [x.id, x.code])} />
        : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>{courses.map((x) => <Pressable key={x.id} onPress={() => go({ courseId: x.id, examId: '' })} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, backgroundColor: x.id === cid ? C.accent : C.cell }}><Text style={{ color: x.id === cid ? C.accentText : C.ink, fontWeight: '600' }}>{x.code}</Text></Pressable>)}</ScrollView>}
      <View style={{ marginHorizontal: 16, marginTop: 14, backgroundColor: C.hero, borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: C.heroText, opacity: 0.85, fontSize: 13 }}>{ex ? fmtLong(ex.due) : 'Whole semester'}</Text>
          <Text style={{ color: C.heroText, fontSize: 20, fontWeight: '700' }}>{c.code} · {ex ? ex.title : examId === COURSE_STUDY_ID ? 'Course study' : `Finals Mode${isPro ? '' : ' · Pro'}`}</Text>
        </View>
        {ex ? <Text style={{ color: C.heroText, fontWeight: '700', fontSize: 13, backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, overflow: 'hidden' }}>{relDue(ex.due)}</Text> : null}
      </View>
      <View style={{ marginHorizontal: 16, marginTop: 10, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 11, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep }}>
        <Text style={{ color: C.ink, fontSize: 13, fontWeight: '700' }}>
          {access.loading ? 'Checking your server-confirmed plan…' : access.status ? `Your plan: ${access.status.plan === 'pro' ? 'Pro' : access.status.plan === 'student' ? 'Student' : 'Free'}` : 'Plan access unavailable'}
        </Text>
        <Text style={{ color: C.sec, fontSize: 12, lineHeight: 17, marginTop: 3 }}>
          {access.loading || !access.status
            ? 'Paid exam tools stay locked until your library plan is confirmed.'
            : 'Student and Pro include guides, flashcards, and quizzes. Pro also includes Finals Mode, Teach me, and Weak areas.'}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 10 }}>
        {studyScopes.map((x) => (
          <Pressable key={x.id} onPress={() => x.id === 'finals' && !isPro ? router.push('/plans') : go({ courseId: cid, examId: x.id })} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: x.id === examId ? C.accentSoft : C.cell }}>
            <Text style={{ color: x.id === examId ? C.accent : C.ink, fontWeight: '600', fontSize: 14 }}>{x.title}{x.id === 'finals' && !isPro ? ' · Pro' : ''}{x.due ? ' · ' + fmtD(x.due) : ''}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {(!finalsMode || isPro) ? (
        <>
          <View style={{ marginHorizontal: 16, marginTop: 12, borderRadius: 12, overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap', gap: 1, backgroundColor: C.sep }}>
            <Stat n={`${an.length}/${lecs.length}`} label="Lectures analyzed" /><Stat n={mins} label="Minutes of lecture" /><Stat n={topics.length} label="Core concepts" />
            <Stat n={terms} label="Definitions" /><Stat n={forms} label="Formulas" /><Stat n={emph} label="Emphasized points" />
          </View>
          <Text style={{ marginHorizontal: 20, marginTop: 8, fontSize: 12, color: C.sec, lineHeight: 16 }}>These topics got the most attention in your course materials. ClassScribe can’t know what will be on the exam.</Text>
        </>
      ) : null}

      {studyAllowed ? (
        <Section title="Study">
          <Row icon="book" iconBg={C.accent} title="Study guide" sub={(c.guides || {})[examId] ? 'Ready · tap to open' : sourceNotes.length ? `Generate from ${plural(sourceNotes.length, 'course source')}${lecs.length ? ' and lectures' : ''}` : 'Generate from your lectures'} onPress={() => router.push({ pathname: '/guide', params: scope })} />
          <Row icon="albums" iconBg={C.blue} title="Flashcards" sub={plural(terms, 'card')} onPress={() => router.push({ pathname: '/cards', params: scope })} />
           <Pressable accessibilityRole="button" accessibilityLabel="Study companion. Start a quiz" onPress={() => router.push({ pathname: '/tutor', params: { ...scope, mode: weak.length && isPro ? 'weak' : 'quiz' } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: C.cell }}>
             <Image source={require('../assets/images/terence-tao-avatar.png')} accessible={false} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.accentSoft }} />
             <View style={{ flex: 1, gap: 3 }}>
               <Text style={{ color: C.ink, fontSize: 16, fontWeight: '700' }}>Study companion · Quiz me</Text>
               <Text style={{ color: C.sec, fontSize: 13 }}>One question at a time. See if you’re right and learn the correct answer.</Text>
               <Text style={{ color: C.sec, fontSize: 11 }}>Illustrated tribute to Dr. Terence Tao · ClassScribe AI, not Dr. Tao.</Text>
             </View>
             <Ionicons name="chevron-forward" color={C.sec} size={18} />
           </Pressable>
          {weak.length && !isPro ? <Row icon="bulb" iconBg={C.purple} title="Weak areas tutor · Pro" sub={plural(weak.length, 'concept') + ' to review with the advanced tutor'} onPress={() => router.push('/plans')} last /> : null}
        </Section>
      ) : (
        <Section title="Study">
          <ExamFeatureAccessNotice billing={access} requiredPlan={finalsMode ? 'pro' : 'student'} embedded />
        </Section>
      )}

      {(!finalsMode || isPro) ? (
        <>
          <Section title="Most emphasized">
            {topics.slice(0, 8).map((t, i) => (
              <Pressable key={t.name} onPress={() => router.push({ pathname: '/lecture/[id]', params: { id: t.refs[0].id, tab: 'transcript', t: String(t.refs[0].t) } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: i < Math.min(7, topics.length - 1) ? 0.5 : 0, borderBottomColor: C.sep }}>
                <Text style={{ flex: 1, fontSize: 15, color: C.ink }}>{t.name}</Text>
                <View style={{ width: 90, height: 8, borderRadius: 4, backgroundColor: C.fill, overflow: 'hidden' }}><View style={{ width: `${(t.refs.length / maxT) * 100}%`, height: 8, borderRadius: 4, backgroundColor: t.refs.length === maxT ? C.hi : C.accent }} /></View>
                <Text style={{ width: 74, textAlign: 'right', fontSize: 13, color: C.sec }}>{plural(t.refs.length, 'lecture')}</Text>
              </Pressable>
            ))}
            {!topics.length ? <Row title="Analyze lectures to see topics" last /> : null}
          </Section>

          <Section title="Weak areas" footer="From your flashcards and quizzes.">
            {weak.slice(0, 6).map((w, i) => <Row key={w.concept} title={w.concept} right={<Text style={{ color: C.sec, fontSize: 13 }}>missed {w.w} of {w.w + w.r}</Text>} last={i === Math.min(5, weak.length - 1)} />)}
            {!weak.length ? <Row title="No missed-concept practice results recorded yet" last /> : null}
          </Section>
          {missedReviews.length ? (
            <Section title="Missed concepts · practical review">
              {missedReviews.map((item, index) => (
                <View key={item.concept} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: index < missedReviews.length - 1 ? 0.5 : 0, borderBottomColor: C.sep, gap: 5 }}>
                  <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{item.concept}</Text>
                  <Text style={{ color: C.sec, fontSize: 12 }}>Missed {item.missed} of {item.attempts} recorded practice attempts</Text>
                  {item.steps.map((step) => <Text key={step} style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>• {step}</Text>)}
                </View>
              ))}
            </Section>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
