// Phase 6 spike driver: presses the spike plugin's button, then reports whether the lesson
// opened, whether its first message went out, and whether an agent ran the plugin's tool.
// Usage: node drive-browser.mjs <repo-with-puppeteer-core> <base-url> <LH_DATA_DIR> <screenshot.png>
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [repo, baseUrl, dataDir, screenshot] = process.argv.slice(2);
const PLUGIN = "speak-english-handoff-spike";
const WAIT_FOR_TOOL_MS = 300000;
const require = createRequire(path.join(repo, "package.json"));
const puppeteer = (await import(pathToFileURL(require.resolve("puppeteer-core")).href)).default;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "speak-english-spike-"));
const logFile = path.join(dataDir, "plugins", PLUGIN, "data", "calls.jsonl");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const calls = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : []);

/** One line per saved message: who said it and what kind of content it holds, with the start of any text. */
function outline(message) {
  const content = Array.isArray(message.content) ? message.content : [{ type: "text", text: String(message.content ?? "") }];
  const parts = content.map(part => (part.type === "text" ? `text(${JSON.stringify(part.text.slice(0, 160))})` : part.type === "toolCall" ? `toolCall(${part.name})` : part.type));
  return `${message.role}${message.toolName ? `[${message.toolName}]` : ""}: ${parts.join(", ")}`;
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, userDataDir: profile, defaultViewport: { width: 1280, height: 900 },
});
try {
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));
  // Loading "/" first avoids a reload loop in the dev server's hot-reload client.
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle2", timeout: 120000 });
  await page.goto(`${baseUrl}/plugins/${PLUGIN}/spike`, { waitUntil: "networkidle2", timeout: 120000 });
  await page.waitForSelector('[data-spike="start"]', { timeout: 60000 });
  await page.click('[data-spike="start"]');
  await page.waitForFunction(() => window.__spike, { timeout: 60000 });
  const started = await page.evaluate(() => window.__spike);
  console.log("STARTED", JSON.stringify(started));
  if (started.error) process.exit(1);
  await page.waitForFunction(id => location.pathname.includes(id), { timeout: 30000 }, started.chatId);
  console.log("OPENED", new URL(page.url()).pathname);

  const deadline = Date.now() + WAIT_FOR_TOOL_MS;
  const executed = () => calls().some(call => call.event === "execute" && call.chatId === started.chatId);
  while (!executed() && Date.now() < deadline) await pause(3000);
  // Give the turn a little time to finish writing its reply.
  await pause(20000);
  console.log("CALLS", JSON.stringify(calls().filter(call => call.chatId === started.chatId).map(({ event, agent, offered }) => ({ event, agent, offered }))));
  const chat = await page.evaluate(async id => (await fetch(`/api/chats/${id}`)).json(), started.chatId);
  const messages = chat.messages ?? chat.chat?.messages ?? [];
  console.log("TITLE", JSON.stringify(chat.title ?? chat.chat?.title));
  for (const message of messages) console.log("  ", outline(message));
  if (screenshot) await page.screenshot({ path: screenshot });
  if (problems.length) console.log("PROBLEMS", problems.slice(0, 8));
  console.log(executed() ? "TOOL RAN IN THE NEW LESSON" : "TOOL DID NOT RUN");
} finally {
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
