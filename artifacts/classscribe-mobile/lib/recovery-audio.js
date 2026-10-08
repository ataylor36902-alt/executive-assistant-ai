// Root audio is gated by recording ownership before it reaches this filter.
// Cache audio requires explicit ownership; legacy documents require manual selection.
export const isRecoveryAudio = (name) => /\.(m4a|mp4|aac|wav|caf|mp3|webm|ogg)$/i.test(name || '');

export function unlinkedAudio(files, lectures) {
  const referencedUris = new Set();
  const referencedNames = new Set();
  for (const lecture of lectures) {
    if (lecture.audioUri) referencedUris.add(lecture.audioUri);
    if (lecture.legacyAudioUri) referencedUris.add(lecture.legacyAudioUri);
    // Legacy audioName was stored for root-level files, but newer recordings
    // may have the same basename in their own lecture subdirectory.
    if (lecture.audioName && (!lecture.audioUri || lecture.audioUri.endsWith('/' + lecture.audioName))) {
      if (!lecture.audioUri || !lecture.audioUri.includes('/lectures/')) referencedNames.add(lecture.audioName);
    }
  }
  return files.filter((f) => isRecoveryAudio(f.name) && f.size > 0
    && !referencedUris.has(f.uri) && !referencedNames.has(f.name));
}