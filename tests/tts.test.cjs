'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { synthesizeSpeech } = require('../src/backend/speech/tts.cjs');
const { SpeechError } = require('../src/backend/speech/errors.cjs');
const { fixtureBytes, fixtureJson, fakeFetch, replay } = require('./helpers.cjs');

const KEY = 'test-key-0123456789abcdef';
const JESSICA = 'cgSgspJ2msm6clMCkdW9';
const recorded = name => fixtureJson('elevenlabs', `${name}.json`);
const audioResponse = bytes => () => new Response(bytes, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
const speak = (overrides = {}) => synthesizeSpeech({ text: "I'll tell him about it.", voiceId: JESSICA, modelId: 'eleven_v4', key: KEY, ...overrides });

async function rejection(promise) {
  const error = await promise.then(() => null, caught => caught);
  assert.ok(error instanceof SpeechError, `expected a SpeechError, got ${error}`);
  assert.equal(error.service, 'elevenlabs');
  assert.ok(!error.message.includes(KEY), 'the key must not leak into the message');
  return error;
}

test('returns the MP3 bytes with their playing time', async () => {
  const mp3 = fixtureBytes('elevenlabs', 'success.mp3');
  const { fetchImpl, calls } = fakeFetch(audioResponse(mp3));
  const audio = await speak({ fetchImpl, text: "  I'll tell him about it.\n" });
  assert.deepEqual(audio.bytes, mp3);
  assert.equal(audio.mime, 'audio/mpeg');
  assert.ok(Math.abs(audio.seconds - 1.28) < 0.0005);
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, `https://api.elevenlabs.io/v1/text-to-speech/${JESSICA}?output_format=mp3_44100_128`);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['xi-api-key'], KEY);
  assert.deepEqual(JSON.parse(init.body), { text: "I'll tell him about it.", model_id: 'eleven_v4' });
  assert.ok(init.signal instanceof AbortSignal);
});

test('recorded failures map to stable codes and keep the service\'s reason', async () => {
  const cases = [
    ['bad-key', 'invalid-key', 401, /invalid_api_key: Invalid API key/],
    ['bad-voice', 'rejected', 404, /voice_not_found/],
    ['bad-model', 'rejected', 400, /model_not_found/],
  ];
  for (const [name, code, httpStatus, reason] of cases) {
    const error = await rejection(speak({ fetchImpl: replay(recorded(name)).fetchImpl }));
    assert.deepEqual([error.code, error.httpStatus], [code, httpStatus], name);
    assert.match(error.message, reason, name);
  }
});

// These bodies are written by hand from the ElevenLabs error format, not recorded.
test('other responses map to stable codes', async () => {
  const json = (status, body) => () => new Response(JSON.stringify(body), { status });
  const cases = [
    ['out of credit', json(401, { detail: { status: 'quota_exceeded', message: 'no credits left' } }), 'quota-exceeded'],
    ['missing permission', json(401, { detail: { status: 'missing_permissions', message: 'text_to_speech' } }), 'invalid-key'],
    ['rate limit', json(429, { detail: { status: 'too_many_concurrent_requests', message: 'slow down' } }), 'rate-limited'],
    ['plain text detail', json(422, { detail: 'unprocessable' }), 'rejected'],
    ['server error without a body', () => new Response('', { status: 500 }), 'service-error'],
    ['200 that is not audio', audioResponse(new TextEncoder().encode('{"ok":true}')), 'service-error'],
    ['200 with no bytes', audioResponse(new Uint8Array(0)), 'service-error'],
  ];
  for (const [name, makeResponse, code] of cases) {
    const error = await rejection(speak({ fetchImpl: fakeFetch(makeResponse).fetchImpl }));
    assert.equal(error.code, code, name);
  }
});

test('a long reason from the service is cut short', async () => {
  const makeResponse = () => new Response(JSON.stringify({ detail: { status: 'x', message: 'm'.repeat(5000) } }), { status: 400 });
  const error = await rejection(speak({ fetchImpl: fakeFetch(makeResponse).fetchImpl }));
  assert.ok(error.message.length < 260);
});

test('unusable input is refused before any request is made', async () => {
  const cases = [
    ['empty text', { text: ' \n' }, 'invalid-input'],
    ['text too long', { text: 'a'.repeat(3001) }, 'invalid-input'],
    ['text not a string', { text: 42 }, 'invalid-input'],
    ['voice id with a path in it', { voiceId: '../v1/user/subscription' }, 'invalid-input'],
    ['voice id missing', { voiceId: undefined }, 'invalid-input'],
    ['model id with spaces', { modelId: 'eleven v4' }, 'invalid-input'],
    ['no key', { key: undefined }, 'missing-key'],
    ['key with a line break', { key: 'abc\nxi-api-key: other' }, 'invalid-key'],
  ];
  for (const [name, overrides, code] of cases) {
    const { fetchImpl, calls } = fakeFetch(audioResponse(fixtureBytes('elevenlabs', 'success.mp3')));
    const error = await rejection(speak({ fetchImpl, ...overrides }));
    assert.equal(error.code, code, name);
    assert.equal(calls.length, 0, name);
  }
});

test('a network failure is reported as unreachable', async () => {
  const error = await rejection(speak({ fetchImpl: async () => { throw new TypeError('fetch failed'); } }));
  assert.equal(error.code, 'unreachable');
});

test('a service that never answers is reported as a timeout', async () => {
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  const error = await rejection(speak({ fetchImpl: hang, timeoutMs: 20 }));
  assert.equal(error.code, 'timeout');
});
