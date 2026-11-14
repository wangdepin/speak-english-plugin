// Phase 6 throwaway backend: remembers which sessions the plugin started, offers a tool
// only in those sessions, and logs every time the host builds or runs that tool.
const fs = require('node:fs');
const path = require('node:path');

const LESSON = `Passage (English, the learner's own language is Chinese):
1. 今天就到这里吧。 -> Let's call it a day. (key expression: call it a day)
2. 剩下的我们明天再弄清楚。 -> We'll figure out the rest tomorrow. (key expression: figure out)

Diagnostic:
1. Not said: call, day. Marked unknown: call it a day.
2. Not said: figure. Marked unknown: none.

Guide: explain in Chinese only the gaps listed above. Do not teach linking rules; treat "call it a day" as one chunk of sound with one meaning. You cannot play audio or hear the learner.`;

exports.activate = ctx => {
  const boundFile = path.join(ctx.dataDirectory, 'bound.json');
  const logFile = path.join(ctx.dataDirectory, 'calls.jsonl');
  const bound = () => { try { return JSON.parse(fs.readFileSync(boundFile, 'utf8')); } catch { return []; } };
  const log = entry => {
    fs.mkdirSync(ctx.dataDirectory, { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  };

  ctx.handle('bind', ({ chatId }) => {
    fs.mkdirSync(ctx.dataDirectory, { recursive: true });
    fs.writeFileSync(boundFile, JSON.stringify([...bound(), chatId]));
    log({ event: 'bind', chatId });
    return { ok: true };
  });

  ctx.registerInstructions({
    agents: ['prober', 'teacher'],
    text: 'If the tool speaking_practice_lesson is available, this session was started from the Speaking practice plugin: call it before anything else and follow the guide it returns.',
  });

  ctx.registerTools({
    agents: ['prober', 'teacher'],
    create: context => {
      const offered = bound().includes(context.chatId);
      log({ event: 'create', chatId: context.chatId, agent: context.agent, offered });
      if (!offered) return [];
      return [{
        name: 'speaking_practice_lesson',
        label: 'Speaking practice lesson',
        description: 'Returns the passage the learner wants to be taught, what a listening diagnostic found, and how to teach it.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => {
          log({ event: 'execute', chatId: context.chatId, agent: context.agent });
          return { content: [{ type: 'text', text: LESSON }], details: { chatId: context.chatId } };
        },
      }];
    },
  });
};
