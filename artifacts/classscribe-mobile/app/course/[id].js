import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Alert } from '../../lib/notify';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../lib/store';
import { C, courseColor } from '../../lib/theme';
import { isConfirmedDue } from '../../lib/due-dates';
import { meetingsText } from '../../lib/schedule';
import { fmtD, fmtT, plural, relDue, snippet, whenStr, uid, nowMs } from '../../lib/util';
import { Btn, Chip, Empty, Row, Screen, Section, Seg, s } from '../../components/ui';
import { goBack } from '../../components/BackButton';

export default function Course() {
  const params = useLocalSearchParams();
  const { id } = params;
  const st = useStore();
  const [tab, setTab] = useState(params.tab === 'assign' ? 'assign' : 'lectures');
  const [dateEdit, setDateEdit] = useState(null);
  const [dateDraft, setDateDraft] = useState('');
  const c = st.course(id);
  if (!c) return <Screen><Empty text="This course isn’t in your library anymore." /></Screen>;
  const readOnly = !!c.ex;
  const ls = st.lecturesOf(c.id);
  const as = st.assignmentsOf(c.id);
  const ns = st.notesOf(c.id);
  const marks = ls.flatMap((l) => (l.marks || []).map((t, index) => {
    const segment = (l.segs || []).filter((x) => Number.isFinite(x.t) && x.t <= t + 2).pop();
    return { lecture: l, t, text: segment ? segment.x : 'Bookmarked moment', index };
  }));
  const mods = {};
  ls.forEach((l) => { (mods[l.module || 'Lectures'] = mods[l.module || 'Lectures'] || []).push(l); });

  function remove() {
    if (readOnly) return;
    Alert.alert(`Remove ${c.code}?`, 'This deletes its lectures, assignments and notes.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { ls.forEach((l) => st.del('lectures', l.id)); as.forEach((a) => st.del('assignments', a.id)); ns.forEach((n) => st.del('notes', n.id)); st.del('courses', c.id); goBack(); } },
    ]);
  }
  function newNote() {
    if (readOnly) return;
    const n = { id: uid(), courseId: c.id, lectureId: '', title: '', body: '', pinned: false, created: nowMs(), updated: nowMs(), ex: false };
    st.put('notes', n); router.push(`/note/${n.id}`);
  }
  function saveDate() {
    if (readOnly || !dateEdit) return;
    const due = dateDraft.trim();
    const d = new Date(`${due}T12:00:00`);
    if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(d.getTime()) || d.getFullYear() !== Number(due.slice(0, 4)) || d.getMonth() + 1 !== Number(due.slice(5, 7)) || d.getDate() !== Number(due.slice(8)))) {
      Alert.alert('Check the date', 'Enter a real date as YYYY-MM-DD, or leave it blank to clear it.');
      return;
    }
    st.put('assignments', { ...dateEdit, due, dateConfirmed: !!due, dueConfirmed: !!due, dueSource: due ? 'manual' : null });
    setDateEdit(null);
  }

  return (
    <>
      <Stack.Screen options={{ title: c.code }} />
      <Screen>
        <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Chip label={c.code} color={courseColor(c)} /><Chip label={c.semester || ''} color={C.sec} bg={C.fill} />{c.ex ? <Chip label="Example" color={C.sec} bg={C.fill} /> : null}
          </View>
          <Text style={s.h1}>{c.name}</Text>
          <Text style={{ color: C.sec, fontSize: 15 }}>{c.professor ? c.professor + ' · ' : ''}{plural(ls.length, 'lecture')} · {Math.round(ls.reduce((a, l) => a + (l.duration || 0), 0) / 60)} min</Text>
          <Pressable onPress={() => router.push(`/course-times/${c.id}`)} accessibilityRole="button" style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: C.cell, borderRadius: 12, padding: 12 }}>
            <Ionicons name="calendar-outline" size={18} color={C.accent} />
            <View style={{ flex: 1, gap: 2 }}>{(c.meetings || []).length ? meetingsText(c).map((t, i) => <Text key={i} style={{ color: C.ink, fontSize: 14 }}>{t}</Text>) : <Text style={{ color: C.sec, fontSize: 14 }}>No class times yet</Text>}</View>
            {!readOnly ? <Text style={{ color: C.accent, fontSize: 14 }}>{(c.meetings || []).length ? 'Edit' : 'Add'}</Text> : null}
          </Pressable>
          <Pressable onPress={() => router.push({ pathname: '/grades', params: { courseId: c.id } })} accessibilityRole="button" accessibilityLabel={`Grades for ${c.code}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.accentSoft, borderRadius: 13, padding: 14 }}>
            <Ionicons name="stats-chart-outline" size={21} color={C.accent} />
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>Grades</Text><Text style={{ color: C.sec, fontSize: 12, marginTop: 2 }}>Scores, categories and course estimate</Text></View>
            <Ionicons name="chevron-forward" size={17} color={C.accent} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 14 }}>
          {!readOnly ? <Btn title="Record" kind="rec" icon="mic" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/record', params: { courseId: c.id } })} /> : null}
          <Btn title="Exam Center" icon="school" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/exam', params: { courseId: c.id } })} />
        </View>
        <Seg style={{ marginTop: 16 }} value={tab} onChange={setTab} options={[['lectures', 'Lectures'], ['assign', `Assignments (${as.filter((a) => !a.done).length})`], ['notes', `Notes (${ns.length})`], ['bookmarks', `Bookmarks (${marks.length})`]]} />

        {tab === 'lectures' ? (
          ls.length ? Object.entries(mods).map(([m, list]) => (
            <Section key={m} title={m}>
              {list.map((l, i) => <Row key={l.id} lead={<View style={{ width: 40, alignItems: 'center' }}><Text style={{ fontSize: 11, color: C.sec, fontWeight: '700' }}>{fmtD(l.date).split(' ')[0].toUpperCase()}</Text><Text style={{ fontSize: 18, fontWeight: '700', color: C.ink }}>{fmtD(l.date).split(' ')[1]}</Text></View>}
                 title={l.title} sub={`${Math.round((l.duration || 0) / 60)} min${(l.marks || []).length ? ' · ' + l.marks.length + ' bookmarks' : ''}${l.analysis ? '' : ' · not analyzed'}${l.reviewed ? ' · reviewed' : ''}`} onPress={() => router.push(`/lecture/${l.id}`)} last={i === list.length - 1} />)}
            </Section>
          )) : <Empty text={`No lectures recorded for ${c.code} yet.`}>{!readOnly ? <Btn title="Record first lecture" kind="rec" icon="mic" small onPress={() => router.push({ pathname: '/record', params: { courseId: c.id } })} /> : null}</Empty>
        ) : null}

        {tab === 'assign' ? (
          <Section>
            {as.map((a, i) => <Row key={a.id} lead={readOnly ? <Ionicons name={a.done ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={a.done ? C.accent : C.faint} /> : <Pressable onPress={() => st.put('assignments', { ...a, done: !a.done })} hitSlop={8} accessibilityLabel={`Mark ${a.title} done`}><Ionicons name={a.done ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={a.done ? C.accent : C.faint} /></Pressable>}
              title={a.title} sub={`${a.type || 'task'} · ${a.due ? fmtD(a.due) + (isConfirmedDue(a) ? ' · confirmed' : ' · review date') : 'No date'}${isConfirmedDue(a) ? ' · ' + relDue(a.due) : ''}`}
              onPress={!readOnly ? () => { setDateEdit(a); setDateDraft(a.due || ''); } : undefined} last={i === as.length - 1}
              right={!readOnly ? <View style={{ alignItems: 'flex-end' }}>
                {a.due && !isConfirmedDue(a) ? <Pressable onPress={() => st.put('assignments', { ...a, dateConfirmed: true, dueConfirmed: true })} accessibilityRole="button" accessibilityLabel={`Confirm ${a.title} due ${fmtD(a.due)}`} style={{ padding: 8 }}><Text style={{ color: C.accent, fontWeight: '700', fontSize: 12 }}>Confirm</Text></Pressable> : null}
                {['assignment', 'homework', 'project', 'quiz', 'test', 'exam'].includes(String(a.type || '').toLowerCase()) ? <Pressable onPress={() => router.push({ pathname: '/grades', params: { courseId: c.id, assignmentId: a.id } })} accessibilityRole="button" accessibilityLabel={`Record grade for ${a.title}`} testID={`record-grade-${a.id}`} style={{ padding: 8 }}><Text style={{ color: C.accent, fontWeight: '700', fontSize: 12 }}>Record grade</Text></Pressable> : null}
              </View> : null} />)}
            {!as.length ? <Row title="No assignments yet" sub="ClassScribe adds them when your professor mentions homework, readings or exams." last /> : null}
            {!readOnly && dateEdit ? <View style={{ padding: 16, gap: 10, borderTopWidth: 1, borderColor: C.sep }}>
              <Text style={{ color: C.ink, fontSize: 16, fontWeight: '700' }}>Due date · {dateEdit.title}</Text>
              <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>Dates found in lectures need your confirmation. Entering a date yourself confirms it for Home reminders.</Text>
              <TextInput value={dateDraft} onChangeText={setDateDraft} placeholder="YYYY-MM-DD" placeholderTextColor={C.faint} accessibilityLabel="Due date in YYYY-MM-DD format" style={{ color: C.ink, backgroundColor: C.bg, borderColor: C.sep, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 }} />
              <View style={{ flexDirection: 'row', gap: 10 }}><Btn title="Cancel" kind="secondary" small onPress={() => setDateEdit(null)} style={{ flex: 1 }} /><Btn title="Save date" small onPress={saveDate} style={{ flex: 1 }} /></View>
            </View> : null}
          </Section>
        ) : null}

        {tab === 'notes' ? (
          <Section>
            {ns.map((n) => <Row key={n.id} icon={n.sourceType ? 'document-text-outline' : 'create-outline'} title={n.title || 'Untitled note'} sub={`${n.sourceType ? `${n.sourceType.replace('-', ' ')}${n.sourceName ? ` · ${n.sourceName}` : ''} · ` : ''}${whenStr(n.updated)} · ${snippet(n.body, 70)}`} onPress={() => router.push(`/note/${n.id}`)} />)}
            {!readOnly ? <Row icon="document-attach-outline" iconColor={C.accent} title={`Import source for ${c.code}`} sub="Syllabus, reading, or study guide" onPress={() => router.push({ pathname: '/source-import', params: { courseId: c.id } })} /> : null}
            {!readOnly ? <Row icon="add-circle" iconColor={C.accent} title={`New note for ${c.code}`} onPress={newNote} last chevron={false} /> : null}
          </Section>
        ) : null}

        {tab === 'bookmarks' ? (
          <Section title="Bookmarked moments">
            {marks.length ? marks.map((mark, i) => <Row
              key={`${mark.lecture.id}-${mark.t}-${mark.index}`}
              icon="bookmark"
              iconColor={C.accent}
              title={mark.text}
              sub={`${mark.lecture.title} · ${fmtD(mark.lecture.date)} · ${fmtT(mark.t)}`}
              numberOfLines={2}
              onPress={() => router.push({ pathname: '/lecture/[id]', params: { id: mark.lecture.id, tab: 'transcript', t: String(mark.t) } })}
              last={i === marks.length - 1}
            />) : <Row title="No bookmarked moments yet" sub="Bookmark moments while recording or reviewing a lecture." last />}
          </Section>
        ) : null}

        {!c.ex ? <Section><Row title="Remove course" destructive onPress={remove} last chevron={false} /></Section> : null}
      </Screen>
    </>
  );
}
