'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackend } = require('../src/backend/backend.cjs');
const { translationSystemPrompt } = require('../src/backend/translate-prompts.cjs');
const { fixtureBytes, fixtureJson } = require('./helpers.cjs');

const ELEVENLABS_KEY = 'el-test-key';
const AZURE_KEY = 'az-test-key';
const attemptId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const wavBase64 = Buffer.from(fixtureBytes('audio', 'tell-him-16k.wav')).toString('base64');
const assessmentHeader = request => JSON.parse(Buffer.from(request.init.headers['Pronunciation-Assessment'], 'base64').toString('utf8'));

const CHINESE = '这事挺难，但我做成了。我明天全都告诉他。';
const translationReply = JSON.stringify({ sentences: [
  { zh: '这事挺难，但我做成了。', en: "I can't believe I pulled it off.", key: 'pulled it off' },
  { zh: '我明天全都告诉他。', en: "I'll tell him about it.", key: 'tell him about it' },
] });

const ENGLISH = "The weather is nice today, so let's take a walk in the park.";
const JAPANESE = fixtureJson('azure', 'japanese.json').referenceText;
const japaneseReply = JSON.stringify({ sentences: [{ native: ENGLISH, target: JAPANESE, key: '散歩しましょう' }] });

/** A host context that keeps the registered handlers, with a canned model and a canned network. */
function harness(t, { synthesisStatus = 200, reply = translationReply, azureFixture = 'match', store } = {}) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-english-backend-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  if (store) fs.writeFileSync(path.join(dataDirectory, 'store.json'), JSON.stringify(store));
  const handlers = new Map();
  const requests = [];
  const asked = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (url.includes('elevenlabs')) {
      return synthesisStatus === 200
        ? new Response(fixtureBytes('elevenlabs', 'success.mp3'), { status: 200 })
        : new Response(JSON.stringify(fixtureJson('elevenlabs', 'bad-key.json').body), { status: synthesisStatus });
    }
    return Response.json(fixtureJson('azure', `${azureFixture}.json`).body);
  };
  const model = { provider: 'fixture', id: 'cheap-model' };
  const ctx = {
    dataDirectory,
    signal: new AbortController().signal,
    handle: (name, handler) => handlers.set(name, handler),
    inference: {
      catalog: async () => ({ models: [model], slots: { cheap: { model } } }),
      complete: async request => { asked.push(request); return { stopReason: 'stop', content: [{ type: 'text', text: reply }] }; },
    },
  };
  const start = () => { handlers.clear(); createBackend(ctx, { fetchImpl }); };
  start();
  return { dataDirectory, requests, asked, restart: start, call: (name, input) => handlers.get(name)(input) };
}

/** Translates `text` under the current settings and confirms the first version as it came back. */
async function confirmedPassage(backend, text = CHINESE) {
  const { nativeLanguage, targetLanguage, versions } = await backend.call('translate', { register: 'formal', text });
  return backend.call('create-passage', { register: 'formal', version: versions[0].id, nativeLanguage, targetLanguage, source: text, sentences: versions[0].sentences });
}

const synthesisBodies = backend => backend.requests.filter(request => request.url.includes('elevenlabs')).map(request => JSON.parse(request.init.body));
const scoringRequests = backend => backend.requests.filter(request => request.url.includes('microsoft'));

