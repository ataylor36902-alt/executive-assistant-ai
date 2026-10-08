export const askCalls = [];
let failAsk = false;

export function setFailAsk(value) {
  failAsk = value;
}

export const openai = {
  chat: {
    completions: {
      async create(request) {
        askCalls.push(request);
        if (failAsk) throw new Error("Mock Ask provider failure");
        return { choices: [{ message: { content: "Mitosis separates chromosomes [1]." } }] };
      },
    },
  },
};