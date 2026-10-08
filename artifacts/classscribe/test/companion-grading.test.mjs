import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const screen = fs.readFileSync(new URL('../web-src/6_study_social.js', import.meta.url), 'utf8');
const source = screen.slice(screen.indexOf('let TUT={key:null};'), screen.indexOf('/* ---------- CLASSMATES'));
const served = fs.readFileSync(new URL('../web-public/index.html', import.meta.url), 'utf8');
const replies = {
  right: 'Correct. The chloroplast converts light to chemical energy.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="yes">>',
  wrong: 'Incorrect. That is the organelle for respiration.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="no">>',
  conflict: 'Incorrect. That is the organelle for respiration.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="yes">>',
  explanationConflict: 'Correct. Your answer is incorrect because mitochondria handle respiration.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="yes">>',
  missing: 'Incorrect. Correct answer: Chloroplast.',
  malformed: 'Incorrect.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="maybe">>',
  noAnswer: 'Incorrect. Try again.\n<<result concept="photosynthesis" correct="no">>',
  falsePositive: 'Correct. Chloroplasts use light.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="yes">>',
  falseNegative: 'Incorrect. Try again.\nCorrect answer: Chloroplast.\n<<result concept="photosynthesis" correct="no">>',
  unsupported: 'Incorrect. Try again.\nCorrect answer: Phloem.\n<<result concept="photosynthesis" correct="no">>',
};
const held = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

test('served browser tutor matches the tested source', () => {
  assert.equal(served.slice(served.indexOf('let TUT={key:null};'), served.indexOf('/* ---------- CLASSMATES')), source);
});

function harness() {
  const responses = [];
  const records = [];
  const requests = [];
  const ctx = {
    S: { uid: 'one', view: { name: 'tutor', courseId: 'bio', mode: 'quiz' } },
    VIEWS: {}, ACT: {}, window: { scrollTo() {} }, document: { body: { scrollHeight: 0 } },
    $: () => null, render() {}, billingUserCode: () => ctx.S.uid,
    CS_STUDY: (operation, payload) => { requests.push({ operation, payload }); return responses.shift().promise; },
    record: (...args) => records.push(args), markReviewed() {}, aiErr() {},
    studyMaterial: () => 'BIO course: chloroplast converts light into chemical energy',
    sourceNotesOf: () => [], sourceCoverageBlurb: () => '', lecturesOf: () => [], course: () => ({ code: 'BIO' }),
    weakList: () => [], examFeatureState: () => 'allowed', plural: () => '0 lectures',
    esc: s => s, md: s => s, ic: () => '', goAttr: () => '', thinking: '',
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  function start(answer = 'Mitochondrion') {
    ctx.VIEWS.tutor(ctx.S.view);
    vm.runInContext(`TUT.turns=[{role:'user',content:'BIO material',hidden:true},{role:'assistant',shown:'Which organelle converts light?'},{role:'user',content:${JSON.stringify(answer)}}]`, ctx);
  }
  function state() { return vm.runInContext('({score:TUT.score,turns:TUT.turns})', ctx); }
  return { ctx, responses, records, requests, start, state };
}

for (const [name, text] of Object.entries(replies)) {
  test(`web companion ${name} grades only a verified answer`, async () => {
    const h = harness(); h.start(['right', 'falseNegative'].includes(name) ? 'Chloroplast' : 'Mitochondrion');
    const reply = held(); h.responses.push(reply);
    const pending = h.ctx.tutSend(); reply.resolve({ text }); await pending;
    assert.match(h.requests[0].payload.material, /BIO course: chloroplast/);
    const { score, turns } = h.state();
    const expected = name === 'right' ? [1, 0] : name === 'wrong' ? [0, 1] : [0, 0];
    assert.deepEqual([score.r, score.w], expected);
    assert.equal(h.records.length, expected[0] + expected[1]);
    assert.equal(h.records[0]?.[0], expected[0] + expected[1] ? 'bio' : undefined);
    assert.doesNotMatch(turns.at(-1).shown, /<<result/);
    if (name === 'wrong') assert.match(h.ctx.VIEWS.tutor(h.ctx.S.view), /Incorrect\..*Correct answer:.*Chloroplast/s);
    if (!expected.some(Boolean)) assert.match(turns.at(-1).shown, /Not graded/);
    // A duplicate invocation for the same answer must never add a second grade.
    const again = held(); h.responses.push(again);
    const duplicate = h.ctx.tutSend(); again.resolve({ text }); await duplicate;
    assert.deepEqual([h.state().score.r, h.state().score.w], expected);
    assert.equal(h.records.length, expected[0] + expected[1]);
  });
}

test('web hides answer key in the question before an attempt', () => {
  const h = harness(); h.start();
  assert.doesNotMatch(h.ctx.companionResult('Which organelle?\nCorrect answer: Chloroplast.\n<<result concept="x" correct="yes">>', null).shown, /Correct answer:|<<result/);
});

test('web first question does not render a leaked answer key', async () => {
  const h = harness(); h.ctx.VIEWS.tutor(h.ctx.S.view);
  vm.runInContext("TUT.turns=[{role:'user',content:'BIO material',hidden:true}]", h.ctx);
  const reply = held(); h.responses.push(reply);
  const pending = h.ctx.tutSend();
  reply.resolve({ text: 'Which organelle?\nCorrect answer: Chloroplast.\n<<result concept="x" correct="yes">>' });
  await pending;
  assert.doesNotMatch(h.ctx.VIEWS.tutor(h.ctx.S.view), /Correct answer:|<<result/);
  assert.equal(h.records.length, 0);
});

for (const change of ['course', 'library']) {
  test(`web discards grading after a ${change} change`, async () => {
    const h = harness(); h.start();
    const reply = held(); h.responses.push(reply);
    const pending = h.ctx.tutSend();
    if (change === 'course') h.ctx.S.view = { name: 'tutor', courseId: 'chem', mode: 'quiz' };
    else h.ctx.S.uid = 'two';
    reply.resolve({ text: replies.wrong }); await pending;
    assert.equal(h.records.length, 0);
    assert.doesNotMatch(JSON.stringify(h.state()), /Chloroplast/);
    assert.doesNotMatch(h.ctx.VIEWS.tutor(h.ctx.S.view), /Chloroplast/);
  });
}