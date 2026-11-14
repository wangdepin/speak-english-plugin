'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../src/backend/store.cjs');
const { openSecrets } = require('../src/backend/secrets.cjs');
const { openAudioFiles } = require('../src/backend/audio-files.cjs');
const { defaultSettings, applySettingsPatch, VOICES } = require('../src/backend/settings.cjs');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-english-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('a new store starts empty with the agreed defaults', t => {
  const state = openStore(temporaryDirectory(t)).get();
  assert.deepEqual({ ...state, settings: undefined }, { version: 2, revision: 0, settings: undefined, passages: {}, sentences: {}, attempts: [] });
  assert.deepEqual(state.settings, {
    language: 'zh', nativeLanguage: 'zh-CN', targetLanguage: 'en-US', languagesConfirmed: false,
    modelOverride: null, ttsModel: 'eleven_v4', ttsVoiceId: VOICES.jessica, questionVoiceId: VOICES.eric, azureRegion: '',
    retention: 0.95, dailyReviewLimit: 50, readingSpeed: 5, startAllowanceSeconds: 3, speakingTimeFactor: 2, explainAfterFailures: 3,
  });
});

test('changes are written to disk and survive reopening', t => {
  const directory = temporaryDirectory(t);
  const store = openStore(directory);
  assert.equal(store.change(state => { state.passages.p1 = { id: 'p1' }; return 'done'; }), 'done');
  assert.equal(store.get().revision, 1);
  const reopened = openStore(directory).get();
  assert.deepEqual(reopened.passages, { p1: { id: 'p1' } });
  assert.equal(reopened.revision, 1);
  assert.deepEqual(fs.readdirSync(directory), ['store.json']);
  assert.equal(fs.statSync(path.join(directory, 'store.json')).mode & 0o777, 0o600);
});

test('a failing change leaves memory and disk untouched', t => {
  const directory = temporaryDirectory(t);
  const store = openStore(directory);
  store.change(state => { state.passages.kept = {}; });
  assert.throws(() => store.change(state => { state.passages.lost = {}; throw new Error('stop'); }), /stop/);
  assert.deepEqual(Object.keys(store.get().passages), ['kept']);
  assert.deepEqual(Object.keys(openStore(directory).get().passages), ['kept']);
});

test('a setting added later gets its default when an older file is opened', t => {
  const directory = temporaryDirectory(t);
  fs.writeFileSync(path.join(directory, 'store.json'), JSON.stringify({ version: 2, revision: 4, settings: { dailyReviewLimit: 30 }, passages: {}, sentences: {}, attempts: [] }));
  assert.deepEqual(openStore(directory).get().settings, { ...defaultSettings(), dailyReviewLimit: 30 });
});

test('a damaged or unknown store file is refused and left as it is', t => {
  const shaped = overrides => JSON.stringify({ version: 2, revision: 0, settings: {}, passages: {}, sentences: {}, attempts: [], ...overrides });
  const contents = [
    'not json', '{"version":2}', '{"version":1}', '[]',
    shaped({ passages: [] }), shaped({ version: 1, passages: [] }), shaped({ version: 1, sentences: null }), shaped({ version: 1, settings: 'x' }),
    shaped({ version: 99 }), shaped({ version: 3 }), shaped({ version: 0 }), shaped({ version: '2' }),
  ];
  for (const content of contents) {
    const directory = temporaryDirectory(t);
    fs.writeFileSync(path.join(directory, 'store.json'), content);
    assert.throws(() => openStore(directory), /损坏或版本不支持/, content);
    assert.equal(fs.readFileSync(path.join(directory, 'store.json'), 'utf8'), content);
    assert.deepEqual(fs.readdirSync(directory), ['store.json'], content);
  }
});

// ---- upgrading a version 1 store ----

