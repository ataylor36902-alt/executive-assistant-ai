const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/schedule-import.js'), 'utf8');
const handler = source.slice(source.indexOf('  async function run() {'), source.indexOf('\n\n  return (')).trim();
const helpers = fs.readFileSync(path.join(__dirname, '../lib/schedule.js'), 'utf8').replace(/^export /gm, '');
const codeKey = fs.readFileSync(path.join(__dirname, '../lib/util.js'), 'utf8').match(/^export const codeKey = (.*);$/m)[1];
const meetings = [{ days: ['Mon', 'Wed', 'Fri'], start: '09:00', end: '09:50', location: 'Science Hall 101' }];

function harness(overrides = {}) {
  const state = { library: 'original', busy: false, error: '', result: '', progress: '', writes: [], aiCalls: [], courses: [] };
  const context = {
    text: 'BIO 101 Intro to Biology MWF 9:00–9:50 AM Science Hall 101\nCHEM 110 TTh 11:00–12:15 Chemistry 204',
    photo: null,
    running: { current: false }, requestRef: { current: null },
    AbortController, Keyboard: { dismiss() {} },
    getUid: () => state.library,
    setError: value => { state.error = value; },
    setResult: value => { state.result = value; },
    setBusy: value => { state.busy = value; },
    setProgress: value => { state.progress = value; },
    studyAI: async (...args) => {
      state.aiCalls.push(args);
      return { courses: [{ code: 'BIO 101', name: 'Intro to Biology', meetings }, { code: 'CHEM 110', name: 'Chemistry', meetings }] };
    },
    st: {
      profile: { term: 'Fall 2026' },
      courses: () => state.courses,
      putCourse: async course => { state.writes.push(course); },
      put: () => { throw new Error('Unacknowledged optimistic writes must not be used'); },
    },
    curSemester: () => 'Fall 2026', nowMs: () => 1, uid: () => `course_${state.writes.length}`,
    codeKey: vm.runInNewContext(`(${codeKey})`),
    plural: (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`,
    errMsg: error => error.message,
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(`${helpers}\nglobalThis.cleanMeetings = cleanMeetings;`, context);
  return { context, state, run: vm.runInContext(`(${handler})`, context) };
}

test('an empty schedule shows inline guidance, not a hidden alert or an AI request', async () => {
  const h = harness({ text: '' });
  await h.run();
  assert.match(h.state.error, /Paste your schedule text/);
  assert.equal(h.state.aiCalls.length, 0);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.busy, false);
});

test('pasted schedule submits the entered text and saves both extracted courses', async () => {
  const h = harness();
  await h.run();
  assert.equal(h.state.aiCalls[0][0], 'schedule');
  assert.equal(h.state.aiCalls[0][1].material, h.context.text);
  assert.ok(h.state.aiCalls[0][2] instanceof AbortSignal);
  assert.deepEqual(h.state.writes.map(course => course.code), ['BIO 101', 'CHEM 110']);
  assert.equal(h.state.writes[0].meetings[0].start, '09:00');
  assert.match(h.state.result, /0 courses updated, 2 new/);
  assert.equal(h.state.busy, false);
  assert.equal(h.state.progress, '');
});

test('existing courses wait for save acknowledgement before reporting success', async () => {
  const h = harness();
  h.state.courses = [{ id: 'existing', code: 'BIO 101', semester: 'Fall 2026', meetings: [] }];
  h.context.studyAI = async () => ({ courses: [{ code: 'BIO 101', meetings }] });
  let confirm;
  h.context.st.putCourse = async course => {
    h.state.writes.push(course);
    await new Promise(resolve => { confirm = resolve; });
  };
  const pending = h.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.result, '');
  assert.equal(h.state.busy, true);
  assert.equal(h.state.writes[0].id, 'existing');
  confirm();
  await pending;
  assert.match(h.state.result, /1 course updated, 0 new/);
});

test('course save failures remain visible and do not claim successful import', async () => {
  const h = harness();
  h.context.st.putCourse = async () => { throw { code: 'plan_limit', message: 'Your plan has reached its course limit.' }; };
  await h.run();
  assert.match(h.state.error, /course limit/);
  assert.equal(h.state.result, '');
  assert.equal(h.state.busy, false);
  assert.ok(h.context.text.includes('BIO 101'));
});

test('repeated taps cannot submit a second import while the first is running', async () => {
  const h = harness();
  let resolveAI;
  h.context.studyAI = async (...args) => {
    h.state.aiCalls.push(args);
    return new Promise(resolve => { resolveAI = resolve; });
  };
  const first = h.run();
  await h.run();
  assert.equal(h.state.aiCalls.length, 1);
  resolveAI({ courses: [{ code: 'BIO 101', meetings }] });
  await first;
  assert.equal(h.state.writes.length, 1);
});

test('library switches and leaving the screen prevent late extraction from saving courses', async () => {
  for (const abort of [false, true]) {
    const h = harness();
    let resolveAI;
    h.context.studyAI = async () => new Promise(resolve => { resolveAI = resolve; });
    const pending = h.run();
    if (abort) h.context.requestRef.current.abort();
    else h.state.library = 'different';
    resolveAI({ courses: [{ code: 'BIO 101', meetings }] });
    await pending;
    assert.equal(h.state.writes.length, 0);
    assert.equal(h.state.result, '');
    if (!abort) assert.match(h.state.error, /library changed/);
  }
});

test('a selected screenshot sends image data to the schedule operation', async () => {
  const h = harness({ text: '', photo: { base64: 'test-image-data', mimeType: 'image/png' } });
  await h.run();
  assert.equal(h.state.aiCalls[0][1].image.mediaType, 'image/png');
  assert.equal(h.state.aiCalls[0][1].image.data, 'test-image-data');
  assert.match(h.state.result, /2 new/);
});

test('schedule import has explicit Back navigation and no native modal hiding root notices', () => {
  const layout = fs.readFileSync(path.join(__dirname, '../app/_layout.js'), 'utf8');
  assert.match(source, /testID="schedule-import-back"/);
  assert.match(source, /router\.replace\('\/schedule'\)/);
  assert.match(source, /requestRef\.current\?\.abort\(\)/);
  assert.match(layout, /name="schedule-import" options=\{\{ presentation: 'card',[\s\S]*?BackButton destination="\/schedule"/);
  assert.match(source, /testID="schedule-import-error"/);
  assert.match(source, /testID="schedule-import-success"/);
});
