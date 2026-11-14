# 英语开口练习插件：实现计划（第 4 版）
> 状态：设计决定已全部确认。阶段 0 已完成，四项假设在开发模式下全部通过，结果见 `docs/phase0-results.md`；桌面版里的录音还没实测（推迟到阶段 2）。阶段 1 已完成：语音模块在 `src/backend/speech/`，离线测试 32 个全部通过（`npm test`），联网检查用 `scripts/live-check.mjs`。阶段 2 已完成：插件骨架、设置页、存储和录入流程，离线测试共 56 个全部通过，并在开发实例里用浏览器走通了「录入 → 确认 → 合成 → 播放」和设置页的麦克风测试。桌面版里的麦克风测试已由你确认通过。阶段 3 已完成：听（整段、逐句、放慢）、分段跟读（红绿标记、听起来像、最近 10 句平均分）、完整跟读（存档第一次和最近一次）、试背（说出来的句子进入 FSRS，第二天到期），离线测试共 74 个全部通过，并用假麦克风在开发实例里走通。阶段 4 已完成：到期复习（FSRS 排期、每日上限、两段时限、超时自动判定、10 分钟后重试）和讲解（先分清缺的是速度还是说法，再请模型讲解，可采用替代说法或拆分方案），离线测试共 96 个全部通过，并用假麦克风在开发实例里走通。阶段 5 已完成：「只听一遍」（可加快到 1.2 倍，没听懂时分成声音或配对）和「接话」（模型生成问句，以段落为单位，自己判断），离线测试共 103 个全部通过，并在开发实例里走通。这一阶段的十一处设计和细节已由你确认，见第 14 节。阶段 5 之后加了两项：快捷键（各练习页面同一套键，页面底部有按键提示）和界面语言（中文或 English，在插件设置里选），离线测试共 113 个全部通过，并用键盘在开发实例里走通，见「阶段 5 之后的补充」。之后又加了母语和学习语言两项设置（33 种语言，默认中文到英语），离线测试和开发实例里的走查结果见「补充：母语和学习语言」；通用提示词的全文已确认，这一版已装进桌面应用。阶段 6（先学一遍：摸底、交给课堂 teacher、朗读和变速听）已实现，离线测试共 203 个全部通过，并在开发实例里走通，见「阶段 6」；讲解要求的措辞和我另外定的十八处已在 2026-11-14 确认，这一版已装进桌面应用，并作为 0.2.0 发布。
> 
> 上一版在 `~/src/tries/2026-10-17-amosblomqvist-learnharness/docs/english-speaking-plugin-plan.md`，保留了你的全部批注，我没有再改它。这一版把那些批注的结论合并了进来。
## 1. 背景与目标
**要解决的问题**：把自己想说的话变成英语，并练到在真实场合脱口而出。

**方法来源**：

- 李笑来《1000 小时》1.2–2.7 节：写中文 → AI 转英文 → AI 生成语音 → 跟读 → 背诵 → 定期复习。
  
- 你在《英语自学手册》课上得到的三条结论：
  
  1. 配对只能从样本里得来。
    
  2. 一遍练习只加固「当时的线索 → 当时的反应」这一个方向。
    
  3. 听和说有时限，连接不仅要存在，还要够快。
    

**插件相对书里手工流程的两处改进**：

|     | 书里  | 插件  |
| --- | --- | --- |
| 回忆的线索 | 上一句带出下一句（整段背诵） | 中文意图 → 说出英文，和组会、闲聊的真实线索一致 |
| 复习安排 | 周日复习一周、月末复习一月 | FSRS 按每句的遗忘进度单独排期 |

**成功标准**：每天打开一个入口，不切换任何工具，完成「到期复习 + 当天新段落」。
## 2. 已确定的决定
| 主题  | 决定  |
| --- | --- |
| 插件 id | `speak-english` |
| 代码位置 | `~/src/tries/2026-11-13-speak-english-plugin`（本目录） |
| 形态  | 独立的每日练习视图，不经过课堂里的 teacher |
| 内容录入 | 粘贴一段中文 → 选场景 → 模型翻译 → 整段确认一次 → 自动分句并合成语音 |
| 场景  | 正式（组会）或口语（闲聊）。口语场景给简短版和展开版供选 |
| 翻译提示词 | 以书里两个 GPT 的提示词为基础：正式用 Translation Hands，口语用 NY Speak Easy，再加「返回逐句对齐的中英对和关键说法」 |
| 语音合成 | ElevenLabs，默认模型 `eleven_v4`，默认声音 Jessica，都可在设置里改 |
| 排期  | 只有「中文意图 → 开口」进 FSRS |
| 目标保持率 | 95% |
| 每日复习上限 | 50 次 |
| 时限  | 两段算法（5.1 节），三个数都能在设置里改 |
| 复习自评 | 两个按钮：说出来了 = Good，没说出来 = Again。超时自动判为没说出来 |
| 「说出来了」的标准 | 5.4 节 |
| 进入排期的时机 | 当天试背第一次说出来。没说出来的留到第二天再试背 |
| 讲解  | 累计 3 次没说出来时提示（次数可在设置里改）。卡片背面始终有「讲解」按钮，可以随时直接进入 |
| 录音保留 | 每段只留第一次和最近一次的完整跟读，其余练习录音评分后删除 |
| 发音评分 | 用 Azure，直接放进插件，不依赖 speechcoach。在后台计算，不挡流程，不影响排期 |
| 评分范围 | 第一版只逐句评分（分段跟读、试背、复习）。整段跟读只录音存档，下一版再加整段评分 |
| 韵律评分 | 所有逐句评分都开，包括复习 |
| 密钥  | Azure 和 ElevenLabs 两把密钥在插件自己的设置页填写，存在插件数据目录，只有后端读取，设置页只显示「已设置」 |
| 可选练习 | 「只听一遍」和「接话」不排期，放到阶段 5 |
| 借鉴 issue #700 | 显示实际发成的音；错词标红、其余标绿；最近若干句的平均分。只放在跟读环节 |
## 3. 插件和学习窗口的关系
**两者互相独立。** 学习任何内容时都不需要调用这个插件，插件也不读取课程内容。

插件在侧栏里有一个自己的入口，和 Flashcards 一样。点开后，主区域换成练习视图。

|     | 学习窗口（和 teacher 上课） | 本插件 |
| --- | --- | --- |
| 目的  | 弄懂一个主题 | 把句子练到脱口而出 |
| 谁主导 | teacher 模型，逐步讲解和提问 | 固定流程，不经过 teacher |
| 内容来源 | 你给的主题或资料 | 你自己写的中文 |
| 数据存在哪里 | 课程记录和知识图谱 | 插件自己的数据文件 |
| 什么时候用 | 想学新东西时 | 每天固定练习时 |

**共用的只有两样**：同一个应用窗口，以及翻译和讲解时用的模型配置。
## 4. 每日流程
```
打开「每日练习」
   │
   ├─ ① 到期复习（每天最多 50 次）
   │     看中文意图 → 限时内开口 → 看答案、听原声 → 两个按钮
   │
   ├─ ② 今天的新段落
   │     录入：粘贴中文 → 选场景 → 确认英文
   │     听：整段和逐句，可放慢
   │     分段跟读：听一句 → 录一句 → 红绿标记 → 重来或下一句
   │     完整跟读：整段录音
   │     试背：逐句看中文意图说英文，说出来的句子进入 FSRS
   │
   └─ ③ 可选练习（阶段 5 再细化）
         只听一遍 / 接话
```

