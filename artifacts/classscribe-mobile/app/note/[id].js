import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, InputAccessoryView, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { Alert } from '../../lib/notify';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../lib/store';
import { cleanSmartNote, errMsg, getUid } from '../../lib/api';
import { C, courseColor } from '../../lib/theme';
import { clockStamp, fmtD, nowMs } from '../../lib/util';
import { Btn, Chip, Empty, Md } from '../../components/ui';
import { showActions } from '../../components/ActionSheet';
import { goBack } from '../../components/BackButton';
import { MAX_SOURCE_CHARS } from '../../lib/course-sources';
import { noteSaveMessage } from '../../lib/note-saving';

const BAR = 'noteBar';

export default function NoteEditor() {
  const { id } = useLocalSearchParams();
  const st = useStore();
  const n = st.note(id);
  const c = n ? st.course(n.courseId) : null;
  const lec = n?.lectureId ? st.lecture(n.lectureId) : null;
  const readOnly = !!(n && (n.ex || c?.ex || lec?.ex));
  const noteTitle = (note) => typeof note?.title === 'string' ? note.title : '';
  const noteBody = (note) => typeof note?.body === 'string' ? note.body : '';
  const [title, setTitle] = useState(() => noteTitle(n));
  const [body, setBody] = useState(() => noteBody(n));
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [preview, setPreview] = useState(() => !!noteBody(n));
  const [ai, setAi] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState({ phase: 'idle' });
  const editVersion = useRef(0);
  const saveVersion = useRef(0);
  const mounted = useRef(true);
  const editorLibrary = useRef(st.status.uid);
  const timer = useRef(null);
  const latest = useRef({ title: noteTitle(n), body: noteBody(n) });
  const loadedNoteId = useRef(n?.id ?? null);
  const dirty = useRef(false);
  const stRef = useRef(st);
  useEffect(() => { stRef.current = st; });
  useEffect(() => {
    if (!n || loadedNoteId.current === id) return;
    loadedNoteId.current = id;
    // A cold-start editor can mount before the provider knows its library.
    // Bind the draft when its note arrives, not to that initial empty identity.
    editorLibrary.current = st.status.uid || getUid();
    const nextTitle = noteTitle(n);
    const nextBody = noteBody(n);
    latest.current = { title: nextTitle, body: nextBody };
    dirty.current = false;
    setTitle(nextTitle);
    setBody(nextBody);
    setPreview(!!nextBody);
    setAi(null);
    setSaveState({ phase: 'idle' });
  }, [id, n]);
  // Save whatever is typed; runs after a pause in typing and when leaving the screen.
  const flush = useCallback((force = false, patch = {}) => {
    if (!dirty.current && !force) return;
    clearTimeout(timer.current);
    const store = stRef.current; const cur = store.note(id); if (!cur) return;
    if (cur.ex || store.course(cur.courseId)?.ex || (cur.lectureId && store.lecture(cur.lectureId)?.ex)) return;
    const version = editVersion.current;
    const attempt = ++saveVersion.current;
    const active = () => mounted.current && loadedNoteId.current === id &&
      version === editVersion.current && attempt === saveVersion.current && editorLibrary.current === getUid();
    if (active()) setSaveState({ phase: 'saving' });
    const { title: t, body: b } = latest.current;
    return store.saveNote({ ...cur, ...patch, title: t, body: b, updated: nowMs() }, () => {
      if (version === editVersion.current && attempt === saveVersion.current) dirty.current = false;
      if (active()) setSaveState({ phase: 'syncing' });
    }, editorLibrary.current).then(result => {
      if (!active() || result.superseded) return;
      setSaveState({ phase: result.synced ? 'synced' : result.localSaved ? 'pending' : 'error', error: result.error });
    }).catch(error => { if (active()) setSaveState({ phase: 'error', error }); });
  }, [id]);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') flush(); });
    return () => { clearTimeout(timer.current); flush(); mounted.current = false; subscription.remove(); };
  }, [flush]);
  useEffect(() => {
    if (saveState.phase === 'pending' && n && !n._pending && !dirty.current &&
        n.title === latest.current.title && n.body === latest.current.body) setSaveState({ phase: 'synced' });
  }, [n, saveState.phase]);
  if (!n) return <Empty text="This note was deleted." />;
  const visibleSaveState = saveState.phase === 'idle' && n._pending ? { phase: 'restored_pending' } : saveState;
  const canRetrySave = ['pending', 'restored_pending', 'error'].includes(visibleSaveState.phase);
  function change(t, b) { if (readOnly) return; const nextBody = n.sourceType ? b.slice(0, MAX_SOURCE_CHARS) : b; latest.current = { title: t, body: nextBody }; dirty.current = true; editVersion.current++; setSaveState({ phase: 'saving' }); setTitle(t); setBody(nextBody); clearTimeout(timer.current); timer.current = setTimeout(flush, 700); }

  function fmt(kind) {
    if (readOnly) return;
    const { start, end } = sel; const v = body;
    if (kind === 'b') { const w = v.slice(start, end) || 'bold'; change(title, v.slice(0, start) + '**' + w + '**' + v.slice(end)); return; }
    const ls = v.lastIndexOf('\n', start - 1) + 1;
    if (kind === 'ts') { const tok = clockStamp(); change(title, v.slice(0, start) + tok + v.slice(end)); return; }
    const pre = { h: '## ', li: '- ', todo: '- [ ] ', star: '⭐ ' }[kind];
    const lineRest = v.slice(ls).replace(/^(#+ |- \[[ x]\] |- |⭐ )/, '');
    change(title, v.slice(0, ls) + pre + lineRest);
  }
  function pickCourse() {
    if (readOnly) return;
    const cs = st.courses();
    showActions({ title: 'File under', actions: [
      { label: 'No course', onPress: () => flush(true, { courseId: '', lectureId: '' }) },
      ...cs.map((x) => ({ label: `${x.code} · ${x.name}`, onPress: () => flush(true, { courseId: x.id, lectureId: '' }) })),
    ] });
  }
  function pickLecture() {
    if (readOnly) return;
    if (!n.courseId) return Alert.alert('Pick a course first');
    const ls = st.lecturesOf(n.courseId);
    showActions({ title: 'Link to a lecture', actions: [
      { label: 'Not linked', onPress: () => flush(true, { lectureId: '' }) },
      ...ls.map((l) => ({ label: `${fmtD(l.date)} · ${l.title}`, onPress: () => flush(true, { lectureId: l.id }) })),
    ] });
  }
  async function organize() {
    if (readOnly) return;
    flush();
    if (!body.trim()) return Alert.alert('Write some notes first');
    setBusy(true); setPreview(true);
    try {
      const cleanupInput = (body.slice(0, 10_000) + (lec ? `\n\nLecture material:\n${(lec.segs || []).map((g) => g.x).join('\n').slice(0, 10_000)}` : '')).slice(0, 20_000);
      const text = await cleanSmartNote(cleanupInput);
      setAi(text.trim());
    } catch (e) { Alert.alert('Couldn’t organize', errMsg(e)); }
    setBusy(false);
  }
  function more() {
    const actions = [];
    if (!readOnly) actions.push({ label: n.pinned ? 'Unpin' : 'Pin to top', onPress: () => flush(true, { pinned: !n.pinned }) });
    actions.push({ label: 'Share', onPress: () => Share.share({ message: `${title}\n\n${body.replace(/\[\[[\w-]+@[\d.]+\]\]/g, '')}` }) });
    if (!readOnly) actions.push({ label: 'Delete note', destructive: true, onPress: () => Alert.alert('Delete this note?', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { clearTimeout(timer.current); dirty.current = false; st.del('notes', id); goBack('/notes'); } }]) });
    showActions({ actions });
  }
  const tools = [['h', 'H'], ['b', 'B'], ['li', '•'], ['todo', '☐'], ['star', '⭐'], ['ts', '⏱']];
  const formatBar = (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.fill, borderTopWidth: 0.5, borderTopColor: C.sep, paddingHorizontal: 6, height: 46 }}>
      {tools.map(([k, label]) => <Pressable key={k} onPress={() => fmt(k)} accessibilityLabel={{ h: 'Heading', b: 'Bold', li: 'Bullet', todo: 'Checklist', star: 'Important', ts: 'Insert date and time' }[k]} style={{ minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 18, fontWeight: '700', color: C.ink }}>{label}</Text></Pressable>)}
      <View style={{ flex: 1 }} />
      <Pressable onPress={organize} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accentSoft, paddingHorizontal: 12, height: 34, borderRadius: 99 }} accessibilityRole="button"><Ionicons name="sparkles" size={15} color={C.accent} /><Text style={{ color: C.accent, fontWeight: '600' }}>Organize</Text></Pressable>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{
        title: '',
        headerRight: () => (
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            {!readOnly ? <Pressable onPress={() => { flush(); setPreview(!preview); }} hitSlop={8} accessibilityRole="button"><Text style={{ color: C.accent, fontSize: 17 }}>{preview ? 'Edit' : 'Preview'}</Text></Pressable> : null}
            <Pressable onPress={more} hitSlop={8} accessibilityLabel="More"><Ionicons name="ellipsis-horizontal-circle" size={26} color={C.accent} /></Pressable>
          </View>
        ),
      }} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.cell }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          {readOnly ? <Text style={{ fontSize: 28, fontWeight: '700', color: C.ink }}>{title || 'Untitled note'}</Text> : <TextInput value={title} onChangeText={(t) => change(t, body)} placeholder="Title" placeholderTextColor={C.faint} style={{ fontSize: 28, fontWeight: '700', color: C.ink }} multiline />}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {readOnly ? (c ? <Chip label={c.code} color={courseColor(c)} /> : <Chip label="No course" color={C.sec} bg={C.fill} />) : <Pressable onPress={pickCourse} accessibilityRole="button">{c ? <Chip label={c.code + ' ▾'} color={courseColor(c)} /> : <Chip label="Add to a course ▾" color={C.sec} bg={C.fill} />}</Pressable>}
            {c && !n.sourceType ? (readOnly ? <Chip label={lec ? `Lecture: ${fmtD(lec.date)}` : 'Not linked to a lecture'} color={C.sec} bg={C.fill} /> : <Pressable onPress={pickLecture} accessibilityRole="button"><Chip label={lec ? `Lecture: ${fmtD(lec.date)} ▾` : 'Link a lecture ▾'} color={C.sec} bg={C.fill} /></Pressable>) : null}
            {n.sourceType ? <Chip label={`${n.sourceType.replace('-', ' ')}${n.sourceName ? ` · ${n.sourceName}` : ''}`} color={C.accent} bg={C.accentSoft} /> : null}
            {n.ex ? <Chip label="Example" color={C.sec} bg={C.fill} /> : null}
          </View>
          {!readOnly ? <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <Text testID="note-save-status" accessibilityLiveRegion="polite"
                style={{ color: visibleSaveState.phase === 'error' ? C.warn : C.sec, fontSize: 13 }}>
                {noteSaveMessage(visibleSaveState)}
              </Text>
              {canRetrySave ? <Pressable testID="note-save-retry" accessibilityRole="button"
                accessibilityLabel="Retry saving this note" hitSlop={10} onPress={() => flush(true)}>
                <Text style={{ color: C.accent, fontWeight: '600', fontSize: 14 }}>Retry</Text>
              </Pressable> : null}
            </View>
            {visibleSaveState.phase === 'error' ? <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 13, lineHeight: 18 }}>
              Keep this screen open and retry to protect your changes.
            </Text> : null}
          </View> : null}
          {n.sourceAnalysis ? <View style={{ padding: 14, marginBottom: 16, borderRadius: 12, backgroundColor: C.accentSoft }}>
            <Text style={{ color: C.ink, fontWeight: '700', marginBottom: 8 }}>Document analysis · check against the source below</Text>
            <Md text={`## Summary\n${n.sourceAnalysis.summary}\n\n## Key points\n${(n.sourceAnalysis.keyPoints || []).map(point => `- ${point}`).join('\n')}`} size={16} />
          </View> : null}
          {readOnly
            ? (body.trim() ? <Md text={body} getLecture={st.lecture} size={17} /> : <Text style={{ color: C.faint, fontSize: 17 }}>This example note is empty.</Text>)
            : preview
              ? <Pressable onPress={() => setPreview(false)} accessibilityHint="Edit the note">{body.trim() ? <Md text={body} getLecture={st.lecture} size={17} /> : <Text style={{ color: C.faint, fontSize: 17 }}>Tap to start writing…</Text>}</Pressable>
            : <TextInput value={body} onChangeText={(b) => change(title, b)} maxLength={n.sourceType ? MAX_SOURCE_CHARS : undefined} onSelectionChange={(e) => setSel(e.nativeEvent.selection)} multiline autoFocus={!body} scrollEnabled={false} inputAccessoryViewID={BAR} placeholder="Start writing. Use ## for headings, - for bullets, - [ ] for checklists." placeholderTextColor={C.faint} style={{ fontSize: 17, lineHeight: 24, color: C.ink, minHeight: 300, textAlignVertical: 'top' }} />}
          {!readOnly && n.prevBody && !ai ? <Btn title="Restore my original" kind="plain" small onPress={() => { change(title, n.prevBody); st.put('notes', { ...st.note(id), body: n.prevBody, prevBody: null }); }} /> : null}
          {!readOnly && (busy || ai) ? (
            <View style={{ backgroundColor: C.bg, borderRadius: 14, padding: 14, gap: 10 }}>
              <Text style={{ fontWeight: '700', fontSize: 16, color: C.ink }}>Organized version</Text>
              {busy ? <Text style={{ color: C.sec }}>Organizing your notes…</Text> : <Md text={ai} getLecture={st.lecture} />}
              {!busy ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Btn title="Replace" small style={{ flex: 1 }} onPress={() => { const prevBody = body; change(title, ai); flush(true, { prevBody }); setAi(null); }} />
                  <Btn title="Add below" kind="secondary" small style={{ flex: 1 }} onPress={() => { const b = body.trimEnd() + '\n\n---\n' + ai; change(title, b); setAi(null); }} />
                  <Btn title="Discard" kind="plain" small onPress={() => setAi(null)} />
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
        {!readOnly && !preview && Platform.OS !== 'ios' ? formatBar : null}
        {!readOnly && preview ? (
          <View style={{ position: 'absolute', right: 16, bottom: 30 }}>
            <Btn title="Organize with AI" icon="sparkles" kind="secondary" small busy={busy} onPress={organize} />
          </View>
        ) : null}
      </KeyboardAvoidingView>
      {!readOnly && Platform.OS === 'ios' ? <InputAccessoryView nativeID={BAR}>{formatBar}</InputAccessoryView> : null}
    </>
  );
}
