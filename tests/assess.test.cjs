'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessPronunciation } = require('../src/backend/speech/assess.cjs');
const { buildAssessmentRequest, assessmentOptions } = require('../src/backend/speech/azure-request.cjs');
const { SpeechError } = require('../src/backend/speech/errors.cjs');
const { fixtureBytes, fixtureJson, fakeFetch, replay, makeWav } = require('./helpers.cjs');

const KEY = 'test-key-0123456789abcdef';
const wav = fixtureBytes('audio', 'tell-him-16k.wav');
const recorded = name => fixtureJson('azure', `${name}.json`);
const assess = (overrides = {}) => assessPronunciation({ wav, referenceText: "I'll tell him about it.", locale: 'en-US', key: KEY, region: 'swedencentral', ...overrides });
const assessmentHeader = call => JSON.parse(Buffer.from(call.init.headers['Pronunciation-Assessment'], 'base64').toString('utf8'));
const BASE_OPTIONS = { GradingSystem: 'HundredMark', Granularity: 'Phoneme', Dimension: 'Comprehensive', EnableMiscue: true };
const FULL_OPTIONS = { ...BASE_OPTIONS, EnableProsodyAssessment: true, PhonemeAlphabet: 'IPA', NBestPhonemeCount: 3 };

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
  assert.deepEqual(assessmentHeader(calls[0]), { ReferenceText: "I'll tell him about it.", ...FULL_OPTIONS });
});

test('a reference sentence with non-ASCII characters survives the header encoding', async () => {
  const { fetchImpl, calls } = replay(recorded('match'));
  await assess({ fetchImpl, referenceText: 'It’s a café — naïve.' });
  assert.equal(assessmentHeader(calls[0]).ReferenceText, 'It’s a café — naïve.');
});

test('only en-US asks for prosody, IPA phoneme names and "sounds like" candidates', () => {
  assert.deepEqual(assessmentOptions('en-US'), FULL_OPTIONS);
  for (const locale of ['ja-JP', 'zh-CN', 'de-DE', 'en-GB']) assert.deepEqual(assessmentOptions(locale), BASE_OPTIONS, locale);
});

test('the request names the locale of the recording and carries the options of that locale', () => {
  const referenceText = '今日は天気がいいので、公園を散歩しましょう。';
  const { url, init } = buildAssessmentRequest({ key: KEY, region: 'swedencentral', locale: 'ja-JP', referenceText, wav });
  assert.equal(url, 'https://swedencentral.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=ja-JP&format=detailed');
  const header = assessmentHeader({ init });
  assert.deepEqual(header, { ReferenceText: referenceText, ...BASE_OPTIONS });
  for (const option of ['EnableProsodyAssessment', 'PhonemeAlphabet', 'NBestPhonemeCount']) assert.ok(!Object.hasOwn(header, option), option);
});

test('recordings in other languages are scored in their own locale', async () => {
  const cases = [
    ['mandarin', 'zh-CN', 98, 9],
    ['japanese', 'ja-JP', 87.4, 10],
    ['german', 'de-DE', 92, 10],
  ];
  for (const [name, locale, overall, words] of cases) {
    const exchange = recorded(name);
    const { fetchImpl, calls } = replay(exchange);
    const assessment = await assess({ fetchImpl, locale, referenceText: exchange.referenceText });
    assert.deepEqual([assessment.scores.overall, assessment.scores.prosody, assessment.words.length], [overall, null, words], name);
    assert.match(calls[0].url, new RegExp(`\\?language=${locale}&format=detailed$`), name);
    assert.deepEqual(assessmentHeader(calls[0]), { ReferenceText: exchange.referenceText, ...BASE_OPTIONS }, name);
  }
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
    ['locale missing', { locale: undefined }, 'invalid-input'],
    ['language without a region', { locale: 'ja' }, 'invalid-input'],
    ['locale in the wrong case', { locale: 'JA-jp' }, 'invalid-input'],
    ['locale with a query in it', { locale: 'ja-JP&format=simple' }, 'invalid-input'],
    ['locale that is a name', { locale: 'Japanese' }, 'invalid-input'],
    ['locale not a string', { locale: 5 }, 'invalid-input'],
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
