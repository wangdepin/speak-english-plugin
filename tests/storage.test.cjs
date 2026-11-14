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
  assert.deepEqual({ ...state, settings: undefined }, { version: 1, revision: 0, settings: undefined, passages: {}, sentences: {}, attempts: [] });
  assert.deepEqual(state.settings, {
    language: 'zh', modelOverride: null, ttsModel: 'eleven_v4', ttsVoiceId: VOICES.jessica, questionVoiceId: VOICES.eric, azureRegion: '',
    retention: 0.95, dailyReviewLimit: 50, readingCharsPerSecond: 5, startAllowanceSeconds: 3, speakingTimeFactor: 2, explainAfterFailures: 3,
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
  fs.writeFileSync(path.join(directory, 'store.json'), JSON.stringify({ version: 1, revision: 4, settings: { dailyReviewLimit: 30 }, passages: {}, sentences: {}, attempts: [] }));
  assert.deepEqual(openStore(directory).get().settings, { ...defaultSettings(), dailyReviewLimit: 30 });
});

test('a damaged or unknown store file is refused and left as it is', t => {
  for (const content of ['not json', '{"version":2}', '[]', JSON.stringify({ version: 1, revision: 0, settings: {}, passages: [], sentences: {}, attempts: [] })]) {
    const directory = temporaryDirectory(t);
    fs.writeFileSync(path.join(directory, 'store.json'), content);
    assert.throws(() => openStore(directory), /损坏或版本不支持/);
    assert.equal(fs.readFileSync(path.join(directory, 'store.json'), 'utf8'), content);
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
    [{ azureRegion: 'evil.example.com' }, /区域/], [{ speakingTimeFactor: 0.5 }, /说话时限/], [{ readingCharsPerSecond: 0 }, /字数/],
    [{ startAllowanceSeconds: -1 }, /思考时间/], [{ explainAfterFailures: 0 }, /讲解/], [{ modelOverride: { provider: 'p' } }, /翻译模型/],
    [{ dayStart: 3 }, /不支持的设置项/], [null, /格式/], [[], /格式/],
  ];
  for (const [patch, expected] of refused) assert.throws(() => applySettingsPatch(current, patch), expected, JSON.stringify(patch));
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
