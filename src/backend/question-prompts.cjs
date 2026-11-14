'use strict';

const { LANGUAGES, isOriginalPair, withArticle } = require('./languages.cjs');

// For Chinese speakers practising American English. The wording was shown to the user on 2026-11-14
// (docs/plan.md, section 14). Change it only with their say-so.
const ORIGINAL_SYSTEM_PROMPT = `The learner has memorized a short English passage that says something they want to say in real life. Write 3 different questions that another person might naturally ask, to which this passage would be a natural spoken answer. For the formal register the asker is a colleague in a meeting; for the casual register, a friend in small talk.

Rules:
- Each question is one short spoken sentence, at most 12 words, in everyday English.
- The three differ in wording and angle, so the learner does not get used to one cue.
- Do not give away the answer: avoid reusing the passage's key expressions.
- Add a Chinese translation of each question.
- Reply with JSON only: {"questions":[{"en":"…","zh":"…"}]}`;

const questionLimit = target => (target.spaced ? '12 words' : '24 characters');

// The same instructions for every other pair, with the two languages filled in.
const generalSystemPrompt = (native, target) => `The learner has memorized a short ${target.name} passage that says something they want to say in real life. Write 3 different questions that another person might naturally ask, to which this passage would be a natural spoken answer. For the formal register the asker is a colleague in a meeting; for the casual register, a friend in small talk.

Rules:
- Each question is one short spoken sentence, at most ${questionLimit(target)}, in everyday ${target.full}.
- The three differ in wording and angle, so the learner does not get used to one cue.
- Do not give away the answer: avoid reusing the passage's key expressions.
- Add ${withArticle(native.name)} translation of each question.
- Reply with JSON only: {"questions":[{"target":"…","native":"…"}]}`;

/** The system prompt for suggesting questions about a passage of one language pair. */
function questionSystemPrompt(nativeLanguage, targetLanguage) {
  if (isOriginalPair(nativeLanguage, targetLanguage)) return ORIGINAL_SYSTEM_PROMPT;
  return generalSystemPrompt(LANGUAGES[nativeLanguage], LANGUAGES[targetLanguage]);
}

/** The user message: the register, the passage as the learner says it, and what they meant in their own language. */
function questionUserPrompt({ register, passage, source, nativeLanguage, targetLanguage }) {
  return `Register: ${register}\n\nPassage (${LANGUAGES[targetLanguage].name}):\n${passage}\n\nPassage (${LANGUAGES[nativeLanguage].name}):\n${source}`;
}

module.exports = { questionSystemPrompt, questionUserPrompt };
