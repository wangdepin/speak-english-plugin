import { el } from './dom.js';
import { hintText, markWords, scoreLine } from './word-marking.js';
import { mark, t } from './i18n.js';

const STATUS_TITLES = { good: '', wrong: mark('读得不准'), missed: mark('漏读'), extra: mark('多读的词') };

/** Shows one assessment: the sentence with each word marked, the scores, and what weak sounds resembled. */
export function renderAssessment(parent, referenceText, assessment) {
  const { words, hints } = markWords(referenceText, assessment);
  const sentence = el('p', 'se-marked');
  for (const word of words) {
    const span = el('span', `se-word se-word-${word.status}`, word.text);
    if (STATUS_TITLES[word.status]) span.title = t(STATUS_TITLES[word.status]);
    sentence.append(span, ' ');
  }
  parent.replaceChildren(sentence, el('p', 'se-muted', scoreLine(assessment.scores)));
  if (hints.length === 0) return;
  const list = el('ul', 'se-hints');
  for (const hint of hints) list.append(el('li', '', hintText(hint)));
  parent.append(list);
}
