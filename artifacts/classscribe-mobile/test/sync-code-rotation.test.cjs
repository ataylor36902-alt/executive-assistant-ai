const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  checkLibrary,
  db,
  getUid,
  rotateSyncCode,
  rotateWithRecovery,
  setServer,
  setUid,
} = require('../.sync-code-rotation-client.cjs');

const oldCode = 'u_TestOnlyOldLibraryCode';
const nextCode = 'u_TestOnlyReplacementCode';
const noteText = 'A note queued while offline';

function response(ok, body, status = ok ? 200 : 403) {
  return { ok, status, json: async () => body };
}

test('phone keeps an offline note, confirms rotation, retries a lost response, and switches another device', async () => {
  const previousFetch = global.fetch;
  const documents = new Map([
    [`data/users/${oldCode}/profile`, { firstName: 'Student' }],
  ]);
  const revoked = new Set();
  const rotations = new Map();
  const rotationRequests = [];
  const pendingNotes = [{
    path: `data/users/${oldCode}/lib/notes/offline-note`,
    data: { id: 'offline-note', body: noteText },
  }];
  const pendingValues = new Map();
  const rotationStorage = {
    async getItem(key) { return pendingValues.get(key) ?? null; },
    async setItem(key, value) { pendingValues.set(key, String(value)); },
    async removeItem(key) { pendingValues.delete(key); },
  };
  let offline = true;
  let loseFirstResponse = true;

  global.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(options.body || '{}');
    const code = options.headers?.['X-CS-User'];
    if (offline) throw new Error('test network unavailable');

    if (path === '/api/db/set') {
      if (revoked.has(code)) return response(false, { code: 'not_granted', error: 'This sync code has been replaced' });
      documents.set(body.path, body.data);
      return response(true, {});
    }
    if (path === '/api/db/get') {
      if (revoked.has(code)) return response(false, { code: 'not_granted', error: 'This sync code has been replaced' });
      return response(true, { data: documents.get(body.path) ?? null });
    }
    if (path === '/api/db/rotate') {
      rotationRequests.push({
        confirmed: body.confirm === true,
        sourceIsCurrent: code === oldCode,
        destination: body.nextCode,
      });
      if (body.confirm !== true) return response(false, { code: 'invalid', error: 'Confirmation required' }, 400);
      const previousDestination = rotations.get(code);
      if (previousDestination) {
        if (previousDestination !== body.nextCode) {
          return response(false, { code: 'not_granted', error: 'This sync code has been replaced' });
        }
      } else if (revoked.has(code) || code !== oldCode) {
        return response(false, { code: 'not_granted', error: 'This sync code has been replaced' });
      } else {
        const oldPrefix = `data/users/${code}/`;
        for (const [documentPath, data] of [...documents]) {
          if (documentPath.startsWith(oldPrefix)) {
            documents.set(`data/users/${body.nextCode}/${documentPath.slice(oldPrefix.length)}`, data);
            documents.delete(documentPath);
          }
        }
        rotations.set(code, body.nextCode);
        revoked.add(code);
      }
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error('test response lost after commit');
      }
      return response(true, {});
    }
    return response(false, { error: 'Unexpected test route' }, 404);
  };

  try {
    await setServer('https://classscribe.test');
    await setUid(oldCode);

    const uploadPending = async () => {
      for (const note of [...pendingNotes]) {
        await db.set(note.path, note.data);
        pendingNotes.splice(pendingNotes.indexOf(note), 1);
      }
    };
    const createArgs = () => ({
      storage: rotationStorage,
      oldCode: getUid(),
      createCode: () => nextCode,
      uploadPending,
      rotate: rotateSyncCode,
      activate: setUid,
    });

    await assert.rejects(
      rotateWithRecovery(createArgs()),
      (error) => error.code === 'offline',
    );
    assert.equal(pendingNotes.length, 1, 'the failed offline upload stays queued');
    assert.equal(rotationRequests.length, 0, 'the phone does not rotate while the note is unsynced');
    assert.equal(getUid() === oldCode, true);
    assert.equal(pendingValues.has('cs_rotation'), false);

    offline = false;
    await assert.rejects(
      rotateWithRecovery(createArgs()),
      (error) => error.code === 'offline',
    );
    assert.equal(pendingNotes.length, 0, 'the note reaches the server before migration');
    assert.equal(rotationRequests.length, 1);
    assert.equal(rotations.get(oldCode) === nextCode, true, 'the server committed before the response was lost');
    assert.equal(rotationRequests[0].confirmed, true, 'the phone sends confirmation to the rotation endpoint');
    assert.equal(rotationRequests[0].sourceIsCurrent, true);
    assert.equal(getUid() === oldCode, true, 'the phone keeps its old identity until the response is recovered');
    assert.equal(pendingValues.has('cs_rotation'), true);

    await rotateWithRecovery(createArgs());
    assert.equal(rotationRequests.length, 2);
    assert.equal(rotationRequests.every((request) => request.confirmed), true);
    assert.equal(rotationRequests[1].destination === rotationRequests[0].destination, true, 'retry uses the same proposed code');
    assert.equal(getUid() === nextCode, true);
    assert.equal(pendingValues.has('cs_rotation'), false);
    assert.equal(documents.get(`data/users/${nextCode}/lib/notes/offline-note`)?.body, noteText);

    // Simulate a second phone entering the replacement code in Account.
    await setUid(oldCode);
    assert.equal(await checkLibrary(nextCode), true);
    await setUid(nextCode);
    const note = await db.get(`data/users/${nextCode}/lib/notes/offline-note`);
    assert.equal(note.body, noteText);
    assert.equal(getUid() === nextCode, true);
  } finally {
    global.fetch = previousFetch;
  }
});

test('phone requires an explicit destructive confirmation before rotating', () => {
  const account = fs.readFileSync(new URL('../app/account.js', `file://${__dirname}/`), 'utf8');
  const action = account.match(/function replaceCode\(\)\s*\{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(action, 'the Account replacement action is present');
  assert.match(action, /Alert\.alert\('Replace your sync code\?'/);
  assert.match(action, /\{ text: 'Cancel', style: 'cancel' \}/);
  assert.match(action, /\{ text: 'Replace code', style: 'destructive'/);
  assert.ok(action.indexOf('st.replaceSyncCode()') > action.indexOf("text: 'Replace code'"));
});