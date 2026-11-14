# 英语开口练习 — LearnHarness 插件

[English](./README.md)

把自己想说的中文变成能脱口而出的英语。贴一小段中文，插件把它翻译成英文、合成原声，然后带你听、分段跟读、完整跟读、试背。说得出来的句子进入间隔复习：卡片只显示中文意图，你要在几秒内开口。

这是 LearnHarness 的社区插件（`apiVersion: 1`，id `speak-english`，`minAppVersion 0.7.0`）。界面有中文和英文两种。

## 方法

插件照着李笑来《1000 小时》的流程做：用母语写下想说的话，转成英文和语音，跟读，背诵，复习。它改了其中两处，并加了时限：

1. **练自己的句子。** 内容不来自教材，是你在组会或闲聊里真要说的话，场景可选正式或口语。
2. **线索是意思，不是上一句。** 整段背诵练的是「第 2 句带出第 3 句」。这里的卡片给中文意图、要英文，和真实对话里的线索一致。只有这个方向进入排期。
3. **每句按自己的遗忘进度排期。** 复习用 FSRS-6，目标保持率 95%，有每日上限，不是「周日复习一周」。
4. **开口有时限。** 连接存在但太慢，在对话里用不上。复习卡给你读完中文的时间，再加几秒思考；来不及开口就算没说出来。没说出来的卡 10 分钟后再来。
5. **你来判定，分数只供参考。** 两个按钮：「说出来了」或「没说出来」。发音评分在后台算，逐词标记，但不影响排期。
6. **总说不出来的句子，先分清缺什么，再讲解。** 先不限时再说一遍。能说出来，缺的只是速度，不讲解。说不出来，再请模型讲这句难在哪里，并给出更简单的说法或拆成两句的方案，你可以采用来替换原句。

完整的设计、每条规则的理由和决定记录在 [`docs/plan.md`](./docs/plan.md)。

## 需要自备

| 用途 | 服务 | 在哪里填 |
| --- | --- | --- |
| 翻译、讲解、问句 | LearnHarness 里配置的模型（默认用 cheap 档） | 应用设置，或本插件设置里另选 |
| 原声 | ElevenLabs 密钥 | 本插件的设置页 |
| 发音评分 | Azure 语音密钥和区域 | 本插件的设置页 |

三者都是你自己的账号，都可能产生费用。插件只把各自需要的内容发过去：中文原文发给模型，讲解时再加上这句话和你的练习次数；英文句子发给 ElevenLabs；一句话的录音（最长 30 秒）和它的参考文本发给 Azure。

其余都留在本机的插件数据目录里：段落和练习记录、原声、每段第一次和最近一次的完整跟读录音，以及两把密钥（`secrets.json`，仅本人可读，保存后界面不再显示）。分段跟读、试背和复习时的录音评分后就丢弃。

## 安装

需要：LearnHarness 0.7.0 或更高版本，较新的 Node.js 和 npm。

```sh
git clone https://github.com/wangdepin/speak-english-plugin.git
cd speak-english-plugin
npm ci
npm run install:local -- "<数据目录>"
```

`<数据目录>` 是应用的数据目录；macOS 桌面版是 `~/Library/Application Support/MasteryHarness/data`。这条命令先构建，再装到 `<数据目录>/plugins/speak-english/dist/`：

```text
speak-english/
  dist/
    manifest.json
    main.js           # 浏览器端 ES 模块
    backend.cjs       # Node CommonJS
    styles.css
    FSRS-LICENSE.txt
  data/               # 你的段落、密钥和音频，不随插件分发
```

在 **Settings → Community plugins** 里启用「英语开口练习」，再到插件设置里填两把密钥和 Azure 区域。同一页的「测试麦克风和评分」可以一次检查麦克风、密钥和区域。

更新时再跑一次 `npm run install:local`，然后重启 LearnHarness。安装只替换 `dist/`，不碰旁边的 `data/`。

## 流程

插件在侧边栏加一个「开口练习」入口（英文界面叫 Speak English）。它和上课互相独立：不读你的课程，课堂里也不会调用它。

1. **录入。** 写 100 到 150 字中文，选正式或口语，翻译。英文只需整段确认一次，每句的中文意图、英文和关键说法都可以改。保存后合成原声。
2. **听。** 整段或单句，原速或放慢。
3. **分段跟读。** 听一句，录一句，看每个词是读对、读得不准、漏读还是多读，以及不清楚的音听起来像什么。
4. **完整跟读。** 戴着耳机跟着原声录下整段。保留第一次和最近一次的录音，方便以后对比。
5. **试背。** 看中文意图说英文。说出来的句子第二天进入复习，其余的明天再试背。
6. **复习。** 每天做到期的卡：读中文，在倒计时结束前开口，对照答案和自己的录音，然后自己判定。

另有两个不排期的可选练习：

- **只听一遍。** 每句只放一遍，没有文字，可以加快到 1.2 倍。没听懂的句子，看到文字后再分：一看就懂是缺声音这一端，看了还是不懂是缺配对。
- **接话。** 针对你背过的段落问一个问题，换一个声音，只问一遍，你用背过的话回答。问句由模型建议，你确认后才保存。

## 快捷键

各练习页面用同一套键，页面底部有一行列出当前能用的键。