和书的对应关系：

| 书里的步骤 | 插件里的环节 |
| --- | --- |
| 1.2 说自己想说的话 | 录入  |
| 2.1 搞清每个单词的读音 | 分段跟读里的音素级反馈 |
| 2.2 放慢播放速度仔细听 | 听（放慢到 0.85 倍） |
| 2.3 分段跟读 | 分段跟读 |
| 2.4 完整跟读，录音对比 | 完整跟读，和原声对比着听 |
| 2.5 背诵，定期复习 | 试背 + FSRS 复习 |
| 1.4 存档第一遍和最后一遍录音 | 每段保留第一次和最近一次完整跟读的录音 |

**不做的部分**：2.6「放松」只是用自然的方式重读，不需要软件支持。2.7「复盘」写文字记录，本期不做。
## 5. 复习卡片与 FSRS 排期
### 5.1 卡片的样子和时限
一句话一张卡。正面只有中文意图，背面是英文和原声。

```
正面
┌──────────────────────────────────────────┐
│ 场景：组会                                  │
│                                          │
│ 这事挺难，但我做成了。                        │
│                                          │
│ 剩余 5 秒                    [空格] 开始说   │
└──────────────────────────────────────────┘

按空格开始录音，说完再按一次空格

背面
┌──────────────────────────────────────────┐
│ I can't believe I **pulled it off**. ▶ 原声 │
│ ▶ 我的录音                        [讲解]    │
│                                          │
│ [没说出来]                    [说出来了]     │
└──────────────────────────────────────────┘
```

时限随句子变化，分成两段：

| 时限  | 怎么算 | 例子  |
| --- | --- | --- |
| 开始时限：卡片出现到按空格 | 读题时间 + 3 秒。读题时间按中文字数算，每 5 个字 1 秒 | 10 个字：2 + 3 = 5 秒。25 个字：5 + 3 = 8 秒 |
| 说话时限：按空格到说完 | 原声时长的 2 倍 | 原声 3 秒：最多说 6 秒 |

- 超过开始时限：卡片直接翻到背面，记为没说出来。
  
- 超过说话时限：录音自动停止，卡片翻到背面，由你自己判断。
  
- 三个数（每 5 个字 1 秒、3 秒、2 倍）都能在设置里改。
  
- 每次的实际用时都会记录，之后可以按记录收紧。
  
### 5.2 排期规则
1. **每句一份日程。** 调度器记录这句话的记忆稳定度，据此算出下次复习的日期。
  
2. **进入排期**：当天试背时第一次说出来，这句话就有了日程。
  
3. **说出来了**：间隔拉长。
  
4. **没说出来**：10 分钟后在当次练习里再出现一次，之后间隔从短的重新开始。
  
5. **每日队列**：到期的卡按到期日从早到晚排。超过 50 次的顺延到第二天。
  
6. **一天从凌晨 4 点算起**，和 Flashcards 一致。
  
7. **发音分不影响排期**，只记进练习记录。
  
### 5.3 实际的间隔
目标保持率 95% 时，用 Flashcards 的调度器实际算出来的天数：

| 情况  | 间隔  |
| --- | --- |
| 每次都说出来 | 1 天 → 3 天 → 8 天 → 19 天 → 43 天 → 89 天 |
| 第 3 次没说出来 | 1 天 → 3 天 → 没说出来 → 1 天 → 2 天 → 3 天 → 5 天 |

调度器的默认参数来自普通记忆卡片的数据，不是针对限时开口。用两三周后，拿实际的说出率和 95% 比较，再决定要不要调整。
### 5.4 「说出来了」的标准
试背和复习用同一个标准。

1. **标准答案**是录入时你确认过的那句英文。
  
2. **关键说法**：录入时模型给每句标出关键说法，比如 _pulled it off_。你确认英文时可以改。卡片背面把它加粗。
  
3. **说出来了** = 关键说法说对，并且意思完整。冠词、介词这类小词不同不算错。
  
4. **换了另一种说法** = 没说出来。这张卡练的是这一个配对。临场造的句子没有样本验证过，可能不地道。
  
5. **由你自己判断。** 逐词比对（说了哪些词、漏了哪些词）几秒后显示在背面，供你参考，不会自动改你的选择。
  
### 5.5 说不出来时的讲解
**入口**：卡片背面始终有「讲解」按钮。同一句累计 3 次没说出来时，插件会主动提示你点它。

**第一步，先分类。** 用你课上学的办法：不限时再试一次。

| 不限时能说出来吗 | 缺的是 | 处理  |
| --- | --- | --- |
| 能   | 速度  | 不需要讲解，继续按排期练 |
| 不能  | 这个说法或句子结构没掌握 | 进入第二步 |

**第二步，请模型讲解。** 插件把这句的中文、英文、关键说法、历次结果、读错的词和音发给模型，要求返回三样：

1. 这句难在哪里。
  
2. 一个更短或更简单的替代说法。
  
3. 句子太长时，拆成两句的方案。
  

你可以一键采用替代说法或拆分方案。旧卡换成新卡，语音重新合成，排期从头开始。

**和课堂 teacher 的区别**：讲解在插件内完成，用的是你配置的同一个模型，但不是课堂里的 teacher，没有它的教学流程和知识图谱。原因是插件接口只能打开已有的课堂会话，不能新建。交给真正的 teacher 需要改宿主代码，放在阶段 6。

讲解用的提示词在实现前先给你看。
## 6. 语音：合成与评分
这一节是本版新增的，对应你上一轮的四条批注。
### 6.1 合成用 ElevenLabs：测评结果
我把 4 句话用 6 个模型、2 个美式声音各合成了一遍，并用 Azure Jenny 做对照。

| 模型  | 状态  | 平均合成耗时 | 第 4 句的时长 |
| --- | --- | --- | --- |
| `eleven_v4` | 最新的旗舰模型 | 0.95 秒 | 3.6–4.0 秒 |
| `eleven_v4_turbo` | 最新的实时模型 | 0.40 秒 | 3.7 秒 |
| `eleven_v3` | 上一代 | 1.30 秒 | 3.0–3.1 秒 |
| `eleven_multilingual_v2` | 上一代，宿主现在在用 | 0.33 秒 | 2.5–2.7 秒 |
| `eleven_flash_v2_5` | 便宜、快，宿主现在在用 | 0.21 秒 | 2.5 秒 |
| `eleven_turbo_v2_5` | 已停用 | 0.20 秒 | 2.6–2.8 秒 |
| Azure Jenny | 原方案 | 约 0.5 秒 | —   |

- **哪个更像真人，需要你自己听。** 我听不到声音。试听页在 `evaluation/tts-voices/index.html`，双击打开，每行一种语音、每列一句话。
  
- **耗时不是问题。** 语音只在录入时合成一次，之后播放的都是存好的文件。
  
- **v4 说得明显更慢。** 同一句话，v4 比 flash 长约 50%。这对跟读是好事还是坏事，也要你听了再定。
  
