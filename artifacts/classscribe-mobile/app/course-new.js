import React, { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useStore } from '../lib/store';
import { C } from '../lib/theme';
import { uid } from '../lib/util';
import { Btn, Screen, s } from '../components/ui';
import { goBack } from '../components/BackButton';

export default function CourseNew() {
  const st = useStore();
  const [f, setF] = useState({ code: '', name: '', professor: '', semester: (st.profile && st.profile.term) || '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const draftId = useRef(null);
  const field = (k, label, ph, extra = {}) => (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput value={f[k]} onChangeText={(v) => { setF({ ...f, [k]: v }); setSaveError(''); }} placeholder={ph} placeholderTextColor={C.faint} style={s.input} {...extra} />
    </View>
  );
  async function save() {
    if (saving) return;
    if (!f.code.trim() || !f.name.trim()) {
      setSaveError('Add a course code and name before saving.');
      return;
    }
    const c = { id: draftId.current || uid(), code: f.code.trim().toUpperCase(), name: f.name.trim(), professor: f.professor.trim(), semester: f.semester.trim(), color: st.courses().length % 6, created: Date.now() };
    draftId.current = c.id;
    setSaving(true);
    setSaveError('');
    try {
      await st.putCourse(c);
      goBack();
    } catch (error) {
      setSaveError(error?.message || (error?.code === 'plan_limit'
        ? 'Your current plan has reached its course limit. Your draft is still here.'
        : 'The course could not be saved. Your draft is still here; try again.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Screen style={{ padding: 16, gap: 16 }}>
      {field('code', 'Course code', 'PSYC 210', { autoCapitalize: 'characters', autoFocus: true })}
      {field('name', 'Course name', 'Cognitive Psychology')}
      {field('professor', 'Professor', 'Prof. Rivera')}
      {field('semester', 'Term', 'Fall 2026')}
      {saveError ? <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 14, lineHeight: 20 }}>{saveError}</Text> : null}
      <Btn title="Add course" icon="add" onPress={save} busy={saving} disabled={saving} />
      <Text style={{ color: C.sec, fontSize: 13 }}>To build a whole semester from your syllabus, use Import syllabus in ClassScribe on the web.</Text>
    </Screen>
  );
}
