'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessPronunciation } = require('../src/backend/speech/assess.cjs');
const { SpeechError } = require('../src/backend/speech/errors.cjs');
const { fixtureBytes, fixtureJson, fakeFetch, replay, makeWav } = require('./helpers.cjs');

const KEY = 'test-key-0123456789abcdef';
const wav = fixtureBytes('audio', 'tell-him-16k.wav');
const recorded = name => fixtureJson('azure', `${name}.json`);
const assess = (overrides = {}) => assessPronunciation({ wav, referenceText: "I'll tell him about it.", key: KEY, region: 'swedencentral', ...overrides });

async function rejection(promise) {
  const error = await promise.then(() => null, caught => caught);
  assert.ok(error instanceof SpeechError, `expected a SpeechError, got ${error}`);
  assert.equal(error.service, 'azure');
  assert.ok(!error.message.includes(KEY), 'the key must not leak into the message');
  return error;
}

test('sends the recording to the regional endpoint with the assessment options', async () => {
  const { fetchImpl, calls } = replay(recorded('match'));
  const assessment = await assess({ fetchImpl, referenceText: "  I'll tell him about it. " });
  assert.equal(assessment.scores.overall, 96);
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://swedencentral.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Ocp-Apim-Subscription-Key'], KEY);
  assert.equal(init.headers['Content-Type'], 'audio/wav; codecs=audio/pcm; samplerate=16000');
  assert.equal(init.body, wav);
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(Buffer.from(init.headers['Pronunciation-Assessment'], 'base64').toString('utf8')), {
    ReferenceText: "I'll tell him about it.", GradingSystem: 'HundredMark', Granularity: 'Phoneme', Dimension: 'Comprehensive',
    EnableMiscue: true, EnableProsodyAssessment: true, PhonemeAlphabet: 'IPA', NBestPhonemeCount: 3,
  });
});

test('a reference sentence with non-ASCII characters survives the header encoding', async () => {
  const { fetchImpl, calls } = replay(recorded('match'));
  await assess({ fetchImpl, referenceText: 'It’s a café — naïve.' });
  const header = JSON.parse(Buffer.from(calls[0].init.headers['Pronunciation-Assessment'], 'base64').toString('utf8'));
  assert.equal(header.ReferenceText, 'It’s a café — naïve.');
});

test('recorded failures map to stable codes', async () => {
  const cases = [
    ['bad-key', 'invalid-key', 401],
    ['silence', 'no-speech', 200],
    ['not-wav', 'no-speech', 200],
  ];
  for (const [name, code, httpStatus] of cases) {
    const error = await rejection(assess({ fetchImpl: replay(recorded(name)).fetchImpl }));
    assert.deepEqual([error.code, error.httpStatus], [code, httpStatus], name);
  }
});

test('other responses map to stable codes', async () => {
  const cases = [
    ['forbidden', () => new Response('', { status: 403 }), 'invalid-key'],
    ['rate limit', () => new Response('', { status: 429 }), 'rate-limited'],
    ['bad request', () => new Response('{"error":"bad"}', { status: 400 }), 'rejected'],
    ['server error', () => new Response('oops', { status: 503 }), 'service-error'],
    ['not JSON', () => new Response('<html>', { status: 200 }), 'service-error'],
    ['no match', () => Response.json({ RecognitionStatus: 'NoMatch' }), 'no-speech'],
    ['initial silence', () => Response.json({ RecognitionStatus: 'InitialSilenceTimeout' }), 'no-speech'],
    ['recognition error', () => Response.json({ RecognitionStatus: 'Error' }), 'service-error'],
    ['success without words', () => Response.json({ RecognitionStatus: 'Success', NBest: [] }), 'service-error'],
  ];
  for (const [name, makeResponse, code] of cases) {
    const error = await rejection(assess({ fetchImpl: fakeFetch(makeResponse).fetchImpl }));
    assert.equal(error.code, code, name);
  }
});

test('unusable input is refused before any request is made', async () => {
  const cases = [
    ['mp3 instead of wav', { wav: fixtureBytes('audio', 'sell-him.mp3') }, 'bad-audio'],
    ['48 kHz wav', { wav: makeWav({ sampleRate: 48000 }) }, 'bad-audio'],
    ['31 second wav', { wav: makeWav({ seconds: 31 }) }, 'bad-audio'],
    ['empty reference', { referenceText: '   ' }, 'invalid-input'],
    ['reference too long', { referenceText: 'a'.repeat(1001) }, 'invalid-input'],
    ['no key', { key: '' }, 'missing-key'],
    ['key with a line break', { key: 'abc\r\nX-Injected: 1' }, 'invalid-key'],
    ['region with a host in it', { region: 'evil.example.com/x' }, 'invalid-input'],
    ['region missing', { region: undefined }, 'invalid-input'],
  ];
  for (const [name, overrides, code] of cases) {
    const { fetchImpl, calls } = replay(recorded('match'));
    const error = await rejection(assess({ fetchImpl, ...overrides }));
    assert.equal(error.code, code, name);
    assert.equal(calls.length, 0, name);
  }
});

test('a network failure is reported as unreachable', async () => {
  const error = await rejection(assess({ fetchImpl: async () => { throw new TypeError('fetch failed'); } }));
  assert.deepEqual([error.code, error.httpStatus], ['unreachable', null]);
});

const hangUntilAborted = (url, init) => new Promise((resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
});

test('a service that never answers is reported as a timeout', async () => {
  const error = await rejection(assess({ fetchImpl: hangUntilAborted, timeoutMs: 20 }));
  assert.equal(error.code, 'timeout');
});

test("the caller's own cancellation is passed through untouched", async () => {
  const controller = new AbortController();
  const pending = assess({ fetchImpl: hangUntilAborted, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError' && !(error instanceof SpeechError));
});
