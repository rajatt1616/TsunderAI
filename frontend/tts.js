// --- TTS + Lip-Sync engine ---
// Adapted from the app's own kokoro_manager.js / audio_context_manager.js / audio_player.js.
// Local neural TTS (Kokoro) with analyser-driven lip sync; falls back to browser speechSynthesis.

let ttsAudioContext = null;
let ttsAnalyser = null;
let ttsGainNode = null;
let currentAudioSource = null;

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

// Resolves once the static <script type="module"> tag has exposed window.KokoroTTS.
window.kokoroLibPromise = new Promise((resolve) => {
  window.__kokoroLibResolve = resolve;
});

// Silently preload the Kokoro ONNX model in the background. Call at startup without await.
window.preloadKokoroInBackground = async function () {
  if (window.isKokoroReady || window.isKokoroLoading) return;

  const hasWebGPU = navigator.gpu !== undefined;
  const isLowRAM = navigator.deviceMemory && navigator.deviceMemory < 4;
  const isSlowNetwork =
    navigator.connection &&
    (navigator.connection.effectiveType === '2g' || navigator.connection.effectiveType === '3g');

  if (isLowRAM || isSlowNetwork) {
    console.warn(
      `[tts] Kokoro TTS disabled safely (${isLowRAM ? 'Low RAM' : 'Slow Network'}). Falling back to browser TTS.`
    );
    window.isKokoroReady = false;
    return;
  }

  window.isKokoroLoading = true;
  console.log('[tts] Silently preloading Kokoro in the background...');
  try {
    await window.kokoroLibPromise;
    if (!window.KokoroTTS) throw new Error('kokoro-js module did not load');
    // WebGPU + q8 gives garbage audio; fp32 for WebGPU, q8 for WASM.
    const targetDevice = hasWebGPU ? 'webgpu' : 'wasm';
    const targetDtype = hasWebGPU ? 'fp32' : 'q8';
    window.kokoroTTS = await window.KokoroTTS.from_pretrained(
      'onnx-community/Kokoro-82M-v1.0-ONNX',
      { dtype: targetDtype, device: targetDevice }
    );
    window.isKokoroReady = true;
    console.log(`[tts] Kokoro ready! (Device: ${targetDevice}, Type: ${targetDtype})`);
  } catch (err) {
    console.warn('[tts] Kokoro preload failed:', err.message);
    window.isKokoroReady = false;
  } finally {
    window.isKokoroLoading = false;
  }
};

// Generates audio using local Kokoro and returns an AudioBuffer (or null).
window.generateKokoroAudioBuffer = async function (text, voice = 'af_heart') {
  if (!window.isKokoroReady || !window.kokoroTTS) return null;
  try {
    const raw = await window.kokoroTTS.generate(text, { voice, speed: 1.0 });
    const ctx = getTTSAudioContext();
    const buffer = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
    buffer.copyToChannel(raw.audio, 0);
    return buffer;
  } catch (err) {
    console.warn('[tts] Kokoro generation failed:', err.message);
    return null;
  }
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