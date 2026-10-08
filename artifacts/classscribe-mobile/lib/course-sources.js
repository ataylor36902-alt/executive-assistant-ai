export const SOURCE_TYPES = ['syllabus', 'reading', 'study-guide'];
export const MAX_SOURCE_CHARS = 30_000;
export const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;

export function sourceFileType(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'txt' || ext === 'md') return 'text/plain';
  return '';
}

export function sourceText(value) {
  return String(value || '').slice(0, MAX_SOURCE_CHARS);
}

export function makeSourceNote({ id, courseId, title, body, sourceType, sourceName, created }) {
  if (!id || !courseId || !String(title || '').trim() || !String(body || '').trim() || !SOURCE_TYPES.includes(sourceType)) {
    throw new Error('Choose a course and source type, then add a title and source text.');
  }
  const timestamp = Number(created) || Date.now();
  const note = {
    id,
    courseId,
    lectureId: '',
    title: String(title).trim(),
    body: sourceText(body),
    sourceType,
    pinned: false,
    created: timestamp,
    updated: timestamp,
  };
  if (sourceName) note.sourceName = String(sourceName).slice(0, 255);
  return note;
}

export function courseSourceMaterial(notes = [], max = 30000) {
  const sources = notes.filter((note) => SOURCE_TYPES.includes(note.sourceType) && String(note.body || '').trim());
  const limit = Math.max(0, Math.floor(Number(max) || 0));
  if (!sources.length || !limit) return '';

  const normalized = sources.map((note) => ({
    note,
    body: String(note.body).slice(0, MAX_SOURCE_CHARS),
    heading: `\n### Private course ${note.sourceType.replace('-', ' ')}: "${String(note.title || 'Untitled source').slice(0, 100)}"${note.sourceName ? ` · ${String(note.sourceName).slice(0, 80)}` : ''}\n`,
  }));
  const coveragePrefix = `[Source coverage: balanced excerpts from ${sources.length} private sources; ${sources.length} shortened.]\n`;
  let headingCost = normalized.reduce((total, item) => total + item.heading.length, 0);
  let prefix = coveragePrefix;
  let compactCoverage = false;
  if (prefix.length + headingCost + normalized.length > limit) {
    compactCoverage = true;
    prefix = `[${sources.length} private sources; ${sources.length} shortened.]\n`;
    normalized.forEach((item, index) => {
      item.heading = `\n### Source ${index + 1}/${sources.length}: ${String(item.note.title || 'Untitled source').slice(0, 32)}\n`;
    });
    headingCost = normalized.reduce((total, item) => total + item.heading.length, 0);
  }
  if (prefix.length + headingCost + normalized.length > limit) {
    normalized.forEach((item, index) => { item.heading = `\nS${index + 1}: `; });
    headingCost = normalized.reduce((total, item) => total + item.heading.length, 0);
    prefix = `[${sources.length} sources; ${sources.length} shortened.]\n`.slice(0, Math.max(0, limit - headingCost - normalized.length));
  }
  const bodyBudget = Math.max(0, limit - prefix.length - headingCost - normalized.length);
  const allocations = normalized.map(() => 0);
  let remaining = bodyBudget;
  let active = normalized.map((_, index) => index).filter((index) => normalized[index].body.length > 0);
  while (remaining > 0 && active.length) {
    const share = Math.max(1, Math.floor(remaining / active.length));
    let used = 0;
    for (const index of active) {
      const available = normalized[index].body.length - allocations[index];
      const take = Math.min(share, available);
      allocations[index] += take;
      used += take;
    }
    if (!used) break;
    remaining -= used;
    active = active.filter((index) => allocations[index] < normalized[index].body.length);
  }
  const shortened = allocations.filter((amount, index) => amount < normalized[index].body.length).length;
  const coverage = compactCoverage
    ? `[${sources.length} private sources; ${shortened} shortened.]\n`
    : `[Source coverage: balanced excerpts from ${sources.length} private sources; ${shortened} shortened.]\n`;
  let out = coverage.length <= prefix.length ? coverage : prefix;
  normalized.forEach((item, index) => {
    const amount = allocations[index];
    out += item.heading + item.body.slice(0, amount) + '\n';
  });
  return out.slice(0, limit);
}