test('intake end to end: translate, confirm, synthesize, play back', async t => {
  const backend = harness(t);
  await backend.call('set-secret', { name: 'elevenLabsKey', value: ELEVENLABS_KEY });
  const { passageId, state } = await confirmedPassage(backend);
  const [passage] = state.passages;
  assert.equal(passage.id, passageId);
  assert.deepEqual([passage.nativeLanguage, passage.targetLanguage, passage.source], ['zh-CN', 'en-US', CHINESE]);
  assert.deepEqual(passage.sentences.map(sentence => [sentence.native, sentence.target, sentence.keyExpression, sentence.audio, sentence.schedule]), [
    ['这事挺难，但我做成了。', "I can't believe I pulled it off.", 'pulled it off', null, null],
    ['我明天全都告诉他。', "I'll tell him about it.", 'tell him about it', null, null],
  ]);

  let latest;
  for (const sentence of passage.sentences) latest = await backend.call('synthesize-sentence', { sentenceId: sentence.id });
  const synthesized = latest.passages[0].sentences;
  assert.ok(synthesized.every(sentence => Math.abs(sentence.audio.seconds - 1.28) < 0.001 && sentence.audio.modelId === 'eleven_v4'));
  assert.equal(backend.requests.length, 2);
  assert.equal(backend.requests[0].init.headers['xi-api-key'], ELEVENLABS_KEY);
  assert.deepEqual(JSON.parse(backend.requests[0].init.body), { text: "I can't believe I pulled it off.", model_id: 'eleven_v4', language_code: 'en' });

  const audio = await backend.call('sentence-audio', { sentenceId: synthesized[0].id });
  assert.equal(audio.mime, 'audio/mpeg');
  assert.deepEqual(new Uint8Array(Buffer.from(audio.base64, 'base64')), fixtureBytes('elevenlabs', 'success.mp3'));

  await backend.call('synthesize-sentence', { sentenceId: synthesized[0].id });
  assert.equal(backend.requests.length, 2, 'existing audio is not synthesized again');
  await backend.call('synthesize-sentence', { sentenceId: synthesized[0].id, force: true });
  assert.equal(backend.requests.length, 3, 'unless asked to');
});

test('translate uses the pair in the settings and names it in the result', async t => {
  const backend = harness(t);
  const result = await backend.call('translate', { register: 'formal', text: CHINESE });
  assert.deepEqual(Object.keys(result).sort(), ['nativeLanguage', 'targetLanguage', 'versions']);
  assert.deepEqual([result.nativeLanguage, result.targetLanguage, result.versions.map(version => version.id)], ['zh-CN', 'en-US', ['sentences']]);
  assert.deepEqual(result.versions[0].sentences[0], { native: '这事挺难，但我做成了。', target: "I can't believe I pulled it off.", keyExpression: 'pulled it off' });
  assert.equal(backend.asked[0].context.systemPrompt, translationSystemPrompt('formal', 'zh-CN', 'en-US'));
  assert.equal(backend.asked[0].context.messages[0].content, `Chinese passage:\n\n${CHINESE}`);
  await assert.rejects(backend.call('translate', { register: 'formal', chinese: CHINESE }), /请先写下/, 'the old input name is not read');
});

test('with the settings on another pair, the model is asked for that pair and the passage is saved under it', async t => {
  const backend = harness(t, { reply: japaneseReply });
  const saved = await backend.call('save-settings', { nativeLanguage: 'en-US', targetLanguage: 'ja-JP' });
  assert.deepEqual([saved.settings.nativeLanguage, saved.settings.targetLanguage, saved.settings.languagesConfirmed, saved.settings.readingSpeed], ['en-US', 'ja-JP', true, 3]);

  const result = await backend.call('translate', { register: 'formal', text: ENGLISH });
  assert.deepEqual(result, { nativeLanguage: 'en-US', targetLanguage: 'ja-JP', versions: [{ id: 'sentences', sentences: [{ native: ENGLISH, target: JAPANESE, keyExpression: '散歩しましょう' }] }] });
  assert.equal(backend.asked[0].context.systemPrompt, translationSystemPrompt('formal', 'en-US', 'ja-JP'));
  assert.equal(backend.asked[0].context.messages[0].content, `English passage:\n\n${ENGLISH}`);

  const { state } = await backend.call('create-passage', { register: 'formal', version: 'sentences', nativeLanguage: result.nativeLanguage, targetLanguage: result.targetLanguage, source: ENGLISH, sentences: result.versions[0].sentences });
  const [passage] = state.passages;
  assert.deepEqual([passage.nativeLanguage, passage.targetLanguage, passage.source], ['en-US', 'ja-JP', ENGLISH]);
  assert.deepEqual(passage.sentences.map(sentence => [sentence.native, sentence.target, sentence.keyExpression]), [[ENGLISH, JAPANESE, '散歩しましょう']]);
  const stored = JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8'));
  assert.deepEqual([stored.version, stored.passages[passage.id].nativeLanguage, stored.passages[passage.id].targetLanguage], [2, 'en-US', 'ja-JP']);
});

