import React, { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../lib/notify';
import { router, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { useStore } from '../../../lib/store';
import { studyAI, db, errMsg, getUid } from '../../../lib/api';
import { material } from '../../../lib/logic';
import { sharedCache } from '../../../lib/shared';
import { C } from '../../../lib/theme';
import { codeKey, fmtD } from '../../../lib/util';
import { Btn, Empty, Md, Row, Section, Seg } from '../../../components/ui';

const EX_POSTS = [
  { id: 'p1', by: 'ex1', text: 'Does anyone have the diagram from the cell cycle slide? I missed the end of class.', at: Date.now() - 86400000 * 3 },
  { id: 'p2', by: 'ex2', text: 'I shared Monday’s lecture. Crossing over is going to be on the midterm.', at: Date.now() - 86400000 * 2 },
];
const EX_NAMES = { ex1: 'Jordan (example)', ex2: 'Priya (example)' };

export default function ClassTab() {
  const st = useStore();
  const courses = st.courses();
  const [selectedId, setSelectedId] = useState(courses[0]?.id || '');
  const [tab, setTab] = useState('discuss');
  const [posts, setPosts] = useState([]);
  const [shared, setShared] = useState([]);
  const [names, setNames] = useState({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [invite, setInvite] = useState('');
  const [editingGroup, setEditingGroup] = useState(false);
  const [copied, setCopied] = useState(false);
  const namesRef = useRef({});
  const selectedCourse = courses.find((c) => c.id === selectedId) || courses[0];
  const code = selectedCourse?.code || '';
  const key = codeKey(code);
  const live = !!st.status.server;
  const groupCode = /^g_[0-9a-f]{32}$/.test(selectedCourse?.groupCode || '') ? selectedCourse.groupCode : '';
  const groupRef = useRef(groupCode);
  groupRef.current = groupCode;

  const load = useCallback(async () => {
    if (!live || !groupCode) return;
    try {
      const [ps, sh] = await Promise.all([db.list('posts', [['code', '==', groupCode]]), db.list('shared', [['code', '==', groupCode]])]);
      if (groupRef.current !== groupCode) return;
      const list = ps.map((d) => ({ ...d.data, id: d.id })).sort((a, b) => b.at - a.at);
      setPosts(list);
      const sl = sh.map((d) => ({ ...d.data, id: d.id, sharedCopy: true }));
      sl.forEach((l) => sharedCache.set(l.id, l)); setShared(sl);
      const ids = [...new Set([...list.map((p) => p.by), ...sl.map((l) => l.by)])].filter((id) => id && !(id in namesRef.current));
      await Promise.all(ids.map(async (id) => { try { const m = await db.get('members/' + id, groupCode); if (groupRef.current === groupCode) namesRef.current[id] = (m && m.name) || ''; } catch { if (groupRef.current === groupCode) namesRef.current[id] = ''; } }));
      if (groupRef.current === groupCode) { setNames({ ...namesRef.current }); setErr(''); }
    } catch (e) { if (groupRef.current === groupCode) setErr(errMsg(e)); }
  }, [live, groupCode]);

  useFocusEffect(useCallback(() => {
    setPosts([]); setShared([]); setErr(''); setNames({}); namesRef.current = {};
    if (!groupCode) return;
    load(); const t = setInterval(load, 6000); return () => clearInterval(t);
  }, [load, groupCode]));

  function saveGroup(nextCode) {
    if (!selectedCourse || selectedCourse.ex) return;
    const save = () => {
      st.put('courses', { ...selectedCourse, groupCode: nextCode });
      setInvite(''); setEditingGroup(false); setCopied(false); setErr('');
    };
    if (groupCode && groupCode !== nextCode) {
      const message = 'You will see messages from the new group. Keep your old invite code if you may want to rejoin it.';
      if (Platform.OS === 'web') { if (window.confirm(`Switch class groups?\n\n${message}`)) save(); }
      else Alert.alert('Switch class groups?', message, [{ text: 'Keep current', style: 'cancel' }, { text: 'Switch', onPress: save }]);
    } else save();
  }
  const createGroup = () => saveGroup('g_' + Crypto.randomUUID().replace(/-/g, '').toLowerCase());
  async function copyInvite() {
    try { await Clipboard.setStringAsync(groupCode); setCopied(true); } catch (e) { setErr(errMsg(e)); }
  }

  async function post() {
    const t = text.trim(); if (!t) return;
    if (!groupCode) return;
    try { await db.add('posts', { code: groupCode, by: getUid(), text: t, at: Date.now() }); setText(''); load(); } catch (e) { setErr(errMsg(e)); }
  }
  async function studySession() {
    if (!groupCode) return;
    setBusy(true);
    try {
      const mine = st.lecturesOf().filter((l) => codeKey((st.course(l.courseId) || {}).code) === key);
      const r = await studyAI('group', { material: material([...shared, ...mine], [], 14000, st.course) || `Course: ${code}` });
      await db.add('posts', { code: groupCode, by: getUid(), bot: true, text: r.text.trim(), at: Date.now() });
      load();
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  }
  const who = (p) => (p.bot ? 'ClassScribe study session' : p.by === getUid() ? 'You' : EX_NAMES[p.by] || names[p.by] || 'Classmate');
  const shownPosts = live ? posts : (courses.some((c) => c.ex && codeKey(c.code) === key) ? EX_POSTS : []);

  if (!courses.length) return <Empty text="Add a course to join its class group." />;
  return (
    <>
      <Stack.Screen options={{ title: 'Classmates' }} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 6 }}>
            {courses.map((c) => (
              <Pressable key={c.id} onPress={() => { setSelectedId(c.id); setEditingGroup(false); setInvite(''); setCopied(false); }} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, backgroundColor: c.id === selectedCourse?.id ? C.accent : C.cell }} accessibilityRole="button" accessibilityState={{ selected: c.id === selectedCourse?.id }}>
                <Text style={{ color: c.id === selectedCourse?.id ? C.accentText : C.ink, fontWeight: '600' }}>{c.code}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {!live ? <Text style={{ margin: 16, color: C.sec }}>Class groups need your ClassScribe server. Showing an example group.</Text> : null}
          {live ? (
            <View style={{ marginHorizontal: 16, marginTop: 14, padding: 14, borderRadius: 12, backgroundColor: C.cell, gap: 10 }}>
              <Text style={{ color: C.ink, fontSize: 16, fontWeight: '700' }}>Class group</Text>
              {selectedCourse?.ex ? (
                <Text style={{ color: C.sec, lineHeight: 20 }}>This is an example course. Add your own course to join or create a live class group.</Text>
              ) : groupCode && !editingGroup ? (
                <>
                  <Text style={{ color: C.sec, lineHeight: 20 }}>Only classmates with this private invite code can see this group's discussion and shared lectures.</Text>
                  <Text selectable style={{ color: C.ink, fontSize: 13 }}>{groupCode}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Btn title={copied ? 'Copied' : 'Copy invite code'} icon="copy" small kind="secondary" onPress={copyInvite} />
                    <Btn title="Switch group" small kind="secondary" onPress={() => setEditingGroup(true)} />
                  </View>
                </>
              ) : (
                <>
                  <Text style={{ color: C.sec, lineHeight: 20 }}>Course names are not invite codes. Create a private group or enter the code a classmate sent you.</Text>
                  <TextInput value={invite} onChangeText={setInvite} autoCapitalize="none" autoCorrect={false} placeholder="Paste class invite code" placeholderTextColor={C.faint} accessibilityLabel="Class invite code" style={{ backgroundColor: C.bg, color: C.ink, borderRadius: 8, padding: 12, fontSize: 15 }} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Btn title="Join group" small disabled={!/^g_[0-9a-f]{32}$/.test(invite.trim().toLowerCase())} onPress={() => saveGroup(invite.trim().toLowerCase())} />
                    <Btn title="Create group" small kind="secondary" onPress={createGroup} />
                  </View>
                  {groupCode ? <Btn title="Keep current group" small kind="secondary" onPress={() => { setEditingGroup(false); setInvite(''); }} /> : null}
                </>
              )}
            </View>
          ) : null}
          {err ? <Text style={{ marginHorizontal: 16, marginTop: 8, color: C.rec }}>{err}</Text> : null}
          {(!live || groupCode) ? <Seg style={{ marginTop: 12 }} value={tab} onChange={setTab} options={[['discuss', 'Discussion'], ['shared', `Shared lectures (${shared.length})`]]} /> : null}
          {(!live || !!groupCode) && (tab === 'discuss' ? (
            <>
              {live ? <View style={{ marginHorizontal: 16, marginTop: 12 }}><Btn title="Start an AI study session" icon="sparkles" kind="secondary" small busy={busy} onPress={studySession} /></View> : null}
              <Section>
                {shownPosts.map((p, i) => (
                  <View key={p.id} style={{ flexDirection: 'row', gap: 10, padding: 12, borderBottomWidth: i < shownPosts.length - 1 ? 0.5 : 0, borderBottomColor: C.sep }}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: p.bot ? C.accent : C.fill, alignItems: 'center', justifyContent: 'center' }}>
                      {p.bot ? <Ionicons name="sparkles" size={16} color="#fff" /> : <Text style={{ fontWeight: '700', color: C.sec }}>{(who(p)[0] || '?').toUpperCase()}</Text>}
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ fontSize: 14, color: C.ink }}><Text style={{ fontWeight: '700' }}>{who(p)}</Text><Text style={{ color: C.sec }}> · {new Date(p.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text></Text>
                      <Md text={p.text} size={15} />
                    </View>
                  </View>
                ))}
                {!shownPosts.length ? <Row title="No messages yet" sub="Start the conversation." last /> : null}
              </Section>
            </>
          ) : (
            <Section footer="Share one of your own lectures from its ••• menu.">
              {shared.map((l, i) => <Row key={l.id} icon="book" iconBg={C.accent} title={l.title} sub={`${fmtD(l.date)} · shared by ${l.by === getUid() ? 'you' : names[l.by] || 'a classmate'}`} onPress={() => router.push(`/catchup/${l.id}`)} last={i === shared.length - 1} />)}
              {!shared.length ? <Row title="Nothing shared yet" last /> : null}
            </Section>
          ))}
        </ScrollView>
        {tab === 'discuss' && live && groupCode ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, margin: 12, backgroundColor: C.cell, borderRadius: 22, paddingLeft: 14, padding: 4 }}>
            <TextInput value={text} onChangeText={setText} placeholder={`Message ${code}`} placeholderTextColor={C.faint} multiline style={{ flex: 1, fontSize: 17, paddingVertical: 8, maxHeight: 120, color: C.ink }} />
            <Pressable onPress={post} disabled={!text.trim()} accessibilityLabel="Send" style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: text.trim() ? C.accent : C.fill, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="arrow-up" size={20} color={text.trim() ? C.accentText : C.sec} /></Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </>
  );
}
