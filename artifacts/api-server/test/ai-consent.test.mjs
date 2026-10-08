import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/routes/ai-consent.ts', import.meta.url), 'utf8');
const policy = fs.readFileSync(new URL('../src/lib/ai-consent.ts', import.meta.url), 'utf8');
const pattern = vm.runInNewContext(policy.match(/export const aiProcessingPath = (.+);/)[1]);
const gateCode = source.slice(source.indexOf('export const aiConsentGate:'), source.indexOf('\nexport default router'))
  .replace('export const aiConsentGate: RequestHandler', 'const handler')
  .replace(/\(error as \{ status\?: number \}\)/g, 'error');

async function run({ path = '/ai/ask', method = 'POST', accepted = false, failure } = {}) {
  let verified = 0;
  let providerCalls = 0;
  let status;
  let result;
  const handler = vm.runInNewContext(`${gateCode};handler`, {
    aiProcessingPath: pattern, db: {},
    resolveWriteLibrary: async () => ({ libraryCode: 'test-library', libraryHash: 'test-hash', userId: '' }),
    assertPrivacyLibraryActive: async () => { if (failure) throw failure; },
    readAiConsent: async () => { verified++; return accepted; },
  });
  await handler({ path, method }, {
    status(value) { status = value; return this; }, json(value) { result = value; },
  }, () => { providerCalls++; });
  return { verified, providerCalls, status, result };
}

test('without permission no provider handler is reached', async () => {
  const r = await run();
  assert.equal(r.providerCalls, 0);
  assert.equal(r.status, 403);
  assert.equal(r.result.code, 'ai_consent_required');
});
test('confirmed current permission allows the feature handler', async () => {
  const r = await run({ accepted: true });
  assert.equal(r.providerCalls, 1);
  assert.equal(r.verified, 1);
});
for (const path of [
  '/ai', '/ai/ask', '/ai/basic-analysis', '/ai/clean-note', '/ai/study/guide',
  '/transcribe', '/support', '/classscribe/ask', '/schedule/import-preview',
  '/courses/course-id/syllabus/upload', '/courses/course-id/syllabus/preview',
  '/courses/course-id/study-guide', '/lectures/lecture-id/transcribe',
  '/lectures/lecture-id/analyze', '/study-plans/import',
  '/edu/courses/course-id/lectures/lecture-id/transcribe',
  '/AI', '/Ai/Clean-Note', '/TRANSCRIBE', '/Courses/course-id/Study-Guide',
]) test(`permission is enforced for ${path}`, async () => {
  const r = await run({ path });
  assert.equal(r.status, 403);
  assert.equal(r.providerCalls, 0);
});
for (const path of ['/courses', '/notes', '/privacy/delete', '/billing/stripe/checkout', '/db/set']) {
  test(`non-AI functionality remains available: ${path}`, async () => {
    const r = await run({ path });
    assert.equal(r.verified, 0);
    assert.equal(r.providerCalls, 1);
  });
}
test('reading stored study content does not require processing consent', async () => {
  const r = await run({ path: '/courses/course-id/study-guide', method: 'GET' });
  assert.equal(r.verified, 0);
  assert.equal(r.providerCalls, 1);
});
test('failed verification fails closed', async () => {
  const r = await run({ failure: new Error('unavailable'), accepted: true });
  assert.equal(r.status, 503); assert.equal(r.providerCalls, 0);
});
test('deleted libraries cannot process data even with previous consent', async () => {
  const r = await run({ failure: Object.assign(new Error('deleted'), { status: 410 }), accepted: true });
  assert.equal(r.status, 410); assert.equal(r.providerCalls, 0);
});
test('gate runs before both legacy and signed-in routes', () => {
  const app = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.ok(app.indexOf('app.use("/api", aiConsentGate)') < app.indexOf('app.use("/api", classscribeLegacyRouter)'));
  assert.ok(app.indexOf('app.use("/api", aiConsentGate)') < app.indexOf('app.use("/api", router)'));
});
test('phone and browser classify the same processing routes as the server', () => {
  const mobile = fs.readFileSync(new URL('../../classscribe-mobile/lib/ai-consent.js', import.meta.url), 'utf8');
  const browser = fs.readFileSync(new URL('../../classscribe/web-public/ai-consent.js', import.meta.url), 'utf8');
  const parse = text => vm.runInNewContext(text.match(/const processingPath = (.+);/)[1]);
  for (const path of ['/ai', '/ai/study/cards', '/AI', '/Ai/Clean-Note', '/TRANSCRIBE', '/Courses/c/Study-Guide', '/transcribe', '/support', '/courses/c/study-guide', '/notes']) {
    assert.equal(parse(mobile).test(`/api${path}`), pattern.test(path));
    assert.equal(parse(browser).test(`/api${path}`), pattern.test(path));
  }
});
