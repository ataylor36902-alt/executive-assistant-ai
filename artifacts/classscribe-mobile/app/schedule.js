import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../lib/store';
import { classesOn, fmtRange, WEEK, WEEK_LONG } from '../lib/schedule';
import { C, courseColor, mono } from '../lib/theme';
import { plural } from '../lib/util';
import { Btn, Chip, Empty, Row, Screen, Section } from '../components/ui';

export default function Schedule() {
  const st = useStore();
  const courses = st.courses();
  const now = new Date();
  const [day, setDay] = useState(now.getDay());
  const date = new Date(); date.setDate(date.getDate() + ((day - now.getDay() + 7) % 7));
  const list = classesOn(courses, date);
  const isToday = day === now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const noTimes = courses.filter((c) => !(c.meetings || []).length);
  const countFor = (i) => { const d = new Date(); d.setDate(d.getDate() + ((i - now.getDay() + 7) % 7)); return classesOn(courses, d).length; };

  return (
    <>
      <Stack.Screen options={{ title: isToday ? 'Today' : WEEK_LONG[day], headerRight: () => <Pressable onPress={() => router.push('/schedule-import')} accessibilityLabel="Scan or upload schedule" hitSlop={8}><Ionicons name="scan-outline" size={25} color={C.accent} /></Pressable> }} />
      <Screen>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
          {[1, 2, 3, 4, 5, 6, 0].map((i) => (
            <Pressable key={i} onPress={() => setDay(i)} accessibilityRole="button" accessibilityState={{ selected: i === day }}
              style={{ width: 52, paddingVertical: 8, borderRadius: 12, alignItems: 'center', backgroundColor: i === day ? C.accent : C.cell }}>
              <Text style={{ color: i === day ? C.accentText : C.ink, fontWeight: '700' }}>{WEEK[i]}</Text>
              <Text style={{ color: i === day ? C.accentText : C.sec, fontSize: 11 }}>{i === now.getDay() ? 'today' : plural(countFor(i), 'class', 'classes')}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={{ marginHorizontal: 20, marginTop: 14, color: C.sec }}>{date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · {plural(list.length, 'class', 'classes')}</Text>
        {list.length ? (
          <Section>
            {list.map((x, i) => {
              const nowOn = isToday && mins >= x.start - 15 && mins <= x.end; const past = isToday && x.end < mins;
              return (
                <Pressable key={x.c.id + i} onPress={() => router.push(`/course/${x.c.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, opacity: past ? 0.5 : 1, borderBottomWidth: i < list.length - 1 ? 0.5 : 0, borderBottomColor: C.sep }}>
                  <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: courseColor(x.c) }} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[{ fontSize: 14, color: C.sec }, mono]}>{fmtRange(x.m.start, x.m.end)}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      <Text style={{ fontSize: 17, fontWeight: '600', color: C.ink }}>{x.c.code}</Text>
                      {nowOn ? <Chip label="Now" color={C.rec} bg={C.recSoft} /> : null}
                    </View>
                    <Text style={{ fontSize: 14, color: C.sec }} numberOfLines={1}>{[x.c.name, x.m.type, x.m.location].filter(Boolean).join(' · ')}</Text>
                  </View>
                  {!past && !x.c.ex ? <Btn title="Record" kind={nowOn ? 'rec' : 'secondary'} icon="mic" small onPress={() => router.push({ pathname: '/record', params: { courseId: x.c.id } })} /> : null}
                </Pressable>
              );
            })}
          </Section>
        ) : <Empty text={`No classes on ${WEEK_LONG[day]}.`} />}
        {noTimes.length ? (
          <Section title="Courses without class times">
            {noTimes.map((c, i) => <Row key={c.id} title={c.code} sub={c.name} right={<Text style={{ color: C.accent }}>Add times</Text>} onPress={() => router.push(`/course-times/${c.id}`)} last={i === noTimes.length - 1} />)}
          </Section>
        ) : null}
        <View style={{ margin: 16 }}><Btn title="Scan or upload schedule" icon="scan-outline" kind="secondary" onPress={() => router.push('/schedule-import')} /></View>
      </Screen>
    </>
  );
}
