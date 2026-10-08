import { PropsWithChildren } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export function Screen({ children }: PropsWithChildren) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, {
    backgroundColor: colors.background,
    paddingTop: Platform.OS === 'web' ? 67 : insets.top + 22,
    paddingBottom: Platform.OS === 'web' ? 110 : insets.bottom + 110,
  }]} style={{ backgroundColor: colors.background }}>{children}</ScrollView>;
}

export function Heading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  const colors = useColors();
  return <View style={styles.heading}>
    {eyebrow ? <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>{eyebrow}</Text> : null}
    <View style={styles.titleRow}>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
    </View>
    {description ? <Text style={[styles.description, { color: colors.mutedForeground }]}>{description}</Text> : null}
  </View>;
}

export function Panel({ children, style }: PropsWithChildren & { style?: ViewProps['style'] }) {
  const colors = useColors();
  return <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, gap: 18, minHeight: '100%' },
  heading: { marginBottom: 12, gap: 6 },
  eyebrow: { fontFamily: 'AtkinsonHyperlegible_700Bold', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  title: { fontFamily: 'BricolageGrotesque_700Bold', fontSize: 35, lineHeight: 40, letterSpacing: -0.5 },
  description: { fontFamily: 'AtkinsonHyperlegible_400Regular', fontSize: 16, lineHeight: 24, marginTop: 4 },
  panel: { borderWidth: 1, padding: 18, gap: 14 },
});