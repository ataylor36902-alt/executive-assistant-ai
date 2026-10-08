import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ClassTab from '../app/(tabs)/class/index';
import Lecture from '../app/lecture/[id]';
import { beginRender, controls, documents, failNextPost, focusScreen, inputs, queries, resetHooks, session, setLecture } from './fixtures/class-groups-ui';

function render() {
  beginRender();
  return renderToStaticMarkup(<ClassTab />);
}
function press(title) {
  const control = controls.find(c => c.title === title);
  assert.ok(control, `missing ${title}`);
  assert.notEqual(control.disabled, true);
  return control.onPress();
}
function enter(title, value) {
  const input = inputs.find(i => i.title === title);
  assert.ok(input, `missing ${title}`);
  input.onChangeText(value);
}
async function refresh() {
  render();
  const stop = focusScreen();
  await new Promise(resolve => setImmediate(resolve));
  stop?.();
  return render();
}

test('two students join a group while the same display code in another course stays isolated and a failed post keeps its draft', async () => {
  documents.posts.length = 0;
  documents.shared.length = 0;
  queries.length = 0;
  const first = [{ id: 'biology', code: 'BIO101' }, { id: 'biology-evening', code: 'BIO101' }];
  session('u_first', first);
  render();
  press('Create group');
  const groupA = first[0].groupCode;
  assert.match(groupA, /^g_[0-9a-f]{32}$/);
  session('u_first', first);
  setLecture({ id: 'lecture-a', courseId: 'biology', title: 'Cell lecture', date: '2026-09-26', analysis: { summary: 'Cell division' }, segs: [] });
  beginRender();
  renderToStaticMarkup(<Lecture />);
  press('More actions');
  await press('Share with class');
  assert.equal(documents.shared[0].data.code, groupA, 'lecture action should share with the selected course group');
  assert.equal(documents.shared[0].data.title, 'Cell lecture');
  resetHooks();
  await refresh();
  enter('Message BIO101', 'Bring the cell diagram');
  assert.match(render(), /Bring the cell diagram/, 'typing should update composer');
  failNextPost();
  await press('Send');
  assert.match(render(), /Bring the cell diagram/, 'failed post should leave draft');
  assert.match(render(), /Could not send/);
  await press('Send');
  assert.equal(documents.posts[0].data.code, groupA);
  assert.match(await refresh(), /Bring the cell diagram/, 'sent post should load for author');
  press('Shared lectures (1)');
  assert.match(render(), /Cell lecture/);

  // Different local course, same display code: no inherited group or posts.
  render();
  const courseButtons = controls.filter(c => c.title === 'BIO101');
  assert.equal(courseButtons.length, 2);
  courseButtons[1].onPress();
  render();
  press('Create group');
  const groupB = first[1].groupCode;
  assert.notEqual(groupB, groupA);
  assert.doesNotMatch(await refresh(), /Cell lecture|Bring the cell diagram/);
  assert.deepEqual(queries.at(-2).where, [['code', '==', groupB]]);
  assert.deepEqual(queries.at(-1).where, [['code', '==', groupB]]);

  const second = [{ id: 'other-student-course', code: 'BIO101' }];
  session('u_second', second);
  render();
  enter('Class invite code', groupA);
  render();
  press('Join group');
  assert.equal(second[0].groupCode, groupA);
  assert.match(await refresh(), /Bring the cell diagram/, 'joined student should load post');
  press('Shared lectures (1)');
  assert.match(render(), /Cell lecture/);

  const outsider = [{ id: 'outsider-course', code: 'BIO101', groupCode: groupB }];
  session('u_outsider', outsider);
  assert.doesNotMatch(await refresh(), /Bring the cell diagram|Cell lecture/);
  press('Shared lectures (0)');
  assert.doesNotMatch(render(), /Cell lecture/);
});