'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackend } = require('../src/backend/backend.cjs');
const { recordScores, judgeRecall, recallStatus, shadowAverage, problemWords } = require('../src/backend/attempts.cjs');
const { parseAssessment } = require('../src/backend/speech/azure-parse.cjs');
const { defaultSettings } = require('../src/backend/settings.cjs');
const { fixtureBytes, fixtureJson } = require('./helpers.cjs');

const SENTENCE = '11111111-1111-4111-8111-111111111111';
const attemptId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = text => new Date(text).getTime();
const assessmentFrom = name => parseAssessment(fixtureJson('azure', `${name}.json`).body);

function stateWithSentence() {
  return { settings: defaultSettings(), passages: {}, attempts: [], sentences: { [SENTENCE]: { id: SENTENCE, target: 'I will tell him about it.', schedule: null } } };
}

test('problemWords keeps flagged words and words with a weak phoneme, nothing else', () => {
  assert.deepEqual(problemWords(assessmentFrom('match')), []);
  assert.deepEqual(problemWords(assessmentFrom('mispronunciation')), [{
    word: 'tell', errorType: 'Mispronunciation', accuracy: 55,
    weakPhonemes: [{ expected: 't', accuracy: 0, soundsLike: 's' }, { expected: 'ɛ', accuracy: 8, soundsLike: null }],
  }]);
  assert.deepEqual(problemWords(assessmentFrom('omission')).map(word => [word.word, word.errorType]), [['all', 'Omission'], ['tomorrow', 'Omission']]);
});

test('problemWords in a language whose sounds are not named: flagged words only, without sounds', () => {
  assert.deepEqual(problemWords(assessmentFrom('german')), [{ word: 'ist', errorType: 'Mispronunciation', accuracy: 59, weakPhonemes: [] }]);
  assert.deepEqual(problemWords(assessmentFrom('japanese')), []);
  assert.deepEqual(problemWords(assessmentFrom('mandarin')), []);
});

test('scores and the verdict of one attempt may arrive in either order', () => {
  for (const order of [['scores', 'verdict'], ['verdict', 'scores']]) {
    const state = stateWithSentence();
    const now = at('2026-11-14T10:00:00');
    const steps = {
      scores: () => recordScores(state, { attemptId: attemptId(1), sentenceId: SENTENCE, kind: 'recall', assessment: assessmentFrom('mispronunciation'), now }),
      verdict: () => judgeRecall(state, { attemptId: attemptId(1), sentenceId: SENTENCE, said: true, responseMs: 2400.4, speakMs: 3100, now }),
    };
    for (const step of order) steps[step]();
    assert.equal(state.attempts.length, 1, order.join(' then '));
    const [attempt] = state.attempts;
    assert.deepEqual([attempt.said, attempt.responseMs, attempt.speakMs, attempt.scores.overall, attempt.problems.length], [true, 2400, 3100, 89.3, 1]);
  }
});

test('the first successful recall schedules the sentence for the next study day', () => {
  const state = stateWithSentence();
  const now = at('2026-11-14T10:00:00');
  assert.equal(recallStatus(state, state.sentences[SENTENCE], now), 'pending');
  judgeRecall(state, { attemptId: attemptId(1), sentenceId: SENTENCE, said: true, now });
  const { schedule } = state.sentences[SENTENCE];
  assert.deepEqual([schedule.state, schedule.scheduled_days, schedule.dueDay, schedule.reps], [2, 1, '2026-11-15', 1]);
  assert.equal(recallStatus(state, state.sentences[SENTENCE], now), 'scheduled');
  assert.throws(() => judgeRecall(state, { attemptId: attemptId(2), sentenceId: SENTENCE, said: true, now }), /已经在复习里了/);
});

test('a missed recall schedules nothing and comes back on the next study day, which starts at 4 a.m.', () => {
  const state = stateWithSentence();
  const sentence = state.sentences[SENTENCE];
  judgeRecall(state, { attemptId: attemptId(1), sentenceId: SENTENCE, said: false, now: at('2026-11-14T23:30:00') });
  assert.equal(sentence.schedule, null);
  assert.equal(recallStatus(state, sentence, at('2026-11-14T23:45:00')), 'tomorrow');
  assert.equal(recallStatus(state, sentence, at('2026-11-15T03:59:00')), 'tomorrow');
  assert.throws(() => judgeRecall(state, { attemptId: attemptId(2), sentenceId: SENTENCE, said: true, now: at('2026-11-15T03:59:00') }), /明天再试/);
  assert.equal(recallStatus(state, sentence, at('2026-11-15T04:01:00')), 'pending');
  judgeRecall(state, { attemptId: attemptId(2), sentenceId: SENTENCE, said: true, now: at('2026-11-15T04:01:00') });
  assert.equal(sentence.schedule.dueDay, '2026-11-16');
});

