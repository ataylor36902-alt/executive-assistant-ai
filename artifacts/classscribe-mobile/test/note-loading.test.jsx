import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import NoteEditor from '../app/note/[id]';
import { StoreProvider, useStore } from '../lib/store';
import { libraryCacheKey } from '../lib/store-sync';
import {
  UID, NOTE_ID, disk, remote, writes, gates, reset, AppState, listeners,
} from './fixtures/note-loading-native';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const path = `data/users/${UID}/lib/notes/${NOTE_ID}`;
const original = { id: NOTE_ID, title: 'Biology lecture', body: '## Cells\n\nOriginal saved text.', updated: 123 };
const library = note => ({ courses: {}, lectures: {}, assignments: {}, notes: { [NOTE_ID]: note }, stats: {} });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function open(t, note, source = 'cache') {
  reset();
  if (source === 'cache') disk.set(libraryCacheKey(UID), JSON.stringify(library(note)));
  remote.set(path, structuredClone(note));
  let st;
  function Capture() { st = useStore(); return null; }
  const tree = show => <StoreProvider><Capture />{show ? <NoteEditor /> : null}</StoreProvider>;
  let renderer;
  await act(async () => { renderer = create(tree(true)); await settle(); });
  t.after(async () => {
    gates.cache.resolve(); gates.remote.resolve();
    await act(async () => { renderer.unmount(); await settle(); });
  });
  assert.equal(st.status.loading, true);
  assert.equal(st.note(NOTE_ID), undefined);
  assert.equal(writes.length, 0);
  return {
    renderer, store: () => st,
    async load() {
      await act(async () => { gates.cache.resolve(); await settle(); });
      if (source === 'remote') {
        assert.equal(st.note(NOTE_ID), undefined);
        await act(async () => { gates.remote.resolve(); await settle(); });
      } else {
        assert.equal(st.status.loading, true, 'cache can arrive before the server refresh finishes');
      }
      assert.ok(st.note(NOTE_ID));
    },
    async sync() {
      await act(async () => { gates.remote.resolve(); await settle(); await st.refresh(); await settle(); });
    },
    async leave() {
      await act(async () => { renderer.update(tree(false)); await settle(); });
    },
    async reopen() {
      await act(async () => { renderer.update(tree(true)); await settle(); });
    },
  };
}
function input(h, title = false) {
  return h.renderer.root.findAllByType('TextInput').find(node =>
    title ? node.props.placeholder === 'Title' : node.props.placeholder !== 'Title');
}
async function toggle(h, label) {
  const button = h.renderer.root.findAllByType('Pressable').find(node =>
    node.findAllByType('Text').some(text => text.props.children === label));
  assert.ok(button, `Missing ${label} button`);
  await act(async () => { button.props.onPress(); await settle(); });
}
function assertNote(actual, expected) {
  assert.deepEqual(actual, expected, 'the whole original record must be preserved without edits');
}
function storedNote() { return JSON.parse(disk.get(libraryCacheKey(UID))).notes[NOTE_ID]; }

for (const source of ['cache', 'remote']) {
  test(`delayed ${source} hydration survives preview, backgrounding, leave and refresh without writes`, async t => {
    const h = await open(t, original, source);
    await h.load();
    assert.equal(input(h, true).props.value, original.title);
    assert.equal(h.renderer.root.findByType('Md').props.text, original.body);
    await toggle(h, 'Edit');
    assert.equal(input(h).props.value, original.body);
    await toggle(h, 'Preview');
    await act(async () => { for (const listener of listeners) listener('background'); await settle(); });
    await h.leave();
    await h.sync();
    assert.equal(writes.length, 0, 'viewing and leaving must never issue a note write');
    assertNote(h.store().note(NOTE_ID), original);
    assertNote(storedNote(), original);
    assertNote(remote.get(path), original);
    await h.reopen();
    assert.equal(h.renderer.root.findByType('Md').props.text, original.body);
  });
}

for (const [label, note] of [
  ['empty title and body', { ...original, title: '', body: '' }],
  ['missing title and body', { id: NOTE_ID, updated: 123 }],
  ['null title and body', { ...original, title: null, body: null }],
  ['missing title only', { id: NOTE_ID, body: original.body, updated: 123 }],
  ['missing body only', { id: NOTE_ID, title: original.title, updated: 123 }],
]) {
  test(`${label} renders safely and stays unchanged without edits`, async t => {
    const h = await open(t, note);
    await h.load();
    assert.equal(input(h, true).props.value, typeof note.title === 'string' ? note.title : '');
    if (typeof note.body === 'string' && note.body) await toggle(h, 'Edit');
    assert.equal(input(h).props.value, typeof note.body === 'string' ? note.body : '');
    await toggle(h, 'Preview');
    await h.leave(); await h.sync();
    assert.equal(writes.length, 0);
    assertNote(storedNote(), note); assertNote(remote.get(path), note);
  });
}

test('editing after delayed hydration debounces and autosaves the full draft locally and remotely', async t => {
  const h = await open(t, original);
  await h.load(); await h.sync(); await toggle(h, 'Edit');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await act(async () => { input(h, true).props.onChangeText('Updated title'); });
  await act(async () => { input(h).props.onChangeText('Updated body'); });
  await act(async () => { t.mock.timers.tick(699); await settle(); });
  assert.equal(writes.length, 0, 'autosave waits for the typing pause');
  await act(async () => { t.mock.timers.tick(1); await settle(); });
  assert.equal(writes.length, 1);
  assert.equal(storedNote().title, 'Updated title');
  assert.equal(storedNote().body, 'Updated body');
  assert.equal(remote.get(path).title, 'Updated title');
  assert.equal(remote.get(path).body, 'Updated body');
  assert.equal(h.renderer.root.findAllByType('Text').find(n => n.props.testID === 'note-save-status').props.children, 'Saved and synced');
  await h.leave(); await h.sync();
  assert.equal(writes.length, 1, 'leaving after a confirmed save must not write again');
  await h.reopen();
  assert.equal(h.renderer.root.findByType('Md').props.text, 'Updated body');
});

test('leaving before debounce saves an edit to missing text and offline refresh syncs it later', async t => {
  const h = await open(t, { id: NOTE_ID, updated: 123 });
  await h.load(); await h.sync();
  gates.offline = true;
  await act(async () => { input(h, true).props.onChangeText('New title'); });
  await act(async () => { input(h).props.onChangeText('New body'); });
  await h.leave();
  assert.equal(storedNote().body, 'New body');
  assert.equal(storedNote().title, 'New title');
  assert.equal(storedNote()._pending, true);
  assert.equal(remote.get(path).body, undefined);
  gates.offline = false;
  await h.sync();
  assert.equal(storedNote().body, 'New body');
  assert.equal(storedNote()._pending, undefined);
  assert.equal(remote.get(path).body, 'New body');
  await h.reopen();
  assert.equal(h.renderer.root.findByType('Md').props.text, 'New body');
});

test('intentionally clearing both fields remains a valid autosaved edit', async t => {
  const h = await open(t, original);
  await h.load(); await h.sync(); await toggle(h, 'Edit');
  await act(async () => { input(h, true).props.onChangeText(''); });
  await act(async () => { input(h).props.onChangeText(''); });
  await toggle(h, 'Preview');
  await h.leave(); await h.sync();
  assert.equal(storedNote().title, '');
  assert.equal(storedNote().body, '');
  assert.equal(remote.get(path).title, '');
  assert.equal(remote.get(path).body, '');
});
