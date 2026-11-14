import { el, errorLine } from './dom.js';
import { blobToWav } from './recorder.js';
import { createSentencePlayer, playOrStop, playSentences } from './sentence-player.js';
import { createTakeRecorder, takeLimitMs } from './take-recorder.js';
import { isWord, markedPhrases, plainTokens, scoredGaps, scoredTokens, showsSentence } from './diagnose-words.js';
import { toBase64 } from './wav.js';
import { LANGUAGES } from './languages.js';
import { t } from './i18n.js';

// Before the first sentence, the whole passage is heard once.
const WHOLE = -1;

/**
 * The listening diagnostic, taken before a passage is taught: the whole passage once without text,
 * then each sentence heard without text and repeated aloud. The repetition is scored against the
 * sentence, the text is shown, and the learner marks what they do not understand.
 * The result is kept with the passage for the lesson with the teacher.
 */
export function diagnoseScreen(app, root, signal, { passageId }) {
  const passage = app.state.passages.find(item => item.id === passageId);
  if (!passage) { app.go({ name: 'home' }); return; }
  const header = el('div', 'se-header');
  app.ui.button(header, t('← 返回段落'), () => app.go({ name: 'passage', passageId }), signal, { variant: 'ghost' });
  const position = el('span', 'se-muted', t('摸底'));
  header.append(position);
  root.append(header);
  if (passage.sentences.some(sentence => !sentence.audio)) {
    root.append(el('p', 'se-muted', t('这一段还有句子没有语音，先回段落页合成。')));
    return;
  }

  const sentences = passage.sentences;
  const player = createSentencePlayer(app.call, signal);
  let index = WHOLE;
  // The current sentence as words, once its text is shown; null while it is only heard.
  let tokens = null;
  let marked = new Set();
  let retold = false;
  let turn = 0;

  const card = el('div', 'se-card');
  const instruction = el('p', '', t('先不看文本，用正常速度把整段听一遍，了解自己能听懂多少。然后逐句摸底。'));
  const listen = el('div', 'se-actions');
  const status = el('p', 'se-status');
  // The sentence as written, shown only when the marked words below are not exactly it.
  const written = el('p', 'se-target');
  const text = el('p', 'se-marked');
  const meaning = el('p', 'se-native');
  card.append(instruction, listen, status, written, text, meaning);
  root.append(card);
  const error = errorLine(root);
  const after = el('div', 'se-actions');
  root.append(after);

  // Not while a repetition is being recorded: the microphone would hear the answer.
  const play = () => (recorder.isRecording() ? undefined : (index === WHOLE ? playSentences(player, sentences) : player.play(sentences[index].id)).catch(error.show));
  const playButton = app.ui.button(listen, t('▶ 听整段'), play, signal);
  app.keys.bind('reference', { run: playOrStop(player, play), label: t('原声') }, signal);
  const recordButton = app.ui.button(listen, t('● 开始复述'), () => toggle(), signal, { variant: 'default', disabled: true });
  const giveUpButton = app.ui.button(listen, t('说不出来，看原文'), () => reveal(null), signal, { variant: 'ghost', disabled: true });
  const nextButton = app.ui.button(after, t('开始逐句摸底 →'), () => next(), signal, { key: 'next' });
  app.keys.bind('record', { run: () => void toggle(), label: t('复述'), enabled: () => index !== WHOLE && tokens === null }, signal);

  /** One word of the shown sentence. A click marks it as not understood, a second click takes the mark back. */
  function wordSpan(token, at) {
    const span = el('span', token.status ? `se-word se-word-${token.status}` : 'se-word', token.text);
    if (!isWord(token)) return span;
    span.classList.add('se-tap');
    span.setAttribute('role', 'button');
    span.setAttribute('aria-pressed', 'false');
    span.addEventListener('click', () => {
      if (marked.has(at)) marked.delete(at); else marked.add(at);
      span.classList.toggle('se-word-unknown', marked.has(at));
      span.setAttribute('aria-pressed', String(marked.has(at)));
    });
    return span;
  }

  /** Shows the sentence's text for marking. `assessment` is null when the learner could not repeat the sentence. */
  function reveal(assessment) {
    const sentence = sentences[index];
    recorder.cancel();
    turn += 1;
    retold = assessment !== null;
    tokens = retold ? scoredTokens(sentence.target, assessment) : plainTokens(sentence.target, passage.targetLanguage);
    marked = new Set();
    const gap = LANGUAGES[passage.targetLanguage].spaced ? ' ' : '';
    text.replaceChildren(...tokens.flatMap((token, at) => [wordSpan(token, at), gap]));
    written.textContent = showsSentence(tokens, sentence.target, passage.targetLanguage) ? '' : sentence.target;
    meaning.textContent = sentence.native;
    const { notSaid, unclear } = scoredGaps(tokens);
    status.textContent = retold ? t('没说出来 {missed} 个词，说得不清楚 {unclear} 个词。', { missed: notSaid.length, unclear: unclear.length }) : '';
    instruction.textContent = t('点一下不认识的词或短语，再点一次取消。');
    recordButton.update({ disabled: true, label: t('● 开始复述') });
    giveUpButton.update({ disabled: true });
    nextButton.update({ disabled: false });
  }

  async function score({ blob }) {
    const mine = turn;
    const sentenceId = sentences[index].id;
    status.textContent = t('正在评分…');
    try {
      const { wav } = await blobToWav(blob);
      if (signal.aborted || mine !== turn) return;
      const { assessment } = await app.call('score-retell', { sentenceId, wavBase64: toBase64(wav) });
      if (signal.aborted || mine !== turn) return;
      reveal(assessment);
    } catch (cause) {
      if (signal.aborted || mine !== turn) return;
      status.textContent = '';
      error.show(cause);
    }
  }

  const recorder = createTakeRecorder({
    signal,
    onStart: () => { status.textContent = t('正在录音…'); recordButton.update({ label: t('■ 停止') }); },
    onTake: taken => { recordButton.update({ label: t('● 开始复述') }); void score(taken); },
    onError: cause => { recordButton.update({ label: t('● 开始复述') }); status.textContent = ''; error.show(cause); },
  });

  function toggle() {
    if (index === WHOLE || tokens !== null) return undefined;
    if (recorder.isRecording()) return recorder.stop();
    player.stop();
    error.clear();
    turn += 1;
    return recorder.start(takeLimitMs(sentences[index]));
  }

  function show(nextIndex) {
    recorder.cancel();
    index = nextIndex;
    tokens = null;
    marked = new Set();
    retold = false;
    turn += 1;
    position.textContent = t('摸底 · 第 {position}/{total} 句', { position: index + 1, total: sentences.length });
    instruction.textContent = t('不看文本听这一句，可以重听。听完后凭记忆复述出来。');
    written.textContent = '';
    text.replaceChildren();
    meaning.textContent = '';
    status.textContent = '';
    error.clear();
    playButton.update({ label: t('▶ 听这一句') });
    recordButton.update({ disabled: false });
    giveUpButton.update({ disabled: false });
    nextButton.update({ disabled: true, label: index === sentences.length - 1 ? t('看结果 →') : t('下一句 →') });
    void play();
  }

  async function save() {
    const { notSaid, unclear } = retold ? scoredGaps(tokens) : { notSaid: [], unclear: [] };
    const unknown = markedPhrases(tokens, marked, passage.targetLanguage);
    const state = await app.call('record-diagnosis', { passageId, sentenceId: sentences[index].id, retold, notSaid, unclear, unknown });
    if (!signal.aborted) app.setState(state);
  }

  /** Leaves the whole-passage listen or the current sentence. A new diagnostic replaces the old one only from here on. */
  async function next() {
    error.clear();
    player.stop();
    try {
      if (index === WHOLE) app.setState(await app.call('start-diagnosis', { passageId }));
      else await save();
    } catch (cause) {
      if (!signal.aborted) error.show(cause);
      return;
    }
    if (signal.aborted) return;
    if (index === sentences.length - 1) app.go({ name: 'gaps', passageId });
    else show(index + 1);
  }
}
