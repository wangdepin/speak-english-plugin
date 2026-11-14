import { el } from './dom.js';
import { fromBase64 } from './wav.js';
import { t } from './i18n.js';

export const SLOW_RATE = 0.85;

/**
 * Plays audio that the backend returns as base64 (the host does not serve files
 * from a plugin's data directory). `fetchAudio(id)` resolves to { base64, mime };
 * each id is fetched once and kept as an object URL until `signal` aborts.
 * Only one thing plays at a time.
 */
export function createPlayer(fetchAudio, signal) {
  const urls = new Map();
  const audio = new Audio();
  let turn = 0;
  let settle = null;
  // True from the moment something was asked to play until it ends or is stopped.
  let active = false;
  const finish = completed => { active = false; settle?.(completed); settle = null; };
  audio.addEventListener('ended', () => finish(true));
  audio.addEventListener('error', () => finish(false));

  function stop() {
    turn += 1;
    audio.pause();
    finish(false);
  }
  /** Runs one step of starting playback; a failure ends this play unless a newer one has taken over. */
  async function step(mine, action) {
    try { return await action(); } catch (cause) { if (mine === turn) finish(false); throw cause; }
  }
  signal.addEventListener('abort', () => {
    stop();
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }, { once: true });

  async function urlFor(id) {
    if (!urls.has(id)) {
      const { base64, mime } = await fetchAudio(id);
      if (!signal.aborted) urls.set(id, URL.createObjectURL(new Blob([fromBase64(base64)], { type: mime })));
    }
    return urls.get(id);
  }

  return {
    /** Starts playing and resolves to true when the audio ran to its end, false when it was stopped or replaced. */
    async play(id, { rate = 1 } = {}) {
      stop();
      const mine = turn;
      active = true;
      const url = await step(mine, () => urlFor(id));
      if (mine !== turn) return false;
      if (signal.aborted || !url) { finish(false); return false; }
      audio.src = url;
      audio.playbackRate = rate;
      const finished = new Promise(resolve => { settle = resolve; });
      await step(mine, () => audio.play());
      return finished;
    },
    stop,
    isPlaying: () => active,
    /** Drops the cached audio of an id whose audio was replaced. */
    forget(id) {
      const url = urls.get(id);
      if (url) URL.revokeObjectURL(url);
      urls.delete(id);
    },
  };
}

/** For a key that starts playback and, pressed again, stops it. `play` starts whatever the key stands for. */
export const playOrStop = (player, play) => () => (player.isPlaying() ? player.stop() : play());

/** A player for sentences' reference audio. */
export function createSentencePlayer(call, signal) {
  return createPlayer(sentenceId => call('sentence-audio', { sentenceId }), signal);
}

/** Plays the sentences one after another. Resolves to false when playback was stopped part-way. */
export async function playSentences(player, sentences, { rate = 1, onSentence } = {}) {
  for (const sentence of sentences.filter(item => item.audio)) {
    onSentence?.(sentence.id);
    if (!await player.play(sentence.id, { rate })) return false;
  }
  onSentence?.(null);
  return true;
}

/** Plays recordings held in memory, such as the take the learner just made. */
export function createBlobPlayer(signal) {
  const audio = new Audio();
  let url = null;
  const release = () => { audio.pause(); if (url) URL.revokeObjectURL(url); url = null; };
  signal.addEventListener('abort', release, { once: true });
  return {
    async play(blob) {
      release();
      url = URL.createObjectURL(blob);
      audio.src = url;
      await audio.play();
    },
    stop: release,
  };
}

/** A "slow down" checkbox. Returns a function giving the playback rate to use right now. */
export function slowToggle(parent) {
  const label = el('label', 'se-radio');
  const input = el('input');
  input.type = 'checkbox';
  label.append(input, t('放慢（{rate} 倍）', { rate: SLOW_RATE }));
  parent.append(label);
  return () => (input.checked ? SLOW_RATE : 1);
}
