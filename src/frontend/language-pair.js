import { el } from './dom.js';
import { t } from './i18n.js';
import { languageLabel, languageOptions } from './languages.js';

/** The two practice languages as settings rows. `save(patch)` stores a change and rejects when it is refused. */
export function languageRows(settings, save) {
  const row = (key, label, description) => ({ key, label, description, type: 'dropdown', value: settings[key], options: languageOptions(), onChange: value => save({ [key]: value }) });
  return [
    row('nativeLanguage', t('母语'), t('你用它写下想说的话，讲解也用它。选成和学习语言一样时，两者对调。')),
    row('targetLanguage', t('学习语言'), t('新段落会翻译成它。已有的段落保持原来的语言。')),
  ];
}

/** The pair in one line: 中文（普通话，简体） → 英语（美国）. */
export const pairLine = settings => t('{native} → {target}', { native: languageLabel(settings.nativeLanguage), target: languageLabel(settings.targetLanguage) });

/**
 * Mounts the two dropdowns in `parent`. Each choice is saved at once; `error` is
 * the screen's error line. The dropdowns live until `signal` aborts.
 */
export function mountLanguageRows(app, parent, signal, error) {
  const slot = el('div', 'se-language-rows');
  parent.append(slot);
  const rows = () => languageRows(app.state.settings, save);
  const widget = app.ui.widget(app.ctx.ui.mountSettingsRows(slot, { rows: rows() }, { signal }), signal);
  async function save(patch) {
    try {
      app.setState(await app.call('save-settings', patch));
      error.clear();
      // Choosing the other side's language swaps the two, so both rows may have changed.
      if (!signal.aborted) widget.update({ rows: rows() });
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
      throw cause;
    }
  }
}
