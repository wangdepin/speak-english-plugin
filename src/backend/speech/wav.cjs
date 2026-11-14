'use strict';

const PCM_FORMAT = 1;
const ASSESSABLE_SAMPLE_RATE = 16_000;
const ASSESSABLE_MAX_SECONDS = 30;

function tagAt(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function readFormatChunk(view, offset) {
  return {
    audioFormat: view.getUint16(offset, true),
    channels: view.getUint16(offset + 2, true),
    sampleRate: view.getUint32(offset + 4, true),
    bitsPerSample: view.getUint16(offset + 14, true),
  };
}

/**
 * Reads the header of a RIFF/WAVE file by walking its chunks (headers are not
 * always 44 bytes). Returns null when the bytes are not a readable WAV file.
 */
function describeWav(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  if (tagAt(bytes, 0) !== 'RIFF' || tagAt(bytes, 8) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = tagAt(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.length) format = readFormatChunk(view, body);
    if (id === 'data') return format ? withDuration(format, Math.min(size, bytes.length - body)) : null;
    offset = body + size + (size % 2);
  }
  return null;
}

function withDuration(format, dataBytes) {
  const bytesPerSecond = format.sampleRate * format.channels * (format.bitsPerSample / 8);
  return { ...format, dataBytes, seconds: bytesPerSecond > 0 ? dataBytes / bytesPerSecond : 0 };
}

/**
 * Says why a recording cannot be sent for pronunciation assessment, or returns
 * null when it can. Azure answers "nothing was said" for bytes it cannot
 * decode, so the format has to be checked here.
 */
function assessableWavProblem(bytes) {
  const wav = describeWav(bytes);
  if (!wav) return 'not a WAV file';
  if (wav.audioFormat !== PCM_FORMAT) return `not PCM (format ${wav.audioFormat})`;
  if (wav.channels !== 1) return `${wav.channels} channels, expected mono`;
  if (wav.sampleRate !== ASSESSABLE_SAMPLE_RATE) return `${wav.sampleRate} Hz, expected ${ASSESSABLE_SAMPLE_RATE} Hz`;
  if (wav.bitsPerSample !== 16) return `${wav.bitsPerSample}-bit, expected 16-bit`;
  if (wav.dataBytes === 0) return 'the recording is empty';
  if (wav.seconds > ASSESSABLE_MAX_SECONDS) return `${wav.seconds.toFixed(1)} s long, the limit is ${ASSESSABLE_MAX_SECONDS} s`;
  return null;
}

module.exports = { describeWav, assessableWavProblem, ASSESSABLE_SAMPLE_RATE, ASSESSABLE_MAX_SECONDS };
