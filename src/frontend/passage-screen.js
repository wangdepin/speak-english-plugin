import { el, errorLine, lifetime } from './dom.js';
import { appendWithKey, passageSummary } from './labels.js';
import { createSentencePlayer, playSentences, slowToggle } from './sentence-player.js';
import { mountQuestions } from './question-section.js';
import { mountLessonButtons } from './lesson-start.js';
import { mark, t } from './i18n.js';

const RECALL_NOTES = { scheduled: mark('已进入复习'), tomorrow: mark('明天再试背'), pending: '' };

/** A line under a sentence saying where it stands: waiting for recall, or when it is next reviewed. */
function recallNote(sentence) {
  const note = t(RECALL_NOTES[sentence.recall]);
  const dueDay = sentence.schedule?.dueDay;
  return dueDay ? t('{note} · 下次 {month} 月 {day} 日', { note, month: Number(dueDay.slice(5, 7)), day: Number(dueDay.slice(8, 10)) }) : note;
}

/**
 * One passage. This screen is the "listen" step (whole passage or one sentence,
 * optionally slowed down) and the way into shadowing, whole reading and recall.
 * Above those is the optional first step: a listening diagnostic, a lesson with
 * the app's teacher, then reading aloud and speed listening.
 * Below the sentences are the passage's questions for the "respond" exercise.
 * Missing reference audio is synthesized one sentence at a time.
 */
