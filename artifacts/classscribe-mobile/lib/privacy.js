import AsyncStorage from '@react-native-async-storage/async-storage';
import { getServer, getUid } from './api';

const CONSENT_QUEUE_PREFIX = 'cs_privacy_consents_v1_';
const CONSENT_RECEIPT_PREFIX = 'cs_privacy_consent_receipt_v1_';
const PRIVACY_CONFIG_CACHE = 'cs_privacy_config_v1';
const ageBands = new Set(['13-17', '18+']);
const consentFlushes = new Map();

async function privacyRequest(path, method, getToken, libraryCode, body, { allowAnonymous = false, freshSession = false, signedIn = false } = {}) {
  const server = getServer();
  if (!server) throw new Error('Connect to your ClassScribe server in Account before continuing.');
  if (!libraryCode || libraryCode !== getUid()) throw new Error('The active library changed. Reopen Account and try again.');
  let token;
  try {
    token = freshSession ? await getToken?.({ skipCache: true }) : await getToken?.();
  } catch {
    throw Object.assign(new Error('Your account session could not be refreshed. Check your connection or sign in again. Recording has not started.'), { code: 'auth_session_failed' });
  }
  if (libraryCode !== getUid()) throw new Error('The active library changed. Reopen Account and try again.');
  if (!token && signedIn) {
    throw Object.assign(new Error('You are signed in, but your account session could not be refreshed for recording. Verify your sign-in and return to this lecture setup. Recording has not started.'), { code: 'auth_session_failed' });
  }
  if (!token && !allowAnonymous) throw Object.assign(new Error('Sign in to your account before continuing.'), { code: 'auth_required' });
  let response;
  try {
    response = await fetch(server + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : allowAnonymous ? { Authorization: `Bearer ${libraryCode}` } : {}),
        'X-CS-User': libraryCode,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw { code: 'offline', message: 'Can’t reach the ClassScribe server. This request has not been confirmed. Check your connection and try again.' };
  }
  const result = await response.json().catch(() => ({}));
  if (libraryCode !== getUid()) throw new Error('The active library changed while this request was running. Reopen the original library to check its status.');
  if (!response.ok) {
    if (path === '/api/privacy/consents' && [401, 403].includes(response.status)) {
      const code = response.status === 401 || !token ? 'auth_required' : 'library_mismatch';
      throw Object.assign(new Error(code === 'auth_required'
        ? signedIn
          ? 'You are signed in, but the ClassScribe server did not accept your account session. Verify your sign-in for this library, then return and tap Start recording. Recording has not started.'
          : 'Sign in to the account linked to this library, then return and tap Start recording. Recording has not started.'
        : 'This account is not authorized for the selected library. Check the linked library in Account. Your current library has not changed.'), { code });
    }
    const error = new Error(result.error || result.message || 'The privacy request could not be completed.');
    error.code = result.code || 'privacy_request_failed';
    throw error;
  }
  return result;
}

