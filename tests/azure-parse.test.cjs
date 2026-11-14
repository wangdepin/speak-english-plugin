'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAssessment, heardNothing, WEAK_PHONEME_THRESHOLD } = require('../src/backend/speech/azure-parse.cjs');
const { fixtureJson } = require('./helpers.cjs');

const parsed = name => parseAssessment(fixtureJson('azure', `${name}.json`).body);
const wordNamed = (assessment, name) => assessment.words.find(word => word.word.toLowerCase() === name);

test('a correct reading parses into scores and clean words', () => {
  const assessment = parsed('match');
  assert.equal(assessment.recognizedText, "I'll tell him about it.");
  assert.deepEqual(assessment.scores, { overall: 96, accuracy: 98, fluency: 100, completeness: 100, prosody: 91 });
  assert.deepEqual(assessment.words.map(word => word.word), ["i'll", 'tell', 'him', 'about', 'it']);
  assert.ok(assessment.words.every(word => word.errorType === 'None'));
  assert.ok(assessment.words.flatMap(word => word.phonemes).every(phoneme => !phoneme.weak && phoneme.soundsLike === null));
});

test('a mispronounced word carries its weak phonemes and the sound that was heard', () => {
  const tell = wordNamed(parsed('mispronunciation'), 'tell');
  assert.equal(tell.errorType, 'Mispronunciation');
  assert.equal(tell.accuracy, 55);
  assert.deepEqual(tell.phonemes, [
    { expected: 't', accuracy: 0, weak: true, soundsLike: 's' },
    { expected: 'ɛ', accuracy: 8, weak: true, soundsLike: null },
    { expected: 'l', accuracy: 100, weak: false, soundsLike: null },
  ]);
});

test('skipped words are marked Omission and have no phonemes', () => {
  const assessment = parsed('omission');
  assert.deepEqual(assessment.words.filter(word => word.errorType === 'Omission').map(word => word.word), ['all', 'tomorrow']);
  assert.deepEqual(wordNamed(assessment, 'all'), { word: 'all', errorType: 'Omission', accuracy: 0, phonemes: [] });
  assert.equal(heardNothing(assessment), false);
});

test('extra words in the recording are not reported by the REST API', () => {
  const assessment = parsed('insertion');
  assert.deepEqual(assessment.words.map(word => `${word.word}:${word.errorType}`), ["i'll:None", 'tell:None', 'him:None']);
});

test('silence and undecodable audio both come back as "every word omitted"', () => {
  for (const name of ['silence', 'not-wav']) {
    const assessment = parsed(name);
    assert.equal(heardNothing(assessment), true, name);
    assert.equal(assessment.scores.prosody, null, name);
  }
});

test('soundsLike is only reported below the weak threshold', () => {
  const phoneme = accuracy => ({ Phoneme: 'ɔ', AccuracyScore: accuracy, NBestPhonemes: [{ Phoneme: 'ɑ', Score: 100 }] });
  const body = { NBest: [{ Words: [{ Word: 'off', ErrorType: 'None', AccuracyScore: 80, Phonemes: [phoneme(WEAK_PHONEME_THRESHOLD - 1), phoneme(WEAK_PHONEME_THRESHOLD)] }] }] };
  assert.deepEqual(parseAssessment(body).words[0].phonemes.map(item => item.soundsLike), ['ɑ', null]);
});

test('missing or malformed fields do not throw', () => {
  const sparse = parseAssessment({ NBest: [{ Words: [{ Word: 'hi', Phonemes: [{ Phoneme: 'h' }] }, {}] }] });
  assert.deepEqual(sparse.scores, { overall: null, accuracy: null, fluency: null, completeness: null, prosody: null });
  assert.deepEqual(sparse.words, [
    { word: 'hi', errorType: 'None', accuracy: null, phonemes: [{ expected: 'h', accuracy: null, weak: false, soundsLike: null }] },
    { word: '', errorType: 'None', accuracy: null, phonemes: [] },
  ]);
});

test('a body without an assessment parses to null', () => {
  for (const body of [null, {}, { NBest: [] }, { NBest: [{ Display: 'hi' }] }, 'text']) assert.equal(parseAssessment(body), null);
});
