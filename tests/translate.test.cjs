'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { translationSystemPrompt, translationUserPrompt } = require('../src/backend/translate-prompts.cjs');
const { parseTranslation } = require('../src/backend/translate-parse.cjs');
const { translatePassage } = require('../src/backend/translate.cjs');
const { defaultSettings } = require('../src/backend/settings.cjs');
const { LANGUAGES, LANGUAGE_CODES, replyKeys } = require('../src/backend/languages.cjs');

const sha16 = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const ORIGINAL_KEYS = replyKeys('zh-CN', 'en-US');
const GENERAL_KEYS = replyKeys('en-US', 'ja-JP');

const formalReply = JSON.stringify({ sentences: [
  { zh: '这事挺难，但我做成了。', en: "I can't believe I pulled it off.", key: 'pulled it off' },
  { zh: '下周我再跟进。', en: "I'll follow up next week.", key: 'Follow Up' },
] });
const casualReply = JSON.stringify({
  brief: [{ zh: '我搞定了。', en: 'Nailed it.', key: 'Nailed it' }],
  elaborate: [{ zh: '我搞定了。', en: 'It took a while, but I nailed it.', key: 'nailed it' }, { zh: '挺开心的。', en: "I'm pretty stoked.", key: 'stoked' }],
});
const japaneseReply = JSON.stringify({ sentences: [
  { native: 'It was hard, but I pulled it off.', target: '大変でしたが、やり遂げました。', key: 'やり遂げました' },
  { native: "I'll follow up next week.", target: '来週また確認します。', key: 'フォロー' },
] });

test('each register gets the book\'s role description plus the output rules', () => {
  const formal = translationSystemPrompt('formal', 'zh-CN', 'en-US');
  const casual = translationSystemPrompt('casual', 'zh-CN', 'en-US');
  assert.match(formal, /^Your role is to be an English guru/);
  assert.match(formal, /\{"sentences":\[\{"zh":"…","en":"…","key":"…"\}\]\}/);
  assert.match(casual, /^NY Speak Easy serves as an English spoken adviser/);
  assert.match(casual, /\{"brief":\[.*\],"elaborate":\[.*\]\}/);
  for (const prompt of [formal, casual]) assert.match(prompt, /about 20 words at most/);
  assert.throws(() => translationSystemPrompt('poetic', 'zh-CN', 'en-US'), /场景/);
  assert.equal(translationUserPrompt('你好', 'zh-CN'), 'Chinese passage:\n\n你好');
});

test('the approved zh-CN → en-US translation prompts are unchanged', () => {
  assert.equal(sha16(translationSystemPrompt('formal', 'zh-CN', 'en-US')), '98b6952c2051f512');
  assert.equal(sha16(translationSystemPrompt('casual', 'zh-CN', 'en-US')), '6e3cf0e2bfbacbc1');
  for (const register of ['formal', 'casual']) {
    const prompt = translationSystemPrompt(register, 'zh-CN', 'en-US');
    assert.match(prompt, /The user will practise saying your English aloud, one sentence at a time, with the Chinese as the only cue\./);
    assert.match(prompt, /- "zh" is the part of the Chinese passage that the English sentence expresses\./);
    assert.match(prompt, /that a Chinese speaker is least likely to come up with: a phrasal verb, an idiom or a collocation\./);
    assert.doesNotMatch(prompt, /"native"|"target"/);
  }
});

