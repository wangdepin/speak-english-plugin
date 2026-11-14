// Dev tool: call both speech modules against the real services once. Uses credit; not part of `npm test`.
// Usage: node scripts/live-check.mjs <azure-env-file> <auth.json> [out.mp3]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { synthesizeSpeech } = require("../src/backend/speech/tts.cjs");
const { assessPronunciation } = require("../src/backend/speech/assess.cjs");

const [envFile, authFile, outFile] = process.argv.slice(2);
const env = Object.fromEntries(readFileSync(envFile, "utf8").split("\n")
  .map(line => line.trim()).filter(line => line && !line.startsWith("#") && line.includes("="))
  .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const elevenLabsKey = JSON.parse(readFileSync(authFile, "utf8")).ELEVENLABS_API_KEY;
const wav = new Uint8Array(readFileSync(new URL("../tests/fixtures/audio/tell-him-16k.wav", import.meta.url)));
const sentence = "I'll tell him about it.";

async function timed(label, run, describe) {
  const started = performance.now();
  const outcome = await run().then(describe, error => `${error.name} ${error.code ?? ""} — ${error.message}`);
  console.log(`${label}: ${outcome} (${Math.round(performance.now() - started)} ms)`);
}

await timed("tts eleven_v4", () => synthesizeSpeech({ text: sentence, voiceId: "cgSgspJ2msm6clMCkdW9", modelId: "eleven_v4", key: elevenLabsKey }), audio => {
  if (outFile) writeFileSync(outFile, audio.bytes);
  return `${audio.bytes.length} bytes, ${audio.seconds.toFixed(3)} s`;
});
await timed("tts wrong key", () => synthesizeSpeech({ text: sentence, voiceId: "cgSgspJ2msm6clMCkdW9", modelId: "eleven_v4", key: "0".repeat(32) }), () => "unexpected success");
await timed("assess", () => assessPronunciation({ wav, referenceText: sentence, key: env.SPEECH_KEY, region: env.SPEECH_REGION }), result =>
  `${JSON.stringify(result.scores)} ${result.words.map(word => `${word.word}:${word.errorType}`).join(" ")}`);
await timed("assess wrong key", () => assessPronunciation({ wav, referenceText: sentence, key: "0".repeat(32), region: env.SPEECH_REGION }), () => "unexpected success");
await timed("assess wrong region", () => assessPronunciation({ wav, referenceText: sentence, key: env.SPEECH_KEY, region: "nosuchregion", timeoutMs: 8000 }), () => "unexpected success");
