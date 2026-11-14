import { t } from './i18n.js';

const STATUS_BY_ERROR = { None: 'good', Omission: 'missed', Insertion: 'extra' };
const EDGE_PUNCTUATION = /^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu;

/** A word without the punctuation around it. Marks that belong to its letters stay. */
export const bareWord = text => text.replace(EDGE_PUNCTUATION, '');

/**
 * Text to show for each assessed word. The scoring service returns lower-cased
 * words without punctuation; when they line up one-to-one with the reference
 * sentence's words, the reference spelling is shown instead. Words the speaker
 * added ("Insertion") have no counterpart in the reference and keep their own text.
 * A sentence written without spaces never lines up, so it is shown as the service divided it.
 */
function displayTexts(referenceText, words) {
  const tokens = referenceText.trim().split(/\s+/);
  const expected = words.filter(word => word.errorType !== 'Insertion');
  if (tokens.length !== expected.length) return words.map(word => word.word);
  let next = 0;
  return words.map(word => (word.errorType === 'Insertion' ? word.word : tokens[next++]));
}

/**
 * Turns an assessment into what the learner sees: each word as 'good', 'wrong',
 * 'missed' or 'extra', plus one hint per weak phoneme. A hint says what the sound
 * resembled, when the service could tell, never that it was "wrong":
 * ordinary accent variants are flagged too.
 */
export function markWords(referenceText, assessment) {
  const texts = displayTexts(referenceText, assessment.words);
  const words = assessment.words.map((word, index) => ({ text: texts[index], status: STATUS_BY_ERROR[word.errorType] ?? 'wrong' }));
  const hints = assessment.words.flatMap((word, index) => word.phonemes
    .filter(phoneme => phoneme.weak)
    .map(phoneme => ({ word: bareWord(texts[index]), expected: phoneme.expected, soundsLike: phoneme.soundsLike })));
  return { words, hints };
}

export function hintText(hint) {
  return hint.soundsLike
    ? t('{word}：/{expected}/ 听起来像 /{soundsLike}/', hint)
    : t('{word}：/{expected}/ 不够清楚', hint);
}

/** The scores in one line. Prosody is scored for American English only and is left out where there is none. */
export function scoreLine(scores) {
  const show = value => (value === null || value === undefined ? '—' : String(value));
  const shown = { overall: show(scores.overall), accuracy: show(scores.accuracy), fluency: show(scores.fluency), completeness: show(scores.completeness), prosody: show(scores.prosody) };
  if (scores.prosody === null || scores.prosody === undefined) return t('总分 {overall} · 准确 {accuracy} · 流利 {fluency} · 完整 {completeness}', shown);
  return t('总分 {overall} · 准确 {accuracy} · 流利 {fluency} · 完整 {completeness} · 韵律 {prosody}', shown);
}
