// Dev tool: record one real Azure pronunciation-assessment REST exchange as a test fixture.
// Usage: node capture-azure-fixture.mjs <env-file> <audio-file> "<reference text>" <out.json> [--bad-key] [--content-type <type>]
import { readFileSync, writeFileSync } from "node:fs";

const [envFile, audioFile, referenceText, outFile, ...flags] = process.argv.slice(2);
const env = Object.fromEntries(readFileSync(envFile, "utf8").split("\n")
  .map(line => line.trim()).filter(line => line && !line.startsWith("#") && line.includes("="))
  .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const contentTypeFlag = flags.indexOf("--content-type");
const assessment = {
  ReferenceText: referenceText, GradingSystem: "HundredMark", Granularity: "Phoneme", Dimension: "Comprehensive",
  EnableMiscue: true, EnableProsodyAssessment: true, PhonemeAlphabet: "IPA", NBestPhonemeCount: 3,
};
const response = await fetch(`https://${env.SPEECH_REGION || "swedencentral"}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`, {
  method: "POST",
  headers: {
    "Ocp-Apim-Subscription-Key": flags.includes("--bad-key") ? "0".repeat(32) : env.SPEECH_KEY,
    "Content-Type": contentTypeFlag >= 0 ? flags[contentTypeFlag + 1] : "audio/wav; codecs=audio/pcm; samplerate=16000",
    Accept: "application/json",
    "Pronunciation-Assessment": Buffer.from(JSON.stringify(assessment), "utf8").toString("base64"),
  },
  body: readFileSync(audioFile),
});
const bodyText = await response.text();
let body; try { body = JSON.parse(bodyText); } catch { body = null; }
writeFileSync(outFile, `${JSON.stringify({ referenceText, status: response.status, contentType: response.headers.get("content-type"), body, bodyText: body ? undefined : bodyText }, null, 1)}\n`);
const best = body?.NBest?.[0];
console.log(outFile.split("/").pop(), "→", response.status, body?.RecognitionStatus ?? bodyText.slice(0, 120), best ? `| ${best.Display} | ${(best.Words ?? []).map(w => `${w.Word}:${w.ErrorType}`).join(" ")}` : "");
