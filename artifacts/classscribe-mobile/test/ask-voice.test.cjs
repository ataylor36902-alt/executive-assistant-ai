const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  appendVoiceTranscript,
  beginVoiceRecording,
  createSpeechPlayback,
  finishVoiceQuestion,
  splitSpeechText,
  toSpeechText,
} = require('../.ask-voice-test.cjs');

test('voice transcript appends to typed text without adding empty spaces', () => {
  assert.equal(appendVoiceTranscript('  What did I miss?  ', '  Review chapter three. '), 'What did I miss? Review chapter three.');
  assert.equal(appendVoiceTranscript('', '  Review chapter three. '), 'Review chapter three.');
  assert.equal(appendVoiceTranscript('typed question', ''), 'typed question');
});

test('speech text removes markdown and lecture citation tokens', () => {
  assert.equal(toSpeechText('# Key point\n- The lecture emphasizes **mitosis** [[lecture-1@22]].'), 'Key point The lecture emphasizes mitosis.');
});

test('long answers are split into bounded speech chunks', () => {
  assert.deepEqual(splitSpeechText('One two three four five', 18), ['One two three four', 'five']);
  assert.deepEqual(splitSpeechText('', 18), []);
});

test('voice recording stops cleanly when microphone permission is denied', async () => {
  const calls = [];
  const result = await beginVoiceRecording({
    requestPermission: async () => {
      calls.push('permission');
      return { granted: false, canAskAgain: false };
    },
    setAudioMode: async () => calls.push('audio-mode'),
    prepareToRecord: async () => calls.push('prepare'),
    record: async () => calls.push('record'),
  });

  assert.equal(result.status, 'denied');
  assert.equal(result.permission.canAskAgain, false);
  assert.deepEqual(calls, ['permission']);
});

test('voice recording starts only after permission, audio mode, and preparation succeed', async () => {
  const calls = [];
  const result = await beginVoiceRecording({
    requestPermission: async () => {
      calls.push('permission');
      return { granted: true };
    },
    setAudioMode: async (mode) => calls.push(mode.allowsRecording ? 'recording-mode' : 'playback-mode'),
    prepareToRecord: async () => calls.push('prepare'),
    record: async () => calls.push('record'),
  });

  assert.equal(result.status, 'recording');
  assert.deepEqual(calls, ['permission', 'recording-mode', 'prepare', 'record']);
});

test('empty voice recordings report a retryable message and restore audio mode', async () => {
  const calls = [];
  await assert.rejects(
    finishVoiceQuestion({
      stopRecording: async () => calls.push('stop'),
      getUri: () => null,
      transcribe: async () => {
        calls.push('transcribe');
        return { segments: [] };
      },
      removeTemporaryAudio: (uri) => calls.push(['remove', uri]),
      setAudioMode: async (mode) => calls.push(['audio-mode', mode.allowsRecording]),
    }),
    /No audio was captured/,
  );

  assert.deepEqual(calls, ['stop', ['remove', null], ['audio-mode', false]]);
});

test('recordings with no recognized speech are rejected and their audio is removed', async () => {
  const calls = [];
  await assert.rejects(
    finishVoiceQuestion({
      stopRecording: async () => calls.push('stop'),
      getUri: () => 'file:///silent-question.m4a',
      transcribe: async () => ({ segments: [{ x: '  ' }, {}] }),
      removeTemporaryAudio: (uri) => calls.push(['remove', uri]),
      setAudioMode: async (mode) => calls.push(['audio-mode', mode.allowsRecording]),
    }),
    /No speech was detected/,
  );
  assert.deepEqual(calls, [
    'stop',
    ['remove', 'file:///silent-question.m4a'],
    ['audio-mode', false],
  ]);
});

