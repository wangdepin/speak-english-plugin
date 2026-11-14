'use strict';

const { explainSystemPrompt, explainUserPrompt } = require('./explain-prompts.cjs');
const { parseExplanation } = require('./explain-parse.cjs');
const { resolveModel } = require('./translate.cjs');
const { replyText, keyWithin } = require('./model-reply.cjs');
const { requireSentence, requirePassage } = require('./records.cjs');
const { replyKeys } = require('./languages.cjs');
const { forgetDiagnosisOf } = require('./study.cjs');
const { t } = require('./messages.cjs');

// Generous on purpose: some models count their reasoning as output, and a cut-off reply is unusable.
const REPLY_MAX_TOKENS = 4000;
const MOST_FREQUENT = 5;
const ADOPTIONS = Object.freeze(['simpler', 'split']);

/** The `limit` most frequent items of a Map from key to { count, ... }, most frequent first. */
const mostFrequent = (tally, limit) => [...tally.values()].sort((a, b) => b.count - a.count).slice(0, limit);

function countInto(tally, key, item) {
  const entry = tally.get(key) ?? { ...item, count: 0 };
  entry.count += 1;
  tally.set(key, entry);
}

/**
 * What the practice log says about one sentence: how often it was tried from
 * memory and with what result, and which words and sounds went wrong most often
 * in any kind of practice.
 */
function practiceHistory(state, sentenceId) {
  const attempts = state.attempts.filter(attempt => attempt.sentenceId === sentenceId);
  const judged = attempts.filter(attempt => attempt.said !== null);
  const wrongWords = new Map();
  const weakSounds = new Map();
  for (const problem of attempts.flatMap(attempt => attempt.problems ?? [])) {
    if (problem.errorType !== 'None') countInto(wrongWords, problem.word, { word: problem.word });
    for (const phoneme of problem.weakPhonemes) countInto(weakSounds, `${problem.word}/${phoneme.expected}`, { word: problem.word, expected: phoneme.expected, soundsLike: phoneme.soundsLike });
  }
  return {
    attempts: judged.length,
    said: judged.filter(attempt => attempt.said).length,
    missed: judged.filter(attempt => !attempt.said).length,
    timedOut: judged.filter(attempt => attempt.timedOut).length,
    wrongWords: mostFrequent(wrongWords, MOST_FREQUENT),
    weakSounds: mostFrequent(weakSounds, MOST_FREQUENT),
  };
}

/** Asks the model why a sentence is hard to say and what to say instead. Resolves to the parsed explanation. */
async function requestExplanation({ inference, state, sentenceId, signal }) {
  const sentence = requireSentence(state, sentenceId);
  const { nativeLanguage, targetLanguage } = requirePassage(state, sentence.passageId);
  const model = await resolveModel(inference, state.settings);
  const message = await inference.complete({
    model,
    purpose: 'user',
    context: { systemPrompt: explainSystemPrompt(nativeLanguage, targetLanguage), messages: [{ role: 'user', content: explainUserPrompt(sentence, practiceHistory(state, sentenceId), nativeLanguage, targetLanguage), timestamp: Date.now() }] },
    options: { maxTokens: REPLY_MAX_TOKENS },
    signal,
  });
  return parseExplanation(replyText(message, t('讲解')), sentence.target, { targetLanguage, keys: replyKeys(nativeLanguage, targetLanguage) });
}

/** Keeps the explanation with its sentence, and starts counting misses afresh. */
function storeExplanation(state, sentenceId, explanation, now) {
  const sentence = requireSentence(state, sentenceId);
  sentence.explanation = { ...explanation, at: now };
  sentence.explainCheckedAt = now;
}

/** The learner could say the sentence without a time limit: only speed is missing, so no explanation; misses count afresh. */
function recordSpeedGap(state, sentenceId, now) {
  requireSentence(state, sentenceId).explainCheckedAt = now;
}

/**
 * Replaces a sentence by what its explanation proposed: the simpler wording, or
 * the two-sentence split. The new sentences take the old one's place in the
 * passage and start from scratch: no audio, no schedule, no practice log.
 * Returns { removedSentenceId, sentenceIds }.
 */
function adoptExplanation(state, sentenceId, choice, { newId }) {
  const sentence = requireSentence(state, sentenceId);
  if (!ADOPTIONS.includes(choice)) throw new Error(t('只能采用替代说法或拆分方案。'));
  if (!sentence.explanation) throw new Error(t('这一句还没有讲解。'));
  const parts = choice === 'simpler' ? [{ native: sentence.native, target: sentence.explanation.simpler.target }] : sentence.explanation.split;
  if (!parts) throw new Error(t('这一句的讲解里没有拆分方案。'));
  const passage = requirePassage(state, sentence.passageId);
  const replacements = parts.map(part => ({
    id: newId(), passageId: passage.id, native: part.native, target: part.target, keyExpression: keyWithin(part.target, sentence.keyExpression),
    audio: null, schedule: null, explanation: null, explainCheckedAt: null,
  }));
  for (const replacement of replacements) state.sentences[replacement.id] = replacement;
  passage.sentenceIds.splice(passage.sentenceIds.indexOf(sentenceId), 1, ...replacements.map(replacement => replacement.id));
  delete state.sentences[sentenceId];
  state.attempts = state.attempts.filter(attempt => attempt.sentenceId !== sentenceId);
  forgetDiagnosisOf(passage, sentenceId);
  return { removedSentenceId: sentenceId, sentenceIds: replacements.map(replacement => replacement.id) };
}

module.exports = { practiceHistory, requestExplanation, storeExplanation, recordSpeedGap, adoptExplanation };
