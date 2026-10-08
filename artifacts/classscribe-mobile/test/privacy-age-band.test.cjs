const test = require('node:test');
const assert = require('node:assert/strict');
const { ageBandFromBirthMonthYear } = require('../.age-band-test.cjs');

test('age gate uses month/year only and conservatively waits for the birthday month', () => {
  const now = new Date(2026, 5, 15);
  assert.equal(ageBandFromBirthMonthYear(7, 2013, now), 'under13');
  assert.equal(ageBandFromBirthMonthYear(6, 2013, now), 'under13');
  assert.equal(ageBandFromBirthMonthYear(5, 2013, now), '13-17');
  assert.equal(ageBandFromBirthMonthYear(1, 2008, now), '18+');
  assert.equal(ageBandFromBirthMonthYear(0, 2010, now), 'invalid');
  assert.equal(ageBandFromBirthMonthYear(6, 2030, now), 'invalid');
});