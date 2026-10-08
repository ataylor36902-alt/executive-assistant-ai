const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { readFileSync } = require('node:fs');
const { tokenCache } = require('@clerk/expo/token-cache');
const Welcome = require('../app/welcome').default;
const { AccountSessionControls } = require('../components/AccountSessionControls');
const {
  beginRequiredAuthRender,
  controls,
  inputAccessories,
  redirectCalls,
  resetRequiredAuthUI,
  scrollViews,
  textInputs,
  asyncStorageEntries,
} = require('./fixtures/required-auth-ui.jsx');

function renderWelcome() {
  beginRequiredAuthRender();
  return renderToStaticMarkup(React.createElement(Welcome));
}

function renderAccountSession() {
  beginRequiredAuthRender();
  return renderToStaticMarkup(React.createElement(AccountSessionControls));
}

test('iOS numeric birthdate completion dismisses the keypad without submitting an account', () => {
  const state = resetRequiredAuthUI({ platform: 'ios' });
  renderWelcome();
  assert.equal(scrollViews[0].bottomOffset, 120);
  enter('Birth month (1–12)', '1');
  renderWelcome();
  const before = state.keyboardDismissCalls || 0;
  enter('Birth year', '200');
  assert.equal(state.keyboardDismissCalls || 0, before);
  renderWelcome();
  enter('Birth year', '2000');
  assert.equal(state.keyboardDismissCalls, before + 1);
  renderWelcome();
  assert.equal(state.signUpPasswordInput, undefined);
  assert.equal(state.ssoCalls, undefined);
  assert.equal(asyncStorageEntries.has('cs_privacy_ageband_pending'), false);
  const submit = controls.find((item) => item.testID === 'birthdate-keyboard-submit');
  assert.ok(submit);
  assert.equal(submit.disabled, false);
  assert.equal(submit.accessibilityLabel, 'Submit account details');
  for (const input of textInputs.filter((item) => ['Birth month', 'Birth year'].includes(item.accessibilityLabel))) {
    assert.equal(input.inputAccessoryViewID, inputAccessories[0].nativeID);
  }
});

test('iOS keyboard Continue runs the same explicit social age check', async () => {
  const state = resetRequiredAuthUI({ platform: 'ios' });
  renderWelcome();
  await press('Already have an account? Sign in');
  renderWelcome();
  await press('Other sign-in options');
  renderWelcome();
  await press('Continue with Google');
  renderWelcome();
  let submit = controls.find((item) => item.testID === 'birthdate-keyboard-submit');
  assert.equal(submit.disabled, true);
  await enterBirthMonthYear('1', '2000');
  submit = controls.find((item) => item.testID === 'birthdate-keyboard-submit');
  assert.equal(submit.accessibilityLabel, 'Continue after age check');
  assert.equal(submit.disabled, false);
  assert.equal(state.ssoCalls, undefined);
  await submit.onPress();
  assert.equal(state.ssoCalls.length, 1);
  assert.deepEqual(state.ssoCalls[0].unsafeMetadata, { ageBand: '18+' });
});

test('completing month last does not close the keypad at the first digit of December', () => {
  const state = resetRequiredAuthUI({ platform: 'ios' });
  renderWelcome();
  enter('Birth year', '2000');
  renderWelcome();
  const before = state.keyboardDismissCalls || 0;
  enter('Birth month (1–12)', '1');
  assert.equal(state.keyboardDismissCalls || 0, before);
  renderWelcome();
  enter('Birth month (1–12)', '12');
  assert.equal(state.keyboardDismissCalls, before + 1);
});

test('iOS keyboard Submit creates an email account only after the explicit tap', async () => {
  const state = resetRequiredAuthUI({ platform: 'ios' });
  renderWelcome();
  enter('you@school.edu', 'student@example.edu');
  enter('Choose your password', 'a-strong-password');
  renderWelcome();
  await enterBirthMonthYear('1', '2000');
  assert.equal(state.signUpPasswordInput, undefined);
  await controls.find((item) => item.testID === 'birthdate-keyboard-submit').onPress();
  assert.deepEqual(state.signUpPasswordInput, {
    emailAddress: 'student@example.edu',
    password: 'a-strong-password',
    unsafeMetadata: { ageBand: '18+' },
  });
  // The fixture returns a complete, verified Clerk account by default.
  assert.match(renderWelcome(), /Set up your library/);
});