| 键 | 作用 |
| --- | --- |
| 空格 | 开始 / 结束录音 |
| `↓`、`→` 或 Enter | 下一句、继续、开始 |
| `↑` 或 `←` | 上一句（分段跟读） |
| `R` | 播放原声，再按一次停止 |
| `M` | 播放我的录音 |
| `S` | 慢速播放（只听一遍） |
| `1` | 否定的判定：没说出来、没听懂、没接上 |
| `2` | 肯定的判定：说出来了、听懂了、接上了 |
| `A` | 想不起来，看答案 |
| `E` | 讲解 |

删除、采用新说法和返回特意不给快捷键。在输入框里打字或有对话框打开时，快捷键不起作用。

## 设置

| 设置 | 默认 | 含义 |
| --- | --- | --- |
| 界面语言 | 中文 | 中文或 English。模型的讲解始终是中文 |
| 语音模型、声音 | `eleven_v4`、Jessica | 合成原声用的 ElevenLabs 模型和声音 |
| 问句的声音 | Eric | 「接话」练习里提问的声音 |
| 每日复习上限 | 50 | 每天复习的次数，重试也算 |
| 目标保持率 | 95% | FSRS 的目标；越高间隔越短 |
| 读题速度、思考时间 | 每秒 5 个字、3 秒 | 开始时限 = 中文字数 ÷ 读题速度 + 思考时间 |
| 说话时限 | 2 倍 | 说一句话的时间，按原声时长的倍数算 |
| 几次没说出来后提示讲解 | 3 | 从上次讲解之后算起 |
| 模型 | 跟随 cheap 档 | 翻译、讲解和问句用的模型 |

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/backend/backend.cjs` | 前端调用的各项操作；启动 |
| `src/backend/store.cjs`、`secrets.cjs`、`audio-files.cjs` | `ctx.dataDirectory` 下的原子写入存储、密钥和音频文件 |
| `src/backend/translate*.cjs`、`explain*.cjs`、`question*.cjs` | 模型的提示词、请求和回复解析 |
| `src/backend/review.cjs`、`attempts.cjs`、`scheduler.cjs` | 到期队列、练习记录、FSRS-6 |
| `src/backend/speech/` | 用 REST 调 ElevenLabs 合成和 Azure 发音评估 |
| `src/frontend/*-screen.js` | 练习视图的每个页面各一个文件，以及设置页 |
| `src/frontend/shortcuts.js`、`shortcut-keys.js` | 快捷键和按键提示 |
| `src/frontend/i18n.js`、`en.js`、`src/backend/messages*.cjs` | 两种语言的界面文字 |
| `scripts/` | 构建、安装、录制样例、联网检查、界面走查 |
| `tests/` | Node 自带的测试，用录好的服务返回，不联网 |
| `docs/` | 设计、阶段 0 的验证结果 |
| `evaluation/`、`spikes/` | 前期的语音测评和阶段 0 的验证代码，不属于插件本身 |

## 开发

```sh
npm test            # 离线测试
npm run check       # 所有源文件的语法检查
npm run build       # 产出 dist/
```

运行时没有依赖，开发依赖只有 esbuild。测试重放从真实服务录下的返回，不需要密钥，也不联网。

界面文字在代码里写中文并包在 `t('…')` 里，英文写进 `src/frontend/en.js` 或 `src/backend/messages-en.cjs`，键就是那句中文。模块顶层的常量用 `mark('…')` 标记，显示时再翻译。漏了英文、占位符对不上或者有中文没包起来，`npm test` 会报。

下面的脚本会调用真实服务，花一点额度。界面走查用无界面的 Chrome 操作一个临时的 LearnHarness 实例，拿一个 WAV 文件当麦克风；其中三个会删掉实例里的全部段落，只能对着临时数据目录跑。

```sh
node scripts/live-check.mjs <含 SPEECH_KEY/SPEECH_REGION 的 .env> <含 ELEVENLABS_API_KEY 的 auth.json>
node scripts/ui-walkthrough.mjs <learnharness 仓库> <应用地址> <假麦克风 WAV> <截图目录>
node scripts/ui-walkthrough-practice.mjs  <仓库> <应用地址> <假麦克风 WAV> <截图目录> <.env> <auth.json>
node scripts/ui-walkthrough-review.mjs    <仓库> <应用地址> <假麦克风 WAV> <截图目录> <.env> <auth.json> <临时数据目录>
node scripts/ui-walkthrough-exercises.mjs <仓库> <应用地址> <假麦克风 WAV> <截图目录> <.env> <auth.json> <临时数据目录>
node scripts/ui-walkthrough-keys.mjs      <仓库> <应用地址> <假麦克风 WAV> <截图目录> <.env> <auth.json> <临时数据目录>
```

用 `next dev` 跑界面走查前，先在浏览器里打开一次首页 `/`，等它编译完；否则开发服务器的热更新会让插件页面反复刷新。更新插件后要重启应用，否则宿主会报 `Restart required: plugin package changed`。

## 还没做

- 完整跟读的整段评分（现在只录音存档）。
- 把讲解交给 LearnHarness 课堂里的 teacher。
- 可下载的发布包；目前要从源码构建。

## 许可证

[AGPL-3.0-only](./LICENSE)，和 LearnHarness 相同：调度代码和存储的写法取自它的 Flashcards 插件。`src/backend/scheduler.cjs` 的部分代码改编自 ts-fsrs（MIT 许可证），见 [`FSRS-LICENSE.txt`](./FSRS-LICENSE.txt)。两个翻译提示词以李笑来《1000 小时》里公开的 GPT 指令为基础。