- **一个间接迹象**：我用 Azure 的音素评分检查了这些样本。_can't_ 结尾的 t，ElevenLabs 多个样本只得 9–58 分，Azure Jenny 得 81 分。这提示 ElevenLabs 更常把这个 t 读成不爆破，接近真人口语。弱读和闪音这两项，Azure 的评分分辨不出来。
  
- **价格没查到。** 文档只说 flash 的单价是其他模型的一半。你的密钥没有读取账户信息的权限，我看不到额度。
  
### 6.2 评分用 Azure，直接放进插件
**结论：可以不依赖 Python。** 插件后端直接调 Azure 的 REST 接口。这样插件能分发给别人，对方只需自备密钥。speechcoach 不再是运行时依赖，只作为移植评分逻辑时的参考。

| 项目  | 情况  |
| --- | --- |
| 单句评分（3–10 秒） | REST 接口直接支持：音素分数、漏读和多读检测、韵律 |
| 「实际发成哪个音」 | 用 Python SDK 实测可用（见下）。REST 接口的官方文档表格里没有这个参数，只在微软的官方示例代码里出现，要在阶段 0 实测 |
| 录音长度上限 | 发音评估最长 30 秒。单句够用，整段跟读超出 |
| 录音格式 | 只收 16 kHz 的 WAV 或 OGG，不收浏览器默认录出的 WebM。所以由前端在浏览器里转成 WAV，不需要 ffmpeg |
| 费用  | 按语音转文字计费，韵律另外加收。免费档每月 5 小时语音转文字，发音评估是否计入、免费档能否用韵律，没能确认 |
| 只支持美式英语的功能 | 韵律评分、「实际发成哪个音」 |

**「实际发成哪个音」已实测可用**，但会误报。实测里 _off_ 的 /ɔ/ 被报告为「实际是 /ɑ/」，只给了 9 分，而 /ɑ/ 是正常的美式读法。所以界面上写成「听起来像 /ɑ/」，不写「读错了」。返回结果的样例存在 `evaluation/azure/pronunciation-nbest-sample.json`。
### 6.3 issue #700 里的开源模型：不采用
| 模型  | 结论  | 原因  |
| --- | --- | --- |
| KoelLabs xlsr-english-01 | 三个里最好，但不采用 | 只输出音素串，没有评分。要自己做参考音素转换、对齐、打分和阈值。需要本机跑 PyTorch。许可证是 AGPL-3.0 |
| PhoneticXeus | 不采用 | 许可证禁止商用。训练标签来自文本，不反映读错的情况 |
| allosaurus | 不采用 | 2021 年后无人维护，三个里准确率最低 |

- 没有找到任何把这些模型和 Azure 做正面对比的公开结果。
  
- 它们的论文数字参考价值有限：一个完全不听录音、只把参考文本转成音素的基线，得分和最好的模型差不多。
  
- 它们需要本机跑模型，和「能分发给别人」的目标相冲突。
  
## 7. 架构
```
插件前端 main.js（浏览器）
   │  录音：getUserMedia → 在浏览器里转成 16 kHz 单声道 WAV
   │  播放：<audio>，放慢用 playbackRate
   │  ctx.call(操作名, JSON)          ← 音频用 base64 传
   ▼
插件后端 backend.cjs（Node）
   ├─ store      句子、日程、练习记录（JSON 文件，原子写入）
   ├─ scheduler  FSRS-6
   ├─ translate  ctx.inference.complete（翻译、讲解）
   ├─ tts        fetch → ElevenLabs
   └─ assess     fetch → Azure 发音评估（REST）
```

要点：

- **没有 Python，没有 ffmpeg，没有 npm 运行时依赖。** 两个外部服务都用 Node 自带的 `fetch` 调用。
  
- **两把密钥只在后端使用**，前端拿不到。它们在插件的设置页填写，存在插件数据目录的一个单独文件里。
  
- **音频文件**存在插件的数据目录。插件的静态资源接口不提供数据目录里的文件，所以播放时由后端读出、经 `ctx.call` 以 base64 返回。
  
## 8. 数据模型
存成一个 `store.json`，写法仿照 Flashcards 的 `store.cjs`。

| 记录  | 字段  |
| --- | --- |
| 段落  | id、创建日期、场景、中文原文、句子 id 列表、第一次和最近一次完整跟读的录音文件 |
| 句子  | id、所属段落、中文、英文、关键说法、原声文件和时长、FSRS 日程（试背通过后才有） |
| 练习记录 | 句子 id、时间、类型（跟读/试背/复习）、结果、反应用时、发音分、读错的词和音素 |
| 设置  | 翻译模型、语音模型和声音、每日复习上限、三个时限参数、目标保持率、讲解提示次数 |
## 9. 复用的现有代码
以下路径都在 `~/src/tries/2026-10-17-amosblomqvist-learnharness` 里。

| 用途  | 来源  |
| --- | --- |
| FSRS-6 调度 | `plugins/flashcards/src/scheduler.cjs`（MIT，连同 `FSRS-LICENSE.txt` 一起复制） |
| 原子写入的 JSON 存储 | `plugins/flashcards/src/store.cjs` 的写法 |
| 选模型（cheap 档或手动指定） | `plugins/flashcards/src/backend.cjs:228` 附近 |
| 视图、侧栏入口、设置页的注册 | `plugins/flashcards/src/main.js:421` 附近 |
| 构建脚本 | `plugins/flashcards/scripts/build.mjs` |
| 安装到数据目录 | 作者技能包里的 `tools/install-plugin-local.mjs` |
| 类型定义 | 作者技能包里的 `types/` |
| ElevenLabs 请求的写法 | `src/server/tts.ts` |

评分结果的解析（词的错误类型、弱音素阈值）从 speechcoach 的 `scoring.py`、`result.py` 移植成 JavaScript。
## 10. 分阶段实施
每个阶段结束都有可以单独验证的结果。
### 阶段 0：验证四个没有保证的假设
先花最少的代码确认，任何一项不成立都要回来改方案。

1. 插件前端能直接用 `getUserMedia` 录音（开发模式的浏览器和桌面版都要试）。插件接口没有公开这个能力。
  
2. 浏览器里转出的 WAV，Azure 的 REST 接口能收，并返回音素分数和漏读检测。
  
3. REST 接口支持「实际发成哪个音」和 IPA 音标这两个参数。
  
4. `ctx.call` 能传一段 30 秒的 WAV（base64 后约 1.3 MB）。代码里没看到大小限制，但没实测过。
  
### 阶段 1：语音模块
- `tts`：文本 → ElevenLabs → 音频文件和时长。
  
- `assess`：WAV + 参考句 → Azure → 每个词的结果、弱音素、听起来像的音。
  
- 两个模块的测试用存好的返回样例，不联网。
  
### 阶段 2：插件骨架与录入
- 清单文件、构建脚本、视图和设置页（含两把密钥的填写）。
  
- 存储模块和它的测试。
  
- 录入流程：粘贴中文 → 选场景 → 翻译 → 确认 → 分句合成。
  
### 阶段 3：新段落的学习流程
- 听、分段跟读、完整跟读、试背四个环节。
  
- 红绿标记和「听起来像」的音。
  
- 最近若干句的平均分。
  
