import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const webSource = readFileSync(new URL('../web-src/1_head.html', import.meta.url), 'utf8');
const servedWeb = readFileSync(new URL('../web-public/index.html', import.meta.url), 'utf8');
const mobileSource = readFileSync(new URL('../../classscribe-mobile/components/LaunchIntro.js', import.meta.url), 'utf8');
const mobileColors = JSON.parse(readFileSync(new URL('../../classscribe-mobile/lib/appearance-tokens.json', import.meta.url), 'utf8'));

function section(text, start, end) {
  const from = text.indexOf(start);
  const until = text.indexOf(end, from);
  assert.ok(from >= 0 && until > from, `Missing opening scene section: ${start}`);
  return text.slice(from, until);
}

test('served website intro stays in sync with its editable source', () => {
  assert.equal(section(servedWeb, '#launch-intro{', '/* shell */'), section(webSource, '#launch-intro{', '/* shell */'));
  assert.equal(section(servedWeb, '  <button id="launch-intro"', '  <aside class="side"'), section(webSource, '  <button id="launch-intro"', '  <aside class="side"'));
});

test('website loading scene keeps the mobile name, company line and palette', () => {
  assert.match(mobileSource, />\s*ClassScribe\s*</);
  assert.match(mobileSource, /Edmita Investment LLC/);
  assert.match(webSource, /<span class="launch-word">ClassScribe<\/span>/);
  assert.match(webSource, /<span class="launch-company">Edmita Investment LLC<\/span>/);
  assert.ok(webSource.includes(`color:${mobileColors.dark.gold}`));
  assert.match(webSource, /background:var\(--logo\)/);
  assert.match(webSource, /#launch-intro\.playing \.launch-window\{animation:launch-write 1\.85s \.18s/);
});