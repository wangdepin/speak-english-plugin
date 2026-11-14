// Phase 0 throwaway frontend: microphone -> 16 kHz mono WAV -> backend -> Azure.
const SAMPLE_RATE = 16000;

function encodeWav(samples) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Uint8Array(view.buffer);
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function recordBlob(milliseconds) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    await new Promise(resolve => setTimeout(resolve, milliseconds));
    recorder.stop();
    await stopped;
    return new Blob(chunks, { type: recorder.mimeType });
  } finally {
    stream.getTracks().forEach(track => track.stop());
  }
}

async function blobToWav(blob) {
  const decoder = new AudioContext();
  try {
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    return { wav: encodeWav(rendered.getChannelData(0)), seconds: decoded.duration, sourceRate: decoded.sampleRate };
  } finally {
    await decoder.close();
  }
}

export function activate(context) {
  context.registerView({
    id: 'spike',
    name: 'Speak English spike',
    mount(container) {
      const log = document.createElement('pre');
      log.dataset.spike = 'log';
      log.style.whiteSpace = 'pre-wrap';
      const say = line => { log.textContent += `${line}\n`; };
      const run = async (name, work) => {
        const started = performance.now();
        try {
          const result = await work();
          window.__spike[name] = { ok: true, ms: Math.round(performance.now() - started), result };
        } catch (error) {
          window.__spike[name] = { ok: false, ms: Math.round(performance.now() - started), error: `${error && error.name}: ${error && error.message}` };
        }
        say(`${name}: ${JSON.stringify(window.__spike[name])}`);
      };
      window.__spike = {};

      const reference = document.createElement('input');
      reference.value = "I'll tell him about it.";
      reference.style.width = '28rem';
      const record = document.createElement('button');
      record.dataset.spike = 'record';
      record.textContent = 'Record 4 s and score';
      record.onclick = () => run('record', async () => {
        const blob = await recordBlob(4000);
        const converted = await blobToWav(blob);
        const assessed = await context.call('assess', { wavBase64: toBase64(converted.wav), referenceText: reference.value });
        return { recordedType: blob.type, recordedBytes: blob.size, seconds: converted.seconds, sourceRate: converted.sourceRate, wavBytes: converted.wav.length, assessed };
      });
      const payload = document.createElement('button');
      payload.dataset.spike = 'payload';
      payload.textContent = 'Send a 30 s WAV through ctx.call';
      payload.onclick = () => run('payload', async () => {
        const samples = new Float32Array(SAMPLE_RATE * 30).map((_, i) => Math.sin(i / 20) * 0.2);
        const base64 = toBase64(encodeWav(samples));
        const echoed = await context.call('echo', { data: base64 });
        return { sentChars: base64.length, echoedChars: echoed.length, intact: echoed.length === base64.length && echoed.head === base64.slice(0, 8) && echoed.tail === base64.slice(-8) };
      });
      container.append(reference, document.createElement('br'), record, payload, log);
      say('ready');
      return () => container.replaceChildren();
    },
  });
  context.registerAction({ id: 'open', name: 'Speak English spike', run: () => context.app.openView('spike') });
  context.placeAction({ id: 'open-sidebar', actionId: 'open', location: 'sidebar' });
}
