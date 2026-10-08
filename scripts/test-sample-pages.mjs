import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Real web + Expo web screens, entirely disposable identities/storage. Intercept
// every API call (including unrecognized ones); never reach a student's database.
const webUrl = process.env.EXAMPLES_WEB_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/`;
const mobileUrl = process.env.EXAMPLES_MOBILE_URL || `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}/`;
if (webUrl.includes('undefined') || mobileUrl.includes('undefined')) throw new Error('Set EXAMPLES_WEB_URL and EXAMPLES_MOBILE_URL.');
const uid = 'u_SampleReadOnlyValidation123456';
const profile = { firstName: 'Regression', level: 'College', term: 'Fall 2026', showExamples: true, showExamplesUpdated: 1, planSelected: true };
const billing = {
  plan: 'student', status: 'active', features: { studyTools: true }, courseLimit: 20,
  recordingHoursLimit: 20, recordingHoursUsed: 0, recordingCountUsed: 0,
  recordingCountLimit: 100, transcriptionCountUsed: 0, transcriptionCountLimit: 100,
  billingSource: 'web', billingConflict: false,
};
const real = { id: 'test-real-course', ex: false, code: 'TEST 101', name: 'Disposable real course', meetings: [{ days: ['Mon'], start: '09:00', end: '09:50', location: 'Test room', type: 'Lecture' }] };
const errors = [], apiWrites = [], unexpected = [];
const docs = new Map([[`data/users/${uid}/profile`, profile], [`data/users/${uid}/lib/courses/${real.id}`, real]]);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
let activePage;
async function mockApi(route) {
  const req = route.request(), path = new URL(req.url()).pathname;
  let input = {};
  if (req.postData()) { try { input = req.postDataJSON(); } catch {} }
  const reply = json => route.fulfill({ json });
  if (path.startsWith('/api/db/')) {
    assert.equal(req.headers()['x-cs-user'], uid, 'database requests must belong to the disposable library');
    if (path.endsWith('/get')) return reply({ data: docs.get(input.path) || null });
    if (path.endsWith('/list')) return reply({ docs: [...docs].filter(([key]) => key.startsWith(input.path + '/')).map(([key, data]) => ({ id: key.split('/').at(-1), data })) });
    apiWrites.push({ path, input });
    assert.ok(!JSON.stringify(input).includes('ex-bio'), 'sample writes must never reach the API');
    if (path.endsWith('/set')) docs.set(input.path, input.data);
    else if (path.endsWith('/update')) docs.set(input.path, { ...docs.get(input.path), ...input.data });
    else if (path.endsWith('/delete')) docs.delete(input.path);
    else { unexpected.push(path); return route.fulfill({ status: 501, json: { error: 'Unexpected database operation' } }); }
    return reply({ ok: true });
  }
  if (path === '/api/health') return reply({ ok: true, ai: false, transcribe: false });
  if (path === '/api/billing/status') return reply(billing);
  if (path === '/api/student/grades/list') return reply({ courses: [], summary: {} });
  if (path === '/api/profile-photo') return route.fulfill({ status: 404, json: { error: 'No test photo' } });
  // Auxiliary account/credits availability is deliberately unavailable, not a
  // fake success. Unknown calls are recorded and fail the suite at the end.
  if (path.startsWith('/api/billing/') || path.startsWith('/api/credits/')) return route.fulfill({ status: 503, json: { error: 'Outside the isolated sample-page fixture' } });
  unexpected.push(path);
  return route.fulfill({ status: 501, json: { error: `Unexpected test API: ${path}` } });
}
async function noEdits(page, scope, forbidden) {
  const writable = scope.locator('input:not([type="search"]):not([readonly]):not([disabled]):visible,textarea:not([readonly]):not([disabled]):visible,select:not([disabled]):visible,[contenteditable="true"]:visible,[role="switch"]:visible');
  assert.deepEqual(await writable.evaluateAll(nodes => nodes.map(n => n.outerHTML)), [], 'sample content must have no writable fields');
  for (const name of forbidden) assert.equal(await scope.getByText(name, { exact: true }).filter({ visible: true }).count(), 0, `sample mutation control is absent: ${name}`);
}
async function back(page) {
  await page.getByRole('button', { name: 'Back', exact: true }).filter({ visible: true }).last().click();
}
try {
  const desktop = await browser.newContext({ viewport: { width: 1100, height: 900 }, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const phone = await browser.newContext({ viewport: { width: 400, height: 800 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  for (const ctx of [desktop, phone]) {
    await ctx.route('**/api/**', mockApi);
    ctx.on('page', page => {
      page.setDefaultTimeout(15000);
      // Metro may compile a cold Expo bundle after the workflow restarts.
      page.setDefaultNavigationTimeout(120000);
      page.on('pageerror', e => errors.push(e.message));
    });
  }
  await desktop.addInitScript(({ uid, profile }) => {
    if (window !== window.top || !/^https?:$/.test(location.protocol)) return;
    localStorage.setItem('cs_device_uid', uid);
    localStorage.setItem('cs_profile', JSON.stringify(profile));
  }, { uid, profile });
  await phone.addInitScript(({ uid, profile }) => {
    if (window !== window.top || !/^https?:$/.test(location.protocol)) return;
    localStorage.setItem('cs_uid', uid);
    localStorage.setItem(`cs_profile_v2_${uid}`, JSON.stringify(profile));
  }, { uid, profile });

  const web = await desktop.newPage(), mobile = await phone.newPage();
  activePage = web;
  await web.goto(webUrl, { waitUntil: 'domcontentloaded' });
  const intro = web.getByText('Tap anywhere to continue');
  if (await intro.isVisible()) await intro.click();
  await web.locator('#main .home-course[aria-label^="Open BIO 101"]').waitFor();
  await web.locator('#main .home-course[aria-label^="Open BIO 101"]').click();
  const main = web.locator('#main');
  await main.getByText('Introduction to Biology', { exact: true }).waitFor();
  await noEdits(web, main, ['Record', 'Edit times', 'Remove course', 'Import syllabus']);
  for (const tab of ['Assignments', 'Notes', 'Grades', 'I Missed Class', 'Lectures']) {
    const button = main.getByRole('tab', { name: new RegExp(`^${tab}`) });
    await button.click();
    assert.equal(await button.getAttribute('aria-selected'), 'true', `${tab} navigation works`);
    await noEdits(web, main, ['New note', 'New note for BIO 101', 'Add', 'Add score', 'Course settings']);
  }
  // A forced direct action must not open an editor even though its button is absent.
  await web.evaluate(() => ACT.editTimes({ dataset: { id: 'ex-bio' } }));
  assert.equal(await web.locator('#modal-root input').count(), 0, 'direct sample course-times action stays read-only');
  await main.getByText('Cells and the Cell Cycle', { exact: true }).click();
  await main.getByRole('tab', { name: 'Transcript', exact: true }).click();
  await noEdits(web, main, ['Analyze again', 'Delete lecture', 'Add transcript', 'New note']);
  for (const button of await main.getByRole('tab').all()) {
    await button.click();
    assert.equal(await button.getAttribute('aria-selected'), 'true');
    await noEdits(web, main, ['Analyze again', 'Delete lecture', 'New note']);
  }
  await main.getByRole('button', { name: /Flashcards/ }).click();
  await main.getByRole('heading', { name: /Flashcards/ }).waitFor();
  await main.getByRole('button', { name: 'Back', exact: true }).click();
  await main.getByRole('heading', { name: 'Cells and the Cell Cycle', exact: true }).waitFor();
  await web.evaluate(() => go({ name: 'course', id: 'ex-bio', tab: 'lectures' }));
  await main.getByText('Introduction to Biology', { exact: true }).waitFor();
  const writeCheck = await web.evaluate(async () => {
    const before = JSON.stringify(EX), mineBefore = JSON.stringify(COLS.map(col => S[col]));
    for (const col of COLS) for (const sample of Object.values(EX[col] || {})) {
      await put(col, { ...sample, ex: false, title: 'Illegal sample edit', courseId: 'test-real-course' });
      await del(col, sample.id);
    }
    return { unchanged: JSON.stringify(EX) === before, privateUnchanged: JSON.stringify(COLS.map(col => S[col])) === mineBefore };
  });
  assert.deepEqual(writeCheck, { unchanged: true, privateUnchanged: true }, 'actual bundled sample writes are blocked');
  const sampleNoteId = await web.evaluate(() => Object.values(EX.notes).find(n => n.courseId === 'ex-bio').id);
  await web.evaluate(id => go({ name: 'notes', courseId: 'ex-bio', id }), sampleNoteId);
  await main.locator('#note-title').waitFor();
  await noEdits(web, main, ['New note', 'Organize with AI', 'Pin', 'Delete']);
  await main.getByRole('tab', { name: 'Preview', exact: true }).click();
  await main.getByRole('tab', { name: 'Write', exact: true }).click();
  assert.equal(await main.locator('#note-title').getAttribute('readonly'), '');
  // Real editing through the visible times editor, followed by API acknowledgement.
  await web.evaluate(id => go({ name: 'course', id }), real.id);
  await main.getByText('Edit times', { exact: true }).click();
  // The location field is the only field with the fixture's room value.
  await web.locator('#modal-root [data-tm="location"]').fill('Edited web room');
  await web.locator('#modal-root').getByRole('button', { name: /Save/ }).click();
  await main.getByText(/Edited web room/).waitFor();
  assert.ok(apiWrites.some(w => w.input.data?.meetings?.some(m => m.location === 'Edited web room')), 'real web times edit reaches persistence');

  await mobile.goto(mobileUrl, { waitUntil: 'domcontentloaded' });
  activePage = mobile;
  await mobile.getByRole('button', { name: 'Open BIO 101, Introduction to Biology', exact: true }).click();
  await mobile.waitForURL('**/course/ex-bio');
  await mobile.getByText('Introduction to Biology', { exact: true }).last().waitFor();
  await noEdits(mobile, mobile.locator('body'), ['Record', 'Edit', 'Remove course', 'New note for BIO 101']);
  for (const tab of ['Assignments', 'Notes', 'Bookmarks', 'Lectures']) {
    const button = mobile.getByRole('tab', { name: new RegExp(`^${tab}`) }).filter({ visible: true }).last();
    const previous = await mobile.locator('body').innerText();
    await button.click();
    await mobile.waitForFunction(previous => document.body.innerText !== previous, previous);
    await noEdits(mobile, mobile.locator('body'), ['Confirm date', 'New note for BIO 101', 'Import source for BIO 101']);
  }
  await mobile.getByRole('button', { name: 'Grades for BIO 101', exact: true }).click();
  await mobile.getByText('Example courses are for exploring ClassScribe and are not editable gradebooks.').waitFor();
  await noEdits(mobile, mobile.locator('body'), ['Add score', 'Course settings', 'Save']);
  await back(mobile);
  await mobile.waitForURL('**/course/ex-bio');
  await mobile.getByText('Introduction to Biology', { exact: true }).last().waitFor();
  await mobile.getByRole('button', { name: /Mon.*9:00/ }).click();
  await mobile.waitForURL('**/course-times/ex-bio');
  await mobile.getByText(/Science Hall/).last().waitFor();
  await noEdits(mobile, mobile.locator('body'), ['Save class times', 'Add another time']);
  await back(mobile);
  await mobile.waitForURL('**/course/ex-bio');
  await mobile.getByText('Cells and the Cell Cycle', { exact: true }).last().click();
  await mobile.waitForURL('**/lecture/ex-bio-1');
  for (const tab of ['Transcript', 'Notes', 'Key points', 'Study']) {
    const button = mobile.getByRole('tab', { name: tab, exact: true }).filter({ visible: true }).last();
    const previous = await mobile.locator('body').innerText();
    await button.click();
    await mobile.waitForFunction(previous => document.body.innerText !== previous, previous);
    await noEdits(mobile, mobile.locator('body'), ['Analyze with AI', 'New note for this lecture', 'Add transcript', 'Transcribe saved audio']);
  }
  await mobile.getByRole('button', { name: /Flashcards/ }).click();
  await mobile.waitForURL('**/cards*');
  await mobile.getByText('Card 1 of 8', { exact: true }).last().waitFor();
  await back(mobile);
  await mobile.waitForURL('**/lecture/ex-bio-1');
  await mobile.getByLabel('More actions', { exact: true }).filter({ visible: true }).last().click();
  for (const name of ['Analyze again', 'Delete lecture', 'Share with class']) assert.equal(await mobile.getByText(name, { exact: true }).count(), 0);
  await mobile.getByText('Cancel', { exact: true }).click();
  await back(mobile);
  await mobile.waitForURL('**/course/ex-bio');
  await mobile.getByRole('tab', { name: /^Notes/ }).filter({ visible: true }).last().click();
  await mobile.getByText('Mitosis — my shorthand', { exact: true }).last().click();
  await mobile.waitForURL('**/note/ex-n1');
  await mobile.getByText('Mitosis — my shorthand', { exact: true }).last().waitFor();
  await noEdits(mobile, mobile.locator('body'), ['Edit', 'Organize', 'Restore my original']);
  await mobile.getByLabel('More', { exact: true }).filter({ visible: true }).last().click();
  for (const name of ['Pin to top', 'Unpin', 'Delete note']) assert.equal(await mobile.getByText(name, { exact: true }).count(), 0);
  await mobile.getByText('Cancel', { exact: true }).click();
  await back(mobile);
  await mobile.waitForURL('**/course/ex-bio');
  await mobile.getByText('Introduction to Biology', { exact: true }).last().waitFor();
  // Direct routes cover bookmarked/deep-linked times and notes, not just hidden UI.
  await mobile.goto(new URL('course-times/ex-bio', mobileUrl).href);
  await mobile.getByText(/Science Hall/).last().waitFor();
  await noEdits(mobile, mobile.locator('body'), ['Save class times', 'Add another time']);
  await mobile.goto(new URL(`course-times/${real.id}`, mobileUrl).href);
  await mobile.getByPlaceholder('Room, e.g. Science Hall 101').fill('Edited phone room');
  await mobile.getByText('Save class times', { exact: true }).click();
  await mobile.getByText(/Edited phone room/).waitFor();
  assert.ok(apiWrites.some(w => w.input.data?.meetings?.some(m => m.location === 'Edited phone room')), 'real mobile times edit reaches persistence');
  assert.deepEqual(unexpected, [], 'fixture must explicitly handle every API request');
  assert.deepEqual(errors, [], 'both apps must render without uncaught errors');
  console.log('Sample-page regression passed: web and Expo web course, lecture, note, times, Grades, tabs, Back, menus and real-course editing.');
} catch (error) {
  console.error('Sample-page failure at', activePage?.url(), '\n', await activePage?.locator('body').innerText());
  console.error('Tabs:', await activePage?.getByRole('tab').evaluateAll(nodes => nodes.map(n => n.outerHTML)));
  throw error;
} finally {
  await browser.close();
}
