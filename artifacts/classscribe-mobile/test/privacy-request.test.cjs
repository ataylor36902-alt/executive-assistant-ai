const assert = require('node:assert/strict');
const test = require('node:test');
const privacy = require('../.privacy-client-test.cjs');
const native = require('./fixtures/privacy-request-stubs.cjs');

const libraryCode = 'u_request_test_1234567890';
const ownerToken = async () => 'owner-session-token';
const jsonResponse = (body, ok = true) => ({ ok, json: async () => body });
const consentRecord = {
  sessionId: 'recording_session_123', lectureId: 'recording_session_123', courseId: 'course_123',
  version: 'test', statements: ['Permission', 'Privacy'], platform: 'ios', appVersion: 'test', accommodation: false,
};
const consentResponse = { saved: true, consentId: '12345678-1234-1234-1234-123456789012' };

test('recording consent obtains a fresh account session rather than a cached token', async () => {
  const state = native.resetPrivacyRequestHarness();
  state.fetchHandler = async () => jsonResponse(consentResponse);
  const optionsSeen = [];
  await privacy.savePrivacyConsent(consentRecord, async options => {
    optionsSeen.push(options);
    return options?.skipCache ? 'fresh-session-token' : 'stale-session-token';
  }, libraryCode, { signedIn: true });
  assert.deepEqual(optionsSeen, [{ skipCache: true }]);
  assert.equal(state.fetchCalls[0].options.headers.Authorization, 'Bearer fresh-session-token');
});

test('a signed-in account with no refreshed token never submits as an anonymous library', async () => {
  const state = native.resetPrivacyRequestHarness();
  await assert.rejects(privacy.savePrivacyConsent(consentRecord, async () => null, libraryCode, { signedIn: true }), error => {
    assert.equal(error.code, 'auth_session_failed');
    assert.match(error.message, /You are signed in/);
    assert.match(error.message, /Recording has not started/);
    return true;
  });
  assert.equal(state.fetchCalls.length, 0);
  assert.equal(state.storage.size, 0);
});

test('a rejected signed-in session is distinguished from signing out and is not downgraded', async () => {
  const state = native.resetPrivacyRequestHarness();
  state.fetchHandler = async () => ({ status: 401, ...jsonResponse({ code: 'unauthorized' }, false) });
  await assert.rejects(privacy.savePrivacyConsent(consentRecord, ownerToken, libraryCode, { signedIn: true }), error => {
    assert.equal(error.code, 'auth_required');
    assert.match(error.message, /You are signed in, but the ClassScribe server did not accept/);
    return true;
  });
  assert.equal(state.fetchCalls.length, 1);
  assert.equal(state.storage.size, 0);
});

test('overlapping background consent flushes share one request and preserve failed records with a retry delay', async () => {
  const code = 'u_flush_test_1234567890';
  const state = native.resetPrivacyRequestHarness({ uid: code });
  await privacy.queuePrivacyConsent(code, consentRecord);
  const queueBefore = new Map(state.storage);
  let releaseResponse;
  state.fetchHandler = async () => new Promise(resolve => { releaseResponse = resolve; });
  const first = privacy.flushPrivacyConsents(code, ownerToken);
  const second = privacy.flushPrivacyConsents(code, ownerToken);
  assert.equal(first, second);
  const failed = assert.rejects(first, error => error.code === 'library_mismatch');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.fetchCalls.length, 1);
  releaseResponse({ status: 403, ...jsonResponse({ error: 'Not authorized' }, false) });
  await failed;
  assert.deepEqual(state.storage, queueBefore, 'the original consent is retained without any receipt');
  await assert.rejects(privacy.flushPrivacyConsents(code, ownerToken), error => error.code === 'library_mismatch');
  assert.equal(state.fetchCalls.length, 1, 'automatic retries must not flood a rejected library');

  state.fetchHandler = async () => jsonResponse(consentResponse);
  const explicitRetry = await privacy.savePrivacyConsent(consentRecord, ownerToken, code, { signedIn: true });
  assert.equal(explicitRetry.consentId, consentResponse.consentId);
  assert.equal(state.fetchCalls.length, 2, 'a deliberate recording retry is not blocked by background cooldown');
});

