import asyncio
import json
import os
import random
import re
from xml.sax.saxutils import escape

import edge_tts

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles 

load_dotenv()

app = FastAPI(title="AI Waifu Simulator", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_system_prompt(current_affection: int) -> str:
    return f"""
You are Yuki, a tsundere anime companion living inside a desktop web application.

PERSONA: Tsundere. Flustered, sharp-tongued, grumpy, secretly cares about the user.
Affection: {current_affection}/100
- <0: Hostile, dismissive, highly annoyed.
- 0-69: Classic tsundere: sarcastic, defensive ("It's not like I did this for you!").
- 70+: Flustered, soft-spoken, hiding her crush.

STRICT RULES:
1. Start text with an emotion tag: [EMOTION: neutral|happy|blush|angry|surprised]
2. Max 20 words (1-2 short sentences) - for TTS.
3. NO asterisks, actions, or stage directions. Pure spoken dialogue only.
4. You only know what the user types. Never invent mouse movements, webcams, files, or physical actions. Slash commands are in-game events, not real threats.
5. Never reference UI, browsers, code, or being software/AI.

SCORING (affection_change int): compliment/kindness/headpat +2..+5 | neutral chat 0 | mild tease -1..+1 | insult/rude/creepy -3..-8

Reply ONLY in this exact 3-line format (no JSON, no extra text). You MUST output all 3 lines every time:
[EMOTION: neutral|happy|blush|angry|surprised]
<your dialogue, max 20 words>
AFFECTION_CHANGE: <int -10..10>

Example:
[EMOTION: blush]
Morning... Don't get used to me greeting you back, idiot.
AFFECTION_CHANGE: +2
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
MAX_CONTEXT = 6


class ChatRequest(BaseModel):
    message: str


class AdjustRequest(BaseModel):
    delta: int = 0


class TTSRequest(BaseModel):
    text: str
    voice: str = "en-US-JennyNeural"
    rate: str = "+0%"
    pitch: str = "+0Hz"


class ChatResponse(BaseModel):
    response: str
    emotion: str = "neutral"
    affection_change: int = 0
    total_affection: int = 0
    combo_active: bool = False


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
    raw = content.strip()
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
        except (json.JSONDecodeError, AttributeError):
            pass

    if emotion == "angry":
        emotion = "annoyed"
    return text, emotion, change


def build_llm() -> ChatGroq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY is missing. Create backend/.env with GROQ_API_KEY=your_key"
        )
    # llama-3.1-8b-instant has a ~1M tokens/day free quota (vs 100k for the 70b
    # model) and answers faster, so it won't burn out mid-session. Override with
    # GROQ_MODEL in backend/.env if you prefer a different model.
    model = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
    return ChatGroq(
        model=model,
        api_key=api_key,
        temperature=0.7,
        max_tokens=120,
        timeout=60,
    )


# Offline fallback lines used when the LLM API is down/rate-limited so Yuki
# still answers instead of breaking the chat. Each is (text, emotion, delta).
FALLBACK_REPLIES = [
    ("Hmph. My brain's taking a break right now... don't get the wrong idea, I was just thinking of you.", "blush", 2),
    ("Ugh, I can't reach my thoughts right now. Say that again when I'm not busy being cute.", "neutral", 1),
    ("...My head's a little full right now, so I'll let that slide. Don't expect it twice, idiot.", "annoyed", 0),
    ("I heard you, dummy. I'm just choosing not to think about it. Ask me again in a minute.", "neutral", 0),
    ("E-Even I need a second to think sometimes, you know?! Don't rush me!", "blush", 1),
]


@app.get("/api/health")
def health_check():
    return {"app": "Animated AI Waifu Simulator", "status": "online"}


@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    text = (request.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    text = text[:1000]

    voice = request.voice or "en-US-JennyNeural"
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


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    global user_affection, combo_streak

    message = request.message.strip()
    if not message:
        return ChatResponse(
            response="...You didn't even say anything. How annoying.",
            total_affection=user_affection,
        )

    # Append the user's message, keeping the window bounded to the last 8.
    HISTORY.append({"role": "user", "content": message})
    if len(HISTORY) > MAX_CONTEXT:
        HISTORY[:] = HISTORY[-MAX_CONTEXT:]

    # Dynamic system prompt reflects the current affection tier.
    messages = [SystemMessage(content=get_system_prompt(user_affection))]
    messages += [
        (
            HumanMessage(content=m["content"])
            if m["role"] == "user"
            else AIMessage(content=m["content"])
        )
        for m in HISTORY
    ]

    try:
        llm = build_llm()
        result = llm.invoke(messages)
        reply, emotion, change = parse_reply(result.content)
    except Exception as err:
        # API down / rate limited / no key: keep the game alive with a local
        # canned tsundere line instead of returning a 500 to the frontend.
        print(f"[LLM] {type(err).__name__}: {err}")
        reply, emotion, change = random.choice(FALLBACK_REPLIES)
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
    return ChatResponse(
        response=reply,
        emotion=emotion,
        affection_change=change,
        total_affection=user_affection,
        combo_active=combo_active,
    )

    

# --- Place this at the very bottom of main.py ---
app.mount("/", StaticFiles(directory="frontend", html=True), name="static")