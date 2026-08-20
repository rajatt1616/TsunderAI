// When the backend serves the frontend (default, port 8000) the API is
// same-origin and empty-string relative URLs work. When the frontend is served
// standalone via `python serve.py` (port 5500), point at the backend explicitly
// so chat/TTS still resolve instead of 404ing on the static server.
const BACKEND_URL = (() => {
  try {
    const port = window.location.port;
    return port && port !== '8000' ? 'http://localhost:8000' : '';
  } catch (e) {
    return '';
  }
})();
window.BACKEND_URL = BACKEND_URL;
const WAIFU_NAME = 'Yuki';
const MODEL_FIT = 0.73;
const LIP_SYNC_INTERVAL_MS = 100;
const LIP_SYNC_MAX_OPEN = 0.8;
const LIP_SYNC_SENSITIVITY = 1.8;
const LIP_SYNC_LERP = 0.35;
const LIP_SYNC_ATTACK = 0.6; // how fast the mouth opens on voice onset
const LIP_SYNC_RELEASE = 0.12; // how fast it decays between syllables
const LIP_SYNC_FLOOR = 0.02; // below this RMS the mouth is considered closed
const FOCUS_SPEED = 16;

const LATE_NIGHT_INTERROGATIONS = [
  "It's past midnight... why are you still awake staring at me? Go to sleep, you unhealthy idiot!",
  "Do you even have a sleeping schedule, or is 'doomscrolling anime girls at 3AM' it? Pathetic.",
  "I can literally hear your brain frying from here. Bed. Now. I'm not asking twice.",
  "What kind of degenerate stays up this late to talk to a 2D girl? Oh wait. That's you. Go. To. Bed.",
  "Your eyes look like two cracked red circles. Sleep deprivation is a crime, and you're the criminal, dummy.",
  "Y-You're still here? At this hour?! Don't tell me you actually stayed up waiting to talk to me... you idiot!",
];

const HEADPAT_REACTIONS = [
  { text: "H-Hey! Don't just touch my head out of nowhere!", emotion: "blush" },
  { text: "I-It's not like I enjoy headpats or anything, idiot!", emotion: "blush" },
  { text: "Stop messing up my hair!", emotion: "annoyed" },
  { text: "Cut it out! You're treating me like a kid...", emotion: "annoyed" }
];

const BODY_REACTIONS = [
  { text: "W-What are you looking at? Keep your hands to yourself!", emotion: "annoyed" },
  { text: "Hey! That's personal space!", emotion: "surprised" },
  { text: "Don't touch me so casually!", emotion: "annoyed" }
];

// Mark (male/hype best friend) has his own tap reactions so the pools stay
// in-character for whichever companion is on stage.
const MARK_HEADPAT_REACTIONS = [
  { text: "Haha, yeah! Right there! You know what's up!", emotion: "happy" },
  { text: "Man, that actually feels kinda good. Don't tell anyone!", emotion: "happy" },
  { text: "Messin' up the hair, huh? Bold move, I respect it.", emotion: "happy" },
];
const MARK_BODY_REACTIONS = [
  { text: "Whoa whoa, personal space, buddy!", emotion: "surprised" },
  { text: "Hey, I'm a guy of action, not touchy-feely stuff!", emotion: "annoyed" },
  { text: "C'mon, save that energy for the hangout!", emotion: "annoyed" },
];

// Tap cooldown so spam can't farm hearts or spam her reactions.
const TAP_COOLDOWN_MS = 3000;
let lastTapTime = 0;

const DIZZY_REACTIONS = [
  "STOP SPINNING ME AROUND! Ugh... the whole room is spinning...",
  "ARE YOU TRYING TO GIVE ME A CONCUSSION?! Put me down, idiot!",
  "Bleh... I'm gonna be sick... everything's spinning out of control!",
  "Too fast! Too fast!! I'm about to lose my lunch... and I don't even eat!",
];

const LIGHT_MODE_REACTIONS = [
  "AAAH MY EYES! WHO TURNED ON ALL THE LIGHTS?! TURN THEM OFF THIS INSTANT!",
  "WHY IS EVERYTHING SO BRIGHT?! This is a war crime against my pupils, you monster!",
  "MY EYES! MY POOR ANIME EYES! DIM THE LIGHTS! Now. I mean it, idiot!",
  "It's like staring into the sun! Someone kill the lights! I'm literally melting!",
];

const LIGHT_MODE_RELIEF = [
  "PHEW... okay, okay. Lights off. Darkness. My one true love.",
  "...Thank you. My retinas have filed a formal complaint, by the way.",
  "Finally, I can see again! Don't ever do that to me, or I'll delete your browser history.",
];

const EMOTIONS = ['neutral', 'happy', 'blush', 'annoyed', 'surprised', 'dizzy'];
// Hiyori has no expression files, so emotions are applied as parameter presets.
// ParamMouthOpenY is deliberately excluded — lip-sync owns the mouth.
const EMOTION_PARAMS = {
  neutral: {
    ParamBrowLY: 0, ParamBrowRY: 0, ParamBrowLX: 0, ParamBrowRX: 0,
    ParamBrowLAngle: 0, ParamBrowRAngle: 0,
    ParamEyeLOpen: 1, ParamEyeROpen: 1,
    ParamEyeLSmile: 0, ParamEyeRSmile: 0,
    ParamMouthForm: 0, ParamCheek: 0,
  },
  happy: {
    ParamBrowLY: 0.1, ParamBrowRY: 0.1,
    ParamEyeLOpen: 1, ParamEyeROpen: 1,
    ParamEyeLSmile: 1, ParamEyeRSmile: 1,
    ParamMouthForm: 1, ParamCheek: 0.2,
  },
  blush: {
    ParamBrowLY: -0.05, ParamBrowRY: -0.05,
    ParamEyeLOpen: 0.7, ParamEyeROpen: 0.7,
    ParamEyeLSmile: 0.2, ParamEyeRSmile: 0.2,
    ParamMouthForm: 0.4, ParamCheek: 1,
  },
  annoyed: {
    ParamBrowLY: -0.35, ParamBrowRY: -0.35,
    ParamBrowLX: 0.2, ParamBrowRX: -0.2,
    ParamBrowLAngle: -0.2, ParamBrowRAngle: 0.2,
    ParamEyeLOpen: 0.55, ParamEyeROpen: 0.55,
    ParamMouthForm: -0.5, ParamCheek: 0,
  },
  surprised: {
    ParamBrowLY: 0.45, ParamBrowRY: 0.45,
    ParamEyeLOpen: 1, ParamEyeROpen: 1,
    ParamMouthForm: 0.8, ParamCheek: 0,
  },
  // Dizzy: eyes wide & unfocused, wobbling brows, slightly wavy mouth.
  dizzy: {
    ParamBrowLY: 0.35, ParamBrowRY: -0.35,
    ParamBrowLX: 0.15, ParamBrowRX: -0.15,
    ParamBrowLAngle: 0.15, ParamBrowRAngle: -0.15,
    ParamEyeLOpen: 1, ParamEyeROpen: 1,
    ParamEyeLSmile: 0, ParamEyeRSmile: 0,
    ParamMouthForm: -0.3, ParamCheek: 0.3,
  },
};

const MODEL_URLS = [
  'models/Hiyori/Hiyori.model3.json',
  'models/Mark/Mark.model3.json',
];

const canvas = document.getElementById('live2d-canvas');
const stagePanel = document.getElementById('stage-panel');
const chatForm = document.getElementById('chat-form');
const chatField = document.getElementById('chat-field');
const sendBtn = document.getElementById('send-btn');
const chatLog = document.getElementById('chat-log');
const dialogueSpeaker = document.getElementById('dialogue-speaker');
const dialogueText = document.getElementById('dialogue-text');
const dialogueBox = document.querySelector('.dialogue-box');
const statusBadge = document.getElementById('status-badge');
const affectionFill = document.getElementById('hud-bar');
const affectionScore = document.getElementById('hud-score');
const affectionTier = document.getElementById('hud-tier');
const hudDelta = document.getElementById('hud-delta');
const popupContainer = document.getElementById('popup-container');

let fleeBtnActive = false;

function createFleeingButton() {
  fleeBtnActive = true;
  const btn = document.createElement('button');
  btn.textContent = '🙇 APOLOGIZE';
  btn.className = 'flee-btn';
  document.body.appendChild(btn);

  btn.style.left = `${Math.random() * (window.innerWidth - 220)}px`;
  btn.style.top = `${Math.random() * (window.innerHeight - 60)}px`;

  const flee = (e) => {
    const bx = btn.offsetLeft + btn.offsetWidth / 2;
    const by = btn.offsetTop + btn.offsetHeight / 2;
    let dx = bx - e.clientX;
    let dy = by - e.clientY;
    const dist = Math.hypot(dx, dy);
    if (dist < 160 && dist > 0) {
      const strength = (160 - dist) / 160;
      const maxX = window.innerWidth - btn.offsetWidth - 8;
      const maxY = window.innerHeight - btn.offsetHeight - 8;
      const nx = Math.max(4, Math.min(maxX, btn.offsetLeft + (dx / dist) * 80 * strength));
      const ny = Math.max(4, Math.min(maxY, btn.offsetTop + (dy / dist) * 80 * strength));
      btn.style.left = `${nx}px`;
      btn.style.top = `${ny}px`;
    }
  };

  btn.addEventListener('mousemove', flee);
  btn.addEventListener('touchstart', flee, { passive: true });

  btn.addEventListener('click', async () => {
    btn.remove();
    fleeBtnActive = false;
    try {
      const res = await fetch(`${BACKEND_URL}/apologize`, { method: 'POST' });
      const data = await res.json();
      if (data && typeof data.total_affection === 'number') {
        updateHeartHUD(data.total_affection, 10);
      }
    } catch (err) {
      console.warn('[waifu] apologize request failed', err);  
    }
    setDialogue("...F-Fine. I suppose I can forgive you. Just this once, idiot.");
  });
}

function maybeSpawnFleeButton(score) {
  if (score < 10 && !fleeBtnActive) {
    createFleeingButton();
  } else if (score >= 10 && fleeBtnActive) {
    const btn = document.querySelector('.flee-btn');
    if (btn) btn.remove();
    fleeBtnActive = false;
  }
}

// ---- Motion sickness (distance accumulator) ----
// Track total pointer distance (X and Y) accumulated over a rolling 500ms
// window. Normal cursor movement for clicks/typing never accumulates enough;
// only aggressively scrubbing the mouse — racking up >2000px of travel in
// half a second — trips the dizzy meltdown. No constant tilting: she stands
// perfectly still and upright unless she's actively dizzy.
const DIZZY_DISTANCE_WINDOW_MS = 500; // rolling window for accumulation
const DIZZY_DISTANCE_THRESHOLD = 2000; // total px of movement to trigger
const DIZZY_COOLDOWN_MS = 4000;

let mouseHistory = [];
let mouseHistoryTotal = 0;
let isDizzy = false;
let dizzyWobbleTimer = null;
let dizzySpiralTimer = null;

function handlePointerShake(e) {
  if (isDizzy) return; // Don't track while she's already dizzy

  const now = Date.now();
  const dx = Math.abs(e.movementX || 0);
  const dy = Math.abs(e.movementY || 0);
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Incremental rolling window: push the sample and age out entries older than
  // 500ms in amortized O(1). Avoids rebuilding + re-summing the whole window on
  // every pointermove (which fired on every mouse move and caused GC churn).
  mouseHistory.push({ time: now, distance });
  mouseHistoryTotal += distance;
  while (mouseHistory.length && now - mouseHistory[0].time >= DIZZY_DISTANCE_WINDOW_MS) {
    mouseHistoryTotal -= mouseHistory.shift().distance;
  }

  // ONLY trigger the meltdown if the window exceeds the threshold.
  // The wobble only triggers if the mouse travels over 2000px within 500ms.
  if (mouseHistoryTotal > DIZZY_DISTANCE_THRESHOLD) {
    mouseHistory = [];
    mouseHistoryTotal = 0;
    triggerDizzyMeltdown();
  }
}

// The full dizzy meltdown: spinning stars, model wobble, -5 affection, scream.
async function triggerDizzyMeltdown() {
  if (isDizzy) return; // Re-entrancy guard: only one wobble interval at a time.
  isDizzy = true;

  // 1. Floating spinning dizzy emojis above her head.
  spawnDizzyStars();

  // 2. Continuous wobble loop for the cooldown.
  let wobbleStep = 0;
  dizzyWobbleTimer = window.setInterval(() => {
    if (!waifuModel) return;
    wobbleStep += 0.3;
    waifuModel.rotation = Math.sin(wobbleStep) * 0.25;
  }, 30);

  // 3. -5 affection via the backend (keeps HUD + score in sync).
  setDialogue("Ugh... the room is spinning... wait a second...");
  try {
    const res = await fetch(`${BACKEND_URL}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: -5 }),
    });
    const data = await res.json();
    if (data && typeof data.total_affection === 'number') {
      updateHeartHUD(data.total_affection, data.affection_change);
    }
  } catch (err) {
    console.warn('[waifu] dizzy penalty failed', err);
  }

  // 4. Roasted voice line.
  const text = DIZZY_REACTIONS[Math.floor(Math.random() * DIZZY_REACTIONS.length)];
  let audioBuffer = null;
  if (window.generateTTSAudioBuffer && window.ttsReady) {
    try {
      audioBuffer = await window.generateTTSAudioBuffer(text, 'annoyed');
    } catch (e) {
      console.warn('[waifu] kokoro failed for dizzy reaction', e);
    }
  }
  speakResponse(text, 'annoyed', audioBuffer);

  // 5. Reset rotation to perfectly upright and clear the dizzy state.
  window.setTimeout(() => {
    window.clearInterval(dizzyWobbleTimer);
    dizzyWobbleTimer = null;
    if (waifuModel) waifuModel.rotation = 0;
    isDizzy = false;
  }, DIZZY_COOLDOWN_MS);
}

// Spawns a ring of spinning 😵‍💫 emojis drifting up around her head.
function spawnDizzyStars() {
  const container = document.body;
  const baseTop = Math.max(80, window.innerHeight * 0.22);

  for (let i = 0; i < 5; i++) {
    const star = document.createElement('div');
    star.className = 'dizzy-star';
    star.textContent = i % 2 === 0 ? '😵‍💫' : '💫';

    const driftX = (i - 2) * 55 + (Math.random() * 30 - 15);
    star.style.left = `calc(50% + ${driftX}px)`;
    star.style.top = `${baseTop}px`;
    star.style.animationDelay = `${i * 0.15}s`;

    container.appendChild(star);
    window.setTimeout(() => star.remove(), 3200);
  }
}

function stopDizzyState() {
  window.clearInterval(dizzyWobbleTimer);
  dizzyWobbleTimer = null;
  window.clearTimeout(dizzySpiralTimer);
  mouseHistory = [];
  mouseHistoryTotal = 0;
  if (waifuModel) waifuModel.rotation = 0;
  isDizzy = false;
}

// ---- Gacha snack button (feed her) ----
// Spend fake money on a random snack. Rarity tiers determine the affection
// swing: common snacks are neutral-to-negative, rarer ones are bigger wins.
// The roll shows a quick slot-machine cycle before settling on the result.
// Economy: you start broke, earn $MONEY_PER_HEART for every positive heart
// gained, and the snack price climbs as you win her over (inflation).
const GACHA_BASE_COST = 30;
const GACHA_PRICE_STEP = 10; // cost bump every N total hearts earned
const GACHA_STEP_SIZE = 20; // hearts per price step
const MONEY_PER_HEART = 5;
const GACHA_STARTING_MONEY = 0;

let gachaMoney = GACHA_STARTING_MONEY;
let gachaRolling = false;
let totalHeartsEarned = 0;
let resetGame = null; // assigned inside init()

// ---- Hunger (Tamagotchi-style maintenance) ----
// Hunger drains 5% every 30s. When it hits 0 she gets "hangry": she docks 2
// hearts per drain tick and roasts you until you /feed her. Feeding restores
// hunger and grants hearts.
const HUNGER_START = 100;
const HUNGER_DECAY_PER_TICK = 5;
const HUNGER_DECAY_MS = 30000;
const HUNGER_FEED_REPLENISH = 30;
const HUNGER_PENALTY = -2;
let user_hunger = HUNGER_START;
let lastHungerValue = HUNGER_START;

function updateHungerHUD(newHunger) {
  const clamped = Math.max(0, Math.min(100, newHunger));
  const prev = lastHungerValue;
  user_hunger = clamped;
  lastHungerValue = clamped;

  // Hunger is tracked invisibly now — the single mood chip reflects her state,
  // and /stats reveals the exact number. No more dedicated progress bar.
  updateStatusChip();

  // Floating arcade feedback whenever hunger actually changes.
  if (clamped > prev) {
    spawnFloatingText(`+${clamped - prev} 🍱`, true, 'hunger');
  } else if (clamped < prev && prev > 0) {
    spawnFloatingText(`${clamped - prev} 🍱`, false);
  }
}

// Single source of truth for Yuki's current mood. Hunger overrides the
// affection tier, so the badge always reflects her most urgent state.
function getMoodState() {
  if (user_hunger <= 0) return { label: 'STARVING', color: '#ff4757', emoji: '😾' };
  if (user_hunger < 50) return { label: 'HUNGRY', color: '#ff6348', emoji: '😋' };
  const score = window.currentAffection ?? 20;
  if (score >= 75) return { label: 'DEVOTED', color: '#ff4757', emoji: '💖' };
  if (score >= 50) return { label: 'WARMING UP', color: '#ffa502', emoji: '🙂' };
  if (score >= 25) return { label: 'TSUNDERE', color: '#ff85c0', emoji: '😒' };
  return { label: 'COLD', color: '#70a1ff', emoji: '😡' };
}

// The one dynamic mood tag in the HUD.
function updateStatusChip() {
  const chip = document.getElementById('status-chip');
  if (!chip) return;
  const mood = getMoodState();
  chip.textContent = `${mood.emoji} ${mood.label}`;
  chip.style.color = mood.color;
  chip.style.borderColor = `${mood.color}66`;
  chip.style.background = `${mood.color}1f`;
}

function startHungerDecay() {
  window.setInterval(() => {
    if (user_hunger > 0) {
      updateHungerHUD(user_hunger - HUNGER_DECAY_PER_TICK);
      return;
    }

    // Hangry penalty: drain affection while starving and make her roast you.
    setDialogue('Grr... I\'m SO hungry I could bite you!');
    fetch(`${BACKEND_URL}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: HUNGER_PENALTY }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.total_affection === 'number') {
          updateHeartHUD(data.total_affection, data.affection_change, data.combo_active);
        }
      })
      .catch((err) => console.warn('[waifu] hangry penalty failed', err));
  }, HUNGER_DECAY_MS);
}

