import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

const analytics = fs.readFileSync(new URL("../src/lib/analytics.ts", import.meta.url), "utf8");
const plans = fs.readFileSync(new URL("../src/pages/SubscriptionPlans.tsx", import.meta.url), "utf8");
const handler = plans.match(/const sendEduInquiry = async \(event: FormEvent<HTMLFormElement>\) => \{([\s\S]*?)\n  \};/);
assert.ok(handler, "The plans form must have its submission handler");

function setup({ tracker, response = { accepted: true }, failure, pending = false } = {}) {
  const state = { submitted: false, error: "", requests: 0 };
  const ctx = {
    window: tracker ? { umami: { track: tracker } } : {},
    contactSubmitted: false,
    contactForm: {
      name: " Private Name ", email: " private@example.test ",
      school: " Private School ", role: " Private Role ", message: " Private Message ",
    },
    requestEduAccess: {
      isPending: pending,
      async mutateAsync() {
        state.requests++;
        if (failure) throw failure;
        return response;
      },
    },
    setContactError: value => { state.error = value; },
    setContactSubmitted: value => { state.submitted = value; },
  };
  vm.createContext(ctx);
  vm.runInContext(transformSync(analytics.replace("export function", "function"), { loader: "ts" }).code, ctx);
  vm.runInContext(`send = async event => {${handler[1]}}`, ctx);
  return { state, send: () => ctx.send({ preventDefault() {} }) };
}

test("only accepted inquiries emit one detail-free event", async () => {
  const calls = [];
  const { state, send } = setup({ tracker: (...args) => calls.push(args) });
  await send();
  assert.equal(state.requests, 1);
  assert.equal(state.submitted, true);
  assert.equal(state.error, "");
  assert.deepEqual(calls, [["edu_inquiry_sent", undefined]]);
});

test("failed or unaccepted submissions do not count", async () => {
  for (const options of [{ failure: new Error("Delivery failed") }, { response: { accepted: false } }]) {
    const calls = [];
    const { state, send } = setup({ ...options, tracker: (...args) => calls.push(args) });
    await send();
    assert.equal(state.submitted, false);
    assert.match(state.error, /couldn’t send/);
    assert.deepEqual(calls, []);
  }
});

test("missing, throwing, and rejecting trackers preserve confirmation", async () => {
  for (const tracker of [undefined, () => { throw new Error("Tracker failed"); }, () => Promise.reject(new Error("Tracker rejected"))]) {
    const { state, send } = setup({ tracker });
    await send();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.submitted, true);
    assert.equal(state.error, "");
    assert.equal(state.requests, 1);
  }
});

test("pending submissions are not delivered or counted again", async () => {
  const { state, send } = setup({ pending: true, tracker: () => assert.fail("must not track") });
  await send();
  assert.equal(state.requests, 0);
});

test("wrapper is safe without a browser", () => {
  const ctx = vm.createContext({});
  vm.runInContext(transformSync(analytics.replace("export function", "function"), { loader: "ts" }).code, ctx);
  assert.doesNotThrow(() => vm.runInContext("trackEvent('edu_inquiry_sent')", ctx));
});

const browserSource = fs.readFileSync(new URL("../web-src/4_views.js", import.meta.url), "utf8");
const servedHtml = fs.readFileSync(new URL("../web-public/index.html", import.meta.url), "utf8");
const inquiryBlock = text => text.slice(text.indexOf("/* ---------- school inquiries and privacy-safe analytics ---------- */"), text.indexOf("/* ---------- modals: course, syllabus ---------- */"));

test("served browser inquiry code matches its editable source and has a Plans entry point", () => {
  assert.ok(inquiryBlock(browserSource).length > 100);
  assert.equal(inquiryBlock(browserSource), inquiryBlock(servedHtml));
  assert.match(servedHtml, /data-act="eduInquiry" data-testid="button-edu-contact"/);
});

function browserSetup({ ok = true, accepted = true, tracker, connected = true, failure } = {}) {
  const events = [], requests = [], button = {}, status = {};
  const form = {
    dataset: {}, isConnected: connected, innerHTML: "",
    elements: { namedItem: key => ({ value: ` private-${key} ` }) },
    querySelector: selector => selector === '[type="submit"]' ? button : status,
  };
  const ctx = {
    ACT: {}, openModal() {}, document: { addEventListener() {} },
    window: { umami: { track: tracker || ((...args) => events.push(args)) } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (failure) throw failure;
      return { ok, json: async () => ({ accepted }) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(inquiryBlock(servedHtml), ctx);
  return { ctx, form, events, requests, button, status };
}

test("served form counts acceptance once and sends no private analytics properties", async () => {
  const { ctx, form, events, requests } = browserSetup();
  await ctx.submitEduInquiry(form);
  await ctx.submitEduInquiry(form);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/edu-inquiries");
  assert.equal(JSON.parse(requests[0].options.body).school, "private-school");
  assert.deepEqual(events, [["edu_inquiry_sent"]]);
  assert.match(form.innerHTML, /Your inquiry was sent/);
  assert.doesNotMatch(form.innerHTML, /private-/);
});

test("served delivery failure or negative acceptance keeps retry and does not count", async () => {
  for (const options of [{ ok: false }, { accepted: false }, { failure: new Error("Offline") }]) {
    const { ctx, form, events, button, status } = browserSetup(options);
    await ctx.submitEduInquiry(form);
    assert.deepEqual(events, []);
    assert.equal(button.disabled, false);
    assert.match(status.textContent, /couldn’t send/);
  }
});

test("served tracker errors cannot replace delivery confirmation", async () => {
  for (const tracker of [() => { throw new Error("Tracker"); }, () => Promise.reject(new Error("Tracker"))]) {
    const { ctx, form } = browserSetup({ tracker });
    await ctx.submitEduInquiry(form);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(form.innerHTML, /Your inquiry was sent/);
  }
});

test("closing during delivery cannot update a later dialog", async () => {
  const { ctx, form, events } = browserSetup({ connected: false });
  await ctx.submitEduInquiry(form);
  assert.equal(form.innerHTML, "");
  assert.deepEqual(events, [["edu_inquiry_sent"]]);
});
