'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackend } = require('../src/backend/backend.cjs');
const { parseExplanation } = require('../src/backend/explain-parse.cjs');
const { explainSystemPrompt, explainUserPrompt } = require('../src/backend/explain-prompts.cjs');
const { practiceHistory } = require('../src/backend/explain.cjs');
const { replyKeys, joinSentences } = require('../src/backend/languages.cjs');
const { fixtureBytes, fixtureJson } = require('./helpers.cjs');

const sha16 = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const attemptId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORIGINAL = { targetLanguage: 'en-US', keys: replyKeys('zh-CN', 'en-US') };
const JAPANESE = { targetLanguage: 'ja-JP', keys: replyKeys('en-US', 'ja-JP') };

const LONG = 'I wanted to tell him about the whole thing yesterday, but I never got the chance to do it.';
const reply = { difficulty: ['“pulled it off”是固定搭配，中文里没有对应的结构。'], simpler: { en: 'I did it.', why: '去掉了固定搭配。' }, split: null };
const explained = { difficulty: reply.difficulty, simpler: { target: 'I did it.', why: '去掉了固定搭配。' }, split: null };
const splitReply = { ...reply, simpler: { en: 'I wanted to tell him yesterday, but I had no chance.', why: '更短。' }, split: [{ zh: '我昨天想把整件事告诉他。', en: 'I wanted to tell him about the whole thing yesterday.' }, { zh: '但我一直没机会。', en: 'But I never got the chance.' }] };
const splitParts = [{ native: '我昨天想把整件事告诉他。', target: 'I wanted to tell him about the whole thing yesterday.' }, { native: '但我一直没机会。', target: 'But I never got the chance.' }];

const LONG_JAPANESE = '昨日、彼に全部話したかったのですが、結局その機会がありませんでした。';
const japaneseReply = {
  difficulty: ['"機会がありませんでした" is a set phrase with no word-for-word English match.'],
  simpler: { target: '昨日は彼に話せませんでした。', why: 'One short clause.' },
  split: [{ native: 'I wanted to tell him everything yesterday.', target: '昨日、彼に全部話したかったです。' }, { native: 'But I never got the chance.', target: 'でも、その機会がありませんでした。' }],
};
// Outside the original pair a reply already uses the field names the explanation is stored under.
const japaneseExplained = japaneseReply;

test('the system prompt is the approved wording', () => {
  const prompt = explainSystemPrompt('zh-CN', 'en-US');
  assert.match(prompt, /^你是一位英语口语教练。/);
  assert.match(prompt, /只有原句超过 12 个词时才给拆分方案/);
  assert.match(prompt, /\{"difficulty":\["…"\],"simpler":\{"en":"…","why":"…"\},"split":\[\{"zh":"…","en":"…"\},\{"zh":"…","en":"…"\}\]\}$/);
  assert.equal(sha16(prompt), 'bdc2435f20490716');
});

test('another pair gets the same instructions in English, with its languages named and the keys "native" and "target"', () => {
  const prompt = explainSystemPrompt('en-US', 'ja-JP');
  assert.match(prompt, /^You are a speaking coach for Japanese\. The learner, whose own language is English, wants to say in Japanese what they mean in English\./);
  assert.match(prompt, /- Explain in English; keep Japanese examples in Japanese\./);
  assert.match(prompt, /- Offer a split only when the original is longer than 24 characters: .* each with its meaning in English\. Otherwise set "split" to null\./);
  assert.match(prompt, /\{"difficulty":\["…"\],"simpler":\{"target":"…","why":"…"\},"split":\[\{"native":"…","target":"…"\},\{"native":"…","target":"…"\}\]\}$/);
  assert.doesNotMatch(prompt, /"zh"|"en"|Chinese|中文/);
});

