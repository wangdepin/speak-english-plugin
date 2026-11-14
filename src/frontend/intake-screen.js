import { el, errorLine } from './dom.js';
import { REGISTER_LABELS, VERSION_LABELS } from './labels.js';
import { t } from './i18n.js';

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

/** Step 1: the Chinese passage and its register. */
function writeStep(app, root, signal, draft, showConfirm) {
  root.replaceChildren(el('h1', 'se-title', t('新段落')));
  const textarea = el('textarea', 'se-input se-passage-input');
  textarea.value = draft.chinese;
  textarea.maxLength = PASSAGE_MAX_CHARS;
  textarea.placeholder = t('用中文写下你想说的话，100 到 150 字左右。');
  const count = el('span', 'se-muted');
  const updateCount = () => { count.textContent = t('{count} 字', { count: textarea.value.trim().length }); };
  textarea.addEventListener('input', () => { draft.chinese = textarea.value; updateCount(); }, { signal });
  field(root, t('想说的话'), textarea);
  root.append(count);
  updateCount();

  root.append(el('span', 'se-label', t('场景')));
  radioGroup(root, 'se-register', Object.fromEntries(Object.entries(REGISTER_LABELS).map(([value, label]) => [value, t(label)])), draft.register, value => { draft.register = value; });
  const error = errorLine(root);
  const actions = el('div', 'se-actions');
  root.append(actions);
  const status = el('span', 'se-muted');
  app.ui.button(actions, t('翻译'), async () => {
    error.clear();
    status.textContent = t('正在翻译…');
    try {
      const { versions } = await app.call('translate', { register: draft.register, chinese: draft.chinese });
      if (signal.aborted) return;
      draft.versions = versions;
      draft.version = versions[0].id;
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

function sentenceEditor(sentence, index) {
  const row = el('div', 'se-sentence-edit');
  const bind = (control, key) => { control.value = sentence[key]; control.addEventListener('input', () => { sentence[key] = control.value; }); return control; };
  row.append(el('span', 'se-sentence-number', String(index + 1)));
  const fields = el('div', 'se-sentence-fields');
  field(fields, t('中文意图'), bind(el('input', 'se-input'), 'zh'));
  field(fields, t('英文'), bind(el('textarea', 'se-input se-english-input'), 'en'));
  field(fields, t('关键说法'), bind(el('input', 'se-input'), 'keyExpression'));
  row.append(fields);
  return row;
}

/** Step 2: review the whole translation once, edit if needed, then save it. */
function confirmStep(app, root, signal, draft, showWrite) {
  root.replaceChildren(el('h1', 'se-title', t('确认英文')));
  root.append(el('p', 'se-muted', t('每一句会成为一张卡片：正面是中文意图，背面是英文。关键说法会加粗，它必须是英文句子里的原话。')));
  const sentences = el('div', 'se-sentence-list');
  const renderSentences = () => {
    const version = draft.versions.find(item => item.id === draft.version);
    sentences.replaceChildren(...version.sentences.map(sentenceEditor));
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
      const { passageId, state } = await app.call('create-passage', { register: draft.register, version: draft.version, chinese: draft.chinese, sentences: version.sentences });
      if (signal.aborted) return;
      app.setState(state);
      app.go({ name: 'passage', passageId });
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
    }
  }, signal, { variant: 'default' });
  app.ui.button(actions, t('返回修改中文'), showWrite, signal);
  app.ui.button(actions, t('取消'), () => app.go({ name: 'home' }), signal, { variant: 'ghost' });
}

/** Intake: write Chinese, pick a register, translate, confirm once. */
export function intakeScreen(app, root, signal) {
  const draft = { chinese: '', register: 'formal', versions: [], version: '' };
  const showWrite = () => writeStep(app, root, signal, draft, showConfirm);
  function showConfirm() { confirmStep(app, root, signal, draft, showWrite); }
  showWrite();
}
