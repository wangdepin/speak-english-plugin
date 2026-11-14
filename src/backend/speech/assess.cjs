'use strict';

const { SpeechError } = require('./errors.cjs');
const { callService } = require('./http.cjs');
const { assessableWavProblem } = require('./wav.cjs');
const { buildAssessmentRequest } = require('./azure-request.cjs');
const { parseAssessment, heardNothing } = require('./azure-parse.cjs');

const SERVICE = 'azure';
const NOTHING_HEARD_STATUSES = new Set(['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout']);

function failureFor(status) {
  if (status === 401 || status === 403) return new SpeechError(SERVICE, 'invalid-key', `Azure refused the key (${status})`, status);
  if (status === 429) return new SpeechError(SERVICE, 'rate-limited', 'Azure is rate limiting this key (429)', status);
  if (status >= 400 && status < 500) return new SpeechError(SERVICE, 'rejected', `Azure refused the request (${status})`, status);
  return new SpeechError(SERVICE, 'service-error', `Azure failed (${status})`, status);
}

async function readAssessment(response) {
  if (!response.ok) throw failureFor(response.status);
  let body;
  try {
    body = JSON.parse(await response.text());
  } catch {
    throw new SpeechError(SERVICE, 'service-error', 'Azure returned a response that is not JSON', response.status);
  }
  if (NOTHING_HEARD_STATUSES.has(body?.RecognitionStatus)) throw new SpeechError(SERVICE, 'no-speech', `Azure heard no speech (${body.RecognitionStatus})`, response.status);
  const assessment = body?.RecognitionStatus === 'Success' ? parseAssessment(body) : null;
  if (!assessment) throw new SpeechError(SERVICE, 'service-error', `Azure returned no assessment (${String(body?.RecognitionStatus)})`, response.status);
  if (heardNothing(assessment)) throw new SpeechError(SERVICE, 'no-speech', 'Azure heard none of the reference words', response.status);
  return assessment;
}

/**
 * Scores one recording against the sentence the speaker meant to say, in the language `locale` names.
 * `wav` is 16 kHz mono 16-bit PCM WAV bytes, at most 30 seconds.
 * Resolves to { recognizedText, scores, words }; rejects with a SpeechError.
 */
async function assessPronunciation({ wav, referenceText, locale, key, region, fetchImpl, signal, timeoutMs }) {
  const { url, init } = buildAssessmentRequest({ key, region, locale, referenceText, wav });
  const problem = assessableWavProblem(wav);
  if (problem) throw new SpeechError(SERVICE, 'bad-audio', `the recording cannot be scored: ${problem}`);
  return callService(SERVICE, url, init, readAssessment, { fetchImpl, signal, timeoutMs });
}

module.exports = { assessPronunciation };
