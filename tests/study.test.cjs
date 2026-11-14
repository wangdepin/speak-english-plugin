'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createBackend } = require('../src/backend/backend.cjs');
const { startDiagnosis, recordDiagnosis, recordLesson, passageForChat, recordConsolidation } = require('../src/backend/study.cjs');
const { adoptExplanation } = require('../src/backend/explain.cjs');
const { lessonText, registerLesson, TOOL_NAME } = require('../src/backend/lesson.cjs');
const { FIXED_INSTRUCTION } = require('../src/backend/lesson-guide.cjs');
const { parseAssessment } = require('../src/backend/speech/azure-parse.cjs');
const { fixtureBytes, fixtureJson } = require('./helpers.cjs');

const load = name => import(pathToFileURL(path.join(__dirname, '..', 'src', 'frontend', name)).href);
const recorded = name => { const fixture = fixtureJson('azure', `${name}.json`); return [fixture.referenceText, parseAssessment(fixture.body)]; };
const NOW = Date.UTC(2026, 10, 14, 12);
const wavBase64 = Buffer.from(fixtureBytes('audio', 'tell-him-16k.wav')).toString('base64');

/** A store state with one two-sentence passage, Chinese to American English. */
function stateWithPassage() {
  const sentence = (id, native, target, keyExpression) => ({ id, passageId: 'p1', native, target, keyExpression, audio: null, schedule: null, explanation: null, explainCheckedAt: null });
  return {
    sentences: { s1: sentence('s1', '今天就到这里吧。', "Let's call it a day.", 'call it a day'), s2: sentence('s2', '剩下的明天再弄清楚。', "We'll figure out the rest tomorrow.", '') },
    passages: { p1: { id: 'p1', createdAt: NOW, register: 'casual', version: 'brief', nativeLanguage: 'zh-CN', targetLanguage: 'en-US', source: '今天就到这里吧。剩下的明天再弄清楚。', sentenceIds: ['s1', 's2'], questions: [] } },
    attempts: [],
  };
}

/** Adds a second passage with one sentence to a state. */
function addSecondPassage(state) {
  state.sentences.t1 = { ...state.sentences.s1, id: 't1', passageId: 'p2' };
  state.passages.p2 = { ...state.passages.p1, id: 'p2', sentenceIds: ['t1'] };
}

const found = { passageId: 'p1', sentenceId: 's1', retold: true, notSaid: ['call', 'day'], unclear: [], unknown: ['call it a day'], now: NOW };

test('a diagnostic is recorded sentence by sentence, and starting again discards the earlier one', () => {
  const state = stateWithPassage();
  assert.throws(() => recordDiagnosis(state, found), /还没有开始摸底/);
  startDiagnosis(state, { passageId: 'p1', now: NOW });
  recordDiagnosis(state, { ...found, notSaid: [' call ', 'day', 'day'] });
  assert.deepEqual(state.passages.p1.diagnosis.sentences.s1, { retold: true, notSaid: ['call', 'day'], unclear: [], unknown: ['call it a day'] });
  startDiagnosis(state, { passageId: 'p1', now: NOW + 1 });
  assert.deepEqual(state.passages.p1.diagnosis, { at: NOW + 1, sentences: {} });
});

test('a diagnostic result that is malformed or about another passage is refused', () => {
  const state = stateWithPassage();
  startDiagnosis(state, { passageId: 'p1', now: NOW });
  addSecondPassage(state);
  assert.throws(() => recordDiagnosis(state, { ...found, sentenceId: 't1' }), /找不到这一句/, 'a sentence of another passage');
  assert.throws(() => recordDiagnosis(state, { ...found, sentenceId: 'elsewhere' }), /找不到这一句/);
  assert.throws(() => recordDiagnosis(state, { ...found, unknown: Array.from({ length: 201 }, (_, index) => `w${index}`) }), /格式不对/, 'too many words');
  assert.throws(() => recordDiagnosis(state, { ...found, unknown: ['x'.repeat(401)] }), /格式不对/, 'a word that is too long');
  const roomy = stateWithPassage();
  startDiagnosis(roomy, { passageId: 'p1', now: NOW });
  assert.doesNotThrow(() => recordDiagnosis(roomy, { ...found, unknown: ['x'.repeat(400)] }), 'a phrase as long as a sentence');
  assert.throws(() => recordDiagnosis(state, { ...found, retold: false }), /格式不对/, 'scored words without a repetition');
  assert.throws(() => recordDiagnosis(state, { ...found, retold: 'yes' }), /格式不对/);
  assert.throws(() => recordDiagnosis(state, { ...found, notSaid: 'call' }), /格式不对/);
  assert.throws(() => recordDiagnosis(state, { ...found, unknown: [''] }), /格式不对/);
  assert.throws(() => recordDiagnosis(state, { ...found, unknown: [7] }), /格式不对/);
  assert.throws(() => recordDiagnosis(state, { ...found, retold: false }), /格式不对/, 'a sentence that was not repeated has no scored words');
  assert.throws(() => startDiagnosis(state, { passageId: 'nowhere', now: NOW }), /找不到这一段/);
  assert.deepEqual(state.passages.p1.diagnosis.sentences, {});
});

