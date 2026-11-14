'use strict';

const { t } = require('./messages.cjs');

const own = (map, id) => (typeof id === 'string' && Object.hasOwn(map, id) ? map[id] : null);

/** Returns the sentence with this id or throws a message for the user. */
function requireSentence(state, sentenceId) {
  const sentence = own(state.sentences, sentenceId);
  if (!sentence) throw new Error(t('找不到这一句。'));
  return sentence;
}

/** Returns the passage with this id or throws a message for the user. */
function requirePassage(state, passageId) {
  const passage = own(state.passages, passageId);
  if (!passage) throw new Error(t('找不到这一段。'));
  return passage;
}

module.exports = { requireSentence, requirePassage };
