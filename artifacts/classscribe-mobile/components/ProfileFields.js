import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { C } from '../lib/theme';
import { curSemester } from '../lib/util';
import { s } from './ui';
import { useResolvedTheme } from '../lib/store';

export const LEVELS = ['High School', 'College', 'Graduate'];

export function ProfileFields({ p, set, ageBand }) {
  useResolvedTheme();
  const F = ({ k, label, ph, auto }) => (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput value={p[k] || ''} onChangeText={(v) => set({ ...p, [k]: v })} placeholder={ph} placeholderTextColor={C.faint} autoComplete={auto} style={s.input} />
    </View>
  );
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>{F({ k: 'firstName', label: 'First name', ph: 'Required', auto: 'given-name' })}</View>
        {ageBand !== '13-17' ? <View style={{ flex: 1 }}>{F({ k: 'lastName', label: 'Last name', ph: 'Optional', auto: 'family-name' })}</View> : null}
      </View>
      {F({ k: 'school', label: 'School', ph: 'e.g. State University', auto: 'organization' })}
      <View style={{ gap: 6 }}>
        <Text style={s.label}>Level</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {LEVELS.map((l) => (
            <Pressable key={l} onPress={() => set({ ...p, level: l })} accessibilityRole="radio" accessibilityState={{ selected: p.level === l }}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: p.level === l ? C.accent : C.cell }}>
              <Text style={{ color: p.level === l ? C.accentText : C.ink, fontWeight: '600' }}>{l}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={s.label}>Class format</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            ['online', 'Online'],
            ['in-person', 'In-person'],
          ].map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => set({ ...p, learningMode: value })}
              accessibilityRole="radio"
              accessibilityState={{ selected: p.learningMode === value }}
              testID={`class-format-${value}`}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: p.learningMode === value ? C.accent : C.cell }}
            >
              <Text style={{ color: p.learningMode === value ? C.accentText : C.ink, fontWeight: '600' }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ fontSize: 13, lineHeight: 18, color: C.sec }}>Your library syncs across your devices. Class format does not change billing.</Text>
      </View>
      {F({ k: 'major', label: 'Major or program', ph: 'Optional' })}
      {F({ k: 'term', label: 'Current term', ph: curSemester() })}
    </View>
  );
}

