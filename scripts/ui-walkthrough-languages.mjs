// Dev tool: checks the practice languages end to end in a throwaway instance.
//   1. first use: the home screen asks to confirm the pair; "修改" changes it on the spot
//   2. Chinese → Japanese through the screens: intake, synthesis, shadowing with scoring, recall
//   3. the settings page: choosing the other side's language swaps the two; the reading speed follows
//   4. English → Chinese through the backend: translation, synthesis, scoring, explanation, questions
//   5. a passage keeps the pair it was made with after the settings change
// The microphone is a WAV file of someone saying JAPANESE_SENTENCE.
// It DELETES every passage in that instance and changes its settings, so point it at a scratch
// data root only. Uses real services (model, speech synthesis, scoring), so it costs a little credit.
// Usage: node scripts/ui-walkthrough-languages.mjs <repo-with-puppeteer-core> <base-url> <japanese-mic-48k.wav> <out-dir> <azure-env-file> <auth.json> <mandarin-16k.wav>
//   <mandarin-16k.wav> is a recording of MANDARIN_SENTENCE; scripts/language-check.mjs writes both recordings.
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [repo, baseUrl, micWav, outDir, envFile, authFile, mandarinWav] = process.argv.slice(2);
if (!mandarinWav) { console.error("Usage: see the comment at the top of this file."); process.exit(1); }
const require = createRequire(path.join(repo, "package.json"));
const puppeteer = (await import(pathToFileURL(require.resolve("puppeteer-core")).href)).default;
fs.mkdirSync(outDir, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const JAPANESE_SENTENCE = "今日は天気がいいので、公園を散歩しましょう。";
const MANDARIN_SENTENCE = "今天天气很好，我们去公园散步吧。";
const ENGLISH_SENTENCE = "I'll tell him about it.";
const ENGLISH_WAV = fileURLToPath(new URL("../tests/fixtures/audio/tell-him-16k.wav", import.meta.url));
const CJK = /[㐀-鿿]/;

async function api(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const parsed = await response.json();
  if (!response.ok) throw new Error(parsed.error);
  return parsed;
}
const call = async (operation, input = {}) => (await api("POST", "/api/plugins/speak-english/call", { operation, input })).result;
const wavBase64 = file => fs.readFileSync(file).toString("base64");

const failures = [];
function check(step, passed, detail = "") {
  console.log(`${passed ? "ok  " : "FAIL"} ${step}${detail ? `: ${detail}` : ""}`);
  if (!passed) failures.push(step);
}

async function prepare() {
  const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#") && line.includes("="))
    .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
  await call("set-secret", { name: "azureKey", value: env.SPEECH_KEY });
  await call("set-secret", { name: "elevenLabsKey", value: JSON.parse(fs.readFileSync(authFile, "utf8")).ELEVENLABS_API_KEY });
  await call("save-settings", { azureRegion: env.SPEECH_REGION, language: "zh", nativeLanguage: "zh-CN", targetLanguage: "en-US" });
  await call("save-settings", { languagesConfirmed: false });
  for (const passage of (await call("get-state")).passages) await call("delete-passage", { passageId: passage.id });
  // A Chinese → English passage from before any change, to be scored again at the very end.
  const { state } = await call("create-passage", {
    register: "formal", version: "sentences", nativeLanguage: "zh-CN", targetLanguage: "en-US", source: "我会把这件事告诉他。",
    sentences: [{ native: "我会把这件事告诉他。", target: ENGLISH_SENTENCE, keyExpression: "tell him about it" }],
  });
  return state.passages[0].sentences[0].id;
}

/** English → Chinese with no browser: every step that depends on the pair, through the backend's operations. */
async function englishToChinese() {
  await call("save-settings", { nativeLanguage: "en-US", targetLanguage: "zh-CN" });
  const translated = await call("translate", { register: "casual", text: "The weather is nice today, so let's go for a walk in the park. I have been stuck at my desk all week." });
  check("en→zh: the translation names its pair", translated.nativeLanguage === "en-US" && translated.targetLanguage === "zh-CN");
  const brief = translated.versions[0].sentences;
  console.log("     ", brief.map(sentence => `${sentence.native} / ${sentence.target} [${sentence.keyExpression}]`).join(" || "));
  check("en→zh: cues are English, sentences Chinese", brief.every(sentence => !CJK.test(sentence.native) && CJK.test(sentence.target)));

  const long = "我本来打算这个周末把整个报告从头到尾认真地修改一遍，可是临时有事没有时间。";
  const { passageId, state } = await call("create-passage", {
    register: "casual", version: "brief", nativeLanguage: "en-US", targetLanguage: "zh-CN", source: "The weather is nice today, so let's go for a walk in the park.",
    sentences: [
      { native: "The weather is nice today, so let's go for a walk in the park.", target: MANDARIN_SENTENCE, keyExpression: "散步" },
      { native: "I meant to revise the whole report carefully this weekend, but something came up and I had no time.", target: long, keyExpression: "临时有事" },
    ],
  });
  const [first, second] = state.passages.find(passage => passage.id === passageId).sentences;
  await call("synthesize-sentence", { sentenceId: first.id });
  const { assessment } = await call("score-attempt", { attemptId: randomUUID(), sentenceId: first.id, kind: "shadow", wavBase64: wavBase64(mandarinWav) });
  console.log("     ", JSON.stringify(assessment.scores), assessment.words.map(word => `${word.word}${word.errorType === "None" ? "" : `:${word.errorType}`}`).join(" "));
  check("en→zh: a Chinese recording is scored as Chinese, without prosody", assessment.scores.overall > 80 && assessment.scores.prosody === null);
  check("en→zh: Chinese sounds are named", assessment.words.some(word => word.phonemes.length > 0 && /^[a-z]+ \d$/.test(word.phonemes[0].expected)));

  const { explanation } = await call("explain-sentence", { sentenceId: second.id });
  console.log("     ", JSON.stringify(explanation).slice(0, 500));
  // The explanation quotes Chinese examples, so "in English" means mostly Latin letters.
  const explained = [explanation.simpler.why, explanation.difficulty.join(" ")].join(" ");
  const mostlyLatin = (explained.match(/[A-Za-z]/g) ?? []).length > 3 * (explained.match(/[\u3400-\u9fff]/g) ?? []).length;
  check("en→zh: the explanation is in English, the simpler wording in Chinese", mostlyLatin && CJK.test(explanation.simpler.target));
  check("en→zh: a long Chinese sentence gets a split, counted in characters", Array.isArray(explanation.split) && explanation.split.length === 2 && explanation.split.every(part => CJK.test(part.target) && !CJK.test(part.native)), JSON.stringify(explanation.split));

  const { questions } = await call("suggest-questions", { passageId });
  console.log("     ", JSON.stringify(questions));
  check("en→zh: questions are Chinese with an English translation", questions.length > 0 && questions.every(question => CJK.test(question.target) && question.native !== "" && !CJK.test(question.native)));
}

const englishSentenceId = await prepare();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "speak-english-ui-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, userDataDir: profile, defaultViewport: { width: 1280, height: 900 },
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${micWav}`,
    "--autoplay-policy=no-user-gesture-required", "--disable-features=AudioServiceSandbox"],
});
const problems = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));
  page.on("console", message => { if (message.type() === "error" && !/favicon/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`); });
  const shot = name => page.screenshot({ path: path.join(outDir, `${name}.png`) });
  const click = async label => {
    const found = await page.evaluate(text => {
      const button = [...document.querySelectorAll(".se-root button")].find(node => node.textContent.trim().startsWith(text) && !node.disabled);
      if (button) button.click();
      return Boolean(button);
    }, label);
    if (!found) throw new Error(`button not found: ${label}`);
  };
  const text = selector => page.evaluate(query => [...document.querySelectorAll(query)].map(node => node.innerText.replace(/\n+/g, " | ")).join(" || "), selector);
  const waitText = (selector, pattern, timeout = 60000) => page.waitForFunction((query, source) => [...document.querySelectorAll(query)].some(node => new RegExp(source).test(node.textContent)), { timeout }, selector, pattern);
  const expectText = async (step, selector, pattern) => {
    try { await waitText(selector, pattern, 20000); check(step, true); }
    catch { check(step, false, await text(selector)); }
  };
  /** Chooses `value` in the `index`-th dropdown under `selector`, and waits for the backend to have it. */
  const choose = async (selector, index, value, saved) => {
    const selects = await page.$$(`${selector} select`);
    await selects[index].select(value);
    for (let tries = 0; tries < 40; tries += 1) {
      if (saved((await call("get-state")).settings)) return;
      await pause(250);
    }
    throw new Error(`choosing ${value} was not saved`);
  };

  // The dev server needs its home page compiled once before a plugin page loads cleanly.
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pause(4000);
  await page.goto(`${baseUrl}/plugins/speak-english/practice`, { waitUntil: "domcontentloaded", timeout: 120000 });

  // 1. First use: the pair is shown for confirmation, and can be changed in place.
  await expectText("home asks to confirm the default pair", ".se-notice", "中文（普通话，简体） → 英语（美国）");
  await expectText("the existing passage says which language it is in", ".se-passage-row", "英语");
  await shot("1-confirm-card");
  await click("修改");
  await page.waitForSelector(".se-language-rows select", { timeout: 20000 });
  await choose(".se-language-rows", 1, "ja-JP", settings => settings.targetLanguage === "ja-JP");
  await shot("2-change-in-place");
  await click("完成");
  await pause(500);
  const afterCard = (await call("get-state")).settings;
  check("the choice is saved and counts as confirmed", afterCard.nativeLanguage === "zh-CN" && afterCard.targetLanguage === "ja-JP" && afterCard.languagesConfirmed === true);
  check("the card does not come back", !(await text(".se-notice")).includes("练习语言"));

  // 2. Chinese → Japanese through the screens.
  await click("新段落");
  await page.waitForSelector(".se-passage-input");
  await expectText("intake shows the pair it will use", ".se-language-pair", "中文（普通话，简体） → 日语");
  check("intake asks for Chinese, counted in characters", /用中文写下.*字左右/.test(await page.$eval(".se-passage-input", node => node.placeholder)));
  await page.type(".se-passage-input", MANDARIN_SENTENCE);
  await shot("3-intake-japanese");
  await click("翻译");
  await page.waitForSelector(".se-sentence-edit", { timeout: 120000 });
  await expectText("the confirm step names the language", ".se-title", "确认日语");
  const labels = await text(".se-sentence-edit .se-label");
  check("fields are labelled with the two languages", labels.includes("中文意图") && labels.includes("日语"), labels);
  console.log("     ", await page.evaluate(() => [...document.querySelectorAll(".se-sentence-edit")].map(row => [...row.querySelectorAll(".se-input")].map(input => input.value).join(" / ")).join(" || ")));
  // Make the first sentence the one the microphone file says, so that it can be scored.
  await page.evaluate(sentence => {
    const [, target, key] = document.querySelector(".se-sentence-edit").querySelectorAll(".se-input");
    for (const [input, value] of [[target, sentence], [key, ""]]) { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); }
  }, JAPANESE_SENTENCE);
  await shot("4-confirm-japanese");
  await click("确认并合成语音");
  await page.waitForSelector(".se-sentence", { timeout: 30000 });
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll(".se-sentence");
    const playable = [...document.querySelectorAll(".se-sentence button")].filter(node => node.textContent.trim() === "▶ 原声");
    return (rows.length > 0 && playable.length === rows.length) || [...document.querySelectorAll(".se-error")].some(node => node.textContent);
  }, { timeout: 180000 });
  check("Japanese audio is synthesized", (await text(".se-error")) === "", await text(".se-error"));

  await click("分段跟读");
  await waitText(".se-header", "第 1/");
  await pause(2500);
  await page.keyboard.press("Space");
  await pause(6500);
  await page.keyboard.press("Space");
  try { await waitText(".se-result", "总分", 60000); } catch { /* reported by the checks below */ }
  const result = await text(".se-result");
  console.log("     ", result, "|", await text(".se-error"));
  check("a Japanese take is scored", /总分 \d/.test(result));
  check("no prosody score and no sound hints for Japanese", !result.includes("韵律") && (await page.$(".se-hints")) === null);
  check("Japanese words are shown without spaces between them", await page.evaluate(() => { const marked = document.querySelector(".se-marked"); return Boolean(marked) && !/\s/.test(marked.textContent.trim()); }));
  await shot("5-shadow-japanese");
  await click("← 返回段落");
  await waitText(".se-steps", "试背");
  await click("试背");
  await expectText("the recall card says which language to speak", ".se-card, .se-practice", "· 日语");
  await shot("6-recall-japanese");

  // 3. The settings page: choosing the other side's language swaps the two, and the reading speed follows the native language.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lh:open-plugin-settings", { detail: "speak-english" })));
  await page.waitForSelector(".se-settings .se-mic-test", { timeout: 30000 });
  await choose(".se-settings", 1, "ja-JP", settings => settings.nativeLanguage === "ja-JP");
  const swapped = (await call("get-state")).settings;
  check("choosing the language of the other side swaps the two", swapped.nativeLanguage === "ja-JP" && swapped.targetLanguage === "zh-CN" && swapped.readingSpeed === 5, JSON.stringify([swapped.nativeLanguage, swapped.targetLanguage, swapped.readingSpeed]));
  await choose(".se-settings", 1, "en-US", settings => settings.nativeLanguage === "en-US");
  const english = (await call("get-state")).settings;
  check("a native language read in words resets the reading speed to 3", english.readingSpeed === 3 && english.targetLanguage === "zh-CN");
  await expectText("the reading speed is labelled in words", ".se-settings", "每秒几个词");
  await page.evaluate(() => document.querySelector(".se-settings").scrollIntoView());
  await shot("7-settings");
  await page.keyboard.press("Escape");
  await pause(500);

  // English → Chinese on the intake screen: the texts follow the new pair.
  await page.goto(`${baseUrl}/plugins/speak-english/practice`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitText(".se-passages", "今天天气很好");
  await click("新段落");
  await page.waitForSelector(".se-passage-input");
  await expectText("intake follows the new pair", ".se-language-pair", "英语（美国） → 中文（普通话，简体）");
  check("intake asks for English, counted in words", /用英语写下.*词左右/.test(await page.$eval(".se-passage-input", node => node.placeholder)));
  await page.type(".se-passage-input", "The weather is nice today.");
  await expectText("the length is counted in words", ".se-practice", "5 词");
  await shot("8-intake-english");

  // 4. and 5. through the backend.
  await englishToChinese();
  const { assessment } = await call("score-attempt", { attemptId: randomUUID(), sentenceId: englishSentenceId, kind: "shadow", wavBase64: wavBase64(ENGLISH_WAV) });
  check("the English passage made earlier is still scored as English, with prosody", assessment.scores.prosody !== null && assessment.scores.overall > 60, JSON.stringify(assessment.scores));
} finally {
  if (problems.length) console.log("PROBLEMS", problems.slice(0, 10));
  // Leave the instance on the default pair, which the other walkthroughs assume.
  await call("save-settings", { nativeLanguage: "zh-CN", targetLanguage: "en-US" });
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log(failures.length === 0 ? "ALL CHECKS PASSED" : `FAILED: ${failures.join("; ")}`);
process.exit(failures.length === 0 ? 0 : 1);
