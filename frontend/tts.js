// --- TTS + Lip-Sync engine ---
// Adapted from the app's own kokoro_manager.js / audio_context_manager.js / audio_player.js.
// Primary: Edge neural TTS (backend /api/tts) with analyser-driven lip sync.
// Fallbacks: local Kokoro in a Web Worker, then browser speechSynthesis.

let ttsAudioContext = null;
let ttsAnalyser = null;
let ttsGainNode = null;
let currentAudioSource = null;

// ---- Voice tuning (make her sound like an anime girl) ----
// Kokoro voice choices (all "af_" = American female): af_heart (sweet/warm),
// af_sky (bright/energetic), af_bella (elegant), af_jessica (young),
// af_aoede (musical/lyrical). af_sky reads the most youthful/cheery.
const KOKORO_VOICE = 'af_sky';
// Edge (Microsoft neural) voice used when the backend /api/tts route is
// reachable. en-US-AriaNeural is the locked-in primary: bright, youthful, and
// natural. She NEVER changes mid-session — the voice is pinned to this one.
const EDGE_VOICE = 'en-US-AriaNeural';
// The anime-girl lift is applied by Edge itself via its SSML `pitch` (Hz),
// so formants are preserved and it sounds like a real young woman — not a
// resampled chipmunk. BASE_PITCH_HZ is the neutral-register lift; each
// emotion rides a small offset around it in VOICE_PRESETS.
const BASE_PITCH_HZ = 45;
// Per-character voice register. Each model profile raises/lowers this from
// app.js via setTTSBasePitch (a male model sits ~20Hz, a gentle one ~40Hz),
// so every persona sounds like a different person without resampling.
let ttsBasePitchHz = BASE_PITCH_HZ;
window.setTTSBasePitch = function (hz) {
  ttsBasePitchHz = Number.isFinite(hz) ? hz : BASE_PITCH_HZ;
};
// Per-emotion SSML pitch offsets (Hz) around BASE_PITCH_HZ. Edge adds these to
// its own SSML so the formants stay intact — the shift reads as "same girl,
// different mood" (happy/startled brighter, annoyed deeper) instead of a
// resampled different voice.
const EMOTION_PITCH_HZ = {
  neutral: 0,
  happy: 8,
  blush: -5,
  annoyed: -9,
  surprised: 11,
};

// ---- Emotion-reactive voice presets ----
// Each emotion shifts the generated tempo (rate%) and the SSML pitch so her
// voice actually sounds happy, flustered, or annoyed instead of reading every
// line in the same neutral tone. Applied in getVoicePreset(). The band is kept
// tight (pitch ±~10Hz around BASE_PITCH_HZ, speed near-native) so she stays
// recognizably the SAME girl in every mood — no random jitter, no wildly
// different takes between consecutive lines.
const VOICE_PRESETS = {
  neutral: { speed: 1.04, pitch: 1.0 },
  happy: { speed: 1.1, pitch: 1.06 },
  blush: { speed: 0.98, pitch: 0.97 },
  annoyed: { speed: 1.08, pitch: 0.93 },
  surprised: { speed: 1.12, pitch: 1.09 },
};

// ---- User-tunable TTS config (settings panel) ----
// Mirrors the settings panel controls and persists to localStorage. The
// `epoch` counter increments on every change so the audio cache (below) keys
// on it and discards stale renders instead of replaying old takes.
const TTS_CONFIG_DEFAULTS = {
  edgeVoice: EDGE_VOICE,
  kokoroVoice: KOKORO_VOICE,
  speed: 1.0, // global tempo multiplier applied on top of the emotion preset
  pitchHz: 0, // global pitch offset (Hz) added around BASE_PITCH_HZ
  muted: false, // real mute — suppresses all TTS output
};
const TTS_STORAGE_KEY = 'yuki_tts_config';

function loadTTSConfig() {
  try {
    const raw = localStorage.getItem(TTS_STORAGE_KEY);
    if (raw) return { ...TTS_CONFIG_DEFAULTS, ...JSON.parse(raw) };
  } catch (e) { /* ignore corrupted storage */ }
  return { ...TTS_CONFIG_DEFAULTS };
}

const ttsConfig = loadTTSConfig();
let configEpoch = 0;

// Reads the current config (copy) and persists any patch, bumping the epoch so
// in-flight/cached audio invalidates. Returns the merged live config.
window.getTTSConfig = function () {
  return { ...ttsConfig };
};

window.saveTTSConfig = function (patch) {
  Object.assign(ttsConfig, patch);
  configEpoch += 1;
  try {
    localStorage.setItem(TTS_STORAGE_KEY, JSON.stringify(ttsConfig));
  } catch (e) { /* ignore quota / private mode */ }
  return { ...ttsConfig };
};

// ---- Per-text audio cache ----
// Identical (engine, voice, text, rate, pitch) renders are reused instead of
// re-hitting Edge TTS / Kokoro every time. The cache stores the PROMISE so
// concurrent duplicate lines dedupe too. `configEpoch` in the key invalidates
// everything when the user changes a voice/speed/pitch setting.
const AUDIO_CACHE_MAX = 256;
const audioCache = new Map();

