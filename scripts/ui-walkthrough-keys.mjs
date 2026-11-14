// Dev tool: walks the installed plugin with the keyboard only (shadowing, recall, review, listen once),
// then switches the interface to English on the settings page and checks that no Chinese
// interface text is left. The microphone is a WAV file saying "I'll tell him about it."
// It DELETES every passage in that instance and edits the instance's store.json, so point it at
// a scratch data root only. Uses real services (speech synthesis, scoring), so it costs a little credit.
// Usage: node scripts/ui-walkthrough-keys.mjs <repo-with-puppeteer-core> <base-url> <fake-mic-48k.wav> <out-dir> <azure-env-file> <auth.json> <scratch-data-root>
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

async function api(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const parsed = await response.json();
  if (!response.ok) throw new Error(parsed.error);
  return parsed;
}
const call = async (operation, input = {}) => (await api("POST", "/api/plugins/speak-english/call", { operation, input })).result;

/** The backend reads store.json once, when the plugin starts: edit the file while the plugin is off. */
async function makeDue(sentenceId) {
  await api("PUT", "/api/plugins/speak-english", { enabled: false });
  const stored = JSON.parse(fs.readFileSync(storeFile, "utf8"));
  const { schedule } = stored.sentences[sentenceId];
  schedule.due = Date.now() - 3600_000;
  if (schedule.dueDay) schedule.dueDay = "2026-01-01";
  fs.writeFileSync(storeFile, JSON.stringify(stored));
  await api("PUT", "/api/plugins/speak-english", { enabled: true });
}

const SENTENCES = [
  { zh: "我会把这件事告诉他。", en: "I'll tell him about it.", keyExpression: "tell him about it" },
  { zh: "就这样。", en: "That's it.", keyExpression: "" },
];

async function prepare() {
  const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#") && line.includes("="))
    .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
  await call("set-secret", { name: "azureKey", value: env.SPEECH_KEY });
  await call("set-secret", { name: "elevenLabsKey", value: JSON.parse(fs.readFileSync(authFile, "utf8")).ELEVENLABS_API_KEY });
  await call("save-settings", { azureRegion: env.SPEECH_REGION, language: "zh" });
  for (const passage of (await call("get-state")).passages) await call("delete-passage", { passageId: passage.id });
  const { state } = await call("create-passage", { register: "formal", version: "sentences", chinese: SENTENCES.map(sentence => sentence.zh).join(""), sentences: SENTENCES });
  const ids = state.passages[0].sentences.map(sentence => sentence.id);
  for (const sentenceId of ids) await call("synthesize-sentence", { sentenceId });
  // The first sentence enters review and is made due; the second is left for the recall screen.
  await call("judge-recall", { attemptId: randomUUID(), sentenceId: ids[0], said: true });
  await makeDue(ids[0]);
  return ids;
}

