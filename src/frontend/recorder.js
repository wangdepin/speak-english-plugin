import { encodeWav, WAV_SAMPLE_RATE } from './wav.js';
import { t } from './i18n.js';

/**
 * Starts recording from the microphone. `stop()` ends it and resolves to the
 * recording as the browser encoded it (usually 48 kHz WebM/Opus). The
 * microphone is released when recording stops or `signal` aborts.
 */
export async function startRecording(signal) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(t('这个环境不能使用麦克风。'));
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    throw new Error(error?.name === 'NotAllowedError' ? t('没有麦克风权限，请在系统设置里允许本应用使用麦克风。') : t('打不开麦克风：{reason}', { reason: error?.message ?? error }));
  }
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
  const stopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
  const release = () => {
    if (recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach(track => track.stop());
  };
  signal?.addEventListener('abort', release, { once: true });
  recorder.start();
  return {
    async stop() {
      release();
      await stopped;
      return new Blob(chunks, { type: recorder.mimeType });
    },
  };
}

/** Decodes a recording and resamples it to 16 kHz mono WAV in the browser, with no external tool. */
export async function blobToWav(blob) {
  const decoder = new AudioContext();
  try {
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE), WAV_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return { wav: encodeWav(rendered.getChannelData(0)), seconds: decoded.duration };
  } finally {
    await decoder.close();
  }
}

/** Records for a fixed time and returns the result as WAV. */
export async function recordWavFor(milliseconds, signal) {
  const recording = await startRecording(signal);
  await new Promise(resolve => setTimeout(resolve, milliseconds));
  return blobToWav(await recording.stop());
}
