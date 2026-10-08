import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Alert } from '../../lib/notify';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../lib/store';
import { fmtClock, MEET_TYPES, meetingsText, parseClock, WEEK } from '../../lib/schedule';
import { C } from '../../lib/theme';
import { Btn, Empty, Screen, s } from '../../components/ui';
import { goBack } from '../../components/BackButton';

const blank = () => ({ days: [], start: '', end: '', location: '', type: 'Lecture' });

export default function CourseTimes() {
  const { id } = useLocalSearchParams();
  const st = useStore();
  const c = st.course(id);
  const [rows, setRows] = useState(() => (c && (c.meetings || []).length ? c.meetings.map((m) => ({ ...m, start: fmtClock(m.start), end: fmtClock(m.end) })) : [blank()]));
  if (!c) return <Empty text="This course isn’t in your library." />;
  const upd = (i, patch) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  if (c.ex) return <>
    <Stack.Screen options={{ title: `${c.code} class times` }} />
    <Screen style={{ padding: 16, gap: 12 }}>
      {(c.meetings || []).length
        ? meetingsText(c).map((meeting, i) => <Text key={i} style={{ color: C.ink, backgroundColor: C.cell, borderRadius: 12, padding: 14, fontSize: 15, lineHeight: 22 }}>{meeting}</Text>)
        : <Text style={{ color: C.sec, fontSize: 15 }}>No class times yet.</Text>}
    </Screen>
  </>;

  function save() {
    const out = [];
    for (const r of rows) {
      if (!r.days.length && !r.start) continue;
      const start = parseClock(r.start), end = r.end ? parseClock(r.end) : '';
      if (!r.days.length || !start) return Alert.alert('Check the times', 'Each class time needs at least one day and a start time like 9:00 AM.');
      if (r.end && !end) return Alert.alert('Check the end time', `“${r.end}” isn’t a time. Try 9:50 AM.`);
      out.push({ days: WEEK.filter((d) => r.days.includes(d)), start, end, location: r.location.trim(), type: r.type });
    }
    st.put('courses', { ...c, meetings: out });
    goBack(`/course/${id}`);
  }

  return (
    <>
      <Stack.Screen options={{ title: `${c.code} class times` }} />
      <Screen style={{ padding: 16, gap: 14 }}>
        {rows.map((r, i) => (
          <View key={i} style={{ backgroundColor: C.cell, borderRadius: 14, padding: 14, gap: 12 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[...WEEK.slice(1), 'Sun'].map((d) => {
                const on = r.days.includes(d);
                return <Pressable key={d} onPress={() => upd(i, { days: on ? r.days.filter((x) => x !== d) : [...r.days, d] })} accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={{ width: 44, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.accent : C.fill }}><Text style={{ color: on ? C.accentText : C.ink, fontWeight: '600' }}>{d}</Text></Pressable>;
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, gap: 6 }}><Text style={s.label}>Starts</Text><TextInput value={r.start} onChangeText={(v) => upd(i, { start: v })} placeholder="9:00 AM" placeholderTextColor={C.faint} style={[s.input, { backgroundColor: C.bg }]} /></View>
              <View style={{ flex: 1, gap: 6 }}><Text style={s.label}>Ends</Text><TextInput value={r.end} onChangeText={(v) => upd(i, { end: v })} placeholder="9:50 AM" placeholderTextColor={C.faint} style={[s.input, { backgroundColor: C.bg }]} /></View>
            </View>
            <TextInput value={r.location} onChangeText={(v) => upd(i, { location: v })} placeholder="Room, e.g. Science Hall 101" placeholderTextColor={C.faint} style={[s.input, { backgroundColor: C.bg }]} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {MEET_TYPES.slice(0, 4).map((t) => <Pressable key={t} onPress={() => upd(i, { type: t })} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, backgroundColor: r.type === t ? C.accentSoft : C.fill }}><Text style={{ color: r.type === t ? C.accent : C.ink, fontWeight: '600', fontSize: 13 }}>{t}</Text></Pressable>)}
            </View>
            {rows.length > 1 ? <Btn title="Remove this time" kind="plain" small onPress={() => setRows(rows.filter((_, k) => k !== i))} /> : null}
          </View>
        ))}
        <Btn title="Add another time" kind="secondary" icon="add" onPress={() => setRows([...rows, blank()])} />
        <Btn title="Save class times" onPress={save} />
      </Screen>
    </>
  );
}
