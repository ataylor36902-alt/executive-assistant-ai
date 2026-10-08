const test = require('node:test');
const assert = require('node:assert/strict');
const { createNoteSaver, noteSaveMessage } = require('../.note-saving-test.cjs');
const { syncPendingRecords } = require('../.store-sync-test.cjs');

function harness() {
  const h = { uid: 'original-library', record: null, stored: null, writes: [], diskError: false, networkError: false };
  h.saver = createNoteSaver({
    getLibrary: () => h.uid,
    getRecord: () => h.record,
    applyRecord: record => { h.record = record; },
    persistLocal: async () => {
      if (h.diskError) throw new Error('Storage unavailable');
      h.stored = { ...h.record };
    },
    writeRemote: async (uid, record) => {
      h.writes.push({ uid, record });
      if (h.networkError) throw new Error('Offline');
      if (h.gate) await h.gate;
    },
  });
  return h;
}
const note = { id: 'test-note', title: 'Biology', body: 'Cell structure', courseId: 'course', updated: 1 };

test('local confirmation precedes sync, and only server acknowledgement clears pending', async () => {
  const h = harness();
  let release;
  h.gate = new Promise(resolve => { release = resolve; });
  let localConfirmed = false;
  const saving = h.saver.save(note, { onLocalSaved: () => { localConfirmed = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(localConfirmed, true);
  assert.equal(h.stored.body, note.body);
  assert.equal(h.record._pending, true);
  release();
  assert.deepEqual(await saving, { localSaved: true, synced: true });
  assert.equal(h.record._pending, undefined);
  assert.equal(h.stored._pending, undefined);
});

test('offline notes remain durable and pending, and retry uploads the latest complete note', async () => {
  const h = harness();
  h.networkError = true;
  const failed = await h.saver.save(note);
  assert.equal(failed.localSaved, true);
  assert.equal(failed.synced, false);
  assert.equal(h.stored._pending, true);
  h.networkError = false;
  const latest = { ...h.record, title: 'Updated title', body: 'Newest draft', courseId: 'new-course', pinned: true, updated: 2 };
  assert.equal((await h.saver.save(latest)).synced, true);
  assert.equal(h.writes.at(-1).record.body, latest.body);
  assert.equal(h.writes.at(-1).record.courseId, latest.courseId);
  assert.equal(h.writes.at(-1).record._pending, undefined);
});

test('storage failure never claims a local save and Retry can recover the in-memory draft', async () => {
  const h = harness();
  h.diskError = true;
  let confirmed = false;
  const failed = await h.saver.save(note, { onLocalSaved: () => { confirmed = true; } });
  assert.equal(failed.localSaved, false);
  assert.equal(confirmed, false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.record.body, note.body);
  h.diskError = false;
  assert.equal((await h.saver.save(h.record)).synced, true);
});

test('typing during a slow sync persists immediately and an old acknowledgement cannot clear a new draft', async () => {
  const h = harness();
  let release;
  h.gate = new Promise(resolve => { release = resolve; });
  const old = h.saver.save(note);
  await new Promise(resolve => setImmediate(resolve));
  const newest = { ...note, body: 'Written while syncing', updated: 2 };
  const next = h.saver.save(newest);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.stored.body, newest.body);
  assert.equal(h.stored._pending, true);
  assert.equal(h.writes.length, 1);
  release();
  await Promise.all([old, next]);
  assert.deepEqual(h.writes.map(item => item.record.body), [note.body, newest.body]);
  assert.equal(h.stored.body, newest.body);
  assert.equal(h.record._pending, undefined);
});

test('a library switch blocks a queued draft from being sent with the next library identity', async () => {
  const h = harness();
  let release;
  h.gate = new Promise(resolve => { release = resolve; });
  const old = h.saver.save(note);
  await new Promise(resolve => setImmediate(resolve));
  const next = h.saver.save({ ...note, body: 'Original library draft', updated: 2 });
  h.uid = 'different-library';
  release();
  await Promise.all([old, next]);
  assert.equal(h.writes.length, 1);
  const rejected = await h.saver.save(note, { libraryCode: 'original-library' });
  assert.equal(rejected.localSaved, false);
  assert.match(rejected.error.message, /library changed/);
});

test('deleted drafts are not recreated by queued saves', async () => {
  const h = harness();
  let release;
  h.gate = new Promise(resolve => { release = resolve; });
  const old = h.saver.save(note);
  await new Promise(resolve => setImmediate(resolve));
  const next = h.saver.save({ ...note, body: 'Queued', updated: 2 });
  h.record = null;
  release();
  await Promise.all([old, next]);
  assert.equal(h.writes.length, 1);
  assert.equal(h.record, null);
});

test('background refresh defers notes owned by the editor without clearing pending', async () => {
  const pending = { ...note, _pending: true };
  const result = await syncPendingRecords(['notes'], { notes: { [note.id]: pending } }, async () => false);
  assert.deepEqual(result.written, []);
  assert.deepEqual(result.failed, []);
});

test('save labels distinguish actual confirmations and retry states', () => {
  assert.equal(noteSaveMessage({ phase: 'idle' }), 'Autosave on');
  assert.equal(noteSaveMessage({ phase: 'saving' }), 'Saving…');
  assert.equal(noteSaveMessage({ phase: 'syncing' }), 'Saved on this phone · syncing…');
  assert.equal(noteSaveMessage({ phase: 'synced' }), 'Saved and synced');
  assert.equal(noteSaveMessage({ phase: 'pending' }), 'Saved on this phone · sync pending');
  assert.equal(noteSaveMessage({ phase: 'error' }), 'Couldn’t save on this phone');
});
