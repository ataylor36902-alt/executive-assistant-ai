// Provides the app's platform services (database, AI, user id, file saving)
// on top of this Replit server. Loaded before the app script.
(function () {
  let uid = null;
  try { uid = localStorage.getItem('cs_device_uid'); } catch (e) {}
  if (!uid) {
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    uid = 'u_' + Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');
    try { localStorage.setItem('cs_device_uid', uid); } catch (e) {}
  }
  const api = (url, body) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CS-User': uid }, body: JSON.stringify(body || {}),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error = { code: j.code || 'unavailable', message: j.error || r.statusText };
      if (error.code === 'not_granted' && error.message === 'This sync code has been replaced') markSyncCodeReplaced();
      throw error;
    }
    return j;
  });

  let syncCodeReplaced = false;
  function markSyncCodeReplaced() {
    if (syncCodeReplaced) return;
    syncCodeReplaced = true;
    setTimeout(() => window.dispatchEvent(new Event('cs-sync-code-replaced')), 0);
  }
  const pendingKey = (code) => `cs_sync_pending_v1_${code}`;
  const volatilePending = new Map();
  const clearedPending = new Map();
  const pendingMap = (store, code) => {
    if (!store.has(code)) store.set(code, new Map());
    return store.get(code);
  };
  const readPending = (code = uid) => {
    let pending = {};
    try {
      const value = JSON.parse(localStorage.getItem(pendingKey(code)) || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) pending = value;
    } catch (e) {}
    for (const path of pendingMap(clearedPending, code).keys()) delete pending[path];
    for (const [path, operation] of pendingMap(volatilePending, code)) pending[path] = operation;
    return pending;
  };
  let mutationSequence = Date.now() * 1000;
  const latestMutation = new Map();
  const activeWrites = new Set();
  function rememberPending(path, type, data, token, code) {
    const operation = { path, type, data, token };
    const pending = readPending(code);
    pending[path] = operation;
    pendingMap(clearedPending, code).delete(path);
    pendingMap(volatilePending, code).set(path, operation);
    try {
      localStorage.setItem(pendingKey(code), JSON.stringify(pending));
      pendingMap(volatilePending, code).delete(path);
    }
    catch (e) { throw new Error('This change could not be saved in browser storage. Keep this page open and try again.'); }
  }
  function clearPending(path, token, code = uid) {
    const pending = readPending(code);
    if (!pending[path] || Number(pending[path].token) > token) return;
    delete pending[path];
    pendingMap(volatilePending, code).delete(path);
    try {
      localStorage.setItem(pendingKey(code), JSON.stringify(pending));
      pendingMap(clearedPending, code).delete(path);
    } catch (e) {
      pendingMap(clearedPending, code).add(path);
    }
  }
  async function writeWithQueue(path, type, data) {
    const code = uid;
    const token = Math.max(mutationSequence, Date.now() * 1000) + 1;
    mutationSequence = token;
    latestMutation.set(path, token);
    const write = (async () => {
      try {
        const result = await api(type === 'delete' ? '/api/db/delete' : type === 'update' ? '/api/db/update' : '/api/db/set',
          { path, ...(type === 'delete' ? {} : { data }) });
        if (latestMutation.get(path) === token) clearPending(path, token, code);
        return result;
      } catch (error) {
        if (latestMutation.get(path) === token) rememberPending(path, type, data, token, code);
        throw error;
      }
    })();
    activeWrites.add(write);
    try {
      return await write;
    } finally {
      activeWrites.delete(write);
    }
  }
  function overlayPendingDocument(path, data) {
    const pending = readPending()[path];
    if (!pending) return data;
    if (pending.type === 'delete') return null;
    if (pending.type === 'update') return { ...(data || {}), ...(pending.data || {}) };
    return pending.data;
  }
  function overlayPendingCollection(path, result) {
    const docs = new Map((result.docs || []).map((document) => [document.id, document]));
    for (const operation of Object.values(readPending())) {
      if (operation.path.split('/').slice(0, -1).join('/') !== path) continue;
      const id = operation.path.split('/').pop();
      if (operation.type === 'delete') docs.delete(id);
      else {
        const previous = docs.get(id);
        const data = operation.type === 'update'
          ? { ...(previous && previous.data || {}), ...(operation.data || {}) }
          : operation.data;
        docs.set(id, { id, data });
      }
    }
    const merged = Array.from(docs.values());
    return { ...result, docs: merged, size: merged.length, empty: merged.length === 0 };
  }
  function rewritePendingPath(path, oldCode, newCode) {
    if (path === `members/${oldCode}`) return `members/${newCode}`;
    const oldPrefix = `data/users/${oldCode}/`;
    return path.startsWith(oldPrefix) ? `data/users/${newCode}/${path.slice(oldPrefix.length)}` : path;
  }
  /* ---- database ---- */
  const watchers = new Set();
  function watch(fetcher, cb, err) {
    const w = { fetcher, cb, err, last: null };
    watchers.add(w); run(w);
    return () => watchers.delete(w);
  }
  function run(w) {
    return w.fetcher().then((r) => { const s = JSON.stringify(r); if (s !== w.last) { w.last = s; w.cb(r); } })
      .catch((e) => { if (w.err) w.err(e); });
  }
  let bumpT = null;
  const bump = () => { clearTimeout(bumpT); bumpT = setTimeout(() => watchers.forEach(run), 60); };
  setInterval(() => { if (!document.hidden) watchers.forEach(run); }, 4000);
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const snapDoc = (p, d) => ({ id: p.split('/').pop(), exists: d != null, data: () => (d == null ? undefined : JSON.parse(JSON.stringify(d))), metadata: { fromCache: false, hasPendingWrites: false } });
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p,
      get: (groupCode) => api('/api/db/get', { path: p, ...(groupCode ? { groupCode } : {}) }).then((r) => snapDoc(p, overlayPendingDocument(p, r.data))),
      set: (data) => writeWithQueue(p, 'set', data).then(() => { bump(); }),
      update: (data) => writeWithQueue(p, 'update', data).then(() => { bump(); }),
      delete: () => writeWithQueue(p, 'delete').then(() => { bump(); }),
      onSnapshot: (next, err) => watch(
        () => api('/api/db/get', { path: p }).then((r) => ({ data: overlayPendingDocument(p, r.data) })),
        (r) => next(snapDoc(p, r.data)), err),
      collection: (c) => colRef(p + '/' + c),
    };
  }
  function query(p, where) {
    const mk = (r) => { const docs = r.docs.map((d) => snapDoc(p + '/' + d.id, d.data)); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; };
    const q = {
      where: (f, op, v) => query(p, where.concat([[f, op, v]])),
      orderBy: () => q, limit: () => q,
      get: () => api('/api/db/list', { path: p, where }).then((r) => mk(overlayPendingCollection(p, r))),
      onSnapshot: (next, err) => watch(() => api('/api/db/list', { path: p, where }).then((r) => overlayPendingCollection(p, r)), (r) => next(mk(r)), err),
    };
    return q;
  }
  function colRef(p) {
    return Object.assign(query(p, []), {
      path: p,
      doc: (id) => docRef(p + '/' + (id || rid())),
      add: (data) => { const r = docRef(p + '/' + rid()); return r.set(data).then(() => r); },
    });
  }
  const db = { doc: docRef, collection: colRef };

  /* ---- AI ---- */
  const blobToB64 = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res({ type: (fr.result.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg', data: String(fr.result).split(',')[1] }); fr.onerror = rej; fr.readAsDataURL(b); });
  async function callAI(input, opts) {
    opts = opts || {};
    const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map((m) => ({ role: m.role, content: m.content }));
    if (opts.images) {
      const list = opts.images instanceof Blob ? [opts.images] : Array.from(opts.images);
      const imgs = await Promise.all(list.map(blobToB64));
      const last = messages[messages.length - 1];
      last.content = imgs.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.type, data: i.data } })).concat([{ type: 'text', text: String(last.content) }]);
    }
    const tools = (opts.tools || []).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }));
    for (let round = 0; round < 8; round++) {
      if (opts.signal && opts.signal.aborted) throw { code: 'cancelled', message: 'Stopped' };
      const r = await api(opts.askId ? '/api/ai/ask' : '/api/ai', {
        messages, tools, tier: opts.modelTier, ...(opts.askId ? { askId: opts.askId } : {}),
      });
      if (opts.signal && opts.signal.aborted) throw { code: 'cancelled', message: 'Stopped' };
      const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const uses = r.content.filter((b) => b.type === 'tool_use');
      if (!uses.length || r.stop_reason !== 'tool_use') {
        if (opts.onText) opts.onText({ text, delta: text });
        return { text, truncated: r.stop_reason === 'max_tokens', modelTierApplied: opts.modelTier || 'default' };
      }
      messages.push({ role: 'assistant', content: r.content });
      const results = [];
      for (const u of uses) {
        const t = (opts.tools || []).find((x) => x.name === u.name);
        let out, isErr = false;
        try { out = t ? await t.execute(u.input || {}, { signal: opts.signal }) : 'Unknown tool'; } catch (e) { out = String((e && e.message) || e); isErr = true; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out), is_error: isErr });
      }
      messages.push({ role: 'user', content: results });
    }
    throw { code: 'unavailable', message: 'The AI took too many steps.' };
  }
  window.CS_BASIC_ANALYZE = (transcript, date, difficulty) =>
    api('/api/ai/basic-analysis', { transcript, date, difficulty });
  window.CS_CLEAN_NOTE = (text) => api('/api/ai/clean-note', { text }).then((result) => result.text);
  window.CS_STUDY = (operation, data) => api('/api/ai/study/' + operation, data);
  function parseJSON(t) {
    t = String(t).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (e) {}
    const a = Math.min(...['{', '['].map((c) => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
    const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (a !== Infinity && b > a) return JSON.parse(t.slice(a, b + 1));
    throw { code: 'transform_error', message: 'The AI reply wasn’t valid JSON.' };
  }
  const sample = Object.assign((i, o) => callAI(i, o), {
    json: async (i, o) => parseJSON((await callAI(typeof i === 'string' ? i + '\n\nReply with the JSON only.' : i, o)).text),
    limits: async () => ({ images: true, maxPromptBytes: 400000 }),
  });

  /* ---- user, downloads ---- */
  const user = {
    id: async () => uid, me: async () => ({ id: uid, name: '', email: null, isMe: true }),
    isOwner: () => true, canEdit: () => true, can: () => true, profiles: async () => ({}),
  };
  const downloads = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return { status: 'saved' };
    },
  };
  const caps = { db, sample, user, downloads };
  async function verifySyncCode(code) {
    const response = await fetch('/api/db/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CS-User': code },
      body: JSON.stringify({ path: `data/users/${code}/profile` }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not check that sync code. Try again.');
    if (!result.data || !result.data.firstName) throw new Error('That code did not open a library. Check it and try again.');
  }
  async function flushPendingWrites() {
    for (const operation of Object.values(readPending())) {
      try {
        const url = operation.type === 'delete' ? '/api/db/delete' : operation.type === 'update' ? '/api/db/update' : '/api/db/set';
        await api(url, { path: operation.path, ...(operation.type === 'delete' ? {} : { data: operation.data }) });
        clearPending(operation.path, Number(operation.token) || 0);
        bump();
      } catch (e) {
        // Keep failed changes locally and retry after the next connection or page load.
      }
    }
  }
  function carryPendingToReplacement(oldCode, newCode) {
    const source = readPending(oldCode);
    const destination = readPending(newCode);
    for (const operation of Object.values(source)) {
      const path = rewritePendingPath(operation.path, oldCode, newCode);
      const data = operation.data && typeof operation.data === 'object'
        ? { ...operation.data, ...(operation.data.by === oldCode ? { by: newCode } : {}) }
        : operation.data;
      const existing = destination[path];
      if (!existing || Number(operation.token) >= Number(existing.token)) {
        destination[path] = { ...operation, path, data };
      }
    }
    try {
      if (Object.keys(destination).length) localStorage.setItem(pendingKey(newCode), JSON.stringify(destination));
      const fromProfile = `cs_pending_profile_v2_${oldCode}`;
      const toProfile = `cs_pending_profile_v2_${newCode}`;
      const oldPatch = JSON.parse(localStorage.getItem(fromProfile) || '{}');
      const newPatch = JSON.parse(localStorage.getItem(toProfile) || '{}');
      if (oldPatch && typeof oldPatch === 'object' && !Array.isArray(oldPatch) && Object.keys(oldPatch).length) {
        localStorage.setItem(toProfile, JSON.stringify({ ...newPatch, ...oldPatch }));
      }
    } catch (e) {
      throw new Error('Could not preserve this browser’s saved changes. Keep this page open and try again.');
    }
  }
  // Transcribe a captured audio clip on the server (lectures or spoken questions).
  window.CS_TRANSCRIBE = async (blob, { timed = true } = {}) => {
    if (blob.size > 25 * 1024 * 1024) throw { code: 'too_large', message: 'Recording is over the 25 MB transcription limit.' };
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
    const type = blob.type || 'audio/webm';
    const ext = type.includes('mp4') || type.includes('aac') ? 'm4a' : type.includes('mpeg') ? 'mp3' : type.includes('wav') ? 'wav' : type.includes('ogg') ? 'ogg' : 'webm';
    const r = await api('/api/transcribe', { audio: b64, filename: (timed ? 'lecture.' : 'question.') + ext, mime: type, timed });
    return r.segments || [];
  };
  // Sync code: lets a phone (or another browser) open the same library.
  window.CS_SYNC = {
    code: uid,
    get replaced() { return syncCodeReplaced; },
    use: async (code) => {
      if (pendingMap(volatilePending, uid).size) {
        throw new Error('This change could not be saved in browser storage. Keep this page open and free browser storage before switching libraries.');
      }
      await verifySyncCode(code);
      await Promise.all([...activeWrites].map((write) => write.catch(() => {})));
      if (syncCodeReplaced) carryPendingToReplacement(uid, code);
      localStorage.setItem('cs_device_uid', code);
      localStorage.removeItem('cs_profile');
      localStorage.removeItem('cs_lib');
      uid = code;
      syncCodeReplaced = false;
      location.reload();
    },
    rotate: async () => {
      await Promise.all([...activeWrites].map((write) => write.catch(() => {})));
      const saved = localStorage.getItem('cs_rotation');
      let pending = null;
      try { pending = saved && JSON.parse(saved); } catch (e) {}
      const retryingRotation = !!(pending && pending.old === uid && pending.next);
      // Keep profile edits in the old library namespace before the server moves it.
      // If the device is offline, a first rotation is refused. During recovery
      // from an ambiguous prior request, keep the patch and move it after the
      // idempotent rotation succeeds.
      if (window.CS_FLUSH_PROFILE_PATCHES) {
        try { await window.CS_FLUSH_PROFILE_PATCHES(uid); }
        catch (e) { if (!retryingRotation) throw e; }
      }
      await flushPendingWrites();
      const privatePrefix = `data/users/${uid}/`;
      const unsavedLibraryChanges = Object.keys(readPending()).some((path) =>
        path.startsWith(privatePrefix) || path === `members/${uid}`);
      if (unsavedLibraryChanges) {
        throw new Error('Some library changes are still saved only in this browser. Reconnect and try replacing the code again.');
      }
      let nextCode = pending && pending.old === uid ? pending.next : null;
      if (!nextCode) {
        const bytes = new Uint8Array(20);
        crypto.getRandomValues(bytes);
        nextCode = 'u_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      }
      // Retain the proposed code across a lost response: retrying the same
      // request is safe even after the server committed the migration.
      localStorage.setItem('cs_rotation', JSON.stringify({ old: uid, next: nextCode }));
      await api('/api/db/rotate', { confirm: true, nextCode });
      carryPendingToReplacement(uid, nextCode);
      if (window.CS_MOVE_PROFILE_PATCHES) window.CS_MOVE_PROFILE_PATCHES(uid, nextCode);
      localStorage.setItem('cs_device_uid', nextCode);
      localStorage.removeItem('cs_rotation');
      localStorage.removeItem('cs_profile');
      localStorage.removeItem('cs_lib');
      location.reload();
    },
  };
  setTimeout(() => { flushPendingWrites(); }, 0);
  window.claude = { use: (name) => Promise.resolve(caps[name] || null) };
})();
