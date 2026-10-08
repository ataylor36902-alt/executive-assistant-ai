import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { cases, course, item, category, entry, result } from '../../../scripts/test/grade-guidance-fixtures.mjs';

const source = fs.readFileSync(new URL('../web-src/10_grades.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web-public/index.html', import.meta.url), 'utf8');
const start = html.indexOf('/* Grades are server-owned.');
assert.ok(start > 0);
// Exercise the actual served functions too; do not rebuild the page for tests.
const served = html.slice(start, html.indexOf('</script>', start));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(code) {
  const c = {
    S: { uid: 'library-a', courses: { [course.id]: course }, assignments: {}, billing: {}, view: { name: 'grades' } },
    VIEWS: {}, AFTER: {}, ACT: {}, access: 'allowed', events: {}, calls: [],
    document: { addEventListener: (name, fn) => { c.events[name] = fn; } },
    billingUserCode: () => c.S.uid, examFeatureState: () => c.access,
    esc: s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    course: id => c.S.courses[id], clone: structuredClone, goAttr: () => '', ccVar: () => '',
    plural: (n, label) => `${n} ${label}s`, ic: () => '', fmtD: x => x,
    render() {}, closeModal() {}, toast() {}, loadBillingStatus() {},
    confirm: () => true, uid: () => 'Saved weak test',
    FormData: class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } },
    fetch: async (url, options) => { c.calls.push({ url, options }); return { ok: true, json: async () => c.response }; },
  };
  vm.createContext(c);
  vm.runInContext(code, c);
  c.setData = data => { c.fixture = data; vm.runInContext("GRADES.code=S.uid;GRADES.state='ready';GRADES.data=fixture", c); };
  c.setData(result());
  c.submitItem = async (values, id = '') => {
    const error = { hidden: true };
    const form = { values, dataset: { form: 'gradeItem', cid: course.id, id }, querySelector: selector => selector === '.grade-form-error' ? error : null };
    await c.events.submit({ target: { closest: () => form }, preventDefault() {} });
    assert.equal(error.hidden, true, error.textContent);
  };
  return c;
}

for (const [label, code] of [['source', source], ['served page', served]]) {
  for (const scenario of cases) test(`web ${label}: ${scenario.name}`, () => {
    const c = harness(code);
    const advice = c.gradeCoach(scenario.row, course.code);
    for (const pattern of scenario.includes) assert.match(advice, pattern);
    for (const pattern of scenario.excludes) assert.doesNotMatch(advice, pattern);
  });
  test(`web ${label}: only current real courses contribute to overview advice`, () => {
    const c = harness(code);
    c.S.courses.example = { id: 'example', code: 'DEMO', name: 'Example', ex: true };
    c.setData(result(
      entry([item('Real feedback', 'quiz', 80)], [category('quiz', 80)]),
      entry([item('Example secret', 'test', 0)], [category('test', 0)], null, 'example'),
      entry([item('Foreign secret', 'test', 0)], [category('test', 0)], null, 'foreign')));
    const advice = c.gradesOverview().split('<div class="grade-overview-head">')[0];
    assert.match(advice, /Real feedback/);
    assert.doesNotMatch(advice, /Example secret|Foreign secret|DEMO/);
    assert.doesNotMatch(c.gradesCourseContent('example'), /grade-coach|Example secret/);
  });
  test(`web ${label}: save and actual Remove action replace advice with acknowledged scores`, async () => {
    const c = harness(code);
    c.setData(result(entry()));
    assert.match(c.gradesShell(course.id), /Enter a score from/);
    const weak = entry([item('Saved weak test', 'test', 25)], [category('test', 25)]);
    c.response = result(weak);
    await c.submitItem({ title: 'Saved weak test', type: 'test', earned: '25', possible: '100' });
    assert.equal(JSON.parse(c.calls.at(-1).options.body).gradebook.items[0].earned, 25);
    assert.match(c.gradesShell(course.id), /Rework Saved weak test/);
    const improved = entry([item('Saved weak test', 'test', 100)], [category('test', 100)]);
    c.response = result(improved);
    await c.submitItem({ title: 'Saved weak test', type: 'test', earned: '100', possible: '100' }, 'Saved weak test');
    assert.doesNotMatch(c.gradesShell(course.id), /Rework Saved weak test/);
    c.response = result(entry());
    await c.ACT.gradeDelete({ dataset: { cid: course.id, id: 'Saved weak test' } });
    assert.deepEqual(JSON.parse(c.calls.at(-1).options.body).gradebook.items, []);
    assert.match(c.gradesShell(course.id), /Enter a score from/);
  });
  test(`web ${label}: paid advice stays hidden for all denied and unverified states`, async () => {
    const c = harness(code);
    c.setData(result(entry([item('Private weak score', 'quiz', 20)], [category('quiz', 20)])));
    for (const access of ['locked', 'loading', 'error']) {
      c.access = access;
      for (const id of [undefined, course.id]) assert.doesNotMatch(c.gradesShell(id), /grade-coach|Private weak score/);
      await c.loadGrades(true);
    }
    assert.equal(c.calls.length, 0);
    c.access = 'allowed';
    vm.runInContext("GRADES.state='locked'", c);
    assert.doesNotMatch(c.gradesShell(course.id), /grade-coach|Private weak score/);
  });
  test(`web ${label}: library switch immediately clears cached advice`, () => {
    const c = harness(code);
    c.setData(result(entry([item('Other library secret', 'quiz', 10)], [category('quiz', 10)])));
    assert.match(c.gradesShell(course.id), /Other library secret/);
    c.S.uid = 'library-b';
    assert.doesNotMatch(c.gradesShell(course.id), /Other library secret|grade-coach/);
    assert.equal(vm.runInContext('GRADES.data', c), null);
  });
  for (const operation of ['load', 'save']) test(`web ${label}: delayed ${operation} cannot restore old-library advice`, async () => {
    const c = harness(code);
    const held = deferred();
    c.fetch = async () => ({ ok: true, json: () => held.promise });
    const pending = operation === 'load' ? c.loadGrades(true) : c.saveGradeBook(entry().gradebook);
    c.S.uid = 'library-b';
    c.gradesShell();
    held.resolve(result(entry([item('Late secret', 'quiz', 10)], [category('quiz', 10)])));
    await pending;
    assert.doesNotMatch(c.gradesShell(course.id), /Late secret|grade-coach/);
  });
}
