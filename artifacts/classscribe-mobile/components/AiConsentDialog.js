import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text } from 'react-native';
import { PrivacySheet } from './PrivacySheet';
import { installAiConsentPrompt } from '../lib/ai-consent';
import { getServer } from '../lib/api';
import { useStore } from '../lib/store';
import { C } from '../lib/theme';

export function AiConsentDialog() {
  const { status } = useStore();
  const [notice, setNotice] = useState(null);
  const resolve = useRef(null);
  function finish(accepted) {
    const done = resolve.current;
    resolve.current = null;
    setNotice(null);
    done?.(accepted);
  }
  useEffect(() => {
    const remove = installAiConsentPrompt((value) => new Promise((done) => {
      resolve.current?.(false);
      resolve.current = done;
      setNotice(value);
    }));
    return () => { remove(); resolve.current?.(false); resolve.current = null; setNotice(null); };
  }, [status.uid, status.server]);
  return <PrivacySheet visible={!!notice} title={notice?.title || 'AI-sharing permission'} onClose={() => finish(false)}
    actions={[{ title: 'Allow AI sharing', onPress: () => finish(true) }, { title: 'Not now', kind: 'plain', onPress: () => finish(false) }]}>
    <Text style={{ color: C.ink, lineHeight: 22 }}>{notice?.notice}</Text>
    <Text accessibilityRole="link" style={{ color: C.accent, marginTop: 14 }} onPress={() => Linking.openURL(`${getServer()}/privacy.html`).catch(() => {})}>Read the Privacy Notice</Text>
  </PrivacySheet>;
}
