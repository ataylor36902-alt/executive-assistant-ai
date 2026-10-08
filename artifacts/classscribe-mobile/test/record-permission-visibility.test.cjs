const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('esbuild');

const source = fs.readFileSync(path.join(__dirname, '../app/record.js'), 'utf8');
const tokens = require('../lib/appearance-tokens.json');
const componentSource = source.slice(source.indexOf('function PermissionSwitch('), source.indexOf('export default function Record'));
const componentCode = transformSync(componentSource, { loader: 'jsx' }).code;

function contrast(a, b) {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => {
      const x = parseInt(value, 16) / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('permission switches visibly distinguish off/on in light and dark themes', () => {
  for (const palette of Object.values(tokens)) {
    for (const value of [false, true]) {
      let control;
      const onValueChange = () => {};
      const C = { sec: palette.secondaryText, accent: palette.accent, accentText: palette.accentText, cell: palette.card };
      const Component = vm.runInNewContext(`${componentCode}\nPermissionSwitch;`, {
        React, C,
        View: ({ children }) => React.createElement('div', null, children),
        Text: ({ children }) => React.createElement('span', null, children),
        Switch: props => { control = props; return React.createElement('button'); },
      });
      const markup = renderToStaticMarkup(React.createElement(Component, { value, onValueChange, label: 'Permission', testID: 'test-permission' }));
      assert.match(markup, value ? />On</ : />Off</);
      assert.equal(control.value, value);
      assert.equal(control.onValueChange, onValueChange);
      assert.equal(control.accessibilityLabel, 'Permission');
      assert.equal(control.testID, 'test-permission');
      assert.equal(control.ios_backgroundColor, C.sec);
      const track = control.trackColor[value];
      assert.ok(contrast(track, C.cell) >= 3, 'track must contrast with its card');
      assert.ok(contrast(track, control.thumbColor) >= 3, 'thumb must contrast with its track');
    }
  }
});

test('all three switches remain deliberate choices with required and optional guidance', () => {
  for (const name of ['c1', 'c2', 'accommodation']) {
    assert.match(source, new RegExp(`\\[${name}, [^\\]]+\\] = useState\\(false\\)`));
    assert.match(source, new RegExp(`<PermissionSwitch value=\\{${name}\\}`));
  }
  assert.match(source, /both required switches to agree/);
  assert.match(source, /accommodation switch is optional/);
  assert.match(source, /const ready = c1 && c2 &&/);
});
