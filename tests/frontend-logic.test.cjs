'use strict';

// The frontend's pure modules are ES modules; they are loaded here with import().
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseAssessment } = require('../src/backend/speech/azure-parse.cjs');
const { describeWav, assessableWavProblem } = require('../src/backend/speech/wav.cjs');
const { fixtureJson } = require('./helpers.cjs');

const load = name => import(pathToFileURL(path.join(__dirname, '..', 'src', 'frontend', name)).href);
const recorded = name => { const fixture = fixtureJson('azure', `${name}.json`); return [fixture.referenceText, parseAssessment(fixture.body)]; };

test('words keep the reference spelling and are marked good, wrong or missed', async () => {
  const { markWords } = await load('word-marking.js');
  assert.deepEqual(markWords(...recorded('mispronunciation')).words, [
    { text: 'I', status: 'good' }, { text: 'will', status: 'good' }, { text: 'tell', status: 'wrong' },
    { text: 'him', status: 'good' }, { text: 'about', status: 'good' }, { text: 'it.', status: 'good' },
  ]);
  assert.deepEqual(markWords(...recorded('omission')).words.filter(word => word.status === 'missed').map(word => word.text), ['all', 'tomorrow.']);
  assert.ok(markWords(...recorded('match')).words.every(word => word.status === 'good'));
});

test('every weak phoneme becomes a hint, worded as a resemblance', async () => {
  const { markWords, hintText } = await load('word-marking.js');
  const { hints } = markWords(...recorded('mispronunciation'));
  assert.deepEqual(hints, [{ word: 'tell', expected: 't', soundsLike: 's' }, { word: 'tell', expected: 'ɛ', soundsLike: null }]);
  assert.deepEqual(hints.map(hintText), ['tell：/t/ 听起来像 /s/', 'tell：/ɛ/ 不够清楚']);
  assert.deepEqual(markWords(...recorded('match')).hints, []);
  const [reference, assessment] = recorded('insertion');
  assert.deepEqual(markWords(reference, assessment).hints, [{ word: 'him', expected: 'm', soundsLike: 'ə' }], 'trailing punctuation is dropped from the word');
});

test('words the speaker added are marked extra and do not shift the reference spelling', async () => {
  const { markWords } = await load('word-marking.js');
  const word = (text, errorType) => ({ word: text, errorType, phonemes: [] });
  const assessment = { words: [word('it', 'Insertion'), word('i', 'Omission'), word("can't", 'None'), word('believe', 'Mispronunciation')] };
  assert.deepEqual(markWords("I can't believe.", assessment).words, [
    { text: 'it', status: 'extra' }, { text: 'I', status: 'missed' }, { text: "can't", status: 'good' }, { text: 'believe.', status: 'wrong' },
  ]);
});

test('when the service splits the sentence differently, its own words are shown', async () => {
  const { markWords } = await load('word-marking.js');
  const word = text => ({ word: text, errorType: 'None', phonemes: [] });
  assert.deepEqual(markWords('2 AM', { words: [word('two'), word('a'), word('m')] }).words.map(item => item.text), ['two', 'a', 'm']);
});

test('the score line shows a dash for a missing score', async () => {
  const { scoreLine } = await load('word-marking.js');
  assert.equal(scoreLine({ overall: 96, accuracy: 98, fluency: 100, completeness: 100, prosody: null }), '总分 96 · 准确 98 · 流利 100 · 完整 100 · 韵律 —');
});

test('the browser-side WAV encoder produces exactly what the scoring check accepts', async () => {
  const { encodeWav, toBase64, fromBase64 } = await load('wav.js');
  const samples = Float32Array.from({ length: 16000 * 2 }, (_, index) => Math.sin(index / 20) * 1.5);
  const wav = encodeWav(samples);
  assert.deepEqual(describeWav(wav), { audioFormat: 1, channels: 1, sampleRate: 16000, bitsPerSample: 16, dataBytes: 64000, seconds: 2 });
  assert.equal(assessableWavProblem(wav), null);
  const view = new DataView(wav.buffer);
  const peaks = Array.from({ length: samples.length }, (_, index) => view.getInt16(44 + index * 2, true));
  assert.deepEqual([Math.max(...peaks), Math.min(...peaks)], [32767, -32768], 'samples beyond ±1 are clamped, not wrapped');
  assert.deepEqual(fromBase64(toBase64(wav)), wav);
});

