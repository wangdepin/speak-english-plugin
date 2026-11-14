'use strict';

const { randomUUID } = require('node:crypto');
const { openStore } = require('./store.cjs');
const { openSecrets } = require('./secrets.cjs');
const { openAudioFiles } = require('./audio-files.cjs');
const { applySettingsPatch } = require('./settings.cjs');
const { translatePassage } = require('./translate.cjs');
const { checkConfirmedPassage, addPassage, removePassage, attachAudio, addReading, clientView } = require('./passages.cjs');
const { requireSentence, requirePassage } = require('./records.cjs');
const { recordScores, judgeRecall } = require('./attempts.cjs');
const { judgeReview } = require('./review.cjs');
const { requestExplanation, storeExplanation, recordSpeedGap, adoptExplanation } = require('./explain.cjs');
const { synthesizeSpeech } = require('./speech/tts.cjs');
const { assessPronunciation } = require('./speech/assess.cjs');
const { userFacingError } = require('./speech-messages.cjs');
const { suggestQuestions, requireQuestion, addQuestions, removeQuestion, attachQuestionAudio } = require('./questions.cjs');
const { recordListen, recordResponse } = require('./exercises.cjs');
const { t, setLanguage } = require('./messages.cjs');

// 30 seconds of 16 kHz mono 16-bit WAV is about 1.28 million base64 characters.
const WAV_BASE64_MAX_CHARS = 1_400_000;
// A whole-passage reading is kept as the browser recorded it (compressed), a few megabytes at most.
const READING_BASE64_MAX_CHARS = 8_000_000;
const READING_MAX_SECONDS = 600;
const READING_MIME = /^audio\/(webm|ogg|mp4|wav)(;[\x20-\x7e]{0,60})?$/;

function decodeWav(wavBase64) {
  if (typeof wavBase64 !== 'string' || wavBase64 === '' || wavBase64.length > WAV_BASE64_MAX_CHARS) throw new Error(t('录音为空或太长。'));
  return new Uint8Array(Buffer.from(wavBase64, 'base64'));
}

/**
 * Wires the plugin's operations onto the host context. `services.fetchImpl`
 * replaces the network in tests.
 */
