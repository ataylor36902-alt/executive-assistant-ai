import React, { useRef, useState } from 'react';
import { Alert, Keyboard, Platform, Text, View } from 'react-native';
import { useClerk, useUser } from '@clerk/expo';
import { router } from 'expo-router';
import { clerkPublishableKey } from '../lib/clerk-config';
import { C } from '../lib/theme';
import { Btn } from './ui';

const SIGN_OUT_MESSAGE = 'This signs out of your ClassScribe account. Your library stays saved on this device and can still be opened with its private sync code. Signing out does not delete your data or cancel a subscription.';

function ConfiguredSessionControls() {
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);

  async function signOut() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    Keyboard.dismiss();
    try {
      await clerk.signOut();
      // Only leave Account after Clerk confirms sign-out. Do not reset the
      // independent sync-code library or its locally saved recordings.
      router.replace('/account-sign-in');
    } catch (cause) {
      const detail = cause?.errors?.[0]?.longMessage || cause?.errors?.[0]?.message || cause?.message;
      setError(detail ? `Could not sign out: ${detail}` : 'Could not sign out. Check your connection and try again.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function confirmSignOut() {
    if (running.current || !isLoaded) return;
    Keyboard.dismiss();
    if (Platform.OS === 'web') {
      if (window.confirm(`Sign out of account?\n\n${SIGN_OUT_MESSAGE}`)) void signOut();
      return;
    }
    // A native alert can be presented above the iOS Account modal; the global
    // in-app notice host belongs to the underlying navigation screen.
    Alert.alert('Sign out of account?', SIGN_OUT_MESSAGE, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', onPress: signOut },
    ]);
  }

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
      {isSignedIn ? (
        <Btn title="Sign out of account" kind="secondary" busy={busy} disabled={!isLoaded || busy} onPress={confirmSignOut} testID="account-sign-out" />
      ) : (
        <Btn title="Sign in to account" kind="secondary" disabled={!isLoaded} onPress={() => router.push('/account-sign-in')} testID="account-sign-in" />
      )}
      {error ? <Text accessibilityRole="alert" style={{ color: C.warn, lineHeight: 20 }}>{error}</Text> : null}
    </View>
  );
}

export function AccountSessionControls() {
  return clerkPublishableKey ? <ConfiguredSessionControls /> : null;
}
