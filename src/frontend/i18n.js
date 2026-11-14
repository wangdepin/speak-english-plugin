import { EN } from './en.js';

export const LANGUAGES = ['zh', 'en'];
const LOCALES = { zh: 'zh-CN', en: 'en-US' };
let language = 'zh';
const listeners = new Set();

/** Sets the interface language; anything unknown means Chinese. Tells the listeners when it changed. */
export function setLanguage(next) {
  const value = LANGUAGES.includes(next) ? next : 'zh';
  if (value === language) return;
  language = value;
  for (const listener of [...listeners]) listener();
}

/** Calls `listener` whenever the interface language changes, until `signal` aborts. */
export function onLanguageChange(listener, signal) {
  listeners.add(listener);
  signal.addEventListener('abort', () => listeners.delete(listener), { once: true });
}

/** The locale to format dates with. */
export const locale = () => LOCALES[language];

const fill = (template, params) => template.replace(/\{(\w+)\}/g, (whole, name) => (Object.hasOwn(params, name) ? String(params[name]) : whole));

/**
 * The interface text for `source` in the current language. The Chinese text is
 * the key; `{name}` stands for a value from `params`. English entries live in
 * en.js and may be functions of `params` where the wording depends on a number.
 */
export function t(source, params = {}) {
  const entry = language === 'en' ? EN[source] : undefined;
  if (typeof entry === 'function') return entry(params);
  return fill(entry ?? source, params);
}

/** Marks a text for translation where it is defined; translate it with t() where it is shown. */
export const mark = source => source;
