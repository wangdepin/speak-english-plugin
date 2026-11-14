import { startRecording } from './recorder.js';

const MIN_TAKE_MS = 8000;
const MAX_TAKE_MS = 30000;

/** Time allowed for one scored take of a sentence: three times the reference audio, within what the scoring service accepts. */
export function takeLimitMs(sentence) {
  const reference = sentence.audio ? sentence.audio.seconds * 3000 : MIN_TAKE_MS;
  return Math.min(MAX_TAKE_MS, Math.max(MIN_TAKE_MS, reference));
}

/**
 * Records one take at a time. `start(maxMs)` opens the microphone and stops by
 * itself after `maxMs`; `stop()` ends it early. Either way `onTake` receives
 * { blob, speakMs }. Starting while a take is running does nothing.
 * `cancel()` ends a take and throws it away, also one whose microphone is still opening.
 */
export function createTakeRecorder({ signal, onStart, onTake, onError }) {
  let active = null;
  let opening = false;
  // Counts cancellations, so that a microphone that opens after one is closed again.
  let cancellations = 0;

  async function stop() {
    if (!active) return;
    const { recording, startedAt, timer } = active;
    active = null;
    clearTimeout(timer);
    try {
      const blob = await recording.stop();
      if (!signal.aborted) onTake({ blob, speakMs: performance.now() - startedAt });
    } catch (error) {
      if (!signal.aborted) onError(error);
    }
  }

  async function start(maxMs) {
    if (active || opening || signal.aborted) return;
    opening = true;
    try {
      const asked = cancellations;
      const recording = await startRecording(signal);
      if (asked !== cancellations) { recording.stop().catch(() => {}); return; }
      active = { recording, startedAt: performance.now(), timer: setTimeout(() => void stop(), maxMs) };
      onStart?.();
    } catch (error) {
      if (!signal.aborted) onError(error);
    } finally {
      opening = false;
    }
  }

  function cancel() {
    cancellations += 1;
    if (!active) return;
    const { recording, timer } = active;
    active = null;
    clearTimeout(timer);
    recording.stop().catch(() => {});
  }

  signal.addEventListener('abort', cancel, { once: true });
  return { start, stop, cancel, isRecording: () => Boolean(active) };
}
