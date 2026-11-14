'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIXTURES = path.join(__dirname, 'fixtures');

function fixtureBytes(...parts) {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, ...parts)));
}

function fixtureJson(...parts) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, ...parts), 'utf8'));
}

/** A fetch stand-in that answers every call with `makeResponse()` and remembers the calls. */
function fakeFetch(makeResponse) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return makeResponse();
  };
  return { fetchImpl, calls };
}

/** Replays a recorded exchange: { status, contentType, body | bodyText }. */
function replay(recorded) {
  const text = recorded.body == null ? (recorded.bodyText ?? '') : JSON.stringify(recorded.body);
  return fakeFetch(() => new Response(text, { status: recorded.status, headers: recorded.contentType ? { 'Content-Type': recorded.contentType } : {} }));
}

/** Builds a PCM WAV file with the plain 44-byte header browsers and this plugin write. */
function makeWav({ sampleRate = 16000, channels = 1, bitsPerSample = 16, seconds = 1, audioFormat = 1 } = {}) {
  const dataBytes = Math.round(seconds * sampleRate) * channels * (bitsPerSample / 8);
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const tag = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
  tag(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true); view.setUint16(34, bitsPerSample, true);
  tag(36, 'data'); view.setUint32(40, dataBytes, true);
  return bytes;
}

module.exports = { fixtureBytes, fixtureJson, fakeFetch, replay, makeWav };
