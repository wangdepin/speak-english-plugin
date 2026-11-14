'use strict';

const { questionSystemPrompt, questionUserPrompt } = require('./question-prompts.cjs');
const { resolveModel } = require('./translate.cjs');
const { replyText, extractJson, cleanText, badReply } = require('./model-reply.cjs');
const { requirePassage } = require('./records.cjs');
const { replyKeys, joinSentences } = require('./languages.cjs');
const { t } = require('./messages.cjs');

const SUGGESTED_QUESTIONS = 3;
const MAX_QUESTIONS_PER_PASSAGE = 6;
const QUESTION_MAX_CHARS = 200;
const REPLY_MAX_TOKENS = 4000;

/** A question in the language practised, with its translation into the learner's own language. */
const cleanQuestion = (item, keys = { native: 'native', target: 'target' }) => ({ target: cleanText(item?.[keys.target]), native: cleanText(item?.[keys.native]) });
const isUsable = question => question.target !== '' && question.target.length <= QUESTION_MAX_CHARS && question.native.length <= QUESTION_MAX_CHARS;

/**
 * Reads the model's reply into at most three { target, native } questions. `keys` names the reply's
 * fields for the two languages. Unusable items are dropped; none left is an error.
 */
function parseQuestions(replyBody, keys) {
  const reply = extractJson(String(replyBody ?? ''));
  const questions = (Array.isArray(reply.questions) ? reply.questions : []).map(item => cleanQuestion(item, keys)).filter(isUsable).slice(0, SUGGESTED_QUESTIONS);
  if (questions.length === 0) throw badReply();
  return questions;
}

/** Asks the model which questions this passage would answer. Nothing is stored: the learner edits and confirms first. */
async function suggestQuestions({ inference, state, passageId, signal }) {
  const passage = requirePassage(state, passageId);
  const { nativeLanguage, targetLanguage } = passage;
  const text = joinSentences(passage.sentenceIds.map(id => state.sentences[id].target), targetLanguage);
  const model = await resolveModel(inference, state.settings);
  const message = await inference.complete({
    model,
    purpose: 'user',
    context: { systemPrompt: questionSystemPrompt(nativeLanguage, targetLanguage), messages: [{ role: 'user', content: questionUserPrompt({ register: passage.register, passage: text, source: passage.source, nativeLanguage, targetLanguage }), timestamp: Date.now() }] },
    options: { maxTokens: REPLY_MAX_TOKENS },
    signal,
  });
  return parseQuestions(replyText(message, t('生成问句')), replyKeys(nativeLanguage, targetLanguage));
}

const questionsOf = passage => passage.questions ?? [];

/** Returns the question with this id in the passage or throws a message for the user. */
function requireQuestion(state, passageId, questionId) {
  const question = questionsOf(requirePassage(state, passageId)).find(item => item.id === questionId);
  if (!question) throw new Error(t('找不到这个问句。'));
  return question;
}

/** Adds confirmed questions to a passage, without audio yet. Returns their ids. */
function addQuestions(state, passageId, questions, { newId }) {
  const passage = requirePassage(state, passageId);
  if (!Array.isArray(questions) || questions.length === 0) throw new Error(t('没有要保存的问句。'));
  const cleaned = questions.map(question => cleanQuestion(question));
  if (!cleaned.every(isUsable)) throw new Error(t('问句不能为空，也不能超过 {max} 个字符。', { max: QUESTION_MAX_CHARS }));
  if (questionsOf(passage).length + cleaned.length > MAX_QUESTIONS_PER_PASSAGE) throw new Error(t('一段最多 {max} 个问句，请先删掉几个。', { max: MAX_QUESTIONS_PER_PASSAGE }));
  const added = cleaned.map(question => ({ id: newId(), ...question, audio: null }));
  passage.questions = [...questionsOf(passage), ...added];
  return added.map(question => question.id);
}

/** Removes a question and the answers logged for it. */
function removeQuestion(state, passageId, questionId) {
  requireQuestion(state, passageId, questionId);
  const passage = state.passages[passageId];
  passage.questions = passage.questions.filter(question => question.id !== questionId);
  state.attempts = state.attempts.filter(attempt => attempt.questionId !== questionId);
}

/** Records that a question now has audio. */
function attachQuestionAudio(state, passageId, questionId, { seconds, modelId, voiceId, now }) {
  requireQuestion(state, passageId, questionId).audio = { seconds, modelId, voiceId, createdAt: now };
}

module.exports = { parseQuestions, suggestQuestions, requireQuestion, addQuestions, removeQuestion, attachQuestionAudio, questionsOf, MAX_QUESTIONS_PER_PASSAGE };
