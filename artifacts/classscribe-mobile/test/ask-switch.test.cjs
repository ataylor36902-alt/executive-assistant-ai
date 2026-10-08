const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const screen = readFileSync(join(__dirname, '../app/(tabs)/ask/index.js'), 'utf8');
const api = readFileSync(join(__dirname, '../lib/api.js'), 'utf8');
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const groupA = 'g_' + 'a'.repeat(32);
const groupB = 'g_' + 'b'.repeat(32);
const toolSource = screen.slice(screen.indexOf('  const tools = ['), screen.indexOf('  function speakAnswer('));
const sendSource = screen.slice(screen.indexOf('  async function send('), screen.indexOf('  const voiceLabel ='));
const aiSource = (api.slice(api.indexOf('async function runAI('), api.indexOf('export const searchPrivateEvidence')) +
  api.slice(api.indexOf('export const askAI'), api.indexOf('export const aiText'))).replaceAll('export const ', 'const ');

function harness() {
  const state = { uid: 'u_old', turns: [], busy: '', visible: '' };
  const course = { id: 'c', code: 'BIO', name: 'Biology', groupCode: groupA };
  const other = { id: 'other', code: 'CHEM', name: 'Chemistry', groupCode: groupB };
  const lectures = [{ id: 'old', courseId: 'c', title: 'Old', segs: [{ x: 'secret transcript', t: 12 }] }];
  const notes = [{ id: 'note', courseId: 'c', title: 'Private', body: 'secret note' }];
  const requests = [];
  const held = deferred();
  const deps = {
    scopedCourses: [course], scopedCourseIds: new Set(['c']), scopedLectures: lectures, scopedNotes: notes,
    scopedAssignments: [], courses: [course, other], cid: 'c', c0: course, selectedScope: 'c',
    st: { status: { uid: 'u_old' }, course: id => [course, other].find(c => c.id === id), statsOf: () => ({}) },
    getUid: () => state.uid, renderedLibraryUidRef: { current: 'u_old' },
    scopeRevision: { current: 0 }, scopeSnapshotRef: { current: 'old-scope' },
    askAbortRef: { current: null }, busyRef: { current: false }, turnsRef: { current: [] },
    cancelCurrentAsk: () => { deps.scopeRevision.current++; deps.askAbortRef.current?.abort(); deps.busyRef.current = false; },
    voiceRef: { current: 'idle' }, sessionRef: { current: false }, voiceContextRef: { current: null },
    input: '', billing: { status: { plan: 'student', status: 'active' } }, gradeAccess: true,
    setInput: () => {}, setBusy: value => { state.busy = value; },
    retrievalMode: 'keyword', setSearchCoverage: value => { state.coverage = value; },
    searchPrivateEvidence: async () => ({ hits: [], coverage: { partial: false }, notice: '' }),
    showTurns: value => { state.turns = value; deps.turnsRef.current = value; state.visible = JSON.stringify(value); },
    scroller: { current: null }, todayISO: () => '2026-09-28',
    setTimeout: () => {}, validateAskCitations: text => ({ text, rejected: false }),
    searchLectures: () => [{ kind: 'lecture', l: lectures[0], t: 12, text: 'secret transcript' }, { kind: 'note', n: notes[0], text: 'secret note' }],
    searchAssignments: () => [], isFiniteRealSeconds: value => Number.isFinite(Number(value)),
    citationKey: (kind, id) => `${kind}:${id}`, listStudentGrades: () => held.promise,
    db: {
      list: async (path, filters) => {
        requests.push({ path, filters });
        return [{ data: { code: groupA, text: 'allowed discussion', title: 'allowed lecture', segs: [{ x: 'allowed transcript' }] } },
          { data: { code: groupB, text: 'foreign discussion', title: 'foreign lecture', segs: [{ x: 'foreign transcript' }] } }];
      },
      get: async () => ({ code: groupA, text: 'allowed notebook' }),
    },
    errMsg: e => e.message || '', evidenceForHit: () => {},
    speakAnswer() {}, changeVoice() {},
  };
  const clientRequests = [];
  deps.call = async (_path, body) => {
    clientRequests.push(body);
    if (clientRequests.length === 1) return { content: [{ type: 'tool_use', name: 'student_gradebook_scores', id: 'grade', input: {} }], stop_reason: 'tool_use' };
    return { content: [{ type: 'text', text: 'unexpected secret grade' }], stop_reason: 'end_turn' };
  };
  deps.getRandomBytes = size => new Uint8Array(size).fill(1);
  deps.setQuotaError = () => {};
  deps.askQuotaExhaustedRef = { current: false };
  deps.askAccess = { refresh: async () => ({ plan: 'student', askCountRemaining: 25 }) };
  const factory = new Function('deps', `with (deps) { ${aiSource}; ${toolSource}; ${sendSource}; return { ai, askAI, tools, send }; }`);
  const instance = factory(deps);
  deps.ai = instance.ai;
  deps.askAI = instance.askAI;
  return { ...instance, deps, state, held, requests, clientRequests, course };
}

