import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { C } from '../lib/theme';

export function ProfileAvatar({ source, initial, size = 44 }) {
  const [loadedUri, setLoadedUri] = useState('');
  const showingPhoto = !!source?.uri && loadedUri === source.uri;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: C.accent, fontWeight: '800', fontSize: size * 0.38, opacity: showingPhoto ? 0 : 1 }}>{(initial || '?').toUpperCase()}</Text>
      {source ? <Image
        key={source.uri}
        source={source}
        cachePolicy="none"
        contentFit="cover"
        transition={0}
        useAppleWebpCodec={false}
        onLoad={() => setLoadedUri(source.uri)}
        onError={() => setLoadedUri('')}
        style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, opacity: showingPhoto ? 1 : 0 }}
        accessibilityIgnoresInvertColors
      /> : null}
    </View>
  );
}