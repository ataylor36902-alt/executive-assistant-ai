import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Two isolated browsers, one shared fake library. No real student data is read or written.
const mobileUrl = process.env.EXAMPLES_MOBILE_URL ||
  (process.env.REPLIT_EXPO_DEV_DOMAIN && `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}/`);
const webUrl = process.env.EXAMPLES_WEB_URL ||
  (process.env.REPLIT_DEV_DOMAIN && `https://${process.env.REPLIT_DEV_DOMAIN}/`);
if (!mobileUrl || !webUrl) throw new Error('Set EXAMPLES_MOBILE_URL and EXAMPLES_WEB_URL, or run in the Replit workspace.');

const uid = 'u_ExamplePreferenceValidation1234';
const profilePath = `data/users/${uid}/profile`;
const initialProfile = () => ({ firstName: 'Examples', level: 'College', term: 'Fall 2026', showExamples: true, showExamplesUpdated: 1 });
let profile = initialProfile();
const writes = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  args: ['--no-sandbox'],
});

async function mockApi(route) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const input = request.postDataJSON?.() || {};
  if (path.startsWith('/api/db/')) assert.equal(request.headers()['x-cs-user'], uid, 'both clients must use the same isolated library');
  if (path === '/api/db/get') return route.fulfill({ json: { data: input.path === profilePath ? profile : null } });
  if (path === '/api/db/update' || path === '/api/db/set') {
    if (input.path === profilePath) {
      writes.push({ path, data: input.data });
      profile = { ...profile, ...input.data };
    }
    return route.fulfill({ json: { ok: true } });
  }
  if (path === '/api/db/list') return route.fulfill({ json: { docs: [] } });
  if (path === '/api/health') return route.fulfill({ json: { ok: true, ai: false, transcribe: false } });
  if (path === '/api/profile-photo' && request.method() === 'GET') return route.fulfill({ status: 404, json: { error: 'No photo saved' } });
  if (path.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'Billing is outside this check' } });
  throw new Error(`Unexpected API request: ${path}`);
}

