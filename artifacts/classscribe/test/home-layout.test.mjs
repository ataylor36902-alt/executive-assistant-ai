import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const webSource = fs.readFileSync(new URL('../web-src/8_account.js', import.meta.url), 'utf8');
const webSubmitSource = fs.readFileSync(new URL('../web-src/6_study_social.js', import.meta.url), 'utf8');
const servedWeb = fs.readFileSync(new URL('../web-public/index.html', import.meta.url), 'utf8');
const mobileSource = fs.readFileSync(new URL('../../classscribe-mobile/lib/store.js', import.meta.url), 'utf8');
const mobileHome = fs.readFileSync(new URL('../../classscribe-mobile/app/(tabs)/home/index.js', import.meta.url), 'utf8');
const mobileAccount = fs.readFileSync(new URL('../../classscribe-mobile/app/account.js', import.meta.url), 'utf8');
const codeA = 'u_fictionalLibraryA123';
const codeB = 'u_fictionalLibraryB456';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

function server() {
  const records = new Map();
  const listeners = new Map();
  const requests = [];
  let online = true;
  let hold = false;
  const profile = uid => structuredClone(records.get(uid) || null);
  const notify = uid => {
    for (const fn of listeners.get(uid) || []) fn({ exists: !!profile(uid), data: () => profile(uid) });
  };
  return {
    profile, requests, notify,
    seed(uid, value) { records.set(uid, structuredClone(value)); },
    setOnline(value) { online = value; },
    setHold(value) { hold = value; },
    async get(uid) {
      if (!online) throw Error('offline');
      return profile(uid);
    },
    async update(uid, patch) {
      if (!online) throw Error('offline');
      const gate = deferred();
      const request = { uid, patch: structuredClone(patch), release: gate.resolve };
      requests.push(request);
      if (hold) await gate.promise;
      records.set(uid, { ...(records.get(uid) || {}), ...patch });
      notify(uid);
    },
    subscribe(uid, fn) {
      const group = listeners.get(uid) || new Set();
      group.add(fn);
      listeners.set(uid, group);
      fn({ exists: !!profile(uid), data: () => profile(uid) });
      return () => group.delete(fn);
    },
  };
}

