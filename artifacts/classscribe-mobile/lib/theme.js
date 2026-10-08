import { Platform } from 'react-native';
import appearanceTokens from './appearance-tokens.json';

let activeMode = 'light';

const colorFor = (key) => {
  const t = appearanceTokens[activeMode];
  const values = {
    accent: t.accent, accentText: t.accentText, accentSoft: t.accentSoft, accentDark: activeMode === 'dark' ? '#24745F' : '#12503F',
    rec: t.record, recSoft: t.recordSoft, hi: t.exam, hiSoft: t.examSoft, hiInk: t.examText, star: t.gold,
    bg: t.phoneBg, cell: t.card, ink: t.text, sec: t.secondaryText, sep: t.separator, fill: t.fill, faint: t.faint,
    blue: t.blue, orange: t.orange, purple: t.purple, good: t.good, warn: t.warn, warnSoft: t.warnSoft,
    hero: t.hero, heroText: t.heroText, logo: t.logo, raised: t.raised, line: t.separator,
    white: '#FFFFFF', black: '#000000',
  };
  return values[key];
};

export const setActiveTheme = (mode) => { activeMode = mode === 'dark' ? 'dark' : 'light'; };
export const getActiveTheme = () => activeMode;
export const C = new Proxy({}, { get: (_, key) => colorFor(key) });
export const COURSE_COLORS = new Proxy([], {
  get: (_, key) => {
    if (key === 'length') return 6;
    const i = Number(key);
    return [C.accent, C.blue, C.orange, C.purple, appearanceTokens[activeMode].teal, appearanceTokens[activeMode].gold][i];
  },
});
export const courseColor = (c) => COURSE_COLORS[((c && c.color) || 0) % 6];
export const mono = { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontVariant: ['tabular-nums'] };