function audioCacheKey(engine, voice, text, rateStr, pitchStr) {
  return `${configEpoch}|${engine}|${voice}|${rateStr}|${pitchStr}|${text}`;
}

function audioCacheGet(key) {
  return audioCache.get(key);
}

function audioCacheSet(key, promise) {
  if (audioCache.size >= AUDIO_CACHE_MAX) {
    const oldest = audioCache.keys().next().value;
    if (oldest !== undefined) audioCache.delete(oldest);
  }
  audioCache.set(key, promise);
  promise.catch(() => {
    if (audioCache.get(key) === promise) audioCache.delete(key);
  });
}

function getVoicePreset(emotion) {
  const preset = VOICE_PRESETS[emotion] || VOICE_PRESETS.neutral;
  return {
    speed: preset.speed * (ttsConfig.speed || 1),
    pitch: preset.pitch,
  };
}

// Which TTS engine is actually active ("edge" | "kokoro" | "system") — shown
// in the HUD badge and logged so it's obvious which path is running.
// window.ttsReady = the TTS pipeline is installed; the engine choice is made
// inside generateTTSAudioBuffer (edge -> kokoro -> null) at call time, so this
// stays true and call sites always attempt generation.
window.ttsReady = true;

function updateVoiceBadge() {
  const edge = !!window.isEdgeReady;
  const kokoro = !!window.isKokoroReady;
  window.voiceEngine = edge ? 'edge' : kokoro ? 'kokoro' : 'system';
  const el = document.getElementById('voice-badge');
  if (el) {
    el.textContent = window.voiceEngine;
    el.classList.toggle('kokoro', kokoro && !edge);
    el.title = edge
      ? 'Edge neural TTS (' + ttsConfig.edgeVoice + ')'
      : kokoro
        ? 'Kokoro neural TTS (' + ttsConfig.kokoroVoice + ')'
        : 'Browser speechSynthesis';
  }
  console.log(
    '[tts] voice engine:',
    edge ? 'EDGE (' + ttsConfig.edgeVoice + ')' : kokoro ? 'KOKORO (' + ttsConfig.kokoroVoice + ')' : 'BROWSER speechSynthesis'
  );
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
// `emotion` picks the voice preset's tempo; `voice` overrides the base voice.
window.generateKokoroAudioBuffer = function (text, emotion, voice = ttsConfig.kokoroVoice) {
  if (!window.isKokoroReady || !ttsWorker) return Promise.resolve(null);

  const preset = getVoicePreset(emotion);
  const speed = preset.speed;
  const key = audioCacheKey('kokoro', voice, text, 'r' + Math.round(speed * 100), 'p0');
  const cached = audioCacheGet(key);
  if (cached) return cached;

  const promise = new Promise((resolve, reject) => {
    const id = ++workerIdCounter;
    workerPending.set(id, { resolve, reject });
    ttsWorker.postMessage({ type: 'generate', id, text, voice, speed });
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

  audioCacheSet(key, promise);
  return promise;
};

// Edge TTS first (much more natural voice, synthesized by the backend from
// Microsoft's free neural voices), Kokoro as the offline/error fallback, then
// null (callers drop to browser speechSynthesis). Returns an AudioBuffer.
// Both the emotion preset's TEMPO (rate%) and PITCH (Hz, formant-preserved by
// Edge) are baked into the SSML, so playback needs no client-side resampling —
// the same girl every line, just slightly faster/brighter per emotion.
window.generateTTSAudioBuffer = async function (text, emotion, voice = ttsConfig.kokoroVoice) {
  if (!text) return null;
  if (ttsConfig.muted) return null;

  const preset = getVoicePreset(emotion);
  const rate = Math.round((preset.speed - 1) * 100);
  const rateStr = (rate >= 0 ? '+' : '') + rate + '%';
  const pitchHz = ttsBasePitchHz + (ttsConfig.pitchHz || 0) + (EMOTION_PITCH_HZ[emotion] || 0);
  const pitchStr = '+' + Math.round(pitchHz) + 'Hz';

  const edgeKey = audioCacheKey('edge', ttsConfig.edgeVoice, text, rateStr, pitchStr);
  const edgeCached = audioCacheGet(edgeKey);
  if (edgeCached) return edgeCached;

  // The cached promise must resolve to the FULL fallback chain (Edge, then
  // Kokoro). generateEdgeAudioBuffer resolves to null on failure instead of
  // rejecting, so caching just the Edge call would permanently pin a null
  // result — identical text would then skip Kokoro and always hit browser TTS.
  const promise = (async () => {
    const edgeBuffer = await generateEdgeAudioBuffer(text, rateStr, pitchStr);
    if (edgeBuffer) return edgeBuffer;
    return generateKokoroAudioBuffer(text, emotion, voice);
  })();
  audioCacheSet(edgeKey, promise);
  return promise;
};

async function generateEdgeAudioBuffer(text, rateStr, pitchStr) {
  try {
    const res = await fetch((window.BACKEND_URL || '') + '/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: ttsConfig.edgeVoice, rate: rateStr, pitch: pitchStr }),
    });
    if (!res.ok) {
      console.warn('[tts] Edge TTS rejected:', res.status, res.statusText);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const ctx = getTTSAudioContext();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    if (!window.isEdgeReady) {
      window.isEdgeReady = true;
      updateVoiceBadge();
    }
    console.log(`[tts] Edge TTS ok (${buffer.duration.toFixed(2)}s)`);
    return buffer;
  } catch (err) {
    console.warn('[tts] Edge TTS failed, falling back to Kokoro:', err && err.message ? err.message : err);
    return null;
  }
}

// Plays a buffer through the analyser. Lip-sync and emotion are tied to the
// audio lifecycle: `onStart` fires in the same frame as `source.start()`,
// `onEnd` fires on `onended`, and the flags drive Pixi's ticker.
// ---- Voice polish chain (anime-style production) ----
// Soft room reverb + gentle compression + a thin-and-bright EQ so her voice
// reads as a high, youthful anime-girl vocal instead of a dry TTS read. A
// highpass trims the chesty low end (thinner = younger), the presence shelf is
// lifted for an energetic forward sound, and reverb/compression glue it. The
// reverb impulse response is generated procedurally (decaying noise) — no
// external asset needed — and cached per audio context.
const POLISH_WET = 0.07; // reverb wet mix (0..1) — kept low so it reads as room ambience, not an echo
const POLISH_DECAY = 0.45; // reverb tail length in seconds — short, so the bright anime EQ stays clean
const POLISH_THIN_FREQ = 140; // highpass below this removes boom/chest weight
const POLISH_WARMTH = 1.2; // lowshelf boost in dB (kept subtle)
const POLISH_AIR = 1; // highshelf cut in dB (kept small so she stays bright)
const POLISH_BRIGHTNESS = 3; // presence shelf lift in dB (forward anime energy)

const polishCache = new Map(); // AudioContext -> { convolver, impulse }

function getPolishNodes(ctx) {
  if (polishCache.has(ctx)) return polishCache.get(ctx);

  // Procedural stereo-ish impulse response: exponentially decaying noise.
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * POLISH_DECAY);
  const impulse = ctx.createBuffer(1, length, rate);
  const data = impulse.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const decay = Math.pow(1 - i / length, 2.2);
    const white = Math.random() * 2 - 1;
    // Cheap lowpass on the noise so the tail is soft, not hissy.
    last = last * 0.6 + white * 0.4;
    data[i] = last * decay;
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = impulse;

  const nodes = { convolver };
  polishCache.set(ctx, nodes);
  return nodes;
}

// Returns a one-shot post-processor wrapping a source node. Chain:
// source -> highpass(thin) -> lowshelf(warmth) -> highshelf(air)
//        -> peaking(brightness) -> dry/wet split -> compressor -> analyser
// Disconnect with the returned `dispose` to free the graph when playback ends.
function buildPolishChain(source, analyser) {
  const ctx = source.context;
  const nodes = getPolishNodes(ctx);

  const thin = ctx.createBiquadFilter();
  thin.type = 'highpass';
  thin.frequency.value = POLISH_THIN_FREQ;
  thin.Q.value = 0.7;

  const warmth = ctx.createBiquadFilter();
  warmth.type = 'lowshelf';
  warmth.frequency.value = 220;
  warmth.gain.value = POLISH_WARMTH;

  const air = ctx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 6000;
  air.gain.value = -POLISH_AIR;

  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2600;
  presence.Q.value = 0.8;
  presence.gain.value = POLISH_BRIGHTNESS;

  const dry = ctx.createGain();
  dry.gain.value = 1 - POLISH_WET;
  const wet = ctx.createGain();
  wet.gain.value = POLISH_WET;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 20;
  comp.ratio.value = 2;
  comp.attack.value = 0.004;
  comp.release.value = 0.16;

  source.connect(thin);
  thin.connect(warmth);
  warmth.connect(air);
  air.connect(presence);
  presence.connect(dry);
  presence.connect(nodes.convolver);
  nodes.convolver.connect(wet);
  dry.connect(comp);
  wet.connect(comp);
  comp.connect(analyser);

  return {
    dispose() {
      const all = [source, thin, warmth, air, presence, dry, wet, comp];
      all.forEach((n) => {
        try { n.disconnect(); } catch (e) { /* ignore */ }
      });
    },
  };
}

// Plays a buffer through the analyser. Lip-sync and emotion are tied to the
// audio lifecycle: `onStart` fires in the same frame as `source.start()`,
// `onEnd` fires on `onended`, and the flags drive Pixi's ticker.
// Pitch/tempo now live entirely in the generated audio (Edge SSML), so the
// chain here is only the polish EQ/reverb/compressor — no client resampling.
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
    const polish = buildPolishChain(source, analyser);

    source.onended = () => {
      window.__isSpeaking = false;
      window.__isAnalyserSpeaking = false;
      if (currentAudioSource === source) currentAudioSource = null;
      try { source.disconnect(); } catch (e) { /* ignore */ }
      polish.dispose();
      if (callbacks.onEnd) callbacks.onEnd();
    };

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