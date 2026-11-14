// Phase 0 spike: Azure pronunciation assessment over plain REST from Node (no SDK).
// Usage: node azure-rest.mjs <env-file> <wav> "<reference text>"
import { readFileSync, writeFileSync } from "node:fs";

const [envFile, wavFile, referenceText, outFile] = process.argv.slice(2);
const env = Object.fromEntries(readFileSync(envFile, "utf8").split("\n")
  .map(line => line.trim()).filter(line => line && !line.startsWith("#") && line.includes("="))
  .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const region = env.SPEECH_REGION || "swedencentral";

const assessment = {
  ReferenceText: referenceText, GradingSystem: "HundredMark", Granularity: "Phoneme", Dimension: "Comprehensive",
  EnableMiscue: true, EnableProsodyAssessment: true, PhonemeAlphabet: "IPA", NBestPhonemeCount: 3,
};
const started = Date.now();
const response = await fetch(`https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`, {
  method: "POST",
  headers: {
    "Ocp-Apim-Subscription-Key": env.SPEECH_KEY,
    "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
    Accept: "application/json",
    "Pronunciation-Assessment": Buffer.from(JSON.stringify(assessment), "utf8").toString("base64"),
  },
  body: readFileSync(wavFile),
});
const text = await response.text();
console.log("http", response.status, `${Date.now() - started} ms`);
if (!response.ok) { console.log(text.slice(0, 400)); process.exit(1); }
const result = JSON.parse(text);
if (outFile) writeFileSync(outFile, JSON.stringify(result, null, 1));
const best = result.NBest?.[0] ?? {};
console.log("status", result.RecognitionStatus, "| display:", best.Display);
// REST returns scores flat on NBest[0]; the SDK nests them under PronunciationAssessment.
const scores = best.PronunciationAssessment ?? best;
console.log("scores", JSON.stringify(Object.fromEntries(["AccuracyScore", "FluencyScore", "ProsodyScore", "CompletenessScore", "PronScore"].map(k => [k, scores[k]]))));
for (const word of best.Words ?? []) {
  const w = word.PronunciationAssessment ?? word;
  const phonemes = (word.Phonemes ?? []).map(p => {
    const pa = p.PronunciationAssessment ?? p;
    const heard = pa.NBestPhonemes?.[0]?.Phoneme;
    return `${p.Phoneme}${heard && heard !== p.Phoneme ? "→" + heard : ""}(${Math.round(pa.AccuracyScore)})${pa.NBestPhonemes ? "" : "[no-nbest]"}`;
  }).join(" ");
  console.log(` ${word.Word.padEnd(8)} ${String(w.ErrorType).padEnd(16)} ${String(w.AccuracyScore ?? "-").padEnd(5)} ${phonemes}`);
}
