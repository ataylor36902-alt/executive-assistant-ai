// Study logic shared with the web app: topics, weak areas, AI prompts, offline study guide.

// Only score answers that can be corroborated by an explicit answer in the
// selected material. Paraphrases that cannot be checked deterministically
// remain ungraded rather than trusting an AI-generated "Correct" label.
export function companionResult(text, submittedAnswer, courseMaterial = '') {
  const raw = typeof text === 'string' ? text : '';
  const tags = [...raw.matchAll(/<<result\b[^>]*>>/g)];
  const shown = raw.replace(/<<result\b[^>]*>>/g, '').trim();
  if (!submittedAnswer) return { shown: shown.replace(/^\s*Correct answer:\s*.*$/gim, '').trim(), grade: null };
  const verdict = /^\s*(Correct|Incorrect)\./i.exec(shown);
  const answer = /^\s*Correct answer:\s*(\S.*)$/im.exec(shown);
  const marker = tags.length === 1 && /^<<result concept="([^"]+)" correct="(yes|no)">>$/.exec(tags[0][0]);
  const claims = [...shown.matchAll(/\b(?:Incorrect|Correct)\.(?!\s*answer:)|\b(?:your (?:answer|response) is|you (?:are|were))\s+(?:in)?correct\b/gi)]
    .map(([claim]) => /\bincorrect\b/i.test(claim) ? 'no' : 'yes');
  const normalize = value => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^(?:the|a|an) /, '');
  const expected = normalize(answer?.[1] || '');
  const submitted = normalize(submittedAnswer);
  const supported = expected && (` ${normalize(courseMaterial)} `).includes(` ${expected} `);
  if (!marker || !verdict || !answer || (verdict[1].toLowerCase() === 'correct') !== (marker[2] === 'yes')
    || claims.some((claim) => claim !== marker[2]) || !supported || !submitted
    || (marker[2] === 'yes') !== (submitted === expected)) {
    return { shown: 'Not graded. ClassScribe could not verify this result. Please try answering again.', grade: null };
  }
  return { shown, grade: { concept: marker[1], correct: marker[2] === 'yes' } };
}
import { daysUntil, fmtD, plural, spkName, todayISO } from './util';
import { courseSourceMaterial } from './course-sources';

