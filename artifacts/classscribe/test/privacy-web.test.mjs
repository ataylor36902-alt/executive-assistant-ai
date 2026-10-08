import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = name => readFileSync(new URL(`../web-src/${name}`, import.meta.url), 'utf8');
const account = read('8_account.js');
const capture = read('5_capture_lecture.js');
const events = read('6_study_social.js');
const core = read('3_core.js');

test('web privacy account actions use scoped authenticated APIs and Clerk first-factor verification', () => {
  assert.doesNotThrow(() => new vm.Script(account));
  assert.match(account, /getToken\(\{skipCache:true\}\)/);
  assert.match(account, /unsafeMetadata:clerkSignupAgeBand\?\{ageBand:clerkSignupAgeBand\}:undefined/);
  assert.match(account, /\/status/);
  assert.match(account, /\/export/);
  assert.match(account, /\/delete/);
  assert.match(account, /startVerification\(\{level:'first_factor'\}\)/);
  assert.match(account, /factorVerificationAge/);
  assert.match(account, /confirmation:'DELETE',confirmActiveSubscription:/);
  assert.match(account, /privacy-active-override/);
  assert.match(account, /Manage or cancel subscription/);
  assert.match(account, /\/privacy\.html/);
  assert.match(account, /\/terms\.html/);
  assert.match(account, /function privacyLibraryCode\(\)\{\s*return String\(window\.CS_SYNC&&window\.CS_SYNC\.code\|\|S\.uid\|\|''\)/);
  const headerSource=account.match(/function privacyRequestHeaders\(expectedCode,hasBody,token\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(headerSource,'privacy request header builder is present');
  const headerContext={};vm.runInNewContext(`${headerSource};this.privacyRequestHeaders=privacyRequestHeaders`,headerContext);
  assert.deepEqual(JSON.parse(JSON.stringify(headerContext.privacyRequestHeaders('u_selectedLibrary',true,''))),{
    'Content-Type':'application/json','X-CS-User':'u_selectedLibrary','Authorization':'Bearer u_selectedLibrary'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(headerContext.privacyRequestHeaders('u_selectedLibrary',true,'clerk-session-token'))),{
    'Content-Type':'application/json','X-CS-User':'u_selectedLibrary','Authorization':'Bearer clerk-session-token'
  });
  assert.match(account, /const headers=privacyRequestHeaders\(expectedCode,body!==undefined,token\)/);
  assert.match(account, /await privacyRequest\('\/consents','POST',submission,code\)/);
  assert.match(account, /privacyLibraryLinkRequest\('POST',\{code\},code\)/);
  assert.match(account, /This account is not linked to the selected library/);
  assert.match(account, /This signed-in account is not linked to the selected library/);
  assert.match(account, /if\(clerkClient&&clerkClient\.user\)\{\s*if\(!clerkClient\.session\)throw new Error\([\s\S]*?\n\s*token=await clerkClient\.session\.getToken\(\{skipCache:true\}\);\s*if\(!token\)throw new Error\('Your signed-in account could not be authenticated/);
  assert.match(account, /const submission=\{\.\.\.record\};delete submission\.consentId/);
  assert.doesNotMatch(account.slice(account.indexOf('function openPrivacyDelete'), account.indexOf('async function requestPrivacyExport')), /window\.confirm|window\.alert/);
});

test('age gating does not persist a date of birth and blocks under-13 library creation', () => {
  assert.match(account, /Birth month/);
  assert.match(account, /Birth year/);
  assert.match(account, /age<13\?'under13'/);
  assert.match(account, /ClassScribe is not available to children under 13/);
  assert.match(account, /delete profile\.birthDate;delete profile\.dateOfBirth;delete profile\.birthMonth;delete profile\.birthYear/);
  assert.match(account, /withSignUp:!!clerkSignupAgeBand,transferable:!!clerkSignupAgeBand,unsafeMetadata:clerkSignupAgeBand\?\{ageBand:clerkSignupAgeBand\}:undefined/);
  assert.match(account, /data-act="clerkSignupAgeStart"/);
  assert.doesNotMatch(account, /unsafeMetadata:\{[^}]*birth(?:Month|Year|Date)/i);
  assert.match(events, /if\(band==='under13'\)\{updateWelcomeAgeGate\(\);return\}/);
  assert.match(events, /persistProfileAgeBand\(p\.ageBand\)/);
});

test('capture consent loads current statements and persists an idempotent record before reservation', () => {
  assert.doesNotThrow(() => new vm.Script(capture));
  assert.doesNotThrow(() => new vm.Script(core));
  assert.match(capture, /PRIVACY_CONFIG\.consent\.statements\[0\]/);
  assert.match(capture, /PRIVACY_CONFIG\.consent\.statements\[1\]/);
  assert.match(capture, /consentId,sessionId,lectureId,courseId,version:PRIVACY_CONFIG\.consent\.version/);
  assert.match(capture, /accommodation:!!\$\('#consent-accommodation'\)\?\.checked/);
  assert.match(capture, /function reusableReserveRetryId\(code,courseId\)/);
  assert.match(capture, /draft\.sessionId===id&&draft\.lectureId===id&&draft\.courseId===courseId/);
  assert.match(capture, /sessionId=recordingId/);
  assert.match(core, /consentId:String\(consent\.consentId\),sessionId:String\(consent\.sessionId\)/);
  assert.match(core, /creditActionPost\('\/api\/billing\/recordings\/reserve'/);
  assert.match(core, /const payload=\{\.\.\.body,useCredits:true,requestId\}/);
  assert.match(core, /creditActionPost\('\/api\/transcribe'/);
  assert.match(core, /recordingId:String\(recordingId\),sessionId:String\(sessionId\),lectureId:String\(lectureId\),courseId:String\(courseId\),consentId:String\(consentId\)/);
  assert.doesNotMatch(core, /\/api\/lectures\/.*\/transcribe/);
  const consentWrite = events.indexOf('await persistRecordingConsent(consent,consentCode)');
  const reservation = events.indexOf("await billingRecordingAction('reserve',recordingId,billingCode,consent)");
  assert.ok(consentWrite >= 0 && reservation > consentWrite);
  assert.match(events, /const persisted=await persistRecordingConsent\(consent,consentCode\)/);
  assert.match(events, /billingRecordingAction\('reserve',recordingId,billingCode,consent\)/);
  assert.match(events, /if\(persisted\.queued\).*return/s);
  assert.match(capture, /window\.CS_TRANSCRIBE\(blob,\{timed:true,consentId:consentId\|\|l\.consentId,recordingId,sessionId:l\.sessionId,lectureId:id,courseId:l\.courseId\}\)/);
  assert.match(capture, /Confirm both current permission and privacy statements before continuing/);
  assert.match(capture, /async function ensureLectureTranscriptionConsent/);
  assert.match(capture, /persistRecordingConsent\(record,code\)/);
  assert.match(capture, /transcribeInto\(id,blob,btn/);
  assert.match(events, /captureConsentDraftKey\(consentCode\)/);
  assert.match(account, /window\.addEventListener\('online',\(\)=>\{if\(privacyLibraryCode\(\)\)void flushPrivacyConsentQueue\(\)\}\)/);
});