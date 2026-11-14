'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackend } = require('../src/backend/backend.cjs');
const { parseQuestions } = require('../src/backend/questions.cjs');
const { questionSystemPrompt, questionUserPrompt } = require('../src/backend/question-prompts.cjs');
const { replyKeys } = require('../src/backend/languages.cjs');
const { fixtureBytes } = require('./helpers.cjs');

const sha16 = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const attemptId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORIGINAL_KEYS = replyKeys('zh-CN', 'en-US');
const GENERAL_KEYS = replyKeys('en-US', 'ja-JP');

const suggested = [{ target: 'How did the project go?', native: '项目怎么样了？' }, { target: 'Did it work out in the end?', native: '最后成了吗？' }, { target: 'Any news on that?', native: '那件事有消息吗？' }];
const suggestedReply = suggested.map(question => ({ en: question.target, zh: question.native }));
// Outside the original pair a reply already uses the field names a question is stored under.
const japaneseSuggested = [{ target: 'プロジェクトはどうでしたか？', native: 'How did the project go?' }, { target: '結局うまくいきましたか？', native: 'Did it work out in the end?' }];

test('suggested questions are read from the reply, at most three, unusable ones dropped', () => {
  assert.deepEqual(parseQuestions(JSON.stringify({ questions: suggestedReply }), ORIGINAL_KEYS), suggested);
  const messy = { questions: [{ en: ' ', zh: '空' }, { en: 'So,  how was it?' }, ...suggestedReply] };
  assert.deepEqual(parseQuestions(`\`\`\`json\n${JSON.stringify(messy)}\n\`\`\``, ORIGINAL_KEYS), [{ target: 'So, how was it?', native: '' }, suggested[0], suggested[1]]);
  for (const bad of ['no json', '{"questions":[]}', '{"questions":[{"zh":"只有中文"}]}', `{"questions":[{"en":"${'x'.repeat(201)}"}]}`]) assert.throws(() => parseQuestions(bad, ORIGINAL_KEYS), /不是预期的格式/, bad);
});

test('questions for another pair are read by the keys "native" and "target"', () => {
  assert.deepEqual(parseQuestions(JSON.stringify({ questions: japaneseSuggested }), GENERAL_KEYS), japaneseSuggested);
  assert.deepEqual(parseQuestions('{"questions":[{"target":" どう  でしたか？ "}]}', GENERAL_KEYS), [{ target: 'どう でしたか？', native: '' }]);
  assert.throws(() => parseQuestions(JSON.stringify({ questions: suggestedReply }), GENERAL_KEYS), /不是预期的格式/, 'questions under "en" are not read');
  assert.throws(() => parseQuestions(JSON.stringify({ questions: japaneseSuggested }), ORIGINAL_KEYS), /不是预期的格式/, 'nor the other way round');
});

test('the question prompt for zh-CN → en-US is the approved wording', () => {
  const prompt = questionSystemPrompt('zh-CN', 'en-US');
  assert.match(prompt, /^The learner has memorized a short English passage that says something they want to say in real life\. Write 3 different questions/);
  assert.match(prompt, /- Each question is one short spoken sentence, at most 12 words, in everyday English\./);
  assert.match(prompt, /- Add a Chinese translation of each question\./);
  assert.match(prompt, /- Reply with JSON only: \{"questions":\[\{"en":"…","zh":"…"\}\]\}$/);
  assert.equal(sha16(prompt), '303e8369e3c16a6e');
});

test('the question prompt for another pair names its languages, counts in their unit, and asks for "target" and "native"', () => {
  const cases = [
    ['zh-CN', 'ja-JP', /^The learner has memorized a short Japanese passage/, /at most 24 characters, in everyday Japanese\./, /a Chinese translation of each question\./],
    ['zh-CN', 'en-GB', /^The learner has memorized a short English passage/, /at most 12 words, in everyday British English\./, /a Chinese translation of each question\./],
    ['ja-JP', 'en-US', /^The learner has memorized a short English passage/, /at most 12 words, in everyday American English\./, /a Japanese translation of each question\./],
    ['ja-JP', 'zh-HK', /^The learner has memorized a short Cantonese passage/, /at most 24 characters, in everyday Hong Kong Cantonese, written in traditional characters\./, /a Japanese translation of each question\./],
  ];
  for (const [nativeLanguage, targetLanguage, opening, limit, translation] of cases) {
    const prompt = questionSystemPrompt(nativeLanguage, targetLanguage);
    const pair = `${nativeLanguage} → ${targetLanguage}`;
    for (const expected of [opening, limit, translation, /- Reply with JSON only: \{"questions":\[\{"target":"…","native":"…"\}\]\}$/]) assert.match(prompt, expected, pair);
    assert.doesNotMatch(prompt, /"zh"|"en"/, pair);
  }
});

