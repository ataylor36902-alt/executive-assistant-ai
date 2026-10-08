import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { useClerk, useUser } from '@clerk/expo';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../lib/theme';
import { clerkPublishableKey } from '../lib/clerk-config';
import {
  APPLE_UNAVAILABLE_COPY,
  appleErrorMessage,
  appleStrategyAvailability,
  appleUnavailableMessage,
  isAppleStrategyUnavailableError,
  isProviderConnected,
  verifyAppleAccountLink,
} from '../lib/apple-auth';
import { Btn, Section } from '../components/ui';
import { goBack } from '../components/BackButton';

function clerkErrorText(error) {
  const detail = error?.errors?.[0] || error?.error?.errors?.[0];
  return detail?.longMessage || detail?.message || error?.message || 'Apple could not be linked. Try again.';
}

function SignInMethods() {
  const { user, isLoaded, isSignedIn } = useUser();
  const clerk = useClerk();
  const appleEnabled = appleStrategyAvailability(clerk.__internal_environment?.userSettings?.socialProviderStrategies);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  async function linkApple() {
    if (!user || busy) return;
    const originalUserId = user.id;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (appleEnabled === false) {
        setError(appleUnavailableMessage(null, clerkErrorText));
        return;
      }
      const redirectUrl = Platform.OS === 'web'
        ? window.location.href
        : AuthSession.makeRedirectUri({ scheme: 'classscribe-mobile', path: 'account-sign-in-methods' });
      const externalAccount = await user.createExternalAccount({
        strategy: 'oauth_apple',
        redirectUrl,
      });
      const verificationUrl = externalAccount.verification?.externalVerificationRedirectURL;
      if (!verificationUrl) throw new Error('Clerk did not provide an Apple authorization URL. Your account was not changed.');

      if (Platform.OS === 'web') {
        window.location.assign(verificationUrl.toString());
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(verificationUrl.toString(), redirectUrl);
      if (result.type === 'cancel' || result.type === 'dismiss') {
        setNotice('Apple linking was canceled. Your account and library were not changed.');
        return;
      }
      if (result.type !== 'success') {
        throw new Error(`Apple authorization ended without a verified callback (${result.type}). Your account and library were not changed.`);
      }

      if (clerk.user?.id !== originalUserId) {
        throw new Error('The signed-in account changed during Apple authorization. Your library was not changed; review the account before continuing.');
      }
      const refreshedUser = await clerk.user.reload();
      verifyAppleAccountLink(originalUserId, refreshedUser);
      if (clerk.user?.id !== originalUserId) {
        throw new Error('The signed-in account changed during Apple verification. Your library was not changed; review the account before continuing.');
      }
      setNotice('Apple is connected to this ClassScribe account. Your signed-in identity and library were kept.');
    } catch (exception) {
      const message = appleEnabled === false || isAppleStrategyUnavailableError(exception)
        ? appleUnavailableMessage(exception, clerkErrorText)
        : appleErrorMessage(exception, clerkErrorText);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  if (!isLoaded) return <View style={{ padding: 20 }}><Text style={{ color: C.sec }}>Loading sign-in methods…</Text></View>;
  if (!isSignedIn || !user) {
    return <View style={{ padding: 20, gap: 12 }}>
      <Text style={{ color: C.ink, fontSize: 15, lineHeight: 22 }}>Sign in to the ClassScribe account you want to connect. Linking a provider adds a sign-in method to that account; it does not switch your library.</Text>
      <Btn title="Sign in to ClassScribe" onPress={() => router.push('/account-sign-in')} />
    </View>;
  }

  const accounts = user.externalAccounts || [];
  const googleConnected = isProviderConnected(accounts, 'google');
  const appleConnected = isProviderConnected(accounts, 'apple');
  return (
    <View style={{ padding: 16, gap: 16 }}>
      <Section title="Connected sign-in methods" footer="Only methods verified on this signed-in ClassScribe account appear as connected.">
        {[
          ['Google', googleConnected],
          ['Apple', appleConnected],
        ].map(([provider, connected], index) => (
          <View key={provider} style={{ paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: index === 0 ? 1 : 0, borderBottomColor: C.line }}>
            <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{provider}</Text>
            <Text style={{ color: C.sec, fontSize: 13, marginTop: 3 }}>{connected ? 'Connected' : 'Not connected'}</Text>
          </View>
        ))}
      </Section>
      {!appleConnected && appleEnabled !== false ? <Btn title="Link Apple to this account" icon="logo-apple" kind="dark" busy={busy} disabled={busy} onPress={linkApple} testID="account-link-apple" /> : null}
      {!appleConnected && appleEnabled === false ? <Text accessibilityLiveRegion="polite" style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>{APPLE_UNAVAILABLE_COPY}</Text> : null}
      <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>
        Apple’s Hide My Email may provide a private relay address instead of your personal email. ClassScribe links Apple only to the account you are signed into; it never merges accounts based on a guessed or matching email address.
      </Text>
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: C.rec, fontSize: 14, lineHeight: 20 }}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: C.accent, fontSize: 14, lineHeight: 20 }}>{notice}</Text> : null}
      <Btn title="Back to Account" kind="plain" onPress={() => goBack('/account')} />
    </View>
  );
}

export default function AccountSignInMethods() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['bottom']}>
      {clerkPublishableKey
        ? <SignInMethods />
        : <View style={{ padding: 20 }}><Text style={{ color: C.sec }}>Account sign-in is unavailable on this build.</Text></View>}
    </SafeAreaView>
  );
}