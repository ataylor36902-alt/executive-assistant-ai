import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = ['../web-src/4_views.js', '../web-public/index.html'];

function fixture(file) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = source.indexOf('function render(){');
  const end = source.indexOf('\nlet LEAVE=', start);
  assert.ok(start >= 0 && end > start);
  let writes = 0;
  let form = null;
  const main = {
    querySelector: () => form,
    set innerHTML(value) {
      writes++;
      form = value.includes('data-form="welcome"')
        ? { dataset: {}, firstName: '', birthMonth: '', birthYear: '', consent: false }
        : null;
    },
  };
  const app = { dataset: {}, classList: { toggle() {} } };
  const tabbar = {};
  const state = { profile: null, mode: 'db', uid: 'fictional-library-a', view: { name: 'home' } };
  const context = vm.createContext({
    S: state, pending: true,
    $: selector => ({ '#main': main, '.app': app, '#tabbar': tabbar }[selector]),
    shouldGateOnboarding: profile => !profile,
    VIEWS: { welcome: () => '<form data-form="welcome"></form>', plans: () => 'plans', home: () => 'home' },
    AFTER: {}, renderSide() {}, renderTabbar() {}, topbar: () => '', ic: () => '',
  });
  vm.runInContext(source.slice(start, end), context);
  return { state, render: () => context.render(), get form() { return form; }, get writes() { return writes; } };
}

for (const file of files) {
  test(`${file}: updates and keyboard blur preserve the mounted setup form`, () => {
    const ui = fixture(file);
    ui.render();
    const form = ui.form;
    Object.assign(form, { firstName: 'Test Student', birthMonth: '6', birthYear: '2000', consent: true });
    for (let update = 0; update < 5; update++) ui.render();
    assert.equal(ui.writes, 1);
    assert.equal(ui.form, form);
    assert.equal(ui.form.firstName, 'Test Student');
    assert.equal(ui.form.birthMonth, '6');
    assert.equal(ui.form.birthYear, '2000');
    assert.equal(ui.form.consent, true);
  });

  test(`${file}: switching library or local/synced identity clears the unsaved form`, () => {
    const ui = fixture(file);
    ui.render();
    ui.form.firstName = 'Previous Student';
    ui.state.uid = 'fictional-library-b';
    ui.render();
    assert.equal(ui.writes, 2);
    assert.equal(ui.form.firstName, '');
    ui.form.firstName = 'Another Student';
    ui.state.mode = 'local';
    ui.state.uid = null;
    ui.render();
    assert.equal(ui.writes, 3);
    assert.equal(ui.form.firstName, '');
  });

  test(`${file}: a completed profile leaves setup and opens plan selection`, () => {
    const ui = fixture(file);
    ui.render();
    ui.state.profile = { firstName: 'Test Student', ageBand: '18+' };
    ui.state.view = { name: 'plans', onboarding: true };
    ui.render();
    assert.equal(ui.form, null);
    assert.equal(ui.state.view.name, 'plans');
  });
}
