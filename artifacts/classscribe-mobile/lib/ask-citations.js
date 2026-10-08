export function citationKey(kind, id, seconds) {
  if (kind === 'lecture') return `lecture:${id}@${seconds}`;
  return `${kind}:${id}`;
}

export function isFiniteRealSeconds(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) return false;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0;
}

export function validateAskCitations(text, evidence) {
  let rejected = 0;
  const safeText = String(text || '').replace(
    /\[\[([\w-]+@[\d.]+|note:[\w-]+|assignment:[\w-]+)\]\]/g,
    (token, citation) => {
      const match = citation.match(/^([\w-]+)@([\d.]+)$/);
      const key = match
        ? citationKey('lecture', match[1], match[2])
        : citation;
      if (evidence && evidence.has(key)) return token;
      rejected++;
      return '[source unavailable]';
    },
  );
  return { text: safeText, rejected };
}

export function firstLectureCitation(text) {
  const match = String(text || '').match(/\[\[([\w-]+)@([\d.]+)\]\]/);
  return match ? { id: match[1], seconds: Number(match[2]) } : null;
}

export function firstNoteCitation(text) {
  const match = String(text || '').match(/\[\[note:([\w-]+)\]\]/);
  return match ? { id: match[1] } : null;
}

export function firstAssignmentCitation(text) {
  const match = String(text || '').match(/\[\[assignment:([\w-]+)\]\]/);
  return match ? { id: match[1] } : null;
}