export function findT(l, concept) {
  const a = l.analysis || {};
  const first = concept.toLowerCase().split(' ')[0];
  const e = (a.emphasized || []).find((x) => x.concept.toLowerCase().includes(first));
  if (e) return e.t;
  const w = concept.toLowerCase().split(/\s+/).find((x) => x.length > 3) || concept.toLowerCase();
  const g = (l.segs || []).find((s) => s.x.toLowerCase().includes(w.slice(0, Math.max(4, w.length - 2))));
  return g ? g.t : 0;
}
export function topicCounts(lecs) {
  const m = {};
  lecs.forEach((l) => {
    const a = l.analysis; if (!a) return;
    const seen = new Set();
    (a.concepts || []).forEach((cn) => {
      const k = cn.trim().toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      (m[k] = m[k] || { name: cn.trim(), refs: [] }).refs.push({ id: l.id, t: findT(l, cn) });
    });
  });
  return Object.values(m).sort((a, b) => b.refs.length - a.refs.length);
}
export function weakList(stats) {
  return Object.entries((stats && stats.concepts) || {}).map(([k, v]) => ({ concept: k, ...v })).filter((x) => x.w > 0).sort((a, b) => (b.w - b.r) - (a.w - a.r) || b.w - a.w);
}
export function missedConceptReview(stats, limit = 8) {
  return weakList(stats).slice(0, limit).map((item) => ({
    concept: item.concept,
    missed: Number(item.w) || 0,
    attempts: (Number(item.w) || 0) + (Number(item.r) || 0),
    steps: [
      `Revisit the selected course material on ${item.concept} and write a one-sentence explanation from it.`,
      `Work through one relevant example or explain how ${item.concept} applies to a problem in your course.`,
      `Close your notes and recall the key idea; then retry a practice question and track the result.`,
    ],
  }));
}
export function material(lecs, notes = [], max = 26000, courseOf = () => ({})) {
  let out = '';
  const sourceNotes = notes.filter((note) => ['syllabus', 'reading', 'study-guide'].includes(note.sourceType) && String(note.body || '').trim());
  const lectureLimit = sourceNotes.length ? Math.floor(max / 2) : max;
  for (const l of lecs) {
    const a = l.analysis; const c = courseOf(l.courseId) || {};
    let s = `\n### Lecture id=${l.id} · ${c.code || ''} · ${l.date} · "${l.title}"\n`;
    if (a) {
      s += `Summary: ${a.summary || ''}\nKey points:\n${(a.keyPoints || []).map((k) => '- ' + k).join('\n')}\n`;
      if ((a.emphasized || []).length) s += `Professor emphasized:\n${a.emphasized.map((e) => `- ${e.concept} (${e.why}) @${e.t}`).join('\n')}\n`;
      if ((a.terms || []).length) s += `Terms:\n${a.terms.map((t) => `- ${t.term}: ${t.def} @${t.t}`).join('\n')}\n`;
      if ((a.examples || []).length) s += `Examples/formulas:\n${a.examples.map((t) => `- [${t.kind}] ${t.text} @${t.t}`).join('\n')}\n`;
    } else {
      s += 'Transcript:\n' + (l.segs || []).map((g) => `[${Math.round(g.t)}] ${spkName(l, g.s)}: ${g.x}`).join('\n').slice(0, 6000) + '\n';
    }
    notes.filter((n) => n.lectureId === l.id && n.body).forEach((n) => { s += `Student note "${n.title}": ${n.body.slice(0, 1500)}\n`; });
    if (out.length + s.length > lectureLimit) { out += '\n(Additional lectures omitted for length.)'; break; }
    out += s;
  }
  if (out.length < max) out += courseSourceMaterial(notes, max - out.length);
  return out;
}
export function analysisPrompt(l, c, notesText = '') {
  const tx = (l.segs || []).map((g) => `[${Math.round(g.t)}] ${spkName(l, g.s)}: ${g.x}`).join('\n')
    + ((l.slides || []).length ? '\n\nSLIDES/BOARD PHOTOS:\n' + l.slides.map((s) => `[${s.t}] ${s.text}`).join('\n') : '')
    + ((l.marks || []).length ? '\n\nSTUDENT BOOKMARKED THESE MOMENTS (treat as important): ' + l.marks.join(', ') : '')
    + (notesText ? '\n\nTHE STUDENT\'S OWN NOTES FROM THIS LECTURE (use them, especially when there is no transcript):\n' + notesText.slice(0, 20000) : '');
  return `You are ClassScribe, analyzing a college lecture transcript for a student. Course: ${c.code || ''} ${c.name || ''} (${c.professor || 'professor'}). Lecture: "${l.title}" on ${l.date}. Today is ${todayISO()}. Each line is "[seconds] SPEAKER: text".
Return ONLY JSON with this shape:
{"summary":"2-3 sentences","keyPoints":["5-8 main takeaways"],"emphasized":[{"concept":"","why":"quote or reason","t":seconds}],"terms":[{"term":"","def":"one sentence from the lecture","t":seconds}],"examples":[{"kind":"example|formula|process|case|date|person","text":"","t":seconds}],"assignments":[{"title":"","type":"homework|reading|quiz|exam|project","due":"YYYY-MM-DD or empty","t":seconds}],"announcements":[""],"studentQuestions":[{"q":"","t":seconds}],"concepts":["3-8 short general topic names"],"notes":"structured study notes in markdown using ## headings and - bullets, bold key terms"}
Use only what is in the transcript. Resolve relative dates against the lecture date. Use empty arrays when nothing applies.

TRANSCRIPT:
${tx.slice(0, 110000)}`;
}
export const lectureNotesText = (l, notes) => notes.filter((n) => n.lectureId === l.id && (n.body || '').trim()).map((n) => `${n.title}:\n${n.body}`).join('\n\n');
export const hasContent = (l, notesText) => !!((l.segs || []).length || (l.slides || []).length || (notesText || '').trim());