const VERSION_1 = {
  version: 1,
  revision: 7,
  settings: { language: 'en', dailyReviewLimit: 30, readingCharsPerSecond: 7 },
  passages: {
    p1: {
      id: 'p1', createdAt: 1000, register: 'formal', version: 'sentences', chinese: '这事挺难，但我做成了。我昨天想把整件事告诉他，但一直没机会。', sentenceIds: ['s1', 's2'],
      questions: [{ id: 'q1', en: 'How did it go?', zh: '怎么样了？', audio: { seconds: 1.28, modelId: 'eleven_v4', voiceId: VOICES.eric, createdAt: 2000 } }],
      firstReading: { seconds: 42.5, mime: 'audio/webm', recordedAt: 3000 }, latestReading: null,
    },
    p2: { id: 'p2', createdAt: 500, register: 'casual', version: 'brief', chinese: '我搞定了。', sentenceIds: [] },
  },
  sentences: {
    s1: { id: 's1', passageId: 'p1', zh: '这事挺难，但我做成了。', en: "I can't believe I pulled it off.", keyExpression: 'pulled it off', audio: null, schedule: null, explanation: null, explainCheckedAt: null },
    s2: {
      id: 's2', passageId: 'p1', zh: '我昨天想把整件事告诉他，但一直没机会。', en: 'I wanted to tell him about the whole thing yesterday, but I never got the chance to do it.', keyExpression: 'got the chance',
      audio: { seconds: 3.2, modelId: 'eleven_v4', voiceId: VOICES.jessica, createdAt: 2000 }, schedule: { state: 2, due: 5000, dueDay: '2026-11-15' },
      explanation: {
        difficulty: ['句子太长。'], simpler: { en: 'I wanted to tell him yesterday, but I had no chance.', why: '更短。' },
        split: [{ zh: '我昨天想把整件事告诉他。', en: 'I wanted to tell him about the whole thing yesterday.' }, { zh: '但我一直没机会。', en: 'But I never got the chance.' }], at: 4000,
      },
      explainCheckedAt: 4000,
    },
  },
  attempts: [{ id: 'a1', sentenceId: 's2', kind: 'recall', at: 3500, said: false, timedOut: false, responseMs: 900, speakMs: null, scores: null, problems: [] }],
};

const UPGRADED = {
  version: 2,
  revision: 7,
  settings: { ...defaultSettings(), language: 'en', dailyReviewLimit: 30, readingSpeed: 7 },
  passages: {
    p1: {
      id: 'p1', createdAt: 1000, register: 'formal', version: 'sentences', source: '这事挺难，但我做成了。我昨天想把整件事告诉他，但一直没机会。', sentenceIds: ['s1', 's2'],
      questions: [{ id: 'q1', target: 'How did it go?', native: '怎么样了？', audio: { seconds: 1.28, modelId: 'eleven_v4', voiceId: VOICES.eric, createdAt: 2000 } }],
      firstReading: { seconds: 42.5, mime: 'audio/webm', recordedAt: 3000 }, latestReading: null, nativeLanguage: 'zh-CN', targetLanguage: 'en-US',
    },
    p2: { id: 'p2', createdAt: 500, register: 'casual', version: 'brief', source: '我搞定了。', sentenceIds: [], nativeLanguage: 'zh-CN', targetLanguage: 'en-US' },
  },
  sentences: {
    s1: { id: 's1', passageId: 'p1', native: '这事挺难，但我做成了。', target: "I can't believe I pulled it off.", keyExpression: 'pulled it off', audio: null, schedule: null, explanation: null, explainCheckedAt: null },
    s2: {
      id: 's2', passageId: 'p1', native: '我昨天想把整件事告诉他，但一直没机会。', target: 'I wanted to tell him about the whole thing yesterday, but I never got the chance to do it.', keyExpression: 'got the chance',
      audio: { seconds: 3.2, modelId: 'eleven_v4', voiceId: VOICES.jessica, createdAt: 2000 }, schedule: { state: 2, due: 5000, dueDay: '2026-11-15' },
      explanation: {
        difficulty: ['句子太长。'], simpler: { target: 'I wanted to tell him yesterday, but I had no chance.', why: '更短。' },
        split: [{ native: '我昨天想把整件事告诉他。', target: 'I wanted to tell him about the whole thing yesterday.' }, { native: '但我一直没机会。', target: 'But I never got the chance.' }], at: 4000,
      },
      explainCheckedAt: 4000,
    },
  },
  attempts: VERSION_1.attempts,
};

/** A data directory holding `state` as its store.json; returns the directory, the file's text and the two paths. */
function directoryWithStore(t, state) {
  const directory = temporaryDirectory(t);
  const text = JSON.stringify(state);
  const file = path.join(directory, 'store.json');
  fs.writeFileSync(file, text);
  return { directory, text, file, backup: path.join(directory, 'store.v1.json') };
}

/** Every key used anywhere inside `value`. */
function keysWithin(value) {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => (Array.isArray(value) ? keysWithin(inner) : [key, ...keysWithin(inner)]));
}

