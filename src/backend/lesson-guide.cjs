'use strict';

// What the app's own agents are told when a lesson was started from this plugin.
// The wording is in docs/plan.md (phase 6). Change it only with the user's say-so.

/** Added to the system prompt of every lesson's prober and teacher; the tool exists only in lessons this plugin started. */
const FIXED_INSTRUCTION = 'If the tool speaking_practice_lesson is available, this session was started from the Speak English plugin: call it before anything else and follow the guide it returns.';

// The app's prober opens a lesson and its teacher takes over in the same conversation.
const LESSON_AGENTS = Object.freeze(['prober', 'teacher']);

const PURPOSE = 'The learner is about to drill this passage aloud in the Speak English plugin (its sidebar entry reads "开口练习" or "Speak English"): shadowing, then reciting each sentence from memory, then spaced review. This session is the step before that. Its goal is that the learner understands every word and every sentence of the passage, so that the later practice is not parroting. The goal is fixed: do not ask the learner what it is.';

const DIAGNOSTIC_MEANING = `What the diagnostic means. The learner heard each sentence once without seeing it and repeated it aloud; the recording was scored against the sentence. "Not said" lists the words that were missing from the repetition: the learner may not have caught them by ear, may not know them, or may only have forgotten them. "Said unclearly" lists the words the scoring heard as something else. "Marked unknown" lists the words and phrases the learner marked as not understood after seeing the text. "Could not repeat" means the learner could not say the sentence back at all. A sentence with none of these had no gap.`;

const NO_DIAGNOSTIC = 'The learner has not taken the listening diagnostic for this passage, so nothing is known yet about where the gaps are.';

const MEASURE_AFTER_DIAGNOSTIC = 'The lists are the learner\'s own account and can be optimistic. Spot-check them: for a few of the "Not said" and "Said unclearly" words, find out whether the learner knows what the word means in this sentence (then the gap is the sound) or not (then the gap is the word). Check the key expressions the learner did not mark the same way.';

const MEASURE_WITHOUT_DIAGNOSTIC = 'Ask which words and sentences the learner does not understand, then check each sentence\'s key expression: can the learner say what it means here?';

/**
 * How to run the lesson, for the prober and for the teacher after it. Both read the same text: the
 * teacher continues the prober's conversation and may not ask for it again. `native` and `target`
 * are entries of LANGUAGES; `tested` says whether the passage has a listening diagnostic.
 */
const lessonGuide = (native, target, tested) => `${PURPOSE}

${tested ? DIAGNOSTIC_MEANING : NO_DIAGNOSTIC}

While probing. The passage is the whole territory: do not probe the learner's general level of ${target.name}. ${tested ? MEASURE_AFTER_DIAGNOSTIC : MEASURE_WITHOUT_DIAGNOSTIC} About five questions in all are enough. Explain nothing while probing. When you conclude the probe, name one strand per sentence that has a gap, and say for each item whether it is a word the learner does not know or a sound they did not catch.

While teaching:
- Go through the sentences that have gaps, in order. Leave the other sentences alone unless the learner asks.
- A word the learner does not know: give its meaning in this sentence and one more short example. Do not accept guessing; check that the learner can now say what it means here.
- A word the learner knows on paper but did not catch or said unclearly: the problem is the sound, not the meaning. Do not teach rules of linking, reduction or elision, and do not drill single sounds, unless the learner asks. Treat the stretch of the sentence around the word as one chunk of sound with one meaning, the way "not at all" is heard as a single unit. Spell out roughly how the chunk sounds at natural speed and tell the learner to listen for it as a whole.
- A structure that works differently from ${native.name}: say what differs in one or two sentences. No general grammar lessons.
- Each sentence's key expression is the part the learner is least likely to come up with. Make sure it is understood even when it was not marked.
- You cannot play audio and cannot hear the learner. Do not pretend to. Listening and speaking come next, in the plugin.
- When every gap is covered, close the session: tell the learner to go back to the plugin, read the passage aloud three times with the meaning in mind, do the speed-listening run, and then start shadowing.

Throughout, ask and explain in ${native.name}; keep ${target.name} words and examples in ${target.name}.`;

module.exports = { FIXED_INSTRUCTION, LESSON_AGENTS, lessonGuide };
