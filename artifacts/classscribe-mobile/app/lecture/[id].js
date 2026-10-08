import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import { Alert } from '../../lib/notify';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as MailComposer from 'expo-mail-composer';
import { File, Paths } from 'expo-file-system';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useStore } from '../../lib/store';
import { basicLectureAnalysis, db, errMsg, getUid } from '../../lib/api';
import { hasContent, lectureNotesText } from '../../lib/logic';
import { createLectureAudioSeeker, formatLectureTimestamp, isSeekableLectureTimestamp, lectureLinkTimestamp } from '../../lib/lecture-audio';
import { sharedCache } from '../../lib/shared';
import { C, courseColor, mono } from '../../lib/theme';
import { fmtD, fmtLong, fmtT, spkName, stampDate, uid } from '../../lib/util';
import { Btn, Card, Chip, Empty, Md, Row, Section, Seg, s } from '../../components/ui';
import { goBack } from '../../components/BackButton';
import { showActions } from '../../components/ActionSheet';
import { CreditsConfirmSheet } from '../../components/CreditsConfirmSheet';
import { RecordingConsentSheet } from '../../components/RecordingConsentSheet';
import { getPrivacyConsentReceipt } from '../../lib/privacy';

function audioUriFor(name, fallback) {
  try { if (fallback) { const f = new File(fallback); if (f.exists) return f.uri; } } catch { /* not there */ }
  try { if (name) { const f = new File(Paths.document, name); if (f.exists) return f.uri; } } catch { /* not there */ }
  return null;
}
function lectureText(l, c) {
  const a = l.analysis || {};
  let t = `${c.code ? c.code + ' — ' : ''}${l.title}\n${fmtLong(l.date)}\n\n`;
  if (a.summary) t += 'SUMMARY\n' + a.summary + '\n\n';
  if ((a.keyPoints || []).length) t += 'KEY POINTS\n' + a.keyPoints.map((k) => '• ' + k).join('\n') + '\n\n';
  if ((a.emphasized || []).length) t += 'PROFESSOR EMPHASIZED\n' + a.emphasized.map((e) => `• ${e.concept} [${fmtT(e.t)}]`).join('\n') + '\n\n';
  if ((a.assignments || []).length) t += 'ASSIGNMENTS\n' + a.assignments.map((x) => `• ${x.title}${x.due ? ' — due ' + fmtD(x.due) : ''}`).join('\n') + '\n\n';
  if (a.notes) t += 'NOTES\n' + a.notes.replace(/\*\*/g, '') + '\n';
  return t;
}

