'use strict';

// MPEG audio, Layer III only: that is what ElevenLabs returns.
const VERSION_1 = 3;
const VERSION_RESERVED = 1;
const LAYER_3 = 1;
const BITRATES_KBPS = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
// Byte offsets inside the Xing/Info tag of the encoder delay and padding (LAME extension).
const LAME_DELAY_OFFSET = 141;

function id3v2Length(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  return 10 + (((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f));
}

/** Decodes the 4-byte frame header at `offset`, or returns null when there is none. */
function readFrameHeader(bytes, offset) {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;
  const version = (bytes[offset + 1] >> 3) & 3;
  const layer = (bytes[offset + 1] >> 1) & 3;
  const bitrateIndex = bytes[offset + 2] >> 4;
  const rateIndex = (bytes[offset + 2] >> 2) & 3;
  if (version === VERSION_RESERVED || layer !== LAYER_3 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const isVersion1 = version === VERSION_1;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const samples = isVersion1 ? 1152 : 576;
  const bitrate = BITRATES_KBPS[isVersion1 ? 'v1' : 'v2'][bitrateIndex] * 1000;
  const padding = (bytes[offset + 2] >> 1) & 1;
  const isMono = (bytes[offset + 3] >> 6) === 3;
  const sideInfoBytes = isVersion1 ? (isMono ? 17 : 32) : (isMono ? 9 : 17);
  return { sampleRate, samples, length: Math.floor((samples / 8) * bitrate / sampleRate) + padding, tagOffset: offset + 4 + sideInfoBytes };
}

/**
 * The first frame may hold no audio, only a Xing/Info tag. Returns the samples
 * the encoder says to drop (delay + padding), or null when the frame is audio.
 */
function infoFrameTrim(bytes, header) {
  const tag = String.fromCharCode(...bytes.subarray(header.tagOffset, header.tagOffset + 4));
  if (tag !== 'Xing' && tag !== 'Info') return null;
  const at = header.tagOffset + LAME_DELAY_OFFSET;
  if (at + 3 > bytes.length) return 0;
  const delay = (bytes[at] << 4) | (bytes[at + 1] >> 4);
  const padding = ((bytes[at + 1] & 0x0f) << 8) | bytes[at + 2];
  return delay + padding;
}

/**
 * Playing time of an MP3 file in seconds, read from its frame headers, or null
 * when the bytes hold no MP3 frame. Matches ffprobe on ElevenLabs output.
 */
function mp3DurationSeconds(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  let offset = id3v2Length(bytes);
  let totalSamples = 0;
  let trimmedSamples = 0;
  let sampleRate = 0;
  let framesSeen = 0;
  while (offset + 4 <= bytes.length) {
    const header = readFrameHeader(bytes, offset);
    if (!header) { offset += 1; continue; }
    const trim = framesSeen === 0 ? infoFrameTrim(bytes, header) : null;
    framesSeen += 1;
    offset += header.length;
    if (trim !== null) { trimmedSamples = trim; continue; }
    sampleRate = header.sampleRate;
    totalSamples += header.samples;
  }
  if (totalSamples === 0) return null;
  return Math.max(0, totalSamples - trimmedSamples) / sampleRate;
}

module.exports = { mp3DurationSeconds };
