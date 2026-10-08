const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = (path) => readFileSync(join(__dirname, '..', path), 'utf8');

test('Record waits for auth readiness and offers stack-preserving recovery without sync codes in routes', () => {
  const record = source('app/record.js');
  const signIn = source('app/account-sign-in.js');
  assert.ok(record.indexOf('if (!isLoaded)') < record.indexOf("await import('../lib/ai-consent')"));
  assert.match(record, /setupLibraryRef\.current !== getUid\(\)/);
  assert.match(record, /testID="record-sign-in-recovery"/);
  assert.match(record, /router\.push\(\{ pathname: '\/account-sign-in', params: \{ recordingRecovery: '1' \}/);
  assert.match(record, /onPress=\{\(\) => start\(\)\}/);
  assert.match(signIn, /goBack\('\/record'\)/);
  assert.ok(signIn.indexOf("goBack('/record')") < signIn.indexOf('await linkCurrentLibrary'));
});

test('consent server response is persisted as a lecture-and-course-bound receipt', () => {
  const privacy = source('lib/privacy.js');
  assert.match(privacy, /const consentId = response\?\.consentId \|\| response\?\.id/);
  assert.match(privacy, /sessionId = response\?\.sessionId \|\| response\?\.stableSessionId \|\| record\?\.sessionId/);
  assert.match(privacy, /lectureId: record\.lectureId,[\s\S]*courseId: record\.courseId/);
  assert.match(privacy, /consentReceiptKey\(libraryCode, record\.lectureId\)/);
  assert.match(privacy, /return \{ \.\.\.result, \.\.\.receipt \}/);
});

test('ordinary and Credits reservations send the exact server consent tuple with session equal to recording ID', () => {
  const api = source('lib/api.js');
  const record = source('app/record.js');
  assert.match(api, /reserveRecording\(recordingId, \{ useCredits = false, requestId, consentId, sessionId, lectureId, courseId \}/);
  assert.match(api, /const body = \{ recordingId: stableRecordingId, sessionId, lectureId, courseId, consentId \}/);
  assert.match(api, /sessionId !== stableRecordingId \|\| lectureId !== stableRecordingId/);
  assert.match(api, /useCredits \? creditsOptInBody\(body, requestId\) : body/);
  assert.match(record, /sessionId: recordingId/);
  assert.match(record, /consentReceipt = await savePrivacyConsent/);
  assert.match(record, /if \(!consentReceipt\?\.consentId \|\| consentReceipt\.sessionId !== sessionId\)/);
  assert.match(record, /consentId: consentReceipt\.consentId, sessionId: consentReceipt\.sessionId, lectureId: consentReceipt\.lectureId, courseId: consentReceipt\.courseId/);
  assert.match(api, /finishRecordingReservation\(recordingId\)[\s\S]*finish', \{ recordingId: validateRecordingId\(recordingId\) \}/);
  assert.match(api, /releaseRecordingReservation\(recordingId\)[\s\S]*release', \{ recordingId: validateRecordingId\(recordingId\) \}/);
  assert.match(record, /Your recording consent is saved on this phone and will retry when online/);
});

test('lecture transcription uses the legacy endpoint with the complete receipt tuple', () => {
  const api = source('lib/api.js');
  const store = source('lib/store.js');
  assert.match(store, /getPrivacyConsentReceipt\(requestLibrary, l\.id, l\.courseId\)/);
  assert.match(store, /recordingId: consentReceipt\.sessionId,[\s\S]*lectureId: consentReceipt\.lectureId,[\s\S]*courseId: consentReceipt\.courseId,[\s\S]*consentId: consentReceipt\.consentId,[\s\S]*sessionId: consentReceipt\.sessionId/);
  assert.match(api, /recordingId \? \{ recordingId, sessionId, lectureId, courseId \} : \{\}/);
  assert.match(api, /consentId \? \{ consentId \} : \{\}/);
  assert.match(api, /call\('\/api\/transcribe'/);
  assert.doesNotMatch(api, /\/api\/lectures\/.*\/transcribe/);
  assert.match(api, /sessionId !== recordingId/);
  assert.match(api, /typeof lectureId !== 'string' \|\| !lectureId\.trim\(\)/);
});

test('recovered lecture audio asks for current terms and only transcribes after server receipt confirmation', () => {
  const store = source('lib/store.js');
  const recovery = source('app/recover-recordings.js');
  const lecture = source('app/lecture/[id].js');
  const consent = source('components/RecordingConsentSheet.js');
  assert.match(store, /if \(!consentReceipt\) \{[\s\S]*This recording has no matching saved consent receipt\. Its audio was not uploaded\./);
  assert.match(recovery, /if \(retryTranscription\) \{[\s\S]*consentNeeded\.push\(\{ lecture, course: target \}\)/);
  assert.match(recovery, /<RecordingConsentSheet[\s\S]*onConfirmed=\{\(\) => \{[\s\S]*st\.processRecording/);
  assert.match(consent, /getPrivacyConfig\(\)/);
  assert.match(consent, /result\?\.offlineCached/);
  assert.match(consent, /statements: \[\.\.\.config\.statements\]/);
  assert.match(consent, /getQueuedPrivacyConsent\(libraryCode, sessionId, lectureId, courseId\)/);
  assert.match(consent, /await queuePrivacyConsent\(libraryCode, record\)/);
  assert.match(consent, /await savePrivacyConsent\(record, getToken, libraryCode\)/);
  assert.match(consent, /onConfirmed\?\.\(receipt\)/);
  assert.match(consent, /This is a new confirmation for transcription now\. It does not claim that consent was given when the recording was made\./);
  assert.match(consent, /accessibilityRole="checkbox"/);
  assert.match(consent, /config\.statements/);
  assert.match(consent, /accepted\.every\(Boolean\)/);
  assert.match(consent, /accommodation,/);
  assert.match(lecture, /setRecordingConsentTarget\(\{ lecture, sessionId: recordingId \}\)/);
  assert.match(lecture, /onConfirmed=\{\(\) => st\.processRecording\(recordingConsentTarget\.lecture, uri\)\}/);
});

test('anonymous legacy deletion uses the local library bearer code rather than X-CS-User alone', () => {
  const privacy = source('lib/privacy.js');
  assert.match(privacy, /allowAnonymous \? \{ Authorization: `Bearer \$\{libraryCode\}` \} : \{\}/);
  assert.match(privacy, /privacyRequest\('\/api\/privacy\/delete', 'POST', getToken, libraryCode, body, \{ allowAnonymous: true \}\)/);
});

test('Clerk password re-verification skips preparation while code factors are prepared', () => {
  const settings = source('app/privacy-settings.js');
  assert.match(settings, /if \(selected\.strategy === 'password'\) \{\s*setReauthFactor\('password'\)/);
  assert.match(settings, /if \(selected\.strategy !== 'email_code' && selected\.strategy !== 'phone_code'\)/);
  assert.match(settings, /session\.prepareFirstFactorVerification\(parameters\)/);
  assert.match(settings, /session\.attemptFirstFactorVerification\(\{ strategy: 'password', password: reauthPassword \}\)/);
});

test('social OAuth can start only after the rendered age step; email sign-in remains ungated', () => {
  const auth = source('components/OptionalSignIn.js');
  assert.match(auth, /onPress=\{\(\) => requestSocialAge\('oauth_apple'\)\}/);
  assert.match(auth, /onPress=\{\(\) => requestSocialAge\('oauth_google'\)\}/);
  assert.match(auth, /mode === 'social-age' \? \(/);
  assert.match(auth, /if \(\(mode === 'signup' \|\| mode === 'social-age'\) && !newAccountAgeBand\) return/);
  assert.match(auth, /const newAccountAgeBand = mode === 'signup' \? await requireSignupAge\(\) : ''/);
  assert.match(auth, /if \(mode === 'signup'\) \{\s*const result = await signUp\.password/);
  assert.match(auth, /const result = await signIn\.password/);
});