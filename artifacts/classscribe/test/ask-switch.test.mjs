import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const screen = fs.readFileSync(new URL('../web-src/6_study_social.js', import.meta.url), 'utf8');
const platform = fs.readFileSync(new URL('../web-public/platform.js', import.meta.url), 'utf8');
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const groupA = 'g_' + 'a'.repeat(32);
const groupB = 'g_' + 'b'.repeat(32);

function harness() {
  const library = uid => ({
    uid, mode: 'db', view: { name: 'ask' },
    courses: { c: { id: 'c', code: 'BIO', name: 'Biology', groupCode: groupA }, other: { id: 'other', code: 'CHEM', name: 'Chemistry', groupCode: groupB } },
    lectures: { old: { id: 'old', courseId: 'c', title: 'Old transcript', segs: [{ x: 'secret mitochondria transcript', t: 12 }] } },
    notes: { note: { id: 'note', courseId: 'c', title: 'Private', body: 'secret mitochondria note' } },
    assignments: {}, stats: {},
  });
  const calls = [];
  const aiReply = deferred();
  const elements = { '#ask-in': { value: 'mitochondria' }, '#ask-live': { innerHTML: '' }, '#ask-status': { textContent: '' } };
  const ctx = {
    S: library('u_old'), ACT: {}, VIEWS: {}, AFTER: {}, AbortController, window: { addEventListener() {} },
    $: key => elements[key], render() {}, md: text => text, clearInterval, setInterval: () => 1,
    billingUserCode: () => ctx.S.uid, AI: async () => async (turns, opts) => {
      calls.push({ turns, opts });
      return aiReply.promise;
    },
    tokens: text => text.toLowerCase().split(/\s+/),
    scoreText: (text, toks) => toks.some(t => String(text).toLowerCase().includes(t)) ? 1 : 0,
    course: id => ctx.S.courses[id], lecturesOf: id => Object.values(ctx.S.lectures).filter(l => l.courseId === id),
    gradesAccess: () => 'allowed', gradesRequest: async () => ({ courses: [] }),
    DB: null, todayISO: () => '2026-09-28', askPortrait: () => '',
    fetch: async () => ({
      ok: true,
      json: async () => ({
        hits: [{ kind: 'lecture', id: 'old', courseId: 'c', title: 'Old transcript', text: 'secret mitochondria transcript', seconds: 12 }],
        coverage: { partial: false }, notice: '',
      }),
    }),
    askVoiceUI() {}, cancelAskVoice() {}, aiErr() {},
  };
  vm.createContext(ctx);
  vm.runInContext(screen.slice(screen.indexOf('const CHAT='), screen.indexOf('/* ---------- TUTOR')), ctx);
  return { ctx, elements, calls, aiReply, library };
}

test('web Ask drops a delayed AI answer after a library or course switch', async () => {
  for (const change of ['library', 'course']) {
    const { ctx, calls, aiReply, library } = harness();
    const pending = ctx.sendAsk();
    await tick();
    assert.equal(calls.length, 1);
    const oldTool = calls[0].opts.tools.find(t => t.name === 'search_evidence');
    assert.match(JSON.stringify(await oldTool.execute({ query: 'mitochondria' })), /secret mitochondria/);
    if (change === 'library') ctx.S = library('u_new');
    else vm.runInContext("CHAT.scope='other';CHAT.epoch++", ctx);
    assert.doesNotMatch(JSON.stringify(await oldTool.execute({ query: 'mitochondria' })), /secret mitochondria/);
    aiReply.resolve({ text: 'secret mitochondria note' });
    await pending;
    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(vm.runInContext('CHAT.turns', ctx)), /secret mitochondria/);
  }
});

