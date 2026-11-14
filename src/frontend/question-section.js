import { el, lifetime } from './dom.js';
import { isMemorized } from './exercise-picks.js';
import { createPlayer } from './sentence-player.js';
import { t } from './i18n.js';

function draftRow(draft) {
  const row = el('div', 'se-question-draft');
  const english = el('input', 'se-input');
  english.value = draft.en;
  english.setAttribute('aria-label', t('问句（英文）'));
  const chinese = el('input', 'se-input');
  chinese.value = draft.zh;
  chinese.setAttribute('aria-label', t('问句的中文'));
  row.append(english, chinese);
  return { row, read: () => ({ en: english.value, zh: chinese.value }) };
}

/**
 * The questions of one passage, for the "respond" exercise: listen to them,
 * delete them, or have the model suggest more. Suggestions can be edited and
 * are saved only when confirmed; saved questions are then synthesized one by one.
 * `error` is the page's error line.
 */
export function mountQuestions(app, parent, signal, passageId, error) {
  const findPassage = () => app.state.passages.find(passage => passage.id === passageId);
  const player = createPlayer(questionId => app.call('question-audio', { passageId, questionId }), signal);
  const section = el('div', 'se-questions');
  const hint = el('p', 'se-muted');
  const list = el('div', 'se-question-list');
  const status = el('p', 'se-muted se-status');
  const editor = el('div');
  const actions = el('div', 'se-actions');
  section.append(el('h3', 'se-subtitle', t('接话的问句')), hint, list, status, editor, actions);
  parent.append(section);
  let rows = lifetime(signal);
  let editing = lifetime(signal);
  let busy = false;

  const guarded = action => async () => {
    error.clear();
    try { await action(); } catch (cause) { if (!signal.aborted) error.show(cause); }
  };

  async function synthesize(questionId, force) {
    const state = await app.call('synthesize-question', { passageId, questionId, force });
    if (signal.aborted) return;
    player.forget(questionId);
    app.setState(state);
    render();
  }

  /** Synthesizes every question that has no audio yet, one at a time, and stops at the first failure. */
  async function synthesizeMissing() {
    if (busy) return;
    busy = true;
    try {
      for (const question of findPassage().questions.filter(item => !item.audio)) {
        if (signal.aborted) return;
        status.textContent = t('正在合成问句的语音：{question}', { question: question.en });
        await synthesize(question.id, false);
      }
    } finally {
      busy = false;
      if (!signal.aborted) { status.textContent = ''; render(); }
    }
  }

  function questionRow(question) {
    const row = el('div', 'se-sentence');
    const text = el('div', 'se-sentence-text');
    text.append(el('p', 'se-english', question.en), el('p', 'se-chinese', question.zh));
    const controls = el('div', 'se-sentence-controls');
    if (question.audio) app.ui.button(controls, '▶', guarded(() => player.play(question.id)), rows.signal);
    else controls.append(el('span', 'se-muted', busy ? t('等待合成…') : t('还没有语音')));
    app.ui.confirmButton(controls, t('删除'), guarded(async () => {
      const state = await app.call('delete-question', { passageId, questionId: question.id });
      if (signal.aborted) return;
      app.setState(state);
      render();
    }), rows.signal, { variant: 'ghost' });
    row.append(text, controls);
    return row;
  }

  function closeEditor() {
    editing.abort();
    editor.replaceChildren();
    render();
  }

  /** Shows the suggested questions in editable fields. Nothing is saved until the learner confirms. */
  function openEditor(drafts) {
    editing.abort();
    editing = lifetime(signal);
    actions.replaceChildren();
    const fields = drafts.map(draftRow);
    const buttons = el('div', 'se-actions');
    editor.replaceChildren(el('p', 'se-muted', t('可以改写；不想要的清空英文那一栏。保存后合成语音。')), ...fields.map(field => field.row), buttons);
    app.ui.button(buttons, t('保存问句'), guarded(async () => {
      const questions = fields.map(field => field.read()).filter(question => question.en.trim() !== '');
      if (questions.length === 0) { closeEditor(); return; }
      const { state } = await app.call('add-questions', { passageId, questions });
      if (signal.aborted) return;
      app.setState(state);
      closeEditor();
      await synthesizeMissing();
    }), editing.signal, { variant: 'default' });
    app.ui.button(buttons, t('取消'), closeEditor, editing.signal, { variant: 'ghost' });
  }

  async function suggest() {
    status.textContent = t('正在请模型出问句，大约十几秒…');
    try {
      const { questions } = await app.call('suggest-questions', { passageId });
      if (!signal.aborted) openEditor(questions);
    } finally {
      if (!signal.aborted) status.textContent = '';
    }
  }

  function render() {
    rows.abort();
    rows = lifetime(signal);
    const passage = findPassage();
    if (!passage) return;
    const { questions } = passage;
    hint.textContent = isMemorized(passage)
      ? t('「接话」练习会随机用其中一个问句来问你，你用这一段背过的话回答。')
      : t('这一段的句子全部进入复习后，才会出现在「接话」练习里。问句可以先准备好。');
    list.replaceChildren(...questions.map(questionRow));
    actions.replaceChildren();
    app.ui.button(actions, questions.length > 0 ? t('再生成几个问句') : t('生成问句'), guarded(suggest), rows.signal);
    const missing = questions.filter(question => !question.audio).length;
    if (missing > 0 && !busy) app.ui.button(actions, t('合成剩下的 {count} 个', { count: missing }), guarded(synthesizeMissing), rows.signal);
  }

  render();
}
