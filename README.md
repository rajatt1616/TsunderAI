# TsunderAI

A visual novel AI companion with a Live2D character, real-time text-to-speech, and LLM-driven chat. The character reacts to conversation with a persistent affection system that changes her tone, dialogue, and voice.

## Overview

TsunderAI runs as a two-part application:

- **Backend** (FastAPI): hosts the LLM chat endpoint, an affection-scoring system, and a text-to-speech route powered by Edge TTS.
- **Frontend** (vanilla JS): renders a Live2D character with physics, room backgrounds, a chat interface, and a speech engine that drives lip-sync from the audio being played.

The companion, Yuki, is a tsundere persona. Every reply is tagged with an emotion, adjusts her affection score, and is spoken out loud with a voice preset matched to that emotion. When affection reaches 100, the session ends with a victory screen and a final time.

## Features

- **LLM chat** with a constrained reply format: each message returns an emotion tag, short spoken dialogue, and an affection delta.
- **Affection system** scoring interactions from -100 to 100. A streak of three positive replies triggers a 2x multiplier. Slash commands let you feed, apologize to, headpat, or dance with her.
- **Emotion-reactive voice** driven by per-emotion tempo and pitch presets (applied via Edge SSML, so the voice stays one consistent girl while moods shift the delivery).
- **Text-to-speech with three fallbacks** in priority order: the backend Edge TTS route, local Kokoro TTS running in a Web Worker, then the browser's built-in `speechSynthesis`. Lip-sync is driven by an audio analyser.
- **Live2D presentation** using the Hiyori Cubism 4 model with physics, idle motions, and parameter presets for each emotion (mouth is reserved for lip-sync).
- **Gamified extras**: a speedrun timer, fake gacha currency earned from affection, switchable room backgrounds, and an offline fallback so the character still responds when the LLM API is unavailable.
- **Offline resilience**: if the LLM call fails (rate limit, missing key, outage), the backend replies with a canned in-character line instead of returning an error.

## Architecture

```
Frontend (port 5500)
  ├─ index.html / app.js      UI, Live2D rendering (PixiJS + pixi-live2d-display)
  ├─ tts.js / tts-worker.js   TTS pipeline (Edge -> Kokoro -> speechSynthesis) + lip-sync
  ├─ models/                  Live2D model (Hiyori)
  └─ rooms/                   background images

Backend (port 8000)
  └─ main.py                  FastAPI app
      ├─ POST /api/chat       LLM dialogue + affection scoring
      ├─ POST /api/tts        Edge TTS synthesis (audio/mpeg)
      ├─ POST /reset          Reset affection, combo, and history
      ├─ POST /apologize      Affection +10
      ├─ POST /adjust         Manually adjust affection
      └─ GET  /api/health     Health check
```

The backend also serves the frontend as static files at `/`, so the application can be opened from either server.

## Requirements

- Python 3.10+
- A [Groq API key](https://console.groq.com) for the LLM. The default model is `llama-3.1-8b-instant` (fast, with a large free quota) and can be overridden with `GROQ_MODEL`.
- An internet connection for the Live2D/PixiJS CDN scripts and the Edge TTS endpoint.

## Getting started

1. Install dependencies:

   ```sh
   pip install -r requirements.txt
   ```

2. Create `backend/.env` and set your API key:

   ```sh
   GROQ_API_KEY=your_key_here
   # Optional:
   # GROQ_MODEL=llama-3.1-8b-instant
   ```

3. Start the backend (this also serves the frontend at `http://localhost:8000`). From the `backend/` directory:

   ```sh
   python -m uvicorn main:app --reload
   ```

   Or from the project root:

   ```sh
   python -m uvicorn backend.main:app --reload
   ```

   Alternatively, serve the frontend on its own port:

   ```sh
   python serve.py        # serves frontend/ on http://localhost:5500
   ```

## Project structure

```
backend/
  main.py                 FastAPI application (chat, TTS, affection state)
  .env                    API keys and model configuration (gitignored)

frontend/
  index.html              Application shell
  style.css               Styling
  app.js                  UI logic, Live2D, game state
  tts.js                  TTS pipeline and lip-sync
  tts-worker.js           Kokoro TTS Web Worker
  serve.py                Static file server (no-cache) on port 5500
  models/                 Live2D model assets (Hiyori)
  rooms/                  Room background images
  vendor/                 Local vendored libraries (Live2D Cubism 4 core)
```

## Notes

- The affection score is global in-memory state and resets when the backend restarts.
- Slash commands and actions (headpats, feeding) are handled in-game; the character does not have awareness of your machine, files, or webcam.
- The default Groq model is selected for its free quota and speed; heavier models can be set via `GROQ_MODEL` but consume quota faster.