test('Expo Ask cancels a held grade tool before another AI round or visible reply', async () => {
  for (const change of ['library', 'course']) {
    const h = harness();
    const pending = h.send('What is my grade?', false);
    await tick();
    assert.equal(h.clientRequests.length, 1);
    if (change === 'library') {
      h.state.uid = 'u_new';
      h.deps.renderedLibraryUidRef.current = 'u_new';
    } else {
      h.deps.scopeSnapshotRef.current = 'new-scope';
      h.deps.scopeRevision.current++;
    }
    h.held.resolve({ courses: [{ courseId: 'c', gradebook: { items: [{ title: 'secret grade', type: 'quiz', earned: 90, possible: 100 }] } }] });
    await pending;
    assert.equal(h.clientRequests.length, 1);
    assert.doesNotMatch(h.state.visible, /secret grade/);
  }
});

test('Expo Ask discards a delayed first AI answer after switching libraries', async () => {
  const h = harness();
  const first = deferred();
  h.deps.call = async (_path, body) => { h.clientRequests.push(body); return first.promise; };
  const pending = h.send('What is in my notes?', false);
  await tick();
  h.state.uid = 'u_new';
  h.deps.renderedLibraryUidRef.current = 'u_new';
  first.resolve({ content: [{ type: 'text', text: 'secret note and transcript' }], stop_reason: 'end_turn' });
  await pending;
  assert.equal(h.clientRequests.length, 1);
  assert.doesNotMatch(h.state.visible, /secret note|secret transcript/);
});

test('Expo Ask never sends a held group read to a second AI round after course switch', async () => {
  const h = harness();
  const groupRead = deferred();
  h.deps.call = async (_path, body) => {
    h.clientRequests.push(body);
    return h.clientRequests.length === 1
      ? { content: [{ type: 'tool_use', name: 'class_discussions', id: 'group', input: {} }], stop_reason: 'tool_use' }
      : { content: [{ type: 'text', text: 'unexpected foreign group' }], stop_reason: 'end_turn' };
  };
  h.deps.db.list = () => groupRead.promise;
  const pending = h.send('What did my group say?', false);
  await tick();
  h.deps.scopeSnapshotRef.current = 'new-scope';
  h.deps.scopeRevision.current++;
  groupRead.resolve([{ data: { code: groupA, text: 'secret group discussion' } }]);
  await pending;
  assert.equal(h.clientRequests.length, 1);
  assert.doesNotMatch(h.state.visible, /secret group discussion/);
});

test('Expo Ask reads only selected invite discussion, notebook and shared lectures', async () => {
  const h = harness();
  const byName = name => h.tools.find(t => t.name === name);
  const discussion = JSON.stringify(await byName('class_discussions').execute({}, () => {}));
  const shared = JSON.stringify(await byName('shared_course_material').execute({}, () => {}));
  assert.match(discussion, /allowed discussion/);
  assert.match(shared, /allowed notebook|allowed lecture|allowed transcript/);
  assert.doesNotMatch(discussion + shared, /foreign/);
  assert.ok(h.requests.every(r => JSON.stringify(r.filters) === JSON.stringify([['code', '==', groupA]])));
  h.course.groupCode = 'wrong';
  assert.doesNotMatch(JSON.stringify(await byName('class_discussions').execute({}, () => {})), /allowed|foreign/);
  assert.doesNotMatch(JSON.stringify(await byName('shared_course_material').execute({}, () => {})), /allowed|foreign/);
});

test('Expo semantic passages preserve exact times, validated IDs and partial-search notice', async () => {
  const h = harness();
  h.deps.retrievalMode = 'semantic';
  h.deps.scopedLectures[0].segs.push({ t: 17.25, x: 'ATP' });
  h.deps.searchPrivateEvidence = async (_query, ids) => {
    assert.deepEqual(ids, ['c']);
    return {
      notice: 'Partial search: narrow to one course.',
      hits: [
        { kind: 'lecture', id: 'old', courseId: 'c', seconds: 17.25, text: 'ATP' },
        { kind: 'lecture', id: 'old', courseId: 'c', seconds: 17.3, text: 'Invented time' },
        { kind: 'note', id: 'note', courseId: 'c', text: 'Private' },
        { kind: 'note', id: 'peer', courseId: 'other', text: 'Foreign' },
      ],
    };
  };
  const evidence = new Map();
  const result = await h.tools.find(t => t.name === 'search_course_material').execute({ query: 'cellular energy production' }, () => {}, evidence);
  assert.deepEqual(result.hits.map(h => h.citation), ['[[old@17.25]]', '[[note:note]]']);
  assert.equal(evidence.get('lecture:old').seconds, 17.25);
  assert.match(h.state.coverage, /Partial search/);
});

test('Expo discards a pending semantic search after a library or scope switch', async () => {
  for (const change of ['library', 'scope']) {
    const h = harness();
    h.deps.retrievalMode = 'semantic';
    const held = deferred();
    h.deps.searchPrivateEvidence = () => held.promise;
    const assertCurrent = () => {
      if (h.state.uid !== 'u_old' || h.deps.scopeSnapshotRef.current !== 'old-scope') throw { code: 'cancelled' };
    };
    const pending = h.tools.find(t => t.name === 'search_course_material').execute({ query: 'energy' }, assertCurrent, new Map());
    if (change === 'library') h.state.uid = 'u_new';
    else h.deps.scopeSnapshotRef.current = 'new-scope';
    held.resolve({ notice: 'Old-library notice', hits: [{ kind: 'note', id: 'note', courseId: 'c', text: 'Secret' }] });
    await assert.rejects(pending, error => error.code === 'cancelled');
    assert.equal(h.state.coverage, undefined);
  }
});