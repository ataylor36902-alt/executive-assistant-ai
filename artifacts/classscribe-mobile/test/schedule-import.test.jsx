import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Home from '../app/(tabs)/home/index';
import Courses from '../app/courses';
import { Stack } from './fixtures/schedule-import-ui.jsx';

const importerSource = fs.readFileSync('app/schedule-import.js', 'utf8');
const coursesScreenSource = fs.readFileSync('app/courses.js', 'utf8');
const scheduleHelpersSource = fs.readFileSync('lib/schedule.js', 'utf8').replace(/^export /gm, '');
const utilSource = fs.readFileSync('lib/util.js', 'utf8');
const codeKeyExpression = utilSource.match(/^export const codeKey = (.*);$/m)?.[1];
assert.ok(codeKeyExpression, 'mobile course-code normalizer must remain available');
const oldMeetings = [{ days: ['Mon'], start: '08:00', end: '08:50', location: 'Old Hall', type: 'Lecture' }];
const currentMeetings = [{ days: ['Wed'], start: '09:00', end: '09:50', location: 'Current Hall', type: 'Lecture' }];
const importedMeetings = [{ days: ['Tue', 'Thu'], start: '10:30', end: '11:45', location: 'North Hall', type: 'Lecture' }];

function importRun() {
  const start = importerSource.indexOf('  async function run() {');
  const end = importerSource.indexOf('\n\n  return (', start);
  assert.ok(start >= 0 && end > start, 'schedule importer run handler must remain available');
  return importerSource.slice(start, end).trim();
}

function library() {
  const previous = {
    id: 'bio-spring',
    code: 'BIO 101',
    name: 'Previous Biology',
    professor: 'Dr. Old',
    semester: 'Spring 2026',
    meetings: structuredClone(oldMeetings),
    created: 1,
  };
  const current = {
    id: 'bio-fall',
    code: 'bio 101',
    name: 'Current Biology',
    professor: 'Dr. Current',
    semester: ' fall   2026 ',
    meetings: structuredClone(currentMeetings),
    created: 2,
  };
  const courses = [previous, current];
  const store = {
    profile: { term: 'Fall 2026', homeLayout: 'class-first' },
    status: { server: 'https://example.invalid', online: true, loading: false },
    appearance: 'auto',
    courses: () => courses,
    lecturesOf: () => [],
    all: () => ({}),
    retryPendingRecordingFinishes() {},
    refresh: async () => {},
    saveHomeLayoutChoice() {},
    setAppearanceChoice() {},
    setShowEx() {},
    showEx: false,
    put: (collection, course) => {
      assert.equal(collection, 'courses');
      const i = courses.findIndex(existing => existing.id === course.id);
      if (i < 0) courses.push(course);
      else courses[i] = course;
    },
    putCourse: async course => {
      const i = courses.findIndex(existing => existing.id === course.id);
      if (i < 0) courses.push(course);
      else courses[i] = course;
    },
    course: id => courses.find(course => course.id === id),
  };
  return { courses, store };
}

test('mobile schedule import preserves older same-code courses and keeps them available outside Home', async () => {
  const { courses, store } = library();
  const oldBefore = structuredClone(courses[0]);
  globalThis.__scheduleStore = store;
  const results = [];
  const context = {
    st: store,
    text: 'BIO 101 schedule',
    photo: null,
    setBusy() {},
    setError(message) { if (message) throw new Error(message); },
    setResult: message => results.push(message),
    setProgress() {},
    running: { current: false },
    requestRef: { current: null },
    AbortController,
    Keyboard: { dismiss() {} },
    getUid: () => 'schedule-test-library',
    studyAI: async () => ({ courses: [{
      code: ' BIO   101 ',
      name: 'Imported Biology',
      meetings: structuredClone(importedMeetings),
    }] }),
    parseJSON: JSON.parse,
    SCHEDULE_PROMPT: '',
    codeKey: vm.runInNewContext(`(${codeKeyExpression})`),
    curSemester: () => 'Fall 2026',
    nowMs: () => 42,
    plural: (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`,
    uid: () => 'new-course',
    goBack() {},
  };
  vm.createContext(context);
  vm.runInContext(`${scheduleHelpersSource}\nglobalThis.cleanMeetings = cleanMeetings;`, context);
  const run = vm.runInContext(`(${importRun()})`, context);
  await run();

  assert.deepEqual(JSON.parse(JSON.stringify(courses[0])), oldBefore, 'older-term course and meetings remain intact');
  assert.deepEqual(JSON.parse(JSON.stringify(courses[1].meetings)), importedMeetings, 'current-term course receives imported times');
  assert.equal(courses.length, 2, 'the importer updates the current course instead of creating a duplicate');
  assert.match(results.at(-1) || '', /1 course updated, 0 new/);

  const home = renderToStaticMarkup(React.createElement(Home));
  assert.match(home, /Current Biology/);
  assert.match(home, /Tue, Thu 10:30/);
  assert.doesNotMatch(home, /Previous Biology/, 'Home omits courses from older terms');

  const allCourses = renderToStaticMarkup(React.createElement(Courses));
  assert.match(allCourses, /Previous Biology/);
  assert.match(allCourses, /Spring 2026/);
  assert.match(allCourses, /Current Biology/);
  assert.match(allCourses, /fall\s+2026/i);
  assert.match(coursesScreenSource, /onPress=\{\(\) => router\.push\(`\/course\/\$\{course\.id\}`\)\}/, 'each All courses row opens its course');
});