test('a reply in the original keys is refused when the settings are on another pair', async t => {
  const backend = harness(t);
  await backend.call('save-settings', { targetLanguage: 'en-GB' });
  await assert.rejects(backend.call('translate', { register: 'formal', text: CHINESE }), /不是预期的格式/);
});

test('a passage is spoken and scored in its own language, even after the settings move to another pair', async t => {
  const backend = harness(t, { reply: japaneseReply, azureFixture: 'japanese' });
  await backend.call('set-secret', { name: 'elevenLabsKey', value: ELEVENLABS_KEY });
  await backend.call('set-secret', { name: 'azureKey', value: AZURE_KEY });
  await backend.call('save-settings', { azureRegion: 'swedencentral', nativeLanguage: 'en-US', targetLanguage: 'ja-JP' });
  const { state } = await confirmedPassage(backend, ENGLISH);
  const sentenceId = state.passages[0].sentences[0].id;

  const moved = await backend.call('save-settings', { nativeLanguage: 'zh-CN', targetLanguage: 'de-DE' });
  assert.deepEqual([moved.settings.nativeLanguage, moved.settings.targetLanguage], ['zh-CN', 'de-DE']);
  assert.deepEqual([moved.passages[0].nativeLanguage, moved.passages[0].targetLanguage], ['en-US', 'ja-JP'], 'the passage keeps its pair');

  await backend.call('synthesize-sentence', { sentenceId });
  assert.deepEqual(synthesisBodies(backend), [{ text: JAPANESE, model_id: 'eleven_v4', language_code: 'ja' }]);

  const { assessment } = await backend.call('score-attempt', { attemptId: attemptId(1), sentenceId, kind: 'shadow', wavBase64 });
  assert.deepEqual([assessment.scores.overall, assessment.scores.prosody], [87.4, null]);
  assert.ok(assessment.words.every(word => word.phonemes.length === 0));
  const [scoring] = scoringRequests(backend);
  assert.equal(scoring.url, 'https://swedencentral.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=ja-JP&format=detailed');
  assert.deepEqual(assessmentHeader(scoring), { ReferenceText: JAPANESE, GradingSystem: 'HundredMark', Granularity: 'Phoneme', Dimension: 'Comprehensive', EnableMiscue: true });
});

test('a zh-CN → en-US passage is scored as en-US with the full options', async t => {
  const backend = harness(t);
  await backend.call('set-secret', { name: 'azureKey', value: AZURE_KEY });
  await backend.call('save-settings', { azureRegion: 'swedencentral' });
  const { state } = await confirmedPassage(backend);
  await backend.call('save-settings', { nativeLanguage: 'en-US', targetLanguage: 'ja-JP' });
  await backend.call('score-attempt', { attemptId: attemptId(1), sentenceId: state.passages[0].sentences[1].id, kind: 'shadow', wavBase64 });
  const [scoring] = scoringRequests(backend);
  assert.match(scoring.url, /\?language=en-US&format=detailed$/);
  assert.deepEqual(assessmentHeader(scoring), {
    ReferenceText: "I'll tell him about it.", GradingSystem: 'HundredMark', Granularity: 'Phoneme', Dimension: 'Comprehensive',
    EnableMiscue: true, EnableProsodyAssessment: true, PhonemeAlphabet: 'IPA', NBestPhonemeCount: 3,
  });
});

test('sentences and questions are synthesized with the speech code of the passage\'s target language', async t => {
  const cases = [
    ['zh-CN', 'en-US', 'en'], ['zh-CN', 'en-GB', 'en'], ['en-US', 'ja-JP', 'ja'], ['en-US', 'zh-HK', 'yue'],
    ['en-US', 'zh-TW', 'zh'], ['en-US', 'zh-CN', 'zh'], ['en-US', 'nb-NO', 'no'], ['en-US', 'pt-BR', 'pt'],
  ];
  const backend = harness(t);
  await backend.call('set-secret', { name: 'elevenLabsKey', value: ELEVENLABS_KEY });
  for (const [nativeLanguage, targetLanguage] of cases) {
    const { passageId, state } = await backend.call('create-passage', { register: 'casual', version: 'brief', nativeLanguage, targetLanguage, source: 'source', sentences: [{ native: 'native', target: `sentence in ${targetLanguage}`, keyExpression: '' }] });
    const { questionIds } = await backend.call('add-questions', { passageId, questions: [{ target: `question in ${targetLanguage}`, native: 'native' }] });
    await backend.call('synthesize-sentence', { sentenceId: state.passages[0].sentences[0].id });
    await backend.call('synthesize-question', { passageId, questionId: questionIds[0] });
  }
  assert.deepEqual(
    synthesisBodies(backend).map(body => [body.text, body.language_code]),
    cases.flatMap(([, targetLanguage, code]) => [[`sentence in ${targetLanguage}`, code], [`question in ${targetLanguage}`, code]]),
  );
});

