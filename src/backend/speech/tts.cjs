'use strict';

const { SpeechError } = require('./errors.cjs');
const { callService, requireKey } = require('./http.cjs');
const { mp3DurationSeconds } = require('./mp3-duration.cjs');

const SERVICE = 'elevenlabs';
const ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';
const OUTPUT_FORMAT = 'mp3_44100_128';
const TTS_MAX_CHARS = 3000;
const DETAIL_MAX_CHARS = 200;

function invalidInput(message) {
  return new SpeechError(SERVICE, 'invalid-input', message);
}

/** ElevenLabs synthesizes a short noise for empty text and still answers 200, so text is checked here. */
function requireText(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed === '') throw invalidInput('the text to speak is empty');
  if (trimmed.length > TTS_MAX_CHARS) throw invalidInput(`the text to speak is longer than ${TTS_MAX_CHARS} characters`);
  return trimmed;
}

/** The voice id becomes part of the URL path. */
function requireVoiceId(voiceId) {
  if (typeof voiceId !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(voiceId)) throw invalidInput('the voice id must be 10 to 40 letters and digits');
  return voiceId;
}

function requireModelId(modelId) {
  if (typeof modelId !== 'string' || !/^[a-z0-9][a-z0-9_.-]{1,60}$/.test(modelId)) throw invalidInput('the model id must look like "eleven_v4"');
  return modelId;
}

/** ElevenLabs errors arrive as { detail: { status, message } } or { detail: "text" }. */
async function readErrorDetail(response) {
  try {
    const detail = JSON.parse(await response.text())?.detail;
    if (typeof detail === 'string') return { status: '', message: detail };
    return { status: String(detail?.status ?? ''), message: String(detail?.message ?? '') };
  } catch {
    return { status: '', message: '' };
  }
}

function codeFor(httpStatus, detailStatus) {
  if (detailStatus === 'quota_exceeded') return 'quota-exceeded';
  if (httpStatus === 401 || httpStatus === 403) return 'invalid-key';
  if (httpStatus === 429) return 'rate-limited';
  if (httpStatus >= 400 && httpStatus < 500) return 'rejected';
  return 'service-error';
}

async function failureFor(response) {
  const detail = await readErrorDetail(response);
  const reason = [detail.status, detail.message].filter(Boolean).join(': ').slice(0, DETAIL_MAX_CHARS);
  return new SpeechError(SERVICE, codeFor(response.status, detail.status), `ElevenLabs failed (${response.status})${reason ? ` ${reason}` : ''}`, response.status);
}

async function readAudio(response) {
  if (!response.ok) throw await failureFor(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const seconds = mp3DurationSeconds(bytes);
  if (seconds === null) throw new SpeechError(SERVICE, 'service-error', 'ElevenLabs returned no playable MP3 audio', response.status);
  return { bytes, mime: 'audio/mpeg', seconds };
}

/**
 * Speaks `text` with one ElevenLabs voice and model.
 * Resolves to { bytes, mime, seconds } (MP3); rejects with a SpeechError.
 */
async function synthesizeSpeech({ text, voiceId, modelId, key, fetchImpl, signal, timeoutMs }) {
  const url = `${ENDPOINT}/${requireVoiceId(voiceId)}?output_format=${OUTPUT_FORMAT}`;
  const init = {
    method: 'POST',
    headers: { 'xi-api-key': requireKey(SERVICE, key), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: requireText(text), model_id: requireModelId(modelId) }),
  };
  return callService(SERVICE, url, init, readAudio, { fetchImpl, signal, timeoutMs });
}

module.exports = { synthesizeSpeech, TTS_MAX_CHARS };
