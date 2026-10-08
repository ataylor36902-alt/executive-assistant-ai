import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useFonts, DancingScript_600SemiBold } from '@expo-google-fonts/dancing-script';
import appearanceTokens from '../lib/appearance-tokens.json';

const GREEN = appearanceTokens.light.logo;
const WHITE = appearanceTokens.light.accentText;
export function LaunchIntro({ onFinish }) {
  const { width: screenWidth } = useWindowDimensions();
  const [fontsLoaded] = useFonts({ DancingScript_600SemiBold });
  const fontSize = Math.max(42, Math.min(72, Math.floor((screenWidth - 74) * 72 / 320)));
  const wordWidth = Math.ceil(fontSize * 4.4);
  const reveal = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const finish = useRef(onFinish);
  finish.current = onFinish;

  useEffect(() => {
    let active = true;
    let started = false;
    let fading = false;
    let animation;
    let delay;
    let fadeAnimation;
    const close = () => {
      if (active) finish.current();
    };
    const fade = () => {
      if (!active || fading) return;
      fading = true;
      fadeAnimation = Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true });
      fadeAnimation.start(({ finished }) => { if (finished) close(); });
    };
    const start = (reduced) => {
      if (!active || started) return;
      started = true;
      if (reduced) {
        reveal.setValue(1);
        delay = setTimeout(fade, 550);
        return;
      }
      animation = Animated.sequence([
        Animated.delay(180),
        Animated.timing(reveal, { toValue: 1, duration: 1850, useNativeDriver: false }),
        Animated.delay(350),
      ]);
      animation.start(({ finished }) => { if (finished && active) fade(); });
    };
    // Font and accessibility checks can be slow in a refreshed web simulator.
    // Start with the fallback font rather than leaving the opening frame frozen.
    const fallback = setTimeout(() => start(false), 300);
    const fadeFallback = setTimeout(fade, 3700);
    const closeFallback = setTimeout(close, 4500);
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        clearTimeout(fallback);
        start(reduced);
      });
    return () => {
      active = false;
      clearTimeout(fallback);
      clearTimeout(fadeFallback);
      clearTimeout(closeFallback);
      clearTimeout(delay);
      animation?.stop();
      fadeAnimation?.stop();
    };
  }, [opacity, reveal]);

  const width = reveal.interpolate({ inputRange: [0, 1], outputRange: [0, wordWidth] });
  const penX = reveal.interpolate({ inputRange: [0, 1], outputRange: [0, wordWidth - 5] });
  const penY = reveal.interpolate({
    inputRange: [0, 0.16, 0.31, 0.47, 0.62, 0.77, 1],
    outputRange: [6, -12, 2, -8, 5, -10, 1],
  });
  const companyOpacity = reveal.interpolate({
    inputRange: [0, 0.75, 1],
    outputRange: [0, 0, 1],
  });

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip opening animation"
        onPress={onFinish}
        style={styles.center}
      >
        <View style={[styles.wordBox, { width: wordWidth + 50 }]}>
          <Animated.View style={[styles.writing, { width }]}>
            <Text
              numberOfLines={1}
              allowFontScaling={false}
              style={[styles.word, { fontSize, width: wordWidth + 3, fontFamily: fontsLoaded ? 'DancingScript_600SemiBold' : 'cursive' }]}
            >
              ClassScribe
            </Text>
          </Animated.View>
          <Animated.View style={[styles.pen, { transform: [{ translateX: penX }, { translateY: penY }] }]}>
            <Svg width={54} height={72} viewBox="0 0 54 72">
              <Path d="M43 4c2-2 5-2 7 0l1 1c2 2 2 5 0 7L27 41 16 54 8 60l3-10 10-15L43 4Z" fill={WHITE} />
              <Path d="m16 54-5-4-3 10 8-6ZM38 11l7 7M20 36l8 7" stroke={GREEN} strokeWidth={2.5} strokeLinecap="round" />
              <Path d="M7 62 3 68" stroke={WHITE} strokeWidth={1.8} strokeLinecap="round" />
            </Svg>
          </Animated.View>
        </View>
        <Animated.Text style={[styles.company, { opacity: companyOpacity }]}>
          Edmita Investment LLC
        </Animated.Text>
        <Text style={styles.hint}>Tap anywhere to continue</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    backgroundColor: GREEN,
    overflow: 'hidden',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordBox: {
    height: 122,
    justifyContent: 'center',
  },
  writing: {
    overflow: 'hidden',
    height: 122,
    justifyContent: 'center',
  },
  word: {
    color: WHITE,
    lineHeight: 100,
    paddingLeft: 2,
    includeFontPadding: false,
  },
  pen: {
    position: 'absolute',
    top: 12,
    left: -5,
  },
  company: {
    marginTop: 8,
    color: appearanceTokens.dark.gold,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  hint: {
    position: 'absolute',
    bottom: 52,
    color: WHITE,
    fontSize: 12,
    letterSpacing: 0.4,
    opacity: 0.75,
  },
});