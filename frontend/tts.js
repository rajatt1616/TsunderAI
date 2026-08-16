// --- TTS + Lip-Sync engine ---
// Adapted from the app's own kokoro_manager.js / audio_context_manager.js / audio_player.js.
// Local neural TTS (Kokoro) with analyser-driven lip sync; falls back to browser speechSynthesis.

let ttsAudioContext = null;
let ttsAnalyser = null;
let ttsGainNode = null;
let currentAudioSource = null;

// ---- Voice tuning (make her sound more feminine) ----
// Kokoro voice choices (all "af_" = American female): af_heart (sweet/warm),
// af_sky (bright/energetic), af_bella (elegant), af_jessica (young),
// af_aoede (musical/lyrical). af_sky reads the most youthful/cheery.
const KOKORO_VOICE = 'af_sky';
// >1 raises the pitch = brighter, more feminine. 1.15 is a clear lift.
const VOICE_PITCH = 1.15;
// Generation runs synchronously on the main thread (Kokoro WASM), so a slower
// generation speed would freeze the whole page (Live2D included) longer on
// EVERY spoken line. Generate at native speed instead; the playback pitch
// boost still carries the feminine lift (at a slightly brisker tempo).
const VOICE_SPEED = 1.0;

// Which TTS engine is actually active ("kokoro" | "system") — shown in the
// HUD badge and logged so it's obvious which path is running.
function updateVoiceBadge() {
  const kokoro = !!window.isKokoroReady;
  window.voiceEngine = kokoro ? 'kokoro' : 'system';
  const el = document.getElementById('voice-badge');
  if (el) {
    el.textContent = kokoro ? 'kokoro' : 'system';
    el.classList.toggle('kokoro', kokoro);
    el.title = kokoro ? 'Kokoro neural TTS (af_' + KOKORO_VOICE.slice(3) + ')' : 'Browser speechSynthesis';
  }
  console.log('[tts] voice engine:', kokoro ? 'KOKORO (' + KOKORO_VOICE + ')' : 'BROWSER speechSynthesis');
}
updateVoiceBadge();

function unlockAudioContext(audioCtx) {
  if (!audioCtx || audioCtx.state !== 'suspended') return;
  const resumeAudio = () => {
    audioCtx
      .resume()
      .then(() => {
        window.removeEventListener('click', resumeAudio);
        window.removeEventListener('keydown', resumeAudio);
      })
      .catch(() => {});
  };
  window.addEventListener('click', resumeAudio);
  window.addEventListener('keydown', resumeAudio);
}

function getTTSAudioContext() {
  if (!ttsAudioContext || ttsAudioContext.state === 'closed') {
    ttsAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (ttsAnalyser) {
      try { ttsAnalyser.disconnect(); } catch (e) { /* ignore */ }
      ttsAnalyser = null;
    }
    // Unlock on the first user gesture (click/keydown) anywhere on the page.
    unlockAudioContext(ttsAudioContext);
  }
  if (ttsAudioContext.state === 'suspended') {
    ttsAudioContext.resume().catch(() => {});
  }
  return ttsAudioContext;
}

function getTTSGainNode() {
  const ctx = getTTSAudioContext();
  if (!ttsGainNode || ttsGainNode.context !== ctx) {
    ttsGainNode = ctx.createGain();
    ttsGainNode.gain.value = 1.0;
    ttsGainNode.connect(ctx.destination);
  }
  return ttsGainNode;
}

function getTTSAnalyser() {
  const ctx = getTTSAudioContext();
  if (!ttsAnalyser || ttsAnalyser.context !== ctx) {
    if (ttsAnalyser) {
      try { ttsAnalyser.disconnect(); } catch (e) { /* ignore */ }
    }
    ttsAnalyser = ctx.createAnalyser();
    ttsAnalyser.fftSize = 256;
    ttsAnalyser.smoothingTimeConstant = 0.4;
    ttsAnalyser.connect(getTTSGainNode());
    window.__lipAnalyser = ttsAnalyser;
    window.__lipData = new Uint8Array(ttsAnalyser.frequencyBinCount);
  }
  return ttsAnalyser;
}

window.getTTSAudioContext = getTTSAudioContext;
window.getTTSAnalyser = getTTSAnalyser;
window.getTTSGainNode = getTTSGainNode;

