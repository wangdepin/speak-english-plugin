# Speak English — LearnHarness plugin

[中文说明](./README.zh-CN.md)

Turn what you want to say, written in Chinese, into English you can say out loud
without thinking. Paste a short Chinese passage; the plugin translates it,
synthesizes reference audio, and takes you through listening, shadowing, reading
along and recall. Sentences you can say enter spaced review, where each card
shows only the Chinese meaning and you have a few seconds to start speaking.

This is a LearnHarness Community plugin (`apiVersion: 1`, id `speak-english`,
`minAppVersion 0.7.0`). The interface is available in Chinese and English.

## The method

The plugin follows the routine in Li Xiaolai's *1000 Hours* (李笑来《1000 小时》):
write what you want to say in your own language, have it turned into English and
into speech, shadow it, recite it, review it. It changes two things in that
routine and adds a time limit:

1. **Your own sentences.** Nothing comes from a textbook. You practise what you
   actually need to say in a group meeting or in small talk, in the register you
   choose (formal or casual).
2. **The cue is the meaning, not the previous sentence.** Reciting a passage
   trains "sentence 3 follows sentence 2". A card here shows the Chinese
   meaning and asks for the English, which is the cue you have in a real
   conversation. Only this direction is scheduled.
3. **Each sentence is scheduled by how well you remember it.** Review uses
   FSRS-6 with a 95% target retention and a daily cap, instead of "review the
   week on Sunday".
4. **Speaking has a deadline.** A connection that exists but is slow does not
   help in conversation. A review card gives you time to read the cue plus a few
   seconds to think; not starting in time counts as a miss. A missed card comes
   back after 10 minutes.
5. **You judge, the scores inform.** Two buttons: *Said it* or *Missed it*.
   Pronunciation scoring runs in the background and marks each word, but never
   decides the schedule.
6. **A sentence you keep missing gets sorted before it gets explained.** First
   you try once more with no time limit. If you can say it, only speed is
   missing and nothing is explained. If not, the model explains where the
   sentence is hard and proposes a simpler wording or a split into two
   sentences, which you can adopt in its place.

[`docs/plan.md`](./docs/plan.md) (in Chinese) holds the full design, the
reasoning behind each rule and the decision log.

## What you need

| For | Service | Where it is set |
| --- | --- | --- |
| Translation, explanations, questions | A model configured in LearnHarness (the cheap slot by default) | LearnHarness settings, or this plugin's settings |
| Reference audio | An ElevenLabs API key | This plugin's settings |
| Pronunciation scoring | An Azure Speech key and region | This plugin's settings |

All three are your own accounts and may cost money. The plugin sends them only
what each needs: the Chinese passage and, for explanations, the sentence with
your practice counts go to the model; English sentences go to ElevenLabs; a
recording of one sentence (30 seconds at most) and its reference text go to
Azure.

Everything else stays on your computer, in the plugin's data directory: your
passages and practice log, the reference audio, the first and the latest
read-along recording of each passage, and the two keys (`secrets.json`, readable
only by you, never shown again after saving). Recordings made while shadowing,
recalling and reviewing are scored and then discarded.

## Installation

### Download a release (no build tools needed)

Requirements: LearnHarness 0.7.0 or later.

