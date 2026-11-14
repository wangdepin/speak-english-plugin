'use strict';

const { t } = require('./messages.cjs');

/** The error for a model reply that is not in the expected format. */
const badReply = () => new Error(t('模型返回的内容不是预期的格式，请再试一次。'));

const cleanText = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * The text of a model reply. `task` names what was asked ("翻译", "讲解") for the
 * message when the model stopped with an error or ran into the output limit.
 */
function replyText(message, task) {
  if (message?.stopReason === 'error' || message?.stopReason === 'aborted') throw new Error(t('{task}没有完成：{detail}', { task, detail: message.errorMessage || message.stopReason }));
  if (message?.stopReason === 'length') throw new Error(t('{task}的回复太长，被截断了。请再试一次，或在设置里换一个模型。', { task }));
  const parts = Array.isArray(message?.content) ? message.content : [];
  return parts.filter(part => part.type === 'text').map(part => part.text).join('');
}

/** Models sometimes wrap JSON in a code fence or a sentence; take the outermost object. */
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw badReply();
  try { return JSON.parse(text.slice(start, end + 1)); } catch { throw badReply(); }
}

/** A key expression is only useful if it can be found, and bolded, in the sentence. Returns it as spelled there, or ''. */
function keyWithin(sentence, key) {
  const cleaned = cleanText(key);
  const at = cleaned === '' ? -1 : sentence.toLowerCase().indexOf(cleaned.toLowerCase());
  return at < 0 ? '' : sentence.slice(at, at + cleaned.length);
}

module.exports = { replyText, extractJson, keyWithin, cleanText, badReply };
