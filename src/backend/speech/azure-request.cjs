'use strict';

const { SpeechError } = require('./errors.cjs');
const { requireKey } = require('./http.cjs');

const SERVICE = 'azure';
const REFERENCE_MAX_CHARS = 1000;
const BASE_OPTIONS = Object.freeze({ GradingSystem: 'HundredMark', Granularity: 'Phoneme', Dimension: 'Comprehensive', EnableMiscue: true });
// Prosody scores, phoneme names in IPA and "sounds like" candidates exist for en-US only.
const FULL_LOCALE = 'en-US';
const FULL_OPTIONS = Object.freeze({ GradingSystem: 'HundredMark', Granularity: 'Phoneme', Dimension: 'Comprehensive', EnableMiscue: true, EnableProsodyAssessment: true, PhonemeAlphabet: 'IPA', NBestPhonemeCount: 3 });

/** What to ask the service to assess for one locale. */
const assessmentOptions = locale => (locale === FULL_LOCALE ? FULL_OPTIONS : BASE_OPTIONS);

/** The locale becomes part of the URL, so only a plain code such as "ja-JP" is accepted. */
function requireLocale(locale) {
  if (typeof locale !== 'string' || !/^[a-z]{2}-[A-Z]{2}$/.test(locale)) throw new SpeechError(SERVICE, 'invalid-input', 'the language must be a locale code such as "en-US"');
  return locale;
}

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

function assessmentHeader(referenceText, locale) {
  return Buffer.from(JSON.stringify(Object.assign({ ReferenceText: referenceText }, assessmentOptions(locale))), 'utf8').toString('base64');
}

/** Builds the pronunciation-assessment REST request for one 16 kHz mono PCM WAV recording of speech in `locale`. */
function buildAssessmentRequest({ key, region, locale, referenceText, wav }) {
  const url = `https://${requireRegion(region)}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${requireLocale(locale)}&format=detailed`;
  const init = {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': requireKey(SERVICE, key),
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
      Accept: 'application/json',
      'Pronunciation-Assessment': assessmentHeader(requireReferenceText(referenceText), locale),
    },
    body: wav,
  };
  return { url, init };
}

module.exports = { buildAssessmentRequest, assessmentOptions, REFERENCE_MAX_CHARS };
