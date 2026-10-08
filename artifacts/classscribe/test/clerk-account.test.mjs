import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const accountPath = new URL('../web-src/8_account.js', import.meta.url);
const corePath = new URL('../web-src/3_core.js', import.meta.url);
const viewsPath = new URL('../web-src/4_views.js', import.meta.url);
const htmlPath = new URL('../web-public/index.html', import.meta.url);
const reactPath = new URL('../src/App.tsx', import.meta.url);
const accountSource = readFileSync(accountPath, 'utf8');
const coreSource = readFileSync(corePath, 'utf8');
const viewsSource = readFileSync(viewsPath, 'utf8');
const servedHtml = readFileSync(htmlPath, 'utf8');
const reactSource = readFileSync(reactPath, 'utf8');

test('legacy account and deep-link source parse as JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(accountSource));
  assert.doesNotThrow(() => new vm.Script(coreSource));
});

test('embedded Account offers a top-level sign-in link without mounting Clerk', () => {
  const init = accountSource.slice(accountSource.indexOf('function initClerkAccount()'));
  assert.match(init, /if\(isEmbeddedPreview\(\)\)[\s\S]*?target="_blank" rel="noopener" href="\$\{esc\(clerkAccountPageUrl\(\)\)\}"/);
  assert.ok(init.indexOf('if(isEmbeddedPreview())') < init.indexOf('loadClerkBrowser()'));
  assert.match(coreSource, /get\('cs_account'\)==='1'\)S\.view=\{name:'account'\}/);
});

test('explicit Account deep link bypasses onboarding only after profile loading', () => {
  const helper = viewsSource.match(/function shouldGateOnboarding\(profile,search=location\.search\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper);
  const shouldGate = vm.runInNewContext(`(${helper})`, {
    URLSearchParams,
    location: { search: '' },
  });
  assert.equal(shouldGate(undefined, '?cs_account=1'), true);
  assert.equal(shouldGate(null, ''), true);
  assert.equal(shouldGate(null, '?cs_account=1'), false);
  assert.equal(shouldGate({ firstName: 'Ada' }, ''), false);
  assert.match(viewsSource, /const gate=shouldGateOnboarding\(S\.profile\)/);
  assert.match(accountSource, /VIEWS\.account=\(\)=>\{const p=S\.profile\|\|\{\}/);
  assert.match(accountSource, /AFTER\.account=.+initClerkAccount\(\)/);
  assert.ok(servedHtml.includes(helper));
});

test('Apple availability, account linking, and relay guidance are explicit', () => {
  assert.match(accountSource, /socialProviderStrategies/);
  assert.match(accountSource, /createExternalAccount\(\{strategy:'oauth_apple',redirectUrl\}\)/);
  assert.match(accountSource, /externalVerificationRedirectURL/);
  assert.match(accountSource, /window\.location\.assign\(redirect\)/);
  assert.doesNotMatch(accountSource, /handleRedirectCallback/);
  assert.match(accountSource, /sessionStorage\.setItem\('cs_clerk_apple_link_user_id',user\.id\)/);
  assert.match(accountSource, /if\(user\.id!==expectedUserId\)/);
  assert.match(accountSource, /user=await user\.reload\(\)/);
  assert.match(accountSource, /verification\.status!=='verified'/);
  assert.match(accountSource, /new URL\(window\.location\.pathname\|\|'\/',window\.location\.origin\)/);
  const refreshStart = accountSource.indexOf('function refreshClerkAccount()');
  const refreshEnd = accountSource.indexOf('function clerkSignInResource()', refreshStart);
  assert.doesNotMatch(accountSource.slice(refreshStart, refreshEnd), /clerkAccountError\(''\)/);
  assert.match(accountSource, /Hide My Email/);
  assert.match(accountSource, /does not find or merge accounts by email/);
  assert.match(accountSource, /Optional account sign-in failed to load: \$\{clerkErrorDetail\(error\)\}/);
  assert.match(accountSource, /Account sign-in could not be displayed: \$\{clerkErrorDetail\(e\)\}/);
});

test('served HTML and React sign-in retain the iframe guidance', () => {
  assert.ok(servedHtml.includes('function linkClerkApple(button)'));
  assert.ok(servedHtml.includes("createExternalAccount({strategy:'oauth_apple',redirectUrl})"));
  assert.ok(!servedHtml.includes('handleRedirectCallback'));
  assert.ok(servedHtml.includes('Open sign-in in a new tab'));
  for (const [start, end] of [
    ['let clerkClient=null,clerkLoad=', 'function paintSyncCodeReplacement(){'],
    ['function initClerkAccount(){', 'function paintSyncCodeReplacement(){'],
  ]) {
    const sourceStart = accountSource.indexOf(start);
    const sourceEnd = accountSource.indexOf(end, sourceStart);
    const servedStart = servedHtml.indexOf(start);
    const servedEnd = servedHtml.indexOf(end, servedStart);
    assert.ok(sourceStart >= 0 && sourceEnd > sourceStart && servedStart >= 0 && servedEnd > servedStart);
    assert.equal(servedHtml.slice(servedStart, servedEnd), accountSource.slice(sourceStart, sourceEnd));
  }
  assert.match(reactSource, /Apple sign-in can’t complete inside the Replit preview frame/);
  assert.match(reactSource, /target="_blank" rel="noopener"/);
});