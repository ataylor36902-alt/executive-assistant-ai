// Talks to the ClassScribe server (the Replit project): database, AI and transcription.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { getRandomBytes } from 'expo-crypto';
import { setBaseUrl, setRequestConsentGuard } from '@workspace/api-client-react';
import { apiError, creditsOptInBody } from './credits-contract';
import { ensureAiConsent, needsAiConsent } from './ai-consent';

let SERVER = '';
let UID = '';
let creditsMaintenanceError = '';

function newUid() {
  return newSyncCode();
}
export async function initApi() {
  const saved = await AsyncStorage.getItem('cs_server');
  const defaultServer = Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : process.env.EXPO_PUBLIC_SERVER_URL || (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '');
  SERVER = (saved || defaultServer || (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.serverUrl) || '').replace(/\/+$/, '');
  setBaseUrl(SERVER || null);
  UID = (await AsyncStorage.getItem('cs_uid')) || '';
  if (!UID) { UID = newUid(); await AsyncStorage.setItem('cs_uid', UID); }
  setRequestConsentGuard(async (url, method, headers) => {
    const path = new URL(url, SERVER || 'https://classscribe.invalid').pathname;
    if (method !== 'POST' || !needsAiConsent(path)) return;
    const libraryCode = UID;
    const server = SERVER;
    await ensureAiConsent();
    if (libraryCode !== UID || server !== SERVER) throw new Error('The library or server changed. Reopen the feature and try again.');
    headers.set('X-CS-User', libraryCode);
  });
  return { server: SERVER, uid: UID };
}
export const getServer = () => SERVER;
export const getUid = () => UID;
export async function setServer(url) {
  creditsMaintenanceError = '';
  SERVER = String(url || '').trim().replace(/\/+$/, '');
  if (SERVER && !/^https?:\/\//.test(SERVER)) SERVER = 'https://' + SERVER;
  await AsyncStorage.setItem('cs_server', SERVER);
  return SERVER;
}
export async function setUid(code) {
  UID = String(code).trim();
  creditsMaintenanceError = '';
  await AsyncStorage.setItem('cs_uid', UID);
}
export const validSyncCode = (c) => /^u_[A-Za-z0-9]{10,40}$/.test(String(c).trim());
export const newSyncCode = () => 'u_' + Array.from(getRandomBytes(20), b => b.toString(16).padStart(2, '0')).join('');
export const rotateSyncCode = (nextCode) => call('/api/db/rotate', { confirm: true, nextCode }, 120000);
export async function checkLibrary(code) {
  if (!SERVER || !validSyncCode(code)) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const response = await fetch(SERVER + '/api/db/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CS-User': code },
      body: JSON.stringify({ path: `data/users/${code}/profile` }),
      signal: ctl.signal,
    });
    if (!response.ok) return false;
    const result = await response.json();
    return !!(result.data && result.data.firstName);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function call(path, body, timeoutMs = 20000, signal) {
  if (!SERVER) throw { code: 'no_server', message: 'Add your ClassScribe server address in Account.' };
  const requestedLibrary = UID;
  const requestedServer = SERVER;
  if (signal?.aborted) throw { code: 'cancelled', message: 'The request was cancelled.' };
  if (needsAiConsent(path)) await ensureAiConsent();
  if (requestedLibrary !== UID || requestedServer !== SERVER) throw { code: 'library_changed', message: 'The library or server changed. Reopen the feature and try again.' };
  if (body?.useCredits === true && creditsMaintenanceError) {
    throw { code: 'credits_maintenance', message: creditsMaintenanceError };
  }
  if (signal && signal.aborted) throw { code: 'cancelled', message: 'The request was cancelled.' };
  let r;
  const ctl = new AbortController();
  const abortRequest = () => ctl.abort();
  if (signal) {
    signal.addEventListener('abort', abortRequest, { once: true });
    if (signal.aborted) ctl.abort();
  }
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    r = await fetch(SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CS-User': requestedLibrary }, body: JSON.stringify(body || {}), signal: ctl.signal });
  } catch {
    throw signal && signal.aborted
      ? { code: 'cancelled', message: 'The request was cancelled.' }
      : ctl.signal.aborted
        ? { code: 'timeout', message: 'The ClassScribe server took too long to answer.' }
        : { code: 'offline', message: 'Can’t reach the ClassScribe server. Check your connection and server address.' };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abortRequest);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = apiError(j, r.status);
    if ((r.status === 409 || r.status === 503) && (path.startsWith('/api/credits') || error.code === 'credits_maintenance')) {
      error.message = r.status === 409
        ? 'Credits are temporarily paused for maintenance. Top-ups and credit use are unavailable right now.'
        : 'Credits are temporarily unavailable during maintenance. Top-ups and credit use are unavailable right now.';
      if (body?.useCredits === true || path.startsWith('/api/credits')) creditsMaintenanceError = error.message;
    }
    throw error;
  }
  return j;
}
export async function health() {
  if (!SERVER) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(SERVER + '/api/health', { signal: ctl.signal }); return await r.json(); } catch { return null; } finally { clearTimeout(timer); }
}

