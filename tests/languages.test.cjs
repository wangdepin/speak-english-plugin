'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LANGUAGES, LANGUAGE_CODES, DEFAULT_NATIVE, DEFAULT_TARGET, DEFAULT_READING_SPEED,
  isLanguage, requireLanguage, requirePair, isOriginalPair, replyKeys, joinSentences, textLength,
} = require('../src/backend/languages.cjs');

const UNSPACED = ['zh-CN', 'zh-TW', 'zh-HK', 'ja-JP', 'th-TH'];
const READ_BY_CHARACTER = [...UNSPACED, 'ko-KR'];

test('every language is a locale code with the names and the speech code the prompts and services need', () => {
  assert.equal(LANGUAGE_CODES.length, 33);
  assert.deepEqual(LANGUAGE_CODES, Object.keys(LANGUAGES));
  for (const code of LANGUAGE_CODES) {
    const language = LANGUAGES[code];
    assert.match(code, /^[a-z]{2}-[A-Z]{2}$/);
    for (const field of ['name', 'full']) assert.ok(typeof language[field] === 'string' && language[field].trim() !== '', `${code} ${field}`);
    assert.match(language.tts, /^[a-z]{2,3}$/, code);
    assert.equal(language.spaced, !UNSPACED.includes(code), `${code} spaced`);
    assert.equal(language.readBy, READ_BY_CHARACTER.includes(code) ? 'char' : 'word', `${code} readBy`);
  }
});

test('the defaults are the original pair, read at five characters or three words a second', () => {
  assert.deepEqual([DEFAULT_NATIVE, DEFAULT_TARGET], ['zh-CN', 'en-US']);
  assert.deepEqual(DEFAULT_READING_SPEED, { char: 5, word: 3 });
});

test('only the listed codes are languages', () => {
  for (const code of ['zh-CN', 'en-US', 'ja-JP', 'zh-HK']) assert.equal(isLanguage(code), true, code);
  for (const code of ['zh', 'en-us', 'EN-US', 'xx-XX', 'toString', '__proto__', '', null, undefined, 5]) {
    assert.equal(isLanguage(code), false, String(code));
    assert.throws(() => requireLanguage(code), /不支持这种语言/, String(code));
  }
  assert.equal(requireLanguage('ja-JP'), LANGUAGES['ja-JP']);
});

test('a pair is two supported languages that differ', () => {
  assert.deepEqual(requirePair('en-US', 'ja-JP'), { nativeLanguage: 'en-US', targetLanguage: 'ja-JP' });
  assert.deepEqual(requirePair('zh-CN', 'zh-HK'), { nativeLanguage: 'zh-CN', targetLanguage: 'zh-HK' });
  const refused = [
    ['xx-XX', 'en-US', /不支持这种语言/], ['zh-CN', 'english', /不支持这种语言/], [undefined, 'en-US', /不支持这种语言/],
    ['zh-CN', undefined, /不支持这种语言/], ['en-US', 'en-US', /母语和学习语言不能相同/],
  ];
  for (const [nativeLanguage, targetLanguage, expected] of refused) assert.throws(() => requirePair(nativeLanguage, targetLanguage), expected, `${nativeLanguage} → ${targetLanguage}`);
});

test('only zh-CN → en-US is the original pair, and only its replies use the keys "zh" and "en"', () => {
  const cases = [
    ['zh-CN', 'en-US', true], ['en-US', 'zh-CN', false], ['zh-CN', 'en-GB', false], ['zh-TW', 'en-US', false], ['en-US', 'ja-JP', false],
  ];
  for (const [nativeLanguage, targetLanguage, original] of cases) {
    const pair = `${nativeLanguage} → ${targetLanguage}`;
    assert.equal(isOriginalPair(nativeLanguage, targetLanguage), original, pair);
    assert.deepEqual(replyKeys(nativeLanguage, targetLanguage), original ? { native: 'zh', target: 'en' } : { native: 'native', target: 'target' }, pair);
  }
});

test('text length counts words where words are spaced, otherwise letters and digits without punctuation or combining marks', () => {
  const cases = [
    ['en-US', "I can't believe I pulled it off.", 7],
    ['en-US', '  spread   out \n words ', 3],
    ['en-US', '   ', 0],
    ['de-DE', 'Heute ist schönes Wetter.', 4],
    ['ko-KR', '오늘 날씨가 좋아요.', 3],
    ['ja-JP', '今日は、いい天気です。', 9],
    ['ja-JP', 'やり遂げた ！', 5],
    ['zh-CN', '这事挺难，但我做成了 2 次。', 11],
    ['zh-CN', '。，！', 0],
    ['th-TH', 'วันนี้ 5', 4],
  ];
  for (const [code, text, expected] of cases) assert.equal(textLength(text, code), expected, `${code}: ${text}`);
  assert.throws(() => textLength('text', 'xx-XX'), /不支持这种语言/);
});

test('sentences are joined with a space only where the language uses spaces', () => {
  const cases = [
    ['en-US', ['Nailed it.', "I'm stoked."], "Nailed it. I'm stoked."],
    ['ko-KR', ['해냈어요.', '기뻐요.'], '해냈어요. 기뻐요.'],
    ['ja-JP', ['やり遂げました。', '嬉しいです。'], 'やり遂げました。嬉しいです。'],
    ['zh-CN', ['我搞定了。', '挺开心的。'], '我搞定了。挺开心的。'],
    ['en-US', ['Only one.'], 'Only one.'],
    ['ja-JP', [], ''],
  ];
  for (const [code, sentences, expected] of cases) assert.equal(joinSentences(sentences, code), expected, `${code}: ${expected}`);
  assert.throws(() => joinSentences(['text'], 'xx-XX'), /不支持这种语言/);
});
