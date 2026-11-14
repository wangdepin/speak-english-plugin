'use strict';

const { extractJson, keyWithin, cleanText, badReply } = require('./model-reply.cjs');
const { t } = require('./messages.cjs');

const MAX_SENTENCES = 60;
// Which lists each register's reply must contain, in the order they are offered to the user.
const VERSIONS = Object.freeze({ formal: ['sentences'], casual: ['brief', 'elaborate'] });

function parseSentence(item) {
  const zh = cleanText(item?.zh);
  const en = cleanText(item?.en);
  if (zh === '' || en === '') throw badReply();
  return { zh, en, keyExpression: keyWithin(en, item.key) };
}

function parseSentences(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SENTENCES) throw badReply();
  return list.map(parseSentence);
}

/**
 * Reads the model's reply for one register into
 * { versions: [{ id, sentences: [{ zh, en, keyExpression }] }] }.
 * Formal has one version ("sentences"); casual has two ("brief", "elaborate").
 * Throws an Error with a message for the user when the reply is unusable.
 */
function parseTranslation(replyText, register) {
  const expected = VERSIONS[register];
  if (!expected) throw new Error(t('场景只能是正式或口语。'));
  const reply = extractJson(String(replyText ?? ''));
  return { versions: expected.map(id => ({ id, sentences: parseSentences(reply[id]) })) };
}

module.exports = { parseTranslation, MAX_SENTENCES };