export function cleanAnalysis(a) {
  a = a || {};
  return { summary: a.summary || '', keyPoints: a.keyPoints || [], emphasized: a.emphasized || [], terms: a.terms || [], examples: a.examples || [], assignments: a.assignments || [], announcements: a.announcements || [], studentQuestions: a.studentQuestions || [], concepts: a.concepts || [], notes: a.notes || '' };
}
export function localGuide(c, ex, lecs, weak, notes = []) {
  const an = lecs.filter((l) => l.analysis); const A = (l) => l.analysis;
  const topics = topicCounts(an); const days = ex ? Math.max(1, daysUntil(ex.due)) : 14;
  let t = '## Big picture\n';
  an.forEach((l) => { t += `- **${fmtD(l.date)} · ${l.title}:** ${A(l).summary} [[${l.id}@0]]\n`; });
  const sources = notes.filter((note) => ['syllabus', 'reading', 'study-guide'].includes(note.sourceType) && String(note.body || '').trim());
  if (sources.length) {
    t += '\n## Imported course sources\n';
    sources.forEach((source) => {
      const sourceName = source.sourceName ? ` · ${source.sourceName}` : '';
      t += `- **${source.title}** (${source.sourceType.replace('-', ' ')}${sourceName}):\n${source.body.slice(0, 3000).split('\n').map((line) => `  ${line}`).join('\n')}\n`;
    });
  }
  t += '\n## Core concepts\n';
  topics.slice(0, 10).forEach((tp) => { t += `- **${tp.name}**, in ${plural(tp.refs.length, 'lecture')} ${tp.refs.map((r) => `[[${r.id}@${r.t}]]`).join(' ')}\n`; });
  t += '\n## Must-know definitions\n';
  an.forEach((l) => (A(l).terms || []).forEach((x) => { t += `- **${x.term}:** ${x.def} [[${l.id}@${x.t || 0}]]\n`; }));
  const fx = []; an.forEach((l) => (A(l).examples || []).filter((x) => /formula|process/.test(x.kind)).forEach((x) => fx.push(`- ${x.text} [[${l.id}@${x.t || 0}]]`)));
  if (fx.length) t += `\n## Formulas & processes\n${fx.join('\n')}\n`;
  const em = []; an.forEach((l) => (A(l).emphasized || []).forEach((x) => em.push(`- **${x.concept}**: ${x.why} [[${l.id}@${x.t || 0}]]`)));
  if (em.length) t += `\n## What the professor emphasized\n${em.join('\n')}\n`;
  const review = missedConceptReview({ concepts: Object.fromEntries(weak.map((w) => [w.concept, w])) }, 6);
  if (review.length) {
    t += `\n## Missed concepts & practical review\n${review.map((w) => `- **${w.concept}** — missed ${w.missed} of ${w.attempts} recorded attempts.\n${w.steps.map((step) => `  - ${step}`).join('\n')}`).join('\n')}\n`;
  }
  t += `\n## Review plan (${plural(days, 'day')})\n`;
  const per = Math.max(1, Math.ceil(an.length / Math.max(1, days - 2))); let d = 1;
  for (let i = 0; i < an.length; i += per) { t += `- **Day ${d++}:** review ${an.slice(i, i + per).map((l) => l.title).join(' + ')}, then its flashcards\n`; if (d > days - 1) break; }
  t += `- **Day ${Math.max(d, days)}:** take a practice exam, then quiz yourself on weak areas\n`;
  return t;
}
export function searchLectures(lecs, notes, q, limit = 8) {
  const toks = String(q).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  if (!toks.length) return [];
  const score = (text) => { const t = text.toLowerCase(); let s = 0; toks.forEach((w) => { const st = w.length > 5 ? w.slice(0, w.length - 2) : w; if (t.includes(st)) s += 1; }); return s; };
  const hits = [];
  lecs.forEach((l) => (l.segs || []).forEach((g, i) => { const s = score(g.x); if (s) hits.push({ kind: 'lecture', l, i, t: g.t, text: g.x, s }); }));
  notes.forEach((n) => { const s = score(n.title + ' ' + n.body); if (s) hits.push({ kind: 'note', n, text: n.body.slice(0, 600), s }); });
  return hits.sort((a, b) => b.s - a.s).slice(0, limit);
}
export function searchAssignments(assignments, q, limit = 8) {
  const toks = String(q).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  if (!toks.length) return [];
  const hits = assignments.map((assignment) => {
    const text = `${assignment.title || ''} ${assignment.type || ''} ${assignment.due || ''}`.toLowerCase();
    const score = toks.reduce((total, word) => total + (text.includes(word.length > 5 ? word.slice(0, -2) : word) ? 1 : 0), 0);
    return { assignment, score };
  }).filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map((hit) => hit.assignment);
}