test('pronunciation scores never create a schedule', () => {
  const state = stateWithSentence();
  recordScores(state, { attemptId: attemptId(1), sentenceId: SENTENCE, kind: 'shadow', assessment: assessmentFrom('match'), now: 1 });
  recordScores(state, { attemptId: attemptId(2), sentenceId: SENTENCE, kind: 'recall', assessment: assessmentFrom('match'), now: 2 });
  assert.equal(state.sentences[SENTENCE].schedule, null);
  assert.deepEqual(state.attempts.map(attempt => attempt.said), [null, null]);
});

test('attempt input is validated', () => {
  const base = { attemptId: attemptId(1), sentenceId: SENTENCE, said: true, now: 1 };
  const refused = [
    [{ attemptId: 'nope' }, /练习记录编号无效/], [{ sentenceId: 'missing' }, /找不到这一句/], [{ sentenceId: '__proto__' }, /找不到这一句/],
    [{ said: 'yes' }, /请选择/], [{ responseMs: -1 }, /用时不对/], [{ speakMs: Infinity }, /用时不对/],
  ];
  for (const [overrides, expected] of refused) {
    const state = stateWithSentence();
    assert.throws(() => judgeRecall(state, { ...base, ...overrides }), expected, JSON.stringify(overrides));
    assert.equal(state.sentences[SENTENCE].schedule, null);
  }
  const state = stateWithSentence();
  assert.throws(() => recordScores(state, { attemptId: attemptId(1), sentenceId: SENTENCE, kind: 'listen', assessment: assessmentFrom('match'), now: 1 }), /练习类型/);
  recordScores(state, { attemptId: attemptId(1), sentenceId: SENTENCE, kind: 'shadow', assessment: assessmentFrom('match'), now: 1 });
  assert.throws(() => judgeRecall(state, base), /已经用在别处/);
});

test('the shadowing average covers the ten most recent scored shadow attempts only', () => {
  const state = stateWithSentence();
  assert.equal(shadowAverage(state), null);
  const scored = (id, kind, overall) => state.attempts.push({ id, sentenceId: SENTENCE, kind, at: id, scores: overall === null ? null : { overall } });
  scored(1, 'shadow', 0);
  scored(2, 'recall', 0);
  for (let n = 3; n <= 12; n += 1) scored(n, 'shadow', n === 12 ? 85 : 90);
  scored(13, 'shadow', null);
  assert.deepEqual(shadowAverage(state), { count: 10, overall: 89.5 });
});

// ---- through the backend operations ----

function harness(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-english-practice-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const handlers = new Map();
  let azureFixture = 'match';
  const fetchImpl = async url => (url.includes('elevenlabs') ? new Response(fixtureBytes('elevenlabs', 'success.mp3')) : Response.json(fixtureJson('azure', `${azureFixture}.json`).body));
  const ctx = { dataDirectory, signal: new AbortController().signal, handle: (name, handler) => handlers.set(name, handler), inference: {} };
  createBackend(ctx, { fetchImpl });
  return { dataDirectory, call: (name, input) => handlers.get(name)(input), hear: name => { azureFixture = name; } };
}

const ORIGINAL_PASSAGE = {
  register: 'casual', version: 'brief', nativeLanguage: 'zh-CN', targetLanguage: 'en-US', source: '我会把这事告诉他。我搞定了。',
  sentences: [{ native: '我会把这事告诉他。', target: 'I will tell him about it.', keyExpression: 'tell him about it' }, { native: '我搞定了。', target: 'Nailed it.', keyExpression: '' }],
};
const GERMAN_PASSAGE = {
  register: 'casual', version: 'brief', nativeLanguage: 'en-US', targetLanguage: 'de-DE', source: "The weather is nice today, let's go for a walk in the park.",
  sentences: [{ native: "The weather is nice today, let's go for a walk in the park.", target: fixtureJson('azure', 'german.json').referenceText, keyExpression: 'spazieren gehen' }],
};

async function passageReady(backend, passage = ORIGINAL_PASSAGE) {
  await backend.call('set-secret', { name: 'azureKey', value: 'az-key' });
  await backend.call('save-settings', { azureRegion: 'swedencentral' });
  const { passageId, state } = await backend.call('create-passage', passage);
  return { passageId, sentenceIds: state.passages[0].sentences.map(sentence => sentence.id) };
}

const wavBase64 = Buffer.from(fixtureBytes('audio', 'tell-him-16k.wav')).toString('base64');

test('shadowing: each scored attempt is logged and moves the recent average', async t => {
  const backend = harness(t);
  const { sentenceIds } = await passageReady(backend);
  backend.hear('mispronunciation');
  const first = await backend.call('score-attempt', { attemptId: attemptId(1), sentenceId: sentenceIds[0], kind: 'shadow', wavBase64 });
  assert.equal(first.assessment.words.find(word => word.word === 'tell').errorType, 'Mispronunciation');
  assert.deepEqual(first.state.shadowAverage, { count: 1, overall: 89.3 });
  backend.hear('match');
  const second = await backend.call('score-attempt', { attemptId: attemptId(2), sentenceId: sentenceIds[0], kind: 'shadow', wavBase64 });
  assert.deepEqual(second.state.shadowAverage, { count: 2, overall: 92.7 });
  assert.equal(second.state.passages[0].sentences[0].recall, 'pending', 'shadowing does not schedule');
  const stored = JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8')).attempts;
  assert.deepEqual(stored.map(attempt => [attempt.kind, attempt.scores.overall, attempt.problems.length]), [['shadow', 89.3, 1], ['shadow', 96, 0]]);
});

