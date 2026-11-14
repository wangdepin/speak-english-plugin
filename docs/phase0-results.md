# 阶段 0 结果：四个假设的验证

日期：2026-11-14。结论：四项在开发模式下全部通过；桌面版的录音还没有实测。

## 结果

| # | 假设 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 插件前端能直接用 `getUserMedia` 录音 | 开发模式通过。桌面版未测 | 试验插件在 Chrome 157 里录到 3.96 秒的 `audio/webm;codecs=opus`，32 KB |
| 2 | 浏览器转出的 WAV，Azure 的 REST 接口能收 | 通过 | 录音在浏览器里转成 16 kHz 单声道 WAV（127 KB），Azure 识别为 "I'll tell him about it."，准确度 99，完整度 100 |
| 3 | REST 接口支持「听起来像哪个音」和 IPA 音标 | 通过 | 每个音素都返回 IPA 符号和 3 个候选音，例如 `t(100)<t,d,ɛ>` |
| 4 | `ctx.call` 能传 30 秒的 WAV | 通过 | 128 万字符的 base64 往返完整，耗时 55–1242 毫秒 |

另外确认了三件事：

- **漏读检测可用。** 参考句比录音多两个词时，这两个词被标为 `Omission`，完整度降到 71。
- **韵律分可用。** REST 接口返回了 `ProsodyScore`（90.9）。
- **评分耗时短。** 一次 Azure 请求 0.2–0.9 秒。

## 怎么测的

- 一个一次性的试验插件 `speak-english-spike`（`spikes/phase0/plugin/dist/`）：前端录音并转 WAV，后端调 Azure。
- 一个临时的应用实例：用主仓库的代码在 3211 端口启动，数据目录放在临时文件夹里。**没有碰正在运行的桌面应用和它的数据。**
- 用无界面的 Chrome 自动点击。麦克风用一个 WAV 文件冒充，内容是 Azure Jenny 读的 "I'll tell him about it."。
- Azure 密钥从 speechcoach 的 `.env` 读取，只在后端使用。

重跑方法见 `spikes/phase0/README.md`。

## 实现时要注意的细节

1. **REST 和 SDK 的返回结构不同。** REST 把分数直接放在 `NBest[0]` 和每个词、每个音素上；Python SDK 把它们包在 `PronunciationAssessment` 里。解析代码要按 REST 的结构写。样例：`evaluation/azure/rest-sample.json`。
2. **浏览器录出的是 48 kHz 的 WebM。** 转换步骤是 `decodeAudioData` → `OfflineAudioContext` 重采样到 16 kHz → 写 WAV 头。试验插件里的 `blobToWav` 可以直接搬到正式代码。
3. **自动化测试的假麦克风需要一个启动参数。** 不加 `--disable-features=AudioServiceSandbox` 时，Chrome 的音频服务读不到 WAV 文件，录到的是静音。文件还要是 48 kHz。
4. **测试时主仓库在 `feat/provider-pause` 分支上，带着未提交的改动。** 试验实例跑的是那个状态的代码。

## 还没验证的

**桌面版里的录音。** 需要有人在桌面应用里点按钮并对着麦克风说话，自动化做不了。代码上的依据是充分的：`electron/main.cjs` 对应用自己的页面授予了麦克风权限，宿主的听写功能就在同一个页面里用同样的方式录音。