const mobile = await browser.newContext({ viewport: { width: 400, height: 720 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
const web = await browser.newContext({ viewport: { width: 900, height: 800 }, ignoreHTTPSErrors: true });
try {
  for (const context of [mobile, web]) await context.route('**/api/**', mockApi);
  await mobile.addInitScript(() => {
    window.__exampleSeenDuringLoad = false;
    new MutationObserver(() => {
      if (document.querySelector('button[aria-label="Open BIO 101, Introduction to Biology"]')) window.__exampleSeenDuringLoad = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await web.addInitScript(() => {
    window.__exampleSeenDuringLoad = false;
    new MutationObserver(() => {
      if (document.querySelector('#main .home-course[aria-label^="Open BIO 101"]')) window.__exampleSeenDuringLoad = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await mobile.addInitScript(uid => localStorage.setItem('cs_uid', uid), uid);
  await web.addInitScript(uid => localStorage.setItem('cs_device_uid', uid), uid);
  const phone = await mobile.newPage();
  const desktop = await web.newPage();
  phone.setDefaultTimeout(25000);
  desktop.setDefaultTimeout(25000);

  async function phoneHome(visible) {
    await phone.goto(mobileUrl, { waitUntil: 'domcontentloaded' });
    await phone.getByRole('button', { name: 'Account', exact: true }).waitFor();
    const bio = phone.getByRole('button', { name: 'Open BIO 101, Introduction to Biology', exact: true });
    if (visible) await bio.waitFor();
    else {
      await phone.getByRole('button', { name: 'Show example courses' }).waitFor();
      assert.equal(await bio.count(), 0, 'phone must not display hidden examples after refresh');
      assert.equal(await phone.evaluate(() => window.__exampleSeenDuringLoad), false, 'phone must never briefly display a hidden example while loading');
    }
  }
  async function webHome(visible) {
    await desktop.goto(webUrl, { waitUntil: 'domcontentloaded' });
    const intro = desktop.getByText('Tap anywhere to continue');
    if (await intro.isVisible()) await intro.click();
    await desktop.getByText('Account settings').waitFor();
    const bio = desktop.locator('#main .home-course[aria-label^="Open BIO 101"]');
    if (visible) await bio.waitFor();
    else {
      await desktop.locator('#main [data-act="showEx"]').first().waitFor();
      assert.equal(await bio.count(), 0, 'web must not display hidden examples after refresh');
      assert.equal(await desktop.evaluate(() => window.__exampleSeenDuringLoad), false, 'web must never briefly display a hidden example while loading');
    }
  }
  async function phoneChoice(show) {
    await phone.getByRole('button', { name: 'Account', exact: true }).click();
    const toggle = phone.getByRole('switch');
    await toggle.waitFor();
    assert.equal(await toggle.isChecked(), !show, 'phone switch before change');
    await toggle.click();
    await phone.waitForFunction((expected) => document.querySelector('[role="switch"]')?.checked === expected, show);
    await waitForWrite(show);
  }
  async function webChoice(show) {
    await desktop.getByText('Account settings').click();
    const button = desktop.locator(`[data-act="${show ? 'showEx' : 'hideEx'}"]`).last();
    await button.waitFor();
    await button.click();
    await waitForWrite(show);
  }
  async function waitForWrite(show) {
    // Also proves the client's actual profile API write, not just an optimistic switch.
    for (let i = 0; i < 100 && profile.showExamples !== show; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(profile.showExamples, show, 'shared library profile must contain the new choice');
    assert.ok(writes.some(w => w.path === '/api/db/update' && w.data.showExamples === show), 'choice must be sent to the profile API');
  }
  async function resetLegacy(flagOnPhone) {
    profile = { firstName: 'Examples', level: 'College', term: 'Fall 2026' };
    writes.length = 0;
    await phone.evaluate(({ uid, hidden }) => {
      localStorage.removeItem(`cs_profile_v2_${uid}`);
      localStorage.removeItem(`cs_profile_pending_v2_${uid}`);
      localStorage.removeItem(`cs_profile_migrated_v2_${uid}`);
      localStorage.removeItem('cs_profile');
      if (hidden) localStorage.setItem('cs_hideEx', '1');
      else localStorage.removeItem('cs_hideEx');
    }, { uid, hidden: flagOnPhone });
    await desktop.evaluate(uid => {
      localStorage.removeItem(`cs_profile_v2_${uid}`);
      localStorage.removeItem(`cs_pending_profile_v2_${uid}`);
      localStorage.removeItem('cs_profile');
      localStorage.removeItem('cs_hideEx_v2');
    }, uid);
  }

  await phoneHome(true);
  await webHome(true);
  await webChoice(false);
  await phoneHome(false);
  await webHome(false);
  await phoneChoice(true);
  await webHome(true);
  await phoneHome(true);

  // Old phone-only hide migrates exactly once when the shared profile has no choice.
  await resetLegacy(true);
  await phoneHome(false);
  await waitForWrite(false);
  await webHome(false);
  await phoneChoice(true);
  await desktop.evaluate(() => localStorage.setItem('cs_hideEx_v2', '1'));
  await webHome(true);
  assert.equal(await desktop.evaluate(() => localStorage.getItem('cs_hideEx_v2')), null, 'stale web hide flag must be removed');
  assert.equal(profile.showExamples, true, 'stale web flag must not rewrite a newer show choice');

  // Old browser-only hide migrates too, and a newer phone show wins on return.
  await resetLegacy(false);
  await desktop.evaluate(() => localStorage.setItem('cs_hideEx_v2', '1'));
  await webHome(false);
  await waitForWrite(false);
  await phoneHome(false);
  await phoneChoice(true);
  await phone.evaluate(() => localStorage.setItem('cs_hideEx', '1'));
  await phoneHome(true);
  assert.equal(await phone.evaluate(() => localStorage.getItem('cs_hideEx')), null, 'stale phone hide flag must be removed');
  await webHome(true);
  assert.equal(profile.showExamples, true, 'stale phone flag must not rewrite a newer show choice');
  console.log('Example course validation passed: web-to-phone, phone-to-web, reloads, both legacy migrations and newer show choices.');
} finally {
  await browser.close();
}