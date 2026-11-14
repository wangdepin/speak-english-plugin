'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeWav, assessableWavProblem } = require('../src/backend/speech/wav.cjs');
const { fixtureBytes, makeWav } = require('./helpers.cjs');

test('describeWav reads a real file whose fmt chunk is 18 bytes, not 16', () => {
  const wav = describeWav(fixtureBytes('audio', 'tell-him-16k.wav'));
  assert.deepEqual({ ...wav, seconds: Number(wav.seconds.toFixed(3)) }, {
    audioFormat: 1, channels: 1, sampleRate: 16000, bitsPerSample: 16, dataBytes: 65664, seconds: 2.052,
  });
});

test('describeWav reads the plain 44-byte header', () => {
  const wav = describeWav(makeWav({ seconds: 1.5 }));
  assert.equal(wav.seconds, 1.5);
  assert.equal(wav.dataBytes, 48000);
});

test('describeWav trusts the bytes present when the data chunk claims more', () => {
  const truncated = makeWav({ seconds: 2 }).subarray(0, 44 + 16000);
  assert.equal(describeWav(truncated).seconds, 0.5);
});

test('describeWav returns null for anything that is not a readable WAV', () => {
  const noDataChunk = makeWav({ seconds: 1 }).subarray(0, 36);
  for (const bytes of [new Uint8Array(0), fixtureBytes('audio', 'sell-him.mp3'), noDataChunk, 'RIFF', null]) {
    assert.equal(describeWav(bytes), null);
  }
});

test('assessableWavProblem accepts 16 kHz mono 16-bit PCM up to 30 seconds', () => {
  assert.equal(assessableWavProblem(fixtureBytes('audio', 'tell-him-16k.wav')), null);
  assert.equal(assessableWavProblem(makeWav({ seconds: 30 })), null);
});

test('assessableWavProblem names what is wrong', () => {
  const cases = [
    ['mp3 bytes', fixtureBytes('audio', 'sell-him.mp3'), /not a WAV file/],
    ['float samples', makeWav({ audioFormat: 3 }), /not PCM/],
    ['stereo', makeWav({ channels: 2 }), /2 channels/],
    ['48 kHz', makeWav({ sampleRate: 48000 }), /48000 Hz/],
    ['8-bit', makeWav({ bitsPerSample: 8 }), /8-bit/],
    ['empty', makeWav({ seconds: 0 }), /empty/],
    ['too long', makeWav({ seconds: 30.5 }), /30\.5 s long/],
  ];
  for (const [name, bytes, expected] of cases) assert.match(assessableWavProblem(bytes), expected, name);
});