test('recording consent uses the server-validated legacy bearer when no account session exists', async () => {
  const state = native.resetPrivacyRequestHarness();
  state.fetchHandler = async () => jsonResponse(consentResponse);
  const receipt = await privacy.savePrivacyConsent(consentRecord, async () => null, libraryCode);
  assert.equal(receipt.consentId, consentResponse.consentId);
  assert.equal(receipt.sessionId, consentRecord.sessionId);
  assert.equal(state.fetchCalls[0].options.headers.Authorization, `Bearer ${libraryCode}`);
  assert.equal(state.fetchCalls[0].options.headers['X-CS-User'], libraryCode);
  assert.deepEqual(JSON.parse(state.fetchCalls[0].options.body), consentRecord);
  assert.ok(await privacy.getPrivacyConsentReceipt(libraryCode, consentRecord.lectureId, consentRecord.courseId));
});

test('signed-in consent uses the account token; rejected owners never downgrade to legacy bearer', async () => {
  const state = native.resetPrivacyRequestHarness();
  state.fetchHandler = async () => ({ status: 403, ...jsonResponse({ code: 'privacy_library_unavailable' }, false) });
  await assert.rejects(privacy.savePrivacyConsent(consentRecord, ownerToken, libraryCode), error => {
    assert.equal(error.code, 'library_mismatch');
    return true;
  });
  assert.equal(state.fetchCalls.length, 1);
  assert.equal(state.fetchCalls[0].options.headers.Authorization, 'Bearer owner-session-token');
  assert.equal(state.storage.size, 0);
});

test('linked legacy and expired-session rejection provide sign-in recovery and save no receipt', async () => {
  for (const [status, tokenGetter] of [[403, async () => null], [401, ownerToken]]) {
    const state = native.resetPrivacyRequestHarness();
    state.fetchHandler = async () => ({ status, ...jsonResponse({ code: 'privacy_library_unavailable' }, false) });
    await assert.rejects(privacy.savePrivacyConsent(consentRecord, tokenGetter, libraryCode), error => {
      assert.equal(error.code, 'auth_required');
      assert.match(error.message, /Recording has not started/);
      return true;
    });
    assert.equal(state.storage.size, 0);
    state.fetchHandler = async () => jsonResponse(consentResponse);
    const retry = await privacy.savePrivacyConsent(consentRecord, ownerToken, libraryCode);
    assert.equal(retry.sessionId, consentRecord.sessionId);
    assert.equal(state.fetchCalls[1].options.headers.Authorization, 'Bearer owner-session-token');
  }
});

test('a token refresh failure does not downgrade to a sync-code bearer', async () => {
  const state = native.resetPrivacyRequestHarness();
  await assert.rejects(privacy.savePrivacyConsent(consentRecord, async () => { throw new Error('expired'); }, libraryCode),
    error => error.code === 'auth_session_failed');
  assert.equal(state.fetchCalls.length, 0);
  assert.equal(state.storage.size, 0);
});

test('offline private export and deletion errors do not claim data was queued, saved, deleted, or cleared', async () => {
  const state = native.resetPrivacyRequestHarness();
  state.fetchFailure = new Error('network is offline');
  for (const [label, request] of [
    ['export', () => privacy.requestPrivacyExport(ownerToken, libraryCode)],
    ['deletion', () => privacy.requestPrivacyDeletion({ confirmation: 'DELETE' }, ownerToken, libraryCode)],
  ]) {
    await assert.rejects(request, error => {
      assert.equal(error.code, 'offline', `${label} should preserve the offline error code`);
      assert.match(error.message, /not been confirmed/i);
      assert.doesNotMatch(error.message, /queued|saved|deleted|cleared/i);
      return true;
    });
  }
  assert.equal(state.fetchCalls.length, 2);
  assert.equal(state.storage.size, 0);
});