test('the question prompt reads as English when the learner\'s own language starts with a vowel', () => {
  for (const [nativeLanguage, name] of [['en-US', 'English'], ['it-IT', 'Italian'], ['ar-EG', 'Arabic']]) {
    assert.match(questionSystemPrompt(nativeLanguage, 'ja-JP'), new RegExp(`- Add an ${name} translation of each question\\.`), nativeLanguage);
  }
});

test('the user message labels the passage and its source with their languages', () => {
  assert.equal(questionUserPrompt({ register: 'formal', passage: 'やり遂げました。', source: 'I pulled it off.', nativeLanguage: 'en-US', targetLanguage: 'ja-JP' }),
    'Register: formal\n\nPassage (Japanese):\nやり遂げました。\n\nPassage (English):\nI pulled it off.');
});

function harness(t, { questions = suggestedReply } = {}) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-english-exercises-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const handlers = new Map();
  const asked = [];
  const synthesized = [];
  const model = { provider: 'fixture', id: 'cheap-model' };
  const ctx = {
    dataDirectory, signal: new AbortController().signal, handle: (name, handler) => handlers.set(name, handler),
    inference: {
      catalog: async () => ({ models: [model], slots: { cheap: { model } } }),
      complete: async request => { asked.push(request); return { stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify({ questions }) }] }; },
    },
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    synthesized.push({ url, text: body.text, languageCode: body.language_code });
    return new Response(fixtureBytes('elevenlabs', 'success.mp3'));
  };
  createBackend(ctx, { fetchImpl });
  return { dataDirectory, asked, synthesized, call: (name, input) => handlers.get(name)(input) };
}

const ORIGINAL_PASSAGE = {
  register: 'casual', version: 'brief', nativeLanguage: 'zh-CN', targetLanguage: 'en-US', source: '这事挺难，但我做成了。我明天告诉他。',
  sentences: [{ native: '这事挺难，但我做成了。', target: "I can't believe I pulled it off.", keyExpression: 'pulled it off' }, { native: '我明天告诉他。', target: "I'll tell him tomorrow.", keyExpression: '' }],
};
const JAPANESE_PASSAGE = {
  register: 'formal', version: 'sentences', nativeLanguage: 'en-US', targetLanguage: 'ja-JP', source: "It was hard, but I pulled it off. I'll tell him tomorrow.",
  sentences: [{ native: 'It was hard, but I pulled it off.', target: '大変でしたが、やり遂げました。', keyExpression: 'やり遂げました' }, { native: "I'll tell him tomorrow.", target: '明日、彼に伝えます。', keyExpression: '' }],
};

async function passageReady(backend, passage = ORIGINAL_PASSAGE) {
  await backend.call('set-secret', { name: 'elevenLabsKey', value: 'el-key' });
  const { passageId, state } = await backend.call('create-passage', passage);
  assert.deepEqual(state.passages[0].questions, []);
  return { passageId, sentenceIds: state.passages[0].sentences.map(sentence => sentence.id) };
}

