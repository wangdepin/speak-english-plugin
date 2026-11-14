// Dev tool: walks spaced review and the explanation flow of the installed plugin in a throwaway
// instance, with a WAV file saying "I'll tell him about it." as the microphone.
// It DELETES every passage in that instance, creates one with four sentences, and edits the
// instance's store.json to make them due, so point it at a scratch data root only.
// Uses real services (model, speech synthesis, scoring), so it costs a little credit.
// Usage: node scripts/ui-walkthrough-review.mjs <repo-with-puppeteer-core> <base-url> <fake-mic-48k.wav> <out-dir> <azure-env-file> <auth.json> <scratch-data-root>
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
const HOUR = 3600_000;

async function api(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const parsed = await response.json();
  if (!response.ok) throw new Error(`${route}: ${parsed.error}`);
  return parsed;
}
const call = async (operation, input = {}) => (await api("POST", "/api/plugins/speak-english/call", { operation, input })).result;

/** The backend reads store.json once, when the plugin starts: edit the file while the plugin is off. */
async function editStore(change) {
  await api("PUT", "/api/plugins/speak-english", { enabled: false });
  const stored = JSON.parse(fs.readFileSync(storeFile, "utf8"));
  change(stored);
  fs.writeFileSync(storeFile, JSON.stringify(stored));
  await api("PUT", "/api/plugins/speak-english", { enabled: true });
}

/** Moves the given sentences' schedules into the past, the first one longest overdue. */
const makeDue = sentenceIds => editStore(stored => {
  sentenceIds.forEach((id, index) => {
    const { schedule } = stored.sentences[id];
    schedule.due = Date.now() - (sentenceIds.length - index) * HOUR;
    if (schedule.dueDay) schedule.dueDay = "2026-01-01";
  });
});

const SENTENCES = [
  { native: "我会把这件事告诉他。", target: "I'll tell him about it.", keyExpression: "tell him about it" },
  { native: "这事挺难，但我做成了。", target: "I can't believe I pulled it off.", keyExpression: "pulled it off" },
  { native: "我昨天本来想把整件事原原本本地告诉他，但是一直没有找到合适的机会。", target: "I wanted to tell him about the whole thing yesterday, but I never got the chance to do it.", keyExpression: "got the chance" },
  { native: "就这样。", target: "That's it.", keyExpression: "" },
];

async function prepare() {
  const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#") && line.includes("="))
    .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
  await call("set-secret", { name: "azureKey", value: env.SPEECH_KEY });
  await call("set-secret", { name: "elevenLabsKey", value: JSON.parse(fs.readFileSync(authFile, "utf8")).ELEVENLABS_API_KEY });
  // One miss is enough to be offered an explanation, so the walkthrough reaches it.
  await call("save-settings", { azureRegion: env.SPEECH_REGION, explainAfterFailures: 1 });
  for (const passage of (await call("get-state")).passages) await call("delete-passage", { passageId: passage.id });
  const { state } = await call("create-passage", { register: "formal", version: "sentences", nativeLanguage: "zh-CN", targetLanguage: "en-US", source: SENTENCES.map(sentence => sentence.native).join(""), sentences: SENTENCES });
  const ids = state.passages[0].sentences.map(sentence => sentence.id);
  for (const sentenceId of ids) {
    await call("synthesize-sentence", { sentenceId });
    await call("judge-recall", { attemptId: randomUUID(), sentenceId, said: true });
  }
  await makeDue(ids);
  return ids;
}