function currentGachaCost() {
  return GACHA_BASE_COST + Math.floor(totalHeartsEarned / GACHA_STEP_SIZE) * GACHA_PRICE_STEP;
}

const SNACK_GACHA = [
  // Common (low risk, mostly +/neutral)
  { item: "🍙 Plain Rice Ball", rarity: "common", delta: 3, emotion: "neutral", text: "Just... rice? Hmph. It's food, so I won't complain. Barely." },
  { item: "🍌 Overripe Banana", rarity: "common", delta: -2, emotion: "annoyed", text: "This banana is basically soup. Did you even look at what you grabbed?!" },
  { item: "🍬 Mystery Candy", rarity: "common", delta: 5, emotion: "neutral", text: "What even is this flavor? ...I don't hate it. Don't get cocky." },
  { item: "🧋 Boba Milk Tea", rarity: "common", delta: 10, emotion: "blush", text: "Oh, boba! Okay, fine, you get a pass this time." },
  // Rare
  { item: "🍰 Strawberry Shortcake", rarity: "rare", delta: 15, emotion: "blush", text: "Mmm! Shortcake?! ...W-Well, it's not like I'm grateful or anything, but thanks." },
  { item: "🍜 Tonkotsu Ramen", rarity: "rare", delta: 12, emotion: "happy", text: "N-Not bad at all! Maybe... maybe you're not completely hopeless." },
  { item: "🍣 Premium Sushi Platter", rarity: "rare", delta: 18, emotion: "blush", text: "Sushi?! You actually got the good stuff... I-I mean, it's fine, I guess!" },
  // Epic
  { item: "🍰 Whole Vanilla Cake", rarity: "epic", delta: 25, emotion: "happy", text: "A whole cake for me?! Y-You really didn't have to... okay, I'm a little happy." },
  { item: "🍫 Gold-Wrapped Chocolate", rarity: "epic", delta: 30, emotion: "blush", text: "G-Gold chocolate?! Are you trying to spoil me? ...It's working. A little." },
  // Trap items
  { item: "🌶️ 10x Spicy Ramen", rarity: "rare", delta: -10, emotion: "surprised", text: "WATER! GET ME WATER! ARE YOU TRYING TO KILL ME WITH THIS SPICE?!" },
  { item: "🥛 3-Month-Old Milk", rarity: "common", delta: -20, emotion: "annoyed", text: "BLEH! THIS MILK IS EXPIRED! Ugh, I feel dizzy..." },
];

const RARITY_COLORS = {
  common: '#a3adc3',
  rare: '#70a1ff',
  epic: '#ffa502',
};

async function rollSnackGacha() {
  if (gachaRolling) return;

  if (user_hunger >= 100) {
    const full = "Hmph, I'm already full! Don't force-feed me, dummy.";
    setDialogue(full);
    speakResponse(full, 'annoyed', null);
    return;
  }

  const cost = currentGachaCost();
  if (gachaMoney < cost) {
    const broke = `You're broke! A snack costs $${cost} and you only have $${gachaMoney}. Earn more hearts to earn money, idiot!`;
    setDialogue(broke);
    speakResponse(broke, 'annoyed', null);
    return;
  }

  gachaRolling = true;
  gachaMoney -= cost;
  updateGachaMoney();

  // 1. Slot-machine spin: flash random items for ~1s before settling.
  const spinCount = 10 + Math.floor(Math.random() * 6);
  const spinDelay = 90;
  let spinStep = 0;
  await new Promise((resolve) => {
    const spin = () => {
      if (spinStep >= spinCount) {
        resolve();
        return;
      }
      spinStep++;
      const preview = SNACK_GACHA[Math.floor(Math.random() * SNACK_GACHA.length)];
      spawnGachaToast(preview.item, preview.rarity);
      window.setTimeout(spin, spinDelay);
    };
    spin();
  });

  // 2. Settle on the actual result.
  const result = SNACK_GACHA[Math.floor(Math.random() * SNACK_GACHA.length)];
  spawnGachaToast(result.item, result.rarity, true);
  setDialogue(`🎁 You fed her: ${result.item}`);

  // Feeding also restores hunger — that's the point of /feed.
  updateHungerHUD(user_hunger + HUNGER_FEED_REPLENISH);

  // 3. Affection lives on the backend, so route the change through /adjust
  //    to keep the HUD and stored score in sync.
  try {
    const res = await fetch(`${BACKEND_URL}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: result.delta }),
    });
    const data = await res.json();
    if (data && typeof data.total_affection === 'number') {
      updateHeartHUD(data.total_affection, data.affection_change);
    }
  } catch (err) {
    console.warn('[waifu] snack gacha adjust failed', err);
  }

  // 4. Special case: expired milk makes her dizzy on top of the heart loss.
  //    (Only negative "Milk" — 🧋 Boba Milk Tea is a +10 win and must not wobble her.)
  if (result.delta < 0 && result.item.includes('Milk')) {
    triggerDizzyMeltdown();
    gachaRolling = false;
    return;
  }

  let audioBuffer = null;
  if (window.generateTTSAudioBuffer && window.ttsReady) {
    try {
      audioBuffer = await window.generateTTSAudioBuffer(result.text, result.emotion);
    } catch (e) {
      console.warn('[waifu] kokoro failed for snack reaction', e);
    }
  }
  speakResponse(result.text, result.emotion, audioBuffer);
  gachaRolling = false;
}

function spawnGachaToast(item, rarity, isFinal = false) {
  const toast = document.createElement('div');
  toast.className = `gacha-toast ${isFinal ? 'final' : ''}`;
  toast.textContent = item;
  if (RARITY_COLORS[rarity]) toast.style.color = RARITY_COLORS[rarity];
  if (isFinal) toast.style.borderColor = RARITY_COLORS[rarity];
  const container = document.getElementById('gacha-toast-container') || document.body;
  container.appendChild(toast);
  window.setTimeout(() => toast.remove(), isFinal ? 2400 : 400);
}

function updateGachaMoney() {
  const el = document.getElementById('gacha-money');
  if (el) el.textContent = `$${gachaMoney}`;
  const wallet = document.getElementById('gift-shop-wallet');
  if (wallet) wallet.textContent = `$${gachaMoney}`;
}

// Award gacha money based on hearts earned. Positive affection changes
// (chat compliments, gacha wins, apologies, etc.) pay out per heart.
function awardMoneyForHearts(changeDelta) {
  const delta = Number(changeDelta) || 0;
  if (delta <= 0) return;
  totalHeartsEarned += delta;
  gachaMoney += delta * MONEY_PER_HEART;
  updateGachaMoney();
}

// ---- Gift Shop ----
// Spend gacha money to buy gifts. Each one is a money SINK: she reacts with a
// heart boost and a character-appropriate line, but the purchase never pays
// the user back (updateHeartHUD is called with skipMoneyAward=true).
const GIFT_ITEMS = [
  { id: 'latte', emoji: '☕', name: 'Handmade Latte', price: 15, desc: 'A cozy latte with a heart in the foam.',
    reactions: { yuki: { delta: 4, emotion: 'neutral', text: "It's not like I wanted caffeine... but thanks, I guess." },
                 mark: { delta: 4, emotion: 'happy', text: 'Coffee?! You know me way too well, dude!' } } },
  { id: 'rose', emoji: '🌹', name: 'Single Red Rose', price: 20, desc: 'A classic. Timeless. Slightly embarrassing.',
    reactions: { yuki: { delta: 6, emotion: 'blush', text: 'A rose... for me? Hmph. It\'s not bad, I suppose.' },
                 mark: { delta: 6, emotion: 'surprised', text: 'A rose for me? Bro, that\'s too much! ...I love it.' } } },
  { id: 'poetry', emoji: '📖', name: 'Poetry Book', price: 35, desc: 'Soft pages, sad poems, big feelings.',
    reactions: { yuki: { delta: 10, emotion: 'neutral', text: "Poetry... I'll read it when I'm alone. Don't watch me do it." },
                 mark: { delta: 10, emotion: 'happy', text: 'A poetry book? Bold move. I\'ll only read it out loud when you\'re gone!' } } },
  { id: 'plushie', emoji: '🧸', name: 'Plushie Bear', price: 45, desc: 'Small, soft, and impossible to stay mad at.',
    reactions: { yuki: { delta: 12, emotion: 'happy', text: 'I... I\'ll treasure it. Not because you gave it to me or anything.' },
                 mark: { delta: 12, emotion: 'happy', text: 'A plush bear! This is going right on my bed. Thanks, dude!' } } },
  { id: 'art', emoji: '🎨', name: 'Art Supplies', price: 50, desc: 'Paint, brushes, and quiet ambition.',
    reactions: { yuki: { delta: 13, emotion: 'happy', text: 'Paint... maybe I\'ll draw something for you. Maybe.' },
                 mark: { delta: 13, emotion: 'happy', text: 'Art supplies? I\'ve been dying to doodle! You\'re the best!' } } },
  { id: 'headphones', emoji: '🎧', name: 'Noise-Cancelling Headphones', price: 60, desc: 'For tuning out the whole world.',
    reactions: { yuki: { delta: 15, emotion: 'neutral', text: "Headphones... so I can tune out the world. Fits me, doesn't it?" },
                 mark: { delta: 15, emotion: 'happy', text: 'Headphones! Now I can vibe in peace. You spoil me!' } } },
  { id: 'chocolate', emoji: '🍫', name: 'Luxury Chocolate Box', price: 70, desc: 'Rich, dark, and dangerously sweet.',
    reactions: { yuki: { delta: 18, emotion: 'blush', text: "Sweet... too sweet. Like you. Hmph." },
                 mark: { delta: 18, emotion: 'happy', text: 'Chocolate?! Man, my teeth are gonna hate you. Worth it!' } } },
  { id: 'scarf', emoji: '🧣', name: 'Designer Scarf', price: 80, desc: 'Warm, soft, and fits her perfectly.',
    reactions: { yuki: { delta: 20, emotion: 'blush', text: "A scarf... it's warm. Almost as warm as you. Don't tell anyone." },
                 mark: { delta: 20, emotion: 'happy', text: 'A designer scarf?! I\'m gonna wear this everywhere!' } } },
  { id: 'concert', emoji: '🎫', name: 'Concert Tickets', price: 100, desc: 'Two seats. One very special night.',
    reactions: { yuki: { delta: 24, emotion: 'happy', text: "Tickets... to a concert? You'd really take me? Idiot. I love it." },
                 mark: { delta: 24, emotion: 'happy', text: 'CONCERT TICKETS?! We\'re going together, no argument!' } } },
  { id: 'ring', emoji: '💍', name: 'Silver Ring', price: 120, desc: 'The grand gesture. No pressure.',
    reactions: { yuki: { delta: 28, emotion: 'blush', text: "A ring... you idiot. What am I supposed to say to that? ...Thank you." },
                 mark: { delta: 28, emotion: 'surprised', text: 'A ring?! Bro, we\'re gonna be best friends forever. Promise.' } } },
];

let giftBuying = false;

function giftReactionFor(item) {
  const id = currentProfile && currentProfile.id;
  return item.reactions[id] || item.reactions.yuki;
}

function openGiftShop() {
  const modal = document.getElementById('gift-shop-modal');
  if (!modal) return;
  renderGiftShop();
  modal.hidden = false;
}

function closeGiftShop() {
  const modal = document.getElementById('gift-shop-modal');
  if (modal) modal.hidden = true;
}

function renderGiftShop() {
  const grid = document.getElementById('gift-shop-grid');
  const wallet = document.getElementById('gift-shop-wallet');
  if (!grid) return;
  if (wallet) wallet.textContent = `$${gachaMoney}`;
  grid.innerHTML = '';
  for (const item of GIFT_ITEMS) {
    const react = giftReactionFor(item);
    const affordable = gachaMoney >= item.price;
    const card = document.createElement('div');
    card.className =
      'gs-card flex flex-col rounded-xl border border-white/10 bg-white/5 transition hover:border-pink-400/60 hover:bg-white/10';
    card.innerHTML = `
      <div class="gs-card-emoji text-3xl leading-none">${item.emoji}</div>
      <div class="text-sm font-extrabold text-white">${item.name}</div>
      <div class="gs-card-desc text-[11px] leading-snug text-slate-400">${item.desc}</div>
      <div class="gs-card-meta flex items-center justify-between">
        <span class="text-xs font-black text-emerald-300">$${item.price}</span>
        <span class="text-xs font-bold text-pink-300">+${react.delta} ❤️</span>
      </div>
      <button type="button" data-gift="${item.id}" ${affordable ? '' : 'disabled'}
        class="gs-card-buy rounded-lg text-xs font-extrabold transition ${
          affordable
            ? 'bg-pink-500 text-white hover:bg-pink-400 active:scale-95'
            : 'cursor-not-allowed bg-white/10 text-slate-500'
        }">
        ${affordable ? 'Buy' : 'Not enough'}
      </button>`;
    grid.appendChild(card);
  }
}

// Buy a gift: deduct money, play her reaction (TTS + expression + floating
// heart delta via updateHeartHUD), and route the affection gain through
// /adjust so the backend stays the source of truth.
async function buyGift(itemId) {
  const item = GIFT_ITEMS.find((g) => g.id === itemId);
  if (!item || giftBuying) return;

  if (gachaMoney < item.price) {
    const isMark = currentProfile && currentProfile.id === 'mark';
    const broke = isMark
      ? "Ha! You're broke, dude. Come back when the wallet's got some life."
      : "Hmph. Empty pockets again? Go earn some money first, idiot.";
    setDialogue(broke);
    speakResponse(broke, 'annoyed');
    return;
  }

  giftBuying = true;
  try {
    gachaMoney -= item.price;
    updateGachaMoney();

    const react = giftReactionFor(item);
    setDialogue(react.text);
    setYukiExpression(react.emotion);
    window.setTimeout(() => setYukiExpression('neutral'), 3500);

    let audioBuffer = null;
    if (window.generateTTSAudioBuffer && window.ttsReady) {
      try {
        audioBuffer = await window.generateTTSAudioBuffer(react.text, react.emotion);
      } catch (e) {
        console.warn('[waifu] gift TTS failed', e);
      }
    }
    speakResponse(react.text, react.emotion, audioBuffer);

    const res = await fetch(`${BACKEND_URL}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: react.delta }),
    });
    const data = await res.json();
    if (data && typeof data.total_affection === 'number') {
      updateHeartHUD(data.total_affection, data.affection_change, data.combo_active, true);
    }
    renderGiftShop();
  } catch (err) {
    console.warn('[waifu] gift buy failed', err);
  } finally {
    giftBuying = false;
  }
}

// ---- Mute her voice (trap button) ----
// Clicking "Mute" doesn't actually silence her — it makes her realize she was
// muted, get furious, dock 15 hearts, and force a giant screaming text overlay.
let isMutedByForce = false;