test('questions: suggested by the model, saved only when confirmed, spoken in the asker\'s voice', async t => {
  const backend = harness(t);
  const { passageId } = await passageReady(backend);
  const { questions } = await backend.call('suggest-questions', { passageId });
  assert.deepEqual(questions, suggested);
  assert.equal(backend.asked[0].context.systemPrompt, questionSystemPrompt('zh-CN', 'en-US'));
  assert.equal(backend.asked[0].context.messages[0].content, "Register: casual\n\nPassage (English):\nI can't believe I pulled it off. I'll tell him tomorrow.\n\nPassage (Chinese):\n这事挺难，但我做成了。我明天告诉他。");
  assert.deepEqual((await backend.call('get-state')).passages[0].questions, [], 'suggesting stores nothing');

  const edited = [{ target: '  How did it go? ', native: '怎么样了？' }, suggested[1]];
  const { questionIds, state } = await backend.call('add-questions', { passageId, questions: edited });
  assert.deepEqual(state.passages[0].questions.map(question => [question.id, question.target, question.native, question.audio]), [[questionIds[0], 'How did it go?', '怎么样了？', null], [questionIds[1], suggested[1].target, suggested[1].native, null]]);
  await assert.rejects(backend.call('question-audio', { passageId, questionId: questionIds[0] }), /还没有合成语音/);

  const spoken = await backend.call('synthesize-question', { passageId, questionId: questionIds[0] });
  assert.equal(spoken.passages[0].questions[0].audio.voiceId, 'cjVigY5qzO86Huf0OWal');
  assert.deepEqual(backend.synthesized, [{ url: backend.synthesized[0].url, text: 'How did it go?', languageCode: 'en' }]);
  assert.match(backend.synthesized[0].url, /cjVigY5qzO86Huf0OWal/);
  assert.equal((await backend.call('question-audio', { passageId, questionId: questionIds[0] })).mime, 'audio/mpeg');
  await backend.call('synthesize-question', { passageId, questionId: questionIds[0] });
  assert.equal(backend.synthesized.length, 1, 'existing audio is not synthesized again');
});

test('questions for a passage of another pair: asked for, read and spoken in that pair\'s languages', async t => {
  const backend = harness(t, { questions: japaneseSuggested });
  const { passageId } = await passageReady(backend, JAPANESE_PASSAGE);
  const { questions } = await backend.call('suggest-questions', { passageId });
  assert.deepEqual(questions, japaneseSuggested);
  assert.equal(backend.asked[0].context.systemPrompt, questionSystemPrompt('en-US', 'ja-JP'));
  assert.equal(backend.asked[0].context.messages[0].content, "Register: formal\n\nPassage (Japanese):\n大変でしたが、やり遂げました。明日、彼に伝えます。\n\nPassage (English):\nIt was hard, but I pulled it off. I'll tell him tomorrow.");

  const { questionIds, state } = await backend.call('add-questions', { passageId, questions });
  assert.deepEqual(state.passages[0].questions.map(question => [question.target, question.native]), japaneseSuggested.map(question => [question.target, question.native]));
  await backend.call('synthesize-question', { passageId, questionId: questionIds[0] });
  assert.deepEqual([backend.synthesized[0].text, backend.synthesized[0].languageCode], ['プロジェクトはどうでしたか？', 'ja']);
});

test('a passage keeps asking in its own pair after the settings move to another one', async t => {
  const backend = harness(t);
  const { passageId } = await passageReady(backend);
  await backend.call('save-settings', { nativeLanguage: 'en-US', targetLanguage: 'ja-JP' });
  assert.deepEqual((await backend.call('suggest-questions', { passageId })).questions, suggested);
  assert.equal(backend.asked[0].context.systemPrompt, questionSystemPrompt('zh-CN', 'en-US'));
});

