import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('../src/middlewares/privacy-write-lock.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'privacy-lock-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$|privacy-access$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: `
          export const classscribePrivacyTombstonesTable = {libraryHash:'libraryHash', deletedUserHash:'deletedUserHash'};
          export const db = { select: () => ({from: () => ({where: () => ({limit: async () => globalThis.__privacyLockTest.tombstones})})}) };
          export const pool = {connect: () => {throw new Error('Must not reserve a data connection for a request lock')}};
          export const privacyLockPool = {connect: async () => {
            const h = globalThis.__privacyLockTest; h.connections++;
            return {query: async (sql) => {
              h.queries.push(sql);
              if(h.failure && sql.includes(h.failure)) throw new Error('fixture failure');
              if(sql.includes('pg_try_advisory_lock')) return {rows:[{acquired: h.blockedAttempts-- <= 0}]};
            },
              release: (destroy) => h.releases.push(!!destroy)};
          }};
          export const resolveWriteLibrary = async () => ({libraryCode:'u_privacyLockFixture', libraryHash:'fixture-hash'});
          export const requirePrivacyLibrary = async () => {
            const h = globalThis.__privacyLockTest;
            h.ownerChecks++;
            if(h.ownerDenied) throw Object.assign(new Error('Sign in to the linked account'), {status:403});
            return {libraryCode:'u_privacyLockFixture', libraryHash:'fixture-hash'};
          };
        `,
      }));
    },
  }],
});
const { privacyWriteLockMiddleware } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

async function invoke(path, { failure, tombstones = [], aborted = false, blockedAttempts = 0, ownerDenied = false } = {}) {
  const h = { connections: 0, queries: [], releases: [], tombstones, failure, nextCalls: 0, blockedAttempts, ownerDenied, ownerChecks: 0 };
  globalThis.__privacyLockTest = h;
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false, destroyed: false,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; this.end(); return this; },
    end() { this.writableEnded = true; this.emit('finish'); },
  });
  privacyWriteLockMiddleware({ method: 'POST', path, aborted }, res, () => h.nextCalls++);
  await new Promise(resolve => setImmediate(resolve));
  return { h, res };
}

test('POST data reads never reserve advisory-lock connections', async () => {
  for (const path of ['/db/get', '/db/list']) {
    const { h } = await invoke(path);
    assert.equal(h.connections, 0);
    assert.equal(h.nextCalls, 1);
  }
});
test('transaction-guarded profile writes do not take a second request lock', async () => {
  const { h } = await invoke('/db/update');
  assert.equal(h.connections, 0);
  assert.equal(h.nextCalls, 1);
});
test('other mutations use the isolated lock pool and unlock after finishing', async () => {
  const { h, res } = await invoke('/recording/reserve');
  assert.equal(h.connections, 1);
  assert.match(h.queries[0], /pg_try_advisory_lock/);
  assert.equal(h.nextCalls, 1);
  res.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.queries[1], /pg_advisory_unlock/);
  assert.deepEqual(h.releases, [false]);
});
test('failed acquisition destroys the connection and never starts a write', async () => {
  const { h, res } = await invoke('/recording/reserve', { failure: 'pg_try_advisory_lock' });
  assert.equal(res.code, 503);
  assert.equal(h.nextCalls, 0);
  assert.deepEqual(h.releases, [true]);
});
test('failed unlock destroys the session rather than returning a held lock', async () => {
  const { h, res } = await invoke('/recording/reserve', { failure: 'pg_advisory_unlock' });
  res.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.releases, [true]);
});
test('deleted libraries still cannot read or write', async () => {
  for (const path of ['/db/get', '/recording/reserve']) {
    const { h, res } = await invoke(path, { tombstones: [{ libraryHash: 'fixture-hash' }] });
    assert.equal(res.code, 410);
    assert.equal(h.nextCalls, 0);
    assert.equal(h.releases.length, path === '/db/get' ? 0 : 1);
  }
});
test('an already-aborted request releases its acquired lock without writing', async () => {
  const { h } = await invoke('/recording/reserve', { aborted: true });
  assert.equal(h.nextCalls, 0);
  assert.equal(h.connections, 0);
  assert.deepEqual(h.releases, []);
});

test('rejected recording consent never reserves a lock connection', async () => {
  const { h, res } = await invoke('/privacy/consents', { ownerDenied: true });
  assert.equal(res.code, 403);
  assert.equal(h.connections, 0);
  assert.equal(h.nextCalls, 0);
});

test('authorized recording consent is rechecked under its acquired lock', async () => {
  const { h, res } = await invoke('/privacy/consents');
  assert.equal(h.ownerChecks, 2);
  assert.equal(h.nextCalls, 1);
  res.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.releases, [false]);
});

test('a busy library returns its waiting connection before trying again', async () => {
  const { h, res } = await invoke('/recording/reserve', { blockedAttempts: 1 });
  assert.equal(h.connections, 1);
  assert.deepEqual(h.releases, [false]);
  assert.equal(h.nextCalls, 0);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(h.connections, 2);
  assert.equal(h.nextCalls, 1);
  assert.deepEqual(h.releases, [false]);
  res.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.releases, [false, false]);
});

test('a disconnected waiter stops polling without starting a mutation', async () => {
  const { h, res } = await invoke('/recording/reserve', { blockedAttempts: 100 });
  res.destroyed = true;
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(h.connections, 1);
  assert.equal(h.nextCalls, 0);
  assert.deepEqual(h.releases, [false]);
});
test('disconnects do not unlock an ongoing write before the handler ends', async () => {
  const { h, res } = await invoke('/recording/reserve');
  res.emit('close');
  assert.deepEqual(h.releases, []);
  res.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.releases, [false]);
});
