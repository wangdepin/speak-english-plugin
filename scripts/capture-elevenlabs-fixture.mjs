// Dev tool: record one real ElevenLabs text-to-speech exchange as a test fixture.
// Error responses are saved as JSON; a successful response saves its audio next to the JSON.
// Usage: node capture-elevenlabs-fixture.mjs <auth.json> <out.json> [--bad-key] [--voice <id>] [--model <id>] [--text <text>]
import { readFileSync, writeFileSync } from "node:fs";

const [authFile, outFile, ...flags] = process.argv.slice(2);
const option = (name, fallback) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : fallback);
const key = flags.includes("--bad-key") ? "0".repeat(32) : JSON.parse(readFileSync(authFile, "utf8")).ELEVENLABS_API_KEY;
const voiceId = option("--voice", "cgSgspJ2msm6clMCkdW9");
const modelId = option("--model", "eleven_flash_v2_5");
const text = option("--text", "I'll tell him about it.");

const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
  method: "POST",
  headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
  body: JSON.stringify({ text, model_id: modelId }),
});
const contentType = response.headers.get("content-type");
const record = { request: { voiceId, modelId, text }, status: response.status, contentType };
if (response.ok) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  record.audioFile = outFile.replace(/\.json$/, ".mp3").split("/").pop();
  record.audioBytes = bytes.length;
  writeFileSync(outFile.replace(/\.json$/, ".mp3"), bytes);
} else {
  const bodyText = await response.text();
  try { record.body = JSON.parse(bodyText); } catch { record.bodyText = bodyText; }
}
writeFileSync(outFile, `${JSON.stringify(record, null, 1)}\n`);
console.log(outFile.split("/").pop(), "→", response.status, contentType, response.ok ? `${record.audioBytes} bytes` : JSON.stringify(record.body ?? record.bodyText).slice(0, 200));
