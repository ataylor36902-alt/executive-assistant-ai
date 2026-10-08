import { isoOffset } from './examples';

export const todayISO = () => isoOffset(0);
export const nowMs = () => Date.now();
export const stampDate = (iso) => dObj(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export function clockStamp() {
  const d = new Date();
  return `[${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}] `;
}
// "[Sep 24, 2026 · 12:30]" typed while recording → "Sep 24, 2026 [[lectureId@750]]" (a link to that moment)
export function stampsToLinks(text, lecId) {
  return text.replace(/\[(?:([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}) · )?(\d+:\d{2}(?::\d{2})?)\]/g, (m, day, ts) => `${day ? day + ' ' : ''}[[${lecId}@${ts.split(':').map(Number).reduce((a, b) => a * 60 + b, 0)}]]`);
}
export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
export const dObj = (iso) => new Date((iso || todayISO()) + 'T12:00:00');
export const fmtD = (iso) => dObj(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const fmtLong = (iso) => dObj(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
export const daysUntil = (iso) => Math.round((dObj(iso) - dObj(todayISO())) / 864e5);
export const plural = (n, w, p) => `${n} ${n === 1 ? w : p || w + 's'}`;
export const codeKey = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function fmtT(s) {
  s = Math.max(0, Math.round(+s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}
export function relDue(iso) {
  if (!iso) return 'No date';
  const n = daysUntil(iso);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`;
}
export function curSemester() {
  const d = new Date(), m = d.getMonth();
  return (m >= 7 ? 'Fall' : m <= 4 ? 'Spring' : 'Summer') + ' ' + d.getFullYear();
}
export function snippet(t, n = 110) {
  const s = String(t || '').replace(/^#+\s*/gm, '').replace(/[*`>]|- \[[ x]\]|\[\[[\w-]+@[\d.]+\]\]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}
export function whenStr(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 6e4) return 'just now';
  if (d < 36e5) return Math.round(d / 6e4) + ' min ago';
  if (d < 864e5) return Math.round(d / 36e5) + ' h ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export const spkName = (l, s) => (l.speakers && l.speakers[s]) || ({ P: 'Professor', S: 'Student', G: 'Guest' }[s] || s);
const STOP = new Set('the a an and or of to in on for is was what did does do say said about this that with from how why when who which are be it as at by me my i you professor prof'.split(' '));
export const tokens = (q) => String(q).toLowerCase().replace(/[^a-z0-9′'\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
export function scoreText(text, toks) {
  const t = String(text).toLowerCase();
  let s = 0;
  toks.forEach((w) => {
    const stem = w.length > 5 ? w.slice(0, Math.max(5, w.length - 2)) : w;
    if (t.includes(stem)) s += 1 + (t.includes(w) ? 0.5 : 0);
  });
  return s;
}
