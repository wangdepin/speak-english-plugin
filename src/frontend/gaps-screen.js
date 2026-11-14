import { el, errorLine } from './dom.js';
import { passageDate } from './labels.js';
import { mountLessonButtons } from './lesson-start.js';
import { t } from './i18n.js';

const listed = words => words.join(', ');

/** What the diagnostic found in one sentence, in one line. `found` is undefined for a sentence it did not reach. */
export function findingText(found) {
  if (!found) return t('没测');
  const parts = [];
  if (!found.retold) parts.push(t('没能复述'));
  if (found.notSaid.length > 0) parts.push(t('没说出来：{words}', { words: listed(found.notSaid) }));
  if (found.unclear.length > 0) parts.push(t('说得不清楚：{words}', { words: listed(found.unclear) }));
  if (found.unknown.length > 0) parts.push(t('不认识：{words}', { words: listed(found.unknown) }));
  return parts.length > 0 ? parts.join(' · ') : t('没有缺口');
}

/** The result of a passage's listening diagnostic, sentence by sentence, and the way on to the teacher. */
export function gapsScreen(app, root, signal, { passageId }) {
  const passage = app.state.passages.find(item => item.id === passageId);
  if (!passage) { app.go({ name: 'home' }); return; }
  if (!passage.diagnosis) { app.go({ name: 'diagnose', passageId }); return; }
  const go = name => () => app.go({ name, passageId });

  const header = el('div', 'se-header');
  app.ui.button(header, t('← 返回段落'), go('passage'), signal, { variant: 'ghost' });
  header.append(el('span', 'se-muted', t('摸底结果 · {date}', { date: passageDate(passage.diagnosis.at) })));
  const list = el('div', 'se-sentence-list');
  passage.sentences.forEach((sentence, index) => {
    const row = el('div', 'se-sentence');
    const text = el('div', 'se-sentence-text');
    text.append(el('p', 'se-target', sentence.target), el('p', 'se-muted', findingText(passage.diagnosis.sentences[sentence.id])));
    row.append(el('span', 'se-sentence-number', String(index + 1)), text);
    list.append(row);
  });
  root.append(header, list);
  const error = errorLine(root);
  const actions = el('div', 'se-actions');
  root.append(actions);
  mountLessonButtons(app, actions, signal, passageId, error, 'default');
  app.ui.button(actions, t('朗读和变速听'), go('consolidate'), signal);
  app.ui.button(actions, t('重新摸底'), go('diagnose'), signal, { variant: 'ghost' });
}