export async function extractMaterial(bytes, mime, libraryCode = UID) {
  if (!SERVER) throw { code: 'no_server', message: 'Add your ClassScribe server address in Account.' };
  if (!libraryCode || libraryCode !== UID) throw { code: 'library_changed', message: 'The active library changed. Reopen source import and try again.' };
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!payload.length) throw { code: 'invalid_argument', message: 'The selected file is empty or could not be read.' };
  if (payload.byteLength > 8 * 1024 * 1024) throw { code: 'invalid_argument', message: 'Choose a PDF, TXT, or MD file no larger than 8 MB.' };
  if (mime !== 'application/pdf' && mime !== 'text/plain') throw { code: 'invalid_argument', message: 'Choose a PDF, TXT, or MD file.' };
  const body = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
  let response;
  try {
    response = await fetch(SERVER + '/api/materials/extract', {
      method: 'POST',
      headers: { 'Content-Type': mime, 'X-CS-User': libraryCode },
      body,
    });
  } catch {
    throw { code: 'offline', message: 'Can’t reach the ClassScribe server. Check your connection and try again.' };
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw { code: result.code || 'unavailable', message: result.error || 'The server could not extract text from this file.' };
  if (libraryCode !== UID) throw { code: 'library_changed', message: 'The active library changed while the file was being read. Reopen source import before saving.' };
  if (typeof result.text !== 'string' || typeof result.truncated !== 'boolean' || !Number.isFinite(Number(result.originalLength))) {
    throw { code: 'invalid_response', message: 'The server returned an invalid extracted-text response. Try another file.' };
  }
  return result;
}

export async function supportChat(question, history = []) {
  return call('/api/support', { question, history }, 45000);
}

export const listStudentGrades = () => call('/api/student/grades/list', {});
export const saveStudentGrades = (gradebook) => call('/api/student/grades/save', { gradebook });

async function billingRequest(path, method, libraryCode, body = {}) {
  if (!SERVER) throw { code: 'no_server', message: 'Connect to your ClassScribe server in Account, then try again.' };
  if (!libraryCode) throw { code: 'no_library', message: 'Open a library before checking its subscription.' };
  if (libraryCode !== UID) throw { code: 'library_changed', message: 'The active library changed. Reopen its plan page to continue.' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  let response;
  try {
    response = await fetch(SERVER + path, {
      method,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'X-CS-User': libraryCode,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}),
      signal: ctl.signal,
    });
  } catch {
    throw ctl.signal.aborted
      ? { code: 'timeout', message: 'The ClassScribe server took too long to load your plan.' }
      : { code: 'offline', message: 'Can’t reach the ClassScribe server. Check your connection and try again.' };
  } finally {
    clearTimeout(timer);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const billingRoute = path.includes('/api/billing/');
    const fallback = path.includes('/billing/revenuecat/')
      ? 'The library server cannot verify in-app subscriptions right now. Your server-confirmed plan has not changed.'
      : billingRoute
        ? 'The library server cannot verify billing right now. Your server-confirmed plan has not changed.'
        : 'The request could not be completed.';
    const error = {
      ...result,
      code: result.code || 'unavailable',
      status: response.status,
      message: billingRoute ? fallback : result.error || result.message || fallback,
      ...(result.details && typeof result.details === 'object' ? result.details : {}),
    };
    if (path === '/api/credits/status' && (response.status === 409 || response.status === 503)) {
      creditsMaintenanceError = response.status === 409
        ? 'Credits are temporarily paused for maintenance. Top-ups and credit use are unavailable right now.'
        : 'Credits are temporarily unavailable during maintenance. Top-ups and credit use are unavailable right now.';
      error.message = creditsMaintenanceError;
    }
    throw error;
  }
  if (libraryCode !== UID) throw { code: 'library_changed', message: 'The active library changed. Reopen its plan page to continue.' };
  if (path === '/api/credits/status') creditsMaintenanceError = '';
  return result;
}

export async function getBillingStatus(libraryCode = UID, { forceRefresh = false } = {}) {
  return billingRequest(`/api/billing/status${forceRefresh ? '?refresh=1' : ''}`, 'GET', libraryCode);
}

export async function getCreditsStatus(libraryCode = UID) {
  return billingRequest('/api/credits/status', 'GET', libraryCode);
}

export async function createStripeCheckout(plan, returnUrl, libraryCode = UID) {
  if (plan !== 'student' && plan !== 'pro') {
    throw { code: 'invalid_argument', message: 'Choose Student or Pro to start checkout.' };
  }
  return billingRequest('/api/billing/checkout', 'POST', libraryCode, { plan, returnUrl });
}

