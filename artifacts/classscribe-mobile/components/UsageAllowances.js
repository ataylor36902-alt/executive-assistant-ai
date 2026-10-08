import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { usageAllowanceSummary } from '../lib/usage-allowances';
import { C } from '../lib/theme';
import { Btn } from './ui';

export function UsageAllowances({ status }) {
  const summary = usageAllowanceSummary(status);
  if (!summary) return null;
  return <View accessibilityLiveRegion="polite" testID="base-usage-allowances" style={{ padding: 12, gap: 8 }}>
    <Text style={{ color: C.ink, fontSize: 14, fontWeight: '700' }}>Remaining included usage</Text>
    <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>
      {summary.hours === null ? 'Hours unavailable' : `${summary.hours.toFixed(1)} transcription hours`}
      {' · '}{summary.recordings === null ? 'Recordings unavailable' : `${summary.recordings} saved recordings`}
    </Text>
    <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>Included usage resets monthly (UTC). Unspent Scribe Credits do not expire.</Text>
    {summary.exhausted.length ? <>
      <Text style={{ color: C.warn, fontSize: 13, lineHeight: 19 }}>Included {summary.exhausted.join(', ')} exhausted.
        {summary.paid ? ' Continue with a one-time credit confirmation. Other plan limits still apply.' : ' Your transcription-count limit still applies on Free.'}
      </Text>
      <Btn title="View balance and buy credits" kind="secondary" small onPress={() => router.push('/credits')} />
    </> : null}
  </View>;
}