test('data survives a restart, and the keys never reach the frontend', async t => {
  const backend = harness(t);
  await backend.call('set-secret', { name: 'elevenLabsKey', value: ELEVENLABS_KEY });
  await backend.call('save-settings', { azureRegion: 'swedencentral', dailyReviewLimit: 30, targetLanguage: 'en-GB' });
  await backend.call('save-settings', { targetLanguage: 'en-US' });
  const { state } = await confirmedPassage(backend);
  await backend.call('synthesize-sentence', { sentenceId: state.passages[0].sentences[0].id });
  backend.restart();
  const reopened = await backend.call('get-state');
  assert.deepEqual(reopened.secrets, { azureKey: false, elevenLabsKey: true });
  assert.equal(reopened.settings.dailyReviewLimit, 30);
  assert.deepEqual([reopened.settings.nativeLanguage, reopened.settings.targetLanguage, reopened.settings.languagesConfirmed], ['zh-CN', 'en-US', true]);
  assert.deepEqual([reopened.passages[0].nativeLanguage, reopened.passages[0].targetLanguage], ['zh-CN', 'en-US']);
  assert.equal(reopened.passages[0].sentences[0].audio.voiceId, 'cgSgspJ2msm6clMCkdW9');
  assert.ok(!JSON.stringify(reopened).includes(ELEVENLABS_KEY));
  assert.ok(!fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8').includes(ELEVENLABS_KEY));
});

test('a version 1 store keeps working: its passages are practised as zh-CN → en-US', async t => {
  const [p1, s1, q1] = ['11111111-1111-4111-8111-000000000001', '11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000003'];
  const store = {
    version: 1, revision: 3, settings: { azureRegion: 'swedencentral', readingCharsPerSecond: 7 },
    passages: { [p1]: { id: p1, createdAt: 1000, register: 'formal', version: 'sentences', chinese: '我明天全都告诉他。', sentenceIds: [s1], questions: [{ id: q1, en: 'Will you tell him?', zh: '你会告诉他吗？', audio: null }], firstReading: null, latestReading: null } },
    sentences: { [s1]: { id: s1, passageId: p1, zh: '我明天全都告诉他。', en: "I'll tell him about it.", keyExpression: 'tell him about it', audio: null, schedule: null, explanation: null, explainCheckedAt: null } },
    attempts: [],
  };
  const backend = harness(t, { store });
  const state = await backend.call('get-state');
  assert.equal(state.settings.readingSpeed, 7);
  const [passage] = state.passages;
  assert.deepEqual([passage.source, passage.nativeLanguage, passage.targetLanguage], ['我明天全都告诉他。', 'zh-CN', 'en-US']);
  assert.deepEqual(passage.sentences.map(sentence => [sentence.native, sentence.target]), [['我明天全都告诉他。', "I'll tell him about it."]]);
  assert.deepEqual(passage.questions.map(question => [question.target, question.native]), [['Will you tell him?', '你会告诉他吗？']]);

  await backend.call('set-secret', { name: 'elevenLabsKey', value: ELEVENLABS_KEY });
  await backend.call('set-secret', { name: 'azureKey', value: AZURE_KEY });
  await backend.call('synthesize-sentence', { sentenceId: s1 });
  await backend.call('synthesize-question', { passageId: p1, questionId: q1 });
  assert.deepEqual(synthesisBodies(backend).map(body => [body.text, body.language_code]), [["I'll tell him about it.", 'en'], ['Will you tell him?', 'en']]);
  await backend.call('score-attempt', { attemptId: attemptId(1), sentenceId: s1, kind: 'shadow', wavBase64 });
  assert.match(scoringRequests(backend)[0].url, /\?language=en-US&format=detailed$/);

  const written = JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8'));
  assert.deepEqual([written.version, written.sentences[s1].target, written.passages[p1].source], [2, "I'll tell him about it.", '我明天全都告诉他。']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backend.dataDirectory, 'store.v1.json'), 'utf8')), store);
});

