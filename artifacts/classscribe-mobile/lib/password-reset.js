function assertClerkResult(result) {
  if (result?.error) throw result.error;
}

export async function sendPasswordResetCode(signIn, email) {
  assertClerkResult(await signIn.reset());
  assertClerkResult(await signIn.create({ identifier: email }));
  assertClerkResult(await signIn.resetPasswordEmailCode.sendCode());
}

export async function verifyPasswordResetCode(signIn, code) {
  assertClerkResult(await signIn.resetPasswordEmailCode.verifyCode({ code }));
  if (signIn.status !== 'needs_new_password') {
    throw new Error(`Password reset needs another step (${signIn.status || 'incomplete'}). Please request a new code.`);
  }
}

export async function savePasswordReset(signIn, password) {
  assertClerkResult(await signIn.resetPasswordEmailCode.submitPassword({ password }));
  return signIn.status;
}

export async function resendPasswordResetCode(signIn) {
  assertClerkResult(await signIn.resetPasswordEmailCode.sendCode());
}