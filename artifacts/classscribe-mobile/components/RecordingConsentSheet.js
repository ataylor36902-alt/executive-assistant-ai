import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '@clerk/expo';
import { PrivacySheet } from './PrivacySheet';
import { C } from '../lib/theme';
import {
  getPrivacyConfig,
  getPrivacyConsentReceipt,
  getQueuedPrivacyConsent,
  queuePrivacyConsent,
  removeQueuedPrivacyConsent,
  savePrivacyConsent,
} from '../lib/privacy';

export function RecordingConsentSheet({ visible, lectureId, courseId, sessionId, libraryCode, onClose, onConfirmed }) {
  const { getToken } = useAuth();
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState('');
  const [accepted, setAccepted] = useState([false, false]);
  const [accommodation, setAccommodation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    setConfig(null);
    setConfigError('');
    setAccepted([false, false]);
    setAccommodation(false);
    setQueued(false);
    setError('');
    getQueuedPrivacyConsent(libraryCode, sessionId, lectureId, courseId).then((queuedRecord) => {
      if (!active) return;
      if (queuedRecord) {
        setConfig({ version: queuedRecord.version, statements: [...queuedRecord.statements], queuedTerms: true });
        setAccepted([true, true]);
        setAccommodation(!!queuedRecord.accommodation);
        setQueued(true);
        return null;
      }
      return getPrivacyConfig().then((result) => {
        if (!active) return;
        if (result?.offlineCached) {
          throw new Error('Current server recording-consent text could not be verified. Reconnect before confirming new consent.');
        }
        if (!result?.consent?.version || !Array.isArray(result.consent.statements) ||
            result.consent.statements.length !== 2 ||
            result.consent.statements.some((statement) => typeof statement !== 'string' || !statement)) {
          throw new Error('The server returned incomplete recording-consent text. No audio will be uploaded.');
        }
        setConfig(result.consent);
      });
    }).catch((loadError) => {
      if (!active) return;
      setConfigError(loadError?.message || 'The current recording-consent text could not be loaded.');
    });
    return () => { active = false; };
  }, [visible]);

  async function confirmConsent() {
    if (busy || !config || !accepted.every(Boolean) || !libraryCode || !lectureId || !courseId || !sessionId) return;
    const record = {
      sessionId,
      lectureId,
      courseId,
      version: config.version,
      statements: [...config.statements],
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version || 'unknown',
      accommodation,
    };
    setBusy(true);
    setError('');
    try {
      await queuePrivacyConsent(libraryCode, record);
      setQueued(true);
      const receipt = await savePrivacyConsent(record, getToken, libraryCode);
      if (receipt.sessionId !== sessionId || receipt.lectureId !== lectureId || receipt.courseId !== courseId) {
        throw new Error('The server confirmation does not match this recording. Audio was not uploaded.');
      }
      await removeQueuedPrivacyConsent(libraryCode, sessionId);
      onConfirmed?.(receipt);
      onClose?.();
    } catch (saveError) {
      setError(saveError?.message || 'Consent was saved on this phone, but the server could not confirm it. Audio was not uploaded.');
    } finally {
      setBusy(false);
    }
  }

  async function retryQueuedConsent() {
    if (busy || !queued || !libraryCode) return;
    setBusy(true);
    setError('');
    try {
      const queuedRecord = await getQueuedPrivacyConsent(libraryCode, sessionId, lectureId, courseId);
      if (!queuedRecord) throw new Error('The saved consent terms are no longer available for this recording.');
      await savePrivacyConsent(queuedRecord, getToken, libraryCode);
      const receipt = await getPrivacyConsentReceipt(libraryCode, lectureId, courseId);
      if (!receipt || receipt.sessionId !== sessionId) {
        throw new Error('The server has not confirmed this recording’s consent yet. Audio was not uploaded.');
      }
      await removeQueuedPrivacyConsent(libraryCode, sessionId);
      onConfirmed?.(receipt);
      onClose?.();
    } catch (saveError) {
      setError(saveError?.message || 'The consent record is still waiting for server confirmation. Audio was not uploaded.');
    } finally {
      setBusy(false);
    }
  }

  const statements = config?.statements || [];
  const actions = queued
    ? [{ title: 'Retry consent sync', kind: 'primary', busy: true, onPress: retryQueuedConsent }]
    : [{ title: 'Confirm and transcribe', kind: 'primary', busy: true, disabled: !config || !accepted.every(Boolean) || !!configError, onPress: confirmConsent }];

  return (
    <PrivacySheet
      visible={visible}
      title="Confirm permission for this recording"
      onClose={() => { if (!busy) onClose?.(); }}
      busy={busy}
      actions={[
        ...actions,
        { title: 'Cancel', kind: 'secondary', onPress: () => { if (!busy) onClose?.(); } },
      ]}
    >
      <Text style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>
        This is a new confirmation for transcription now. It does not claim that consent was given when the recording was made. The audio stays on this phone unless the server confirms this consent and transcription proceeds.
      </Text>
      {statements.map((statement, index) => (
        <Pressable key={`${config?.version || 'consent'}-${index}`} onPress={() => setAccepted((current) => current.map((value, item) => item === index ? !value : value))}
          accessibilityRole="checkbox" accessibilityLabel={statement} accessibilityState={{ checked: !!accepted[index] }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
          <View style={{ width: 24, height: 24, borderWidth: 1, borderColor: accepted[index] ? C.accent : C.line, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: accepted[index] ? C.accent : 'transparent' }}>
            {accepted[index] ? <Text style={{ color: C.bg, fontWeight: '800' }}>✓</Text> : null}
          </View>
          <Text style={{ flex: 1, color: C.ink, fontSize: 15, lineHeight: 21 }}>{statement}</Text>
        </Pressable>
      ))}
      {config ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.bg, borderRadius: 12, padding: 12 }}>
          <Text style={{ flex: 1, color: C.ink, fontSize: 14, lineHeight: 20 }}>I have an accommodation related to recording</Text>
          <Switch value={accommodation} onValueChange={setAccommodation} trackColor={{ true: C.accent }} accessibilityLabel="Accommodation related to recording" />
        </View>
      ) : null}
      {configError ? <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 14, lineHeight: 20 }}>{configError}</Text> : null}
      {config?.queuedTerms ? <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>Using the exact consent terms already confirmed on this phone. Retry sync to get the server receipt before uploading.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: C.warn, fontSize: 14, lineHeight: 20 }}>{error}</Text> : null}
      {queued && !error ? <Text style={{ color: C.sec, fontSize: 14, lineHeight: 20 }}>Your checked consent terms are saved on this phone. The server must confirm them before audio can be uploaded.</Text> : null}
    </PrivacySheet>
  );
}