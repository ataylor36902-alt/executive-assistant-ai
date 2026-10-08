const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeTranscriptAccumulator } = require('../.native-transcript-test.cjs');

test('punctuated interim remains provisional until its revised final arrives', () => {
  const transcript = createNativeTranscriptAccumulator();
  assert.deepEqual(transcript.accept('The answer is forty.', false), {
    draft: 'The answer is forty.',
    committed: '',
  });
  assert.deepEqual(transcript.accept('The answer is forty-two.', true), {
    draft: '',
    committed: 'The answer is forty-two.',
  });
  assert.equal(transcript.finishPart(), '');
});

test('a final that never arrives is promoted once at the confirmed part boundary', () => {
  const transcript = createNativeTranscriptAccumulator();
  transcript.accept('The answer is forty.', false);
  assert.equal(transcript.finishPart(), 'The answer is forty.');
  assert.equal(transcript.finishPart(), '');
});

test('cumulative finals append only their unrepeated suffix', () => {
  const transcript = createNativeTranscriptAccumulator();
  assert.equal(transcript.accept('We covered the first law.', true).committed, 'We covered the first law.');
  assert.equal(transcript.accept('We covered the first law and conservation.', true).committed, 'and conservation.');
});