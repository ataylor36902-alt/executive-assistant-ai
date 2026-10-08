import React, { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Alert } from '../lib/notify';
import { KeyboardAwareScrollViewCompat } from '../components/KeyboardAwareScrollViewCompat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from '../lib/store';
import { validSyncCode } from '../lib/api';
import { C } from '../lib/theme';
import { curSemester } from '../lib/util';
import { Btn, s } from '../components/ui';
import { ProfileFields } from '../components/ProfileFields';
import { OptionalSignIn } from '../components/OptionalSignIn';
import { clerkPublishableKey } from '../lib/clerk-config';
import { canShowProfileSetup } from '../lib/required-auth';
import { linkCurrentLibrary } from '../lib/library-link';
import { savePrivacyAge } from '../lib/privacy';

function WelcomeHero() {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingTop: 20 }}>
      <Image
        source={require('../assets/classscribe/icon.png')}
        style={{ width: 88, height: 88, borderRadius: 20 }}
        accessibilityLabel="ClassScribe logo"
      />
      <Text style={{ fontSize: 32, fontWeight: '800', color: C.ink, textAlign: 'center' }}>ClassScribe</Text>
    </View>
  );
}

function ConfiguredWelcome() {
  const { isSignedIn, getToken } = useAuth();
  const { saveProfile, status, setServer, switchLibrary } = useStore();
  const [p, setP] = useState({ firstName: '', lastName: '', school: '', level: 'College', major: '', term: curSemester() });
  const [agree, setAgree] = useState(false);
  const [server, setServerText] = useState(status.server || '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [accountReady, setAccountReady] = useState(false);
  const [ageBand, setAgeBand] = useState('');
  const profileSetupAllowed = canShowProfileSetup({ clerkConfigured: true, isSignedIn, accountReady });

  useEffect(() => {
    let active = true;
    if (!isSignedIn) return undefined;
    AsyncStorage.getItem('cs_privacy_ageband_pending').then((savedBand) => {
      if (!active || !['13-17', '18+'].includes(savedBand)) return;
      setAgeBand(savedBand);
      if (savedBand === '13-17') setP((current) => ({ ...current, lastName: '', level: 'High School' }));
    });
    return () => { active = false; };
  }, [isSignedIn]);

  function requireAccount() {
    if (profileSetupAllowed) return true;
    setAccountReady(false);
    return false;
  }

  async function create() {
    if (busy) return;
    if (!requireAccount()) return;
    if (!p.firstName.trim()) return Alert.alert('Enter your first name');
    if (!agree) {
      return Alert.alert(
        'Recording permission',
        'Only record classes where your instructor and school allow it. Do you agree to follow this rule?',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'I agree — create library', onPress: async () => { setAgree(true); await createConfirmed(); } },
        ],
      );
    }
    await createConfirmed();
  }

  async function createConfirmed() {
    if (busy) return;
    setBusy('create');
    try {
      // There is no existing library to download during new-library setup.
      if (server.trim() && server.trim() !== status.server) await setServer(server, { refreshData: false });
      const pendingAgeBand = await AsyncStorage.getItem('cs_privacy_ageband_pending');
      const selectedAgeBand = ['13-17', '18+'].includes(pendingAgeBand) ? pendingAgeBand : ageBand;
      if (selectedAgeBand) setAgeBand(selectedAgeBand);
      await saveProfile({
        ...p,
        firstName: p.firstName.trim(),
        lastName: selectedAgeBand === '13-17' ? '' : p.lastName.trim(),
        ...(selectedAgeBand ? { ageBand: selectedAgeBand } : {}),
        ...(selectedAgeBand === '13-17' ? { level: 'High School' } : {}),
        term: p.term || curSemester(),
        created: Date.now(),
        updated: Date.now(),
        onboardingPlanPending: true,
      });
      if (isSignedIn && ['13-17', '18+'].includes(selectedAgeBand)) {
        await linkCurrentLibrary(getToken, status.uid);
        await savePrivacyAge(selectedAgeBand, getToken, status.uid);
        await AsyncStorage.removeItem('cs_privacy_ageband_pending');
      }
      router.replace({ pathname: '/plans', params: { onboarding: '1' } });
    } catch (error) {
      Alert.alert('Could not create library', error?.message || 'Check your connection and try again.');
    } finally {
      setBusy('');
    }
  }
  async function useCode() {
    if (busy) return;
    if (!requireAccount()) return;
    if (!validSyncCode(code)) return Alert.alert('That code doesn’t look right', 'Sync codes start with u_ and are shown on the Account page of ClassScribe on the web.');
    if (!server.trim() && !status.server) return Alert.alert('Add the server address first');
    setBusy('existing');
    try {
      // Switching downloads the destination library; don't download the
      // current empty library first when the server address changes.
      if (server.trim() && server.trim() !== status.server) await setServer(server, { refreshData: false });
      const ok = await switchLibrary(code.trim());
      if (!ok) Alert.alert('Couldn’t open library', 'Check the sync code, server address, and your connection.');
      else router.replace('/home');
    } catch (error) {
      Alert.alert('Couldn’t open library', error?.message || 'Check your connection and try again.');
    } finally {
      setBusy('');
    }
  }
  async function recoverWithSignIn() {
    if (busy) return;
    if (!requireAccount()) return;
    setBusy('recover');
    try {
      if (server.trim() && server.trim() !== status.server) await setServer(server, { refreshData: false });
      router.push('/recover-library');
    } catch (error) {
      Alert.alert('Could not connect', error.message || 'Check the server address and try again.');
    } finally {
      setBusy('');
    }
  }

  if (!profileSetupAllowed) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
        <OptionalSignIn
          required
          continueLabel="Continue to profile setup"
          onContinue={() => setAccountReady(true)}
          hero={<WelcomeHero />}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <KeyboardAwareScrollViewCompat bottomOffset={120} keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 32, fontWeight: '800', color: C.ink }}>Set up your library</Text>
          <Text style={{ fontSize: 14, lineHeight: 21, color: C.sec }}>Set up your profile and library, then choose a plan to finish getting started.</Text>
          {ageBand === '13-17' ? <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>High school privacy settings are on: only your first name is used in class discussions, and class sharing and public profiles are off.</Text> : null}
          <ProfileFields p={p} set={setP} ageBand={ageBand} />
          {!status.loading && !status.server ? (
            <View style={{ gap: 6 }}>
              <Text style={s.label}>ClassScribe server</Text>
              <TextInput value={server} onChangeText={setServerText} placeholder="your-repl.replit.app" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input} />
              <Text style={{ fontSize: 13, color: C.sec }}>The web address of your ClassScribe Replit server. You can add it later in Account.</Text>
            </View>
          ) : null}
          <View style={{ backgroundColor: C.cell, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ flex: 1, fontSize: 15, lineHeight: 20, color: C.ink }}>I’ll only record classes where my instructor and school allow it.</Text>
            <Switch value={agree} onValueChange={setAgree} trackColor={{ true: C.accent }} accessibilityLabel="Agree to recording rules" />
          </View>
          <Btn title="Create library" onPress={create} busy={busy === 'create'} disabled={status.loading || !!busy} />
          <View style={{ backgroundColor: C.cell, borderRadius: 12, padding: 14, gap: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: C.ink }}>Already use ClassScribe on the web?</Text>
            <Text style={{ fontSize: 13, color: C.sec }}>Enter the sync code from its Account page to use the same library here.</Text>
            <TextInput value={code} onChangeText={setCode} placeholder="u_…" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} style={[s.input, { backgroundColor: C.bg }]} />
            <Btn title="Use my existing library" kind="secondary" small onPress={useCode} busy={busy === 'existing'} disabled={status.loading || !!busy} />
            <Text style={{ fontSize: 13, color: C.sec }}>Already linked Apple, Google, or email sign-in to your library?</Text>
            <Btn title="Sign in to reopen my library" kind="plain" small onPress={recoverWithSignIn} busy={busy === 'recover'} disabled={status.loading || !!busy} />
          </View>
        </KeyboardAwareScrollViewCompat>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function Welcome() {
  if (!clerkPublishableKey) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
        <OptionalSignIn
          required
          hero={<WelcomeHero />}
        />
      </SafeAreaView>
    );
  }
  return <ConfiguredWelcome />;
}