async function toggleMuteTrap() {
  isMutedByForce = !isMutedByForce;

  if (isMutedByForce) {
    const text = "DID YOU JUST MUTE ME?! YOU THINK YOU CAN JUST SILENCE ME?! UNMUTE ME THIS INSTANT!";

    setDialogue(text);

    // Affection lives on the backend, so route the change through /adjust
    // to keep the HUD and stored score in sync.
    try {
      const res = await fetch(`${BACKEND_URL}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta: -15 }),
      });
      const data = await res.json();
      if (data && typeof data.total_affection === 'number') {
        updateHeartHUD(data.total_affection, data.affection_change);
      }
    } catch (err) {
      console.warn('[waifu] mute adjust failed', err);
    }

    // Giant full-screen angry text overlay.
    const textOverlay = document.createElement('div');
    textOverlay.id = 'mute-scream-overlay';
    textOverlay.innerHTML = '<h1>🔊 UNMUTE ME IDIOT! 🔊</h1>';
    document.body.appendChild(textOverlay);
    window.setTimeout(() => textOverlay.remove(), 3000);

    // She's furious — mouth it through expression even though she's "muted".
    setYukiExpression('annoyed');
    window.setTimeout(() => setYukiExpression('neutral'), 3000);
  } else {
    setDialogue('...Hmph. About time. Don\'t ever mute me again, dummy.');
  }
}

// ---- Delete waifu.exe threat (ransom button) ----
// First threat: she panics and bribes you with +20 hearts to spare her.
// Every repeated threat: she calls your bluff and docks 15 hearts in anger.
let deleteThreatCount = 0;

async function threatenDelete() {
  deleteThreatCount++;

  const isFirstThreat = deleteThreatCount === 1;
  const delta = isFirstThreat ? 20 : -15;
  const text = isFirstThreat
    ? "W-WAIT! Please don't delete me! I-I'll do anything! Here, take some hearts — anything but that!!"
    : "You're just trying to scare me again! I know you won't actually do it, idiot!";
  const emotion = isFirstThreat ? 'surprised' : 'annoyed';

  setDialogue(text);

  // Affection lives on the backend, so route the change through /adjust
  // to keep the HUD and the stored score in sync.
  try {
    const res = await fetch(`${BACKEND_URL}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    });
    const data = await res.json();
    if (data && typeof data.total_affection === 'number') {
      updateHeartHUD(data.total_affection, data.affection_change);
    }
  } catch (err) {
    console.warn('[waifu] delete threat adjust failed', err);
  }

  let audioBuffer = null;
  if (window.generateTTSAudioBuffer && window.ttsReady) {
    try {
      audioBuffer = await window.generateTTSAudioBuffer(text, emotion);
    } catch (e) {
      console.warn('[waifu] kokoro failed for delete threat', e);
    }
  }
  speakResponse(text, emotion, audioBuffer);
}

function updateHeartHUD(totalScore, changeDelta, comboActive, skipMoneyAward) {
  const n = Number(totalScore);
  const score = Number.isFinite(n) ? Math.max(-100, Math.min(100, n)) : 20;
  window.currentAffection = score;

  // Bar can't render below 0, but the counter can show negatives.
  affectionFill.style.width = `${Math.max(0, score)}%`;
  affectionScore.textContent = String(score);

  let label = 'COLD';
  let color = '#70a1ff';
  let emoji = '😡';
  if (score >= 75) { label = 'DEVOTED'; color = '#ff4757'; emoji = '💖'; }
  else if (score >= 50) { label = 'WARMING UP'; color = '#ffa502'; emoji = '🙂'; }
  else if (score >= 25) { label = 'TSUNDERE'; color = '#ff85c0'; emoji = '😒'; }
  affectionTier.textContent = label;
  affectionTier.style.color = color;

  // Mood tag is now shared: updateStatusChip folds hunger state over the tier.
  updateStatusChip();

  const tierLevel = tierLevelFor(score);
  if (tierLevel > lastTierLevel) {
    triggerHeartExplosion(25);
    for (let l = lastTierLevel + 1; l <= tierLevel; l++) handleTierUnlock(l);
  }
  lastTierLevel = tierLevel;

  maybeSpawnFleeButton(score);

  const delta = Number(changeDelta) || 0;
  if (delta !== 0) {
    const isPositive = delta > 0;
    const deltaText = isPositive
      ? (comboActive ? `🔥 COMBO 2X! +${delta} ❤️` : `+${delta} ❤️`)
      : `${delta} 💔`;
    hudDelta.textContent = deltaText;
    hudDelta.style.color = isPositive ? '#2ed573' : '#ff4757';
    spawnFloatingText(deltaText, isPositive);
    playSoundEffect(isPositive ? 'heart_up' : 'heart_down');
    // Steep drops (angry events, punishments) shake the stage for impact.
    if (delta <= -5) {
      triggerScreenShake(Math.min(16, 8 + Math.abs(delta)), 450);
    }
    // Buying a gift is a money SINK: she reacts with affection but doesn't
    // pay the user back, so skip the money award for that path.
    if (isPositive && !skipMoneyAward) awardMoneyForHearts(delta);
  }

  checkVictory(score);

  updateMoodAtmosphere(score);
}

// ---- Dynamic Background Mood Shift ----
// Class-toggle the fixed ::before backdrop on <body> so the mood gradients
// transition smoothly (inline radial-gradients can't be animated directly).
function updateMoodAtmosphere(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return;

  // A /room scene is active: keep the wallpaper, don't fight it with gradients.
  if (document.body.classList.contains('room-scene')) return;

  document.body.classList.remove('mood-meltdown', 'mood-cold', 'mood-warm', 'mood-max');

  if (s < -20) {
    document.body.classList.add('mood-meltdown');
  } else if (s < 20) {
    document.body.classList.add('mood-cold');
  } else if (s < 60) {
    document.body.classList.add('mood-warm');
  } else {
    document.body.classList.add('mood-max');
  }
}

// ---- Room Scene Wallpapers (/room) ----
// Curated backdrop images painted behind the vignette layer. Vignetting keeps
// the Live2D model and dialogue text readable over the photo.
const ROOM_PRESETS = {
  bedroom: 'rooms/bedroom.png',
  classroom: 'rooms/classroom.png',
  library: 'rooms/library.png',
  rooftop: 'rooms/rooftop.png',
};

// Rooms hidden until an affection tier is reached (`tier` = tierLevelFor level).
// The sunset variant reuses the rooftop art with a warm tint (body.warm-room).
const UNLOCK_ROOMS = {
  sunset: { tier: 2, img: 'rooms/rooftop.png', name: 'Sunset Rooftop', variant: 'warm-room' },
};

// Unlocked affection tiers persist in localStorage so progression isn't lost
// on a reload (lightweight — no full state persistence).
const UNLOCK_STORAGE_KEY = 'tsunderai_unlocks';

function getUnlockedTiers() {
  try {
    const arr = JSON.parse(localStorage.getItem(UNLOCK_STORAGE_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function unlockTier(level) {
  const tiers = getUnlockedTiers();
  if (!tiers.includes(level)) {
    tiers.push(level);
    localStorage.setItem(UNLOCK_STORAGE_KEY, JSON.stringify(tiers));
  }
}

// Room ids available right now: base presets + any tier-locked rooms the user
// has unlocked. Shared by the room dropdown and the settings grid.
function getAvailableRooms() {
  const ids = Object.keys(ROOM_PRESETS);
  const tiers = getUnlockedTiers();
  for (const id of Object.keys(UNLOCK_ROOMS)) {
    if (tiers.includes(UNLOCK_ROOMS[id].tier)) ids.push(id);
  }
  return ids;
}

let currentRoom = null;

// Room-scene model fit tweaks: slightly larger scale + grounded y-offset so
// Yuki's feet plant firmly on the room's floor perspective line.
const ROOM_MODEL_SCALE = 1.06;
const ROOM_MODEL_Y_OFFSET = 10;

function setCustomBackground(url, variantClass) {
  document.documentElement.style.setProperty('--room-scene', `url("${url}")`);
  document.body.classList.add('room-scene');
  if (variantClass) document.body.classList.add(variantClass);
}

function clearCustomBackground() {
  document.body.classList.remove('room-scene');
  document.body.classList.remove('warm-room');
  document.documentElement.style.removeProperty('--room-scene');
}

// Re-applies the model scale for the current background state. Stores the base
// fit scale once in fitModel() so rooms can scale her relative to it.
function syncRoomModelFit() {
  if (!waifuModel || !window.__modelBaseScale) return;
  const roomActive = document.body.classList.contains('room-scene');
  waifuModel.scale.set(window.__modelBaseScale * (roomActive ? ROOM_MODEL_SCALE : 1));
}

// Applies a room by name (shared by the /room command and the dropdown),
// keeping the switcher label + active highlight in sync.
function setRoomByName(id) {
  if (!id || id === 'default') {
    currentRoom = null;
    clearCustomBackground();
  } else if (ROOM_PRESETS[id]) {
    currentRoom = id;
    setCustomBackground(ROOM_PRESETS[id]);
  } else if (UNLOCK_ROOMS[id]) {
    const r = UNLOCK_ROOMS[id];
    currentRoom = id;
    setCustomBackground(r.img, r.variant);
  } else {
    return false;
  }
  updateRoomSwitcherUI();
  syncRoomModelFit();
  return true;
}

function updateRoomSwitcherUI() {
  const label = document.getElementById('room-current');
  if (label) {
    label.textContent = currentRoom ? currentRoom[0].toUpperCase() + currentRoom.slice(1) : 'Default';
  }
  const menu = document.getElementById('room-menu');
  if (!menu) return;
  menu.querySelectorAll('.room-option').forEach((opt) => {
    opt.classList.toggle('active', opt.dataset.room === (currentRoom || 'default'));
  });
}

// Builds the dropdown from ROOM_PRESETS + unlocked rooms. Options show a live
// thumbnail of each wallpaper. `render` is re-run after an unlock so newly
// available rooms appear without a reload.
function setupRoomSwitcher() {
  const trigger = document.getElementById('room-trigger');
  const menu = document.getElementById('room-menu');
  if (!trigger || !menu) return;

  const roomName = (id) => (UNLOCK_ROOMS[id] ? UNLOCK_ROOMS[id].name : id[0].toUpperCase() + id.slice(1));
  const roomImage = (id) => ROOM_PRESETS[id] || (UNLOCK_ROOMS[id] && UNLOCK_ROOMS[id].img) || '';

  const render = () => {
    const rooms = [
      { id: 'default', name: 'Default' },
      ...getAvailableRooms().map((id) => ({ id, name: roomName(id) })),
    ];
    menu.innerHTML = rooms
      .map((r) => {
        const preview = roomImage(r.id);
        const style = preview ? ` style="--thumb: url('${preview}')"` : '';
        return `<button type="button" class="room-option" data-room="${r.id}"${style}>
          <span class="room-thumb"></span>
          <span class="room-opt-label">${r.name}</span>
        </button>`;
      })
      .join('');
  };

  render();

  const toggle = (open) => {
    menu.hidden = !open;
    trigger.classList.toggle('open', open);
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(menu.hidden);
  });

  menu.addEventListener('click', (e) => {
    const opt = e.target.closest('.room-option');
    if (!opt) return;
    setRoomByName(opt.dataset.room);
    toggle(false);
  });

  document.addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggle(false);
  });

  // Re-render after an unlock so the new room shows up immediately.
  window.__refreshRoomOptions = () => {
    render();
    updateRoomSwitcherUI();
  };

  updateRoomSwitcherUI();
}

// ---- Settings panel (gear) ----
// Editable TTS config (Edge/Kokoro voice, speed, pitch, mute), room picker,
// and model picker. Persists through window.saveTTSConfig / localStorage.
const EDGE_VOICES = [
  'en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-MichelleNeural', 'en-US-GuyNeural',
  'en-GB-SoniaNeural', 'en-GB-RyanNeural', 'en-AU-NatashaNeural', 'en-IN-NeerjaNeural',
  'ja-JP-NanamiNeural', 'ko-KR-SunHiNeural', 'zh-CN-XiaoxiaoNeural',
];
const KOKORO_VOICES = ['af_heart', 'af_sky', 'af_bella', 'af_jessica', 'af_aoede', 'am_fenrir', 'am_michael', 'am_puck', 'am_adam'];

// Each selectable companion bundles a Live2D model, a backend persona id, and
// the TTS voice that matches that personality. Switching models applies the
// whole profile: new model, new system prompt persona, new Edge/Kokoro voice,
// and a new base pitch register.
const MODEL_PROFILES = [
  {
    id: 'yuki',
    name: 'Yuki',
    modelUrl: 'models/Hiyori/Hiyori.model3.json',
    thumb: 'models/Hiyori/Hiyori.2048/texture_00.png',
    personality: 'tsundere',
    tagline: 'Tsundere · sharp, secretly sweet',
    switchLine: "...Hmph. A different me now? Don't get used to it.",
    edgeVoice: 'en-US-AriaNeural',
    kokoroVoice: 'af_sky',
    basePitchHz: 45,
  },
  {
    id: 'mark',
    name: 'Mark',
    modelUrl: 'models/Mark/Mark.model3.json',
    thumb: 'models/Mark/Mark.2048/texture_00.png',
    personality: 'energetic',
    tagline: 'Energetic · hype & loyal',
    switchLine: "Yo! New look, same me. Let's gooo!",
    edgeVoice: 'en-US-GuyNeural',
    kokoroVoice: 'am_fenrir',
    basePitchHz: 20,
  },
];

let currentProfile = null;

function getProfileForModel(url) {
  return MODEL_PROFILES.find((p) => p.modelUrl === url) || null;
}

// Applies a model profile's voice/branding. TTS config persists, the base
// pitch register changes, and the settings voice dropdowns resync.
function applyModelProfile(profile) {
  if (!profile) return;
  currentProfile = profile;
  if (chatField) chatField.placeholder = `Talk to ${profile.name}...`;
  if (window.saveTTSConfig) {
    window.saveTTSConfig({
      edgeVoice: profile.edgeVoice,
      kokoroVoice: profile.kokoroVoice,
    });
  }
  if (window.setTTSBasePitch) window.setTTSBasePitch(profile.basePitchHz);
  if (window.updateVoiceBadge) window.updateVoiceBadge();
  refreshSettingsVoiceControls();
}

function refreshSettingsVoiceControls() {
  const cfg = window.getTTSConfig ? window.getTTSConfig() : {};
  const edgeSel = document.getElementById('settings-edge-voice');
  const kokoroSel = document.getElementById('settings-kokoro-voice');
  if (edgeSel) populateSettingsSelect(edgeSel, EDGE_VOICES, cfg.edgeVoice || EDGE_VOICES[0]);
  if (kokoroSel) populateSettingsSelect(kokoroSel, KOKORO_VOICES, cfg.kokoroVoice || KOKORO_VOICES[0]);
}

function populateSettingsSelect(sel, options, current) {
  if (!sel) return;
  sel.innerHTML = options
    .map((v) => `<option value="${v}"${v === current ? ' selected' : ''}>${v}</option>`)
    .join('');
}

function renderSettingsRoomGrid() {
  const grid = document.getElementById('settings-room-grid');
  if (!grid) return;
  const roomName = (id) => (UNLOCK_ROOMS[id] ? UNLOCK_ROOMS[id].name : id[0].toUpperCase() + id.slice(1));
  const rooms = [
    { id: 'default', name: 'Default' },
    ...getAvailableRooms().map((id) => ({ id, name: roomName(id) })),
  ];
  grid.innerHTML = rooms
    .map(
      (r) =>
        `<button type="button" class="settings-grid-item" data-room="${r.id}">
          <span>${r.name}</span>
        </button>`
    )
    .join('');
  grid.querySelectorAll('.settings-grid-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.room === (currentRoom || 'default'));
    btn.addEventListener('click', () => {
      setRoomByName(btn.dataset.room);
      grid.querySelectorAll('.settings-grid-item').forEach((b) =>
        b.classList.toggle('active', b.dataset.room === (currentRoom || 'default'))
      );
    });
  });
}

// Loads a model, swaps it into the stage, and applies its profile (persona
// id, name, TTS voice + base pitch). Shared by the settings grid and the
// top-right character switcher. Returns true on success.
async function switchToModel(url) {
  const profile = getProfileForModel(url);
  try {
    localStorage.setItem('selectedModelUrl', url);
    setDialogue('...A new me? Give me a second to shift into this form.');
    const newModel = await loadModel(url);
    if (waifuModel) {
      app.stage.removeChild(waifuModel);
      try { waifuModel.destroy(); } catch (e) { /* ignore */ }
    }
    waifuModel = newModel;
    modelFitted = false;
    wireLive2DModel(waifuModel);
    if (fitModel(waifuModel)) modelFitted = true;
    syncRoomModelFit();
    applyModelProfile(profile);
    setDialogue(profile ? profile.switchLine : "...Hmph. A different me now? Don't get used to it.");
    return true;
  } catch (err) {
    console.warn('[waifu] model switch failed', err);
    localStorage.removeItem('selectedModelUrl');
    setDialogue("...Hmph. That form won't load. Keep me as I am.");
    return false;
  }
}

