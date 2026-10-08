const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tutor = fs.readFileSync(path.join(__dirname, '../app/tutor.js'), 'utf8');
const logic = fs.readFileSync(path.join(__dirname, '../lib/logic.js'), 'utf8');
const parse = new Function(logic.slice(logic.indexOf('export function companionResult'), logic.indexOf('\nimport ')).replace('export function', 'function') + '; return companionResult')();
const runSource = tutor.slice(tutor.indexOf('  async function run('), tutor.indexOf('  function start()'));
const held = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const responses = {
  right: 'Correct. Chloroplasts use light.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="yes">>',
  wrong: 'Incorrect. Mitochondria handle respiration.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="no">>',
  conflict: 'Incorrect. Mitochondria handle respiration.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="yes">>',
  explanationConflict: 'Correct. Your answer is incorrect because mitochondria handle respiration.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="yes">>',
  missing: 'Incorrect. Correct answer: Chloroplast.',
  malformed: 'Incorrect.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="maybe">>',
  noAnswer: 'Incorrect.\n<<result concept="photosynthesis" correct="no">>',
  falsePositive: 'Correct. Chloroplasts use light.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="yes">>',
  falseNegative: 'Incorrect. Try again.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="no">>',
  unsupported: 'Incorrect. Try again.\nCorrect answer: Phloem.\n<<result concept="photosynthesis" correct="no">>',
};

function harness() {
  const state = { uid: 'one', turns: [], score: { r: 0, w: 0 }, records: [], requests: [] };
  const response = held(), requestSequence = { current: 0 }, contextRef = { current: 'one|bio' };
  const deps = {
    busyRef: { current: false }, requestSequence, contextRef, requestController: { current: null },
    processedAnswers: { current: new Set() }, scroller: { current: null }, setTimeout: () => {},
    getUid: () => state.uid, courseId: 'bio', contextKey: 'one|bio', advancedMode: false,
    st: { status: { uid: 'one' }, record: (...args) => state.records.push(args), markReviewed: () => {} },
    lecs: [], courseNotes: [], material: () => 'BIO course: chloroplast converts light',
    setBusy: () => {}, setTurns: turns => { state.turns = turns; },
    setScore: fn => { state.score = fn(state.score); },
    studyAI: (operation, payload) => { state.requests.push({ operation, payload }); return response.promise; },
    ai: () => response.promise,
    companionResult: parse, errMsg: error => String(error), AbortController,
  };
  const run = new Function('deps', `with (deps) { ${runSource}; return run; }`)(deps);
  const next = [{ role: 'assistant', shown: 'Which organelle converts light?' }, { role: 'user', content: 'Mitochondrion' }];
  return { state, response, deps, run, next };
}

for (const [name, text] of Object.entries(responses)) {
  test(`Expo companion ${name} grades once at most`, async () => {
    const h = harness();
    if (['right', 'falseNegative'].includes(name)) h.next[1].content = 'Chloroplast';
    const pending = h.run(h.next, 1);
    h.response.resolve({ text }); await pending;
    assert.match(h.state.requests[0].payload.material, /BIO course: chloroplast/);
    const expected = name === 'right' ? [1, 0] : name === 'wrong' ? [0, 1] : [0, 0];
    assert.deepEqual([h.state.score.r, h.state.score.w], expected);
    assert.equal(h.state.records.length, expected[0] + expected[1]);
    if (name === 'wrong') {
      assert.match(h.state.turns.at(-1).shown, /Incorrect\..*Correct answer: Chloroplast/s);
      assert.match(tutor, /<Md text=\{t\.shown\}/);
    }
    if (!expected.some(Boolean)) assert.match(h.state.turns.at(-1).shown, /Not graded/);
    assert.doesNotMatch(h.state.turns.at(-1).shown, /<<result/);
    // Replaying the same answer id cannot update stats or score again.
    await h.run(h.next, 1);
    assert.deepEqual([h.state.score.r, h.state.score.w], expected);
    assert.equal(h.state.records.length, expected[0] + expected[1]);
  });
}

test('Expo question never reveals its answer before an attempt', () => {
  assert.doesNotMatch(parse('Which organelle?\nCorrect answer: Chloroplast.\n<<result concept="x" correct="yes">>', null).shown, /Correct answer:|<<result/);
});

test('Expo first question does not show a leaked answer key or score', async () => {
  const h = harness(), pending = h.run([], null);
  h.response.resolve({ text: 'Which organelle?\nCorrect answer: Chloroplast.\n<<result concept="x" correct="yes">>' });
  await pending;
  assert.doesNotMatch(h.state.turns.at(-1).shown, /Correct answer:|<<result/);
  assert.deepEqual(h.state.score, { r: 0, w: 0 });
});

for (const change of ['course', 'library']) {
  test(`Expo discards a reply after ${change} changes`, async () => {
    const h = harness(), pending = h.run(h.next, 1);
    if (change === 'course') h.deps.contextRef.current = 'one|chem';
    else h.state.uid = 'two';
    h.response.resolve({ text: responses.wrong }); await pending;
    assert.equal(h.state.records.length, 0);
    assert.deepEqual(h.state.score, { r: 0, w: 0 });
    assert.doesNotMatch(JSON.stringify(h.state.turns), /Chloroplast/);
  });
}