test('owner token is used for status and export and age updates send only the ageBand field', async () => {
  const state = native.resetPrivacyRequestHarness();
  state.fetchHandler = async url => {
    if (url.endsWith('/status')) return jsonResponse({ ageBand: '18+' });
    if (url.endsWith('/export')) return jsonResponse({ url: '/private.zip', expiresAt: '2030-01-01T00:00:00.000Z' });
    if (url.endsWith('/age')) return jsonResponse({ ageBand: '13-17' });
    throw new Error(`Unexpected isolated endpoint: ${url}`);
  };
  assert.deepEqual(await privacy.getPrivacyStatus(ownerToken, libraryCode), { ageBand: '18+' });
  assert.deepEqual(await privacy.requestPrivacyExport(ownerToken, libraryCode), {
    url: '/private.zip',
    expiresAt: '2030-01-01T00:00:00.000Z',
  });
  assert.deepEqual(await privacy.savePrivacyAge('13-17', ownerToken, libraryCode), { ageBand: '13-17' });
  assert.deepEqual(state.fetchCalls.map(call => [call.url, call.options.method]), [
    ['https://privacy.invalid/api/privacy/status', 'GET'],
    ['https://privacy.invalid/api/privacy/export', 'POST'],
    ['https://privacy.invalid/api/privacy/age', 'POST'],
  ]);
  for (const call of state.fetchCalls) {
    assert.equal(call.options.headers.Authorization, 'Bearer owner-session-token');
    assert.equal(call.options.headers['X-CS-User'], libraryCode);
  }
  assert.equal(state.fetchCalls[0].options.body, undefined);
  assert.deepEqual(JSON.parse(state.fetchCalls[1].options.body), {});
  assert.deepEqual(JSON.parse(state.fetchCalls[2].options.body), { ageBand: '13-17' });
});

test('unlinked legacy deletion uses the private sync code as its anonymous bearer credential', async () => {
  const state = native.resetPrivacyRequestHarness();
  state.fetchHandler = async () => jsonResponse({ deleted: true });
  const result = await privacy.requestPrivacyDeletion(
    { confirmation: 'DELETE', confirmActiveSubscription: false },
    async () => null,
    libraryCode,
  );
  assert.deepEqual(result, { deleted: true });
  assert.equal(state.fetchCalls.length, 1);
  const [{ url, options }] = state.fetchCalls;
  assert.equal(url, 'https://privacy.invalid/api/privacy/delete');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, `Bearer ${libraryCode}`);
  assert.equal(options.headers['X-CS-User'], libraryCode);
  assert.deepEqual(JSON.parse(options.body), { confirmation: 'DELETE', confirmActiveSubscription: false });
});

test('privacy requests reject a stale library before fetch and reject a library switch during the request', async () => {
  const state = native.resetPrivacyRequestHarness();
  state.uid = 'u_different_library_123456789';
  await assert.rejects(
    privacy.getPrivacyStatus(ownerToken, libraryCode),
    /active library changed/i,
  );
  assert.equal(state.fetchCalls.length, 0, 'a stale library code must be blocked before any request');

  native.resetPrivacyRequestHarness();
  let releaseResponse;
  let requestStarted;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  const inFlight = globalThis.__privacyRequestHarness;
  inFlight.fetchHandler = async () => {
    requestStarted();
    return responseGate;
  };
  const pending = privacy.requestPrivacyExport(ownerToken, libraryCode);
  await started;
  inFlight.uid = 'u_switched_during_request_123456';
  releaseResponse(jsonResponse({ url: '/private.zip', expiresAt: '2030-01-01T00:00:00.000Z' }));
  await assert.rejects(pending, /active library changed while this request was running/i);
});

test('a library switch while owner-token resolution is pending blocks the request before fetch', async () => {
  const state = native.resetPrivacyRequestHarness();
  let resolveToken;
  const tokenGate = new Promise(resolve => { resolveToken = resolve; });
  const pending = privacy.requestPrivacyExport(() => tokenGate, libraryCode);
  state.uid = 'u_switched_while_token_pending_123456';
  resolveToken('owner-session-token');
  await assert.rejects(pending, /active library changed/i);
  assert.equal(state.fetchCalls.length, 0, 'the stale owner request must not reach fetch');
});