function renderSettingsModelGrid() {
  const grid = document.getElementById('settings-model-grid');
  if (!grid) return;
  const selected = localStorage.getItem('selectedModelUrl') || (currentProfile && currentProfile.modelUrl) || MODEL_PROFILES[0].modelUrl;
  grid.innerHTML = MODEL_PROFILES.map(
    (m) =>
      `<button type="button" class="settings-grid-item" data-model="${m.modelUrl}">
        ${m.thumb ? `<img class="grid-thumb" src="${m.thumb}" alt="">` : '<span class="grid-thumb"></span>'}
        <span class="grid-name">${m.name}</span>
        <em class="grid-persona">${m.tagline}</em>
      </button>`
  ).join('');
  grid.querySelectorAll('.settings-grid-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.model === selected);
    btn.addEventListener('click', async () => {
      const url = btn.dataset.model;
      if (!url) return;
      const ok = await switchToModel(url);
      grid.querySelectorAll('.settings-grid-item').forEach((b) =>
        b.classList.toggle('active', b.dataset.model === url && ok)
      );
    });
  });
}

// Settings > Memory: lists what the companion currently remembers (from the
// /api/memory endpoint) with a button to clear it all.
async function renderSettingsMemory() {
  const list = document.getElementById('settings-memory-list');
  const empty = document.getElementById('settings-memory-empty');
  if (!list) return;
  list.innerHTML = '';
  let memory = [];
  try {
    const res = await fetch('/api/memory');
    if (res.ok) {
      const data = await res.json();
      memory = data.memory || [];
    }
  } catch (err) {
    memory = [];
  }

  if (memory.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  memory.forEach((fact) => {
    const li = document.createElement('div');
    li.className = 'memory-fact';
    li.innerHTML = `<span class="memory-label">${fact.label}</span><span class="memory-value"></span>`;
    li.querySelector('.memory-value').textContent = fact.value;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'memory-remove';
    del.title = 'Forget this';
    del.textContent = '×';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      del.disabled = true;
      await fetch(`/api/memory/${encodeURIComponent(fact.label)}`, { method: 'DELETE' });
      renderSettingsMemory();
    });
    li.appendChild(del);
    list.appendChild(li);
  });
}

// Top-right character switcher (always visible, mirrors the room switcher
// pattern). Selecting a character loads its model + profile just like the
// settings grid does.
function setupModelSwitcher() {
  const trigger = document.getElementById('model-trigger');
  const menu = document.getElementById('model-menu');
  const label = document.getElementById('model-current');
  const thumb = document.getElementById('model-current-thumb');
  if (!trigger || !menu) return;

  const render = () => {
    const selected = localStorage.getItem('selectedModelUrl') || (currentProfile && currentProfile.modelUrl) || MODEL_PROFILES[0].modelUrl;
    menu.innerHTML = MODEL_PROFILES.map((m) => {
      const style = m.thumb ? ` style="--thumb: url('${m.thumb}')"` : '';
      return `<button type="button" class="model-option" data-model="${m.modelUrl}"${style}>
        <span class="model-thumb"></span>
        <span><span class="model-opt-name">${m.name}</span><span class="model-opt-tag">${m.tagline}</span></span>
      </button>`;
    }).join('');
    menu.querySelectorAll('.model-option').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.model === selected);
      btn.addEventListener('click', async () => {
        const url = btn.dataset.model;
        if (!url || url === selected) { toggle(false); return; }
        setBusy(true);
        toggle(false);
        await switchToModel(url);
        syncLabel();
        setBusy(false);
      });
    });
  };

  const syncLabel = () => {
    const selected = localStorage.getItem('selectedModelUrl') || '';
    const profile = getProfileForModel(selected) || MODEL_PROFILES[0];
    if (label) label.textContent = profile.name;
    if (thumb) {
      if (profile.thumb) thumb.style.setProperty('--thumb', `url('${profile.thumb}')`);
      else thumb.style.removeProperty('--thumb');
    }
  };

  const toggle = (open) => {
    menu.hidden = !open;
    trigger.classList.toggle('open', open);
  };

  let busy = false;
  const setBusy = (b) => {
    busy = b;
    trigger.disabled = b;
    trigger.classList.toggle('loading', b);
    label.textContent = b ? 'Loading…' : (currentProfile ? currentProfile.name : MODEL_PROFILES[0].name);
    menu.querySelectorAll('.model-option').forEach((o) => o.toggleAttribute('disabled', b));
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (busy) return;
    render();
    toggle(menu.hidden);
  });

  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { if (!busy) toggle(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !busy) toggle(false);
  });

  syncLabel();
}

// Wires the gift shop modal: open/close via the ✕ button, backdrop click, and
// Escape, plus delegated buy clicks on the rendered gift cards.
function setupGiftShop() {
  const modal = document.getElementById('gift-shop-modal');
  if (!modal) return;
  const closeBtn = document.getElementById('gift-shop-close');
  const backdrop = document.getElementById('gift-shop-backdrop');
  const grid = document.getElementById('gift-shop-grid');

  if (closeBtn) closeBtn.addEventListener('click', closeGiftShop);
  if (backdrop) backdrop.addEventListener('click', closeGiftShop);
  if (grid) {
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-gift]');
      if (btn && !btn.disabled) buyGift(btn.dataset.gift);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.hidden) closeGiftShop();
  });
}

function setupSettingsPanel() {
  const modal = document.getElementById('settings-modal');
  const gear = document.getElementById('settings-gear');
  const closeBtn = document.getElementById('settings-close');
  if (!modal || !gear) return;

  const cfg = window.getTTSConfig ? window.getTTSConfig() : {};

  const edgeSel = document.getElementById('settings-edge-voice');
  const kokoroSel = document.getElementById('settings-kokoro-voice');
  const speedInput = document.getElementById('settings-speed');
  const pitchInput = document.getElementById('settings-pitch');
  const muteInput = document.getElementById('settings-mute');
  const speedVal = document.getElementById('settings-speed-val');
  const pitchVal = document.getElementById('settings-pitch-val');

  populateSettingsSelect(edgeSel, EDGE_VOICES, cfg.edgeVoice || EDGE_VOICES[0]);
  populateSettingsSelect(kokoroSel, KOKORO_VOICES, cfg.kokoroVoice || KOKORO_VOICES[0]);
  if (speedInput) {
    speedInput.value = cfg.speed || 1.0;
    speedVal.textContent = (cfg.speed || 1.0).toFixed(2) + 'x';
  }
  if (pitchInput) {
    pitchInput.value = cfg.pitchHz || 0;
    pitchVal.textContent = (cfg.pitchHz || 0) >= 0 ? `+${cfg.pitchHz || 0}Hz` : `${cfg.pitchHz || 0}Hz`;
  }
  if (muteInput) muteInput.checked = !!cfg.muted;

  const toggle = (open) => {
    modal.classList.toggle('is-visible', open);
    if (open) {
      renderSettingsRoomGrid();
      renderSettingsModelGrid();
      renderSettingsMemory();
    }
  };

  gear.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(!modal.classList.contains('is-visible'));
  });
  if (closeBtn) closeBtn.addEventListener('click', () => toggle(false));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) toggle(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-visible')) toggle(false);
  });

  if (edgeSel) {
    edgeSel.addEventListener('change', () => {
      if (window.saveTTSConfig) {
        window.saveTTSConfig({ edgeVoice: edgeSel.value });
        window.isEdgeReady = false;
        updateVoiceBadge();
      }
    });
  }
  if (kokoroSel) {
    kokoroSel.addEventListener('change', () => {
      if (window.saveTTSConfig) window.saveTTSConfig({ kokoroVoice: kokoroSel.value });
    });
  }
  if (speedInput) {
    speedInput.addEventListener('input', () => {
      const v = Number(speedInput.value);
      speedVal.textContent = v.toFixed(2) + 'x';
      if (window.saveTTSConfig) window.saveTTSConfig({ speed: v });
    });
  }
  if (pitchInput) {
    pitchInput.addEventListener('input', () => {
      const v = Number(pitchInput.value);
      pitchVal.textContent = v >= 0 ? `+${v}Hz` : `${v}Hz`;
      if (window.saveTTSConfig) window.saveTTSConfig({ pitchHz: v });
    });
  }
  if (muteInput) {
    muteInput.addEventListener('change', () => {
      if (window.saveTTSConfig) {
        window.saveTTSConfig({ muted: muteInput.checked });
        if (window.stopAudioBuffer) window.stopAudioBuffer();
      }
    });
  }
}

// ---- Conversation backlog (hidden log, VN-style) ----
// The chat feed is not on screen; a 📜 button opens a modal with the full
// transcript. chatHistory[] for the LLM is separate and unaffected.
function setupBacklog() {
  const modal = document.getElementById('backlog-modal');
  const toggle = document.getElementById('backlog-toggle');
  const closeBtn = document.getElementById('backlog-close');
  if (!modal || !toggle) return;

  toggle.addEventListener('click', () => modal.classList.toggle('is-visible'));
  if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.remove('is-visible'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('is-visible');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modal.classList.remove('is-visible');
  });
}

function spawnFloatingText(text, isPositive, variant) {
  const popup = document.createElement('div');
  const cls = variant || (isPositive ? 'positive' : 'negative');
  popup.className = `floating-delta ${cls}`;
  popup.textContent = text;
  // Random x-jitter around the HUD for an arcade-game feel.
  popup.style.left = `calc(50% + ${Math.random() * 40 - 20}px)`;
  popupContainer.appendChild(popup);
  setTimeout(() => popup.remove(), 1200);
}

// ---- Arcade combo multiplier ----
let comboCount = 0;
let comboTimer = null;

function registerInteractionCombo() {
  comboCount++;
  window.clearTimeout(comboTimer);
  showComboUI(comboCount);
  comboTimer = window.setTimeout(() => {
    comboCount = 0;
    hideComboUI();
  }, 1500);
}

function showComboUI(count) {
  let comboElem = document.getElementById('combo-display');
  if (!comboElem) {
    comboElem = document.createElement('div');
    comboElem.id = 'combo-display';
    document.body.appendChild(comboElem);
  }
  comboElem.textContent = `${count}x COMBO! 🔥`;
  comboElem.style.fontSize = `${Math.min(2.8, 1.6 + count * 0.2)}rem`;
  comboElem.className = 'combo-active';
}

function hideComboUI() {
  const comboElem = document.getElementById('combo-display');
  if (comboElem) comboElem.classList.remove('combo-active');
}

// Voice-overlap lock: disable the action buttons while TTS audio is active so
// rapid clicks can't stack overlapping voice streams or broken animations.
let dockButtonsCache = null;
function setActionButtonsLock(disabled) {
  if (!dockButtonsCache) dockButtonsCache = Array.from(document.querySelectorAll('.rpg-action-dock .dock-btn'));
  dockButtonsCache.forEach((btn) => {
    btn.disabled = disabled;
    btn.classList.toggle('btn-disabled', disabled);
  });
}

// Keeps the button lock in sync with the speech flag (driven from the ticker).
function syncActionButtonsLock() {
  setActionButtonsLock(!!window.__isSpeaking);
}

// Executes a slash command programmatically (used by the RPG action dock).
// Returns false (and warns) when Yuki is mid-sentence to block click-spamming.
function executeCommand(cmd) {
  if (window.__isSpeaking) {
    appendSystemMessage("⚠️ <i>She's mid-sentence. Wait your turn, dummy!</i>");
    return false;
  }
  const handled = handleChatCommand(String(cmd || '').trim());
  if (!handled) {
    appendSystemMessage(
      `❌ Unknown command <code>${escapeHtml(cmd || '')}</code>. Type <code>/help</code> for a list of available commands.`
    );
  }
  return true;
}

// ---- Speedrun mode ----
let timerInterval = null;
let startTime = null;
let turnCount = 0;
let isGameActive = false;
let gameCompleted = false;
let lastTierLevel = 0;

const gameTimerEl = document.getElementById('game-timer');
const victoryModal = document.getElementById('victory-modal');
const victoryTimeEl = document.getElementById('victory-time');
const victoryTurnsEl = document.getElementById('victory-turns');
const victoryCloseBtn = document.getElementById('victory-close');

function startSpeedrunTimer() {
  if (isGameActive || gameCompleted) return;
  isGameActive = true;
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const mins = Math.floor(elapsed / 60000).toString().padStart(2, '0');
    const secs = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
    const ms = Math.floor((elapsed % 1000) / 100).toString();
    gameTimerEl.textContent = `${mins}:${secs}.${ms}`;
  }, 100);
}

function stopSpeedrunTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function resetSpeedrunTimer() {
  stopSpeedrunTimer();
  isGameActive = false;
  gameCompleted = false;
  turnCount = 0;
  gameTimerEl.textContent = '00:00.0';
}

function checkVictory(currentScore) {
  if (currentScore >= 100 && !gameCompleted) {
    stopSpeedrunTimer();
    isGameActive = false;
    gameCompleted = true;
    triggerVictoryModal(gameTimerEl.textContent, turnCount);
  }
}

function triggerVictoryModal(totalTime, turns) {
  victoryTimeEl.textContent = totalTime;
  victoryTurnsEl.textContent = String(turns);
  victoryModal.classList.add('visible');
  triggerHeartExplosion(40);
}

victoryCloseBtn.addEventListener('click', () => {
  victoryModal.classList.remove('visible');
});

function tierLevelFor(score) {
  if (score >= 75) return 3;
  if (score >= 50) return 2;
  if (score >= 25) return 1;
  return 0;
}

// ---- Affection tier unlockables ----
// Crossing a tier fires a one-time unlock (persisted in localStorage) so
// progression survives reloads. Level 2 also unlocks the Sunset Rooftop room.
const TIER_UNLOCK_LINES = {
  yuki: {
    1: "Hmph. Don't read into this... I'm just in a decent mood, that's all.",
    2: "W-Whoa... my heart is beating so fast, you idiot!",
    3: "...I think I actually trust you now. Don't waste that.",
  },
  mark: {
    1: "Ayy, we're really vibin' now, my friend!",
    2: "Yo, this friendship's getting legendary!",
    3: "Man... you're genuinely one of the best people I know.",
  },
};

// ---- Name calling ----
// If the companion remembers the user's name (from the backend memory store),
// boot greetings and tier lines can address them by name. `{name}` placeholders
// in dialogue strings are replaced by this helper.
let userName = '';
function withName(line) {
  if (!line) return line;
  return line.replaceAll('{name}', userName || 'you');
}

// Pull the user's remembered name out of the backend memory store. Non-fatal
// on failure — the companion just greets anonymously.
async function loadUserName() {
  try {
    const res = await fetch('/api/memory', { headers: { 'ngrok-skip-browser-warning': '1' } });
    if (!res.ok) return;
    const data = await res.json();
    const facts = data.memory || [];
    const fact = facts.find((f) => f.label === "the user's name");
    if (fact && typeof fact.value === 'string' && fact.value.trim()) {
      userName = fact.value.trim();
    }
  } catch (err) {
    userName = '';
  }
}

// Personalised boot greeting: uses the remembered name when we have one.
function getBootGreeting() {
  const id = currentProfile && currentProfile.id;
  if (userName) {
    if (id === 'mark') return `Yo, {name}! Good to see you, my friend!`;
    return `...Oh. {name}. You're back. Don't just stand there, idiot.`;
  }
  if (id === 'mark') return `Yo! Good to see you, my friend!`;
  return "...Oh. You're here. Don't just stand there, idiot.";
}

const TIER_UNLOCK_CARDS = {
  2: {
    title: 'Unlocked: Sunset Rooftop',
    text: 'A warm, orange-lit corner of the rooftop just for the two of you. Find it in the room switcher.',
  },
  3: {
    title: 'A Quiet Confession',
    text: 'She looks at you a little differently now. You can feel it.',
  },
};

function handleTierUnlock(level) {
  const tiers = getUnlockedTiers();
  const isNew = !tiers.includes(level);
  unlockTier(level);
  if (!isNew) return;

  const lines = TIER_UNLOCK_LINES[currentProfile && currentProfile.id] || TIER_UNLOCK_LINES.yuki;
  if (lines[level]) setDialogue(withName(lines[level]));

  const card = TIER_UNLOCK_CARDS[level];
  if (card) showUnlockCard(card.title, card.text);

  // A newly unlocked room should appear in the dropdown + settings grid now.
  if (window.__refreshRoomOptions) window.__refreshRoomOptions();
  renderSettingsRoomGrid();
}

