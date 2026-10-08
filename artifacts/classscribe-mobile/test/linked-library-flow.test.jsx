import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Welcome from '../app/welcome';
import AccountSignIn from '../app/account-sign-in';
import RecoverLibrary from '../app/recover-library';
import { beginRender, codes, controls, current, link, mountScreen, openDevice, requests, reset, router, runEffects, storage, Alert } from './fixtures/linked-library-ui';

function render(Screen) {
  beginRender();
  return renderToStaticMarkup(<Screen />);
}
async function press(label) {
  const action = controls.find(control => control.label === label);
  assert.ok(action, `Missing action ${label}`);
  assert.notEqual(action.disabled, true);
  await action.press();
}
async function continueAndSettle(Screen, label) {
  render(Screen);
  await press(label);
  render(Screen);
  await runEffects();
  return render(Screen);
}

function delayNextLookup() {
  const fetch = global.fetch;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  global.fetch = async (...args) => {
    const response = await fetch(...args);
    if (args[1].method === 'GET') await gate;
    return response;
  };
  return release;
}

const sessionChanges = {
  'another account': device => { device.account = 'other-account'; },
  'sign-out': device => { device.account = null; },
  'a new session for the same account': device => { device.sessionId = 'replacement-session'; },
};

for (const [change, changeSession] of Object.entries(sessionChanges)) {
  test(`recovery ignores the previous account's delayed library after ${change}`, async () => {
    reset();
    link('test-account', codes.first);
    const device = openDevice('second');
    const originalCode = device.code;
    const originalProfile = device.profile;
    const release = delayNextLookup();
    await continueAndSettle(RecoverLibrary, 'Open my linked library');
    assert.equal(requests.length, 1, 'the lookup must be in flight before the account changes');
    changeSession(device);
    render(RecoverLibrary);
    await runEffects();
    release();
    await runEffects();
    const page = render(RecoverLibrary);
    assert.match(page, /signed-in account changed/);
    assert.equal(device.code, originalCode);
    assert.deepEqual(device.profile, originalProfile);
    assert.deepEqual(device.switchCalls, []);
    assert.notEqual(router.path, '/home');
  });

  test(`Account ignores a delayed lookup after ${change} without linking or offering the old library`, async () => {
    // Cover both an existing link and the branch that would create a new link.
    for (const existingLink of [true, false]) {
      reset();
      if (existingLink) link('test-account', codes.different);
      const device = current();
      device.profile = { firstName: 'Ada' };
      const originalProfile = { ...device.profile };
      const release = delayNextLookup();
      await continueAndSettle(AccountSignIn, 'Link sign-in to this library');
      assert.equal(requests.length, 1);
      changeSession(device);
      render(AccountSignIn);
      await runEffects();
      release();
      await runEffects();
      const page = render(AccountSignIn);
      assert.match(page, /signed-in account changed/);
      assert.equal(controls.some(action => action.label === 'Open linked library'), false);
      assert.equal(device.code, codes.first);
      assert.deepEqual(device.profile, originalProfile);
      assert.deepEqual(device.switchCalls, []);
      assert.deepEqual(requests.map(request => request.method), ['GET']);
      assert.equal(router.path, '/welcome');
    }
  });

  test(`confirmed Account switching ignores a delayed response after ${change}`, async () => {
    reset();
    link('test-account', codes.different);
    const device = current();
    device.profile = { firstName: 'Ada' };
    const originalProfile = { ...device.profile };
    await continueAndSettle(AccountSignIn, 'Link sign-in to this library');
    const release = delayNextLookup();
    await press('Open linked library');
    const switching = Alert.last.actions.find(action => action.text === 'Open linked library').onPress();
    await runEffects();
    assert.equal(requests.length, 2);
    changeSession(device);
    render(AccountSignIn);
    await runEffects();
    release();
    await switching;
    assert.match(render(AccountSignIn), /signed-in account changed/);
    assert.equal(device.code, codes.first);
    assert.deepEqual(device.profile, originalProfile);
    assert.deepEqual(device.switchCalls, []);
    assert.equal(router.path, '/welcome');
  });
}

test('Account confirmation remains bound to the account that offered the library', async () => {
  reset();
  link('test-account', codes.different);
  const device = current();
  device.profile = { firstName: 'Ada' };
  await continueAndSettle(AccountSignIn, 'Link sign-in to this library');
  await press('Open linked library');
  device.account = 'other-account';
  render(AccountSignIn);
  await runEffects();
  await Alert.last.actions.find(action => action.text === 'Open linked library').onPress();
  assert.match(render(AccountSignIn), /signed-in account changed/);
  assert.equal(requests.length, 1, 'an old confirmation must not query the new account');
  assert.equal(device.code, codes.first);
  assert.deepEqual(device.profile, { firstName: 'Ada' });
  assert.deepEqual(device.switchCalls, []);
});

