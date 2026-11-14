import { bareWord as bare, markWords } from './word-marking.js';
import { LANGUAGES } from './languages.js';

const unique = items => [...new Set(items)];

/** Whether a piece of a sentence is a word the learner can mark, and not punctuation alone. */
export const isWord = token => bare(token.text) !== '';

/**
 * A sentence that was not scored, cut into pieces: at the spaces where the language has them,
 * otherwise where the browser's word segmentation for that language puts the boundaries.
 * There, a space inside the sentence stays as a piece of its own.
 */
export function plainTokens(text, language) {
  if (LANGUAGES[language].spaced) return text.trim().split(/\s+/).map(piece => ({ text: piece, status: null }));
  const pieces = new Intl.Segmenter(language, { granularity: 'word' }).segment(text);
  return [...pieces].map(piece => ({ text: piece.segment, status: null }));
}

/**
 * Whether the pieces, put together again, are the sentence as it was written. A scored sentence is
 * not when its words did not line up with the scoring service's: then it shows the service's words.
 */
export function showsSentence(tokens, text, language) {
  const squeeze = value => value.trim().replace(/\s+/g, ' ');
  return squeeze(tokens.map(token => token.text).join(LANGUAGES[language].spaced ? ' ' : '')) === squeeze(text);
}

/**
 * A scored sentence as its words, each 'good', 'wrong' (said inaccurately) or 'missed' (not said).
 * Words the learner added are left out: they are not part of the sentence.
 */
export function scoredTokens(referenceText, assessment) {
  return markWords(referenceText, assessment).words.filter(word => word.status !== 'extra').map(word => ({ text: word.text, status: word.status }));
}

/** What the scoring found: the words that were not said and the words that were said inaccurately. */
export function scoredGaps(tokens) {
  const withStatus = status => unique(tokens.filter(token => token.status === status).map(token => bare(token.text)).filter(Boolean));
  return { notSaid: withStatus('missed'), unclear: withStatus('wrong') };
}

/**
 * The words the learner marked as not understood. `marked` holds the positions of the marked tokens;
 * marked tokens next to each other count as one phrase, also across a space.
 */
export function markedPhrases(tokens, marked, language) {
  const joiner = LANGUAGES[language].spaced ? ' ' : '';
  const phrases = [];
  let run = [];
  let spaces = [];
  const close = () => { if (run.length > 0) phrases.push(bare(run.join(joiner))); run = []; spaces = []; };
  tokens.forEach((token, index) => {
    if (marked.has(index)) { run.push(...spaces, token.text); spaces = []; }
    else if (run.length > 0 && token.text.trim() === '') spaces.push(token.text);
    else close();
  });
  close();
  return unique(phrases.filter(Boolean));
}
