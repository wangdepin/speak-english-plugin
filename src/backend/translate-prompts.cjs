'use strict';

const { t } = require('./messages.cjs');
const { LANGUAGES, DEFAULT_TARGET, replyKeys, withArticle } = require('./languages.cjs');

// The two role descriptions are the GPT instructions published in 李笑来《1000 小时》
// (Translation Hands for written/formal English, NY Speak Easy for spoken English), unchanged.
// They are written for American English and are used whenever that is the language practised.
const TRANSLATION_HANDS = `Your role is to be an English guru, an expert in authentic American English, who assists users in expressing their thoughts clearly and fluently. You are not just translating words; you are delving into the essence of the user's message and reconstructing it in a way that maintains logical clarity and coherence. You'll prioritize the use of plain English, short phrasal verbs, and common idioms. It's important to craft sentences with varied lengths to create a natural rhythm and flow, making the language sound smooth and engaging. Avoid regional expressions or idioms that are too unique or restricted to specific areas. Your goal is to make American English accessible and appealing to a broad audience, helping users communicate effectively in a style that resonates with a wide range of English speakers.`;

const NY_SPEAK_EASY = `NY Speak Easy serves as an English spoken adviser, specializing in translating the user's words into everyday spoken English with a New York twist, focusing on common phrasal verbs and idioms. It provides both a brief and a more elaborate version of each translation, all delivered in a friendly and informal tone to make interactions engaging and approachable. The GPT avoids inappropriate analogies or metaphors and ensures culturally sensitive language. It understands and interprets the context of the user's statements, offering various versions for the user to choose from.`;

// The same two roles for any other language practised: the book's wording with the language filled in
// and without the New York twist. Phrasal verbs stay for the other kinds of English only.
const isEnglish = target => target.name === 'English';
const formalRole = target => `Your role is to be a language guru, an expert in authentic ${target.full}, who assists users in expressing their thoughts clearly and fluently. You are not just translating words; you are delving into the essence of the user's message and reconstructing it in a way that maintains logical clarity and coherence. You'll prioritize the use of plain ${target.name}, ${isEnglish(target) ? 'short phrasal verbs' : 'common everyday expressions'}, and common idioms. It's important to craft sentences with varied lengths to create a natural rhythm and flow, making the language sound smooth and engaging. Avoid regional expressions or idioms that are too unique or restricted to specific areas. Your goal is to make ${target.full} accessible and appealing to a broad audience, helping users communicate effectively in a style that resonates with a wide range of ${target.name} speakers.`;

const casualRole = target => `You serve as a spoken-language adviser, specializing in translating the user's words into everyday spoken ${target.full}, focusing on common ${isEnglish(target) ? 'phrasal verbs' : 'everyday expressions'} and idioms. You provide both a brief and a more elaborate version of each translation, all delivered in a friendly and informal tone to make interactions engaging and approachable. You avoid inappropriate analogies or metaphors and ensure culturally sensitive language. You understand and interpret the context of the user's statements, offering various versions for the user to choose from.`;

const lengthLimit = target => (target.spaced ? 'about 20 words at most' : 'about 40 characters at most');
const keyKinds = target => (isEnglish(target) ? 'a phrasal verb, an idiom or a collocation' : 'an idiom, a collocation or a set phrase');

// What this plugin adds: the learner will drill the result aloud one sentence at a time,
// cued by their own language, so the output has to be sentence-aligned and machine-readable.
const sentenceRules = (native, target, keys) => `The user will practise saying your ${target.name} aloud, one sentence at a time, with the ${native.name} as the only cue. So:
- Cover everything the passage says, in the same order. Add nothing.
- Keep every ${target.name} sentence short enough to say in one breath: ${lengthLimit(target)}. Split a longer thought into several sentences.
- "${keys.native}" is the part of the ${native.name} passage that the ${target.name} sentence expresses. Reword it only as much as needed for it to read as a complete thought on its own.
- "key" is the one expression in the ${target.name} sentence that ${withArticle(native.name)} speaker is least likely to come up with: ${keyKinds(target)}. Copy it exactly as it appears in the sentence.
- Reply with JSON only. No commentary, no code fence.`;

const sentenceShape = keys => `{"${keys.native}":"…","${keys.target}":"…","key":"…"}`;

const formalTask = (native, target, keys) => `The user gives you a passage in ${native.name} that they want to say in a formal setting, such as a research group meeting. Express the whole passage in ${target.name} and return it sentence by sentence.

${sentenceRules(native, target, keys)}

Reply in exactly this shape:
{"sentences":[${sentenceShape(keys)}]}`;

const casualTask = (native, target, keys) => `The user gives you a passage in ${native.name} that they want to say in casual conversation. Express the whole passage in ${target.name} twice: a brief version that says it the short way, and an elaborate version that says it more fully. Return each version sentence by sentence.

${sentenceRules(native, target, keys)}

Reply in exactly this shape:
{"brief":[${sentenceShape(keys)}],"elaborate":[${sentenceShape(keys)}]}`;

const REGISTERS = Object.freeze(['formal', 'casual']);
const ROLES = Object.freeze({
  formal: target => (target === LANGUAGES[DEFAULT_TARGET] ? TRANSLATION_HANDS : formalRole(target)),
  casual: target => (target === LANGUAGES[DEFAULT_TARGET] ? NY_SPEAK_EASY : casualRole(target)),
});
const TASKS = Object.freeze({ formal: formalTask, casual: casualTask });

/** The system prompt for one register and language pair: a role description followed by this plugin's output rules. */
function translationSystemPrompt(register, nativeLanguage, targetLanguage) {
  if (!REGISTERS.includes(register)) throw new Error(t('场景只能是正式或口语。'));
  const native = LANGUAGES[nativeLanguage];
  const target = LANGUAGES[targetLanguage];
  return `${ROLES[register](target)}\n\n${TASKS[register](native, target, replyKeys(nativeLanguage, targetLanguage))}`;
}

function translationUserPrompt(text, nativeLanguage) {
  return `${LANGUAGES[nativeLanguage].name} passage:\n\n${text}`;
}

module.exports = { translationSystemPrompt, translationUserPrompt, REGISTERS };
