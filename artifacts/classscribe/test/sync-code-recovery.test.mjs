import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web-public/platform.js', import.meta.url), 'utf8');

function createBrowser(fetchImpl, failPendingStorage = false, initialCode = 'u_oldlibrarycode123456789') {
  const values = new Map([['cs_device_uid', initialCode]]);
  const calls = [];
  const timers = [];
  let reloads = 0;
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failPendingStorage && key.startsWith('cs_sync_pending_v1_')) throw new Error('Quota exceeded');
      values.set(key, String(value));
    },
    removeItem: key => values.delete(key),
  };
  const window = { dispatchEvent: event => calls.push({ event: event.type }) };
  const context = {
    window,
    document: { hidden: true },
    localStorage,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetchImpl(url, options);
    },
    Event: class Event { constructor(type) { this.type = type; } },
    location: { reload: () => { reloads++; } },
    setTimeout: callback => { timers.push(callback); return timers.length; },
    setInterval: () => 0,
    clearTimeout: () => {},
    crypto: { getRandomValues: bytes => bytes.fill(1) },
    Uint8Array, Array, Map, Set, Promise, Date, Math, JSON, String, Number, Object, Error,
    Blob: class Blob {}, FileReader: class FileReader {},
    console,
  };
  vm.runInNewContext(source, context);
  return { window, localStorage, values, calls, timers, get reloads() { return reloads; } };
}

function response(ok, body, statusText = 'Forbidden') {
  return { ok, statusText, json: async () => body };
}

test('browser reports a replaced code and carries failed local work to the entered library', async () => {
  const oldCode = 'u_oldlibrarycode123456789';
  const newCode = 'u_newlibrarycode123456789';
  const browser = createBrowser((url, options) => {
    const body = JSON.parse(options.body);
    const code = options.headers['X-CS-User'];
    if (url === '/api/db/set' && code === oldCode) {
      return response(false, { code: 'not_granted', error: 'This sync code has been replaced' });
    }
    if (url === '/api/db/get' && code === newCode && body.path === `data/users/${newCode}/profile`) {
      return response(true, { data: { firstName: 'Sam' } });
    }
    return response(true, { data: null });
  });
  const db = await browser.window.claude.use('db');
  const notes = db.collection(`data/users/${oldCode}/lib/notes`);

  await assert.rejects(notes.doc('offline-note').set({ id: 'offline-note', body: 'Saved only on this device' }));
  assert.equal(browser.window.CS_SYNC.replaced, true);
  const oldPending = JSON.parse(browser.values.get(`cs_sync_pending_v1_${oldCode}`));
  assert.equal(oldPending[`data/users/${oldCode}/lib/notes/offline-note`].data.body, 'Saved only on this device');

  browser.localStorage.setItem(`cs_pending_profile_v2_${oldCode}`, JSON.stringify({ school: 'North Campus' }));
  await browser.window.CS_SYNC.use(newCode);

  const moved = JSON.parse(browser.values.get(`cs_sync_pending_v1_${newCode}`));
  assert.equal(moved[`data/users/${newCode}/lib/notes/offline-note`].data.body, 'Saved only on this device');
  assert.deepEqual(JSON.parse(browser.values.get(`cs_pending_profile_v2_${newCode}`)), { school: 'North Campus' });
  assert.equal(browser.values.get('cs_device_uid'), newCode);
  assert.equal(browser.reloads, 1);
});

test('a class-group permission error does not show the replaced-library state', async () => {
  const browser = createBrowser(() => response(false, { code: 'not_granted', error: 'Not allowed' }));
  const db = await browser.window.claude.use('db');

  await assert.rejects(db.collection('posts').doc('post-one').set({ body: 'Class post' }));
  assert.equal(browser.window.CS_SYNC.replaced, false);
});

test('browser storage failure keeps recovery in the current page instead of switching libraries', async () => {
  const oldCode = 'u_oldlibrarycode123456789';
  const browser = createBrowser(
    () => response(false, { code: 'not_granted', error: 'This sync code has been replaced' }),
    true,
  );
  const db = await browser.window.claude.use('db');

  await assert.rejects(
    db.collection(`data/users/${oldCode}/lib/notes`).doc('offline-note').set({ body: 'Keep this work' }),
    /could not be saved in browser storage/i,
  );
  await assert.rejects(
    browser.window.CS_SYNC.use('u_newlibrarycode123456789'),
    /free browser storage/i,
  );
  assert.equal(browser.values.get('cs_device_uid'), oldCode);
  assert.equal(browser.reloads, 0);
});