export const getPrivacyConfig = async () => {
  const server = getServer();
  if (!server) throw new Error('Connect to your ClassScribe server in Account before continuing.');
  try {
    const response = await fetch(server + '/api/privacy/config', { headers: { Accept: 'application/json' } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Privacy information is unavailable right now.');
    await AsyncStorage.setItem(PRIVACY_CONFIG_CACHE, JSON.stringify(result));
    return result;
  } catch (error) {
    const cached = await AsyncStorage.getItem(PRIVACY_CONFIG_CACHE);
    if (!cached) throw error;
    const result = JSON.parse(cached);
    return { ...result, offlineCached: true };
  }
};

export const getPrivacyStatus = (getToken, libraryCode = getUid()) =>
  privacyRequest('/api/privacy/status', 'GET', getToken, libraryCode);

export async function savePrivacyAge(ageBand, getToken, libraryCode = getUid()) {
  if (!ageBands.has(ageBand)) throw new Error('Choose an age range to continue.');
  return privacyRequest('/api/privacy/age', 'POST', getToken, libraryCode, { ageBand });
}

export const requestPrivacyDeletion = (body, getToken, libraryCode = getUid()) =>
  privacyRequest('/api/privacy/delete', 'POST', getToken, libraryCode, body, { allowAnonymous: true });

export const requestPrivacyExport = (getToken, libraryCode = getUid()) =>
  privacyRequest('/api/privacy/export', 'POST', getToken, libraryCode, {});

export const consentReceiptKey = (libraryCode, lectureId) =>
  `${CONSENT_RECEIPT_PREFIX}${lectureId}_${libraryCode}`;

export async function persistPrivacyConsentReceipt(libraryCode, record, response) {
  if (!libraryCode || libraryCode !== getUid()) throw new Error('The active library changed before consent confirmation could be saved.');
  const consentId = response?.consentId || response?.id;
  const sessionId = response?.sessionId || response?.stableSessionId || record?.sessionId;
  if (typeof consentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(consentId)) {
    throw new Error('The server did not return a valid recording-consent ID. Recording was not started.');
  }
  if (typeof record?.sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(record.sessionId) ||
      sessionId !== record.sessionId ||
      !record.lectureId || !record.courseId) {
    throw new Error('The server consent confirmation does not match this recording’s session, lecture and course.');
  }
  const receipt = {
    consentId,
    sessionId,
    lectureId: record.lectureId,
    courseId: record.courseId,
  };
  await AsyncStorage.setItem(consentReceiptKey(libraryCode, record.lectureId), JSON.stringify(receipt));
  if (libraryCode !== getUid()) throw new Error('The active library changed while recording consent was saved.');
  return receipt;
}

export async function getPrivacyConsentReceipt(libraryCode, lectureId, courseId) {
  if (!libraryCode || libraryCode !== getUid() || !lectureId || !courseId) return null;
  const raw = await AsyncStorage.getItem(consentReceiptKey(libraryCode, lectureId));
  if (!raw) return null;
  const receipt = JSON.parse(raw);
  if (libraryCode !== getUid()) return null;
  if (receipt?.lectureId !== lectureId || receipt?.courseId !== courseId ||
      typeof receipt?.sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(receipt.sessionId) ||
      typeof receipt.consentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(receipt.consentId)) return null;
  return receipt;
}

export async function savePrivacyConsent(body, getToken, libraryCode = getUid(), { signedIn = false } = {}) {
  // The server permits a matching sync-code bearer only for existing, active,
  // unlinked legacy libraries. Linked, revoked and deleted libraries still fail.
  const result = await privacyRequest('/api/privacy/consents', 'POST', getToken, libraryCode, body, { allowAnonymous: true, freshSession: true, signedIn });
  const receipt = await persistPrivacyConsentReceipt(libraryCode, body, result);
  return { ...result, ...receipt };
}

export const consentQueueKey = (libraryCode) => CONSENT_QUEUE_PREFIX + libraryCode;

export async function queuePrivacyConsent(libraryCode, record) {
  if (!libraryCode || libraryCode !== getUid()) throw new Error('The active library changed before consent could be saved.');
  const key = consentQueueKey(libraryCode);
  const queued = JSON.parse((await AsyncStorage.getItem(key)) || '[]');
  if (!Array.isArray(queued)) throw new Error('The saved consent queue could not be read.');
  const next = [...queued.filter((entry) => entry.sessionId !== record.sessionId), record];
  await AsyncStorage.setItem(key, JSON.stringify(next));
  if (libraryCode !== getUid()) throw new Error('The active library changed before consent could be saved.');
}

export async function removeQueuedPrivacyConsent(libraryCode, sessionId) {
  if (!libraryCode || libraryCode !== getUid()) return;
  const key = consentQueueKey(libraryCode);
  const queued = JSON.parse((await AsyncStorage.getItem(key)) || '[]');
  if (!Array.isArray(queued)) throw new Error('The saved consent queue could not be read.');
  const next = queued.filter((record) => record.sessionId !== sessionId);
  if (next.length) await AsyncStorage.setItem(key, JSON.stringify(next));
  else await AsyncStorage.removeItem(key);
}

export async function getQueuedPrivacyConsent(libraryCode, sessionId, lectureId, courseId) {
  if (!libraryCode || libraryCode !== getUid() || !sessionId || !lectureId || !courseId) return null;
  const queued = JSON.parse((await AsyncStorage.getItem(consentQueueKey(libraryCode))) || '[]');
  if (!Array.isArray(queued)) throw new Error('The saved consent queue could not be read.');
  if (libraryCode !== getUid()) return null;
  const record = queued.find((entry) =>
    entry?.sessionId === sessionId && entry?.lectureId === lectureId && entry?.courseId === courseId);
  if (!record || !record.version || !Array.isArray(record.statements) || record.statements.length !== 2 ||
      record.statements.some((statement) => typeof statement !== 'string' || !statement)) return null;
  return record;
}

export function flushPrivacyConsents(libraryCode, getToken) {
  if (!libraryCode || libraryCode !== getUid()) return Promise.resolve();
  const existing = consentFlushes.get(libraryCode);
  if (existing?.promise) return existing.promise;
  if (existing?.retryAt > Date.now()) return Promise.reject(existing.error);
  const state = { promise: null, retryAt: 0, error: null };
  const promise = flushQueuedPrivacyConsents(libraryCode, getToken).then(
    () => { if (consentFlushes.get(libraryCode) === state) consentFlushes.delete(libraryCode); },
    error => {
      state.error = error;
      state.retryAt = Date.now() + 30000;
      throw error;
    },
  ).finally(() => { state.promise = null; });
  state.promise = promise;
  consentFlushes.set(libraryCode, state);
  return promise;
}

async function flushQueuedPrivacyConsents(libraryCode, getToken) {
  if (!libraryCode || libraryCode !== getUid()) return;
  const key = consentQueueKey(libraryCode);
  const queued = JSON.parse((await AsyncStorage.getItem(key)) || '[]');
  if (!Array.isArray(queued)) throw new Error('The saved consent queue could not be read.');
  const remaining = [];
  for (const record of queued) {
    if (libraryCode !== getUid()) return;
    try {
      await savePrivacyConsent(record, getToken, libraryCode);
    } catch (error) {
      if (libraryCode !== getUid()) return;
      remaining.push(record);
      // Preserve the original record exactly for idempotent retry.
      remaining.push(...queued.slice(queued.indexOf(record) + 1));
      await AsyncStorage.setItem(key, JSON.stringify(remaining));
      throw error;
    }
  }
  if (libraryCode === getUid()) {
    if (remaining.length) await AsyncStorage.setItem(key, JSON.stringify(remaining));
    else await AsyncStorage.removeItem(key);
  }
}

export async function removeLectureConsents(libraryCode, lectureId) {
  if (!libraryCode || !lectureId) return;
  const key = consentQueueKey(libraryCode);
  const queued = JSON.parse((await AsyncStorage.getItem(key)) || '[]');
  if (Array.isArray(queued)) {
    const next = queued.filter((record) => record.lectureId !== lectureId);
    if (next.length) await AsyncStorage.setItem(key, JSON.stringify(next));
    else await AsyncStorage.removeItem(key);
  }
}