export async function createStripePortal(returnUrl, libraryCode = UID) {
  return billingRequest('/api/billing/portal', 'POST', libraryCode, { returnUrl });
}

function validateRecordingId(recordingId) {
  if (typeof recordingId !== 'string' || !recordingId.trim()) {
    throw { code: 'invalid_argument', message: 'A stable recording ID is required to reserve or finish a recording.' };
  }
  return recordingId.trim();
}

export async function reserveRecording(recordingId, { useCredits = false, requestId, consentId, sessionId, lectureId, courseId } = {}) {
  if (typeof consentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(consentId) ||
      typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(sessionId) ||
      typeof lectureId !== 'string' || !lectureId.trim() ||
      typeof courseId !== 'string' || !courseId.trim()) {
    throw { code: 'invalid_argument', message: 'The recording reservation requires its consent ID, session, lecture and course.' };
  }
  const stableRecordingId = validateRecordingId(recordingId);
  if (sessionId !== stableRecordingId || lectureId !== stableRecordingId) {
    throw { code: 'invalid_argument', message: 'The consent session and lecture must match this recording ID.' };
  }
  const body = { recordingId: stableRecordingId, sessionId, lectureId, courseId, consentId };
  return call('/api/billing/recordings/reserve', useCredits ? creditsOptInBody(body, requestId) : body, 15000);
}

export async function finishRecordingReservation(recordingId) {
  return call('/api/billing/recordings/finish', { recordingId: validateRecordingId(recordingId) }, 15000);
}

export async function releaseRecordingReservation(recordingId) {
  return call('/api/billing/recordings/release', { recordingId: validateRecordingId(recordingId) }, 15000);
}

export async function getRevenueCatIdentity(libraryCode = UID) {
  const result = await billingRequest('/api/billing/revenuecat/identity', 'GET', libraryCode);
  if (typeof result.appUserId !== 'string' || !result.appUserId.trim()) {
    throw { code: 'billing_unavailable', message: 'The server did not provide a RevenueCat identity for this library.' };
  }
  return { appUserId: result.appUserId.trim() };
}

export async function refreshRevenueCatBilling(libraryCode = UID) {
  return billingRequest('/api/billing/revenuecat/refresh', 'POST', libraryCode);
}

export const libPath = (col) => `data/users/${UID}/lib/${col}`;
export const db = {
  get: (p, groupCode) => call('/api/db/get', { path: p, ...(groupCode ? { groupCode } : {}) }).then((r) => r.data),
  set: (p, data) => call('/api/db/set', { path: p, data }),
  update: (p, data) => call('/api/db/update', { path: p, data }),
  del: (p) => call('/api/db/delete', { path: p }),
  list: (p, where = []) => call('/api/db/list', { path: p, where }).then((r) => r.docs),
  add: (p, data) => call('/api/db/set', { path: p + '/' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36), data }),
};

/* ---- AI (Claude via the server) ---- */
async function runAI(path, messages, { tier, tools, signal, assertCurrent, askId, useCredits, requestId } = {}) {
  messages = messages.map((m) => ({ ...m }));
  const defs = (tools || []).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }));
  const assertRequestCurrent = () => {
    if (signal && signal.aborted) throw { code: 'cancelled', message: 'The request was cancelled.' };
    if (assertCurrent) assertCurrent();
  };
  for (let round = 0; round < 8; round++) {
    assertRequestCurrent();
    let body = { messages, tools: defs, tier };
    if (askId) body.askId = askId;
    if (useCredits) body = creditsOptInBody(body, requestId);
    const r = await call(path, body, 150000, signal);
    assertRequestCurrent();
    const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const uses = r.content.filter((b) => b.type === 'tool_use');
    if (!uses.length || r.stop_reason !== 'tool_use') return { text, truncated: r.stop_reason === 'max_tokens' };
    messages.push({ role: 'assistant', content: r.content });
    const results = [];
    for (const u of uses) {
      assertRequestCurrent();
      const t = (tools || []).find((x) => x.name === u.name);
      let out, isErr = false;
      try { out = t ? await t.execute(u.input || {}) : 'Unknown tool'; } catch (e) { out = String((e && e.message) || e); isErr = true; }
      assertRequestCurrent();
      results.push({ type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out), is_error: isErr });
    }
    messages.push({ role: 'user', content: results });
  }
  throw { code: 'unavailable', message: 'The AI took too many steps.' };
}
export const ai = (messages, options) => runAI('/api/ai', messages, options);
export const searchPrivateEvidence = async (query, courseIds, signal) => {
  const result = await call('/api/ai/evidence', { query, courseIds: courseIds.slice(0, 100), mode: 'semantic' }, 90000, signal);
  if (courseIds.length > 100) {
    result.notice = ['Partial search: only the first 100 courses in this scope were searched. Narrow to one semester or course.', result.notice].filter(Boolean).join(' ');
    result.coverage.partial = true;
  }
  return result;
};