const ids = await prepare();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "speak-english-ui-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, userDataDir: profile, defaultViewport: { width: 1280, height: 900 },
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${micWav}`,
    "--autoplay-policy=no-user-gesture-required", "--disable-features=AudioServiceSandbox"],
});
const problems = [];
const failures = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));
  page.on("response", response => { if (response.status() === 404) problems.push(`404: ${response.url()}`); });
  page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 200)}`); });
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
  const press = async key => { await page.keyboard.press(key); await pause(250); };
  const hint = () => text(".se-keys");
  /** Records what the hint line says at a step and whether it is what was expected. */
  const expectHint = async (step, expected) => {
    await pause(150);
    const actual = await hint();
    console.log(`${actual === expected ? "ok  " : "FAIL"} ${step}: ${actual}`);
    if (actual !== expected) failures.push(`${step}: expected "${expected}"`);
  };
  const expectText = async (step, selector, pattern) => {
    try { await waitText(selector, pattern, 20000); console.log(`ok   ${step}`); }
    catch { failures.push(step); console.log(`FAIL ${step}: ${await text(selector)}`); }
  };
  const take = async ms => { await press("Space"); await pause(ms); await press("Space"); };

  // The dev server needs its home page compiled once before a plugin page loads cleanly.
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pause(4000);
  await page.goto(`${baseUrl}/plugins/speak-english/practice`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitText(".se-passages", "我会把这件事告诉他");
  await expectHint("home has no keys", "");

  // Passage page: R plays the whole passage, R again stops it.
  await page.click(".se-passage-row");
  await waitText(".se-steps", "分段跟读");
  await expectHint("passage", "R 整段原声");
  await press("KeyR");
  await page.waitForSelector(".se-sentence.se-current", { timeout: 15000 });
  console.log("ok   R starts the whole passage");
  await press("KeyR");
  await pause(300);
  const stillPlaying = await page.$(".se-sentence.se-current");
  console.log(`${stillPlaying ? "FAIL" : "ok  "} R again stops it`);
  if (stillPlaying) failures.push("R again stops the passage");

  // Shadowing with keys only.
  await click("分段跟读");
  await waitText(".se-header", "第 1/2 句");
  await pause(2500);
  await expectHint("shadow, first sentence", "空格 录音 · R 原声 · ↓ 下一句");
  await take(2500);
  await waitText(".se-result", "总分", 60000);
  await expectHint("shadow, after a take", "空格 录音 · R 原声 · M 我的录音 · ↓ 下一句");
  await press("KeyM");
  await press("ArrowDown");
  await expectText("↓ goes to the second sentence", ".se-header", "第 2/2 句");
  await expectHint("shadow, last sentence", "空格 录音 · R 原声 · ↑ 上一句 · ↓ 完成，回到段落");
  await press("ArrowUp");
  await expectText("↑ goes back", ".se-header", "第 1/2 句");
  await press("ArrowRight");
  await expectText("→ also goes on", ".se-header", "第 2/2 句");
  await press("Enter");
  await expectText("Enter on the last sentence returns to the passage", ".se-steps", "试背（1 句）");
  await shot("k1-passage");

  // Recall: A shows the answer, E opens the explanation, 2 = can say it, Enter moves on.
  await click("试背");
  await waitText(".se-header", "试背 · 第 1/1 句");
  await expectHint("recall front", "空格 录音 · A 想不起来，看答案");
  await press("KeyA");
  await expectText("A shows the answer", ".se-card", "已记为没说出来");
  await expectHint("recall back, judged", "R 原声 · E 讲解 · ↓ 下一句");
  await shot("k2-recall-back");
  await press("KeyE");
  await expectText("E opens the explanation", ".se-card", "先分清缺的是什么");
  await expectHint("explanation, sorting", "1 还是说不出来 · 2 能说出来");
  await press("Digit2");
  await expectText("2 = can say it", ".se-card", "缺的是速度");
  await expectHint("speed gap", "↓ 好的");
  await press("Enter");
  await expectText("Enter ends the recall", ".se-card", "这次试背了 1 句");
  await expectHint("recall summary", "↓ 回到段落");
  await press("Enter");
  await waitText(".se-steps", "分段跟读");

  // Review with keys only.
  await click("← 返回");
  await waitText(".se-review", "现在有 1 句到期");
  await click("开始复习");
  await waitText(".se-card", "现在有 1 句到期");
  await expectHint("review intro", "↓ 开始复习");
  await press("Enter");
  await waitText(".se-card", "剩余 \\d+ 秒");
  await expectHint("review front", "空格 录音");
  await pause(600);
  await take(2500);
  await page.waitForSelector(".se-verdict button");
  await expectHint("review back", "R 原声 · M 我的录音 · E 讲解 · 1 没说出来 · 2 说出来了");
  await shot("k3-review-back");
  await press("Digit2");
  await expectText("2 = said it", ".se-card", "这次复习了 1 次：1 次说出来了");
  await expectHint("review done", "↓ 回到首页");
  await press("Enter");
  await waitText(".se-review", "今天已复习 1/50 次");

  // Listen once with keys only.
  await click("只听一遍");
  await waitText(".se-card", "随机抽 2 句");
  await expectHint("listen intro", "↓ 开始");
  await press("Enter");
  await waitText(".se-card", "放完了", 30000);
  await expectHint("listen, asked", "1 没听懂 · 2 听懂了");
  await press("Digit1");
  await expectText("1 = did not understand", ".se-card", "现在看到文字了");
  await expectHint("listen, sorting", "1 一看就懂，每个词都认识 · 2 看了还是不懂");
  await press("Digit1");
  await expectText("1 = clear at a glance", ".se-card", "缺的是声音这一端");
  await expectHint("listen, advice", "R 再听 · S 慢速（0.85 倍） · ↓ 下一句");
  await shot("k4-listen-advice");
  await press("KeyS");
  await pause(600);
  await press("ArrowDown");
  await waitText(".se-card", "放完了", 30000);
  await press("Digit2");
  await expectText("2 = understood", ".se-card", "其实没听懂");
  await expectHint("listen, understood", "1 其实没听懂 · ↓ 下一句");
  await press("ArrowDown");
  await expectText("↓ ends the round", ".se-card", "这一轮听了 2 句：听懂 1 句，没听懂 1 句");

  // Switch to English on the settings page, which opens over the practice view.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lh:open-plugin-settings", { detail: "speak-english" })));
  await page.waitForSelector(".se-settings .se-mic-test", { timeout: 30000 });
  await shot("k5-settings-zh");
  // With the dialog open, the keys belong to the dialog: ↓ must not leave the summary on the screen behind.
  await page.evaluate(() => document.activeElement?.blur());
  await press("ArrowDown");
  const behind = await text(".se-practice .se-card");
  console.log(`${/这一轮听了 2 句/.test(behind) ? "ok  " : "FAIL"} keys do nothing behind an open dialog`);
  if (!/这一轮听了 2 句/.test(behind)) failures.push("keys behind an open dialog");
  const picked = await page.evaluate(() => {
    const select = [...document.querySelectorAll(".se-settings select")].find(node => [...node.options].some(option => option.value === "en"));
    if (!select) return document.querySelector(".se-settings").innerHTML.slice(0, 1500);
    select.value = "en";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return "";
  });
  if (picked) throw new Error(`language control not found: ${picked}`);
  await expectText("the settings page is rebuilt in English", ".se-settings", "Test the microphone and scoring");
  await shot("k6-settings-en");
  const cjk = selector => page.evaluate(query => [...document.querySelectorAll(query)].flatMap(node => node.innerText.split("\n")).filter(line => /[一-鿿]/.test(line)), selector);
  console.log("settings, Chinese left:", JSON.stringify(await cjk(".se-settings")));
  await page.keyboard.press("Escape");
  await pause(800);

  // The practice view behind the dialog was redrawn in English.
  await expectText("the screen behind is redrawn in English", ".se-practice", "Listen once");
  await page.goto(`${baseUrl}/plugins/speak-english/practice`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitText(".se-review", "Due reviews");
  console.log("home:", await text(".se-review"));
  console.log("home, Chinese left outside the learner's own text:", JSON.stringify(await cjk(".se-notice, .se-header, .se-passage-row .se-muted")));
  await shot("k7-home-en");
  await page.click(".se-passage-row");
  await waitText(".se-steps", "Shadowing");
  await expectHint("passage, English", "R Whole passage");
  console.log("passage:", await text(".se-header, .se-steps, .se-sentence .se-muted, .se-questions .se-muted"));
  await shot("k8-passage-en");
  await click("Shadowing");
  await waitText(".se-header", "sentence 1/2");
  await pause(2500);
  await expectHint("shadow, English", "Space Record · R Reference · ↓ Next");
  await take(2500);
  await waitText(".se-result", "Overall", 60000);
  console.log("scores:", await text(".se-result .se-muted"));
  await shot("k9-shadow-en");

  // Backend messages are English too.
  const refused = await call("judge-review", { attemptId: randomUUID(), sentenceId: ids[1], said: true }).then(() => "accepted", error => error.message);
  console.log(`${/not in review yet/.test(refused) ? "ok  " : "FAIL"} backend message: ${refused}`);
  if (!/not in review yet/.test(refused)) failures.push("backend message in English");
} finally {
  if (problems.length) console.log("PROBLEMS", problems.slice(0, 10));
  console.log(failures.length ? `FAILED: ${failures.length}\n${failures.join("\n")}` : "ALL CHECKS PASSED");
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
  await call("save-settings", { language: "zh" }).catch(() => {});
}
