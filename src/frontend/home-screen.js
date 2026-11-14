import { el, errorLine, lifetime } from './dom.js';
import { passageSummary } from './labels.js';
import { listenableSentences, respondablePassages } from './exercise-picks.js';
import { t } from './i18n.js';
import { mountLanguageRows, pairLine } from './language-pair.js';

function missingSetup(state) {
  const missing = [];
  if (!state.secrets.elevenLabsKey) missing.push(t('还没有填 ElevenLabs 密钥，新段落无法合成语音。'));
  if (!state.secrets.azureKey || !state.settings.azureRegion) missing.push(t('还没有填 Azure 语音的密钥和区域，跟读时无法评分。'));
  return missing;
}

function renderNotices(app, parent, signal) {
  parent.replaceChildren();
  const missing = missingSetup(app.state);
  if (missing.length === 0) return;
  const box = el('div', 'se-notice');
  for (const line of missing) box.append(el('p', '', line));
  app.ui.button(box, t('打开设置'), () => app.ctx.app.openSettings(), signal);
  parent.append(box);
}

/**
 * Asks once which two languages to practise with: confirm the pair, or change it here.
 * Either answer is remembered, and the card does not come back. `redraw` draws the home screen again.
 */
function renderLanguages(app, parent, signal, error, redraw) {
  parent.replaceChildren();
  if (app.state.settings.languagesConfirmed) return;
  const box = el('div', 'se-notice');
  const actions = el('div', 'se-actions');
  box.append(el('p', 'se-label', t('练习语言')), el('p', '', pairLine(app.state.settings)), el('p', 'se-muted', t('新段落会从母语翻译成学习语言。以后可以在插件设置里改。')), actions);
  parent.append(box);
  /** Remembers that the learner has answered. Resolves to whether that worked. */
  const remember = async () => {
    try { app.setState(await app.call('save-settings', { languagesConfirmed: true })); return true; }
    catch (cause) { if (!signal.aborted) error.show(cause); return false; }
  };
  app.ui.button(actions, t('确认'), async () => { if (await remember() && !signal.aborted) redraw(); }, signal, { variant: 'default' });
  app.ui.button(actions, t('修改'), async () => {
    if (!(await remember()) || signal.aborted) return;
    box.replaceChildren(el('p', 'se-label', t('练习语言')));
    mountLanguageRows(app, box, signal, error);
    const done = el('div', 'se-actions');
    box.append(done);
    app.ui.button(done, t('完成'), redraw, signal, { variant: 'default' });
  }, signal);
}

/** The way into today's review. Hidden until at least one sentence has entered spaced review. */
function renderReview(app, parent, signal) {
  parent.replaceChildren();
  const { review } = app.state;
  if (review.scheduled === 0) return;
  const canWait = review.waiting.length > 0 && review.doneToday < review.limit;
  const box = el('div', 'se-notice se-review');
  box.append(el('p', 'se-label', t('到期复习')));
  box.append(el('p', '', review.dueIds.length > 0 ? t('现在有 {count} 句到期。', { count: review.dueIds.length }) : t('现在没有到期的句子。')));
  if (canWait) box.append(el('p', '', t('{count} 句刚才没说出来，10 分钟后再来一次。', { count: review.waiting.length })));
  if (review.postponed > 0) box.append(el('p', '', t('另有 {count} 句超过每日上限，顺延到明天。', { count: review.postponed })));
  box.append(el('p', 'se-muted', t('今天已复习 {done}/{limit} 次 · 复习中的句子共 {scheduled} 句', { done: review.doneToday, limit: review.limit, scheduled: review.scheduled })));
  app.ui.button(box, t('开始复习'), () => app.go({ name: 'review' }), signal, { variant: 'default', disabled: review.dueIds.length === 0 && !canWait });
  parent.append(box);
}

/** The optional, unscheduled exercises. Hidden until there is a sentence with audio to practise on. */
function renderExercises(app, parent, signal) {
  parent.replaceChildren();
  const listenable = listenableSentences(app.state).length;
  if (listenable === 0) return;
  const respondable = respondablePassages(app.state).length;
  const box = el('div', 'se-notice se-review');
  box.append(el('p', 'se-label', t('可选练习')), el('p', 'se-muted', t('不排期，想练就练。只听一遍：每句只放一遍，看能不能当场听懂。接话：听到问句，用背过的话回答。')));
  const actions = el('div', 'se-actions');
  box.append(actions);
  app.ui.button(actions, t('只听一遍'), () => app.go({ name: 'listen' }), signal);
  app.ui.button(actions, t('接话'), () => app.go({ name: 'respond' }), signal, { disabled: respondable === 0 });
  if (respondable === 0) box.append(el('p', 'se-muted', t('接话还用不了：需要一段话的句子全部进入复习，并在段落页生成问句。')));
  parent.append(box);
}

function passageRow(app, passage) {
  const row = el('button', 'se-passage-row');
  row.type = 'button';
  row.append(el('span', 'se-passage-preview', passage.sentences[0]?.native ?? ''), el('span', 'se-muted', passageSummary(passage)));
  row.addEventListener('click', () => app.go({ name: 'passage', passageId: passage.id }));
  return row;
}

function renderPassages(app, parent) {
  parent.replaceChildren();
  if (app.state.passages.length === 0) {
    parent.append(el('p', 'se-muted', t('还没有段落。点「新段落」，写下你想说的话。')));
    return;
  }
  for (const passage of app.state.passages) parent.append(passageRow(app, passage));
}

/** The first screen: the languages to confirm on first use, what is still missing in settings, today's review, the optional exercises, and the passages entered so far. */
export function homeScreen(app, root, signal) {
  // The host already shows the view's name above this screen.
  const header = el('div', 'se-header');
  header.append(el('h2', 'se-title', t('我的段落')));
  app.ui.button(header, t('新段落'), () => app.go({ name: 'intake' }), signal, { variant: 'default' });
  const languages = el('div');
  const notices = el('div');
  const review = el('div');
  const exercises = el('div');
  const passages = el('div', 'se-passages');
  root.append(languages, notices, review, exercises, header);
  const error = errorLine(root);
  root.append(passages);

  // Each render mounts its own host buttons; the previous render's are disposed first.
  let buttons = lifetime(signal);
  const render = () => {
    buttons.abort();
    buttons = lifetime(signal);
    renderLanguages(app, languages, buttons.signal, error, render);
    renderNotices(app, notices, buttons.signal);
    renderReview(app, review, buttons.signal);
    renderExercises(app, exercises, buttons.signal);
    renderPassages(app, passages);
  };
  render();
  // Settings live on another page, so what was loaded earlier may be out of date.
  app.call('get-state').then(state => {
    if (signal.aborted) return;
    app.setState(state);
    render();
  }, cause => { if (!signal.aborted) error.show(cause); });
}
