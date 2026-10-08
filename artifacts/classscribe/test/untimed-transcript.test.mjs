import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('untimed transcript lines are visible but cannot seek or bookmark at 0:00', () => {
  const source = fs.readFileSync(new URL('../web-src/5_capture_lecture.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function txHTML('), source.indexOf('function refreshLive()'));
  const ctx = {
    ic: () => '<svg></svg>', fmtT: t => String(t), esc: t => String(t),
    goAttr: () => 'data-go="lecture"', spkName: () => 'Professor', isMine: () => true,
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  const html = ctx.txHTML({ id: 'lecture', segs: [{ t: null, s: 'P', x: 'Untimed words' }] }, 'view');
  assert.match(html, /Untimed words/);
  assert.match(html, /timestamp unavailable/i);
  assert.doesNotMatch(html, /data-t=|data-go=|data-act="markSeg"|Timestamp 0/);
  const timed = ctx.txHTML({ id: 'lecture', segs: [{ t: 12.5, s: 'P', x: 'Timed words' }] }, 'view');
  assert.match(timed, /data-t="12.5"/);
  assert.match(timed, /data-go="lecture"/);
});