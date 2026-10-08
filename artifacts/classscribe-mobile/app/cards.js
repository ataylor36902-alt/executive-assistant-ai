import React, { useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { Alert } from '../lib/notify';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStore } from '../lib/store';
import { studyAI, errMsg } from '../lib/api';
import { material, weakList } from '../lib/logic';
import { C } from '../lib/theme';
import { fmtD, fmtT } from '../lib/util';
import { Btn, Empty } from '../components/ui';
import { ExamFeatureAccessNotice, useExamFeatureAccess } from '../components/ExamFeatureAccess';
import { isFinalsStudy } from '../lib/study-scope';

export default function Cards() {
  const p = useLocalSearchParams();
  const st = useStore();
  const finalsMode = isFinalsStudy({ examId: p.examId, lectureIds: p.lectureIds, before: p.before });
  const access = useExamFeatureAccess('study', finalsMode);
  const lecs = p.lectureIds ? String(p.lectureIds).split(',').map(st.lecture).filter(Boolean) : st.lecturesOf(p.courseId).filter((l) => !p.before || l.date <= p.before);
  const courseIds = new Set(lecs.map((lecture) => lecture.courseId).concat(p.courseId || []).filter(Boolean));
  const sourceNotes = st.notesOf().filter((note) => courseIds.has(note.courseId) && ['syllabus', 'reading', 'study-guide'].includes(note.sourceType));
  const [deck, setDeck] = useState(() => {
    const d = [];
    lecs.forEach((l) => ((l.analysis && l.analysis.terms) || []).forEach((t) => d.push({ front: t.term, back: t.def, concept: t.term, lid: l.id, t: t.t, cid: l.courseId })));
    return d;
  });
  const [i, setI] = useState(0);
  const [score, setScore] = useState({ got: 0, miss: 0 });
  const [busy, setBusy] = useState(false);
  const [flip] = useState(() => new Animated.Value(0));
  const [flipped, setFlipped] = useState(false);

  if (!access.allowed) return <ExamFeatureAccessNotice billing={access} requiredPlan={access.requiredPlan} />;

  function turn() {
    Animated.spring(flip, { toValue: flipped ? 0 : 180, useNativeDriver: true, friction: 8 }).start();
    setFlipped(!flipped);
  }
  function answer(ok) {
    const card = deck[i];
    st.record(card.cid || p.courseId, card.concept, ok);
    Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setScore((sc) => ({ got: sc.got + (ok ? 1 : 0), miss: sc.miss + (ok ? 0 : 1) }));
    setDeck((d) => d.map((x, k) => (k === i ? { ...x, missed: !ok } : x)));
    flip.setValue(0); setFlipped(false); setI(i + 1);
    if (i + 1 >= deck.length) st.markReviewed(lecs.map((l) => l.id));
  }
  async function more() {
    setBusy(true);
    try {
      const weak = weakList(st.statsOf(p.courseId)).map((w) => w.concept);
      const r = await studyAI('cards', { material: material(lecs, sourceNotes, 20000, st.course), focus: weak.join(', '), avoid: deck.map((c) => c.front).join('; ').slice(0, 2000) });
      const add = (r.cards || []).filter((c) => c.front && c.back).map((c) => ({ front: c.front, back: c.back, concept: c.concept || c.front, lid: st.lecture(c.lectureId) ? c.lectureId : null, t: c.t, cid: p.courseId }));
      setDeck((d) => [...d.slice(0, i), ...add, ...d.slice(i)]);
    } catch (e) { Alert.alert('Couldn’t make cards', errMsg(e)); }
    setBusy(false);
  }

  if (!deck.length) return <Empty text="No cards yet. Analyze a lecture or add a course source, then generate cards with AI."><Btn title="Generate cards with AI" icon="sparkles" small busy={busy} onPress={more} /></Empty>;
  if (i >= deck.length) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 24, justifyContent: 'center', gap: 14 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', textAlign: 'center', color: C.ink }}>Deck complete</Text>
        <Text style={{ fontSize: 17, color: C.sec, textAlign: 'center' }}>You knew {score.got} of {deck.length}.{score.miss ? ` ${score.miss} went to your weak areas.` : ''}</Text>
        <Btn title="Study again" onPress={() => { setI(0); setScore({ got: 0, miss: 0 }); }} />
        {score.miss ? <Btn title="Review missed only" kind="secondary" onPress={() => { setDeck(deck.filter((c) => c.missed)); setI(0); setScore({ got: 0, miss: 0 }); }} /> : null}
      </View>
    );
  }
  const card = deck[i];
  const front = flip.interpolate({ inputRange: [0, 180], outputRange: ['0deg', '180deg'] });
  const back = flip.interpolate({ inputRange: [0, 180], outputRange: ['180deg', '360deg'] });
  const face = { position: 'absolute', width: '100%', height: '100%', backfaceVisibility: 'hidden', borderRadius: 20, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 10, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 };
  const lec = card.lid && st.lecture(card.lid);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, padding: 16, gap: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: C.sec }}>Card {i + 1} of {deck.length}</Text><Text style={{ color: C.sec }}>✓ {score.got} · ✗ {score.miss}</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: C.fill }}><View style={{ height: 6, borderRadius: 3, backgroundColor: C.accent, width: `${(i / deck.length) * 100}%` }} /></View>
      <Pressable onPress={turn} accessibilityRole="button" accessibilityLabel={flipped ? card.back : `${card.front}. Tap to reveal.`} style={{ height: 320 }}>
        <Animated.View style={[face, { backgroundColor: C.cell, transform: [{ perspective: 1000 }, { rotateY: front }] }]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.sec, letterSpacing: 0.6 }}>TERM</Text>
          <Text style={{ fontSize: 26, fontWeight: '700', textAlign: 'center', color: C.ink }}>{card.front}</Text>
          <Text style={{ fontSize: 13, color: C.faint }}>Tap to flip</Text>
        </Animated.View>
        <Animated.View style={[face, { backgroundColor: C.cell, transform: [{ perspective: 1000 }, { rotateY: back }] }]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.sec, letterSpacing: 0.6 }}>ANSWER</Text>
          <Text style={{ fontSize: 19, textAlign: 'center', lineHeight: 26, color: C.ink }}>{card.back}</Text>
          {lec ? <Text style={{ fontSize: 13, color: C.accent }}>{fmtD(lec.date)} · {fmtT(card.t)}</Text> : null}
        </Animated.View>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Btn title="Missed it" kind="secondary" icon="close" style={{ flex: 1, backgroundColor: C.recSoft }} onPress={() => answer(false)} />
        <Btn title="Got it" icon="checkmark" style={{ flex: 1 }} onPress={() => answer(true)} />
      </View>
      <Btn title="Generate more cards with AI" kind="plain" small icon="sparkles" busy={busy} onPress={more} />
    </View>
  );
}