export const askAI = (messages, options) => {
  if (!options?.askId) throw { code: 'invalid_argument', message: 'A stable Ask question ID is required.' };
  return runAI('/api/ai/ask', messages, options);
};
export const newAskId = () => Array.from(getRandomBytes(16), (byte) => byte.toString(16).padStart(2, '0')).join('');
export const aiText = async (prompt, opts) => (await ai([{ role: 'user', content: prompt }], opts)).text;
export const studyAI = (operation, data, signal) => call(
  `/api/ai/study/${operation}`,
  data?.useCredits ? creditsOptInBody(data, data.requestId) : data,
  150000,
  signal,
);
export async function basicLectureAnalysis(transcript, date, difficulty = 'intermediate') {
  return call('/api/ai/basic-analysis', { transcript, date, difficulty }, 150000);
}
export async function cleanSmartNote(text) {
  const result = await call('/api/ai/clean-note', { text }, 150000);
  return result.text;
}
export function parseJSON(t) {
  t = String(t).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const starts = ['{', '['].map((c) => t.indexOf(c)).filter((i) => i >= 0);
  const a = Math.min(...starts), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (starts.length && b > a) return JSON.parse(t.slice(a, b + 1));
  throw { code: 'transform_error', message: 'The AI reply wasn’t valid JSON.' };
}
export const aiJSON = async (prompt, opts) => parseJSON(await aiText(prompt + '\n\nReply with the JSON only.', opts));
export async function aiImage(prompt, base64, mime = 'image/jpeg') {
  const r = await ai([{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } }, { type: 'text', text: prompt }] }], { tier: 'quick' });
  return r.text;
}

/* ---- transcription (optional on the server) ---- */
async function readBase64(uri) {
  if (Platform.OS !== 'web') return { audio: await new File(uri).base64(), mime: '' };
  const blob = await (await fetch(uri)).blob();
  const audio = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  return { audio, mime: blob.type.split(';')[0] };
}
export async function transcribe(uri, { timed = false, useCredits = false, requestId, libraryCode = UID, recordingId, sessionId, lectureId, courseId, consentId } = {}) {
  if (!libraryCode || libraryCode !== UID) throw { code: 'library_changed', message: 'The active library changed before transcription. Reopen the recording and try again.' };
  if (recordingId !== undefined &&
      (typeof recordingId !== 'string' || !recordingId ||
       typeof consentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(consentId) ||
       typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(sessionId) ||
       sessionId !== recordingId || typeof lectureId !== 'string' || !lectureId.trim() ||
       typeof courseId !== 'string' || !courseId.trim())) {
    throw { code: 'invalid_argument', message: 'Recording transcription requires its saved consent ID and matching session, lecture and course.' };
  }
  const { audio, mime: recordedMime } = await readBase64(uri);
  if (libraryCode !== UID) throw { code: 'library_changed', message: 'The active library changed while the audio was being read. Reopen the recording and try again.' };
  const formats = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };
  if (recordedMime && !formats[recordedMime]) throw { code: 'invalid_argument', message: 'This audio format cannot be transcribed.' };
  const mime = recordedMime || (Platform.OS === 'web' ? 'audio/webm' : uri.endsWith('.caf') ? 'audio/x-caf' : 'audio/mp4');
  const name = uri.startsWith('blob:') ? `question.${formats[mime] || 'webm'}` : uri.split('/').pop() || 'lecture.m4a';
  const body = {
    audio, filename: name, mime, timed,
    ...(recordingId ? { recordingId, sessionId, lectureId, courseId } : {}),
    ...(consentId ? { consentId } : {}),
  };
  const result = await call('/api/transcribe', useCredits ? creditsOptInBody(body, requestId) : body, 300000);
  if (libraryCode !== UID) throw { code: 'library_changed', message: 'The active library changed while transcription was running.' };
  return result;
}

export function errMsg(e) {
  const m = {
    no_server: 'Add your ClassScribe server address in Account.',
    offline: 'Can’t reach the ClassScribe server.',
    timeout: 'The ClassScribe server took too long to answer. Try again.',
    unavailable: (e && e.message) || 'The service isn’t available right now.',
    rate_limited: 'Too many AI requests. Wait a minute and try again.',
    not_granted: 'The server’s AI key was rejected. Check ANTHROPIC_API_KEY in Replit Secrets.',
    paid_required: 'This AI tool requires a verified Student or Pro plan. Open Plans to upgrade.',
  };
  return m[e && e.code] || (e && e.message) || 'Something went wrong.';
}
