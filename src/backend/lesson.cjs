'use strict';

const { LANGUAGES } = require('./languages.cjs');
const { passageForChat } = require('./study.cjs');
const { FIXED_INSTRUCTION, LESSON_AGENTS, lessonGuide } = require('./lesson-guide.cjs');

/** The name of the tool that gives a lesson's agents the passage. The fixed instruction refers to it. */
const TOOL_NAME = 'speaking_practice_lesson';
const PASSAGE_GONE = 'The passage this session was started for has been deleted from the Speak English plugin. Tell the learner so, and teach nothing from it.';

const listed = words => (words.length > 0 ? words.join(', ') : 'none');

/** What the diagnostic found in one sentence, as indented lines. */
function findingLines(found) {
  if (!found) return ['   Not tested.'];
  const unknown = `   Marked unknown: ${listed(found.unknown)}`;
  if (!found.retold) return ['   Could not repeat.', unknown];
  return [`   Not said: ${listed(found.notSaid)}`, `   Said unclearly: ${listed(found.unclear)}`, unknown];
}

function sentenceLines(sentence, index, diagnosis) {
  const lines = [`${index + 1}. ${sentence.target}`, `   Meaning: ${sentence.native}`, `   Key expression: ${sentence.keyExpression || 'none'}`];
  return diagnosis ? [...lines, ...findingLines(diagnosis.sentences[sentence.id])] : lines;
}

/** The passage's diagnostic when it covers at least one sentence the passage still has, otherwise null. */
function usableDiagnosis(passage) {
  const covered = passage.diagnosis ? Object.keys(passage.diagnosis.sentences).some(id => passage.sentenceIds.includes(id)) : false;
  return covered ? passage.diagnosis : null;
}

/** Everything the app's agents need to run the lesson: the passage, the diagnostic and the guide. */
function lessonText(state, passage) {
  const native = LANGUAGES[passage.nativeLanguage];
  const target = LANGUAGES[passage.targetLanguage];
  const diagnosis = usableDiagnosis(passage);
  const sentences = passage.sentenceIds.map(id => state.sentences[id]);
  return [
    `Passage in ${target.full}, ${passage.register} register. The learner's own language is ${native.name}.`,
    '',
    ...sentences.flatMap((sentence, index) => sentenceLines(sentence, index, diagnosis)),
    '',
    lessonGuide(native, target, Boolean(diagnosis)),
  ].join('\n');
}

function lessonTool(store, context) {
  return {
    name: TOOL_NAME,
    label: 'Speak English lesson',
    description: 'Returns the passage the learner wants to be taught, what a listening diagnostic found in it, and how to run this session.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      const state = store.get();
      const passage = passageForChat(state, context.chatId);
      if (!passage) return { content: [{ type: 'text', text: PASSAGE_GONE }], details: {} };
      return { content: [{ type: 'text', text: lessonText(state, passage) }], details: { passageId: passage.id } };
    },
  };
}

/**
 * Gives the app's prober and teacher the lesson tool, in the sessions this plugin started and nowhere else.
 * Returns false on a host that cannot extend its agents; the plugin then cannot hand a passage to the teacher.
 */
function registerLesson(ctx, store) {
  if (typeof ctx.registerInstructions !== 'function' || typeof ctx.registerTools !== 'function') return false;
  ctx.registerInstructions({ agents: [...LESSON_AGENTS], text: FIXED_INSTRUCTION });
  ctx.registerTools({
    agents: [...LESSON_AGENTS],
    create: context => (passageForChat(store.get(), context.chatId) ? [lessonTool(store, context)] : []),
  });
  return true;
}

module.exports = { registerLesson, lessonText, TOOL_NAME };
