import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../lib/theme';
import { setNoticePresenter } from '../lib/notify';

export function InAppNoticeHost() {
  const [notice, setNotice] = useState(null);
  const insets = useSafeAreaInsets();
  useEffect(() => setNoticePresenter(setNotice), []);
  const close = () => setNotice(null);
  return (
    <Modal transparent visible={!!notice} animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={{ borderRadius: 18, padding: 20, paddingBottom: Math.max(20, insets.bottom / 2), backgroundColor: C.cell, gap: 12 }}>
          <Text style={{ color: C.ink, fontSize: 19, fontWeight: '800' }}>{notice?.title}</Text>
          {notice?.message ? <Text style={{ color: C.sec, fontSize: 15, lineHeight: 22 }}>{notice.message}</Text> : null}
          <View style={{ gap: 8, marginTop: 4 }}>
            {notice?.buttons.map((button, index) => (
              <Pressable
                key={`${button.text}-${index}`}
                onPress={() => {
                  close();
                  if (button.onPress) setTimeout(() => button.onPress(), 50);
                }}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  minHeight: 46,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 12,
                  backgroundColor: button.style === 'destructive' ? C.recSoft : index === notice.buttons.length - 1 ? 'transparent' : C.accentSoft,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Text style={{ color: button.style === 'destructive' ? C.rec : C.accent, fontSize: 16, fontWeight: '700' }}>{button.text || 'OK'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}