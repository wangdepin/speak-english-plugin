'use strict';

const { translationSystemPrompt, translationUserPrompt } = require('./translate-prompts.cjs');
const { parseTranslation } = require('./translate-parse.cjs');
const { replyText } = require('./model-reply.cjs');
const { requirePair, replyKeys } = require('./languages.cjs');
const { t } = require('./messages.cjs');

const PASSAGE_MAX_CHARS = 2000;
const REPLY_MAX_TOKENS = 4000;

function requirePassage(source) {
  const text = typeof source === 'string' ? source.trim() : '';
  if (text === '') throw new Error(t('请先写下想说的话。'));
  if (text.length > PASSAGE_MAX_CHARS) throw new Error(t('这段话超过 {max} 字了，请分成几段录入。', { max: PASSAGE_MAX_CHARS }));
  return text;
}

/** The model to use: the plugin's own override, otherwise the app's cheap slot. */
async function resolveModel(inference, settings) {
  const catalog = await inference.catalog();
  const pin = settings.modelOverride ? { model: settings.modelOverride } : catalog.slots?.cheap;
  if (!pin?.model) throw new Error(t('还没有可用的模型。请在应用设置里配置 cheap 档模型，或在本插件的设置里指定翻译模型。'));
  const known = catalog.models.some(model => model.provider === pin.model.provider && model.id === pin.model.id);
  if (!known) throw new Error(t('选定的翻译模型现在不可用，请在设置里换一个。'));
  return { provider: pin.model.provider, id: pin.model.id, ...(pin.thinkingLevel ? { thinkingLevel: pin.thinkingLevel } : {}) };
}

/**
 * Turns a passage in the learner's own language into sentence-aligned text in the language they practise,
 * for one register. The two languages are the ones in the settings; the result names them, so the passage
 * can be saved under the pair it was translated for:
 * { nativeLanguage, targetLanguage, versions: [{ id, sentences: [{ native, target, keyExpression }] }] }.
 */
async function translatePassage({ inference, settings, register, text, signal }) {
  const { nativeLanguage, targetLanguage } = requirePair(settings.nativeLanguage, settings.targetLanguage);
  const systemPrompt = translationSystemPrompt(register, nativeLanguage, targetLanguage);
  const passage = requirePassage(text);
  const model = await resolveModel(inference, settings);
  const message = await inference.complete({
    model,
    purpose: 'user',
    context: { systemPrompt, messages: [{ role: 'user', content: translationUserPrompt(passage, nativeLanguage), timestamp: Date.now() }] },
    options: { maxTokens: REPLY_MAX_TOKENS },
    signal,
  });
  const { versions } = parseTranslation(replyText(message, t('翻译')), register, replyKeys(nativeLanguage, targetLanguage));
  return { nativeLanguage, targetLanguage, versions };
}

module.exports = { translatePassage, resolveModel, PASSAGE_MAX_CHARS };
