'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackend } = require('../src/backend/backend.cjs');
const { judgeRecall, recordScores } = require('../src/backend/attempts.cjs');
const { judgeReview, reviewSummary } = require('../src/backend/review.cjs');
const { parseAssessment } = require('../src/backend/speech/azure-parse.cjs');
const { defaultSettings } = require('../src/backend/settings.cjs');
const { fixtureJson } = require('./helpers.cjs');

const MINUTE = 60_000;
const sentenceId = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const attemptId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = text => new Date(text).getTime();
let nextAttempt = 1000;
const freshAttempt = () => attemptId(nextAttempt++);

/** A state with `count` sentences, each first said from memory on 14 November at 10:00, so all are due on the 15th. */
function stateWithScheduled(count, settings = {}) {
  const state = { settings: { ...defaultSettings(), ...settings }, passages: {}, attempts: [], sentences: {} };
  for (let n = 1; n <= count; n += 1) {
    state.sentences[sentenceId(n)] = { id: sentenceId(n), en: 'I will tell him about it.', schedule: null };
    judgeRecall(state, { attemptId: freshAttempt(), sentenceId: sentenceId(n), said: true, now: at('2026-11-14T10:00:00') + n });
  }
  return state;
}

const review = (state, n, said, now, extra = {}) => judgeReview(state, { attemptId: freshAttempt(), sentenceId: sentenceId(n), said, now, ...extra });

test('a sentence is due from 4 a.m. of its review day, not before', () => {
  const state = stateWithScheduled(2);
  assert.deepEqual(reviewSummary(state, at('2026-11-15T03:59:00')).dueIds, []);
  assert.throws(() => review(state, 1, true, at('2026-11-15T03:59:00')), /还没到复习时间/);
  const summary = reviewSummary(state, at('2026-11-15T04:00:00'));
  assert.deepEqual(summary, { dueIds: [sentenceId(1), sentenceId(2)], postponed: 0, waiting: [], doneToday: 0, limit: 50, scheduled: 2 });
});

test('saying it every time stretches the interval as the plan says: 1, 3, 8, 19, 43, 89 days', () => {
  const state = stateWithScheduled(1);
  const intervals = [state.sentences[sentenceId(1)].schedule.scheduled_days];
  for (let round = 0; round < 5; round += 1) {
    review(state, 1, true, state.sentences[sentenceId(1)].schedule.due + 6 * 60 * MINUTE);
    intervals.push(state.sentences[sentenceId(1)].schedule.scheduled_days);
  }
  assert.deepEqual(intervals, [1, 3, 8, 19, 43, 89]);
});

test('a miss comes back after 10 minutes, ahead of the other reviews, then restarts from a short interval', () => {
  const state = stateWithScheduled(3);
  const now = at('2026-11-15T09:00:00');
  review(state, 1, false, now, { responseMs: 4000, speakMs: 2000 });
  assert.equal(state.sentences[sentenceId(1)].schedule.lapses, 1);
  let summary = reviewSummary(state, now + 9 * MINUTE);
  assert.deepEqual(summary.dueIds, [sentenceId(2), sentenceId(3)]);
  assert.deepEqual(summary.waiting, [{ sentenceId: sentenceId(1), dueAt: now + 10 * MINUTE }]);
  assert.throws(() => review(state, 1, true, now + 9 * MINUTE), /还没到复习时间/);

  summary = reviewSummary(state, now + 10 * MINUTE);
  assert.deepEqual(summary.dueIds, [sentenceId(1), sentenceId(2), sentenceId(3)], 'the retry is the most urgent');
  assert.deepEqual(summary.waiting, []);

  review(state, 1, false, now + 10 * MINUTE);
  assert.equal(state.sentences[sentenceId(1)].schedule.due, now + 20 * MINUTE, 'a second miss waits another 10 minutes');
  review(state, 1, true, now + 20 * MINUTE);
  const { schedule } = state.sentences[sentenceId(1)];
  assert.deepEqual([schedule.state, schedule.scheduled_days, schedule.dueDay, schedule.lapses], [2, 1, '2026-11-16', 1]);
});

test('an unfinished retry is still due on a later day', () => {
  const state = stateWithScheduled(1);
  review(state, 1, false, at('2026-11-15T23:55:00'));
  assert.deepEqual(reviewSummary(state, at('2026-11-17T08:00:00')).dueIds, [sentenceId(1)]);
});

test('reviews are ordered from the longest overdue', () => {
  const state = stateWithScheduled(3);
  review(state, 2, true, at('2026-11-15T09:00:00'));
  // Sentence 2 is next due on the 18th; 1 and 3 have been waiting since the 15th.
  assert.deepEqual(reviewSummary(state, at('2026-11-18T09:00:00')).dueIds, [sentenceId(1), sentenceId(3), sentenceId(2)]);
});

