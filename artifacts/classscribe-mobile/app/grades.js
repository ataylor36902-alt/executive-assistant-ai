import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../lib/notify';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../lib/store';
import { useBillingStatus } from '../lib/billing';
import { errMsg, getUid, listStudentGrades, saveStudentGrades } from '../lib/api';
import { C, courseColor, mono } from '../lib/theme';
import { Btn, Screen } from '../components/ui';

const TYPES = ['assignment', 'project', 'quiz', 'test'];
const LABELS = { assignment: 'Assignments', project: 'Projects', quiz: 'Quizzes', test: 'Tests' };
const assignmentType = (type) => ({ homework: 'assignment', exam: 'test' })[String(type).toLowerCase()] || String(type).toLowerCase();
const newItem = () => ({ id: '', title: '', type: 'assignment', earned: '', possible: '', date: '' });
const chiefJosephPortrait = require('../assets/images/chief-joseph-tribute.png');
const validDate = (value) => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.getTime()) && d.getFullYear() === Number(value.slice(0, 4)) && d.getMonth() + 1 === Number(value.slice(5, 7)) && d.getDate() === Number(value.slice(8));
};
const numeric = (value) => String(value ?? '').trim() !== '' && Number.isFinite(Number(value));
const percentage = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`;

function Field({ label, value, onChangeText, placeholder, numericInput, style }) {
  return <View style={[{ gap: 7 }, style]}>
    <Text style={{ color: C.sec, fontSize: 11, fontWeight: '800', letterSpacing: 0.9, textTransform: 'uppercase' }}>{label}</Text>
    <TextInput value={String(value ?? '')} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.faint} keyboardType={numericInput ? 'decimal-pad' : 'default'} style={{ color: C.ink, backgroundColor: C.cell, borderColor: C.sep, borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 13, fontSize: 16 }} />
  </View>;
}

function Panel({ icon, title, detail, action, onPress }) {
  return <View style={{ borderRadius: 19, padding: 22, backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, gap: 9, alignItems: 'flex-start' }}>
    <Ionicons name={icon} size={27} color={C.accent} />
    <Text style={{ color: C.ink, fontSize: 19, fontWeight: '800', letterSpacing: -0.4 }}>{title}</Text>
    <Text style={{ color: C.sec, fontSize: 14, lineHeight: 21 }}>{detail}</Text>
    {action ? <Btn title={action} onPress={onPress} small style={{ marginTop: 7 }} /> : null}
  </View>;
}

function GuidanceCard({ rows }) {
  const caption = { color: C.sec, fontSize: 12, lineHeight: 18 };
  const allItems = rows.flatMap(({ items, weights, courseName }, rowIndex) => items.map((item) => ({ ...item, weights, courseName, rowIndex })));
  const scored = allItems.filter((item) => item.earned != null && numeric(item.earned) && numeric(item.possible) && Number(item.possible) > 0);
  const pending = allItems.filter((item) => item.earned == null).length;
  const categories = rows.flatMap(({ courseName, analysis, weights }, rowIndex) =>
    (analysis?.byType || [])
      .filter((category) => category.averagePercent != null && numeric(category.averagePercent) && scored.some((item) => item.rowIndex === rowIndex && item.type === category.type))
      .filter((category) => !weights || Number(weights[category.type]) > 0)
      .map((category) => ({ ...category, courseName, rowIndex, weight: weights?.[category.type] })),
  ).sort((a, b) => Number(a.averagePercent) - Number(b.averagePercent));
  const priority = categories.find((category) => Number(category.averagePercent) < 100);
  const lowestItem = scored.filter((item) => (!item.weights || Number(item.weights[item.type]) > 0) && (!priority || item.rowIndex === priority.rowIndex && item.type === priority.type))
    .sort((a, b) => Number(a.earned) / Number(a.possible) - Number(b.earned) / Number(b.possible))[0];
  const steps = [];
  if (!scored.length) {
    steps.push(pending
      ? `Enter scores for your ${pending} saved unscored item${pending === 1 ? '' : 's'} when they are returned.`
      : 'Add a returned assignment, project, quiz, or test with its earned and possible points.');
    steps.push('After your first score, review the instructor feedback and choose one concept to practice before your next assessment.');
  } else {
    if (priority) {
      const weightNote = priority.weight != null ? ` (${priority.weight}% course weight)` : '';
      const courseNote = priority.courseName ? `${priority.courseName} · ` : '';
      steps.push(`Review ${courseNote}${LABELS[priority.type] || priority.type} feedback and practice one missed concept; its scored average is ${percentage(priority.averagePercent)}${weightNote}.`);
    }
    if (lowestItem) {
      const points = numeric(lowestItem.earned) ? ` (${lowestItem.earned}/${lowestItem.possible} points)` : '';
      const itemPercent = Number(lowestItem.earned) / Number(lowestItem.possible) * 100;
      const courseNote = lowestItem.courseName ? `${lowestItem.courseName} · ` : '';
      steps.push(itemPercent < 100
        ? `Revisit “${courseNote}${lowestItem.title}”${points}: identify one missed step and try a similar problem.`
        : `Revisit “${courseNote}${lowestItem.title}”${points}: note what worked and reuse that approach.`);
    }
    steps.push(pending
      ? `Plan to enter scores for ${pending} saved unscored item${pending === 1 ? '' : 's'} when they are returned.`
      : 'Before your next assessment, set aside a short review session for a concept you want to strengthen.');
    if (!priority && !lowestItem) steps.unshift('Review feedback on returned work and compare category results as more scores are entered.');
  }
  return <View style={{ backgroundColor: C.raised, borderColor: C.sep, borderWidth: 1, borderRadius: 18, padding: 15, gap: 11 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
      <Image source={chiefJosephPortrait} accessibilityLabel="Illustrated tribute to Chief Joseph" style={{ width: 65, height: 76, borderRadius: 13, backgroundColor: C.fill }} resizeMode="cover" />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: C.ink, fontSize: 16, fontWeight: '800' }}>A reflection from ClassScribe</Text>
        <Text style={caption}>An illustrated tribute to Chief Hinmahtooyalatkekt (Chief Joseph)</Text>
      </View>
    </View>
    <View style={{ gap: 9 }}>{steps.map((step, index) => <View key={`${index}-${step}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
      <Text style={{ color: C.accent, fontSize: 13, fontWeight: '800', lineHeight: 21 }}>{index + 1}.</Text>
      <Text style={{ color: C.ink, flex: 1, fontSize: 14, lineHeight: 21 }}>{step}</Text>
    </View>)}</View>
    {scored.length ? <Text style={caption}>{rows.some((row) => row.weights) ? 'Category weights follow your setup; category averages are based on entered points.' : 'Categories are points-based, so possible points affect their share.'}</Text> : null}
    <Text style={caption}>Study priorities by ClassScribe, based on your entered grades—not quotations from or an endorsement by Chief Joseph. Estimates are not promises of outcomes.</Text>
  </View>;
}

