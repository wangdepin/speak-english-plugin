// Phase 0 spike driver: opens the spike view in a throwaway Chrome profile whose
// microphone is a WAV file, then presses both buttons and prints the results.
// Usage: node drive-browser.mjs <repo-with-puppeteer-core> <base-url> <fake-mic.wav>
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [repo, baseUrl, micWav] = process.argv.slice(2);
const require = createRequire(path.join(repo, "package.json"));
const puppeteer = (await import(pathToFileURL(require.resolve("puppeteer-core")).href)).default;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "speak-english-spike-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, userDataDir: profile,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${micWav}`, "--autoplay-policy=no-user-gesture-required",
    // Without this the sandboxed audio service cannot read the WAV and the fake microphone is silent.
    "--disable-features=AudioServiceSandbox"],
});
try {
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));
  page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 200)}`); });
  await page.goto(`${baseUrl}/plugins/speak-english-spike/spike`, { waitUntil: "networkidle2", timeout: 120000 });
  console.log("url after load:", page.url());
  await page.waitForSelector('[data-spike="record"]', { timeout: 60000 });
  await page.click('[data-spike="payload"]');
  await page.waitForFunction(() => window.__spike && window.__spike.payload, { timeout: 60000 });
  console.log("PAYLOAD", JSON.stringify(await page.evaluate(() => window.__spike.payload)));
  await page.click('[data-spike="record"]');
  await page.waitForFunction(() => window.__spike && window.__spike.record, { timeout: 90000 });
  console.log("RECORD", JSON.stringify(await page.evaluate(() => window.__spike.record), null, 1));
  if (problems.length) console.log("PROBLEMS", problems.slice(0, 8));
} finally {
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