// ---- Kokoro TTS runs in a Web Worker (tts-worker.js) ----
// Model load + ONNX inference happen off the main thread so the page never
// freezes while she "thinks". The worker imports kokoro-js itself; this side
// only spawns the worker, marshals init/generate requests, and plays audio.
let ttsWorker = null;
let workerIdCounter = 0;
const workerPending = new Map(); // id -> { resolve, reject }

function createTTSWorker() {
  try {
    return new Worker('tts-worker.js', { type: 'module' });
  } catch (err) {
    console.warn('[tts] Web Worker creation failed:', err.message);
    return null;
  }
}

function failKokoro(message) {
  window.isKokoroReady = false;
  window.isKokoroLoading = false;
  updateVoiceBadge();
  workerPending.forEach((p) => p.reject(new Error(message)));
  workerPending.clear();
}

function setupWorkerHandlers(worker) {
  worker.onmessage = (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'ready') {
      window.isKokoroReady = true;
      window.isKokoroLoading = false;
      updateVoiceBadge();
      console.log(`[tts] Kokoro ready! (Device: ${msg.device}, Type: ${msg.dtype})`);
    } else if (msg.type === 'error') {
      if (msg.id !== undefined) {
        const pending = workerPending.get(msg.id);
        if (pending) {
          workerPending.delete(msg.id);
          pending.reject(new Error(msg.message));
        }
      } else {
        console.warn('[tts] Kokoro init failed:', msg.message);
        failKokoro(msg.message);
      }
    } else if (msg.type === 'audio') {
      const pending = workerPending.get(msg.id);
      if (pending) {
        workerPending.delete(msg.id);
        pending.resolve({
          buffer: msg.buffer,
          byteOffset: msg.byteOffset || 0,
          length: msg.length,
          sampling_rate: msg.sampling_rate,
        });
      }
    }
  };

  worker.onerror = (event) => {
    console.warn('[tts] Worker error:', event && event.message);
    failKokoro('tts worker crashed');
  };
}

// Silently preload the Kokoro ONNX model in the background. Call at startup
// without await; the worker's "ready"/"error" message updates the voice badge.
window.preloadKokoroInBackground = function () {
  if (window.isKokoroReady || window.isKokoroLoading) return;

  const isLowRAM = navigator.deviceMemory && navigator.deviceMemory < 4;
  const isSlowNetwork =
    navigator.connection &&
    (navigator.connection.effectiveType === '2g' || navigator.connection.effectiveType === '3g');

  if (isLowRAM || isSlowNetwork) {
    console.warn(
      `[tts] Kokoro TTS disabled safely (${isLowRAM ? 'Low RAM' : 'Slow Network'}). Falling back to browser TTS.`
    );
    window.isKokoroReady = false;
    updateVoiceBadge();
    return;
  }

  window.isKokoroLoading = true;
  console.log('[tts] Silently preloading Kokoro in a Web Worker...');

  ttsWorker = createTTSWorker();
  if (!ttsWorker) {
    failKokoro('could not create worker');
    return;
  }
  setupWorkerHandlers(ttsWorker);
  ttsWorker.postMessage({ type: 'init' });
};

// Generates audio using Kokoro (inside the worker) and returns an AudioBuffer
// (or null on any failure, so callers fall back to browser TTS).
window.generateKokoroAudioBuffer = function (text, voice = KOKORO_VOICE) {
  if (!window.isKokoroReady || !ttsWorker) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const id = ++workerIdCounter;
    workerPending.set(id, { resolve, reject });
    ttsWorker.postMessage({ type: 'generate', id, text, voice, speed: VOICE_SPEED });
  })
    .then((raw) => {
      const ctx = getTTSAudioContext();
      const float32 = new Float32Array(raw.buffer, raw.byteOffset, raw.length);
      const buffer = ctx.createBuffer(1, raw.length, raw.sampling_rate);
      buffer.copyToChannel(float32, 0);
      return buffer;
    })
    .catch((err) => {
      console.warn('[tts] Kokoro generation failed:', err && err.message ? err.message : err);
      return null;
    });
};

