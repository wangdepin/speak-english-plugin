'use strict';

const { extractJson, cleanText, badReply } = require('./model-reply.cjs');
const { LANGUAGES, textLength } = require('./languages.cjs');

const MAX_DIFFICULTIES = 3;
const SENTENCE_MAX_CHARS = 400;
const EXPLANATION_MAX_CHARS = 600;
// A split is offered only for sentences longer than this: in words, or in characters where words are not spaced.
const SPLIT_ABOVE = Object.freeze({ words: 12, characters: 24 });

const isLongEnoughToSplit = (sentence, targetLanguage) => textLength(sentence, targetLanguage) > (LANGUAGES[targetLanguage].spaced ? SPLIT_ABOVE.words : SPLIT_ABOVE.characters);

function parseSimpler(simpler, keys) {
  const target = cleanText(simpler?.[keys.target]);
  if (target === '' || target.length > SENTENCE_MAX_CHARS) throw badReply();
  return { target, why: cleanText(simpler.why).slice(0, EXPLANATION_MAX_CHARS) };
}

/** Two sentences with their meaning, or null: an unusable split is dropped, it does not spoil the rest of the reply. */
function parseSplit(split, keys) {
  if (!Array.isArray(split) || split.length !== 2) return null;
  const parts = split.map(part => ({ native: cleanText(part?.[keys.native]), target: cleanText(part?.[keys.target]) }));
  const usable = parts.every(part => part.native !== '' && part.target !== '' && part.native.length <= SENTENCE_MAX_CHARS && part.target.length <= SENTENCE_MAX_CHARS);
  return usable ? parts : null;
}

/**
 * Reads the model's explanation of one sentence into
 * { difficulty: [text], simpler: { target, why }, split: [{ native, target }, { native, target }] | null }.
 * The split is kept only when the original sentence is long: more than 12 words, or 24 characters
 * in a language written without spaces. `keys` names the reply's fields for the two languages.
 * Throws an Error with a message for the user when the reply is unusable.
 */
function parseExplanation(replyText, original, { targetLanguage, keys }) {
  const reply = extractJson(String(replyText ?? ''));
  const difficulty = (Array.isArray(reply.difficulty) ? reply.difficulty : [])
    .map(item => cleanText(item).slice(0, EXPLANATION_MAX_CHARS)).filter(Boolean).slice(0, MAX_DIFFICULTIES);
  if (difficulty.length === 0) throw badReply();
  const split = isLongEnoughToSplit(original, targetLanguage) ? parseSplit(reply.split, keys) : null;
  return { difficulty, simpler: parseSimpler(reply.simpler, keys), split };
}

module.exports = { parseExplanation };