export function passageScreen(app, root, signal, { passageId }) {
  const findPassage = () => app.state.passages.find(passage => passage.id === passageId);
  if (!findPassage()) { app.go({ name: 'home' }); return; }
  const player = createSentencePlayer(app.call, signal);
  let synthesizing = false;
  let playingId = null;
  // Rows are rebuilt on every render; their host buttons are disposed with this scope.
  let rows = lifetime(signal);

  const header = el('div', 'se-header');
  app.ui.button(header, t('← 返回'), () => app.go({ name: 'home' }), signal, { variant: 'ghost' });
  const summary = el('span', 'se-muted');
  header.append(summary);
  const study = el('div', 'se-actions se-study');
  const steps = el('div', 'se-actions se-steps');
  const listen = el('div', 'se-actions');
  const status = el('p', 'se-muted se-status');
  const list = el('div', 'se-sentence-list');
  root.append(header, study, steps, listen, status);
  const error = errorLine(root);
  const retrySlot = el('div', 'se-actions');
  root.append(retrySlot, list);
  mountQuestions(app, root, signal, passageId, error);
  const footer = el('div', 'se-actions se-footer');
  root.append(footer);
  // Mounted once, not with the rows: a lesson that is starting outlives the redraws during synthesis.
  const lesson = mountLessonButtons(app, study, signal, passageId, error);

  const guarded = action => async () => {
    error.clear();
    try { await action(); } catch (cause) { if (!signal.aborted) error.show(cause); }
  };
  const markPlaying = sentenceId => {
    playingId = sentenceId;
    for (const row of list.children) row.classList.toggle('se-current', row.dataset.sentenceId === sentenceId);
  };

  const playAll = guarded(() => playSentences(player, findPassage().sentences, { rate: rate(), onSentence: markPlaying }));
  const stopAll = () => { player.stop(); markPlaying(null); };
  app.ui.button(listen, t('▶ 整段原声'), playAll, signal);
  app.ui.button(listen, t('■ 停止'), stopAll, signal, { variant: 'ghost' });
  app.keys.bind('reference', { run: () => (player.isPlaying() ? stopAll() : playAll()), label: t('整段原声') }, signal);
  const rate = slowToggle(listen);

  async function synthesize(sentenceId, force) {
    const state = await app.call('synthesize-sentence', { sentenceId, force });
    if (signal.aborted) return;
    player.forget(sentenceId);
    app.setState(state);
    render();
  }

  function sentenceRow(sentence, index) {
    const row = el('div', 'se-sentence');
    row.dataset.sentenceId = sentence.id;
    row.classList.toggle('se-current', sentence.id === playingId);
    const text = el('div', 'se-sentence-text');
    const spoken = el('p', 'se-target');
    appendWithKey(spoken, sentence.target, sentence.keyExpression);
    text.append(el('p', 'se-native', sentence.native), spoken);
    if (recallNote(sentence)) text.append(el('p', 'se-muted', recallNote(sentence)));
    const controls = el('div', 'se-sentence-controls');
    if (sentence.audio) {
      app.ui.button(controls, t('▶ 原声'), guarded(async () => { markPlaying(null); await player.play(sentence.id, { rate: rate() }); }), rows.signal);
      controls.append(el('span', 'se-muted', t('{seconds} 秒', { seconds: sentence.audio.seconds.toFixed(1) })));
      app.ui.button(controls, t('重新合成'), guarded(() => synthesize(sentence.id, true)), rows.signal, { variant: 'ghost', disabled: synthesizing });
    } else {
      controls.append(el('span', 'se-muted', synthesizing ? t('等待合成…') : t('还没有语音')));
    }
    row.append(el('span', 'se-sentence-number', String(index + 1)), text, controls);
    return row;
  }

  function renderStudy(passage) {
    study.replaceChildren(el('span', 'se-muted', t('先学一遍（可选）')));
    const go = name => () => app.go({ name, passageId });
    app.ui.button(study, passage.diagnosis ? t('摸底结果') : t('摸底'), go(passage.diagnosis ? 'gaps' : 'diagnose'), rows.signal);
    study.append(lesson.element);
    lesson.refresh();
    app.ui.button(study, passage.consolidation ? t('朗读和变速听（已做）') : t('朗读和变速听'), go('consolidate'), rows.signal);
  }

  function renderSteps(passage) {
    steps.replaceChildren();
    const pending = passage.sentences.filter(sentence => sentence.recall === 'pending').length;
    const go = name => () => app.go({ name, passageId });
    app.ui.button(steps, t('分段跟读'), go('shadow'), rows.signal);
    app.ui.button(steps, passage.firstReading ? t('完整跟读（已录过）') : t('完整跟读'), go('reading'), rows.signal);
    app.ui.button(steps, pending > 0 ? t('试背（{count} 句）', { count: pending }) : t('试背'), go('recall'), rows.signal, { disabled: pending === 0 });
  }

  function render() {
    rows.abort();
    rows = lifetime(signal);
    const passage = findPassage();
    summary.textContent = passageSummary(passage);
    renderStudy(passage);
    renderSteps(passage);
    list.replaceChildren(...passage.sentences.map(sentenceRow));
    retrySlot.replaceChildren();
    const missing = passage.sentences.filter(sentence => !sentence.audio).length;
    if (missing > 0 && !synthesizing) app.ui.button(retrySlot, t('合成剩下的 {count} 句', { count: missing }), synthesizeMissing, rows.signal);
  }

  async function synthesizeMissing() {
    if (synthesizing) return;
    synthesizing = true;
    error.clear();
    const total = findPassage().sentences.length;
    try {
      for (const sentence of findPassage().sentences.filter(item => !item.audio)) {
        if (signal.aborted) return;
        const done = findPassage().sentences.filter(item => item.audio).length;
        status.textContent = t('正在合成语音 {position}/{total}…', { position: done + 1, total });
        render();
        await synthesize(sentence.id, false);
      }
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
    } finally {
      synthesizing = false;
      if (!signal.aborted) { status.textContent = ''; render(); }
    }
  }

  app.ui.confirmButton(footer, t('删除这一段'), guarded(async () => {
    const state = await app.call('delete-passage', { passageId });
    if (signal.aborted) return;
    app.setState(state);
    app.go({ name: 'home' });
  }), signal, { variant: 'ghost' });

  render();
  if (findPassage().sentences.some(sentence => !sentence.audio) && app.state.secrets.elevenLabsKey) void synthesizeMissing();
}