test('iOS reset code field is visible while sending and preserves code entered before send completes', async () => {
  let finish;
  resetRequiredAuthUI({ platform: 'ios', resetSendPending: new Promise((resolve) => { finish = resolve; }) });
  renderWelcome();
  await press('Forgot your password? Reset it');
  renderWelcome();
  enter('you@school.edu', 'student@example.edu');
  renderWelcome();
  const pending = press('Send reset code');
  assert.match(renderWelcome(), /Requesting your code/);
  const field = textInputs.find((input) => input.testID === 'reset-code');
  assert.ok(field, 'code entry must be visible before the send request resolves');
  assert.equal(field.accessibilityLabel, 'Password reset code');
  assert.equal(control('Verify reset code').disabled, true);
  enter('Reset code', '123456');
  finish();
  await pending;
  renderWelcome();
  assert.equal(textInputs.find((input) => input.testID === 'reset-code').value, '123456');
  assert.notEqual(control('Verify reset code').disabled, true);
  await press('Verify reset code');
  assert.match(renderWelcome(), /Set a new password/);
});

test('iOS failed reset send keeps the code field and permits retry without premature verification', async () => {
  resetRequiredAuthUI({ platform: 'ios', resetSendError: new Error('Network unavailable') });
  renderWelcome();
  await press('Forgot your password? Reset it');
  renderWelcome();
  enter('you@school.edu', 'student@example.edu');
  renderWelcome();
  await press('Send reset code');
  assert.match(renderWelcome(), /Network unavailable/);
  assert.ok(textInputs.find((input) => input.testID === 'reset-code'));
  assert.equal(control('Verify reset code').disabled, true);
  globalThis.__requiredAuthState.resetSendError = null;
  await press('Retry sending reset code');
  // The link starts the asynchronous request without returning its promise.
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(renderWelcome(), /A reset code was sent/);
  assert.notEqual(control('Verify reset code').disabled, true);
});

test('iOS Account exposes sign-out and Cancel preserves the session', async () => {
  resetRequiredAuthUI({ isSignedIn: true, platform: 'ios' });
  renderAccountSession();
  await press('Sign out of account');
  const state = globalThis.__requiredAuthState;
  const [title, message, buttons] = state.alerts[0];
  assert.equal(title, 'Sign out of account?');
  assert.match(message, /library stays saved/);
  assert.match(message, /does not delete your data or cancel a subscription/);
  assert.equal(buttons[0].text, 'Cancel');
  assert.equal(buttons[0].onPress, undefined);
  assert.equal(state.signOutCalls || 0, 0);
  assert.equal(state.isSignedIn, true);
  assert.equal(state.navigation, undefined);
});

test('confirmed iOS sign-out opens account sign-in without clearing library storage', async () => {
  resetRequiredAuthUI({ isSignedIn: true, platform: 'ios' });
  asyncStorageEntries.set('cs_uid', 'u_test_library_preserved');
  asyncStorageEntries.set('cs_cache', 'private library contents');
  renderAccountSession();
  await press('Sign out of account');
  await globalThis.__requiredAuthState.alerts[0][2][1].onPress();
  const state = globalThis.__requiredAuthState;
  assert.equal(state.signOutCalls, 1);
  assert.equal(state.isSignedIn, false);
  assert.deepEqual(state.navigation, [['replace', '/account-sign-in']]);
  assert.equal(asyncStorageEntries.get('cs_uid'), 'u_test_library_preserved');
  assert.equal(asyncStorageEntries.get('cs_cache'), 'private library contents');
  assert.match(renderAccountSession(), /Sign in to account/);
});

