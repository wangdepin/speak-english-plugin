import { el, errorLine } from './dom.js';
import { appendWithKey } from './labels.js';
import { createSentencePlayer, playSentences } from './sentence-player.js';
import { REPEATS_WHEN_SLOW_TO_ADAPT, SPEED_LADDER, speedSteps } from './speed-run.js';
import { t } from './i18n.js';

const READS_ADVISED = 3;

function checkbox(parent, label, checked) {
  const wrap = el('label', 'se-radio');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  wrap.append(input, label);
  parent.append(wrap);
  return input;
}

/**
 * What follows understanding a passage and precedes shadowing: reading it aloud a few times with the
 * meaning in mind, then hearing it at rising and falling speeds. Both are counted, neither is scored.
 */
export function consolidateScreen(app, root, signal, { passageId }) {
  const findPassage = () => app.state.passages.find(item => item.id === passageId);
  if (!findPassage()) { app.go({ name: 'home' }); return; }
  const sentences = findPassage().sentences;
  const player = createSentencePlayer(app.call, signal);
  let running = false;
  const allHaveAudio = sentences.every(sentence => sentence.audio);

  const header = el('div', 'se-header');
  app.ui.button(header, t('← 返回段落'), () => app.go({ name: 'passage', passageId }), signal, { variant: 'ghost' });
  header.append(el('span', 'se-muted', t('朗读和变速听')));

  const reading = el('div', 'se-card');
  const readCount = el('p', 'se-muted');
  const readActions = el('div', 'se-actions');
  reading.append(el('h3', 'se-subtitle', t('朗读')), el('p', '', t('看着文本大声读。读的时候让意思同步在心里过，不要只是念字。读完一遍点一次。')), readCount, readActions);

  const speed = el('div', 'se-card');
  const speedCount = el('p', 'se-muted');
  const speedActions = el('div', 'se-actions');
  const status = el('p', 'se-status');
  speed.append(el('h3', 'se-subtitle', t('变速听')), el('p', '', t('整段按 {ladder} 倍连续播放。跟不上时打开文本，看着听。', { ladder: SPEED_LADDER.join(' → ') })), speedCount, speedActions, status);

  const list = el('div', 'se-sentence-list');
  for (const sentence of sentences) {
    const text = el('div', 'se-sentence-text');
    const spoken = el('p', 'se-target');
    appendWithKey(spoken, sentence.target, sentence.keyExpression);
    text.append(spoken, el('p', 'se-native', sentence.native));
    list.append(text);
  }
  root.append(header, reading, speed);
  const error = errorLine(root);
  const textToggle = el('div', 'se-actions');
  root.append(textToggle, list);

  const showText = checkbox(textToggle, t('显示文本'), true);
  const applyTextToggle = () => { list.hidden = !showText.checked; };
  showText.addEventListener('change', applyTextToggle);

  function renderCounts() {
    const done = findPassage().consolidation ?? { readAloud: 0, speedRuns: 0 };
    readCount.textContent = t('已读 {count} 遍（建议 {advised} 遍）', { count: done.readAloud, advised: READS_ADVISED });
    speedCount.textContent = t('已完成 {count} 轮', { count: done.speedRuns });
  }

  async function count(kind) {
    error.clear();
    try {
      const state = await app.call('record-consolidation', { passageId, kind });
      if (signal.aborted) return;
      app.setState(state);
      renderCounts();
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
    }
  }

  /** Plays the passage up and down the speeds. The text is hidden when a run starts and can be shown again. */
  async function run() {
    if (running || !allHaveAudio) return;
    running = true;
    error.clear();
    showText.checked = false;
    applyTextToggle();
    const steps = speedSteps(threeTimes.checked ? REPEATS_WHEN_SLOW_TO_ADAPT : 1);
    try {
      for (const step of steps) {
        status.textContent = t('现在 {rate} 倍 · 第 {rung}/{total} 档', { rate: step.rate, rung: step.rung, total: SPEED_LADDER.length });
        if (!await playSentences(player, sentences, { rate: step.rate })) return;
      }
      await count('speed');
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
    } finally {
      running = false;
      if (!signal.aborted) status.textContent = '';
    }
  }

  app.ui.button(readActions, t('读完一遍'), () => count('read'), signal);
  app.ui.button(speedActions, t('▶ 开始变速听'), run, signal, { variant: 'default', disabled: !allHaveAudio });
  app.ui.button(speedActions, t('■ 停止'), () => player.stop(), signal, { variant: 'ghost' });
  const threeTimes = checkbox(speedActions, t('每个速度听 {count} 遍', { count: REPEATS_WHEN_SLOW_TO_ADAPT }), false);
  app.keys.bind('reference', { run: () => (running ? player.stop() : void run()), label: t('变速听'), enabled: () => allHaveAudio }, signal);
  renderCounts();
}
