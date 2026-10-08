import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../../lib/store';
import { C } from '../../../lib/theme';
import { snippet, uid, whenStr } from '../../../lib/util';
import { Empty, Row, Screen, Section } from '../../../components/ui';

export default function Notes() {
  const st = useStore();
  const [q, setQ] = useState('');
  const [cid, setCid] = useState('');
  const courses = st.courses();
  const list = st.notesOf(cid || null).filter((n) => !q || (n.title + ' ' + n.body).toLowerCase().includes(q.toLowerCase()));
  const pinned = list.filter((n) => n.pinned); const rest = list.filter((n) => !n.pinned);
  const sources = list.filter((n) => n.sourceType && !n.pinned);
  const regular = rest.filter((n) => !n.sourceType);
  const lecNotes = st.lecturesOf(cid || null).filter((l) => l.analysis && l.analysis.notes).filter((l) => !q || (l.title + l.analysis.notes).toLowerCase().includes(q.toLowerCase())).reverse().slice(0, 8);

  function newNote() {
    const n = { id: uid(), courseId: cid, lectureId: '', title: '', body: '', pinned: false, created: Date.now(), updated: Date.now(), ex: false };
    st.put('notes', n); router.push(`/note/${n.id}`);
  }
  const searchOpts = useMemo(() => ({ placeholder: 'Search notes', onChangeText: (e) => setQ(e.nativeEvent.text), hideWhenScrolling: false }), []);
  const row = (n, i, arr) => <Row key={n.id} title={n.title || 'Untitled note'} sub={`${n.sourceType ? `${n.sourceType.replace('-', ' ')}${n.sourceName ? ` · ${n.sourceName}` : ''} · ` : ''}${whenStr(n.updated)}  ${snippet(n.body, 70) || 'No text'}${n.courseId && st.course(n.courseId) ? ' · ' + st.course(n.courseId).code : ''}`} onPress={() => router.push(`/note/${n.id}`)} last={i === arr.length - 1} />;
  const header = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
      <Pressable onPress={() => router.push({ pathname: '/source-import', params: cid ? { courseId: cid } : {} })} accessibilityLabel="Import course source" hitSlop={8}><Ionicons name="document-attach-outline" size={24} color={C.accent} /></Pressable>
      <Pressable onPress={newNote} accessibilityLabel="New note" hitSlop={8}><Ionicons name="create-outline" size={26} color={C.accent} /></Pressable>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Notes', headerSearchBarOptions: searchOpts, headerRight: header }} />
      <Screen>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
          {[{ id: '', code: 'All' }, ...courses].map((c) => (
            <Pressable key={c.id || 'all'} onPress={() => setCid(c.id)} accessibilityRole="button" accessibilityState={{ selected: cid === c.id }} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, backgroundColor: cid === c.id ? C.accent : C.cell }}>
              <Text style={{ color: cid === c.id ? C.accentText : C.ink, fontWeight: '600' }}>{c.code}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {pinned.length ? <Section title="Pinned">{pinned.map(row)}</Section> : null}
        {regular.length ? <Section title="Notes">{regular.map(row)}</Section> : null}
        {sources.length ? <Section title="Course sources">{sources.map(row)}</Section> : null}
        {!list.length ? <Empty text={q ? 'No notes match.' : 'No notes yet. Tap the pencil to write one, or use My notes while recording.'} /> : null}
        {lecNotes.length ? (
          <Section title="Smart notes from lectures">
            {lecNotes.map((l, i) => <Row key={l.id} icon="sparkles" iconColor={C.accent} title={l.title} sub={(st.course(l.courseId) || {}).code} onPress={() => router.push({ pathname: '/lecture/[id]', params: { id: l.id, tab: 'notes' } })} last={i === lecNotes.length - 1} />)}
          </Section>
        ) : null}
        <Text style={{ textAlign: 'center', color: C.sec, fontSize: 12, marginTop: 18 }}>{list.length} notes</Text>
      </Screen>
    </>
  );
}
