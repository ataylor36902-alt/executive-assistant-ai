import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web-src/4_views.js', import.meta.url), 'utf8');
const served = readFileSync(new URL('../web-public/index.html', import.meta.url), 'utf8');
const head = readFileSync(new URL('../web-src/1_head.html', import.meta.url), 'utf8');
const support = readFileSync(new URL('../web-public/support.js', import.meta.url), 'utf8');
const topbar = text => text.slice(text.indexOf('function topbar(){'), text.indexOf('function shouldGateOnboarding'));

test('editable and served headers stay aligned', () => {
  assert.equal(topbar(source), topbar(served));
});

for (const [copy, text] of [['source', source], ['served', served]]) {
  test(`${copy}: Record is kept on Home and other pages, but not Plans`, () => {
    const context = vm.createContext({
      S: { view: { name: 'home' }, q: '' },
      ic: () => '', esc: value => value,
      goAttr: view => `data-go="${view.name}"`,
    });
    vm.runInContext(topbar(text), context);
    for (const name of ['home', 'schedule', 'notes', 'account', 'course', 'grades', 'plans']) {
      context.S.view.name = name;
      const html = vm.runInContext('topbar()', context);
      assert.equal(html.includes('aria-label="Record a lecture"'), name !== 'plans', name);
      if (name !== 'plans') assert.match(html, /data-go="capture"/);
    }
    assert.ok(text.includes("(v.name==='capture'?'':topbar())+f(v)"));
  });
}

test('responsive header keeps a full tap target and a shrinkable search field', () => {
  for (const text of [head, served]) {
    assert.match(text, /\.topbar\{[^}]*flex-wrap:wrap/);
    assert.match(text, /\.topbar \.btn\.rec\{[^}]*min-height:44px/);
    assert.match(text, /\.search\{[^}]*min-width:0/);
    assert.doesNotMatch(text, /\.topbar \.btn\.rec\{display:none\}/);
  }
});

test('Help stays bottom-anchored above the tablet and phone navigation', () => {
  assert.match(support, /\.cs-support-launch\{position:fixed;right:18px;bottom:/);
  assert.match(head, /@media \(max-width:860px\)/);
  assert.match(support, /@media \(max-width:860px\)\{\s*\.cs-support-launch\{right:12px;bottom:calc\(88px/);
});
