'use strict';

const { extractJson, cleanText, badReply } = require('./model-reply.cjs');

const MAX_DIFFICULTIES = 3;
const CHINESE_MAX_CHARS = 300;
const ENGLISH_MAX_CHARS = 400;
const EXPLANATION_MAX_CHARS = 600;
// A split is offered only for sentences longer than this many words.
const SPLIT_MIN_WORDS = 13;

const wordCount = english => english.trim().split(/\s+/).length;

function parseSimpler(simpler) {
  const en = cleanText(simpler?.en);
  if (en === '' || en.length > ENGLISH_MAX_CHARS) throw badReply();
  return { en, why: cleanText(simpler.why).slice(0, EXPLANATION_MAX_CHARS) };
}

/** Two sentences with their Chinese, or null: an unusable split is dropped, it does not spoil the rest of the reply. */
function parseSplit(split) {
  if (!Array.isArray(split) || split.length !== 2) return null;
  const parts = split.map(part => ({ zh: cleanText(part?.zh), en: cleanText(part?.en) }));
  const usable = parts.every(part => part.zh !== '' && part.en !== '' && part.zh.length <= CHINESE_MAX_CHARS && part.en.length <= ENGLISH_MAX_CHARS);
  return usable ? parts : null;
}

/**
 * Reads the model's explanation of one sentence into
 * { difficulty: [text], simpler: { en, why }, split: [{ zh, en }, { zh, en }] | null }.
 * The split is kept only when the original sentence has more than 12 words.
 * Throws an Error with a message for the user when the reply is unusable.
 */
function parseExplanation(replyText, originalEnglish) {
  const reply = extractJson(String(replyText ?? ''));
  const difficulty = (Array.isArray(reply.difficulty) ? reply.difficulty : [])
    .map(item => cleanText(item).slice(0, EXPLANATION_MAX_CHARS)).filter(Boolean).slice(0, MAX_DIFFICULTIES);
  if (difficulty.length === 0) throw badReply();
  const split = wordCount(originalEnglish) >= SPLIT_MIN_WORDS ? parseSplit(reply.split) : null;
  return { difficulty, simpler: parseSimpler(reply.simpler), split };
}

module.exports = { parseExplanation };
