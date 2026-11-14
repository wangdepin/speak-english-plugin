'use strict';
// Phase 0 throwaway backend. Reads the Azure key from an env file whose path is
// given in <dataDirectory>/spike-config.json; the key never reaches the frontend.
const fs = require('node:fs');
const path = require('node:path');

function readEnv(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n')
    .map(line => line.trim()).filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
}

exports.activate = ctx => {
  ctx.handle('echo', input => {
    if (!input || typeof input.data !== 'string') throw new Error('echo expects {data: string}');
    return { length: input.data.length, head: input.data.slice(0, 8), tail: input.data.slice(-8) };
  });

  ctx.handle('assess', async input => {
    if (!input || typeof input.wavBase64 !== 'string' || typeof input.referenceText !== 'string') {
      throw new Error('assess expects {wavBase64: string, referenceText: string}');
    }
    const config = JSON.parse(fs.readFileSync(path.join(ctx.dataDirectory, 'spike-config.json'), 'utf8'));
    const env = readEnv(config.envFile);
    const wav = Buffer.from(input.wavBase64, 'base64');
    const assessment = {
      ReferenceText: input.referenceText, GradingSystem: 'HundredMark', Granularity: 'Phoneme', Dimension: 'Comprehensive',
      EnableMiscue: true, EnableProsodyAssessment: true, PhonemeAlphabet: 'IPA', NBestPhonemeCount: 3,
    };
    const started = Date.now();
    const response = await fetch(`https://${env.SPEECH_REGION || 'swedencentral'}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.SPEECH_KEY,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        Accept: 'application/json',
        'Pronunciation-Assessment': Buffer.from(JSON.stringify(assessment), 'utf8').toString('base64'),
      },
      body: wav,
      signal: ctx.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Azure ${response.status}: ${text.slice(0, 200)}`);
    const result = JSON.parse(text);
    const best = (result.NBest && result.NBest[0]) || {};
    return {
      wavBytes: wav.length, azureMs: Date.now() - started, status: result.RecognitionStatus, display: best.Display,
      scores: { accuracy: best.AccuracyScore, fluency: best.FluencyScore, prosody: best.ProsodyScore, completeness: best.CompletenessScore, pron: best.PronScore },
      words: (best.Words || []).map(word => ({
        word: word.Word, errorType: word.ErrorType, accuracy: word.AccuracyScore,
        phonemes: (word.Phonemes || []).map(p => ({ expected: p.Phoneme, accuracy: p.AccuracyScore, heard: (p.NBestPhonemes || []).map(n => n.Phoneme) })),
      })),
    };
  });
};
