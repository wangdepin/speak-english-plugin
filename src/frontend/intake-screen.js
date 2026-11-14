import { el, errorLine, lifetime } from './dom.js';
import { REGISTER_LABELS, VERSION_LABELS } from './labels.js';
import { t } from './i18n.js';
import { LANGUAGES, languageName, readingLength } from './languages.js';
import { mountLanguageRows, pairLine } from './language-pair.js';

const PASSAGE_MAX_CHARS = 2000;

function radioGroup(parent, name, labels, selected, onChange) {
  const group = el('div', 'se-radios');
  for (const [value, label] of Object.entries(labels)) {
    const option = el('label', 'se-radio');
    const input = el('input');
    input.type = 'radio'; input.name = name; input.value = value; input.checked = value === selected;
    input.addEventListener('change', () => onChange(value));
    option.append(input, label);
    group.append(option);
  }
  parent.append(group);
  return group;
}

function field(parent, label, control) {
  const wrapper = el('label', 'se-field');
  wrapper.append(el('span', 'se-label', label), control);
  parent.append(wrapper);
  return control;
}

/** How long a passage should be and how its length is counted, by the language it is written in. */
function lengthGuide(nativeLanguage) {
  const language = languageName(nativeLanguage);
  if (LANGUAGES[nativeLanguage].readBy === 'char') {
    return { placeholder: t('用{language}写下你想说的话，100 到 150 字左右。', { language }), count: text => t('{count} 字', { count: readingLength(text, nativeLanguage) }) };
  }
  return { placeholder: t('用{language}写下你想说的话，60 到 100 词左右。', { language }), count: text => t('{count} 词', { count: readingLength(text, nativeLanguage) }) };
}

/**
 * The language pair a new passage will use, with a way to change it on the spot.
 * `redraw` draws the step again once the pair has been changed, so its texts follow.
 */
function languageLine(app, parent, signal, error, redraw) {
  const box = el('div', 'se-language-pair');
  parent.append(box);
  let scope = lifetime(signal);
  function show(editing) {
    scope.abort();
    scope = lifetime(signal);
    box.replaceChildren();
    if (!editing) {
      box.append(el('span', 'se-label', pairLine(app.state.settings)));
      app.ui.button(box, t('修改'), () => show(true), scope.signal, { variant: 'ghost' });
      return;
    }
    mountLanguageRows(app, box, scope.signal, error);
    app.ui.button(box, t('完成'), redraw, scope.signal);
  }
  show(false);
}

/** Step 1: the passage in the learner's own language, and its register. */
function writeStep(app, root, signal, draft, showConfirm, showWrite) {
  const guide = lengthGuide(app.state.settings.nativeLanguage);
  root.replaceChildren(el('h1', 'se-title', t('新段落')));
  const pairSlot = el('div');
  root.append(pairSlot);
  const textarea = el('textarea', 'se-input se-passage-input');
  textarea.value = draft.source;
  textarea.maxLength = PASSAGE_MAX_CHARS;
  textarea.placeholder = guide.placeholder;
  const count = el('span', 'se-muted');
  const updateCount = () => { count.textContent = guide.count(textarea.value); };
  textarea.addEventListener('input', () => { draft.source = textarea.value; updateCount(); }, { signal });
  field(root, t('想说的话'), textarea);
  root.append(count);
  updateCount();

  root.append(el('span', 'se-label', t('场景')));
  radioGroup(root, 'se-register', Object.fromEntries(Object.entries(REGISTER_LABELS).map(([value, label]) => [value, t(label)])), draft.register, value => { draft.register = value; });
  const error = errorLine(root);
  languageLine(app, pairSlot, signal, error, showWrite);
  const actions = el('div', 'se-actions');
  root.append(actions);
  const status = el('span', 'se-muted');
  app.ui.button(actions, t('翻译'), async () => {
    error.clear();
    status.textContent = t('正在翻译…');
    try {
      const { nativeLanguage, targetLanguage, versions } = await app.call('translate', { register: draft.register, text: draft.source });
      if (signal.aborted) return;
      Object.assign(draft, { nativeLanguage, targetLanguage, versions, version: versions[0].id });
      showConfirm();
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
    } finally {
      status.textContent = '';
    }
  }, signal, { variant: 'default' });
  app.ui.button(actions, t('取消'), () => app.go({ name: 'home' }), signal, { variant: 'ghost' });
  actions.append(status);
  textarea.focus();
}

