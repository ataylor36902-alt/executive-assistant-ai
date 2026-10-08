export function isSeekableLectureTimestamp(timestamp) {
  return Number.isFinite(timestamp) && timestamp >= 0;
}

export function lectureLinkTimestamp(value) {
  if (value == null) return null;
  const timestamp = Number(value);
  return isSeekableLectureTimestamp(timestamp) ? timestamp : null;
}

export function formatLectureTimestamp(timestamp, formatTime) {
  return isSeekableLectureTimestamp(timestamp) ? formatTime(timestamp) : '—';
}

export function createLectureAudioSeeker(player, onError = () => {}) {
  let loaded = false;
  let pending = null;
  let requestId = 0;

  async function seekAndPlay(timestamp, request) {
    try {
      await player.seekTo(timestamp);
      if (request === requestId) await player.play();
    } catch {
      if (request === requestId) onError();
    }
  }

  function seek(timestamp) {
    if (!isSeekableLectureTimestamp(timestamp)) return false;
    const request = ++requestId;
    if (!loaded) {
      pending = { timestamp, request };
      return true;
    }
    pending = null;
    void seekAndPlay(timestamp, request);
    return true;
  }

  function setLoaded(value) {
    loaded = Boolean(value);
    if (!loaded || !pending) return;
    const request = pending.request;
    const timestamp = pending.timestamp;
    pending = null;
    void seekAndPlay(timestamp, request);
  }

  return { seek, setLoaded };
}