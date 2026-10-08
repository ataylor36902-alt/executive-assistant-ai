import { getServer, getUid } from './api';

const processingPath = /^(?:\/api\/ai(?:\/.*)?|\/api\/support|\/api\/transcribe|\/api\/classscribe\/ask|\/api\/schedule\/import-preview|\/api\/study-plans\/import|\/api\/courses\/[^/]+\/(?:study-guide|syllabus\/(?:upload|preview))|\/api\/lectures\/[^/]+\/(?:transcribe|analyze)|\/api\/edu\/courses\/[^/]+\/lectures\/[^/]+\/transcribe)\/?$/i;
export const needsAiConsent = (path) => processingPath.test(path);
let prompt;
let pending;
export function installAiConsentPrompt(handler) {
  prompt = handler;
  return () => { if (prompt === handler) prompt = null; };
}

export async function aiConsentRequest(method = 'GET', body, libraryCode = getUid(), server = getServer()) {
  if (!server || !libraryCode || libraryCode !== getUid() || server !== getServer()) throw new Error('The library or server changed. Reopen the feature and try again.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try { response = await fetch(server + '/api/privacy/ai-consent', {
    method, headers: { 'X-CS-User': libraryCode, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    signal: controller.signal,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }); } catch {
    throw new Error('Could not confirm AI permission. No processing request was started; check your connection and try again.');
  } finally { clearTimeout(timeout); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not confirm AI permission. Try again when connected.');
  if (libraryCode !== getUid() || server !== getServer()) throw new Error('The library or server changed while permission was being checked.');
  if (typeof result.version !== 'string' || typeof result.notice !== 'string' || typeof result.accepted !== 'boolean') throw new Error('The AI permission response was invalid.');
  return result;
}

export async function ensureAiConsent() {
  const libraryCode = getUid();
  const server = getServer();
  const key = `${server}:${libraryCode}`;
  if (pending?.key === key) return pending.promise;
  const promise = (async () => {
    const state = await aiConsentRequest('GET', undefined, libraryCode, server);
    if (state.accepted) return;
    if (!prompt) throw new Error('Open Privacy controls to review AI-sharing permission.');
    const accepted = await prompt(state);
    if (!accepted) throw Object.assign(new Error('AI sharing was declined. No processing request was started.'), { code: 'ai_consent_declined' });
    const result = await aiConsentRequest('POST', { version: state.version, accepted: true }, libraryCode, server);
    if (!result.accepted) throw new Error('The server did not confirm AI permission.');
  })();
  pending = { key, promise };
  try { await promise; } finally { if (pending?.promise === promise) pending = null; }
}
