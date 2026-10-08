import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Grades from '../app/grades';
import { env, controls, inputs, reset, beginRender, focusScreen } from './fixtures/grade-guidance-ui';
import { cases, course, item, category, entry, result } from '../../../scripts/test/grade-guidance-fixtures.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function render() { beginRender(); return renderToStaticMarkup(<Grades />); }
function guidance(markup) {
  const start = markup.indexOf('guidance-portrait');
  if (start < 0) return '';
  return markup.slice(start, markup.indexOf('Estimates are not promises of outcomes.', start))
    .replace(/<[^>]+>/g, '').replaceAll('&#x27;', "'").replaceAll('&quot;', '"');
}
async function open(data, params = { courseId: course.id }, courses = [course]) {
  reset({ data, params, courses });
  render();
  focusScreen();
  await tick();
  return render();
}
async function press(title) {
  const button = controls.find(c => c.title === title);
  assert.ok(button, `Missing ${title}`);
  assert.ok(!button.disabled, `${title} unexpectedly disabled`);
  await button.onPress();
}
function fill(placeholder, value) {
  const input = inputs.find(i => i.placeholder === placeholder);
  assert.ok(input, `Missing field ${placeholder}`);
  input.onChangeText(value);
  render();
}

for (const scenario of cases) test(`mobile: ${scenario.name}`, async () => {
  const advice = guidance(await open(result(scenario.row)));
  assert.ok(advice, 'Guidance should render after loading');
  for (const pattern of scenario.includes) assert.match(advice, pattern);
  for (const pattern of scenario.excludes) assert.doesNotMatch(advice, pattern);
});

test('mobile: overview item belongs to its priority category AND course', async () => {
  const second = { id: 'chemistry', code: 'CHEM', name: 'Chemistry' };
  const advice = guidance(await open(result(
    entry([item('BIO test', 'test', 40)], [category('test', 40)]),
    entry([item('CHEM tiny test', 'test', 0, 1), item('CHEM large test', 'test', 100)], [category('test', 100 / 101 * 100)], null, second.id),
  ), {}, [course, second]));
  assert.match(advice, /Review BIO · Tests/);
  assert.match(advice, /Revisit “BIO · BIO test”/);
  assert.doesNotMatch(advice, /CHEM tiny test/);
});

test('mobile: neither example nor unknown-course data contributes to advice', async () => {
  const example = { id: 'example', code: 'DEMO', name: 'Example', ex: true };
  const data = result(
    entry([item('Real feedback', 'quiz', 80)], [category('quiz', 80)]),
    entry([item('Example secret', 'test', 0)], [category('test', 0)], null, example.id),
    entry([item('Foreign secret', 'test', 0)], [category('test', 0)], null, 'foreign'));
  const advice = guidance(await open(data, {}, [course, example]));
  assert.match(advice, /Real feedback/);
  assert.doesNotMatch(advice, /DEMO|Example secret|Foreign secret/);
  env.params = { courseId: example.id };
  render(); focusScreen(); await tick();
  const markup = render();
  assert.match(markup, /Example course/);
  assert.equal(guidance(markup), '');
});

test('mobile: real Add, Save and Remove callbacks recompute visible advice', async () => {
  assert.match(guidance(await open(result(entry()))), /Add a returned/);
  await press('add-grade');
  render();
  fill('e.g. Research outline', 'Saved weak assignment');
  fill('Not graded yet', '25');
  fill('100', '100');
  render();
  env.save = async book => result(entry(book.items, [category('assignment', 25)]));
  await press('Save score');
  assert.equal(env.saves.at(-1).items[0].earned, 25);
  assert.match(guidance(render()), /Saved weak assignment/);
  await press('Edit Saved weak assignment');
  render();
  fill('Not graded yet', '100');
  render();
  env.save = async book => result(entry(book.items, [category('assignment', 100)]));
  await press('Save score');
  assert.doesNotMatch(guidance(render()), /missed step/);
  env.save = async book => result(entry(book.items));
  await press('Remove Saved weak assignment');
  assert.deepEqual(env.saves.at(-1).items, []);
  assert.match(guidance(render()), /Add a returned/);
});

test('mobile: Free, expired, loading and unverifiable plans hide cached paid advice', async () => {
  await open(result(entry([item('Private weak score', 'quiz', 20)], [category('quiz', 20)])));
  for (const billing of [
    { status: { plan: 'free', status: 'active' } },
    { status: { plan: 'student', status: 'expired' } },
    { loading: true, status: { plan: 'student', status: 'active' } },
    { error: 'Unable to verify', status: { plan: 'pro', status: 'active' } },
  ]) {
    env.billing = billing;
    assert.equal(guidance(render()), '');
    assert.doesNotMatch(render(), /Private weak score/);
  }
  reset({ courses: [course], data: result(entry()) });
  env.billing = { status: { plan: 'free', status: 'active' } };
  render(); focusScreen(); await tick();
  assert.deepEqual(env.calls, []);
});

test('mobile: active and trial Student and Pro plans still show guidance', async () => {
  for (const plan of ['student', 'pro']) for (const status of ['active', 'trialing']) {
    reset({ courses: [course], data: result(entry([item('Paid work', 'quiz', 50)], [category('quiz', 50)])) });
    env.billing = { status: { plan, status } };
    render(); focusScreen(); await tick();
    assert.match(guidance(render()), /Paid work/, `${plan}/${status}`);
  }
});

test('mobile: library switch hides advice before any effect or request completes', async () => {
  await open(result(entry([item('Old library secret', 'quiz', 10)], [category('quiz', 10)])));
  assert.match(guidance(render()), /Old library secret/);
  env.uid = 'library-b';
  assert.doesNotMatch(render(), /Old library secret/);
  assert.equal(guidance(render()), '');
  env.data = result(entry([item('New library work', 'test', 50)], [category('test', 50)]));
  focusScreen(); await tick();
  assert.match(guidance(render()), /New library work/);
});

for (const operation of ['load', 'save']) test(`mobile: delayed ${operation} cannot leak across libraries`, async () => {
  await open(result(entry([item('Late secret', 'quiz', 10)], [category('quiz', 10)])));
  const held = deferred();
  if (operation === 'load') { env.list = () => held.promise; focusScreen(); }
  else {
    await press('add-grade'); render();
    fill('e.g. Research outline', 'Late secret'); fill('Not graded yet', '10'); fill('100', '100'); render();
    env.save = () => held.promise;
  }
  const pending = operation === 'save' ? press('Save score') : null;
  env.uid = 'library-b';
  assert.doesNotMatch(render(), /Late secret/);
  held.resolve(result(entry([item('Late secret', 'quiz', 10)], [category('quiz', 10)])));
  await pending; await tick();
  assert.doesNotMatch(render(), /Late secret/);
  assert.equal(guidance(render()), '');
});
