# Phase 6 spike: handing a passage to the lesson teacher

A throwaway plugin that checks, before any real code is written, whether a
plugin can start a LearnHarness lesson and steer it. It is not part of the
Speak English plugin.

## What it checks

1. A plugin frontend can create a session the way the host's home page does:
   `POST /api/chats` with a title, then
   `sessionStorage['lh.openingPrompt.<id>'] = {"text": …, "attempted": false}`,
   then `ctx.app.openSession(id)`. The session page sends the stored text as the
   learner's first message.
2. A tool registered with `ctx.registerTools({agents: ['prober', 'teacher'], …})`
   is offered in that session, and an instruction registered with
   `ctx.registerInstructions` makes the prober call it first.
3. The `chatId` the tool factory receives is the id of the session the frontend
   created, so the plugin can tell which passage a lesson is about.

Neither `POST /api/chats` nor the `lh.openingPrompt.<id>` key is part of the
plugin interface. They were read from the host's source (`components/start-session.ts`,
`components/opening-prompt.ts`) at LearnHarness 0.8.3.

## Running it

Use a scratch data directory, never your real one.

1. Copy `plugin/dist` to `<scratch data dir>/plugins/speak-english-handoff-spike/dist`.
2. Start LearnHarness on that data directory, open `/` once, enable the plugin,
   restart, and set a lesson model.
3. `node drive-browser.mjs <learnharness repo with puppeteer-core> <base url> <scratch data dir> <screenshot.png>`

The driver presses the spike's button, then reports whether the lesson opened,
whether its first message went out, and whether an agent ran the spike's tool.
It prints one line per saved message; the list should start with the opening
prompt followed by the prober's call of the tool.

## Result (2026-11-14)

All three held with `deepseek-v4-pro` as the lesson model. One thing the stub
taught: with a guide that only said "teach this passage", the prober started
explaining instead of probing. The real guide therefore says what to do while
probing and what to do while teaching, in one text that both agents read.
