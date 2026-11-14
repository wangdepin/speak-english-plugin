'use strict';

// English messages, keyed by the Chinese text used in the code, with the same {placeholders}.
module.exports = {
  // Tasks given to the model
  '翻译': 'The translation',
  '讲解': 'The explanation',
  '生成问句': 'Generating questions',
  '{task}没有完成：{detail}': '{task} did not finish: {detail}',
  '{task}的回复太长，被截断了。请再试一次，或在设置里换一个模型。': 'The reply was too long and got cut off ({task}). Try again, or choose another model in settings.',
  '模型返回的内容不是预期的格式，请再试一次。': 'The model did not reply in the expected format. Please try again.',
  '还没有可用的模型。请在应用设置里配置 cheap 档模型，或在本插件的设置里指定翻译模型。': "No model is available. Configure the cheap slot in the app's settings, or choose a model in this plugin's settings.",
  '选定的翻译模型现在不可用，请在设置里换一个。': 'The chosen model is not available right now. Choose another one in settings.',

  // Intake
  '请先写下想说的话。': 'Write down what you want to say first.',
  '这段话超过 {max} 字了，请分成几段录入。': 'This passage is longer than {max} characters. Enter it as several passages.',
  '场景只能是正式或口语。': 'The setting must be formal or casual.',
  '版本和场景对不上。': 'The version does not belong to this setting.',
  '原文为空或太长。': 'The passage is empty or too long.',
  '一段要有 1 到 {max} 句。': 'A passage needs 1 to {max} sentences.',
  '第 {position} 句': 'Sentence {position}',
  '{label}两种语言的内容都不能为空。': '{label}: neither language may be left empty.',
  '{label}太长了，请拆成两句。': '{label} is too long. Split it into two sentences.',
  '{label}的关键说法「{keyExpression}」不在要练的句子里。': '{label}: the key expression "{keyExpression}" does not appear in the sentence to practise.',

  // Records
  '找不到这一句。': 'This sentence was not found.',
  '找不到这一段。': 'This passage was not found.',
  '找不到这个问句。': 'This question was not found.',
  '段落编号无效。': 'The passage id is not valid.',
  '句子编号无效。': 'The sentence id is not valid.',
  '录音位置无效。': 'The recording slot is not valid.',
  '练习记录编号无效。': 'The practice record id is not valid.',
  '这个练习记录编号已经用在别处了。': 'This practice record id is already used elsewhere.',
  '不认识的练习类型。': 'Unknown kind of practice.',
  '用时不对。': 'The duration is not valid.',
  '操作的输入格式不对。': 'The input of the operation is not in the right format.',

  // Audio
  '录音为空或太长。': 'The recording is empty or too long.',
  '不支持这种录音格式。': 'This recording format is not supported.',
  '录音时长不对。': 'The length of the recording is not valid.',
  '还没有这段录音。': 'This recording does not exist yet.',
  '这一句还没有合成语音。': 'This sentence has no audio yet.',
  '这个问句还没有合成语音。': 'This question has no audio yet.',
  '还没有填 Azure 区域，请到插件设置里填写。': "The Azure region is missing. Enter it in the plugin's settings.",

  // Recall and review
  '请选择说出来了还是没说出来。': 'Choose whether you said it or missed it.',
  '这一句已经在复习里了。': 'This sentence is already in review.',
  '这一句今天已经试过了，明天再试。': 'You have already tried this sentence today. Try again tomorrow.',
  '超时标记不对。': 'The timed-out flag is not valid.',
  '超时的句子不能记为说出来了。': 'A sentence that timed out cannot be recorded as said.',
  '这一句还没有进入复习，请先在段落里试背。': 'This sentence is not in review yet. Recall it from its passage first.',
  '这一句现在还没到复习时间。': 'This sentence is not due yet.',
  '今天的复习已经到每日上限了，明天继续。': "Today's reviews have reached the daily limit. Continue tomorrow.",
  '这次复习已经记过结果了。': 'The result of this review is already recorded.',

  // Explanation
  '只能采用替代说法或拆分方案。': 'Only the simpler wording or the split can be adopted.',
  '这一句还没有讲解。': 'This sentence has no explanation yet.',
  '这一句的讲解里没有拆分方案。': 'The explanation of this sentence offers no split.',

  // Optional exercises
  '请选择听懂了还是没听懂。': 'Choose whether you understood it or not.',
  '不认识的分类。': 'Unknown category.',
  '听懂了的句子不需要分类。': 'A sentence you understood needs no category.',
  '播放速度不对。': 'The playback speed is not valid.',
  '请选择接上了还是没接上。': 'Choose whether you answered or missed it.',
  '没有要保存的问句。': 'There are no questions to save.',
  '问句不能为空，也不能超过 {max} 个字符。': 'A question may not be empty or longer than {max} characters.',
  '一段最多 {max} 个问句，请先删掉几个。': 'A passage can have at most {max} questions. Delete some first.',

  // Keys and settings
  '不认识的密钥名称。': 'Unknown key name.',
  '密钥不能为空。': 'The key may not be empty.',
  '密钥里有空格或不该出现的字符，请重新粘贴。': 'The key contains spaces or characters that do not belong in it. Paste it again.',
  '读不了密钥文件，请在设置里重新填写密钥。': 'The key file could not be read. Enter the keys again in settings.',
  '设置格式不对。': 'The settings are not in the right format.',
  '不支持的设置项：{key}': 'Unsupported setting: {key}',
  '界面语言只能是中文或英文。': 'The interface language must be Chinese or English.',
  '翻译模型无效。': 'The model is not valid.',
  '语音模型不在支持的列表里。': 'The speech model is not in the supported list.',
  '声音 ID 应为 10 到 40 位字母和数字。': 'A voice ID is 10 to 40 letters and digits.',
  'Azure 区域应为小写字母和数字，例如 swedencentral。': 'The Azure region is lower-case letters and digits, e.g. swedencentral.',
  '目标保持率应在 70% 到 99% 之间。': 'The target retention must be between 70% and 99%.',
  '每日复习上限应为 1 到 500 的整数。': 'The daily review limit must be a whole number from 1 to 500.',
  '读题速度应在 1 到 20 之间。': 'The reading speed must be between 1 and 20.',
  '不支持这种语言。': 'This language is not supported.',
  '母语和学习语言不能相同。': 'Your language and the language you practise must be different.',
  '思考时间应在 0 到 30 秒之间。': 'The thinking time must be between 0 and 30 seconds.',
  '说话时限应为原声时长的 1 到 5 倍。': 'The speaking limit must be 1 to 5 times the reference length.',
  '提示讲解的次数应为 1 到 20 的整数。': 'The number of misses before an explanation is suggested must be a whole number from 1 to 20.',
  '读不了练习数据：{reason}': 'The practice data could not be read: {reason}',
  '练习数据文件损坏或版本不支持，没有做任何改动。': 'The practice data file is damaged or of an unsupported version. Nothing was changed.',

  // Speech services
  'Azure 语音': 'Azure Speech',
  '还没有填 {name} 的密钥，请到插件设置里填写。': "The {name} key is missing. Enter it in the plugin's settings.",
  '{name} 不接受这把密钥。请检查密钥是否填对、是否有相应权限。': '{name} does not accept this key. Check that it is entered correctly and has the needed permissions.',
  '{name} 账户的额度用完了。': 'The {name} account has run out of quota.',
  '{name} 说请求太频繁，请稍等再试。': '{name} says there are too many requests. Wait a moment and try again.',
  '{name} 拒绝了这次请求，请检查设置里的声音、模型或区域。': '{name} rejected the request. Check the voice, model or region in settings.',
  '这段录音没法评分。': 'This recording could not be scored.',
  '没有听到这句话，请靠近麦克风再说一遍。': 'The sentence was not heard. Move closer to the microphone and say it again.',
  '连不上 {name}，请检查网络。': 'Could not reach {name}. Check your network.',
  '{name} 太久没有回应，请再试一次。': '{name} took too long to respond. Please try again.',
  '{name} 出错了，请稍后再试。': '{name} had an error. Try again later.',
  '发给语音服务的内容不对。': 'What was sent to the speech service was not valid.',
  '{message}（{detail}）': '{message} ({detail})',

  // Learning a passage first
  '摸底结果的格式不对。': 'The diagnostic result is not in the right format.',
  '还没有开始摸底。': 'The diagnostic has not been started.',
  '课堂会话的编号无效。': "The lesson's session id is not valid.",
  '这个版本的 LearnHarness 不能把段落交给老师，请更新应用。': 'This version of LearnHarness cannot hand a passage to the teacher. Please update the app.',
};