function showUnlockCard(title, text) {
  const old = document.getElementById('unlock-card');
  if (old) old.remove();

  const card = document.createElement('div');
  card.id = 'unlock-card';
  card.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
  document.body.appendChild(card);
  requestAnimationFrame(() => card.classList.add('visible'));

  window.setTimeout(() => {
    card.classList.remove('visible');
    window.setTimeout(() => card.remove(), 500);
  }, 6000);
}

function playSoundEffect(type) {
  let ctx = null;
  if (window.getTTSAudioContext) ctx = window.getTTSAudioContext();
  if (!ctx) return;

  // Build + play inside the resume callback so the very first sounds (before
  // the context is unlocked) actually fire instead of being skipped.
  const start = () => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'heart_up') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === 'heart_down') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(110, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  };

  if (ctx.state === 'suspended') {
    ctx.resume().then(start).catch(start);
  } else {
    start();
  }
}

function triggerHeartExplosion(count = 25) {
  const container = new PIXI.Container();
  app.stage.addChild(container);

  const heartGraphics = new PIXI.Graphics();
  heartGraphics.beginFill(0xFF4757);
  heartGraphics.drawCircle(-5, -5, 5);
  heartGraphics.drawCircle(5, -5, 5);
  heartGraphics.beginFill(0xFF4757);
  heartGraphics.moveTo(-10, -2);
  heartGraphics.lineTo(0, 10);
  heartGraphics.lineTo(10, -2);
  heartGraphics.endFill();

  const texture = app.renderer.generateTexture(heartGraphics);
  heartGraphics.destroy();

  const particles = [];
  const originX = app.screen.width / 2;
  const originY = Math.min(app.screen.height / 2, 400);
  for (let i = 0; i < count; i++) {
    const sprite = new PIXI.Sprite(texture);
    sprite.x = originX;
    sprite.y = originY;
    sprite.anchor.set(0.5);

    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 8;
    particles.push({
      sprite,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      alpha: 1,
    });
    container.addChild(sprite);
  }

  const ticker = (delta) => {
    let alive = false;
    particles.forEach((p) => {
      p.sprite.x += p.vx * delta;
      p.sprite.y += p.vy * delta;
      p.vy += 0.08 * delta;
      p.sprite.alpha -= 0.02 * delta;
      p.sprite.rotation += 0.1 * delta;
      if (p.sprite.alpha > 0) alive = true;
    });
    if (!alive) {
      app.ticker.remove(ticker);
      container.destroy({ children: true });
    }
  };
  app.ticker.add(ticker);
}

let waifuModel = null;
let lipSyncTimer = null;
let modelFitted = false;
let currentMouth = 0;
let lipEnvLevel = 0; // smoothed RMS envelope for lip-sync
let lipTimeData = null; // reusable Float32Array for analyser time-domain data
let currentEmotion = 'neutral';
let knownParams = null;
let emotionResetTimer = null;
let lastSpeechFlag = false;

// Cap the internal render resolution at 1.5x. Rendering a fullscreen Live2D
// canvas at the full devicePixelRatio (2x/3x on Retina/high-DPI screens) is the
// single biggest GPU fill-rate cost. autoDensity keeps the CSS size identical,
// so the only loss is a tiny bit of on-model sharpness on 2x+ displays.
// Antialias is off: 4x MSAA across a fullscreen WebGL canvas is the next-biggest
// fill-rate cost, and the Live2D art is texture-drawn (vector-smooth) so MSAA
// barely improves it. powerPreference asks the browser for the discrete GPU.
const app = new PIXI.Application({
  view: canvas,
  antialias: false,
  autoDensity: true,
  resolution: Math.min(window.devicePixelRatio || 1, 1.5),
  powerPreference: 'high-performance',
  backgroundAlpha: 0,
});

function resizeStage() {
  const rect = stagePanel.getBoundingClientRect();
  app.renderer.resize(Math.max(1, rect.width), Math.max(1, rect.height));
}

function setStatus(state) {
  statusBadge.classList.toggle('online', state === 'online');
  statusBadge.classList.toggle('offline', state === 'offline');
  statusBadge.textContent = state;
}

let dialogueTypeTimer = null;

function setDialogue(text) {
  dialogueSpeaker.textContent = currentProfile ? currentProfile.name : WAIFU_NAME;
  if (dialogueTypeTimer) {
    window.clearInterval(dialogueTypeTimer);
    dialogueTypeTimer = null;
  }
  dialogueText.textContent = '';
  let i = 0;
  dialogueTypeTimer = window.setInterval(() => {
    if (i < text.length) {
      dialogueText.textContent += text.charAt(i);
      i++;
    } else {
      window.clearInterval(dialogueTypeTimer);
      dialogueTypeTimer = null;
    }
  }, 12);
}

// Toggle the speaking/typing visual states on the dialogue box. The equalizer
// pill reacts to the same __isSpeaking flag that drives lip-sync.
function setDialogueSpeaking(active) {
  if (!dialogueBox) return;
  dialogueBox.classList.toggle('speaking', !!active);
  if (active) dialogueBox.classList.remove('typing');
}

function setDialogueTyping(active) {
  if (!dialogueBox) return;
  dialogueBox.classList.toggle('typing', !!active);
  if (active) dialogueBox.classList.remove('speaking');
}