test('browser confirms and recovers a rotation after offline notes and a lost response, then lets another device switch', async () => {
  const oldCode = 'u_test_old_library';
  const documents = new Map([
    [`data/users/${oldCode}/profile`, { firstName: 'Student' }],
  ]);
  const revoked = new Set();
  const rotations = new Map();
  const rotationRequests = [];
  let offline = true;
  let loseFirstResponse = true;

  const fetchServer = async (url, options) => {
    const body = JSON.parse(options.body || '{}');
    const code = options.headers['X-CS-User'];
    if (offline) throw new Error('test network unavailable');

    if (url === '/api/db/set') {
      if (revoked.has(code)) return response(false, { code: 'not_granted', error: 'This sync code has been replaced' });
      documents.set(body.path, body.data);
      return response(true, {});
    }
    if (url === '/api/db/get') {
      if (revoked.has(code)) return response(false, { code: 'not_granted', error: 'This sync code has been replaced' });
      return response(true, { data: documents.get(body.path) || null });
    }
    if (url === '/api/db/rotate') {
      rotationRequests.push({
        confirmed: body.confirm === true,
        sourceIsCurrent: code === oldCode,
        destination: body.nextCode,
      });
      if (body.confirm !== true) return response(false, { code: 'invalid', error: 'Confirmation required' }, 'Bad Request');
      const previous = rotations.get(code);
      if (previous) {
        if (previous !== body.nextCode) return response(false, { code: 'not_granted', error: 'This sync code has been replaced' });
      } else if (revoked.has(code) || code !== oldCode) {
        return response(false, { code: 'not_granted', error: 'This sync code has been replaced' });
      } else {
        const oldPrefix = `data/users/${code}/`;
        for (const [path, data] of [...documents]) {
          if (path.startsWith(oldPrefix)) {
            documents.set(`data/users/${body.nextCode}/${path.slice(oldPrefix.length)}`, data);
            documents.delete(path);
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
    return response(true, { data: null });
  };

  const firstDevice = createBrowser(fetchServer, false, oldCode);
  const db = await firstDevice.window.claude.use('db');
  const notePath = `data/users/${oldCode}/lib/notes/offline-note`;
  await assert.rejects(
    db.doc(notePath).set({ body: 'Saved while offline' }),
    /network unavailable/,
  );
  assert.equal(documents.has(notePath), false, 'the offline note is local before reconnection');

  await assert.rejects(firstDevice.window.CS_SYNC.rotate(), /saved only in this browser/i);
  assert.equal(rotationRequests.length, 0, 'an offline note blocks the first rotation attempt');
  assert.equal(firstDevice.values.get('cs_device_uid') === oldCode, true);

  offline = false;
  await assert.rejects(firstDevice.window.CS_SYNC.rotate(), /response lost after commit/);
  assert.equal(rotationRequests.length, 1);
  assert.equal(rotationRequests[0].confirmed, true, 'the browser sends the required confirmation');
  assert.equal(rotationRequests[0].sourceIsCurrent, true);
  const nextCode = rotationRequests[0].destination;
  assert.equal(typeof nextCode, 'string');
  assert.equal(firstDevice.values.get('cs_device_uid') === oldCode, true, 'the client stays on the old identity until retry succeeds');
  assert.equal(firstDevice.values.has('cs_rotation'), true, 'the retry destination survives a lost response');

  await firstDevice.window.CS_SYNC.rotate();
  assert.equal(rotationRequests.length, 2);
  assert.equal(rotationRequests.every((request) => request.confirmed), true);
  assert.equal(rotationRequests[1].destination === nextCode, true, 'retry reuses the same destination identity');
  assert.equal(firstDevice.values.get('cs_device_uid') === nextCode, true);
  assert.equal(firstDevice.values.has('cs_rotation'), false);
  assert.equal(documents.get(`data/users/${nextCode}/lib/notes/offline-note`)?.body, 'Saved while offline');

  const secondDevice = createBrowser(fetchServer, false, oldCode);
  await secondDevice.window.CS_SYNC.use(nextCode);
  const secondDb = await secondDevice.window.claude.use('db');
  const movedNote = await secondDb.doc(`data/users/${nextCode}/lib/notes/offline-note`).get();
  assert.equal(movedNote.data().body, 'Saved while offline');
  assert.equal(secondDevice.values.get('cs_device_uid') === nextCode, true);
  assert.equal(secondDevice.reloads, 1);
});

test('browser asks for confirmation before starting sync-code rotation', () => {
  const page = fs.readFileSync(new URL('../web-public/index.html', import.meta.url), 'utf8');
  const action = page.match(/ACT\.rotateSync=async el=>\{([\s\S]*?)\n\};/)?.[1];
  assert.ok(action, 'the Account rotation action is present');
  const confirmAt = action.indexOf('confirm(');
  const rotateAt = action.indexOf('window.CS_SYNC.rotate()');
  assert.ok(confirmAt >= 0 && rotateAt > confirmAt, 'the server migration starts only after the confirmation prompt');
});
