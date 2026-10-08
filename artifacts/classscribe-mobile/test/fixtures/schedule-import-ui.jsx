import React from 'react';

const Box = ({ children, ...props }) => <div {...(props.accessibilityLabel ? { 'aria-label': props.accessibilityLabel } : {})}>{children}</div>;

export const Image = Box;
export const Alert = { alert() {} };
export const Platform = { OS: 'ios' };
export const Pressable = ({ children, accessibilityLabel }) => <button aria-label={accessibilityLabel}>{children}</button>;
export const RefreshControl = () => null;
export const ScrollView = Box;
export const Text = ({ children }) => <span>{children}</span>;
export const View = Box;
export const useFocusEffect = () => {};
export const router = { push() {} };
export const Ionicons = () => null;
export const useSafeAreaInsets = () => ({ top: 0, bottom: 0 });
export const useStore = () => globalThis.__scheduleStore;
export const C = {
  accent: '#1769aa',
  accentText: '#fff',
  accentSoft: '#e8f1fa',
  bg: '#fff',
  cell: '#f7f9fc',
  exam: '#f1efff',
  examInk: '#45348a',
  fill: '#d8d0ff',
  hiSoft: '#f1efff',
  hiInk: '#45348a',
  ink: '#1c2636',
  line: '#d9e0e9',
  rec: '#be3434',
  sep: '#d9e0e9',
  sec: '#667085',
  soft: '#e8f1fa',
};
export const courseColor = () => '#1769aa';
export const classesOn = () => [];
export const fmtRange = (start, end) => `${start}–${end}`;
export const nextMeetingIn = () => Infinity;
export const nextMeetingLabel = course => course.meetings?.[0]
  ? `${course.meetings[0].days.join(', ')} ${course.meetings[0].start}`
  : '';
export const WEEK_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const daysUntil = () => 0;
export const fmtD = () => '';
export const fmtLong = () => 'Saturday, September 26';
export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
export const todayISO = () => '2026-09-26';
export const relDue = () => '';
export const curSemester = () => 'Fall 2026';
export const showActions = () => {};
export const Btn = ({ title, onPress }) => <button onClick={onPress}>{title}</button>;
export const Empty = ({ text }) => <p>{text}</p>;
export const Row = ({ title, sub, onPress }) => <button onClick={onPress}>{title} {sub}</button>;
export const Screen = Box;
export const Section = ({ title, children }) => <section><h2>{title}</h2>{children}</section>;
export const Stack = { Screen: () => null };