'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { translationSystemPrompt, translationUserPrompt } = require('../src/backend/translate-prompts.cjs');
const { parseTranslation } = require('../src/backend/translate-parse.cjs');
const { translatePassage } = require('../src/backend/translate.cjs');
const { defaultSettings } = require('../src/backend/settings.cjs');

const formalReply = JSON.stringify({ sentences: [
  { zh: '这事挺难，但我做成了。', en: "I can't believe I pulled it off.", key: 'pulled it off' },
  { zh: '下周我再跟进。', en: "I'll follow up next week.", key: 'Follow Up' },
] });
const casualReply = JSON.stringify({
  brief: [{ zh: '我搞定了。', en: 'Nailed it.', key: 'Nailed it' }],
  elaborate: [{ zh: '我搞定了。', en: 'It took a while, but I nailed it.', key: 'nailed it' }, { zh: '挺开心的。', en: "I'm pretty stoked.", key: 'stoked' }],
});

test('each register gets the book\'s role description plus the output rules', () => {
  const formal = translationSystemPrompt('formal');
  const casual = translationSystemPrompt('casual');
  assert.match(formal, /^Your role is to be an English guru/);
  assert.match(formal, /\{"sentences":\[\{"zh":"…","en":"…","key":"…"\}\]\}/);
  assert.match(casual, /^NY Speak Easy serves as an English spoken adviser/);
  assert.match(casual, /\{"brief":\[.*\],"elaborate":\[.*\]\}/);
  for (const prompt of [formal, casual]) assert.match(prompt, /about 20 words at most/);
  assert.throws(() => translationSystemPrompt('poetic'), /场景/);
  assert.equal(translationUserPrompt('你好'), 'Chinese passage:\n\n你好');
});

test('a formal reply parses into one version with key expressions located in the sentence', () => {
  assert.deepEqual(parseTranslation(formalReply, 'formal'), { versions: [{ id: 'sentences', sentences: [
    { zh: '这事挺难，但我做成了。', en: "I can't believe I pulled it off.", keyExpression: 'pulled it off' },
    { zh: '下周我再跟进。', en: "I'll follow up next week.", keyExpression: 'follow up' },
  ] }] });
});

test('a casual reply parses into a brief and an elaborate version', () => {
  const { versions } = parseTranslation(casualReply, 'casual');
  assert.deepEqual(versions.map(version => [version.id, version.sentences.length]), [['brief', 1], ['elaborate', 2]]);
});

test('code fences, surrounding prose and stray whitespace are tolerated', () => {
  const wrapped = `Here you go:\n\`\`\`json\n{"sentences":[{"zh":" 你好 ","en":"Hi\\n there.","key":"nope"}]}\n\`\`\`\nHope it helps!`;
  assert.deepEqual(parseTranslation(wrapped, 'formal').versions[0].sentences, [{ zh: '你好', en: 'Hi there.', keyExpression: '' }]);
});

test('unusable replies are refused with one message', () => {
  const cases = [
    ['', 'formal'], ['Sorry, I cannot.', 'formal'], ['{"sentences":[]}', 'formal'], ['{"sentences":[{"zh":"你好"}]}', 'formal'],
    ['{"sentences":"x"}', 'formal'], ['{broken', 'formal'], [formalReply, 'casual'], ['{"brief":[{"zh":"a","en":"b"}]}', 'casual'],
    [JSON.stringify({ sentences: Array.from({ length: 61 }, () => ({ zh: '好', en: 'ok' })) }), 'formal'],
  ];
  for (const [reply, register] of cases) assert.throws(() => parseTranslation(reply, register), /不是预期的格式/, reply.slice(0, 30));
});

const CHEAP = { provider: 'fixture', id: 'cheap-model' };
const OTHER = { provider: 'fixture', id: 'other-model' };
function fakeInference({ reply = formalReply, cheap = { model: CHEAP, thinkingLevel: 'low' }, stopReason = 'stop', errorMessage } = {}) {
  const requests = [];
  return {
    requests,
    catalog: async () => ({ models: [CHEAP, OTHER], slots: { cheap } }),
    complete: async request => { requests.push(request); return { role: 'assistant', stopReason, errorMessage, content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: reply }] }; },
  };
}

test('translatePassage asks the cheap slot model and returns the parsed versions', async () => {
  const inference = fakeInference();
  const signal = new AbortController().signal;
  const result = await translatePassage({ inference, settings: defaultSettings(), register: 'formal', chinese: '  这事挺难，但我做成了。下周我再跟进。 ', signal });
  assert.equal(result.versions[0].sentences.length, 2);
  const [request] = inference.requests;
  assert.deepEqual(request.model, { ...CHEAP, thinkingLevel: 'low' });
  assert.equal(request.purpose, 'user');
  assert.equal(request.signal, signal);
  assert.equal(request.context.systemPrompt, translationSystemPrompt('formal'));
  assert.equal(request.context.messages[0].content, 'Chinese passage:\n\n这事挺难，但我做成了。下周我再跟进。');
});

test('the plugin\'s own model override wins over the cheap slot', async () => {
  const inference = fakeInference({ reply: casualReply });
  await translatePassage({ inference, settings: { ...defaultSettings(), modelOverride: OTHER }, register: 'casual', chinese: '我搞定了' });
  assert.deepEqual(inference.requests[0].model, OTHER);
});

test('translatePassage explains what is wrong before or after calling the model', async () => {
  const settings = defaultSettings();
  const cases = [
    [{ inference: fakeInference(), chinese: '   ' }, /请先写下/, 0],
    [{ inference: fakeInference(), chinese: '长'.repeat(2001) }, /超过 2000 字/, 0],
    [{ inference: fakeInference(), chinese: '你好', register: 'poetic' }, /场景/, 0],
    [{ inference: fakeInference({ cheap: null }), chinese: '你好' }, /还没有可用的模型/, 0],
    [{ inference: fakeInference(), chinese: '你好', settings: { ...settings, modelOverride: { provider: 'gone', id: 'x' } } }, /现在不可用/, 0],
    [{ inference: fakeInference({ stopReason: 'error', errorMessage: 'overloaded' }), chinese: '你好' }, /翻译没有完成：overloaded/, 1],
    [{ inference: fakeInference({ reply: 'no json here' }), chinese: '你好' }, /不是预期的格式/, 1],
  ];
  for (const [overrides, expected, calls] of cases) {
    await assert.rejects(translatePassage({ settings, register: 'formal', ...overrides }), expected);
    assert.equal(overrides.inference.requests.length, calls, String(expected));
  }
});
