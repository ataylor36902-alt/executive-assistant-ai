import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const core = readFileSync(new URL("../web-src/3_core.js", import.meta.url), "utf8");
const views = readFileSync(new URL("../web-src/4_views.js", import.meta.url), "utf8");

test("web credits maintenance errors clear balances and describe 409 pause / 503 outage", () => {
  assert.match(core, /error\.status===409\|\|error\.status===503\?creditsMaintenanceMessage\(error\.status\)/);
  assert.match(core, /Credits are temporarily paused for maintenance/);
  assert.match(core, /Credits are temporarily unavailable during maintenance/);
  assert.match(core, /data:null,_userCode:creditsUserCode\(\),error/);
});

test("currency-migration history renders a neutral no-change label and credits are non-expiring", () => {
  const start = views.indexOf("VIEWS.credits=()=>{");
  const end = views.indexOf("ACT.creditsRetry=", start);
  assert.ok(start >= 0 && end > start);
  const context = {
    VIEWS: {},
    S: {
      credits: {
        state: "ready",
        data: {
          balance: 3,
          currency: { code: "CREDITS", name: "Credits" },
          packs: [],
          costs: {},
          monthlyBonus: { student: 0, pro: 0 },
          history: [{ id: "migration", date: "2025-01-01", amount: 0, reason: "migration_completed", source: "currency_migration" }],
        },
        notice: "",
        action: null,
      },
    },
    creditNumber: value => String(value),
    esc: value => String(value),
    ic: () => "",
    goAttr: () => "",
    creditsCurrency: () => "",
    creditCostLabel: () => "",
  };
  runInNewContext(views.slice(start, end), context);
  const html = context.VIEWS.credits();
  assert.match(html, /Currency migration/);
  assert.match(html, /No balance change/);
  assert.doesNotMatch(html, /\+0 credits|-0 credits/);
  assert.match(html, /Credits accumulate and do not expire/);
});