### 阶段 4：复习
- FSRS 排期、到期队列、每日上限。
  
- 两段时限、两个按钮、超时自动判定。
  
- 后台评分，结果补记到练习记录里。
  
- 讲解（5.5 节）。
  
### 阶段 5：可选练习
> 这一节已按「我建议这个」的选项实现，四处待定已由你确认（2026-11-14）。

两个练习都不进 FSRS，结果只记进练习记录。入口放在首页，「到期复习」下面加一栏「可选练习」。

**它们各练哪条连接**（按你课上的规律：一遍练习只加固「当时的线索 → 当时的反应」）：

| 练习  | 线索  | 反应  | 前四个阶段练过吗 |
| --- | --- | --- | --- |
| 复习  | 看到中文意图 | 说出英文 | 练过  |
| 只听一遍 | 听到英文，只有一遍 | 在时限内听懂 | 没有。跟读时看着文字，可以重听 |
| 接话  | 听到别人的问话 | 说出自己的回答 | 没有。这是闲聊里真正用到的那条 |

只听一遍

1. 从有语音的句子里随机抽 10 句，跨段落混在一起。
  
2. 每句只播一遍，不显示文字，不能重播。
  
3. 播完你选「听懂了」或「没听懂」。然后显示英文和中文。
  
4. 选「没听懂」时，用课上那张表分类，你点一下属于哪种：
  

| 看到英文后 | 缺的是 | 建议  |
| --- | --- | --- |
| 一看就懂，每个词都认识 | 声音这一端 | 回这句的分段跟读，对着文字听哪里的音变了 |
| 还是不懂 | 配对  | 这句的说法没掌握，去看讲解 |

（表里「给足时间能懂 = 缺速度」那一行用不上：只播一遍，没有可以多给的时间。）

**一个要先说清的局限**：材料是你自己写的、跟读过很多遍的句子，声音也是同一个。这些句子你大概率一听就懂，所以这个练习更像是验证，训练量有限。它对美剧听力的帮助也有限，因为合成语音没有真人语流里的那些音变。两个不花钱或少花钱的补救办法见待定 1。

- **待定 1：怎么让它有训练量。** (a) 只用现有语音，加一个「加快到 1.2 倍」的开关，不额外花钱（我建议这个）；(b) 另外用第二个声音把每句再合成一遍，听的是没听过的声音，合成费用翻倍；(c) 这个练习先不做。
  
- **待定 2：怎么确认听懂了。** (a) 自己判断，如上（我建议这个）；(b) 听完把这句复述出来，用 Azure 评分。复述更客观，但它测的是「听到 → 说出」，和复习的那条连接重叠更多。
  

接话

1. 问句以**段落**为单位：一个问句对应一整段，你的回答就是这一段里你已经背过的话。
  
2. 练习时：播问句，只播一遍，不显示文字 → 你在开始时限内按空格开口 → 说完按空格 → 显示问句的文字和这一段的英文，可以听自己的录音和原声 → 自己选「接上了」或「没接上」。
  
3. 只抽「全部句子都已进入复习」的段落。还没背下来的段落，接话时没有可说的。
  
4. 问句用另一个声音合成（默认 Eric），听起来是别人在问。
  
5. 整段回答不评分，和完整跟读一样（Azure 的接口最长 30 秒；整段评分放在下一版）。
  
6. 开始时限：问句播完后 3 秒（用设置里的「思考时间」）。超时记为没接上。
  

- **待定 3：问句从哪里来。**
  

| 方案  | 做法  | 好处  | 代价  |
| --- | --- | --- | --- |
| (a) 模型生成（我建议这个） | 在段落页点「生成问句」，模型给出 3 个「别人会怎么问，你才会说出这段话」的问句，带中文。你可以改、删，确认后合成语音 | 不用自己想；一段有几种问法，线索不单一 | 每段一次模型调用和 3 次合成 |
| (b) 你自己写 | 录入时多填一栏「别人会怎么问」 | 最贴近你的真实场景 | 你要自己想英文问句，可能不地道 |
| (c) 内置常见问句 | 插件带一份闲聊常见问句（_What have you been up to?_ 之类），你先选问句，再写回答，回答走正常的录入流程 | 问句是真实高频的 | 方向反过来了：是「先有问句再写内容」，现有段落用不上 |

- **待定 4：问句以段落为单位，还是以句子为单位。** 段落为单位（我建议这个）更像真实对话，但不能评分；句子为单位可以用 Azure 逐词比对，但一句话一个问句不自然，问句数量也多得多。
  

**提示词**：如果选 (a)，生成问句的提示词和讲解的一样，实现前先给你看。
### 阶段 5 之后的补充：快捷键和界面语言

**快捷键**只在练习页面里生效，各页面用同一套键。在输入框里打字、输入法组字、按着 ⌘/Ctrl/Alt，或者有对话框（比如设置）盖在页面上时不触发。每个练习页面底部有一行灰色小字，列出当前能用的键。

| 键 | 作用 | 出现在 |
| --- | --- | --- |
| 空格 | 开始 / 结束录音 | 跟读、完整跟读、试背、复习、接话 |
| `↓` 或 `→` 或 Enter | 下一句 / 继续 / 开始 / 好的 | 所有练习页面 |
| `↑` 或 `←` | 上一句 | 分段跟读 |
| `R` | 播放原声，再按一次停止 | 段落页和完整跟读放整段，接话放问句，其他页面放当前句 |
| `M` | 播放我的录音 | 跟读、完整跟读、卡片背面、接话 |
| `S` | 慢速原声 | 只听一遍 |
| `1` | 否定的那个：没说出来 / 没听懂 / 没接上 / 其实没听懂 / 还是说不出来 | 判定时 |
| `2` | 肯定的那个：说出来了 / 听懂了 / 接上了 / 能说出来 | 判定时 |
| `A` | 想不起来，看答案 | 试背 |
| `E` | 讲解 / 看讲解 | 卡片背面 |

「只听一遍」里的「一看就懂 / 看了还是不懂」按屏幕顺序用 `1` / `2`。删除、采用替代说法或拆分、返回没有快捷键；首页、录入页、设置页也没有。按键是固定的，不能自定义。

**界面语言**在插件设置的「界面语言 / Language」里选，默认中文。按钮、提示、建议、错误信息和日期格式跟着切换；你自己写的中文、问句的中文翻译和模型的讲解不变（讲解始终用中文）。切换后练习页面立刻用新语言重画，侧边栏入口和页面标题要重启应用才更新；插件列表里的名称不变。

实现上，代码里的中文就是英文对照表的键：前端的对照表在 `src/frontend/en.js`，后端的在 `src/backend/messages-en.cjs`。`tests/i18n.test.cjs` 检查每一句界面文字都有英文、占位符一致、没有绕过翻译的中文。

### 补充：母语和学习语言

原来的插件写死了「中文 → 英语」。现在两种语言都可以选，默认仍是中文（普通话，简体）和英语（美国）。

确认过的十一处（2026-11-14）：

