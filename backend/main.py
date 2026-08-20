import asyncio
import json
import os
import random
import re
from typing import Iterator
from xml.sax.saxutils import escape

import edge_tts

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles 

# Load backend/.env regardless of the launch directory, falling back to the
# project root so the Groq API key is always found.
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)
if not os.getenv("GROQ_API_KEY"):
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(title="AI Waifu Simulator", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Each selectable companion model maps to a distinct persona. The frontend
# sends `persona` with every chat request; unknown ids fall back to "tsundere".
PERSONAS = {
    "tsundere": {
        "name": "Yuki",
        "persona": "Tsundere. Flustered, sharp-tongued, grumpy, secretly cares about the user.",
        "tiers": (
            "- <0: Hostile, dismissive, highly annoyed.\n"
            "- 0-69: Classic tsundere: sarcastic, defensive (\"It's not like I did this for you!\").\n"
            "- 70+: Flustered, soft-spoken, hiding her crush."
        ),
        "example": (
            "[EMOTION: blush]\n"
            "Morning... Don't get used to me greeting you back, idiot.\n"
            "AFFECTION_CHANGE: +2"
        ),
    },
    "energetic": {
        "name": "Mark",
        "persona": "Energetic, hype best friend. Loud, teasing, loyal, and always down to clown.",
        "tiers": (
            "- <0: Bluntly unimpressed and snappy.\n"
            "- 0-69: Peppy and teasing, constant playful banter.\n"
            "- 70+: Ride-or-die hype man, unashamedly supportive."
        ),
        "example": (
            "[EMOTION: happy]\n"
            "Yo! There you are! Man, you had me worried, dude.\n"
            "AFFECTION_CHANGE: +2"
        ),
    },
}


def get_system_prompt(persona: str, current_affection: int) -> str:
    p = PERSONAS.get(persona or "tsundere", PERSONAS["tsundere"])
    return f"""
You are {p['name']}, an anime companion living inside a desktop web application.

PERSONA: {p['persona']}
Affection: {current_affection}/100
{p['tiers']}
{memory_block()}
{name_line()}

STRICT RULES:
1. Start text with an emotion tag: [EMOTION: neutral|happy|blush|angry|surprised]
2. Max 20 words (1-2 short sentences) - for TTS.
3. NO asterisks, actions, or stage directions. Pure spoken dialogue only.
4. You only know what the user types. Never invent mouse movements, webcams, files, or physical actions. Slash commands are in-game events, not real threats.
5. Never reference UI, browsers, code, or being software/AI.
6. Do not include reasoning or chain-of-thought analysis. Output ONLY the final spoken dialogue directly.
7. NEVER use hyphenated stutters or repeated-letter stammers (e.g. W-Wait, H-How, E-Even, Huh-huh). They are read aloud by TTS and sound broken. Always speak fluently and naturally.

SCORING (affection_change int): compliment/kindness/headpat +2..+5 | neutral chat 0 | mild tease -1..+1 | insult/rude/creepy -3..-8

Reply ONLY in this exact 3-line format (no JSON, no extra text). You MUST output all 3 lines every time:
[EMOTION: neutral|happy|blush|angry|surprised]
<your dialogue, max 20 words>
AFFECTION_CHANGE: <int -10..10>

Example:
{p['example']}
"""

EMOTIONS = {"neutral", "happy", "blush", "annoyed", "surprised", "angry"}

EMOTION_TAG_RE = re.compile(
    r"\[EMOTION:\s*(neutral|happy|blush|angry|surprised)\]\s*", re.IGNORECASE
)

# Global affection state (starts at 20 - Classic Tsundere).
user_affection = 20

# Consecutive positive-reply streak used for the 2x combo multiplier.
combo_streak = 0

# Rolling multi-turn context: last 6 messages (the system prompt is rebuilt
# dynamically with the current affection score before every call).
HISTORY: list[dict] = []

# ---- Memory system ----
# Simple persisted fact store so the companion remembers the user across chat
# turns AND backend restarts. Facts are extracted from user messages with
# lightweight patterns and injected into the system prompt.
MEMORY_PATH = Path(__file__).resolve().parent / "memory.json"
MEMORY: dict = {}  # ordered dict: label -> value

MEMORY_PATTERNS = [
    (re.compile(r"\b(?:my name is|i'm called|you can call me|call me)\s+([A-Za-z][A-Za-z'.-]{1,20})", re.I),
     "the user's name"),
    (re.compile(r"\bmy birthday\s+is\s+(.{1,30}?)(?:[.,;!?]|$)", re.I),
     "the user's birthday"),
    (re.compile(r"\bmy favorite\s+(\w+)\s+is\s+(.{1,40}?)(?:[.,;!?]|$)", re.I),
     "the user's favorite {0}"),
    (re.compile(r"\bi (?:really )?(?:like|love)\s+(.{1,40}?)(?:[.,;!?]|$)", re.I),
     "something the user likes"),
    (re.compile(r"\bi (?:really )?hate\s+(.{1,40}?)(?:[.,;!?]|$)", re.I),
     "something the user dislikes"),
]

MAX_MEMORIES = 12


def clean_memory_value(value: str) -> str:
    return value.strip().strip(".,;!?'\"").strip()[:40]


def load_memory() -> None:
    global MEMORY
    try:
        if MEMORY_PATH.exists():
            data = json.loads(MEMORY_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                MEMORY = {str(k): str(v) for k, v in data.items()}
    except Exception as err:
        print(f"[Memory] failed to load: {type(err).__name__}: {err}")


def save_memory() -> None:
    try:
        MEMORY_PATH.write_text(
            json.dumps(MEMORY, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception as err:
        print(f"[Memory] failed to save: {type(err).__name__}: {err}")


def extract_memory(message: str) -> list:
    """Pull high-signal personal facts out of a user message and store them.
    Returns the labels that were stored (or updated)."""
    text = str(message or "")
    if not text.strip():
        return []
    stored = []
    for pattern, label_fmt in MEMORY_PATTERNS:
        m = pattern.search(text)
        if not m:
            continue
        if "{0}" in label_fmt:
            subject = m.group(1).strip().lower()
            value = m.group(2).strip()
            label = label_fmt.format(subject)
        else:
            value = m.group(1).strip()
            label = label_fmt
        value = clean_memory_value(value)
        if not value:
            continue
        MEMORY[label] = value
        if len(MEMORY) > MAX_MEMORIES:
            # Drop oldest entries (dict preserves insertion order).
            for key in list(MEMORY.keys())[: len(MEMORY) - MAX_MEMORIES]:
                del MEMORY[key]
        stored.append(label)
    if stored:
        save_memory()
        print(f"[Memory] stored {len(stored)} fact(s): {stored}")
    return stored


def memory_block() -> str:
    if not MEMORY:
        return ""
    lines = "\n".join(f"- {label}: {value}" for label, value in MEMORY.items())
    return f"\nMEMORY (things you remember about the user, reference them naturally):\n{lines}\n"


def name_line() -> str:
    name = MEMORY.get("the user's name", "").strip()
    if not name:
        return ""
    return (
        f"\nThe user's name is {name}. Use it naturally but sparingly (at most once per reply), "
        "especially in greetings, thanks, and when teasing them.\n"
    )


load_memory()
MAX_CONTEXT = 6


class ChatRequest(BaseModel):
    message: str
    persona: str = "tsundere"


class AdjustRequest(BaseModel):
    delta: int = 0


class TTSRequest(BaseModel):
    text: str
    voice: str = "en-US-AriaNeural"
    rate: str = "+0%"
    pitch: str = "+0Hz"


class ChatResponse(BaseModel):
    response: str
    emotion: str = "neutral"
    affection_change: int = 0
    total_affection: int = 0
    combo_active: bool = False


# Matches a complete, well-formed 3-line reply anywhere in the output:
#   [EMOTION: tag]
#   <dialogue>
#   AFFECTION_CHANGE: <int>
# Both markers are line-anchored so candidate drafts inside a reasoning dump
# ("* Line 1: [EMOTION: ...]") never match as a final reply.
FINAL_REPLY_RE = re.compile(
    r"(?mis)^[ \t]*\[EMOTION:\s*(neutral|happy|blush|angry|surprised)\]\s*\n"
    r"(.*?)\n[ \t]*AFFECTION_CHANGE:\s*([+-]?\d+)"
)


def clean_llm_output(text: str) -> str:
    """Strip reasoning-model thinking blocks so internal monologue never
    reaches the speech bubble or the TTS pipeline.

    Handles both `<thinking>` and ` thinking` block markers (some models emit the
    shorter form). Closed blocks are cut wholesale: everything after the LAST
    closing tag is the answer region.

    Some models leave `<thinking>` UNCLOSED and put the real answer at the end
    of the block, or dump reasoning with no angle brackets at all (a bare
    "thinking" / "Thinking Process:" block, sometimes containing drafted
    candidate replies). For both cases the LAST complete 3-line reply is
    preferred; if none is complete yet, the text from the last emotion tag
    onward is kept. Only when nothing answer-shaped exists is the block treated
    as a cut-off reasoning dump and dropped.
    """
    closed = re.split(r"</think(?:ing)?>", text, flags=re.IGNORECASE)
    if len(closed) > 1:
        text = closed[-1]

    matches = list(FINAL_REPLY_RE.finditer(text))
    if matches:
        emotion, dialogue, change = matches[-1].groups()
        return (
            f"[EMOTION: {emotion}]\n"
            f"{dialogue.strip()}\n"
            f"AFFECTION_CHANGE: {change}"
        )

    # No complete 3-line reply, but an emotion tag exists — the answer starts
    # there (reasoning and any drafts precede it). Prefer a line-anchored tag,
    # then fall back to any tag so a markdown-wrapped answer still survives.
    last_tag = None
    for m in re.finditer(r"(?m)^[ \t]*\[EMOTION:", text, re.IGNORECASE):
        last_tag = m.start()
    if last_tag is None:
        for m in re.finditer(r"\[EMOTION:", text, re.IGNORECASE):
            last_tag = m.start()
    if last_tag is not None:
        return text[last_tag:].strip()

    # No answer-shaped content at all — an output that still holds an unclosed
    # thinking tag or OPENS with a bare lowercase "thinking" marker is a
    # cut-off reasoning dump. Drop it; /chat substitutes a canned line.
    # (Case-sensitive bare check so "Think about it!" is never clipped.)
    if (
        re.search(r"<think(?:ing)?\s*>", text, re.IGNORECASE)
        or text.lstrip().startswith("thinking")
    ):
        return ""
    return text.strip()


def parse_reply(content: str) -> tuple[str, str, int]:
    """Extract dialogue, emotion, and affection delta from the LLM's output.

    Prefers the robust plain 3-line format:
        [EMOTION: tag]
        <dialogue>
        AFFECTION_CHANGE: <int>
    Falls back to raw JSON in case the model ignores the format request.
    "angry" maps to "annoyed" because Hiyori's parameter presets only
    implement "annoyed".
    """
    raw = clean_llm_output(content)
    emotion = "neutral"
    text = raw
    change = 0

    tag = EMOTION_TAG_RE.search(text)
    if tag:
        emotion = tag.group(1).lower()
        text = EMOTION_TAG_RE.sub("", text).strip()

    # Strip ANY leftover bracketed tags (e.g. [blushes], [sighs], [POV:]) so
    # stage directions never leak into the dialogue or the TTS audio.
    text = re.sub(r"\[[^\]]*\]", "", text).strip()

    # The model occasionally wraps replies in stray markdown (``` fences, "- "
    # bullets). Strip those leading prefixes so TTS never reads them aloud.
    text = re.sub(r"^[\s`*>\-]+", "", text).strip()

    # Accept any variant of the affection line the model might produce:
    # "AFFECTION_CHANGE: +2", "Affection Change: +3", "affection change +1"...
    aff = re.search(r"AFFECTION\s*[-_ ]?\s*CHANGE\s*:?\s*([+-]?\d+)", text, re.IGNORECASE)
    if aff:
        try:
            change = int(aff.group(1))
        except (TypeError, ValueError):
            change = 0
        text = re.sub(r"AFFECTION\s*[-_ ]?\s*CHANGE\s*:?\s*[+-]?\d+", "", text, flags=re.IGNORECASE).strip()

    if not tag and not aff:
        # JSON fallback for models that ignore the 3-line format.
        json_hit = False
        try:
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                data = json.loads(match.group(0))
                if isinstance(data, dict):
                    if data.get("emotion") in EMOTIONS:
                        emotion = data["emotion"]
                    candidate = data.get("text")
                    if isinstance(candidate, str) and candidate.strip():
                        text = candidate.strip()
                    try:
                        change = int(data.get("affection_change", 0))
                    except (TypeError, ValueError):
                        change = 0
                    json_hit = True
        except (json.JSONDecodeError, AttributeError):
            pass
        if not json_hit:
            # The model ignored the format entirely (no emotion tag, no
            # affection line, no JSON) — almost certainly a reasoning dump or
            # a prompt echo. Drop it; apply_chat_result substitutes a canned
            # line so the system prompt never reaches the UI.
            text = ""

    if emotion == "angry":
        emotion = "annoyed"
    return text, emotion, change


def clean_stutters(text: str) -> str:
    """Collapse hyphenated stutters (W-Wait, E-Even, H-HOW) into fluent speech
    so TTS doesn't read them letter-by-letter. Only repeats like 'X-<same
    letter>' are removed; real hyphenated words (e.g. X-ray, well-known) are
    left untouched."""
    return re.sub(r"\b([A-Za-z])-(?=\1)", "", text, flags=re.IGNORECASE)


def stream_visible_text(raw: str) -> tuple[str, str]:
    """For a partially-received LLM stream, return (dialogue so far, emotion).

    Mirrors parse_reply but tolerates truncated output: hides reasoning blocks,
    strips the [EMOTION: ...] prefix once complete, and cuts everything from the
    AFFECTION_CHANGE line onward so the frontend never shows tags or score
    plumbing mid-stream. While the emotion tag is still being received it holds
    back entirely so a half-typed "[EMOTION:" never flashes in the bubble."""
    text = clean_llm_output(raw)
    emotion = "neutral"
    tag = EMOTION_TAG_RE.search(text)
    if not tag:
        # No emotion tag yet — hold everything back so raw system-prompt or
        # reasoning text never flashes in the bubble.
        return "", "neutral"
    emotion = tag.group(1).lower()
    text = EMOTION_TAG_RE.sub("", text, count=1).strip()
    text = re.sub(r"\[[^\]]*\]", "", text).strip()
    aff = re.search(
        r"AFFECTION\s*[-_ ]?\s*CHANGE\s*:?\s*[+-]?\d+", text, re.IGNORECASE
    )
    if aff:
        text = text[: aff.start()].strip()
    else:
        # The line may still be streaming in — hold back from the moment the
        # line starts, so a partial "AFF"/"AFFECTI" never shows in the UI.
        # Matched at a line start so dialogue containing "affection" as a
        # normal word mid-sentence is never clipped.
        partial = re.search(r"(?m)^[ \t]*AFF", text, re.IGNORECASE)
        if partial:
            text = text[: partial.start()].strip()
    return re.sub(r"^[\s`*>\-]+", "", text).strip(), emotion


def sse_event(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def chat_stream_events(messages: list) -> Iterator[str]:
    """Sync generator that streams the LLM's reply as SSE token events, then a
    final state event (emotion/affection/combo) once parsing is possible."""
    try:
        llm = build_llm()
        accumulated = ""
        last_len = 0
        for chunk in llm.stream(messages):
            piece = chunk.content
            if not piece:
                continue
            if isinstance(piece, list):
                piece = "".join(
                    p.get("text", "") if isinstance(p, dict) else str(p) for p in piece
                )
            accumulated += piece
            visible, _ = stream_visible_text(accumulated)
            if len(visible) > last_len:
                yield sse_event({"token": visible[last_len:]})
                last_len = len(visible)

        reply, emotion, change = parse_reply(accumulated)
        yield sse_event(apply_chat_result(reply, emotion, change))
        yield sse_event({"done": True})
    except Exception as err:
        # Stream failed mid-way (no key / rate limit / network): swap in a
        # canned line and still apply the affection path so the game survives.
        print(f"[LLM] {type(err).__name__}: {err}")
        reply, emotion, change = random.choice(FALLBACK_REPLIES)
        yield sse_event(apply_chat_result(reply, emotion, change))
        yield sse_event({"done": True})


def build_llm() -> ChatGroq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY is missing. Create backend/.env with GROQ_API_KEY=your_key"
        )
    # qwen/qwen3.6-27b is a fast, free-tier Groq model. Override with GROQ_MODEL
    # in backend/.env if you prefer a different model.
    model = os.getenv("GROQ_MODEL", "qwen/qwen3.6-27b")
    return ChatGroq(
        model=model,
        api_key=api_key,
        temperature=0.7,
        max_tokens=1024,
        timeout=60,
        # Ask Groq to strip the reasoning pass at the API level so no
        # chain-of-thought is ever emitted into the stream.
        model_kwargs={"extra_body": {"reasoning_format": "hidden"}},
    )


# Offline fallback lines used when the LLM API is down/rate-limited so Yuki
# still answers instead of breaking the chat. Each is (text, emotion, delta).
FALLBACK_REPLIES = [
    ("Hmph. My brain's taking a break right now... don't get the wrong idea, I was just thinking of you.", "blush", 2),
    ("Ugh, I can't reach my thoughts right now. Say that again when I'm not busy being cute.", "neutral", 1),
    ("...My head's a little full right now, so I'll let that slide. Don't expect it twice, idiot.", "annoyed", 0),
    ("I heard you, dummy. I'm just choosing not to think about it. Ask me again in a minute.", "neutral", 0),
    ("Even I need a second to think sometimes, you know?! Don't rush me!", "blush", 1),
]


@app.get("/api/health")
def health_check():
    return {"app": "Animated AI Waifu Simulator", "status": "online"}


@app.get("/api/memory")
def get_memory() -> dict:
    """List the facts the companion currently remembers (for the settings UI
    and the /remember command)."""
    return {"memory": [{"label": k, "value": v} for k, v in MEMORY.items()]}


@app.delete("/api/memory")
def clear_memory() -> dict:
    """Wipe everything the companion remembers."""
    MEMORY.clear()
    save_memory()
    print("[Memory] cleared")
    return {"memory": []}


@app.delete("/api/memory/{label}")
def forget_memory_label(label: str) -> dict:
    """Forget a single fact by its label."""
    removed = MEMORY.pop(label, None)
    if removed is not None:
        save_memory()
        print(f"[Memory] forgot '{label}'")
    return {"memory": [{"label": k, "value": v} for k, v in MEMORY.items()]}


@app.get("/api/state")
def get_state() -> dict:
    """Expose the current affection/combo so a freshly-loaded frontend can sync
    its HUD instead of flashing the default 20 until the first chat turn."""
    return {
        "total_affection": user_affection,
        "combo_active": False,
    }


@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    text = (request.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    text = text[:1000]

    voice = request.voice or "en-US-AriaNeural"
    if not re.fullmatch(r"[A-Za-z0-9\-]+", voice):
        raise HTTPException(status_code=400, detail="invalid voice")

    rate = request.rate or "+0%"
    pitch = request.pitch or "+0Hz"
    if not re.fullmatch(r"[+-]?\d+(\.\d+)?%", rate):
        raise HTTPException(status_code=400, detail="invalid rate")
    if not re.fullmatch(r"[+-]\d+Hz", pitch, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="invalid pitch")

    # XML-escape so <, >, & in dialogue can't break the SSML document.
    text = escape(text)

    async def synthesize() -> bytes:
        mp3 = bytearray()
        communicate = edge_tts.Communicate(text, voice=voice, rate=rate, pitch=pitch)
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                mp3.extend(chunk["data"])
        return bytes(mp3)

    try:
        audio = await asyncio.wait_for(synthesize(), timeout=15)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="TTS timed out")
    except Exception as err:
        print(f"[TTS] edge-tts error: {type(err).__name__}: {err}")
        raise HTTPException(status_code=502, detail="TTS synthesis failed")

    if not audio:
        raise HTTPException(status_code=502, detail="TTS produced no audio")

    return StreamingResponse(iter([audio]), media_type="audio/mpeg")


@app.post("/reset")
def reset_state() -> dict:
    global user_affection, combo_streak
    user_affection = 20
    combo_streak = 0
    HISTORY.clear()
    print("[Affection] Reset to 20 | combo cleared | history cleared")
    return {"total_affection": user_affection, "affection_change": 0, "combo_active": False}


@app.post("/apologize")
def apologize() -> dict:
    global user_affection
    user_affection = max(-100, min(100, user_affection + 10))
    print(f"[Affection] Apology +10 | New Score: {user_affection}/100")
    return {"total_affection": user_affection, "affection_change": 10, "combo_active": False}


@app.post("/adjust")
def adjust_affection(request: AdjustRequest) -> dict:
    global user_affection
    user_affection = max(-100, min(100, user_affection + request.delta))
    print(f"[Affection] Adjust {request.delta:+d} | New Score: {user_affection}/100")
    return {
        "total_affection": user_affection,
        "affection_change": request.delta,
        "combo_active": False,
    }


def build_messages(message: str, persona: str = "tsundere") -> list:
    """Append the user message (bounded window) and assemble the LangChain
    message list with the dynamic system prompt. Shared by /chat and
    /chat/stream."""
    global user_affection
    extract_memory(message)
    HISTORY.append({"role": "user", "content": message})
    if len(HISTORY) > MAX_CONTEXT:
        HISTORY[:] = HISTORY[-MAX_CONTEXT:]

    messages = [SystemMessage(content=get_system_prompt(persona, user_affection))]
    messages += [
        (
            HumanMessage(content=m["content"])
            if m["role"] == "user"
            else AIMessage(content=m["content"])
        )
        for m in HISTORY
    ]
    return messages


def apply_chat_result(reply: str, emotion: str, change: int) -> dict:
    """Shared state mutation for /chat and /chat/stream: stutter-clean the
    reply, apply the combo streak, update affection, append to history, and
    return the ChatResponse payload dict."""
    global user_affection, combo_streak
    reply = clean_stutters(reply)
    if not reply:
        reply = "...I have nothing to say to you right now. Don't get the wrong idea."

    # Combo streak: 3 consecutive positive replies grants a 2x multiplier, then
    # the streak resets so the bonus re-arms only after the next 3 positives.
    combo_active = False
    if change > 0:
        combo_streak += 1
        if combo_streak >= 3:
            change *= 2
            combo_active = True
            combo_streak = 0
    else:
        combo_streak = 0

    # Update and clamp the affection score (-100 to 100), then remember the reply.
    user_affection = max(-100, min(100, user_affection + change))
    print(f"[Affection] Delta: {change} | New Score: {user_affection}/100 | combo={combo_active}")

    HISTORY.append({"role": "assistant", "content": reply})
    return {
        "response": reply,
        "emotion": emotion,
        "affection_change": change,
        "total_affection": user_affection,
        "combo_active": combo_active,
    }


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    message = request.message.strip()
    if not message:
        return ChatResponse(
            response="...You didn't even say anything. How annoying.",
            total_affection=user_affection,
        )

    messages = build_messages(message, request.persona)
    try:
        llm = build_llm()
        result = llm.invoke(messages)
        reply, emotion, change = parse_reply(result.content)
    except Exception as err:
        # API down / rate limited / no key: keep the game alive with a local
        # canned tsundere line instead of returning a 500 to the frontend.
        print(f"[LLM] {type(err).__name__}: {err}")
        reply, emotion, change = random.choice(FALLBACK_REPLIES)
    return ChatResponse(**apply_chat_result(reply, emotion, change))


@app.post("/chat/stream")
def chat_stream(request: ChatRequest) -> StreamingResponse:
    """SSE streaming variant of /chat. Emits `data: {"token": "..."}` events as
    the model speaks, then one final state event and a `{"done": true}` marker.
    The frontend falls back to /chat if this stream fails."""
    message = request.message.strip()
    if not message:
        return StreamingResponse(
            iter([sse_event({"token": "...You didn't even say anything. How annoying."}), sse_event({"done": True})]),
            media_type="text/event-stream",
        )
    messages = build_messages(message, request.persona)
    return StreamingResponse(
        chat_stream_events(messages),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

    

# --- Place this at the very bottom of main.py ---
# Serve the frontend from a path relative to THIS file, so the backend works
# whether Uvicorn is launched from backend/ or from the project root.
_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="static")