for (const [change, changeSession] of Object.entries(sessionChanges)) {
  for (const stage of ['switchGate', 'uidSaveGate', 'profileLoadGate']) {
    for (const Screen of [RecoverLibrary, AccountSignIn]) {
      test(`${Screen.name} cancels the real store switch during ${stage} after ${change}`, async () => {
        reset();
        link('test-account', codes.different);
        const device = Screen === RecoverLibrary ? openDevice('second') : current();
        if (Screen === AccountSignIn) device.profile = { firstName: 'Ada' };
        const initialCode = device.code;
        const initialProfile = device.profile;
        let release;
        device[stage] = new Promise(resolve => { release = resolve; });
        let switching;
        if (Screen === RecoverLibrary) {
          await continueAndSettle(Screen, 'Open my linked library');
        } else {
          await continueAndSettle(Screen, 'Link sign-in to this library');
          await press('Open linked library');
          switching = Alert.last.actions.find(action => action.text === 'Open linked library').onPress();
          await runEffects();
        }
        assert.deepEqual(device.switchCalls, [codes.different], 'the real store switch must have started');
        changeSession(device);
        render(Screen);
        await runEffects();
        release();
        if (switching) await switching;
        await runEffects();
        assert.match(render(Screen), /signed-in account changed/);
        assert.equal(device.code, initialCode, 'the UID must remain unchanged or be rolled back');
        assert.deepEqual(device.profile, initialProfile);
        assert.equal(device.profileChanges.some(profile => profile?.firstName === 'Grace'), false,
          'the old account destination profile must never be displayed');
        assert.notEqual(router.path, '/home');
      });
    }
  }
}

test('Account rechecks the session after waiting for pending code replacement storage', async () => {
  reset();
  link('test-account', codes.different);
  const device = current();
  device.profile = { firstName: 'Ada' };
  await continueAndSettle(AccountSignIn, 'Link sign-in to this library');
  let release;
  let storageRead = false;
  const originalGetItem = storage.getItem;
  storage.getItem = () => {
    storageRead = true;
    return new Promise(resolve => { release = resolve; });
  };
  try {
    await press('Open linked library');
    const switching = Alert.last.actions.find(action => action.text === 'Open linked library').onPress();
    await runEffects();
    assert.equal(storageRead, true);
    device.account = 'other-account';
    render(AccountSignIn);
    await runEffects();
    release(null);
    await switching;
    assert.match(render(AccountSignIn), /signed-in account changed/);
    assert.equal(device.code, codes.first);
    assert.deepEqual(device.profile, { firstName: 'Ada' });
    assert.deepEqual(device.switchCalls, []);
  } finally {
    storage.getItem = originalGetItem;
  }
});

test('returning to the original account does not revive an old recovery response, but a retry works', async () => {
  reset();
  link('test-account', codes.first);
  const device = openDevice('second');
  const originalCode = device.code;
  const release = delayNextLookup();
  await continueAndSettle(RecoverLibrary, 'Open my linked library');
  device.account = 'other-account';
  render(RecoverLibrary);
  await runEffects();
  device.account = 'test-account';
  render(RecoverLibrary);
  await runEffects();
  release();
  await runEffects();
  assert.match(render(RecoverLibrary), /signed-in account changed/);
  assert.equal(device.code, originalCode);
  assert.equal(device.profile, null);
  assert.deepEqual(device.switchCalls, []);
  await continueAndSettle(RecoverLibrary, 'Open my linked library');
  assert.equal(device.code, codes.first);
  assert.equal(device.profile.firstName, 'Ada');
  assert.equal(router.path, '/home');
});

test('a new named library is linked optionally, then recovered on a second device without entering a sync code', async () => {
  reset();
  render(Welcome);
  await press('Continue to profile setup');
  render(Welcome);
  await press('Set name');
  render(Welcome);
  await press('Agree to recording rules');
  render(Welcome);
  await press('Create library');
  assert.equal(current().profile.firstName, 'Ada');
  assert.equal(router.path, '/plans');
  const originalCode = current().code;
  const originalProfile = current().profile;

  mountScreen();
  await continueAndSettle(AccountSignIn, 'Link sign-in to this library');
  assert.equal(router.path, '/account');
  assert.deepEqual(requests.map(r => r.method), ['GET', 'POST']);
  assert.deepEqual(JSON.parse(requests[1].body), { code: originalCode });

  const second = openDevice('second');
  assert.equal(second.profile, null);
  const page = await continueAndSettle(RecoverLibrary, 'Open my linked library');
  assert.doesNotMatch(page, /could not load|No library is linked/);
  assert.equal(router.path, '/home');
  assert.equal(second.code, originalCode);
  assert.deepEqual(second.profile, originalProfile);
  assert.deepEqual(second.switchCalls, [originalCode]);
  assert.deepEqual(requests.map(r => r.method), ['GET', 'POST', 'GET']);
  assert.equal(requests[2].body, undefined, 'recovery must not send or require a typed sync code');
});