test('a failed synthesis leaves the sentence without audio and says why in Chinese', async t => {
  const backend = harness(t, { synthesisStatus: 401 });
  const { state } = await confirmedPassage(backend);
  const sentenceId = state.passages[0].sentences[0].id;
  await assert.rejects(backend.call('synthesize-sentence', { sentenceId }), /还没有填 ElevenLabs 的密钥/);
  await backend.call('set-secret', { name: 'elevenLabsKey', value: ELEVENLABS_KEY });
  await assert.rejects(backend.call('synthesize-sentence', { sentenceId }), error => /ElevenLabs 不接受这把密钥/.test(error.message) && !error.message.includes(ELEVENLABS_KEY));
  assert.equal((await backend.call('get-state')).passages[0].sentences[0].audio, null);
  await assert.rejects(backend.call('sentence-audio', { sentenceId }), /还没有合成语音/);
});

test('deleting a passage removes its sentences and audio files', async t => {
  const backend = harness(t);
  await backend.call('set-secret', { name: 'elevenLabsKey', value: ELEVENLABS_KEY });
  const { passageId, state } = await confirmedPassage(backend);
  await backend.call('synthesize-sentence', { sentenceId: state.passages[0].sentences[0].id });
  assert.equal(fs.readdirSync(path.join(backend.dataDirectory, 'audio')).length, 1);
  const after = await backend.call('delete-passage', { passageId });
  assert.deepEqual(after.passages, []);
  assert.deepEqual(fs.readdirSync(path.join(backend.dataDirectory, 'audio')), []);
  await assert.rejects(backend.call('delete-passage', { passageId }), /找不到这一段/);
});

test('a confirmed passage is checked before it is saved', async t => {
  const backend = harness(t);
  const good = { register: 'casual', version: 'brief', nativeLanguage: 'zh-CN', targetLanguage: 'en-US', source: '我搞定了', sentences: [{ native: '我搞定了。', target: 'Nailed it.', keyExpression: 'nailed it' }] };
  const refused = [
    [{ register: 'poetic' }, /场景/], [{ version: 'sentences' }, /版本和场景对不上/], [{ source: ' ' }, /原文为空或太长/], [{ source: '长'.repeat(2001) }, /原文为空或太长/],
    [{ source: undefined, chinese: '我搞定了' }, /原文为空或太长/], [{ sentences: [] }, /1 到 60 句/],
    [{ nativeLanguage: undefined }, /不支持这种语言/], [{ targetLanguage: 'xx-XX' }, /不支持这种语言/], [{ targetLanguage: 'en' }, /不支持这种语言/],
    [{ nativeLanguage: 'en-US' }, /母语和学习语言不能相同/],
    [{ sentences: [{ native: '我搞定了。', target: ' ' }] }, /第 1 句两种语言的内容都不能为空/],
    [{ sentences: [{ native: '', target: 'Nailed it.' }] }, /第 1 句两种语言的内容都不能为空/],
    [{ sentences: [{ zh: '我搞定了。', en: 'Nailed it.' }] }, /第 1 句两种语言的内容都不能为空/],
    [{ sentences: [good.sentences[0], { native: '好', target: 'x'.repeat(401) }] }, /第 2 句太长了/],
    [{ sentences: [{ native: '我搞定了。', target: 'Nailed it.', keyExpression: 'pulled off' }] }, /第 1 句的关键说法「pulled off」不在要练的句子里/],
  ];
  for (const [overrides, expected] of refused) await assert.rejects(backend.call('create-passage', { ...good, ...overrides }), expected);
  assert.deepEqual((await backend.call('get-state')).passages, []);
  const { state } = await backend.call('create-passage', good);
  assert.equal(state.passages[0].version, 'brief');
});

