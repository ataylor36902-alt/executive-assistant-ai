const assert = require('node:assert/strict');
const test = require('node:test');
const { apiError, creditsOptInBody } = require('../.credits-contract-test.cjs');

test('credits-required 402 details stay available to the confirmation UI', () => {
  const error = apiError({
    code: 'credits_required',
    error: 'Credits are required.',
    cost: 3,
    balance: 12,
    action: 'study_guide',
    requestId: 'request-123',
  }, 402);
  assert.deepEqual(
    { code: error.code, status: error.status, message: error.message, cost: error.cost, balance: error.balance, action: error.action, requestId: error.requestId },
    { code: 'credits_required', status: 402, message: 'Credits are required.', cost: 3, balance: 12, action: 'study_guide', requestId: 'request-123' },
  );
});

test('nested server details are promoted while preserving server error metadata', () => {
  const error = apiError({ code: 'credits_required', error: 'Use Credits?', details: { cost: 4, balance: 2, action: 'ask', requestId: 'request-456' } }, 402);
  assert.equal(error.code, 'credits_required');
  assert.equal(error.requestId, 'request-456');
  assert.equal(error.cost, 4);
  assert.equal(error.balance, 2);
});

test('Credits opt-in retry preserves the original body and adds only explicit confirmation fields', () => {
  const original = { recordingId: 'recording-1' };
  assert.deepEqual(creditsOptInBody(original, 'request-789'), {
    recordingId: 'recording-1',
    useCredits: true,
    requestId: 'request-789',
  });
  assert.deepEqual(original, { recordingId: 'recording-1' });
  assert.throws(() => creditsOptInBody(original, ''), (error) => error.code === 'invalid_argument' && /No Credits were used/.test(error.message));
});