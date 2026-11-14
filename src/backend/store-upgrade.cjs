'use strict';

const { DEFAULT_NATIVE, DEFAULT_TARGET } = require('./languages.cjs');

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Moves `record[from]` to `record[to]`, when it is there. */
function rename(record, from, to) {
  if (!isRecord(record) || !Object.hasOwn(record, from)) return;
  record[to] = record[from];
  delete record[from];
}

function upgradeSentence(sentence) {
  rename(sentence, 'zh', 'native');
  rename(sentence, 'en', 'target');
  rename(sentence.explanation?.simpler, 'en', 'target');
  const split = sentence.explanation?.split;
  for (const part of Array.isArray(split) ? split : []) { rename(part, 'zh', 'native'); rename(part, 'en', 'target'); }
}

function upgradePassage(passage) {
  rename(passage, 'chinese', 'source');
  passage.nativeLanguage = DEFAULT_NATIVE;
  passage.targetLanguage = DEFAULT_TARGET;
  for (const question of Array.isArray(passage.questions) ? passage.questions : []) { rename(question, 'zh', 'native'); rename(question, 'en', 'target'); }
}

/**
 * Version 1 knew one language pair, Chinese to English, and named its fields
 * after it. Version 2 names them after their role and records each passage's
 * languages. Changes `state` in place.
 */
function upgradeFromVersion1(state) {
  for (const sentence of Object.values(state.sentences).filter(isRecord)) upgradeSentence(sentence);
  for (const passage of Object.values(state.passages).filter(isRecord)) upgradePassage(passage);
  rename(state.settings, 'readingCharsPerSecond', 'readingSpeed');
  state.version = 2;
}

module.exports = { upgradeFromVersion1 };
