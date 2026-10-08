import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// Run against the managed Expo web and ClassScribe web workflows. All API
// requests are intercepted: the test must never modify a student's library.
const mobileUrl = process.env.APPEARANCE_MOBILE_URL ||
  (process.env.REPLIT_EXPO_DEV_DOMAIN && `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}/`);
const webUrl = process.env.APPEARANCE_WEB_URL ||
  (process.env.REPLIT_DEV_DOMAIN && `https://${process.env.REPLIT_DEV_DOMAIN}/`);
if (!mobileUrl || !webUrl) throw new Error('Set APPEARANCE_MOBILE_URL and APPEARANCE_WEB_URL (or run in the Replit workspace).');

const uid = 'u_AppearanceValidationOnly123456';
const tokens = JSON.parse(readFileSync(new URL('../artifacts/classscribe-mobile/lib/appearance-tokens.json', import.meta.url)));
let profile = { firstName: 'Appearance', lastName: 'Check', level: 'College', appearance: 'dark' };
let offlineProfile = false;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  args: ['--no-sandbox'],
});

async function mockApi(route) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const input = request.postDataJSON?.() || {};
  if (path.startsWith('/api/db/')) assert.equal(request.headers()['x-cs-user'], uid, 'test library must be isolated');
  if (path === '/api/db/get') {
    if (offlineProfile && input.path === `data/users/${uid}/profile`) {
      return route.fulfill({ status: 503, json: { error: 'Offline' } });
    }
    return route.fulfill({ json: { data: input.path === `data/users/${uid}/profile` ? profile : null } });
  }
  if (path === '/api/db/update' || path === '/api/db/set') {
    if (input.path === `data/users/${uid}/profile`) profile = { ...profile, ...input.data };
    return route.fulfill({ json: { ok: true } });
  }
  if (path === '/api/db/list') return route.fulfill({ json: { docs: [] } });
  if (path === '/api/health') return route.fulfill({ json: { ok: true, ai: false, transcribe: false } });
  if (path === '/api/profile-photo' && request.method() === 'GET') {
    assert.equal(request.headers()['x-cs-user'], uid, 'test photo request must be isolated');
    return route.fulfill({ status: 404, json: { error: 'No photo saved' } });
  }
  if (path.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'Plan check not part of appearance validation' } });
  if (path === '/api/credits/status' && request.method() === 'GET') {
    assert.equal(request.headers()['x-cs-user'], uid, 'test credits request must be isolated');
    return route.fulfill({ status: 503, json: { error: 'Credits check not part of appearance validation' } });
  }
  if (path === '/api/privacy/config' && request.method() === 'GET') {
    return route.fulfill({ status: 503, json: { error: 'Recording consent check not part of appearance validation' } });
  }
  throw new Error(`Unexpected API request: ${path}`);
}

