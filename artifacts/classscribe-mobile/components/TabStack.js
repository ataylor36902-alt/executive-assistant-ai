import React, { useMemo } from 'react';
import { Stack } from 'expo-router';
import { C } from '../lib/theme';
import { useStore } from '../lib/store';
import BackButton from './BackButton';
import { renderHeaderTitle } from './HeaderTitle';

// Each tab gets its own stack so it shows an iOS large title that collapses on scroll.
export default function TabStack({ title }) {
  const { resolvedTheme } = useStore();
  const screenOptions = useMemo(() => ({
    headerLargeTitle: true,
    headerLargeTitleShadowVisible: false,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: C.bg },
    headerLargeStyle: { backgroundColor: C.bg },
    headerTintColor: C.accent,
    headerTitleStyle: { color: C.ink },
    headerTitle: renderHeaderTitle,
    headerLeft: title === 'Home' ? undefined : () => <BackButton toHome />,
    headerBackVisible: false,
    contentStyle: { backgroundColor: C.bg },
  }), [title, resolvedTheme]);
  return (
    <Stack
      screenOptions={screenOptions}
    >
      <Stack.Screen name="index" options={{ title }} />
    </Stack>
  );
}
