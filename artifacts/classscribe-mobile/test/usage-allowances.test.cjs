const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../lib/usage-allowances.js'), 'utf8');
const context = {};
runInNewContext(source.replace('export function ', 'function '), context);
const summarize = context.usageAllowanceSummary;

test('base remaining clamps paid overage and identifies each exhausted limit', () => {
  const result = summarize({ plan: 'student', recordingHoursUsed: 31, recordingHoursLimit: 30,
    recordingCountUsed: 22, recordingCountLimit: 20, transcriptionCountUsed: 21, transcriptionCountLimit: 20 });
  assert.equal(result.hours, 0);
  assert.equal(result.recordings, 0);
  assert.equal(result.exhausted.join(', '), 'transcription hours, saved recordings, transcriptions');
  assert.equal(result.paid, true);
});
test('included allowances stay available until exhausted and unknown usage never looks like zero', () => {
  const result = summarize({ plan: 'pro', recordingHoursUsed: 1.5, recordingHoursLimit: 120,
    recordingCountUsed: 2, recordingCountLimit: 60, transcriptionCountUsed: 59, transcriptionCountLimit: 60 });
  assert.equal(result.hours, 118.5);
  assert.equal(result.recordings, 58);
  assert.equal(result.exhausted.length, 0);
  assert.equal(summarize(null), null);
  assert.equal(summarize({ plan: 'free' }).hours, null);
  assert.equal(summarize({ plan: 'free' }).paid, false);
});
test('Account and Plans both show remaining base usage and point to existing store purchase screen', () => {
  const path = require('node:path');
  for (const file of ['account', 'plans']) {
    assert.match(readFileSync(path.join(__dirname, `../app/${file}.js`), 'utf8'), /<UsageAllowances status=/);
  }
  const component = readFileSync(path.join(__dirname, '../components/UsageAllowances.js'), 'utf8');
  assert.match(component, /router\.push\('\/credits'\)/);
  assert.match(component, /Unspent Scribe Credits do not expire/);
});
