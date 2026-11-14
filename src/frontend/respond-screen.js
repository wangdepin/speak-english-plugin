import { el, errorLine, lifetime } from './dom.js';
import { appendWithKey, REGISTER_LABELS } from './labels.js';
import { respondablePassages, sample } from './exercise-picks.js';
import { createBlobPlayer, createPlayer, createSentencePlayer, playOrStop, playSentences } from './sentence-player.js';
import { createTakeRecorder } from './take-recorder.js';
import { answerSpeakLimitMs, answerStartLimitMs, secondsLeft } from './time-limits.js';
import { t } from './i18n.js';

const ROUND_SIZE = 5;
const TICK_MS = 100;

/**
 * Optional exercise "respond": a question is asked once, in another voice and
 * with no text, and the learner answers aloud with the passage they have
 * memorized. They judge themselves; nothing is scored or scheduled.
 */
export function respondScreen(app, root, signal) {
  const questions = createPlayer(key => {
    const [passageId, questionId] = key.split('/');
    return app.call('question-audio', { passageId, questionId });
  }, signal);
  const reference = createSentencePlayer(app.call, signal);
  const ownTakes = createBlobPlayer(signal);
  const tally = { answered: 0, missed: 0 };
  let queue = [];
  let position = 0;
  let turn = null;
  let stepScope = lifetime(signal);
  let ticker = null;

  const header = el('div', 'se-header');
  app.ui.button(header, t('← 返回'), () => app.go({ name: 'home' }), signal, { variant: 'ghost' });
  const progress = el('span', 'se-muted', t('接话'));
  header.append(progress);
  const body = el('div', 'se-card');
  root.append(header, body);
  const error = errorLine(root);

  const stopTicker = () => { clearInterval(ticker); ticker = null; };
  signal.addEventListener('abort', stopTicker, { once: true });

  /** Ends the previous step's buttons and timer and returns the signal for the next step's. */
  function newStep() {
    stopTicker();
    stepScope.abort();
    stepScope = lifetime(signal);
    return stepScope.signal;
  }

  const recorder = createTakeRecorder({
    signal,
    onStart: () => { if (turn?.phase === 'answering') turn.prompt.textContent = t('正在录音… 说完再按一次空格。'); },
    onTake: taken => { if (turn?.phase === 'answering') { turn.taken = taken; turn.speakMs = taken.speakMs; showAnswer(); } },
    onError: cause => {
      error.show(cause);
      // The microphone failed, not the learner: the turn gets its start time back.
      if (turn?.phase === 'answering') { turn.responseMs = null; turn.askedAt = performance.now(); turn.prompt.textContent = t('按空格开始回答。'); }
    },
  });

  /** Logs the outcome. Returns whether the backend took it. */
  async function record(current, answered, timedOut) {
    try {
      const state = await app.call('record-response', { attemptId: current.attemptId, passageId: current.passage.id, questionId: current.question.id, answered, timedOut, responseMs: current.responseMs, speakMs: current.speakMs });
      if (signal.aborted) return false;
      app.setState(state);
      tally[answered ? 'answered' : 'missed'] += 1;
      return true;
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
      return false;
    }
  }

  function advance() {
    position += 1;
    ask();
  }

  async function giveVerdict(current, answered) {
    if (await record(current, answered, false)) advance();
  }

  /** What was asked and what the learner had ready to say, with both recordings to compare. */
  function showAnswer() {
    const current = turn;
    current.phase = 'answer';
    const scope = newStep();
    const { passage, question } = current;
    const listen = el('div', 'se-actions');
    const text = el('div', 'se-reading-text');
    for (const sentence of passage.sentences) {
      const line = el('p', 'se-target');
      appendWithKey(line, sentence.target, sentence.keyExpression);
      text.append(line);
    }
    const verdict = el('div', 'se-actions se-verdict');
    body.replaceChildren(el('p', 'se-muted', t('问句')), el('p', 'se-target se-target-large', question.target), el('p', 'se-native', question.native), el('p', 'se-muted', t('你背过的回答')), text, listen, verdict);
    const playQuestion = () => questions.play(current.key).catch(error.show);
    app.ui.button(listen, t('▶ 问句'), playQuestion, scope);
    app.keys.bind('reference', { run: playOrStop(questions, playQuestion), label: t('问句') }, scope);
    if (current.taken) app.ui.button(listen, t('▶ 我的回答'), () => { reference.stop(); return ownTakes.play(current.taken.blob); }, scope, { key: 'mine' });
    app.ui.button(listen, t('▶ 整段原声'), () => { ownTakes.stop(); return playSentences(reference, passage.sentences).catch(error.show); }, scope);
    if (current.timedOut) {
      body.append(el('p', 'se-muted', t('没有在时限内开口，已记为没接上。')));
      app.ui.button(verdict, t('下一个 →'), advance, scope, { variant: 'default', key: 'next' });
      return;
    }
    app.ui.button(verdict, t('没接上'), () => giveVerdict(current, false), scope, { key: 'no' });
    app.ui.button(verdict, t('接上了'), () => giveVerdict(current, true), scope, { variant: 'default', key: 'yes' });
    body.append(el('p', 'se-muted', t('用背过的话把意思说出来了，就算接上了。不要求一字不差，也不要求说完整段。')));
  }

  async function timeOut(current, limit) {
    stopTicker();
    recorder.cancel();
    current.phase = 'timed-out';
    current.responseMs = limit;
    current.timedOut = true;
    current.prompt.textContent = t('时间到。');
    app.keys.refresh();
    await record(current, false, true);
    if (!signal.aborted && turn === current) showAnswer();
  }

  /** The question has been asked: the learner has a few seconds to start answering. */
  function awaitAnswer(current) {
    const scope = newStep();
    const limit = answerStartLimitMs(app.state.settings);
    const countdown = el('span', 'se-countdown', t('剩余 {seconds} 秒', { seconds: secondsLeft(limit, 0) }));
    current.prompt = el('p', 'se-status', t('按空格开始回答。'));
    current.phase = 'answering';
    current.askedAt = performance.now();
    body.replaceChildren(el('p', 'se-muted', t('场景：{register}', { register: t(REGISTER_LABELS[current.passage.register]) })), el('p', 'se-cue', t('问完了，该你了。')), countdown, current.prompt);
    ticker = setInterval(() => {
      if (scope.aborted || turn !== current || current.responseMs !== null) return;
      const elapsed = performance.now() - current.askedAt;
      if (elapsed >= limit) void timeOut(current, limit);
      else countdown.textContent = t('剩余 {seconds} 秒', { seconds: secondsLeft(limit, elapsed) });
    }, TICK_MS);
  }

  async function ask() {
    error.clear();
    reference.stop();
    ownTakes.stop();
    if (position >= queue.length) { showSummary(); return; }
    const scope = newStep();
    const current = { ...queue[position], attemptId: crypto.randomUUID(), phase: 'asking', askedAt: null, responseMs: null, speakMs: null, taken: null, timedOut: false, prompt: null };
    current.key = `${current.passage.id}/${current.question.id}`;
    turn = current;
    progress.textContent = t('接话 · 第 {position}/{total} 个', { position: position + 1, total: queue.length });
    body.replaceChildren(el('p', 'se-cue', t('正在问你…')), el('p', 'se-muted', t('只问一遍，没有文字。')));
    let asked = false;
    try {
      asked = await questions.play(current.key);
    } catch (cause) {
      if (!scope.aborted) error.show(cause);
    }
    if (scope.aborted || turn !== current) return;
    if (asked) { awaitAnswer(current); return; }
    const actions = el('div', 'se-actions');
    body.replaceChildren(el('p', '', t('这个问句没有放出来。')), actions);
    app.ui.button(actions, t('跳过'), advance, scope, { key: 'next' });
  }

  function showSummary() {
    const scope = newStep();
    turn = null;
    progress.textContent = t('接话');
    const actions = el('div', 'se-actions');
    body.replaceChildren(el('p', '', t('这一轮问了 {total} 个：接上 {answered} 个，没接上 {missed} 个。', { total: tally.answered + tally.missed, answered: tally.answered, missed: tally.missed })), actions);
    app.ui.button(actions, t('再来一轮'), showIntro, scope);
    app.ui.button(actions, t('回到首页'), () => app.go({ name: 'home' }), scope, { variant: 'default', key: 'next' });
  }

  function showIntro() {
    const scope = newStep();
    turn = null;
    const passages = respondablePassages(app.state);
    const actions = el('div', 'se-actions');
    if (passages.length === 0) {
      body.replaceChildren(el('p', '', t('还没有可以接话的段落。')), el('p', 'se-muted', t('需要一段话的句子全部进入复习，并且在段落页生成过问句。')), actions);
      app.ui.button(actions, t('回到首页'), () => app.go({ name: 'home' }), scope, { variant: 'default' });
      return;
    }
    body.replaceChildren(
      el('p', '', t('从 {available} 段背过的话里随机抽 {count} 段，每段问一个问句。', { available: passages.length, count: Math.min(ROUND_SIZE, passages.length) })),
      el('p', 'se-muted', t('问句只播一遍，没有文字。问完后 {seconds} 秒内按空格开始回答，说完再按一次空格；来不及开口就记为没接上。', { seconds: answerStartLimitMs(app.state.settings) / 1000 })),
      actions,
    );
    app.ui.button(actions, t('开始'), () => {
      queue = sample(passages, ROUND_SIZE).map(passage => ({ passage, question: sample(passage.questions.filter(question => question.audio), 1)[0] }));
      position = 0;
      Object.assign(tally, { answered: 0, missed: 0 });
      void ask();
    }, scope, { variant: 'default', key: 'next' });
  }

  function speak() {
    if (recorder.isRecording()) { void recorder.stop(); return; }
    if (turn.responseMs !== null) return;
    turn.responseMs = performance.now() - turn.askedAt;
    void recorder.start(answerSpeakLimitMs(turn.passage, app.state.settings));
  }
  app.keys.bind('record', { run: speak, label: t('录音'), enabled: () => turn?.phase === 'answering' }, signal);
  showIntro();
}
