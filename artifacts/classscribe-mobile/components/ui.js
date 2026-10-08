import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { KeyboardToolbar } from 'react-native-keyboard-controller';
import { KeyboardAwareScrollViewCompat } from './KeyboardAwareScrollViewCompat';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { C, getActiveTheme } from '../lib/theme';
import { fmtT, fmtD } from '../lib/util';
import { useResolvedTheme } from '../lib/store';

export function Screen({ children, style, refreshControl }) {
  useResolvedTheme();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAwareScrollViewCompat style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[{ paddingBottom: 120 }, style]} bottomOffset={120} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
        {children}
      </KeyboardAwareScrollViewCompat>
      {Platform.OS !== 'web' ? <KeyboardToolbar showArrows={false} doneText="Done" /> : null}
    </View>
  );
}
export function Section({ title, footer, children, style }) {
  useResolvedTheme();
  return (
    <View style={[{ marginTop: 22, marginHorizontal: 16 }, style]}>
      {title ? <Text style={s.sectionTitle}>{title.toUpperCase()}</Text> : null}
      <View style={s.group}>{children}</View>
      {footer ? <Text style={s.footer}>{footer}</Text> : null}
    </View>
  );
}
export function Row({ icon, iconBg, iconColor, lead, title, sub, right, onPress, last, destructive, chevron = !!onPress, numberOfLines = 1 }) {
  useResolvedTheme();
  const body = (
    <View style={s.row}>
      {lead || (icon ? (iconBg ? <View style={[s.icoBox, { backgroundColor: iconBg }]}><Ionicons name={icon} size={17} color={C.white} /></View> : <Ionicons name={icon} size={21} color={iconColor || C.sec} style={{ width: 28 }} />) : null)}
      <View style={[s.rowBody, !last && s.sep]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.rowTitle, destructive && { color: C.rec }]} numberOfLines={numberOfLines}>{title}</Text>
          {sub ? <Text style={s.rowSub} numberOfLines={2}>{sub}</Text> : null}
        </View>
        {right}
        {chevron ? <Ionicons name="chevron-forward" size={17} color={C.faint} /> : null}
      </View>
    </View>
  );
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: C.fill }} accessibilityRole="button">{body}</Pressable> : body;
}
export function Btn({ title, onPress, kind = 'primary', icon, disabled, busy, style, small, accessibilityLabel, accessibilityState, testID }) {
  useResolvedTheme();
  const k = { primary: [C.accent, C.accentText], secondary: [C.accentSoft, C.accent], rec: [C.rec, C.white], plain: ['transparent', C.accent], dark: [C.black, C.white] }[kind] || [C.accent, C.accentText];
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ ...accessibilityState, disabled: disabled || busy }} testID={testID} style={({ pressed }) => [s.btn, small && s.btnSm, { backgroundColor: k[0], opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}>
      {busy ? <ActivityIndicator color={k[1]} /> : icon ? <Ionicons name={icon} size={small ? 16 : 19} color={k[1]} /> : null}
      <Text style={[s.btnText, small && { fontSize: 15 }, { color: k[1] }]}>{title}</Text>
    </Pressable>
  );
}
export function Seg({ options, value, onChange, style }) {
  useResolvedTheme();
  return (
    <View style={[s.seg, style]} accessibilityRole="tablist">
      {options.map(([k, label]) => (
        <Pressable key={k} onPress={() => onChange(k)} accessibilityRole="tab" accessibilityState={{ selected: value === k }} style={[s.segItem, value === k && s.segOn]}>
          <Text style={s.segText} numberOfLines={1}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
export function Chip({ label, color = C.accent, bg }) {
  useResolvedTheme();
  return <View style={{ backgroundColor: bg || color + '1F', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}><Text style={{ color, fontSize: 12, fontWeight: '600' }}>{label}</Text></View>;
}
export function Card({ children, style }) { useResolvedTheme(); return <View style={[s.card, style]}>{children}</View>; }
export function Empty({ text, children }) {
  useResolvedTheme();
  return <View style={s.empty}><Text style={{ color: C.sec, fontSize: 15, textAlign: 'center' }}>{text}</Text>{children}</View>;
}
export function Cite({ lecture, t, label, note, assignment }) {
  useResolvedTheme();
  const onPress = lecture
    ? () => router.push({ pathname: '/lecture/[id]', params: { id: lecture, tab: 'transcript', t: String(t) } })
    : note
      ? () => router.push(`/note/${note}`)
      : () => router.push({ pathname: '/course/[id]', params: { id: assignment.courseId, tab: 'assign', assignmentId: assignment.id } });
  return (
    <Text onPress={onPress} style={s.cite} accessibilityRole="link">
      {' ▶ ' + (label || (lecture ? fmtT(t) : note ? 'Open note' : 'Open assignment')) + ' '}
    </Text>
  );
}

/* Minimal markdown with validated lecture, private-note and assignment citations. */
function inline(str, getLecture, getNote, getAssignment, key, strictLectureCitations) {
  const parts = []; let rest = String(str); let i = 0;
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[\[(?:[\w-]+@[\d.]+|note:[\w-]+|assignment:[\w-]+)\]\])/;
  while (rest.length) {
    const m = rest.match(re);
    if (!m) { parts.push(rest); break; }
    if (m.index) parts.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(<Text key={key + 'b' + i} style={{ fontWeight: '700' }}>{tok.slice(2, -2)}</Text>);
    else if (tok.startsWith('[[')) {
      const cite = tok.slice(2, -2);
      const lectureMatch = cite.match(/^([\w-]+)@([\d.]+)$/);
      const noteMatch = cite.match(/^note:([\w-]+)$/);
      const assignmentMatch = cite.match(/^assignment:([\w-]+)$/);
      const l = lectureMatch && getLecture && getLecture(lectureMatch[1]);
      if (l && (!strictLectureCitations || (l.segs || []).some((segment) => segment.t != null && segment.t !== '' && Number.isFinite(Number(segment.t)) && Number(segment.t) === Number(lectureMatch[2])))) {
        parts.push(<Cite key={key + 'c' + i} lecture={lectureMatch[1]} t={+lectureMatch[2]} label={`${fmtD(l.date)} · ${fmtT(+lectureMatch[2])}`} />);
      } else if (noteMatch) {
        const note = getNote && getNote(noteMatch[1]);
        if (note) parts.push(<Cite key={key + 'c' + i} note={note.id} label={note.title || 'Open note'} />);
        else parts.push(<Text key={key + 'u' + i} style={{ color: C.sec }}>[source unavailable]</Text>);
      } else if (assignmentMatch) {
        const assignment = getAssignment && getAssignment(assignmentMatch[1]);
        if (assignment) parts.push(<Cite key={key + 'c' + i} assignment={assignment} label={assignment.title || 'Open assignment'} />);
        else parts.push(<Text key={key + 'u' + i} style={{ color: C.sec }}>[source unavailable]</Text>);
      } else {
        parts.push(<Text key={key + 'u' + i} style={{ color: C.sec }}>[source unavailable]</Text>);
      }
    } else parts.push(<Text key={key + 'i' + i} style={{ fontStyle: 'italic' }}>{tok.slice(1, -1)}</Text>);
    rest = rest.slice(m.index + tok.length); i++;
  }
  return parts;
}
export function Md({ text, getLecture, getNote, getAssignment, strictLectureCitations = false, size = 16 }) {
  useResolvedTheme();
  const lines = String(text || '').split('\n');
  return (
    <View style={{ gap: 6 }}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd(); let m;
        if (!line.trim()) return <View key={i} style={{ height: 4 }} />;
        if ((m = line.match(/^(#{1,4})\s+(.*)/))) return <Text key={i} style={{ fontSize: m[1].length <= 2 ? 20 : 17, fontWeight: '700', marginTop: 8, color: C.ink }}>{inline(m[2], getLecture, getNote, getAssignment, i, strictLectureCitations)}</Text>;
        if ((m = line.match(/^\s*[-*•]\s+\[( |x|X)\]\s+(.*)/))) return <View key={i} style={s.li}><Ionicons name={m[1] === ' ' ? 'ellipse-outline' : 'checkmark-circle'} size={20} color={m[1] === ' ' ? C.faint : C.accent} /><Text style={[s.liText, { fontSize: size }]}>{inline(m[2], getLecture, getNote, getAssignment, i, strictLectureCitations)}</Text></View>;
        if ((m = line.match(/^\s*[-*•]\s+(.*)/))) return <View key={i} style={s.li}><Text style={{ color: C.accent, fontWeight: '800', fontSize: size }}>•</Text><Text style={[s.liText, { fontSize: size }]}>{inline(m[1], getLecture, getNote, getAssignment, i, strictLectureCitations)}</Text></View>;
        if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)/))) return <View key={i} style={s.li}><Text style={{ color: C.accent, fontWeight: '700', fontSize: size }}>{m[1]}.</Text><Text style={[s.liText, { fontSize: size }]}>{inline(m[2], getLecture, getNote, getAssignment, i, strictLectureCitations)}</Text></View>;
        if (line.startsWith('---')) return <View key={i} style={{ height: 1, backgroundColor: C.sep, marginVertical: 6 }} />;
        return <Text key={i} style={{ fontSize: size, lineHeight: size * 1.4, color: C.ink }}>{inline(line, getLecture, getNote, getAssignment, i, strictLectureCitations)}</Text>;
      })}
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  sectionTitle: { fontSize: 13, color: C.sec, marginLeft: 16, marginBottom: 7 },
  footer: { fontSize: 13, color: C.sec, marginHorizontal: 16, marginTop: 7, lineHeight: 18 },
  group: { backgroundColor: C.cell, borderRadius: 10, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, gap: 12, minHeight: 44 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingRight: 16 },
  sep: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.sep },
  rowTitle: { fontSize: 17, color: C.ink },
  rowSub: { fontSize: 14, color: C.sec, marginTop: 2 },
  icoBox: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btn: { height: 50, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 },
  btnSm: { height: 36, borderRadius: 10, paddingHorizontal: 12 },
  btnText: { fontSize: 17, fontWeight: '600' },
  seg: { flexDirection: 'row', backgroundColor: C.fill, borderRadius: 9, padding: 2, marginHorizontal: 16 },
  segItem: { flex: 1, paddingVertical: 6, borderRadius: 7, alignItems: 'center' },
  segOn: { backgroundColor: C.cell, shadowColor: C.black, shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segText: { fontSize: 13, fontWeight: '600', color: C.ink },
  card: { backgroundColor: C.cell, borderRadius: 14, padding: 14, marginHorizontal: 16, marginTop: 12, gap: 10 },
  empty: { margin: 16, marginTop: 22, padding: 24, borderRadius: 14, backgroundColor: C.cell, alignItems: 'center', gap: 12 },
  cite: { color: C.accent, fontWeight: '600', fontSize: 13, backgroundColor: C.bg },
  li: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  liText: { flex: 1, lineHeight: 22, color: C.ink },
  h1: { fontSize: 28, fontWeight: '700', color: C.ink },
  label: { fontSize: 13, fontWeight: '600', color: C.sec, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: { backgroundColor: C.cell, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, color: C.ink },
});
const styleCache = {};
export const s = new Proxy({}, { get: (_, key) => {
  const mode = getActiveTheme();
  if (!styleCache[mode]) styleCache[mode] = createStyles();
  return styleCache[mode][key];
} });
