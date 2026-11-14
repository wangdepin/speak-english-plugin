'use strict';

// A phoneme scoring below this is "weak" (same threshold as speechcoach).
const WEAK_PHONEME_THRESHOLD = 60;

function scoreOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The sound Azure thinks was actually produced, reported only for a weak
 * phoneme whose best candidate differs from the expected one. Candidates for
 * well-scored phonemes are noise from legitimate accent variants.
 */
function soundsLike(phoneme, isWeak) {
  if (!isWeak) return null;
  const heard = phoneme.NBestPhonemes?.[0]?.Phoneme;
  return typeof heard === 'string' && heard !== '' && heard !== phoneme.Phoneme ? heard : null;
}

function parsePhoneme(phoneme) {
  const accuracy = scoreOrNull(phoneme.AccuracyScore);
  const weak = accuracy !== null && accuracy < WEAK_PHONEME_THRESHOLD;
  return { expected: String(phoneme.Phoneme ?? ''), accuracy, weak, soundsLike: soundsLike(phoneme, weak) };
}

/** Only en-US and zh-CN name their phonemes. A sound without a name cannot be shown to the learner, so it is left out. */
const isNamed = phoneme => phoneme.expected !== '';

function parseWord(word) {
  return {
    word: String(word.Word ?? ''),
    errorType: typeof word.ErrorType === 'string' ? word.ErrorType : 'None',
    accuracy: scoreOrNull(word.AccuracyScore),
    phonemes: Array.isArray(word.Phonemes) ? word.Phonemes.map(parsePhoneme).filter(isNamed) : [],
  };
}

/**
 * Turns the REST response body into the plugin's shape, or returns null when
 * the body carries no assessment. The REST API puts scores directly on
 * NBest[0], each word and each phoneme (the SDKs nest them one level deeper).
 * `errorType` keeps Azure's word: None, Mispronunciation, Omission, Insertion.
 */
function parseAssessment(body) {
  const best = body?.NBest?.[0];
  if (!best || !Array.isArray(best.Words)) return null;
  return {
    recognizedText: String(best.Display ?? ''),
    scores: {
      overall: scoreOrNull(best.PronScore),
      accuracy: scoreOrNull(best.AccuracyScore),
      fluency: scoreOrNull(best.FluencyScore),
      completeness: scoreOrNull(best.CompletenessScore),
      prosody: scoreOrNull(best.ProsodyScore),
    },
    words: best.Words.map(parseWord),
  };
}

/** True when not one reference word was heard: silence, noise, or bytes Azure could not decode. */
function heardNothing(assessment) {
  return assessment.words.every(word => word.errorType === 'Omission');
}

module.exports = { parseAssessment, heardNothing, WEAK_PHONEME_THRESHOLD };