test('the daily limit counts every judged review, postpones the rest, and frees up the next morning', () => {
  const state = stateWithScheduled(4, { dailyReviewLimit: 2 });
  const now = at('2026-11-15T09:00:00');
  assert.deepEqual([reviewSummary(state, now).dueIds.length, reviewSummary(state, now).postponed], [2, 2]);
  review(state, 1, true, now);
  review(state, 2, false, now);
  const summary = reviewSummary(state, now + 10 * MINUTE);
  assert.deepEqual([summary.dueIds, summary.postponed, summary.doneToday], [[], 3, 2]);
  assert.throws(() => review(state, 3, true, now + 10 * MINUTE), /每日上限/);
  const tomorrow = reviewSummary(state, at('2026-11-16T04:00:00'));
  assert.deepEqual([tomorrow.dueIds, tomorrow.postponed, tomorrow.doneToday], [[sentenceId(2), sentenceId(3)], 1, 0]);
});

test('scores do not count as a review and never move the schedule', () => {
  const state = stateWithScheduled(1);
  const now = at('2026-11-15T09:00:00');
  const before = structuredClone(state.sentences[sentenceId(1)].schedule);
  const assessment = parseAssessment(fixtureJson('azure', 'mispronunciation.json').body);
  recordScores(state, { attemptId: attemptId(1), sentenceId: sentenceId(1), kind: 'review', assessment, now });
  assert.deepEqual(state.sentences[sentenceId(1)].schedule, before);
  assert.equal(reviewSummary(state, now).doneToday, 0);
  judgeReview(state, { attemptId: attemptId(1), sentenceId: sentenceId(1), said: true, responseMs: 3100.6, speakMs: 2900, now });
  const attempt = state.attempts.find(item => item.id === attemptId(1));
  assert.deepEqual([attempt.kind, attempt.said, attempt.timedOut, attempt.responseMs, attempt.speakMs, attempt.scores.overall], ['review', true, false, 3101, 2900, 89.3]);
  assert.equal(reviewSummary(state, now).doneToday, 1);
});

test('review input is validated, and a refused review changes nothing', () => {
  const state = stateWithScheduled(1);
  state.sentences[sentenceId(2)] = { id: sentenceId(2), en: 'Nailed it.', schedule: null };
  const now = at('2026-11-15T09:00:00');
  const base = { attemptId: attemptId(1), sentenceId: sentenceId(1), said: false, timedOut: true, now };
  const refused = [
    [{ said: 'no' }, /请选择/], [{ said: true }, /超时的句子不能记为说出来了/], [{ timedOut: 'yes' }, /超时标记/], [{ sentenceId: sentenceId(2) }, /请先在段落里试背/],
    [{ sentenceId: 'missing' }, /找不到这一句/], [{ attemptId: 'nope' }, /练习记录编号无效/], [{ responseMs: -1 }, /用时不对/],
  ];
  const before = JSON.stringify(state.sentences);
  for (const [overrides, expected] of refused) assert.throws(() => judgeReview(structuredClone(state), { ...base, ...overrides }), expected, JSON.stringify(overrides));
  assert.equal(JSON.stringify(state.sentences), before);
  judgeReview(state, base);
  assert.equal(state.attempts.at(-1).timedOut, true);
  assert.throws(() => judgeReview(state, { ...base, now: now + 10 * MINUTE }), /已经记过结果了/);
});

test('through the backend: a recalled sentence shows up in the review queue of the state', async t => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-english-review-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const handlers = new Map();
  createBackend({ dataDirectory, signal: new AbortController().signal, handle: (name, handler) => handlers.set(name, handler), inference: {} });
  const call = (name, input) => handlers.get(name)(input);
  const { state } = await call('create-passage', { register: 'casual', version: 'brief', chinese: '我搞定了。', sentences: [{ zh: '我搞定了。', en: 'Nailed it.', keyExpression: '' }] });
  const [sentence] = state.passages[0].sentences;
  assert.deepEqual([sentence.misses, sentence.explanation, state.review.scheduled], [0, null, 0]);
  await assert.rejects(call('judge-review', { attemptId: attemptId(1), sentenceId: sentence.id, said: true }), /请先在段落里试背/);
  const recalled = await call('judge-recall', { attemptId: attemptId(2), sentenceId: sentence.id, said: true });
  assert.deepEqual(recalled.review, { dueIds: [], postponed: 0, waiting: [], doneToday: 0, limit: 50, scheduled: 1 });
  await assert.rejects(call('judge-review', { attemptId: attemptId(3), sentenceId: sentence.id, said: true }), /还没到复习时间/);

  // Move the review day into the past, as if a day had gone by, and reopen the store.
  const file = path.join(dataDirectory, 'store.json');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(stored.sentences[sentence.id].schedule, { due: Date.now() - 60 * MINUTE, dueDay: '2026-01-01' });
  fs.writeFileSync(file, JSON.stringify(stored));
  handlers.clear();
  createBackend({ dataDirectory, signal: new AbortController().signal, handle: (name, handler) => handlers.set(name, handler), inference: {} });
  assert.deepEqual((await call('get-state')).review.dueIds, [sentence.id]);
  const missed = await call('judge-review', { attemptId: attemptId(4), sentenceId: sentence.id, said: false, timedOut: true, responseMs: 5000 });
  assert.deepEqual([missed.review.dueIds, missed.review.waiting.length, missed.review.doneToday, missed.passages[0].sentences[0].misses], [[], 1, 1, 1]);
});
