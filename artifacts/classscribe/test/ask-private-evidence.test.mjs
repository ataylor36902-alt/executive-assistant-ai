import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web-src/6_study_social.js', import.meta.url), 'utf8');

function helpersFor(library) {
  const start = source.indexOf('function askSemesterKey');
  const end = source.indexOf('function askOfflineAnswer', start);
  const helperSource = source.slice(start, end);
  const context = {
    S: library,
    askOwnedCourses: () => Object.values(library.courses).filter(course => course && !course.ex),
    scoreText: () => 0,
  };
  vm.createContext(context);
  vm.runInContext(helperSource, context);
  return context;
}

test('private evidence scope and citations stay inside current owned library', () => {
  const library = {
    courses: {
      c1: { id: 'c1', semester: 'Fall 2025' },
      c2: { id: 'c2', semester: 'Spring 2026' },
      example: { id: 'example', semester: 'Fall 2025', ex: true },
    },
    lectures: {
      l1: { id: 'l1', courseId: 'c1', segs: [{ t: 42.2, x: 'evidence' }] },
      l2: { id: 'l2', courseId: 'c2', segs: [{ t: 42, x: 'other term' }] },
    },
    notes: {
      n1: { id: 'n1', courseId: 'c1', body: 'private note' },
      n2: { id: 'n2', courseId: 'c2', body: 'other course note' },
      n3: { id: 'n3', courseId: 'c1', body: 'example note', ex: true },
    },
    assignments: {
      a1: { id: 'a1', courseId: 'c1', title: 'Lab report' },
      a2: { id: 'a2', courseId: 'c2', title: 'Other term task' },
    },
  };
  const h = helpersFor(library);
  assert.deepEqual(Array.from(h.askCourseIdsForScope('semester:Fall%202025')), ['c1']);
  assert.equal(h.askCitationIsValid('l1@42', 'semester:Fall%202025'), true);
  assert.equal(h.askCitationIsValid('l1@41', 'semester:Fall%202025'), false);
  assert.equal(h.askCitationIsValid('l2@42', 'semester:Fall%202025'), false);
  assert.equal(h.askCitationIsValid('NOTE:n1', 'semester:Fall%202025'), true);
  assert.equal(h.askCitationIsValid('NOTE:n3', 'semester:Fall%202025'), false);
  assert.equal(h.askCitationIsValid('NOTE:n2', 'semester:Fall%202025'), false);
  assert.equal(h.askCitationIsValid('ASSIGNMENT:a1', 'semester:Fall%202025'), true);
  assert.equal(h.askCitationIsValid('ASSIGNMENT:a2', 'semester:Fall%202025'), false);
  assert.equal(h.askCitationIsValid('ASSIGNMENT:invented', 'all'), false);
  assert.equal(h.askAssignmentScore({ title: 'Lab report', due: '2026-01-15' }, [], 'What is due soon?'), 1);
  assert.match(h.askVerifiedAnswer('Fact [[fake@12]]', 'all'), /source link not verified/);
  assert.match(source, /name:'search_evidence'/);
  assert.match(source, /Do not claim mastery or predict what will be on an exam/);
});