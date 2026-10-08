import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PrivacySettings from '../app/privacy-settings';
import {
  beginRender,
  controls,
  deletionRequests,
  events,
  exportRequests,
  files,
  resetPrivacySettings,
  router,
  runEffects,
  shareCalls,
  statusRequests,
  storageEntries,
  textInputs,
} from './fixtures/privacy-settings-ui';

function render() {
  beginRender();
  return renderToStaticMarkup(<PrivacySettings />);
}

async function renderAndLoad() {
  render();
  await runEffects();
  return render();
}

function action(label) {
  const found = controls.find(control => control.label === label);
  assert.ok(found, `missing privacy-settings action: ${label}; rendered actions: ${controls.map(control => control.label).join(', ')}`);
  return found;
}

async function press(label) {
  const found = action(label);
  assert.notEqual(found.disabled, true, `${label} should be enabled`);
  assert.equal(typeof found.onPress, 'function', `${label} should be pressable`);
  return found.onPress();
}

function enter(placeholder, value) {
  const field = textInputs.find(input => input.placeholder === placeholder);
  assert.ok(field, `missing privacy-settings input: ${placeholder}`);
  field.onChangeText(value);
}

async function openDelete({ value = 'DELETE' } = {}) {
  await press('Delete my library data');
  render();
  enter('Type DELETE', value);
  render();
}

async function confirmEmailFactorDeletion() {
  await openDelete();
  await press('Delete app data');
  render();
  assert.ok(textInputs.some(input => input.placeholder === 'Verification code'));
  enter('Verification code', '123456');
  render();
  await press('Verify and delete');
}

test('private ZIP export shares successfully on iOS and Android and removes its temporary file', async () => {
  for (const platform of ['ios', 'android']) {
    const state = resetPrivacySettings({ platform });
    state.fetchImplementation = async (url, options) => {
      assert.equal(url, 'https://classscribe.invalid/private-export');
      assert.deepEqual(options, { headers: { Accept: 'application/zip' } });
      return { ok: true, arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer };
    };
    await renderAndLoad();
    await press('Export my library (private ZIP)');
    const sheetMarkup = render();
    assert.match(sheetMarkup, /private download link expires after 24 hours/i);
    assert.doesNotMatch(sheetMarkup, /one-time download link/i);
    await press('Create private ZIP');
    const markup = render();
    assert.match(markup, /Private ZIP ready/);
    assert.equal(exportRequests.length, 1);
    assert.equal(shareCalls.length, 1);
    assert.equal(shareCalls[0].options.mimeType, 'application/zip');
    assert.equal(shareCalls[0].options.dialogTitle, 'Save your private ClassScribe export');
    assert.equal(files.length, 1);
    assert.equal(files[0].deleted, true, `${platform} export should delete its temporary ZIP after sharing`);
    assert.equal(files[0].exists, false);
  }
});

test('HTTP and download failures show an actionable error without leaving temporary export files', async () => {
  const cases = [
    ['HTTP rejection', async () => ({
      ok: false,
      json: async () => ({ error: 'Private export link expired' }),
    }), /Private export link expired/],
    ['download rejection', async () => ({
      ok: true,
      arrayBuffer: async () => { throw new Error('Download stream interrupted'); },
    }), /Download stream interrupted/],
  ];
  for (const [name, fetchImplementation, message] of cases) {
    const state = resetPrivacySettings();
    state.fetchImplementation = fetchImplementation;
    await renderAndLoad();
    await press('Export my library (private ZIP)');
    render();
    await press('Create private ZIP');
    const markup = render();
    assert.match(markup, message, name);
    assert.equal(files.length, 0, `${name} must not leave a temporary file`);
    assert.equal(shareCalls.length, 0);
  }

  const state = resetPrivacySettings();
  state.fetchImplementation = async () => ({
    ok: true,
    arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
  });
  state.shareFailure = new Error('System share sheet failed');
  await renderAndLoad();
  await press('Export my library (private ZIP)');
  render();
  await press('Create private ZIP');
  assert.match(render(), /System share sheet failed/);
  assert.equal(files.length, 1);
  assert.equal(files[0].deleted, true, 'a created ZIP is deleted after a downstream export failure');
  assert.equal(files[0].exists, false);
});