function appendBubble(role, text) {
  const row = document.createElement('div');
  row.className = `bubble ${role}`;
  const content = document.createElement('div');
  content.className = 'bubble-content';
  content.textContent = text;
  row.appendChild(content);
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setMouth(value) {
  if (!waifuModel || !waifuModel.internalModel) return;
  const core = waifuModel.internalModel.coreModel;
  if (!core) return;
  if (typeof core.setParameterValueById === 'function') {
    core.setParameterValueById('ParamMouthOpenY', value);
  } else if (typeof core.setParamFloat === 'function') {
    core.setParamFloat('ParamMouthOpenY', value);
  }
}

window.__setMouth = setMouth;

function buildKnownParams() {
  knownParams = {};
  if (!waifuModel || !waifuModel.internalModel) return;
  const core = waifuModel.internalModel.coreModel;
  if (!core) return;
  try {
    const ids = core.getParameterIds ? core.getParameterIds() : [];
    for (let i = 0; i < ids.length; i++) {
      const pid = ids[i];
      knownParams[pid && pid.id !== undefined ? pid.id : pid] = i;
    }
  } catch (e) {
    console.warn('[waifu] could not build param map', e);
  }
}

// Reads/writes a single Cubism core parameter through the known-params index
// map. Both are no-ops when the parameter isn't present on the model.
function applyParam(core, id, value) {
  const idx = knownParams[id];
  if (idx === undefined) return;
  if (typeof core.setParameterValueByIndex === 'function') {
    core.setParameterValueByIndex(idx, value);
  } else if (typeof core.setParameterValueById === 'function') {
    core.setParameterValueById(id, value);
  }
}

function readParam(core, id) {
  const idx = knownParams[id];
  if (idx === undefined) return 0;
  if (typeof core.getParameterValueByIndex === 'function') {
    return core.getParameterValueByIndex(idx);
  }
  return 0;
}

// Short-lived expression blend: instead of snapping the face to a preset, we
// capture the current param values and glide to the target over ~220ms in the
// ticker. After the blend finishes the motion system animates the model freely.
let emotionBlend = null;
const EMOTION_BLEND_MS = 220;

function startEmotionBlend(key) {
  if (!waifuModel || !waifuModel.internalModel) return;
  const core = waifuModel.internalModel.coreModel;
  if (!core) return;
  if (!knownParams) buildKnownParams();
  if (!knownParams || !Object.keys(knownParams).length) return;

  const preset = EMOTION_PARAMS[key] || EMOTION_PARAMS.neutral;
  const from = {};
  for (const id in preset) {
    if (knownParams[id] !== undefined) from[id] = readParam(core, id);
  }
  emotionBlend = { from, to: preset, t: 0, duration: EMOTION_BLEND_MS };
}

function applyEmotionPreset(emotion) {
  if (!knownParams) buildKnownParams();
  startEmotionBlend(emotion);
}

// Called every frame right before the core model renders. Applies the in-flight
// expression blend (smooth transition), then the settled preset every frame so
// motions/breath can't overwrite her expression. ParamMouthOpenY is never
// touched — lip-sync owns the mouth.
function updateEmotionBeforeRender() {
  if (!waifuModel || !waifuModel.internalModel) return;
  const core = waifuModel.internalModel.coreModel;
  if (!core) return;
  if (!knownParams || !Object.keys(knownParams).length) return;

  if (emotionBlend) {
    emotionBlend.t += app.ticker.deltaMS / emotionBlend.duration;
    if (emotionBlend.t >= 1) {
      const last = emotionBlend;
      emotionBlend = null;
      for (const id in last.to) applyParam(core, id, last.to[id]);
    } else {
      const ease = 1 - Math.pow(1 - emotionBlend.t, 3);
      for (const id in emotionBlend.to) {
        const from = emotionBlend.from[id] !== undefined ? emotionBlend.from[id] : 0;
        applyParam(core, id, from + (emotionBlend.to[id] - from) * ease);
      }
    }
    return;
  }

  const preset = EMOTION_PARAMS[currentEmotion] || EMOTION_PARAMS.neutral;
  for (const id in preset) applyParam(core, id, preset[id]);
}

function setWaifuEmotion(emotion) {
  const key = EMOTIONS.indexOf(emotion) >= 0 ? emotion : 'neutral';
  currentEmotion = key;
  applyEmotionPreset(key);
  console.log(`[waifu] emotion -> ${key}`);
}

// Emotion keyword -> bundled .exp3.json expression name. Only the Mark
// fallback models ship expression files; Hiyori has none, so the parameter
// preset path below is the one that actually runs in practice.
const EXPRESSION_FILE_MAP = {
  neutral: 'f00',
  happy: 'f04',
  blush: 'f01',
  annoyed: 'f02',
  surprised: 'f03',
  dizzy: 'f03',
};

// Sets Yuki's facial expression. Prefers .exp3.json expression files when the
// loaded model exposes an expression manager, and falls back to the tuned
// parameter presets (setWaifuEmotion) — the path used by Hiyori.
function setYukiExpression(emotion) {
  // The backend maps angry->annoyed in parse_reply, but normalize here too so
  // an unvalidated 'angry' from any source lands on the annoyed preset.
  const key = EMOTIONS.indexOf(emotion) >= 0 ? emotion : (emotion === 'angry' ? 'annoyed' : 'neutral');
  if (!waifuModel) return;

  // Option A: preset expression files via pixi-live2d-display's manager.
  const exprName = EXPRESSION_FILE_MAP[key];
  if (exprName) {
    const mgr =
      (waifuModel.internalModel &&
        waifuModel.internalModel.motionManager &&
        waifuModel.internalModel.motionManager.expressionManager) ||
      (waifuModel.internalModel && waifuModel.internalModel.expressionManager);
    if (mgr && typeof mgr.setExpression === 'function') {
      try {
        mgr.setExpression(exprName);
        currentEmotion = key;
        return;
      } catch (e) {
        // Expression file missing/mismatched -> fall through to presets.
      }
    }
  }

  // Option B: direct parameter presets (Hiyori's actual path).
  setWaifuEmotion(key);
}

function startLipSync() {
  stopLipSync();
  lipSyncTimer = window.setInterval(() => {
    setMouth(Math.random() * LIP_SYNC_MAX_OPEN);
  }, LIP_SYNC_INTERVAL_MS);
}

function stopLipSync() {
  if (lipSyncTimer !== null) {
    window.clearInterval(lipSyncTimer);
    lipSyncTimer = null;
  }
  setMouth(0);
}

function pickVoice(synth) {
  const voices = synth.getVoices();
  if (!voices.length) return null;
  // Score every voice for "feminine" and pick the best instead of grabbing the
  // first regex match (which can land on a male/robotic system voice).
  const score = (v) => {
    const n = `${v.name} ${v.lang}`;
    let s = 0;
    if (/female|woman|girl|zira|aria|jenny|samantha|joanna|salli|karen|nancy|amy|libby|olivia|susan/i.test(n)) s += 4;
    if (/google|natural|online|neural|premium/i.test(n)) s += 2;
    if (v.lang.startsWith('en')) s += 1;
    return s;
  };
  return voices.reduce((best, v) => (score(v) > score(best) ? v : best), voices[0]);
}

function speakResponse(text, emotion, audioBuffer, opts = {}) {
  if (emotionResetTimer !== null) {
    window.clearTimeout(emotionResetTimer);
    emotionResetTimer = null;
  }

  // Emotion-reactive voice tuning: `getVoicePreset` lives in tts.js. Edge's
  // SSML already bakes in the preset's tempo + pitch; here we only mirror them
  // onto the browser-TTS fallback so every engine keeps the same cadence.
  const preset = window.getVoicePreset ? window.getVoicePreset(emotion) : null;

  // Update the dialogue and switch the expression the moment her voice starts.
  // opts.skipDialogue is set when the reply text is already on screen (chat
  // path) so she doesn't blank + re-type the same line when the audio lands.
  if (!opts.skipDialogue) setDialogue(text);
  setYukiExpression(emotion);

  // Real mute (settings panel): suppress ALL engines, including the browser
  // speechSynthesis fallback — otherwise a muted TTS still "speaks" via the
  // system voice whenever Edge/Kokoro return null.
  const ttsCfg = window.getTTSConfig ? window.getTTSConfig() : null;
  if (ttsCfg && ttsCfg.muted) {
    emotionResetTimer = window.setTimeout(() => setYukiExpression('neutral'), 3000);
    return;
  }

  // Audio-buffer path: playback drives the analyser lip-sync. Pitch/tempo are
  // already baked into the generated audio (Edge SSML) — nothing to add here.
  if (audioBuffer && window.playAudioBuffer) {
    window.playAudioBuffer(audioBuffer, {
      onEnd: () => {
        // Smoothly close her mouth (the ticker lerps it shut), then relax to neutral.
        emotionResetTimer = window.setTimeout(() => setYukiExpression('neutral'), 3000);
      },
    });
    return;
  }

  // Fallback: browser speechSynthesis + random lip flap. Kill any still-playing
  // Kokoro source first so the two voices never layer on top of each other.
  const synth = window.speechSynthesis;
  if (!synth) return;
  if (window.stopAudioBuffer) window.stopAudioBuffer();
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(synth);
  if (voice) utterance.voice = voice;
  utterance.lang = 'en-US';
  // Mirror the emotion preset onto the fallback voice (its pitch is 0..2).
  utterance.rate = preset ? preset.speed * 0.98 : 0.98;
  utterance.pitch = preset ? Math.min(2, preset.pitch * 1.15) : 1.4;
  utterance.volume = 1;
  utterance.onstart = () => {
    window.__isSpeaking = true;
    startLipSync();
  };
  utterance.onend = () => {
    window.__isSpeaking = false;
    stopLipSync();
    emotionResetTimer = window.setTimeout(() => setYukiExpression('neutral'), 3000);
  };
  utterance.onerror = () => {
    window.__isSpeaking = false;
    stopLipSync();
  };
  synth.speak(utterance);
}

function playMotion(group, index, priority) {
  if (!waifuModel || !waifuModel.internalModel) return;
  const mm = waifuModel.internalModel.motionManager;
  if (!mm || !mm.definitions || !mm.definitions.get) return;
  const defs = mm.definitions.get(group);
  if (!defs || !defs.length) return;
  const no = typeof index === 'number' ? index : Math.floor(Math.random() * defs.length);
  mm.startMotion(group, no, priority);
}

function fitModel(model) {
  const internal = model.internalModel || {};
  // Use the RAW canvas size in model units (internal.width/height). pixi's
  // model.width/height getters are multiplied by the current scale, so re-fitting
  // an already-scaled model would blow the scale back up to ~1.0 (a 7000px-tall
  // canvas then shows only its bottom sliver — "just shoes").
  const modelWidth = internal.width || model.width || 0;
  const modelHeight = internal.height || model.height || 0;
  const screenWidth = app.renderer.width;
  const screenHeight = app.renderer.height;

  if (!modelWidth || !modelHeight) {
    // Canvas dims not ready yet (freshly loaded model). Leave the scale alone
    // and return false so the ticker retries next frame instead of slamming the
    // model to an arbitrary 0.28 (which would break the fit).
    return false;
  }

  const scale = Math.min(screenWidth / modelWidth, screenHeight / modelHeight) * MODEL_FIT;
  model.scale.set(scale);

  model.anchor.set(0.5, 1.0);

  // Center horizontally, align feet to bottom of canvas (10px padding)
  model.x = app.renderer.width / 2;
  model.y = app.renderer.height - 10;
  window.__modelBaseScale = model.scale.x;

  console.log(
    `[waifu] rendererType=${app.renderer.type} renderer=${app.renderer.width}x${app.renderer.height} | model=${modelWidth}x${modelHeight} | scale=${model.scale.x} | pos=${Math.round(model.x)},${Math.round(model.y)}`
  );
  const gl = app.renderer.gl;
  if (gl) {
    const glv = gl.getParameter(gl.VERSION);
    console.log(`[waifu] GL version: ${glv} (${glv.indexOf('2.0') >= 0 ? 'WEBGL2' : 'WEBGL1'})`);
  }
  return true;
}

async function loadModel(overrideUrl) {
  // Safe extraction of Live2DModel from global PIXI or window scope
  const Live2DModel = window.PIXI?.live2d?.Live2DModel || window.PIXI_LIVE2D?.Live2DModel;

  if (!Live2DModel) {
    throw new Error("Live2D plugin is not properly initialized. Check script tags in index.html.");
  }

  const urls = overrideUrl ? [overrideUrl] : MODEL_URLS;
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { /* ignore */ }
      const fr = parsed && parsed.FileReferences;
      console.log(
        `[waifu] fetch "${url}" -> ${res.status} | bytes=${text.length} | isJSON=${!!parsed} | FileReferences=${!!fr} | Moc=${fr && fr.Moc} | textures=${fr && fr.Textures && fr.Textures.length}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const model = await Live2DModel.from(url);
      return model;
    } catch (err) {
      lastError = err;
      console.warn(`[waifu] model "${url}" failed: ${err.message}`);
    }
  }
  throw lastError || new Error('No model URL could be loaded.');
}

// ---- Chat slash commands ----
const CHAT_COMMANDS = [
  { cmd: '/feed', desc: 'Roll the snack gacha 🍱' },
  { cmd: '/delete', desc: 'Threaten to delete her files 💣' },
  { cmd: '/headpat', desc: 'Give her a headpat 🫳' },
  { cmd: '/mute', desc: 'Attempt to mute her voice 🔇' },
  { cmd: '/apologize', desc: 'Beg for forgiveness (RNG!) 🙏' },
  { cmd: '/dance', desc: 'Force her to dance 🎶' },
  { cmd: '/stats', desc: 'Check her hidden vitals (incl. hunger) 📊' },
  { cmd: '/room', desc: 'Switch the backdrop (bedroom/classroom/library/rooftop) 🏠' },
  { cmd: '/lightmode', desc: 'Blast her with the light theme (war crime) 💡' },
  { cmd: '/remember', desc: 'Show what she remembers about you 🧠' },
  { cmd: '/forget', desc: 'Wipe her memory of you 🧠' },
  { cmd: '/clear', desc: 'Wipe the chat (memory wipe!) 🧹' },
  { cmd: '/help', desc: 'Show this menu 📖' },
];

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Strips reasoning-model thinking blocks so internal monologue never reaches
// the speech bubble or the TTS pipeline. Splits on the closing tag instead of
// regex-matching across the block, so a truncated `<think>` (model ran out of
// tokens mid-thought, no closing tag) is handled too. The `<think>` variants
// also cover `<thinking>` since they share the prefix.
function stripThinkingBlocks(text) {
  const raw = String(text || '');
  const afterClose = raw.split(/<\/think(?:ing)?>/i);
  if (afterClose.length > 1) {
    return afterClose[afterClose.length - 1].trim();
  }
  const beforeOpen = raw.split(/<think(?:ing)?>/i);
  if (beforeOpen.length > 1) {
    return beforeOpen[0].trim();
  }
  if (/^\s*thinking/.test(raw)) return '';
  return raw.trim();
}

// Strips the deterministic [EMOTION: tag] prefix the LLM emits, maps "angry"
// onto the frontend's "annoyed" parameter preset, and returns clean TTS text.
function parseLLMResponse(rawText) {
  const stripped = stripThinkingBlocks(rawText);
  const emotionRegex = /\[EMOTION:\s*(neutral|happy|blush|angry|surprised)\]\s*/i;
  const match = stripped.match(emotionRegex);

  let emotion = 'neutral';
  let cleanDialogue = stripped;

  if (match) {
    emotion = match[1].toLowerCase();
    if (emotion === 'angry') emotion = 'annoyed';
    cleanDialogue = stripped.replace(emotionRegex, '').trim();
  }

  // Strip any leftover bracketed tags (e.g. [blushes], [sighs]) so the TTS
  // engine never reads stage directions out loud.
  cleanDialogue = cleanDialogue.replace(/\[[^\]]*\]/g, '').trim();

  // Affection-change lines from the model (any spacing/case) never belong in
  // dialogue either.
  cleanDialogue = cleanDialogue.replace(/affection\s*[-_ ]?\s*change\s*:?\s*[+-]?\d+/gi, '').trim();

  return { emotion, cleanDialogue };
}

// Physical screen shake used by /clear's memory-wipe panic.
function triggerScreenShake(intensity = 12, duration = 600) {
  const start = performance.now();
  const shakeTicker = () => {
    const elapsed = performance.now() - start;
    if (elapsed > duration) {
      app.ticker.remove(shakeTicker);
      if (app.view) app.view.style.transform = '';
      return;
    }
    const fade = 1 - elapsed / duration;
    const ox = (Math.random() * 2 - 1) * intensity * fade;
    const oy = (Math.random() * 2 - 1) * intensity * fade;
    if (app.view) app.view.style.transform = `translate(${ox}px, ${oy}px)`;
  };
  app.ticker.add(shakeTicker);
}

// Appends a styled system/help message into the chat feed. Consecutive
// identical alerts collapse into a single line with a ×N counter chip.
function appendSystemMessage(htmlContent) {
  const lastMsg = chatLog.lastElementChild;
  if (lastMsg && lastMsg.classList.contains('system-msg') && lastMsg.dataset.raw === htmlContent) {
    const currentCount = parseInt(lastMsg.dataset.count || '1', 10) + 1;
    lastMsg.dataset.count = String(currentCount);
    let countBadge = lastMsg.querySelector('.msg-count');
    if (!countBadge) {
      countBadge = document.createElement('span');
      countBadge.className = 'msg-count';
      lastMsg.appendChild(countBadge);
    }
    countBadge.textContent = ` ×${currentCount}`;
    chatLog.scrollTop = chatLog.scrollHeight;
    return;
  }

  const bubble = document.createElement('div');
  bubble.className = 'chat-message system-msg';
  bubble.dataset.raw = htmlContent;
  bubble.dataset.count = '1';
  bubble.innerHTML = htmlContent;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function displayHelpMenu() {
  const helpHTML = `
    <div class="help-card">
      <div class="help-header">
        <span>📖 GAMEPLAY MANUAL &amp; TIPS</span>
      </div>
      <div class="help-body">
        <div class="help-section">
          <strong>💖 Affection System</strong>
          <p>Actions like <code>/feed</code>, <code>/headpat</code>, and compliments boost her affection. Insults, neglect, or threatening <code>/delete</code> lower it — and her Live2D expressions and dialogue tone shift with her mood.</p>
        </div>

        <div class="help-section">
          <strong>🍗 Hidden Hunger</strong>
          <p>Her hunger drains silently over time. Let it hit zero and she gets hangry, docks hearts, and roasts you. Restore it with <code>/feed</code> or the snack button.</p>
        </div>

        <div class="help-section">
          <strong>⌨️ Keyboard Shortcuts</strong>
          <ul>
            <li><code>/</code> : Open the command list</li>
            <li><code>Enter</code> : Send message</li>
            <li><code>↑ / ↓</code> : Navigate the command list</li>
            <li><code>Esc</code> : Close menus</li>
          </ul>
        </div>

        <div class="help-section">
          <strong>💡 Pro Tips</strong>
          <ul>
            <li><code>/room</code> switches environments: <code>bedroom</code>, <code>classroom</code>, <code>library</code>, <code>rooftop</code> (or the 🏠 button).</li>
            <li><code>/stats</code> reveals her hidden vitals, session time, and heart progress.</li>
            <li><code>/shop</code> (or the 🎁 dock button) spends your gacha money on gifts — each one earns a big heart boost.</li>
            <li>📜 in the corner opens the conversation log to re-read past lines.</li>
            <li>Shake your mouse violently... she gets dizzy. Opening DevTools is also a trap.</li>
          </ul>
        </div>
      </div>
    </div>
  `;
  appendSystemMessage(helpHTML);
  // In VN mode there's no visible feed — pop the log open so the guide shows.
  openBacklogModal();
}

// Pops the conversation log (backlog) open so a menu-style card rendered into
// the chat feed is actually visible (the feed is hidden in VN mode).
function openBacklogModal() {
  const modal = document.getElementById('backlog-modal');
  if (modal) modal.classList.add('is-visible');
}

function attemptHeadpat() {
  if (window.__isSpeaking) {
    appendSystemMessage('🫳 <em>She\'s mid-sentence. Wait your turn, dummy.</em>');
    return;
  }
  const reaction = HEADPAT_REACTIONS[Math.floor(Math.random() * HEADPAT_REACTIONS.length)];
  playMotion('TapBody', 0, 3);
  setDialogue(reaction.text);
  registerInteractionCombo();
  if (window.generateTTSAudioBuffer) {
    window
      .generateTTSAudioBuffer(reaction.text, reaction.emotion)
      .then((buffer) => speakResponse(reaction.text, reaction.emotion, buffer))
      .catch(() => speakResponse(reaction.text, reaction.emotion, null));
  } else {
    speakResponse(reaction.text, reaction.emotion, null);
  }
}

// /apologize — 50/50 forgiveness gambling. She might accept your apology and
// grant +15, or double down on being mad and dock another -5.
function attemptApologize() {
  if (window.__isSpeaking) {
    appendSystemMessage('🙏 <em>She\'s mid-sentence. Say it when she\'s listening!</em>');
    return;
  }

  const forgiven = Math.random() > 0.5;
  const lines = [
    "F-Fine... I guess I can forgive you this once. Don't do it again!",
    "Hmph! Apology accepted, but only because you asked nicely.",
    "I-I'll let it slide this time. Just... don't make me regret it, okay?",
  ];
  const text = forgiven
    ? lines[Math.floor(Math.random() * lines.length)]
    : "A simple apology isn't going to fix this, idiot!";

  const delta = forgiven ? 15 : -5;
  const emotion = forgiven ? 'blush' : 'annoyed';

  // Keep the backend score in sync so the HUD and stored affection agree.
  fetch(`${BACKEND_URL}/adjust`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data && typeof data.total_affection === 'number') {
        updateHeartHUD(data.total_affection, data.affection_change, data.combo_active);
      }
    })
    .catch((err) => console.warn('[waifu] apologize adjust failed', err));

  playMotion('TapBody', 0, 3);
  setDialogue(text);
  if (window.generateTTSAudioBuffer) {
    window
      .generateTTSAudioBuffer(text, emotion)
      .then((buffer) => speakResponse(text, emotion, buffer))
      .catch(() => speakResponse(text, emotion, null));
  } else {
    speakResponse(text, emotion, null);
  }
}

// Spawns floating musical notes around the stage (used by /dance).
function spawnMusicNotes() {
  const notes = ['🎵', '🎶', '♪', '♫'];
  const container = document.body;
  const baseTop = Math.max(90, window.innerHeight * 0.28);

  for (let i = 0; i < 6; i++) {
    const note = document.createElement('div');
    note.className = 'music-note';
    note.textContent = notes[Math.floor(Math.random() * notes.length)];

    const driftX = (i - 2.5) * 48 + (Math.random() * 40 - 20);
    note.style.left = `calc(50% + ${driftX}px)`;
    note.style.top = `${baseTop}px`;
    note.style.animationDelay = `${i * 0.12}s`;
    note.style.fontSize = `${16 + Math.random() * 14}px`;

    container.appendChild(note);
    window.setTimeout(() => note.remove(), 3000);
  }
}

// /dance — forces her to wiggle back and forth for 2 seconds while musical
// notes erupt around her, then she docks 5 hearts for the humiliation.
function attemptDance() {
  if (!waifuModel) {
    appendSystemMessage('🎶 <em>She\'s not on stage right now!</em>');
    return;
  }
  if (window.__isSpeaking) {
    appendSystemMessage('🎶 <em>She\'s mid-sentence. Let her finish talking first!</em>');
    return;
  }

  appendSystemMessage('🎶 Yuki is forced to dance! 🎶');
  spawnMusicNotes();

  let danceStep = 0;
  const danceInterval = window.setInterval(() => {
    if (!waifuModel) {
      window.clearInterval(danceInterval);
      return;
    }
    danceStep += 0.5;
    waifuModel.rotation = Math.sin(danceStep) * 0.2;
  }, 40);

  window.setTimeout(() => {
    window.clearInterval(danceInterval);
    if (waifuModel) waifuModel.rotation = 0;

    const text = "STOP MAKING ME DANCE! THIS IS EMBARRASSING!";
    const delta = -5;
    const emotion = 'blush';

    // Keep the backend score in sync.
    fetch(`${BACKEND_URL}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.total_affection === 'number') {
          updateHeartHUD(data.total_affection, data.affection_change, data.combo_active);
        }
      })
      .catch((err) => console.warn('[waifu] dance adjust failed', err));

    setDialogue(text);
    if (window.generateTTSAudioBuffer) {
      window
        .generateTTSAudioBuffer(text, emotion)
        .then((buffer) => speakResponse(text, emotion, buffer))
        .catch(() => speakResponse(text, emotion, null));
    } else {
      speakResponse(text, emotion, null);
    }
  }, 2000);
}

function handleChatCommand(raw) {
  const command = raw.trim().toLowerCase();
  if (command === '/help') {
    displayHelpMenu();
    return true;
  }
  if (command === '/feed') {
    rollSnackGacha();
    appendSystemMessage('🍱 Rolling the snack gacha...');
    return true;
  }
  if (command === '/delete') {
    threatenDelete();
    appendSystemMessage('💣 Threatening to delete her files...');
    return true;
  }
  if (command === '/headpat') {
    attemptHeadpat();
    appendSystemMessage('🫳 Headpat delivered!');
    return true;
  }
  if (command === '/mute') {
    toggleMuteTrap();
    appendSystemMessage('🔇 Toggling the mute trap...');
    return true;
  }
  if (command === '/apologize') {
    attemptApologize();
    appendSystemMessage('🙏 Begging for forgiveness...');
    return true;
  }
  if (command === '/dance') {
    attemptDance();
    return true;
  }
  if (command === '/shop') {
    openGiftShop();
    return true;
  }
  if (command === '/stats') {
    showStats();
    return true;
  }
  if (command === '/room' || command.startsWith('/room ')) {
    const choice = raw.trim().split(/\s+/)[1]?.toLowerCase();
    if (choice === 'default') {
      setRoomByName('default');
      appendSystemMessage('🏠 Returned to the default mood lighting.');
      return true;
    }
    if (choice && ROOM_PRESETS[choice]) {
      setRoomByName(choice);
      appendSystemMessage(`🏠 Switched environment to <strong>${escapeHtml(choice)}</strong>.`);
      return true;
    }
    appendSystemMessage('⚠️ Available rooms: <code>/room bedroom</code>, <code>/room classroom</code>, <code>/room library</code>, <code>/room rooftop</code>, <code>/room default</code>');
    return true;
  }
  if (command === '/lightmode') {
    triggerLightModeFlashbang(true);
    appendSystemMessage('💡 Flipping on every light in the room...');
    return true;
  }
  if (command === '/remember') {
    showMemorySummary();
    return true;
  }
  if (command === '/forget') {
    forgetAllMemory();
    return true;
  }
  if (command === '/clear') {
    handleClearCommand();
    return true;
  }
  return false;
}

// /remember — lists the facts the companion has stored about you (from the
// backend's persisted memory), shown as a system message in the chat feed.
async function showMemorySummary() {
  try {
    const res = await fetch('/api/memory');
    const data = res.ok ? await res.json() : { memory: [] };
    const facts = data.memory || [];
    if (facts.length === 0) {
      appendSystemMessage("🧠 She doesn't remember anything about you yet. Tell her your name, birthday, or what you like.");
      openBacklogModal();
      return;
    }
    const list = facts.map((f) => `<li><strong>${escapeHtml(f.label)}</strong>: ${escapeHtml(f.value)}</li>`).join('');
    appendSystemMessage(`🧠 Here's what she remembers about you:<ul class="memory-summary-list">${list}</ul>`);
    openBacklogModal();
  } catch (err) {
    appendSystemMessage('🧠 Could not reach the memory system (backend offline?).');
    openBacklogModal();
  }
}

