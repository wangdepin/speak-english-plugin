import { mark, t } from './i18n.js';

/**
 * One language a learner can speak natively or practise, as the interface needs it.
 * name    its short name: 英语
 * region  what tells it apart from other entries of the same language, or null
 * spaced  false for scripts written without spaces between words
 * readBy  what a reading speed counts in this language: 'char' or 'word'
 */
const language = (name, region = null, { spaced = true, readBy = 'word' } = {}) => ({ name, region, spaced, readBy });
const UNSPACED = { spaced: false, readBy: 'char' };

// The same locales, in the same order, as the backend's list (a test compares the two).
export const LANGUAGES = {
  'ar-EG': language(mark('阿拉伯语'), mark('埃及')),
  'ar-SA': language(mark('阿拉伯语'), mark('沙特阿拉伯')),
  'ca-ES': language(mark('加泰罗尼亚语')),
  'zh-HK': language(mark('粤语'), mark('香港，繁体'), UNSPACED),
  'zh-CN': language(mark('中文'), mark('普通话，简体'), UNSPACED),
  'zh-TW': language(mark('中文'), mark('台湾，繁体'), UNSPACED),
  'da-DK': language(mark('丹麦语')),
  'nl-NL': language(mark('荷兰语')),
  'en-AU': language(mark('英语'), mark('澳大利亚')),
  'en-CA': language(mark('英语'), mark('加拿大')),
  'en-IN': language(mark('英语'), mark('印度')),
  'en-GB': language(mark('英语'), mark('英国')),
  'en-US': language(mark('英语'), mark('美国')),
  'fi-FI': language(mark('芬兰语')),
  'fr-CA': language(mark('法语'), mark('加拿大')),
  'fr-FR': language(mark('法语'), mark('法国')),
  'de-DE': language(mark('德语')),
  'hi-IN': language(mark('印地语')),
  'it-IT': language(mark('意大利语')),
  'ja-JP': language(mark('日语'), null, UNSPACED),
  'ko-KR': language(mark('韩语'), null, { readBy: 'char' }),
  'ms-MY': language(mark('马来语')),
  'nb-NO': language(mark('挪威语')),
  'pl-PL': language(mark('波兰语')),
  'pt-BR': language(mark('葡萄牙语'), mark('巴西')),
  'pt-PT': language(mark('葡萄牙语'), mark('葡萄牙')),
  'ru-RU': language(mark('俄语')),
  'es-MX': language(mark('西班牙语'), mark('墨西哥')),
  'es-ES': language(mark('西班牙语'), mark('西班牙')),
  'sv-SE': language(mark('瑞典语')),
  'ta-IN': language(mark('泰米尔语')),
  'th-TH': language(mark('泰语'), null, UNSPACED),
  'vi-VN': language(mark('越南语')),
};

export const LANGUAGE_CODES = Object.keys(LANGUAGES);
// What a learner reads per second in their own language, by what the speed counts.
export const DEFAULT_READING_SPEED = { char: 5, word: 3 };

/** The short name of a language, for labels: 英语. */
export const languageName = code => t(LANGUAGES[code].name);

/** The full name of a language, for choosing one: 英语（美国）. */
export function languageLabel(code) {
  const { name, region } = LANGUAGES[code];
  return region ? t('{language}（{region}）', { language: t(name), region: t(region) }) : t(name);
}

/** The dropdown options for choosing a language. */
export const languageOptions = () => LANGUAGE_CODES.map(value => ({ value, label: languageLabel(value) }));

/** How much there is to read in `text`: letters and digits, or words, by what a reading speed counts in its language. */
export function readingLength(text, code) {
  if (LANGUAGES[code].readBy === 'char') return [...text].filter(char => /[\p{L}\p{N}]/u.test(char)).length;
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}