1. 母语和学习语言用同一张表：Azure 发音评估支持的 33 个语言和地区。两者不能相同。
2. 语言对是一项设置，只影响之后新建的段落；每个段落记住自己建立时的语言对。复习队列可以混着不同语言的卡片。
3. 设置页加两行下拉；录入页顶部常显一行「中文（普通话，简体） → 英语（美国）」和「修改」；第一次打开插件（包括升级后的第一次）首页出现一次确认卡片。
4. 学习语言是美式英语时，书里两个角色提示词原样保留。其他学习语言用同一段文字的通用版。
5. 讲解用母语写。中文 → 美式英语继续用批准过的中文提示词，一字不改；其他语言对用内容相同的英文模板。问句用学习语言，附母语翻译。
6. 非美式英语不显示韵律分和「听起来像」。不分词的语言，逐词标记用 Azure 返回的分词。
7. 按词数的规则，对不分词的语言改按字数：每句约 40 字以内，超过 24 字才给拆分方案，问句最多 24 字。
8. 读题速度的单位跟母语走：中、日、韩、泰、粤按每秒字数（默认 5），其他按每秒词数（默认 3）。改母语时重置为对应默认值。
9. 存储字段改名：`zh`/`en` 改为 `native`/`target`，`chinese` 改为 `source`，`readingCharsPerSecond` 改为 `readingSpeed`。启动时把第 1 版的数据一次性转成第 2 版。
10. 声音设置不变，合成请求里加 `language_code`。
11. 界面语言仍只有中文和英文；插件 id 和显示名不改；麦克风测试仍读那句英文并按美式英语评分。

实测结果（2026-11-14，`scripts/language-check.mjs`）：

- 33 个语言和地区各合成一句（`eleven_v4`、Jessica）再送去评分，全部成功。发音总分最低 83.6（越南语），最高 100；日语 87，粤语 90，德语 92，普通话 98。所以不需要按语言换默认声音。
- 五个语音模型都接受 `language_code`（用日语各试了一次）。
- 只有美式英语返回韵律分。音素的名字只有美式英语（IPA）和普通话（音节加声调，如 `qi 4`）有，其他语言的音素名是空的。
- 中文、日语、泰语、粤语的 `Words` 是服务自己分的词（今天 / 天气 / 很 / 好），参考文本按空格切分对不上，所以直接显示服务返回的词，词之间不加空格。

通用提示词由三个文件里的模板生成（`translate-prompts.cjs`、`explain-prompts.cjs`、`question-prompts.cjs`），填入两种语言的名字。下面是「英语 → 日语」生成出来的全文。和批准过的版本相比，改动只有：语言名；学的不是英语时，`short phrasal verbs` 换成 `common everyday expressions`，关键说法的种类写成 `an idiom, a collocation or a set phrase`（学英式、澳式等其他英语时两处都保留 phrasal verbs）；去掉 `New York twist` 和 `NY Speak Easy` 这个名字；字数规则按上面第 7 条；JSON 字段名用 `native` / `target`。

#### 翻译，正式场景（英语 → 日语）

```text
Your role is to be a language guru, an expert in authentic Japanese, who assists users in expressing their thoughts clearly and fluently. You are not just translating words; you are delving into the essence of the user's message and reconstructing it in a way that maintains logical clarity and coherence. You'll prioritize the use of plain Japanese, common everyday expressions, and common idioms. It's important to craft sentences with varied lengths to create a natural rhythm and flow, making the language sound smooth and engaging. Avoid regional expressions or idioms that are too unique or restricted to specific areas. Your goal is to make Japanese accessible and appealing to a broad audience, helping users communicate effectively in a style that resonates with a wide range of Japanese speakers.

The user gives you a passage in English that they want to say in a formal setting, such as a research group meeting. Express the whole passage in Japanese and return it sentence by sentence.

The user will practise saying your Japanese aloud, one sentence at a time, with the English as the only cue. So:
- Cover everything the passage says, in the same order. Add nothing.
- Keep every Japanese sentence short enough to say in one breath: about 40 characters at most. Split a longer thought into several sentences.
- "native" is the part of the English passage that the Japanese sentence expresses. Reword it only as much as needed for it to read as a complete thought on its own.
- "key" is the one expression in the Japanese sentence that an English speaker is least likely to come up with: an idiom, a collocation or a set phrase. Copy it exactly as it appears in the sentence.
- Reply with JSON only. No commentary, no code fence.

Reply in exactly this shape:
{"sentences":[{"native":"…","target":"…","key":"…"}]}
```

#### 翻译，口语场景（英语 → 日语）的角色段

```text
You serve as a spoken-language adviser, specializing in translating the user's words into everyday spoken Japanese, focusing on common everyday expressions and idioms. You provide both a brief and a more elaborate version of each translation, all delivered in a friendly and informal tone to make interactions engaging and approachable. You avoid inappropriate analogies or metaphors and ensure culturally sensitive language. You understand and interpret the context of the user's statements, offering various versions for the user to choose from.
```

#### 讲解（英语 → 日语）

```text
You are a speaking coach for Japanese. The learner, whose own language is English, wants to say in Japanese what they mean in English. They are memorizing the Japanese sentence below, but have failed to say it several times, and cannot say it even without a time limit. Find where they get stuck and give a wording that is easier to say.

Rules:
- Explain in English; keep Japanese examples in Japanese.
- The difficulties must be specific to this sentence: point to a phrase, a sentence structure, or a place where English and Japanese express things differently. No general grammar lessons. At most three points, one or two sentences each.
- The simpler wording must say the same thing, suit speech, and be shorter or simpler than the original. Keep the key expression where possible; if the key expression is itself the difficulty, replace it and say why.
- Offer a split only when the original is longer than 24 characters: two sentences, each sayable on its own, each with its meaning in English. Otherwise set "split" to null.
- Mispronounced words and sounds are for reference only: mention them only when they clearly get in the way of speaking; do not correct pronunciation item by item.
- Reply with JSON only, no other text:
  {"difficulty":["…"],"simpler":{"target":"…","why":"…"},"split":[{"native":"…","target":"…"},{"native":"…","target":"…"}]}
```

#### 问句（英语 → 日语）

```text
The learner has memorized a short Japanese passage that says something they want to say in real life. Write 3 different questions that another person might naturally ask, to which this passage would be a natural spoken answer. For the formal register the asker is a colleague in a meeting; for the casual register, a friend in small talk.

Rules:
- Each question is one short spoken sentence, at most 24 characters, in everyday Japanese.
- The three differ in wording and angle, so the learner does not get used to one cue.
- Do not give away the answer: avoid reusing the passage's key expressions.
- Add an English translation of each question.
- Reply with JSON only: {"questions":[{"target":"…","native":"…"}]}
```

数据升级（`src/backend/store-upgrade.cjs`）：读到第 1 版的 `store.json` 时，先把原文件原样另存为同目录下的 `store.v1.json`（已存在就不覆盖），再在内存里改名、给每个段落记上「中文（普通话，简体） → 英语（美国）」。转换后的内容在下一次有改动时才写回 `store.json`。练习记录、排期和音频文件不动。0.1.0 读不了第 2 版的文件，要退回旧版得把 `store.v1.json` 改回 `store.json`。

### 阶段 6：先学一遍，由课堂 teacher 讲解
**要解决的问题**：录入一段后直接进入跟读和背诵，没有「先学懂」这一步。不认识的词、没听出来的声音、和母语不一样的结构，都留到背不出来的时候才暴露。

