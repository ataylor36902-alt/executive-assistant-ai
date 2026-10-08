import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const paths = [
  new URL('../web-src/3_core.js', import.meta.url),
  new URL('../web-public/index.html', import.meta.url),
];

for (const path of paths) {
  test(`${path.pathname.split('/').slice(-2).join('/')}: remaining balance and safe foreground refresh`, () => {
    const source = fs.readFileSync(path, 'utf8');
    const start = source.indexOf('function creditNumber(value){');
    const end = source.indexOf('let pendingCreditConsent=', start);
    assert.ok(start >= 0 && end > start);
    let requests = 0, timer, cadence;
    const handlers = {};
    const context = {
      S: { view: { name: 'plans' }, credits: { state: 'ready', data: {
        balance: 0, currency: { name: 'Credits' }, monthlyBonus: { student: 50, pro: 100 },
        costs: { transcription10Minutes: 1, savedRecording: 2 },
      } } },
      Intl,
      creditsUserCode: () => 'test-library',
      loadCreditsStatus: force => { assert.equal(force, true); requests++; },
      esc: value => String(value),
      goAttr: () => 'data-go="credits"',
      document: { visibilityState: 'visible', addEventListener: (name, fn) => { handlers[name] = fn; } },
      window: {
        setInterval: (fn, ms) => { timer = fn; cadence = ms; },
        addEventListener: (name, fn) => { handlers[name] = fn; },
      },
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    assert.equal(cadence, 30_000);
    assert.match(context.creditsSummaryMarkup(), /Remaining Scribe Credits[\s\S]*<h2>0 /);
    context.S.credits.data.balance = 123;
    assert.match(context.creditsSummaryMarkup(), /<h2>123 /);
    assert.match(context.creditsSummaryMarkup(), /including Free/);
    assert.match(context.creditsSummaryMarkup(), /Credits accumulate and do not expire/);
    assert.match(context.creditsSummaryMarkup(), /1 credit per 10 extra transcription minutes/);
    const exhaustedMarkup = context.baseUsageAllowanceMarkup({ plan: 'student',
      recordingHoursUsed: 45, recordingHoursLimit: 40,
      recordingCountUsed: 20, recordingCountLimit: 20,
      transcriptionCountUsed: 20, transcriptionCountLimit: 20 });
    assert.match(exhaustedMarkup, /0\.0 transcription hours · 0 saved recordings/);
    assert.match(exhaustedMarkup, /Included transcription hours, saved recordings, transcriptions exhausted/);
    assert.match(exhaustedMarkup, /View balance and buy credits/);
    const freshMarkup = context.baseUsageAllowanceMarkup({ plan: 'student',
      recordingHoursUsed: 1, recordingHoursLimit: 40,
      recordingCountUsed: 2, recordingCountLimit: 20,
      transcriptionCountUsed: 2, transcriptionCountLimit: 20 });
    assert.match(freshMarkup, /39\.0 transcription hours · 18 saved recordings/);
    assert.doesNotMatch(freshMarkup, /exhausted/);
    timer();
    handlers.focus();
    assert.equal(requests, 2);
    context.document.visibilityState = 'hidden';
    timer();
    assert.equal(requests, 2);
    context.document.visibilityState = 'visible';
    context.S.credits.action = 'pack-checkout';
    timer();
    assert.equal(requests, 2, 'refresh must not interrupt checkout');
    context.S.credits.action = null;
    context.S.view.name = 'notes';
    timer();
    assert.equal(requests, 2, 'refresh must not re-render editing screens');
    context.S.view.name = 'account';
    timer();
    assert.equal(requests, 3, 'Account must refresh purchases made on another device');
    context.S.view.name = 'credits';
    context.S.credits.state = 'error';
    context.S.credits.data = null;
    context.S.credits.error = 'Balance temporarily unavailable';
    assert.doesNotMatch(context.creditsSummaryMarkup(), /<h2>0 /);
    handlers.visibilitychange();
    assert.equal(requests, 4);
  });
}
