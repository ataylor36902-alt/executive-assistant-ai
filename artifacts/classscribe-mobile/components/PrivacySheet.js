import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from './KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn } from './ui';
import { C } from '../lib/theme';

export function PrivacySheet({ visible, title, children, actions = [], onClose, busy = false }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' }}>
        <Pressable accessibilityLabel="Close sheet" onPress={onClose} style={{ flex: 1 }} />
        <View style={{ maxHeight: '88%', backgroundColor: C.cell, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: Math.max(insets.bottom, 16) }}>
          <KeyboardAwareScrollViewCompat bottomOffset={60} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, gap: 16 }}>
            <Text style={{ color: C.ink, fontSize: 21, fontWeight: '800' }}>{title}</Text>
            {children}
            {actions.map((action) => (
              <Btn
                key={action.title}
                title={action.title}
                kind={action.kind || 'primary'}
                disabled={busy || action.disabled}
                busy={busy && action.busy}
                onPress={action.onPress}
              />
            ))}
          </KeyboardAwareScrollViewCompat>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}