// Dev tool: for each locale, synthesize one sentence in that language and score the result,
// to see that both services accept the language and how native the voice sounds in it.
// Uses credit; not part of `npm test`.
// Usage: node scripts/language-check.mjs <azure-env-file> <auth.json> <out-dir> [locale ...]
//   With no locale, every supported one is checked. Raw scoring replies are written to <out-dir>.
//   Set TTS_MODEL or TTS_VOICE to try another model or voice.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { LANGUAGES, LANGUAGE_CODES } = require("../src/backend/languages.cjs");
const { assessmentOptions } = require("../src/backend/speech/azure-request.cjs");

const SENTENCES = {
  ar: "الطقس جميل اليوم، فلنذهب للتنزه في الحديقة.",
  ca: "Avui fa bon temps, anem a passejar pel parc.",
  yue: "今日天氣好好，我哋去公園散步啦。",
  "zh-CN": "今天天气很好，我们去公园散步吧。",
  "zh-TW": "今天天氣很好，我們去公園散步吧。",
  da: "Vejret er dejligt i dag, så lad os gå en tur i parken.",
  nl: "Het is mooi weer vandaag, dus laten we in het park gaan wandelen.",
  en: "The weather is nice today, so let's go for a walk in the park.",
  fi: "Tänään on kaunis ilma, joten mennään kävelylle puistoon.",
  fr: "Il fait beau aujourd'hui, allons nous promener dans le parc.",
  de: "Heute ist schönes Wetter, lass uns im Park spazieren gehen.",
  hi: "आज मौसम अच्छा है, चलो पार्क में टहलने चलते हैं।",
  it: "Oggi c'è bel tempo, andiamo a fare una passeggiata nel parco.",
  ja: "今日は天気がいいので、公園を散歩しましょう。",
  ko: "오늘 날씨가 좋으니까 공원에서 산책합시다.",
  ms: "Cuaca hari ini baik, jom kita berjalan-jalan di taman.",
  no: "Det er fint vær i dag, så la oss gå en tur i parken.",
  pl: "Dzisiaj jest ładna pogoda, więc chodźmy na spacer do parku.",
  pt: "O tempo está bom hoje, vamos dar um passeio no parque.",
  ru: "Сегодня хорошая погода, давайте погуляем в парке.",
  es: "Hoy hace buen tiempo, vamos a dar un paseo por el parque.",
  sv: "Det är fint väder i dag, så låt oss ta en promenad i parken.",
  ta: "இன்று வானிலை நன்றாக இருக்கிறது, பூங்காவில் நடக்கலாம்.",
  th: "วันนี้อากาศดี ไปเดินเล่นที่สวนสาธารณะกันเถอะ",
  vi: "Hôm nay trời đẹp, chúng ta đi dạo trong công viên nhé.",
};

const [envFile, authFile, outDir, ...requested] = process.argv.slice(2);
const env = Object.fromEntries(readFileSync(envFile, "utf8").split("\n")
  .map(line => line.trim()).filter(line => line && !line.startsWith("#") && line.includes("="))
  .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const elevenLabsKey = JSON.parse(readFileSync(authFile, "utf8")).ELEVENLABS_API_KEY;
const model = process.env.TTS_MODEL || "eleven_v4";
const voice = process.env.TTS_VOICE || "cgSgspJ2msm6clMCkdW9";
mkdirSync(outDir, { recursive: true });

/** Wraps raw 16 kHz mono 16-bit PCM in the plain 44-byte WAV header. */
function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function synthesize(text, locale) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=pcm_16000`, {
    method: "POST",
    headers: { "xi-api-key": elevenLabsKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: model, language_code: LANGUAGES[locale].tts }),
  });
  if (!response.ok) throw new Error(`synthesis ${response.status} ${(await response.text()).slice(0, 160)}`);
  return wavFromPcm(Buffer.from(await response.arrayBuffer()));
}

async function assess(wav, text, locale) {
  const header = Buffer.from(JSON.stringify({ ReferenceText: text, ...assessmentOptions(locale) }), "utf8").toString("base64");
  const response = await fetch(`https://${env.SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${locale}&format=detailed`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": env.SPEECH_KEY, "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000", Accept: "application/json", "Pronunciation-Assessment": header },
    body: wav,
  });
  const bodyText = await response.text();
  let body; try { body = JSON.parse(bodyText); } catch { body = null; }
  return { referenceText: text, status: response.status, contentType: response.headers.get("content-type"), body, bodyText: body ? undefined : bodyText };
}

for (const locale of requested.length > 0 ? requested : LANGUAGE_CODES) {
  const text = SENTENCES[locale] ?? SENTENCES[LANGUAGES[locale].tts];
  try {
    const wav = await synthesize(text, locale);
    writeFileSync(path.join(outDir, `${locale}.wav`), wav);
    const recorded = await assess(wav, text, locale);
    writeFileSync(path.join(outDir, `${locale}.json`), `${JSON.stringify(recorded, null, 1)}\n`);
    const best = recorded.body?.NBest?.[0];
    const words = best?.Words ?? [];
    const flagged = words.filter(word => word.ErrorType && word.ErrorType !== "None").map(word => `${word.Word}:${word.ErrorType}`).join(" ");
    console.log(`${locale}  ${recorded.status} ${recorded.body?.RecognitionStatus ?? ""}  overall ${best?.PronScore ?? "—"} accuracy ${best?.AccuracyScore ?? "—"} fluency ${best?.FluencyScore ?? "—"} completeness ${best?.CompletenessScore ?? "—"} prosody ${best?.ProsodyScore ?? "—"}  words ${words.length}${flagged ? `  ${flagged}` : ""}`);
  } catch (error) {
    console.log(`${locale}  FAILED ${error.message}`);
  }
}
