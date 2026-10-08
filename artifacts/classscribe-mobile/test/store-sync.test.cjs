const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applySyncedRecords,
  collectPendingRecords,
  isReplacedSyncCodeError,
  libraryCacheKey,
  libraryDeletesKey,
  libraryProfileKey,
  mergeRemoteRecords,
  syncPendingRecords,
} = require('../.store-sync-test.cjs');

const collections = ['courses', 'lectures', 'assignments', 'notes', 'stats'];

function document(id, data) {
  return { id, data };
}

test('offline edits to existing records override remote copies until a reconnect write succeeds', async () => {
  const remote = Object.fromEntries(collections.map((collection) => [
    collection,
    { id: `existing-${collection}`, title: `Server version: ${collection}`, revision: 1 },
  ]));
  const results = collections.map((collection) => [document(`existing-${collection}`, remote[collection])]);
  results[0].push(document('deleted-course', { id: 'deleted-course', title: 'Must stay deleted' }));

  const offlineEdits = Object.fromEntries(collections.map((collection) => {
    const id = `existing-${collection}`;
    return [collection, { [id]: { ...remote[collection], title: `Edited offline: ${collection}`, revision: 2, _pending: true } }];
  }));
  const tombstones = { courses: { 'deleted-course': true } };

  const afterReconnect = mergeRemoteRecords(collections, results, offlineEdits, tombstones);
  for (const collection of collections) {
    assert.equal(afterReconnect[collection][`existing-${collection}`].title, `Edited offline: ${collection}`);
    assert.equal(afterReconnect[collection][`existing-${collection}`]._pending, true);
  }
  assert.equal(afterReconnect.courses['deleted-course'], undefined, 'a remote copy must not revive a queued deletion');

  const firstSync = await syncPendingRecords(collections, afterReconnect, async () => {
    throw new Error('offline');
  });
  assert.equal(firstSync.written.length, 0);
  assert.equal(firstSync.failed.length, collections.length);
  assert.equal(afterReconnect.notes['existing-notes']._pending, true, 'failed sync retains the local edit');

  const server = structuredClone(remote);
  const refreshedAgain = mergeRemoteRecords(collections, results, afterReconnect, tombstones);
  const retry = await syncPendingRecords(collections, refreshedAgain, async (collection, _id, clean) => {
    server[collection] = clean;
  });
  const synced = applySyncedRecords(refreshedAgain, retry.written);

  assert.equal(retry.failed.length, 0);
  assert.equal(retry.written.length, collections.length);
  assert.equal(synced.notes['existing-notes'].title, 'Edited offline: notes');
  assert.equal(synced.notes['existing-notes']._pending, undefined, 'successful sync clears the dirty marker');
  assert.equal(server.notes.title, 'Edited offline: notes', 'the edited record reaches the server');
});

test('offline cache and profile/tombstone keys are isolated by sync code', () => {
  assert.notEqual(libraryCacheKey('u_first-library'), libraryCacheKey('u_second-library'));
  assert.notEqual(libraryProfileKey('u_first-library'), libraryProfileKey('u_second-library'));
  assert.notEqual(libraryDeletesKey('u_first-library'), libraryDeletesKey('u_second-library'));
});

test('replaced-code recovery keeps queued local edits over the migrated server copy', () => {
  const local = {
    ...Object.fromEntries(collections.map(collection => [collection, {}])),
    notes: { n1: { id: 'n1', body: 'Unsynced edit', _pending: true } },
  };
  const failed = new Map([['courses:c1', { col: 'courses', obj: { id: 'c1', name: 'Offline course' } }]]);
  const pending = collectPendingRecords(collections, local, failed);
  const remote = collections.map(collection => collection === 'notes'
    ? [document('n1', { body: 'Older server copy' })]
    : []);
  const recovered = mergeRemoteRecords(collections, remote, pending, {});

  assert.equal(recovered.notes.n1.body, 'Unsynced edit');
  assert.equal(recovered.notes.n1._pending, true);
  assert.equal(recovered.courses.c1.name, 'Offline course');
  assert.equal(recovered.courses.c1._pending, true);
});

test('only the explicit replaced-library response enters recovery state', () => {
  assert.equal(isReplacedSyncCodeError({ code: 'not_granted', message: 'This sync code has been replaced' }), true);
  assert.equal(isReplacedSyncCodeError({ code: 'not_granted', message: 'Not allowed' }), false);
  assert.equal(isReplacedSyncCodeError({ code: 'unavailable', message: 'This sync code has been replaced' }), false);
});