test('a passage remembers its lesson, and the lesson finds its passage', () => {
  const state = stateWithPassage();
  assert.equal(passageForChat(state, 'chat_1'), null);
  recordLesson(state, { passageId: 'p1', chatId: 'chat_1', now: NOW });
  assert.equal(passageForChat(state, 'chat_1').id, 'p1');
  recordLesson(state, { passageId: 'p1', chatId: 'chat_2', now: NOW + 1 });
  assert.equal(passageForChat(state, 'chat_1'), null, 'a later lesson replaces the earlier one');
  assert.deepEqual(state.passages.p1.lesson, { chatId: 'chat_2', startedAt: NOW + 1 });
  for (const chatId of ['', 'has space', '../etc', 7, 'x'.repeat(81)]) assert.throws(() => recordLesson(state, { passageId: 'p1', chatId, now: NOW }), /编号无效/);
});

test('a session belongs to one passage, and a session without an id to none', () => {
  const state = stateWithPassage();
  addSecondPassage(state);
  for (const chatId of [undefined, null, '', 7]) assert.equal(passageForChat(state, chatId), null, 'passages without a lesson are not found by a missing id');
  recordLesson(state, { passageId: 'p1', chatId: 'chat_1', now: NOW });
  recordLesson(state, { passageId: 'p2', chatId: 'chat_1', now: NOW + 1 });
  assert.equal(passageForChat(state, 'chat_1').id, 'p2');
  assert.equal(state.passages.p1.lesson, null, 'the first passage lets go of the session');
});

test('replacing a sentence forgets what the diagnostic found in it', () => {
  const state = stateWithPassage();
  state.sentences.s1.explanation = { simpler: { target: "Let's stop here." }, split: null };
  state.sentences.s2.explanation = { simpler: { target: 'The rest can wait.' }, split: null };
  startDiagnosis(state, { passageId: 'p1', now: NOW });
  recordDiagnosis(state, found);
  recordDiagnosis(state, { ...found, sentenceId: 's2', notSaid: [], unknown: [] });
  let made = 0;
  const newId = () => `n${++made}`;
  adoptExplanation(state, 's1', 'simpler', { newId });
  assert.deepEqual(Object.keys(state.passages.p1.diagnosis.sentences), ['s2']);
  adoptExplanation(state, 's2', 'simpler', { newId });
  assert.equal(state.passages.p1.diagnosis, null, 'a diagnostic with no sentence left is dropped');
});

test('reading aloud and speed listening are counted separately', () => {
  const state = stateWithPassage();
  recordConsolidation(state, { passageId: 'p1', kind: 'read', now: NOW });
  recordConsolidation(state, { passageId: 'p1', kind: 'read', now: NOW + 1 });
  recordConsolidation(state, { passageId: 'p1', kind: 'speed', now: NOW + 2 });
  assert.deepEqual(state.passages.p1.consolidation, { readAloud: 2, speedRuns: 1, at: NOW + 2 });
  assert.throws(() => recordConsolidation(state, { passageId: 'p1', kind: 'toString', now: NOW }), /不认识的练习类型/);
});