test('failed sign-out stays on Account and offers a visible retry', async () => {
  resetRequiredAuthUI({ isSignedIn: true, signOutError: new Error('Network unavailable') });
  renderAccountSession();
  await press('Sign out of account');
  await globalThis.__requiredAuthState.alerts[0][2][1].onPress();
  assert.equal(globalThis.__requiredAuthState.isSignedIn, true);
  assert.equal(globalThis.__requiredAuthState.navigation, undefined);
  assert.match(renderAccountSession(), /Could not sign out: Network unavailable/);
  assert.notEqual(control('Sign out of account').disabled, true);
});

test('Account sign-out waits for Clerk and cannot submit twice', async () => {
  let finish;
  resetRequiredAuthUI({ isSignedIn: true, signOutPending: new Promise((resolve) => { finish = resolve; }) });
  renderAccountSession();
  await press('Sign out of account');
  const action = globalThis.__requiredAuthState.alerts[0][2][1].onPress;
  const pending = action();
  await action();
  assert.equal(globalThis.__requiredAuthState.signOutCalls, 1);
  assert.equal(globalThis.__requiredAuthState.navigation, undefined);
  finish();
  await pending;
  assert.deepEqual(globalThis.__requiredAuthState.navigation, [['replace', '/account-sign-in']]);
});

function control(label) {
  const result = controls.find((item) => item.authLabel === label);
  assert.ok(result, `missing control: ${label}`);
  return result;
}

async function press(label) {
  const result = control(label);
  assert.notEqual(result.disabled, true, `${label} should not be pressed while disabled`);
  if (typeof result.onPress !== 'function') throw new Error(`${label} is not actionable`);
  return result.onPress();
}

function enter(placeholder, value) {
  const field = textInputs.find((item) => item.placeholder === placeholder);
  assert.ok(field, `missing input: ${placeholder}`);
  field.onChangeText(value);
}

async function enterBirthMonthYear(month = '1', year = '2000') {
  enter('Birth month (1–12)', month);
  renderWelcome();
  enter('Birth year', year);
  return renderWelcome();
}

async function continueSocial(providerLabel, year = '2000') {
  await press(providerLabel);
  renderWelcome();
  await enterBirthMonthYear('1', year);
  await press(`Continue with ${providerLabel.includes('Apple') ? 'Apple' : 'Google'}`);
  return renderWelcome();
}

function noGuestContinuation(markup) {
  assert.doesNotMatch(markup, /Continue to profile setup|Continue to library|Return to library/);
}

test('auth fields expose keyboard Done dismissal and the iOS accessory without adding web/Android accessories', () => {
  const iosState = resetRequiredAuthUI({ platform: 'ios' });
  renderWelcome();
  assert.equal(scrollViews[0].keyboardDismissMode, 'interactive');
  assert.equal(inputAccessories.length, 1);
  const accessoryID = inputAccessories[0].nativeID;
  assert.ok(accessoryID);
  for (const field of textInputs) {
    assert.equal(field.returnKeyType, 'done');
    assert.equal(field.blurOnSubmit, true);
    assert.equal(typeof field.onSubmitEditing, 'function');
    assert.equal(field.inputAccessoryViewID, accessoryID);
  }
  textInputs[0].onSubmitEditing();
  assert.equal(iosState.keyboardDismissCalls, 1);
  control('Done').onPress();
  assert.equal(iosState.keyboardDismissCalls, 2);

  for (const platform of ['android', 'web']) {
    resetRequiredAuthUI({ platform });
    renderWelcome();
    assert.equal(inputAccessories.length, 0);
    for (const field of textInputs) {
      assert.equal(field.returnKeyType, 'done');
      assert.equal(field.blurOnSubmit, true);
      assert.equal(typeof field.onSubmitEditing, 'function');
      assert.equal(Object.hasOwn(field, 'inputAccessoryViewID'), false);
    }
    assert.equal(scrollViews[0].keyboardDismissMode, platform === 'android' ? 'on-drag' : undefined);
  }
});