function createBackend(ctx, services = {}) {
  const store = openStore(ctx.dataDirectory);
  const secrets = openSecrets(ctx.dataDirectory);
  const audioFiles = openAudioFiles(ctx.dataDirectory);
  const { fetchImpl } = services;
  const view = () => clientView(store.get(), secrets.status(), Date.now());

  async function synthesizeSentence({ sentenceId, force }) {
    const { settings } = store.get();
    const sentence = requireSentence(store.get(), sentenceId);
    if (sentence.audio && !force) return view();
    const audio = await synthesizeSpeech({ text: sentence.en, voiceId: settings.ttsVoiceId, modelId: settings.ttsModel, key: secrets.get('elevenLabsKey'), fetchImpl, signal: ctx.signal });
    audioFiles.write(sentenceId, audio.bytes);
    store.change(state => attachAudio(state, sentenceId, { seconds: audio.seconds, modelId: settings.ttsModel, voiceId: settings.ttsVoiceId, now: Date.now() }));
    return view();
  }

  function sentenceAudio({ sentenceId }) {
    const sentence = requireSentence(store.get(), sentenceId);
    if (!sentence.audio) throw new Error(t('这一句还没有合成语音。'));
    return { base64: Buffer.from(audioFiles.read(sentenceId)).toString('base64'), mime: 'audio/mpeg', seconds: sentence.audio.seconds };
  }

  function deletePassage({ passageId }) {
    const idsWithAudio = store.change(state => removePassage(state, passageId));
    for (const id of idsWithAudio) audioFiles.remove(id);
    audioFiles.removeReadings(passageId);
    return view();
  }

  /** Synthesizes a question in the asker's voice. Its audio is stored like a sentence's, under the question's id. */
  async function synthesizeQuestion({ passageId, questionId, force }) {
    const { settings } = store.get();
    const question = requireQuestion(store.get(), passageId, questionId);
    if (question.audio && !force) return view();
    const audio = await synthesizeSpeech({ text: question.en, voiceId: settings.questionVoiceId, modelId: settings.ttsModel, key: secrets.get('elevenLabsKey'), fetchImpl, signal: ctx.signal });
    audioFiles.write(questionId, audio.bytes);
    store.change(state => attachQuestionAudio(state, passageId, questionId, { seconds: audio.seconds, modelId: settings.ttsModel, voiceId: settings.questionVoiceId, now: Date.now() }));
    return view();
  }

  function questionAudio({ passageId, questionId }) {
    const question = requireQuestion(store.get(), passageId, questionId);
    if (!question.audio) throw new Error(t('这个问句还没有合成语音。'));
    return { base64: Buffer.from(audioFiles.read(questionId)).toString('base64'), mime: 'audio/mpeg', seconds: question.audio.seconds };
  }

  function deleteQuestion({ passageId, questionId }) {
    store.change(state => removeQuestion(state, passageId, questionId));
    audioFiles.remove(questionId);
    return view();
  }

  function assess({ wavBase64, referenceText }) {
    const region = store.get().settings.azureRegion;
    if (region === '') throw new Error(t('还没有填 Azure 区域，请到插件设置里填写。'));
    return assessPronunciation({ wav: decodeWav(wavBase64), referenceText, key: secrets.get('azureKey'), region, fetchImpl, signal: ctx.signal });
  }

  /** Scores a recording of one sentence and keeps the result in the practice log. */
  async function scoreAttempt({ attemptId, sentenceId, kind, wavBase64 }) {
    const sentence = requireSentence(store.get(), sentenceId);
    const assessment = await assess({ wavBase64, referenceText: sentence.en });
    store.change(state => recordScores(state, { attemptId, sentenceId, kind, assessment, now: Date.now() }));
    return { assessment, state: view() };
  }

  /** Asks the model to explain a sentence the learner cannot say, and keeps the answer with the sentence. */
  async function explainSentence({ sentenceId }) {
    const explanation = await requestExplanation({ inference: ctx.inference, state: store.get(), sentenceId, signal: ctx.signal });
    store.change(state => storeExplanation(state, sentenceId, explanation, Date.now()));
    return { explanation, state: view() };
  }

  /** Swaps a sentence for the wording its explanation proposed. The new sentences still need audio. */
  function adoptSentence({ sentenceId, choice }) {
    const { removedSentenceId, sentenceIds } = store.change(state => adoptExplanation(state, sentenceId, choice, { newId: randomUUID }));
    audioFiles.remove(removedSentenceId);
    return { sentenceIds, state: view() };
  }

  function saveReading({ passageId, base64, mime, seconds }) {
    requirePassage(store.get(), passageId);
    if (typeof base64 !== 'string' || base64 === '' || base64.length > READING_BASE64_MAX_CHARS) throw new Error(t('录音为空或太长。'));
    if (typeof mime !== 'string' || !READING_MIME.test(mime)) throw new Error(t('不支持这种录音格式。'));
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > READING_MAX_SECONDS) throw new Error(t('录音时长不对。'));
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    // Write the file under the slot the store will pick, then record it: a crash in between leaves no dangling record.
    const slot = store.get().passages[passageId].firstReading ? 'latest' : 'first';
    audioFiles.writeReading(passageId, slot, bytes);
    store.change(state => addReading(state, passageId, { seconds, mime, now: Date.now() }));
    return view();
  }

  function readingAudio({ passageId, slot }) {
    const reading = requirePassage(store.get(), passageId)[slot === 'first' ? 'firstReading' : slot === 'latest' ? 'latestReading' : ''];
    if (!reading) throw new Error(t('还没有这段录音。'));
    return { base64: Buffer.from(audioFiles.readReading(passageId, slot)).toString('base64'), mime: reading.mime, seconds: reading.seconds };
  }

  const operations = {
    'get-state': view,
    'get-catalog': () => ctx.inference.catalog(),
    'save-settings': patch => { store.change(state => { state.settings = applySettingsPatch(state.settings, patch); }); return view(); },
    'set-secret': ({ name, value }) => { secrets.set(name, value); return view(); },
    'clear-secret': ({ name }) => { secrets.clear(name); return view(); },
    translate: ({ register, chinese }) => translatePassage({ inference: ctx.inference, settings: store.get().settings, register, chinese, signal: ctx.signal }),
    'create-passage': input => {
      const confirmed = checkConfirmedPassage(input);
      const passageId = store.change(state => addPassage(state, confirmed, { now: Date.now(), newId: randomUUID }));
      return { passageId, state: view() };
    },
    'synthesize-sentence': synthesizeSentence,
    'sentence-audio': sentenceAudio,
    'delete-passage': deletePassage,
    assess,
    'score-attempt': scoreAttempt,
    'judge-recall': input => { store.change(state => judgeRecall(state, { ...input, now: Date.now() })); return view(); },
    'judge-review': input => { store.change(state => judgeReview(state, { ...input, now: Date.now() })); return view(); },
    'explain-sentence': explainSentence,
    'record-speed-gap': ({ sentenceId }) => { store.change(state => recordSpeedGap(state, sentenceId, Date.now())); return view(); },
    'adopt-explanation': adoptSentence,
    'suggest-questions': async ({ passageId }) => ({ questions: await suggestQuestions({ inference: ctx.inference, state: store.get(), passageId, signal: ctx.signal }) }),
    'add-questions': ({ passageId, questions }) => {
      const questionIds = store.change(state => addQuestions(state, passageId, questions, { newId: randomUUID }));
      return { questionIds, state: view() };
    },
    'delete-question': deleteQuestion,
    'synthesize-question': synthesizeQuestion,
    'question-audio': questionAudio,
    'record-listen': input => { store.change(state => recordListen(state, { ...input, now: Date.now() })); return view(); },
    'record-response': input => { store.change(state => recordResponse(state, { ...input, now: Date.now() })); return view(); },
    'save-reading': saveReading,
    'reading-audio': readingAudio,
  };

  for (const [name, run] of Object.entries(operations)) {
    ctx.handle(name, async (input = {}) => {
      // Messages follow the interface language, which a call may just have changed.
      setLanguage(store.get().settings.language);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(t('操作的输入格式不对。'));
      try { return await run(input); } catch (error) { throw userFacingError(error); }
    });
  }
}

exports.activate = ctx => createBackend(ctx);
exports.createBackend = createBackend;
