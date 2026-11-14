// Dev tool: walks the practice steps of the installed plugin (listen, shadowing, whole reading, recall)
// in a throwaway Chrome profile whose microphone is a WAV file saying "I'll tell him about it."
// It first stores the keys and creates a two-sentence passage through the plugin's own operations.
// Uses real services, so it costs a little credit. Screenshots go to <out-dir>.
// Usage: node scripts/ui-walkthrough-practice.mjs <repo-with-puppeteer-core> <base-url> <fake-mic-48k.wav> <out-dir> <azure-env-file> <auth.json>
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [repo, baseUrl, micWav, outDir, envFile, authFile] = process.argv.slice(2);
const require = createRequire(path.join(repo, "package.json"));
const puppeteer = (await import(pathToFileURL(require.resolve("puppeteer-core")).href)).default;
fs.mkdirSync(outDir, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function call(operation, input) {
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
  const sentences = [
    { zh: "我会把这件事告诉他。", en: "I'll tell him about it.", keyExpression: "tell him about it" },
    { zh: "这事挺难，但我做成了。", en: "I can't believe I pulled it off.", keyExpression: "pulled it off" },
  ];
  const { state } = await call("create-passage", { register: "formal", version: "sentences", chinese: "我会把这件事告诉他。这事挺难，但我做成了。", sentences });
  for (const sentence of state.passages[0].sentences) await call("synthesize-sentence", { sentenceId: sentence.id });
}

await prepare();
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
  page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 200)}`); });
  await page.evaluateOnNewDocument(() => {
    window.__played = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function patchedPlay() {
      this.addEventListener("playing", () => { window.__played += 1; }, { once: true });
      return play.call(this);
    };
  });
  const shot = name => page.screenshot({ path: path.join(outDir, `${name}.png`) });
  const click = async label => {
    const found = await page.evaluate(text => {
      const button = [...document.querySelectorAll(".se-root button")].find(node => node.textContent.trim().startsWith(text));
      if (button) button.click();
      return button ? button.textContent.trim() : null;
    }, label);
    if (!found) throw new Error(`button not found: ${label}`);
    return found;
  };
  const text = selector => page.evaluate(query => [...document.querySelectorAll(query)].map(node => node.innerText.replace(/\n+/g, " | ")), selector);
  const waitText = (selector, pattern, timeout = 60000) => page.waitForFunction((query, source) => [...document.querySelectorAll(query)].some(node => new RegExp(source).test(node.textContent)), { timeout }, selector, pattern);
  const played = () => page.evaluate(() => window.__played);
  const take = async ms => { await page.keyboard.press("Space"); await pause(ms); await page.keyboard.press("Space"); };
  const marked = () => page.evaluate(() => [...document.querySelectorAll(".se-marked .se-word")].map(node => `${node.textContent}:${node.className.replace("se-word se-word-", "")}`).join(" "));

  await page.goto(`${baseUrl}/plugins/speak-english/practice`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".se-passage-row", { timeout: 120000 });
  await page.click(".se-passage-row");
  await page.waitForSelector(".se-steps button");
  console.log("steps:", await text(".se-steps"));

  // Listen: the whole passage plays sentence by sentence.
  await click("▶ 整段原声");
  await page.waitForFunction(() => window.__played >= 2, { timeout: 30000 });
  await shot("p1-passage-listening");
  await click("■ 停止");
  console.log("listen: sentences played in a row:", await played());

  // Shadowing.
  await click("分段跟读");
  await page.waitForSelector(".se-english-large");
  await pause(2500);
  await take(4500);
  await waitText(".se-marked, .se-error", ".", 60000);
  console.log("shadow 1:", await marked(), "|", await text(".se-result .se-muted"), "| hints:", await text(".se-hints li"), "| errors:", await text(".se-error"));
  console.log("header:", await text(".se-header"));
  await shot("p2-shadow-first");
  await click("下一句");
  await pause(2500);
  await take(4500);
  await waitText(".se-marked, .se-error", ".", 60000);
  console.log("shadow 2:", await marked(), "|", await text(".se-result .se-muted"), "| hints:", await text(".se-hints li"), "| errors:", await text(".se-error"));
  await shot("p3-shadow-mismatch");
  await click("完成，回到段落");
  await page.waitForSelector(".se-steps button");

  // Whole reading: two takes, so both archive slots exist.
  await click("完整跟读");
  await page.waitForSelector(".se-reading-text");
  for (const expected of [1, 2]) {
    await take(3500);
    await page.waitForFunction(count => document.querySelectorAll(".se-root .se-actions button").length > 0 && [...document.querySelectorAll(".se-root button")].filter(node => /的录音/.test(node.textContent)).length === count, { timeout: 30000 }, expected);
    await pause(500);
  }
  console.log("reading archive:", (await text(".se-root button")).filter(label => /的录音/.test(label)), "| status:", await text(".se-status"), "| errors:", await text(".se-error"));
  const before = await played();
  await click("▶ 第一次的录音");
  await page.waitForFunction(count => window.__played > count, { timeout: 30000 }, before);
  await shot("p4-reading");
  await click("← 返回段落");
  await page.waitForSelector(".se-steps button");

  // Recall: say the first sentence, give up on the second.
  console.log("recall button:", await click("试背"));
  await page.waitForSelector(".se-cue");
  await shot("p5-recall-front");
  console.log("recall front:", await text(".se-card"));
  await take(4500);
  await page.waitForSelector(".se-verdict button");
  await waitText(".se-result", "总分|没有逐词比对", 60000);
  console.log("recall back:", await marked(), "|", await text(".se-result"));
  await shot("p6-recall-back");
  await click("说出来了");
  await page.waitForFunction(() => /第 2\/2 句/.test(document.querySelector(".se-header").textContent), { timeout: 30000 });
  await click("想不起来");
  await waitText(".se-card", "已记为没说出来");
  await shot("p7-recall-gave-up");
  await click("下一句");
  await waitText(".se-card", "这次试背了 2 句");
  console.log("recall summary:", await text(".se-card"));
  await click("回到段落");
  await page.waitForSelector(".se-steps button");
  console.log("after recall:", await text(".se-sentence-text"), "| steps:", await text(".se-steps"));
  await shot("p8-passage-after");
} finally {
  if (problems.length) console.log("PROBLEMS", problems.slice(0, 10));
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
