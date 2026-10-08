import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { C } from '../lib/theme';
import { useStore } from '../lib/store';
import { getLinkedLibrary } from '../lib/library-link';
import { clerkPublishableKey } from '../lib/clerk-config';
import { OptionalSignIn } from '../components/OptionalSignIn';
import { useLibraryLinkSession } from '../lib/use-library-link-session';

function RecoverLinkedLibrary() {
  const auth = useAuth();
  const { isSignedIn, getToken, userId, sessionId } = auth;
  const captureSession = useLibraryLinkSession(auth);
  const { switchLibrary, profile } = useStore();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const running = useRef(false);

  useEffect(() => {
    if (!pending || !isSignedIn || running.current) return;
    running.current = true;
    const assertSession = captureSession();
    (async () => {
      if (profile) throw new Error('This device already has a library. Use Account to manage it.');
      const linked = await getLinkedLibrary(getToken);
      assertSession();
      if (!linked.linked) throw new Error('No library is linked to this sign-in yet. Use your private sync code instead, or link sign-in from Account on a device that has your library.');
      const ok = await switchLibrary(linked.code, { assertCurrent: assertSession });
      assertSession();
      if (!ok) throw new Error('Your linked library could not load. Check the server connection and try again.');
      router.replace('/home');
    })().catch((error) => setNotice(error.message || 'Could not open your linked library.'))
      .finally(() => { running.current = false; setPending(false); });
  }, [pending, isSignedIn, userId, sessionId, getToken, switchLibrary, profile]);

  return <OptionalSignIn required recoverOnly
    onContinue={() => { setNotice(''); setPending(true); }}
    continueLabel={pending ? 'Opening your library…' : 'Open my linked library'}
    notice={notice}
  />;
}

export default function RecoverLibrary() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['bottom']}>
      {clerkPublishableKey ? <RecoverLinkedLibrary /> : <OptionalSignIn required recoverOnly onContinue={() => {}} />}
    </SafeAreaView>
  );
}