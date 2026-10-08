import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Alert } from '../lib/notify';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { C } from '../lib/theme';
import { useResolvedTheme, useStore } from '../lib/store';
import { getLinkedLibrary, linkCurrentLibrary } from '../lib/library-link';
import { clerkPublishableKey } from '../lib/clerk-config';
import { OptionalSignIn } from '../components/OptionalSignIn';
import { goBack } from '../components/BackButton';
import { Btn } from '../components/ui';
import { getUid } from '../lib/api';
import { useLibraryLinkSession } from '../lib/use-library-link-session';

function LinkSignIn() {
  const { recordingRecovery: recoveryParam } = useLocalSearchParams();
  const recordingRecovery = recoveryParam === '1';
  const auth = useAuth();
  const { isSignedIn, getToken, userId, sessionId } = auth;
  const captureSession = useLibraryLinkSession(auth);
  const { status, switchLibrary } = useStore();
  const recordingLibraryRef = useRef(status.uid);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [linkedCode, setLinkedCode] = useState('');
  const [switching, setSwitching] = useState(false);
  const running = useRef(false);
  const linkedSession = useRef(null);

  useEffect(() => {
    if (!pending || !isSignedIn || running.current) return;
    running.current = true;
    const originalLibrary = status.uid;
    const assertSession = captureSession();
    (async () => {
      const linked = await getLinkedLibrary(getToken);
      assertSession();
      if (recordingRecovery) {
        if (getUid() !== recordingLibraryRef.current || originalLibrary !== recordingLibraryRef.current) {
          setNotice('Your library changed during sign-in. Reopen Record in the library you want to use. Recording has not started.');
          return;
        }
        if (!linked.linked || linked.code !== recordingLibraryRef.current) {
          setNotice(linked.linked
            ? 'This account is linked to a different library. Your current library and recording setup have not changed. Sign in with its linked account.'
            : 'This account is not linked to the selected library. Open Account to review library linking. No library was linked or changed.');
          return;
        }
        goBack('/record');
        return;
      }
      if (linked.linked && linked.code !== status.uid) {
        linkedSession.current = assertSession;
        setLinkedCode(linked.code);
        setNotice('This sign-in opens a different library. Your current library has not changed. Copy its sync code from Account before switching if you may need it again.');
        return;
      }
      if (!linked.linked) {
        await linkCurrentLibrary(async (options) => {
          assertSession();
          const token = await getToken(options);
          assertSession();
          return token;
        }, status.uid);
        assertSession();
      }
      linkedSession.current = null;
      setLinkedCode('');
      router.replace('/account');
    })().catch((error) => setNotice(error.message || 'Could not link your library.'))
      .finally(() => { running.current = false; setPending(false); });
  }, [pending, isSignedIn, userId, sessionId, getToken, status.uid, recordingRecovery]);

  async function openLinkedLibrary() {
    if (!linkedCode || switching) return;
    setSwitching(true);
    setNotice('');
    try {
      const assertSession = linkedSession.current;
      if (!assertSession) throw new Error('Sign in again to refresh your linked library.');
      assertSession();
      const latest = await getLinkedLibrary(getToken);
      assertSession();
      if (!latest.linked || latest.code !== linkedCode) throw new Error('The linked library changed. Sign in again to refresh it.');
      if (await AsyncStorage.getItem('cs_rotation')) throw new Error('Finish your pending sync-code replacement in Account before switching libraries. Your current library was not changed.');
      assertSession();
      const ok = await switchLibrary(latest.code, { assertCurrent: assertSession });
      assertSession();
      if (!ok) throw new Error('Could not open the linked library. Your current library was not changed.');
      router.replace('/home');
    } catch (error) {
      setNotice(error.message || 'Could not open the linked library.');
    } finally {
      setSwitching(false);
    }
  }

  function confirmSwitch() {
    const message = 'Opening the linked library replaces the library shown on this device. Copy your current sync code first if you may need it again; unsynced changes may not be available after switching.';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(message)) void openLinkedLibrary();
      return;
    }
    Alert.alert('Switch libraries?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open linked library', onPress: openLinkedLibrary },
    ]);
  }

  return (
    <View style={{ flex: 1 }}>
      {linkedCode ? <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 8 }}>
        <Text style={{ color: C.ink, fontWeight: '700' }}>A different library is linked to this sign-in</Text>
        <Btn title="Open linked library" onPress={confirmSwitch} busy={switching} />
      </View> : null}
      <OptionalSignIn
        onContinue={({ fromAuth } = {}) => {
          if (!fromAuth && !isSignedIn) { goBack('/account'); return; }
          setNotice('');
          setPending(true);
        }}
        continueLabel={recordingRecovery
          ? (pending ? 'Checking your library…' : 'Return to recording')
          : (pending ? 'Linking your library…' : 'Link sign-in to this library')}
        notice={notice}
      />
    </View>
  );
}

export default function AccountSignIn() {
  useResolvedTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['bottom']}>
      {clerkPublishableKey ? <LinkSignIn /> : <OptionalSignIn onContinue={() => goBack('/account')} />}
    </SafeAreaView>
  );
}