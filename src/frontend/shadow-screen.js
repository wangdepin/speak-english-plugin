import { el, errorLine } from './dom.js';
import { appendWithKey } from './labels.js';
import { blobToWav } from './recorder.js';
import { createBlobPlayer, createSentencePlayer, playOrStop, slowToggle } from './sentence-player.js';
import { createTakeRecorder, takeLimitMs } from './take-recorder.js';
import { renderAssessment } from './assessment-view.js';
import { toBase64 } from './wav.js';
import { t } from './i18n.js';

function averageText(average) {
  return average ? t('最近 {count} 句平均 {score}', { count: average.count, score: average.overall }) : '';
}

/** Shadowing: hear one sentence, record it, see which words were off, then repeat or move on. */
export function shadowScreen(app, root, signal, { passageId }) {
  const passage = app.state.passages.find(item => item.id === passageId);
  if (!passage) { app.go({ name: 'home' }); return; }
  const sentences = passage.sentences;
  const player = createSentencePlayer(app.call, signal);
  const ownTakes = createBlobPlayer(signal);
  let index = 0;
  let take = null;
  let turn = 0;

  const header = el('div', 'se-header');
  app.ui.button(header, t('← 返回段落'), () => app.go({ name: 'passage', passageId }), signal, { variant: 'ghost' });
  const position = el('span', 'se-muted');
  const average = el('span', 'se-muted', averageText(app.state.shadowAverage));
  header.append(position, average);
  const card = el('div', 'se-card');
  const meaning = el('p', 'se-native');
  const spoken = el('p', 'se-target se-target-large');
  const listen = el('div', 'se-actions');
  const status = el('p', 'se-status');
  const result = el('div', 'se-result');
  const after = el('div', 'se-actions');
  card.append(meaning, spoken, listen, status, result);
  root.append(header, card);
  const error = errorLine(root);
  root.append(after, el('p', 'se-muted', t('按空格开始录音，说完再按一次空格。')));

  const playOriginal = () => player.play(sentences[index].id, { rate: rate() }).catch(error.show);
  app.ui.button(listen, t('▶ 原声'), playOriginal, signal);
  app.keys.bind('reference', { run: playOrStop(player, playOriginal), label: t('原声') }, signal);
  const rate = slowToggle(listen);
  const recordButton = app.ui.button(listen, t('● 开始录音'), () => toggle(), signal, { variant: 'default' });
  const ownButton = app.ui.button(listen, t('▶ 我的录音'), () => take && ownTakes.play(take.blob), signal, { disabled: true, key: 'mine' });

  async function score({ blob }) {
    const mine = turn;
    const sentence = sentences[index];
    take = { blob };
    ownButton.update({ disabled: false });
    status.textContent = t('正在评分…');
    try {
      const { wav } = await blobToWav(blob);
      const { assessment, state } = await app.call('score-attempt', { attemptId: crypto.randomUUID(), sentenceId: sentence.id, kind: 'shadow', wavBase64: toBase64(wav) });
      if (signal.aborted) return;
      app.setState(state);
      average.textContent = averageText(app.state.shadowAverage);
      if (mine !== turn) return;
      status.textContent = '';
      renderAssessment(result, sentence.target, assessment, passage.targetLanguage);
    } catch (cause) {
      if (signal.aborted || mine !== turn) return;
      status.textContent = '';
      error.show(cause);
    }
  }

  const recorder = createTakeRecorder({
    signal,
    onStart: () => { status.textContent = t('正在录音…'); recordButton.update({ label: t('■ 停止') }); },
    onTake: taken => { recordButton.update({ label: t('● 开始录音') }); void score(taken); },
    onError: cause => { recordButton.update({ label: t('● 开始录音') }); status.textContent = ''; error.show(cause); },
  });

  function toggle() {
    if (recorder.isRecording()) return recorder.stop();
    player.stop();
    ownTakes.stop();
    error.clear();
    result.replaceChildren();
    turn += 1;
    return recorder.start(takeLimitMs(sentences[index]));
  }

  function show(next) {
    recorder.cancel();
    recordButton.update({ label: t('● 开始录音') });
    turn += 1;
    index = next;
    take = null;
    const sentence = sentences[index];
    position.textContent = t('分段跟读 · 第 {position}/{total} 句', { position: index + 1, total: sentences.length });
    meaning.textContent = sentence.native;
    spoken.replaceChildren();
    appendWithKey(spoken, sentence.target, sentence.keyExpression);
    status.textContent = sentence.audio ? '' : t('这一句还没有语音，可以先回段落页合成。');
    result.replaceChildren();
    error.clear();
    ownButton.update({ disabled: true });
    previousButton.update({ disabled: index === 0 });
    nextButton.update({ label: index === sentences.length - 1 ? t('完成，回到段落') : t('下一句 →') });
    if (sentence.audio) void playOriginal();
  }

  const previousButton = app.ui.button(after, t('← 上一句'), () => show(index - 1), signal, { variant: 'ghost', key: 'previous' });
  app.ui.button(after, t('再听一遍'), playOriginal, signal);
  const nextButton = app.ui.button(after, t('下一句 →'), () => (index === sentences.length - 1 ? app.go({ name: 'passage', passageId }) : show(index + 1)), signal, { key: 'next' });
  app.keys.bind('record', { run: () => void toggle(), label: t('录音') }, signal);
  show(0);
}
