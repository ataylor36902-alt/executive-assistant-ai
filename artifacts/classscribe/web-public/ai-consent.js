/* Gates requests before content leaves the browser. The API independently enforces permission. */
(() => {
  const originalFetch = window.fetch.bind(window);
  const processingPath = /^(?:\/api\/ai(?:\/.*)?|\/api\/support|\/api\/transcribe|\/api\/classscribe\/ask|\/api\/schedule\/import-preview|\/api\/study-plans\/import|\/api\/courses\/[^/]+\/(?:study-guide|syllabus\/(?:upload|preview))|\/api\/lectures\/[^/]+\/(?:transcribe|analyze)|\/api\/edu\/courses\/[^/]+\/lectures\/[^/]+\/transcribe)\/?$/i;
  const pending = new Map();
  function currentLibrary() {
    return typeof S !== 'undefined' ? S.uid : '';
  }
  async function permission(headers, method = 'GET', body) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Accept', 'application/json');
    if (body) requestHeaders.set('Content-Type', 'application/json');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try { response = await originalFetch('/api/privacy/ai-consent', {
      method, headers: requestHeaders, credentials: 'include', cache: 'no-store',
      signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }); } catch {
      throw new Error('AI permission could not be confirmed. No processing request was started; check your connection and try again.');
    } finally { clearTimeout(timeout); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'AI permission could not be confirmed. Try again when connected.');
    if (typeof result.version !== 'string' || typeof result.notice !== 'string' || typeof result.accepted !== 'boolean') throw new Error('Invalid AI permission response.');
    return result;
  }
  function showNotice(state, manage = false) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.id = 'cs-ai-consent';
      dialog.setAttribute('aria-labelledby', 'cs-ai-consent-title');
      dialog.style.cssText = 'border:1px solid #94a89f;border-radius:18px;padding:24px;width:calc(100% - 32px);max-width:560px;max-height:85vh;overflow:auto;background:var(--cell,#fff);color:var(--ink,#172d27);box-sizing:border-box';
      const title = document.createElement('h2');
      title.id = 'cs-ai-consent-title';
      title.textContent = state.title;
      const copy = document.createElement('p');
      copy.style.cssText = 'white-space:pre-line;line-height:1.55';
      copy.textContent = state.notice;
      const policy = document.createElement('a');
      policy.href = '/privacy.html'; policy.target = '_blank'; policy.rel = 'noopener';
      policy.textContent = 'Read the Privacy Notice';
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin-top:22px';
      const finish = (choice) => { dialog.remove(); resolve(choice); };
      const allow = document.createElement('button');
      allow.type = 'button'; allow.className = 'btn';
      allow.style.cssText = 'padding:12px 18px;min-height:44px';
      allow.textContent = manage && state.accepted ? 'Withdraw AI permission' : 'Allow AI sharing';
      allow.onclick = () => finish(manage && state.accepted ? 'withdraw' : 'allow');
      const decline = document.createElement('button');
      decline.type = 'button'; decline.className = 'btn';
      decline.style.cssText = 'padding:12px 18px;min-height:44px';
      decline.textContent = manage && state.accepted ? 'Keep permission' : 'Not now';
      decline.onclick = () => finish('cancel');
      dialog.oncancel = (event) => { event.preventDefault(); finish('cancel'); };
      actions.append(allow, decline); dialog.append(title, copy, policy, actions);
      document.body.append(dialog); dialog.showModal(); decline.focus();
    });
  }
  async function ensure(headers, manage = false) {
    const code = headers.get('X-CS-User') || '';
    const userId = window.Clerk?.user?.id;
    const state = await permission(headers);
    if ((code && typeof S !== 'undefined' && currentLibrary() !== code) || window.Clerk?.user?.id !== userId) throw new Error('The active library changed. Reopen the feature and try again.');
    if (state.accepted && !manage) return;
    const choice = await showNotice(state, manage);
    if ((code && typeof S !== 'undefined' && currentLibrary() !== code) || window.Clerk?.user?.id !== userId) throw new Error('The active library changed. Reopen the feature and try again.');
    if (choice === 'cancel') {
      if (manage) return;
      throw new Error('AI sharing was declined. No processing request was started.');
    }
    const result = await permission(headers, 'POST', { version: state.version, accepted: choice === 'allow' });
    if ((code && typeof S !== 'undefined' && currentLibrary() !== code) || window.Clerk?.user?.id !== userId) throw new Error('The active library changed. Reopen the feature and try again.');
    if (choice === 'allow' && !result.accepted) throw new Error('The server did not confirm AI permission.');
    if (choice === 'withdraw' && result.accepted) throw new Error('The server did not confirm withdrawal. Retry when connected.');
  }
  window.fetch = async function(input, options = {}) {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin === window.location.origin && method === 'POST' && processingPath.test(url.pathname)) {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(options.headers).forEach((value, key) => headers.set(key, value));
      const key = headers.get('X-CS-User') || window.Clerk?.user?.id || headers.get('Authorization') || 'current-library';
      if (!pending.has(key)) pending.set(key, ensure(headers));
      const check = pending.get(key);
      try { await check; } finally { if (pending.get(key) === check) pending.delete(key); }
      if (options.signal?.aborted || (input instanceof Request && input.signal.aborted)) throw new DOMException('Request cancelled', 'AbortError');
    }
    return originalFetch(input, options);
  };
  window.CSAIConsent = {
    review: async () => {
      const headers = new Headers();
      if (currentLibrary()) headers.set('X-CS-User', currentLibrary());
      await ensure(headers, true);
    },
    ensure: async () => {
      const headers = new Headers();
      if (currentLibrary()) headers.set('X-CS-User', currentLibrary());
      await ensure(headers);
    },
  };
  // Web Speech can send audio directly to the device/browser speech provider,
  // without going through fetch. Apply the same permission before it starts.
  const speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (speech?.prototype?.start) {
    const start = speech.prototype.start;
    const generations = new WeakMap();
    speech.prototype.start = function() {
      const instance = this;
      const generation = (generations.get(instance) || 0) + 1;
      generations.set(instance, generation);
      window.CSAIConsent.ensure().then(() => {
        if (generations.get(instance) === generation) start.call(instance);
      }).catch((error) => {
        if (generations.get(instance) !== generation) return;
        const event = new Event('error');
        Object.assign(event, { error: 'not-allowed', message: error.message });
        instance.dispatchEvent(event);
      });
    };
    for (const method of ['stop', 'abort']) {
      const original = speech.prototype[method];
      if (original) speech.prototype[method] = function() {
        generations.set(this, (generations.get(this) || 0) + 1);
        return original.call(this);
      };
    }
  }
  // Account/legal views are rendered dynamically; keep the control reachable there.
  const mountControl = () => {
    document.querySelectorAll('a[href="/privacy.html"]').forEach((link) => {
      if (link.closest('#cs-ai-consent') || link.parentElement.querySelector('[data-ai-permission-control]')) return;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'btn';
      button.dataset.aiPermissionControl = 'true';
      button.style.cssText = 'margin:8px;min-height:44px';
      button.textContent = 'AI-sharing permission';
      button.onclick = () => window.CSAIConsent.review().catch((error) => window.alert(error.message));
      link.parentElement.append(button);
    });
  };
  document.addEventListener('DOMContentLoaded', () => {
    mountControl();
    new MutationObserver(mountControl).observe(document.body, { childList: true, subtree: true });
  });
})();
