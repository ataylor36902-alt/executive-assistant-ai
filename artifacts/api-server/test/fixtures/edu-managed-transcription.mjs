export const transcriptionCalls = [];
export let failTranscription = false;
let nextGate;

export function setFailTranscription(value) {
  failTranscription = value;
}

export function pauseNextTranscription() {
  let markStarted;
  let release;
  const started = new Promise(resolve => { markStarted = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  nextGate = { markStarted, blocked };
  return { started, release };
}

export const openai = {
  audio: {
    transcriptions: {
      async create(request) {
        transcriptionCalls.push(request);
        const gate = nextGate;
        nextGate = undefined;
        if (gate) {
          gate.markStarted();
          await gate.blocked;
        }
        if (failTranscription) throw new Error("Mock transcription provider failure");
        return { text: "A verified mock transcript." };
      },
    },
  },
};