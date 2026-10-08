import React from 'react';
import { Text } from 'react-native';
import { router, Stack } from 'expo-router';
import { useStore } from '../lib/store';
import { C, courseColor } from '../lib/theme';
import { plural } from '../lib/util';
import { Btn, Empty, Row, Screen, Section } from '../components/ui';

export default function Courses() {
  const st = useStore();
  const groups = new Map();
  st.courses().forEach((course) => {
    const semester = String(course.semester || '').trim().replace(/\s+/g, ' ') || 'Unassigned semester';
    const key = semester.toLowerCase();
    if (!groups.has(key)) groups.set(key, { title: semester, courses: [] });
    groups.get(key).courses.push(course);
  });
  const semesters = [...groups.values()].sort((a, b) => {
    if (a.title === 'Unassigned semester') return 1;
    if (b.title === 'Unassigned semester') return -1;
    return b.title.localeCompare(a.title);
  });
  semesters.forEach((group) => group.courses.sort((a, b) => a.code.localeCompare(b.code)));

  return <>
    <Stack.Screen options={{ title: 'All courses' }} />
    <Screen>
      <Text style={{ color: C.sec, fontSize: 14, lineHeight: 20, marginHorizontal: 20, marginTop: 6 }}>
        Courses from every semester stay here, even when they aren’t part of your current Home view.
      </Text>
      {!semesters.length ? <Empty text="No courses in your library yet." /> : semesters.map((group) => (
        <Section key={group.title} title={group.title}>
          {group.courses.map((course, index) => <Row
            key={course.id}
            icon="book-outline"
            iconColor={courseColor(course)}
            title={course.code}
            sub={`${course.name}${course.professor ? ` · ${course.professor}` : ''} · ${plural(st.lecturesOf(course.id).length, 'lecture')}`}
            onPress={() => router.push(`/course/${course.id}`)}
            last={index === group.courses.length - 1}
          />)}
        </Section>
      ))}
      <Btn title="Add course" icon="add" onPress={() => router.push('/course-new')} style={{ marginHorizontal: 16, marginTop: 22 }} />
    </Screen>
  </>;
}