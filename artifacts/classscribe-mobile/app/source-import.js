import React, { useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Alert } from '../lib/notify';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useStore } from '../lib/store';
import { db, errMsg, extractMaterial, getServer, getUid, studyAI } from '../lib/api';
import { C } from '../lib/theme';
import { nowMs, uid } from '../lib/util';
import { Btn, Screen } from '../components/ui';
import { showActions } from '../components/ActionSheet';
import { goBack } from '../components/BackButton';
import { makeSourceNote, MAX_SOURCE_CHARS, MAX_SOURCE_FILE_BYTES, SOURCE_TYPES, sourceFileType, sourceText } from '../lib/course-sources';

const TYPE_LABELS = { syllabus: 'Syllabus', reading: 'Reading', 'study-guide': 'Study guide' };

export default function SourceImport() {
  const params = useLocalSearchParams();
  const st = useStore();
  const courses = st.courses().filter((course) => !course.ex);
  const preferredId = Array.isArray(params.courseId) ? params.courseId[0] : params.courseId;
  const [courseId, setCourseId] = useState(courses.some((course) => course.id === preferredId) ? preferredId : '');
  const [sourceType, setSourceType] = useState('reading');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const selectedCourse = courses.find((course) => course.id === courseId);

  function chooseCourse() {
    showActions({ title: 'Choose a course', actions: courses.map((course) => ({
      label: `${course.code} · ${course.name}`,
      onPress: () => setCourseId(course.id),
    })) });
  }

  function chooseType() {
    showActions({ title: 'Source type', actions: SOURCE_TYPES.map((type) => ({
      label: TYPE_LABELS[type],
      onPress: () => setSourceType(type),
    })) });
  }

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mime = sourceFileType(asset.name);
      if (!mime) {
        Alert.alert('Unsupported file', 'Choose a PDF, TXT, or MD file.');
        return;
      }
      if (Number.isFinite(asset.size) && asset.size > MAX_SOURCE_FILE_BYTES) {
        Alert.alert('File too large', 'Choose a file no larger than 8 MB.');
        return;
      }
      setFile({ ...asset, mime });
      setText('');
      setFeedback('');
    } catch (error) {
      Alert.alert('Couldn’t choose file', errMsg(error));
    }
  }

  async function readFileBytes(asset) {
    const reportedSize = Number(asset.size || asset.file?.size || 0);
    if (reportedSize > MAX_SOURCE_FILE_BYTES) throw new Error('Choose a file no larger than 8 MB.');
    if (asset.file && typeof asset.file.arrayBuffer === 'function') {
      return new Uint8Array(await asset.file.arrayBuffer());
    }
    if (Platform.OS === 'web') {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error('The selected file could not be read. Choose it again or paste its text.');
      return new Uint8Array(await response.arrayBuffer());
    }
    return await new File(asset.uri).bytes();
  }

  async function saveSource(analyze = true) {
    if (busy) return;
    const cleanTitle = title.trim();
    if (!courseId) return Alert.alert('Choose a course', 'Imported sources are saved under one of your courses.');
    if (!cleanTitle) return Alert.alert('Add a title', 'Enter a title for this source.');
    if (!file && !text.trim()) return Alert.alert('Add source text', 'Paste source text or choose a PDF, TXT, or MD file.');
    if (text.length > MAX_SOURCE_CHARS) return Alert.alert('Text is too long', `Source text must be no more than ${MAX_SOURCE_CHARS.toLocaleString()} characters.`);
    setBusy(true);
    setFeedback('');
    try {
      const libraryCode = getUid();
      const server = getServer();
      if (!libraryCode || libraryCode !== st.status.uid) throw new Error('Your library is switching. Reopen Notes in the current library before importing.');
      let body = text;
      let truncated = false;
      let originalLength = text.length;
      if (file) {
        const bytes = await readFileBytes(file);
        if (bytes.byteLength > MAX_SOURCE_FILE_BYTES) throw new Error('Choose a file no larger than 8 MB.');
        const extracted = await extractMaterial(bytes, file.mime, libraryCode);
        body = extracted.text;
        truncated = extracted.truncated;
        originalLength = extracted.originalLength;
      }
      if (!body.trim()) throw new Error('No readable text was found. Try a text-based PDF, TXT, or MD file, or paste the source text.');
      const storedBody = sourceText(body);
      if (libraryCode !== getUid() || server !== getServer()) throw new Error('Your library or server changed. Nothing was imported into another library.');
      let sourceAnalysis;
      if (analyze) {
        setFeedback('Analyzing the document and extracting key points…');
        sourceAnalysis = await studyAI('source-summary', { material: storedBody });
        if (typeof sourceAnalysis?.summary !== 'string' || !Array.isArray(sourceAnalysis?.keyPoints)) throw new Error('Document analysis returned an invalid response. Nothing was saved; try again.');
      }
      if (libraryCode !== getUid() || server !== getServer()) throw new Error('Your library or server changed during analysis. Nothing was imported into another library.');
      const note = makeSourceNote({
        id: uid(), courseId, title: cleanTitle, body: storedBody, sourceType,
        sourceName: file?.name, created: nowMs(),
      });
      if (sourceAnalysis) note.sourceAnalysis = sourceAnalysis;
      if (server) {
        await db.set(`data/users/${libraryCode}/lib/notes/${note.id}`, note);
        if (libraryCode !== getUid() || server !== getServer()) throw new Error('The source was saved to the original library. Switch back to view it; no other library was changed.');
        if (!(await st.refresh())) throw new Error('The source was saved to your private library, but the note list could not refresh. Reopen Notes to view it; do not import it again.');
      } else {
        await st.put('notes', note);
      }
      const overLimit = body.length > MAX_SOURCE_CHARS || truncated;
      setBusy(false);
      const message = `${analyze ? 'A summary and key points are ready in your source note. ' : 'Saved without AI analysis. '}${server ? 'Saved and synced to your private library. ' : 'Saved on this device only. '}The original file is not stored. Student and Pro study guides, exam practice, and quizzes use this course’s source text.`
        + (overLimit ? ` The saved text is limited to ${MAX_SOURCE_CHARS.toLocaleString()} characters${truncated && originalLength ? ` from ${Number(originalLength).toLocaleString()} extracted characters` : ''}.` : '');
      Alert.alert('Source imported', message, [{ text: 'OK', onPress: () => goBack('/notes') }]);
    } catch (error) {
      setBusy(false);
      setFeedback(errMsg(error));
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Import course source' }} />
      <Screen style={{ padding: 16, gap: 14 }}>
        <Text style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>
          Free, Student, and Pro can import documents and get an AI summary and key points. Only extracted text and its analysis are saved privately; the raw file is not stored. Analysis requires your AI-sharing permission. Student and Pro use these course sources for exam practice and quizzes, with balanced excerpts and source coverage.
        </Text>
        {!courses.length ? <Text style={{ color: C.rec }}>Create a course before importing a source.</Text> : null}
        <Pressable disabled={busy} onPress={chooseType} accessibilityRole="button" accessibilityLabel={`Source type: ${TYPE_LABELS[sourceType]}`} style={{ backgroundColor: C.cell, padding: 14, borderRadius: 12 }}>
          <Text style={{ color: C.sec, fontSize: 12 }}>TYPE</Text>
          <Text style={{ color: C.ink, fontSize: 16, fontWeight: '600', marginTop: 4 }}>{TYPE_LABELS[sourceType]} ▾</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={chooseCourse} accessibilityRole="button" accessibilityLabel={`Course: ${selectedCourse?.code || 'Choose course'}`} style={{ backgroundColor: C.cell, padding: 14, borderRadius: 12 }}>
          <Text style={{ color: C.sec, fontSize: 12 }}>COURSE</Text>
          <Text style={{ color: selectedCourse ? C.ink : C.faint, fontSize: 16, fontWeight: '600', marginTop: 4 }}>{selectedCourse ? `${selectedCourse.code} · ${selectedCourse.name}` : 'Choose course ▾'}</Text>
        </Pressable>
        <TextInput editable={!busy} value={title} onChangeText={setTitle} placeholder="Source title" placeholderTextColor={C.faint} accessibilityLabel="Source title" style={{ color: C.ink, backgroundColor: C.cell, borderRadius: 12, padding: 14, fontSize: 16 }} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn title={file ? 'Choose another file' : 'Choose PDF, TXT, or MD'} icon="document-outline" kind="secondary" style={{ flex: 1 }} onPress={pickFile} disabled={!courses.length || busy} />
          {file ? <Btn title="Remove" kind="plain" onPress={() => setFile(null)} disabled={busy} /> : null}
        </View>
        {file ? <Text style={{ color: C.sec, fontSize: 13 }}>Selected: {file.name}{Number.isFinite(file.size) ? ` · ${(file.size / 1024 / 1024).toFixed(2)} MB` : ''}. The file is sent for text extraction only when you import.</Text> : null}
        <Text style={{ color: C.sec, fontWeight: '600' }}>{file ? 'Or paste text instead' : 'Or paste source text'}</Text>
        <TextInput value={text} onChangeText={(value) => { setText(value.slice(0, MAX_SOURCE_CHARS)); if (value) setFile(null); }} editable={!busy} maxLength={MAX_SOURCE_CHARS} multiline textAlignVertical="top" placeholder="Paste the relevant course material…" placeholderTextColor={C.faint} accessibilityLabel="Source text" style={{ minHeight: 180, color: C.ink, backgroundColor: C.cell, borderRadius: 12, padding: 14, fontSize: 15, lineHeight: 21 }} />
        <Text style={{ color: C.sec, fontSize: 12, textAlign: 'right' }}>{text.length.toLocaleString()} / {MAX_SOURCE_CHARS.toLocaleString()} characters</Text>
        {feedback ? <Text accessibilityRole="alert" style={{ color: C.rec, lineHeight: 20 }}>{feedback}</Text> : null}
        <Btn title="Import and analyze document" icon="add-circle-outline" busy={busy} disabled={!courses.length} onPress={() => saveSource(true)} />
        <Btn title="Save without AI analysis" kind="secondary" disabled={!courses.length || busy} onPress={() => saveSource(false)} />
      </Screen>
    </>
  );
}