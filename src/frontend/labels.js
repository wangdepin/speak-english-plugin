import { locale, mark, t } from './i18n.js';
import { languageName } from './languages.js';

export const REGISTER_LABELS = { formal: mark('正式（组会）'), casual: mark('口语（闲聊）') };
export const VERSION_LABELS = { sentences: '', brief: mark('简短版'), elaborate: mark('展开版') };

/** What a card says above its cue: the setting the sentence is for, and the language to say it in. */
export const cueHeading = passage => `${t('场景：{register}', { register: t(REGISTER_LABELS[passage.register]) })} · ${languageName(passage.targetLanguage)}`;

export function passageDate(createdAt) {
  return new Date(createdAt).toLocaleDateString(locale(), { month: 'long', day: 'numeric' });
}

export function passageSummary(passage) {
  const withAudio = passage.sentences.filter(sentence => sentence.audio).length;
  const parts = [passageDate(passage.createdAt), languageName(passage.targetLanguage), t(REGISTER_LABELS[passage.register]), t(VERSION_LABELS[passage.version]), t('{count} 句', { count: passage.sentences.length })];
  if (withAudio < passage.sentences.length) parts.push(t('语音 {done}/{total}', { done: withAudio, total: passage.sentences.length }));
  return parts.filter(Boolean).join(' · ');
}

/** Appends `sentence` to `parent` with the key expression in bold. */
export function appendWithKey(parent, sentence, keyExpression) {
  const at = keyExpression ? sentence.toLowerCase().indexOf(keyExpression.toLowerCase()) : -1;
  if (at < 0) { parent.append(sentence); return; }
  const strong = document.createElement('strong');
  strong.textContent = sentence.slice(at, at + keyExpression.length);
  parent.append(sentence.slice(0, at), strong, sentence.slice(at + keyExpression.length));
}
