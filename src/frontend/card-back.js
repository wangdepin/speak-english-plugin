import { el, errorText } from './dom.js';
import { appendEnglish } from './labels.js';
import { blobToWav } from './recorder.js';
import { renderAssessment } from './assessment-view.js';
import { playOrStop } from './sentence-player.js';
import { toBase64 } from './wav.js';
import { mark, t } from './i18n.js';

export const VERDICT_RULE = mark('关键说法说对、意思完整，就算说出来了。小词不同不算错；换了另一种说法算没说出来。');

/**
 * Scores the card's recording in the background and writes the word-by-word
 * comparison into the card's own slot. It only informs: the learner's own
 * verdict decides, and the card may be long gone when the scores arrive.
 */
async function compare(env, card, kind) {
  const slot = card.comparison;
  try {
    const { wav } = await blobToWav(card.taken.blob);
    const { assessment, state } = await env.app.call('score-attempt', { attemptId: card.attemptId, sentenceId: card.sentence.id, kind, wavBase64: toBase64(wav) });
    if (env.signal.aborted) return;
    env.app.setState(state);
    renderAssessment(slot, card.sentence.en, assessment);
  } catch (cause) {
    slot.replaceChildren(el('p', 'se-muted', t('没有逐词比对：{reason}', { reason: errorText(cause) })));
  }
}

/**
 * The answer side of a card, shared by first recall and review: the English with
 * its key expression in bold, the reference audio, the learner's own recording
 * with a word-by-word comparison, and the way into the explanation.
 *
 * `env` is { app, signal, player, ownTakes, error }. `card` is
 * { sentence, attemptId, taken } where `taken` is null when nothing was recorded.
 * Buttons live until `scope` aborts. Returns the row for the screen's own buttons.
 */
export function renderCardBack(env, body, scope, card, { kind, onExplain }) {
  const { sentence, taken } = card;
  const english = el('p', 'se-english se-english-large');
  appendEnglish(english, sentence.en, sentence.keyExpression);
  const listen = el('div', 'se-actions');
  const verdict = el('div', 'se-actions se-verdict');
  body.replaceChildren(el('p', 'se-chinese', sentence.zh), english, listen);
  if (sentence.audio) {
    const playOriginal = () => env.player.play(sentence.id).catch(env.error.show);
    env.app.ui.button(listen, t('▶ 原声'), playOriginal, scope);
    env.app.keys.bind('reference', { run: playOrStop(env.player, playOriginal), label: t('原声') }, scope);
  }
  if (taken) {
    env.app.ui.button(listen, t('▶ 我的录音'), () => env.ownTakes.play(taken.blob), scope, { key: 'mine' });
    if (!card.comparison) {
      card.comparison = el('div', 'se-result');
      card.comparison.append(el('p', 'se-muted', t('正在逐词比对…')));
      void compare(env, card, kind);
    }
    body.append(card.comparison);
  }
  env.app.ui.button(listen, t('讲解'), onExplain, scope, { variant: 'ghost', key: 'explain' });
  body.append(verdict);
  return verdict;
}
