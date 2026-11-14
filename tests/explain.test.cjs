'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackend } = require('../src/backend/backend.cjs');
const { parseExplanation } = require('../src/backend/explain-parse.cjs');
const { EXPLAIN_SYSTEM_PROMPT, explainUserPrompt } = require('../src/backend/explain-prompts.cjs');
const { practiceHistory } = require('../src/backend/explain.cjs');
const { fixtureBytes, fixtureJson } = require('./helpers.cjs');

const attemptId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LONG = 'I wanted to tell him about the whole thing yesterday, but I never got the chance to do it.';
const reply = { difficulty: ['“pulled it off”是固定搭配，中文里没有对应的结构。'], simpler: { en: 'I did it.', why: '去掉了固定搭配。' }, split: null };
const splitReply = { ...reply, simpler: { en: 'I wanted to tell him yesterday, but I had no chance.', why: '更短。' }, split: [{ zh: '我昨天想把整件事告诉他。', en: 'I wanted to tell him about the whole thing yesterday.' }, { zh: '但我一直没机会。', en: 'But I never got the chance.' }] };

test('the system prompt is the approved wording', () => {
  assert.match(EXPLAIN_SYSTEM_PROMPT, /^你是一位英语口语教练。/);
  assert.match(EXPLAIN_SYSTEM_PROMPT, /只有原句超过 12 个词时才给拆分方案/);
  assert.match(EXPLAIN_SYSTEM_PROMPT, /\{"difficulty":\["…"\],"simpler":\{"en":"…","why":"…"\},"split":\[\{"zh":"…","en":"…"\},\{"zh":"…","en":"…"\}\]\}$/);
});

test('the user message lists the sentence, its record, and the most frequent trouble spots', () => {
  const problem = (word, errorType, weakPhonemes = []) => ({ word, errorType, accuracy: 50, weakPhonemes });
  const state = { attempts: [
    { sentenceId: 's1', kind: 'shadow', said: null, problems: [problem('tell', 'Mispronunciation', [{ expected: 't', accuracy: 0, soundsLike: 's' }]), problem('about', 'None', [{ expected: 'aʊ', accuracy: 40, soundsLike: null }])] },
    { sentenceId: 's1', kind: 'recall', said: true, problems: [problem('tell', 'Mispronunciation', [{ expected: 't', accuracy: 10, soundsLike: 's' }])] },
    { sentenceId: 's1', kind: 'review', said: false, timedOut: true, problems: [] },
    { sentenceId: 's1', kind: 'review', said: false, timedOut: false, problems: [problem('it', 'Omission')] },
    { sentenceId: 's2', kind: 'review', said: false, timedOut: true, problems: [problem('nailed', 'Omission')] },
  ] };
  const history = practiceHistory(state, 's1');
  assert.deepEqual([history.attempts, history.said, history.missed, history.timedOut], [3, 1, 2, 1]);
  assert.deepEqual(history.wrongWords, [{ word: 'tell', count: 2 }, { word: 'it', count: 1 }]);
  assert.equal(explainUserPrompt({ zh: '我会把这事告诉他。', en: "I'll tell him about it.", keyExpression: 'tell him about it' }, history), [
    '中文：我会把这事告诉他。',
    "英文：I'll tell him about it.",
    '关键说法：tell him about it',
    '练习记录：共 3 次，说出来 1 次，没说出来 2 次（其中超时 1 次）',
    '常读错的词：tell（2 次）、it（1 次）',
    '不清楚的音：tell 里的 /t/（听起来像 /s/）、about 里的 /aʊ/',
  ].join('\n'));
  assert.match(explainUserPrompt({ zh: '好', en: 'OK.', keyExpression: '' }, practiceHistory(state, 'none')), /关键说法：无\n练习记录：共 0 次.*\n常读错的词：无\n不清楚的音：无$/);
});

test('a reply is read whether bare or fenced, and trimmed to three difficulties', () => {
  const many = { ...reply, difficulty: ['一', ' ', '二', '三', '四'] };
  assert.deepEqual(parseExplanation(JSON.stringify(reply), 'I pulled it off.'), reply);
  assert.deepEqual(parseExplanation(`好的：\n\`\`\`json\n${JSON.stringify(many)}\n\`\`\``, 'I pulled it off.').difficulty, ['一', '二', '三']);
});

