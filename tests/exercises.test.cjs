'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackend } = require('../src/backend/backend.cjs');
const { parseQuestions } = require('../src/backend/questions.cjs');
const { QUESTION_SYSTEM_PROMPT } = require('../src/backend/question-prompts.cjs');
const { fixtureBytes } = require('./helpers.cjs');

const attemptId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const suggested = [{ en: 'How did the project go?', zh: '项目怎么样了？' }, { en: 'Did it work out in the end?', zh: '最后成了吗？' }, { en: 'Any news on that?', zh: '那件事有消息吗？' }];

test('suggested questions are read from the reply, at most three, unusable ones dropped', () => {
  assert.deepEqual(parseQuestions(JSON.stringify({ questions: suggested })), suggested);
  const messy = { questions: [{ en: ' ', zh: '空' }, { en: 'So,  how was it?' }, ...suggested] };
  assert.deepEqual(parseQuestions(`\`\`\`json\n${JSON.stringify(messy)}\n\`\`\``), [{ en: 'So, how was it?', zh: '' }, suggested[0], suggested[1]]);
  for (const bad of ['no json', '{"questions":[]}', '{"questions":[{"zh":"只有中文"}]}', `{"questions":[{"en":"${'x'.repeat(201)}"}]}`]) assert.throws(() => parseQuestions(bad), /不是预期的格式/, bad);
});

function harness(t) {
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
      complete: async request => { asked.push(request); return { stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify({ questions: suggested }) }] }; },
    },
  };
  const fetchImpl = async (url, init) => { synthesized.push({ url, text: JSON.parse(init.body).text }); return new Response(fixtureBytes('elevenlabs', 'success.mp3')); };
  createBackend(ctx, { fetchImpl });
  return { dataDirectory, asked, synthesized, call: (name, input) => handlers.get(name)(input) };
}

async function passageReady(backend) {
  await backend.call('set-secret', { name: 'elevenLabsKey', value: 'el-key' });
  const sentences = [{ zh: '这事挺难，但我做成了。', en: "I can't believe I pulled it off.", keyExpression: 'pulled it off' }, { zh: '我明天告诉他。', en: "I'll tell him tomorrow.", keyExpression: '' }];
  const { passageId, state } = await backend.call('create-passage', { register: 'casual', version: 'brief', chinese: '这事挺难，但我做成了。我明天告诉他。', sentences });
  assert.deepEqual(state.passages[0].questions, []);
  return { passageId, sentenceIds: state.passages[0].sentences.map(sentence => sentence.id) };
}

test('questions: suggested by the model, saved only when confirmed, spoken in the asker\'s voice', async t => {
  const backend = harness(t);
  const { passageId } = await passageReady(backend);
  const { questions } = await backend.call('suggest-questions', { passageId });
  assert.deepEqual(questions, suggested);
  assert.equal(backend.asked[0].context.systemPrompt, QUESTION_SYSTEM_PROMPT);
  assert.equal(backend.asked[0].context.messages[0].content, "Register: casual\n\nPassage (English):\nI can't believe I pulled it off. I'll tell him tomorrow.\n\nPassage (Chinese):\n这事挺难，但我做成了。我明天告诉他。");
  assert.deepEqual((await backend.call('get-state')).passages[0].questions, [], 'suggesting stores nothing');

  const edited = [{ en: '  How did it go? ', zh: '怎么样了？' }, suggested[1]];
  const { questionIds, state } = await backend.call('add-questions', { passageId, questions: edited });
  assert.deepEqual(state.passages[0].questions.map(question => [question.id, question.en, question.zh, question.audio]), [[questionIds[0], 'How did it go?', '怎么样了？', null], [questionIds[1], suggested[1].en, suggested[1].zh, null]]);
  await assert.rejects(backend.call('question-audio', { passageId, questionId: questionIds[0] }), /还没有合成语音/);

  const spoken = await backend.call('synthesize-question', { passageId, questionId: questionIds[0] });
  assert.equal(spoken.passages[0].questions[0].audio.voiceId, 'cjVigY5qzO86Huf0OWal');
  assert.deepEqual([backend.synthesized.length, backend.synthesized[0].text], [1, 'How did it go?']);
  assert.match(backend.synthesized[0].url, /cjVigY5qzO86Huf0OWal/);
  assert.equal((await backend.call('question-audio', { passageId, questionId: questionIds[0] })).mime, 'audio/mpeg');
  await backend.call('synthesize-question', { passageId, questionId: questionIds[0] });
  assert.equal(backend.synthesized.length, 1, 'existing audio is not synthesized again');
});

test('questions are checked, capped at six per passage, and deleted with their audio', async t => {
  const backend = harness(t);
  const { passageId } = await passageReady(backend);
  const refused = [[[], /没有要保存的问句/], [[{ en: ' ' }], /问句不能为空/], [[{ en: 'x'.repeat(201) }], /问句不能为空/], ['text', /没有要保存的问句/]];
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
