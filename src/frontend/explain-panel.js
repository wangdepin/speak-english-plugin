import { el, errorLine, lifetime } from './dom.js';
import { findSentence } from './lookup.js';
import { t } from './i18n.js';

function option(title) {
  const box = el('div', 'se-option');
  box.append(el('p', 'se-label', title));
  return box;
}

/**
 * Shown after a miss on a sentence that has been missed often: the answer, and
 * the suggestion to look at the explanation. Buttons live until `scope` aborts.
 */
export function suggestExplanation(app, body, scope, sentence, { onExplain, onNext }) {
  const { misses } = findSentence(app.state, sentence.id).sentence;
  const actions = el('div', 'se-actions');
  body.replaceChildren(el('p', 'se-chinese', sentence.zh), el('p', 'se-english se-english-large', sentence.en), el('p', '', t('这一句已经 {misses} 次没说出来了。看看讲解，找出卡在哪里？', { misses })), actions);
  app.ui.button(actions, t('看讲解'), onExplain, scope, { variant: 'default', key: 'explain' });
  app.ui.button(actions, t('下一句 →'), onNext, scope, { key: 'next' });
}

/**
 * The explanation flow for one sentence, drawn into `body` in place of the card.
 * First it sorts out what is missing: the learner tries once more without a time
 * limit. Being able to say it means only speed is missing, and nothing is
 * explained. Otherwise the model explains, and its simpler wording or its split
 * can be adopted in place of the sentence.
 * `onDone(replaced)` is called when the learner leaves; `replaced` is true when the sentence no longer exists.
 */
export function openExplanation(app, body, signal, sentenceId, onDone) {
  const scope = lifetime(signal);
  let step = lifetime(scope.signal);
  const errorHolder = el('div');
  const error = errorLine(errorHolder);
  const done = replaced => { scope.abort(); onDone(replaced); };
  const found = findSentence(app.state, sentenceId);
  if (!found) { done(true); return; }
  const { sentence } = found;

  /** Starts a new step: its title and content, then a row for its buttons, which is returned. */
  function frame(title, ...content) {
    step.abort();
    step = lifetime(scope.signal);
    error.clear();
    const actions = el('div', 'se-actions');
    body.replaceChildren(el('p', 'se-subtitle', title), ...content, actions, errorHolder);
    return actions;
  }
  const button = (parent, label, action, options) => app.ui.button(parent, label, action, step.signal, options);

  function showClassify() {
    const actions = frame(t('先分清缺的是什么'), el('p', 'se-cue', sentence.zh), el('p', '', t('不限时间，看着中文把这句话再说一遍，然后自己判断。')));
    button(actions, t('还是说不出来'), askModel, { key: 'no' });
    button(actions, t('能说出来'), recordSpeedGap, { key: 'yes' });
    button(actions, t('返回'), () => done(false), { variant: 'ghost' });
  }

  async function recordSpeedGap() {
    try {
      const state = await app.call('record-speed-gap', { sentenceId });
      if (scope.signal.aborted) return;
      app.setState(state);
    } catch (cause) {
      if (!scope.signal.aborted) error.show(cause);
      return;
    }
    const actions = frame(t('缺的是速度'), el('p', '', t('不限时能说出来，说明这句话你已经会了，缺的只是速度。不需要讲解，继续按排期练就行。')));
    button(actions, t('好的'), () => done(false), { variant: 'default', key: 'next' });
  }

  async function askModel() {
    frame(t('讲解'), el('p', 'se-muted', t('正在请模型讲解，大约十几秒…')));
    try {
      const { explanation, state } = await app.call('explain-sentence', { sentenceId });
      if (scope.signal.aborted) return;
      app.setState(state);
      showExplanation(explanation);
    } catch (cause) {
      if (scope.signal.aborted) return;
      const actions = frame(t('讲解'));
      error.show(cause);
      button(actions, t('再试一次'), askModel);
      button(actions, t('返回'), () => done(false), { variant: 'ghost' });
    }
  }

  function showExplanation(explanation) {
    const difficulties = el('ul', 'se-hints');
    for (const item of explanation.difficulty) difficulties.append(el('li', '', item));
    const simpler = option(t('更简单的说法'));
    simpler.append(el('p', 'se-english', explanation.simpler.en), el('p', 'se-muted', explanation.simpler.why));
    const content = [el('p', 'se-chinese', sentence.zh), el('p', 'se-english', sentence.en), difficulties, simpler];
    let split = null;
    if (explanation.split) {
      split = option(t('拆成两句'));
      for (const part of explanation.split) split.append(el('p', 'se-chinese', part.zh), el('p', 'se-english', part.en));
      content.push(split);
    }
    content.push(el('p', 'se-muted', t('采用后，这张卡换成新句子：语音重新合成，回到段落里重新试背，排期从头开始。原句的练习记录会删除。')));
    const actions = frame(t('这句难在哪里'), ...content);
    app.ui.confirmButton(simpler, t('采用这个说法'), () => adopt('simpler'), step.signal);
    if (split) app.ui.confirmButton(split, t('采用拆分'), () => adopt('split'), step.signal);
    button(actions, t('不采用，继续练原句'), () => done(false), { variant: 'default', key: 'next' });
    button(actions, t('重新讲解'), askModel, { variant: 'ghost' });
  }

  /** Synthesizes the new sentences one by one. Returns the first failure, or null. */
  async function synthesize(sentenceIds) {
    for (const id of sentenceIds) {
      try {
        const state = await app.call('synthesize-sentence', { sentenceId: id });
        if (scope.signal.aborted) return null;
        app.setState(state);
      } catch (cause) {
        return cause;
      }
    }
    return null;
  }

  async function adopt(choice) {
    let sentenceIds;
    try {
      const result = await app.call('adopt-explanation', { sentenceId, choice });
      if (scope.signal.aborted) return;
      app.setState(result.state);
      sentenceIds = result.sentenceIds;
    } catch (cause) {
      if (!scope.signal.aborted) error.show(cause);
      return;
    }
    frame(t('已换成新卡'), el('p', 'se-muted', t('正在合成新句子的语音…')));
    const failure = await synthesize(sentenceIds);
    if (scope.signal.aborted) return;
    const actions = frame(t('已换成新卡'), el('p', '', t('新句子在段落里等你试背，说出来后重新进入复习。')));
    if (failure) { error.show(failure); actions.before(el('p', 'se-muted', t('语音没有合成成功，可以到段落页重试。'))); }
    button(actions, t('继续'), () => done(true), { variant: 'default', key: 'next' });
  }

  if (sentence.explanation) showExplanation(sentence.explanation);
  else showClassify();
}
