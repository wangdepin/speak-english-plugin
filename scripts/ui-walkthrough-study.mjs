// Dev tool: walks the optional first step with a passage in a throwaway instance.
//   1. the listening diagnostic: one sentence repeated and scored, one given up on, words marked as unknown
//   2. the result screen
//   3. "hand to the teacher": the app opens a lesson, sends the first message, and its prober
//      gets the passage, the diagnostic and the guide from the plugin's tool
//   4. reading aloud and one speed-listening run
// The microphone is a WAV file saying "I'll tell him about it."; the first sentence of the passage is
// "I'll tell him all about it tomorrow.", so the diagnostic finds "all" and "tomorrow" missing.
// It DELETES every passage in that instance, so point it at a scratch data root only. The instance needs
// a strong model slot. Uses real services (the lesson's model, speech synthesis, scoring), so it costs a little credit.
// Usage: node scripts/ui-walkthrough-study.mjs <repo-with-puppeteer-core> <base-url> <fake-mic-48k.wav> <out-dir> <azure-env-file> <auth.json>
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [repo, baseUrl, micWav, outDir, envFile, authFile] = process.argv.slice(2);
if (!authFile) { console.error("Usage: see the comment at the top of this file."); process.exit(1); }
const require = createRequire(path.join(repo, "package.json"));
const puppeteer = (await import(pathToFileURL(require.resolve("puppeteer-core")).href)).default;
fs.mkdirSync(outDir, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const LESSON_TOOL = "speaking_practice_lesson";
const FIRST_TURN_MS = 420000;

async function api(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const parsed = await response.json();
  if (!response.ok) throw new Error(parsed.error);
  return parsed;
}
const call = async (operation, input = {}) => (await api("POST", "/api/plugins/speak-english/call", { operation, input })).result;

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
  await call("save-settings", { azureRegion: env.SPEECH_REGION, language: "zh", nativeLanguage: "zh-CN", targetLanguage: "en-US", languagesConfirmed: true });
  for (const passage of (await call("get-state")).passages) await call("delete-passage", { passageId: passage.id });
  const { passageId, state } = await call("create-passage", {
    register: "casual", version: "brief", nativeLanguage: "zh-CN", targetLanguage: "en-US", source: "我明天把这件事全都告诉他。今天就到这里吧。",
    sentences: [
      { native: "我明天把这件事全都告诉他。", target: "I'll tell him all about it tomorrow.", keyExpression: "tell him all about it" },
      { native: "今天就到这里吧。", target: "Let's call it a day.", keyExpression: "call it a day" },
    ],
  });
  check("lessons are available in this app", state.lessonAvailable === true);
  for (const sentence of state.passages.find(passage => passage.id === passageId).sentences) await call("synthesize-sentence", { sentenceId: sentence.id });
  return passageId;
}

/** One line per saved message of a lesson: who, and what kind of content, with the start of any text. */
function outline(message) {
  const content = Array.isArray(message.content) ? message.content : [{ type: "text", text: String(message.content ?? "") }];
  const parts = content.map(part => (part.type === "text" ? `text ${JSON.stringify(part.text.slice(0, 600))}` : part.type === "toolCall" ? `toolCall ${part.name} ${JSON.stringify(part.arguments ?? {}).slice(0, 700)}` : part.type));
  return `${message.role}${message.toolName ? ` [${message.toolName}]` : ""}: ${parts.join(" | ")}`;
}

/** Waits until the lesson's first turn is over and returns the session as the app saved it. */
async function finishedLesson(chatId) {
  const deadline = Date.now() + FIRST_TURN_MS;
  while (Date.now() < deadline) {
    const chat = await api("GET", `/api/chats/${chatId}`);
    if (!chat.turnInFlight && chat.messages.length > 1) return chat;
    await pause(4000);
  }
  return api("GET", `/api/chats/${chatId}`);
}

