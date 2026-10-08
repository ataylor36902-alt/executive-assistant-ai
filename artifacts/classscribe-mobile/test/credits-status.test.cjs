const test = require('node:test');
const assert = require('node:assert/strict');
const { creditsStatusError } = require('../.credits-status-test.cjs');

test('Credits maintenance status is actionable without implying a zero balance', () => {
  assert.match(creditsStatusError({ status: 409 }), /temporarily paused for maintenance/);
  assert.match(creditsStatusError({ status: 503 }), /temporarily unavailable during maintenance/);
  assert.match(creditsStatusError({ status: 500, message: 'Server error' }), /Server error/);
});