import React, { useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../lib/store';
import { studyAI, errMsg, getUid, health } from '../lib/api';
import { localGuide, material, weakList } from '../lib/logic';
import { C } from '../lib/theme';
import { daysUntil, fmtD, plural, nowMs } from '../lib/util';
import { Btn, Card, Empty, Md, Row, Screen, Section } from '../components/ui';
import { ExamFeatureAccessNotice, useExamFeatureAccess } from '../components/ExamFeatureAccess';
import { isFinalsStudy } from '../lib/study-scope';
import { CreditsConfirmSheet } from '../components/CreditsConfirmSheet';
import { isCreditsRequired, refreshCreditsAfterAction } from '../lib/credits-actions';

export default function Guide() {
  const p = useLocalSearchParams();
  const st = useStore();
  const finalsMode = isFinalsStudy({ examId: p.examId });
  const access = useExamFeatureAccess('study', finalsMode);
  const c = st.course(p.courseId);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [creditsPrompt, setCreditsPrompt] = useState(null);
  const [creditsPromptVisible, setCreditsPromptVisible] = useState(false);
  if (!c) return <Empty text="Pick a course in Exam Center first." />;
  const ex = st.all('assignments')[p.examId];
  const key = p.examId || 'finals';
  const lecs = st.lecturesOf(c.id).filter((l) => !ex || l.date <= ex.due);
  const notes = st.notesOf(c.id);
  const sourceNotes = notes.filter((n) => ['syllabus', 'reading', 'study-guide'].includes(n.sourceType) && String(n.body || '').trim());
  const guide = (c.guides || {})[key];
  const missedReviews = weakList(typeof st.statsOf === 'function' ? st.statsOf(c.id) : null).slice(0, 6).map((item) => ({
    concept: item.concept,
    missed: Number(item.w) || 0,
    attempts: (Number(item.w) || 0) + (Number(item.r) || 0),
    steps: [
      `Revisit the selected course material on ${item.concept} and write a one-sentence explanation from it.`,
      `Work through one relevant example or explain how ${item.concept} applies to a problem in your course.`,
      `Close your notes and recall the key idea; then retry a practice question and track the result.`,
    ],
  }));

  if (!access.allowed) return <ExamFeatureAccessNotice billing={access} requiredPlan={access.requiredPlan} />;

  async function generate(confirmed = null) {
    if (!confirmed && !lecs.some((l) => l.analysis) && !sourceNotes.length) { setNote('Add a course source or analyze a lecture before generating a study guide.'); return; }
    setBusy(true); setNote('');
    const weak = weakList(st.statsOf(c.id));
    const requestLibrary = confirmed?.libraryCode || st.status.uid;
    if (!requestLibrary || requestLibrary !== getUid()) {
      setNote('Your library changed. Reopen the study guide before using Credits.');
      setBusy(false);
      return;
    }
    let text = ''; let usedAI = false;
    const body = confirmed?.body || {
      material: material(lecs, notes, 40000, st.course),
      focus: `${c.code} ${c.name} · ${ex ? ex.title : 'course study'}; missed concepts: ${weak.map(w => w.concept).join(', ')}`.slice(0, 1000),
      days: ex ? Math.min(60, Math.max(1, daysUntil(ex.due))) : 14,
    };
    const info = confirmed || await health();
    if (info && (confirmed || info.ai)) {
      try {
        const result = await studyAI('guide', {
          ...body,
          ...(confirmed ? { useCredits: true, requestId: confirmed.request.requestId } : {}),
        });
        if (requestLibrary !== getUid()) throw { code: 'library_changed', message: 'Your library changed while the guide was being generated. Reopen this course to continue.' };
        text = result.text;
        usedAI = true;
        if (confirmed) {
          try {
            const update = await refreshCreditsAfterAction(requestLibrary);
            if (update.warning) setNote(update.warning);
          } catch {
            setNote('The guide was generated, but your Credits balance could not be refreshed yet.');
          }
        }
      } catch (e) {
        if (isCreditsRequired(e)) {
          setCreditsPrompt({ ...e, body, libraryCode: requestLibrary });
          setCreditsPromptVisible(true);
          setBusy(false);
          return;
        }
        if (confirmed) {
          setNote(errMsg(e));
          setBusy(false);
          return;
        }
        if (e?.code === 'paid_required' || e?.code === 'not_granted') {
          setNote(errMsg(e));
          setBusy(false);
          return;
        }
        setNote(errMsg(e) + ' Built it from your available course materials instead.');
      }
    }
    if (!text) text = localGuide(c, ex, lecs, weak, notes);
    await st.put('courses', { ...c, guides: { ...(c.guides || {}), [key]: { text, at: nowMs(), ai: usedAI } } });
    setBusy(false);
  }

  function confirmCredits() {
    if (!creditsPrompt) return;
    if (creditsPrompt.libraryCode !== getUid() || creditsPrompt.libraryCode !== st.status.uid) {
      setCreditsPromptVisible(false);
      setCreditsPrompt(null);
      setNote('Your library changed. Reopen the study guide and try again.');
      return;
    }
    const { body, ...request } = creditsPrompt;
    setCreditsPromptVisible(false);
    generate({ body, request });
  }

  return (
    <>
      <Stack.Screen options={{ headerRight: guide ? () => <Pressable onPress={() => Share.share({ message: `${c.code} study guide\n\n${guide.text.replace(/\[\[[\w-]+@[\d.]+\]\]/g, '')}` })} accessibilityLabel="Share study guide" hitSlop={8}><Ionicons name="share-outline" size={24} color={C.accent} /></Pressable> : undefined }} />
      <Screen>
        <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 4 }}>
          <Text style={{ color: C.sec, fontSize: 13 }}>{c.code} · {ex ? `${ex.title} · ${fmtD(ex.due)}` : 'Finals Mode'}</Text>
          <Text style={{ fontSize: 28, fontWeight: '700', color: C.ink }}>Study guide</Text>
        </View>
        {!guide ? (
          <>
            <Section title="Covers">
              <Row icon="book" iconBg={C.blue} title={plural(lecs.length, 'lecture')} sub={`${lecs.filter((l) => l.analysis).length} analyzed`} />
              <Row icon="document-text-outline" iconBg={C.accent} title={plural(sourceNotes.length, 'imported course source')} sub={sourceNotes.map((source) => source.title).join(' · ') || 'Syllabus, readings, or study guides'} />
              <Row icon="create" iconBg={C.sec} title={plural(notes.length, 'of your notes', 'of your notes')} last />
            </Section>
            <View style={{ margin: 16, gap: 8 }}>
              <Btn title="Generate study guide" icon="sparkles" busy={busy} onPress={generate} />
              <Text style={{ fontSize: 12, color: C.sec, textAlign: 'center' }}>Uses AI when your server has it; otherwise builds a guide from available course materials.</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={{ marginHorizontal: 20, marginTop: 6, fontSize: 13, color: C.sec }}>{guide.ai ? 'Written with AI' : 'Built from your course materials'} · {new Date(guide.at).toLocaleDateString()}</Text>
            <Card><Md text={guide.text} getLecture={(id) => lecs.find((lecture) => lecture.id === id)} /></Card>
            {missedReviews.length ? (
              <Section title="Your missed concepts · review steps">
                {missedReviews.map((item, index) => (
                  <View key={item.concept} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: index < missedReviews.length - 1 ? 0.5 : 0, borderBottomColor: C.sep, gap: 5 }}>
                    <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{item.concept}</Text>
                    <Text style={{ color: C.sec, fontSize: 12 }}>Missed {item.missed} of {item.attempts} recorded practice attempts</Text>
                    {item.steps.map((step) => <Text key={step} style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>• {step}</Text>)}
                  </View>
                ))}
              </Section>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, margin: 16 }}>
              <Btn title="Regenerate" kind="secondary" style={{ flex: 1 }} busy={busy} onPress={generate} />
              <Btn title="Quiz me on this" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/tutor', params: { courseId: c.id, examId: key, before: ex ? ex.due : '', mode: 'quiz' } })} />
            </View>
          </>
        )}
        {note ? <Text style={{ marginHorizontal: 20, color: C.rec }}>{note}</Text> : null}
      </Screen>
      <CreditsConfirmSheet
        request={creditsPrompt}
        visible={creditsPromptVisible}
        busy={busy}
        onConfirm={confirmCredits}
        onCancel={() => { setCreditsPromptVisible(false); setCreditsPrompt(null); }}
      />
    </>
  );
}
