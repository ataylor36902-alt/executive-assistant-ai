import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Image as CachedImage } from 'expo-image';
import { router } from 'expo-router';
import { useAuth, useClerk, useSession } from '@clerk/expo';
import { useStore } from '../lib/store';
import { getUid } from '../lib/api';
import { getPrivacyStatus, requestPrivacyDeletion, requestPrivacyExport } from '../lib/privacy';
import { C } from '../lib/theme';
import { Btn, Screen, Section, s } from '../components/ui';
import { PrivacySheet } from '../components/PrivacySheet';
import { aiConsentRequest, ensureAiConsent } from '../lib/ai-consent';

export default function PrivacySettings() {
  const st = useStore();
  const { getToken, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { session } = useSession();
  const libraryCode = st.status.uid;
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState('');
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const [activeBillingConsent, setActiveBillingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [deleteReceipt, setDeleteReceipt] = useState(null);
  const [exportMessage, setExportMessage] = useState('');
  const [reauthFactor, setReauthFactor] = useState('');
  const [reauthCode, setReauthCode] = useState('');
  const [reauthPassword, setReauthPassword] = useState('');
  const [aiPermission, setAiPermission] = useState(null);
  const [aiError, setAiError] = useState('');
  useEffect(() => {
    let active = true;
    setAiPermission(null); setAiError('');
    if (libraryCode && !st.status.loading) aiConsentRequest().then((result) => {
      if (active) setAiPermission(result);
    }).catch((cause) => { if (active) setAiError(cause.message); });
    return () => { active = false; };
  }, [libraryCode, st.status.loading, st.status.server]);

  useEffect(() => {
    let active = true;
    setStatus(null);
    setError('');
    if (!isSignedIn || !libraryCode || st.status.loading) {
      setLoading(false);
      setStatus(null);
      return undefined;
    }
    setLoading(true);
    getPrivacyStatus(getToken, libraryCode).then((result) => {
      if (active && libraryCode === getUid()) setStatus(result);
    }).catch((cause) => {
      if (active && libraryCode === getUid()) setError(cause.message || 'Privacy status is unavailable.');
    }).finally(() => { if (active && libraryCode === getUid()) setLoading(false); });
    return () => { active = false; };
  }, [getToken, isSignedIn, libraryCode, st.status.loading]);

  const finishExport = useCallback(async () => {
    const requestedFor = libraryCode;
    let temporaryExportFile = null;
    setBusy(true); setError(''); setExportMessage('');
    try {
      const ticket = await requestPrivacyExport(getToken, requestedFor);
      if (requestedFor !== getUid()) return;
      if (typeof ticket?.url !== 'string' || !ticket.url || !ticket.expiresAt) throw new Error('The server did not return a valid private export link.');
      const base = st.status.server.replace(/\/+$/, '');
      const url = /^https?:\/\//i.test(ticket.url) ? ticket.url : `${base}${ticket.url.startsWith('/') ? '' : '/'}${ticket.url}`;
      const response = await fetch(url, { headers: { Accept: 'application/zip' } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'The private ZIP could not be downloaded. Request a new export and try again.');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (requestedFor !== getUid()) return;
      temporaryExportFile = new File(Paths.cache, `classscribe-library-${Date.now()}.zip`);
      temporaryExportFile.create({ overwrite: true });
      temporaryExportFile.write(bytes);
      if (!(await Sharing.isAvailableAsync())) throw new Error('The private ZIP was downloaded, but sharing is unavailable on this device.');
      await Sharing.shareAsync(temporaryExportFile.uri, { mimeType: 'application/zip', dialogTitle: 'Save your private ClassScribe export' });
      if (requestedFor === getUid()) setExportMessage(`Private ZIP ready. Its download link expires ${new Date(ticket.expiresAt).toLocaleString()}. Another export is available after 24 hours.`);
    } catch (cause) {
      if (requestedFor === getUid()) setError(cause.message || 'The private export could not be created.');
    } finally {
      if (temporaryExportFile?.exists) temporaryExportFile.delete();
      if (requestedFor === getUid()) setBusy(false);
    }
  }, [getToken, libraryCode, st.status.server]);

  async function completeVerifiedDeletion() {
    if (libraryCode !== getUid()) throw new Error('The active library changed. Reopen its own Account page to continue.');
    const freshToken = await getToken({ skipCache: true });
    if (!freshToken) throw new Error('Sign in again to verify your identity before deleting this library.');
    const result = await requestPrivacyDeletion({
      confirmation: 'DELETE',
      confirmActiveSubscription: !!(status?.activeSubscription && activeBillingConsent),
    }, async () => freshToken, libraryCode);
    if (libraryCode !== getUid()) throw new Error('The active library changed. Reopen its original account to check deletion status.');
    if (result?.deleted !== true) throw new Error('The server did not confirm deletion. This phone has not been cleared.');
    setDeleteReceipt(result);
    setSheet('');
    setComplete(true);
  }

  async function beginFirstFactorVerification() {
    if (!session) throw new Error('Your sign-in session is unavailable. Sign in again and retry.');
    const verification = await session.startVerification({ level: 'first_factor' });
    const factors = verification.supportedFirstFactors || [];
    const email = factors.find((factor) => factor.strategy === 'email_code');
    const phone = factors.find((factor) => factor.strategy === 'phone_code');
    const password = factors.find((factor) => factor.strategy === 'password');
    const selected = email || phone || password || factors.find((factor) => factor.strategy === 'passkey');
    if (!selected) throw new Error('This sign-in has no supported first-factor verification method. Use the account’s sign-in method, then retry.');
    if (selected.strategy === 'passkey') {
      const completed = await session.verifyWithPasskey();
      if (completed.status !== 'complete') throw new Error('Passkey verification is not complete. Try again.');
      await completeVerifiedDeletion();
      return;
    }
    if (selected.strategy === 'password') {
      setReauthFactor('password');
      setReauthCode('');
      setReauthPassword('');
      return;
    }
    if (selected.strategy !== 'email_code' && selected.strategy !== 'phone_code') {
      throw new Error('This sign-in factor cannot be prepared for first-factor reverification.');
    }
    const parameters = {
      strategy: selected.strategy,
      ...(selected.emailAddressId ? { emailAddressId: selected.emailAddressId } : {}),
      ...(selected.phoneNumberId ? { phoneNumberId: selected.phoneNumberId } : {}),
    };
    await session.prepareFirstFactorVerification(parameters);
    setReauthFactor(selected.strategy);
    setReauthCode('');
    setReauthPassword('');
  }

  async function submitFirstFactorVerification() {
    if (!session) throw new Error('Your sign-in session is unavailable. Sign in again and retry.');
    const attempt = reauthFactor === 'password'
      ? await session.attemptFirstFactorVerification({ strategy: 'password', password: reauthPassword })
      : await session.attemptFirstFactorVerification({ strategy: reauthFactor, code: reauthCode.trim() });
    if (attempt.status !== 'complete') throw new Error('Verification did not complete. Check your entry and try again.');
    setReauthFactor('');
    await completeVerifiedDeletion();
  }

  async function deleteData() {
    if (typed !== 'DELETE') { setError('Type DELETE exactly to confirm permanent deletion.'); return; }
    if (status?.activeSubscription && !activeBillingConsent) {
      setError('An active subscription must be managed or cancelled, or you must separately confirm that you still want deletion.');
      return;
    }
    setBusy(true); setError('');
    try {
      if (isSignedIn) await beginFirstFactorVerification();
      else {
        const result = await requestPrivacyDeletion({ confirmation: 'DELETE', confirmActiveSubscription: false }, async () => null, libraryCode);
        if (libraryCode !== getUid()) return;
        if (result?.deleted !== true) throw new Error('The server did not confirm deletion. This phone has not been cleared.');
        setDeleteReceipt(result);
        setSheet('');
        setComplete(true);
      }
    } catch (cause) {
      if (libraryCode === getUid()) setError(cause.message || 'The deletion request could not be completed.');
    } finally {
      if (libraryCode === getUid()) setBusy(false);
    }
  }

  async function finishDeletion() {
    if (libraryCode !== getUid()) return;
    setBusy(true);
    try {
      const keys = await AsyncStorage.getAllKeys();
      const scopedKeys = keys.filter((key) => key.endsWith(`_${libraryCode}`));
      await AsyncStorage.multiRemove([...scopedKeys, 'cs_cache', 'cs_profile', 'cs_profile_pending']);
      await CachedImage.clearDiskCache();
      await st.clearDeletedLibrary(libraryCode);
      if (libraryCode !== getUid()) {
        try { await signOut(); } finally { router.replace('/welcome'); }
      }
    } catch (cause) {
      setError(cause.message || 'The server deleted the library, but some local data could not be cleared. Retry clearing this phone.');
    } finally { setBusy(false); }
  }

  async function switchToLegacyDeletion() {
    setBusy(true); setError('');
    try {
      await signOut();
      router.replace('/privacy-settings');
    } catch (cause) {
      setError(cause.message || 'Could not sign out before opening legacy-library deletion.');
    } finally { setBusy(false); }
  }

  return (
    <Screen style={{ paddingTop: 12 }}>
      <Section title="AI-sharing permission">
        <Text style={{ color: C.sec, lineHeight: 21 }}>{aiPermission ? aiPermission.accepted ? 'Allowed for this library. You can stop future AI and transcription requests below.' : 'Not allowed. Manual notes, courses and your existing library remain available.' : 'Checking AI permission…'}</Text>
        <Btn title={aiPermission?.accepted ? 'Withdraw AI permission' : 'Review AI sharing'} kind="secondary" disabled={busy} onPress={async () => {
          setBusy(true); setAiError('');
          try {
            if (aiPermission?.accepted) await aiConsentRequest('POST', { version: aiPermission.version, accepted: false }, libraryCode);
            else await ensureAiConsent();
            const result = await aiConsentRequest('GET', undefined, libraryCode);
            if (libraryCode === getUid()) setAiPermission(result);
          } catch (cause) { if (libraryCode === getUid()) setAiError(cause.message); }
          finally { if (libraryCode === getUid()) setBusy(false); }
        }} />
        {aiError ? <Text accessibilityRole="alert" style={{ color: C.warn }}>{aiError}</Text> : null}
      </Section>
      <Section title="Your privacy data" footer={status ? `Age range: ${status.ageBand || 'not set'} · provider: ${status.provider || 'none'}` : undefined}>
        {!isSignedIn ? <Text style={{ color: C.sec, lineHeight: 21 }}>Sign in to the account linked to this library to manage private data.</Text> : null}
        {!isSignedIn ? <Text style={{ color: C.sec, lineHeight: 21 }}>An unlinked legacy library can still be deleted using this device’s private sync code and typed confirmation. If a subscription is active, sign in to manage it first.</Text> : null}
        {loading ? <Text style={{ color: C.sec }}>Loading privacy status…</Text> : null}
        {status ? <>
          <Text style={{ color: C.ink, lineHeight: 21 }}>Your private library is identified only for its owner. Export creates a private ZIP, with one export allowed every 24 hours.</Text>
          {status.exportNextAllowedAt ? <Text style={{ color: C.sec }}>Next export available {new Date(status.exportNextAllowedAt).toLocaleString()}</Text> : null}
          {status.reauthenticationRequired ? <Text style={{ color: C.warn }}>A recent first-factor verification is required to delete data.</Text> : null}
          <Btn title="Export my library (private ZIP)" onPress={() => { setError(''); setSheet('export'); }} />
          <Btn title="Delete my library data" kind="rec" onPress={() => { setError(''); setTyped(''); setReauthFactor(''); setReauthCode(''); setReauthPassword(''); setActiveBillingConsent(false); setSheet('delete'); }} />
        </> : null}
        {isSignedIn && !status && !loading && error ? <>
          <Text style={{ color: C.sec, lineHeight: 21 }}>If this device has an unlinked legacy library, sign out to open its private sync-code deletion option. This will not delete data by itself.</Text>
          <Btn title="Sign out and open legacy deletion" kind="secondary" busy={busy} onPress={switchToLegacyDeletion} />
        </> : null}
        {!isSignedIn ? <Btn title="Delete unlinked legacy library" kind="rec" onPress={() => { setError(''); setTyped(''); setReauthFactor(''); setActiveBillingConsent(false); setSheet('delete'); }} /> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: C.warn }}>{error}</Text> : null}
        {exportMessage ? <Text style={{ color: C.sec }}>{exportMessage}</Text> : null}
      </Section>

      <PrivacySheet visible={sheet === 'export'} title="Export your library" onClose={() => !busy && setSheet('')} busy={busy}
        actions={[{ title: 'Create private ZIP', busy: true, onPress: finishExport }, { title: 'Cancel', kind: 'plain', onPress: () => setSheet('') }]}>
        <Text style={{ color: C.sec, lineHeight: 21 }}>The export is private to this library and its private download link expires after 24 hours. The ZIP is shared using your device’s system save/share sheet.</Text>
      </PrivacySheet>

      <PrivacySheet visible={sheet === 'delete'} title="Permanently delete library data" onClose={() => !busy && setSheet('')} busy={busy}
        actions={[{ title: reauthFactor ? 'Verification required below' : 'Delete app data', kind: 'rec', busy: true, disabled: !!reauthFactor, onPress: deleteData }, { title: 'Cancel', kind: 'plain', onPress: () => setSheet('') }]}>
        <Text style={{ color: C.sec, lineHeight: 21 }}>App data deletion begins immediately. External provider cleanup may remain pending and resumable. This does not claim platform backups are immediately erased.</Text>
        {status?.activeSubscription ? <View style={{ gap: 10 }}>
          <Text style={{ color: C.warn, lineHeight: 20 }}>An active paid subscription is present. Manage or cancel billing first. If you still request data deletion despite the active subscription, separately confirm below.</Text>
          <Text accessibilityRole="link" onPress={() => status.manageUrl ? Linking.openURL(status.manageUrl) : router.push('/plans')} style={{ color: C.accent, fontWeight: '700' }}>Manage or cancel subscription</Text>
          <Pressable onPress={() => setActiveBillingConsent((value) => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: activeBillingConsent }} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Text style={{ color: C.accent, fontSize: 21 }}>{activeBillingConsent ? '☑' : '□'}</Text>
            <Text style={{ flex: 1, color: C.ink, lineHeight: 20 }}>I explicitly request data deletion despite the active paid subscription.</Text>
          </Pressable>
        </View> : null}
        {reauthFactor ? <View style={{ gap: 10 }}>
          <Text style={{ color: C.ink, fontWeight: '700' }}>Verify your identity with your sign-in method</Text>
          <TextInput
            value={reauthFactor === 'password' ? reauthPassword : reauthCode}
            onChangeText={reauthFactor === 'password' ? setReauthPassword : setReauthCode}
            placeholder={reauthFactor === 'password' ? 'Account password' : 'Verification code'}
            placeholderTextColor={C.faint}
            secureTextEntry={reauthFactor === 'password'}
            keyboardType={reauthFactor === 'password' ? 'default' : 'number-pad'}
            style={[s.input, { backgroundColor: C.bg }]}
          />
          <Btn title="Verify and delete" kind="rec" busy={busy} onPress={async () => {
            setBusy(true); setError('');
            try { await submitFirstFactorVerification(); } catch (cause) { if (libraryCode === getUid()) setError(cause.message || 'Verification could not be completed.'); }
            finally { if (libraryCode === getUid()) setBusy(false); }
          }} />
        </View> : null}
        {!reauthFactor ? <TextInput value={typed} onChangeText={setTyped} placeholder="Type DELETE" placeholderTextColor={C.faint} autoCapitalize="characters" style={[s.input, { backgroundColor: C.bg }]} /> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: C.warn }}>{error}</Text> : null}
      </PrivacySheet>

      <PrivacySheet visible={complete} title="Deletion confirmed" onClose={() => {}} busy={busy}
        actions={[{ title: 'Clear phone data and sign out', busy: true, onPress: finishDeletion }]}>
        <Text style={{ color: C.sec, lineHeight: 21 }}>The server confirmed deletion. This clears this library’s cached profile, documents, recordings, photos, recovery state and pending queues on this phone, then signs out.</Text>
        <Text style={{ color: C.sec, lineHeight: 21 }}>{deleteReceipt?.providersPending ? 'External provider cleanup is still pending and will be retried.' : 'No external provider cleanup is currently pending.'}</Text>
        <Text style={{ color: C.sec, lineHeight: 21 }}>Backup retention: {Number.isFinite(deleteReceipt?.backupDays) ? `${deleteReceipt.backupDays} days` : 'not provided'}. Platform-managed backups are not claimed as immediately erased.</Text>
      </PrivacySheet>
    </Screen>
  );
}