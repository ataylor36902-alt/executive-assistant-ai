import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ControlledHtmlAudio } from './fixtures/controlled-html-audio.mjs';

const browserClients = [
  { name: 'browser source', path: new URL('../web-src/5_capture_lecture.js', import.meta.url) },
  { name: 'served browser page', path: new URL('../web-public/index.html', import.meta.url) },
];

function extract(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `Missing code section: ${start}`);
  assert.notEqual(to, -1, `Missing code section after: ${start}`);
  return source.slice(from, to);
}

function createBrowserClient(path, audio, loadAudio = async () => 'blob:controlled-lecture') {
  const source = readFileSync(path, 'utf8');
  const context = {
    AFTER: {},
    ACT: {},
    $: (selector) => selector === '#lecaudio' ? audio
      : selector === '#audionote' ? audio.note : null,
    $$: () => [],
    audioLoad: loadAudio,
    goAttr: (route) => `data-go="${JSON.stringify(route)}"`,
    isMine: () => true,
    isExampleRecord: () => false,
    stampDate: () => '',
    fmtT: (seconds) => `${seconds}s`,
    spkName: () => 'Professor',
    esc: (value) => String(value),
    ic: () => '<svg></svg>',
    matchMedia: () => ({ matches: false }),
    setTimeout,
  };
  runInNewContext(extract(source, 'function txHTML(', 'function refreshLive()'), context);
  runInNewContext(extract(source, 'AFTER.lecture=v=>{', 'ACT.markSeg='), context);
  return context;
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

for (const client of browserClients) {
  test(`${client.name}: timed transcript rows link to playback; untimed rows stay readable but cannot seek`, () => {
    const audio = new ControlledHtmlAudio();
    const context = createBrowserClient(client.path, audio);
    const html = context.txHTML({
      id: 'lecture-1',
      segs: [
        { t: 18.5, s: 'P', x: 'Timed explanation' },
        { t: null, s: 'P', x: 'Transcript without timing' },
      ],
    }, 'view');

    assert.match(html, /Timed explanation/);
    assert.match(html, /data-t="18\.5"/);
    assert.match(html, /data-go=/);
    assert.match(html, /Transcript without timing/);
    assert.match(html, /audio timestamp unavailable/);
    assert.doesNotMatch(html, /data-t="null"/);
    assert.equal(audio.seekCalls.length, 0);
  });

  test(`${client.name}: timestamp link waits for HTML audio metadata, then seeks and plays`, async () => {
    const audio = new ControlledHtmlAudio();
    const context = createBrowserClient(client.path, audio);

    context.AFTER.lecture({ id: 'lecture-1', t: 37.25 });
    await flushAsync();

    assert.equal(audio.src, 'blob:controlled-lecture');
    assert.deepEqual(audio.seekCalls, []);
    assert.equal(audio.playCalls, 0);

    audio.dispatch('loadedmetadata');
    await flushAsync();
    assert.deepEqual(audio.seekCalls, [37.25]);
    assert.equal(audio.playCalls, 1);
  });

  test(`${client.name}: a timestamp link opened after metadata seeks and plays immediately`, async () => {
    const audio = new ControlledHtmlAudio({ readyState: 1 });
    const context = createBrowserClient(client.path, audio);

    context.AFTER.lecture({ id: 'lecture-1', t: 52 });
    await flushAsync();

    assert.deepEqual(audio.seekCalls, [52]);
    assert.equal(audio.playCalls, 1);
  });
}