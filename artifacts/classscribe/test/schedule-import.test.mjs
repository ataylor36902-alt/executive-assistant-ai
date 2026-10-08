import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scheduleSource = fs.readFileSync(new URL('../web-src/9_schedule.js', import.meta.url), 'utf8');
const viewsSource = fs.readFileSync(new URL('../web-src/4_views.js', import.meta.url), 'utf8');
const coreSource = fs.readFileSync(new URL('../web-src/3_core.js', import.meta.url), 'utf8');
const codeKeySource = coreSource.match(/^const codeKey=.*;$/m)?.[0];
assert.ok(codeKeySource, 'browser course-code normalizer must remain available');

const previousMeetings = [{ days: ['Mon'], start: '08:00', end: '08:50', location: 'Old Hall', type: 'Lecture' }];
const currentMeetings = [{ days: ['Wed'], start: '09:00', end: '09:50', location: 'Current Hall', type: 'Lecture' }];
const importedMeetings = [{ days: ['Tue', 'Thu'], start: '10:30', end: '11:45', location: 'North Hall', type: 'Lecture' }];

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source section: ${startMarker}`);
  return source.slice(start, end);
}

function webClient() {
  const previous = {
    id: 'bio-spring',
    code: 'BIO 101',
    name: 'Previous Biology',
    professor: 'Dr. Old',
    semester: 'Spring 2026',
    meetings: structuredClone(previousMeetings),
  };
  const current = {
    id: 'bio-fall',
    code: 'bio 101',
    name: 'Current Biology',
    professor: 'Dr. Current',
    semester: ' fall   2026 ',
    meetings: structuredClone(currentMeetings),
  };
  const S = {
    profile: { term: 'Fall 2026' },
    showEx: false,
    mode: 'local',
    courses: { [previous.id]: previous, [current.id]: current },
  };
  const ctx = {
    S,
    VIEWS: {},
    ACT: {},
    WEEK: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    MEET_TYPES: ['Lecture', 'Lab', 'Discussion', 'Seminar', 'Recitation', 'Office hours'],
    allC: () => S.courses,
    put: async (collection, course) => {
      assert.equal(collection, 'courses');
      S.courses[course.id] = structuredClone(course);
    },
    courseLimitReached: () => false,
    curSemester: () => 'Fall 2026',
    uid: () => 'new-course',
    Date,
    Promise,
    structuredClone,
    coursesSorted: () => Object.values(S.courses),
    esc: value => String(value ?? ''),
    goAttr: value => `data-go="${JSON.stringify(value)}"`,
    ccVar: () => '',
    ic: () => '',
    plural: (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`,
    lecturesOf: () => [],
    nextMeetingLabel: course => course.meetings?.[0] ? `${course.meetings[0].days.join(', ')} ${course.meetings[0].start}` : '',
    nextMeetingIn: () => Infinity,
    homeLayoutValue: () => 'simple',
    upcoming: () => [],
    allA: () => ({}),
    daysUntil: () => 0,
    todayISO: () => '2026-09-26',
    fmtLong: () => 'Saturday, September 26',
  };
  vm.createContext(ctx);
  vm.runInContext(`${codeKeySource}\n${section(scheduleSource, 'async function applySchedule(list){', '\nACT.schedRun=')}`, ctx);
  vm.runInContext(section(viewsSource, '/* ---------- HOME ---------- */', 'function assignRow('), ctx);
  return { ctx, state: S };
}

test('browser schedule import preserves the prior semester and shows each course in the right place', async () => {
  const { ctx, state } = webClient();
  const oldBefore = structuredClone(state.courses['bio-spring']);
  const result = await ctx.applySchedule([{
    code: ' BIO   101 ',
    name: 'Imported Biology',
    meetings: structuredClone(importedMeetings),
  }]);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { added: 0, updated: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(state.courses['bio-spring'])), oldBefore, 'older-term course and times stay unchanged');
  assert.deepEqual(JSON.parse(JSON.stringify(state.courses['bio-fall'].meetings)), importedMeetings, 'current-term course receives imported times');
  assert.equal(Object.keys(state.courses).length, 2, 'a same-code course is updated rather than duplicated');

  const home = ctx.VIEWS.home();
  assert.match(home, /Current Biology/);
  assert.match(home, /Tue, Thu 10:30/);
  assert.doesNotMatch(home, /Previous Biology/, 'Home omits courses from older terms');

  const allCourses = ctx.VIEWS.courses();
  assert.match(allCourses, /Previous Biology/);
  assert.match(allCourses, /Spring 2026/);
  assert.ok(allCourses.includes('bio-spring'), 'older course remains reachable from All courses');
  assert.match(allCourses, /Current Biology/);
  assert.match(allCourses, /fall\s+2026/i);
});