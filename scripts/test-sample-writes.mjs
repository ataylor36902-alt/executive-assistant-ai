import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the production guards and mutation functions, not copies of their logic.
// Deliberately fail when their boundaries change so this cannot silently test stale code.
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing production function boundaries: ${start}`);
  return source.slice(a, b);
}
const cols = ['courses', 'lectures', 'notes', 'assignments', 'stats'];
const empty = () => Object.fromEntries(cols.map(col => [col, {}]));
const fixtures = () => ({
  ...empty(),
  courses: { sample: { id: 'sample', ex: true, name: 'Sample', meetings: [] } },
  lectures: { lecture: { id: 'lecture', ex: true, courseId: 'sample', title: 'Sample lecture', reviewed: false } },
  notes: { note: { id: 'note', ex: true, courseId: 'sample', lectureId: 'lecture', body: 'Sample note' } },
  assignments: { assignment: { id: 'assignment', ex: true, courseId: 'sample', done: false } },
  stats: { sample: { id: 'sample', ex: true, concepts: {} } },
});
function webHarness(source) {
  const S = { ...empty(), uid: 'disposable-library', mode: 'db' }, EX = fixtures(), writes = [];
  const ctx = vm.createContext({
    S, EX, toast() {}, schedule() {}, clone: structuredClone, localSave() {},
    colRef: col => ({ doc: id => ({
      set: async data => writes.push({ col, id, data }),
      delete: async () => writes.push({ col, id, delete: true }),
    }) }),
  });
  vm.runInContext(between(source, 'function isExampleRecord(', 'function schedule()'), ctx);
  return { mine: S, samples: EX, writes, put: ctx.put, del: ctx.del };
}
function phoneHarness() {
  const source = readFileSync('artifacts/classscribe-mobile/lib/store.js', 'utf8');
  const mine = empty(), samples = fixtures(), writes = [];
  const ctx = vm.createContext({
    useCallback: fn => fn, getUid: () => 'disposable-library',
    mineRef: { current: mine }, exRef: { current: samples },
    setMine: fn => Object.assign(mine, typeof fn === 'function' ? fn(mine) : fn), saveCache() {},
    db: { set: async (path, data) => writes.push({ path, data }), del: async path => writes.push({ path, delete: true }) },
    failedWrites: { current: new Map() }, failedDeletes: { current: new Map() },
    writes: { current: new Set() },
    removeLectureConsents: async () => {}, setStatus() {},
    noteSaver: { current: null },
    // Replace only the durable-save transport, retaining the store's real guard.
    createNoteSaver: options => ({ save: async obj => {
      options.applyRecord(obj);
      await options.persistLocal('disposable-library');
      await options.writeRemote('disposable-library', obj);
      return { localSaved: true, synced: true };
    } }),
  });
  vm.runInContext(
    between(source, '  const isExampleRecord = useCallback(', '  const saveNote = useCallback(') +
    between(source, '  const saveNote = useCallback(', '  const put = useCallback(') +
    between(source, '  const put = useCallback(', '  const saveRecordingFinishIntent = useCallback(') +
    between(source, '  const del = useCallback(', '  const saveProfile = useCallback(') +
    '\nglobalThis.mutations = { put, del, saveNote };', ctx);
  return { mine, samples, writes, ...ctx.mutations };
}
for (const [name, factory] of [
  ['web source', () => webHarness(readFileSync('artifacts/classscribe/web-src/3_core.js', 'utf8'))],
  ['served web', () => webHarness(readFileSync('artifacts/classscribe/web-public/index.html', 'utf8'))],
  ['mobile store', phoneHarness],
]) {
  test(`${name}: sample updates/deletes, stripped flags and new children never write`, async () => {
    const h = factory(), before = JSON.stringify(h.samples);
    for (const col of cols) {
      for (const obj of Object.values(h.samples[col])) {
        await h.put(col, { ...obj, ex: false, courseId: 'real', title: 'Changed', body: 'Changed', done: true, meetings: ['Changed'] });
        await h.del(col, obj.id);
      }
    }
    for (const col of ['lectures', 'notes', 'assignments']) {
      await h.put(col, { id: `new-${col}`, courseId: 'sample', ex: false });
    }
    await h.put('notes', { id: 'new-lecture-note', lectureId: 'lecture', ex: false });
    if (h.saveNote) {
      for (const obj of [
        { ...h.samples.notes.note, ex: false, courseId: 'real' },
        { id: 'new-autosaved-note', lectureId: 'lecture', ex: false },
      ]) {
        const result = await h.saveNote(obj);
        assert.equal(result.localSaved, false);
        assert.equal(result.synced, false);
      }
    }
    assert.equal(JSON.stringify(h.samples), before, 'bundled sample data must remain intact');
    assert.equal(JSON.stringify(h.mine), JSON.stringify(name.includes('web') ? { ...empty(), uid: 'disposable-library', mode: 'db' } : empty()), 'sample data must not leak into the private library');
    assert.equal(h.writes.length, 0, 'no sample mutation may reach persistence');
  });
  test(`${name}: real course, lecture, note, assignment and progress remain writable`, async () => {
    const h = factory();
    for (const col of cols) {
      const record = { id: `real-${col}`, courseId: 'real-courses', title: 'Original', ex: false };
      await h.put(col, record);
      await h.put(col, { ...record, title: 'Edited' });
      assert.equal(h.mine[col][record.id].title, 'Edited');
      await h.del(col, record.id);
      assert.equal(h.mine[col][record.id], undefined);
    }
    assert.equal(h.writes.length, 15, 'real edits and deletes must reach persistence');
  });
}