const mobile = await browser.newContext({ viewport: { width: 400, height: 720 }, isMobile: true, hasTouch: true, colorScheme: 'dark', ignoreHTTPSErrors: true });
const web = await browser.newContext({ viewport: { width: 900, height: 800 }, colorScheme: 'light', ignoreHTTPSErrors: true });
try {
  for (const context of [mobile, web]) {
    await context.route('**/api/**', mockApi);
  }
  await mobile.addInitScript(({ uid, profile }) => {
    localStorage.setItem('cs_uid', uid);
    localStorage.setItem(`cs_profile_v2_${uid}`, JSON.stringify(profile));
  }, { uid, profile });
  await web.addInitScript((uid) => localStorage.setItem('cs_device_uid', uid), uid);

  const phone = await mobile.newPage();
  phone.setDefaultTimeout(20000);
  const desktop = await web.newPage();
  desktop.setDefaultTimeout(20000);
  await phone.goto(mobileUrl, { waitUntil: 'domcontentloaded' });
  await phone.getByRole('button', { name: 'Account', exact: true }).click();
  const choice = (label) => phone.getByText(label, { exact: true });
  await choice('Automatic (match my device)').waitFor();

  // Read the actual painted DOM, not the selected preference or the palette proxy.
  // Account is a modal: verify its mounted surface and header first, then the
  // underlying tab bar after returning Home at each theme boundary.
  async function colors() {
    return phone.evaluate(() => {
      const text = [...document.querySelectorAll('*')];
      const byText = (s) => text.find(el => el.textContent?.trim() === s && ![...el.children].some(c => c.textContent?.trim() === s));
      const input = document.querySelector('input[placeholder="Required"]');
      const lastName = document.querySelector('input[placeholder="Optional"]');
      const server = document.querySelector('input[placeholder="your-repl.replit.app"]');
      const account = byText('Account');
      const section = byText('APPEARANCE');
      const tablist = document.querySelector('[role="tablist"]');
      const tabSurface = tablist?.parentElement;
      const css = (el, prop) => el && getComputedStyle(el)[prop];
      const headerSurface = document.querySelector('[data-testid="account-header-surface"]');
      return {
        inputBg: css(input, 'backgroundColor'), inputText: css(input, 'color'),
        lastNameBg: css(lastName, 'backgroundColor'), lastNameText: css(lastName, 'color'),
        serverBg: css(server, 'backgroundColor'), serverText: css(server, 'color'),
        pageBg: css(document.querySelector('input[placeholder="Required"]')?.closest('[style*="background-color"]'), 'backgroundColor'),
        sectionText: css(section, 'color'),
        headerBg: css(headerSurface, 'backgroundColor'),
        headerVisible: !!headerSurface && headerSurface.getBoundingClientRect().height > 0,
        headerText: css(account, 'color'),
        tabBg: css(tabSurface, 'backgroundColor'),
        tabLine: css(tabSurface, 'borderTopColor'),
        tabVisible: !!tablist && !!tabSurface && tabSurface.getBoundingClientRect().height > 0,
        documentScheme: document.documentElement.style.colorScheme,
      };
    });
  }
  const rgb = (hex) => {
    const n = hex.match(/\w\w/g).map(x => parseInt(x, 16));
    return `rgb(${n.join(', ')})`;
  };
  async function expectAccount(mode) {
    const expected = tokens[mode];
    await phone.waitForFunction(({ bg, text, page, line, mode }) => {
      const input = document.querySelector('input[placeholder="Required"]');
      const header = document.querySelector('[data-testid="account-header-surface"]');
      const tab = document.querySelector('[role="tablist"]')?.parentElement;
      const pageSurface = input?.closest('[style*="background-color"]');
      return input && getComputedStyle(input).backgroundColor === bg &&
        getComputedStyle(input).color === text &&
        getComputedStyle(header).backgroundColor === page &&
        (!tab || (getComputedStyle(tab).backgroundColor === bg && getComputedStyle(tab).borderTopColor === line)) &&
        getComputedStyle(pageSurface).backgroundColor === page &&
        document.documentElement.style.colorScheme === mode;
    }, { bg: rgb(expected.card), text: rgb(expected.text), page: rgb(expected.phoneBg), line: rgb(expected.separator), mode });
    const actual = await colors();
    assert.equal(actual.inputBg, rgb(expected.card), `${mode} input background`);
    assert.equal(actual.inputText, rgb(expected.text), `${mode} input text`);
    assert.equal(actual.lastNameBg, rgb(expected.card), `${mode} second form field background`);
    assert.equal(actual.lastNameText, rgb(expected.text), `${mode} second form field text`);
    assert.equal(actual.serverBg, rgb(expected.phoneBg), `${mode} server field background`);
    assert.equal(actual.serverText, rgb(expected.text), `${mode} server field text`);
    assert.equal(actual.sectionText, rgb(expected.secondaryText), `${mode} section heading`);
    assert.equal(actual.headerText, rgb(expected.text), `${mode} Account header text`);
    // The root modal header background and Account scroll body are distinct.
    assert.equal(actual.pageBg, rgb(expected.phoneBg), `${mode} page background`);
    assert.equal(actual.headerBg, rgb(expected.phoneBg), `${mode} header background`);
    assert.ok(actual.headerVisible, `${mode} header surface must be painted`);
    // Direct /account reload has no mounted Home tab navigator until Back.
    if (actual.tabBg) {
      assert.equal(actual.tabBg, rgb(expected.card), `${mode} underlying tab surface`);
      assert.equal(actual.tabLine, rgb(expected.separator), `${mode} underlying tab border`);
    }
    assert.equal(actual.documentScheme, mode, `${mode} browser color scheme`);
    return actual;
  }
  async function expectTabs(mode) {
    await phone.getByRole('button', { name: 'Back', exact: true }).click();
    await phone.waitForFunction((color) => {
      const bar = document.querySelector('[role="tablist"]')?.parentElement;
      return bar && getComputedStyle(bar).backgroundColor === color && bar.getBoundingClientRect().height > 0;
    }, rgb(tokens[mode].card));
    const actual = await colors();
    assert.equal(actual.tabBg, rgb(tokens[mode].card), `${mode} tab background`);
    assert.equal(actual.tabLine, rgb(tokens[mode].separator), `${mode} tab border`);
    assert.ok(actual.tabVisible, 'tab bar must be visible');
    await phone.getByRole('button', { name: 'Account', exact: true }).click();
    await choice('Automatic (match my device)').waitFor();
  }
  async function check(mode) { await expectAccount(mode); await expectTabs(mode); }

  // Keep an unsaved form value on the mounted Account screen through both
  // directions. A remount would mask the stale-style regression.
  await phone.locator('input[placeholder="Required"]').fill('Unsaved name');
  await expectAccount('dark');
  await phone.emulateMedia({ colorScheme: 'light' });
  await expectAccount('dark'); // explicit Dark ignores the device
  await choice('Automatic (match my device)').click();
  await expectAccount('light');
  await phone.emulateMedia({ colorScheme: 'dark' });
  await expectAccount('dark');
  await phone.emulateMedia({ colorScheme: 'light' });
  await expectAccount('light');
  await phone.emulateMedia({ colorScheme: 'dark' });
  await expectAccount('dark');
  assert.equal(await phone.locator('input[placeholder="Required"]').inputValue(), 'Unsaved name', 'Account must stay mounted with its draft intact');
  await check('dark');
  await choice('Light').click();
  await check('light'); // explicit Light ignores the dark device
  await choice('Dark').click();
  await check('dark');

  // Cached library choice must be applied before a server profile can load.
  await phone.waitForFunction((uid) => JSON.parse(localStorage.getItem(`cs_profile_v2_${uid}`) || '{}').appearance === 'dark', uid);
  offlineProfile = true;
  await phone.emulateMedia({ colorScheme: 'light' });
  await phone.reload({ waitUntil: 'domcontentloaded' });
  await choice('Automatic (match my device)').waitFor();
  await check('dark');
  offlineProfile = false;

  // Change the same library from the actual browser app, then reload the
  // mobile-web client to fetch that remote preference (not its cached Dark).
  await desktop.goto(webUrl, { waitUntil: 'domcontentloaded' });
  const intro = desktop.getByText('Tap anywhere to continue');
  if (await intro.isVisible()) await intro.click();
  await desktop.getByText('Account settings').click();
  await desktop.locator('[data-act="appearancePick"][data-appearance="light"]').first().waitFor();
  const webWrite = desktop.waitForResponse(r => r.url().endsWith('/api/db/update') &&
    r.request().postDataJSON()?.path === `data/users/${uid}/profile` &&
    r.request().postDataJSON()?.data?.appearance === 'light');
  await desktop.locator('[data-act="appearancePick"][data-appearance="light"]').first().click();
  await webWrite;
  await desktop.waitForFunction(() => document.querySelector('[data-act="appearancePick"][data-appearance="light"]')?.getAttribute('aria-checked') === 'true');
  assert.equal(profile.appearance, 'light', 'web app must write the shared library preference');
  await phone.reload({ waitUntil: 'domcontentloaded' });
  await choice('Automatic (match my device)').waitFor();
  await check('light');
  console.log('Appearance validation passed: mounted Account, both theme directions, explicit modes, cached reload, and web preference.');
} finally {
  await browser.close();
}