export default function Lecture() {
  const p = useLocalSearchParams();
  const st = useStore();
  const l = st.lecture(p.id) || sharedCache.get(p.id);
  const lectureDate = l?.date ? stampDate(l.date) : '';
  const mine = st.isMine(l);
  const [tab, setTab] = useState(p.tab || (l && l.analysis ? 'points' : 'transcript'));
  const [busy, setBusy] = useState(false);
  const [recordingConsentTarget, setRecordingConsentTarget] = useState(null);
  const [pasteTx, setPasteTx] = useState('');
  const [active, setActive] = useState(p.t != null ? +p.t : null);
  const audioName = l ? l.audioName : '';
  const audioFallback = l ? l.audioUri : '';
  const uri = useMemo(() => audioUriFor(audioName, audioFallback), [audioName, audioFallback]);
  const source = useMemo(() => (uri ? { uri } : null), [uri]);
  const player = useAudioPlayer(source);
  const ps = useAudioPlayerStatus(player);
  const audioSeeker = useMemo(() => createLectureAudioSeeker(player, () => {
    Alert.alert('Couldn’t play this moment', 'Try again after the recording loads.');
  }), [player]);
  const scroller = useRef(null);
  const rowY = useRef({});
  const listY = useRef(0);
  const navigatedTo = useRef(null);

  useEffect(() => {
    if (p.tab) setTab(p.tab);
  }, [p.id, p.tab]);

  useEffect(() => {
    audioSeeker.setLoaded(!!uri && ps.isLoaded);
  }, [audioSeeker, uri, ps.isLoaded]);

  useEffect(() => {
    const t = lectureLinkTimestamp(p.t);
    if (!uri || t == null) return;
    const key = `${p.id}:${t}`;
    if (navigatedTo.current !== key) {
      navigatedTo.current = key;
      audioSeeker.seek(t);
    }
  }, [p.id, p.t, uri, audioSeeker]);

  useEffect(() => {
    if (p.t == null || tab !== 'transcript') return;
    const tm = setTimeout(() => {
      const segs = (l && l.segs) || [];
      let idx = 0; segs.forEach((g, i) => { if (Number.isFinite(g.t) && g.t <= +p.t + 1) idx = i; });
      const y = rowY.current[idx];
      if (y != null && scroller.current) scroller.current.scrollTo({ y: Math.max(0, listY.current + y - 160), animated: true });
    }, 350);
    return () => clearTimeout(tm);
  }, [p.t, tab, l]);

  if (!l) return <Empty text="This lecture isn’t available." />;
  const job = st.jobs[l.id];
  const c = st.course(l.courseId) || { code: l.courseCode || '', name: l.courseName };
  const readOnly = !!(l.ex || c.ex);
  const a = l.analysis;

  function seek(t) {
    if (!isSeekableLectureTimestamp(t)) return;
    setActive(t);
    if (uri) audioSeeker.seek(t);
  }
  async function analyze() {
    if (readOnly) return;
    const notesText = lectureNotesText(l, Object.values(st.all('notes')));
    if (!hasContent(l, notesText)) { setTab('transcript'); return Alert.alert('Nothing to analyze yet', 'This lecture has no transcript, slides or notes. Paste a transcript below, or record with the microphone on.'); }
    setBusy(true);
    try {
      const transcript = (l.segs || []).map((g) => `[${Math.round(g.t)}] ${spkName(l, g.s)}: ${g.x}`).join('\n')
        + ((l.slides || []).length ? '\n\nSLIDES / BOARD:\n' + l.slides.map((slide) => `[${slide.t}] ${slide.text || ''}`).join('\n') : '')
        + ((l.marks || []).length ? '\n\nBookmarked moments: ' + l.marks.join(', ') : '')
        + (notesText ? '\n\nStudent notes:\n' + notesText : '');
      const basic = await basicLectureAnalysis(transcript.slice(0, 80_000), /^\d{4}-\d{2}-\d{2}$/.test(l.date || '') ? l.date : undefined);
      const an = {
        summary: basic.summary,
        keyPoints: basic.keyPoints,
        terms: basic.definitions.map((item) => ({ term: item.term, def: item.definition, t: 0 })),
        assignments: basic.dates.map((item) => ({ title: item.label, type: 'homework', due: /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : '', t: 0 })),
        notes: basic.notes,
        emphasized: [],
        examples: [],
        announcements: [],
        studentQuestions: [],
        concepts: [],
      };
      if (!mine) { sharedCache.set(l.id, { ...l, analysis: an }); } else {
        await st.put('lectures', { ...l, analysis: an });
        for (const [i, x] of an.assignments.entries()) if (x.title) await st.put('assignments', { id: l.id + '-a' + i, courseId: l.courseId, title: x.title, type: x.type || 'homework', due: /^\d{4}-\d\d-\d\d$/.test(x.due || '') ? x.due : '', dueSource: 'ai', dateConfirmed: false, lectureId: l.id, t: x.t || 0, done: false, ex: !!l.ex });
      }
      setTab('points');
    } catch (e) { Alert.alert('Analysis didn’t finish', errMsg(e)); }
    setBusy(false);
  }
  async function email() {
    const ownNotes = lectureNotesText(l, Object.values(st.all('notes'))).replace(/\[\[[\w-]+@[\d.]+\]\]/g, '').trim();
    const body = lectureText(l, c) + (ownNotes ? `\nMY NOTES\n${ownNotes}\n` : '');
    try {
      if (await MailComposer.isAvailableAsync()) await MailComposer.composeAsync({ subject: `${c.code || ''} — ${l.title} (${fmtD(l.date)})`, body });
      else await Share.share({ message: body });
    } catch (e) { Alert.alert('Couldn’t share by email', errMsg(e)); }
  }
  async function shareWithClass() {
    if (st.profile?.ageBand === '13-17') return Alert.alert('Class sharing is off', 'High school privacy settings do not allow sharing lectures with classmates.');
    if (c.ex) return Alert.alert('Example course', 'Add your own course before sharing a lecture with classmates.');
    if (!a) return Alert.alert('Analyze first', 'Classmates get the summary and catch-up, so analyze this lecture first.');
    if (!/^g_[0-9a-f]{32}$/.test(c.groupCode || '')) return Alert.alert('Join a class group first', 'Open Classmates and create or join a private group for this course before sharing a lecture.');
    Alert.alert(`Share with ${c.code}?`, 'Classmates in this course group will see the summary, notes and transcript in I Missed Class. Only share recordings your instructor allows to be shared.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Share', onPress: async () => {
        try {
          await db.set(`shared/${l.id}-${getUid().slice(-6)}-${c.groupCode.slice(-8)}`, { code: c.groupCode, courseCode: c.code || '', courseName: c.name || '', professor: c.professor || '', title: l.title, date: l.date, module: l.module || '', duration: l.duration || 0, speakers: l.speakers || {}, analysis: a, segs: l.segs || [], marks: [], slides: [], allowCopy: false, by: getUid(), at: Date.now() });
          Alert.alert('Shared', `Your ${c.code} classmates can now catch up on this lecture.`);
        } catch (e) { Alert.alert('Couldn’t share', errMsg(e)); }
      } },
    ]);
  }
  function more() {
    const actions = [];
    if (!readOnly) actions.push({ label: a ? 'Analyze again' : 'Analyze with AI', onPress: analyze });
    if (mine) actions.push({ label: 'Share with class', onPress: shareWithClass });
    actions.push({ label: 'Email', onPress: email }, { label: 'Share as text', onPress: () => Share.share({ message: lectureText(l, c) }) });
    if (mine && !readOnly) actions.push({ label: 'Delete lecture', destructive: true, onPress: () => Alert.alert('Delete this lecture?', 'This can’t be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { st.del('lectures', l.id); goBack(`/course/${l.courseId}`); } }]) });
    showActions({ title: l.title, actions });
  }
  function addPasted() {
    if (readOnly) return;
    const lines = pasteTx.split('\n').map((x) => x.trim()).filter(Boolean).map((x, i) => {
      const m = x.match(/^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*[-–]?\s*/); let t = i * 8; let text = x; let sp = 'P';
      if (m) { t = m[1].split(':').map(Number).reduce((a, b) => a * 60 + b, 0); text = x.slice(m[0].length); }
      const n = text.match(/^([A-Z][\w .'’-]{0,30}):\s+(.*)/); if (n) { sp = /student/i.test(n[1]) ? 'S' : /prof|dr|instructor/i.test(n[1]) ? 'P' : 'G'; text = n[2]; }
      return { t, s: sp, x: text };
    });
    const updated = { ...l, segs: [...(l.segs || []), ...lines].sort((a, b) => a.t - b.t), duration: Math.max(l.duration || 0, (lines[lines.length - 1] || { t: 0 }).t + 20) };
    st.put('lectures', updated); setPasteTx('');
    st.processRecording(updated, null);
  }
  async function retryAudioTranscription() {
    if (!uri || !mine || readOnly) return;
    let consentReceipt = null;
    try {
      consentReceipt = await getPrivacyConsentReceipt(st.status.uid, l.id, l.courseId);
    } catch { /* missing or damaged receipts require explicit current consent */ }
    if (!consentReceipt) {
      let recordingId = l.recordingId || l.id;
      let lecture = l;
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(recordingId)) {
        recordingId = uid();
        lecture = { ...l, recordingId };
        try { await st.put('lectures', lecture); }
        catch (error) { return Alert.alert('Couldn’t prepare transcription', errMsg(error)); }
      }
      setRecordingConsentTarget({ lecture, sessionId: recordingId });
      return;
    }
    Alert.alert('Upload audio for transcription?', 'This sends this recording to your ClassScribe server. The audio remains on this phone. You can keep it private and add text manually instead.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Upload and transcribe', onPress: () => st.processRecording(l, uri) },
    ]);
  }
  function newNote() {
    if (readOnly) return;
    const n = { id: uid(), courseId: l.courseId || '', lectureId: l.id, title: l.title + ' — notes', body: '', pinned: false, created: Date.now(), updated: Date.now(), ex: false };
    st.put('notes', n); router.push(`/note/${n.id}`);
  }
  const TS = ({ t }) => <Text onPress={() => { setTab('transcript'); seek(t); }} style={{ color: C.accent, fontWeight: '600', fontSize: 13 }}>▶ {fmtT(t)}</Text>;
  const linked = Object.values(st.all('notes')).filter((n) => n.lectureId === l.id);

  return (
    <>
      <Stack.Screen options={{ title: c.code || '', headerRight: () => <Pressable onPress={more} accessibilityLabel="More actions" hitSlop={8}><Ionicons name="ellipsis-horizontal-circle" size={26} color={C.accent} /></Pressable> }} />
      <ScrollView ref={scroller} style={{ flex: 1, backgroundColor: C.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: uri ? 120 : 40 }}>
        <View style={{ paddingHorizontal: 20, gap: 8, paddingTop: 4 }}>
          <Text style={s.h1}>{l.title}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {c.code ? <Chip label={c.code} color={courseColor(c)} /> : null}<Chip label={fmtD(l.date)} color={C.sec} bg={C.fill} /><Chip label={`${Math.round((l.duration || 0) / 60)} min`} color={C.sec} bg={C.fill} />
            {a ? <Chip label="Analyzed" /> : null}{l.sharedCopy ? <Chip label="Shared by a classmate" /> : null}{l.ex ? <Chip label="Example" color={C.sec} bg={C.fill} /> : null}
          </View>
        </View>
        {l.audioSaveWarning ? <Card><Text style={{ color: C.warn, fontSize: 14, lineHeight: 20 }}>{l.audioSaveWarning} The original audio path is retained for playback and recovery.</Text></Card> : null}
        {job && job.text ? <Card style={{ flexDirection: 'row', alignItems: 'center' }}><ActivityIndicator color={C.accent} /><Text style={{ flex: 1, fontSize: 15, color: C.ink }}>{job.text}</Text></Card> : null}
        {job && job.error ? <Card><Text style={{ fontSize: 15, color: C.ink }}>{job.error}</Text><Btn title="OK" kind="secondary" small onPress={() => st.clearJob(l.id)} /></Card> : null}
        {!readOnly && !a && !(job && job.text) ? <Card><Text style={{ fontSize: 15, color: C.ink }}>Get key points, smart notes, terms and detected assignments.</Text><Btn title="Analyze with AI" icon="sparkles" busy={busy} onPress={analyze} /></Card> : null}
        <Seg style={{ marginTop: 14 }} value={tab} onChange={setTab} options={[['notes', 'Notes'], ['points', 'Key points'], ['transcript', 'Transcript'], ['study', 'Study']]} />

        {tab === 'notes' ? (
          <>
            {a && a.notes ? <Card><Md text={a.notes} /></Card> : <Card><Text style={{ color: C.sec }}>Smart notes appear after analysis.</Text></Card>}
            <Section title="Your notes">
              {linked.map((n) => <Row key={n.id} icon="create-outline" title={n.title || 'Untitled note'} onPress={() => router.push(`/note/${n.id}`)} />)}
              {!readOnly ? <Row icon="add-circle" iconColor={C.accent} title="New note for this lecture" onPress={newNote} last chevron={false} /> : null}
            </Section>
          </>
        ) : null}

        {tab === 'points' ? (a ? (
          <>
            <Card><Text style={s.label}>Summary</Text><Text style={{ fontSize: 16, lineHeight: 22, color: C.ink }}>{a.summary}</Text></Card>
            <Card><Text style={s.label}>Key points</Text>
              {(a.keyPoints || []).map((k, i) => <View key={i} style={{ flexDirection: 'row', gap: 10 }}><View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.accent, fontWeight: '700', fontSize: 13 }}>{i + 1}</Text></View><Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: C.ink }}>{k}</Text></View>)}
            </Card>
            {(a.emphasized || []).length ? <Text style={[s.label, { marginLeft: 32, marginTop: 18 }]}>Professor emphasized</Text> : null}
            {(a.emphasized || []).map((e, i) => (
              <View key={i} style={{ marginHorizontal: 16, marginTop: 8, backgroundColor: C.hiSoft, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 10 }}>
                <Ionicons name="star" size={18} color={C.hiInk} />
                <View style={{ flex: 1, gap: 3 }}><Text style={{ fontSize: 15, fontWeight: '600', color: C.ink }}>{e.concept}</Text><Text style={{ fontSize: 13, color: C.sec }}>{e.why}</Text></View>
                <TS t={e.t} />
              </View>
            ))}
            {(a.terms || []).length ? <Section title="Terms">{a.terms.map((t, i) => <Row key={i} title={t.term} sub={t.def} numberOfLines={2} last={i === a.terms.length - 1} right={<TS t={t.t || 0} />} />)}</Section> : null}
            {(a.assignments || []).length ? <Section title="Assignments mentioned">{a.assignments.map((x, i) => <Row key={i} icon="calendar-outline" title={x.title} sub={x.due ? 'Due ' + fmtD(x.due) : ''} last={i === a.assignments.length - 1} />)}</Section> : null}
            {(a.studentQuestions || []).length ? <Section title="Questions students asked">{a.studentQuestions.map((q, i) => <Row key={i} icon="help-circle-outline" title={q.q} numberOfLines={2} right={<TS t={q.t || 0} />} last={i === a.studentQuestions.length - 1} />)}</Section> : null}
          </>
        ) : <Card><Text style={{ color: C.sec }}>Key points appear after analysis.</Text></Card>) : null}

        {tab === 'transcript' ? (
          <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: C.cell, borderRadius: 14, paddingVertical: 6 }} onLayout={(e) => { listY.current = e.nativeEvent.layout.y; }}>
            {(l.segs || []).some((g) => !isSeekableLectureTimestamp(g.t)) ? <Text style={{ color: C.sec, paddingHorizontal: 14, paddingVertical: 8 }}>Some transcript text has no audio timestamps, so it can’t be used to seek.</Text> : null}
            {!(l.segs || []).length ? (
              <View style={{ padding: 14, gap: 10 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: C.ink }}>No transcript for this lecture</Text>
                <Text style={{ color: C.sec, lineHeight: 20 }}>{uri ? 'The audio is saved on this phone. You can try transcription with your ClassScribe server, or paste a transcript here.' : 'No audio was recorded. Allow microphone access for ClassScribe in Settings, or paste a transcript here.'}</Text>
                {mine && !readOnly ? (<>
                  {uri && !(job && job.text) ? <Btn title="Try audio transcription" kind="secondary" small onPress={retryAudioTranscription} /> : null}
                  <TextInput value={pasteTx} onChangeText={setPasteTx} multiline placeholder="Paste a transcript (from Zoom, Otter, Voice Memos…)" placeholderTextColor={C.faint} style={[s.input, { backgroundColor: C.bg, minHeight: 100, textAlignVertical: 'top' }]} />
                  <Btn title="Add transcript and analyze" small disabled={!pasteTx.trim()} onPress={addPasted} />
                </>) : null}
              </View>
            ) : null}
            {(l.segs || []).map((g, i) => {
              const timed = isSeekableLectureTimestamp(g.t);
              const on = timed && active != null && g.t <= active + 1 && (!(l.segs[i + 1]) || l.segs[i + 1].t > active + 1);
              const marked = timed && (l.marks || []).some((t) => Math.abs(t - g.t) < 2);
              return (
                <Pressable key={i} onLayout={(e) => { rowY.current[i] = e.nativeEvent.layout.y; }} onPress={timed ? () => seek(g.t) : undefined} accessibilityHint={timed && uri ? 'Plays from this moment' : undefined}
                  style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: on ? C.hiSoft : 'transparent' }}>
                   <View style={{ width: 96, paddingTop: 2, gap: 2 }}>
                     {lectureDate ? <Text style={{ color: C.sec, fontSize: 11 }} numberOfLines={1}>{lectureDate}</Text> : null}
                     <Text style={[{ color: C.sec, fontSize: 12 }, mono]}>{formatLectureTimestamp(g.t, fmtT)}</Text>
                   </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: g.s === 'P' ? C.accent : g.s === 'S' ? C.blue : C.orange }}>{spkName(l, g.s).toUpperCase()}{marked ? '  ⭐' : ''}</Text>
                    <Text style={{ fontSize: 16, lineHeight: 22, color: C.ink }}>{g.x}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {tab === 'study' ? (
          <>
            <Section>
              <Row icon="albums" iconBg={C.blue} title="Flashcards" sub={`${((a && a.terms) || []).length} cards from this lecture`} onPress={() => router.push({ pathname: '/cards', params: { courseId: l.courseId || '', lectureIds: l.id } })} />
              <Row icon="chatbubbles" iconBg={C.purple} title="Quiz me" sub="One question at a time, from this lecture" onPress={() => router.push({ pathname: '/tutor', params: { courseId: l.courseId || '', lectureIds: l.id, mode: 'quiz' } })} />
              <Row icon="bulb" iconBg={C.orange} title="Teach me this lecture" onPress={() => router.push({ pathname: '/tutor', params: { courseId: l.courseId || '', lectureIds: l.id, mode: 'teach' } })} />
              <Row icon="book" iconBg={C.accent} title="Catch-up summary" onPress={() => router.push(`/catchup/${l.id}`)} last />
            </Section>
            {mine && !readOnly ? <Section><Row title="I’ve reviewed this lecture" right={<Switch value={!!l.reviewed} onValueChange={(v) => st.put('lectures', { ...l, reviewed: v })} trackColor={{ true: C.accent }} />} last chevron={false} /></Section> : null}
          </>
        ) : null}
      </ScrollView>

      {uri ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 28, backgroundColor: C.cell, borderRadius: 16, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6 }}>
          <Pressable onPress={() => player.seekTo(Math.max(0, (ps.currentTime || 0) - 15))} accessibilityLabel="Back 15 seconds"><Ionicons name="play-back" size={24} color={C.ink} /></Pressable>
          <Pressable onPress={() => (ps.playing ? player.pause() : player.play())} accessibilityLabel={ps.playing ? 'Pause' : 'Play'} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={ps.playing ? 'pause' : 'play'} size={22} color={C.accentText} /></Pressable>
          <Pressable onPress={() => player.seekTo((ps.currentTime || 0) + 15)} accessibilityLabel="Forward 15 seconds"><Ionicons name="play-forward" size={24} color={C.ink} /></Pressable>
          <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: C.fill }}><View style={{ height: 4, borderRadius: 2, backgroundColor: C.accent, width: `${Math.min(100, ((ps.currentTime || 0) / Math.max(1, ps.duration || l.duration || 1)) * 100)}%` }} /></View>
          <Text style={[{ fontSize: 12, color: C.sec }, mono]}>{fmtT(ps.currentTime || 0)}</Text>
        </View>
      ) : null}
      <CreditsConfirmSheet
        request={job?.creditsRequired}
        visible={!!job?.creditsRequired}
        busy={!!job?.text}
        onConfirm={() => {
          const request = job?.creditsRequired;
          if (request) st.processRecording(l, uri, undefined, {
            useCredits: true, requestId: request.requestId, libraryCode: request.libraryCode,
          });
        }}
        onCancel={() => st.clearJob(l.id)}
      />
      <RecordingConsentSheet
        visible={!!recordingConsentTarget}
        libraryCode={st.status.uid}
        lectureId={recordingConsentTarget?.lecture.id || l.id}
        courseId={recordingConsentTarget?.lecture.courseId || l.courseId}
        sessionId={recordingConsentTarget?.sessionId || l.id}
        onClose={() => setRecordingConsentTarget(null)}
        onConfirmed={() => st.processRecording(recordingConsentTarget.lecture, uri)}
      />
    </>
  );
}
