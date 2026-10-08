export const transcriptionCalls = [];
export let failTranscription = false;

export function setFailTranscription(value) {
  failTranscription = value;
}

export const openai = {
  audio: {
    transcriptions: {
      async create(request) {
        transcriptionCalls.push(request);
        if (failTranscription) throw new Error("Mock transcription provider failure");
        return { text: "A verified mock transcript." };
      },
    },
  },
  chat: {
    completions: {
      async create() {
        return { choices: [{ message: { content: "{}" } }] };
      },
    },
  },
};