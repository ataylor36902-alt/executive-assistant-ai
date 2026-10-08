import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { ClerkProvider } from 'native-clerk-provider';
import { ClerkLoaded, ClerkLoading, ClerkFailed, useClerk } from '@clerk/react';
import Welcome from '../app/welcome';
import { controls, resetRequiredAuthUI } from './fixtures/required-auth-ui';
import { providerOptions, setNativeClient } from './fixtures/native-auth-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const key = `pk_test_${Buffer.from('native-smoke.clerk.accounts.dev$').toString('base64')}`;
const proxyUrl = 'https://release.example.test/__clerk';
let observedStatus;
function ProviderProbe() {
  observedStatus = useClerk().status;
  return <>
    <ClerkLoaded><span>sdk-loaded</span></ClerkLoaded>
    <ClerkLoading><span>sdk-loading</span></ClerkLoading>
    <ClerkFailed><span>sdk-failed</span></ClerkFailed>
  </>;
}

function makeClient(load) {
  const resources = { client: { signIn: {}, signUp: {} }, user: null, session: null, organization: null };
  const signInState = { signIn: resources.client.signIn };
  const signUpState = { signUp: resources.client.signUp };
  return {
    loaded: false, status: 'loading', load,
    ...resources,
    get __internal_lastEmittedResources() { return this.loaded ? resources : undefined; },
    __internal_state: {
      signInSignal: () => signInState,
      signUpSignal: () => signUpState,
      __internal_effect: () => () => {},
    },
    __internal_environment: { userSettings: { socialProviderStrategies: ['oauth_apple', 'oauth_google'] } },
    addListener() { return () => {}; },
    addOnLoaded() {},
    on(event, listener, options) {
      if (event === 'status' && options?.notify) listener(this.status);
      return () => {};
    },
    off() {},
    __unstable__updateProps() {},
  };
}
function screen(renderer) {
  const text = (node) => typeof node === 'string' ? node :
    Array.isArray(node) ? node.map(text).join(' ') : node ? text(node.children) : '';
  return text(renderer.toJSON());
}
function assertBlocked(renderer) {
  assert.doesNotMatch(screen(renderer), /Create library|Continue to profile setup|Continue without|Skip for now/);
  assert.ok(!controls.some((item) => /Create library|Continue to profile setup/.test(item.authLabel)));
}
async function mount(client) {
  resetRequiredAuthUI({ key, platform: 'ios', loaded: false });
  setNativeClient(client);
  let renderer;
  await act(async () => {
    renderer = create(
      <ClerkProvider publishableKey={key} proxyUrl={proxyUrl}>
        <ProviderProbe />
        <Welcome />
      </ClerkProvider>,
    );
  });
  return renderer;
}

test('native Clerk loads: welcome has email and account controls, never signed-out profile setup', async () => {
  const client = makeClient(async () => {
    client.loaded = true;
    client.status = 'ready';
  });
  const renderer = await mount(client);
  try {
    assert.equal(observedStatus, 'ready');
    assert.match(screen(renderer), /sdk-loaded/);
    assert.match(screen(renderer), /Create an account/);
    assert.match(screen(renderer), /Already have an account\? Sign in/);
    assert.ok(controls.some((item) => item.authLabel === 'Create account'));
    assert.ok(renderer.root.findAll((node) => node.type === 'input' && node.props.placeholder === 'you@school.edu').length);
    assertBlocked(renderer);
    assert.equal(providerOptions[0].proxyUrl, proxyUrl, 'absolute proxy reaches the native client');
    await act(async () => {
      controls.find((item) => item.authLabel === 'Already have an account? Sign in').onPress();
    });
    assert.match(screen(renderer), /Sign in with email/);
    assertBlocked(renderer);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('native client load rejection enters the real provider error state and shows an actionable welcome error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const renderer = await mount(makeClient(async () => {
    throw new Error('simulated native initialization failure');
  }));
  try {
    assert.equal(observedStatus, 'error', 'the installed provider must handle the rejected native load');
    assert.match(screen(renderer), /sdk-failed/);
    assert.doesNotMatch(screen(renderer), /sdk-loaded|sdk-loading/);
    await act(async () => t.mock.timers.tick(10000));
    assert.match(screen(renderer), /Account sign-in could not load/);
    assert.match(screen(renderer), /Check your connection and reopen ClassScribe/);
    assert.doesNotMatch(screen(renderer), /simulated native initialization failure/);
    assertBlocked(renderer);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('native stalled load switches from progress to error at 10 seconds and recovers without granting guest access', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveLoad;
  const client = makeClient(() => new Promise((resolve) => { resolveLoad = resolve; }));
  const renderer = await mount(client);
  try {
    assert.equal(observedStatus, 'loading');
    assert.match(screen(renderer), /Checking account sign-in/);
    await act(async () => t.mock.timers.tick(9999));
    assert.match(screen(renderer), /Checking account sign-in/);
    assert.doesNotMatch(screen(renderer), /Account sign-in could not load/);
    assertBlocked(renderer);
    await act(async () => t.mock.timers.tick(1));
    assert.match(screen(renderer), /Account sign-in could not load/);
    assert.doesNotMatch(screen(renderer), /Checking account sign-in/);
    assertBlocked(renderer);
    await act(async () => {
      client.loaded = true;
      client.status = 'ready';
      resolveLoad();
    });
    assert.match(screen(renderer), /Create an account/);
    assert.doesNotMatch(screen(renderer), /Account sign-in could not load/);
    assertBlocked(renderer);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('unmount cancels the native welcome timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clearTimeout = t.mock.method(globalThis, 'clearTimeout');
  const renderer = await mount(makeClient(() => new Promise(() => {})));
  assert.match(screen(renderer), /Checking account sign-in/);
  const callsBeforeUnmount = clearTimeout.mock.callCount();
  await act(async () => renderer.unmount());
  assert.ok(clearTimeout.mock.callCount() > callsBeforeUnmount, 'unmount must clear the pending sign-in timer');
  await act(async () => t.mock.timers.tick(10000));
  assert.equal(renderer.toJSON(), null);
});