test('the lesson text gives the passage, what the diagnostic found, and the guide for probing and for teaching', () => {
  const state = stateWithPassage();
  startDiagnosis(state, { passageId: 'p1', now: NOW });
  recordDiagnosis(state, found);
  const forTeacher = lessonText(state, state.passages.p1);
  assert.match(forTeacher, /^Passage in American English, casual register\. The learner's own language is Chinese\./);
  assert.match(forTeacher, /1\. Let's call it a day\.\n {3}Meaning: 今天就到这里吧。\n {3}Key expression: call it a day\n {3}Not said: call, day\n {3}Said unclearly: none\n {3}Marked unknown: call it a day/);
  assert.match(forTeacher, /2\. We'll figure out the rest tomorrow\.\n {3}Meaning: 剩下的明天再弄清楚。\n {3}Key expression: none\n {3}Not tested\./);
  assert.match(forTeacher, /While probing\. The passage is the whole territory/);
  assert.match(forTeacher, /Explain nothing while probing\./);
  assert.match(forTeacher, /While teaching:/);
  assert.match(forTeacher, /Do not teach rules of linking, reduction or elision/);
  assert.match(forTeacher, /ask and explain in Chinese; keep English words and examples in English\.$/);
});

test('a sentence the learner could not repeat is reported as such', () => {
  const state = stateWithPassage();
  startDiagnosis(state, { passageId: 'p1', now: NOW });
  recordDiagnosis(state, { ...found, retold: false, notSaid: [], unclear: [], unknown: ['call'] });
  assert.match(lessonText(state, state.passages.p1), /Key expression: call it a day\n {3}Could not repeat\.\n {3}Marked unknown: call/);
});

test('without a diagnostic the guide says so and the sentences carry no findings', () => {
  const state = stateWithPassage();
  const text = lessonText(state, state.passages.p1);
  assert.match(text, /has not taken the listening diagnostic/);
  assert.match(text, /Ask which words and sentences the learner does not understand/);
  assert.doesNotMatch(text, /Not said|Not tested|What the diagnostic means/);
  // A diagnostic whose sentences were all replaced since counts as none.
  state.passages.p1.diagnosis = { at: NOW, sentences: { gone: { retold: true, notSaid: [], unclear: [], unknown: [] } } };
  assert.match(lessonText(state, state.passages.p1), /has not taken the listening diagnostic/);
});

/** A host that can extend its agents: keeps what was registered. */
function agentHost() {
  const registered = { instructions: [], tools: [] };
  return { registered, registerInstructions: entry => registered.instructions.push(entry), registerTools: entry => registered.tools.push(entry) };
}

test('the lesson tool is offered to the prober and the teacher, only in the session the plugin started', async () => {
  const state = stateWithPassage();
  const store = { get: () => state };
  const host = agentHost();
  assert.equal(registerLesson(host, store), true);
  assert.deepEqual(host.registered.instructions, [{ agents: ['prober', 'teacher'], text: FIXED_INSTRUCTION }]);
  const [{ agents, create }] = host.registered.tools;
  assert.deepEqual(agents, ['prober', 'teacher']);
  assert.deepEqual(create({ chatId: 'chat_1', agent: 'teacher' }), [], 'no lesson was started for this session');
  recordLesson(state, { passageId: 'p1', chatId: 'chat_1', now: NOW });
  assert.deepEqual(create({ chatId: 'other', agent: 'teacher' }), []);
  assert.deepEqual(create({ agent: 'teacher' }), [], 'a context without a session');
  const [tool] = create({ chatId: 'chat_1', agent: 'prober' });
  assert.equal(tool.name, TOOL_NAME);
  assert.match(FIXED_INSTRUCTION, new RegExp(TOOL_NAME));
  const result = await tool.execute('call-1', {}, new AbortController().signal);
  assert.equal(result.content[0].text, lessonText(state, state.passages.p1));
  assert.deepEqual(result.details, { passageId: 'p1' });
  delete state.passages.p1;
  assert.match((await tool.execute('call-2', {}, new AbortController().signal)).content[0].text, /has been deleted/);
});

test('a host that cannot extend its agents gets no lesson', () => {
  assert.equal(registerLesson({}, { get: stateWithPassage }), false);
});

/** A backend on a scratch data directory. `extend` adds what a newer host offers. */
function harness(t, extend = {}) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-english-study-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const handlers = new Map();
  const ctx = {
    dataDirectory, signal: new AbortController().signal, handle: (name, handler) => handlers.set(name, handler),
    inference: { catalog: async () => ({ models: [], slots: {} }) }, ...extend,
  };
  createBackend(ctx, { fetchImpl: async () => Response.json(fixtureJson('azure', 'omission.json').body) });
  return { dataDirectory, call: (name, input) => handlers.get(name)(input) };
}

const CONFIRMED = { register: 'formal', version: 'sentences', nativeLanguage: 'zh-CN', targetLanguage: 'en-US', source: '我明天全都告诉他。', sentences: [{ native: '我明天全都告诉他。', target: fixtureJson('azure', 'omission.json').referenceText, keyExpression: 'tell him all about it' }] };

test('the study operations keep their records with the passage and report whether lessons are available', async t => {
  const host = agentHost();
  const backend = harness(t, host);
  const { passageId, state: created } = await backend.call('create-passage', CONFIRMED);
  assert.equal(created.lessonAvailable, true);
  const [fresh] = created.passages;
  assert.deepEqual([fresh.diagnosis, fresh.lesson, fresh.consolidation], [null, null, null]);
  const sentenceId = fresh.sentences[0].id;

  await backend.call('set-secret', { name: 'azureKey', value: 'az-test-key' });
  await backend.call('save-settings', { azureRegion: 'swedencentral' });
  await backend.call('start-diagnosis', { passageId });
  const { assessment } = await backend.call('score-retell', { sentenceId, wavBase64 });
  assert.deepEqual(assessment.words.filter(word => word.errorType === 'Omission').map(word => word.word), ['all', 'tomorrow']);
  await backend.call('record-diagnosis', { passageId, sentenceId, retold: true, notSaid: ['all', 'tomorrow'], unclear: [], unknown: [] });
  await backend.call('start-lesson', { passageId, chatId: 'chat_abc' });
  await backend.call('record-consolidation', { passageId, kind: 'read' });
  const [passage] = (await backend.call('record-consolidation', { passageId, kind: 'speed' })).passages;
  assert.deepEqual(passage.diagnosis.sentences[sentenceId].notSaid, ['all', 'tomorrow']);
  assert.equal(passage.lesson.chatId, 'chat_abc');
  assert.deepEqual([passage.consolidation.readAloud, passage.consolidation.speedRuns], [1, 1]);

  const saved = JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8'));
  assert.deepEqual(saved.attempts, [], 'a repetition from the diagnostic is not a practice attempt');
  const [tool] = host.registered.tools[0].create({ chatId: 'chat_abc', agent: 'teacher' });
  assert.match((await tool.execute('call-1', {}, new AbortController().signal)).content[0].text, /Not said: all, tomorrow/);
});

test('on a host that cannot extend its agents a lesson cannot be started', async t => {
  const backend = harness(t);
  const { passageId, state } = await backend.call('create-passage', CONFIRMED);
  assert.equal(state.lessonAvailable, false);
  await assert.rejects(backend.call('start-lesson', { passageId, chatId: 'chat_abc' }), /不能把段落交给老师/);
});

test('a scored repetition gives the words that were not said and the words said unclearly', async () => {
  const { scoredTokens, scoredGaps } = await load('diagnose-words.js');
  assert.deepEqual(scoredGaps(scoredTokens(...recorded('omission'))), { notSaid: ['all', 'tomorrow'], unclear: [] });
  assert.deepEqual(scoredGaps(scoredTokens(...recorded('mispronunciation'))), { notSaid: [], unclear: ['tell'] });
  assert.deepEqual(scoredGaps(scoredTokens(...recorded('match'))), { notSaid: [], unclear: [] });
  const withExtra = scoredTokens(...recorded('insertion'));
  assert.ok(withExtra.every(token => token.status !== 'extra'), 'words the learner added are not part of the sentence');
});

test('a word keeps the marks that belong to its letters', async () => {
  const { bareWord } = await load('word-marking.js');
  const { scoredGaps } = await load('diagnose-words.js');
  for (const word of ['ที่', 'नहीं', 'நான்', 'cafe\u0301']) assert.equal(bareWord(`«${word}».`), word);
  assert.equal(bareWord('“day,”'), 'day');
  assert.deepEqual(scoredGaps([{ text: 'नहीं।', status: 'missed' }]), { notSaid: ['नहीं'], unclear: [] });
});

test('the screen can tell whether the marked words are the sentence as written', async () => {
  const { scoredTokens, plainTokens, showsSentence } = await load('diagnose-words.js');
  const [english, englishScore] = recorded('omission');
  assert.equal(showsSentence(scoredTokens(english, englishScore), english, 'en-US'), true);
  assert.equal(showsSentence(plainTokens(english, 'en-US'), `  ${english} `, 'en-US'), true);
  for (const [name, language] of [['japanese', 'ja-JP'], ['mandarin', 'zh-CN']]) {
    const [text, score] = recorded(name);
    assert.equal(showsSentence(scoredTokens(text, score), text, language), false, 'the scoring service drops the punctuation');
    assert.equal(showsSentence(plainTokens(text, language), text, language), true);
  }
});

test('an unscored sentence is cut into words at spaces, or where the language puts the boundaries', async () => {
  const { plainTokens, isWord } = await load('diagnose-words.js');
  assert.deepEqual(plainTokens("Let's call it a day.", 'en-US').map(token => token.text), ["Let's", 'call', 'it', 'a', 'day.']);
  const japanese = plainTokens('今日は天気がいい。', 'ja-JP');
  assert.equal(japanese.map(token => token.text).join(''), '今日は天気がいい。');
  assert.ok(japanese.length > 2, 'more than one word');
  assert.equal(isWord(japanese.at(-1)), false, 'the full stop is not a word');
  assert.ok(japanese.slice(0, -1).every(isWord));
  const mixed = plainTokens('私は New York に行く。', 'ja-JP');
  assert.equal(mixed.map(token => token.text).join(''), '私は New York に行く。', 'spaces inside the sentence are kept');
  assert.ok(mixed.filter(token => token.text.trim() === '').every(token => !isWord(token)), 'a space cannot be marked');
});

test('marked words next to each other count as one phrase', async () => {
  const { plainTokens, markedPhrases } = await load('diagnose-words.js');
  const tokens = plainTokens("Let's call it a day, okay?", 'en-US');
  assert.deepEqual(markedPhrases(tokens, new Set([1, 2, 3, 4]), 'en-US'), ['call it a day']);
  assert.deepEqual(markedPhrases(tokens, new Set([0, 5]), 'en-US'), ["Let's", 'okay']);
  assert.deepEqual(markedPhrases(tokens, new Set(), 'en-US'), []);
  const japanese = plainTokens('今日は天気がいい。', 'ja-JP');
  assert.equal(markedPhrases(japanese, new Set([0, 1]), 'ja-JP')[0], japanese[0].text + japanese[1].text, 'no space is put between words of an unspaced language');
  const mixed = plainTokens('私は New York に行く。', 'ja-JP');
  const at = text => mixed.findIndex(token => token.text === text);
  assert.deepEqual(markedPhrases(mixed, new Set([at('New'), at('York')]), 'ja-JP'), ['New York'], 'a phrase reaches across a space');
  assert.deepEqual(markedPhrases(mixed, new Set([at('New')]), 'ja-JP'), ['New'], 'a space after the phrase is not part of it');
});

test('a speed run goes up the speeds and back down, each speed once or three times', async () => {
  const { speedSteps, SPEED_LADDER } = await load('speed-run.js');
  assert.deepEqual(SPEED_LADDER, [1, 1.5, 2, 3, 2, 1.5, 1]);
  assert.deepEqual(speedSteps().map(step => step.rate), [1, 1.5, 2, 3, 2, 1.5, 1]);
  assert.deepEqual(speedSteps(3).slice(0, 4), [{ rate: 1, rung: 1 }, { rate: 1, rung: 1 }, { rate: 1, rung: 1 }, { rate: 1.5, rung: 2 }]);
  assert.equal(speedSteps(3).length, 21);
});

test('the result of one sentence reads as one line', async () => {
  const { findingText } = await load('gaps-screen.js');
  assert.equal(findingText(undefined), '没测');
  assert.equal(findingText({ retold: true, notSaid: [], unclear: [], unknown: [] }), '没有缺口');
  assert.equal(findingText({ retold: true, notSaid: ['call', 'day'], unclear: ['figure'], unknown: ['call it a day'] }), '没说出来：call, day · 说得不清楚：figure · 不认识：call it a day');
  assert.equal(findingText({ retold: false, notSaid: [], unclear: [], unknown: [] }), '没能复述');
});
