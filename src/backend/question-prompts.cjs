'use strict';

// The wording was shown to the user on 2026-11-14 (docs/plan.md, section 14). Change it only with their say-so.
const QUESTION_SYSTEM_PROMPT = `The learner has memorized a short English passage that says something they want to say in real life. Write 3 different questions that another person might naturally ask, to which this passage would be a natural spoken answer. For the formal register the asker is a colleague in a meeting; for the casual register, a friend in small talk.

Rules:
- Each question is one short spoken sentence, at most 12 words, in everyday English.
- The three differ in wording and angle, so the learner does not get used to one cue.
- Do not give away the answer: avoid reusing the passage's key expressions.
- Add a Chinese translation of each question.
- Reply with JSON only: {"questions":[{"en":"…","zh":"…"}]}`;

/** The user message: the register, the passage as the learner says it, and what they meant in Chinese. */
function questionUserPrompt({ register, english, chinese }) {
  return `Register: ${register}\n\nPassage (English):\n${english}\n\nPassage (Chinese):\n${chinese}`;
}

module.exports = { QUESTION_SYSTEM_PROMPT, questionUserPrompt };
