'use strict';

// The interface exists in Chinese and English. The Chinese text in the code is the key of
// the English tables, so these tests read the source files to check the tables are complete.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { t, setLanguage } = require('../src/backend/messages.cjs');
const BACKEND_EN = require('../src/backend/messages-en.cjs');
const { applySettingsPatch, defaultSettings } = require('../src/backend/settings.cjs');

const SRC = path.join(__dirname, '..', 'src');
const load = name => import(pathToFileURL(path.join(SRC, 'frontend', name)).href);
const CJK = /[一-鿿]/;
// Text sent to the model, not shown in the interface: it stays Chinese by decision.
const PROMPT_FILES = ['explain-prompts.cjs', 'translate-prompts.cjs', 'question-prompts.cjs', 'lesson-guide.cjs'];
// Language names are shown in their own language whatever the interface language is.
const UNTRANSLATED = ["'中文'", "'界面语言 / Language'"];

function sourceFiles(directory, extension, skip) {
  return fs.readdirSync(path.join(SRC, directory), { recursive: true })
    .filter(name => name.endsWith(extension) && !skip.includes(path.basename(name)))
    .map(name => ({ name, text: fs.readFileSync(path.join(SRC, directory, name), 'utf8') }));
}
const FRONTEND = sourceFiles('frontend', '.js', ['en.js']);
const BACKEND = sourceFiles('backend', '.cjs', ['messages-en.cjs']);

const isComment = line => /^\s*(\*|\/\*\*|\/\/)/.test(line);
const codeLines = text => text.split('\n').filter(line => !isComment(line)).map(line => line.replace(/\s\/\/ .*$/, ''));
const CALL = /(?<![\w.])(?:t|mark)\('((?:[^'\\]|\\.)*)'/g;
const sourcesOf = files => new Set(files.flatMap(file => [...file.text.matchAll(CALL)].map(match => match[1])));
const placeholders = text => new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]));

/** Sample values for the placeholders of `source`: `number` for all of them. */
const sample = (source, number) => Object.fromEntries([...placeholders(source)].map(name => [name, number]));

function checkTable(sources, table) {
  for (const source of sources) {
    const entry = table[source];
    assert.ok(entry !== undefined, `no English text for: ${source}`);
    if (typeof entry === 'string') {
      assert.deepEqual([...placeholders(entry)].sort(), [...placeholders(source)].sort(), `placeholders differ for: ${source}`);
      assert.ok(!CJK.test(entry), `Chinese left in the English text for: ${source}`);
      continue;
    }
    for (const number of [1, 2]) {
      const text = entry(sample(source, number));
      assert.ok(typeof text === 'string' && text !== '' && !CJK.test(text) && !/undefined|NaN/.test(text), `bad English text for: ${source} → ${text}`);
    }
  }
  assert.deepEqual(Object.keys(table).filter(source => !sources.has(source)), [], 'English texts that the code no longer uses');
}

/** Lines whose Chinese text is neither inside t()/mark() nor on the list of untranslated texts. */
function rawChinese(files) {
  return files.flatMap(file => codeLines(file.text)
    .filter(line => CJK.test(UNTRANSLATED.reduce((rest, text) => rest.replaceAll(text, ''), line.replace(CALL, ''))))
    .map(line => `${file.name}: ${line.trim()}`));
}

