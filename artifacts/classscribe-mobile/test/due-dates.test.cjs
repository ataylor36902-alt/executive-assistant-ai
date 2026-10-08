const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const source = fs.readFileSync(path.join(__dirname, '../lib/due-dates.js'), 'utf8');
const output = transformSync(source, { loader: 'js', format: 'cjs' }).code;
const moduleScope = { exports: {} };
vm.runInNewContext(output, { module: moduleScope, exports: moduleScope.exports });
const { isConfirmedDue, isConfirmedDeadlineAlert } = moduleScope.exports;

test('canonical confirmation takes priority over legacy flags', () => {
  assert.equal(isConfirmedDue({ due: '2026-10-02', dateConfirmed: true }), true);
  assert.equal(isConfirmedDue({ due: '2026-10-02', dateConfirmed: false, dueConfirmed: true, dueSource: 'manual' }), false);
  assert.equal(isConfirmedDue({ due: '2026-10-02', dateConfirmed: false, dueSource: 'ai' }), false);
  assert.equal(isConfirmedDue({ dateConfirmed: true }), false);
});

test('prior mobile records remain eligible when explicitly confirmed or manually dated', () => {
  assert.equal(isConfirmedDue({ due: '2026-10-02', dueConfirmed: true }), true);
  assert.equal(isConfirmedDue({ due: '2026-10-02', dueSource: 'manual' }), true);
  assert.equal(isConfirmedDue({ due: '2026-10-02', dueSource: 'ai' }), false);
});

test('alerts require a current course, undone assignment and local-device-day window', () => {
  const ids = new Set(['course-a']);
  const daysUntil = (date) => ({ '2026-10-02': 2, '2026-09-29': -1, '2026-10-30': 30 })[date];
  const item = { courseId: 'course-a', due: '2026-10-02', dateConfirmed: true, done: false };
  assert.equal(isConfirmedDeadlineAlert(item, ids, daysUntil), true);
  assert.equal(isConfirmedDeadlineAlert({ ...item, done: true }, ids, daysUntil), false);
  assert.equal(isConfirmedDeadlineAlert({ ...item, courseId: 'course-b' }, ids, daysUntil), false);
  assert.equal(isConfirmedDeadlineAlert({ ...item, due: '2026-09-29' }, ids, daysUntil), false);
  assert.equal(isConfirmedDeadlineAlert({ ...item, due: '2026-10-30' }, ids, daysUntil), false);
  assert.equal(isConfirmedDeadlineAlert({ ...item, dateConfirmed: false }, ids, daysUntil), false);
});