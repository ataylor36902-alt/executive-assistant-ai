import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../lib/ai-consent.js', import.meta.url), 'utf8')
  .replace(/^import .+\n/gm, '').replace(/\bexport /g, '');
function setup({ accepted = false, saved = true, choose = async () => true } = {}) {
  let library = 'first-library';
  const requests = [];
  let prompts = 0;
  const context = vm.createContext({
    getUid: () => library, getServer: () => 'https://example.test',
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ method: options.method, body: options.body && JSON.parse(options.body) });
      return { ok: true, json: async () => ({ title: 'AI permission', notice: 'Processors and data', version: 'current', accepted: options.method === 'POST' ? saved : accepted }) };
    },
  });
  const api = vm.runInContext(`${source};({ensureAiConsent, installAiConsentPrompt})`, context);
  api.installAiConsentPrompt(async notice => { prompts++; return choose(notice); });
  return { ...api, requests, prompts: () => prompts, switchLibrary: () => { library = 'second-library'; } };
}
test('declining never sends a grant or processing request', async () => {
  const api = setup({ choose: async () => false });
  await assert.rejects(api.ensureAiConsent(), /declined/);
  assert.deepEqual(api.requests.map(r => r.method), ['GET']);
});
test('permission is usable only after server acknowledgement', async () => {
  const api = setup();
  await api.ensureAiConsent();
  assert.deepEqual(api.requests.map(r => r.method), ['GET', 'POST']);
  assert.deepEqual(api.requests[1].body, { version: 'current', accepted: true });
});
test('failed acknowledgement does not permit processing', async () => {
  const api = setup({ saved: false });
  await assert.rejects(api.ensureAiConsent(), /did not confirm/);
});
test('a confirmed existing permission does not prompt again', async () => {
  const api = setup({ accepted: true });
  await api.ensureAiConsent();
  assert.equal(api.prompts(), 0);
});
test('switching libraries while reviewing cannot grant the new library permission', async () => {
  let api;
  api = setup({ choose: async () => { api.switchLibrary(); return true; } });
  await assert.rejects(api.ensureAiConsent(), /library or server changed/);
  assert.deepEqual(api.requests.map(r => r.method), ['GET']);
});
test('simultaneous requests share one decision, not multiple dialogs', async () => {
  const api = setup();
  await Promise.all([api.ensureAiConsent(), api.ensureAiConsent()]);
  assert.equal(api.prompts(), 1);
  assert.deepEqual(api.requests.map(r => r.method), ['GET', 'POST']);
});