test('a version 1 store is upgraded on load: fields are named after their role and passages get the original pair', t => {
  const { directory } = directoryWithStore(t, VERSION_1);
  const state = openStore(directory).get();
  assert.deepEqual(state, UPGRADED);
  const stale = keysWithin(state).filter(key => ['zh', 'en', 'chinese', 'readingCharsPerSecond'].includes(key));
  assert.deepEqual(stale, []);
});

test('upgrading keeps the reading speed the learner had set, and leaves the languages unconfirmed', t => {
  const { settings } = openStore(directoryWithStore(t, VERSION_1).directory).get();
  assert.deepEqual([settings.readingSpeed, settings.nativeLanguage, settings.targetLanguage, settings.languagesConfirmed], [7, 'zh-CN', 'en-US', false]);
  const untouched = openStore(directoryWithStore(t, { ...VERSION_1, settings: {} }).directory).get().settings;
  assert.deepEqual(untouched, defaultSettings());
});

test('the version 1 file is copied to store.v1.json, and store.json is only rewritten by the next change', t => {
  const { directory, text, file, backup } = directoryWithStore(t, VERSION_1);
  const store = openStore(directory);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['store.json', 'store.v1.json']);
  assert.equal(fs.readFileSync(backup, 'utf8'), text);
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'opening alone does not rewrite the store');

  store.change(state => { state.settings.dailyReviewLimit = 40; });
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(written, { ...UPGRADED, revision: 8, settings: { ...UPGRADED.settings, dailyReviewLimit: 40 } });
  assert.equal(fs.readFileSync(backup, 'utf8'), text, 'the copy keeps the version 1 text');
  assert.deepEqual(openStore(directory).get(), written, 'the upgraded store opens as version 2');
});

test('store.v1.json is written once and never overwritten by a later open', t => {
  const { directory, text, file, backup } = directoryWithStore(t, VERSION_1);
  openStore(directory);
  openStore(directory);
  assert.equal(fs.readFileSync(backup, 'utf8'), text);

  const later = JSON.stringify({ ...VERSION_1, revision: 8, passages: {}, sentences: {}, attempts: [] });
  fs.writeFileSync(file, later);
  const reopened = openStore(directory).get();
  assert.deepEqual([reopened.version, reopened.revision], [2, 8]);
  assert.equal(fs.readFileSync(backup, 'utf8'), text, 'the first copy stays');
});

test('a store of a version this release does not know is refused, not upgraded', t => {
  for (const version of [99, 3, 0]) {
    const { directory, text, file } = directoryWithStore(t, { ...VERSION_1, version });
    assert.throws(() => openStore(directory), /损坏或版本不支持/, `version ${version}`);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    assert.deepEqual(fs.readdirSync(directory), ['store.json'], `version ${version}`);
  }
});

test('settings patches are validated field by field', () => {
  const current = defaultSettings();
  assert.deepEqual(applySettingsPatch(current, { dailyReviewLimit: 20, azureRegion: 'swedencentral' }), { ...current, dailyReviewLimit: 20, azureRegion: 'swedencentral' });
  assert.deepEqual(applySettingsPatch(current, { modelOverride: { provider: 'p', id: 'm', extra: 1 } }).modelOverride, { provider: 'p', id: 'm' });
  assert.deepEqual(current, defaultSettings(), 'the input is not mutated');
  const refused = [
    [{ retention: 1 }, /保持率/], [{ retention: '0.9' }, /保持率/], [{ dailyReviewLimit: 0 }, /上限/], [{ dailyReviewLimit: 2.5 }, /上限/],
    [{ ttsModel: 'eleven_v9' }, /语音模型/], [{ ttsVoiceId: '../x' }, /声音 ID/], [{ azureRegion: 'Sweden Central' }, /区域/],
    [{ azureRegion: 'evil.example.com' }, /区域/], [{ speakingTimeFactor: 0.5 }, /说话时限/],
    [{ readingSpeed: 0 }, /读题速度应在 1 到 20 之间/], [{ readingSpeed: 20.5 }, /读题速度/], [{ readingSpeed: '5' }, /读题速度/],
    [{ readingCharsPerSecond: 5 }, /不支持的设置项：readingCharsPerSecond/], [{ languagesConfirmed: 'yes' }, /格式/],
    [{ startAllowanceSeconds: -1 }, /思考时间/], [{ explainAfterFailures: 0 }, /讲解/], [{ modelOverride: { provider: 'p' } }, /翻译模型/],
    [{ dayStart: 3 }, /不支持的设置项/], [null, /格式/], [[], /格式/],
  ];
  for (const [patch, expected] of refused) assert.throws(() => applySettingsPatch(current, patch), expected, JSON.stringify(patch));
});