const passageId = await prepare();
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
  page.on("response", response => { if (response.status() >= 400 && !/favicon/.test(response.url())) problems.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("console", message => { if (message.type() === "error" && !/favicon|Failed to load resource/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`); });
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
  /** Clicks the words of the shown sentence whose text is in `words`. */
  const markWords = words => page.evaluate(wanted => {
    for (const span of document.querySelectorAll(".se-marked .se-tap")) if (wanted.includes(span.textContent)) span.click();
  }, words);
  const wordsWith = className => page.evaluate(name => [...document.querySelectorAll(`.se-marked .${name}`)].map(span => span.textContent), className);
  const openPassage = async () => {
    await page.goto(`${baseUrl}/plugins/speak-english/practice`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector(".se-passage-row", { timeout: 120000 });
    // The home screen is drawn again once the state has loaded; wait for it to settle before clicking.
    await pause(1500);
    await page.evaluate(() => document.querySelector(".se-passage-row").click());
    await page.waitForSelector(".se-study", { timeout: 30000 });
  };

  // The dev server needs its home page compiled once before a plugin page loads cleanly.
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pause(4000);
  await openPassage();
  const studyRow = await text(".se-study");
  check("the passage offers the optional first step, before shadowing", ["先学一遍（可选）", "摸底", "交给老师", "朗读和变速听"].every(label => studyRow.includes(label)), studyRow);
  await shot("1-passage");

  // 1. The diagnostic.
  await click("摸底");
  await expectText("the diagnostic starts with the whole passage, without its text", ".se-card", "先不看文本");
  check("no sentence text is shown before a sentence is repeated", (await text(".se-marked")) === "");
  await click("开始逐句摸底");
  await waitText(".se-header", "第 1/2 句");
  await pause(3500);
  await page.keyboard.press("Space");
  await pause(4500);
  await page.keyboard.press("Space");
  try { await page.waitForSelector(".se-marked .se-word", { timeout: 60000 }); } catch { /* reported by the checks below */ }
  console.log("     ", await text(".se-marked"), "|", await text(".se-status"), "|", await text(".se-error"));
  check("the repetition is scored and the missing words are struck out", JSON.stringify(await wordsWith("se-word-missed")) === JSON.stringify(["all", "tomorrow."]), JSON.stringify(await wordsWith("se-word-missed")));
  await expectText("the status counts them", ".se-status", "没说出来 2 个词");
  await markWords(["him"]);
  check("a clicked word is marked as not understood", JSON.stringify(await wordsWith("se-word-unknown")) === JSON.stringify(["him"]));
  await shot("2-diagnose-scored");
  await click("下一句");
  await waitText(".se-header", "第 2/2 句");
  await pause(2500);
  await click("说不出来，看原文");
  await page.waitForSelector(".se-marked .se-tap", { timeout: 20000 });
  await markWords(["call", "it", "a", "day."]);
  await shot("3-diagnose-given-up");
  await click("看结果");

  // 2. The result.
  await waitText(".se-header", "摸底结果");
  const result = await text(".se-sentence");
  console.log("     ", result);
  check("the result lists what was missing and what was marked", result.includes("没说出来：all, tomorrow") && result.includes("不认识：him"), result);
  check("the sentence given up on says so, with its marked phrase", result.includes("没能复述 · 不认识：call it a day"), result);
  await shot("4-gaps");

  // 3. The lesson.
  await click("交给老师");
  await page.waitForFunction(() => location.pathname.startsWith("/chat/"), { timeout: 60000 });
  const chatId = new URL(page.url()).pathname.slice("/chat/".length);
  const bound = (await call("get-state")).passages.find(passage => passage.id === passageId).lesson;
  check("the app opened a new lesson, and the passage remembers it", bound?.chatId === chatId, `${chatId} / ${JSON.stringify(bound)}`);
  const chat = await finishedLesson(chatId);
  for (const message of chat.messages) console.log("     ", outline(message));
  check("the lesson's first message was sent, and it titles the lesson", chat.messages[0]?.role === "user" && chat.title.startsWith("教我「开口练习」里的这一段"), chat.title);
  const firstReply = chat.messages.find(message => message.role === "assistant");
  check("the first thing the lesson's agent does is call the plugin's tool", (firstReply?.content ?? []).some(part => part.type === "toolCall" && part.name === LESSON_TOOL));
  const toolResult = chat.messages.find(message => message.role === "toolResult" && message.toolName === LESSON_TOOL)?.content?.[0]?.text ?? "";
  check("the tool gave the passage, the diagnostic and the guide", toolResult.includes("Not said: all, tomorrow") && toolResult.includes("Could not repeat.") && toolResult.includes("Marked unknown: call it a day") && toolResult.includes("While probing.") && toolResult.includes("While teaching:"), toolResult.slice(0, 300));
  await pause(3000);
  await shot("5-lesson");

  // 4. Back in the plugin: reading aloud and speed listening.
  await openPassage();
  const after = await text(".se-study");
  check("the passage now offers the result and the lesson", ["摸底结果", "打开这节课", "重新开课"].every(label => after.includes(label)), after);
  await click("朗读和变速听");
  await waitText(".se-card", "已读 0 遍");
  await click("读完一遍");
  await expectText("a read-through is counted", ".se-card", "已读 1 遍");
  check("the text is shown for reading aloud", await page.evaluate(() => !document.querySelector(".se-sentence-list").hidden));
  await click("▶ 开始变速听");
  await expectText("a run starts at normal speed", ".se-status", "现在 1 倍 · 第 1/7 档");
  check("the text is hidden while listening", await page.evaluate(() => document.querySelector(".se-sentence-list").hidden));
  await shot("6-speed-listening");
  try { await waitText(".se-card", "已完成 1 轮", 120000); check("a finished run is counted", true); } catch { check("a finished run is counted", false, await text(".se-card")); }
  const done = (await call("get-state")).passages.find(passage => passage.id === passageId).consolidation;
  check("both are kept with the passage", done?.readAloud === 1 && done?.speedRuns === 1, JSON.stringify(done));
} finally {
  if (problems.length) console.log("PROBLEMS", problems.slice(0, 10));
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
if (problems.length) failures.push(`${problems.length} page problems`);
console.log(failures.length === 0 ? "ALL CHECKS PASSED" : `FAILED: ${failures.join("; ")}`);
process.exit(failures.length === 0 ? 0 : 1);
