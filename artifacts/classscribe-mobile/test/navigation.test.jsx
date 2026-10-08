import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BackButton, { goBack } from '../components/BackButton';
import TabStack from '../components/TabStack';
import RootLayout from '../app/_layout';
import Record from '../app/record';
import HeaderTitle from '../components/HeaderTitle';
import { controls, stacks, router, Alert, BackHandler, Platform, viewport, safeInsets, headerTexts } from './fixtures/navigation-ui';

const render = component => {
  controls.length = 0;
  stacks.length = 0;
  renderToStaticMarkup(component);
  return controls;
};
const press = id => {
  const control = controls.find(x => x.testID === id || x.accessibilityLabel === id);
  assert.ok(control, `missing control: ${id}`);
  control.onPress();
};

test('all stack headers use the shared fitting title without replacing Back or actions', () => {
  render(<RootLayout />);
  assert.equal(typeof stacks[0].screenOptions.headerTitle, 'function');
  assert.equal(typeof stacks[0].screenOptions.headerLeft, 'function');
  render(<TabStack title="Ask ClassScribe" />);
  assert.equal(typeof stacks[0].screenOptions.headerTitle, 'function');
  assert.equal(typeof stacks[0].screenOptions.headerLeft, 'function');
});

test('recording recovery opens above the Account sheet with the shared Back control', () => {
  render(<RootLayout />);
  const root = stacks[0];
  const account = root.screens.find(screen => screen.name === 'account');
  const recovery = root.screens.find(screen => screen.name === 'recover-recordings');
  assert.equal(account.options.presentation, 'modal');
  assert.equal(recovery.options.presentation, 'fullScreenModal');
  assert.notEqual(recovery.options.headerShown, false);
  router.history = ['/home', '/account', '/recover-recordings'];
  render(root.screenOptions.headerLeft());
  press('navigation-back');
  assert.deepEqual(router.history, ['/home', '/account']);
});

test('compact titles reserve action space at narrow widths, large text, and landscape safe areas', () => {
  const titles = ['Scan or upload schedule', 'Recover recordings', 'Ask ClassScribe', 'Sign-in methods', 'Grades & GPA', 'BIOLOGY-ADVANCED-2026'];
  try {
    for (const width of [320, 375, 390, 430, 812]) {
      viewport.width = width;
      safeInsets.left = safeInsets.right = width === 812 ? 59 : 0;
      for (const title of titles) {
        headerTexts.length = 0;
        render(<HeaderTitle>{title}</HeaderTitle>);
        const text = headerTexts[0];
        assert.equal(text.children, title);
        assert.equal(text.style.width + safeInsets.left + safeInsets.right + 192, width);
        assert.equal(text.numberOfLines, 2);
        assert.equal(text.adjustsFontSizeToFit, true);
        assert.equal(text.style.maxHeight, 40);
        assert.equal(text.maxFontSizeMultiplier, 1.3);
      }
    }
    headerTexts.length = 0;
    render(<HeaderTitle>{''}</HeaderTitle>);
    assert.equal(headerTexts.length, 0, 'blank editor titles remain blank');
  } finally {
    viewport.width = 375;
    safeInsets.left = safeInsets.right = 0;
  }
});

test('custom Credits and Record headers protect safe areas and fit their titles', () => {
  const credits = readFileSync('app/credits.js', 'utf8');
  const record = readFileSync('app/record.js', 'utf8');
  assert.match(credits, /<SafeAreaView edges=\{\['top', 'left', 'right'\]\}/);
  assert.match(credits, /numberOfLines=\{1\} adjustsFontSizeToFit[\s\S]*>Credits<\/Text>/);
  assert.match(record, /Platform\.OS === 'web' \? Math\.max\(insets\.top, 67\)/);
  assert.match(record, /paddingLeft: insets\.left, paddingRight: insets\.right/);
  assert.match(record, /numberOfLines=\{1\} adjustsFontSizeToFit[\s\S]*>Record a lecture<\/Text>/);
});