// ---- the two practice languages ----

const languagesOf = settings => [settings.nativeLanguage, settings.targetLanguage];

test('either practice language can be set to any supported language', () => {
  const current = defaultSettings();
  assert.deepEqual(languagesOf(applySettingsPatch(current, { targetLanguage: 'ja-JP' })), ['zh-CN', 'ja-JP']);
  assert.deepEqual(languagesOf(applySettingsPatch(current, { nativeLanguage: 'de-DE' })), ['de-DE', 'en-US']);
  assert.deepEqual(languagesOf(applySettingsPatch(current, { nativeLanguage: 'en-GB', targetLanguage: 'zh-HK' })), ['en-GB', 'zh-HK']);
  assert.deepEqual(languagesOf(applySettingsPatch(current, { nativeLanguage: 'en-US', targetLanguage: 'zh-CN' })), ['en-US', 'zh-CN'], 'both set, crosswise');
});

test('a language this plugin does not support is refused', () => {
  const current = defaultSettings();
  for (const code of ['xx-XX', 'ja', 'en-us', 'Japanese', 'toString', '', null, 5]) {
    for (const key of ['nativeLanguage', 'targetLanguage']) assert.throws(() => applySettingsPatch(current, { [key]: code }), /不支持这种语言/, `${key}: ${code}`);
  }
});

test('picking the language the other side has swaps the two', () => {
  const cases = [
    [['zh-CN', 'en-US'], { nativeLanguage: 'en-US' }, ['en-US', 'zh-CN']],
    [['zh-CN', 'en-US'], { targetLanguage: 'zh-CN' }, ['en-US', 'zh-CN']],
    [['en-US', 'ja-JP'], { nativeLanguage: 'ja-JP' }, ['ja-JP', 'en-US']],
    [['en-US', 'ja-JP'], { targetLanguage: 'en-US' }, ['ja-JP', 'en-US']],
  ];
  for (const [[nativeLanguage, targetLanguage], patch, expected] of cases) {
    const next = applySettingsPatch({ ...defaultSettings(), nativeLanguage, targetLanguage }, patch);
    assert.deepEqual(languagesOf(next), expected, `${nativeLanguage} → ${targetLanguage} with ${JSON.stringify(patch)}`);
    assert.equal(next.languagesConfirmed, true);
  }
});

test('setting both languages to one new language in the same patch is refused', () => {
  for (const code of ['ja-JP', 'de-DE']) {
    assert.throws(() => applySettingsPatch(defaultSettings(), { nativeLanguage: code, targetLanguage: code }), /母语和学习语言不能相同/, code);
  }
});

test('setting both languages to a language one side already has is refused too, not turned into a swap', () => {
  for (const code of ['zh-CN', 'en-US']) {
    assert.throws(() => applySettingsPatch(defaultSettings(), { nativeLanguage: code, targetLanguage: code }), /母语和学习语言不能相同/, code);
  }
});

test('a new native language resets the reading speed to that language\'s default', () => {
  const cases = [
    ['zh-CN → de-DE', {}, { nativeLanguage: 'de-DE' }, 3],
    ['zh-CN → en-GB', {}, { nativeLanguage: 'en-GB' }, 3],
    ['zh-CN → ja-JP, from a speed the learner chose', { readingSpeed: 7 }, { nativeLanguage: 'ja-JP' }, 5],
    ['zh-CN → ko-KR', { readingSpeed: 9 }, { nativeLanguage: 'ko-KR' }, 5],
    ['zh-CN → th-TH', { readingSpeed: 9 }, { nativeLanguage: 'th-TH' }, 5],
    ['de-DE → zh-TW', { nativeLanguage: 'de-DE', readingSpeed: 3 }, { nativeLanguage: 'zh-TW' }, 5],
    ['de-DE → zh-HK', { nativeLanguage: 'de-DE', readingSpeed: 3 }, { nativeLanguage: 'zh-HK' }, 5],
    ['a swap started from the native side', { readingSpeed: 7 }, { nativeLanguage: 'en-US' }, 3],
    ['a swap started from the target side', { readingSpeed: 7 }, { targetLanguage: 'zh-CN' }, 3],
  ];
  for (const [name, before, patch, expected] of cases) {
    assert.equal(applySettingsPatch({ ...defaultSettings(), ...before }, patch).readingSpeed, expected, name);
  }
});