test('welcome does not expose profile setup or a guest continue action to signed-out students', () => {
  resetRequiredAuthUI();
  const markup = renderWelcome();
  assert.doesNotMatch(markup, />Create library</);
  noGuestContinuation(markup);
  assert.match(markup, /Create an account/);
  assert.match(markup, /Already have an account\? Sign in/);
  assert.match(markup, /Birth month \(1–12\)/);
  assert.match(markup, /Birth year/);
  assert.match(markup, /Continue with Apple/);
  assert.match(markup, /Continue with Google/);
  assert.ok(textInputs.some((field) => field.placeholder === 'you@school.edu'));
});

test('installed iOS uses Clerk native Apple ID-token sign-in', async () => {
  const state = resetRequiredAuthUI({ platform: 'ios', isExpoGo: false });
  renderWelcome();
  await press('Already have an account? Sign in');
  renderWelcome();
  await press('Other sign-in options');
  renderWelcome();
  await continueSocial('Continue with Apple');
  assert.equal(state.appleCalls, 1);
  assert.equal(state.ssoCalls, undefined);
  assert.match(renderWelcome(), />Create library</);
});

test('Expo Go on iOS falls back to Apple browser OAuth with the app redirect scheme', async () => {
  const state = resetRequiredAuthUI({ platform: 'ios', isExpoGo: true });
  renderWelcome();
  await press('Already have an account? Sign in');
  renderWelcome();
  await press('Other sign-in options');
  renderWelcome();
  assert.match(renderWelcome(), /Expo Go uses Clerk’s secure browser sign-in instead/);
  await continueSocial('Continue with Apple');
  assert.equal(state.appleCalls, undefined);
  assert.equal(state.ssoCalls[0].strategy, 'oauth_apple');
  assert.equal(state.ssoCalls[0].redirectUrl, 'classscribe-mobile://auth');
  assert.equal(redirectCalls[0].scheme, 'classscribe-mobile');
  assert.match(renderWelcome(), />Create library</);
});

test('Google browser OAuth on iOS retains its existing classscribe-mobile redirect', async () => {
  const state = resetRequiredAuthUI({ platform: 'ios', isExpoGo: false });
  renderWelcome();
  await press('Already have an account? Sign in');
  renderWelcome();
  await press('Other sign-in options');
  renderWelcome();
  await continueSocial('Continue with Google');
  assert.equal(state.ssoCalls[0].strategy, 'oauth_google');
  assert.equal(state.ssoCalls[0].redirectUrl, 'classscribe-mobile://auth');
  assert.equal(redirectCalls[0].scheme, 'classscribe-mobile');
  assert.equal(state.appleCalls, undefined);
  assert.match(renderWelcome(), />Create library</);
});

test('email account creation reaches profile setup only after email verification completes', async () => {
  const state = resetRequiredAuthUI({
    signUpStatusAfterPassword: 'needs_verification',
    signUpStatusAfterVerification: 'complete',
  });
  renderWelcome();
  enter('you@school.edu', 'new.student@example.edu');
  renderWelcome();
  enter('Choose your password', 'student-password');
  renderWelcome();
  await enterBirthMonthYear();
  const signupPassword = textInputs.find((field) => field.placeholder === 'Choose your password');
  assert.equal(signupPassword.autoComplete, 'off');
  assert.equal(signupPassword.textContentType, 'none');
  assert.equal(signupPassword.autoCorrect, false);
  assert.equal(signupPassword.spellCheck, false);
  assert.equal(signupPassword.autoCapitalize, 'none');
  await press('Create account');
  assert.deepEqual(state.signUpPasswordInput, {
    emailAddress: 'new.student@example.edu',
    password: 'student-password',
    unsafeMetadata: { ageBand: '18+' },
  });
  let markup = renderWelcome();
  assert.match(markup, /Check your email/);
  noGuestContinuation(markup);
  const verificationCode = textInputs.find((field) => field.placeholder === 'Verification code');
  assert.equal(verificationCode.textContentType, 'oneTimeCode');
  assert.equal(verificationCode.autoComplete, 'one-time-code');
  enter('Verification code', '123456');
  renderWelcome();
  await press('Verify email');
  markup = renderWelcome();
  assert.match(markup, />Create library</);
});