**方法来源**：泡芙方《20 天突破英语听力》第一部分的六节课。和这一步有关的要点：

| 课里的说法 | 落在哪里 |
| --- | --- |
| 先常速听一遍热身，了解自己能听懂多少（第 3 课） | 摸底第一步 |
| 听一句复述一句，和原文对照找出缺口；严格版是听写（第 3 课） | 摸底：逐句复述并评分 |
| 每个词都要确认看得懂，不能靠猜（第 6 课） | 摸底：点出不认识的词；teacher 逐个确认 |
| 不背连读、弱读规则，把一团声音当成一个整体来认（第 2 课） | teacher 的讲解方式 |
| 弄懂之后朗读三遍，读的时候意思同步在心里过（第 3、6 课） | 朗读 |
| 变速听 1 → 1.5 → 2 → 3 倍再降回来；基础弱时每个速度听三遍，跟不上就看着文本听（第 3、6 课） | 变速听 |
| 影子跟读、逐句背诵、按间隔复习（第 3、5 课） | 已有的跟读、试背和复习 |

**你定下的四件事**（2026-11-14）：

1. 用课堂里真正的 teacher 讲解；测试放在插件里，因为只有插件能放音、录音和评分。

2. 点「交给老师」后由插件新建课堂会话并打开。这走的是宿主的非公开接口，先验证。

3. 发音不讲规则。teacher 把没听出来的地方当作一整块声音来讲，你问了才讲连读、弱读。

4. 这一步可选，排在跟读之前，可以跳过。


**流程**：段落页最上面多一行「先学一遍（可选）」，三个入口按顺序排列，都可以单独进。

1. **摸底**（`diagnose-screen.js`）

  - 先不显示文本，常速听整段一遍。

  - 然后逐句：听这一句（可以重听）→ 不看文本复述并录音 → Azure 对照原句评分 → 显示原文和母语意思，没说出来的词划掉、说得不清楚的词标红 → 点出不认识的词，相邻的词算一个短语 → 下一句。

  - 复述不出来可以点「说不出来，看原文」，这一句记为「没能复述」，照样可以点词。

  - 每句存三样：没说出来的词、说得不清楚的词、不认识的词或短语。复述的录音不进练习记录。

  - 点「开始逐句摸底」时才清掉上一次的结果；中途退出，已做的句子保留。

2. **摸底结果**（`gaps-screen.js`）：逐句列出缺口，下面是「交给老师」「朗读和变速听」「重新摸底」。

3. **交给老师**（`lesson-start.js`、`lesson.cjs`）

  - 插件新建一节课，第一条消息是「教我「开口练习」里的这一段：<第一句的母语原文>」，自动发出并打开。课的标题也是这句话。

  - 插件给课堂里的 prober 和 teacher 加一个工具 `speaking_practice_lesson`，只在由插件开的课里出现。它返回这一段的句子、母语意思、关键说法、每句的摸底结果和讲解要求。

  - 插件另外给这两个代理加一句固定指令，见下。别的课里没有这个工具，这句指令不起作用。

  - 没做摸底也可以交给老师，讲解要求会换成「先问清楚哪些词和句子不懂」。

  - 开过课之后，按钮变成「打开这节课」和「重新开课」（要点两次确认）。

  - 应用里没有配置上课用的模型时不新建会话，直接提示去配置。

4. **朗读和变速听**（`consolidate-screen.js`）

  - 朗读：显示全文，自己读，读完一遍点一次，不录音。显示「已读 n 遍（建议 3 遍）」。

  - 变速听：整段按 1 → 1.5 → 2 → 3 → 2 → 1.5 → 1 倍连续播放。开始时自动收起文本，可以再打开；有「每个速度听 3 遍」的开关。听完一整轮才计数。


之后接现有的分段跟读 → 完整跟读 → 试背 → 复习，不变。

**固定指令的全文**（英文，进入每节课的 prober 和 teacher 的系统提示词）：

```text
If the tool speaking_practice_lesson is available, this session was started from the Speak English plugin: call it before anything else and follow the guide it returns.
```

**讲解要求的全文**（工具返回内容的最后一部分，英文；`{native}` 和 `{target}` 换成语言名；`src/backend/lesson-guide.cjs`）。prober 和 teacher 读到的是同一份：teacher 接着 prober 的对话往下讲，不一定会再调用一次工具。

```text
The learner is about to drill this passage aloud in the Speak English plugin (its sidebar entry reads "开口练习" or "Speak English"): shadowing, then reciting each sentence from memory, then spaced review. This session is the step before that. Its goal is that the learner understands every word and every sentence of the passage, so that the later practice is not parroting. The goal is fixed: do not ask the learner what it is.

What the diagnostic means. The learner heard each sentence once without seeing it and repeated it aloud; the recording was scored against the sentence. "Not said" lists the words that were missing from the repetition: the learner may not have caught them by ear, may not know them, or may only have forgotten them. "Said unclearly" lists the words the scoring heard as something else. "Marked unknown" lists the words and phrases the learner marked as not understood after seeing the text. "Could not repeat" means the learner could not say the sentence back at all. A sentence with none of these had no gap.

While probing. The passage is the whole territory: do not probe the learner's general level of {target}. The lists are the learner's own account and can be optimistic. Spot-check them: for a few of the "Not said" and "Said unclearly" words, find out whether the learner knows what the word means in this sentence (then the gap is the sound) or not (then the gap is the word). Check the key expressions the learner did not mark the same way. About five questions in all are enough. Explain nothing while probing. When you conclude the probe, name one strand per sentence that has a gap, and say for each item whether it is a word the learner does not know or a sound they did not catch.

While teaching:
- Go through the sentences that have gaps, in order. Leave the other sentences alone unless the learner asks.
- A word the learner does not know: give its meaning in this sentence and one more short example. Do not accept guessing; check that the learner can now say what it means here.
- A word the learner knows on paper but did not catch or said unclearly: the problem is the sound, not the meaning. Do not teach rules of linking, reduction or elision, and do not drill single sounds, unless the learner asks. Treat the stretch of the sentence around the word as one chunk of sound with one meaning, the way "not at all" is heard as a single unit. Spell out roughly how the chunk sounds at natural speed and tell the learner to listen for it as a whole.
- A structure that works differently from {native}: say what differs in one or two sentences. No general grammar lessons.
- Each sentence's key expression is the part the learner is least likely to come up with. Make sure it is understood even when it was not marked.
- You cannot play audio and cannot hear the learner. Do not pretend to. Listening and speaking come next, in the plugin.
- When every gap is covered, close the session: tell the learner to go back to the plugin, read the passage aloud three times with the meaning in mind, do the speed-listening run, and then start shadowing.

Throughout, ask and explain in {native}; keep {target} words and examples in {target}.
```

没有摸底结果时，其中两处换成：

```text
The learner has not taken the listening diagnostic for this passage, so nothing is known yet about where the gaps are.

While probing. The passage is the whole territory: do not probe the learner's general level of {target}. Ask which words and sentences the learner does not understand, then check each sentence's key expression: can the learner say what it means here? About five questions in all are enough. Explain nothing while probing. When you conclude the probe, name one strand per sentence that has a gap, and say for each item whether it is a word the learner does not know or a sound they did not catch.
```

