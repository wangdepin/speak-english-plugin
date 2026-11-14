'use strict';

const scheduler = require('./scheduler.cjs');
const { requireSentence } = require('./records.cjs');
const { attemptFor, durationOrNull, schedulerOptions, studyDayOf, DAY_START_HOUR } = require('./attempts.cjs');
const { t } = require('./messages.cjs');

const AGAIN = 1;
const GOOD = 3;
// A schedule in state 2 waits for its review day; any other state is the 10-minute step after a miss.
const REVIEW_STATE = 2;

const isRetry = sentence => sentence.schedule.state !== REVIEW_STATE;

/** Retries of a missed sentence come first (they are timed to the minute), then reviews from the longest overdue. */
function byUrgency(a, b) {
  if (isRetry(a) !== isRetry(b)) return isRetry(a) ? -1 : 1;
  return a.schedule.due - b.schedule.due || (a.id < b.id ? -1 : 1);
}

function reviewsDoneToday(state, now) {
  const today = studyDayOf(now);
  return state.attempts.filter(attempt => attempt.kind === 'review' && attempt.said !== null && studyDayOf(attempt.at) === today).length;
}

/**
 * Today's review queue.
 *   dueIds     sentences to review now, most urgent first, cut to what the daily limit still allows
 *   postponed  due sentences beyond the daily limit; they stay due tomorrow
 *   waiting    missed sentences whose 10-minute retry has not come up yet, soonest first
 *   doneToday  reviews judged today, retries included
 *   scheduled  sentences that have a schedule at all
 */
function reviewSummary(state, now) {
  const scheduled = Object.values(state.sentences).filter(sentence => sentence.schedule);
  const due = scheduled.filter(sentence => scheduler.isDue(sentence.schedule, now, DAY_START_HOUR)).sort(byUrgency);
  const waiting = scheduled
    .filter(sentence => isRetry(sentence) && sentence.schedule.due > now)
    .sort(byUrgency)
    .map(sentence => ({ sentenceId: sentence.id, dueAt: sentence.schedule.due }));
  const limit = state.settings.dailyReviewLimit;
  const doneToday = reviewsDoneToday(state, now);
  const allowed = Math.max(0, limit - doneToday);
  return { dueIds: due.slice(0, allowed).map(sentence => sentence.id), postponed: Math.max(0, due.length - allowed), waiting, doneToday, limit, scheduled: scheduled.length };
}

/**
 * Records the outcome of one review and moves the sentence's schedule:
 * said → the interval grows; not said → it comes back in 10 minutes, then starts
 * again from short intervals. `timedOut` marks a miss where the learner never started speaking.
 */
function judgeReview(state, { attemptId, sentenceId, said, timedOut, responseMs, speakMs, now }) {
  if (typeof said !== 'boolean') throw new Error(t('请选择说出来了还是没说出来。'));
  if (timedOut !== undefined && typeof timedOut !== 'boolean') throw new Error(t('超时标记不对。'));
  if (said && timedOut) throw new Error(t('超时的句子不能记为说出来了。'));
  const sentence = requireSentence(state, sentenceId);
  if (!sentence.schedule) throw new Error(t('这一句还没有进入复习，请先在段落里试背。'));
  if (!scheduler.isDue(sentence.schedule, now, DAY_START_HOUR)) throw new Error(t('这一句现在还没到复习时间。'));
  if (reviewsDoneToday(state, now) >= state.settings.dailyReviewLimit) throw new Error(t('今天的复习已经到每日上限了，明天继续。'));
  const attempt = attemptFor(state, { attemptId, sentenceId, kind: 'review', now });
  if (attempt.said !== null) throw new Error(t('这次复习已经记过结果了。'));
  attempt.said = said;
  attempt.timedOut = Boolean(timedOut);
  attempt.responseMs = durationOrNull(responseMs);
  attempt.speakMs = durationOrNull(speakMs);
  sentence.schedule = scheduler.rate(sentence.schedule, said ? GOOD : AGAIN, now, schedulerOptions(state.settings));
}

module.exports = { reviewSummary, judgeReview };