test('successful voice transcription returns words and removes temporary audio', async () => {
  const calls = [];
  const result = await finishVoiceQuestion({
    stopRecording: async () => calls.push('stop'),
    getUri: () => 'file:///temporary-question.m4a',
    transcribe: async (uri) => {
      calls.push(['transcribe', uri]);
      return { segments: [{ x: 'What' }, { x: 'is mitosis?' }] };
    },
    removeTemporaryAudio: (uri) => calls.push(['remove', uri]),
    setAudioMode: async (mode) => calls.push(['audio-mode', mode.allowsRecording]),
  });

  assert.deepEqual(result, { status: 'transcribed', text: 'What is mitosis?' });
  assert.deepEqual(calls, [
    'stop',
    ['transcribe', 'file:///temporary-question.m4a'],
    ['remove', 'file:///temporary-question.m4a'],
    ['audio-mode', false],
  ]);
});

test('credits-required voice transcription retains the original audio for an explicit retry', async () => {
  const calls = [];
  let captured;
  await assert.rejects(
    finishVoiceQuestion({
      stopRecording: async () => calls.push('stop'),
      getUri: () => 'file:///credits-question.m4a',
      transcribe: async () => { throw { code: 'credits_required', requestId: 'ask-audio-1', cost: 2, balance: 1 }; },
      removeTemporaryAudio: (uri) => calls.push(['remove', uri]),
      setAudioMode: async () => calls.push('audio-mode'),
    }),
    (error) => {
      captured = error;
      return error.code === 'credits_required' && error.audioUri === 'file:///credits-question.m4a';
    },
  );
  assert.equal(captured.requestId, 'ask-audio-1');
  assert.deepEqual(calls, ['stop', 'audio-mode']);
});

function makeScreenVoiceStop(transcribe) {
  const screen = readFileSync(join(__dirname, '../app/(tabs)/ask/index.js'), 'utf8');
  const source = 'async function stopVoice(' + screen.split('async function stopVoice(')[1].split('  const tools =')[0];
  const context = { uid: 'student', scopeRevision: 0, scopeSnapshot: 'course' };
  const state = { draft: 'Could you explain', errors: [], submitted: [] };
  const deps = {
    voiceRef: { current: 'recording' },
    voiceOperation: { current: false },
    voiceContextRef: { current: context },
    sessionRef: { current: true },
    renderedLibraryUidRef: { current: 'student' },
    scopeRevision: { current: 0 },
    scopeSnapshotRef: { current: 'course' },
    stopVoiceAfterPlaybackRef: { current: false },
    askQuotaExhaustedRef: { current: false },
    getUid: () => 'student',
    changeVoice: (value) => { deps.voiceRef.current = value; },
    recorder: { stop: async () => {}, uri: 'file:///question.m4a' },
    transcribe,
    removeTemporaryAudio: () => {},
    setAudioModeAsync: async () => {},
    finishVoiceQuestion,
    appendVoiceTranscript,
    errMsg: (error) => error.message,
    isCreditsRequired: (error) => error?.code === 'credits_required' && !!error.requestId,
    setCreditsPrompt: () => {},
    setCreditsPromptVisible: () => {},
    setVoiceError: (error) => state.errors.push(error),
    setVoiceSession: () => {},
    setInput: (update) => { state.draft = update(state.draft); },
    send: (question) => state.submitted.push(question),
  };
  // Execute the screen's actual stop handler with its external dependencies stubbed.
  const stopVoice = new Function('deps', `with (deps) { return ${source.trim()}; }`)(deps);
  return { screen, stopVoice, state, deps };
}

test('spoken words become an editable draft and are not submitted until Send is pressed', async () => {
  const { screen, stopVoice, state, deps } = makeScreenVoiceStop(async () => ({ segments: [{ x: 'the Krebs cycle?' }] }));
  await stopVoice();
  assert.equal(state.draft, 'Could you explain the Krebs cycle?');
  assert.deepEqual(state.submitted, []);
  assert.equal(deps.voiceRef.current, 'idle');
  assert.match(screen, /editable=\{voice === 'idle' && !busy\}/);
  assert.match(screen, /onPress=\{\(\) => send\(\)\} disabled=\{!input\.trim\(\) \|\| !!busy \|\| voice !== 'idle'\}/);
  state.draft = 'Could you explain the citric acid cycle instead?';
  deps.send(state.draft); // Only the explicit Send action submits the edited question.
  assert.deepEqual(state.submitted, ['Could you explain the citric acid cycle instead?']);
});