function sentenceEditor(sentence, index, draft) {
  const row = el('div', 'se-sentence-edit');
  const bind = (control, key) => { control.value = sentence[key]; control.addEventListener('input', () => { sentence[key] = control.value; }); return control; };
  row.append(el('span', 'se-sentence-number', String(index + 1)));
  const fields = el('div', 'se-sentence-fields');
  field(fields, t('{language}意图', { language: languageName(draft.nativeLanguage) }), bind(el('input', 'se-input'), 'native'));
  field(fields, languageName(draft.targetLanguage), bind(el('textarea', 'se-input se-target-input'), 'target'));
  field(fields, t('关键说法'), bind(el('input', 'se-input'), 'keyExpression'));
  row.append(fields);
  return row;
}

/** Step 2: review the whole translation once, edit if needed, then save it. The languages are the ones it was translated between. */
function confirmStep(app, root, signal, draft, showWrite) {
  const names = { native: languageName(draft.nativeLanguage), target: languageName(draft.targetLanguage) };
  root.replaceChildren(el('h1', 'se-title', t('确认{language}', { language: names.target })));
  root.append(el('p', 'se-muted', t('每一句会成为一张卡片：正面是{native}意图，背面是{target}。关键说法会加粗，它必须是{target}句子里的原话。', names)));
  const sentences = el('div', 'se-sentence-list');
  const renderSentences = () => {
    const version = draft.versions.find(item => item.id === draft.version);
    sentences.replaceChildren(...version.sentences.map((sentence, index) => sentenceEditor(sentence, index, draft)));
  };
  if (draft.versions.length > 1) {
    const labels = Object.fromEntries(draft.versions.map(version => [version.id, t('{version}（{count} 句）', { version: t(VERSION_LABELS[version.id]), count: version.sentences.length })]));
    radioGroup(root, 'se-version', labels, draft.version, value => { draft.version = value; renderSentences(); });
  }
  root.append(sentences);
  renderSentences();
  const error = errorLine(root);
  const actions = el('div', 'se-actions');
  root.append(actions);
  app.ui.button(actions, t('确认并合成语音'), async () => {
    error.clear();
    const version = draft.versions.find(item => item.id === draft.version);
    try {
      const { passageId, state } = await app.call('create-passage', {
        register: draft.register, version: draft.version, nativeLanguage: draft.nativeLanguage, targetLanguage: draft.targetLanguage, source: draft.source, sentences: version.sentences,
      });
      if (signal.aborted) return;
      app.setState(state);
      app.go({ name: 'passage', passageId });
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
    }
  }, signal, { variant: 'default' });
  app.ui.button(actions, t('返回修改{language}', { language: names.native }), showWrite, signal);
  app.ui.button(actions, t('取消'), () => app.go({ name: 'home' }), signal, { variant: 'ghost' });
}

/** Intake: write in your own language, pick a register, translate, confirm once. */
export function intakeScreen(app, root, signal) {
  const draft = { source: '', register: 'formal', nativeLanguage: '', targetLanguage: '', versions: [], version: '' };
  // Each step gets its own lifetime, so the buttons of the step being left are disposed.
  let step = lifetime(signal);
  const enter = () => { step.abort(); step = lifetime(signal); return step.signal; };
  const showWrite = () => writeStep(app, root, enter(), draft, showConfirm, showWrite);
  function showConfirm() { confirmStep(app, root, enter(), draft, showWrite); }
  showWrite();
}
