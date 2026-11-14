'use strict';

const scheduler = require('./scheduler.cjs');
const { requireSentence } = require('./records.cjs');
const { t } = require('./messages.cjs');

// "shadow" is repeating after the reference audio; "recall" is saying the sentence from its cue in the learner's own language on the day
// it is learned; "review" is the same thing later, under a time limit, when the schedule says it is due.
const ATTEMPT_KINDS = Object.freeze(['shadow', 'recall', 'review']);
const SHADOW_AVERAGE_WINDOW = 10;
// A study day starts at 4 a.m., as in the Flashcards plugin.
const DAY_START_HOUR = 4;
const GOOD = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_DURATION_MS = 10 * 60 * 1000;

/** FSRS options for this plugin: no same-day learning steps, one 10-minute step after a failed review. */
const schedulerOptions = settings => ({ retention: settings.retention, learningSteps: [], relearningSteps: [10], dayStart: DAY_START_HOUR });

const studyDayOf = timestamp => scheduler.studyDay(timestamp, DAY_START_HOUR);

function durationOrNull(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > MAX_DURATION_MS) throw new Error(t('用时不对。'));
  return Math.round(value);
}

/** Log entries are created under an id the client picks, so that parts arriving separately land on the same entry. */
function requireAttemptId(attemptId) {
  if (typeof attemptId !== 'string' || !UUID.test(attemptId)) throw new Error(t('练习记录编号无效。'));
}

/** The words worth remembering from one assessment: anything flagged, or containing a weak phoneme. */
function problemWords(assessment) {
  return assessment.words
    .map(word => ({ word: word.word, errorType: word.errorType, accuracy: word.accuracy, weakPhonemes: word.phonemes.filter(phoneme => phoneme.weak).map(({ expected, accuracy, soundsLike }) => ({ expected, accuracy, soundsLike })) }))
    .filter(word => word.errorType !== 'None' || word.weakPhonemes.length > 0);
}

/**
 * Finds or creates the attempt with this id. Scores and the learner's own
 * judgment arrive separately and in either order, so both go through here.
 */
function attemptFor(state, { attemptId, sentenceId, kind, now }) {
  requireAttemptId(attemptId);
  if (!ATTEMPT_KINDS.includes(kind)) throw new Error(t('不认识的练习类型。'));
  requireSentence(state, sentenceId);
  const existing = state.attempts.find(attempt => attempt.id === attemptId);
  if (existing) {
    if (existing.sentenceId !== sentenceId || existing.kind !== kind) throw new Error(t('这个练习记录编号已经用在别处了。'));
    return existing;
  }
  const attempt = { id: attemptId, sentenceId, kind, at: now, said: null, timedOut: false, responseMs: null, speakMs: null, scores: null, problems: [] };
  state.attempts.push(attempt);
  return attempt;
}

/** Stores the pronunciation scores of an attempt. Scores never affect scheduling. */
function recordScores(state, { attemptId, sentenceId, kind, assessment, now }) {
  const attempt = attemptFor(state, { attemptId, sentenceId, kind, now });
  attempt.scores = assessment.scores;
  attempt.problems = problemWords(assessment);
}

/** Whether a sentence still waits for its first successful recall: 'scheduled', 'pending', or 'tomorrow' after a miss today. */
function recallStatus(state, sentence, now) {
  if (sentence.schedule) return 'scheduled';
  const today = studyDayOf(now);
  const missedToday = state.attempts.some(attempt => attempt.sentenceId === sentence.id && attempt.kind === 'recall' && attempt.said === false && studyDayOf(attempt.at) === today);
  return missedToday ? 'tomorrow' : 'pending';
}

/**
 * Records the learner's own verdict on a recall attempt. The first time a
 * sentence is said, it gets its schedule and is due on the next study day.
 * A miss schedules nothing: the sentence comes back for recall tomorrow.
 */
function judgeRecall(state, { attemptId, sentenceId, said, responseMs, speakMs, now }) {
  if (typeof said !== 'boolean') throw new Error(t('请选择说出来了还是没说出来。'));
  const sentence = requireSentence(state, sentenceId);
  const status = recallStatus(state, sentence, now);
  if (status === 'scheduled') throw new Error(t('这一句已经在复习里了。'));
  if (status === 'tomorrow') throw new Error(t('这一句今天已经试过了，明天再试。'));
  const attempt = attemptFor(state, { attemptId, sentenceId, kind: 'recall', now });
  attempt.said = said;
  attempt.responseMs = durationOrNull(responseMs);
  attempt.speakMs = durationOrNull(speakMs);
  if (said) sentence.schedule = scheduler.rate(scheduler.createSchedule(), GOOD, now, schedulerOptions(state.settings));
}

/**
 * How often each sentence was not said (in recall or review) since its last
 * explanation check, as a Map from sentence id to count.
 */
function missCounts(state) {
  const counts = new Map();
  for (const attempt of state.attempts) {
    if (attempt.said !== false) continue;
    const sentence = state.sentences[attempt.sentenceId];
    if (!sentence || attempt.at <= (sentence.explainCheckedAt ?? 0)) continue;
    counts.set(attempt.sentenceId, (counts.get(attempt.sentenceId) ?? 0) + 1);
  }
  return counts;
}

/** Average overall score of the most recent scored shadowing attempts, or null when there are none. */
function shadowAverage(state) {
  const recent = state.attempts.filter(attempt => attempt.kind === 'shadow' && typeof attempt.scores?.overall === 'number').slice(-SHADOW_AVERAGE_WINDOW);
  if (recent.length === 0) return null;
  const total = recent.reduce((sum, attempt) => sum + attempt.scores.overall, 0);
  return { count: recent.length, overall: Math.round((total / recent.length) * 10) / 10 };
}

module.exports = { recordScores, judgeRecall, recallStatus, shadowAverage, missCounts, problemWords, schedulerOptions, attemptFor, requireAttemptId, durationOrNull, studyDayOf, ATTEMPT_KINDS, SHADOW_AVERAGE_WINDOW, DAY_START_HOUR };
