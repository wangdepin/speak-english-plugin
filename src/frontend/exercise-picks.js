/** Sentences that can be played: every sentence with reference audio, with its passage. */
export function listenableSentences(state) {
  return state.passages.flatMap(passage => passage.sentences.filter(sentence => sentence.audio).map(sentence => ({ sentence, passage })));
}

/** Whether every sentence of the passage has entered spaced review, so the learner has something to answer with. */
export const isMemorized = passage => passage.sentences.length > 0 && passage.sentences.every(sentence => sentence.schedule);

/** Passages that can be asked about: memorized, with at least one question that has audio. */
export function respondablePassages(state) {
  return state.passages.filter(passage => isMemorized(passage) && passage.questions.some(question => question.audio));
}

/** Up to `count` of `items` in random order (Fisher–Yates). `random` is injectable for tests. */
export function sample(items, count, random = Math.random) {
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [pool[index], pool[other]] = [pool[other], pool[index]];
  }
  return pool.slice(0, count);
}
