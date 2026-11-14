import { startRecording } from './recorder.js';

/**
 * Records one take at a time. `start(maxMs)` opens the microphone and stops by
 * itself after `maxMs`; `stop()` ends it early. Either way `onTake` receives
 * { blob, speakMs }. Starting while a take is running does nothing.
 * `cancel()` ends a take and throws it away.
 */
export function createTakeRecorder({ signal, onStart, onTake, onError }) {
  let active = null;
  let opening = false;

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
      const recording = await startRecording(signal);
      active = { recording, startedAt: performance.now(), timer: setTimeout(() => void stop(), maxMs) };
      onStart?.();
    } catch (error) {
      if (!signal.aborted) onError(error);
    } finally {
      opening = false;
    }
  }

  function cancel() {
    if (!active) return;
    const { recording, timer } = active;
    active = null;
    clearTimeout(timer);
    recording.stop().catch(() => {});
  }

  signal.addEventListener('abort', cancel, { once: true });
  return { start, stop, cancel, isRecording: () => Boolean(active) };
}