const ids = await prepare();
console.log("prepared: due now", (await call("get-state")).review.dueIds.length);
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
  const take = async ms => { await page.keyboard.press("Space"); await pause(ms); await page.keyboard.press("Space"); };
  const marked = () => page.evaluate(() => [...document.querySelectorAll(".se-marked .se-word")].map(node => `${node.textContent}:${node.className.replace("se-word se-word-", "")}`).join(" "));
  const front = async english => { await waitText(".se-card", "剩余 \\d+ 秒"); console.log(`\nfront (${english}):`, await text(".se-card")); };

  // The dev server needs its home page compiled once before a plugin page loads cleanly.
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pause(4000);
  await page.goto(`${baseUrl}/plugins/speak-english/practice`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitText(".se-review", "到期");
  console.log("home:", await text(".se-review"));
  await shot("r1-home");
  await click("开始复习");
  await waitText(".se-card", "现在有 4 句到期");
  await click("开始复习");

  // Card 1: said within the limits.
  await front(SENTENCES[0].target);
  await shot("r2-front");
  await pause(1200);
  await take(3000);
  await waitText(".se-result", "总分|没有逐词比对");
  console.log("back 1:", await marked(), "|", await text(".se-result .se-muted"));
  await shot("r3-back");
  await click("说出来了");

  // Card 2: the start limit runs out; the offered explanation is taken and its simpler wording adopted.
  await front(SENTENCES[1].target);
  await waitText(".se-card", "没有在开始时限内开口", 20000);
  console.log("timed out:", await text(".se-card"), "| header:", await text(".se-header"));
  await shot("r4-timed-out");
  await click("下一句");
  await waitText(".se-card", "已经 1 次没说出来了");
  await click("看讲解");
  await waitText(".se-card", "先分清缺的是什么");
  await shot("r5-classify");
  await click("还是说不出来");
  await waitText(".se-card", "这句难在哪里", 120000);
  console.log("explanation 2:", await text(".se-card"));
  await shot("r6-explanation");
  await click("采用这个说法");
  await pause(300);
  await click("再点一次确认");
  await waitText(".se-card", "新句子在段落里等你试背", 120000);
  console.log("adopted:", await text(".se-card"), "| errors:", await text(".se-error"));
  await click("继续");

  // Card 3: a long sentence, missed by the learner's own verdict; its explanation should offer a split, which is declined.
  await front(SENTENCES[2].target);
  await pause(1000);
  await take(3000);
  await page.waitForSelector(".se-verdict button");
  await click("没说出来");
  await waitText(".se-card", "已经 1 次没说出来了");
  await click("看讲解");
  await waitText(".se-card", "先分清缺的是什么");
  await click("还是说不出来");
  await waitText(".se-card", "这句难在哪里", 120000);
  console.log("explanation 3:", await text(".se-card"));
  await shot("r7-explanation-split");
  await click("不采用");

  // Card 4: missed, but sayable without a time limit: no explanation.
  await front(SENTENCES[3].target);
  await pause(500);
  await take(2000);
  await page.waitForSelector(".se-verdict button");
  await click("没说出来");
  await waitText(".se-card", "已经 1 次没说出来了");
  await click("看讲解");
  await waitText(".se-card", "先分清缺的是什么");
  await click("能说出来");
  await waitText(".se-card", "缺的是速度");
  console.log("speed gap:", await text(".se-card"));
  await click("好的");

  // Nothing else is due: the screen waits for the 10-minute retries.
  await waitText(".se-card", "10 分钟后再来一次");
  console.log("\nwaiting:", await text(".se-card"), "| header:", await text(".se-header"));
  await shot("r8-waiting");
  await click("先到这里");
  await waitText(".se-review", "10 分钟后再来一次");
  console.log("home after:", await text(".se-review"));
  await shot("r9-home-after");

  // What the backend holds now.
  const after = await call("get-state");
  const sentences = after.passages[0].sentences;
  console.log("\nreview:", JSON.stringify({ ...after.review, waiting: after.review.waiting.length }));
  console.log("sentences:", sentences.map(sentence => `${sentence.id === ids[1] ? "OLD" : ids.includes(sentence.id) ? "kept" : "NEW"} "${sentence.target}" audio=${Boolean(sentence.audio)} recall=${sentence.recall} state=${sentence.schedule?.state ?? "-"} misses=${sentence.misses} explained=${Boolean(sentence.explanation)}`));
  await pause(8000);
  const log = JSON.parse(fs.readFileSync(storeFile, "utf8")).attempts.filter(attempt => attempt.kind === "review");
  console.log("review log:", log.map(attempt => `said=${attempt.said} timedOut=${attempt.timedOut} responseMs=${attempt.responseMs} speakMs=${attempt.speakMs} overall=${attempt.scores?.overall ?? "-"}`));

  // Ten minutes later (by editing the store): the retries are due again, and one is said.
  await makeDue(after.review.waiting.map(item => item.sentenceId));
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(".se-review", "现在有 2 句到期");
  await click("开始复习");
  await waitText(".se-card", "现在有 2 句到期");
  await click("开始复习");
  await front("retry");
  await pause(500);
  await take(2500);
  await page.waitForSelector(".se-verdict button");
  await click("说出来了");
  await front("retry 2");
  const retried = (await call("get-state")).passages[0].sentences.filter(sentence => sentence.schedule).map(sentence => `state=${sentence.schedule.state} days=${sentence.schedule.scheduled_days} dueDay=${sentence.schedule.dueDay ?? "-"}`);
  console.log("\nafter one retry said:", retried);
} finally {
  if (problems.length) console.log("PROBLEMS", problems.slice(0, 10));
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
  await call("save-settings", { explainAfterFailures: 3 }).catch(() => {});
}