test('another pair is named in the prompt and replies with the keys "native" and "target"', () => {
  const cases = [
    ['formal', 'en-US', 'ja-JP', /^Your role is to be a language guru, an expert in authentic Japanese,/, /\{"sentences":\[\{"native":"…","target":"…","key":"…"\}\]\}$/],
    ['casual', 'en-US', 'ja-JP', /^You serve as a spoken-language adviser, specializing in translating the user's words into everyday spoken Japanese,/, /\{"brief":\[\{"native":"…","target":"…","key":"…"\}\],"elaborate":\[\{"native":"…","target":"…","key":"…"\}\]\}$/],
  ];
  for (const [register, nativeLanguage, targetLanguage, role, shape] of cases) {
    const prompt = translationSystemPrompt(register, nativeLanguage, targetLanguage);
    assert.match(prompt, role, register);
    assert.match(prompt, shape, register);
    assert.match(prompt, /The user gives you a passage in English that they want to say/, register);
    assert.match(prompt, /The user will practise saying your Japanese aloud, one sentence at a time, with the English as the only cue\./, register);
    assert.match(prompt, /- "native" is the part of the English passage that the Japanese sentence expresses\./, register);
    assert.match(prompt, /that an English speaker is least likely to come up with: an idiom, a collocation or a set phrase\./, register);
    assert.doesNotMatch(prompt, /"zh"|"en"|Chinese|New York/, register);
  }
  assert.equal(translationUserPrompt('I pulled it off.', 'en-US'), 'English passage:\n\nI pulled it off.');
  assert.equal(translationUserPrompt('我搞掂咗。', 'zh-HK'), 'Cantonese passage:\n\n我搞掂咗。');
});

test('a variety of the target language is named in full: zh-CN → en-GB', () => {
  const formal = translationSystemPrompt('formal', 'zh-CN', 'en-GB');
  assert.match(formal, /an expert in authentic British English,/);
  assert.match(formal, /Your goal is to make British English accessible/);
  assert.match(formal, /The user gives you a passage in Chinese .* Express the whole passage in English/);
  assert.match(formal, /\{"sentences":\[\{"native":"…","target":"…","key":"…"\}\]\}$/);
  assert.doesNotMatch(formal, /American|"zh"|"en"/);
  assert.match(translationSystemPrompt('casual', 'zh-CN', 'en-GB'), /everyday spoken British English,/);
  assert.doesNotMatch(translationSystemPrompt('casual', 'zh-CN', 'en-GB'), /New York|NY Speak Easy/);
});

test('the sentence length is given in words, or in characters for a language written without spaces', () => {
  const cases = [
    ['ja-JP', 'about 40 characters at most'], ['zh-TW', 'about 40 characters at most'], ['zh-HK', 'about 40 characters at most'], ['th-TH', 'about 40 characters at most'],
    ['ko-KR', 'about 20 words at most'], ['de-DE', 'about 20 words at most'], ['en-GB', 'about 20 words at most'],
  ];
  for (const [targetLanguage, limit] of cases) {
    for (const register of ['formal', 'casual']) {
      const prompt = translationSystemPrompt(register, 'en-US', targetLanguage);
      assert.ok(prompt.includes(`short enough to say in one breath: ${limit}.`), `${register} ${targetLanguage}`);
    }
  }
});

test('American English keeps the book\'s roles whatever the learner\'s own language is', () => {
  for (const nativeLanguage of ['ja-JP', 'de-DE', 'zh-TW']) {
    const formal = translationSystemPrompt('formal', nativeLanguage, 'en-US');
    const casual = translationSystemPrompt('casual', nativeLanguage, 'en-US');
    assert.match(formal, /^Your role is to be an English guru, an expert in authentic American English,/, nativeLanguage);
    assert.match(formal, /short phrasal verbs/, nativeLanguage);
    assert.match(casual, /^NY Speak Easy serves as an English spoken adviser/, nativeLanguage);
    assert.match(casual, /New York twist/, nativeLanguage);
    for (const prompt of [formal, casual]) {
      assert.match(prompt, /\{"native":"…","target":"…","key":"…"\}/, nativeLanguage);
      assert.ok(prompt.includes(`a passage in ${LANGUAGES[nativeLanguage].name} that they want to say`), nativeLanguage);
    }
  }
});

test('phrasal verbs are only asked for when the target is English', () => {
  for (const targetLanguage of LANGUAGE_CODES.filter(code => code !== 'en-US')) {
    for (const register of ['formal', 'casual']) {
      const prompt = translationSystemPrompt(register, targetLanguage === 'zh-CN' ? 'en-US' : 'zh-CN', targetLanguage);
      assert.equal(prompt.includes('phrasal verb'), LANGUAGES[targetLanguage].name === 'English', `${register} ${targetLanguage}`);
      assert.doesNotMatch(prompt, /New York/, `${register} ${targetLanguage}`);
    }
  }
});

test('a formal reply parses into one version with key expressions located in the sentence', () => {
  assert.deepEqual(parseTranslation(formalReply, 'formal', ORIGINAL_KEYS), { versions: [{ id: 'sentences', sentences: [
    { native: '这事挺难，但我做成了。', target: "I can't believe I pulled it off.", keyExpression: 'pulled it off' },
    { native: '下周我再跟进。', target: "I'll follow up next week.", keyExpression: 'follow up' },
  ] }] });
});

test('a casual reply parses into a brief and an elaborate version', () => {
  const { versions } = parseTranslation(casualReply, 'casual', ORIGINAL_KEYS);
  assert.deepEqual(versions.map(version => [version.id, version.sentences.length]), [['brief', 1], ['elaborate', 2]]);
});

test('a reply for another pair is read by its "native" and "target" keys into the same shape', () => {
  assert.deepEqual(parseTranslation(japaneseReply, 'formal', GENERAL_KEYS), { versions: [{ id: 'sentences', sentences: [
    { native: 'It was hard, but I pulled it off.', target: '大変でしたが、やり遂げました。', keyExpression: 'やり遂げました' },
    { native: "I'll follow up next week.", target: '来週また確認します。', keyExpression: '' },
  ] }] });
});

test('a reply is only read with the keys of its own pair', () => {
  assert.throws(() => parseTranslation(japaneseReply, 'formal', ORIGINAL_KEYS), /不是预期的格式/);
  assert.throws(() => parseTranslation(formalReply, 'formal', GENERAL_KEYS), /不是预期的格式/);
});

test('code fences, surrounding prose and stray whitespace are tolerated', () => {
  const wrapped = `Here you go:\n\`\`\`json\n{"sentences":[{"zh":" 你好 ","en":"Hi\\n there.","key":"nope"}]}\n\`\`\`\nHope it helps!`;
  assert.deepEqual(parseTranslation(wrapped, 'formal', ORIGINAL_KEYS).versions[0].sentences, [{ native: '你好', target: 'Hi there.', keyExpression: '' }]);
});

test('unusable replies are refused with one message', () => {
  const cases = [
    ['', 'formal'], ['Sorry, I cannot.', 'formal'], ['{"sentences":[]}', 'formal'], ['{"sentences":[{"zh":"你好"}]}', 'formal'],
    ['{"sentences":"x"}', 'formal'], ['{broken', 'formal'], [formalReply, 'casual'], ['{"brief":[{"zh":"a","en":"b"}]}', 'casual'],
    [JSON.stringify({ sentences: Array.from({ length: 61 }, () => ({ zh: '好', en: 'ok' })) }), 'formal'],
  ];
  for (const [reply, register] of cases) assert.throws(() => parseTranslation(reply, register, ORIGINAL_KEYS), /不是预期的格式/, reply.slice(0, 30));
  assert.throws(() => parseTranslation(formalReply, 'poetic', ORIGINAL_KEYS), /场景/);
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

test('translatePassage asks the cheap slot model and returns the parsed versions with the pair they are for', async () => {
  const inference = fakeInference();
  const signal = new AbortController().signal;
  const result = await translatePassage({ inference, settings: defaultSettings(), register: 'formal', text: '  这事挺难，但我做成了。下周我再跟进。 ', signal });
  assert.deepEqual(Object.keys(result).sort(), ['nativeLanguage', 'targetLanguage', 'versions']);
  assert.deepEqual([result.nativeLanguage, result.targetLanguage], ['zh-CN', 'en-US']);
  assert.equal(result.versions[0].sentences.length, 2);
  assert.deepEqual(Object.keys(result.versions[0].sentences[0]), ['native', 'target', 'keyExpression']);
  const [request] = inference.requests;
  assert.deepEqual(request.model, { ...CHEAP, thinkingLevel: 'low' });
  assert.equal(request.purpose, 'user');
  assert.equal(request.signal, signal);
  assert.equal(request.context.systemPrompt, translationSystemPrompt('formal', 'zh-CN', 'en-US'));
  assert.equal(request.context.messages[0].content, 'Chinese passage:\n\n这事挺难，但我做成了。下周我再跟进。');
});

test('translatePassage follows the language pair in the settings', async () => {
  const inference = fakeInference({ reply: japaneseReply });
  const settings = { ...defaultSettings(), nativeLanguage: 'en-US', targetLanguage: 'ja-JP' };
  const result = await translatePassage({ inference, settings, register: 'formal', text: "It was hard, but I pulled it off. I'll follow up next week." });
  assert.deepEqual([result.nativeLanguage, result.targetLanguage], ['en-US', 'ja-JP']);
  assert.deepEqual(result.versions[0].sentences.map(sentence => [sentence.target, sentence.keyExpression]), [['大変でしたが、やり遂げました。', 'やり遂げました'], ['来週また確認します。', '']]);
  const [request] = inference.requests;
  assert.equal(request.context.systemPrompt, translationSystemPrompt('formal', 'en-US', 'ja-JP'));
  assert.equal(request.context.messages[0].content, "English passage:\n\nIt was hard, but I pulled it off. I'll follow up next week.");
});

test('translatePassage does not read a reply in the original keys for another pair', async () => {
  const inference = fakeInference({ reply: formalReply });
  const settings = { ...defaultSettings(), targetLanguage: 'en-GB' };
  await assert.rejects(translatePassage({ inference, settings, register: 'formal', text: '你好' }), /不是预期的格式/);
});

test('the plugin\'s own model override wins over the cheap slot', async () => {
  const inference = fakeInference({ reply: casualReply });
  await translatePassage({ inference, settings: { ...defaultSettings(), modelOverride: OTHER }, register: 'casual', text: '我搞定了' });
  assert.deepEqual(inference.requests[0].model, OTHER);
});

test('translatePassage explains what is wrong before or after calling the model', async () => {
  const settings = defaultSettings();
  const cases = [
    [{ inference: fakeInference(), text: '   ' }, /请先写下/, 0],
    [{ inference: fakeInference(), text: undefined }, /请先写下/, 0],
    [{ inference: fakeInference(), text: '长'.repeat(2001) }, /超过 2000 字/, 0],
    [{ inference: fakeInference(), text: '你好', register: 'poetic' }, /场景/, 0],
    [{ inference: fakeInference(), text: '你好', settings: { ...settings, targetLanguage: 'xx-XX' } }, /不支持这种语言/, 0],
    [{ inference: fakeInference(), text: '你好', settings: { ...settings, nativeLanguage: undefined } }, /不支持这种语言/, 0],
    [{ inference: fakeInference(), text: '你好', settings: { ...settings, targetLanguage: 'zh-CN' } }, /母语和学习语言不能相同/, 0],
    [{ inference: fakeInference({ cheap: null }), text: '你好' }, /还没有可用的模型/, 0],
    [{ inference: fakeInference(), text: '你好', settings: { ...settings, modelOverride: { provider: 'gone', id: 'x' } } }, /现在不可用/, 0],
    [{ inference: fakeInference({ stopReason: 'error', errorMessage: 'overloaded' }), text: '你好' }, /翻译没有完成：overloaded/, 1],
    [{ inference: fakeInference({ reply: 'no json here' }), text: '你好' }, /不是预期的格式/, 1],
  ];
  for (const [overrides, expected, calls] of cases) {
    await assert.rejects(translatePassage({ settings, register: 'formal', ...overrides }), expected);
    assert.equal(overrides.inference.requests.length, calls, String(expected));
  }
});