test('the split limit in the prompt is in words for spaced languages and names the variety practised', () => {
  const british = explainSystemPrompt('zh-CN', 'en-GB');
  assert.match(british, /^You are a speaking coach for British English\. The learner, whose own language is Chinese, wants to say in English what they mean in Chinese\./);
  assert.match(british, /longer than 12 words:/);
  assert.match(british, /"simpler":\{"target":"…"/);
  assert.match(explainSystemPrompt('ja-JP', 'de-DE'), /longer than 12 words:/);
  assert.match(explainSystemPrompt('en-US', 'ko-KR'), /longer than 12 words:/);
  for (const targetLanguage of ['zh-CN', 'zh-TW', 'zh-HK', 'th-TH']) assert.match(explainSystemPrompt('en-US', targetLanguage), /longer than 24 characters:/, targetLanguage);
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
  assert.equal(explainUserPrompt({ native: '我会把这事告诉他。', target: "I'll tell him about it.", keyExpression: 'tell him about it' }, history, 'zh-CN', 'en-US'), [
    '中文：我会把这事告诉他。',
    "英文：I'll tell him about it.",
    '关键说法：tell him about it',
    '练习记录：共 3 次，说出来 1 次，没说出来 2 次（其中超时 1 次）',
    '常读错的词：tell（2 次）、it（1 次）',
    '不清楚的音：tell 里的 /t/（听起来像 /s/）、about 里的 /aʊ/',
  ].join('\n'));
  assert.match(explainUserPrompt({ native: '好', target: 'OK.', keyExpression: '' }, practiceHistory(state, 'none'), 'zh-CN', 'en-US'), /关键说法：无\n练习记录：共 0 次.*\n常读错的词：无\n不清楚的音：无$/);
});

test('the user message for another pair is in English and labels each line with its language', () => {
  const history = {
    attempts: 3, said: 1, missed: 2, timedOut: 1,
    wrongWords: [{ word: '機会', count: 2 }, { word: '結局', count: 1 }],
    weakSounds: [{ word: 'tell', expected: 't', soundsLike: 's', count: 2 }, { word: 'about', expected: 'aʊ', soundsLike: null, count: 1 }],
  };
  assert.equal(explainUserPrompt({ native: 'I never got the chance.', target: '機会がありませんでした。', keyExpression: '機会' }, history, 'en-US', 'ja-JP'), [
    'English: I never got the chance.',
    'Japanese: 機会がありませんでした。',
    'Key expression: 機会',
    'Practice record: attempts from memory 3, said 1, missed 2 (of which out of time: 1)',
    'Words often misread: 機会 (×2), 結局 (×1)',
    'Unclear sounds: /t/ in tell (sounded like /s/), /aʊ/ in about',
  ].join('\n'));
  const nothing = { attempts: 0, said: 0, missed: 0, timedOut: 0, wrongWords: [], weakSounds: [] };
  assert.match(explainUserPrompt({ native: '好', target: 'OK.', keyExpression: '' }, nothing, 'zh-CN', 'en-GB'), /^Chinese: 好\nEnglish: OK\.\nKey expression: none\n.*\nWords often misread: none\nUnclear sounds: none$/);
});

test('a reply is read whether bare or fenced, and trimmed to three difficulties', () => {
  const many = { ...reply, difficulty: ['一', ' ', '二', '三', '四'] };
  assert.deepEqual(parseExplanation(JSON.stringify(reply), 'I pulled it off.', ORIGINAL), explained);
  assert.deepEqual(parseExplanation(`好的：\n\`\`\`json\n${JSON.stringify(many)}\n\`\`\``, 'I pulled it off.', ORIGINAL).difficulty, ['一', '二', '三']);
});

test('a split is kept only for sentences of more than 12 words, and only when it is two usable sentences', () => {
  assert.deepEqual(parseExplanation(JSON.stringify(splitReply), LONG, ORIGINAL).split, splitParts);
  assert.equal(parseExplanation(JSON.stringify(splitReply), 'One two three four five six seven eight nine ten eleven twelve.', ORIGINAL).split, null);
  assert.equal(parseExplanation(JSON.stringify({ ...splitReply, split: [splitReply.split[0]] }), LONG, ORIGINAL).split, null);
  assert.equal(parseExplanation(JSON.stringify({ ...splitReply, split: [splitReply.split[0], { zh: '', en: 'But no.' }] }), LONG, ORIGINAL).split, null);
});

test('a reply for another pair is read by its "native" and "target" keys', () => {
  assert.deepEqual(parseExplanation(JSON.stringify(japaneseReply), LONG_JAPANESE, JAPANESE), japaneseExplained);
  assert.throws(() => parseExplanation(JSON.stringify(reply), LONG_JAPANESE, JAPANESE), /不是预期的格式/, 'a simpler wording under "en" is not read');
  assert.equal(parseExplanation(JSON.stringify({ ...japaneseReply, split: splitReply.split }), LONG_JAPANESE, JAPANESE).split, null, 'a split under "zh" and "en" is not read');
});

test('for a language written without spaces, a split is kept only above 24 letters, whatever the punctuation', () => {
  const cases = [
    ['24 letters', `${'あ'.repeat(24)}。`, false],
    ['24 letters among punctuation and spaces', `${'あ'.repeat(12)}、 ${'あ'.repeat(12)}。！？`, false],
    ['25 letters', `${'あ'.repeat(25)}。`, true],
    ['a real long sentence', LONG_JAPANESE, true],
    ['a real short sentence', 'やり遂げました。', false],
  ];
  for (const [name, original, kept] of cases) {
    assert.deepEqual(parseExplanation(JSON.stringify(japaneseReply), original, JAPANESE).split, kept ? japaneseExplained.split : null, name);
  }
  const mandarin = { targetLanguage: 'zh-CN', keys: replyKeys('en-US', 'zh-CN') };
  assert.equal(parseExplanation(JSON.stringify(japaneseReply), `${'好'.repeat(24)}。`, mandarin).split, null);
  assert.notEqual(parseExplanation(JSON.stringify(japaneseReply), `${'好'.repeat(25)}。`, mandarin).split, null);
});

test('a spaced language other than English counts words, however long they are', () => {
  const german = { targetLanguage: 'de-DE', keys: replyKeys('en-US', 'de-DE') };
  const twelveWords = 'Heute ist wirklich außergewöhnlich schönes Wetter, lass uns gemeinsam im Park spazieren.';
  assert.equal(parseExplanation(JSON.stringify(japaneseReply), twelveWords, german).split, null);
  assert.notEqual(parseExplanation(JSON.stringify(japaneseReply), `${twelveWords} Jetzt.`, german).split, null);
});

test('an unusable reply is refused with a message for the user', () => {
  const bad = ['没有 JSON', '{"difficulty":[],"simpler":{"en":"I did it."}}', '{"difficulty":["难"]}', '{"difficulty":["难"],"simpler":{"en":" "}}', `{"difficulty":["难"],"simpler":{"en":"${'x'.repeat(401)}"}}`];
  for (const text of bad) assert.throws(() => parseExplanation(text, 'I pulled it off.', ORIGINAL), /不是预期的格式/, text);
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

async function passageWith(backend, sentences, { nativeLanguage = 'zh-CN', targetLanguage = 'en-US' } = {}) {
  await backend.call('set-secret', { name: 'elevenLabsKey', value: 'el-key' });
  const source = joinSentences(sentences.map(sentence => sentence.native), nativeLanguage);
  const { passageId, state } = await backend.call('create-passage', { register: 'formal', version: 'sentences', nativeLanguage, targetLanguage, source, sentences });
  for (const sentence of state.passages[0].sentences) await backend.call('synthesize-sentence', { sentenceId: sentence.id });
  return { passageId, ids: state.passages[0].sentences.map(sentence => sentence.id) };
}

const THREE = [
  { native: '先说一句。', target: 'Let me start.', keyExpression: '' },
  { native: '这事挺难，但我做成了。', target: "I can't believe I pulled it off.", keyExpression: 'pulled it off' },
  { native: '就这样。', target: "That's it.", keyExpression: '' },
];
const TWO_JAPANESE = [
  { native: 'Let me start.', target: 'まず一言。', keyExpression: '' },
  { native: 'I wanted to tell him everything yesterday, but I never got the chance.', target: LONG_JAPANESE, keyExpression: '機会' },
];
const sentencesOf = state => state.passages[0].sentences;

test('explaining asks the configured model, keeps the answer with the sentence, and restarts the miss count', async t => {
  const backend = harness(t, JSON.stringify(reply));
  const { ids } = await passageWith(backend, THREE);
  await backend.call('judge-recall', { attemptId: attemptId(1), sentenceId: ids[1], said: false });
  assert.equal(sentencesOf(await backend.call('get-state'))[1].misses, 1);

  const { explanation, state } = await backend.call('explain-sentence', { sentenceId: ids[1] });
  assert.deepEqual(explanation, explained);
  assert.deepEqual([sentencesOf(state)[1].explanation.simpler.target, sentencesOf(state)[1].misses], ['I did it.', 0]);
  const [request] = backend.asked;
  assert.deepEqual(request.model, { provider: 'fixture', id: 'cheap-model' });
  assert.equal(request.context.systemPrompt, explainSystemPrompt('zh-CN', 'en-US'));
  assert.match(request.context.messages[0].content, /^中文：这事挺难，但我做成了。\n英文：I can't believe I pulled it off\.\n关键说法：pulled it off\n练习记录：共 1 次，说出来 0 次，没说出来 1 次（其中超时 0 次）/);
});

test('a sentence of another pair is explained with that pair\'s prompts and reply keys', async t => {
  const backend = harness(t, JSON.stringify(japaneseReply));
  const { ids } = await passageWith(backend, TWO_JAPANESE, { nativeLanguage: 'en-US', targetLanguage: 'ja-JP' });
  const { explanation, state } = await backend.call('explain-sentence', { sentenceId: ids[1] });
  assert.deepEqual(explanation, japaneseExplained);
  assert.deepEqual(sentencesOf(state)[1].explanation.split, japaneseExplained.split, 'the split is kept: the sentence has more than 24 characters');
  const [request] = backend.asked;
  assert.equal(request.context.systemPrompt, explainSystemPrompt('en-US', 'ja-JP'));
  assert.match(request.context.messages[0].content, /^English: I wanted to tell him everything yesterday, but I never got the chance\.\nJapanese: 昨日、彼に全部話したかったのですが、結局その機会がありませんでした。\nKey expression: 機会\nPractice record: attempts from memory 0/);

  backend.answer.reply = JSON.stringify(reply);
  await assert.rejects(backend.call('explain-sentence', { sentenceId: ids[0] }), /不是预期的格式/, 'a reply in the original keys is not read for this pair');
});

test('a passage is explained in its own pair, whatever the settings say by then', async t => {
  const backend = harness(t, JSON.stringify(reply));
  const { ids } = await passageWith(backend, THREE);
  await backend.call('save-settings', { nativeLanguage: 'en-US', targetLanguage: 'ja-JP' });
  const { explanation } = await backend.call('explain-sentence', { sentenceId: ids[1] });
  assert.deepEqual(explanation, explained);
  assert.equal(backend.asked[0].context.systemPrompt, explainSystemPrompt('zh-CN', 'en-US'));
  assert.match(backend.asked[0].context.messages[0].content, /^中文：这事挺难，但我做成了。\n英文：/);
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
  assert.deepEqual([adopted.native, adopted.target, adopted.keyExpression, adopted.audio, adopted.schedule, adopted.recall, adopted.explanation, adopted.misses],
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
  const { ids } = await passageWith(backend, [THREE[0], { native: '我昨天想把整件事告诉他，但一直没机会。', target: LONG, keyExpression: 'got the chance' }]);
  await backend.call('explain-sentence', { sentenceId: ids[1] });
  const { sentenceIds, state } = await backend.call('adopt-explanation', { sentenceId: ids[1], choice: 'split' });
  assert.deepEqual(sentencesOf(state).map(sentence => [sentence.id, sentence.native, sentence.keyExpression]), [
    [ids[0], '先说一句。', ''], [sentenceIds[0], '我昨天想把整件事告诉他。', ''], [sentenceIds[1], '但我一直没机会。', 'got the chance'],
  ]);
});

test('adopting a split works the same for another pair', async t => {
  const backend = harness(t, JSON.stringify(japaneseReply));
  const { ids } = await passageWith(backend, TWO_JAPANESE, { nativeLanguage: 'en-US', targetLanguage: 'ja-JP' });
  await backend.call('explain-sentence', { sentenceId: ids[1] });
  const { sentenceIds, state } = await backend.call('adopt-explanation', { sentenceId: ids[1], choice: 'split' });
  assert.deepEqual(sentencesOf(state).map(sentence => [sentence.id, sentence.native, sentence.target, sentence.keyExpression]), [
    [ids[0], 'Let me start.', 'まず一言。', ''],
    [sentenceIds[0], 'I wanted to tell him everything yesterday.', '昨日、彼に全部話したかったです。', ''],
    [sentenceIds[1], 'But I never got the chance.', 'でも、その機会がありませんでした。', '機会'],
  ]);
  assert.deepEqual([state.passages[0].nativeLanguage, state.passages[0].targetLanguage], ['en-US', 'ja-JP']);
});
