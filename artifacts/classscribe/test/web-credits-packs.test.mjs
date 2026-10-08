import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const core = readFileSync(new URL("../web-src/3_core.js", import.meta.url), "utf8");
const views = readFileSync(new URL("../web-src/4_views.js", import.meta.url), "utf8");

const status = {
  balance: 20,
  currency: { code: "CRD", name: "Scribe Credits" },
  packs: [
    { id: "pack-small", name: "10 Scribe Credits", credits: 10, priceCents: 199, label: "" },
    { id: "pack-value", name: "30 Scribe Credits", credits: 30, priceCents: 499, label: "Best value" },
    { id: "pack-large", name: "60 Scribe Credits", credits: 60, priceCents: 999, label: "Most credits" },
  ],
  costs: { transcription10Minutes: 1, savedRecording: 5, studyGuide: 10, askQuestion: 1 },
  monthlyBonus: { student: 10, pro: 20 },
  history: [],
};

test("credit status accepts named packs with optional labels and rejects missing names", () => {
  const start = core.indexOf("function validCreditsStatus(data){");
  const end = core.indexOf("async function creditsRequestApi(", start);
  assert.ok(start >= 0 && end > start);
  const context = { status };
  runInNewContext(core.slice(start, end), context);

  assert.equal(context.validCreditsStatus(status), true);
  assert.equal(context.validCreditsStatus({
    ...status,
    packs: [{ ...status.packs[0], name: undefined }],
  }), false);
  assert.equal(context.validCreditsStatus({
    ...status,
    packs: [{ ...status.packs[0], label: undefined }],
  }), true);
  assert.equal(context.validCreditsStatus({
    ...status,
    packs: [{ ...status.packs[0], label: 42 }],
  }), false);
});

test("credits pack cards use server names, optional badges, counts, and prices", () => {
  const currencyStart = core.indexOf("function creditsCurrency(data,cents){");
  const currencyEnd = core.indexOf("function creditsSummaryMarkup(){", currencyStart);
  const viewsStart = views.indexOf("function creditCostLabel(value){");
  const viewsEnd = views.indexOf("ACT.creditsRetry=", viewsStart);
  assert.ok(currencyStart >= 0 && currencyEnd > currencyStart);
  assert.ok(viewsStart >= 0 && viewsEnd > viewsStart);
  const context = {
    VIEWS: {},
    S: { credits: { state: "ready", data: status, action: null, notice: "" } },
    creditNumber: value => String(value),
    creditsCurrency: null,
    esc: value => String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]),
    ic: () => "<svg></svg>",
    goAttr: () => "",
    creditCostLabel: value => `${value} credits`,
  };
  runInNewContext(core.slice(currencyStart, currencyEnd), context);
  runInNewContext(views.slice(viewsStart, viewsEnd), context);

  const html = context.VIEWS.credits();
  assert.match(html, /<h3>10 Scribe Credits<\/h3>/);
  assert.match(html, /<h3>30 Scribe Credits<\/h3><span class="chip">Best value<\/span>/);
  assert.match(html, /<h3>60 Scribe Credits<\/h3><span class="chip">Most credits<\/span>/);
  assert.match(html, /Buy 10 Scribe Credits/);
  assert.match(html, /\$1\.99/);
  assert.match(html, /\$4\.99/);
  assert.match(html, /\$9\.99/);
  assert.doesNotMatch(html, /<h3><\/h3>|<span class="chip"><\/span>/);
});

test("checkout status identifies the selected pack by its server name", async () => {
  const start = core.indexOf("async function openCreditsCheckout(packId,checkoutWindow){");
  const end = core.indexOf("function creditsReturnNotice(){", start);
  assert.ok(start >= 0 && end > start);
  const checkoutWindow = { location: { href: "" }, opener: {} };
  const context = {
    S: { credits: { state: "ready", data: status, action: null, notice: "" }, view: { name: "credits" } },
    creditsUserCode: () => "library",
    creditsRequestApi: async () => ({ url: "https://checkout.stripe.com/session" }),
    render() {},
    location: { href: "https://classscribe.example/credits" },
    URL,
    creditsCheckoutRequest: null,
    creditsCheckoutCode: null,
    ["window"]: {},
  };
  runInNewContext(core.slice(start, end), context);

  await context.openCreditsCheckout("pack-small", checkoutWindow);
  assert.equal(checkoutWindow.location.href, "https://checkout.stripe.com/session");
  assert.match(context.S.credits.notice, /10 Scribe Credits/);
});