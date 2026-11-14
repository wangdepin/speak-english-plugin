'use strict';

const { t, mark, LANGUAGES: INTERFACE_LANGUAGES } = require('./messages.cjs');
const { LANGUAGES, DEFAULT_NATIVE, DEFAULT_TARGET, DEFAULT_READING_SPEED, isLanguage } = require('./languages.cjs');

const VOICES = Object.freeze({ jessica: 'cgSgspJ2msm6clMCkdW9', eric: 'cjVigY5qzO86Huf0OWal' });
const TTS_MODELS = Object.freeze(['eleven_v4', 'eleven_v4_turbo', 'eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5']);

/**
 * language               interface language, 'zh' or 'en'
 * nativeLanguage         the learner's own language, in which new passages are written
 * targetLanguage         the language new passages are turned into and practised in
 * languagesConfirmed     whether the learner has confirmed or changed the two languages above
 * modelOverride          model used for translation and explanation; null follows the app's cheap slot
 * questionVoiceId        voice that asks the questions in the "respond" exercise, different from the reference voice
 * readingSpeed           what the learner reads per second in their own language (characters or words, by language), for the start limit
 * startAllowanceSeconds  thinking time added to the reading time, for the start limit
 * speakingTimeFactor     speaking limit as a multiple of the reference audio's length
 * explainAfterFailures   failures on one sentence before the plugin suggests an explanation
 */
const defaultSettings = () => ({
  language: 'zh',
  nativeLanguage: DEFAULT_NATIVE,
  targetLanguage: DEFAULT_TARGET,
  languagesConfirmed: false,
  modelOverride: null,
  ttsModel: 'eleven_v4',
  ttsVoiceId: VOICES.jessica,
  questionVoiceId: VOICES.eric,
  azureRegion: '',
  retention: 0.95,
  dailyReviewLimit: 50,
  readingSpeed: DEFAULT_READING_SPEED[LANGUAGES[DEFAULT_NATIVE].readBy],
  startAllowanceSeconds: 3,
  speakingTimeFactor: 2,
  explainAfterFailures: 3,
});

const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const wholeInRange = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const isModel = value => value !== null && typeof value === 'object' && typeof value.provider === 'string' && value.provider !== '' && typeof value.id === 'string' && value.id !== '';

// Each rule returns true when the value is acceptable; the text is shown to the user when it is not.
const isVoiceId = value => typeof value === 'string' && /^[A-Za-z0-9]{10,40}$/.test(value);

const RULES = {
  language: [value => INTERFACE_LANGUAGES.includes(value), mark('界面语言只能是中文或英文。')],
  nativeLanguage: [isLanguage, mark('不支持这种语言。')],
  targetLanguage: [isLanguage, mark('不支持这种语言。')],
  languagesConfirmed: [value => typeof value === 'boolean', mark('设置格式不对。')],
  modelOverride: [value => value === null || isModel(value), mark('翻译模型无效。')],
  ttsModel: [value => TTS_MODELS.includes(value), mark('语音模型不在支持的列表里。')],
  ttsVoiceId: [isVoiceId, mark('声音 ID 应为 10 到 40 位字母和数字。')],
  questionVoiceId: [isVoiceId, mark('声音 ID 应为 10 到 40 位字母和数字。')],
  azureRegion: [value => typeof value === 'string' && /^([a-z0-9]{3,40})?$/.test(value), mark('Azure 区域应为小写字母和数字，例如 swedencentral。')],
  retention: [value => inRange(value, 0.7, 0.99), mark('目标保持率应在 70% 到 99% 之间。')],
  dailyReviewLimit: [value => wholeInRange(value, 1, 500), mark('每日复习上限应为 1 到 500 的整数。')],
  readingSpeed: [value => inRange(value, 1, 20), mark('读题速度应在 1 到 20 之间。')],
  startAllowanceSeconds: [value => inRange(value, 0, 30), mark('思考时间应在 0 到 30 秒之间。')],
  speakingTimeFactor: [value => inRange(value, 1, 5), mark('说话时限应为原声时长的 1 到 5 倍。')],
  explainAfterFailures: [value => wholeInRange(value, 1, 20), mark('提示讲解的次数应为 1 到 20 的整数。')],
};

/**
 * Keeps the two practice languages consistent after a patch that sets one of them:
 * setting one side to the language the other side has swaps the two, while setting
 * both to the same language is refused; a new native language resets the reading
 * speed to that language's default, unless the same patch sets a speed; and any
 * change counts as confirming the pair.
 */
function settlePracticeLanguages(current, next, patch) {
  const setsNative = Object.hasOwn(patch, 'nativeLanguage');
  const setsTarget = Object.hasOwn(patch, 'targetLanguage');
  if (!setsNative && !setsTarget) return;
  if (next.nativeLanguage === next.targetLanguage) {
    if (setsNative && setsTarget) throw new Error(t('母语和学习语言不能相同。'));
    if (setsNative) next.targetLanguage = current.nativeLanguage;
    else next.nativeLanguage = current.targetLanguage;
    if (next.nativeLanguage === next.targetLanguage) throw new Error(t('母语和学习语言不能相同。'));
  }
  const changed = next.nativeLanguage !== current.nativeLanguage || next.targetLanguage !== current.targetLanguage;
  if (next.nativeLanguage !== current.nativeLanguage && !Object.hasOwn(patch, 'readingSpeed')) next.readingSpeed = DEFAULT_READING_SPEED[LANGUAGES[next.nativeLanguage].readBy];
  if (changed) next.languagesConfirmed = true;
}

/** Merges `patch` into `current` and returns the result, or throws an Error whose message names the bad field. */
function applySettingsPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(t('设置格式不对。'));
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const rule = RULES[key];
    if (!rule) throw new Error(t('不支持的设置项：{key}', { key }));
    if (!rule[0](value)) throw new Error(t(rule[1]));
    next[key] = key === 'modelOverride' && value ? { provider: value.provider, id: value.id } : value;
  }
  settlePracticeLanguages(current, next, patch);
  return next;
}

module.exports = { defaultSettings, applySettingsPatch, VOICES, TTS_MODELS };