/** Module-level constants that call t(): they would keep the language the plugin started with. */
function earlyTranslations(files) {
  return files.flatMap(file => file.text.split('\n')
    .filter(line => /^(export )?const /.test(line) && /(?<![\w.])t\('/.test(line) && !line.includes('=>'))
    .map(line => `${file.name}: ${line.trim()}`));
}

test('every interface text of the frontend has an English counterpart', async () => {
  const { EN } = await load('en.js');
  checkTable(sourcesOf(FRONTEND), EN);
});

test('every message of the backend has an English counterpart', () => {
  checkTable(sourcesOf(BACKEND), BACKEND_EN);
});

test('no Chinese text bypasses translation', () => {
  assert.deepEqual(rawChinese(FRONTEND), []);
  assert.deepEqual(rawChinese(BACKEND.filter(file => !PROMPT_FILES.includes(path.basename(file.name)))), []);
});

test('no text is translated before the language is known', () => {
  assert.deepEqual(earlyTranslations([...FRONTEND, ...BACKEND]), []);
});

test('the frontend follows the chosen language and tells its listeners', async () => {
  const i18n = await load('i18n.js');
  const scope = new AbortController();
  let changes = 0;
  i18n.onLanguageChange(() => { changes += 1; }, scope.signal);
  assert.equal(i18n.t('现在有 {count} 句到期。', { count: 3 }), '现在有 3 句到期。');
  i18n.setLanguage('en');
  assert.equal(i18n.t('现在有 {count} 句到期。', { count: 3 }), '3 sentences are due now.');
  assert.equal(i18n.t('现在有 {count} 句到期。', { count: 1 }), '1 sentence is due now.');
  assert.equal(i18n.t('{note} · 下次 {month} 月 {day} 日', { note: 'In review', month: 11, day: 15 }), 'In review · next on Nov 15');
  assert.equal(i18n.locale(), 'en-US');
  i18n.setLanguage('en');
  assert.equal(changes, 1);
  i18n.setLanguage('something else');
  assert.equal(i18n.locale(), 'zh-CN');
  scope.abort();
  i18n.setLanguage('en');
  i18n.setLanguage('zh');
  assert.equal(changes, 2);
});

test('backend messages follow the chosen language', t => {
  t.after(() => setLanguage('zh'));
  const bad = () => applySettingsPatch(defaultSettings(), { dailyReviewLimit: 0 });
  assert.throws(bad, /每日复习上限应为 1 到 500 的整数。/);
  setLanguage('en');
  assert.throws(bad, /The daily review limit must be a whole number from 1 to 500\./);
});

test('a text without an English counterpart falls back to Chinese', () => {
  setLanguage('en');
  assert.equal(t('没有翻译的话 {n}', { n: 2 }), '没有翻译的话 2');
  setLanguage('zh');
});

test('the interface language is Chinese by default and can only be Chinese or English', () => {
  assert.equal(defaultSettings().language, 'zh');
  assert.equal(applySettingsPatch(defaultSettings(), { language: 'en' }).language, 'en');
  assert.throws(() => applySettingsPatch(defaultSettings(), { language: 'fr' }), /界面语言只能是中文或英文。/);
});

test('keys stand for the same role on every screen', async () => {
  const { roleForKey } = await load('shortcut-keys.js');
  const press = (code, extra = {}) => roleForKey({ code, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, keyCode: 0, ...extra });
  assert.deepEqual(['Space', 'KeyR', 'KeyM', 'KeyS', 'KeyA', 'KeyE', 'Digit1', 'Numpad2'].map(code => press(code)), ['record', 'reference', 'mine', 'slow', 'answer', 'explain', 'no', 'yes']);
  assert.deepEqual(['ArrowDown', 'ArrowRight', 'Enter'].map(code => press(code)), ['next', 'next', 'next']);
  assert.deepEqual(['ArrowUp', 'ArrowLeft'].map(code => press(code)), ['previous', 'previous']);
  assert.equal(press('KeyQ'), null);
  assert.equal(press('KeyR', { metaKey: true }), null);
  assert.equal(press('KeyR', { ctrlKey: true }), null);
  assert.equal(press('Digit1', { altKey: true }), null);
  assert.equal(press('KeyR', { isComposing: true }), null);
  assert.equal(press('KeyR', { keyCode: 229 }), null);
});

test('the hint line lists the working keys in a fixed order, in the interface language', async () => {
  const { plainLabel, shortcutHint } = await load('shortcut-keys.js');
  const i18n = await load('i18n.js');
  assert.deepEqual(['▶ 原声', '下一句 →', '← 上一句', '● 开始录音', '讲解'].map(plainLabel), ['原声', '下一句', '上一句', '开始录音', '讲解']);
  const labels = new Map([['next', '下一句'], ['record', '录音'], ['reference', '原声']]);
  assert.equal(shortcutHint(labels), '空格 录音 · R 原声 · ↓ 下一句');
  assert.equal(shortcutHint(new Map()), '');
  i18n.setLanguage('en');
  assert.equal(shortcutHint(new Map([['record', 'Record']])), 'Space Record');
  i18n.setLanguage('zh');
});
