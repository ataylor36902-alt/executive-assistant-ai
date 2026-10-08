import React from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../lib/theme';
import { useResolvedTheme } from '../lib/store';

export function goBack(fallback = '/home') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

export default function BackButton({ toHome = false, destination }) {
  useResolvedTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      testID="navigation-back"
      hitSlop={8}
      onPress={destination ? () => router.replace(destination) : toHome ? () => router.navigate('/home') : () => goBack()}
      style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 12, minHeight: 44 }}
    >
      <Ionicons name="chevron-back" size={23} color={C.accent} />
      <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ color: C.accent, fontSize: 17 }}>Back</Text>
    </Pressable>
  );
}