test('returning email users can switch to sign-in and reach profile setup', async () => {
  const state = resetRequiredAuthUI();
  renderWelcome();
  await press('Already have an account? Sign in');
  renderWelcome();
  const emailForm = renderWelcome();
  assert.match(emailForm, /Sign in with email/);
  assert.match(emailForm, /Forgot password\?/);
  enter('you@school.edu', 'returning.student@example.edu');
  renderWelcome();
  enter('Password', 'existing-password');
  renderWelcome();
  const signinPassword = textInputs.find((field) => field.placeholder === 'Password');
  assert.equal(signinPassword.autoComplete, 'current-password');
  assert.equal(signinPassword.textContentType, 'password');
  await press('Sign in');
  assert.deepEqual(state.signInPasswordInput, { emailAddress: 'returning.student@example.edu', password: 'existing-password' });
  assert.match(renderWelcome(), />Create library</);
});

test('an existing authenticated session can continue to profile setup', async () => {
  resetRequiredAuthUI({ isSignedIn: true });
  assert.match(renderWelcome(), /Continue to profile setup/);
  await press('Continue to profile setup');
  assert.match(renderWelcome(), />Create library</);
});

test('native restart restores a saved account before profile setup, but never grants access to missing or expired sessions', async () => {
  // Exercise the installed Clerk native token cache through an in-memory
  // SecureStore stand-in. A reset below discards all component/Clerk state,
  // while the SecureStore value persists as it would across app processes.
  const layout = readFileSync('app/_layout.js', 'utf8');
  assert.match(layout, /tokenCache=\{Platform\.OS === 'web' \? undefined : tokenCache\}/);
  assert.ok(tokenCache, 'native Clerk token cache must be available');
  const key = 'clerk-session-restart-test';
  const validToken = 'active-session';
  resetRequiredAuthUI();
  renderWelcome();
  await press('Already have an account? Sign in');
  renderWelcome();
  enter('you@school.edu', 'returning.student@example.edu');
  renderWelcome();
  enter('Password', 'existing-password');
  renderWelcome();
  await press('Sign in');
  assert.match(renderWelcome(), />Create library</);
  // Stop here, before saving a profile/library. Clerk caches the active
  // session on native; do not persist any accountReady or component state.
  await tokenCache.saveToken(key, validToken);

  async function restart(sessionIsActive) {
    const state = resetRequiredAuthUI({ loaded: false });
    assert.match(renderWelcome(), /Checking account sign-in/);
    assert.doesNotMatch(renderWelcome(), />Create library</);
    noGuestContinuation(renderWelcome());
    const restored = await tokenCache.getToken(key);
    // Clerk resolves its session with the server after reading SecureStore;
    // a cached token alone is not proof of an active account.
    state.isSignedIn = restored === validToken && sessionIsActive;
    state.loaded = true;
    return renderWelcome();
  }

  try {
    let markup = await restart(true);
    assert.match(markup, /Signed in to your account/);
    assert.match(markup, /Continue to profile setup/);
    assert.doesNotMatch(markup, />Create library</);
    await press('Continue to profile setup');
    assert.match(renderWelcome(), />Create library</);

    markup = await restart(false); // The cached token has expired or been revoked.
    assert.match(markup, /Create an account/);
    noGuestContinuation(markup);
    assert.doesNotMatch(markup, />Create library</);

    await tokenCache.clearToken(key);
    markup = await restart(true); // Nothing to restore.
    assert.match(markup, /Create an account/);
    noGuestContinuation(markup);
    assert.doesNotMatch(markup, />Create library</);
  } finally {
    await tokenCache.clearToken(key);
  }
});

test('incomplete verification and social auth errors stay blocked', async () => {
  resetRequiredAuthUI({
    signUpStatusAfterPassword: 'needs_verification',
    signUpStatusAfterVerification: 'needs_second_factor',
  });
  renderWelcome();
  enter('you@school.edu', 'new.student@example.edu');
  renderWelcome();
  enter('Choose your password', 'student-password');
  renderWelcome();
  await enterBirthMonthYear();
  await press('Create account');
  renderWelcome();
  enter('Verification code', '123456');
  renderWelcome();
  await press('Verify email');
  const incompleteMarkup = renderWelcome();
  assert.doesNotMatch(incompleteMarkup, />Create library</);
  noGuestContinuation(incompleteMarkup);
});

