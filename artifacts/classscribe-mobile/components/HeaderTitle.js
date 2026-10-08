import React from 'react';
import { Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../lib/theme';
import { useResolvedTheme } from '../lib/store';

// Reserve space on both sides for Back and the existing header actions.
// Two lines keep longer page names readable in the compact navigation bar.
export default function HeaderTitle({ children }) {
  useResolvedTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const titleWidth = Math.max(64, width - (insets.left || 0) - (insets.right || 0) - 192);
  if (!children) return null;
  return (
    <Text
      testID="navigation-header-title"
      accessibilityRole="header"
      numberOfLines={2}
      adjustsFontSizeToFit
      minimumFontScale={0.65}
      maxFontSizeMultiplier={1.3}
      style={{ width: titleWidth, maxHeight: 40, color: C.ink, fontSize: 17, lineHeight: 20, fontWeight: '600', textAlign: 'center' }}
    >
      {children}
    </Text>
  );
}

export const renderHeaderTitle = (props) => <HeaderTitle {...props} />;
