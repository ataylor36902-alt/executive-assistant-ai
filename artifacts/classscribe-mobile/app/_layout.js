import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { StoreProvider } from '../lib/store';
import { clerkPublishableKey } from '../lib/clerk-config';
import { ActionSheetHost } from '../components/ActionSheet';
import { InAppNoticeHost } from '../components/InAppNoticeHost';
import BackButton from '../components/BackButton';
import { renderHeaderTitle } from '../components/HeaderTitle';
import { LaunchIntro } from '../components/LaunchIntro';
import { AiConsentDialog } from '../components/AiConsentDialog';
import { C } from '../lib/theme';
import { useStore } from '../lib/store';
import { needsOnboardingPlan } from '../lib/onboarding-plan';
import { flushPrivacyConsents } from '../lib/privacy';

const queryClient = new QueryClient();

function PrivacyConsentSync() {
  const { getToken, isLoaded } = useAuth();
  const { status } = useStore();
  useEffect(() => {
    const libraryCode = status.uid;
    if (!isLoaded || !libraryCode || !status.online || status.loading) return undefined;
    let active = true;
    const flush = () => {
      if (active) flushPrivacyConsents(libraryCode, getToken).catch(() => {});
    };
    flush();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') flush(); });
    const timer = setInterval(flush, 30000);
    return () => { active = false; subscription.remove(); clearInterval(timer); };
  }, [getToken, isLoaded, status.uid, status.online, status.loading]);
  return null;
}

function AppNavigation() {
  const { resolvedTheme, profile } = useStore();
  const [showIntro, setShowIntro] = useState(true);
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appState.current === 'background' && nextState === 'active') setShowIntro(true);
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {clerkPublishableKey ? <PrivacyConsentSync /> : null}
      <StatusBar style={showIntro || resolvedTheme === 'dark' ? 'light' : 'dark'} backgroundColor={showIntro ? C.logo : C.bg} />
      <Stack
        screenOptions={{
          headerTintColor: C.accent,
          headerStyle: { backgroundColor: C.bg },
          headerTitleStyle: { color: C.ink },
          headerTitle: renderHeaderTitle,
          headerShadowVisible: false,
          headerBackVisible: false,
          headerLeft: () => <BackButton />,
          contentStyle: { backgroundColor: C.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="record" options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="recover-recordings" options={{ presentation: 'fullScreenModal', title: 'Recover recordings' }} />
        <Stack.Screen name="lecture/[id]" options={{ title: '' }} />
        <Stack.Screen name="note/[id]" options={{ title: '' }} />
        <Stack.Screen name="course/[id]" options={{ title: '' }} />
        <Stack.Screen name="grades" options={{ title: 'Grades & GPA' }} />
        <Stack.Screen name="course-new" options={{ presentation: 'modal', title: 'Add course' }} />
        <Stack.Screen name="exam" options={{ title: 'Exam Center' }} />
        <Stack.Screen name="guide" options={{ title: 'Study guide' }} />
        <Stack.Screen name="cards" options={{ title: 'Flashcards' }} />
        <Stack.Screen name="tutor" options={{ title: 'Quiz me' }} />
        <Stack.Screen name="catchup/[id]" options={{ title: 'I missed class' }} />
        <Stack.Screen name="account" options={{ presentation: 'modal', title: 'Account', headerStyle: { backgroundColor: C.bg }, headerBackground: () => <View testID="account-header-surface" style={{ flex: 1, backgroundColor: C.bg }} /> }} />
        <Stack.Screen name="privacy-settings" options={{ title: 'Privacy & data' }} />
        <Stack.Screen name="account-sign-in-methods" options={{ title: 'Sign-in methods' }} />
        <Stack.Screen name="support" options={{ title: 'Help' }} />
        <Stack.Screen name="plans" options={{ title: 'Plans', headerLeft: () => <BackButton destination={needsOnboardingPlan(profile) ? '/welcome' : undefined} /> }} />
        <Stack.Screen name="credits" options={{ headerShown: false }} />
        <Stack.Screen name="account-sign-in" options={{ presentation: 'modal', title: 'Account sign-in' }} />
        <Stack.Screen name="recover-library" options={{ title: 'Open your library' }} />
        <Stack.Screen name="schedule" options={{ title: 'Schedule' }} />
        <Stack.Screen name="schedule-import" options={{ presentation: 'card', title: 'Scan or upload schedule', headerLeft: () => <BackButton destination="/schedule" /> }} />
        <Stack.Screen name="course-times/[id]" options={{ presentation: 'modal', title: 'Class times' }} />
      </Stack>
      <ActionSheetHost />
      <InAppNoticeHost />
      <AiConsentDialog />
      {showIntro && <LaunchIntro onFinish={() => setShowIntro(false)} />}
    </View>
  );
}

export default function RootLayout() {
  const app = <StoreProvider><AppNavigation /></StoreProvider>;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <KeyboardProvider>
          {clerkPublishableKey ? (
            <ClerkProvider
              publishableKey={clerkPublishableKey}
              tokenCache={Platform.OS === 'web' ? undefined : tokenCache}
              proxyUrl={process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined}
            >
              {app}
            </ClerkProvider>
          ) : app}
        </KeyboardProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