test('the start limit is reading time, rounded up, plus thinking time; punctuation is not read', async () => {
  const { countedChars, startLimitMs, secondsLeft } = await load('time-limits.js');
  const settings = { readingCharsPerSecond: 5, startAllowanceSeconds: 3 };
  assert.equal(countedChars('这事挺难，但我做成了。'), 9);
  assert.equal(startLimitMs({ zh: '这事挺难，但我做成了。' }, settings), 5000);
  assert.equal(startLimitMs({ zh: '字'.repeat(10) }, settings), 5000);
  assert.equal(startLimitMs({ zh: '字'.repeat(25) }, settings), 8000);
  assert.equal(startLimitMs({ zh: '字'.repeat(25) }, { readingCharsPerSecond: 10, startAllowanceSeconds: 0 }), 3000);
  assert.deepEqual([secondsLeft(5000, 0), secondsLeft(5000, 4001), secondsLeft(5000, 4999), secondsLeft(5000, 6000)], [5, 1, 1, 0]);
});

test('the speaking limit follows the reference audio, within 4 to 30 seconds', async () => {
  const { speakLimitMs } = await load('time-limits.js');
  const settings = { speakingTimeFactor: 2 };
  assert.equal(speakLimitMs({ audio: { seconds: 3 } }, settings), 6000);
  assert.equal(speakLimitMs({ audio: { seconds: 1.2 } }, settings), 4000);
  assert.equal(speakLimitMs({ audio: { seconds: 20 } }, settings), 30000);
  assert.equal(speakLimitMs({ audio: null }, settings), 15000);
});

test('an explanation is suggested once the misses reach the setting', async () => {
  const { findSentence, shouldSuggestExplanation } = await load('lookup.js');
  const state = { settings: { explainAfterFailures: 3 }, passages: [{ id: 'p', sentences: [{ id: 'a', misses: 2 }, { id: 'b', misses: 3 }] }] };
  assert.equal(findSentence(state, 'b').passage.id, 'p');
  assert.equal(findSentence(state, 'gone'), null);
  assert.deepEqual(['a', 'b', 'gone'].map(id => shouldSuggestExplanation(state, id)), [false, true, false]);
});

test('exercises pick only what can be practised: sentences with audio, memorized passages with a spoken question', async () => {
  const { listenableSentences, respondablePassages, isMemorized, sample } = await load('exercise-picks.js');
  const sentence = (id, audio, schedule) => ({ id, audio: audio ? { seconds: 2 } : null, schedule: schedule ? { state: 2 } : null });
  const state = { passages: [
    { id: 'memorized', sentences: [sentence('a', true, true), sentence('b', true, true)], questions: [{ id: 'q1', audio: null }, { id: 'q2', audio: { seconds: 1 } }] },
    { id: 'half', sentences: [sentence('c', true, true), sentence('d', false, false)], questions: [{ id: 'q3', audio: { seconds: 1 } }] },
    { id: 'silent-question', sentences: [sentence('e', true, true)], questions: [{ id: 'q4', audio: null }] },
    { id: 'no-questions', sentences: [sentence('f', true, true)], questions: [] },
  ] };
  assert.deepEqual(listenableSentences(state).map(item => `${item.passage.id}/${item.sentence.id}`), ['memorized/a', 'memorized/b', 'half/c', 'silent-question/e', 'no-questions/f']);
  assert.deepEqual(respondablePassages(state).map(passage => passage.id), ['memorized']);
  assert.equal(isMemorized({ sentences: [] }), false);

  const items = [1, 2, 3, 4, 5];
  const picked = sample(items, 3, () => 0);
  assert.deepEqual([picked.length, new Set(picked).size, items], [3, 3, [1, 2, 3, 4, 5]], 'three distinct items, the input untouched');
  assert.deepEqual(sample(items, 10, () => 0.999).sort(), items);
  assert.deepEqual(sample([], 3), []);
});

test('answering a question: at least a second to start, and time to say the whole passage', async () => {
  const { answerStartLimitMs, answerSpeakLimitMs } = await load('time-limits.js');
  assert.deepEqual([answerStartLimitMs({ startAllowanceSeconds: 3 }), answerStartLimitMs({ startAllowanceSeconds: 0 })], [3000, 1000]);
  const settings = { speakingTimeFactor: 2 };
  assert.equal(answerSpeakLimitMs({ sentences: [{ audio: { seconds: 3 } }, { audio: { seconds: 2.5 } }, { audio: null }] }, settings), 11000);
  assert.equal(answerSpeakLimitMs({ sentences: [{ audio: { seconds: 1 } }] }, settings), 4000);
  assert.equal(answerSpeakLimitMs({ sentences: [{ audio: { seconds: 200 } }] }, settings), 180000);
});
