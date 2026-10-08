import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web-src/4_views.js', import.meta.url), 'utf8');
const start = source.indexOf('function billingSourceLabel(source){');
const end = source.indexOf('/* ---------- modals: course, syllabus ---------- */', start);
assert.ok(start >= 0 && end > start, 'served web Plans billing view must be present');

function renderPlans(billing) {
  const ctx = {
    VIEWS: {}, ACT: {}, AFTER: {},
    S: { billing, billingAction: null, billingNotice: '', profile: { level: 'College' } },
    LEVELS: ['High School', 'College', 'Graduate'],
    billingUserCode: () => 'library-test',
    currentBillingStatus: () => billing.state === 'ready' ? billing : null,
    billingSubscriptionActive: status => ['active', 'trialing'].includes(String(status.status || '').toLowerCase()),
    billingStatusText: () => 'ClassScribe subscription status',
    billingManagementMarkup: undefined,
    billingCheckoutBlockReason: () => '',
    creditsSummaryMarkup: () => '',
    baseUsageAllowanceMarkup: () => '',
    openBillingCheckout() {}, openModal() {}, closeModal() {}, loadBillingStatus() {},
    goAttr: value => `data-go="${JSON.stringify(value)}"`,
    ic: () => '<svg></svg>',
    esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]),
    billingSubscriptionActive: status => ['active', 'trialing'].includes(String(status.status || '').toLowerCase()),
    window: { self: {}, top: {} },
    document: { addEventListener() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  return { html: ctx.VIEWS.plans({}), ctx };
}

const active = extra => ({
  state: 'ready', _userCode: 'library-test', plan: 'student', status: 'active',
  billingReadiness: { ready: true }, ...extra,
});

test('active web plans expose the portal without claiming tier switching is configured', () => {
  const { html } = renderPlans(active());
  assert.match(html, /Active plan: ClassScribe Student/);
  assert.match(html, /Billing source:<\/b> Stripe/);
  assert.equal((html.match(/data-act="billingPortal"/g) || []).length, 3,
    'status panel and both Student/Pro cards should open the portal');
  assert.match(html, /Student–Pro switching is not yet enabled in the Stripe portal/);
  assert.match(html, /Manage web subscription in Stripe/);
  assert.doesNotMatch(html, /data-act="billingCheckout"/);
});

test('blocked checkout pop-up shows an error in the still-open confirmation', async () => {
  const { ctx } = renderPlans(active({ plan: 'free', status: 'none' }));
  const status = { textContent: '' };
  let closed = false;
  ctx.document = { getElementById: () => status };
  ctx.window.open = () => null;
  ctx.closeModal = () => { closed = true; };
  await ctx.ACT.billingConfirm({ dataset: { plan: 'student' }, disabled: false });
  assert.match(status.textContent, /blocked.*checkout tab/);
  assert.equal(closed, false);
});

test('checkout confirmation remains open on failure and closes only after opening', async () => {
  for (const opened of [false, true]) {
    const { ctx } = renderPlans(active({ plan: 'free', status: 'none' }));
    const status = { textContent: '' };
    let closed = false;
    ctx.document = { getElementById: () => status };
    ctx.window.top = ctx.window.self;
    ctx.S.billingNotice = 'Could not connect to billing.';
    ctx.openBillingCheckout = async () => opened;
    ctx.closeModal = () => { closed = true; };
    const button = { dataset: { plan: 'pro' }, disabled: false };
    await ctx.ACT.billingConfirm(button);
    assert.equal(closed, opened);
    assert.equal(button.disabled, false);
    if (!opened) assert.match(status.textContent, /Could not connect/);
  }
});

test('RevenueCat Test Store billing is identified as testing and never offers a dead web management link', () => {
  const { html } = renderPlans(active({ billingSource: 'test_store' }));
  assert.match(html, /RevenueCat Test Store \(testing\)/);
  assert.match(html, /cannot open RevenueCat’s customer page without the authenticated app session/);
  assert.match(html, /installed ClassScribe debug app/);
  assert.match(html, /Test Store owner controls/);
  assert.doesNotMatch(html, /data-act="billingPortal"/);
});

test('cross-store conflicts explain the checkout block and both management paths', () => {
  const { html } = renderPlans(active({ billingSource: 'app_store', billingConflict: true }));
  assert.match(html, /new checkout is blocked to prevent a double charge/);
  assert.match(html, /Cross-store subscriptions do not replace or cancel one another/);
  assert.match(html, /original store on the device used to subscribe/);
  assert.match(html, /Stripe web subscription/);
});

test('unready billing explains setup, keeps Free available, and exposes retry without unsafe HTML', () => {
  const { html } = renderPlans({
    state: 'ready', _userCode: 'library-test', plan: 'free', status: 'inactive',
    billingReadiness: { ready: false, message: '<img src=x onerror=alert(1)>' },
  });
  assert.match(html, /Paid web checkout is not ready because billing setup is incomplete/);
  assert.match(html, /Retry billing setup check/);
  assert.match(html, /data-act="billingFree"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.doesNotMatch(html, /Upgrades aren't set up yet/);
});

test('Free plans offer credit packs independently of subscription checkout readiness', () => {
  for (const ready of [true, false]) {
    const { html } = renderPlans({
      state: 'ready', plan: 'free', status: 'inactive', billingReadiness: { ready },
    });
    const freeCard = html.slice(html.indexOf('<h3>ClassScribe Free'), html.indexOf('<h3>ClassScribe Student'));
    assert.match(freeCard, /Buy Scribe Credits without a subscription/);
    assert.match(freeCard, /<button[^>]*data-go="[^>]*credits[^>]*>Buy Scribe Credits<\/button>/);
    assert.doesNotMatch(freeCard.match(/<button[^>]*>Buy Scribe Credits<\/button>/)[0], /disabled/);
  }
});