**数据**：段落上新增三项，都可以没有，所以不改存储版本号，旧数据照常能读。

| 字段 | 内容 |
| --- | --- |
| `diagnosis` | 摸底时间；每句是否复述了、没说出来的词、说得不清楚的词、点出的不认识的词或短语 |
| `lesson` | 课堂会话的编号和开课时间 |
| `consolidation` | 朗读了几遍、变速听完成了几轮、最近一次的时间 |

**这一版不做**：噪音训练；把 teacher 的讲解存回插件的句子；在课堂里直接放音和录音（需要自定义题型）。

**验证结果**

- 先验证（`spikes/phase6/`）：一个一次性的小插件在开发实例里确认了三件事。插件前端照宿主首页的做法新建会话并留下第一条消息，`ctx.app.openSession` 打开后消息自动发出；prober 的第一个动作就是调用插件的工具；工具拿到的会话编号和新建的一致。

- 离线测试共 203 个全部通过，其中 20 个是这一阶段新增的（`tests/study.test.cjs`）。

- 一次独立的代码审查提出 13 处问题，修了 11 处，修完后界面走查重跑通过。没修的两处：点词只能用鼠标，不能用键盘；摸底词表的长度上限偏宽（每句三个列表，各最多 200 项、每项 400 个字符），界面走不到这个上限。

- 界面走查（`scripts/ui-walkthrough-study.mjs`，真实调用 ElevenLabs、Azure 和模型）全部通过：摸底里一句复述并评分、一句放弃，点词；结果页；交给老师后课自动打开、第一条消息发出、工具返回段落和摸底结果；朗读计数；变速听跑完一轮并计数。

- 用 `deepseek-v4-pro` 把一节课推进到了讲解阶段：prober 只针对标出的词提问，摸底结论按句区分了「声音缺口」和「词义缺口」；teacher 的教学计划是「不教词义，只教怎么整块听」和「习语直接给意思，配一个例句」，没有再调用工具，用的是对话里已有的讲解要求。


**没有验证到的**：teacher 逐步讲解的全过程（只看到了计划）；你平时上课用的模型；中文到英语以外的语言对；没做摸底就交给老师的那条路径只有离线测试。
### 下一版再做
- **整段跟读评分**：引入微软的 JS 语音 SDK（约 5.6 MB）做连续识别，给整段一个分数和红绿标记。做之前先验证这个 SDK 能否打包进插件后端。
  
## 11. 验证方式
| 层面  | 做法  |
| --- | --- |
| 插件后端 | `node --test`：存储、调度、翻译结果解析、两个语音模块（用存好的返回样例） |
| 语音模块联网 | 各手动跑一次真实请求，核对返回结果 |
| 插件整体 | 安装到数据目录并启用，完整走一遍：录入一段 → 四个学习环节 → 把日期拨到次日做一次复习 → 触发一次讲解 |
| 禁用与重启 | 禁用再启用、重启应用后，数据仍在 |
## 12. 风险
- **录音走的是非公开途径。** 插件接口只有听写控件，给文字不给音频。宿主升级后可能失效。阶段 0 先验证。
  
- **交给老师走的也是非公开途径。** 新建课堂会话用的是宿主自己的 `POST /api/chats`，第一条消息留在 `sessionStorage` 的 `lh.openingPrompt.<会话编号>` 里，由课堂页面发出。两处都不在插件接口里，宿主升级后可能失效。失效时点「交给老师」会报错，不影响别的练习。
  
- **「听起来像」会误报。** 正常的口音变体也会被标出来，见 6.2 节。
  
- **整段跟读超过 Azure 的 30 秒上限。** 第一版不给整段评分，下一版引入微软的 JS SDK 解决。
  
- **复习量会累积。** 由每日上限 50 次兜底。
  
- **调度参数未必适合开口练习。** 靠练习记录事后校准，见 5.3 节。
  
- **三处花钱**：翻译和讲解用你配置的模型，合成用 ElevenLabs，评分用 Azure。
  
- **分发给别人时**，对方需要自备 Azure 和 ElevenLabs 两把密钥。许可证是 AGPL-3.0-only，和 LearnHarness 相同（调度代码和存储的写法取自它的 Flashcards 插件）。
  
## 13. 待你确认
快捷键和界面语言实现时我另外定的几处：

1. 每一轮结束后的小结页上，`↓` / Enter 也能按主按钮（「回到段落」「回到首页」）。「再来一轮」和等待重试时的「先到这里」没有键。
  
2. 有对话框（比如设置）盖在练习页面上时，所有快捷键都不起作用。
  
3. 按键提示里每个键后面写的是对应按钮的文字，例如「↓ 开始复习」「1 没说出来 · 2 说出来了」。
  
4. 完整跟读页里 `M` 放最近一次的录音；接话的回答页里「整段原声」没有键（`R` 给了问句）。分段跟读的「再听一遍」没有单独的键（`R` 作用相同）。
  
5. 小键盘的 `1`、`2` 和 Enter 同样有效。
  
6. 在设置里切换语言后，练习页面当场用新语言重画；如果正练到一半，当前这一页会从头开始。
  
7. 英文界面的用词：分段跟读 Shadowing、完整跟读 Read-along、试背 Recall、到期复习 Due reviews、只听一遍 Listen once、接话 Respond、说出来了 Said it、没说出来 Missed it、讲解 Explain。全部英文在 `src/frontend/en.js` 和 `src/backend/messages-en.cjs`。
  

母语和学习语言实现时我另外定的几处：

1. 把一边选成另一边已有的语言时，两者对调。否则用两个下拉框没法把「中文 → 英语」换成「英语 → 中文」。
2. 读题速度的设置只用于和当前母语同一种算法（按字或按词）的段落。算法不同的旧段落用那种算法的默认值（每秒 5 个字或 3 个词）。
3. 试背和复习的卡片上，「场景」后面加学习语言的名字（如「场景：正式（组会） · 日语」）；首页段落列表的摘要里也加。混着几种语言时，光看母语的题目不知道该说哪种语言。
4. 确认卡片点「修改」时就算已确认，两个下拉框在卡片里原地出现；录入页的「修改」也是原地展开。
5. 没有名字的音素不显示，也不进练习记录。普通话的提示写成「今天：/jin 1/ 不够清楚」。
6. 界面上的字段用语言的简称（「中文意图」「日语」），原来写「英文」的地方现在是「英语」。后端的错误信息不提具体语言（「两种语言的内容都不能为空」）。
7. 模型回复里的字段名：中文 → 美式英语沿用 `zh` / `en`，这样批准过的提示词一个字符都不变（测试里有校验）；其他语言对用 `native` / `target`。
8. 每句的长度上限统一为 400 个字符（原来中文 300、英文 400）。
9. 升级前把旧文件另存为 `store.v1.json`。
10. 录入页的篇幅提示和计数跟母语走：「100 到 150 字」或「60 到 100 词」。
11. 版本号还没改。存储格式变了，发布时建议定为 0.2.0。

通用提示词的全文和上面十一处已在 2026-11-14 确认；新版已装进桌面应用，重启后第一次启动会转换真实数据并留下 `store.v1.json`。版本号、提交和发布和阶段 6 一起做，见 0.2.0。