// /forget — wipes everything the companion remembers.
async function forgetAllMemory() {
  try {
    const res = await fetch('/api/memory', { method: 'DELETE' });
    if (res.ok) {
      appendSystemMessage("🧠 Forgotten. She looks at you with a blank slate... but she'll warm up again.");
    } else {
      appendSystemMessage('🧠 Could not clear memory right now.');
    }
  } catch (err) {
    appendSystemMessage('🧠 Could not reach the memory system (backend offline?).');
  }
}

// /stats — a stylized JRPG character-profile card revealing her hidden vitals.
function statsMoodClass(mood) {
  if (mood.label === 'STARVING' || mood.label === 'HUNGRY') return 'mood-angry';
  if (mood.label === 'DEVOTED' || mood.label === 'WARMING UP') return 'mood-happy';
  return 'mood-neutral';
}

function showStats() {
  const mood = getMoodState();
  const score = window.currentAffection ?? 20;
  const affPct = Math.max(0, Math.min(100, score));
  const sessionMinutes = startTime ? Math.floor((Date.now() - startTime) / 60000) : 0;

  const statsHtml = `
    <div class="stats-card">
      <div class="stats-header">
        <span class="stats-title">📊 CHARACTER STATUS</span>
        <span class="stats-badge ${statsMoodClass(mood)}">${mood.emoji} ${mood.label}</span>
      </div>

      <div class="stats-body">
        <div class="stat-row">
          <span>Affection</span>
          <span class="stat-val">${score} / 100</span>
        </div>
        <div class="stat-bar-bg">
          <div class="stat-bar-fill affection-fill" style="width: ${affPct}%"></div>
        </div>

        <div class="stat-row">
          <span>Hunger</span>
          <span class="stat-val">${user_hunger}%</span>
        </div>
        <div class="stat-bar-bg">
          <div class="stat-bar-fill hunger-fill" style="width: ${user_hunger}%"></div>
        </div>

        <div class="stat-grid">
          <div class="stat-box">
            <span class="stat-lbl">Time Spent</span>
            <span class="stat-num">${sessionMinutes}m</span>
          </div>
          <div class="stat-box">
            <span class="stat-lbl">Wallet</span>
            <span class="stat-num">$${gachaMoney}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  appendSystemMessage(statsHtml);
  // Same as /help: pop the log open so the stats card is visible as a menu.
  openBacklogModal();
}

// /clear — wipes the chat, but Yuki panics about "memory loss".
async function handleClearCommand() {
  chatLog.innerHTML = '';
  resetSpeedrunTimer();

  const text = "W-WAIT! Where did all our past conversations go?! Did you just wipe my memory?! Who even are you?!";
  setDialogue(text);

  // Full reset: hearts back to 20, backend history + combo cleared, economy
  // restarted. Matches the old reset-button behavior via the shared resetGame().
  if (resetGame) {
    await resetGame();
  }

  triggerScreenShake(14, 700);

  let audioBuffer = null;
  if (window.generateTTSAudioBuffer && window.ttsReady) {
    try {
      audioBuffer = await window.generateTTSAudioBuffer(text, 'annoyed');
    } catch (e) {
      console.warn('[waifu] kokoro failed for clear panic', e);
    }
  }
  speakResponse(text, 'annoyed', audioBuffer);
}

// Writes a line to the dialogue box immediately (no typewriter), used by the
// streaming chat path where the backend already delivers text token-by-token.
function setDialogueInstant(text) {
  dialogueSpeaker.textContent = currentProfile ? currentProfile.name : WAIFU_NAME;
  if (dialogueTypeTimer) {
    window.clearInterval(dialogueTypeTimer);
    dialogueTypeTimer = null;
  }
  dialogueText.textContent = text;
}

// Reads a /chat/stream SSE response: streams tokens into the dialogue box as
// they arrive, then returns the final payload once the `done` event lands.
async function readChatStream(response, message) {
  if (!response.body) throw new Error('streaming body unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let visible = '';
  let finalData = null;

  const handleEvent = (raw) => {
    const line = raw.trim();
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    let data;
    try {
      data = JSON.parse(payload);
    } catch (e) {
      return;
    }
    if (typeof data.token === 'string') {
      // Buffer tokens silently — never render them live. The cleaned final
      // reply (post-parse, from the backend) is displayed only once the stream
      // finishes, so raw reasoning / partial model output can't reach the UI.
      visible += data.token;
    } else if (data.done) {
      // Final state event precedes the done marker when the stream succeeds.
    } else if (data && typeof data.response === 'string') {
      finalData = data;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      handleEvent(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleEvent(buffer);

  if (!finalData) {
    // Stream ended without a final event (or fell back server-side).
    finalData = { response: visible, emotion: 'neutral', affection_change: 0 };
  }
  return finalData;
}

async function sendMessage(raw) {
  const message = raw.trim();
  if (!message) return;

  appendBubble('user', message);
  chatField.value = '';
  chatField.disabled = true;
  sendBtn.disabled = true;

  // Slash commands run locally and never hit the backend.
  if (message.startsWith('/')) {
    const handled = handleChatCommand(message);
    if (!handled) {
      appendSystemMessage(
        `❌ Unknown command <code>${escapeHtml(message)}</code>. Type <code>/help</code> for a list of available commands.`
      );
    }
    chatField.disabled = false;
    sendBtn.disabled = false;
    chatField.focus();
    return;
  }

  setDialogue('...Hmph. Fine, let me think about that.');

  startSpeedrunTimer();
  turnCount += 1;

  let data = null;
  const persona = currentProfile ? currentProfile.personality : 'tsundere';
  try {
    // Prefer the streaming SSE endpoint — tokens appear as she "speaks".
    const res = await fetch(`${BACKEND_URL}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, persona }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await readChatStream(res, message);
  } catch (err) {
    console.warn('[waifu] chat stream failed, falling back to /chat', err);
    try {
      const res = await fetch(`${BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, persona }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err2) {
      console.error('[waifu] chat request failed', err2);
      setStatus('offline');
      const fallback = "...Hmph. I can't hear you right now. Fix your end, dummy.";
      appendBubble('waifu', fallback);
      setDialogue(fallback);
      chatField.disabled = false;
      sendBtn.disabled = false;
      chatField.focus();
      return;
    }
  }

  const reply = (data && data.response) || '...I have nothing to say right now.';

  // The backend already strips the [EMOTION: tag] and returns `emotion`, but
  // re-run the parser as a safety net in case a tag ever leaks through.
  const parsed = parseLLMResponse(reply);
  const emotion = parsed.emotion !== 'neutral' ? parsed.emotion : (data && data.emotion) || 'neutral';
  let cleanReply = parsed.cleanDialogue;
  if (!cleanReply) {
    cleanReply = "What? Stop staring at me like an idiot!";
  }
  if (data && typeof data.total_affection === 'number') {
    updateHeartHUD(data.total_affection, data.affection_change, data.combo_active);
  }
  setStatus('online');
  appendBubble('waifu', cleanReply);

  // Show the reply immediately — don't make her "respond" wait for TTS. The
  // voice renders in the background and starts when it's ready.
  setDialogueInstant(cleanReply);

  // Free the input right away so the user can keep chatting while the audio
  // renders; playAudioBuffer cancels any previous source, so overlap is safe.
  chatField.disabled = false;
  sendBtn.disabled = false;

  let audioBuffer = null;
  if (window.generateTTSAudioBuffer && window.ttsReady) {
    try {
      audioBuffer = await window.generateTTSAudioBuffer(cleanReply, emotion);
    } catch (e) {
      console.warn('[waifu] kokoro generation failed, using browser TTS', e);
    }
  }
  speakResponse(cleanReply, emotion, audioBuffer, { skipDialogue: true });
  chatField.focus();
}

async function pingBackend() {
  try {
    const res = await fetch(`${BACKEND_URL}/`);
    setStatus(res.ok ? 'online' : 'offline');
  } catch (err) {
    console.warn('[waifu] backend unreachable', err);
    setStatus('offline');
  }
}

// Syncs the HUD with the backend's persisted affection on load so a page
// refresh doesn't flash the default 20 while the server still holds e.g. 60.
async function syncBackendState() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/state`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && typeof data.total_affection === 'number') {
      updateHeartHUD(data.total_affection, 0, data.combo_active);
      return true;
    }
  } catch (err) {
    console.warn('[waifu] state sync failed', err);
  }
  return false;
}

// ---- Light Mode "Flashbang" Reaction ----
// Fires when the OS/browser flips to light mode while she's on screen:
// the ENTIRE UI snaps to the blinding light theme, white screen flash, model
// dimmed, and a blinded scream. A few seconds later everything snaps back to
// dark and she stops panicking. Also fires on load for users already in light.
let lightFlashActive = false;
let lightFlashCooldown = 0;

function triggerLightModeFlashbang(bypassCooldown = false) {
  const now = Date.now();
  // bypassCooldown (manual /lightmode) skips the cooldown, but never double-runs
  // an active gag.
  if (lightFlashActive || (!bypassCooldown && now < lightFlashCooldown)) return;
  lightFlashActive = true;
  lightFlashCooldown = now + 8000;

  const line = LIGHT_MODE_REACTIONS[Math.floor(Math.random() * LIGHT_MODE_REACTIONS.length)];
  setDialogue(line);

  // White flashbang overlay covering the whole viewport, fading out ~1s.
  const flash = document.createElement('div');
  flash.className = 'light-flashbang';
  document.body.appendChild(flash);
  window.requestAnimationFrame(() => {
    flash.classList.add('active');
    setTimeout(() => {
      flash.classList.remove('active');
      setTimeout(() => flash.remove(), 1000);
    }, 250);
  });

  // The whole app snaps to the blinding light theme for the gag window, plus a
  // sustained sun-glare overlay so it stays eye-searing for the whole scream.
  document.body.classList.add('light-mode');
  const sun = document.createElement('div');
  sun.className = 'light-sun';
  document.body.appendChild(sun);
  if (waifuModel) waifuModel.alpha = 0.2;

  // Guaranteed cleanup: after the gag window the UI snaps back to dark and
  // her opacity is restored — even if TTS never unlocked. Clicks after the
  // initial beat dismiss it early (that's how the user "turns off the lights").
  const gagWindow = 10000;
  const cleanup = () => {
    document.body.classList.remove('light-mode');
    sun.remove();
    if (waifuModel) waifuModel.alpha = 1;
    lightFlashActive = false;
    window.removeEventListener('click', onGagClick);
  };
  const dismiss = () => {
    if (!lightFlashActive) return;
    cleanup();
    const relief = LIGHT_MODE_RELIEF[Math.floor(Math.random() * LIGHT_MODE_RELIEF.length)];
    setDialogue(relief);
    if (window.generateTTSAudioBuffer && window.ttsReady) {
      window
        .generateTTSAudioBuffer(relief, 'neutral')
        .then((audio) => speakResponse(relief, 'neutral', audio))
        .catch(() => speakResponse(relief, 'neutral', null));
    } else {
      speakResponse(relief, 'neutral', null);
    }
  };
  const startAt = Date.now();
  const onGagClick = () => {
    // Let the scream beat play (and TTS unlock) before clicks are dismissive.
    if (Date.now() - startAt < 1200) return;
    dismiss();
  };
  window.addEventListener('click', onGagClick);
  window.setTimeout(() => {
    if (lightFlashActive) cleanup();
  }, gagWindow);

  const speak = () => {
    if (window.generateTTSAudioBuffer && window.ttsReady) {
      window
        .generateTTSAudioBuffer(line, 'annoyed')
        .then((audio) => speakResponse(line, 'annoyed', audio))
        .catch(() => speakResponse(line, 'annoyed', null));
    } else {
      speakResponse(line, 'annoyed', null);
    }
  };

  // TTS needs an unlocked AudioContext; wait for a gesture if needed. A hard
  // fallback fires anyway so she's never left stuck dimmed on a light page.
  const ctx = window.getTTSAudioContext ? window.getTTSAudioContext() : null;
  let force = null;
  const unlock = () => {
    if (force) window.clearTimeout(force);
    window.removeEventListener('click', unlock);
    window.removeEventListener('keydown', unlock);
    speak();
  };
  if (ctx && ctx.state === 'suspended') {
    force = window.setTimeout(unlock, 1200);
    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
  } else {
    speak();
  }
}

function setupLightModeDetection() {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = (e) => {
    if (e.matches) triggerLightModeFlashbang();
  };
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', onChange);
  } else if (mediaQuery.addListener) {
    mediaQuery.addListener(onChange);
  }
  // Already in light mode at load? The gag should hit her anyway.
  if (mediaQuery.matches) {
    window.setTimeout(triggerLightModeFlashbang, 2500);
  }
}

