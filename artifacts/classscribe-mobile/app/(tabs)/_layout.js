import React, { useMemo } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useStore } from '../../lib/store';
import { C } from '../../lib/theme';
import { needsOnboardingPlan } from '../../lib/onboarding-plan';

function RecordButton() {
  useStore();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Record a lecture"
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); router.push('/record'); }}
      style={{ flex: 1, alignItems: 'center' }}
    >
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.rec, alignItems: 'center', justifyContent: 'center', marginTop: -14, shadowColor: C.rec, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
        <Ionicons name="mic" size={24} color={C.white} />
      </View>
      <Text style={{ fontSize: 10, fontWeight: '600', color: C.rec, marginTop: 2 }}>Record</Text>
    </Pressable>
  );
}
function TabIcon({ on, off, focused }) {
  useStore();
  return <Ionicons name={focused ? on : off} size={25} color={focused ? C.accent : C.sec} />;
}
function AskTabIcon({ focused }) {
  useStore();
  return <Image source={require('../../assets/images/katherine-johnson-avatar.png')} accessible={false} style={{ width: 29, height: 29, borderRadius: 15, backgroundColor: C.accentSoft, borderWidth: focused ? 2 : 0, borderColor: C.accent }} />;
}
function TabLabel({ children, focused }) {
  useStore();
  return <Text style={{ fontSize: 10, fontWeight: '600', color: focused ? C.accent : C.sec }}>{children}</Text>;
}
function TabBarSurface() {
  useStore();
  return <View style={{ flex: 1, backgroundColor: C.cell, borderTopWidth: 0.5, borderTopColor: C.sep }} />;
}

export default function TabLayout() {
  const { profile, resolvedTheme } = useStore();
  const screenOptions = useMemo(() => ({
    headerShown: false,
    tabBarActiveTintColor: C.accent,
    tabBarInactiveTintColor: C.sec,
    tabBarStyle: { backgroundColor: C.cell, borderTopColor: C.sep, borderTopWidth: 0.5 },
    tabBarBackground: () => <TabBarSurface />,
    tabBarLabelStyle: { fontWeight: '600' },
    tabBarHideOnKeyboard: true,
  }), [resolvedTheme]);
  if (profile === undefined) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator color={C.accent} /></View>;
  if (profile === null) return <Redirect href="/welcome" />;
  if (needsOnboardingPlan(profile)) return <Redirect href={{ pathname: '/plans', params: { onboarding: '1' } }} />;
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarLabel: (props) => <TabLabel {...props} />, tabBarIcon: (props) => <TabIcon on="home" off="home-outline" {...props} /> }} />
      <Tabs.Screen name="notes" options={{ title: 'Notes', tabBarLabel: (props) => <TabLabel {...props} />, tabBarIcon: (props) => <TabIcon on="create" off="create-outline" {...props} /> }} />
      <Tabs.Screen name="record-tab" options={{ title: 'Record', tabBarButton: () => <RecordButton /> }} />
      <Tabs.Screen name="ask" options={{ title: 'Ask', tabBarLabel: (props) => <TabLabel {...props} />, tabBarIcon: (props) => <AskTabIcon {...props} /> }} />
      <Tabs.Screen name="class" options={{ title: 'Class', tabBarLabel: (props) => <TabLabel {...props} />, tabBarIcon: (props) => <TabIcon on="people" off="people-outline" {...props} /> }} />
      <Tabs.Screen name="contact" options={{ title: 'Contact', tabBarLabel: (props) => <TabLabel {...props} />, tabBarIcon: (props) => <TabIcon on="mail" off="mail-outline" {...props} /> }} />
    </Tabs>
  );
}
