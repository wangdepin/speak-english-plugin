'use strict';

const { SpeechError } = require('./errors.cjs');
const { requireKey } = require('./http.cjs');

const SERVICE = 'azure';
const REFERENCE_MAX_CHARS = 1000;
// Prosody scores and "sounds like" candidates exist for en-US only.
const LANGUAGE = 'en-US';
const ASSESSMENT_OPTIONS = Object.freeze({
  GradingSystem: 'HundredMark',
  Granularity: 'Phoneme',
  Dimension: 'Comprehensive',
  EnableMiscue: true,
  EnableProsodyAssessment: true,
  PhonemeAlphabet: 'IPA',
  NBestPhonemeCount: 3,
});

/** The region becomes part of the host name, so only a plain Azure region name is accepted. */
function requireRegion(region) {
  if (typeof region !== 'string' || !/^[a-z0-9]{3,40}$/.test(region)) {
    throw new SpeechError(SERVICE, 'invalid-input', 'the Azure region must be a name such as "swedencentral"');
  }
  return region;
}

function requireReferenceText(referenceText) {
  const text = typeof referenceText === 'string' ? referenceText.trim() : '';
  if (text === '') throw new SpeechError(SERVICE, 'invalid-input', 'the reference sentence is empty');
  if (text.length > REFERENCE_MAX_CHARS) throw new SpeechError(SERVICE, 'invalid-input', `the reference sentence is longer than ${REFERENCE_MAX_CHARS} characters`);
  return text;
}

function assessmentHeader(referenceText) {
  return Buffer.from(JSON.stringify({ ReferenceText: referenceText, ...ASSESSMENT_OPTIONS }), 'utf8').toString('base64');
}

/** Builds the pronunciation-assessment REST request for one 16 kHz mono PCM WAV recording. */
function buildAssessmentRequest({ key, region, referenceText, wav }) {
  const url = `https://${requireRegion(region)}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${LANGUAGE}&format=detailed`;
  const init = {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': requireKey(SERVICE, key),
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
      Accept: 'application/json',
      'Pronunciation-Assessment': assessmentHeader(requireReferenceText(referenceText)),
    },
    body: wav,
  };
  return { url, init };
}

module.exports = { buildAssessmentRequest, ASSESSMENT_OPTIONS, REFERENCE_MAX_CHARS };
