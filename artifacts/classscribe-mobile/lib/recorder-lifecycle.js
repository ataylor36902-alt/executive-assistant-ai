export function recordingOptionsForPlatform(options, platform) {
  const { extension, sampleRate, numberOfChannels, bitRate, isMeteringEnabled = false, directory } = options;
  return {
    extension, sampleRate, numberOfChannels, bitRate, isMeteringEnabled,
    ...(platform === 'web' ? {} : { directory }),
    ...options[platform],
  };
}

// Do not retain a native shared object in React's memoized render state.
// Status and URI getters here are JavaScript-only; native reads happen in
// actions/polling and are allowed to fail without crashing React rendering.
export function createRecorderLifecycle(factory) {
  let native = null;
  let disposed = false;
  let shouldStop = false;
  let lastUri = null;
  let state = { isRecording: false, canRecord: false, durationMillis: 0 };
  function capture(object) {
    if (object !== native && !disposed) return state;
    const next = object.getStatus();
    state = { ...next, error: null };
    if (next.url) lastUri = next.url;
    try { if (object.uri) lastUri = object.uri; } catch { /* Preserve the last known file path. */ }
    return state;
  }
  function requireRecorder() {
    if (disposed) throw new Error('The recording screen has closed. Reopen it before recording.');
    if (!native) native = factory();
    return native;
  }
  return {
    activate() { disposed = false; },
    getStatus() { return state; },
    get isRecording() { return state.isRecording; },
    get uri() { return lastUri; },
    poll() {
      if (!native || disposed) return state;
      try { return capture(native); }
      catch (error) {
        state = { ...state, isRecording: false, error: `The recording device is unavailable. ${error?.message || 'Try saving any captured audio before leaving.'}` };
        return state;
      }
    },
    async prepareToRecordAsync() {
      const object = requireRecorder();
      lastUri = null;
      await object.prepareToRecordAsync();
      if (disposed || object !== native) throw new Error('The recording screen closed while preparing the microphone.');
      capture(object);
    },
    record() {
      const object = requireRecorder();
      shouldStop = true;
      state = { ...state, isRecording: true, error: null };
      object.record();
      capture(object);
    },
    pause() {
      const object = requireRecorder();
      object.pause();
      capture(object);
    },
    async stop() {
      if (!native) return;
      const object = native;
      await object.stop();
      shouldStop = false;
      capture(object);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const object = native;
      const needsStop = shouldStop;
      shouldStop = false;
      native = null;
      if (!object) return;
      // Stop before release, preserving the file URI for a pending save.
      // Cleanup never reads native isRecording/id getters.
      Promise.resolve().then(async () => {
        if (needsStop) {
          try { await object.stop(); capture(object); } catch { /* Cleanup must not throw. */ }
        }
      }).finally(() => {
        try { object.release(); } catch { /* Already released by the native runtime. */ }
      });
    },
  };
}
