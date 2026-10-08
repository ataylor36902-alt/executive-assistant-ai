import React from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../lib/store';
import { sharedCache } from '../../lib/shared';
import { C } from '../../lib/theme';
import { fmtD, fmtLong, fmtT } from '../../lib/util';
import { Btn, Card, Empty, Screen, s } from '../../components/ui';

function Bullets({ items }) {
  return items.map((t, i) => <View key={i} style={{ flexDirection: 'row', gap: 8 }}><Text style={{ color: C.accent, fontWeight: '800' }}>•</Text><Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: C.ink }}>{t}</Text></View>);
}
function Box({ title, children }) {
  return <Card><Text style={s.label}>{title}</Text>{children}</Card>;
}

export default function CatchUp() {
  const { id } = useLocalSearchParams();
  const st = useStore();
  const l = st.lecture(id) || sharedCache.get(id);
  if (!l) return <Empty text="This lecture is no longer shared." />;
  const c = st.course(l.courseId) || { code: l.courseCode || '', professor: l.professor };
  const a = l.analysis;
  return (
    <Screen>
      <View style={{ paddingHorizontal: 20, gap: 6, paddingTop: 4 }}>
        <Text style={{ color: C.sec, fontSize: 13 }}>{c.code || ''} · {fmtLong(l.date)}{l.sharedCopy ? ' · shared by a classmate' : ''}</Text>
        <Text style={s.h1}>{l.title}</Text>
      </View>
      {a ? (
        <>
          <Box title="What happened today"><Text style={{ fontSize: 15, lineHeight: 21, color: C.ink }}>{a.summary}</Text></Box>
          {(a.keyPoints || []).length ? <Box title="What you need to know"><Bullets items={a.keyPoints} /></Box> : null}
          {(a.assignments || []).length ? <Box title="Assignments mentioned"><Bullets items={a.assignments.map((x) => x.title + (x.due ? ' · due ' + fmtD(x.due) : ''))} /></Box> : null}
          {(a.announcements || []).length ? <Box title="Announcements"><Bullets items={a.announcements} /></Box> : null}
          {(a.emphasized || []).length ? <Box title="Review before next class"><Bullets items={a.emphasized.map((e) => `${e.concept} (${fmtT(e.t)}) — ${e.why}`)} /></Box> : null}
          {(a.studentQuestions || []).length ? <Box title="Questions students asked"><Bullets items={a.studentQuestions.map((q) => q.q)} /></Box> : null}
        </>
      ) : <Empty text="This lecture hasn’t been analyzed yet. Open it and choose Analyze." />}
      <View style={{ margin: 16, gap: 10 }}>
        <Btn title="Teach me today’s lecture" icon="bulb" onPress={() => router.push({ pathname: '/tutor', params: { courseId: l.courseId || '', lectureIds: l.id, mode: 'teach' } })} />
        <Btn title="Open transcript" kind="secondary" onPress={() => router.push({ pathname: '/lecture/[id]', params: { id: l.id, tab: 'transcript' } })} />
      </View>
    </Screen>
  );
}
