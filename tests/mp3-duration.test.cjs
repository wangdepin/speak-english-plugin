'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mp3DurationSeconds } = require('../src/backend/speech/mp3-duration.cjs');
const { fixtureBytes } = require('./helpers.cjs');

// Expected values are what ffprobe reports for the same files.
const FFPROBE_SECONDS = [
  [['audio', 'sell-him.mp3'], 1.300317],
  [['elevenlabs', 'success.mp3'], 1.28],
];

test('mp3DurationSeconds matches ffprobe on real ElevenLabs output', () => {
  for (const [parts, expected] of FFPROBE_SECONDS) {
    const seconds = mp3DurationSeconds(fixtureBytes(...parts));
    assert.ok(Math.abs(seconds - expected) < 0.0005, `${parts.join('/')}: ${seconds} vs ${expected}`);
  }
});

test('mp3DurationSeconds counts every frame when there is no Info tag to trim by', () => {
  const bytes = fixtureBytes('elevenlabs', 'success.mp3');
  const firstFrame = bytes.indexOf(0xff, 10);
  const infoFrameLength = 417; // 128 kbps at 44.1 kHz, no padding bit
  const audioOnly = bytes.subarray(firstFrame + infoFrameLength);
  assert.ok(Math.abs(mp3DurationSeconds(audioOnly) - (50 * 1152) / 44100) < 1e-9);
});

test('mp3DurationSeconds returns null when there is no MP3 frame', () => {
  for (const bytes of [new Uint8Array(0), new TextEncoder().encode('{"detail":"not audio"}'), 'ID3', null]) {
    assert.equal(mp3DurationSeconds(bytes), null);
  }
});
