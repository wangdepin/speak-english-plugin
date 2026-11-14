import { locale, mark, t } from './i18n.js';

export const REGISTER_LABELS = { formal: mark('正式（组会）'), casual: mark('口语（闲聊）') };
export const VERSION_LABELS = { sentences: '', brief: mark('简短版'), elaborate: mark('展开版') };

export function passageDate(createdAt) {
  return new Date(createdAt).toLocaleDateString(locale(), { month: 'long', day: 'numeric' });
}

export function passageSummary(passage) {
  const withAudio = passage.sentences.filter(sentence => sentence.audio).length;
  const parts = [passageDate(passage.createdAt), t(REGISTER_LABELS[passage.register]), t(VERSION_LABELS[passage.version]), t('{count} 句', { count: passage.sentences.length })];
  if (withAudio < passage.sentences.length) parts.push(t('语音 {done}/{total}', { done: withAudio, total: passage.sentences.length }));
  return parts.filter(Boolean).join(' · ');
}

/** Appends `english` to `parent` with the key expression in bold. */
export function appendEnglish(parent, english, keyExpression) {
  const at = keyExpression ? english.toLowerCase().indexOf(keyExpression.toLowerCase()) : -1;
  if (at < 0) { parent.append(english); return; }
  const strong = document.createElement('strong');
  strong.textContent = english.slice(at, at + keyExpression.length);
  parent.append(english.slice(0, at), strong, english.slice(at + keyExpression.length));
}
