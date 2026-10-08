export type LecturePacket = {
  title: string;
  professor?: string | null;
  lectureDate: string;
  summary?: string | null;
  keyPoints: string[];
  definitions: string[];
  notes?: string | null;
  transcript?: string | null;
};

export type CalendarDate = {
  id: string;
  title: string;
  kind: string;
  dueDate: string | null;
  confirmed: boolean;
  source: 'lecture' | 'syllabus';
};

const html = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const paragraph = (value: string) => `<p>${html(value).replace(/\r?\n/g, '<br>')}</p>`;

/** Word-compatible HTML document. Only the listed text fields are included. */
export function buildLectureDocument(lecture: LecturePacket): string {
  const section = (heading: string, body: string) => body.trim() ? `<h2>${heading}</h2>${paragraph(body)}` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${html(lecture.title)}</title>
<style>body{font-family:Arial,sans-serif;color:#172132;line-height:1.5;margin:40px}h1{font-size:26px}h2{font-size:18px;margin-top:26px;border-bottom:1px solid #ccc}p{white-space:normal}</style></head><body>
<h1>${html(lecture.title)}</h1><p>${html(lecture.professor || 'Professor')} · ${html(lecture.lectureDate.slice(0, 10))}</p>
${section('Summary', lecture.summary ?? '')}
${lecture.keyPoints.length ? `<h2>Key points</h2><ul>${lecture.keyPoints.map(p => `<li>${html(p)}</li>`).join('')}</ul>` : ''}
${lecture.definitions.length ? `<h2>Terms &amp; definitions</h2><ul>${lecture.definitions.map(d => `<li>${html(d)}</li>`).join('')}</ul>` : ''}
${section('My notes', lecture.notes ?? '')}
${section('Transcript', lecture.transcript ?? '')}
</body></html>`;
}

const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
  .replace(/,/g, '\\,').replace(/;/g, '\\;');
const validDay = (value: string | null): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const day = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, '');

/** Throws rather than silently dropping a selected invalid date. */
export function buildCalendarFile(dates: CalendarDate[], selectedKeys: string[], generatedAt: Date): string {
  const selected = new Set(selectedKeys);
  const entries = dates.filter(date => selected.has(`${date.source}:${date.id}`) && date.confirmed);
  if (entries.length !== selected.size || !entries.length) throw new Error('Select confirmed dates with valid due dates to export.');
  if (entries.some(date => !validDay(date.dueDate))) throw new Error('A selected date is missing a valid due date.');
  const stamp = generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClassScribe//Academic Dates//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const entry of entries) {
    const start = new Date(`${entry.dueDate}T00:00:00Z`);
    const end = new Date(start.getTime() + 86400000);
    lines.push('BEGIN:VEVENT',
      `UID:${encodeURIComponent(entry.source)}-${encodeURIComponent(entry.id)}@classscribe`,
      `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(start)}`, `DTEND;VALUE=DATE:${day(end)}`,
      `SUMMARY:${icsText(entry.title)}`, `DESCRIPTION:${icsText(entry.kind)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}