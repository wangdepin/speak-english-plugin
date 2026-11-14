import { el, errorLine, lifetime } from './dom.js';
import { appendWithKey, passageDate } from './labels.js';
import { createPlayer, createSentencePlayer, playSentences, slowToggle } from './sentence-player.js';
import { createTakeRecorder } from './take-recorder.js';
import { toBase64 } from './wav.js';
import { t } from './i18n.js';

// The archive accepts readings up to ten minutes.
const MAX_READING_MS = 10 * 60 * 1000;

const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/**
 * Whole-passage reading: read the passage aloud along with the reference audio.
 * The recording is archived, not scored; the first and the most recent one are kept.
 */
export function readingScreen(app, root, signal, { passageId }) {
  const findPassage = () => app.state.passages.find(item => item.id === passageId);
  if (!findPassage()) { app.go({ name: 'home' }); return; }
  const original = createSentencePlayer(app.call, signal);
  const readings = createPlayer(slot => app.call('reading-audio', { passageId, slot }), signal);
  let ticker = null;
  // The archive's buttons are rebuilt after every recording; the previous ones are disposed with this scope.
  let archiveScope = lifetime(signal);

  const header = el('div', 'se-header');
  app.ui.button(header, t('← 返回段落'), () => app.go({ name: 'passage', passageId }), signal, { variant: 'ghost' });
  header.append(el('span', 'se-muted', t('完整跟读')));
  const text = el('div', 'se-card se-reading-text');
  const lines = new Map();
  for (const sentence of findPassage().sentences) {
    const line = el('p', 'se-target');
    appendWithKey(line, sentence.target, sentence.keyExpression);
    lines.set(sentence.id, line);
    text.append(line);
  }
  const controls = el('div', 'se-actions');
  const status = el('p', 'se-status');
  const archive = el('div', 'se-actions');
  root.append(header, text, controls, status);
  const error = errorLine(root);
  root.append(archive, el('p', 'se-muted', t('按空格开始录音，读完再按一次空格。这里只录音存档，不评分。每段保留第一次和最近一次的录音。')));

  const highlight = current => { for (const [id, line] of lines) line.classList.toggle('se-current', id === current); };
  const playOriginal = () => playSentences(original, findPassage().sentences, { rate: rate(), onSentence: highlight }).catch(error.show);
  const stopOriginal = () => { original.stop(); highlight(null); };

  app.ui.button(controls, t('▶ 整段原声'), playOriginal, signal);
  app.keys.bind('reference', { run: () => (original.isPlaying() ? stopOriginal() : playOriginal()), label: t('整段原声') }, signal);
  app.ui.button(controls, t('■ 停止播放'), stopOriginal, signal, { variant: 'ghost' });
  const rate = slowToggle(controls);
  const along = el('label', 'se-radio');
  const alongInput = el('input');
  alongInput.type = 'checkbox';
  alongInput.checked = true;
  along.append(alongInput, t('录音时播放原声（请戴耳机，否则原声会被录进去）'));
  controls.append(along);
  const recordButton = app.ui.button(controls, t('● 开始录音'), () => toggle(), signal, { variant: 'default' });

  function renderArchive() {
    archiveScope.abort();
    archiveScope = lifetime(signal);
    archive.replaceChildren();
    const { firstReading, latestReading } = findPassage();
    const play = slot => () => { stopOriginal(); return readings.play(slot).catch(error.show); };
    const entry = (slot, reading, label) => app.ui.button(archive, `▶ ${label}（${passageDate(reading.recordedAt)}，${clock(reading.seconds * 1000)}）`, play(slot), archiveScope.signal);
    if (firstReading) entry('first', firstReading, t('第一次的录音'));
    if (latestReading) entry('latest', latestReading, t('最近一次的录音'));
    // The key plays the newest recording there is.
    if (firstReading) app.keys.bind('mine', { run: play(latestReading ? 'latest' : 'first'), label: t('我的录音') }, archiveScope.signal);
  }

  async function save({ blob, speakMs }) {
    status.textContent = t('正在保存…');
    try {
      const base64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
      const state = await app.call('save-reading', { passageId, base64, mime: blob.type, seconds: speakMs / 1000 });
      if (signal.aborted) return;
      app.setState(state);
      readings.forget(state.passages.find(item => item.id === passageId).latestReading ? 'latest' : 'first');
      status.textContent = t('已保存。');
      renderArchive();
    } catch (cause) {
      if (signal.aborted) return;
      status.textContent = '';
      error.show(cause);
    }
  }

  const stopClock = () => { clearInterval(ticker); ticker = null; };
  signal.addEventListener('abort', stopClock, { once: true });
  const recorder = createTakeRecorder({
    signal,
    onStart: () => {
      const startedAt = performance.now();
      recordButton.update({ label: t('■ 停止录音') });
      status.textContent = t('正在录音 {time}', { time: clock(0) });
      ticker = setInterval(() => { status.textContent = t('正在录音 {time}', { time: clock(performance.now() - startedAt) }); }, 500);
      if (alongInput.checked) void playOriginal();
    },
    onTake: taken => { stopClock(); stopOriginal(); recordButton.update({ label: t('● 开始录音') }); void save(taken); },
    onError: cause => { stopClock(); stopOriginal(); recordButton.update({ label: t('● 开始录音') }); status.textContent = ''; error.show(cause); },
  });

  function toggle() {
    if (recorder.isRecording()) return recorder.stop();
    error.clear();
    stopOriginal();
    readings.stop();
    return recorder.start(MAX_READING_MS);
  }

  app.keys.bind('record', { run: () => void toggle(), label: t('录音') }, signal);
  renderArchive();
}
