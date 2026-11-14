'use strict';

const { LANGUAGES, isOriginalPair } = require('./languages.cjs');

// For Chinese speakers practising American English. The wording was approved by the user on 2026-11-14
// (docs/plan.md, section 14). Change it only with their say-so.
const ORIGINAL_SYSTEM_PROMPT = `你是一位英语口语教练。学习者想把自己的中文意思用英语说出来，正在背下面这句英文，但多次没能说出来，而且不限时也说不出来。请找出他卡在哪里，并给出更容易开口的说法。

要求：
- 用中文讲解，英文例句保持英文。
- 难点要具体到这一句：指出是哪个词组、哪种句子结构，或哪处中英文表达习惯不同。不要泛泛讲语法。最多三点，每点一两句话。
- 替代说法必须表达同一个意思，适合口语，比原句更短或更简单。尽量保留关键说法；如果关键说法本身就是难点，就换掉它，并说明原因。
- 只有原句超过 12 个词时才给拆分方案：拆成两句，每句都能独立说出口，并给出各自对应的中文。否则 split 填 null。
- 读错的词和音只作参考：明显妨碍开口时才提，不要逐条纠音。
- 只输出 JSON，不要其他文字：
  {"difficulty":["…"],"simpler":{"en":"…","why":"…"},"split":[{"zh":"…","en":"…"},{"zh":"…","en":"…"}]}`;

const splitLimit = target => (target.spaced ? '12 words' : '24 characters');

// The same instructions for every other pair, with the two languages filled in.
const generalSystemPrompt = (native, target) => `You are a speaking coach for ${target.full}. The learner, whose own language is ${native.name}, wants to say in ${target.name} what they mean in ${native.name}. They are memorizing the ${target.name} sentence below, but have failed to say it several times, and cannot say it even without a time limit. Find where they get stuck and give a wording that is easier to say.

Rules:
- Explain in ${native.name}; keep ${target.name} examples in ${target.name}.
- The difficulties must be specific to this sentence: point to a phrase, a sentence structure, or a place where ${native.name} and ${target.name} express things differently. No general grammar lessons. At most three points, one or two sentences each.
- The simpler wording must say the same thing, suit speech, and be shorter or simpler than the original. Keep the key expression where possible; if the key expression is itself the difficulty, replace it and say why.
- Offer a split only when the original is longer than ${splitLimit(target)}: two sentences, each sayable on its own, each with its meaning in ${native.name}. Otherwise set "split" to null.
- Mispronounced words and sounds are for reference only: mention them only when they clearly get in the way of speaking; do not correct pronunciation item by item.
- Reply with JSON only, no other text:
  {"difficulty":["…"],"simpler":{"target":"…","why":"…"},"split":[{"native":"…","target":"…"},{"native":"…","target":"…"}]}`;

/** The system prompt for explaining a sentence of one language pair. */
function explainSystemPrompt(nativeLanguage, targetLanguage) {
  if (isOriginalPair(nativeLanguage, targetLanguage)) return ORIGINAL_SYSTEM_PROMPT;
  return generalSystemPrompt(LANGUAGES[nativeLanguage], LANGUAGES[targetLanguage]);
}

const listOr = (items, separator, none) => (items.length === 0 ? none : items.join(separator));

function originalUserPrompt(sentence, history) {
  const wrongWords = history.wrongWords.map(item => `${item.word}（${item.count} 次）`);
  const weakSounds = history.weakSounds.map(item => `${item.word} 里的 /${item.expected}/${item.soundsLike ? `（听起来像 /${item.soundsLike}/）` : ''}`);
  return [
    `中文：${sentence.native}`,
    `英文：${sentence.target}`,
    `关键说法：${sentence.keyExpression || '无'}`,
    `练习记录：共 ${history.attempts} 次，说出来 ${history.said} 次，没说出来 ${history.missed} 次（其中超时 ${history.timedOut} 次）`,
    `常读错的词：${listOr(wrongWords, '、', '无')}`,
    `不清楚的音：${listOr(weakSounds, '、', '无')}`,
  ].join('\n');
}

function generalUserPrompt(sentence, history, native, target) {
  const wrongWords = history.wrongWords.map(item => `${item.word} (×${item.count})`);
  const weakSounds = history.weakSounds.map(item => `/${item.expected}/ in ${item.word}${item.soundsLike ? ` (sounded like /${item.soundsLike}/)` : ''}`);
  return [
    `${native.name}: ${sentence.native}`,
    `${target.name}: ${sentence.target}`,
    `Key expression: ${sentence.keyExpression || 'none'}`,
    `Practice record: attempts from memory ${history.attempts}, said ${history.said}, missed ${history.missed} (of which out of time: ${history.timedOut})`,
    `Words often misread: ${listOr(wrongWords, ', ', 'none')}`,
    `Unclear sounds: ${listOr(weakSounds, ', ', 'none')}`,
  ].join('\n');
}

/**
 * The user message for one sentence. `history` is
 * { attempts, said, missed, timedOut, wrongWords: [{ word, count }], weakSounds: [{ word, expected, soundsLike, count }] }.
 */
function explainUserPrompt(sentence, history, nativeLanguage, targetLanguage) {
  if (isOriginalPair(nativeLanguage, targetLanguage)) return originalUserPrompt(sentence, history);
  return generalUserPrompt(sentence, history, LANGUAGES[nativeLanguage], LANGUAGES[targetLanguage]);
}

module.exports = { explainSystemPrompt, explainUserPrompt };
