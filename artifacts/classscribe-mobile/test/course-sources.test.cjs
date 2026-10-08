const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_SOURCE_CHARS, MAX_SOURCE_FILE_BYTES, SOURCE_TYPES, courseSourceMaterial, makeSourceNote, sourceFileType, sourceText } = require('../.course-sources-test.cjs');
const { localGuide, material } = require('../.course-logic-test.cjs');
const { extractMaterial, setServer, setUid } = require('../.course-api-test.cjs');
const { COURSE_STUDY_ID, isFinalsStudy, requiredExamFeaturePlan, resolveStudyExamId } = require('../.study-scope-test.cjs');

test('recognizes only supported source files and maps markdown to plain text', () => {
  assert.equal(sourceFileType('course.pdf'), 'application/pdf');
  assert.equal(sourceFileType('course.txt'), 'text/plain');
  assert.equal(sourceFileType('notes.MD'), 'text/plain');
  assert.equal(sourceFileType('course.docx'), '');
  assert.equal(MAX_SOURCE_FILE_BYTES, 8 * 1024 * 1024);
});

test('creates a private legacy note record with a 30000-character body cap', () => {
  const note = makeSourceNote({
    id: 'source-1', courseId: 'course-1', title: 'Reading', body: 'x'.repeat(MAX_SOURCE_CHARS + 2),
    sourceType: 'reading', sourceName: 'week-1.md', created: 123,
  });
  assert.deepEqual(note, {
    id: 'source-1', courseId: 'course-1', lectureId: '', title: 'Reading',
    body: 'x'.repeat(MAX_SOURCE_CHARS), sourceType: 'reading', sourceName: 'week-1.md',
    pinned: false, created: 123, updated: 123,
  });
  assert.equal(sourceText('x'.repeat(MAX_SOURCE_CHARS + 1)).length, MAX_SOURCE_CHARS);
  assert.throws(() => makeSourceNote({ id: 'x', courseId: '', title: 'x', body: 'x', sourceType: 'reading' }));
  assert.equal(SOURCE_TYPES.includes('study-guide'), true);
});

test('only tagged course-source notes become source material for course study tools', () => {
  const source = makeSourceNote({
    id: 'source-1', courseId: 'course-1', title: 'Course outline', body: 'Exam covers units one and two.',
    sourceType: 'syllabus', created: 123,
  });
  const ordinary = { id: 'note-2', title: 'Private scratch', body: 'Do not treat as imported source.' };
  assert.match(courseSourceMaterial([source]), /Private course syllabus/);
  assert.doesNotMatch(courseSourceMaterial([ordinary]), /Private scratch/);
  assert.match(material([], [source], 10000), /Exam covers units one and two/);
  assert.match(localGuide({ code: 'BIO 101' }, null, [], [], [source]), /Exam covers units one and two/);
});

test('uploads raw bytes to the extraction endpoint using the active library code', async () => {
  await setServer('https://classscribe.test');
  await setUid('u_1234567890');
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ text: 'Extracted notes', truncated: false, originalLength: 15 }), { status: 200 });
  };
  try {
    const data = await extractMaterial(new Uint8Array([0, 65, 66, 0]).subarray(1, 3), 'text/plain');
    assert.deepEqual(data, { text: 'Extracted notes', truncated: false, originalLength: 15 });
    assert.equal(request.url, 'https://classscribe.test/api/materials/extract');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers['Content-Type'], 'text/plain');
    assert.equal(request.options.headers['X-CS-User'], 'u_1234567890');
    assert.deepEqual(Array.from(new Uint8Array(request.options.body)), [65, 66]);
    await assert.rejects(() => extractMaterial(new Uint8Array(MAX_SOURCE_FILE_BYTES + 1), 'application/pdf'), (error) => /8 MB/.test(error.message));
  } finally {
    global.fetch = originalFetch;
  }
});

test('source-only courses use the Student course-study scope while explicit Finals stays Pro', () => {
  const selected = resolveStudyExamId({ requestedExamId: '', upcomingExamId: '', hasSources: true, lectureCount: 0 });
  assert.equal(selected, COURSE_STUDY_ID);
  const finalsMode = isFinalsStudy({ examId: selected, before: '' });
  assert.equal(finalsMode, false);
  assert.equal(requiredExamFeaturePlan('study', finalsMode), 'student');
  assert.equal(resolveStudyExamId({ requestedExamId: 'finals', hasSources: true, lectureCount: 0 }), 'finals');
  assert.equal(requiredExamFeaturePlan('study', isFinalsStudy({ examId: 'finals' })), 'pro');
  assert.equal(resolveStudyExamId({ requestedExamId: '', upcomingExamId: '', hasSources: false, lectureCount: 0 }), 'finals');
});

test('course source context gives multiple sources balanced excerpts and discloses truncation', () => {
  const sources = ['alpha', 'beta', 'gamma'].map((title) => ({
    sourceType: 'reading', title, body: `${title}-BODY-START ` + `${title}-content `.repeat(300),
  }));
  const excerpt = courseSourceMaterial(sources, 900);
  assert.ok(excerpt.length <= 900);
  for (const title of ['alpha', 'beta', 'gamma']) {
    assert.ok(excerpt.includes(`Private course reading: "${title}"`));
    assert.ok(excerpt.includes(`${title}-BODY-START`));
  }
  assert.match(excerpt, /Source coverage: balanced excerpts from 3 private sources; 3 shortened/);
  const sizes = ['alpha', 'beta', 'gamma'].map((title) => excerpt.split(`${title}-BODY-START `)[1].split('\n')[0].length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 2);
});