test('Clerk loading and missing configuration do not expose a guest path', () => {
  resetRequiredAuthUI({ loaded: false });
  const loadingMarkup = renderWelcome();
  assert.match(loadingMarkup, /Checking account sign-in/);
  assert.doesNotMatch(loadingMarkup, />Create library</);
  noGuestContinuation(loadingMarkup);

  resetRequiredAuthUI({ key: '' });
  const blockedMarkup = renderWelcome();
  assert.match(blockedMarkup, /Account sign-in is unavailable on this build/);
  assert.doesNotMatch(blockedMarkup, />Create library</);
  noGuestContinuation(blockedMarkup);
});

test('incomplete social authentication stays on the blocked welcome screen', async () => {
  resetRequiredAuthUI({
    startSSOFlow: async () => ({
      createdSessionId: null,
      signIn: { status: 'needs_first_factor' },
      signUp: { status: 'needs_first_factor' },
    }),
  });
  renderWelcome();
  await press('Already have an account? Sign in');
  renderWelcome();
  await press('Other sign-in options');
  renderWelcome();
  await continueSocial('Continue with Google');
  const markup = renderWelcome();
  assert.match(markup, /Additional verification is needed/);
  assert.doesNotMatch(markup, />Create library</);
  noGuestContinuation(markup);
  assert.ok(controls.some((item) => item.authLabel === 'Reset account sign-in'));
});

test('cancelled social sign-in stays on welcome and can be retried', async () => {
  let attempts = 0;
  resetRequiredAuthUI({ isExpoGo: true,
    startSSOFlow: async () => {
      attempts += 1;
      return { createdSessionId: null };
    },
  });
  renderWelcome();
  await press('Already have an account? Sign in');
  renderWelcome();
  await press('Other sign-in options');
  renderWelcome();
  await continueSocial('Continue with Apple');
  let markup = renderWelcome();
  assert.match(markup, /Sign-in was not completed/);
  assert.match(markup, /use email instead/);
  assert.doesNotMatch(markup, />Create library</);
  noGuestContinuation(markup);
  assert.ok(!controls.some((item) => item.authLabel === 'Reset account sign-in'));
  await press('Continue with Apple');
  renderWelcome();
  markup = renderWelcome();
  assert.equal(attempts, 2);
  assert.doesNotMatch(markup, />Create library</);
});

test('social choice shows age fields before any provider request and blocks under-13 users without persisting an age band', async () => {
  const state = resetRequiredAuthUI();
  renderWelcome();
  await press('Already have an account? Sign in');
  renderWelcome();
  await press('Other sign-in options');
  renderWelcome();
  await press('Continue with Google');
  let markup = renderWelcome();
  assert.match(markup, /Age check before social sign-in/);
  assert.ok(textInputs.some((field) => field.placeholder === 'Birth month (1–12)'));
  assert.equal(state.ssoCalls, undefined);
  enter('Birth month (1–12)', '1');
  renderWelcome();
  enter('Birth year', '2015');
  renderWelcome();
  await press('Continue with Google');
  markup = renderWelcome();
  assert.match(markup, /at least 13/);
  assert.equal(state.ssoCalls, undefined);
  assert.equal(asyncStorageEntries.has('cs_privacy_ageband_pending'), false);
});

test('valid social age gate sends only ageBand as account metadata and does not block existing email sign-in on DOB', async () => {
  const state = resetRequiredAuthUI();
  renderWelcome();
  await press('Already have an account? Sign in');
  renderWelcome();
  await press('Other sign-in options');
  renderWelcome();
  await press('Continue with Google');
  renderWelcome();
  await enterBirthMonthYear();
  await press('Continue with Google');
  assert.equal(state.ssoCalls[0].unsafeMetadata.ageBand, '18+');
  assert.deepEqual(Object.keys(state.ssoCalls[0].unsafeMetadata), ['ageBand']);
  assert.equal(asyncStorageEntries.get('cs_privacy_ageband_pending'), '18+');

  const emailState = resetRequiredAuthUI();
  renderWelcome();
  await press('Already have an account? Sign in');
  renderWelcome();
  enter('you@school.edu', 'student@example.edu');
  renderWelcome();
  enter('Password', 'existing-password');
  renderWelcome();
  await press('Sign in');
  assert.deepEqual(emailState.signInPasswordInput, { emailAddress: 'student@example.edu', password: 'existing-password' });
  assert.equal(asyncStorageEntries.has('cs_privacy_ageband_pending'), false);
});

