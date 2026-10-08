const test = require('node:test');
const assert = require('node:assert/strict');
const { rotateWithRecovery } = require('../.rotation-test.cjs');

test('lost rotation response retries before old-code uploads, including after a restart', async () => {
  const values = new Map();
  const storage = {
    getItem: async key => values.get(key) || null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
  let uploadCount = 0;
  let rotationCount = 0;
  let active = 'old';
  let committed = false;
  const args = {
    storage, oldCode: 'old', createCode: () => 'new',
    uploadPending: async () => {
      if (committed) throw new Error('old code is revoked');
      uploadCount++;
    },
    rotate: async code => {
      assert.equal(code, 'new');
      rotationCount++;
      committed = true;
      if (rotationCount === 1) throw new Error('response lost');
    },
    activate: async code => { active = code; },
  };
  await assert.rejects(rotateWithRecovery(args), /response lost/);
  assert.equal(active, 'old');
  assert.equal(uploadCount, 1);
  assert.deepEqual(JSON.parse(values.get('cs_rotation')), { old: 'old', next: 'new' });
  await rotateWithRecovery(args);
  assert.equal(uploadCount, 1, 'retry must not upload stale pending notes with revoked code');
  assert.equal(rotationCount, 2);
  assert.equal(active, 'new');
  assert.equal(values.has('cs_rotation'), false);
});