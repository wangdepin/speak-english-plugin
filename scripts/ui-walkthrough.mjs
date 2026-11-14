// Dev tool: walks the installed plugin's UI in a throwaway Chrome profile whose microphone is a WAV file.
// Intake (write → translate → confirm → synthesize → play) and the settings page's microphone test.
// Uses real services, so it costs a little credit. Screenshots go to <out-dir>.
// Usage: node scripts/ui-walkthrough.mjs <repo-with-puppeteer-core> <base-url> <fake-mic-48k.wav> <out-dir>
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [repo, baseUrl, micWav, outDir] = process.argv.slice(2);
const require = createRequire(path.join(repo, "package.json"));
const puppeteer = (await import(pathToFileURL(require.resolve("puppeteer-core")).href)).default;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "speak-english-ui-"));
fs.mkdirSync(outDir, { recursive: true });
const CHINESE = "昨天我本来想早点睡的，结果刷手机刷到两点。今天早上差点没起来。";

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
  // Record what the page plays: the player uses an Audio object that is not in the DOM.
  await page.evaluateOnNewDocument(() => {
    window.__played = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function patchedPlay() {
      this.addEventListener("playing", () => window.__played.push({ duration: this.duration }), { once: true });
      return play.call(this);
    };
  });
  const shot = name => page.screenshot({ path: path.join(outDir, `${name}.png`) });
  const clickButton = async label => {
    const clicked = await page.evaluate(text => {
      const button = [...document.querySelectorAll(".se-root button")].find(node => node.textContent.trim() === text);
      if (button) button.click();
      return Boolean(button);
    }, label);
    if (!clicked) throw new Error(`button not found: ${label}`);
  };
  const errorsShown = () => page.evaluate(() => [...document.querySelectorAll(".se-root .se-error")].map(node => node.textContent).filter(Boolean));

  await page.goto(`${baseUrl}/plugins/speak-english/practice`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".se-practice .se-title", { timeout: 120000 });
  await shot("1-home");
  console.log("home:", await page.evaluate(() => document.querySelector(".se-practice").innerText.replace(/\n+/g, " | ").slice(0, 300)));

  await clickButton("新段落");
  await page.waitForSelector(".se-passage-input");
  await page.type(".se-passage-input", CHINESE);
  await page.click('input[name="se-register"][value="casual"]');
  await shot("2-write");
  await clickButton("翻译");
  await page.waitForSelector(".se-sentence-edit", { timeout: 120000 });
  await page.click('input[name="se-version"][value="elaborate"]');
  await shot("3-confirm");
  console.log("confirm:", await page.evaluate(() => [...document.querySelectorAll(".se-sentence-edit")].map(row => [...row.querySelectorAll(".se-input")].map(input => input.value).join(" / "))));

  await clickButton("确认并合成语音");
  await page.waitForSelector(".se-sentence", { timeout: 30000 });
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll(".se-sentence");
    const playable = [...document.querySelectorAll(".se-sentence button")].filter(node => node.textContent.trim() === "▶ 原声");
    return (rows.length > 0 && playable.length === rows.length) || [...document.querySelectorAll(".se-error")].some(node => node.textContent);
  }, { timeout: 180000 });
  console.log("passage errors:", await errorsShown());
  await clickButton("▶ 原声");
  await page.waitForFunction(() => window.__played.length > 0, { timeout: 30000 });
  await shot("4-passage");
  console.log("passage:", await page.evaluate(() => [...document.querySelectorAll(".se-sentence")].map(row => row.innerText.replace(/\n+/g, " | "))));
  console.log("played:", JSON.stringify(await page.evaluate(() => window.__played)));

  await clickButton("← 返回");
  await page.waitForSelector(".se-passage-row");
  await shot("5-home-with-passage");
  console.log("rows:", await page.evaluate(() => [...document.querySelectorAll(".se-passage-row")].map(row => row.innerText.replace(/\n+/g, " | "))));

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lh:open-plugin-settings", { detail: "speak-english" })));
  await page.waitForSelector(".se-settings .se-mic-test", { timeout: 30000 });
  console.log("key status:", await page.evaluate(() => [...document.querySelectorAll(".se-secret-status")].map(node => node.textContent)));
  console.log("password fields empty:", await page.evaluate(() => [...document.querySelectorAll('.se-secret input[type="password"]')].every(input => input.value === "")));
  await clickButton("录 4 秒并评分");
  await page.waitForFunction(() => /总分|。（|请|没法|不/.test(document.querySelector(".se-mic-result").textContent) && !/正在/.test(document.querySelector(".se-mic-result").textContent), { timeout: 60000 });
  console.log("mic test:", await page.evaluate(() => document.querySelector(".se-mic-result").textContent));
  await page.evaluate(() => document.querySelector(".se-settings").scrollIntoView());
  await shot("6-settings");
  await page.evaluate(() => document.querySelector(".se-mic-test").scrollIntoView());
  await shot("7-settings-mic");
} finally {
  if (problems.length) console.log("PROBLEMS", problems.slice(0, 10));
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
