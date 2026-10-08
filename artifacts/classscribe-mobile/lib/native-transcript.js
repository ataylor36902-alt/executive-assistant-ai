function comparableWord(word) {
  return word.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function appendWithoutOverlap(previous, candidate) {
  const priorWords = String(previous || '').trim().split(/\s+/).filter(Boolean);
  const nextWords = String(candidate || '').trim().split(/\s+/).filter(Boolean);
  if (!nextWords.length) return '';
  const prior = priorWords.slice(-64);
  let overlap = Math.min(prior.length, nextWords.length);
  while (overlap > 0) {
    const matches = prior.slice(-overlap).every((word, index) =>
      comparableWord(word) === comparableWord(nextWords[index]));
    if (matches) break;
    overlap -= 1;
  }
  return nextWords.slice(overlap).join(' ');
}

/**
 * Keeps interim recognition provisional. Finals are committed once; a part
 * boundary may promote the last interim only if the recognizer never finalized
 * it. Overlap removal handles cumulative/revised platform results.
 */
export function createNativeTranscriptAccumulator() {
  let provisional = '';
  let committed = '';

  return {
    accept(text, isFinal) {
      const clean = String(text || '').trim();
      if (!clean) return { draft: provisional, committed: '' };
      if (!isFinal) {
        provisional = clean;
        return { draft: provisional, committed: '' };
      }
      const novel = appendWithoutOverlap(committed, clean);
      committed = [committed, novel].filter(Boolean).join(' ').trim();
      provisional = '';
      return { draft: '', committed: novel };
    },
    finishPart() {
      const fallback = appendWithoutOverlap(committed, provisional);
      committed = [committed, fallback].filter(Boolean).join(' ').trim();
      provisional = '';
      return fallback;
    },
  };
}