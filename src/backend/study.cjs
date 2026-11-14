'use strict';

const { requirePassage } = require('./records.cjs');
const { t } = require('./messages.cjs');

// The optional first step with a new passage, before shadowing: a listening diagnostic in the plugin,
// a lesson with the app's teacher, then reading aloud and speed listening.
// A marked phrase can be as long as a sentence; a list can name every word of one.
const WORD_MAX_CHARS = 400;
const WORDS_MAX = 200;
const CHAT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const CONSOLIDATION_KINDS = Object.freeze({ read: 'readAloud', speed: 'speedRuns' });

/** A list of words or phrases the learner had trouble with: trimmed, without repeats. */
function checkWords(value) {
  if (!Array.isArray(value) || value.length > WORDS_MAX) throw new Error(t('摸底结果的格式不对。'));
  const words = value.map(word => (typeof word === 'string' ? word.replace(/\s+/g, ' ').trim() : ''));
  if (words.some(word => word === '' || word.length > WORD_MAX_CHARS)) throw new Error(t('摸底结果的格式不对。'));
  return [...new Set(words)];
}

/** Starts a diagnostic of a passage, discarding the previous one. */
function startDiagnosis(state, { passageId, now }) {
  requirePassage(state, passageId).diagnosis = { at: now, sentences: {} };
}

/**
 * Records what the diagnostic found in one sentence. `retold` is false when the learner could not
 * repeat the sentence at all; then nothing was scored and both scored lists are empty.
 * notSaid   words that were missing from the repetition
 * unclear   words the scoring flagged as said inaccurately
 * unknown   words or phrases the learner marked as not understood after seeing the text
 */
function recordDiagnosis(state, { passageId, sentenceId, retold, notSaid, unclear, unknown, now }) {
  const passage = requirePassage(state, passageId);
  if (!passage.diagnosis) throw new Error(t('还没有开始摸底。'));
  if (!passage.sentenceIds.includes(sentenceId)) throw new Error(t('找不到这一句。'));
  if (typeof retold !== 'boolean') throw new Error(t('摸底结果的格式不对。'));
  const scored = { notSaid: checkWords(notSaid), unclear: checkWords(unclear) };
  if (!retold && (scored.notSaid.length > 0 || scored.unclear.length > 0)) throw new Error(t('摸底结果的格式不对。'));
  passage.diagnosis.sentences[sentenceId] = { retold, ...scored, unknown: checkWords(unknown) };
  passage.diagnosis.at = now;
}

/** Forgets what the diagnostic found in a sentence that no longer exists. A diagnostic left with no sentence is dropped. */
function forgetDiagnosisOf(passage, sentenceId) {
  if (!passage.diagnosis || !Object.hasOwn(passage.diagnosis.sentences, sentenceId)) return;
  delete passage.diagnosis.sentences[sentenceId];
  if (Object.keys(passage.diagnosis.sentences).length === 0) passage.diagnosis = null;
}

/**
 * Records the lesson the plugin started for a passage. A later lesson replaces it.
 * A session belongs to one passage: another passage that pointed at it lets go.
 */
function recordLesson(state, { passageId, chatId, now }) {
  const passage = requirePassage(state, passageId);
  if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) throw new Error(t('课堂会话的编号无效。'));
  for (const other of Object.values(state.passages)) if (other.lesson?.chatId === chatId) other.lesson = null;
  passage.lesson = { chatId, startedAt: now };
}

/** The passage whose lesson is the session `chatId`, or null. */
function passageForChat(state, chatId) {
  if (typeof chatId !== 'string' || chatId === '') return null;
  return Object.values(state.passages).find(passage => passage.lesson?.chatId === chatId) ?? null;
}

/** Counts one finished read-aloud ('read') or one finished speed-listening run ('speed'). */
function recordConsolidation(state, { passageId, kind, now }) {
  const passage = requirePassage(state, passageId);
  const counter = Object.hasOwn(CONSOLIDATION_KINDS, kind) ? CONSOLIDATION_KINDS[kind] : null;
  if (!counter) throw new Error(t('不认识的练习类型。'));
  const current = passage.consolidation ?? { readAloud: 0, speedRuns: 0, at: now };
  passage.consolidation = { ...current, [counter]: current[counter] + 1, at: now };
}

/** The three study records of a passage as the frontend sees them: each is null until it exists. */
function studyView(passage) {
  return { diagnosis: passage.diagnosis ?? null, lesson: passage.lesson ?? null, consolidation: passage.consolidation ?? null };
}

module.exports = { startDiagnosis, recordDiagnosis, forgetDiagnosisOf, recordLesson, passageForChat, recordConsolidation, studyView };
