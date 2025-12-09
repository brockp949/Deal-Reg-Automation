export default class OpenAI {
  constructor(_opts?: any) {}
  chat = {
    completions: {
      create: async () => ({ choices: [] }),
    },
  };
}
