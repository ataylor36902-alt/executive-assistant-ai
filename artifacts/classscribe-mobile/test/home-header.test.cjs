const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { transformSync } = require('esbuild');

const source = readFileSync(join(__dirname, '../app/(tabs)/home/index.js'), 'utf8');
const start = source.indexOf("    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 9 }}>");
const end = source.indexOf('    <View style={{ marginTop: 20', start);
assert.ok(start >= 0 && end > start, 'Home header must be present');
const code = transformSync(`const tree = <>${source.slice(start, end)}</>; tree;`, {
  loader: 'jsx',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
}).code;

function header(balance) {
  const routes = [];
  let viewOpened = false;
  const tree = runInNewContext(code, {
    React: { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable',
    Ionicons: 'Ionicons', ProfileAvatar: 'ProfileAvatar',
    require: () => ({}),
    colors: {}, C: {}, first: 'Student',
    st: { status: { uid: 'test-library' } }, profilePhoto: { source: null },
    credits: { status: balance === undefined ? null : { balance, currency: { name: 'Scribe Credits' } } },
    layout: 'class-first', LAYOUTS: [['class-first', 'Class-first (default)']],
    openView: () => { viewOpened = true; },
    router: { push: (path) => routes.push(path) },
  });
  return { rows: tree.children.filter(child => child && typeof child === 'object'), routes, viewOpened: () => viewOpened };
}

test('brand shares its row only with the icon, Help, and Account, not variable-width tools', () => {
  const [brandRow, toolsRow] = header().rows;
  assert.equal(brandRow.children.length, 4);
  assert.equal(brandRow.children[1].children[0], 'ClassScribe');
  assert.equal(brandRow.children[2].props.accessibilityLabel, 'Help');
  assert.equal(brandRow.children[3].props.accessibilityLabel, 'Account');
  assert.equal(toolsRow.props.testID, 'home-header-tools');
  assert.equal(toolsRow.props.style.flexWrap, 'wrap');
});

test('wordmark fits a single line instead of being clipped at larger text sizes', () => {
  const brand = header().rows[0].children[1];
  assert.equal(brand.props.numberOfLines, 1);
  assert.equal(brand.props.adjustsFontSizeToFit, true);
  assert.equal(brand.props.minimumFontScale, 0.5);
  assert.equal(brand.props.style.flex, 1);
});

test('loading and large credit balances stay outside the brand row', () => {
  for (const balance of [undefined, 0, 999999999]) {
    const [brandRow, toolsRow] = header(balance).rows;
    assert.equal(brandRow.children[1].children[0], 'ClassScribe');
    assert.equal(toolsRow.children[1].children[1].children[0], balance ?? 'Credits');
    assert.ok(toolsRow.children[1].props.accessibilityLabel.startsWith('Credits balance'));
  }
});

test('all rearranged header controls retain their original actions', () => {
  const rendered = header(30);
  const [brandRow, toolsRow] = rendered.rows;
  brandRow.children[2].props.onPress();
  brandRow.children[3].props.onPress();
  toolsRow.children[0].props.onPress();
  toolsRow.children[1].props.onPress();
  assert.deepEqual(rendered.routes, ['/support', '/account', '/credits']);
  assert.equal(rendered.viewOpened(), true);
});
