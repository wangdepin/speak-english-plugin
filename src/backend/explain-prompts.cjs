'use strict';

// The wording was approved by the user on 2026-11-14 (docs/plan.md, section 14). Change it only with their say-so.
const EXPLAIN_SYSTEM_PROMPT = `你是一位英语口语教练。学习者想把自己的中文意思用英语说出来，正在背下面这句英文，但多次没能说出来，而且不限时也说不出来。请找出他卡在哪里，并给出更容易开口的说法。

要求：
- 用中文讲解，英文例句保持英文。
- 难点要具体到这一句：指出是哪个词组、哪种句子结构，或哪处中英文表达习惯不同。不要泛泛讲语法。最多三点，每点一两句话。
- 替代说法必须表达同一个意思，适合口语，比原句更短或更简单。尽量保留关键说法；如果关键说法本身就是难点，就换掉它，并说明原因。
- 只有原句超过 12 个词时才给拆分方案：拆成两句，每句都能独立说出口，并给出各自对应的中文。否则 split 填 null。
- 读错的词和音只作参考：明显妨碍开口时才提，不要逐条纠音。
- 只输出 JSON，不要其他文字：
  {"difficulty":["…"],"simpler":{"en":"…","why":"…"},"split":[{"zh":"…","en":"…"},{"zh":"…","en":"…"}]}`;

const listOrNone = items => (items.length === 0 ? '无' : items.join('、'));

/**
 * The user message for one sentence. `history` is
 * { attempts, said, missed, timedOut, wrongWords: [{ word, count }], weakSounds: [{ word, expected, soundsLike, count }] }.
 */
function explainUserPrompt(sentence, history) {
  const wrongWords = history.wrongWords.map(item => `${item.word}（${item.count} 次）`);
  const weakSounds = history.weakSounds.map(item => `${item.word} 里的 /${item.expected}/${item.soundsLike ? `（听起来像 /${item.soundsLike}/）` : ''}`);
  return [
    `中文：${sentence.zh}`,
    `英文：${sentence.en}`,
    `关键说法：${sentence.keyExpression || '无'}`,
    `练习记录：共 ${history.attempts} 次，说出来 ${history.said} 次，没说出来 ${history.missed} 次（其中超时 ${history.timedOut} 次）`,
    `常读错的词：${listOrNone(wrongWords)}`,
    `不清楚的音：${listOrNone(weakSounds)}`,
  ].join('\n');
}

module.exports = { EXPLAIN_SYSTEM_PROMPT, explainUserPrompt };