test('failed transcription leaves the draft alone and cannot submit it', async () => {
  const { stopVoice, state } = makeScreenVoiceStop(async () => ({ segments: [] }));
  await stopVoice();
  assert.equal(state.draft, 'Could you explain');
  assert.deepEqual(state.submitted, []);
  assert.match(state.errors[0], /No speech was detected.*record again or type your question/);
});

test('late transcription after ending the voice session does not overwrite the question', async () => {
  let finishTranscription;
  const { stopVoice, state, deps } = makeScreenVoiceStop(() => new Promise((resolve) => { finishTranscription = resolve; }));
  const stopping = stopVoice();
  await new Promise((resolve) => setImmediate(resolve));
  deps.sessionRef.current = false;
  deps.voiceContextRef.current = null;
  finishTranscription({ segments: [{ x: 'stale question' }] });
  await stopping;
  assert.equal(state.draft, 'Could you explain');
  assert.deepEqual(state.submitted, []);
});

test('transcription errors propagate while temporary audio is still removed', async () => {
  const calls = [];
  await assert.rejects(
    finishVoiceQuestion({
      stopRecording: async () => calls.push('stop'),
      getUri: () => 'file:///temporary-question.m4a',
      transcribe: async () => {
        calls.push('transcribe');
        throw new Error('Transcription unavailable');
      },
      removeTemporaryAudio: (uri) => calls.push(['remove', uri]),
      setAudioMode: async (mode) => calls.push(['audio-mode', mode.allowsRecording]),
    }),
    /Transcription unavailable/,
  );
  assert.deepEqual(calls, [
    'stop',
    'transcribe',
    ['remove', 'file:///temporary-question.m4a'],
    ['audio-mode', false],
  ]);
});

test('read-aloud playback can be stopped without starting another answer chunk', async () => {
  const spoken = [];
  let currentOptions;
  let stopCalls = 0;
  const player = createSpeechPlayback({
    maxSpeechInputLength: 8,
    stop: async () => {
      stopCalls += 1;
    },
    speak: (text, options) => {
      spoken.push(text);
      currentOptions = options;
    },
  });

  player.play('one two three four');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(spoken, ['one two']);

  const staleOptions = currentOptions;
  await player.stop();
  staleOptions.onDone();

  assert.equal(stopCalls, 2);
  assert.deepEqual(spoken, ['one two']);
});

