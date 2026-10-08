// Cross-platform action menu: the native action sheet on iPhone, a bottom sheet on Android.
import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../lib/theme';
import { useStore } from '../lib/store';

let listener = null;

/**
 * showActions({ title, actions: [{ label, onPress, destructive }] })
 * A Cancel choice is always added.
 */
export function showActions({ title, actions }) {
  if (Platform.OS === 'ios') {
    const options = [...actions.map((a) => a.label), 'Cancel'];
    const destructiveButtonIndex = actions.findIndex((a) => a.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: destructiveButtonIndex >= 0 ? destructiveButtonIndex : undefined },
      (i) => { if (i < actions.length && actions[i].onPress) actions[i].onPress(); },
    );
    return;
  }
  if (listener) listener({ title, actions });
}

export function ActionSheetHost() {
  const { resolvedTheme } = useStore();
  const [sheet, setSheet] = useState(null);
  const insets = useSafeAreaInsets();
  useEffect(() => { listener = setSheet; return () => { listener = null; }; }, []);
  const close = () => setSheet(null);
  return (
    <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: resolvedTheme === 'dark' ? 'rgba(0,0,0,0.72)' : 'rgba(8,14,12,0.4)' }} onPress={close} accessibilityLabel="Close menu" />
      <View style={{ backgroundColor: C.cell, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: insets.bottom + 8, maxHeight: '70%' }}>
        {sheet && sheet.title ? <Text style={{ textAlign: 'center', color: C.sec, fontSize: 13, paddingTop: 14, paddingBottom: 6 }}>{sheet.title}</Text> : null}
        <ScrollView>
          {sheet ? sheet.actions.map((a, i) => (
            <Pressable key={i} onPress={() => { close(); setTimeout(() => a.onPress && a.onPress(), 50); }} android_ripple={{ color: C.fill }} style={{ paddingVertical: 16, paddingHorizontal: 24 }} accessibilityRole="button">
              <Text style={{ fontSize: 17, color: a.destructive ? C.rec : C.ink }}>{a.label}</Text>
            </Pressable>
          )) : null}
        </ScrollView>
        <Pressable onPress={close} style={{ paddingVertical: 16, paddingHorizontal: 24, borderTopWidth: 0.5, borderTopColor: C.sep }} accessibilityRole="button">
          <Text style={{ fontSize: 17, color: C.accent, fontWeight: '600' }}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
