// Kokoro TTS runs entirely inside this Web Worker so the ONNX model load and
// inference never block the main thread (Live2D animation, typing, UI).
// The worker imports kokoro-js itself from the CDN; the main thread only
// marshals init/generate requests and plays the returned audio.

import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';

let tts = null;

async function init() {
  const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
  const attempts = hasWebGPU
    ? [
        { device: 'webgpu', dtype: 'fp32' },
        { device: 'wasm', dtype: 'q8' },
      ]
    : [{ device: 'wasm', dtype: 'q8' }];

  let lastErr = null;
  for (const cfg of attempts) {
    try {
      tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', cfg);
      return cfg;
    } catch (err) {
      lastErr = err;
      self.postMessage({
        type: 'warn',
        message: `[tts-worker] ${cfg.device}/${cfg.dtype} failed, retrying: ${err && err.message}`,
      });
    }
  }
  throw lastErr;
}

self.addEventListener('message', async (event) => {
  const msg = event.data;
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'init') {
    try {
      const cfg = await init();
      self.postMessage({ type: 'ready', device: cfg.device, dtype: cfg.dtype });
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
    return;
  }

  if (msg.type === 'generate') {
    if (!tts) {
      self.postMessage({ type: 'error', id: msg.id, message: 'Kokoro not initialized' });
      return;
    }
    try {
      const raw = await tts.generate(msg.text, { voice: msg.voice, speed: msg.speed || 1.0 });
      const data = raw.audio;
      self.postMessage(
        {
          type: 'audio',
          id: msg.id,
          buffer: data.buffer,
          byteOffset: data.byteOffset,
          length: data.length,
          sampling_rate: raw.sampling_rate,
        },
        [data.buffer]
      );
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
    }
  }
});