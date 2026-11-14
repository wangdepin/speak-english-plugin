# Phase 0 spike

Throwaway code that verified the four assumptions in `docs/plan.md` (results: `docs/phase0-results.md`).
Nothing here ships.

- `azure-rest.mjs` — Azure pronunciation assessment over plain REST from Node.
  `node azure-rest.mjs <env-file> <16k-mono.wav> "<reference text>" [out.json]`
- `plugin/dist/` — the spike plugin (`speak-english-spike`): records in the browser, converts to
  16 kHz WAV, sends it through `ctx.call`, and scores it with Azure from the backend.
  The backend reads `<plugin data dir>/spike-config.json` → `{"envFile": "<path to .env with SPEECH_KEY/SPEECH_REGION>"}`.
- `drive-browser.mjs` — opens the spike view in a throwaway Chrome profile whose microphone is `fake-mic-48k.wav`.
  `node drive-browser.mjs <learnharness repo> <base url> <fake-mic.wav>`

To rerun: copy `plugin/dist` to `<LH_DATA_DIR>/plugins/speak-english-spike/dist`, write the config file,
start the app with `LH_DATA_DIR=<dir> npx next dev -H localhost -p 3211`, enable the plugin with
`PUT /api/plugins/speak-english-spike {"enabled":true}`, then run the driver.
