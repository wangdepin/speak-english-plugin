import json, sys, subprocess, time
from pathlib import Path
import azure.cognitiveservices.speech as speechsdk
from speechcoach.config import Settings
from speechcoach import tts

out = Path(sys.argv[1]); sc = Path(sys.argv[2])
settings = Settings.from_env(dotenv_path=sc / ".env")
sentences = dict(l.strip().split("|", 1) for l in (out / "sentences.txt").read_text().splitlines() if l.strip())

# 1. Azure baseline clips
for sid, text in sentences.items():
    f = out / f"{sid}_azure_jenny.wav"
    t = time.time(); tts.synthesize(text, f, settings); print(f"azure_jenny {sid} {time.time()-t:.2f}s")

# 2. Phoneme probe on s1 and s3: what does Azure hear for selected phonemes?
def probe(wav, text):
    cfg = speechsdk.SpeechConfig(subscription=settings.speech_key, region=settings.region)
    cfg.speech_recognition_language = "en-US"
    pa = speechsdk.PronunciationAssessmentConfig(reference_text=text,
        grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
        granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme, enable_miscue=True)
    pa.phoneme_alphabet = "IPA"; pa.nbest_phoneme_count = 3
    rec = speechsdk.SpeechRecognizer(speech_config=cfg, audio_config=speechsdk.audio.AudioConfig(filename=str(wav)))
    pa.apply_to(rec)
    res = rec.recognize_once_async().get()
    js = res.properties.get(speechsdk.PropertyId.SpeechServiceResponse_JsonResult)
    return json.loads(js) if js else {}

first = True
for sid in ("s1", "s3"):
    text = sentences[sid]
    for src in sorted(out.glob(f"{sid}_*")):
        if src.suffix not in (".mp3", ".wav"): continue
        wav = src
        if src.suffix == ".mp3":
            wav = Path(sys.argv[3]) / (src.stem + ".wav")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ar", "16000", "-ac", "1", str(wav)], check=True)
        data = probe(wav, text)
        if first:
            (Path(sys.argv[3]) / "nbest_sample.json").write_text(json.dumps(data, indent=1)); first = False
        words = (data.get("NBest") or [{}])[0].get("Words", [])
        parts = []
        for w in words:
            ph = []
            for p in w.get("Phonemes", []):
                pa_ = p.get("PronunciationAssessment", {})
                nb = pa_.get("NBestPhonemes") or []
                top = nb[0]["Phoneme"] if nb else "?"
                mark = p["Phoneme"] if top == p["Phoneme"] else f'{p["Phoneme"]}→{top}'
                ph.append(f'{mark}({pa_.get("AccuracyScore", 0):.0f})')
            parts.append(f'{w["Word"]}[{" ".join(ph)}]')
        print(src.name.ljust(40), " ".join(parts))