test('the reading speed is kept when the patch sets it, or when the native language stays', () => {
  const cases = [
    ['speed set along with a new native language', {}, { nativeLanguage: 'de-DE', readingSpeed: 9 }, 9],
    ['speed set along with a swap', {}, { targetLanguage: 'zh-CN', readingSpeed: 4.5 }, 4.5],
    ['only the target changes', { readingSpeed: 7 }, { targetLanguage: 'ja-JP' }, 7],
    ['the native language is set to what it is', { readingSpeed: 7 }, { nativeLanguage: 'zh-CN' }, 7],
    ['an unrelated setting changes', { readingSpeed: 7 }, { dailyReviewLimit: 20 }, 7],
  ];
  for (const [name, before, patch, expected] of cases) {
    assert.equal(applySettingsPatch({ ...defaultSettings(), ...before }, patch).readingSpeed, expected, name);
  }
});

test('changing either language confirms the pair; nothing else does, short of saying so', () => {
  const cases = [
    ['a new target', { targetLanguage: 'ja-JP' }, true],
    ['a new native language', { nativeLanguage: 'de-DE' }, true],
    ['a swap', { nativeLanguage: 'en-US' }, true],
    ['a change that claims to be unconfirmed', { targetLanguage: 'ja-JP', languagesConfirmed: false }, true],
    ['the learner confirming the defaults', { languagesConfirmed: true }, true],
    ['the same languages again', { nativeLanguage: 'zh-CN', targetLanguage: 'en-US' }, false],
    ['an unrelated setting', { dailyReviewLimit: 20 }, false],
  ];
  for (const [name, patch, expected] of cases) {
    assert.equal(applySettingsPatch(defaultSettings(), patch).languagesConfirmed, expected, name);
  }
  const confirmed = applySettingsPatch(defaultSettings(), { targetLanguage: 'ja-JP' });
  assert.equal(applySettingsPatch(confirmed, { dailyReviewLimit: 20 }).languagesConfirmed, true, 'once confirmed, it stays');
});

test('secrets are stored owner-only and only their presence is reported', t => {
  const directory = temporaryDirectory(t);
  const secrets = openSecrets(directory);
  assert.deepEqual(secrets.status(), { azureKey: false, elevenLabsKey: false });
  assert.equal(secrets.get('azureKey'), '');
  secrets.set('azureKey', '  abc123\n');
  secrets.set('elevenLabsKey', 'sk_test');
  assert.deepEqual(secrets.status(), { azureKey: true, elevenLabsKey: true });
  assert.equal(openSecrets(directory).get('azureKey'), 'abc123');
  assert.equal(fs.statSync(path.join(directory, 'secrets.json')).mode & 0o777, 0o600);
  secrets.clear('azureKey');
  assert.deepEqual(secrets.status(), { azureKey: false, elevenLabsKey: true });
  assert.ok(!JSON.stringify(secrets.status()).includes('sk_test'));
});

test('secrets refuse unknown names and unusable values', t => {
  const secrets = openSecrets(temporaryDirectory(t));
  assert.throws(() => secrets.set('__proto__', 'x'), /不认识/);
  assert.throws(() => secrets.get('other'), /不认识/);
  for (const value of ['', '   ', 'two words', 'line\nbreak', 'x'.repeat(201), 42]) assert.throws(() => secrets.set('azureKey', value), /密钥/, String(value).slice(0, 12));
});

test('audio files are stored by sentence id and ids cannot escape the folder', t => {
  const directory = temporaryDirectory(t);
  const audio = openAudioFiles(directory);
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  audio.write(id, new Uint8Array([1, 2, 3]));
  assert.deepEqual(audio.read(id), new Uint8Array([1, 2, 3]));
  assert.deepEqual(fs.readdirSync(path.join(directory, 'audio')), [`${id}.mp3`]);
  audio.remove(id);
  audio.remove(id);
  assert.deepEqual(fs.readdirSync(path.join(directory, 'audio')), []);
  for (const bad of ['../secrets', 'a/b', '', undefined, `${id}/..`]) assert.throws(() => audio.write(bad, new Uint8Array(1)), /句子编号无效/);
});
