import { el, errorLine, lifetime } from './dom.js';
import { REGISTER_LABELS } from './labels.js';
import { shouldSuggestExplanation } from './lookup.js';
import { createBlobPlayer, createSentencePlayer } from './sentence-player.js';
import { createTakeRecorder } from './take-recorder.js';
import { renderCardBack, VERDICT_RULE } from './card-back.js';
import { openExplanation, suggestExplanation } from './explain-panel.js';
import { speakLimitMs } from './time-limits.js';
import { t } from './i18n.js';

/**
 * First recall of a new passage: see the Chinese, say the English, then judge
 * yourself against the answer. Sentences you said enter spaced review;
 * the others come back here tomorrow. There is no limit on thinking time here.
 */
export function recallScreen(app, root, signal, { passageId }) {
  const passage = app.state.passages.find(item => item.id === passageId);
  if (!passage) { app.go({ name: 'home' }); return; }
  const queue = passage.sentences.filter(sentence => sentence.recall === 'pending');
  const player = createSentencePlayer(app.call, signal);
  const ownTakes = createBlobPlayer(signal);
  const tally = { said: 0, missed: 0, replaced: 0 };
  let position = 0;
  let card = null;
  let cardScope = lifetime(signal);

  const header = el('div', 'se-header');
  app.ui.button(header, t('← 返回段落'), () => app.go({ name: 'passage', passageId }), signal, { variant: 'ghost' });
  const progress = el('span', 'se-muted');
  header.append(progress);
  const body = el('div', 'se-card');
  root.append(header, body);
  const error = errorLine(root);
  const env = { app, signal, player, ownTakes, error };

  /** Returns the signal the next step's buttons live under, ending the previous step's. */
  function newStep() {
    cardScope.abort();
    cardScope = lifetime(signal);
    return cardScope.signal;
  }

  const recorder = createTakeRecorder({
    signal,
    onStart: () => { if (card?.side === 'front') card.prompt.textContent = t('正在录音… 说完再按一次空格。'); },
    onTake: taken => { if (card?.side === 'front') { card.taken = taken; card.speakMs = taken.speakMs; showBack(); } },
    onError: cause => { error.show(cause); },
  });

  /** Sends the verdict. Returns whether the backend took it. */
  async function judge(current, said) {
    try {
      const state = await app.call('judge-recall', { attemptId: current.attemptId, sentenceId: current.sentence.id, said, responseMs: current.responseMs, speakMs: current.speakMs });
      if (signal.aborted) return false;
      app.setState(state);
      tally[said ? 'said' : 'missed'] += 1;
      current.judged = true;
      return true;
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
      return false;
    }
  }

  function advance() {
    position += 1;
    showFront();
  }

  function explain(current) {
    const scope = newStep();
    player.stop();
    ownTakes.stop();
    openExplanation(app, body, scope, current.sentence.id, replaced => {
      if (replaced) { tally.replaced += 1; advance(); }
      else if (current.judged) advance();
      else showBack();
    });
  }

  /** After a miss: on to the next sentence, or first the suggestion to look at the explanation. */
  function afterMiss(current) {
    if (!shouldSuggestExplanation(app.state, current.sentence.id)) { advance(); return; }
    suggestExplanation(app, body, newStep(), current.sentence, { onExplain: () => explain(current), onNext: advance });
  }

  async function giveVerdict(current, said) {
    if (!await judge(current, said)) return;
    if (said) advance();
    else afterMiss(current);
  }

  function showBack() {
    const current = card;
    current.side = 'back';
    const scope = newStep();
    const verdict = renderCardBack(env, body, scope, current, { kind: 'recall', onExplain: () => explain(current) });
    if (current.judged) {
      body.append(el('p', 'se-muted', t('已记为没说出来，明天再试。')));
      app.ui.button(verdict, t('下一句 →'), () => afterMiss(current), scope, { variant: 'default', key: 'next' });
      return;
    }
    app.ui.button(verdict, t('没说出来'), () => giveVerdict(current, false), scope, { key: 'no' });
    app.ui.button(verdict, t('说出来了'), () => giveVerdict(current, true), scope, { variant: 'default', key: 'yes' });
    body.append(el('p', 'se-muted', t(VERDICT_RULE)));
  }

  async function giveUp() {
    const current = card;
    recorder.cancel();
    current.responseMs = performance.now() - current.shownAt;
    if (await judge(current, false)) showBack();
  }

  function showSummary() {
    const scope = newStep();
    card = null;
    progress.textContent = t('试背');
    const lines = queue.length === 0
      ? [t('这一段今天没有要试背的句子。')]
      : [t('这次试背了 {count} 句。', { count: tally.said + tally.missed }), t('{count} 句说出来了，明天开始进入复习。', { count: tally.said }), t('{count} 句没说出来，明天再试背。', { count: tally.missed })];
    if (tally.replaced > 0) lines.push(t('{count} 句换成了新说法，回到段落后可以再试背。', { count: tally.replaced }));
    body.replaceChildren(...lines.map(line => el('p', '', line)));
    const actions = el('div', 'se-actions');
    body.append(actions);
    app.ui.button(actions, t('回到段落'), () => app.go({ name: 'passage', passageId }), scope, { variant: 'default', key: 'next' });
  }

  function showFront() {
    error.clear();
    player.stop();
    ownTakes.stop();
    if (position >= queue.length) { showSummary(); return; }
    const scope = newStep();
    const sentence = queue[position];
    progress.textContent = t('试背 · 第 {position}/{total} 句', { position: position + 1, total: queue.length });
    const prompt = el('p', 'se-status', t('按空格开始说。'));
    card = { sentence, attemptId: crypto.randomUUID(), side: 'front', shownAt: performance.now(), responseMs: null, speakMs: null, taken: null, judged: false, prompt };
    const actions = el('div', 'se-actions');
    body.replaceChildren(el('p', 'se-muted', t('场景：{register}', { register: t(REGISTER_LABELS[passage.register]) })), el('p', 'se-cue', sentence.zh), prompt, actions);
    app.ui.button(actions, t('想不起来，看答案'), giveUp, scope, { variant: 'ghost', key: 'answer' });
  }

  function speak() {
    if (recorder.isRecording()) { void recorder.stop(); return; }
    card.responseMs = performance.now() - card.shownAt;
    void recorder.start(speakLimitMs(card.sentence, app.state.settings));
  }
  app.keys.bind('record', { run: speak, label: t('录音'), enabled: () => card?.side === 'front' }, signal);
  showFront();
}
