const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = (path) => readFileSync(join(__dirname, '..', path), 'utf8');

test('Free plans expose credit purchases and an explicit remaining balance without a subscription gate', () => {
  const plans = source('app/plans.js');
  const credits = source('app/credits.js');
  const hook = source('lib/credits-status.js');
  assert.match(plans, /plan\.id === 'free'[\s\S]*Buy Scribe Credits without a subscription[\s\S]*onPress=\{onBuyCredits\}/);
  assert.match(plans, /onBuyCredits=\{\(\) => router\.push\('\/credits'\)\}/);
  assert.match(plans, /Remaining Scribe Credits[\s\S]*credits\.status\.balance\.toLocaleString\(\)/);
  assert.match(plans, /Balance unavailable/);
  assert.match(credits, /REMAINING SCRIBE CREDITS/);
  assert.match(credits, /setNativeBalance\(null\);\s*\}, \[status\?\.balance\]\)/);
  assert.match(hook, /AppState\.currentState === 'active'[\s\S]*30_000/);
  assert.match(hook, /clearInterval\(timer\)/);
});
test('study guide retries the saved payload only after the Credits sheet confirmation', () => {
  const guide = source('app/guide.js');
  assert.match(guide, /setCreditsPrompt\(\{ \.\.\.e, body, libraryCode: requestLibrary \}\)/);
  assert.match(guide, /\.\.\.\(confirmed \? \{ useCredits: true, requestId: confirmed\.request\.requestId \} : \{\}\)/);
  assert.match(guide, /<CreditsConfirmSheet[\s\S]*onConfirm=\{confirmCredits\}/);
});

test('Ask retries with the same stable ask ID and opts in on every AI tool round', () => {
  const ask = source('app/(tabs)/ask/index.js');
  const api = source('lib/api.js');
  assert.match(ask, /const stableAskId = confirmed\?\.askId \|\| newAskId\(\)/);
  assert.match(ask, /askId: stableAskId,[\s\S]*useCredits: true, requestId: confirmed\.requestId/);
  assert.match(ask, /askId: prompt\.askId/);
  assert.match(api, /if \(useCredits\) body = creditsOptInBody\(body, requestId\)/);
});

test('recording reservations and transcription have explicit opt-in wrappers and visible sheets', () => {
  const api = source('lib/api.js');
  const record = source('app/record.js');
  const store = source('lib/store.js');
  const lecture = source('app/lecture/[id].js');
  assert.match(api, /useCredits \? creditsOptInBody\(body, requestId\) : body/);
  assert.match(record, /reserveRecording\(recordingId, creditConfirmation[\s\S]*useCredits: true, requestId: creditConfirmation\.requestId/);
  assert.match(record, /<CreditsConfirmSheet[\s\S]*onConfirm=\{confirmCreditsReservation\}/);
  assert.match(store, /creditsRequired: \{ \.\.\.e, libraryCode: getUid\(\) \}/);
  assert.match(lecture, /st\.processRecording\(l, uri, undefined, \{[\s\S]*useCredits: true, requestId: request\.requestId/);
});

test('voice transcription retries the retained original audio with the server request ID', () => {
  const voice = source('lib/ask-voice.js');
  const ask = source('app/(tabs)/ask/index.js');
  assert.match(voice, /retainForCreditConfirmation = true;[\s\S]*error\.audioUri = uri/);
  assert.match(ask, /transcribe\(prompt\.audioUri, \{ useCredits: true, requestId: prompt\.requestId/);
  assert.match(ask, /kind: 'voice-transcription', audioUri: prompt\.audioUri/);
});