function evaluateProfileForm(source, values, previous = {}) {
  const start = source.indexOf('function profileFields(p){');
  const end = source.indexOf('VIEWS.welcome=', start);
  assert.ok(start >= 0 && end > start, 'profile field/form readers must exist');
  const inputs = new Map(Object.entries(values).map(([key, value]) => ['#pf-' + key, { value }]));
  const ctx = {
    LEVELS: ['High School', 'College', 'Graduate'],
    $: key => inputs.get(key) || { value: '' },
    esc: value => String(value),
    curSemester: () => 'Fall 2026',
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  return {
    html: ctx.profileFields(previous),
    profile: JSON.parse(JSON.stringify(ctx.readProfileForm(previous))),
  };
}

function storage() {
  const entries = new Map();
  return {
    getItem: async key => entries.get(key) ?? null,
    setItem: async (key, value) => { entries.set(key, String(value)); },
    multiRemove: async keys => keys.forEach(key => entries.delete(key)),
    removeItem: async key => { entries.delete(key); },
    local: {
      getItem: key => entries.get(key) ?? null,
      setItem: (key, value) => { entries.set(key, String(value)); },
      removeItem: key => { entries.delete(key); },
    },
  };
}

function webClient(remote, cache, uid = codeA) {
  const S = { mode: 'db', uid, profile: null, view: { name: 'account' } };
  const inputs = new Map();
  const document = {
    querySelectorAll: () => [],
    querySelector: key => inputs.get(key) || null,
    addEventListener() {},
  };
  const ctx = {
    S, document, $: key => document.querySelector(key), localStorage: cache.local, window: { addEventListener() {} },
    DB: { doc: path => {
      const id = path.split('/')[2];
      return path.startsWith('members/') ? { set: async () => {} } : {
        get: async () => ({ exists: !!(await remote.get(id)), data: () => remote.profile(id) }),
        update: patch => remote.update(id, patch),
        onSnapshot: fn => remote.subscribe(id, fn),
      };
    } },
    VIEWS: {}, ACT: {}, AFTER: {}, Date, Promise, setTimeout,
    render() {}, esc: value => String(value), curSemester: () => 'Fall 2026', billingStatusPanel: () => '', examplesVisible: () => true,
    toast() {}, closeModal() {}, copyText() {},
  };
  vm.createContext(ctx);
  vm.runInContext(webSource, ctx, { filename: 'web-src/8_account.js' });
  return {
    state: S,
    load: () => vm.runInContext('loadProfile()', ctx),
    refresh: () => vm.runInContext('flushProfilePatches()', ctx),
    choose: value => vm.runInContext(`setHomeLayoutChoice(${JSON.stringify(value)})`, ctx),
    save: patch => { ctx.patch = patch; return vm.runInContext('saveProfile(patch)', ctx); },
    layout: () => vm.runInContext('homeLayoutValue()', ctx),
    account: () => ctx.VIEWS.account(),
    draft: values => {
      for (const [key, value] of Object.entries(values)) inputs.set('#pf-' + key, { value });
      if (!inputs.has('#pf-learning-mode')) inputs.set('#pf-learning-mode', { value: '' });
      return vm.runInContext('readProfileForm(ACCOUNT_FORM_BASELINE)', ctx);
    },
    switchTo: async next => {
      S.uid = next;
      await vm.runInContext('loadProfile()', ctx);
    },
  };
}

// Execute the actual StoreProvider profile callbacks with in-memory hooks and
// mocked platform IO. A missing source marker fails instead of testing a copy.
function mobileClient(remote, cache, initialUid = codeA) {
  let uid = initialUid;
  const S = { profile: null, appearance: 'auto' };
  const ref = value => ({ current: value });
  const ctx = {
    AsyncStorage: cache, db: {
      get: path => remote.get(path.split('/')[2]),
      update: (path, patch) => remote.update(path.split('/')[2], patch),
      set: async () => {},
      list: async () => [],
    },
    getUid: () => uid, apiSetUid: async next => { uid = next; await cache.setItem('cs_uid', next); },
    status: { syncCodeReplaced: false }, showEx: true,
    libraryCacheKey: id => `cs_cache_${id}`,
    libraryProfileKey: id => `cs_profile_v2_${id}`,
    libraryPendingProfileKey: id => `cs_pending_profile_v2_${id}`,
    legacyProfileMigratedKey: id => `cs_profile_migrated_v2_${id}`,
    validAppearance: value => ['auto', 'light', 'dark'].includes(value) ? value : 'auto',
    isReplacedSyncCodeError: () => false,
    checkLibrary: async () => true,
    useCallback: fn => fn, Date, Promise,
    profileRef: ref(null), profilePending: ref(new Map()), profileQueue: ref(Promise.resolve()),
    failedWrites: ref(new Map()), failedDeletes: ref(new Map()), mineRef: ref({}), writes: ref(new Set()),
    setProfile: p => { S.profile = p; },
    setAppearanceChoiceState: p => { S.appearance = p; },
    setShowExState() {},
    setMine() {}, setStatus() {}, empty: () => ({}),
    refresh: async () => true,
  };
  vm.createContext(ctx);
  const from = mobileSource.indexOf('  const loadProfile = useCallback(');
  const through = mobileSource.indexOf('  useEffect(() => { profileFlushRef.current', from);
  const saves = mobileSource.indexOf('  const saveProfile = useCallback(', through);
  const switchEnd = mobileSource.indexOf('  const replaceSyncCode = useCallback(', saves);
  assert.ok(from >= 0 && through > from && saves > through && switchEnd > saves);
  vm.runInContext(
    mobileSource.slice(from, through) + '\n' +
    mobileSource.slice(saves, switchEnd) + '\n' +
    'globalThis.actions = {loadProfile, flushProfilePatches, saveProfile, saveHomeLayoutChoice, switchLibrary};',
    ctx, { filename: 'classscribe-mobile/lib/store.js' },
  );
  return {
    state: S,
    get uid() { return uid; },
    load: () => ctx.actions.loadProfile(),
    refresh: () => ctx.actions.loadProfile().then(() => ctx.actions.flushProfilePatches()),
    choose: value => ctx.actions.saveHomeLayoutChoice(value),
    save: patch => ctx.actions.saveProfile(patch),
    switchTo: next => ctx.actions.switchLibrary(next),
  };
}

test('served browser page includes the profile and layout paths under test', () => {
  for (const signature of [
    'function homeLayoutValue()', 'async function flushProfilePatches(',
    'async function loadProfile()', 'async function setHomeLayoutChoice(',
    'function readProfileForm(', "ACT.homeLayoutPick=async el=>",
  ]) assert.ok(servedWeb.includes(signature), `missing from served page: ${signature}`);
  assert.ok(mobileHome.includes("const layout = ['class-first', 'study-first', 'simple'].includes(st.profile?.homeLayout)"));
});

test('source and served browser Account expose an optional, exact class-format profile field', () => {
  for (const [label, source] of [['source', webSource], ['served', servedWeb]]) {
    const unset = evaluateProfileForm(source, {
      first: 'Alex', last: '', school: '', level: 'College', major: '', term: 'Fall 2026', 'learning-mode': '',
    });
    assert.match(unset.html, /Class format/);
    assert.match(unset.html, /Online/);
    assert.match(unset.html, /In-person/);
    assert.match(unset.html, /syncs with this library across your devices and does not change billing/);
    assert.equal(Object.hasOwn(unset.profile, 'learningMode'), false, `${label}: unset remains unset`);

    for (const format of ['online', 'in-person']) {
      const selected = evaluateProfileForm(source, {
        first: 'Alex', last: '', school: '', level: 'College', major: '', term: 'Fall 2026', 'learning-mode': format,
      }, { firstName: 'Alex' });
      assert.equal(selected.profile.learningMode, format, `${label}: preserves exact format ${format}`);
    }
    const legacy = evaluateProfileForm(source, {
      first: 'Alex', last: '', school: '', level: 'College', major: '', term: 'Fall 2026', 'learning-mode': '',
    }, { firstName: 'Alex' });
    assert.equal(Object.hasOwn(legacy.profile, 'learningMode'), false, `${label}: legacy unset does not infer a format`);
  }

  const dirtyKeys = "['firstName','lastName','school','level','major','term','learningMode']";
  assert.ok(webSubmitSource.includes(dirtyKeys), 'source Account save includes learningMode in dirty-field comparison');
  assert.ok(servedWeb.includes(dirtyKeys), 'served Account save includes learningMode in dirty-field comparison');
});

test('class format syncs with the phone in the active library and partial saves preserve unrelated profile fields', async () => {
  const remote = server(), cache = storage();
  remote.seed(codeA, {
    firstName: 'Alex', level: 'College', homeLayout: 'study-first', appearance: 'dark',
    customProfileField: 'preserve me',
  });
  const web = webClient(remote, cache), phone = mobileClient(remote, cache);
  await web.load();
  await phone.load();

  await web.save({ learningMode: 'online' });
  await phone.refresh();
  assert.equal(phone.state.profile.learningMode, 'online');
  assert.equal(remote.profile(codeA).customProfileField, 'preserve me');
  assert.equal(remote.profile(codeA).homeLayout, 'study-first');
  assert.equal(remote.profile(codeA).appearance, 'dark');
  assert.deepEqual(remote.requests.at(-1).patch, { learningMode: 'online', updated: remote.requests.at(-1).patch.updated });

  await phone.save({ phoneOnlyProfileField: 'phone update' });
  await web.refresh();
  assert.equal(web.state.profile.phoneOnlyProfileField, 'phone update');
  await phone.save({ learningMode: 'in-person' });
  await web.refresh();
  assert.equal(web.state.profile.learningMode, 'in-person');
  assert.equal(remote.profile(codeA).customProfileField, 'preserve me');

  await web.switchTo(codeB);
  await web.save({ learningMode: 'online' });
  assert.equal(remote.profile(codeB).learningMode, 'online');
  assert.equal(remote.profile(codeA).learningMode, 'in-person', 'format writes do not escape the active sync-code library');
});

test('new libraries default to Class-first; web and phone share all three explicit choices in both directions', async () => {
  const remote = server(), web = webClient(remote, storage()), phone = mobileClient(remote, storage());
  await web.load();
  await phone.load();
  assert.equal(web.layout(), 'class-first');
  assert.equal(phone.state.profile?.homeLayout ?? 'class-first', 'class-first');
  assert.match(web.account(), /class-first.*aria-checked="true"/s);
  for (const [writer, reader, layout] of [
    [web, phone, 'study-first'], [phone, web, 'simple'], [web, phone, 'class-first'],
  ]) {
    await writer.choose(layout);
    if (reader === web) assert.equal(web.layout(), layout, 'live web snapshot propagates without reload');
    await reader.refresh();
    assert.equal(remote.profile(codeA).homeLayout, layout);
    assert.equal(web.layout(), layout);
    assert.equal(phone.state.profile.homeLayout, layout);
  }
});

test('rapid web and phone choices serialize writes and retain the final choice after delayed responses', async () => {
  for (const kind of ['web', 'phone']) {
    const remote = server(), client = kind === 'web' ? webClient(remote, storage()) : mobileClient(remote, storage());
    await client.load();
    remote.setHold(true);
    const first = client.choose('study-first');
    await tick();
    const second = client.choose('simple');
    assert.equal(remote.requests.length, 1, `${kind}: one in-flight profile write`);
    remote.requests[0].release();
    await tick();
    assert.equal(remote.requests.length, 2);
    remote.requests[1].release();
    await Promise.all([first, second]);
    assert.equal(remote.profile(codeA).homeLayout, 'simple');
    assert.equal(kind === 'web' ? client.layout() : client.state.profile.homeLayout, 'simple');
  }
});

test('offline choices persist across a reload, retry, and do not replay in another library', async () => {
  for (const kind of ['web', 'phone']) {
    const remote = server(), cache = storage();
    const make = () => kind === 'web' ? webClient(remote, cache) : mobileClient(remote, cache);
    const first = make();
    await first.load();
    remote.setOnline(false);
    await assert.rejects(first.choose('study-first'), /offline/);
    const reopened = make();
    await reopened.load();
    assert.equal(kind === 'web' ? reopened.layout() : reopened.state.profile.homeLayout, 'study-first');
    await reopened.switchTo(codeB);
    assert.equal(kind === 'web' ? reopened.layout() : reopened.state.profile?.homeLayout ?? 'class-first', 'class-first');
    remote.setOnline(true);
    await reopened.refresh();
    assert.equal(remote.profile(codeB), null);
    await reopened.switchTo(codeA);
    await reopened.refresh();
    assert.equal(remote.profile(codeA).homeLayout, 'study-first');
    assert.equal(kind === 'web' ? reopened.layout() : reopened.state.profile.homeLayout, 'study-first');
  }
});

test('remote layout updates preserve Account drafts and Account saves cannot replace the layout', async () => {
  const remote = server(), web = webClient(remote, storage()), phone = mobileClient(remote, storage());
  await web.load();
  await phone.load();
  await web.save({ firstName: 'Alex', school: 'Old school' });
  await phone.refresh();
  web.account(); // Opens Account and records its baseline.
  const values = { first: 'Alex', last: '', school: 'Unsaved school', level: 'College', major: '', term: 'Fall 2026' };
  const draft = web.draft(values);
  await phone.choose('simple');
  assert.equal(web.draft(values).school, 'Unsaved school', 'snapshot did not replace form inputs');
  assert.equal(web.layout(), 'simple');
  await web.save({ school: draft.school, homeLayout: 'class-first' });
  await phone.refresh();
  assert.equal(remote.profile(codeA).school, 'Unsaved school');
  assert.equal(remote.profile(codeA).homeLayout, 'simple');
  await web.choose('study-first');
  await phone.save({ firstName: 'Alex', school: 'Phone edit', homeLayout: 'class-first' });
  assert.equal(remote.profile(codeA).homeLayout, 'study-first');
  assert.equal(remote.profile(codeA).school, 'Phone edit');
});

test('simultaneous web Account and phone layout writes merge even when the layout response arrives first', async () => {
  const remote = server(), web = webClient(remote, storage()), phone = mobileClient(remote, storage());
  await web.load();
  await phone.load();
  remote.setHold(true);
  const accountWrite = web.save({ firstName: 'Alex', school: 'Campus' });
  const layoutWrite = phone.choose('study-first');
  await tick();
  assert.equal(remote.requests.length, 2);
  remote.requests[1].release();
  await layoutWrite;
  remote.requests[0].release();
  await accountWrite;
  await phone.refresh();
  assert.equal(remote.profile(codeA).homeLayout, 'study-first');
  assert.equal(remote.profile(codeA).school, 'Campus');
  assert.equal(web.layout(), 'study-first');
  assert.equal(phone.state.profile.school, 'Campus');
});

test('phone Account keeps drafts on remote updates but clears them when switching libraries', () => {
  const start = mobileAccount.indexOf('  useEffect(() => {\n    if (draftLibrary.current !== st.status.uid)');
  const end = mobileAccount.indexOf('  }, [st.status.uid, st.profile]);', start);
  assert.ok(start >= 0 && end > start, 'Account library-change effect must be present');
  let p = { firstName: 'Edited but unsaved', school: 'Library A draft' };
  const ctx = {
    st: { status: { uid: codeA }, profile: { firstName: 'Alex', homeLayout: 'class-first' } },
    draftLibrary: { current: codeA }, awaitingLibraryProfile: { current: false },
    profileBase: { current: { firstName: 'Alex' } },
    setP: next => { p = next; },
  };
  vm.createContext(ctx);
  const effect = vm.runInContext('(' + mobileAccount.slice(start, end).trim().replace(/^useEffect\(/, '') + '})', ctx);
  ctx.st.profile = { firstName: 'Alex', homeLayout: 'simple' };
  effect();
  assert.equal(p.school, 'Library A draft');
  ctx.st = { status: { uid: codeB }, profile: null };
  effect();
  assert.equal(p.school, undefined);
  ctx.st.profile = { firstName: 'Bea', homeLayout: 'study-first' };
  effect();
  assert.equal(p.firstName, 'Bea');
  assert.equal(ctx.profileBase.current.homeLayout, 'study-first');
});