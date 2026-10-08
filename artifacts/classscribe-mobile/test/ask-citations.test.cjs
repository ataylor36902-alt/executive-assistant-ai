const test = require('node:test');
const assert = require('node:assert/strict');
const { citationKey, firstAssignmentCitation, firstLectureCitation, firstNoteCitation, isFiniteRealSeconds, validateAskCitations } = require('../.ask-citations-test.cjs');

test('only exact citations returned from owned-source searches survive filtering', () => {
  const evidence = new Map([
    [citationKey('lecture', 'lec-1', 32), { kind: 'lecture', id: 'lec-1', seconds: 32 }],
    [citationKey('note', 'note-1'), { kind: 'note', id: 'note-1' }],
    [citationKey('assignment', 'assignment-1'), { kind: 'assignment', id: 'assignment-1' }],
  ]);
  const valid = validateAskCitations('Lecture [[lec-1@32]], note [[note:note-1]], assignment [[assignment:assignment-1]].', evidence);
  assert.equal(valid.rejected, 0);
  assert.match(valid.text, /\[\[lec-1@32\]\]/);
  assert.match(valid.text, /\[\[note:note-1\]\]/);
  assert.match(valid.text, /\[\[assignment:assignment-1\]\]/);

  const invalid = validateAskCitations('Unknown lecture [[shared-lecture@32]], wrong second [[lec-1@33]], unknown note [[note:other]], unknown task [[assignment:other]].', evidence);
  assert.equal(invalid.rejected, 4);
  assert.doesNotMatch(invalid.text, /\[\[/);
  assert.equal(invalid.text.match(/\[source unavailable\]/g).length, 4);
});

test('focused review recognizes only a lecture citation token', () => {
  assert.deepEqual(firstLectureCitation('Review [[lec-2@15]].'), { id: 'lec-2', seconds: 15 });
  assert.equal(firstLectureCitation('Open [[note:n1]].'), null);
  assert.deepEqual(firstNoteCitation('Open [[note:n1]].'), { id: 'n1' });
  assert.deepEqual(firstAssignmentCitation('Open [[assignment:a1]].'), { id: 'a1' });
});

test('lecture citation seconds must be real finite nonnegative values', () => {
  assert.equal(isFiniteRealSeconds(0), true);
  assert.equal(isFiniteRealSeconds('12.5'), true);
  for (const value of [null, undefined, '', ' ', true, -1, Infinity, NaN]) {
    assert.equal(isFiniteRealSeconds(value), false, `expected ${String(value)} to be rejected`);
  }
});