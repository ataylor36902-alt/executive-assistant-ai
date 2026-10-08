import React, { useCallback, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { C } from '../lib/theme';
import { Btn } from './ui';

export function CreditsConfirmSheet({ request, visible, busy, onConfirm, onCancel }) {
  const [buyingCredits, setBuyingCredits] = useState(false);
  useFocusEffect(useCallback(() => {
    setBuyingCredits(false);
  }, []));
  if (!request) return null;
  const cost = Number(request.cost);
  const balance = Number(request.balance);
  const enough = Number.isFinite(cost) && Number.isFinite(balance) && balance >= cost;
  return (
    <Modal visible={!!visible && !buyingCredits} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.44)' }}>
        <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34, gap: 12 }}>
          <Text style={{ color: C.ink, fontSize: 21, fontWeight: '800' }}>Use {Number.isFinite(cost) ? cost : '—'} credits?</Text>
          <Text style={{ color: C.sec, fontSize: 15, lineHeight: 22 }}>
            {Number.isFinite(balance) ? `You have ${balance} credits.` : 'Your current Credits balance is unavailable.'}
            {request.action ? ` This will continue ${String(request.action).replace(/[_-]+/g, ' ')}.` : ''}
          </Text>
          {!enough ? (
            <View style={{ backgroundColor: C.warnSoft, borderRadius: 12, padding: 12, gap: 4 }}>
              <Text style={{ color: C.warn, fontSize: 14, fontWeight: '800' }}>Your balance is too low</Text>
              <Text style={{ color: C.sec, fontSize: 13, lineHeight: 19 }}>Add Credits to continue. This action will not spend anything unless you confirm with enough Credits.</Text>
            </View>
          ) : null}
          <Pressable onPress={() => { setBuyingCredits(true); router.push('/credits'); }} accessibilityRole="link" accessibilityLabel="Buy more Credits" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <Text style={{ color: C.accent, fontSize: 14, fontWeight: '700' }}>Buy more credits →</Text>
          </Pressable>
          <Btn title="Confirm and continue" onPress={onConfirm} busy={busy} disabled={busy || !enough || !request.requestId} />
          <Btn title="Not now" kind="plain" onPress={onCancel} disabled={busy} />
        </View>
      </View>
    </Modal>
  );
}