test('a passage may be confirmed for a pair other than the one in the settings', async t => {
  const backend = harness(t);
  const { state } = await backend.call('create-passage', { register: 'casual', version: 'brief', nativeLanguage: 'en-US', targetLanguage: 'ja-JP', source: 'Nailed it.', sentences: [{ native: 'Nailed it.', target: 'やり遂げました。', keyExpression: 'やり遂げ' }] });
  assert.deepEqual([state.passages[0].nativeLanguage, state.passages[0].targetLanguage], ['en-US', 'ja-JP']);
  assert.deepEqual([state.settings.nativeLanguage, state.settings.targetLanguage, state.settings.languagesConfirmed], ['zh-CN', 'en-US', false]);
});

test('save-settings applies the language rules and says what is wrong in the interface language', async t => {
  const backend = harness(t);
  const swapped = await backend.call('save-settings', { targetLanguage: 'zh-CN' });
  assert.deepEqual([swapped.settings.nativeLanguage, swapped.settings.targetLanguage, swapped.settings.readingSpeed, swapped.settings.languagesConfirmed], ['en-US', 'zh-CN', 3, true]);
  await assert.rejects(backend.call('save-settings', { targetLanguage: 'xx-XX' }), /不支持这种语言/);
  await assert.rejects(backend.call('save-settings', { nativeLanguage: 'ja-JP', targetLanguage: 'ja-JP' }), /母语和学习语言不能相同/);
  await backend.call('save-settings', { language: 'en' });
  await assert.rejects(backend.call('save-settings', { targetLanguage: 'xx-XX' }), /This language is not supported\./);
  await assert.rejects(backend.call('save-settings', { nativeLanguage: 'ja-JP', targetLanguage: 'ja-JP' }), /must be different/);
  await assert.rejects(backend.call('save-settings', { readingSpeed: 0 }), /reading speed must be between 1 and 20/);
  const after = await backend.call('save-settings', { language: 'zh' });
  assert.deepEqual([after.settings.nativeLanguage, after.settings.targetLanguage], ['en-US', 'zh-CN'], 'a refused patch changes nothing');
});

test('assess scores a recording with the stored Azure key and region', async t => {
  const backend = harness(t);
  const input = { wavBase64, referenceText: "I'll tell him about it." };
  await assert.rejects(backend.call('assess', input), /还没有填 Azure 区域/);
  await backend.call('save-settings', { azureRegion: 'swedencentral' });
  await assert.rejects(backend.call('assess', input), /还没有填 Azure 语音 的密钥/);
  await backend.call('set-secret', { name: 'azureKey', value: AZURE_KEY });
  const assessment = await backend.call('assess', input);
  assert.equal(assessment.scores.overall, 96);
  assert.equal(backend.requests[0].init.headers['Ocp-Apim-Subscription-Key'], AZURE_KEY);
  assert.match(backend.requests[0].url, /^https:\/\/swedencentral\.stt\.speech\.microsoft\.com\//);
  await assert.rejects(backend.call('assess', { ...input, wavBase64: 'x'.repeat(1_400_001) }), /录音为空或太长/);
  await assert.rejects(backend.call('assess', { ...input, wavBase64: Buffer.from('not a wav').toString('base64') }), /这段录音没法评分/);
});

test('the microphone test is always scored as en-US, whatever language is practised', async t => {
  const backend = harness(t);
  await backend.call('set-secret', { name: 'azureKey', value: AZURE_KEY });
  await backend.call('save-settings', { azureRegion: 'swedencentral', nativeLanguage: 'en-US', targetLanguage: 'ja-JP' });
  await backend.call('assess', { wavBase64, referenceText: "I'll tell him about it." });
  assert.match(backend.requests[0].url, /\?language=en-US&format=detailed$/);
  assert.equal(assessmentHeader(backend.requests[0]).EnableProsodyAssessment, true);
});

test('every operation refuses input that is not an object', async t => {
  const backend = harness(t);
  for (const input of [null, 'text', [1]]) await assert.rejects(backend.call('get-state', input), /输入格式不对/);
  assert.equal((await backend.call('get-state')).revision, 0);
});
