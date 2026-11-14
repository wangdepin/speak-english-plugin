'use strict';

const { extractJson, keyWithin, cleanText, badReply } = require('./model-reply.cjs');
const { t } = require('./messages.cjs');

const MAX_SENTENCES = 60;
// Which lists each register's reply must contain, in the order they are offered to the user.
const VERSIONS = Object.freeze({ formal: ['sentences'], casual: ['brief', 'elaborate'] });

function parseSentence(item, keys) {
  const native = cleanText(item?.[keys.native]);
  const target = cleanText(item?.[keys.target]);
  if (native === '' || target === '') throw badReply();
  return { native, target, keyExpression: keyWithin(target, item.key) };
}

function parseSentences(list, keys) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SENTENCES) throw badReply();
  return list.map(item => parseSentence(item, keys));
}

/**
 * Reads the model's reply for one register into
 * { versions: [{ id, sentences: [{ native, target, keyExpression }] }] }.
 * Formal has one version ("sentences"); casual has two ("brief", "elaborate").
 * `keys` names the reply's fields for the two languages: { native, target }.
 * Throws an Error with a message for the user when the reply is unusable.
 */
function parseTranslation(replyText, register, keys) {
  const expected = VERSIONS[register];
  if (!expected) throw new Error(t('场景只能是正式或口语。'));
  const reply = extractJson(String(replyText ?? ''));
  return { versions: expected.map(id => ({ id, sentences: parseSentences(reply[id], keys) })) };
}

module.exports = { parseTranslation, MAX_SENTENCES };
