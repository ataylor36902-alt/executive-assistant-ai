const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sendPasswordResetCode,
  verifyPasswordResetCode,
  savePasswordReset,
  resendPasswordResetCode,
} = require('../.password-reset-test.cjs');

function clerkAttempt() {
  const calls = [];
  const signIn = {
    status: 'needs_first_factor',
    async reset() { calls.push('reset'); return { error: null }; },
    async create(input) { calls.push(['create', input]); return { error: null }; },
    resetPasswordEmailCode: {
      async sendCode() { calls.push('send'); return { error: null }; },
      async verifyCode(input) {
        calls.push(['verify', input]);
        signIn.status = 'needs_new_password';
        return { error: null };
      },
      async submitPassword(input) {
        calls.push(['password', input]);
        signIn.status = 'complete';
        return { error: null };
      },
    },
  };
  return { calls, signIn };
}

test('reset follows installed Clerk Core v3 method sequence and status transitions', async () => {
  const { signIn, calls } = clerkAttempt();
  await sendPasswordResetCode(signIn, 'student@example.com');
  await resendPasswordResetCode(signIn);
  await verifyPasswordResetCode(signIn, '123456');
  assert.equal(await savePasswordReset(signIn, 'new-password'), 'complete');
  assert.deepEqual(calls, [
    'reset', ['create', { identifier: 'student@example.com' }], 'send', 'send',
    ['verify', { code: '123456' }], ['password', { password: 'new-password' }],
  ]);
});

test('failed code verification remains retryable and does not submit a password', async () => {
  const { signIn } = clerkAttempt();
  const invalid = { errors: [{ message: 'Invalid code' }] };
  signIn.resetPasswordEmailCode.verifyCode = async () => ({ error: invalid });
  await assert.rejects(verifyPasswordResetCode(signIn, 'bad'), (error) => error === invalid);
  assert.equal(signIn.status, 'needs_first_factor');
  signIn.resetPasswordEmailCode.verifyCode = async () => {
    signIn.status = 'needs_new_password';
    return { error: null };
  };
  await verifyPasswordResetCode(signIn, 'good');
});

test('send and password errors propagate without advancing the flow', async () => {
  const { signIn } = clerkAttempt();
  signIn.resetPasswordEmailCode.sendCode = async () => ({ error: new Error('Send failed') });
  await assert.rejects(sendPasswordResetCode(signIn, 'student@example.com'), /Send failed/);
  signIn.status = 'needs_new_password';
  signIn.resetPasswordEmailCode.submitPassword = async () => ({ error: new Error('Weak password') });
  await assert.rejects(savePasswordReset(signIn, 'weak'), /Weak password/);
  assert.equal(signIn.status, 'needs_new_password');
});