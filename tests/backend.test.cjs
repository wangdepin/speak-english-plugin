'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackend } = require('../src/backend/backend.cjs');
const { fixtureBytes, fixtureJson } = require('./helpers.cjs');

const ELEVENLABS_KEY = 'el-test-key';
const AZURE_KEY = 'az-test-key';
const translationReply = JSON.stringify({ sentences: [
  { zh: '这事挺难，但我做成了。', en: "I can't believe I pulled it off.", key: 'pulled it off' },
  { zh: '我明天全都告诉他。', en: "I'll tell him about it.", key: 'tell him about it' },
] });

/** A host context that keeps the registered handlers, with a canned model and a canned network. */
function harness(t, { synthesisStatus = 200 } = {}) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-english-backend-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const handlers = new Map();
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (url.includes('elevenlabs')) {
      return synthesisStatus === 200
        ? new Response(fixtureBytes('elevenlabs', 'success.mp3'), { status: 200 })
        : new Response(JSON.stringify(fixtureJson('elevenlabs', 'bad-key.json').body), { status: synthesisStatus });
    }
    return Response.json(fixtureJson('azure', 'match.json').body);
  };
  const model = { provider: 'fixture', id: 'cheap-model' };
  const ctx = {
    dataDirectory,
    signal: new AbortController().signal,
    handle: (name, handler) => handlers.set(name, handler),
    inference: {
      catalog: async () => ({ models: [model], slots: { cheap: { model } } }),
      complete: async () => ({ stopReason: 'stop', content: [{ type: 'text', text: translationReply }] }),
    },
  };
  const start = () => { handlers.clear(); createBackend(ctx, { fetchImpl }); };
  start();
  return { dataDirectory, requests, restart: start, call: (name, input) => handlers.get(name)(input) };
}

async function confirmedPassage(backend) {
  const { versions } = await backend.call('translate', { register: 'formal', chinese: '这事挺难，但我做成了。我明天全都告诉他。' });
  return backend.call('create-passage', { register: 'formal', version: versions[0].id, chinese: '这事挺难，但我做成了。我明天全都告诉他。', sentences: versions[0].sentences });
}

test('intake end to end: translate, confirm, synthesize, play back', async t => {
  const backend = harness(t);
  await backend.call('set-secret', { name: 'elevenLabsKey', value: ELEVENLABS_KEY });
  const { passageId, state } = await confirmedPassage(backend);
  const [passage] = state.passages;
  assert.equal(passage.id, passageId);
  assert.deepEqual(passage.sentences.map(sentence => [sentence.en, sentence.keyExpression, sentence.audio, sentence.schedule]), [
    ["I can't believe I pulled it off.", 'pulled it off', null, null],
    ["I'll tell him about it.", 'tell him about it', null, null],
  ]);

  let latest;
  for (const sentence of passage.sentences) latest = await backend.call('synthesize-sentence', { sentenceId: sentence.id });
  const synthesized = latest.passages[0].sentences;
  assert.ok(synthesized.every(sentence => Math.abs(sentence.audio.seconds - 1.28) < 0.001 && sentence.audio.modelId === 'eleven_v4'));
  assert.equal(backend.requests.length, 2);
  assert.equal(backend.requests[0].init.headers['xi-api-key'], ELEVENLABS_KEY);
  assert.deepEqual(JSON.parse(backend.requests[0].init.body), { text: "I can't believe I pulled it off.", model_id: 'eleven_v4' });

  const audio = await backend.call('sentence-audio', { sentenceId: synthesized[0].id });
  assert.equal(audio.mime, 'audio/mpeg');
  assert.deepEqual(new Uint8Array(Buffer.from(audio.base64, 'base64')), fixtureBytes('elevenlabs', 'success.mp3'));

  await backend.call('synthesize-sentence', { sentenceId: synthesized[0].id });
  assert.equal(backend.requests.length, 2, 'existing audio is not synthesized again');
  await backend.call('synthesize-sentence', { sentenceId: synthesized[0].id, force: true });
  assert.equal(backend.requests.length, 3, 'unless asked to');
});

test('data survives a restart, and the keys never reach the frontend', async t => {
  const backend = harness(t);
  await backend.call('set-secret', { name: 'elevenLabsKey', value: ELEVENLABS_KEY });
  await backend.call('save-settings', { azureRegion: 'swedencentral', dailyReviewLimit: 30 });
  const { state } = await confirmedPassage(backend);
  await backend.call('synthesize-sentence', { sentenceId: state.passages[0].sentences[0].id });
  backend.restart();
  const reopened = await backend.call('get-state');
  assert.deepEqual(reopened.secrets, { azureKey: false, elevenLabsKey: true });
  assert.equal(reopened.settings.dailyReviewLimit, 30);
  assert.equal(reopened.passages[0].sentences[0].audio.voiceId, 'cgSgspJ2msm6clMCkdW9');
  assert.ok(!JSON.stringify(reopened).includes(ELEVENLABS_KEY));
  assert.ok(!fs.readFileSync(path.join(backend.dataDirectory, 'store.json'), 'utf8').includes(ELEVENLABS_KEY));
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
  const good = { register: 'casual', version: 'brief', chinese: '我搞定了', sentences: [{ zh: '我搞定了。', en: 'Nailed it.', keyExpression: 'nailed it' }] };
  const refused = [
    [{ register: 'poetic' }, /场景/], [{ version: 'sentences' }, /版本和场景对不上/], [{ chinese: ' ' }, /中文原文/], [{ sentences: [] }, /1 到 60 句/],
    [{ sentences: [{ zh: '我搞定了。', en: ' ' }] }, /第 1 句的中文和英文都不能为空/],
    [{ sentences: [good.sentences[0], { zh: '好', en: 'x'.repeat(401) }] }, /第 2 句太长了/],
    [{ sentences: [{ zh: '我搞定了。', en: 'Nailed it.', keyExpression: 'pulled off' }] }, /关键说法「pulled off」不在英文句子里/],
  ];
  for (const [overrides, expected] of refused) await assert.rejects(backend.call('create-passage', { ...good, ...overrides }), expected);
  assert.deepEqual((await backend.call('get-state')).passages, []);
  const { state } = await backend.call('create-passage', good);
  assert.equal(state.passages[0].version, 'brief');
});

test('assess scores a recording with the stored Azure key and region', async t => {
  const backend = harness(t);
  const wavBase64 = Buffer.from(fixtureBytes('audio', 'tell-him-16k.wav')).toString('base64');
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

test('every operation refuses input that is not an object', async t => {
  const backend = harness(t);
  for (const input of [null, 'text', [1]]) await assert.rejects(backend.call('get-state', input), /输入格式不对/);
  assert.equal((await backend.call('get-state')).revision, 0);
});
