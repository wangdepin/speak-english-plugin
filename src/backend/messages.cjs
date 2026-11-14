'use strict';

const EN = require('./messages-en.cjs');

const LANGUAGES = Object.freeze(['zh', 'en']);
let language = 'zh';

/** Sets the language of the messages shown to the user; anything unknown means Chinese. */
function setLanguage(next) {
  language = LANGUAGES.includes(next) ? next : 'zh';
}

const fill = (template, params) => template.replace(/\{(\w+)\}/g, (whole, name) => (Object.hasOwn(params, name) ? String(params[name]) : whole));

/**
 * The message for `source` in the current language. The Chinese text is the
 * key; `{name}` stands for a value from `params`. English entries live in
 * messages-en.cjs.
 */
function t(source, params = {}) {
  const entry = language === 'en' ? EN[source] : undefined;
  return fill(entry ?? source, params);
}

/** Marks a text for translation where it is defined; translate it with t() where it is used. */
const mark = source => source;

module.exports = { t, mark, setLanguage, LANGUAGES };
