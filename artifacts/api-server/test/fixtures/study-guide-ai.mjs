export const calls = [];
let failRequests = false;
export const setFailStudyGuide = (value) => { failRequests = value; };

export const openai = {
  chat: {
    completions: {
      async create(request) {
        calls.push(request);
        if (failRequests) throw new Error("Study guide provider failure");
        return {
          choices: [{
            finish_reason: "stop",
            message: {
              content: "# Big picture\nMock guide based on supplied material.\n\n# Review checklist\n- Revisit [1].",
            },
          }],
        };
      },
    },
  },
};