export default function Grades() {
  const { courseId, assignmentId } = useLocalSearchParams();
  const st = useStore();
  const billing = useBillingStatus(st.status.uid);
  const insets = useSafeAreaInsets();
  const [gradeState, setGradeState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorState, setError] = useState(null);
  const requestId = useRef(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [credits, setCredits] = useState('');
  const [finalPercent, setFinalPercent] = useState('');
  const [weighted, setWeighted] = useState(false);
  const [weights, setWeights] = useState({ assignment: '', project: '', quiz: '', test: '' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const uid = st.status.uid;
  const paid = billing.status && ['student', 'pro'].includes(billing.status.plan) && ['active', 'trialing'].includes(billing.status.status);
  const selectedId = Array.isArray(courseId) ? courseId[0] : courseId;
  const sourceId = Array.isArray(assignmentId) ? assignmentId[0] : assignmentId;
  const scope = JSON.stringify([uid || '', selectedId || '', sourceId || '']);
  const scopeRevision = useRef({ scope, version: 0 });
  if (scopeRevision.current.scope !== scope) scopeRevision.current = { scope, version: scopeRevision.current.version + 1 };
  // Never render a gradebook from another library or route, even during the render
  // before effects have run after a sync-code switch.
  const result = uid && getUid() === uid && gradeState?.scope === scope ? gradeState.data : null;
  const error = errorState?.scope === scope ? errorState.message : '';
  const [editScope, setEditScope] = useState(null);
  const editingForScope = editScope === scope ? editing : null;
  const settingsForScope = editScope === scope && settingsOpen;
  useEffect(() => {
    setEditing(null);
    setSettingsOpen(false);
    setEditScope(null);
    setCredits('');
    setFinalPercent('');
    setWeights({ assignment: '', project: '', quiz: '', test: '' });
  }, [scope]);
  const course = selectedId ? st.course(selectedId) : null;
  const entry = result?.courses?.find((row) => row.gradebook?.courseId === selectedId || row.courseId === selectedId);
  const book = entry?.gradebook;
  const items = book?.items || [];
  const source = sourceId && course ? st.assignmentsOf(course.id).find((a) => a.id === sourceId && !a.ex) : null;
  const initializedSource = useRef(null);
  useEffect(() => {
    if (!sourceId || !result || loading || initializedSource.current === scope) return;
    initializedSource.current = scope;
    if (!source || !TYPES.includes(assignmentType(source.type)) || course?.ex) return;
    const existing = items.find((item) => item.assignmentId === sourceId);
    setEditScope(scope);
    setEditing(existing
      ? { ...existing, earned: existing.earned == null ? '' : String(existing.earned), possible: String(existing.possible), date: existing.date || '' }
      : { ...newItem(), assignmentId: sourceId, title: source.title, type: assignmentType(source.type), date: validDate(source.due) ? source.due || '' : '' });
  }, [scope, sourceId, result, loading, source, course, items]);
  const overviewRows = st.courses().filter((c) => !c.ex).map((c) => {
    const row = result?.courses?.find((r) => r.courseId === c.id || r.gradebook?.courseId === c.id);
    return { courseName: c.code || c.name, analysis: row?.analysis, weights: row?.gradebook?.weights, items: row?.gradebook?.items || [] };
  });

  const load = useCallback(async () => {
    const request = ++requestId.current;
    const revision = scopeRevision.current.version;
    if (!uid || !paid || getUid() !== uid) { setLoading(false); return; }
    const requested = uid;
    setLoading(true);
    setError(null);
    try {
      const next = await listStudentGrades();
      if (getUid() === requested && requestId.current === request && scopeRevision.current.version === revision) setGradeState({ scope, data: next });
    } catch (reason) {
      if (getUid() === requested && requestId.current === request && scopeRevision.current.version === revision) setError({ scope, message: errMsg(reason) });
    } finally {
      if (getUid() === requested && requestId.current === request && scopeRevision.current.version === revision) setLoading(false);
    }
  }, [uid, paid, scope]);
  useFocusEffect(useCallback(() => {
    load();
    return () => { requestId.current += 1; };
  }, [load]));

  const save = async (changes) => {
    if (busy || loading || !course || !uid || getUid() !== uid || gradeState?.scope !== scope) return false;
    const requested = getUid();
    const revision = scopeRevision.current.version;
    setBusy(true);
    try {
      const next = await saveStudentGrades({
        courseId: course.id,
        credits: changes.credits ?? book?.credits ?? 3,
        weights: changes.weights !== undefined ? changes.weights : book?.weights ?? null,
        items: changes.items ?? items,
        finalPercent: changes.finalPercent !== undefined ? changes.finalPercent : book?.finalPercent ?? null,
        version: book?.version ?? 0,
      });
      if (getUid() !== requested || scopeRevision.current.version !== revision) return false;
      setGradeState({ scope, data: next });
      setError(null);
      return true;
    } catch (reason) {
      if (scopeRevision.current.version !== revision || getUid() !== requested) return false;
      const conflict = reason?.code === 'conflict' || reason?.code === 'version_conflict' || reason?.code === 'stale_version' || reason?.status === 409;
      if (conflict) {
        Alert.alert('Grades changed elsewhere', 'The latest gradebook will reload. Any open form stays in place; review the new scores before saving again.');
        load();
      } else Alert.alert('Could not save grades', errMsg(reason));
      return false;
    } finally { setBusy(false); }
  };
  const startSettings = () => {
    setEditScope(scope);
    setCredits(String(book?.credits ?? 3));
    setFinalPercent(book?.finalPercent == null ? '' : String(book.finalPercent));
    setWeighted(!!book?.weights);
    setWeights(Object.fromEntries(TYPES.map((type) => [type, book?.weights?.[type] == null ? '' : String(book.weights[type])])));
    setSettingsOpen(true);
  };
  const saveSettings = async () => {
    if (!settingsForScope) return;
    if (!numeric(credits) || Number(credits) <= 0 || Number(credits) > 12) return Alert.alert('Check credits', 'Enter credits greater than zero and no more than 12.');
    if (finalPercent !== '' && (!numeric(finalPercent) || Number(finalPercent) < 0 || Number(finalPercent) > 100)) return Alert.alert('Check final percent', 'Enter a percentage from 0 to 100, or leave it blank.');
    if (weighted && (TYPES.some((type) => !numeric(weights[type]) || Number(weights[type]) < 0 || Number(weights[type]) > 100) || Math.abs(TYPES.reduce((sum, type) => sum + Number(weights[type]), 0) - 100) > 0.001)) return Alert.alert('Check weights', 'Enter all four category weights. Together they must total 100%.');
    if (await save({ credits: Number(credits), finalPercent: finalPercent === '' ? null : Number(finalPercent), weights: weighted ? Object.fromEntries(TYPES.map((type) => [type, Number(weights[type])])) : null })) setSettingsOpen(false);
  };
  const saveItem = async () => {
    if (!editingForScope) return;
    const title = editingForScope.title.trim();
    if (!title) return Alert.alert('Add a title', 'Name this graded work before saving.');
    if (!numeric(editingForScope.possible) || Number(editingForScope.possible) <= 0) return Alert.alert('Check possible points', 'Possible points must be greater than zero.');
    if (editingForScope.earned !== '' && (!numeric(editingForScope.earned) || Number(editingForScope.earned) < 0 || Number(editingForScope.earned) > Number(editingForScope.possible))) return Alert.alert('Check earned points', 'Enter a score between zero and the possible points, or leave it blank.');
    if (!validDate(editingForScope.date)) return Alert.alert('Check date', 'Use YYYY-MM-DD for the optional date.');
    const item = { id: editingForScope.id || `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, title, type: editingForScope.type, earned: editingForScope.earned === '' ? null : Number(editingForScope.earned), possible: Number(editingForScope.possible), date: editingForScope.date || null };
    if (editingForScope.assignmentId) item.assignmentId = editingForScope.assignmentId;
    const updated = editingForScope.id ? items.map((x) => x.id === item.id ? item : x) : [...items, item];
    if (await save({ items: updated })) setEditing(null);
  };
  const removeItem = (item) => Alert.alert('Remove score?', `${item.title} will be removed from this course gradebook.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => save({ items: items.filter((x) => x.id !== item.id) }) },
  ]);

  const caption = { color: C.sec, fontSize: 12, lineHeight: 18 };
  const heading = { color: C.ink, fontSize: 21, fontWeight: '800', letterSpacing: -0.55 };
  return <>
    <Stack.Screen options={{ title: selectedId ? 'Course grades' : 'Grades & GPA' }} />
    <Screen refreshControl={<RefreshControl refreshing={loading && !!result} onRefresh={load} tintColor={C.accent} />} style={{ paddingHorizontal: 19, paddingTop: 14, paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 0) + 120, gap: 20 }}>
      {billing.loading ? <View style={{ gap: 12 }}><View style={{ backgroundColor: C.fill, height: 150, borderRadius: 20 }} /><View style={{ backgroundColor: C.fill, height: 65, borderRadius: 15 }} /></View>
        : billing.error ? <Panel icon="cloud-offline-outline" title="Plan unavailable" detail={billing.error} action="Try again" onPress={billing.refresh} />
        : !paid ? <Panel icon="school-outline" title="A clearer picture of your progress" detail="Grades and estimated GPA are available with Student and Pro. Keep your scores together and see how each category contributes." action="See plans" onPress={() => router.push('/plans')} />
        : selectedId && !course ? <Panel icon="folder-open-outline" title="Course not found" detail="This course is no longer in your library." action="Back to grades" onPress={() => router.replace('/grades')} />
        : !result && !error ? <View style={{ gap: 12 }}><View style={{ backgroundColor: C.fill, height: 165, borderRadius: 20 }} /><View style={{ backgroundColor: C.fill, height: 76, borderRadius: 15 }} /><View style={{ backgroundColor: C.fill, height: 76, borderRadius: 15 }} /></View>
        : error && !result ? <Panel icon="cloud-offline-outline" title="Grades could not load" detail={error} action="Try again" onPress={load} />
        : selectedId && course?.ex ? <Panel icon="book-outline" title="Example course" detail="Example courses are for exploring ClassScribe and are not editable gradebooks." action="Back to grades" onPress={() => router.replace('/grades')} />
        : selectedId ? <>
          <View style={{ backgroundColor: C.hero, borderRadius: 22, padding: 22, minHeight: 172, justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={{ color: C.heroText, fontWeight: '800', letterSpacing: 1.1, fontSize: 11 }}>{course.code}  /  YOUR GRADEBOOK</Text><Ionicons name="stats-chart-outline" size={22} color={C.heroText} /></View>
            <View><Text style={{ color: C.heroText, fontSize: 42, fontWeight: '800', letterSpacing: -2, ...mono }}>{percentage(entry?.analysis?.averagePercent)}</Text><Text style={{ color: C.heroText, opacity: .8, fontSize: 13 }}>{entry?.analysis?.letter ? `${entry.analysis.letter} · ` : ''}{book?.finalPercent != null ? 'Final percentage entered by you' : 'Based on scored work so far'}</Text></View>
          </View>
          {error ? <Panel icon="alert-circle-outline" title="Could not refresh" detail={error} action="Try again" onPress={load} /> : null}
          {sourceId && !source && !items.some((item) => item.assignmentId === sourceId) ? <Panel icon="alert-circle-outline" title="Assignment not found" detail="This assignment is no longer in your course. Existing gradebook scores are kept." /> : null}
          <Text style={caption}>This is {entry?.analysis?.isEstimate === false ? 'a calculated result' : 'an estimate'}, not an official course grade. Your syllabus or instructor may use a different scale.</Text>
          {!loading && !error ? <GuidanceCard rows={[{ courseName: course.code || course.name, analysis: entry?.analysis, weights: book?.weights, items }]} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={heading}>Categories</Text><Pressable onPress={startSettings} accessibilityRole="button" testID="grade-settings"><Text style={{ color: C.accent, fontWeight: '700' }}>Weights & credits</Text></Pressable></View>
          <View style={{ backgroundColor: C.cell, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: C.sep }}>
            {TYPES.map((type, i) => {
              const analysis = entry?.analysis?.byType?.find((x) => x.type === type);
              return <View key={type} style={{ padding: 15, flexDirection: 'row', alignItems: 'center', borderBottomWidth: i === 3 ? 0 : StyleSheet.hairlineWidth, borderColor: C.sep, gap: 12 }}>
                <View style={{ width: 4, height: 34, backgroundColor: [C.accent, C.blue, C.orange, C.purple][i], borderRadius: 2 }} />
                <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{LABELS[type]}</Text><Text style={caption}>{book?.weights ? `${book.weights[type]}% of course` : 'By points'}</Text></View>
                <Text style={{ color: C.ink, fontWeight: '800', fontSize: 17, ...mono }}>{percentage(analysis?.averagePercent)}</Text>
              </View>;
            })}
          </View>
          {settingsForScope ? <View style={{ gap: 15, backgroundColor: C.raised, borderRadius: 18, padding: 16 }}>
            <Text style={{ ...heading, fontSize: 18 }}>Course setup</Text>
            <Field label="Credits" value={credits} onChangeText={setCredits} numericInput />
            <Field label="Final percent · optional override" value={finalPercent} onChangeText={setFinalPercent} placeholder="Leave blank to calculate" numericInput />
            <Pressable onPress={() => setWeighted(!weighted)} accessibilityRole="switch" accessibilityState={{ checked: weighted }} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44 }}><Ionicons name={weighted ? 'checkbox' : 'square-outline'} size={22} color={C.accent} /><Text style={{ color: C.ink, fontSize: 15 }}>Use category weights</Text></Pressable>
            {weighted ? TYPES.map((type) => <Field key={type} label={`${LABELS[type]} %`} value={weights[type]} onChangeText={(v) => setWeights((old) => ({ ...old, [type]: v }))} numericInput />) : null}
            <Text style={caption}>Weights must add to 100%. A final percent, if entered, takes precedence over scored work.</Text>
            <View style={{ flexDirection: 'row', gap: 9 }}><Btn title="Cancel" kind="secondary" onPress={() => setSettingsOpen(false)} style={{ flex: 1 }} /><Btn title={loading ? 'Refreshing…' : 'Save setup'} onPress={saveSettings} disabled={busy || loading} style={{ flex: 1 }} /></View>
          </View> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={heading}>Scored work</Text><Pressable onPress={() => { setEditScope(scope); setEditing(newItem()); }} accessibilityRole="button" testID="add-grade" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44 }}><Ionicons name="add-circle" color={C.accent} size={20} /><Text style={{ color: C.accent, fontWeight: '700' }}>Add score</Text></Pressable></View>
          {editingForScope ? <View style={{ gap: 15, backgroundColor: C.raised, padding: 16, borderRadius: 18 }}>
            <Text style={{ ...heading, fontSize: 18 }}>{editingForScope.id ? 'Edit score' : 'New score'}</Text>
            <Field label="Title" value={editing.title} onChangeText={(v) => setEditing({ ...editing, title: v })} placeholder="e.g. Research outline" />
            <Text style={{ color: C.sec, fontSize: 11, fontWeight: '800', letterSpacing: 0.9 }}>CATEGORY</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{TYPES.map((type) => <Pressable key={type} onPress={() => setEditing({ ...editing, type })} accessibilityRole="button" style={{ backgroundColor: editing.type === type ? C.accent : C.cell, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11 }}><Text style={{ color: editing.type === type ? C.accentText : C.ink, fontWeight: '700', fontSize: 13 }}>{LABELS[type]}</Text></Pressable>)}</View>
            <View style={{ flexDirection: 'row', gap: 10 }}><Field label="Earned · optional" value={editing.earned} onChangeText={(v) => setEditing({ ...editing, earned: v })} placeholder="Not graded yet" numericInput style={{ flex: 1 }} /><Field label="Possible" value={editing.possible} onChangeText={(v) => setEditing({ ...editing, possible: v })} placeholder="100" numericInput style={{ flex: 1 }} /></View>
            <Field label="Date · optional" value={editing.date} onChangeText={(v) => setEditing({ ...editing, date: v })} placeholder="YYYY-MM-DD" />
            <View style={{ flexDirection: 'row', gap: 9 }}><Btn title="Cancel" kind="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} /><Btn title={loading ? 'Refreshing…' : 'Save score'} onPress={saveItem} disabled={busy || loading} style={{ flex: 1 }} /></View>
          </View> : null}
          {!items.length ? <Panel icon="calculator-outline" title="No scores yet" detail="Add an assignment, project, quiz or test to see how your course is taking shape." /> : items.map((item) => <View key={item.id} style={{ backgroundColor: C.cell, borderRadius: 16, padding: 15, gap: 6, borderWidth: 1, borderColor: C.sep }}>
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1 }}><Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>{item.title}</Text><Text style={caption}>{LABELS[item.type] || item.type}{item.date ? ` · ${item.date}` : ''}</Text>{item.assignmentId ? <Text style={caption}>{(() => { const linked = st.assignmentsOf(course.id).find((a) => a.id === item.assignmentId); return linked ? linked.title !== item.title ? `Course assignment now: ${linked.title}` : 'Linked to course assignment' : 'Course assignment removed; score kept'; })()}</Text> : null}</View><Text style={{ color: C.ink, fontWeight: '800', fontSize: 17, ...mono }}>{item.earned == null ? '—' : item.earned}/{item.possible}</Text></View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 20 }}><Pressable onPress={() => { setEditScope(scope); setEditing({ ...item, earned: item.earned == null ? '' : String(item.earned), possible: String(item.possible), date: item.date || '' }); }} accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`}><Text style={{ color: C.accent, fontWeight: '700' }}>Edit</Text></Pressable><Pressable onPress={() => removeItem(item)} accessibilityRole="button" accessibilityLabel={`Remove ${item.title}`}><Text style={{ color: C.rec, fontWeight: '700' }}>Remove</Text></Pressable></View>
          </View>)}
        </> : <>
          <View style={{ backgroundColor: C.hero, borderRadius: 22, padding: 22, minHeight: 172, justifyContent: 'space-between' }}>
            <Text style={{ color: C.heroText, opacity: .8, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 }}>YOUR ACADEMIC SNAPSHOT</Text>
            <View><Text style={{ color: C.heroText, fontSize: 47, fontWeight: '800', letterSpacing: -2, ...mono }}>{result?.summary?.estimatedGpa == null ? '—' : Number(result.summary.estimatedGpa).toFixed(2)}</Text><Text style={{ color: C.heroText, fontWeight: '700', fontSize: 15 }}>Estimated GPA</Text></View>
            <Text style={{ color: C.heroText, opacity: .8, fontSize: 12 }}>{result?.summary?.countedCredits ?? 0} counted credits · based on your entered grades</Text>
          </View>
          <Text style={caption}>An estimate for planning, not an official transcript. Only courses with enough grade information count toward this GPA.</Text>
          {error ? <Panel icon="alert-circle-outline" title="Could not refresh" detail={error} action="Try again" onPress={load} /> : null}
          {!loading && !error ? <GuidanceCard rows={overviewRows} /> : null}
          <Text style={heading}>Your courses</Text>
          {!st.courses().filter((c) => !c.ex).length ? <Panel icon="albums-outline" title="No courses yet" detail="Add a course, then enter scores to start tracking your progress." action="Add a course" onPress={() => router.push('/course-new')} /> : st.courses().filter((c) => !c.ex).map((c) => {
            const row = result?.courses?.find((r) => r.courseId === c.id || r.gradebook?.courseId === c.id);
            return <Pressable key={c.id} onPress={() => router.push({ pathname: '/grades', params: { courseId: c.id } })} accessibilityRole="button" style={{ backgroundColor: C.cell, borderWidth: 1, borderColor: C.sep, borderRadius: 16, padding: 17, minHeight: 85, flexDirection: 'row', alignItems: 'center', gap: 13 }}>
              <View style={{ width: 4, height: 39, borderRadius: 3, backgroundColor: courseColor(c) }} />
              <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontSize: 16, fontWeight: '800' }}>{c.code}</Text><Text style={caption} numberOfLines={1}>{c.name}</Text></View>
              <View style={{ alignItems: 'flex-end' }}><Text style={{ color: C.ink, fontSize: 17, fontWeight: '800', ...mono }}>{percentage(row?.analysis?.averagePercent)}</Text><Text style={caption}>{row?.analysis?.letter || 'No grades'}</Text></View>
              <Ionicons name="chevron-forward" size={16} color={C.sec} />
            </Pressable>;
          })}
        </>}
    </Screen>
  </>;
}