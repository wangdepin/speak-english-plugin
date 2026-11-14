/** Finds a sentence in the client state. Returns { sentence, passage } or null. */
export function findSentence(state, sentenceId) {
  for (const passage of state.passages) {
    const sentence = passage.sentences.find(item => item.id === sentenceId);
    if (sentence) return { sentence, passage };
  }
  return null;
}

/** Whether a sentence has been missed often enough for the plugin to suggest an explanation. */
export function shouldSuggestExplanation(state, sentenceId) {
  const found = findSentence(state, sentenceId);
  return Boolean(found) && found.sentence.misses >= state.settings.explainAfterFailures;
}
