'use strict';

const { requireSentence } = require('./records.cjs');
const { requireQuestion } = require('./questions.cjs');
const { requireAttemptId, durationOrNull } = require('./attempts.cjs');
const { t } = require('./messages.cjs');

// What a sentence that was not understood lacks: its real sound, or the expression itself.
const LISTEN_GAPS = Object.freeze(['sound', 'pairing']);
const LISTEN_RATES = Object.freeze([1, 1.2]);

/** Finds the log entry with this id, or adds `fresh`. An id can only be reused for the same exercise on the same target. */
function upsert(state, fresh) {
  const existing = state.attempts.find(attempt => attempt.id === fresh.id);
  if (!existing) { state.attempts.push(fresh); return fresh; }
  const sameTarget = existing.kind === fresh.kind && existing.sentenceId === fresh.sentenceId && existing.questionId === fresh.questionId;
  if (!sameTarget) throw new Error(t('这个练习记录编号已经用在别处了。'));
  return existing;
}

/**
 * Logs one "listen once" result: whether the sentence was understood on a single
 * hearing and, when it was not, what was missing. Sent again with the same id
 * to add the gap, or to correct "understood" after seeing the text.
 * These exercises are never scheduled.
 */
function recordListen(state, { attemptId, sentenceId, understood, gap = null, rate = 1, now }) {
  requireAttemptId(attemptId);
  requireSentence(state, sentenceId);
  if (typeof understood !== 'boolean') throw new Error(t('请选择听懂了还是没听懂。'));
  if (gap !== null && !LISTEN_GAPS.includes(gap)) throw new Error(t('不认识的分类。'));
  if (understood && gap !== null) throw new Error(t('听懂了的句子不需要分类。'));
  if (!LISTEN_RATES.includes(rate)) throw new Error(t('播放速度不对。'));
  const entry = upsert(state, { id: attemptId, sentenceId, kind: 'listen', at: now, understood, gap, rate });
  Object.assign(entry, { understood, gap, rate });
}

/**
 * Logs one "respond" result: the learner heard a question and answered, or did
 * not, with the passage they have memorized. `timedOut` marks not having started in time.
 */
function recordResponse(state, { attemptId, passageId, questionId, answered, timedOut = false, responseMs, speakMs, now }) {
  requireAttemptId(attemptId);
  requireQuestion(state, passageId, questionId);
  if (typeof answered !== 'boolean') throw new Error(t('请选择接上了还是没接上。'));
  if (typeof timedOut !== 'boolean' || (answered && timedOut)) throw new Error(t('超时标记不对。'));
  const entry = upsert(state, { id: attemptId, passageId, questionId, kind: 'respond', at: now, answered, timedOut, responseMs: null, speakMs: null });
  Object.assign(entry, { answered, timedOut, responseMs: durationOrNull(responseMs), speakMs: durationOrNull(speakMs) });
}

module.exports = { recordListen, recordResponse, LISTEN_GAPS, LISTEN_RATES };