test('web semantic search discards pending results and coverage after a library switch', async () => {
  const { ctx, library } = harness();
  const held = deferred();
  let payload;
  ctx.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: () => held.promise };
  };
  const context = vm.runInContext("CHAT.scope='c';CHAT.context={uid:S.uid,billingCode:S.uid,epoch:CHAT.epoch};CHAT.context", ctx);
  const tool = ctx.askTools('c', context).find(t => t.name === 'search_evidence');
  const pending = tool.execute({ query: 'cellular energy production', courseId: 'other' });
  assert.equal((await pending).hits.length, 0, 'tool input cannot broaden selected scope');
  const result = tool.execute({ query: 'cellular energy production' });
  await tick();
  assert.deepEqual(payload.courseIds, ['c']);
  ctx.S = library('u_new');
  held.resolve({ hits: [{ kind: 'note', id: 'note', text: 'secret mitochondria note' }], notice: 'Old library partial search' });
  assert.doesNotMatch(JSON.stringify(await result), /secret mitochondria|Old library/);
  assert.equal(vm.runInContext('CHAT.coverage', ctx), '');
});

test('web collaboration uses selected invite capability and rejects mixed group results', async () => {
  const { ctx } = harness();
  ctx.S.mode = 'db';
  ctx.DB = {
    collection: () => ({ where: (_field, _op, code) => ({
      get: async () => ({ docs: [{ data: () => ({ code, text: 'allowed discussion', title: 'allowed lecture' }) }, { data: () => ({ code: groupB, text: 'foreign discussion', title: 'foreign lecture' }) }] }),
    }) }),
    doc: () => ({ get: async () => ({ exists: true, data: () => ({ code: groupA, text: 'allowed notebook' }) }) }),
  };
  const context = vm.runInContext("CHAT.scope='c';CHAT.context={uid:S.uid,billingCode:S.uid,epoch:CHAT.epoch};CHAT.context", ctx);
  const tool = ctx.askTools('c', context).find(t => t.name === 'class_collaboration');
  const allowed = JSON.stringify(await tool.execute({}));
  assert.match(allowed, /allowed discussion|allowed notebook/);
  assert.match(allowed, /allowed lecture/);
  assert.doesNotMatch(allowed, /foreign/);
  ctx.S.courses.c.groupCode = 'invalid';
  assert.doesNotMatch(JSON.stringify(await tool.execute({})), /allowed|foreign/);
  ctx.S.courses.c.groupCode = groupA;
  const read = deferred();
  ctx.DB.collection = () => ({ where: () => ({ get: () => read.promise }) });
  const pending = tool.execute({});
  ctx.S = { ...ctx.S, uid: 'u_new' };
  read.resolve({ docs: [] });
  assert.doesNotMatch(JSON.stringify(await pending), /allowed|foreign/);
});

test('web Ask discards a grade read completed after a library switch', async () => {
  const { ctx } = harness();
  const held = deferred();
  ctx.gradesRequest = () => held.promise;
  const context = vm.runInContext("CHAT.scope='c';CHAT.context={uid:S.uid,billingCode:S.uid,epoch:CHAT.epoch};CHAT.context", ctx);
  const tool = ctx.askTools('c', context).find(t => t.name === 'student_gradebook_results');
  const pending = tool.execute({});
  ctx.S.uid = 'u_new';
  held.resolve({ courses: [{ courseId: 'c', gradebook: { items: [{ title: 'secret grade', type: 'quiz', earned: 90 }] } }] });
  assert.doesNotMatch(JSON.stringify(await pending), /secret grade/);
});

test('web AI loop does not send a second request with stale tool output after abort', async () => {
  const aiSource = platform.slice(platform.indexOf('async function callAI('), platform.indexOf('window.CS_BASIC_ANALYZE'));
  const held = deferred();
  const requests = [];
  const context = { api: async (_path, payload) => {
    requests.push(payload);
    return requests.length === 1
      ? { content: [{ type: 'tool_use', name: 'private', id: 'tool-1', input: {} }], stop_reason: 'tool_use' }
      : { content: [{ type: 'text', text: 'unexpected' }], stop_reason: 'end_turn' };
  } };
  vm.createContext(context);
  vm.runInContext(aiSource, context);
  const controller = new AbortController();
  const pending = context.callAI([{ role: 'user', content: 'question' }], {
    signal: controller.signal, tools: [{ name: 'private', execute: () => held.promise }],
  });
  await tick();
  controller.abort();
  held.resolve('secret old note and grade');
  await assert.rejects(pending, error => error.code === 'cancelled');
  assert.equal(requests.length, 1);
});