test('Home tab roots display a tappable Back that goes Home', () => {
  const tabs = readFileSync('app/(tabs)/_layout.js', 'utf8');
  for (const [tab, title] of [['notes', 'Notes'], ['ask', 'Ask ClassScribe'], ['class', 'Classmates']]) {
    assert.ok(existsSync(`app/(tabs)/${tab}/index.js`));
    assert.match(tabs, new RegExp(`<Tabs\\.Screen name="${tab}"`));
    render(<TabStack title={title} />);
    const header = stacks[0].screenOptions.headerLeft;
    assert.equal(typeof header, 'function', `${title} must expose Back`);
    render(header());
    router.history = ['/home', `/${tab}`];
    press('navigation-back');
    assert.deepEqual(router.history, ['/home'], `${title} Back returns Home`);
  }
  render(<TabStack title="Home" />);
  assert.equal(stacks[0].screenOptions.headerLeft, undefined);
});

test('Home links reach Schedule and course; detail routes show shared Back and preserve history', () => {
  const home = readFileSync('app/(tabs)/home/index.js', 'utf8');
  assert.match(home, /router\.push\('\/schedule'\)/);
  assert.match(home, /router\.push\(`\/course\/\$\{c\.id\}`\)/);
  const course = readFileSync('app/course/[id].js', 'utf8');
  assert.match(course, /router\.push\(`\/lecture\/\$\{l\.id\}`\)/);
  const notes = readFileSync('app/(tabs)/notes/index.js', 'utf8');
  assert.match(notes, /router\.push\(`\/note\/\$\{n\.id\}`\)/);

  render(<RootLayout />);
  const root = stacks[0];
  for (const route of ['schedule', 'course/[id]', 'lecture/[id]', 'note/[id]']) {
    assert.ok(root.screens.some(x => x.name === route), `missing ${route} route`);
  }
  for (const path of ['/schedule', '/course/course-1', '/lecture/lecture-1', '/note/note-1']) {
    router.history = ['/home', path];
    render(root.screenOptions.headerLeft());
    press('navigation-back');
    assert.deepEqual(router.history, ['/home'], `${path} Back returns prior page`);
  }
  router.history = ['/home', '/course/course-1', '/lecture/lecture-1'];
  render(root.screenOptions.headerLeft());
  press('navigation-back');
  assert.deepEqual(router.history, ['/home', '/course/course-1']);
});

test('direct-opened detail falls back to Home without history', () => {
  router.history = ['/note/note-1'];
  render(<BackButton />);
  press('navigation-back');
  assert.deepEqual(router.history, ['/home']);
  router.history = ['/schedule'];
  goBack();
  assert.deepEqual(router.history, ['/home']);
});

test('record setup can cancel; live audio has no Back or swipe exit and requires confirmed Discard', async () => {
  render(<RootLayout />);
  const recordRoute = stacks[0].screens.find(x => x.name === 'record');
  assert.equal(recordRoute.options.gestureEnabled, false);
  globalThis.__recordStep = 'setup';
  router.history = ['/course/course-1', '/record'];
  render(<Record />);
  press('record-back');
  assert.deepEqual(router.history, ['/course/course-1']);
  router.history = ['/record'];
  render(<Record />);
  press('record-back');
  assert.deepEqual(router.history, ['/home']);

  globalThis.__recordStep = 'live';
  globalThis.__recorderStops = 0;
  router.history = ['/home', '/record'];
  render(<Record />);
  assert.ok(!controls.some(x => x.testID === 'record-back' || x.testID === 'navigation-back'));
  assert.ok(controls.some(x => x.accessibilityLabel === 'Stop and save'));
  press('record-discard');
  assert.deepEqual(router.history, ['/home', '/record']);
  assert.equal(globalThis.__recorderStops, 0);
  assert.equal(Alert.last.title, 'Discard this recording?');
  assert.ok(Alert.last.actions.some(x => x.text === 'Keep recording'));
  await Alert.last.actions.find(x => x.text === 'Discard').onPress();
  assert.equal(globalThis.__recorderStops, 1);
  assert.equal(router.history.at(-1), '/home');

  Platform.OS = 'android';
  router.history = ['/home', '/record'];
  render(<Record />);
  assert.equal(BackHandler.handler(), true);
  assert.deepEqual(router.history, ['/home', '/record']);
  assert.equal(Alert.last.title, 'Discard this recording?');
  Platform.OS = 'ios';
  globalThis.__recordStep = 'setup';
});