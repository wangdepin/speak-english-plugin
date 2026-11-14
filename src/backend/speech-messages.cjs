'use strict';

const { SpeechError } = require('./speech/errors.cjs');
const { t, mark } = require('./messages.cjs');

const SERVICE_NAMES = { azure: mark('Azure 语音'), elevenlabs: 'ElevenLabs' };

// Each text may name the service as {name}.
const MESSAGES = {
  'missing-key': mark('还没有填 {name} 的密钥，请到插件设置里填写。'),
  'invalid-key': mark('{name} 不接受这把密钥。请检查密钥是否填对、是否有相应权限。'),
  'quota-exceeded': mark('{name} 账户的额度用完了。'),
  'rate-limited': mark('{name} 说请求太频繁，请稍等再试。'),
  rejected: mark('{name} 拒绝了这次请求，请检查设置里的声音、模型或区域。'),
  'bad-audio': mark('这段录音没法评分。'),
  'no-speech': mark('没有听到这句话，请靠近麦克风再说一遍。'),
  unreachable: mark('连不上 {name}，请检查网络。'),
  timeout: mark('{name} 太久没有回应，请再试一次。'),
  'service-error': mark('{name} 出错了，请稍后再试。'),
  'invalid-input': mark('发给语音服务的内容不对。'),
};

/**
 * Rewrites a SpeechError as an Error whose message can be shown to the user;
 * the technical detail follows in parentheses. Other errors pass through.
 */
function userFacingError(error) {
  if (!(error instanceof SpeechError)) return error;
  const name = t(SERVICE_NAMES[error.service] ?? error.service);
  const message = t(MESSAGES[error.code] ?? MESSAGES['service-error'], { name });
  return new Error(t('{message}（{detail}）', { message, detail: error.message }), { cause: error });
}

module.exports = { userFacingError };
