const MIN_SPEAK_MS = 4000;
const MAX_SPEAK_MS = 30000;
const SPEAK_MS_WITHOUT_AUDIO = 15000;

/** Characters that take time to read: letters and digits, not punctuation or spaces. */
export function countedChars(text) {
  return [...text].filter(char => /[\p{L}\p{N}]/u.test(char)).length;
}

/** Start limit: time to read the Chinese cue (rounded up to whole seconds) plus thinking time. */
export function startLimitMs(sentence, settings) {
  return (Math.ceil(countedChars(sentence.zh) / settings.readingCharsPerSecond) + settings.startAllowanceSeconds) * 1000;
}

/** Speaking limit: the reference audio's length times the setting, within what the scoring service accepts. */
export function speakLimitMs(sentence, settings) {
  if (!sentence.audio) return SPEAK_MS_WITHOUT_AUDIO;
  return Math.min(MAX_SPEAK_MS, Math.max(MIN_SPEAK_MS, sentence.audio.seconds * settings.speakingTimeFactor * 1000));
}

/** Whole seconds left of `limitMs` after `elapsedMs`, never below zero. */
export function secondsLeft(limitMs, elapsedMs) {
  return Math.max(0, Math.ceil((limitMs - elapsedMs) / 1000));
}

const MAX_ANSWER_MS = 180000;

/** Time to start answering once a question has been asked: the thinking time from the settings, at least one second. */
export function answerStartLimitMs(settings) {
  return Math.max(1, settings.startAllowanceSeconds) * 1000;
}

/** Speaking limit for answering with a whole passage: its sentences' reference audio times the setting, within 4 seconds to 3 minutes. */
export function answerSpeakLimitMs(passage, settings) {
  const seconds = passage.sentences.reduce((sum, sentence) => sum + (sentence.audio?.seconds ?? 0), 0);
  if (seconds === 0) return MAX_ANSWER_MS;
  return Math.min(MAX_ANSWER_MS, Math.max(MIN_SPEAK_MS, seconds * settings.speakingTimeFactor * 1000));
}
