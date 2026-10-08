const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildLectureDocument, buildCalendarFile } = require('../.exports-content-test.cjs');

function savedBytes(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classscribe-export-'));
  try {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content, 'utf8');
    return fs.readFileSync(file, 'utf8');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('saved lecture document is structured, escaped, and contains no audio', () => {
  const saved = savedBytes('lecture.doc', buildLectureDocument({
    title: 'Biology <101>', professor: 'Dr & Co', lectureDate: '2026-09-24T12:00:00Z',
    summary: 'Cells < divide', keyPoints: ['DNA & RNA'], definitions: ['Gene: unit'],
    notes: 'My note\nsecond line', transcript: 'Verbatim transcript',
    audioBase64: 'SECRET_AUDIO_BYTES', audioUrl: 'PRIVATE_AUDIO_LOCATION',
  }));
  for (const section of ['Summary', 'Key points', 'Terms &amp; definitions', 'My notes', 'Transcript'])
    assert.ok(saved.includes(section), section);
  assert.match(saved, /Biology &lt;101&gt;/);
  assert.match(saved, /Cells &lt; divide/);
  assert.match(saved, /My note<br>second line/);
  assert.match(saved, /Verbatim transcript/);
  assert.doesNotMatch(saved, /SECRET_AUDIO_BYTES|PRIVATE_AUDIO_LOCATION|<101>/);
});

test('saved calendar contains only individually selected confirmed dates, with all-day boundaries', () => {
  const dates = [
    { source: 'lecture', id: 'one', title: 'Exam, Part 1; final\nreview', kind: 'exam', dueDate: '2026-12-31', confirmed: true },
    { source: 'syllabus', id: 'two', title: 'Assignment', kind: 'assignment', dueDate: '2027-01-08', confirmed: true },
    { source: 'lecture', id: 'three', title: 'Unconfirmed exam', kind: 'exam', dueDate: '2027-01-10', confirmed: false },
  ];
  const saved = savedBytes('dates.ics', buildCalendarFile(dates, ['lecture:one', 'syllabus:two'], new Date('2026-09-24T12:00:00Z')));
  assert.ok(saved.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.match(saved, /SUMMARY:Exam\\, Part 1\\; final\\nreview\r\n/);
  assert.match(saved, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n/);
  assert.match(saved, /DTSTART;VALUE=DATE:20270108\r\nDTEND;VALUE=DATE:20270109\r\n/);
  assert.equal((saved.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.doesNotMatch(saved, /Unconfirmed exam/);
  assert.ok(saved.endsWith('END:VCALENDAR\r\n'));
  assert.throws(() => buildCalendarFile(dates, ['lecture:three'], new Date()), /Select confirmed/);
  assert.throws(() => buildCalendarFile(dates, [], new Date()), /Select confirmed/);
  assert.throws(() => buildCalendarFile(dates, ['lecture:one', 'lecture:missing'], new Date()), /Select confirmed/);
  assert.throws(() => buildCalendarFile([{ ...dates[0], dueDate: '2026-02-30' }], ['lecture:one'], new Date()), /valid due date/);
});