test('shadowing in a language without named sounds: the flagged word is logged, the score counts, prosody is absent', async t => {
  const backend = harness(t);
  const { sentenceIds } = await passageReady(backend, GERMAN_PASSAGE);
  backend.hear('german');
  const { assessment, state } = await backend.call('score-attempt', { attemptId: attemptId(1), sentenceId: sentenceIds[0], kind: 'shadow', wavBase64 });
  assert.deepEqual(assessment.scores, { overall: 92, accuracy: 91, fluency: 99, completeness: 90, prosody: null });
  assert.deepEqual(state.shadowAverage, { count: 1, overall: 92 });
  const [stored] = JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8')).attempts;
  assert.deepEqual(stored.problems, [{ word: 'ist', errorType: 'Mispronunciation', accuracy: 59, weakPhonemes: [] }]);
});

test('shadowing: a recording nobody spoke into is reported and not logged', async t => {
  const backend = harness(t);
  const { sentenceIds } = await passageReady(backend);
  backend.hear('silence');
  await assert.rejects(backend.call('score-attempt', { attemptId: attemptId(1), sentenceId: sentenceIds[0], kind: 'shadow', wavBase64 }), /没有听到这句话/);
  assert.equal((await backend.call('get-state')).shadowAverage, null);
});

test('recall: said sentences are scheduled, missed ones wait, and the view says which is which', async t => {
  const backend = harness(t);
  const { sentenceIds } = await passageReady(backend);
  await backend.call('judge-recall', { attemptId: attemptId(1), sentenceId: sentenceIds[0], said: true, responseMs: 1800, speakMs: 2500 });
  const state = await backend.call('judge-recall', { attemptId: attemptId(2), sentenceId: sentenceIds[1], said: false, responseMs: 9000 });
  assert.deepEqual(state.passages[0].sentences.map(sentence => [sentence.recall, sentence.schedule?.scheduled_days ?? null]), [['scheduled', 1], ['tomorrow', null]]);
  await assert.rejects(backend.call('judge-recall', { attemptId: attemptId(3), sentenceId: sentenceIds[1], said: true }), /明天再试/);
  const scored = await backend.call('score-attempt', { attemptId: attemptId(1), sentenceId: sentenceIds[0], kind: 'recall', wavBase64 });
  assert.equal(scored.state.shadowAverage, null, 'recall scores are kept apart from the shadowing average');
});

test('whole-passage readings: the first is kept for good, later ones replace each other', async t => {
  const backend = harness(t);
  const { passageId } = await passageReady(backend);
  const reading = text => ({ passageId, base64: Buffer.from(text).toString('base64'), mime: 'audio/webm;codecs=opus', seconds: 42.5 });
  const heard = async slot => Buffer.from((await backend.call('reading-audio', { passageId, slot })).base64, 'base64').toString();
  await assert.rejects(backend.call('reading-audio', { passageId, slot: 'first' }), /还没有这段录音/);

  let state = await backend.call('save-reading', reading('take one'));
  assert.deepEqual([state.passages[0].firstReading.seconds, state.passages[0].latestReading], [42.5, null]);
  await backend.call('save-reading', reading('take two'));
  state = await backend.call('save-reading', reading('take three'));
  assert.equal(state.passages[0].latestReading.mime, 'audio/webm;codecs=opus');
  assert.deepEqual([await heard('first'), await heard('latest')], ['take one', 'take three']);
  assert.deepEqual(fs.readdirSync(path.join(backend.dataDirectory, 'readings')).sort(), [`${passageId}.first`, `${passageId}.latest`]);

  const refused = [
    [{ mime: 'text/html' }, /录音格式/], [{ mime: 'audio/webm\r\nx' }, /录音格式/], [{ seconds: 0 }, /时长/], [{ seconds: 601 }, /时长/],
    [{ base64: '' }, /为空或太长/], [{ passageId: 'missing' }, /找不到这一段/],
  ];
  for (const [overrides, expected] of refused) await assert.rejects(backend.call('save-reading', { ...reading('x'), ...overrides }), expected, JSON.stringify(overrides));
  await assert.rejects(backend.call('reading-audio', { passageId, slot: '../../secrets' }), /还没有这段录音/);

  await backend.call('delete-passage', { passageId });
  assert.deepEqual(fs.readdirSync(path.join(backend.dataDirectory, 'readings')), []);
});

test('deleting a passage also removes its practice log', async t => {
  const backend = harness(t);
  const { passageId, sentenceIds } = await passageReady(backend);
  await backend.call('score-attempt', { attemptId: attemptId(1), sentenceId: sentenceIds[0], kind: 'shadow', wavBase64 });
  await backend.call('delete-passage', { passageId });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8')).attempts, []);
});