test('a split is kept only for sentences of more than 12 words, and only when it is two usable sentences', () => {
  assert.deepEqual(parseExplanation(JSON.stringify(splitReply), LONG).split, splitReply.split);
  assert.equal(parseExplanation(JSON.stringify(splitReply), 'One two three four five six seven eight nine ten eleven twelve.').split, null);
  assert.equal(parseExplanation(JSON.stringify({ ...splitReply, split: [splitReply.split[0]] }), LONG).split, null);
  assert.equal(parseExplanation(JSON.stringify({ ...splitReply, split: [splitReply.split[0], { zh: '', en: 'But no.' }] }), LONG).split, null);
});

test('an unusable reply is refused with a message for the user', () => {
  const bad = ['没有 JSON', '{"difficulty":[],"simpler":{"en":"I did it."}}', '{"difficulty":["难"]}', '{"difficulty":["难"],"simpler":{"en":" "}}', `{"difficulty":["难"],"simpler":{"en":"${'x'.repeat(401)}"}}`];
  for (const text of bad) assert.throws(() => parseExplanation(text, 'I pulled it off.'), /不是预期的格式/, text);
});

// ---- through the backend operations ----

function harness(t, modelReply) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-english-explain-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const handlers = new Map();
  const asked = [];
  const model = { provider: 'fixture', id: 'cheap-model' };
  const answer = { reply: modelReply };
  const ctx = {
    dataDirectory, signal: new AbortController().signal, handle: (name, handler) => handlers.set(name, handler),
    inference: {
      catalog: async () => ({ models: [model], slots: { cheap: { model } } }),
      complete: async request => { asked.push(request); return typeof answer.reply === 'string' ? { stopReason: 'stop', content: [{ type: 'text', text: answer.reply }] } : answer.reply; },
    },
  };
  const fetchImpl = async url => (url.includes('elevenlabs') ? new Response(fixtureBytes('elevenlabs', 'success.mp3')) : Response.json(fixtureJson('azure', 'match.json').body));
  createBackend(ctx, { fetchImpl });
  return { dataDirectory, asked, answer, call: (name, input) => handlers.get(name)(input) };
}

async function passageWith(backend, sentences) {
  await backend.call('set-secret', { name: 'elevenLabsKey', value: 'el-key' });
  const { passageId, state } = await backend.call('create-passage', { register: 'formal', version: 'sentences', chinese: sentences.map(sentence => sentence.zh).join(''), sentences });
  for (const sentence of state.passages[0].sentences) await backend.call('synthesize-sentence', { sentenceId: sentence.id });
  return { passageId, ids: state.passages[0].sentences.map(sentence => sentence.id) };
}

const THREE = [
  { zh: '先说一句。', en: 'Let me start.', keyExpression: '' },
  { zh: '这事挺难，但我做成了。', en: "I can't believe I pulled it off.", keyExpression: 'pulled it off' },
  { zh: '就这样。', en: "That's it.", keyExpression: '' },
];
const sentencesOf = state => state.passages[0].sentences;