test('creating a library without the switch offers explicit recording agreement and never treats OK as consent', async () => {
  reset();
  render(Welcome);
  await press('Continue to profile setup');
  render(Welcome);
  await press('Set name');
  render(Welcome);
  await press('Create library');
  assert.equal(Alert.last.title, 'Recording permission');
  assert.equal(current().profile, null);
  assert.equal(router.path, '/welcome');
  assert.ok(Alert.last.actions.some(action => action.text === 'Not now'));
  const agree = Alert.last.actions.find(action => action.text === 'I agree — create library');
  assert.ok(agree);
  await agree.onPress();
  assert.equal(current().profile.firstName, 'Ada');
  assert.equal(router.path, '/plans');
});

test('only the chosen library action spins while saving, and a failed save can be retried', async () => {
  reset();
  render(Welcome);
  await press('Continue to profile setup');
  render(Welcome);
  await press('Set name');
  render(Welcome);
  await press('Agree to recording rules');
  render(Welcome);
  let rejectSave;
  current().profileSaveGate = new Promise((_, reject) => { rejectSave = reject; });
  const saving = controls.find(action => action.label === 'Create library').press();
  render(Welcome);
  assert.equal(controls.find(action => action.label === 'Create library').busy, true);
  for (const label of ['Use my existing library', 'Sign in to reopen my library']) {
    const action = controls.find(item => item.label === label);
    assert.equal(action.busy, false, `${label} should not show a spinner`);
    assert.equal(action.disabled, true, `${label} should not start a second action`);
  }
  rejectSave(new Error('Network timed out'));
  await saving;
  render(Welcome);
  assert.equal(Alert.last.title, 'Could not create library');
  assert.equal(router.path, '/welcome');
  assert.equal(controls.find(action => action.label === 'Create library').busy, false);
  assert.equal(controls.find(action => action.label === 'Create library').disabled, false);
  current().profileSaveGate = null;
  await press('Create library');
  assert.equal(router.path, '/plans');
});

test('a different linked library requires explicit confirmation and does not relink this device', async () => {
  reset();
  link('test-account', codes.different);
  const first = current();
  first.profile = { firstName: 'Ada' };
  const message = await continueAndSettle(AccountSignIn, 'Link sign-in to this library');
  assert.match(message, /different library is linked/);
  assert.equal(first.code, codes.first);
  assert.equal(first.profile.firstName, 'Ada');
  assert.deepEqual(first.switchCalls, []);
  assert.deepEqual(requests.map(r => r.method), ['GET']);
  await press('Open linked library');
  assert.equal(first.code, codes.first);
  assert.equal(Alert.last.title, 'Switch libraries?');
  await Alert.last.actions.find(action => action.text === 'Open linked library').onPress();
  assert.equal(first.code, codes.different);
  assert.equal(first.profile.firstName, 'Grace');
  assert.equal(router.path, '/home');
});

test('failed switching and pending code replacement preserve the active library', async () => {
  for (const failure of ['switch', 'rotation']) {
    reset();
    link('test-account', codes.different);
    const first = current();
    first.profile = { firstName: 'Ada' };
    if (failure === 'switch') first.failSwitch = true;
    else await storage.setItem('cs_rotation', JSON.stringify({ oldCode: codes.first }));
    await continueAndSettle(AccountSignIn, 'Link sign-in to this library');
    await press('Open linked library');
    await Alert.last.actions.find(action => action.text === 'Open linked library').onPress();
    const page = render(AccountSignIn);
    assert.match(page, failure === 'switch' ? /Could not open the linked library/ : /Finish your pending sync-code replacement/);
    assert.equal(first.code, codes.first);
    assert.equal(first.profile.firstName, 'Ada');
    assert.equal(router.path, '/welcome');
    assert.deepEqual(first.switchCalls, failure === 'switch' ? [codes.different] : []);
    assert.equal(requests.some(r => r.method === 'POST'), false);
  }
});

test('recovery failure on a fresh second device leaves its local identity untouched', async () => {
  reset();
  link('test-account', codes.first);
  const second = openDevice('second');
  second.failSwitch = true;
  const initialCode = second.code;
  const page = await continueAndSettle(RecoverLibrary, 'Open my linked library');
  assert.match(page, /linked library could not load/);
  assert.equal(second.code, initialCode);
  assert.equal(second.profile, null);
  assert.notEqual(router.path, '/home');
});

test('sign-in without a linked library does not replace the fresh device library', async () => {
  reset();
  const second = openDevice('second');
  const initialCode = second.code;
  const page = await continueAndSettle(RecoverLibrary, 'Open my linked library');
  assert.match(page, /No library is linked to this sign-in yet/);
  assert.deepEqual(second.switchCalls, []);
  assert.equal(second.code, initialCode);
  assert.equal(second.profile, null);
});