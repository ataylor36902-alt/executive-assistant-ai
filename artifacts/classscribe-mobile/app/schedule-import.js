import React, { useEffect, useRef, useState } from 'react';
import { Image, Keyboard, Platform, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Alert } from '../lib/notify';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { useStore } from '../lib/store';
import { studyAI, errMsg, getUid } from '../lib/api';
import { cleanMeetings } from '../lib/schedule';
import { C } from '../lib/theme';
import { codeKey, curSemester, nowMs, plural, uid } from '../lib/util';
import { Btn, Screen, s } from '../components/ui';

export default function ScheduleImport() {
  const st = useStore();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [progress, setProgress] = useState('');
  const running = useRef(false);
  const requestRef = useRef(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  async function scan(fromCamera) {
    try {
      if (fromCamera && Platform.OS === 'web') {
        return Alert.alert('Camera unavailable', 'Use Screenshot to choose an image on the web.');
      }
      if (Platform.OS !== 'web') {
        const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return Alert.alert(fromCamera ? 'Camera access is off' : 'Photo access is off', 'Allow access for ClassScribe in Settings.');
      }
      const opts = { quality: 0.8, base64: true, allowsEditing: false };
      const r = fromCamera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync({ ...opts, mediaTypes: ['images'] });
      if (r.canceled || !r.assets || !r.assets[0]) return;
      setPhoto(r.assets[0]);
      setError('');
      setResult('');
    } catch (e) {
      Alert.alert(fromCamera ? 'Couldn’t open camera' : 'Couldn’t choose screenshot', errMsg(e));
    }
  }
  async function run() {
    if (running.current) return;
    setError('');
    setResult('');
    if (!text.trim() && !photo) {
      setError('Paste your schedule text, scan it, or choose a screenshot first. The example text is not your schedule.');
      return;
    }
    Keyboard.dismiss();
    running.current = true;
    const libraryCode = getUid();
    const request = new AbortController();
    requestRef.current = request;
    let added = 0, updated = 0;
    setBusy(true);
    setProgress('Reading your schedule…');
    try {
      let image;
      if (photo) {
        const imageData = photo.base64 || (photo.uri ? await new File(photo.uri).base64() : '');
        if (!imageData) throw new Error('The selected image could not be read. Choose another screenshot or paste your schedule text.');
        image = { mediaType: photo.mimeType || 'image/jpeg', data: imageData };
      }
      const r = await studyAI('schedule', { material: text.slice(0, 20000), ...(image ? { image } : {}) }, request.signal);
      if (request.signal.aborted) return;
      if (libraryCode !== getUid()) throw new Error('Your library changed. Reopen the schedule importer in the library you want to use.');
      const list = r.courses || [];
      setProgress('Saving your class times…');
      const mine = st.courses().filter((c) => !c.ex);
      const activeSemester = String(st.profile?.term || '').trim().replace(/\s+/g, ' ') || curSemester();
      const normalizeSemester = (semester) => String(semester || '').trim().replace(/\s+/g, ' ').toLowerCase();
      for (const x of (Array.isArray(list) ? list : [])) {
        if (request.signal.aborted) return;
        if (libraryCode !== getUid()) throw new Error('Your library changed. No more courses were imported.');
        if (!x || !x.code) continue;
        const code = String(x.code).trim().toUpperCase().replace(/\s+/g, ' ');
        const meetings = cleanMeetings(x.meetings);
        // st.courses() is consistently ordered by creation time, so duplicate
        // same-semester codes update the earliest matching course.
        const existing = mine.find((c) => codeKey(c.code) === codeKey(code) && normalizeSemester(c.semester) === normalizeSemester(activeSemester));
        if (existing) {
          const updatedCourse = { ...existing, meetings, professor: existing.professor || x.professor || '' };
          await st.putCourse(updatedCourse);
          updated++;
        }
        else {
          const createdCourse = { id: uid(), code, name: x.name || code, professor: x.professor || '', semester: activeSemester, color: mine.length % 6, created: nowMs(), meetings };
          await st.putCourse(createdCourse);
          mine.push(createdCourse);
          added++;
        }
      }
      if (request.signal.aborted) return;
      if (libraryCode !== getUid()) throw new Error('Your library changed while saving. Reopen the original library to check its courses.');
      if (!added && !updated) {
        setError('No courses were found. Try a clearer photo, or paste your schedule text with course codes, days and times.');
        return;
      }
      setResult(`Schedule added: ${plural(updated, 'course')} updated, ${added} new.`);
    } catch (e) {
      if (request.signal.aborted) return;
      const message = e?.message || (e?.code === 'plan_limit' ? 'Your current plan has reached its course limit. Your schedule draft is still here.' : errMsg(e));
      setError(`${added || updated ? `${plural(updated, 'course')} updated, ${added} new before the import stopped. ` : ''}${message}`);
    } finally {
      running.current = false;
      if (requestRef.current === request) requestRef.current = null;
      if (!request.signal.aborted) {
        setBusy(false);
        setProgress('');
      }
    }
  }

  return (
    <Screen style={{ padding: 16, gap: 14 }}>
      <Text style={{ fontSize: 15, color: C.sec, lineHeight: 21 }}>Scan your printed schedule, pick a screenshot from your student portal, or paste the text. ClassScribe adds the days, times and rooms to your courses and creates any it doesn’t know yet.</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Btn title="Scan with camera" icon="camera" style={{ flex: 1 }} disabled={busy} onPress={() => scan(true)} />
        <Btn title="Screenshot" icon="image-outline" kind="secondary" style={{ flex: 1 }} disabled={busy} onPress={() => scan(false)} />
      </View>
      {photo ? (
        <View style={{ backgroundColor: C.cell, borderRadius: 12, padding: 10, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Image source={{ uri: photo.uri }} style={{ width: 64, height: 64, borderRadius: 8 }} />
          <Text style={{ flex: 1, color: C.ink }}>Schedule photo added</Text>
          <Btn title="Remove" kind="plain" small disabled={busy} onPress={() => setPhoto(null)} />
        </View>
      ) : null}
      <Text style={s.label}>Or paste it</Text>
      <TextInput value={text} onChangeText={(value) => { setText(value); setError(''); setResult(''); }} editable={!busy} accessibilityLabel="Schedule text" multiline placeholder={'Example only — paste your schedule here:\nBIO 101  Intro to Biology  MWF 9:00–9:50 AM  Science Hall 101\nCHEM 110  TTh 11:00–12:15  Chemistry 204'} placeholderTextColor={C.faint} style={[s.input, { minHeight: 140, textAlignVertical: 'top' }]} />
      {progress ? <Text accessibilityLiveRegion="polite" style={{ color: C.sec, lineHeight: 20 }}>{progress}</Text> : null}
      {error ? <Text accessibilityRole="alert" testID="schedule-import-error" style={{ color: C.warn, lineHeight: 20 }}>{error}</Text> : null}
      {result ? <Text accessibilityLiveRegion="polite" testID="schedule-import-success" style={{ color: C.accent, lineHeight: 20 }}>{result}</Text> : null}
      {!result ? <Btn title="Add to my courses" icon="sparkles" busy={busy} disabled={busy} onPress={run} /> : null}
      <Btn title={result ? 'View schedule' : 'Back to schedule'} icon="arrow-back" kind="secondary" testID="schedule-import-back" onPress={() => {
        Keyboard.dismiss();
        requestRef.current?.abort();
        router.replace('/schedule');
      }} />
    </Screen>
  );
}