test('questions are checked, capped at six per passage, and deleted with their audio', async t => {
  const backend = harness(t);
  const { passageId } = await passageReady(backend);
  const refused = [[[], /没有要保存的问句/], [[{ target: ' ' }], /问句不能为空/], [[{ target: 'x'.repeat(201) }], /问句不能为空/], [[{ en: 'How did it go?', zh: '怎么样了？' }], /问句不能为空/], ['text', /没有要保存的问句/]];
  for (const [questions, expected] of refused) await assert.rejects(backend.call('add-questions', { passageId, questions }), expected);
  await assert.rejects(backend.call('add-questions', { passageId: 'missing', questions: suggested }), /找不到这一段/);
  const first = await backend.call('add-questions', { passageId, questions: suggested });
  await backend.call('add-questions', { passageId, questions: suggested });
  await assert.rejects(backend.call('add-questions', { passageId, questions: [suggested[0]] }), /最多 6 个问句/);

  const [questionId, otherId] = first.questionIds;
  await backend.call('synthesize-question', { passageId, questionId });
  await backend.call('synthesize-question', { passageId, questionId: otherId });
  await backend.call('record-response', { attemptId: attemptId(1), passageId, questionId, answered: true });
  const after = await backend.call('delete-question', { passageId, questionId });
  assert.equal(after.passages[0].questions.length, 5);
  assert.deepEqual(fs.readdirSync(path.join(backend.dataDirectory, 'audio')), [`${otherId}.mp3`]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8')).attempts, []);
  await assert.rejects(backend.call('delete-question', { passageId, questionId }), /找不到这个问句/);
  await assert.rejects(backend.call('synthesize-question', { passageId, questionId }), /找不到这个问句/);

  await backend.call('delete-passage', { passageId });
  assert.deepEqual(fs.readdirSync(path.join(backend.dataDirectory, 'audio')), [], 'deleting the passage removes the remaining question audio');
});

test('listen once: logged per sentence, corrected under the same id, never scheduled or counted as a miss', async t => {
  const backend = harness(t);
  const { sentenceIds } = await passageReady(backend);
  const stored = () => JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8')).attempts;
  await backend.call('record-listen', { attemptId: attemptId(1), sentenceId: sentenceIds[0], understood: true, rate: 1.2 });
  await backend.call('record-listen', { attemptId: attemptId(2), sentenceId: sentenceIds[1], understood: false });
  const state = await backend.call('record-listen', { attemptId: attemptId(2), sentenceId: sentenceIds[1], understood: false, gap: 'sound' });
  assert.deepEqual(stored().map(entry => [entry.kind, entry.understood, entry.gap, entry.rate]), [['listen', true, null, 1.2], ['listen', false, 'sound', 1]]);
  assert.deepEqual(state.passages[0].sentences.map(sentence => [sentence.misses, sentence.schedule, sentence.recall]), [[0, null, 'pending'], [0, null, 'pending']]);
  assert.equal(state.review.doneToday, 0);

  await backend.call('record-listen', { attemptId: attemptId(1), sentenceId: sentenceIds[0], understood: false, gap: 'pairing', rate: 1.2 });
  assert.deepEqual([stored().length, stored()[0].understood, stored()[0].gap], [2, false, 'pairing']);
  const base = { attemptId: attemptId(3), sentenceId: sentenceIds[0], understood: false };
  const refused = [[{ understood: 'yes' }, /请选择听懂了还是没听懂/], [{ gap: 'speed' }, /不认识的分类/], [{ understood: true, gap: 'sound' }, /不需要分类/], [{ rate: 2 }, /播放速度/],
    [{ sentenceId: 'missing' }, /找不到这一句/], [{ attemptId: 'nope' }, /练习记录编号无效/], [{ attemptId: attemptId(2) }, /已经用在别处/]];
  for (const [overrides, expected] of refused) await assert.rejects(backend.call('record-listen', { ...base, ...overrides }), expected, JSON.stringify(overrides));
  assert.equal(stored().length, 2);
});

test('respond: logged per question with the timing; a timeout cannot count as answered', async t => {
  const backend = harness(t);
  const { passageId } = await passageReady(backend);
  const { questionIds } = await backend.call('add-questions', { passageId, questions: suggested });
  await backend.call('record-response', { attemptId: attemptId(1), passageId, questionId: questionIds[0], answered: true, responseMs: 1200.4, speakMs: 5300 });
  await backend.call('record-response', { attemptId: attemptId(2), passageId, questionId: questionIds[1], answered: false, timedOut: true, responseMs: 3000 });
  const stored = JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8')).attempts;
  assert.deepEqual(stored.map(entry => [entry.kind, entry.questionId, entry.answered, entry.timedOut, entry.responseMs, entry.speakMs]),
    [['respond', questionIds[0], true, false, 1200, 5300], ['respond', questionIds[1], false, true, 3000, null]]);
  const base = { attemptId: attemptId(3), passageId, questionId: questionIds[0], answered: false };
  const refused = [[{ answered: 1 }, /请选择接上了还是没接上/], [{ answered: true, timedOut: true }, /超时标记/], [{ questionId: 'missing' }, /找不到这个问句/],
    [{ passageId: 'missing' }, /找不到这一段/], [{ responseMs: -5 }, /用时不对/], [{ attemptId: attemptId(2) }, /已经用在别处/]];
  for (const [overrides, expected] of refused) await assert.rejects(backend.call('record-response', { ...base, ...overrides }), expected, JSON.stringify(overrides));
  await backend.call('delete-passage', { passageId });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8')).attempts, []);
});