test('explaining asks the configured model, keeps the answer with the sentence, and restarts the miss count', async t => {
  const backend = harness(t, JSON.stringify(reply));
  const { ids } = await passageWith(backend, THREE);
  await backend.call('judge-recall', { attemptId: attemptId(1), sentenceId: ids[1], said: false });
  assert.equal(sentencesOf(await backend.call('get-state'))[1].misses, 1);

  const { explanation, state } = await backend.call('explain-sentence', { sentenceId: ids[1] });
  assert.deepEqual(explanation, reply);
  assert.deepEqual([sentencesOf(state)[1].explanation.simpler.en, sentencesOf(state)[1].misses], ['I did it.', 0]);
  const [request] = backend.asked;
  assert.deepEqual(request.model, { provider: 'fixture', id: 'cheap-model' });
  assert.equal(request.context.systemPrompt, EXPLAIN_SYSTEM_PROMPT);
  assert.match(request.context.messages[0].content, /^中文：这事挺难，但我做成了。\n英文：I can't believe I pulled it off\.\n关键说法：pulled it off\n练习记录：共 1 次，说出来 0 次，没说出来 1 次（其中超时 0 次）/);
});

test('a failed or garbled explanation stores nothing', async t => {
  const backend = harness(t, 'sorry');
  const { ids } = await passageWith(backend, THREE);
  await assert.rejects(backend.call('explain-sentence', { sentenceId: ids[1] }), /不是预期的格式/);
  backend.answer.reply = { stopReason: 'error', errorMessage: 'overloaded' };
  await assert.rejects(backend.call('explain-sentence', { sentenceId: ids[1] }), /讲解没有完成：overloaded/);
  backend.answer.reply = { stopReason: 'length', content: [{ type: 'text', text: '{"difficulty":["卡在' }] };
  await assert.rejects(backend.call('explain-sentence', { sentenceId: ids[1] }), /讲解的回复太长，被截断了/);
  await assert.rejects(backend.call('explain-sentence', { sentenceId: 'missing' }), /找不到这一句/);
  assert.equal(sentencesOf(await backend.call('get-state'))[1].explanation, null);
});

test('saying it without a time limit needs no explanation and restarts the miss count', async t => {
  const backend = harness(t, JSON.stringify(reply));
  const { ids } = await passageWith(backend, THREE);
  await backend.call('judge-recall', { attemptId: attemptId(1), sentenceId: ids[1], said: false });
  const state = await backend.call('record-speed-gap', { sentenceId: ids[1] });
  assert.deepEqual([sentencesOf(state)[1].misses, sentencesOf(state)[1].explanation, backend.asked.length], [0, null, 0]);
});

test('adopting the simpler wording swaps the card in place and starts it from scratch', async t => {
  const backend = harness(t, JSON.stringify({ ...reply, simpler: { en: 'I really pulled it off.', why: '少了一层从句。' } }));
  const { ids } = await passageWith(backend, THREE);
  await backend.call('judge-recall', { attemptId: attemptId(1), sentenceId: ids[1], said: true });
  await assert.rejects(backend.call('adopt-explanation', { sentenceId: ids[1], choice: 'simpler' }), /还没有讲解/);
  await backend.call('explain-sentence', { sentenceId: ids[1] });
  await assert.rejects(backend.call('adopt-explanation', { sentenceId: ids[1], choice: 'split' }), /没有拆分方案/);
  await assert.rejects(backend.call('adopt-explanation', { sentenceId: ids[1], choice: 'other' }), /只能采用/);

  const { sentenceIds, state } = await backend.call('adopt-explanation', { sentenceId: ids[1], choice: 'simpler' });
  const sentences = sentencesOf(state);
  assert.deepEqual(sentences.map(sentence => sentence.id), [ids[0], sentenceIds[0], ids[2]]);
  assert.notEqual(sentenceIds[0], ids[1]);
  const adopted = sentences[1];
  assert.deepEqual([adopted.zh, adopted.en, adopted.keyExpression, adopted.audio, adopted.schedule, adopted.recall, adopted.explanation, adopted.misses],
    ['这事挺难，但我做成了。', 'I really pulled it off.', 'pulled it off', null, null, 'pending', null, 0]);
  assert.equal(state.review.scheduled, 0, 'the old schedule went with the old card');
  const stored = JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8'));
  assert.deepEqual([Object.keys(stored.sentences).includes(ids[1]), stored.attempts.length], [false, 0]);
  assert.deepEqual(fs.readdirSync(path.join(backend.dataDirectory, 'audio')).sort(), [`${ids[0]}.mp3`, `${ids[2]}.mp3`].sort());
  await assert.rejects(backend.call('adopt-explanation', { sentenceId: ids[1], choice: 'simpler' }), /找不到这一句/);
  const resynthesized = await backend.call('synthesize-sentence', { sentenceId: sentenceIds[0] });
  assert.ok(sentencesOf(resynthesized)[1].audio.seconds > 0);
});

test('adopting a split puts two sentences where one was, and the key expression stays with the half that has it', async t => {
  const backend = harness(t, JSON.stringify(splitReply));
  const { ids } = await passageWith(backend, [THREE[0], { zh: '我昨天想把整件事告诉他，但一直没机会。', en: LONG, keyExpression: 'got the chance' }]);
  await backend.call('explain-sentence', { sentenceId: ids[1] });
  const { sentenceIds, state } = await backend.call('adopt-explanation', { sentenceId: ids[1], choice: 'split' });
  assert.deepEqual(sentencesOf(state).map(sentence => [sentence.id, sentence.zh, sentence.keyExpression]), [
    [ids[0], '先说一句。', ''], [sentenceIds[0], '我昨天想把整件事告诉他。', ''], [sentenceIds[1], '但我一直没机会。', 'got the chance'],
  ]);
});
