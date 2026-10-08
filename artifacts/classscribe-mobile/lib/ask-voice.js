export function appendVoiceTranscript(current, transcript) {
  const existing = String(current ?? '').trim().replace(/\s+/g, ' ');
  const addition = String(transcript ?? '').trim().replace(/\s+/g, ' ');
  return [existing, addition].filter(Boolean).join(' ');
}

export function toSpeechText(markdown) {
  return String(markdown ?? '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[[^\]]+\]\]/g, ' ')
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, '$1')
    .replace(/(^|\n)\s*[-*+]\s+/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/>\s?/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSpeechText(text, maxLength = 2800) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const limit = Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : 2800;
  const chunks = [];
  let current = '';

  for (const word of words) {
    if (word.length > limit) {
      if (current) chunks.push(current);
      current = '';
      for (let offset = 0; offset < word.length; offset += limit) {
        chunks.push(word.slice(offset, offset + limit));
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > limit) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function beginVoiceRecording({
  requestPermission,
  setAudioMode,
  prepareToRecord,
  record,
  isActive = () => true,
}) {
  const permission = await requestPermission();
  if (!isActive()) return { status: 'cancelled' };
  if (!permission?.granted) return { status: 'denied', permission };

  let recordingStarted = false;
  let audioModeAttempted = false;
  try {
    audioModeAttempted = true;
    await setAudioMode({ allowsRecording: true, playsInSilentMode: true });
    await prepareToRecord();
    if (!isActive()) return { status: 'cancelled' };
    await record();
    recordingStarted = true;
    return { status: 'recording' };
  } finally {
    if (audioModeAttempted && !recordingStarted) {
      try {
        await setAudioMode({ allowsRecording: false, playsInSilentMode: true });
      } catch {}
    }
  }
}

export async function finishVoiceQuestion({
  stopRecording,
  getUri,
  transcribe,
  removeTemporaryAudio,
  setAudioMode,
  discard = false,
}) {
  let uri;
  let retainForCreditConfirmation = false;
  try {
    await stopRecording();
    uri = getUri();
    if (discard) return { status: 'discarded', text: '' };
    if (!uri) throw new Error('No audio was captured. Please try again.');

    let result;
    try {
      result = await transcribe(uri);
    } catch (error) {
      if (error?.code === 'credits_required' && error?.requestId) {
        retainForCreditConfirmation = true;
        error.audioUri = uri;
      }
      throw error;
    }
    const text = (result?.segments || []).map((segment) => segment?.x).filter(Boolean).join(' ').trim();
    if (!text) throw new Error('No speech was detected. Please try again.');
    return { status: 'transcribed', text };
  } finally {
    if (!uri) {
      try {
        uri = getUri();
      } catch {}
    }
    if (!retainForCreditConfirmation) {
      try {
        removeTemporaryAudio(uri);
      } catch {}
    }
    try {
      await setAudioMode({ allowsRecording: false, playsInSilentMode: true });
    } catch {}
  }
}

export function createSpeechPlayback(speech, {
  setTimeout: scheduleTimeout = setTimeout,
  clearTimeout: cancelTimeout = clearTimeout,
} = {}) {
  let playbackToken = 0;
  let deadline;

  function clearDeadline() {
    if (deadline !== undefined) cancelTimeout(deadline);
    deadline = undefined;
  }

  function stop() {
    playbackToken += 1;
    clearDeadline();
    try {
      return Promise.resolve(speech.stop()).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  function play(text, { onDone, onStopped, onError } = {}) {
    const maxLength = Math.min(2800, speech.maxSpeechInputLength || 2800);
    const chunks = splitSpeechText(
      toSpeechText(text) || 'I could not find an answer.',
      maxLength,
    );
    if (!chunks.length) return;

    const token = ++playbackToken;
    clearDeadline();
    const fail = (error) => {
      if (playbackToken !== token) return;
      // Invalidate callbacks before stopping: engines may emit callbacks from stop().
      stop();
      onError?.(error);
    };
    const armDeadline = (chunk) => {
      clearDeadline();
      // Allow startup time and generous reading time, but never wait indefinitely.
      const timeoutMs = Math.min(300000, 15000 + chunk.length * 100);
      deadline = scheduleTimeout(() => {
        const error = new Error('Spoken answer playback timed out.');
        error.code = 'speech_timeout';
        fail(error);
      }, timeoutMs);
    };
    // Also bound the initial stop promise, which some engines never resolve.
    armDeadline(chunks[0]);
    let stopping;
    try {
      stopping = speech.stop();
    } catch {
      stopping = undefined;
    }
    Promise.resolve(stopping).catch(() => {}).then(() => {
      if (playbackToken !== token) return;

      const playChunk = (chunkIndex) => {
        if (playbackToken !== token) return;
        let settled = false;
        const settle = () => {
          if (settled || playbackToken !== token) return false;
          settled = true;
          clearDeadline();
          return true;
        };
        armDeadline(chunks[chunkIndex]);
        try {
          speech.speak(chunks[chunkIndex], {
            language: 'en-US',
            rate: 1,
            onDone: () => {
              if (!settle()) return;
              if (chunkIndex + 1 < chunks.length) playChunk(chunkIndex + 1);
              else {
                playbackToken += 1;
                onDone?.();
              }
            },
            onStopped: () => {
              if (!settle()) return;
              playbackToken += 1;
              onStopped?.();
            },
            onError: (error) => {
              if (settle()) fail(error);
            },
          });
        } catch (error) {
          if (settle()) fail(error);
        }
      };

      playChunk(0);
    });
  }

  return { play, stop };
}