// Plays a buffer through the analyser. Lip-sync and emotion are tied to the
// audio lifecycle: `onStart` fires in the same frame as `source.start()`,
// `onEnd` fires on `onended`, and the flags drive Pixi's ticker.
// `callbacks.distort` is the demon-voice intensity (0..1). When > 0 the source
// is pitched down, bit-crushed, and filtered so her voice sounds possessed.
window.playAudioBuffer = function (buffer, callbacks = {}) {
  if (!buffer) return false;

  const ctx = getTTSAudioContext();
  const start = () => {
    // Voice-overlap lock: kill any previously playing source so streams never
    // layer over each other. Null its onended first so a late stop() can't
    // clear the __isSpeaking flag right after the new source sets it.
    if (currentAudioSource) {
      try { currentAudioSource.onended = null; } catch (e) { /* ignore */ }
      try { currentAudioSource.stop(); } catch (e) { /* ignore */ }
      currentAudioSource = null;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const analyser = getTTSAnalyser();

    const intensity = Math.min(1, Math.max(0, Number(callbacks.distort) || 0));
    if (intensity > 0) {
      // 1) Pitch down: the deeper her anger, the lower she drops.
      const pitch = 1 - 0.5 * intensity; // 1.0 -> 0.5 (up to an octave down)
      source.playbackRate.value = pitch;

      // 2) Bit-crush: quantize amplitude harder at higher intensity.
      const shaper = ctx.createWaveShaper();
      const bits = Math.max(2, Math.round(4 - 2 * intensity)); // 4 -> 2 bits
      const steps = Math.pow(2, bits);
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.round(x * steps) / steps;
      }
      shaper.curve = curve;
      shaper.oversample = '4x';

      // 3) Resonant lowpass: darkens + howls, softened a touch by Q.
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900 + 1500 * intensity;
      filter.Q.value = 4 + 6 * intensity;

      // 4) Ring-mod tremolo: wobbly "possessed" shimmer at higher intensity.
      let lfo = null;
      if (intensity > 0.55) {
        lfo = ctx.createOscillator();
        lfo.frequency.value = 4 + 10 * (intensity - 0.55);
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.3 * intensity;
        const ring = ctx.createGain();
        ring.gain.value = 1;
        lfo.connect(lfoGain);
        lfoGain.connect(ring.gain);
        filter.connect(ring);
        ring.connect(analyser);
        lfo.start();
      } else {
        filter.connect(analyser);
      }

      source.connect(shaper);
      shaper.connect(filter);

      source.onended = () => {
        window.__isSpeaking = false;
        window.__isAnalyserSpeaking = false;
        if (currentAudioSource === source) currentAudioSource = null;
        try { source.disconnect(); } catch (e) { /* ignore */ }
        try { shaper.disconnect(); } catch (e) { /* ignore */ }
        try { filter.disconnect(); } catch (e) { /* ignore */ }
        if (lfo) {
          try { lfo.stop(); } catch (e) { /* ignore */ }
          try { lfo.disconnect(); } catch (e) { /* ignore */ }
        }
        if (callbacks.onEnd) callbacks.onEnd();
      };
    } else {
      source.connect(analyser);
      // Brighten her voice with a slight upward pitch shift (feminine lift).
      if (VOICE_PITCH !== 1) source.playbackRate.value = VOICE_PITCH;
      source.onended = () => {
        window.__isSpeaking = false;
        window.__isAnalyserSpeaking = false;
        if (currentAudioSource === source) currentAudioSource = null;
        try { source.disconnect(); } catch (e) { /* ignore */ }
        if (callbacks.onEnd) callbacks.onEnd();
      };
    }

    currentAudioSource = source;
    window.__isSpeaking = true;
    window.__isAnalyserSpeaking = true;
    if (callbacks.onStart) callbacks.onStart();
    source.start(0);
  };

  if (ctx.state === 'suspended') {
    ctx.resume().then(start).catch(start);
  } else {
    start();
  }
  return true;
};

// Hard-stops whatever Kokoro buffer is currently playing. Used by the app's
// speechSynthesis fallback so browser TTS never layers over a live source.
window.stopAudioBuffer = function () {
  if (!currentAudioSource) return;
  try { currentAudioSource.onended = null; } catch (e) { /* ignore */ }
  try { currentAudioSource.stop(); } catch (e) { /* ignore */ }
  currentAudioSource = null;
  window.__isSpeaking = false;
  window.__isAnalyserSpeaking = false;
};