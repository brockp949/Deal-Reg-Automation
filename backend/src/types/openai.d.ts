declare module 'openai' {
  export default class OpenAI {
    constructor(options?: any);
    chat: {
      completions: {
        create: (...args: any[]) => Promise<any>;
      };
    };
  }
}