test('read-aloud playback speaks long answers in bounded chunks', async () => {
  const spoken = [];
  const player = createSpeechPlayback({
    maxSpeechInputLength: 8,
    stop: async () => {},
    speak: (text, options) => {
      spoken.push(text);
      options.onDone();
    },
  });

  let finished = false;
  player.play('one two three four five', { onDone: () => { finished = true; } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(spoken, ['one two', 'three', 'four', 'five']);
  assert.ok(spoken.every((chunk) => chunk.length <= 8));
  assert.equal(finished, true);
});

function makeScreenSpeechPlayback(speech, sessionReply, timers) {
  const screen = readFileSync(join(__dirname, '../app/(tabs)/ask/index.js'), 'utf8');
  const source = 'function speakAnswer(' + screen.split('function speakAnswer(')[1].split('  async function send(')[0];
  const endSource = 'function endConversation()' + screen.split('function endConversation()')[1].split('  async function stopVoice(')[0];
  const answer = 'One two three four five';
  const state = {
    turns: [{ role: 'assistant', content: answer }],
    errors: [],
    voiceError: '',
    speakingTurn: null,
    voice: 'idle',
    voiceSession: sessionReply,
    recordingStarted: false,
  };
  const deps = {
    PLAYBACK_ERROR: 'Could not play the spoken answer. The written answer is above.',
    PLAYBACK_TIMEOUT_ERROR: 'Audio could not finish playing. The written answer is above. You can start voice again or type your next question.',
    sessionRef: { current: sessionReply },
    voiceRef: { current: 'idle' },
    voiceContextRef: { current: null },
    stopVoiceAfterPlaybackRef: { current: false },
    askQuotaExhaustedRef: { current: false },
    speechPlayback: { current: createSpeechPlayback(speech, timers) },
    speakingTurn: null,
    cancelCurrentAsk: () => {},
    setVoiceSession: (active) => { state.voiceSession = active; },
    stopVoice: () => { state.recordingStarted = true; },
    changeVoice: (voice) => { state.voice = voice; deps.voiceRef.current = voice; },
    setSpeakingTurn: (turn) => { state.speakingTurn = turn; deps.speakingTurn = turn; },
    setVoiceError: (update) => {
      const error = typeof update === 'function' ? update(state.voiceError) : update;
      if (error !== state.voiceError) state.errors.push(error);
      state.voiceError = error;
    },
    startVoice: () => { state.recordingStarted = true; },
  };
  deps.endConversation = new Function('deps', `with (deps) { return ${endSource.trim()}; }`)(deps);
  const speakAnswer = new Function('deps', `with (deps) { return ${source.trim()}; }`)(deps);
  assert.match(screen, /<Md text=\{t\.content\}/);
  assert.match(screen, /\{voiceError \? <View/);
  return { answer, state, deps, speakAnswer };
}

function makePlaybackClock() {
  let now = 0;
  let nextId = 0;
  const pending = new Map();
  const delays = [];
  return {
    delays,
    get size() { return pending.size; },
    setTimeout(callback, delay) {
      delays.push(delay);
      const id = ++nextId;
      pending.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of pending) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
  };
}

for (const sessionReply of [true, false]) {
  test(`silent speech timeout recovers ${sessionReply ? 'voice conversation' : 'read-aloud'} and ignores late callbacks`, async () => {
    const clock = makePlaybackClock();
    const spoken = [];
    let options;
    let stopCalls = 0;
    const { answer, state, deps, speakAnswer } = makeScreenSpeechPlayback({
      maxSpeechInputLength: 8,
      stop: async () => { stopCalls += 1; },
      speak: (text, callbacks) => { spoken.push(text); options = callbacks; },
    }, sessionReply, clock);

    speakAnswer(answer, sessionReply ? undefined : 0);
    await new Promise((resolve) => setImmediate(resolve));
    const staleOptions = options;
    clock.advance(14999);
    assert.equal(state.errors.length, 0);
    clock.advance(300000);
    assert.equal(clock.size, 0);
    assert.equal(state.voice, 'idle');
    assert.equal(state.speakingTurn, null);
    assert.equal(state.voiceSession, false);
    assert.equal(deps.sessionRef.current, false);
    assert.equal(state.recordingStarted, false);
    assert.match(state.errors[0], /Audio could not finish playing.*start voice again/);
    assert.deepEqual(state.turns, [{ role: 'assistant', content: answer }]);
    assert.ok(stopCalls >= 2);

    staleOptions.onDone();
    staleOptions.onStopped();
    staleOptions.onError(new Error('late error'));
    assert.deepEqual(spoken, ['One two']);
    assert.equal(state.errors.length, 1);
    assert.equal(state.recordingStarted, false);

    // Execute the actual tap-to-start handler after recovery.
    const screen = readFileSync(join(__dirname, '../app/(tabs)/ask/index.js'), 'utf8');
    const source = 'function startConversation()' + screen.split('function startConversation()')[1].split('  function endConversation()')[0];
    Object.assign(deps, {
      getUid: () => 'student', st: { status: { uid: 'student' } },
      scopeRevision: { current: 0 }, scopeSnapshotRef: { current: 'course' },
      stopAnswerPlayback: () => deps.speechPlayback.current.stop(),
    });
    const startConversation = new Function('deps', `with (deps) { return ${source.trim()}; }`)(deps);
    startConversation();
    assert.equal(state.recordingStarted, true);
    assert.equal(state.voiceSession, true);

    // The expired answer cannot interfere even after a new session starts.
    staleOptions.onDone();
    assert.deepEqual(spoken, ['One two']);
    assert.equal(state.voiceSession, true);
    assert.equal(state.errors.length, 1);
  });
}

test('speech deadlines reset per chunk and are cleared on completion, cancellation, and replacement', async () => {
  const clock = makePlaybackClock();
  const options = [];
  let completed = 0;
  let errors = 0;
  const player = createSpeechPlayback({
    maxSpeechInputLength: 8,
    stop: async () => {},
    speak: (_, callbacks) => options.push(callbacks),
  }, clock);
  player.play('one two three', { onDone: () => { completed += 1; }, onError: () => { errors += 1; } });
  await new Promise((resolve) => setImmediate(resolve));
  clock.advance(15000);
  options[0].onDone();
  options[0].onDone();
  options[0].onError();
  assert.equal(options.length, 2);
  clock.advance(1000); // Beyond the first chunk's deadline, before the second's.
  assert.equal(errors, 0);
  options[1].onDone();
  options[1].onStopped();
  assert.equal(completed, 1);
  assert.equal(clock.size, 0);

  player.play('another', { onError: () => { errors += 1; } });
  await new Promise((resolve) => setImmediate(resolve));
  const replacedOptions = options[2];
  player.play('replacement', { onError: () => { errors += 1; } });
  await new Promise((resolve) => setImmediate(resolve));
  replacedOptions.onDone();
  assert.equal(clock.size, 1);
  await player.stop();
  assert.equal(clock.size, 0);
  clock.advance(300000);
  assert.equal(errors, 0);
  assert.ok(clock.delays.every((delay) => delay >= 15000 && delay <= 300000));
});

test('a stuck initial engine stop also times out, and its late resolution cannot begin speech', async () => {
  const clock = makePlaybackClock();
  let resolveStop;
  let spoken = 0;
  let failure;
  const player = createSpeechPlayback({
    stop: () => new Promise((resolve) => { resolveStop = resolve; }),
    speak: () => { spoken += 1; },
  }, clock);
  player.play('answer', { onError: (error) => { failure = error; } });
  const finishInitialStop = resolveStop;
  clock.advance(300000);
  assert.equal(failure.code, 'speech_timeout');
  assert.equal(clock.size, 0);
  finishInitialStop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(spoken, 0);
});

test('speech engine error leaves the written answer visible, clears speaking, and never starts the next chunk', async () => {
  const spoken = [];
  let failedOptions;
  const { answer, state, deps, speakAnswer } = makeScreenSpeechPlayback({
    maxSpeechInputLength: 8,
    stop: async () => {},
    speak: (text, options) => {
      spoken.push(text);
      failedOptions = options;
    },
  }, true);

  speakAnswer(answer);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(spoken, ['One two']);
  assert.equal(state.voice, 'speaking');
  failedOptions.onError(new Error('Speech engine unavailable'));
  failedOptions.onDone(); // A late completion from the failed engine must be ignored.
  failedOptions.onError(new Error('Duplicate engine error'));

  assert.deepEqual(spoken, ['One two']);
  assert.deepEqual(state.errors, ['Could not play the spoken answer. The written answer is above.']);
  assert.deepEqual(state.turns, [{ role: 'assistant', content: answer }]);
  assert.equal(state.voice, 'idle');
  assert.equal(state.voiceSession, false);
  assert.equal(deps.sessionRef.current, false);
  assert.equal(state.speakingTurn, null);
  assert.equal(state.recordingStarted, false);
});

test('a thrown speak call reports failure without speaking later chunks or hiding the answer', async () => {
  const spoken = [];
  let firstOptions;
  const { answer, state, speakAnswer } = makeScreenSpeechPlayback({
    maxSpeechInputLength: 8,
    stop: async () => {},
    speak: (text, options) => {
      spoken.push(text);
      if (spoken.length === 1) firstOptions = options;
      else throw new Error('Synchronous speech failure');
    },
  }, false);

  speakAnswer(answer, 0);
  await new Promise((resolve) => setImmediate(resolve));
  firstOptions.onDone(); // The second speak call throws.
  firstOptions.onDone(); // Stale callbacks cannot replay or advance.

  assert.deepEqual(spoken, ['One two', 'three']);
  assert.deepEqual(state.errors, ['Could not play the spoken answer. The written answer is above.']);
  assert.deepEqual(state.turns, [{ role: 'assistant', content: answer }]);
  assert.equal(state.speakingTurn, null);
  assert.equal(state.voice, 'idle');
  assert.equal(state.recordingStarted, false);
});

test('manual read-aloud retry clears a speech-engine warning and stays clear after success', async () => {
  let options;
  const { answer, state, deps, speakAnswer } = makeScreenSpeechPlayback({
    stop: async () => {},
    speak: (_text, callbacks) => { options = callbacks; },
  }, true);
  speakAnswer(answer);
  await new Promise((resolve) => setImmediate(resolve));
  const failedOptions = options;
  failedOptions.onError(new Error('Speech engine unavailable'));
  assert.equal(state.voiceError, deps.PLAYBACK_ERROR);
  assert.equal(state.voiceSession, false);

  speakAnswer(answer, 0);
  assert.equal(state.voiceError, '');
  assert.equal(state.speakingTurn, 0);
  await new Promise((resolve) => setImmediate(resolve));
  failedOptions.onError(new Error('Late engine error'));
  options.onDone();
  assert.equal(state.voiceError, '');
  assert.equal(state.speakingTurn, null);
  assert.equal(state.recordingStarted, false);
  assert.deepEqual(state.turns, [{ role: 'assistant', content: answer }]);
});

test('failed read-aloud retry reports a fresh playback warning', async () => {
  let options;
  const { answer, state, deps, speakAnswer } = makeScreenSpeechPlayback({
    stop: async () => {},
    speak: (_text, callbacks) => { options = callbacks; },
  }, false);
  speakAnswer(answer, 0);
  await new Promise((resolve) => setImmediate(resolve));
  options.onError(new Error('Initial engine failure'));
  speakAnswer(answer, 0);
  assert.equal(state.voiceError, '');
  await new Promise((resolve) => setImmediate(resolve));
  options.onError(new Error('Retry engine failure'));
  assert.equal(state.voiceError, deps.PLAYBACK_ERROR);
  assert.deepEqual(state.errors, [deps.PLAYBACK_ERROR, '', deps.PLAYBACK_ERROR]);
  assert.equal(state.speakingTurn, null);
});

test('read-aloud preserves unrelated recording and transcription warnings', async () => {
  for (const warning of [
    'Microphone access is needed to ask a spoken question. You can still type below.',
    'Transcription unavailable. Please record again or type your question.',
  ]) {
    let options;
    const { answer, state, speakAnswer } = makeScreenSpeechPlayback({
      stop: async () => {},
      speak: (_text, callbacks) => { options = callbacks; },
    }, false);
    state.voiceError = warning;
    speakAnswer(answer, 0);
    assert.equal(state.voiceError, warning);
    await new Promise((resolve) => setImmediate(resolve));
    options.onDone();
    assert.equal(state.voiceError, warning);
    assert.deepEqual(state.errors, []);
  }
});