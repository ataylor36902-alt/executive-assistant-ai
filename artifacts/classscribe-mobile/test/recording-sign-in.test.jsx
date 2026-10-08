import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AccountSignIn from '../app/account-sign-in';
import { beginRender, codes, controls, current, link, requests, reset, router, runEffects } from './fixtures/linked-library-ui';

function render() {
  beginRender();
  return renderToStaticMarkup(<AccountSignIn />);
}
async function continueAndSettle() {
  render();
  const button = controls.find(control => control.label === 'Return to recording');
  assert.ok(button);
  await button.press();
  render();
  await runEffects();
  return render();
}

test('recovery returns to Record without linking or switching libraries', async () => {
  reset();
  current().params = { recordingRecovery: '1' };
  link(current().account, codes.first);
  await continueAndSettle();
  assert.equal(router.path, '/record');
  assert.deepEqual(current().switchCalls, []);
  assert.ok(requests.every(request => request.method === 'GET'));
});

test('recovery cannot claim an unlinked library or open a different account library', async () => {
  for (const different of [false, true]) {
    reset();
    current().params = { recordingRecovery: '1' };
    if (different) link(current().account, codes.different);
    const markup = await continueAndSettle();
    assert.match(markup, different ? /linked to a different library/i : /not linked to the selected library/i);
    assert.equal(current().code, codes.first);
    assert.deepEqual(current().switchCalls, []);
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.notEqual(router.path, '/record');
  }
});

test('a library switch during recovery cannot return to the old recording', async () => {
  reset();
  current().params = { recordingRecovery: '1' };
  link(current().account, codes.first);
  render();
  await controls.find(control => control.label === 'Return to recording').press();
  render();
  const originalFetch = global.fetch;
  let resolveRequest;
  global.fetch = async (...args) => {
    const response = await originalFetch(...args);
    return new Promise(resolve => { resolveRequest = () => resolve(response); });
  };
  try {
    await runEffects();
    current().code = codes.different;
    resolveRequest();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(render(), /library changed during sign-in/i);
    assert.notEqual(router.path, '/record');
    assert.deepEqual(current().switchCalls, []);
  } finally { global.fetch = originalFetch; }
});
