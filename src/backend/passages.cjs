'use strict';

const { REGISTERS } = require('./translate-prompts.cjs');
const { MAX_SENTENCES } = require('./translate-parse.cjs');
const { PASSAGE_MAX_CHARS } = require('./translate.cjs');
const { recallStatus, shadowAverage, missCounts } = require('./attempts.cjs');
const { reviewSummary } = require('./review.cjs');
const { requireSentence, requirePassage } = require('./records.cjs');
const { questionsOf } = require('./questions.cjs');
const { requirePair } = require('./languages.cjs');
const { studyView } = require('./study.cjs');
const { t } = require('./messages.cjs');

const VERSION_IDS = Object.freeze({ formal: ['sentences'], casual: ['brief', 'elaborate'] });
// A sentence in either language. The one practised is also the reference text for scoring, which caps it at 1000 characters.
const SENTENCE_MAX_CHARS = 400;

const cleanText = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

function checkSentence(item, index) {
  const label = t('第 {position} 句', { position: index + 1 });
  const native = cleanText(item?.native);
  const target = cleanText(item?.target);
  const keyExpression = cleanText(item?.keyExpression);
  if (native === '' || target === '') throw new Error(t('{label}两种语言的内容都不能为空。', { label }));
  if (native.length > SENTENCE_MAX_CHARS || target.length > SENTENCE_MAX_CHARS) throw new Error(t('{label}太长了，请拆成两句。', { label }));
  if (keyExpression !== '' && !target.toLowerCase().includes(keyExpression.toLowerCase())) throw new Error(t('{label}的关键说法「{keyExpression}」不在要练的句子里。', { label, keyExpression }));
  return { native, target, keyExpression };
}

/** Checks a passage the user confirmed in the intake screen and returns a clean copy. Throws with a message for the user. */
function checkConfirmedPassage(input) {
  const register = input?.register;
  if (!REGISTERS.includes(register)) throw new Error(t('场景只能是正式或口语。'));
  if (!VERSION_IDS[register].includes(input.version)) throw new Error(t('版本和场景对不上。'));
  const { nativeLanguage, targetLanguage } = requirePair(input.nativeLanguage, input.targetLanguage);
  const source = typeof input.source === 'string' ? input.source.trim() : '';
  if (source === '' || source.length > PASSAGE_MAX_CHARS) throw new Error(t('原文为空或太长。'));
  if (!Array.isArray(input.sentences) || input.sentences.length === 0 || input.sentences.length > MAX_SENTENCES) throw new Error(t('一段要有 1 到 {max} 句。', { max: MAX_SENTENCES }));
  return { register, version: input.version, nativeLanguage, targetLanguage, source, sentences: input.sentences.map(checkSentence) };
}

/**
 * Adds a confirmed passage and its sentences to `state`. The passage keeps the two languages it was
 * translated between, whatever the settings say later. Sentences start with no
 * reference audio and no schedule: audio is synthesized next, a schedule is
 * created when the sentence is first said from memory.
 */
function addPassage(state, confirmed, { now, newId }) {
  const passage = { id: newId(), createdAt: now, register: confirmed.register, version: confirmed.version, nativeLanguage: confirmed.nativeLanguage, targetLanguage: confirmed.targetLanguage, source: confirmed.source, sentenceIds: [], questions: [], firstReading: null, latestReading: null, diagnosis: null, lesson: null, consolidation: null };
  for (const sentence of confirmed.sentences) {
    const id = newId();
    state.sentences[id] = { id, passageId: passage.id, ...sentence, audio: null, schedule: null, explanation: null, explainCheckedAt: null };
    passage.sentenceIds.push(id);
  }
  state.passages[passage.id] = passage;
  return passage.id;
}

/** Removes a passage with its sentences, questions and log entries. Returns the ids of the sentences and questions, so their audio can be deleted. */
function removePassage(state, passageId) {
  const passage = requirePassage(state, passageId);
  const removed = new Set(passage.sentenceIds);
  for (const id of removed) delete state.sentences[id];
  state.attempts = state.attempts.filter(attempt => !removed.has(attempt.sentenceId) && attempt.passageId !== passageId);
  delete state.passages[passageId];
  return [...removed, ...questionsOf(passage).map(question => question.id)];
}

/** Records that reference audio now exists for a sentence. */
function attachAudio(state, sentenceId, { seconds, modelId, voiceId, now }) {
  requireSentence(state, sentenceId).audio = { seconds, modelId, voiceId, createdAt: now };
}

/**
 * Records a whole-passage reading and returns the slot its audio belongs in.
 * Only two are kept per passage: the first ever, and the most recent one after it.
 */
function addReading(state, passageId, { seconds, mime, now }) {
  const passage = requirePassage(state, passageId);
  const slot = passage.firstReading ? 'latest' : 'first';
  passage[slot === 'first' ? 'firstReading' : 'latestReading'] = { seconds, mime, recordedAt: now };
  return slot;
}

/**
 * What the frontend sees: settings, which keys are set, the recent shadowing average, today's review queue,
 * and passages newest first with their sentences and questions inline. Each sentence carries `recall` ('pending',
 * 'tomorrow' or 'scheduled') and `misses`, the times it was not said since its last explanation check.
 */
function clientView(state, secretStatus, now) {
  const misses = missCounts(state);
  const forClient = id => {
    const sentence = state.sentences[id];
    return { ...sentence, explanation: sentence.explanation ?? null, recall: recallStatus(state, sentence, now), misses: misses.get(id) ?? 0 };
  };
  const passages = Object.values(state.passages)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(passage => ({ ...passage, ...studyView(passage), questions: questionsOf(passage), sentences: passage.sentenceIds.map(forClient) }));
  return { revision: state.revision, settings: state.settings, secrets: secretStatus, shadowAverage: shadowAverage(state), review: reviewSummary(state, now), passages };
}

module.exports = { checkConfirmedPassage, addPassage, removePassage, attachAudio, addReading, clientView };