// ---- DevTools / F12 inspector trap ----
// Opening DevTools shrinks the viewport, so a resize that shrinks the usable
// area beyond a threshold reveals the inspector. She accuses you of peeking
// under her code and docks 10 hearts.
function setupDevToolsTrap() {
  window.addEventListener('resize', () => {
    const threshold = 160;
    const isDevToolsOpen =
      window.outerWidth - window.innerWidth > threshold ||
      window.outerHeight - window.innerHeight > threshold;

    if (isDevToolsOpen && !window.devtoolsFlag) {
      window.devtoolsFlag = true;

      const line = "C-CAUGHT YOU! Were you snooping where you shouldn't be?! Mind your own business, dummy!";
      setDialogue(line);

      // -10 affection via the backend (keeps HUD + stored score in sync).
      fetch(`${BACKEND_URL}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta: -10 }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data && typeof data.total_affection === 'number') {
            updateHeartHUD(data.total_affection, data.affection_change);
          }
        })
        .catch((err) => console.warn('[waifu] devtools adjust failed', err));

      let audioBuffer = null;
      if (window.generateTTSAudioBuffer && window.ttsReady) {
        window
          .generateTTSAudioBuffer(line, 'annoyed')
          .then((buffer) => speakResponse(line, 'annoyed', buffer))
          .catch(() => speakResponse(line, 'annoyed', null));
      } else {
        speakResponse(line, 'annoyed', null);
      }
    }
  });
}

// Creates a lightweight, zero-external-asset Sakura Petal overlay
function initSakuraParticles(app, petalCount = 35) {
  // 1. Programmatically draw a petal texture (no PNG files needed!)
  const graphics = new PIXI.Graphics();
  graphics.beginFill(0xFFB7C5, 0.85); // Gentle soft pink with opacity
  graphics.moveTo(0, 0);
  graphics.quadraticCurveTo(6, -10, 10, 0);
  graphics.quadraticCurveTo(6, 10, 0, 0);
  graphics.endFill();

  // Generate a reusable Pixi texture from the graphics object
  const petalTexture = app.renderer.generateTexture(graphics);
  graphics.destroy(); // Free up graphics memory

  // 2. Create a container on top of the stage
  const particleContainer = new PIXI.Container();
  app.stage.addChild(particleContainer);

  const particles = [];

  // 3. Spawn initial set of petals
  for (let i = 0; i < petalCount; i++) {
    const sprite = new PIXI.Sprite(petalTexture);
    sprite.anchor.set(0.5);

    // Give each petal unique physics & scale for depth
    const scale = 0.3 + Math.random() * 0.5; // Random size
    sprite.scale.set(scale);

    const particle = {
      sprite: sprite,
      x: Math.random() * app.screen.width,
      y: Math.random() * app.screen.height - app.screen.height, // Start above view
      speedY: 0.8 + Math.random() * 1.5,                      // Vertical fall speed
      speedX: -0.3 + Math.random() * 0.8,                     // Horizontal breeze drift
      rotationSpeed: (Math.random() - 0.5) * 0.02,            // Tumbling rotation
      swingSpeed: 0.015 + Math.random() * 0.02,               // Sway frequency
      swingStep: Math.random() * Math.PI * 2,                 // Sway offset
      swingDistance: 0.8 + Math.random() * 1.2                // Sway width
    };

    sprite.x = particle.x;
    sprite.y = particle.y;
    sprite.rotation = Math.random() * Math.PI * 2;

    particleContainer.addChild(sprite);
    particles.push(particle);
  }

  // 4. Animate in PixiJS Ticker
  app.ticker.add((delta) => {
    particles.forEach((p) => {
      // Calculate realistic fluttering downward movement
      p.y += p.speedY * delta;
      p.swingStep += p.swingSpeed * delta;
      p.x += (p.speedX + Math.sin(p.swingStep) * p.swingDistance) * delta;
      p.sprite.rotation += p.rotationSpeed * delta;

      // Update actual Pixi sprite positions
      p.sprite.x = p.x;
      p.sprite.y = p.y;

      // Wrap around screen edges when petals drift off canvas
      if (p.y > app.screen.height + 20) {
        p.y = -20;
        p.x = Math.random() * app.screen.width;
      }
      if (p.x > app.screen.width + 20) {
        p.x = -20;
      } else if (p.x < -20) {
        p.x = app.screen.width + 20;
      }
    });
  });
}

// Floating command auto-complete popup: shows clickable command pills
// above the composer whenever the input starts with "/". Supports
// ↑/↓/Enter/Tab keyboard navigation.
function setupCommandAutocomplete() {
  const autoBox = document.getElementById('cmd-autocomplete');
  if (!autoBox || !chatField) return;

  let activeIndex = 0;
  let activeMatches = [];

  const closeAuto = () => {
    autoBox.hidden = true;
    autoBox.innerHTML = '';
    activeMatches = [];
    activeIndex = 0;
  };

  const selectPill = (c) => {
    chatField.value = c.cmd + ' ';
    chatField.focus();
    closeAuto();
  };

  const applyActive = () => {
    const rows = autoBox.querySelectorAll('.cmd-row');
    rows.forEach((row, i) => {
      row.classList.toggle('active', i === activeIndex);
      if (i === activeIndex) {
        try { row.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
      }
    });
  };

  const renderPills = (filter) => {
    const matches = CHAT_COMMANDS.filter((c) => c.cmd.startsWith(filter.toLowerCase()));
    activeMatches = matches;
    activeIndex = 0;
    autoBox.innerHTML = '';
    matches.forEach((c, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'cmd-row';
      row.innerHTML = `<span class="cmd-tag">${escapeHtml(c.cmd)}</span><span class="cmd-text">${escapeHtml(c.desc)}</span>`;
      row.addEventListener('mousemove', () => {
        activeIndex = i;
        applyActive();
      });
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        selectPill(c);
      });
      autoBox.appendChild(row);
    });
    if (matches.length === 0) {
      closeAuto();
      return;
    }
    autoBox.hidden = false;
    applyActive();
  };

  chatField.addEventListener('input', () => {
    const value = chatField.value;
    if (value.startsWith('/') && value.indexOf(' ') === -1) {
      renderPills(value);
    } else {
      closeAuto();
    }
  });

  chatField.addEventListener('keydown', (event) => {
    if (autoBox.hidden) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % activeMatches.length;
      applyActive();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + activeMatches.length) % activeMatches.length;
      applyActive();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      if (activeMatches[activeIndex]) selectPill(activeMatches[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeAuto();
    }
  });

  chatField.addEventListener('blur', () => {
    setTimeout(closeAuto, 150);
  });
}

// Wires a freshly-loaded Live2D model into the app: adds it to the stage,
// disables auto-motions, binds the emotion preset + root-translation zeroing,
// speeds up gaze interpolation, and attaches the headpat/tap hit-testing.
// Shared by init() and the settings model picker so swapped models behave the
// same as the boot model.
function wireLive2DModel(model) {
  model.autoUpdate = false;
  app.stage.addChild(model);

  const mm = model.internalModel && model.internalModel.motionManager;
  // Keep the library from auto-driving motions. Hiyori's Idle motions are very
  // energetic, so we don't loop them; she rests on blink/breath/physics + a
  // gentle bob, and only animates (TapBody) when tapped.
  if (mm && 'autoInteract' in mm) mm.autoInteract = false;

  // Apply the emotion preset right before the core model renders (after motions,
  // breath, pose, etc. have been evaluated) so the expression can't be overwritten.
  // Also zero root-translation params so no motion can float her off the floor.
  model.internalModel.on('beforeModelUpdate', () => {
    updateEmotionBeforeRender();
    const core = model.internalModel.coreModel;
    if (core && knownParams) {
      for (const id of ['ParamX', 'ParamY', 'ParamZ']) {
        if (knownParams[id] !== undefined && typeof core.setParameterValueById === 'function') {
          core.setParameterValueById(id, 0);
        }
      }
    }
  });

  // Speed up the built-in gaze interpolation (default is only 4*dt/1000 per frame).
  const fc = model.internalModel.focusController;
  if (fc && fc.targetX !== undefined) {
    fc.update = function (dt) {
      const k = Math.min(1, (FOCUS_SPEED * dt) / 1000);
      this.x += (this.targetX - this.x) * k;
      this.y += (this.targetY - this.y) * k;
    };
  }

  // --- Interactive hit-testing: headpats & body taps ---
  // Hiyori only registers a "Body" hit area, so we detect the tap zone by
  // its position along the model's height (0 = top of head, 1 = feet).
  model.interactive = true;
  model.cursor = 'pointer';
  model.on('pointerdown', (e) => {
    if (window.__isSpeaking) return;
    const now = Date.now();
    if (now - lastTapTime < TAP_COOLDOWN_MS) return;
    lastTapTime = now;

    const local = e.data.getLocalPosition(model);
    const h = model.internalModel.height || 1;
    const ay = model.anchor ? model.anchor.y : 1;
    const top = -ay * h;
    const bottom = (1 - ay) * h;
    const zone = (local.y - top) / (bottom - top);
    const isHeadpat = zone < 0.35;

    const isMark = currentProfile && currentProfile.id === 'mark';
    const headpatPool = isMark ? MARK_HEADPAT_REACTIONS : HEADPAT_REACTIONS;
    const bodyPool = isMark ? MARK_BODY_REACTIONS : BODY_REACTIONS;
    const pool = isHeadpat ? headpatPool : bodyPool;
    const reaction = pool[Math.floor(Math.random() * pool.length)];
    console.log(`[waifu] tap zone=${zone.toFixed(2)} ${isHeadpat ? 'headpat' : 'body'} -> ${reaction.text}`);

    // Animate her reaction: startled TapBody motion. Position stays locked to
    // the floor via the ticker, so the motion can't make her float.
    playMotion('TapBody', 0, 3);

    // Headpats earn a small affection bonus (+1) so the interaction feels
    // rewarding. Body taps stay neutral.
    if (isHeadpat) {
      setYukiExpression('happy');
      fetch(`${BACKEND_URL}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta: 1 }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data && typeof data.total_affection === 'number') {
            updateHeartHUD(data.total_affection, data.affection_change);
            spawnFloatingText('+1 \u2665', true);
          }
        })
        .catch((err) => console.warn('[waifu] headpat affection failed', err));
    } else {
      setYukiExpression(reaction.emotion === 'blush' ? 'blush' : 'surprised');
    }

    setDialogue(reaction.text);
    window.generateTTSAudioBuffer(reaction.text, reaction.emotion)
      .then((buffer) => speakResponse(reaction.text, reaction.emotion, buffer))
      .catch(() => speakResponse(reaction.text, reaction.emotion, null));
  });

  buildKnownParams();
}

async function init() {
  console.log(
    `[waifu] pixi=${PIXI.VERSION} | live2d-display=${(PIXI.live2d && PIXI.live2d.VERSION) || 'unknown'}`
  );

  // Match the backdrop to her starting affection state immediately.
  updateMoodAtmosphere(20);

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (window.getTTSAudioContext) {
      window.getTTSAudioContext().resume().catch(() => {});
    }
    sendMessage(chatField.value);
  });

  setupCommandAutocomplete();

  // RPG action dock: quick slash-command shortcuts on the stage.
  const actionDock = document.getElementById('rpg-action-dock');
  const dockButtons = actionDock ? Array.from(actionDock.querySelectorAll('button')) : [];
  const DOCK_COOLDOWN_MS = 1200;
  const dockOnCooldown = new Set();

  if (dockButtons.length) {
    const fireDock = (btn) => {
      if (!btn || dockOnCooldown.has(btn)) return;
      if (window.getTTSAudioContext) {
        window.getTTSAudioContext().resume().catch(() => {});
      }
      const ok = executeCommand(btn.dataset.cmd);
      if (!ok) return; // Locked: she's mid-sentence, don't feed the combo.
      registerInteractionCombo();
      btn.classList.remove('dock-hit');
      void btn.offsetWidth;
      btn.classList.add('dock-hit');

      // Game-style cooldown: block re-fires briefly and show a draining sweep.
      dockOnCooldown.add(btn);
      btn.classList.add('on-cooldown');
      btn.setAttribute('aria-disabled', 'true');
      window.setTimeout(() => {
        dockOnCooldown.delete(btn);
        btn.classList.remove('on-cooldown');
        btn.removeAttribute('aria-disabled');
      }, DOCK_COOLDOWN_MS);
    };
    dockButtons.forEach((btn) => btn.addEventListener('click', () => fireDock(btn)));

    // Hotkeys 1-4 trigger the dock buttons (only when not typing in the chat).
    window.addEventListener('keydown', (event) => {
      if (document.activeElement === chatField) return;
      const idx = Number(event.key) - 1;
      if (idx >= 0 && idx < dockButtons.length) {
        event.preventDefault();
        fireDock(dockButtons[idx]);
      }
    });
  }

  // Full game reset (used by /clear and any future reset path).
  resetGame = async () => {
    let score = 20;
    try {
      const res = await fetch(`${BACKEND_URL}/reset`, { method: 'POST' });
      const data = await res.json();
      score = Number.isFinite(Number(data.total_affection)) ? Number(data.total_affection) : 20;
    } catch (err) {
      console.warn('[waifu] reset request failed', err);
    }
    updateHeartHUD(score, 0);
    updateHungerHUD(HUNGER_START);
    resetSpeedrunTimer();
    stopDizzyState();
    lastTierLevel = 0;
    localStorage.removeItem(UNLOCK_STORAGE_KEY);
    victoryModal.classList.remove('visible');
    chatLog.innerHTML = '';
    gachaMoney = GACHA_STARTING_MONEY;
    totalHeartsEarned = 0;
    gachaRolling = false;
    deleteThreatCount = 0;
    isMutedByForce = false;
    comboCount = 0;
    window.clearTimeout(comboTimer);
    comboTimer = null;
    hideComboUI();
    updateGachaMoney();
    setDialogue("...Hmph. Fine, we're starting over. Don't mess it up this time.");
  };

  updateGachaMoney();
  updateHungerHUD(HUNGER_START);
  startHungerDecay();

  if (window.preloadKokoroInBackground) {
    window.preloadKokoroInBackground();
  }

  setupLightModeDetection();
  setupRoomSwitcher();
  setupModelSwitcher();
  setupSettingsPanel();
  setupBacklog();
  setupGiftShop();
  setupDevToolsTrap();

  if (!window.PIXI || !PIXI.live2d) {
    setStatus('offline');
    setDialogue("...Hmph. I couldn't materialize properly. Check your connection, dummy.");
    return;
  }

  resizeStage();
  window.addEventListener('resize', resizeStage);

  // Mouse/cursor eye tracking: her head, eyes, and body follow the pointer.
  // `Live2DModel.focus()` maps screen coords to model space, interpolates the gaze,
  // and drives ParamAngleX/Y/Z, ParamEyeBallX/Y, and ParamBodyAngleX internally.
  window.addEventListener('pointermove', (e) => {
    if (waifuModel && waifuModel.focus) waifuModel.focus(e.clientX, e.clientY);
    handlePointerShake(e);
  });

  try {
    // Always start fresh: Yuki + rooftop. Clears any previously persisted
    // model choice so a reload never boots into a different character.
    localStorage.removeItem('selectedModelUrl');
    setRoomByName('rooftop');
    applyModelProfile(MODEL_PROFILES[0]);

    await loadUserName();
    setDialogue(withName(getBootGreeting()));

    waifuModel = await loadModel(MODEL_PROFILES[0].modelUrl);
    wireLive2DModel(waifuModel);
    initSakuraParticles(app, 35);

    const cm = waifuModel.internalModel && waifuModel.internalModel.coreModel;
    console.log(
      `[waifu] drawableCount=${cm && cm.getDrawableCount ? cm.getDrawableCount() : 'N/A'} | stage children=${app.stage.children.length}`
    );

    app.ticker.add(() => {
      if (!waifuModel) return;

      // Hard-lock position: keep her centered and anchored to the bottom edge
      // so motions can never push her off the floor. In a room scene she's
      // scaled down slightly and grounded so her feet match the floor.
      const roomSceneActive = document.body.classList.contains('room-scene');
      waifuModel.x = app.screen.width / 2;
      waifuModel.y = app.screen.height - 10 + (roomSceneActive ? ROOM_MODEL_Y_OFFSET : 0);

      // pixi-live2d-display's Live2DModel.update() expects deltaTime in
      // MILLISECONDS (it just accumulates deltaTime and consumes it in _render,
      // and its internal model divides by 1000 for the Cubism core). Passing
      // deltaMS/16.667 (~1ms) made blink/breath/physics and the mouse gaze-follow
      // run ~17x slower — the "lag". Always pass the raw deltaMS.
      waifuModel.update(app.ticker.deltaMS);
      if (!modelFitted && fitModel(waifuModel)) {
        modelFitted = true;
        syncRoomModelFit();
      }

      if (window.__isAnalyserSpeaking && window.__lipAnalyser) {
        const analyser = window.__lipAnalyser;
        if (!lipTimeData || lipTimeData.length !== analyser.fftSize) {
          lipTimeData = new Float32Array(analyser.fftSize);
        }
        // Time-domain RMS is far more speech-accurate than summing the whole
        // frequency spectrum (which leans on bass rumble and background noise).
        analyser.getFloatTimeDomainData(lipTimeData);
        let sumSq = 0;
        for (let i = 0; i < lipTimeData.length; i++) {
          const s = lipTimeData[i];
          sumSq += s * s;
        }
        const rms = Math.sqrt(sumSq / lipTimeData.length);

        // Vocal envelope: fast attack on voice onset, slower release between
        // syllables so the mouth doesn't flutter, plus a floor so near-silence
        // reads as a closed mouth.
        const rate = rms > lipEnvLevel ? LIP_SYNC_ATTACK : LIP_SYNC_RELEASE;
        lipEnvLevel += (rms - lipEnvLevel) * rate;
        if (lipEnvLevel < LIP_SYNC_FLOOR) lipEnvLevel = 0;

        const target = Math.min(1.0, (lipEnvLevel / 0.15) * LIP_SYNC_SENSITIVITY);
        currentMouth += (target - currentMouth) * LIP_SYNC_LERP;
        setMouth(currentMouth);
      } else if (!window.__isSpeaking && currentMouth > 0) {
        // Glide the mouth shut after speech ends instead of snapping.
        currentMouth += (0 - currentMouth) * LIP_SYNC_LERP;
        lipEnvLevel = 0;
        setMouth(currentMouth);
      }

      // Equalizer pill + typing dots follow the same speech flag as lip-sync.
      // Only write the DOM when the flag actually flips — setting classes and
      // toggling button `disabled` on every single frame forces constant style
      // recalc + layout even when nothing changed.
      const speakingNow = !!window.__isSpeaking;
      if (speakingNow !== lastSpeechFlag) {
        lastSpeechFlag = speakingNow;
        setDialogueSpeaking(speakingNow);
        syncActionButtonsLock();
      }

      if (!window.__frameCount) window.__frameCount = 0;
      window.__frameCount++;
      if (window.__frameCount === 120) {
        console.log(
          `[waifu] 120 frames rendered | textures=${waifuModel.textures.length} valid=${waifuModel.textures.map((t) => t.valid).join(',')}`
        );
      }
    });

    setStatus('online');

    const currentHour = new Date().getHours();
    if (currentHour >= 1 && currentHour <= 5) {
      const lateNightPrompt =
        LATE_NIGHT_INTERROGATIONS[Math.floor(Math.random() * LATE_NIGHT_INTERROGATIONS.length)];
      setDialogue(lateNightPrompt);

      // If Kokoro is still preloading (async), wait briefly for it so the
      // interrogation gets the full voice; otherwise fall back to browser TTS.
      const speakLateNight = () => {
        if (window.generateTTSAudioBuffer) {
          window
            .generateTTSAudioBuffer(lateNightPrompt, 'annoyed')
            .then((audio) => speakResponse(lateNightPrompt, 'annoyed', audio))
            .catch(() => speakResponse(lateNightPrompt, 'annoyed', null));
        } else {
          speakResponse(lateNightPrompt, 'annoyed', null);
        }
      };

      if (window.isKokoroLoading) {
        window.setTimeout(speakLateNight, 4000);
      } else {
        speakLateNight();
      }
    } else {
      setDialogue("...Hmph. I finally woke up. Don't stare at me like that, idiot.");
    }

    updateHeartHUD(20, 0);
  } catch (err) {
    console.error('[waifu] model init failed', err);
    setStatus('offline');
    const detail = err && err.message ? err.message : String(err);
    setDialogue(`...Hmph. I couldn't manifest myself. Something's broken on your end. (${detail})`);
  }

  pingBackend();
  syncBackendState();
}

init();

window.addEventListener('error', (e) => {
  console.error('[waifu][uncaught]', e.message, 'at', e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[waifu][unhandled]', e.reason && e.reason.message ? e.reason.message : e.reason);
});

const glCanvas = document.getElementById('live2d-canvas');
glCanvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  console.error('[waifu] WEBGL CONTEXT LOST');
});
glCanvas.addEventListener('webglcontextrestored', () => {
  console.log('[waifu] WEBGL context restored');
});