test('changing active library while an export ticket is pending blocks download and sharing of the stale export', async () => {
  let resolveExport;
  const state = resetPrivacySettings();
  state.exportGate = new Promise(resolve => { resolveExport = resolve; });
  let downloadCalls = 0;
  state.fetchImplementation = async () => {
    downloadCalls += 1;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  await renderAndLoad();
  await press('Export my library (private ZIP)');
  render();
  const exporting = press('Create private ZIP');
  state.uid = 'u_another_library_123456789';
  resolveExport({ url: '/stale-export', expiresAt: '2030-01-01T00:00:00.000Z' });
  await exporting;
  assert.equal(exportRequests[0].libraryCode, 'u_privacy_test_1234567890');
  assert.equal(downloadCalls, 0);
  assert.equal(shareCalls.length, 0);
  assert.equal(files.length, 0);
});

test('deletion requires exact DELETE and separate active-subscription confirmation before verification or API request', async () => {
  resetPrivacySettings({ status: { activeSubscription: true, manageUrl: 'https://billing.invalid/manage' } });
  await renderAndLoad();
  await openDelete({ value: 'delete' });
  await press('Delete app data');
  assert.equal(deletionRequests.length, 0);
  assert.match(render(), /Type DELETE exactly/);
  enter('Type DELETE', 'DELETE ');
  render();
  await press('Delete app data');
  assert.equal(deletionRequests.length, 0);
  assert.equal(events.some(([name]) => name === 'session.startVerification'), false);
  enter('Type DELETE', 'DELETE');
  render();
  await press('Delete app data');
  assert.equal(deletionRequests.length, 0);
  assert.match(render(), /active subscription must be managed or cancelled/i);
  assert.equal(events.some(([name]) => name === 'session.startVerification'), false);
  const consent = controls.find(control => control.role === 'checkbox');
  assert.ok(consent, 'active-subscription confirmation checkbox should be present');
  consent.onPress();
  render();
  await press('Delete app data');
  assert.equal(deletionRequests.length, 0, 'verification must still precede the deletion API call');
  assert.ok(events.some(([name, level]) => name === 'session.startVerification' && level === 'first_factor'));
  render();
  enter('Verification code', '123456');
  render();
  await press('Verify and delete');
  assert.deepEqual(deletionRequests[0].body, {
    confirmation: 'DELETE',
    confirmActiveSubscription: true,
  });
});

test('a supported first factor is freshly verified before the deletion API receives a skip-cache token', async () => {
  const state = resetPrivacySettings({
    session: {
      startVerification: async ({ level }) => {
        events.push(['session.startVerification', level]);
        return {
          supportedFirstFactors: [
            { strategy: 'totp' },
            { strategy: 'email_code', emailAddressId: 'verified_email' },
            { strategy: 'phone_code', phoneNumberId: 'verified_phone' },
          ],
        };
      },
      attemptFirstFactorVerification: async parameters => {
        events.push(['session.attemptFirstFactorVerification', parameters]);
        return { status: 'complete' };
      },
    },
  });
  await renderAndLoad();
  await confirmEmailFactorDeletion();
  assert.deepEqual(
    events.find(([name]) => name === 'session.prepareFirstFactorVerification'),
    ['session.prepareFirstFactorVerification', { strategy: 'email_code', emailAddressId: 'verified_email' }],
  );
  assert.deepEqual(
    events.find(([name]) => name === 'session.attemptFirstFactorVerification'),
    ['session.attemptFirstFactorVerification', { strategy: 'email_code', code: '123456' }],
  );
  const verifyIndex = events.findIndex(([name]) => name === 'session.attemptFirstFactorVerification');
  const deleteIndex = events.findIndex(([name]) => name === 'privacy.requestPrivacyDeletion');
  assert.ok(verifyIndex >= 0 && deleteIndex > verifyIndex, 'server deletion must follow completed factor verification');
  assert.deepEqual(state.getTokenCalls.at(-1), { skipCache: true });
  assert.deepEqual(deletionRequests, [{
    body: { confirmation: 'DELETE', confirmActiveSubscription: false },
    token: 'fresh-isolated-token',
    libraryCode: 'u_privacy_test_1234567890',
  }]);
  assert.match(render(), /Deletion confirmed/);
});

test('failed factor verification and a nonconfirming deletion response leave phone data untouched', async () => {
  const verification = resetPrivacySettings({
    session: {
      attemptFirstFactorVerification: async () => ({ status: 'needs_first_factor' }),
    },
  });
  storageEntries.set('cs_docs_u_privacy_test_1234567890', 'private-device-record');
  storageEntries.set('cs_cache', 'cache');
  await renderAndLoad();
  await confirmEmailFactorDeletion();
  assert.equal(deletionRequests.length, 0);
  assert.equal(verification.clearedLibraries.length, 0);
  assert.equal(verification.signOutCalls, 0);
  assert.equal(storageEntries.get('cs_docs_u_privacy_test_1234567890'), 'private-device-record');
  assert.equal(storageEntries.get('cs_cache'), 'cache');
  assert.match(render(), /Verification did not complete/);

  const nonconfirmation = resetPrivacySettings({ deletionResult: { deleted: false } });
  storageEntries.set('cs_docs_u_privacy_test_1234567890', 'private-device-record');
  storageEntries.set('cs_profile', 'cached-profile');
  await renderAndLoad();
  await confirmEmailFactorDeletion();
  assert.equal(deletionRequests.length, 1);
  assert.equal(nonconfirmation.clearedLibraries.length, 0);
  assert.equal(nonconfirmation.signOutCalls, 0);
  assert.equal(storageEntries.get('cs_docs_u_privacy_test_1234567890'), 'private-device-record');
  assert.equal(storageEntries.get('cs_profile'), 'cached-profile');
  assert.match(render(), /server did not confirm deletion/i);
});

test('confirmed deletion clears only scoped phone data, clears image cache, signs out, and navigates to welcome', async () => {
  const state = resetPrivacySettings();
  const libraryCode = 'u_privacy_test_1234567890';
  storageEntries.set(`cs_documents_${libraryCode}`, 'documents');
  storageEntries.set(`cs_recordings_${libraryCode}`, 'recordings');
  storageEntries.set(`cs_profile_${libraryCode}`, 'scoped-profile');
  storageEntries.set('cs_cache', 'cache');
  storageEntries.set('cs_profile', 'profile');
  storageEntries.set('cs_profile_pending', 'pending');
  storageEntries.set('cs_documents_u_other_library_123456', 'other-library');
  await renderAndLoad();
  await confirmEmailFactorDeletion();
  assert.match(render(), /Deletion confirmed/);
  assert.equal(storageEntries.has(`cs_documents_${libraryCode}`), true, 'local data waits for explicit cleanup confirmation');
  await press('Clear phone data and sign out');
  assert.deepEqual(state.clearedLibraries, [libraryCode]);
  assert.equal(state.imageCacheClears, 1);
  assert.equal(state.signOutCalls, 1);
  assert.equal(router.path, '/welcome');
  for (const key of [
    `cs_documents_${libraryCode}`,
    `cs_recordings_${libraryCode}`,
    `cs_profile_${libraryCode}`,
    'cs_cache',
    'cs_profile',
    'cs_profile_pending',
  ]) assert.equal(storageEntries.has(key), false, `${key} should be removed after confirmed deletion`);
  assert.equal(storageEntries.get('cs_documents_u_other_library_123456'), 'other-library');
  assert.ok(events.some(([name, path]) => name === 'router.replace' && path === '/welcome'));
});

test('signed-out unlinked legacy deletion uses only the anonymous library-code confirmation path', async () => {
  const state = resetPrivacySettings({ isSignedIn: false });
  const libraryCode = 'u_privacy_test_1234567890';
  storageEntries.set(`cs_legacy_${libraryCode}`, 'legacy-phone-data');
  await renderAndLoad();
  assert.equal(statusRequests.length, 0, 'legacy deletion must not request linked-account privacy status');
  await press('Delete unlinked legacy library');
  render();
  enter('Type DELETE', 'DELETE');
  render();
  await press('Delete app data');
  assert.deepEqual(deletionRequests, [{
    body: { confirmation: 'DELETE', confirmActiveSubscription: false },
    token: null,
    libraryCode,
  }]);
  assert.equal(events.some(([name]) => name === 'session.startVerification'), false);
  assert.match(render(), /Deletion confirmed/);
  assert.equal(storageEntries.has(`cs_legacy_${libraryCode}`), true, 'legacy phone data waits for explicit cleanup');
  await press('Clear phone data and sign out');
  assert.equal(state.clearedLibraries[0], libraryCode);
  assert.equal(state.signOutCalls, 1);
  assert.equal(router.path, '/welcome');
  assert.equal(storageEntries.has(`cs_legacy_${libraryCode}`), false);
});