阶段 6（先学一遍）实现时我另外定的几处：

1. 摸底每句存三样：没说出来的词、说得不清楚的词、点出的不认识的词或短语。「哪里需要讲解」不单独记，由 teacher 根据这三样和每句的关键说法判断。
2. 复述不出来时可以点「说不出来，看原文」，这一句记为「没能复述」。
3. 点词时相邻的词合成一个短语。不分词的语言在没有评分时用浏览器自带的分词。
4. 摸底里的复述不进练习记录，不影响「常读错的词」和跟读平均分。
5. 摸底需要 Azure 评分和已合成的语音；有句子没语音时提示先回段落页合成。
6. 点「开始逐句摸底」时才清掉上一次的结果。摸底结果单独一页，做过之后段落页的按钮变成「摸底结果」。
7. 课的第一条消息（也是课的标题）是「教我「开口练习」里的这一段：」加第一句的母语原文，最多 60 个字符，用界面语言。
8. prober 和 teacher 读同一份讲解要求。原因：teacher 接着 prober 的对话，实测它不会再调用一次工具。
9. 讲解要求里你没有逐条看过的内容：prober 不问目标、不测整体水平、抽查约五个问题、只测不讲，结束时按句说明是词的缺口还是声音的缺口；teacher 不逐个音纠正、每句的关键说法即使没标也要确认、不假装能放音、讲完后让你回插件朗读三遍和变速听。
10. 「重新开课」要点两次确认。旧的那节课不删除，只是段落改为指向新的课。
11. 应用里没有配置上课用的模型时不新建会话，直接提示。宿主版本太旧、不能扩展课堂代理时，点「交给老师」提示更新应用。
12. 朗读自己点「读完一遍」，不录音不评分，显示累计遍数。变速听开始时自动收起文本，中途停止的一轮不计数，快捷键 R 开始或停止。
13. 版本号在确认前不改。
14. 录复述的时候不能放原声，否则麦克风会把答案录进去。
15. 评分后显示的词和原句对不上时（不分词的语言总是这样，评分服务会去掉标点），在标记的词上面多显示一行原句。
16. 采用讲解里的替代说法或拆分后，被替换的那句的摸底结果一并删除；一段里的摸底结果删光了，就当作没摸过底。
17. 一节课只属于一个段落。「交给老师」中途失败后再点，接着用上次建好的那节课，不再多建一节。
18. 点了「交给老师」又离开这一页，课照样建好并记在段落上，但不会自动跳到课堂。

讲解要求的全文（见「阶段 6」）和上面十八处已在 2026-11-14 确认。

## 14. 决定记录
| 日期  | 决定  |
| --- | --- |
| 2026-11-13 | 独立的每日练习视图；内容来自自己写的中文；只有「中文意图 → 开口」进 FSRS |
| 2026-11-13 | 代码放独立目录，id 为 `speak-english`；每日上限 50 次；目标保持率 95%；两段时限 |
| 2026-11-13 | 合成改用 ElevenLabs；评分用 Azure 并直接放进插件，不再依赖 speechcoach；不采用 issue #700 里的开源模型 |
| 2026-11-13 | 密钥存插件自己的设置页；韵律评分在复习时也开；第一版只逐句评分，下一版加整段评分 |
| 2026-11-13 | 「上游可能做同类插件」不算风险，先做出来自用 |
| 2026-11-14 | 阶段 2 的六处细节确认：名称、口语两版整段二选一、提示词的输出规则、确认页可改不可增删、上限、保存后逐句合成 |
| 2026-11-14 | 默认声音用 Jessica。「听起来像」只在音素分数低于 60 时给；一个参考词都没听到时算出错；合成模块只返回音频和时长，存文件由存储层负责 |
| 2026-11-14 | 阶段 3 的七处细节确认：试背只限说话时间、可以直接看答案、跟读录音最长为原声 3 倍、平均分取最近 10 次、完整跟读默认同时播放原声、四个环节不强制顺序、跟读和试背的录音不落盘 |
| 2026-11-14 | 讲解提示词的措辞确认（`src/backend/explain-prompts.cjs`）；原句超过 12 个词才给拆分方案 |
| 2026-11-14 | 阶段 4 的十处细节确认：每日上限按次算、重试排最前、点「开始复习」才计时、复习卡没有「看答案」按钮、时限的取整和上下限、不限时重试由自己判断、讲解提示的计数方式、讲解结果保存在句子上、采用后换卡并删除原句记录、12 个词的拆分门槛在代码里强制 |
| 2026-11-14 | 阶段 5 的十一处确认：「只听一遍」用现有语音加 1.2 倍开关、由自己判断；「接话」的问句由模型生成（提示词在 `src/backend/question-prompts.cjs`）、以段落为单位且不评分；可改口「其实没听懂」；归为声音后可再听和慢速听；每轮最多 5 段、每段随机一个问句；每段最多 6 个问句、一次生成 3 个；问句放完才能开口、回答最长为整段原声的 2 倍且不超过 3 分钟；「接上了」不要求一字不差或说完整段；新设置「问句的声音」默认 Eric |
| 2026-11-14 | 加快捷键和界面语言（中文 / English）。确认的八处：语言设置默认中文、标签双语；按钮、提示、建议、错误信息、日期都切换；讲解始终用中文；侧边栏入口重启后更新、插件列表名称不变；按键表（空格、方向键和 Enter、R、M、S、1、2、A、E）；「一看就懂 / 看了还是不懂」用 1 / 2；页面底部加按键提示；删除、采用、返回不给键，按键不可自定义 |
| 2026-11-14 | 代码公开在 GitHub（`wangdepin/speak-english-plugin`），许可证 AGPL-3.0-only；发布 0.1.0，发布包是 `speak-english-0.1.0.zip` 加 SHA-256 校验和 |
| 2026-11-14 | 加母语和学习语言两项设置，默认中文（普通话，简体）和英语（美国）。确认的十一处见「补充：母语和学习语言」：33 种语言、设置只影响新段落、首次确认卡片、美式英语保留书里的提示词而其他语言用通用版、讲解用母语、非美式英语不显示韵律和「听起来像」、不分词的语言按字数、读题速度的单位跟母语、存储字段改名并升级旧数据、声音不变加 `language_code`、界面语言和插件名不动 |
| 2026-11-14 | 通用提示词的全文确认（`src/backend/translate-prompts.cjs`、`explain-prompts.cjs`、`question-prompts.cjs` 里的通用版）；第 13 节里母语和学习语言的十一处自定决定确认；同意把新版装进桌面应用并升级已有数据 |
| 2026-11-14 | 加「先学一遍」（阶段 6），方法参考泡芙方《20 天突破英语听力》第一部分。确认的四处：用课堂里真正的 teacher 讲解、测试放在插件里；点「交给老师」由插件新建课堂会话并打开，先验证；发音不讲规则，按整块声音讲，问了才讲连读弱读；这一步可选，排在跟读之前 |
| 2026-11-14 | 阶段 6 讲解要求的全文（`src/backend/lesson-guide.cjs`）和第 13 节里阶段 6 的十八处自定决定确认；同意装进桌面应用，提交、推送并发布 0.2.0（母语和学习语言、先学一遍） |
