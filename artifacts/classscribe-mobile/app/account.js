import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Switch, Text, TextInput, View } from 'react-native';
import { Alert } from '../lib/notify';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useStore } from '../lib/store';
import { getServer, getUid, health, validSyncCode } from '../lib/api';
import { removeProfilePhoto, uploadProfilePhoto, useProfilePhoto } from '../lib/profile-photo';
import { billingStatusLabel, planName, useBillingStatus } from '../lib/billing';
import { C } from '../lib/theme';
import { accountProfilePatch } from '../lib/account-profile';
import { Btn, Row, Screen, Section, s } from '../components/ui';
import { ProfileFields } from '../components/ProfileFields';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { useCreditsStatus } from '../lib/credits-status';
import { UsageAllowances } from '../components/UsageAllowances';
import { AccountSessionControls } from '../components/AccountSessionControls';

function legalPageUrl(page) {
  const configured = process.env.EXPO_PUBLIC_WEB_URL || process.env.EXPO_PUBLIC_DOMAIN || getServer();
  if (!configured) return '';
  const base = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${page}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export default function Account() {
  const st = useStore();
  const billing = useBillingStatus(st.status.uid);
  const credits = useCreditsStatus(st.status.uid);
  const [p, setP] = useState(st.profile || {});
  const [server, setServer] = useState(st.status.server);
  const [info, setInfo] = useState(null);
  const [legalMessage, setLegalMessage] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoRevision, setPhotoRevision] = useState(0);
  const photo = useProfilePhoto(st.status.uid, st.status.server, photoRevision);
  const profileBase = useRef({ ...(st.profile || {}) });
  const draftLibrary = useRef(st.status.uid);
  const awaitingLibraryProfile = useRef(false);

  function openLegalPage(page) {
    const url = legalPageUrl(page);
    if (!url) {
      setLegalMessage('The ClassScribe website is not configured for this app.');
      return;
    }
    Linking.openURL(url).then(() => setLegalMessage('')).catch(() => {
      setLegalMessage('Could not open this page. Try again later or open the ClassScribe website.');
    });
  }

  useEffect(() => { health().then(setInfo); }, [st.status.server]);
  useEffect(() => {
    if (draftLibrary.current !== st.status.uid) {
      draftLibrary.current = st.status.uid;
      awaitingLibraryProfile.current = !st.profile;
      setP(st.profile || {});
      profileBase.current = { ...(st.profile || {}) };
    } else if (awaitingLibraryProfile.current && st.profile) {
      awaitingLibraryProfile.current = false;
      setP(st.profile);
      profileBase.current = { ...st.profile };
    }
  }, [st.status.uid, st.profile]);

  async function saveProfile() {
    if (!(p.firstName || '').trim()) return Alert.alert('Enter your first name');
    const patch = accountProfilePatch(p, profileBase.current);
    setBusy('p');
    try {
      await st.saveProfile(patch);
      profileBase.current = { ...profileBase.current, ...patch };
      Alert.alert('Saved', 'Your account details are updated.');
    } catch (e) { Alert.alert('Could not save', e.message || 'Check your connection and try again.'); }
    finally { setBusy(''); }
  }
  async function choosePhoto() {
    const uid = st.status.uid;
    const selectedServer = st.status.server;
    if (!st.status.server || !uid || uid !== getUid()) return Alert.alert('Library unavailable', 'Open your library and connect to the server before choosing a photo.');
    setPhotoBusy(true);
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) return Alert.alert('Photo access is off', 'Allow ClassScribe to access your photos in Settings.');
      }
      const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
      if (selected.canceled || !selected.assets?.[0]?.uri) return;
      if (uid !== getUid() || selectedServer !== getServer()) return;
      await uploadProfilePhoto(uid, selected.assets[0], selectedServer);
      if (uid === getUid() && selectedServer === getServer()) setPhotoRevision((value) => value + 1);
    } catch (error) {
      Alert.alert('Could not save photo', error?.message || 'Choose another photo and try again.');
    } finally {
      setPhotoBusy(false);
    }
  }
  async function removePhoto(uid, selectedServer) {
    if (!uid || uid !== getUid() || selectedServer !== getServer()) return;
    setPhotoBusy(true);
    try {
      await removeProfilePhoto(uid, selectedServer);
      if (uid === getUid() && selectedServer === getServer()) setPhotoRevision((value) => value + 1);
    } catch (error) {
      Alert.alert('Could not remove photo', error?.message || 'Check your connection and try again.');
    } finally {
      setPhotoBusy(false);
    }
  }
  function confirmRemovePhoto() {
    const uid = st.status.uid;
    const selectedServer = st.status.server;
    const remove = () => removePhoto(uid, selectedServer);
    if (Platform.OS === 'web') {
      if (window.confirm('Remove your profile photo from this library and its other devices?')) void remove();
      return;
    }
    Alert.alert('Remove profile photo?', 'This removes the photo from this library on all devices.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove photo', style: 'destructive', onPress: remove },
    ]);
  }
  async function chooseHomeLayout(layout) {
    try { await st.saveHomeLayoutChoice(layout); }
    catch (e) { Alert.alert('Could not save Home layout', e.message || 'Your choice will be retried when this device reconnects.'); }
  }
  async function chooseAppearance(appearance) {
    try { await st.setAppearanceChoice(appearance); }
    catch (e) { Alert.alert('Could not save Appearance', e.message || 'Your choice will be retried when this device reconnects.'); }
  }
  async function connect() {
    setBusy('s'); const ok = await st.setServer(server); setInfo(await health()); setBusy('');
    Alert.alert(ok ? 'Connected' : 'Couldn’t connect', ok ? 'Your library is syncing with this server.' : 'Check the address. It should be your Replit app’s web address.');
  }
  async function useCode() {
    if (!validSyncCode(code)) return Alert.alert('That code doesn’t look right', 'Sync codes start with u_.');
    const recovering = st.status.syncCodeReplaced;
    Alert.alert(recovering ? 'Reconnect this library?' : 'Switch library?',
      recovering
        ? 'This phone’s saved changes will be kept and carried into the library for this replacement code. Only enter the new code for your library. Class invite codes are unchanged.'
        : 'This phone will show the library for that sync code instead of this one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: recovering ? 'Reconnect' : 'Switch', style: 'destructive', onPress: async () => {
        setBusy('c');
        const ok = await st.switchLibrary(code.trim());
        setBusy('');
        if (ok) {
          setCode('');
          if (recovering) Alert.alert('Library reconnected', 'Saved changes from this phone were kept and will sync to the replacement library.');
        } else {
          Alert.alert(recovering ? 'Could not reconnect' : 'Could not switch libraries',
            recovering ? 'Check the replacement code and your connection. Your saved work is still on this phone.' : 'Check the code and your connection. This phone’s library was not changed.');
        }
      } },
    ]);
  }
  function replaceCode() {
    Alert.alert('Replace your sync code?', 'Your notes and courses will move to a new code. The old code will stop working, and you’ll need to enter the new code on your other devices. This does not change class invite codes.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Replace code', style: 'destructive', onPress: async () => {
        setBusy('rotate');
        try {
          await st.replaceSyncCode();
          Alert.alert('Code replaced', 'Your library has moved. Copy the new code from this page to update your other devices.');
        } catch (e) {
          Alert.alert('Could not replace code', e.message || 'Your library remains on this device. Check your connection and try again.');
        } finally { setBusy(''); }
      } },
    ]);
  }

  return (
    <Screen>
      <Section title="Subscription" footer={Platform.OS === 'web' ? 'In-app subscriptions are purchased through the App Store or Google Play. This preview displays the plan confirmed by your library server.' : 'In-app subscriptions are purchased through the App Store or Google Play. ClassScribe applies plan access only after the library server confirms the subscription.'}>
        <Row
          title="Your plan"
          sub={billing.status
            ? `${billingStatusLabel(billing.status.status)}${typeof billing.status.recordingHoursUsed === 'number' ? ` · ${billing.status.recordingHoursUsed.toFixed(1)} of ${billing.status.recordingHoursLimit} monthly transcription hours used` : ''}`
            : billing.loading ? 'Checking this library’s plan…' : billing.error || 'Plan status unavailable'}
          icon="layers-outline"
          right={<Text style={{ color: C.sec, fontSize: 15 }}>{billing.status ? planName(billing.status.plan) : ''}</Text>}
          onPress={() => router.push('/plans')}
          last={!billing.error}
        />
        <UsageAllowances status={billing.status} />
        <Row
          title="Credits"
          sub={credits.status
            ? `${credits.status.balance} ${credits.status.currency.name} · Monthly bonus: Student ${credits.status.monthlyBonus.student}, Pro ${credits.status.monthlyBonus.pro}`
            : credits.loading ? 'Checking your balance and plan bonuses…' : credits.error || 'Credits unavailable'}
          icon="pulse-outline"
          iconColor={C.accent}
          right={credits.status ? <Text style={{ color: C.accent, fontSize: 14, fontWeight: '800' }}>{credits.status.balance}</Text> : null}
          onPress={() => router.push('/credits')}
          last
        />
        {billing.error ? (
          <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
            <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 13, lineHeight: 19 }}>{billing.error}</Text>
            <Btn title="Try again" kind="secondary" small onPress={billing.refresh} style={{ marginTop: 8 }} />
          </View>
        ) : null}
      </Section>
      <Section title="Sign-in methods" footer="See the providers connected to your signed-in ClassScribe account. Apple Hide My Email relay addresses are supported.">
        <Row title="Manage sign-in methods" sub="Connected Google and Apple accounts" icon="person-circle-outline" onPress={() => router.push('/account-sign-in-methods')} last />
        <AccountSessionControls />
      </Section>
      <Section title="Profile" footer="Choose a photo to share it with this library on your devices. Photos saved only in a browser are not uploaded automatically.">
        <View style={{ padding: 16, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <ProfileAvatar key={st.status.uid || 'none'} source={photo.source} initial={st.profile?.firstName?.[0]} size={76} />
            <View style={{ flex: 1, gap: 8 }}>
              <Btn title={photo.source ? 'Change photo' : 'Choose photo'} kind="secondary" small busy={photoBusy} disabled={photoBusy || !!busy} onPress={choosePhoto} testID="account-choose-photo" />
              {photo.source ? <Btn title="Remove photo" kind="plain" small disabled={photoBusy || !!busy} onPress={confirmRemovePhoto} testID="account-remove-photo" /> : null}
            </View>
          </View>
          {photo.error ? <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 13 }}>{photo.error}</Text> : null}
          <ProfileFields p={p} set={setP} />
        </View>
      </Section>
      <View style={{ marginHorizontal: 16, marginTop: 12 }}><Btn title="Save changes" onPress={saveProfile} busy={busy === 'p'} /></View>
      <Section title="Home layout" footer="Saved right away for this library and shared with your other devices.">
        {[
          ['class-first', 'Class-first (default)'],
          ['study-first', 'Study-first'],
          ['simple', 'Simple'],
        ].map(([layout, label], i) => (
          <Row key={layout} title={label} onPress={() => chooseHomeLayout(layout)}
            right={<Text style={{ color: C.accent, fontWeight: '700' }}>{(['study-first', 'simple'].includes(st.profile?.homeLayout) ? st.profile.homeLayout : 'class-first') === layout ? '✓' : ''}</Text>}
            last={i === 2} />
        ))}
      </Section>
      <Section title="Appearance" footer="Automatic matches this device. Your choice is saved for this library and shared with your other devices.">
        {[
          ['auto', 'Automatic (match my device)'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ].map(([appearance, label], i) => (
          <Row key={appearance} title={label} onPress={() => chooseAppearance(appearance)}
            right={<Text style={{ color: C.accent, fontWeight: '700' }}>{st.appearance === appearance ? '✓' : ''}</Text>}
            last={i === 2} />
        ))}
      </Section>

      <Section title="ClassScribe server" footer={info ? `Connected. AI is ${info.ai ? 'on' : 'off (add ANTHROPIC_API_KEY on the server)'}. Transcription is ${info.transcribe ? 'on' : 'off (add OPENAI_API_KEY on the server)'}.` : 'Not connected. Enter your Replit server’s web address.'}>
        <View style={{ padding: 12, gap: 10 }}>
          <TextInput value={server} onChangeText={setServer} placeholder="your-repl.replit.app" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={[s.input, { backgroundColor: C.bg }]} />
          <Btn title="Connect" small onPress={connect} busy={busy === 's'} />
        </View>
      </Section>

      <Section title="Sync with the web" footer="Enter this code on ClassScribe’s Account page on the web (or another phone) to use one library everywhere. Keep it private: anyone with it can open your library.">
        {st.status.syncCodeReplaced ? <View accessibilityRole="alert" style={{ margin: 12, marginBottom: 0, padding: 12, borderRadius: 10, backgroundColor: C.warnSoft }}>
          <Text style={{ color: C.warn, fontWeight: '700', marginBottom: 4 }}>This library code was replaced</Text>
          <Text style={{ color: C.ink, fontSize: 13, lineHeight: 19 }}>Background sync stopped. Your saved changes are still on this phone. Enter the replacement code for this library below to reconnect; your locally saved changes will be carried forward. Class invite codes are unchanged.</Text>
        </View> : null}
        <Row title="Your sync code" sub={st.status.uid} right={<Btn title="Copy" kind="plain" small onPress={() => Clipboard.setStringAsync(st.status.uid)} />} />
        <View style={{ padding: 12, gap: 10 }}>
          <TextInput value={code} onChangeText={setCode} placeholder="Use a code from another device: u_…" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} style={[s.input, { backgroundColor: C.bg }]} />
          <Btn title={st.status.syncCodeReplaced ? 'Reconnect with replacement code' : 'Use this code'} kind="secondary" small onPress={useCode} busy={busy === 'c'} />
          <Btn title="Replace compromised code" kind="secondary" small onPress={replaceCode} busy={busy === 'rotate'} />
        </View>
      </Section>

      <Section title="Example courses" footer="BIO 101 and CHEM 110 with sample lectures and notes, for trying every feature.">
        <Row title="Show example courses" right={<Switch value={st.showEx} onValueChange={st.setShowEx} trackColor={{ true: C.accent }} />} last chevron={false} />
      </Section>
      {Platform.OS !== 'web' ? <Section title="Past recordings" footer="Check this phone for audio that was saved before example-course lectures were kept in your library.">
        <Row title="Recover missing recordings" icon="refresh-circle-outline" onPress={() => router.push('/recover-recordings')} last />
      </Section> : null}
      <Section title="Help & contact">
        <Row title="Help chatbot" sub="Ask about plans, limits, or using ClassScribe" icon="help-circle-outline"
          onPress={() => router.push('/support')} />
      </Section>
      <Section title="Legal & privacy" footer={legalMessage || undefined}>
        <Row title="Privacy Notice" sub="How ClassScribe handles your information" icon="shield-checkmark-outline"
          onPress={() => openLegalPage('privacy.html')} />
        <Row title="Privacy controls" sub="Export a private ZIP or delete your library data" icon="lock-closed-outline"
          onPress={() => router.push('/privacy-settings')} />
        <Row title="Terms of Service" sub="Terms for using ClassScribe" icon="document-text-outline" last
          onPress={() => openLegalPage('terms.html')} />
      </Section>
      <Text style={{ textAlign: 'center', color: C.sec, fontSize: 12, marginTop: 24 }}>ClassScribe {p.level ? '· ' + p.level : ''}</Text>
    </Screen>
  );
}