test('password reset is reachable from signup, email sign-in and provider choice and signs in after verification', async () => {
  for (const surface of ['signup', 'signin', 'choose']) {
    const state = resetRequiredAuthUI();
    renderWelcome();
    if (surface !== 'signup') {
      await press('Already have an account? Sign in');
      renderWelcome();
      if (surface === 'choose') {
        await press('Other sign-in options');
        renderWelcome();
      }
    }
    if (surface !== 'choose') {
      enter('you@school.edu', 'student@example.edu');
      renderWelcome();
    }
    await press(surface === 'signup' ? 'Forgot your password? Reset it' : 'Forgot password?');
    assert.match(renderWelcome(), /Reset your password/);
    if (surface === 'choose') {
      enter('you@school.edu', 'student@example.edu');
      renderWelcome();
    } else assert.equal(textInputs.find((field) => field.testID === 'reset-email')?.value, 'student@example.edu');
    await press('Send reset code');
    assert.match(renderWelcome(), /Check your email/);
    assert.equal(state.resetEmail, 'student@example.edu');
    const resetCode = textInputs.find((field) => field.testID === 'reset-code');
    assert.equal(resetCode.keyboardType, 'number-pad');
    assert.equal(resetCode.textContentType, 'oneTimeCode');
    assert.equal(resetCode.autoComplete, 'one-time-code');
    assert.equal(resetCode.returnKeyType, 'done');
    assert.equal(resetCode.blurOnSubmit, true);
    assert.equal(resetCode.inputAccessoryViewID, inputAccessories[0].nativeID);
    enter('Reset code', 'bad');
    renderWelcome();
    await press('Verify reset code');
    assert.match(renderWelcome(), /Incorrect reset code/);
    await press('Send a new code');
    await new Promise((resolve) => setImmediate(resolve));
    renderWelcome();
    assert.equal(state.resetCodesSent, 2);
    enter('Reset code', '123456');
    renderWelcome();
    await press('Verify reset code');
    assert.match(renderWelcome(), /Set a new password/);
    const resetPassword = textInputs.find((field) => field.testID === 'reset-new-password');
    assert.equal(resetPassword.placeholder, 'Choose your password');
    assert.equal(resetPassword.autoComplete, 'off');
    assert.equal(resetPassword.textContentType, 'none');
    assert.equal(resetPassword.autoCorrect, false);
    assert.equal(resetPassword.spellCheck, false);
    assert.equal(resetPassword.autoCapitalize, 'none');
    enter('Choose your password', 'short');
    renderWelcome();
    await press('Save new password');
    assert.deepEqual(state.resetPasswordInput, { password: 'short' });
    assert.match(renderWelcome(), /Password is too weak/);
    enter('Choose your password', 'a-strong-password');
    renderWelcome();
    await press('Save new password');
    assert.deepEqual(state.resetPasswordInput, { password: 'a-strong-password' });
    assert.match(renderWelcome(), />Create library</);
  }
});

test('back to sign in cancels password reset without losing the entered email', async () => {
  resetRequiredAuthUI();
  renderWelcome();
  await press('Forgot your password? Reset it');
  renderWelcome();
  enter('you@school.edu', 'student@example.edu');
  renderWelcome();
  await press('Send reset code');
  renderWelcome();
  await press('Back to sign in');
  assert.match(renderWelcome(), /Sign in with email/);
  assert.equal(textInputs.find((field) => field.placeholder === 'you@school.edu')?.value, 'student@example.edu');
});