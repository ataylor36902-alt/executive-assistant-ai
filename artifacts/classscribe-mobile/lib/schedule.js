// Class times: course.meetings = [{ days:['Mon','Wed'], start:'09:00', end:'09:50', location:'', type:'Lecture' }]
export const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEK_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MEET_TYPES = ['Lecture', 'Lab', 'Discussion', 'Seminar', 'Recitation', 'Office hours'];

export const EXAMPLE_MEETINGS = {
  'ex-bio': [{ days: ['Mon', 'Wed', 'Fri'], start: '09:00', end: '09:50', location: 'Science Hall 101', type: 'Lecture' }, { days: ['Tue'], start: '14:00', end: '15:50', location: 'Bio Lab 3', type: 'Lab' }],
  'ex-chem': [{ days: ['Tue', 'Thu'], start: '11:00', end: '12:15', location: 'Chemistry 204', type: 'Lecture' }],
};

export const toMin = (hm) => { const m = String(hm || '').match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; };
export function fmtClock(hm) {
  const m = toMin(hm); if (m == null) return '';
  return new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export const fmtRange = (a, b) => (b ? `${fmtClock(a)}–${fmtClock(b)}` : fmtClock(a));
export function daysText(days) {
  const order = WEEK.filter((d) => (days || []).includes(d)).join(', ');
  return order === 'Mon, Wed, Fri' ? 'Mon, Wed, Fri' : order === 'Tue, Thu' ? 'Tue & Thu' : order;
}
export const meetingsText = (c) => (c.meetings || []).map((m) => `${daysText(m.days)} · ${fmtRange(m.start, m.end)}${m.location ? ' · ' + m.location : ''}${m.type && m.type !== 'Lecture' ? ' (' + m.type + ')' : ''}`);

// "9", "9:30", "9:30 pm", "21:30" → "HH:MM" (24-hour), or '' if not a time
export function parseClock(s) {
  const m = String(s || '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(a|p)?\.?m?\.?$/);
  if (!m) return '';
  let h = +m[1]; const min = m[2] ? +m[2] : 0;
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

export function classesOn(courses, date) {
  const dn = WEEK[date.getDay()]; const out = [];
  courses.forEach((c) => (c.meetings || []).forEach((m) => {
    if ((m.days || []).includes(dn) && toMin(m.start) != null) out.push({ c, m, start: toMin(m.start), end: toMin(m.end) ?? toMin(m.start) + 50 });
  }));
  return out.sort((a, b) => a.start - b.start);
}
export function currentClass(courses, now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  return classesOn(courses, now).find((x) => mins >= x.start - 15 && mins <= x.end) || null;
}
export function nextMeetingIn(c, now = new Date()) {
  let best = Infinity; const mins = now.getHours() * 60 + now.getMinutes();
  (c.meetings || []).forEach((m) => (m.days || []).forEach((d) => {
    const di = WEEK.indexOf(d); const st = toMin(m.start); if (di < 0 || st == null) return;
    const len = (toMin(m.end) ?? st + 50) - st;
    let delta = ((di - now.getDay() + 7) % 7) * 1440 + st - mins;
    if (delta < -len) delta += 7 * 1440;
    best = Math.min(best, delta);
  }));
  return best;
}
export function nextMeetingLabel(c) {
  const d = nextMeetingIn(c); if (d === Infinity) return ''; if (d <= 0) return 'In class now';
  const now = new Date(); const at = new Date(now.getTime() + d * 60000);
  const tomorrow = new Date(now.getTime() + 86400000);
  const day = at.toDateString() === now.toDateString() ? 'Today' : at.toDateString() === tomorrow.toDateString() ? 'Tomorrow' : WEEK_LONG[at.getDay()];
  return `${day} ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
export const SCHEDULE_PROMPT = 'Extract a student\'s weekly class schedule. Return ONLY JSON: {"courses":[{"code":"BIO 101","name":"","professor":"","meetings":[{"days":["Mon","Wed","Fri"],"start":"HH:MM","end":"HH:MM","location":"","type":"Lecture|Lab|Discussion|Seminar|Recitation"}]}]}. Use 24-hour times and 3-letter day names. Include every course and every meeting (labs and discussions too). Don\'t invent anything.';
export function cleanMeetings(list) {
  return (list || []).map((m) => ({
    days: (m.days || []).map((d) => WEEK.find((w) => w.toLowerCase() === String(d).slice(0, 3).toLowerCase())).filter(Boolean),
    start: /^\d{1,2}:\d{2}$/.test(m.start || '') ? m.start.padStart(5, '0') : parseClock(m.start),
    end: /^\d{1,2}:\d{2}$/.test(m.end || '') ? m.end.padStart(5, '0') : parseClock(m.end),
    location: m.location || '', type: MEET_TYPES.includes(m.type) ? m.type : 'Lecture',
  })).filter((m) => m.days.length && m.start);
}
