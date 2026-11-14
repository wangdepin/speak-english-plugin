import { el, errorLine, lifetime } from './dom.js';
import { appendWithKey } from './labels.js';
import { listenableSentences, sample } from './exercise-picks.js';
import { createSentencePlayer, playOrStop, SLOW_RATE } from './sentence-player.js';
import { mark, t } from './i18n.js';

const ROUND_SIZE = 10;
const FAST_RATE = 1.2;
const GAP_ADVICE = {
  sound: mark('缺的是声音这一端：这些词你都认识，但真实读出来的声音和你记的不一样。现在对着文字再听几遍，找出哪里的音变了。'),
  pairing: mark('缺的是配对：这句的说法还没掌握。回段落页重新跟读这一句，或在复习时点「讲解」。'),
};

/**
 * Optional exercise "listen once": each sentence is played a single time with no
 * text, and the learner says whether they understood. A sentence that was not
 * understood is sorted by what it lacks. Nothing here is scheduled.
 */
export function listenOnceScreen(app, root, signal) {
  const player = createSentencePlayer(app.call, signal);
  const tally = { understood: 0, sound: 0, pairing: 0, unsorted: 0 };
  let queue = [];
  let position = 0;
  let rate = 1;
  let stepScope = lifetime(signal);

  const header = el('div', 'se-header');
  app.ui.button(header, t('← 返回'), () => app.go({ name: 'home' }), signal, { variant: 'ghost' });
  const progress = el('span', 'se-muted', t('只听一遍'));
  header.append(progress);
  const body = el('div', 'se-card');
  root.append(header, body);
  const error = errorLine(root);

  /** Ends the previous step's buttons and returns the signal for the next step's. */
  function newStep() {
    stepScope.abort();
    stepScope = lifetime(signal);
    return stepScope.signal;
  }

  /** Logs the result so far. A failed log is shown but does not hold up the exercise. */
  async function record(item, understood, gap) {
    try {
      const state = await app.call('record-listen', { attemptId: item.attemptId, sentenceId: item.sentence.id, understood, gap, rate });
      if (!signal.aborted) app.setState(state);
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
    }
  }

  function advance() {
    position += 1;
    playNext();
  }

  /** The text of the sentence, once the single hearing is over. Returns the row for this step's buttons. */
  function reveal(item, ...notes) {
    const spoken = el('p', 'se-target se-target-large');
    appendWithKey(spoken, item.sentence.target, item.sentence.keyExpression);
    const actions = el('div', 'se-actions');
    body.replaceChildren(spoken, el('p', 'se-native', item.sentence.native), ...notes, actions);
    return actions;
  }

  function showAdvice(item, gap) {
    const scope = newStep();
    tally.unsorted -= 1;
    tally[gap] += 1;
    void record(item, false, gap);
    const actions = reveal(item, el('p', '', t(GAP_ADVICE[gap])));
    const replay = () => player.play(item.sentence.id).catch(error.show);
    app.ui.button(actions, t('▶ 再听'), replay, scope);
    app.keys.bind('reference', { run: playOrStop(player, replay), label: t('再听') }, scope);
    app.ui.button(actions, t('▶ 慢速（{rate} 倍）', { rate: SLOW_RATE }), () => player.play(item.sentence.id, { rate: SLOW_RATE }).catch(error.show), scope, { key: 'slow' });
    app.ui.button(actions, t('下一句 →'), advance, scope, { variant: 'default', key: 'next' });
  }

  function askGap(item, wasCountedUnderstood) {
    const scope = newStep();
    if (wasCountedUnderstood) tally.understood -= 1;
    tally.unsorted += 1;
    void record(item, false, null);
    const actions = reveal(item, el('p', '', t('现在看到文字了：')));
    app.ui.button(actions, t('一看就懂，每个词都认识'), () => showAdvice(item, 'sound'), scope, { key: 'no' });
    app.ui.button(actions, t('看了还是不懂'), () => showAdvice(item, 'pairing'), scope, { key: 'yes' });
  }

  function confirmUnderstood(item) {
    const scope = newStep();
    tally.understood += 1;
    void record(item, true, null);
    const actions = reveal(item);
    app.ui.button(actions, t('下一句 →'), advance, scope, { variant: 'default', key: 'next' });
    app.ui.button(actions, t('其实没听懂'), () => askGap(item, true), scope, { variant: 'ghost', key: 'no' });
  }

  function askUnderstood(item) {
    const scope = newStep();
    const actions = el('div', 'se-actions');
    body.replaceChildren(el('p', 'se-cue', t('放完了。')), el('p', 'se-muted', t('不能重播。')), actions);
    app.ui.button(actions, t('没听懂'), () => askGap(item, false), scope, { key: 'no' });
    app.ui.button(actions, t('听懂了'), () => confirmUnderstood(item), scope, { variant: 'default', key: 'yes' });
  }

  async function playNext() {
    error.clear();
    if (position >= queue.length) { showSummary(); return; }
    const scope = newStep();
    const item = queue[position];
    progress.textContent = t('只听一遍 · 第 {position}/{total} 句', { position: position + 1, total: queue.length });
    body.replaceChildren(el('p', 'se-cue', t('正在播放…')), el('p', 'se-muted', t('只播一遍，没有文字。')));
    let played = false;
    try {
      played = await player.play(item.sentence.id, { rate });
    } catch (cause) {
      if (!scope.aborted) error.show(cause);
    }
    if (scope.aborted) return;
    if (played) { askUnderstood(item); return; }
    const actions = el('div', 'se-actions');
    body.replaceChildren(el('p', '', t('这一句没有放出来。')), actions);
    app.ui.button(actions, t('跳过'), advance, scope, { key: 'next' });
  }

  function showSummary() {
    const scope = newStep();
    progress.textContent = t('只听一遍');
    const missed = tally.sound + tally.pairing + tally.unsorted;
    const lines = [t('这一轮听了 {total} 句：听懂 {understood} 句，没听懂 {missed} 句。', { total: queue.length, understood: tally.understood, missed })];
    if (missed > 0) lines.push(t('没听懂的里面：缺声音这一端 {sound} 句，缺配对 {pairing} 句。', { sound: tally.sound, pairing: tally.pairing }));
    const actions = el('div', 'se-actions');
    body.replaceChildren(...lines.map(line => el('p', '', line)), actions);
    app.ui.button(actions, t('再来一轮'), showIntro, scope);
    app.ui.button(actions, t('回到首页'), () => app.go({ name: 'home' }), scope, { variant: 'default', key: 'next' });
  }

  function showIntro() {
    const scope = newStep();
    const available = listenableSentences(app.state);
    const actions = el('div', 'se-actions');
    if (available.length === 0) {
      body.replaceChildren(el('p', '', t('还没有带语音的句子。先录入一段话。')), actions);
      app.ui.button(actions, t('回到首页'), () => app.go({ name: 'home' }), scope, { variant: 'default' });
      return;
    }
    const fast = el('input');
    fast.type = 'checkbox';
    const fastLabel = el('label', 'se-radio');
    fastLabel.append(fast, t('加快到 {rate} 倍', { rate: FAST_RATE }));
    body.replaceChildren(
      el('p', '', t('从 {available} 句带语音的句子里随机抽 {count} 句。', { available: available.length, count: Math.min(ROUND_SIZE, available.length) })),
      el('p', 'se-muted', t('每句只播一遍，不显示文字，不能重播。放完后选听懂了还是没听懂。这些句子你都跟读过，原速大多能听懂；加快后更接近真人说话的速度。')),
      fastLabel, actions,
    );
    app.ui.button(actions, t('开始'), () => {
      rate = fast.checked ? FAST_RATE : 1;
      queue = sample(available, ROUND_SIZE).map(item => ({ ...item, attemptId: crypto.randomUUID() }));
      position = 0;
      Object.assign(tally, { understood: 0, sound: 0, pairing: 0, unsorted: 0 });
      void playNext();
    }, scope, { variant: 'default', key: 'next' });
  }

  showIntro();
}