1. Download `speak-english-<version>.zip` from the
   [latest release](https://github.com/wangdepin/speak-english-plugin/releases/latest).
2. Open **Settings → Community plugins** in LearnHarness to find your plugins
   directory.
3. Unzip the archive into that directory. It contains `speak-english/dist/`, so
   you end up with `<plugins-directory>/speak-english/dist/manifest.json`.
4. Refresh Community plugins and enable **英语开口练习**, then open the plugin's
   settings and enter the two keys and the Azure region. The
   **Test the microphone and scoring** button on the same page checks the
   microphone, the key and the region in one go.

To update, delete `speak-english/dist/` and unzip the new release in its place.
Never delete `speak-english/data/`: it holds your passages, practice log, keys
and audio. Restart LearnHarness to load the new version.

### Build from source

Requirements: LearnHarness 0.7.0 or later, a recent Node.js and npm.

```sh
git clone https://github.com/wangdepin/speak-english-plugin.git
cd speak-english-plugin
npm ci
npm run install:local -- "<data-directory>"
```

`<data-directory>` is the app's data directory; on macOS the desktop app uses
`~/Library/Application Support/MasteryHarness/data`. The command builds first,
then installs to `<data-directory>/plugins/speak-english/dist/`:

```text
speak-english/
  dist/
    manifest.json
    main.js           # browser ES module
    backend.cjs       # Node CommonJS
    styles.css
    LICENSE
    FSRS-LICENSE.txt
  data/               # your passages, keys and audio; never distributed
```

Then enable the plugin and enter the keys as in step 4 above.

To update, run `npm run install:local` again and restart LearnHarness. The
installer replaces only `dist/` and never touches the sibling `data/` directory.

`npm run package` builds the release archive and its SHA-256 checksum into
`release/`.

## Workflow

The plugin adds a **Speak English** entry to the sidebar (**开口练习** when the
interface is Chinese). It is independent of
teaching sessions: it does not read your courses, and nothing in a session calls
it.

1. **Enter a passage.** Write 100 to 150 Chinese characters, choose formal or
   casual, and translate. You check the English once, sentence by sentence, and
   can edit the Chinese meaning, the English and the key expression of each
   sentence. On saving, the reference audio is synthesized.
2. **Listen.** The whole passage or one sentence, at normal speed or slowed
   down.
3. **Shadow.** Hear a sentence, record it, and see each word marked right,
   mispronounced, left out or extra, with what a weak sound resembled.
4. **Read along.** Record the whole passage with the reference in your
   headphones. The first and the latest recording are kept so you can hear the
   difference later.
5. **Recall.** See the Chinese meaning and say the English. Sentences you said
   enter review the next day; the others come back to recall tomorrow.
6. **Review.** Every day, the due cards: read the cue, start speaking before the
   countdown ends, compare with the answer and your own recording, and judge
   yourself.

Two optional exercises are not scheduled:

- **Listen once.** Sentences are played a single time with no text, optionally
  at 1.2×. For one you did not understand, the plugin asks whether the text is
  clear at a glance (the sound is what is missing) or not (the pairing is).
- **Respond.** A question about a passage you have memorized is asked once, in
  another voice. You answer aloud with what you memorized. Questions are
  suggested by the model and saved only after you confirm them.

## Keyboard shortcuts

Every practice screen uses the same keys and lists the ones that work right now
on a line at the bottom.

| Key | Action |
| --- | --- |
| Space | Start / stop recording |
| `↓`, `→` or Enter | Next, continue, start |
| `↑` or `←` | Previous sentence (shadowing) |
| `R` | Play the reference; again to stop |
| `M` | Play my recording |
| `S` | Play slowly (listen once) |
| `1` | The negative verdict: missed it, didn't understand |
| `2` | The positive verdict: said it, understood, answered |
| `A` | Can't recall, show the answer |
| `E` | Explanation |

Deleting, adopting a new wording and going back have no keys on purpose. Keys
are ignored while you type in a field or a dialog is open.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Interface language | 中文 | Chinese or English. Explanations from the model stay in Chinese |
| Speech model, voice | `eleven_v4`, Jessica | ElevenLabs model and voice for reference audio |
| Voice for questions | Eric | The voice that asks in the Respond exercise |
| Daily review limit | 50 | Reviews per day, retries included |
| Target retention | 95% | FSRS target; higher means shorter intervals |
| Reading speed, thinking time | 5 characters/s, 3 s | Start limit = characters ÷ reading speed + thinking time |
| Speaking limit | 2× | Time to say a sentence, as a multiple of the reference audio |
| Misses before an explanation is suggested | 3 | Counted since the last explanation |
| Model | Follows the cheap slot | Model for translation, explanations and questions |

## Project layout

| Path | What |
| --- | --- |
| `src/backend/backend.cjs` | Operations the frontend calls; activation |
| `src/backend/store.cjs`, `secrets.cjs`, `audio-files.cjs` | Atomic JSON store, keys, audio files under `ctx.dataDirectory` |
| `src/backend/translate*.cjs`, `explain*.cjs`, `question*.cjs` | Model prompts, requests and reply parsing |
| `src/backend/review.cjs`, `attempts.cjs`, `scheduler.cjs` | Due queue, practice log, FSRS-6 |
| `src/backend/speech/` | ElevenLabs synthesis and Azure pronunciation assessment over REST |
| `src/frontend/*-screen.js` | One file per screen of the practice view, and the settings page |
| `src/frontend/shortcuts.js`, `shortcut-keys.js` | Keyboard shortcuts and the hint line |
| `src/frontend/i18n.js`, `en.js`, `src/backend/messages*.cjs` | Interface text in two languages |
| `scripts/` | Build, install, release packaging, fixture capture, live checks, UI walkthroughs |
| `tests/` | Node test runner with recorded service replies; no network |
| `docs/` | Design, phase 0 results (Chinese) |
| `evaluation/`, `spikes/` | Early voice comparison and phase 0 code; not part of the plugin |

## Development

```sh
npm test            # offline suite
npm run check       # syntax check of every source file
npm run build       # bundles dist/
```

The runtime has no dependencies; esbuild is the only development dependency.
The tests replay replies recorded from the real services, so they need no keys
and no network.

Interface text is written in Chinese inside `t('…')`; the English goes into
`src/frontend/en.js` or `src/backend/messages-en.cjs` under that Chinese text as
its key. Module-level constants use `mark('…')` and are translated where they
are shown. `npm test` fails when an English text is missing, its placeholders
differ, or Chinese text bypasses translation.

The scripts below talk to the real services and cost a little credit. The UI
walkthroughs drive a throwaway LearnHarness instance in headless Chrome with a
WAV file as the microphone; three of them delete every passage in that instance,
so point them at a scratch data directory only.

```sh
node scripts/live-check.mjs <.env with SPEECH_KEY/SPEECH_REGION> <auth.json with ELEVENLABS_API_KEY>
node scripts/ui-walkthrough.mjs <learnharness repo> <base url> <fake-mic.wav> <screenshot dir>
node scripts/ui-walkthrough-practice.mjs  <repo> <base url> <fake-mic.wav> <dir> <.env> <auth.json>
node scripts/ui-walkthrough-review.mjs    <repo> <base url> <fake-mic.wav> <dir> <.env> <auth.json> <scratch data dir>
node scripts/ui-walkthrough-exercises.mjs <repo> <base url> <fake-mic.wav> <dir> <.env> <auth.json> <scratch data dir>
node scripts/ui-walkthrough-keys.mjs      <repo> <base url> <fake-mic.wav> <dir> <.env> <auth.json> <scratch data dir>
```

## Not done yet

- Scoring of the whole-passage read-along (it is only archived).
- Handing explanations to the teacher of a LearnHarness session.

## License

[AGPL-3.0-only](./LICENSE), the same license as LearnHarness, from whose
Flashcards plugin the scheduler and the storage pattern are taken. Portions of
`src/backend/scheduler.cjs` are adapted from ts-fsrs under the MIT license; see
[`FSRS-LICENSE.txt`](./FSRS-LICENSE.txt). The two translation prompts are based
on the GPT instructions published in 李笑来《1000 小时》.
