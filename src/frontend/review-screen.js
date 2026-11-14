import { el, errorLine, lifetime } from './dom.js';
import { REGISTER_LABELS } from './labels.js';
import { findSentence, shouldSuggestExplanation } from './lookup.js';
import { createBlobPlayer, createSentencePlayer } from './sentence-player.js';
import { createTakeRecorder } from './take-recorder.js';
import { renderCardBack, VERDICT_RULE } from './card-back.js';
import { openExplanation, suggestExplanation } from './explain-panel.js';
import { secondsLeft, speakLimitMs, startLimitMs } from './time-limits.js';
import { t } from './i18n.js';

const TICK_MS = 100;
// Asking the backend a moment after a retry is due avoids asking a hair too early.
const RETRY_MARGIN_MS = 500;

const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/**
 * Spaced review. One card at a time, always the most urgent one the backend
 * reports: see the Chinese, start speaking before the start limit runs out,
 * then judge yourself against the answer. Running out of time before starting
 * counts as not said. A missed card comes back after 10 minutes.
 */
export function reviewScreen(app, root, signal) {
  const player = createSentencePlayer(app.call, signal);
  const ownTakes = createBlobPlayer(signal);
  const tally = { said: 0, missed: 0 };
  let card = null;
  let cardScope = lifetime(signal);
  let ticker = null;

  const header = el('div', 'se-header');
  app.ui.button(header, t('← 返回'), () => app.go({ name: 'home' }), signal, { variant: 'ghost' });
  const progress = el('span', 'se-muted');
  header.append(progress);
  const body = el('div', 'se-card');
  root.append(header, body);
  const error = errorLine(root);
  const env = { app, signal, player, ownTakes, error };

  const stopTicker = () => { clearInterval(ticker); ticker = null; };
  signal.addEventListener('abort', stopTicker, { once: true });

  /** Clears the card area for a new step and returns the signal its buttons live under. */
  function newStep() {
    stopTicker();
    cardScope.abort();
    cardScope = lifetime(signal);
    return cardScope.signal;
  }

  function showProgress() {
    const { review } = app.state;
    progress.textContent = t('复习 · 现在到期 {due} 句 · 今天已复习 {done}/{limit} 次', { due: review.dueIds.length, done: review.doneToday, limit: review.limit });
  }

  const recorder = createTakeRecorder({
    signal,
    onStart: () => { if (card?.side === 'front') card.prompt.textContent = t('正在录音… 说完再按一次空格。'); },
    onTake: taken => { if (card?.side === 'front') { card.taken = taken; card.speakMs = taken.speakMs; showBack(); } },
    onError: cause => {
      error.show(cause);
      // The microphone failed, not the learner: the card gets its start time back.
      if (card?.side === 'front') { card.responseMs = null; card.shownAt = performance.now(); card.prompt.textContent = t('按空格开始说。'); }
    },
  });

  /** Sends the verdict. Returns whether the backend took it. */
  async function judge(current, said, timedOut) {
    try {
      const state = await app.call('judge-review', { attemptId: current.attemptId, sentenceId: current.sentence.id, said, timedOut, responseMs: current.responseMs, speakMs: current.speakMs });
      if (signal.aborted) return false;
      app.setState(state);
      tally[said ? 'said' : 'missed'] += 1;
      showProgress();
      return true;
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
      return false;
    }
  }

  function explain(current) {
    const scope = newStep();
    player.stop();
    ownTakes.stop();
    openExplanation(app, body, scope, current.sentence.id, replaced => {
      if (replaced || current.judged) next();
      else showBack();
    });
  }

  /** After a miss: on to the next card, or first the suggestion to look at the explanation. */
  function afterMiss(current) {
    if (!shouldSuggestExplanation(app.state, current.sentence.id)) { next(); return; }
    suggestExplanation(app, body, newStep(), current.sentence, { onExplain: () => explain(current), onNext: next });
  }

  async function giveVerdict(current, said) {
    if (!await judge(current, said, false)) return;
    current.judged = true;
    if (said) next();
    else afterMiss(current);
  }

  function showBack() {
    const current = card;
    current.side = 'back';
    const scope = newStep();
    const verdict = renderCardBack(env, body, scope, current, { kind: 'review', onExplain: () => explain(current) });
    if (current.judged) {
      body.append(el('p', 'se-muted', current.timedOut ? t('没有在开始时限内开口，已记为没说出来。10 分钟后再来一次。') : t('已记为没说出来。10 分钟后再来一次。')));
      app.ui.button(verdict, t('下一句 →'), () => afterMiss(current), scope, { variant: 'default', key: 'next' });
      return;
    }
    app.ui.button(verdict, t('没说出来'), () => giveVerdict(current, false), scope, { key: 'no' });
    app.ui.button(verdict, t('说出来了'), () => giveVerdict(current, true), scope, { variant: 'default', key: 'yes' });
    body.append(el('p', 'se-muted', t(VERDICT_RULE)));
  }

  /** The start limit ran out: the card turns over by itself and counts as not said. */
  async function timeOut(current, startLimit) {
    stopTicker();
    recorder.cancel();
    current.side = 'timed-out';
    current.responseMs = startLimit;
    current.timedOut = true;
    current.prompt.textContent = t('时间到。');
    app.keys.refresh();
    current.judged = await judge(current, false, true);
    if (signal.aborted || card !== current) return;
    if (current.judged) showBack();
    else app.ui.button(current.actions, t('继续'), next, cardScope.signal, { key: 'next' });
  }

  function showFront(sentenceId) {
    const found = findSentence(app.state, sentenceId);
    if (!found) { showDone(); return; }
    const { sentence, passage } = found;
    const scope = newStep();
    const startLimit = startLimitMs(sentence, app.state.settings);
    const countdown = el('span', 'se-countdown', t('剩余 {seconds} 秒', { seconds: secondsLeft(startLimit, 0) }));
    const prompt = el('p', 'se-status', t('按空格开始说。'));
    const actions = el('div', 'se-actions');
    card = { sentence, attemptId: crypto.randomUUID(), side: 'front', shownAt: performance.now(), responseMs: null, speakMs: null, taken: null, timedOut: false, judged: false, prompt, actions };
    const current = card;
    body.replaceChildren(el('p', 'se-muted', t('场景：{register}', { register: t(REGISTER_LABELS[passage.register]) })), el('p', 'se-cue', sentence.zh), countdown, prompt, actions);
    ticker = setInterval(() => {
      if (scope.aborted || card !== current || current.responseMs !== null) return;
      const elapsed = performance.now() - current.shownAt;
      if (elapsed >= startLimit) void timeOut(current, startLimit);
      else countdown.textContent = t('剩余 {seconds} 秒', { seconds: secondsLeft(startLimit, elapsed) });
    }, TICK_MS);
  }

  /** Nothing is due right now, but a missed card comes back in a few minutes: count down to it. */
  function showWaiting(dueAt) {
    const scope = newStep();
    card = null;
    const count = app.state.review.waiting.length;
    const remaining = el('p', 'se-cue');
    const actions = el('div', 'se-actions');
    body.replaceChildren(el('p', '', t('到期的都复习完了。还有 {count} 句刚才没说出来，10 分钟后再来一次。', { count })), remaining, el('p', 'se-muted', t('可以等在这里，也可以先离开：没复习的句子之后仍然到期。')), actions);
    app.ui.button(actions, t('先到这里'), () => app.go({ name: 'home' }), scope);
    let asked = false;
    const tick = () => {
      const left = dueAt + RETRY_MARGIN_MS - Date.now();
      if (left > 0) { remaining.textContent = clock(left); return; }
      if (asked) return;
      asked = true;
      stopTicker();
      void refresh().then(() => { if (!scope.aborted) next(); });
    };
    ticker = setInterval(tick, TICK_MS * 5);
    tick();
  }

  function showDone() {
    const scope = newStep();
    card = null;
    const { review } = app.state;
    const lines = tally.said + tally.missed === 0 ? [t('现在没有到期的句子。')] : [t('这次复习了 {total} 次：{said} 次说出来了，{missed} 次没说出来。', { total: tally.said + tally.missed, said: tally.said, missed: tally.missed })];
    if (review.postponed > 0) lines.push(t('今天已到每日上限（{limit} 次），还有 {count} 句顺延到明天。', { limit: review.limit, count: review.postponed }));
    const actions = el('div', 'se-actions');
    body.replaceChildren(...lines.map(line => el('p', '', line)), actions);
    app.ui.button(actions, t('回到首页'), () => app.go({ name: 'home' }), scope, { variant: 'default', key: 'next' });
  }

  async function refresh() {
    try {
      const state = await app.call('get-state');
      if (!signal.aborted) app.setState(state);
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
    }
  }

  function next() {
    error.clear();
    player.stop();
    ownTakes.stop();
    showProgress();
    const { review } = app.state;
    if (review.dueIds.length > 0) showFront(review.dueIds[0]);
    else if (review.waiting.length > 0 && review.doneToday < review.limit) showWaiting(review.waiting[0].dueAt);
    else showDone();
  }

  function showIntro() {
    const scope = newStep();
    const { review } = app.state;
    showProgress();
    if (review.dueIds.length === 0) { next(); return; }
    const actions = el('div', 'se-actions');
    body.replaceChildren(
      el('p', '', t('现在有 {count} 句到期。', { count: review.dueIds.length })),
      el('p', 'se-muted', t('每张卡只显示中文。在倒计时结束前按空格开始说，说完再按一次空格；来不及开口就记为没说出来。')),
      actions,
    );
    app.ui.button(actions, t('开始复习'), next, scope, { variant: 'default', key: 'next' });
  }

  function speak() {
    if (recorder.isRecording()) { void recorder.stop(); return; }
    if (card.responseMs !== null) return;
    card.responseMs = performance.now() - card.shownAt;
    void recorder.start(speakLimitMs(card.sentence, app.state.settings));
  }
  app.keys.bind('record', { run: speak, label: t('录音'), enabled: () => card?.side === 'front' }, signal);
  void refresh().then(() => { if (!signal.aborted) showIntro(); });
}
