// Dev tool: walks the optional exercises of the installed plugin in a throwaway instance: generating
// questions for a passage, "listen once", and "respond", with a WAV file as the microphone.
// It DELETES every passage in that instance first, so point it at a scratch data root only.
// Uses real services (model, speech synthesis), so it costs a little credit.
// Usage: node scripts/ui-walkthrough-exercises.mjs <repo-with-puppeteer-core> <base-url> <fake-mic-48k.wav> <out-dir> <azure-env-file> <auth.json> <scratch-data-root>
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [repo, baseUrl, micWav, outDir, envFile, authFile, dataRoot] = process.argv.slice(2);
if (!dataRoot) { console.error("Usage: see the comment at the top of this file."); process.exit(1); }
const require = createRequire(path.join(repo, "package.json"));
const puppeteer = (await import(pathToFileURL(require.resolve("puppeteer-core")).href)).default;
fs.mkdirSync(outDir, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const storeFile = path.join(dataRoot, "plugins", "speak-english", "data", "store.json");

async function call(operation, input = {}) {
  const response = await fetch(`${baseUrl}/api/plugins/speak-english/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, input }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${operation}: ${body.error}`);
  return body.result;
}

async function prepare() {
  const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#") && line.includes("="))
    .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
  await call("set-secret", { name: "azureKey", value: env.SPEECH_KEY });
  await call("set-secret", { name: "elevenLabsKey", value: JSON.parse(fs.readFileSync(authFile, "utf8")).ELEVENLABS_API_KEY });
  await call("save-settings", { azureRegion: env.SPEECH_REGION });
  for (const passage of (await call("get-state")).passages) await call("delete-passage", { passageId: passage.id });
  const sentences = [
    { native: "这事挺难，但我做成了。", target: "I can't believe I pulled it off.", keyExpression: "pulled it off" },
    { native: "我明天会把这件事告诉他。", target: "I'll tell him about it tomorrow.", keyExpression: "tell him about it" },
  ];
  const { state } = await call("create-passage", { register: "casual", version: "brief", nativeLanguage: "zh-CN", targetLanguage: "en-US", source: sentences.map(sentence => sentence.native).join(""), sentences });
  for (const sentence of state.passages[0].sentences) {
    await call("synthesize-sentence", { sentenceId: sentence.id });
    // Said from memory, so the whole passage counts as memorized and can be asked about.
    await call("judge-recall", { attemptId: randomUUID(), sentenceId: sentence.id, said: true });
  }
}

await prepare();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "speak-english-ui-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, userDataDir: profile, defaultViewport: { width: 1280, height: 1000 },
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${micWav}`,
    "--autoplay-policy=no-user-gesture-required", "--disable-features=AudioServiceSandbox"],
});
const problems = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));
  await page.evaluateOnNewDocument(() => {
    window.__rates = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function patchedPlay() {
      this.addEventListener("playing", () => { window.__rates.push(this.playbackRate); }, { once: true });
      return play.call(this);
    };
  });
  const shot = name => page.screenshot({ path: path.join(outDir, `${name}.png`) });
  const click = async label => {
    const found = await page.evaluate(text => {
      const button = [...document.querySelectorAll(".se-root button")].find(node => node.textContent.trim().startsWith(text) && !node.disabled);
      if (button) button.click();
      return Boolean(button);
    }, label);
    if (!found) throw new Error(`button not found: ${label}`);
  };
  const text = selector => page.evaluate(query => [...document.querySelectorAll(query)].map(node => node.innerText.replace(/\n+/g, " | ")), selector);
  const waitText = (selector, pattern, timeout = 60000) => page.waitForFunction((query, source) => [...document.querySelectorAll(query)].some(node => new RegExp(source).test(node.textContent)), { timeout }, selector, pattern);
  const rates = () => page.evaluate(() => window.__rates.splice(0));

  // The dev server needs its home page compiled once before a plugin page loads cleanly.
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pause(4000);
  await page.goto(`${baseUrl}/plugins/speak-english/practice`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".se-passage-row", { timeout: 120000 });
  console.log("home before questions:", await text(".se-review"));

  // Questions: suggested by the model, one dropped, the rest saved and synthesized.
  await page.click(".se-passage-row");
  await waitText(".se-questions", "接话的问句");
  console.log("question hint:", await text(".se-questions > .se-muted"));
  await click("生成问句");
  await page.waitForSelector(".se-question-draft", { timeout: 120000 });
  console.log("suggested:", await page.evaluate(() => [...document.querySelectorAll(".se-question-draft")].map(row => [...row.querySelectorAll("input")].map(input => input.value).join(" / "))));
  await shot("x1-question-drafts");
  await page.evaluate(() => { const input = document.querySelectorAll(".se-question-draft")[2].querySelector("input"); input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await click("保存问句");
  await page.waitForFunction(() => document.querySelectorAll(".se-question-list .se-sentence").length === 2 && [...document.querySelectorAll(".se-question-list .se-sentence")].every(row => [...row.querySelectorAll("button")].some(button => button.textContent.trim() === "▶")), { timeout: 120000 });
  console.log("saved questions:", await text(".se-question-list .se-sentence-text"), "| errors:", await text(".se-error"));
  await page.evaluate(() => [...document.querySelectorAll(".se-question-list button")].find(button => button.textContent.trim() === "▶").click());
  await page.waitForFunction(() => window.__rates.length > 0, { timeout: 30000 });
  await rates();
  await shot("x2-questions-saved");
  await click("← 返回");
  await waitText(".se-review", "可选练习");
  console.log("home:", await text(".se-review"));
  await shot("x3-home");

  // Listen once, sped up: one understood, one not, sorted as "sound".
  await click("只听一遍");
  await waitText(".se-card", "随机抽 2 句");
  await page.click(".se-card input[type=checkbox]");
  await click("开始");
  await waitText(".se-card", "放完了", 30000);
  console.log("\nlisten 1 after playing:", await text(".se-card"), "| rates:", await rates());
  await click("听懂了");
  await waitText(".se-card", "其实没听懂");
  console.log("listen 1 revealed:", await text(".se-card"));
  await click("下一句");
  await waitText(".se-card", "放完了", 30000);
  await click("没听懂");
  await waitText(".se-card", "现在看到文字了");
  await shot("x4-listen-sort");
  await click("一看就懂");
  await waitText(".se-card", "缺的是声音这一端");
  console.log("listen 2 advice:", await text(".se-card"));
  await click("下一句");
  await waitText(".se-card", "这一轮听了 2 句");
  console.log("listen summary:", await text(".se-card"));
  await click("回到首页");
  await waitText(".se-review", "可选练习");

  // Respond: answered in time, then a second round where the start limit runs out.
  await click("接话");
  await waitText(".se-card", "随机抽 1 段");
  console.log("\nrespond intro:", await text(".se-card"));
  await click("开始");
  await waitText(".se-card", "问完了，该你了", 30000);
  console.log("respond asked:", await text(".se-card"), "| header:", await text(".se-header"));
  await shot("x5-respond-waiting");
  await pause(800);
  await page.keyboard.press("Space");
  await pause(3000);
  await page.keyboard.press("Space");
  await page.waitForSelector(".se-verdict button");
  console.log("respond answer:", await text(".se-card"));
  await shot("x6-respond-answer");
  await click("接上了");
  await waitText(".se-card", "这一轮问了 1 个");
  console.log("respond summary:", await text(".se-card"));
  await click("再来一轮");
  await click("开始");
  await waitText(".se-card", "没有在时限内开口", 40000);
  console.log("respond timed out:", await text(".se-card"));
  await click("下一个");
  await waitText(".se-card", "这一轮问了 1 个");
  console.log("respond summary 2:", await text(".se-card"));

  await pause(500);
  const log = JSON.parse(fs.readFileSync(storeFile, "utf8")).attempts.filter(entry => entry.kind === "listen" || entry.kind === "respond");
  console.log("\nlog:", log.map(entry => (entry.kind === "listen" ? `listen understood=${entry.understood} gap=${entry.gap} rate=${entry.rate}` : `respond answered=${entry.answered} timedOut=${entry.timedOut} responseMs=${entry.responseMs} speakMs=${entry.speakMs}`)));
  const after = await call("get-state");
  console.log("review untouched:", JSON.stringify({ doneToday: after.review.doneToday, scheduled: after.review.scheduled }), "| misses:", after.passages[0].sentences.map(sentence => sentence.misses));
} finally {
  if (problems.length) console.log("PROBLEMS", problems.slice(0, 10));
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
