'use strict';

const { t } = require('./messages.cjs');

/**
 * One language a learner can speak natively or practise.
 * name    how prompts refer to it in passing ("a passage in Chinese")
 * full    how prompts name it as the language to produce ("authentic American English")
 * tts     the language code the speech synthesis service expects
 * spaced  false for scripts written without spaces between words
 * readBy  what a reading speed counts in this language: 'char' or 'word'
 */
const language = (name, full, tts, { spaced = true, readBy = 'word' } = {}) => Object.freeze({ name, full, tts, spaced, readBy });
const UNSPACED = { spaced: false, readBy: 'char' };

// The locales the pronunciation scoring service supports, keyed by its locale code.
const LANGUAGES = Object.freeze({
  'ar-EG': language('Arabic', 'Egyptian Arabic', 'ar'),
  'ar-SA': language('Arabic', 'Saudi Arabic', 'ar'),
  'ca-ES': language('Catalan', 'Catalan', 'ca'),
  'zh-HK': language('Cantonese', 'Hong Kong Cantonese, written in traditional characters', 'yue', UNSPACED),
  'zh-CN': language('Chinese', 'Mandarin Chinese, written in simplified characters', 'zh', UNSPACED),
  'zh-TW': language('Chinese', 'Taiwanese Mandarin, written in traditional characters', 'zh', UNSPACED),
  'da-DK': language('Danish', 'Danish', 'da'),
  'nl-NL': language('Dutch', 'Dutch', 'nl'),
  'en-AU': language('English', 'Australian English', 'en'),
  'en-CA': language('English', 'Canadian English', 'en'),
  'en-IN': language('English', 'Indian English', 'en'),
  'en-GB': language('English', 'British English', 'en'),
  'en-US': language('English', 'American English', 'en'),
  'fi-FI': language('Finnish', 'Finnish', 'fi'),
  'fr-CA': language('French', 'Canadian French', 'fr'),
  'fr-FR': language('French', 'French as spoken in France', 'fr'),
  'de-DE': language('German', 'German', 'de'),
  'hi-IN': language('Hindi', 'Hindi', 'hi'),
  'it-IT': language('Italian', 'Italian', 'it'),
  'ja-JP': language('Japanese', 'Japanese', 'ja', UNSPACED),
  'ko-KR': language('Korean', 'Korean', 'ko', { readBy: 'char' }),
  'ms-MY': language('Malay', 'Malay', 'ms'),
  'nb-NO': language('Norwegian', 'Norwegian Bokmål', 'no'),
  'pl-PL': language('Polish', 'Polish', 'pl'),
  'pt-BR': language('Portuguese', 'Brazilian Portuguese', 'pt'),
  'pt-PT': language('Portuguese', 'European Portuguese', 'pt'),
  'ru-RU': language('Russian', 'Russian', 'ru'),
  'es-MX': language('Spanish', 'Mexican Spanish', 'es'),
  'es-ES': language('Spanish', 'European Spanish', 'es'),
  'sv-SE': language('Swedish', 'Swedish', 'sv'),
  'ta-IN': language('Tamil', 'Tamil', 'ta'),
  'th-TH': language('Thai', 'Thai', 'th', UNSPACED),
  'vi-VN': language('Vietnamese', 'Vietnamese', 'vi'),
});

const LANGUAGE_CODES = Object.freeze(Object.keys(LANGUAGES));
const DEFAULT_NATIVE = 'zh-CN';
const DEFAULT_TARGET = 'en-US';
// What a learner reads per second in their own language, by what the speed counts.
const DEFAULT_READING_SPEED = Object.freeze({ char: 5, word: 3 });

const isLanguage = code => typeof code === 'string' && Object.hasOwn(LANGUAGES, code);

/** The language with this code, or an Error with a message for the user. */
function requireLanguage(code) {
  if (!isLanguage(code)) throw new Error(t('不支持这种语言。'));
  return LANGUAGES[code];
}

/** Checks a native/target pair and returns it. The two must be supported and different. */
function requirePair(nativeLanguage, targetLanguage) {
  requireLanguage(nativeLanguage);
  requireLanguage(targetLanguage);
  if (nativeLanguage === targetLanguage) throw new Error(t('母语和学习语言不能相同。'));
  return { nativeLanguage, targetLanguage };
}

/** The pair whose prompts the user approved word for word; every other pair uses the general wording. */
const isOriginalPair = (nativeLanguage, targetLanguage) => nativeLanguage === DEFAULT_NATIVE && targetLanguage === DEFAULT_TARGET;

/** A language's name with its article, for prompts: "an English", "a Chinese". */
const withArticle = name => `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;

/** The field names a model reply uses for the two languages: the original pair's prompts say "zh" and "en". */
const replyKeys = (nativeLanguage, targetLanguage) => (isOriginalPair(nativeLanguage, targetLanguage) ? { native: 'zh', target: 'en' } : { native: 'native', target: 'target' });

/** Sentences put back together as running text: with spaces where the language uses them. */
const joinSentences = (sentences, code) => sentences.join(requireLanguage(code).spaced ? ' ' : '');

/** How long a text is in the unit that suits its language: words where words are spaced, otherwise letters and digits. */
function textLength(text, code) {
  if (requireLanguage(code).spaced) return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  return [...text].filter(char => /[\p{L}\p{N}]/u.test(char)).length;
}

module.exports = { LANGUAGES, LANGUAGE_CODES, DEFAULT_NATIVE, DEFAULT_TARGET, DEFAULT_READING_SPEED, isLanguage, requireLanguage, requirePair, isOriginalPair, withArticle, replyKeys, joinSentences, textLength };
