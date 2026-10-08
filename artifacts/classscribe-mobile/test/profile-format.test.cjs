const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

let ProfileFields;
let accountProfilePatch;
let fixtureDir;

test.before(async () => {
  const { buildProfileFormatFixtures } = await import('./build-profile-format.mjs');
  fixtureDir = mkdtempSync(join(tmpdir(), 'classscribe-profile-format-'));
  await buildProfileFormatFixtures({ outdir: fixtureDir });
  ({ ProfileFields } = require(join(fixtureDir, '.profile-fields-test.cjs')));
  ({ accountProfilePatch } = require(join(fixtureDir, '.account-profile-test.cjs')));
});

test.after(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

function findByTestId(node, testID) {
  if (!node || typeof node !== 'object') return null;
  if (node.props?.testID === testID) return node;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findByTestId(child, testID);
    if (found) return found;
  }
  return null;
}

function collectText(node, output = []) {
  if (typeof node === 'string') output.push(node);
  else if (Array.isArray(node)) node.forEach(child => collectText(child, output));
  else if (node && typeof node === 'object') collectText(node.props?.children, output);
  return output;
}

test('class format selection persists only the changed library field', async () => {
  for (const [mode, label] of [['online', 'Online'], ['in-person', 'In-person']]) {
    let draft = { firstName: 'Ada', school: 'State University' };
    const tree = ProfileFields({ p: draft, set: next => { draft = next; } });
    const visibleText = collectText(tree).join(' ');
    assert.match(visibleText, /Class format/);
    assert.match(visibleText, /Online/);
    assert.match(visibleText, /In-person/);
    assert.match(visibleText, /library syncs across your devices/);
    assert.match(visibleText, /does not change billing/);
    const choice = findByTestId(tree, `class-format-${mode}`);
    assert.ok(choice, `missing ${label} choice`);
    choice.props.onPress();
    assert.equal(draft.learningMode, mode);

    const patch = accountProfilePatch(draft, { ...draft, learningMode: undefined });
    const libraryProfile = { ...draft, appearance: 'dark', homeLayout: 'study-first' };
    const st = { saveProfile: async fields => Object.assign(libraryProfile, fields) };
    await st.saveProfile(patch);

    assert.deepEqual(patch, { learningMode: mode });
    assert.equal(libraryProfile.learningMode, mode);
    assert.equal(libraryProfile.appearance, 'dark');
    assert.equal(libraryProfile.homeLayout, 'study-first');
  }
});

test('legacy profiles without a class format remain unset until a student chooses one', () => {
  const legacyProfile = { firstName: 'Ada', school: 'State University' };
  assert.deepEqual(accountProfilePatch(legacyProfile, legacyProfile), {});
  assert.equal(Object.hasOwn(legacyProfile, 'learningMode'), false);
});