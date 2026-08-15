import json
import os
import re


from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="Animated AI Waifu Simulator", version="1.0.0")

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
    r"^\[EMOTION:\s*(neutral|happy|blush|angry|surprised)\]\s*", re.IGNORECASE
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

    tag = EMOTION_TAG_RE.match(text)
    if tag:
        emotion = tag.group(1).lower()
        text = EMOTION_TAG_RE.sub("", text).strip()

    aff = re.search(r"AFFECTION_CHANGE\s*:\s*([+-]?\d+)", text, re.IGNORECASE)
    if aff:
        try:
            change = int(aff.group(1))
        except (TypeError, ValueError):
            change = 0
        text = re.sub(r"AFFECTION_CHANGE\s*:\s*[+-]?\d+", "", text, flags=re.IGNORECASE).strip()

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
    return ChatGroq(
        model="llama-3.3-70b-versatile",
        api_key=api_key,
        temperature=0.7,
        max_tokens=120,
        timeout=60,
    )


@app.get("/")
def read_root() -> dict:
    return {"app": "Animated AI Waifu Simulator", "status": "online"}


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
async def chat(request: ChatRequest) -> ChatResponse:
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

    llm = build_llm()
    result = llm.invoke(messages)
    reply, emotion, change = parse_reply(result.content)
    if not reply:
        reply = "...I have nothing to say to you right now. Don't get the wrong idea."

    # Combo streak: 3 consecutive positive replies grants a 2x multiplier.
    combo_active = False
    if change > 0:
        combo_streak += 1
        if combo_streak >= 3:
            change *= 2
            combo_active = True
    elif change < 0:
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

    from fastapi.staticfiles import StaticFiles

# --- Place this at the very bottom of main.py ---
app.mount("/", StaticFiles(directory="frontend", html=True), name="static")