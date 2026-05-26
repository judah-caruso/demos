"use strict";

// ============================================================
// Constants
// ============================================================
const CARD_W = 70 * 1.2;
const CARD_H = 98 * 1.2;
const CARD_RADIUS = 6;
const DRAG_THRESHOLD_PX = 5;
// Played (board) cards render scaled to free vertical room on the
// table. The card grows back to full size when hovered or while being
// dragged, so inspecting / picking up a card still feels generous.
// Hit-testing uses the same scale (with hysteresis — hovered cards keep
// their grown footprint until the cursor leaves it) so the visible
// card and the click target stay in sync.
const BOARD_CARD_SCALE = 1.0;
const TOOLTIP_DELAY_MS = 250;

// ============================================================
// Accent palette
// ----------
// Each player is assigned one of four accent colors on page load. The
// pick drives the player's UI accent (buttons, hover halos, focus
// rings, etc.) AND the color of their card backs — so two players in
// the same game can have visually distinct backs. The choice is sent
// to the opponent over the data channel on connection (and on every
// state broadcast as a defensive belt-and-suspenders), so each side
// knows how to render the OTHER side's card backs.
// ============================================================
const ACCENT_PALETTES = {
  red: {
    accent: "#c44545",
    accentRgb: "196, 69, 69",
    accent2: "#a83838",
    accentText: "#f5f5f5",
    cardBack: "#c44545",
    cardBack2: "#d65a5a",
    cardBackBorder: "#8a2828",
    cardBackMark: "rgba(240, 240, 240, 0.92)",
    cardBackPattern: "rgba(255, 255, 255, 0.06)",
  },
  green: {
    accent: "#4caf6e",
    accentRgb: "76, 175, 110",
    accent2: "#3d9258",
    accentText: "#f5f5f5",
    cardBack: "#4caf6e",
    cardBack2: "#62c585",
    cardBackBorder: "#2f7d4c",
    cardBackMark: "rgba(220, 220, 220, 0.92)",
    cardBackPattern: "rgba(255, 255, 255, 0.06)",
  },
  blue: {
    accent: "#4080d0",
    accentRgb: "64, 128, 208",
    accent2: "#2f68b0",
    accentText: "#f5f5f5",
    cardBack: "#4080d0",
    cardBack2: "#5a96e0",
    cardBackBorder: "#285590",
    cardBackMark: "rgba(220, 220, 220, 0.92)",
    cardBackPattern: "rgba(255, 255, 255, 0.06)",
  },
  white: {
    accent: "#d4d4d4",
    accentRgb: "212, 212, 212",
    accent2: "#b0b0b0",
    accentText: "#141414",
    cardBack: "#d4d4d4",
    cardBack2: "#e8e8e8",
    cardBackBorder: "#888888",
    cardBackMark: "rgba(40, 40, 40, 0.85)",
    cardBackPattern: "rgba(0, 0, 0, 0.06)",
  },
  black: {
    // Near-black accent — both shades are LIGHTER than the page bg
    // (#141414) so the button stays visible at rest and gains contrast
    // on hover instead of vanishing. Other palettes darken on hover
    // because their accent has headroom to spare; black doesn't.
    accent: "#333333",
    accentRgb: "51, 51, 51",
    accent2: "#4a4a4a",
    accentText: "#f5f5f5",
    cardBack: "#1f1f1f",
    cardBack2: "#2a2a2a",
    cardBackBorder: "#0a0a0a",
    cardBackMark: "rgba(220, 220, 220, 0.92)",
    cardBackPattern: "rgba(255, 255, 255, 0.05)",
  },
  pink: {
    accent: "#d96b9b",
    accentRgb: "217, 107, 155",
    accent2: "#b85580",
    accentText: "#141414",
    cardBack: "#d96b9b",
    cardBack2: "#e885ae",
    cardBackBorder: "#9c456e",
    cardBackMark: "rgba(40, 40, 40, 0.85)",
    cardBackPattern: "rgba(0, 0, 0, 0.07)",
  },
  purple: {
    // Reference palette: #7F49B4 over #141414 with #CFCFCF marks.
    accent: "#7f49b4",
    accentRgb: "127, 73, 180",
    accent2: "#6a3d9a",
    accentText: "#f5f5f5",
    cardBack: "#7f49b4",
    cardBack2: "#9a63d0",
    cardBackBorder: "#5a3382",
    cardBackMark: "rgba(207, 207, 207, 0.92)",
    cardBackPattern: "rgba(255, 255, 255, 0.07)",
  },
  yellow: {
    accent: "#d4a432",
    accentRgb: "212, 164, 50",
    accent2: "#b08826",
    accentText: "#141414",
    cardBack: "#d4a432",
    cardBack2: "#e6ba4a",
    cardBackBorder: "#9a7822",
    cardBackMark: "rgba(40, 40, 40, 0.85)",
    cardBackPattern: "rgba(0, 0, 0, 0.07)",
  },
  orange: {
    accent: "#d77a3d",
    accentRgb: "215, 122, 61",
    accent2: "#b5642a",
    accentText: "#141414",
    cardBack: "#d77a3d",
    cardBack2: "#e89154",
    cardBackBorder: "#9a5226",
    cardBackMark: "rgba(40, 40, 40, 0.85)",
    cardBackPattern: "rgba(0, 0, 0, 0.07)",
  },
  teal: {
    accent: "#3aafa4",
    accentRgb: "58, 175, 164",
    accent2: "#2e9690",
    accentText: "#141414",
    cardBack: "#3aafa4",
    cardBack2: "#52c5b9",
    cardBackBorder: "#1f7570",
    cardBackMark: "rgba(40, 40, 40, 0.85)",
    cardBackPattern: "rgba(0, 0, 0, 0.07)",
  },
};
const PALETTE_NAMES = Object.keys(ACCENT_PALETTES);

// ============================================================
// Local persistence
// ----------
// Cards, hand, deck, discard, counters, and the picked accent all
// persist in localStorage so refreshing the page (or losing the
// connection and rejoining via the same share link) restores the
// player's board instead of wiping it. The host's PeerJS id changes
// on refresh, so this is most useful for a joiner reconnecting to a
// still-up host; but it also lets a solo host restore their setup if
// they reload.
// ============================================================
const STORAGE_KEY = "sigil-game-state-v1";
const STATE_VERSION = 1;
function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || obj.version !== STATE_VERSION) return null;
    return obj;
  } catch (e) {
    return null;
  }
}
function saveLocalState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STATE_VERSION,
        deck: self.deck,
        hand: self.hand,
        play: self.play,
        discard: self.discard,
        set: self.set,
        counters: self.counters,
        palette: selfPaletteName,
        format: typeof currentFormat === "string" ? currentFormat : "full",
        fastDeckText:
          typeof lastFastDeckText === "string" ? lastFastDeckText : "",
        wins: typeof selfWins === "number" ? selfWins : 0,
        turn: currentTurn,
      }),
    );
  } catch (e) {
    // Quota / private-browsing / serialization failure — best-effort only.
  }
}

const _savedForBoot = loadSavedState();
// Lobby win counts. selfWins persists across refresh so reconnecting
// keeps your score; oppWins comes back via the next "winRecorded"
// broadcast on reconnect. Both reset only when the user explicitly
// hits Host/Join (i.e. starts a new lobby).
let selfWins =
  _savedForBoot && typeof _savedForBoot.wins === "number"
    ? _savedForBoot.wins
    : 0;
let oppWins = 0;
let selfPaletteName =
  _savedForBoot && ACCENT_PALETTES[_savedForBoot.palette]
    ? _savedForBoot.palette
    : PALETTE_NAMES[Math.floor(Math.random() * PALETTE_NAMES.length)];
// Default to blue so opp card backs aren't blank before the opp's
// "hello" arrives; overridden as soon as the connection opens.
let oppPaletteName = "blue";
function getPalette(name) {
  return ACCENT_PALETTES[name] || ACCENT_PALETTES.blue;
}
// Currently rendering side's palette — set at the top of each
// drawBoard() so card-back, hover halo, and ping draws don't need to
// thread the palette through every call site.
let currentRenderPalette = getPalette(selfPaletteName);
function applySelfPalette() {
  const p = getPalette(selfPaletteName);
  const root = document.documentElement.style;
  root.setProperty("--accent", p.accent);
  root.setProperty("--accent2", p.accent2);
  root.setProperty("--accent-glow", `rgba(${p.accentRgb}, 0.78)`);
  root.setProperty("--accent-tint", `rgba(${p.accentRgb}, 0.16)`);
  root.setProperty("--accent-text", p.accentText);
  root.setProperty("--card-back", p.cardBack);
  root.setProperty("--card-back2", p.cardBack2);
  root.setProperty("--card-back-border", p.cardBackBorder);
  root.setProperty("--card-back-mark", p.cardBackMark);
  root.setProperty("--card-back-pattern", p.cardBackPattern);
}
function applyOppPalette() {
  const p = getPalette(oppPaletteName);
  // Scope opp's card-back vars to .half.opp so the opp's deck/discard
  // DOM piles render in opp's color. The page-wide --accent stays as
  // self's color (it's the *local player's* identity).
  const oppHalf = document.querySelector(".half.opp");
  if (!oppHalf) return;
  oppHalf.style.setProperty("--card-back", p.cardBack);
  oppHalf.style.setProperty("--card-back2", p.cardBack2);
  oppHalf.style.setProperty("--card-back-border", p.cardBackBorder);
  oppHalf.style.setProperty("--card-back-mark", p.cardBackMark);
  oppHalf.style.setProperty("--card-back-pattern", p.cardBackPattern);
  // Expose opp's accent at the document root too, so DOM outside the
  // opp half (e.g. chat-message "Opponent" labels) can colour-match.
  document.documentElement.style.setProperty("--opp-accent", p.accent);
}
applySelfPalette();
// applyOppPalette() runs after the DOM is ready (the .half.opp
// element doesn't exist at script-eval time when this module is
// loaded with `defer` ... but the rest of game.js depends on those
// elements too, so by the time we reach the wireConn handlers below
// the DOM is ready). Defer to the next tick to be safe.
queueMicrotask(applyOppPalette);

// User-invoked: set a specific accent color, apply locally, tell the
// opp, and persist. Used by the deck right-click "Change color"
// submenu where each color is an explicit pick.
function setSelfPalette(name) {
  if (!ACCENT_PALETTES[name]) return;
  selfPaletteName = name;
  applySelfPalette();
  if (typeof drawSelf === "function") drawSelf();
  if (typeof renderSelf === "function") renderSelf();
  if (conn && conn.open) {
    conn.send({ type: "hello", palette: selfPaletteName });
  }
  saveLocalState();
  log("Accent color → " + selfPaletteName);
}

// ============================================================
// Per-card tooltips
// ----------
// Hover a card in the play area for ~1s to see its tooltip. Edit this
// table to attach notes/effects to specific cards. Keys are the card's
// display label, e.g. "K♥", "10♠", "Red Joker", "Black Joker".
// Multi-line strings are supported (newlines are preserved).
// ============================================================
function genNumberedHeartText(N) {
  return `Choose one:\n- Play for 0 Mana: Unwound a unit\n- Give a unit +${N} Will this turn\nDiscard`;
}

function genNumberedDiamondText(N) {
  const aOrAn = N == 8 ? "an" : "a";
  return `Choose one:\n- Draw ${N} cards. Keep 1. Send the rest to the bottom of your deck. Discard\n- Play as ${aOrAn} ${N} Will unit (it dies after combat but goes to the bottom of your deck)`;
}

function genNumberedSpadeText(N) {
  const aOrAn = N == 8 ? "an" : "a";
  return `Choose one:\n- Deal ${N} damage to a unit or player. Discard\n- Play as ${aOrAn} ${N} Will unit`;
}

function genNumberedClubText(N) {
  const aOrAn = N == 8 ? "an" : "a";
  return `Choose one:\n- Play as ${aOrAn} ${N} Will unit\n- Attach to another unit as a permanent +${N} Will buff (units can only have one attached buff; buffs are discarded when the unit dies)`;
}

const CARD_TOOLTIPS = {
  "K♥": "Start of turn, choose one:\n- Unwound up to 3 units\n- Give a player 3 HP",
  "K♦": "Start of turn: Draw 3 cards",
  "K♠": "Start of turn: Deal 3 damage to a unit or player",
  "K♣": "Start of turn: Give a unit +3 Will permanently",

  "Q♥": "When played, choose one:\n- Unwound up to 2 units\n- Give a player 2 HP",
  "Q♦": "When played: Draw 2 cards. If both are Red, repeat up to 2 more times",
  "Q♠": "When played: Deal 2 damage to up to 2 units or players",
  "Q♣": "When played: Give your units +2 Will this turn",

  "J♥": "After attacking: Unwound 1 unit",
  "J♦": "After attacking: Look at the top card of your deck; you may send it to the bottom",
  "J♠": "After attacking: Deal 1 damage to a unit",
  "J♣": "After attacking, choose one:\n- Give a unit +1 Will this turn\n- Ready a different Exhausted unit",

  "A♥": "Spend X Mana, choose one:\n- Give a unit +X Will permanently\n- Give a player X HP\nDiscard",
  "A♦": "Spend X Mana: Draw X cards. Discard",
  "A♠": "Spend X Mana: Deal X damage to a unit or player. Discard",
  "A♣": "Spend X Mana: Play as an X Will unit",

  "Red Joker":
    "Spend X Mana, choose one:\n- Move the top X Red cards from your discard pile to your hand. Discard\n- Play as an X Will unit that cannot attack. While alive: you may play one additional Mana card per turn. This effect stacks",
  "Black Joker":
    "Spend X Mana, choose one:\n- Move the top X Black cards from your discard pile to your hand. Discard\n- Play as an X Will unit that cannot attack. While alive: you may play one additional Mana card per turn. This effect stacks",

  "2♥": genNumberedHeartText(2),
  "3♥": genNumberedHeartText(3),
  "4♥": genNumberedHeartText(4),
  "5♥": genNumberedHeartText(5),
  "6♥": genNumberedHeartText(6),
  "7♥": genNumberedHeartText(7),
  "8♥": genNumberedHeartText(8),
  "9♥": genNumberedHeartText(9),
  "10♥": genNumberedHeartText(10),

  "2♦": genNumberedDiamondText(2),
  "3♦": genNumberedDiamondText(3),
  "4♦": genNumberedDiamondText(4),
  "5♦": genNumberedDiamondText(5),
  "6♦": genNumberedDiamondText(6),
  "7♦": genNumberedDiamondText(7),
  "8♦": genNumberedDiamondText(8),
  "9♦": genNumberedDiamondText(9),
  "10♦": genNumberedDiamondText(10),

  "2♠": genNumberedSpadeText(2),
  "3♠": genNumberedSpadeText(3),
  "4♠": genNumberedSpadeText(4),
  "5♠": genNumberedSpadeText(5),
  "6♠": genNumberedSpadeText(6),
  "7♠": genNumberedSpadeText(7),
  "8♠": genNumberedSpadeText(8),
  "9♠": genNumberedSpadeText(9),
  "10♠": genNumberedSpadeText(10),

  "2♣": genNumberedClubText(2),
  "3♣": genNumberedClubText(3),
  "4♣": genNumberedClubText(4),
  "5♣": genNumberedClubText(5),
  "6♣": genNumberedClubText(6),
  "7♣": genNumberedClubText(7),
  "8♣": genNumberedClubText(8),
  "9♣": genNumberedClubText(9),
  "10♣": genNumberedClubText(10),
};

function getCardTooltip(card) {
  return CARD_TOOLTIPS[cardLabel(card)] || null;
}

// ============================================================
// Card model
// ============================================================
const SUITS = ["S", "H", "D", "C"];
const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];
const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };

let cardIdCounter = 0;
function nextCardId() {
  return "c" + ++cardIdCounter;
}

function freshDeck() {
  const cards = [];
  for (const s of SUITS)
    for (const r of RANKS) cards.push({ id: nextCardId(), suit: s, rank: r });
  cards.push({ id: nextCardId(), suit: "J", rank: "RED" });
  cards.push({ id: nextCardId(), suit: "J", rank: "BLACK" });
  return cards;
}

// ============================================================
// Formats
// ----------
// Full = standard 54-card deck, counter defaults to 30.
// Fast = 25-card deck (picked from premades or pasted as text),
//        counter defaults to 20.
// The chosen format is per-player (decks are private) and persists
// in localStorage so refresh keeps the same format. The format
// dropdown lives in the header.
// ============================================================
const FORMATS = {
  full: { deckSize: 54, counterDefault: 30 },
  fast: { deckSize: 25, counterDefault: 20 },
};
const FAST_DECK_SIZE = 25;

// Parse a single card code into a {suit, rank} pair, or null if
// invalid. Accepts: rank+suit codes ("AS", "10H", "TS"); jokers as
// "RJ"/"JR"/"RED JOKER" or "BJ"/"JB"/"BLACK JOKER". Case-insensitive.
function parseCardCode(code) {
  const raw = (code || "").trim().toUpperCase();
  if (!raw || raw.startsWith("#")) return null;
  if (raw === "RJ" || raw === "JR" || raw === "RED JOKER")
    return { suit: "J", rank: "RED" };
  if (raw === "BJ" || raw === "JB" || raw === "BLACK JOKER")
    return { suit: "J", rank: "BLACK" };
  // Suit is the last char; rank is everything before. "T" → "10".
  const suit = raw.slice(-1);
  let rank = raw.slice(0, -1);
  if (rank === "T") rank = "10";
  if (!"SHDC".includes(suit)) return null;
  if (!RANKS.includes(rank)) return null;
  return { suit, rank };
}

// Parse multi-line / space-separated card list. Whitespace, blank
// lines, and `# comments` are ignored. Returns the deduplicated card
// list plus an `errors` array — each entry carries the offending
// token / canonical code, the line number it appeared on, and whether
// it's an unknown card or a duplicate — so the UI can call out
// exactly what and where the issue is.
function parseDeckText(text) {
  const cards = [];
  const seen = new Set();
  const errors = [];
  const lines = (text || "").split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].split("#")[0]; // strip trailing comment
    for (const tok of line.split(/[\s,]+/)) {
      if (!tok) continue;
      const c = parseCardCode(tok);
      if (!c) {
        errors.push({ type: "unknown", token: tok, line: li + 1 });
        continue;
      }
      const key = c.suit + ":" + c.rank;
      if (seen.has(key)) {
        errors.push({
          type: "duplicate",
          code: cardSpecToCode(c),
          line: li + 1,
        });
        continue;
      }
      seen.add(key);
      cards.push(c);
    }
  }
  return { cards, errors };
}

// Inverse of parseCardCode — render a {suit, rank} pair back to its
// short code so we can populate the textarea with the previously-
// applied deck. Used for premade decks (joined as newlines) and for
// re-serializing whatever the user last applied.
function cardSpecToCode(c) {
  if (c.suit === "J") return c.rank === "RED" ? "RJ" : "BJ";
  return c.rank + c.suit;
}

// Canonical 54-card index used by the deck encoder/decoder. Stable
// order: H, D, S, C (ranks A,2..10,J,Q,K), then red joker, then
// black joker. The encoding is a 54-bit bitmask packed into 7 bytes
// and base64-encoded — small enough to paste in chat (~10 chars) and
// trivially decoded back to a {suit, rank} list.
const FAST_DECK_CARD_LIST = (() => {
  const out = [];
  for (const suit of ["H", "D", "S", "C"]) {
    for (const rank of RANKS) out.push({ suit, rank });
  }
  out.push({ suit: "J", rank: "RED" });
  out.push({ suit: "J", rank: "BLACK" });
  return out;
})();
const FAST_DECK_CARD_INDEX = (() => {
  const m = {};
  FAST_DECK_CARD_LIST.forEach((c, i) => {
    m[c.suit + ":" + c.rank] = i;
  });
  return m;
})();
const FAST_DECK_BYTES = Math.ceil(FAST_DECK_CARD_LIST.length / 8);

// Encode a list of {suit, rank} specs into a base64url string with
// no padding. Order doesn't matter; duplicates are folded into the
// bitmask. Empty input produces an all-zero code.
function encodeFastDeck(specs) {
  const bytes = new Uint8Array(FAST_DECK_BYTES);
  for (const s of specs) {
    const idx = FAST_DECK_CARD_INDEX[s.suit + ":" + s.rank];
    if (idx == null) continue;
    bytes[Math.floor(idx / 8)] |= 1 << (idx % 8);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Decode a base64url code back to a list of specs. Returns null on
// any failure (bad characters, wrong byte length, etc.) so callers
// can show an error.
function decodeFastDeck(code) {
  try {
    let s = String(code || "")
      .trim()
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    if (!s) return null;
    while (s.length % 4) s += "=";
    const bin = atob(s);
    if (bin.length !== FAST_DECK_BYTES) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const specs = [];
    for (let i = 0; i < FAST_DECK_CARD_LIST.length; i++) {
      if (bytes[Math.floor(i / 8)] & (1 << (i % 8))) {
        specs.push(FAST_DECK_CARD_LIST[i]);
      }
    }
    return specs;
  } catch (e) {
    return null;
  }
}

// Premade Fast-format decks. Each entry can be ONE of three shapes:
//   1. A deck-code string from the Export button:
//        "Best deck": "AQwArNr_Pg"
//   2. An array of short card codes (see parseCardCode):
//        "Face Heavy": ["JS", "QS", ...]
//   3. An array of { suit, rank } objects (e.g. the value returned by
//      decodeFastDeck — though shape #1 is shorter to author):
//        "Custom": decodeFastDeck("AQwArNr_Pg")
// resolvePremadeDeck() normalizes any of these to a spec list.
function resolvePremadeDeck(entry) {
  if (!entry) return [];
  if (typeof entry === "string") return decodeFastDeck(entry) || [];
  if (Array.isArray(entry)) {
    return entry
      .map((e) =>
        typeof e === "string"
          ? parseCardCode(e)
          : e && e.suit && e.rank
            ? e
            : null,
      )
      .filter(Boolean);
  }
  return [];
}

const PREMADE_FAST_DECKS = {
  "Black Aggro": "AQwArNr_Pg",
  "Red Control": "_zwA_3AAMA",
};

let currentFormat =
  _savedForBoot && FORMATS[_savedForBoot.format]
    ? _savedForBoot.format
    : "full";

// Last-applied Fast deck text — populates the textarea when the
// modal reopens so the player can edit their previous deck instead
// of pasting it again. Saved/restored via localStorage.
let lastFastDeckText =
  _savedForBoot && typeof _savedForBoot.fastDeckText === "string"
    ? _savedForBoot.fastDeckText
    : "";

// Replace self.* with a freshly-shuffled deck of the given cards
// (which are {suit, rank} pairs from parseCardCode / premades), and
// set the deck counter to the Fast default. `sourceText` is what
// gets stashed as `lastFastDeckText` so the modal can re-render the
// deck as text on reopen — pass the user's raw paste for custom
// decks, or the premade's code list joined by newlines.
function applyFastDeck(cardSpecs, label, sourceText) {
  const deck = cardSpecs.map((c) => ({
    id: nextCardId(),
    suit: c.suit,
    rank: c.rank,
  }));
  shuffleInPlace(deck);
  self.deck = deck;
  self.hand = [];
  self.discard = [];
  self.set = [];
  self.play = [];
  self.counters = { deck: FORMATS.fast.counterDefault };
  currentFormat = "fast";
  lastFastDeckText =
    sourceText != null ? sourceText : cardSpecs.map(cardSpecToCode).join("\n");
  log("Format: Fast — " + (label || `${deck.length} cards`));
  notifyOpp("started a new game (Fast format)");
  renderSelf();
  broadcastState();
}

function selectFullFormat() {
  self.deck = freshDeck();
  shuffleInPlace(self.deck);
  self.hand = [];
  self.discard = [];
  self.set = [];
  self.play = [];
  self.counters = { deck: FORMATS.full.counterDefault };
  currentFormat = "full";
  log("Format: Full — 54 cards");
  notifyOpp("started a new game (Full format)");
  renderSelf();
  broadcastState();
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function cardLabel(c) {
  if (c.suit === "J") return c.rank === "RED" ? "Red Joker" : "Black Joker";
  return c.rank + SUIT_SYMBOL[c.suit];
}

function isRed(c) {
  return (
    c.suit === "H" || c.suit === "D" || (c.suit === "J" && c.rank === "RED")
  );
}

// ============================================================
// State
// ============================================================
const self = {
  deck: [],
  hand: [],
  discard: [],
  set: [], // "set aside" pile — cards picked from the deck via the
  // side section above the deck counter. Visible to both players.
  play: [],
  counters: { deck: 30 },
};
const opp = {
  deckCount: 0,
  handCount: 0,
  // Opp's revealed hand cards (null when not revealed; otherwise an
  // array sent by the opp via broadcastState). When set, we render the
  // opp's hand face-up instead of as N card backs.
  hand: null,
  discard: [],
  set: [],
  play: [],
  counters: { deck: 30 },
};
// When true, broadcastState sends our full hand to the opp so they can
// see what we're holding. Toggled via the hand-card right-click menu.
let selfHandRevealed = false;
// Whose turn is it, from this player's perspective. "self" highlights
// the bottom half; "opp" highlights the top half. Persisted in
// localStorage and synced via a turnChange peer message.
let currentTurn =
  _savedForBoot &&
  (_savedForBoot.turn === "self" || _savedForBoot.turn === "opp")
    ? _savedForBoot.turn
    : "self";

let peer = null;
let conn = null;
// True when the local player clicked Host (rather than Join). Used to
// pick a canonical "first turn" assignment when a new lobby starts —
// the host gets "self", joiner gets "opp".
let isHost = false;
let drag = null;
let suppressNextClick = false;
let suppressNextClickTimer = null;
// Set `suppressNextClick` after a drag-drop so the synthetic click the
// browser fires from the same pointerup doesn't trigger pile/canvas
// click handlers. The flag auto-clears after a short window so a later
// real click on a pile isn't accidentally eaten when no synthetic
// click ever fired (e.g., drop landed somewhere non-clickable).
function armClickSuppression() {
  suppressNextClick = true;
  if (suppressNextClickTimer != null) clearTimeout(suppressNextClickTimer);
  suppressNextClickTimer = setTimeout(() => {
    suppressNextClick = false;
    suppressNextClickTimer = null;
  }, 200);
}
let rKeyDown = false;
let cKeyDown = false;
let pKeyDown = false;
let hoveredCardId = null;
// While dragging, the id of a card we'd attach to if we dropped right now
// (or null if not over any). Drives the green attach-preview outline.
let attachTargetId = null;
let tooltipTimer = null;
const tooltipEl = document.getElementById("cardTooltip");

// Skip the game-control hotkeys (t/p/c) when the user is typing into
// a text field — otherwise typing "type a message" would rotate
// cards, ping things, and open the counter widget.
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}
window.addEventListener("keydown", (e) => {
  if (isTypingTarget(e.target)) return;
  if (e.key === "r" || e.key === "R") rKeyDown = true;
  if (e.key === "p" || e.key === "P") pKeyDown = true;
  if (e.key === "c" || e.key === "C") {
    if (!cKeyDown) {
      cKeyDown = true;
      drawSelf();
    }
  }
  // Spacebar → end turn (same effect as clicking the End Turn button).
  // preventDefault stops the page from scrolling; the repeat guard
  // keeps a held key from flipping the turn back and forth.
  if ((e.key === " " || e.code === "Space") && !e.repeat) {
    e.preventDefault();
    endTurn();
  }
  // Chat hotkeys: Enter opens the chat; "/" opens it and seeds the
  // textbox with a slash so the player can type a command immediately.
  if (e.key === "Enter") {
    if (chatEl && chatEl.classList.contains("collapsed")) {
      e.preventDefault();
      openChat();
    }
  } else if (e.key === "/") {
    if (chatEl) {
      e.preventDefault();
      if (chatEl.classList.contains("collapsed")) openChat();
      chatInput.value = "/" + chatInput.value;
      // openChat() focuses on the next tick; queue our caret move after
      // it so the cursor lands at the end of the seeded text.
      setTimeout(() => {
        chatInput.focus();
        const n = chatInput.value.length;
        chatInput.setSelectionRange(n, n);
      }, 0);
    }
  }
});
window.addEventListener("keyup", (e) => {
  if (isTypingTarget(e.target)) return;
  if (e.key === "r" || e.key === "R") rKeyDown = false;
  if (e.key === "p" || e.key === "P") pKeyDown = false;
  if (e.key === "c" || e.key === "C") {
    if (cKeyDown) {
      cKeyDown = false;
      drawSelf();
    }
  }
});
window.addEventListener("blur", () => {
  rKeyDown = false;
  pKeyDown = false;
  if (cKeyDown) {
    cKeyDown = false;
    drawSelf();
  }
});

// ============================================================
// Canvas play-area renderer
// ----------
// Cards on the table live as data { id, suit, rank, x, y } where x, y
// are fractions of the canvas's display size. Drawing happens in canvas
// pixel coords; the canvas's bitmap is sized to displaySize × devicePixelRatio.
// ============================================================
const selfCanvas = document.getElementById("selfBoard");
const oppCanvas = document.getElementById("oppBoard");
const selfCtx = selfCanvas.getContext("2d");
const oppCtx = oppCanvas.getContext("2d");

function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
}

function boardSize(canvas) {
  const r = canvas.getBoundingClientRect();
  return { w: r.width, h: r.height, rect: r };
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawCard(ctx, card, x, y, opts) {
  opts = opts || {};
  // Lifted cards get a small "tilt" (extra 2°) for visual flair while
  // dragged — but suppress it when the player is rotating (R held), so
  // the cardinal snap reads clean against the table.
  const rot = (card.rot || 0) + (opts.lifted && !rKeyDown ? 2 : 0);
  const hovered = !!opts.hovered && !opts.lifted;
  // Hovered or being-dragged cards render at full size; otherwise the
  // played card uses BOARD_CARD_SCALE so the board fits more rows.
  const scale = hovered || opts.lifted ? 1 : BOARD_CARD_SCALE;
  ctx.save();
  // Rotate (and scale) around the card's center, so the card grows
  // symmetrically on hover instead of expanding from one corner.
  ctx.translate(x + CARD_W / 2, y + CARD_H / 2);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.translate(-CARD_W / 2, -CARD_H / 2);
  // Shadow: accent-tinted glow on hover, deeper drop shadow when being
  // dragged, otherwise a subtle drop shadow.
  const haloRgb = currentRenderPalette.accentRgb;
  if (hovered) {
    ctx.shadowColor = `rgba(${haloRgb}, 0.85)`;
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else {
    ctx.shadowColor = opts.lifted ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)";
    ctx.shadowBlur = opts.lifted ? 10 : 3;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = opts.lifted ? 5 : 2;
  }
  if (card.faceDown || !card.suit) {
    drawCardBack(ctx, 0, 0, hovered);
  } else {
    ctx.fillStyle = "#e8e6df";
    roundRectPath(ctx, 0, 0, CARD_W, CARD_H, CARD_RADIUS);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = hovered ? `rgba(${haloRgb}, 0.95)` : "rgba(0,0,0,0.25)";
    ctx.lineWidth = hovered ? 1.5 : 1;
    ctx.stroke();
    ctx.fillStyle = isRed(card) ? "#c44545" : "#1f1f1f";
    if (card.suit === "J") drawJokerContent(ctx, card, 0, 0);
    else drawStandardContent(ctx, card, 0, 0);
  }
  if (card.counter != null && card.counter !== 0) {
    if (opts.mirrored) {
      // Parent canvas is CSS-rotated 180° (opp board). Counter-rotate the
      // badge here so the digit reads upright in the viewer's frame.
      ctx.save();
      ctx.translate(CARD_W / 2, CARD_H / 2);
      ctx.rotate(Math.PI);
      ctx.translate(-CARD_W / 2, -CARD_H / 2);
      drawCardCounter(ctx, card.counter);
      ctx.restore();
    } else {
      drawCardCounter(ctx, card.counter);
    }
  }
  ctx.restore();
}

// Draws a soft green halo + outline matching the card's rotation, used to
// preview which card you'd attach to mid-drag. The scale matches the
// target card's render scale so the outline tracks the visible footprint.
function drawAttachPreview(ctx, card, x, y, scale) {
  scale = scale || 1;
  ctx.save();
  ctx.translate(x + CARD_W / 2, y + CARD_H / 2);
  const rot = card.rot || 0;
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.translate(-CARD_W / 2, -CARD_H / 2);
  ctx.shadowColor = "rgba(136, 192, 152, 0.7)";
  ctx.shadowBlur = 14;
  ctx.strokeStyle = "rgba(136, 192, 152, 0.95)";
  ctx.lineWidth = 2;
  roundRectPath(ctx, -3, -3, CARD_W + 6, CARD_H + 6, CARD_RADIUS + 3);
  ctx.stroke();
  ctx.restore();
}

function drawCardCounter(ctx, value) {
  const text = String(value);
  ctx.save();
  ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, sans-serif";
  const tw = ctx.measureText(text).width;
  const pad = 5;
  const bw = Math.max(18, tw + pad * 2);
  const bh = 18;
  const bx = CARD_W - bw - 3;
  const by = 3;
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  // Positive uses a palette-independent near-opaque dark fill so the
  // chip is clearly visible against any card back — including
  // face-down cards whose back shares the same accent color. Negative
  // keeps the red fill as a semantic damage cue.
  const positive = value > 0;
  ctx.fillStyle = positive ? "rgba(20, 20, 20, 0.92)" : "#c44545";
  roundRectPath(ctx, bx, by, bw, bh, 9);
  ctx.fill();
  ctx.shadowColor = "transparent";
  // Hairline outline defines the chip's edge on dark card backs where
  // the dark fill would otherwise blend in.
  ctx.strokeStyle = positive ? "rgba(255, 255, 255, 0.4)" : "#ffffff";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + bw / 2, by + bh / 2 + 1);
  ctx.restore();
}

// --- C-held counter widget (canvas-drawn, centered ON the card so the
// cursor stays inside the card's hit area while interacting with it).
const COUNTER_WIDGET_W = 64;
const COUNTER_WIDGET_H = 22;
const COUNTER_BTN_W = 20;

function counterWidgetRects(card) {
  const { w, h } = boardSize(selfCanvas);
  const cx = card.x * w + CARD_W / 2;
  const cy = card.y * h + CARD_H / 2;
  const widgetLeft = cx - COUNTER_WIDGET_W / 2;
  const widgetTop = cy - COUNTER_WIDGET_H / 2;
  return {
    widget: {
      left: widgetLeft,
      top: widgetTop,
      w: COUNTER_WIDGET_W,
      h: COUNTER_WIDGET_H,
    },
    dec: {
      left: widgetLeft,
      top: widgetTop,
      w: COUNTER_BTN_W,
      h: COUNTER_WIDGET_H,
    },
    inc: {
      left: widgetLeft + COUNTER_WIDGET_W - COUNTER_BTN_W,
      top: widgetTop,
      w: COUNTER_BTN_W,
      h: COUNTER_WIDGET_H,
    },
    value: {
      left: widgetLeft + COUNTER_BTN_W,
      top: widgetTop,
      w: COUNTER_WIDGET_W - 2 * COUNTER_BTN_W,
      h: COUNTER_WIDGET_H,
    },
  };
}

function pointInRect(px, py, r) {
  return px >= r.left && px < r.left + r.w && py >= r.top && py < r.top + r.h;
}

function drawCounterWidget(ctx, card) {
  const rects = counterWidgetRects(card);
  const r = rects.widget;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "rgba(26, 26, 26, 0.97)";
  roundRectPath(ctx, r.left, r.top, r.w, r.h, 12);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = `rgba(${getPalette(selfPaletteName).accentRgb}, 0.7)`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = "bold 16px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#cfcfcf";
  ctx.fillText(
    "−",
    rects.dec.left + rects.dec.w / 2,
    rects.dec.top + rects.dec.h / 2 + 1,
  );
  ctx.fillText(
    "+",
    rects.inc.left + rects.inc.w / 2,
    rects.inc.top + rects.inc.h / 2 + 1,
  );
  ctx.font = "bold 13px -apple-system, sans-serif";
  ctx.fillStyle = "#cfcfcf";
  ctx.fillText(
    String(card.counter || 0),
    rects.value.left + rects.value.w / 2,
    rects.value.top + rects.value.h / 2 + 1,
  );
  ctx.restore();
}

function drawCardBack(ctx, x, y, hovered) {
  const p = currentRenderPalette;
  ctx.fillStyle = p.cardBack;
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.fill();
  ctx.shadowColor = "transparent";
  // Subtle diagonal stripe pattern, clipped to the rounded card shape.
  // Matches the CSS repeating-linear-gradient on .card.face-down so the
  // DOM and canvas card backs share one texture.
  ctx.save();
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.clip();
  ctx.strokeStyle = p.cardBackPattern;
  ctx.lineWidth = 1;
  for (let i = -CARD_H; i < CARD_W + CARD_H; i += 7) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + CARD_H, y + CARD_H);
    ctx.stroke();
  }
  ctx.restore();
  // 4-point sparkle sigil — matches the CSS pseudo-element on
  // .card.face-down so deck/discard piles and played face-down cards
  // share one design.
  const mcx = x + CARD_W / 2;
  const mcy = y + CARD_H / 2;
  const R = 15;
  const r = R * 0.32;
  const s = r * Math.SQRT1_2;
  ctx.fillStyle = p.cardBackMark;
  ctx.beginPath();
  ctx.moveTo(mcx, mcy - R);
  ctx.lineTo(mcx + s, mcy - s);
  ctx.lineTo(mcx + R, mcy);
  ctx.lineTo(mcx + s, mcy + s);
  ctx.lineTo(mcx, mcy + R);
  ctx.lineTo(mcx - s, mcy + s);
  ctx.lineTo(mcx - R, mcy);
  ctx.lineTo(mcx - s, mcy - s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = hovered ? `rgba(${p.accentRgb}, 0.95)` : p.cardBackBorder;
  ctx.lineWidth = hovered ? 1.5 : 1;
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.stroke();
}

function drawStandardContent(ctx, card, x, y) {
  const sym = SUIT_SYMBOL[card.suit];
  ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(card.rank, x + 6, y + 4);
  ctx.fillText(sym, x + 6, y + 19);
  ctx.save();
  ctx.translate(x + CARD_W - 6, y + CARD_H - 4);
  ctx.rotate(Math.PI);
  ctx.fillText(card.rank, 0, 0);
  ctx.fillText(sym, 0, 15);
  ctx.restore();
  ctx.font = "bold 28px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(sym, x + CARD_W / 2, y + CARD_H / 2 + 1);
}

function drawJokerContent(ctx, card, x, y) {
  ctx.font = "bold 10px -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("JKR", x + 6, y + 6);
  ctx.save();
  ctx.translate(x + CARD_W - 6, y + CARD_H - 6);
  ctx.rotate(Math.PI);
  ctx.fillText("JKR", 0, 0);
  ctx.restore();
  ctx.font = "bold 11px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    card.rank === "RED" ? "RED ★" : "BLK ★",
    x + CARD_W / 2,
    y + CARD_H / 2,
  );
}

function drawBoard(canvas, ctx, cards, hoverId) {
  const { w, h } = boardSize(canvas);
  const mirrored = canvas === oppCanvas;
  // Tell the per-card render functions which palette to use — opp
  // cards render with the opp's chosen accent, self with our own.
  currentRenderPalette = getPalette(
    mirrored ? oppPaletteName : selfPaletteName,
  );
  ctx.clearRect(0, 0, w, h);
  // Draw in order; the currently directly-dragged card is drawn last
  // (so it floats above the others) with a lifted effect. Use _renderX/Y
  // when present (opp cards lerp toward c.x/c.y for smooth movement).
  const posX = (c) => (c._renderX != null ? c._renderX : c.x) * w;
  const posY = (c) => (c._renderY != null ? c._renderY : c.y) * h;
  // Helper: draw any attached cards underneath `parent`. They stack from
  // index 0 (peeks the most) to length-1 (just behind parent), offset in
  // the parent's local "up" direction.
  //
  // Two complications:
  //   1. The opp canvas is CSS-rotated 180°. Without compensation, opp
  //      stacks would visually extend toward the midline while the
  //      player's own stacks extend upward, and the two halves would
  //      disagree. The preferred peek direction in the canvas frame is
  //      flipped for the opp side so the visual direction matches.
  //   2. If extending in the preferred direction would put the furthest
  //      attached card off the canvas (parent too close to that edge),
  //      flip the direction so the whole stack stays visible.
  const mirrorSign = mirrored ? -1 : 1;
  const drawAttachedFor = (parent, parentOpts) => {
    if (!parent.attached || parent.attached.length === 0) return;
    parentOpts = parentOpts || {};
    const baseX = posX(parent);
    const baseY = posY(parent);
    const rotRad = ((parent.rot || 0) * Math.PI) / 180;
    const dxUnit = mirrorSign * Math.sin(rotRad);
    const dyUnit = mirrorSign * -Math.cos(rotRad);
    // Scale the peek to match the visual scale of the cards so the
    // proportional "stick out" stays consistent.
    const peekScale =
      parentOpts.hovered || parentOpts.lifted ? 1 : BOARD_CARD_SCALE;
    const total = parent.attached.length * ATTACH_PEEK_PX * peekScale;
    const probeX = baseX + total * dxUnit;
    const probeY = baseY + total * dyUnit;
    const fits =
      probeX >= 0 &&
      probeX + CARD_W <= w &&
      probeY >= 0 &&
      probeY + CARD_H <= h;
    const flipSign = fits ? 1 : -1;
    for (let i = 0; i < parent.attached.length; i++) {
      const att = parent.attached[i];
      const peek = (parent.attached.length - i) * ATTACH_PEEK_PX * peekScale;
      const dx = flipSign * peek * dxUnit;
      const dy = flipSign * peek * dyUnit;
      // The attached card adopts the parent's rotation, hover state,
      // and drag state while attached — so the whole stack scales
      // together rather than the parent popping up alone.
      const attDraw = Object.assign({}, att, { rot: parent.rot || 0 });
      drawCard(ctx, attDraw, baseX + dx, baseY + dy, {
        mirrored,
        hovered: parentOpts.hovered,
        lifted: parentOpts.lifted,
      });
    }
  };
  let liftedCard = null;
  for (const c of cards) {
    if (
      canvas === selfCanvas &&
      drag &&
      drag.kind === "canvas" &&
      drag.started &&
      drag.cardId === c.id
    ) {
      liftedCard = c;
      continue;
    }
    const isHovered = hoverId === c.id;
    drawAttachedFor(c, { hovered: isHovered });
    drawCard(ctx, c, posX(c), posY(c), {
      hovered: isHovered,
      mirrored,
    });
  }
  // Attach-preview outline on whatever card we're hovering over with a
  // drag in progress. Drawn after the regular cards (so it's on top of
  // the target) but before the lifted card (so the dragged card still
  // floats above everything).
  if (canvas === selfCanvas && attachTargetId != null) {
    const target = cards.find((c) => c.id === attachTargetId);
    if (target) {
      const targetScale = hoverId === target.id ? 1 : BOARD_CARD_SCALE;
      drawAttachPreview(ctx, target, posX(target), posY(target), targetScale);
    }
  }
  if (liftedCard) {
    drawAttachedFor(liftedCard, { lifted: true });
    drawCard(ctx, liftedCard, posX(liftedCard), posY(liftedCard), {
      lifted: true,
      mirrored,
    });
  }
  // Render any active pings on this canvas (drawn over the cards).
  if (activePings.length > 0) {
    const side = canvas === selfCanvas ? "self" : "opp";
    const now = performance.now();
    for (const p of activePings) {
      if (p.side !== side) continue;
      const card = cards.find((c) => c.id === p.cardId);
      if (!card) continue;
      drawPing(
        ctx,
        posX(card) + CARD_W / 2,
        posY(card) + CARD_H / 2,
        now - p.startTime,
      );
    }
  }
}

function drawSelf() {
  drawBoard(selfCanvas, selfCtx, self.play, hoveredCardId);
  // When holding C while hovering a card, overlay the +/- counter widget.
  if (cKeyDown && hoveredCardId !== null) {
    const c = self.play.find((cc) => cc.id === hoveredCardId);
    if (c) drawCounterWidget(selfCtx, c);
  }
}
function drawOpp() {
  drawBoard(oppCanvas, oppCtx, opp.play, null);
}

function setupCanvases() {
  resizeCanvas(selfCanvas);
  resizeCanvas(oppCanvas);
  drawSelf();
  drawOpp();
}

const _ro = new ResizeObserver((entries) => {
  for (const e of entries) {
    resizeCanvas(e.target);
    if (e.target === selfCanvas) drawSelf();
    else if (e.target === oppCanvas) drawOpp();
  }
});
_ro.observe(selfCanvas);
_ro.observe(oppCanvas);

// Topmost (last-drawn) card under (px, py) in canvas-local coords.
// Handles rotation by transforming the point into the card's local frame.
function hitTestPlay(px, py) {
  const { w, h } = boardSize(selfCanvas);
  for (let i = self.play.length - 1; i >= 0; i--) {
    const c = self.play[i];
    // Hysteresis: already-hovered cards keep their grown (scale 1) hit
    // area until the cursor leaves it, so a tiny mouse jitter near the
    // edge doesn't make them shrink+grow repeatedly. Non-hovered cards
    // use the visual (scaled) footprint so the click target tracks
    // what you actually see.
    const scale = c.id === hoveredCardId ? 1 : BOARD_CARD_SCALE;
    const halfW = (CARD_W * scale) / 2;
    const halfH = (CARD_H * scale) / 2;
    const cx = c.x * w + CARD_W / 2;
    const cy = c.y * h + CARD_H / 2;
    const rad = -((c.rot || 0) * Math.PI) / 180;
    const dx = px - cx,
      dy = py - cy;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (lx >= -halfW && lx < halfW && ly >= -halfH && ly < halfH) return c;
    // Extend the hit region to cover the peek of any attached cards.
    // Peek direction is adaptive (drawAttachedFor flips it when the
    // stack wouldn't fit on the canvas), so we use the same fit probe
    // the renderer uses to know which side the visible peek is on.
    if (c.attached && c.attached.length > 0) {
      const extra = c.attached.length * ATTACH_PEEK_PX * scale;
      const baseX = c.x * w;
      const baseY = c.y * h;
      const rotRad = ((c.rot || 0) * Math.PI) / 180;
      // Self canvas: mirrorSign is +1, so preferred peek is local "up".
      const probeX = baseX + extra * Math.sin(rotRad);
      const probeY = baseY + extra * -Math.cos(rotRad);
      const fits =
        probeX >= 0 &&
        probeX + CARD_W <= w &&
        probeY >= 0 &&
        probeY + CARD_H <= h;
      const lyMin = fits ? -halfH - extra : halfH;
      const lyMax = fits ? -halfH : halfH + extra;
      if (lx >= -halfW && lx < halfW && ly >= lyMin && ly < lyMax) return c;
    }
  }
  return null;
}

// How far each attached card peeks above the one above it (in pixels, in
// the parent's local "up" direction).
const ATTACH_PEEK_PX = 22;

// Attach `childId` underneath `parentId` so they move together as a stack.
// If `child` itself had attached cards, they get flattened onto the new
// parent so we don't need to handle nested attachment.
function attachCardToCard(childId, parentId) {
  if (cKeyDown || rKeyDown || pKeyDown) return;
  if (childId === parentId) return;
  const ci = self.play.findIndex((c) => c.id === childId);
  if (ci < 0) return;
  const parent = self.play.find((c) => c.id === parentId);
  if (!parent) return;
  // Face-down cards can't participate in an attach (as child or parent).
  // Flip face-up first.
  if (parent.faceDown || self.play[ci].faceDown) return;
  const [child] = self.play.splice(ci, 1);
  // Forming a group resets face-down state for every card involved — the
  // parent, anything already attached to it, the child, and anything
  // that was attached to the child. A stack reads as one revealed unit.
  delete parent.faceDown;
  if (!parent.attached) parent.attached = [];
  for (const pa of parent.attached) delete pa.faceDown;
  if (child.attached && child.attached.length > 0) {
    // Flatten the child's stack onto the new parent.
    for (const ca of child.attached) {
      delete ca.faceDown;
      parent.attached.push(ca);
    }
    delete child.attached;
  }
  delete child.faceDown;
  parent.attached.push(child);
  // Position/rotation while attached is derived from the parent — clear
  // the now-irrelevant transform state so it doesn't leak if the card is
  // ever detached and the parent's state hasn't been copied to it.
  delete child.x;
  delete child.y;
  delete child.rot;
  log("Attached " + cardLabel(child) + " to " + cardLabel(parent));
  notifyOpp("attached a card");
  renderSelf();
  broadcastState();
}

// Detach all cards from a parent and lay them out next to it on the play
// area as independent cards.
function ungroupCard(parentId) {
  const parent = self.play.find((c) => c.id === parentId);
  if (!parent || !parent.attached || parent.attached.length === 0) return;
  const { w } = boardSize(selfCanvas);
  const xStep = Math.min(0.06, (CARD_W * 0.6) / w);
  const maxXf = Math.max(0, 1 - CARD_W / w);
  const count = parent.attached.length;
  for (let i = 0; i < count; i++) {
    const att = parent.attached[i];
    // Spread the detached cards to the left of the parent so they're
    // immediately visible rather than overlapping it.
    att.x = Math.max(0, Math.min(maxXf, parent.x - (i + 1) * xStep));
    att.y = parent.y;
    self.play.push(att);
  }
  delete parent.attached;
  log(`Ungrouped ${count} card(s) from ${cardLabel(parent)}`);
  notifyOpp("ungrouped a card stack");
  renderSelf();
  broadcastState();
}

function bringCardToFront(cardId) {
  const i = self.play.findIndex((c) => c.id === cardId);
  if (i < 0 || i === self.play.length - 1) return;
  const [c] = self.play.splice(i, 1);
  self.play.push(c);
}

// ============================================================
// Networking
// ============================================================
function setStatus(text, cls) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = "status" + (cls ? " " + cls : "");
}

function log(msg) {
  const el = document.getElementById("log");
  const e = document.createElement("div");
  e.className = "entry";
  // Split timestamp + message into spans so the stylesheet can give the
  // timestamp tabular-numeral mono weighting and the message regular
  // contrast, without falling back to the generic "[HH:MM:SS] msg" look.
  const t = document.createElement("span");
  t.className = "ts";
  t.textContent = new Date().toLocaleTimeString();
  const m = document.createElement("span");
  m.className = "msg";
  m.textContent = msg;
  e.appendChild(t);
  e.appendChild(m);
  el.appendChild(e);
  el.scrollTop = el.scrollHeight;
}

// PeerJS options — uses the default PeerJS Cloud broker. STUN helps
// peers discover their public IPs for a direct WebRTC connection; the
// metered.ca TURN servers are the relay fallback for symmetric-NAT /
// restrictive-network pairs. Credentials are fetched at runtime via
// metered's REST API so they can be rotated without redeploying.
const METERED_TURN_URL =
  "https://sigil.metered.live/api/v1/turn/credentials?apiKey=6313bf0b660cefc023b6bed63cd777913157";
const FALLBACK_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

let iceServersPromise = null;
async function fetchIceServers() {
  try {
    const r = await fetch(METERED_TURN_URL);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const metered = await r.json();
    // Front-load Google + Cloudflare STUN so host/srflx candidates can
    // gather quickly while the metered TURN servers stay available as
    // the relay fallback.
    return [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      ...metered,
    ];
  } catch (e) {
    console.warn(
      "Failed to fetch metered TURN credentials; using STUN only:",
      e,
    );
    return FALLBACK_ICE_SERVERS;
  }
}

function getIceServers() {
  if (!iceServersPromise) iceServersPromise = fetchIceServers();
  return iceServersPromise;
}

async function buildPeerOpts() {
  return { debug: 2, config: { iceServers: await getIceServers() } };
}

// Prefetch on script load so creds are warm by the time the user clicks
// Host or Join.
getIceServers();

function hostLink(id) {
  const url = new URL(window.location.href);
  // Strip any existing ?join= and append the fresh id.
  url.searchParams.delete("join");
  url.searchParams.set("join", id);
  return url.toString();
}

// Accept either a bare peer id ("abc123") or a full share link
// ("https://.../?join=abc123"). Returns the peer id, or null.
function extractPeerId(input) {
  const s = (input || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    const j = u.searchParams.get("join");
    if (j) return j;
  } catch (_) {
    /* not a URL */
  }
  return s;
}

// Set when the user explicitly clicked Host/Join so the on("open")
// handler knows to send a "reset" signal to the opp. Cleared after
// sending. Auto-rejoin (via the ?join= URL parameter on refresh) does
// NOT set this — refreshing should preserve the saved board, not wipe
// it.
let pendingReset = false;
// Set while the URL auto-join is running so join() knows to skip the
// fresh-deck reset.
let autoJoining = false;

async function host() {
  // Clicking Host starts a new game — wipe our board and signal the
  // opp (when they connect) to wipe theirs too. A fresh lobby also
  // zeroes the win counters on both sides.
  isHost = true;
  selfWins = 0;
  oppWins = 0;
  newDeck();
  pendingReset = true;
  if (peer) peer.destroy();
  setStatus("Hosting game…");
  peer = new Peer(await buildPeerOpts());
  peer.on("open", (id) => {
    const link = hostLink(id);
    setStatus("Share the link to invite your opponent", "connected");
    log("Hosting as " + id);
    log("Share link: " + link);
    const input = document.getElementById("joinId");
    input.value = link;
    input.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(link)
        .then(() => log("(link copied to clipboard)"))
        .catch(() => {});
    }
  });
  peer.on("connection", (c) => {
    conn = c;
    wireConn();
  });
  peer.on("error", (e) => logPeerError(e));
}

async function join() {
  const target = extractPeerId(document.getElementById("joinId").value);
  if (!target) return;
  // Manual join → wipe local board + signal opp. Auto-rejoin after a
  // refresh skips this so the saved board comes back intact. A fresh
  // join also zeroes the win counters on both sides.
  isHost = false;
  if (!autoJoining) {
    selfWins = 0;
    oppWins = 0;
    newDeck();
    pendingReset = true;
  }
  if (peer) peer.destroy();
  setStatus("Connecting…");
  peer = new Peer(await buildPeerOpts());
  peer.on("open", () => {
    log("Joining " + target);
    conn = peer.connect(target, { reliable: true });
    wireConn();
  });
  peer.on("error", (e) => logPeerError(e));
}

function logPeerError(e) {
  const type = (e && e.type) || "unknown";
  setStatus("Error: " + type, "error");
  // Keep full details in the devtools console; the game log just gets a
  // single user-facing line via setStatus().
  // eslint-disable-next-line no-console
  console.error("[PeerJS error]", e);
}

function wireConn() {
  // Timeout in case the WebRTC negotiation silently stalls (e.g. ICE
  // can't find a path). 15s is generous; in practice it should connect
  // within a second or two.
  const openTimeout = setTimeout(() => {
    if (!conn || !conn.open) {
      setStatus("Connection timed out", "error");
      log("Connection timed out — see browser console for details");
      console.warn(
        "[card-game-tester] DataConnection didn't open within 15s. ICE state:",
        conn && conn.peerConnection && conn.peerConnection.iceConnectionState,
      );
    }
  }, 15000);

  conn.on("open", () => {
    clearTimeout(openTimeout);
    setStatus("Connected", "connected");
    log("Connection established");
    // If we just hit Host or Join (not auto-rejoin), ask the opp to
    // wipe their board too so both sides start at zero.
    if (pendingReset) {
      pendingReset = false;
      // Fresh lobby — both peers default to "their own" turn locally,
      // and the host immediately tells the joiner that it's the host's
      // turn (which is "opp" from the joiner's perspective).
      currentTurn = "self";
      applyTurnVisual();
      saveLocalState();
      conn.send({ type: "reset" });
      if (isHost) {
        conn.send({ type: "turnChange", turn: "opp" });
      }
    }
    // Tell the opp our accent so they render our card backs in our
    // color. Both sides fire this on open, so we exchange creds with
    // no order assumption.
    conn.send({ type: "hello", palette: selfPaletteName });
    broadcastState();
  });
  conn.on("data", (data) => {
    if (!data) return;
    if (data.type === "state") receiveOppState(data);
    else if (data.type === "move") receiveOppMove(data);
    else if (data.type === "log") log("Opponent: " + data.message);
    else if (data.type === "ping") triggerPing(data.side, data.cardId);
    else if (data.type === "chat")
      receiveChatMessage(data.text, data.sender, data.variant);
    else if (data.type === "winRecorded") receiveWinRecorded(data.wins);
    else if (data.type === "formatChange") receiveFormatChange(data.format);
    else if (data.type === "turnChange") receiveTurnChange(data.turn);
    else if (data.type === "newgame") {
      // Board-only reset — keep wins, turn, palette, format, chat.
      log("Opponent started a new game — board reset");
      resetBoardKeepingFormat();
      saveLocalState();
    } else if (data.type === "reset") {
      // Opp clicked Host/Join or ran /reset — wipe our board and wins
      // so both sides' scoreboards stay in sync. Format/palette/chat
      // are preserved. If the message includes a `turn` field (as
      // /reset does), apply it so the resetter takes the first turn;
      // connection-time resets omit it and let the host's separate
      // turnChange be the source of truth.
      log("Opponent started a new game — board reset");
      selfWins = 0;
      oppWins = 0;
      if (data.turn === "self" || data.turn === "opp") {
        currentTurn = data.turn;
        applyTurnVisual();
      }
      resetBoardKeepingFormat();
      saveLocalState();
    } else if (data.type === "hello") {
      if (data.palette && ACCENT_PALETTES[data.palette]) {
        oppPaletteName = data.palette;
        applyOppPalette();
        // Re-render so opp's deck/discard/played card backs pick up
        // the new palette immediately.
        if (typeof renderOpp === "function") renderOpp();
        if (typeof drawOpp === "function") drawOpp();
      }
    }
  });
  conn.on("close", () => {
    clearTimeout(openTimeout);
    setStatus("Disconnected", "error");
    log("Connection closed");
  });
  conn.on("error", (e) => {
    clearTimeout(openTimeout);
    logPeerError(e);
  });
}

// Receive a `state` message from the opponent and seed render positions so
// the opp's cards can lerp smoothly toward their incoming positions instead
// of teleporting on each update.
function receiveOppState(data) {
  const oldById = new Map(opp.play.map((c) => [c.id, c]));
  const newPlay = data.play || [];
  for (const c of newPlay) {
    const old = oldById.get(c.id);
    if (old && old._renderX != null) {
      c._renderX = old._renderX;
      c._renderY = old._renderY;
    } else {
      // New card — appear at its target with no animation.
      c._renderX = c.x;
      c._renderY = c.y;
    }
  }
  opp.deckCount = data.deckCount;
  opp.handCount = data.handCount;
  opp.hand = Array.isArray(data.hand) ? data.hand : null;
  opp.discard = data.discard || [];
  opp.set = data.set || [];
  opp.play = newPlay;
  opp.counters = data.counters || { deck: 0 };
  renderOpp();
  ensureAnim();
}

// Apply a lightweight drag-move delta from the opponent. Only the moving
// card's position (and rotation) changes; the rest of opp state is left
// alone. The existing _renderX/_renderY lerp origin is preserved so
// movement still animates smoothly toward the new target. If the card
// isn't in opp.play yet (which can happen if a "move" arrives before
// the first full "state"), the delta is dropped — the next full state
// sync will catch up.
function receiveOppMove(data) {
  const c = opp.play.find((x) => x.id === data.id);
  if (!c) return;
  if (c._renderX == null) {
    c._renderX = c.x;
    c._renderY = c.y;
  }
  c.x = data.x;
  c.y = data.y;
  if (data.rot != null) c.rot = data.rot;
  ensureAnim();
}

// Unified per-frame animation loop. Currently handles two things:
//   1. Lerping opp.play card render positions toward their network-supplied
//      targets (so movement is smooth instead of teleporting on each update).
//   2. Drawing card "pings" — short-lived pulse rings triggered by P+click,
//      visible to both players.
// The loop keeps running as long as either has work; both `receiveOppState`
// and `triggerPing` call ensureAnim() to wake it.
const PING_DURATION_MS = 700;
let activePings = []; // [{ side: 'self'|'opp', cardId, startTime }]
let animFrame = null;

function ensureAnim() {
  if (animFrame != null) return;
  animFrame = requestAnimationFrame(tickAnim);
}

function tickAnim() {
  animFrame = null;
  // (1) Lerp opp card render positions toward targets.
  let needsLerp = false;
  const LERP = 0.3;
  const EPS = 0.0005;
  for (const c of opp.play) {
    if (c._renderX == null) {
      c._renderX = c.x;
      c._renderY = c.y;
      continue;
    }
    const dx = c.x - c._renderX;
    const dy = c.y - c._renderY;
    if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) {
      c._renderX = c.x;
      c._renderY = c.y;
    } else {
      c._renderX += dx * LERP;
      c._renderY += dy * LERP;
      needsLerp = true;
    }
  }
  // (2) Drop expired pings.
  const now = performance.now();
  activePings = activePings.filter((p) => now - p.startTime < PING_DURATION_MS);
  const hasPings = activePings.length > 0;
  // Redraw both canvases (ping drawing is part of drawBoard).
  drawSelf();
  drawOpp();
  if (needsLerp || hasPings) animFrame = requestAnimationFrame(tickAnim);
}

// Trigger a ping locally and (optionally) over the wire.
function triggerPing(side, cardId) {
  activePings.push({ side, cardId, startTime: performance.now() });
  ensureAnim();
}

function broadcastPing(side, cardId) {
  if (!conn || !conn.open) return;
  // Flip the side when sending — what's "self" for me is the opp's "opp".
  const remoteSide = side === "self" ? "opp" : "self";
  conn.send({ type: "ping", side: remoteSide, cardId });
}

function drawPing(ctx, cx, cy, elapsed) {
  const t = Math.min(elapsed / PING_DURATION_MS, 1);
  ctx.save();
  // Outer ring: expands and fades.
  const r1 = 28 + t * 72;
  const a1 = Math.max(0, 1 - t);
  ctx.strokeStyle = `rgba(${currentRenderPalette.accentRgb}, ${a1})`;
  ctx.lineWidth = 4 * (1 - 0.6 * t);
  ctx.beginPath();
  ctx.arc(cx, cy, r1, 0, Math.PI * 2);
  ctx.stroke();
  // Inner ring: slight delay for a layered "ping" feel.
  const t2 = Math.max(0, (t - 0.18) / 0.82);
  if (t2 > 0) {
    const r2 = 22 + t2 * 56;
    const a2 = Math.max(0, 1 - t2) * 0.6;
    ctx.strokeStyle = `rgba(255, 255, 255, ${a2})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// Lightweight delta for in-drag position updates. Sends only the moving
// card's id + new x/y + rot, instead of the full state. The drop / any
// discrete action (attach, flip, zone change, …) still triggers a full
// broadcastState() so attachments and complex state stay in sync — but
// the *hot* path during a drag is 30 packets/sec × ~40 bytes instead of
// 30 × ~1 KB, cutting drag bandwidth ~25×. Crucial for the TURN-relay
// fallback where every relayed byte counts against the metered quota.
let dragBroadcastTimer = null;
function broadcastDragMoveThrottled(card) {
  if (dragBroadcastTimer != null) return;
  dragBroadcastTimer = setTimeout(() => {
    dragBroadcastTimer = null;
    if (!conn || !conn.open) return;
    conn.send({
      type: "move",
      id: card.id,
      x: card.x,
      y: card.y,
      rot: card.rot || 0,
    });
  }, 33);
}

// Coalesce broadcast bursts during a drag — sending every pointermove (60Hz+)
// would flood the data channel, while sending only on drop is choppy. ~30Hz
// is plenty for smooth lerping on the receiver.
let broadcastTimer = null;
function broadcastStateThrottled() {
  if (broadcastTimer != null) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastState();
  }, 33);
}

function broadcastState() {
  // Persist regardless of connection state — even offline edits should
  // survive a refresh so the player can reconnect with their board
  // intact.
  saveLocalState();
  if (!conn || !conn.open) return;
  // For face-down cards we hide the rank/suit from the opponent so they
  // can't peek by inspecting the wire data. The counter and attached
  // cards (including their own redaction) are still sent so the opponent
  // can see the table-visible parts of the stack.
  const redactCard = (c) => {
    let out;
    if (c.faceDown) {
      out = {
        id: c.id,
        x: c.x,
        y: c.y,
        rot: c.rot || 0,
        faceDown: true,
        counter: c.counter,
      };
    } else {
      out = c;
    }
    if (c.attached && c.attached.length > 0) {
      out = Object.assign({}, out, { attached: c.attached.map(redactCard) });
    }
    return out;
  };
  const playForOpp = self.play.map(redactCard);
  conn.send({
    type: "state",
    deckCount: self.deck.length,
    handCount: self.hand.length,
    // When the player has chosen to reveal their hand, send the actual
    // cards so the opp can render them face-up. Otherwise omit, and
    // the opp falls back to N face-down backs based on handCount.
    hand: selfHandRevealed ? self.hand : null,
    discard: self.discard,
    set: self.set,
    play: playForOpp,
    counters: self.counters,
  });
}

function notifyOpp(msg) {
  if (conn && conn.open) conn.send({ type: "log", message: msg });
}

// ============================================================
// Game actions
// ============================================================
function newDeck() {
  self.deck = freshDeck();
  shuffleInPlace(self.deck);
  self.hand = [];
  self.discard = [];
  self.set = [];
  self.play = [];
  self.counters = { deck: FORMATS.full.counterDefault };
  currentFormat = "full";
  const _sel = document.getElementById("formatSelect");
  if (_sel) _sel.value = "full";
  log("Created and shuffled a new 54-card deck");
  notifyOpp("created a new deck");
  renderSelf();
  broadcastState();
}

function shuffleDeck() {
  shuffleInPlace(self.deck);
  log("Shuffled deck");
  notifyOpp("shuffled their deck");
  renderSelf();
  broadcastState();
}

function discardToDeckShuffle() {
  if (self.discard.length === 0) return;
  self.deck = self.deck.concat(self.discard);
  self.discard = [];
  shuffleInPlace(self.deck);
  log("Shuffled discard pile into deck");
  notifyOpp("shuffled their discard pile into their deck");
  renderSelf();
  broadcastState();
}

function searchDeck() {
  openModal("Search deck — pick a card to draw", self.deck, (c) => {
    const idx = self.deck.findIndex((x) => x.id === c.id);
    if (idx < 0) return;
    const [card] = self.deck.splice(idx, 1);
    self.hand.push(card);
    log("Searched deck, drew " + cardLabel(card));
    notifyOpp("searched their deck");
    renderSelf();
    broadcastState();
    closeModal();
  });
}

// Variant of searchDeck triggered by clicking the sigil slot — the
// chosen card moves to the side pile instead of the hand. The slot
// holds at most one card; this function is a no-op if a sigil is
// already chosen (the caller also guards this).
function searchDeckForSet() {
  if (self.set.length > 0) return;
  openModal(
    "Select Sigil",
    self.deck.filter((c) =>
      [
        "H:J",
        "H:Q",
        "H:K",
        "D:J",
        "D:Q",
        "D:K",
        "S:J",
        "S:Q",
        "S:K",
        "C:J",
        "C:Q",
        "C:K",
        "J:RED",
        "J:BLACK",
      ].includes(specKey(c)),
    ),
    (c) => {
      // Re-check in case the slot got filled between modal open and
      // pick (e.g., opp signalled a state change).
      if (self.set.length > 0) {
        closeModal();
        return;
      }
      const idx = self.deck.findIndex((x) => x.id === c.id);
      if (idx < 0) return;
      const [card] = self.deck.splice(idx, 1);
      self.set.push(card);
      log("Sigil: " + cardLabel(card));
      notifyOpp("chose a sigil");
      renderSelf();
      broadcastState();
      closeModal();
    },
    {
      condensed: true,
    },
  );
}

function viewDiscard(pile, title) {
  // Discard piles render flat (no suit grouping), with the top of the
  // pile (most recently discarded) shown first.
  openModal(title, pile.slice().reverse(), null, { flat: true });
}

// Search your own discard pile — clicking a card in the modal moves it
// to your hand (mirrors searchDeck behaviour).
function searchDiscard() {
  openModal(
    "Your discard pile — pick a card",
    self.discard.slice().reverse(),
    (c) => {
      const idx = self.discard.findIndex((x) => x.id === c.id);
      if (idx < 0) return;
      const [card] = self.discard.splice(idx, 1);
      self.hand.push(card);
      log("Took from discard: " + cardLabel(card));
      notifyOpp("took a card from their discard pile");
      renderSelf();
      broadcastState();
      closeModal();
    },
    { flat: true },
  );
}

function moveCard(source, target, opts) {
  opts = opts || {};
  // Sigil slot is a 1-card zone — refuse any move that would push a
  // second card into it. Done up front (before the source removal)
  // so the dragged card stays in its original place.
  if (target.type === "set" && self.set.length > 0) return;
  let card;
  // Any cards that travel WITH the primary (the parent's attached stack).
  // They go to the same destination as the parent and become unattached.
  let attachedCards = [];
  if (source.type === "hand") {
    const i = self.hand.findIndex((c) => c.id === source.cardId);
    if (i < 0) return;
    [card] = self.hand.splice(i, 1);
  } else if (source.type === "deckTop") {
    if (self.deck.length === 0) return;
    card = self.deck.shift();
  } else if (source.type === "discardTop") {
    if (self.discard.length === 0) return;
    card = self.discard.pop();
  } else if (source.type === "setTop") {
    if (self.set.length === 0) return;
    card = self.set.pop();
  } else if (source.type === "play") {
    const i = self.play.findIndex((c) => c.id === source.cardId);
    if (i < 0) return;
    [card] = self.play.splice(i, 1);
    if (card.attached && card.attached.length > 0) {
      attachedCards = card.attached.slice();
      delete card.attached;
    }
  }
  if (!card) return;

  // Strip transient play-only state from every card that's moving.
  for (const c of [card, ...attachedCards]) {
    delete c.x;
    delete c.y;
    delete c.rot;
    delete c.faceDown;
    delete c.counter;
  }

  if (target.type === "hand") {
    for (const a of attachedCards) self.hand.push(a);
    self.hand.push(card);
  } else if (target.type === "deckTop") {
    // Unshift attached first (each becomes the new top in turn), then the
    // parent on top of them. Final top-down order in the deck: parent,
    // attached[N-1], …, attached[0], <rest of deck>.
    for (let i = 0; i < attachedCards.length; i++)
      self.deck.unshift(attachedCards[i]);
    self.deck.unshift(card);
  } else if (target.type === "deckBottom") {
    for (const a of attachedCards) self.deck.push(a);
    self.deck.push(card);
  } else if (target.type === "discard") {
    for (const a of attachedCards) self.discard.push(a);
    self.discard.push(card);
  } else if (target.type === "set") {
    for (const a of attachedCards) self.set.push(a);
    self.set.push(card);
  } else if (target.type === "play") {
    card.x = opts.x;
    card.y = opts.y;
    self.play.push(card);
    // (extras into play would only happen if someone explicitly programs
    // it — drop them at the same spot, unattached.)
    for (const a of attachedCards) {
      a.x = opts.x;
      a.y = opts.y;
      self.play.push(a);
    }
  }

  const label =
    attachedCards.length > 0
      ? `${cardLabel(card)} (+${attachedCards.length} attached)`
      : cardLabel(card);
  log(`${describeAction(source.type, target.type)} ${label}`);
  notifyOpp(describeActionOpp(source.type, target.type));
  renderSelf();
  broadcastState();
}

function describeAction(s, t) {
  const m = {
    "hand-deckTop": "Put on top of deck:",
    "hand-deckBottom": "Sent to bottom of deck:",
    "hand-discard": "Discarded:",
    "hand-play": "Played:",
    "deckTop-hand": "Drew:",
    "deckTop-play": "Played from deck:",
    "deckTop-discard": "Discarded top of deck:",
    "discardTop-hand": "Returned to hand:",
    "discardTop-play": "Replayed from discard:",
    "discardTop-deckTop": "Returned to top of deck:",
    "play-hand": "Picked up from play:",
    "play-deckTop": "Returned to top of deck:",
    "play-deckBottom": "Sent to bottom of deck:",
    "play-discard": "Discarded from play:",
    "setTop-hand": "Moved from set to hand:",
    "setTop-play": "Played from set:",
    "setTop-discard": "Discarded from set:",
    "setTop-deckTop": "Returned to top of deck from set:",
    "setTop-deckBottom": "Sent to bottom of deck from set:",
  };
  return m[`${s}-${t}`] || "Moved:";
}
function describeActionOpp(s, t) {
  const m = {
    "hand-deckTop": "put a card on top of their deck",
    "hand-deckBottom": "sent a card to the bottom of their deck",
    "hand-discard": "discarded a card",
    "hand-play": "played a card",
    "deckTop-hand": "drew a card",
    "deckTop-play": "played a card from their deck",
    "deckTop-discard": "discarded top of their deck",
    "discardTop-hand": "returned a card to their hand",
    "discardTop-play": "replayed a card from discard",
    "discardTop-deckTop": "returned a card to the top of their deck",
    "play-hand": "picked up a card from play",
    "play-deckTop": "returned a card to top of deck",
    "play-deckBottom": "sent a card to bottom of deck",
    "play-discard": "discarded a card from play",
    "setTop-hand": "moved a card from their set pile to their hand",
    "setTop-play": "played a card from their set pile",
    "setTop-discard": "discarded a card from their set pile",
    "setTop-deckTop": "moved a card from their set pile to their deck",
    "setTop-deckBottom":
      "sent a card from their set pile to the bottom of their deck",
  };
  return m[`${s}-${t}`] || "moved a card";
}

// ============================================================
// DOM card rendering (hand, deck top, discard top — NOT play area)
// ============================================================
function cardEl(c, opts) {
  opts = opts || {};
  const div = document.createElement("div");
  div.className =
    "card" + (opts.small ? " small" : "") + (isRed(c) ? " red" : "");
  if (c.suit === "J") {
    div.classList.add("joker");
    const center = document.createElement("div");
    center.className = "center";
    center.textContent = c.rank === "RED" ? "RED ★" : "BLK ★";
    div.appendChild(center);
    const tl = document.createElement("div");
    tl.className = "corner";
    tl.textContent = "JKR";
    div.appendChild(tl);
    const br = document.createElement("div");
    br.className = "corner br";
    br.textContent = "JKR";
    div.appendChild(br);
  } else {
    const tl = document.createElement("div");
    tl.className = "corner";
    tl.innerHTML = c.rank + "<br>" + SUIT_SYMBOL[c.suit];
    div.appendChild(tl);
    const center = document.createElement("div");
    center.className = "center";
    center.textContent = SUIT_SYMBOL[c.suit];
    div.appendChild(center);
    const br = document.createElement("div");
    br.className = "corner br";
    br.innerHTML = c.rank + "<br>" + SUIT_SYMBOL[c.suit];
    div.appendChild(br);
  }
  return div;
}

function faceDownCardEl(opts) {
  opts = opts || {};
  const div = document.createElement("div");
  div.className = "card face-down" + (opts.small ? " small" : "");
  return div;
}

// ============================================================
// Drag system
// ----------
// Two paths:
//  - GHOST (DOM): hand wraps, deck top, discard top. A clone follows the
//    cursor; the source is hidden until drop.
//  - CANVAS: cards already drawn on the play canvas. State x,y updates and
//    the canvas redraws — no DOM elements involved.
// ============================================================

function findDropZone(under) {
  if (!under) return null;
  return under.closest(
    "#selfBoard, #selfDeckPile, #selfDiscardPile, #selfSetPile, #selfHand, .half.self .hand-row",
  );
}

function highlightDropZone(zoneEl) {
  document
    .querySelectorAll(".drag-over")
    .forEach((el) => el.classList.remove("drag-over"));
  if (zoneEl) zoneEl.classList.add("drag-over");
}

// ---------- GHOST drag (DOM sources) ----------
function attachGhostDrag(el, getSource) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button, input, .ctx-menu")) return;
    const source = getSource();
    if (!source) return;
    const r = el.getBoundingClientRect();
    drag = {
      kind: "ghost",
      el,
      source,
      offsetX: e.clientX - r.left,
      offsetY: e.clientY - r.top,
      startX: e.clientX,
      startY: e.clientY,
      cardW: r.width,
      cardH: r.height,
      started: false,
      ghost: null,
    };
    document.addEventListener("pointermove", onGhostMove);
    document.addEventListener("pointerup", onGhostUp);
    document.addEventListener("pointercancel", cancelGhost);
  });
}

function beginGhost(e) {
  drag.started = true;
  const ghost = drag.el.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.style.width = drag.cardW + "px";
  ghost.style.height = drag.cardH + "px";
  ghost.style.margin = "0";
  ghost.style.transform = "rotate(2deg)";
  ghost.style.left = e.clientX - drag.offsetX + "px";
  ghost.style.top = e.clientY - drag.offsetY + "px";
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  drag.el.classList.add("dragging-ghost-src");
  closeCtx();
}

function onGhostMove(e) {
  if (!drag || drag.kind !== "ghost") return;
  if (!drag.started) {
    const dx = e.clientX - drag.startX,
      dy = e.clientY - drag.startY;
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    beginGhost(e);
  }
  drag.ghost.style.left = e.clientX - drag.offsetX + "px";
  drag.ghost.style.top = e.clientY - drag.offsetY + "px";
  drag.ghost.style.display = "none";
  const under = document.elementFromPoint(e.clientX, e.clientY);
  drag.ghost.style.display = "";
  const dropZone = findDropZone(under);
  highlightDropZone(dropZone);
  // If the ghost is over the play canvas and overlaps another card, preview
  // an attach with the same green-outline indicator used during canvas drags.
  let newAttachTarget = null;
  if (dropZone && dropZone.id === "selfBoard") {
    const r = selfCanvas.getBoundingClientRect();
    const ghostLeft = parseFloat(drag.ghost.style.left) || 0;
    const ghostTop = parseFloat(drag.ghost.style.top) || 0;
    const cx = ghostLeft - r.left + (drag.cardW || CARD_W) / 2;
    const cy = ghostTop - r.top + (drag.cardH || CARD_H) / 2;
    const t = findOtherCardAt(cx, cy, drag.source && drag.source.cardId);
    if (t) newAttachTarget = t.id;
  }
  if (newAttachTarget !== attachTargetId) {
    attachTargetId = newAttachTarget;
    drawSelf();
  }
}

function onGhostUp(e) {
  if (!drag || drag.kind !== "ghost") return;
  if (drag.started) {
    drag.ghost.style.display = "none";
    const under = document.elementFromPoint(e.clientX, e.clientY);
    drag.ghost.style.display = "";
    const target = findDropZone(under);
    performGhostDrop(target);
    armClickSuppression();
  }
  cleanupGhost();
}

function cancelGhost() {
  cleanupGhost();
}

function performGhostDrop(targetEl) {
  if (!targetEl) return;
  const src = drag.source;
  if (targetEl.id === "selfBoard") {
    // selfBoard is a canvas. Convert ghost's viewport position → canvas-local
    // fractional coords for the card.
    const { w, h, rect } = boardSize(selfCanvas);
    const ghostLeft = parseFloat(drag.ghost.style.left) || 0;
    const ghostTop = parseFloat(drag.ghost.style.top) || 0;
    const left = ghostLeft - rect.left;
    const top = ghostTop - rect.top;
    // If the ghost is centered on another played card, attach to it
    // instead of just laying the new card down beside it.
    const cx = left + CARD_W / 2;
    const cy = top + CARD_H / 2;
    const attachTo = findOtherCardAt(cx, cy, src.cardId);
    if (attachTo) {
      moveCard(src, { type: "play" }, { x: attachTo.x, y: attachTo.y });
      attachCardToCard(src.cardId, attachTo.id);
      return;
    }
    const maxX = Math.max(0, w - CARD_W);
    const maxY = Math.max(0, h - CARD_H);
    const xf = Math.max(0, Math.min(maxX, left)) / w;
    const yf = Math.max(0, Math.min(maxY, top)) / h;
    moveCard(src, { type: "play" }, { x: xf, y: yf });
  } else if (targetEl.id === "selfDeckPile") {
    if (src.type === "deckTop") return;
    moveCard(src, { type: "deckTop" });
  } else if (targetEl.id === "selfDiscardPile") {
    if (src.type === "discardTop") return;
    moveCard(src, { type: "discard" });
  } else if (targetEl.id === "selfSetPile") {
    if (src.type === "setTop") return;
    moveCard(src, { type: "set" });
  } else {
    if (src.type === "hand") return;
    moveCard(src, { type: "hand" });
  }
}

function cleanupGhost() {
  if (drag) {
    if (drag.ghost) drag.ghost.remove();
    if (drag.el) drag.el.classList.remove("dragging-ghost-src");
  }
  highlightDropZone(null);
  if (attachTargetId != null) {
    attachTargetId = null;
    drawSelf();
  }
  document.removeEventListener("pointermove", onGhostMove);
  document.removeEventListener("pointerup", onGhostUp);
  document.removeEventListener("pointercancel", cancelGhost);
  drag = null;
}

// ---------- CANVAS drag (cards already on the play canvas) ----------
selfCanvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  hideTooltip();
  const rect = selfCanvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  // Hold P + click → ping the card (visible to both players).
  if (pKeyDown) {
    const card = hitTestPlay(px, py);
    if (card) {
      triggerPing("self", card.id);
      broadcastPing("self", card.id);
    }
    return;
  }
  // If the C-held counter widget is showing, route a click on its
  // buttons to adjust the counter. Don't fall through to drag while C
  // is held — release C first if you want to drag the card.
  if (cKeyDown && hoveredCardId !== null) {
    const ctrlCard = self.play.find((cc) => cc.id === hoveredCardId);
    if (ctrlCard) {
      const rects = counterWidgetRects(ctrlCard);
      if (pointInRect(px, py, rects.inc)) {
        ctrlCard.counter = (ctrlCard.counter || 0) + 1;
        drawSelf();
        broadcastState();
        return;
      }
      if (pointInRect(px, py, rects.dec)) {
        ctrlCard.counter = (ctrlCard.counter || 0) - 1;
        drawSelf();
        broadcastState();
        return;
      }
    }
    return;
  }
  const card = hitTestPlay(px, py);
  if (!card) return;
  bringCardToFront(card.id);
  const { w, h } = boardSize(selfCanvas);
  const cardCx = card.x * w + CARD_W / 2;
  const cardCy = card.y * h + CARD_H / 2;
  drag = {
    kind: "canvas",
    cardId: card.id,
    // Cursor offset from the card's CENTER (in canvas pixels). Using center
    // makes the drag math work cleanly even when the card is rotated.
    cursorOffCenterX: px - cardCx,
    cursorOffCenterY: py - cardCy,
    startCursorX: e.clientX,
    startCursorY: e.clientY,
    startX: card.x,
    startY: card.y,
    startRot: card.rot || 0,
    started: false,
  };
  document.addEventListener("pointermove", onCanvasMove);
  document.addEventListener("pointerup", onCanvasUp);
  document.addEventListener("pointercancel", cancelCanvas);
  drawSelf();
});

function onCanvasMove(e) {
  if (!drag || drag.kind !== "canvas") return;
  const dx = e.clientX - drag.startCursorX;
  const dy = e.clientY - drag.startCursorY;
  if (!drag.started) {
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    drag.started = true;
    closeCtx();
  }
  const card = self.play.find((c) => c.id === drag.cardId);
  if (!card) return;
  const rect = selfCanvas.getBoundingClientRect();
  const { w, h } = boardSize(selfCanvas);
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  if (rKeyDown) {
    // Rotate: pick the cardinal direction (N/E/S/W) the cursor sits in,
    // relative to the card's center, and snap rot to 0/90/180/270.
    // Inside a small dead zone around the center we hold the starting
    // rotation — otherwise tiny pixel wiggles near center flip between
    // the four quadrants and feel twitchy to new players.
    const cx = card.x * w + CARD_W / 2;
    const cy = card.y * h + CARD_H / 2;
    const ddx = px - cx,
      ddy = py - cy;
    const ROT_DEADZONE = Math.min(CARD_W, CARD_H) * 0.4;
    if (ddx * ddx + ddy * ddy < ROT_DEADZONE * ROT_DEADZONE) {
      card.rot = drag.startRot;
    } else if (Math.abs(ddx) > Math.abs(ddy)) {
      card.rot = ddx > 0 ? 90 : 270;
    } else {
      card.rot = ddy > 0 ? 180 : 0;
    }
  } else {
    // Move: keep cursor offset from the card's center constant.
    const newCx = px - drag.cursorOffCenterX;
    const newCy = py - drag.cursorOffCenterY;
    const newX = (newCx - CARD_W / 2) / w;
    const newY = (newCy - CARD_H / 2) / h;
    const maxXf = Math.max(0, 1 - CARD_W / w);
    const maxYf = Math.max(0, 1 - CARD_H / h);
    card.x = Math.max(0, Math.min(maxXf, newX));
    card.y = Math.max(0, Math.min(maxYf, newY));
  }
  // Update the attach-preview target: another card whose center the
  // dragged card currently overlaps. Skip while rotating (R held), and
  // skip if the dragged card is face-down (face-down cards can't be
  // attached as the child, just as they can't be the parent).
  if (!rKeyDown && !card.faceDown) {
    const cx = card.x * w + CARD_W / 2;
    const cy = card.y * h + CARD_H / 2;
    const t = findOtherCardAt(cx, cy, drag.cardId);
    attachTargetId = t ? t.id : null;
  } else {
    attachTargetId = null;
  }
  drawSelf();
  // Stream the new position to the opponent as a minimal delta so they
  // see smooth movement instead of a single snap at drop time, without
  // re-sending the whole game state on every pointer tick.
  broadcastDragMoveThrottled(card);

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const zone = findDropZone(under);
  highlightDropZone(zone && zone.id !== "selfBoard" ? zone : null);
}

function onCanvasUp(e) {
  if (!drag || drag.kind !== "canvas") return;
  const wasStarted = drag.started;
  const cardId = drag.cardId;
  document.removeEventListener("pointermove", onCanvasMove);
  document.removeEventListener("pointerup", onCanvasUp);
  document.removeEventListener("pointercancel", cancelCanvas);
  highlightDropZone(null);
  attachTargetId = null;
  // Cancel any pending throttled broadcast — we're about to send a final
  // broadcastState() with the committed position.
  if (broadcastTimer != null) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
  }
  if (dragBroadcastTimer != null) {
    clearTimeout(dragBroadcastTimer);
    dragBroadcastTimer = null;
  }

  if (!wasStarted) {
    // Click without drag → flip the card face up/down. Cards attached to
    // it flip in lockstep so a stack reads as a single object.
    const card = self.play.find((c) => c.id === cardId);
    if (card) {
      const next = !card.faceDown;
      card.faceDown = next;
      if (card.attached && card.attached.length > 0) {
        for (const a of card.attached) a.faceDown = next;
      }
      log(
        (next ? "Flipped face-down: " : "Flipped face-up: ") + cardLabel(card),
      );
      notifyOpp("flipped a card");
      drawSelf();
      broadcastState();
    }
    drag = null;
    return;
  }

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const zone = findDropZone(under);
  drag = null;
  if (zone && zone.id !== "selfBoard") {
    const src = { type: "play", cardId };
    if (zone.id === "selfDeckPile") moveCard(src, { type: "deckTop" });
    else if (zone.id === "selfDiscardPile") moveCard(src, { type: "discard" });
    else if (zone.id === "selfSetPile") moveCard(src, { type: "set" });
    else moveCard(src, { type: "hand" });
  } else {
    // Dropped within the canvas. If the dragged card now overlaps another
    // played card, attach to it. Otherwise just commit the new position.
    const rect = selfCanvas.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    // The dragged card was being positioned by cursor offset, so its
    // center is roughly at (cursor - cursorOffCenter). Hit-test that
    // point against the other played cards.
    const dragged = self.play.find((c) => c.id === cardId);
    let target = null;
    // Face-down cards can't attach to anything — flip face-up first.
    if (dragged && !dragged.faceDown) {
      const { w, h } = boardSize(selfCanvas);
      const draggedCx = (dragged.x + CARD_W / w / 2) * w;
      const draggedCy = (dragged.y + CARD_H / h / 2) * h;
      target = findOtherCardAt(draggedCx, draggedCy, cardId);
      // Fall back to the cursor position in case the user grabbed by an
      // off-center point.
      if (!target) target = findOtherCardAt(cursorX, cursorY, cardId);
    }
    if (target) {
      attachCardToCard(cardId, target.id);
    } else {
      drawSelf();
      broadcastState();
    }
  }
  armClickSuppression();
}

// Like hitTestPlay but skips a given cardId — used to look for an attach
// target while a card is being dropped.
function findOtherCardAt(px, py, excludeId) {
  const { w, h } = boardSize(selfCanvas);
  for (let i = self.play.length - 1; i >= 0; i--) {
    const c = self.play[i];
    if (c.id === excludeId) continue;
    // Face-down cards can't be attached to — must be flipped face-up
    // first. Skipping here also hides the green attach-preview outline
    // on face-down cards during drag.
    if (c.faceDown) continue;
    // Match the visible (scaled) footprint so the drag has to overlap
    // the target card you actually see.
    const halfW = (CARD_W * BOARD_CARD_SCALE) / 2;
    const halfH = (CARD_H * BOARD_CARD_SCALE) / 2;
    const cx = c.x * w + CARD_W / 2;
    const cy = c.y * h + CARD_H / 2;
    const rad = -((c.rot || 0) * Math.PI) / 180;
    const dx = px - cx,
      dy = py - cy;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (lx >= -halfW && lx < halfW && ly >= -halfH && ly < halfH) return c;
  }
  return null;
}

function cancelCanvas() {
  if (drag && drag.kind === "canvas") {
    const card = self.play.find((c) => c.id === drag.cardId);
    if (card) {
      card.x = drag.startX;
      card.y = drag.startY;
      card.rot = drag.startRot;
    }
  }
  document.removeEventListener("pointermove", onCanvasMove);
  document.removeEventListener("pointerup", onCanvasUp);
  document.removeEventListener("pointercancel", cancelCanvas);
  highlightDropZone(null);
  attachTargetId = null;
  drag = null;
  drawSelf();
}

function cleanupAnyDrag() {
  if (!drag) return;
  if (drag.kind === "ghost") cleanupGhost();
  else if (drag.kind === "canvas") cancelCanvas();
}

// Hover: outline + slight glow on the card under the cursor (self canvas only).
selfCanvas.addEventListener("pointermove", (e) => {
  if (drag) {
    hideTooltip();
    return;
  }
  const rect = selfCanvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const card = hitTestPlay(px, py);
  const newId = card ? card.id : null;
  // Default cursor; switch to "pointer" when over a counter button.
  let cursor = card ? "grab" : "default";
  if (cKeyDown && card) {
    const rects = counterWidgetRects(card);
    if (pointInRect(px, py, rects.inc) || pointInRect(px, py, rects.dec)) {
      cursor = "pointer";
    }
  }
  selfCanvas.style.cursor = cursor;
  if (newId !== hoveredCardId) {
    hoveredCardId = newId;
    drawSelf();
    if (card) {
      const id = card.id;
      scheduleTooltip(
        card,
        () => {
          const c = self.play.find((cc) => cc.id === id);
          return c ? playedCardScreenRect(selfCanvas, c) : null;
        },
        () => hoveredCardId === id,
      );
    }
  }
});
selfCanvas.addEventListener("pointerleave", () => {
  if (hoveredCardId !== null) {
    hoveredCardId = null;
    selfCanvas.style.cursor = "default";
    drawSelf();
  }
  hideTooltip();
});

// Hover on the opp canvas: show tooltips for revealed (face-up) opp cards.
// No glow/cursor change since the cards aren't interactive from here.
let oppHoveredCardId = null;
oppCanvas.addEventListener("pointermove", (e) => {
  if (drag) {
    hideTooltip();
    return;
  }
  const rect = oppCanvas.getBoundingClientRect();
  const { w, h } = boardSize(oppCanvas);
  // The opp canvas is CSS-rotated 180°, so flip the cursor before hit-testing.
  const px = w - (e.clientX - rect.left);
  const py = h - (e.clientY - rect.top);
  let card = null;
  for (let i = opp.play.length - 1; i >= 0; i--) {
    const c = opp.play[i];
    const cx = c.x * w + CARD_W / 2;
    const cy = c.y * h + CARD_H / 2;
    const rad = -((c.rot || 0) * Math.PI) / 180;
    const dx = px - cx,
      dy = py - cy;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (
      lx >= -CARD_W / 2 &&
      lx < CARD_W / 2 &&
      ly >= -CARD_H / 2 &&
      ly < CARD_H / 2
    ) {
      card = c;
      break;
    }
  }
  const newId = card ? card.id : null;
  if (newId !== oppHoveredCardId) {
    oppHoveredCardId = newId;
    if (card) {
      const id = card.id;
      scheduleTooltip(
        card,
        () => {
          const c = opp.play.find((cc) => cc.id === id);
          return c ? playedCardScreenRect(oppCanvas, c) : null;
        },
        () => oppHoveredCardId === id,
      );
    } else {
      hideTooltip();
    }
  }
});
oppCanvas.addEventListener("pointerleave", () => {
  oppHoveredCardId = null;
  hideTooltip();
});

// Click an opponent card → ping it (visible to both players). Pinging is
// the only interaction available for opp cards, so no modifier is needed.
oppCanvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const rect = oppCanvas.getBoundingClientRect();
  const { w, h } = boardSize(oppCanvas);
  // The opp canvas is CSS-rotated 180°, so flip the cursor before hit-testing.
  const px = w - (e.clientX - rect.left);
  const py = h - (e.clientY - rect.top);
  for (let i = opp.play.length - 1; i >= 0; i--) {
    const c = opp.play[i];
    const cx = c.x * w + CARD_W / 2;
    const cy = c.y * h + CARD_H / 2;
    const rad = -((c.rot || 0) * Math.PI) / 180;
    const dx = px - cx,
      dy = py - cy;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (
      lx >= -CARD_W / 2 &&
      lx < CARD_W / 2 &&
      ly >= -CARD_H / 2 &&
      ly < CARD_H / 2
    ) {
      triggerPing("opp", c.id);
      broadcastPing("opp", c.id);
      return;
    }
  }
});

// Schedule a tooltip after the hover delay. `getAnchorRect` is called when
// the timer fires so the position stays accurate if layout shifts.
// `isStillHovered` returns false to cancel the show.
function scheduleTooltip(card, getAnchorRect, isStillHovered) {
  hideTooltip();
  if (!card) return;
  const text = getCardTooltip(card);
  if (!text) return;
  tooltipTimer = setTimeout(() => {
    if (isStillHovered && !isStillHovered()) return;
    const rect = getAnchorRect();
    if (!rect) return;
    showTooltipAt(card, text, rect);
  }, TOOLTIP_DELAY_MS);
}

function showTooltipAt(card, text, anchorRect) {
  tooltipEl.innerHTML = "";
  const title = document.createElement("div");
  title.className = "tt-title";
  title.textContent = cardLabel(card);
  const body = document.createElement("div");
  body.textContent = text;
  tooltipEl.appendChild(title);
  tooltipEl.appendChild(body);

  tooltipEl.classList.add("visible");
  const tt = tooltipEl.getBoundingClientRect();
  let left = anchorRect.left + anchorRect.width / 2 - tt.width / 2;
  let top = anchorRect.top - tt.height - 10;
  if (top < 8) top = anchorRect.top + anchorRect.height + 10;
  left = Math.max(8, Math.min(window.innerWidth - tt.width - 8, left));
  tooltipEl.style.left = left + "px";
  tooltipEl.style.top = top + "px";
}

function hideTooltip() {
  if (tooltipTimer) {
    clearTimeout(tooltipTimer);
    tooltipTimer = null;
  }
  tooltipEl.classList.remove("visible");
}

// Attach hover-tooltip handlers to any DOM card element (a hand wrap, a
// search-deck/discard modal card, etc).
function attachCardTooltip(el, card) {
  let hovering = false;
  el.addEventListener("pointerenter", () => {
    hovering = true;
    if (drag) return;
    scheduleTooltip(
      card,
      () => el.getBoundingClientRect(),
      () => hovering,
    );
  });
  el.addEventListener("pointerleave", () => {
    hovering = false;
    hideTooltip();
  });
  el.addEventListener("pointerdown", () => {
    hovering = false;
    hideTooltip();
  });
}

// On-screen rect for a played card, accounting for the card's own rotation
// and the opp canvas's CSS 180° rotation.
function playedCardScreenRect(canvas, card) {
  const { w, h, rect } = boardSize(canvas);
  const isOpp = canvas === oppCanvas;
  let cx = card.x * w + CARD_W / 2;
  let cy = card.y * h + CARD_H / 2;
  if (isOpp) {
    cx = w - cx;
    cy = h - cy;
  }
  const effRot = ((((card.rot || 0) + (isOpp ? 180 : 0)) % 360) + 360) % 360;
  const landscape = effRot % 180 === 90;
  const halfW = landscape ? CARD_H / 2 : CARD_W / 2;
  const halfH = landscape ? CARD_W / 2 : CARD_H / 2;
  return {
    left: rect.left + cx - halfW,
    top: rect.top + cy - halfH,
    width: halfW * 2,
    height: halfH * 2,
  };
}

// Right-click on the canvas → hit-test and open the played-card menu.
selfCanvas.addEventListener("contextmenu", (e) => {
  const rect = selfCanvas.getBoundingClientRect();
  const card = hitTestPlay(e.clientX - rect.left, e.clientY - rect.top);
  e.preventDefault();
  hideTooltip();
  if (card) {
    openPlayCardContext(e.clientX, e.clientY, card);
  } else {
    openPlayBoardContext(e.clientX, e.clientY);
  }
});

// Empty-area right-click on the play canvas — board-level actions
// that affect all played cards at once.
function openPlayBoardContext(x, y) {
  closeCtx();
  buildCtx([
    { header: "Battlefield" },
    {
      label: "Untap Mana",
      onClick: untapFlippedCards,
    },
    {
      label: "Untap Everything",
      onClick: untapEverything,
    },
  ]);
  positionCtx(x, y);
}

function untapEverything() {
  let changed = false;
  for (const c of self.play) {
    if (c.rot) {
      c.rot = 0;
      changed = true;
    }

    if (c.attached) {
      for (const a of c.attached) {
        if (a.rot) {
          a.rot = 0;
          changed = true;
        }
      }
    }
  }
  if (!changed) return;

  drawSelf();
  saveLocalState();
  broadcastState();
}

function untapFlippedCards() {
  let changed = false;
  for (const c of self.play) {
    if (c.faceDown && c.rot) {
      c.rot = 0;
      changed = true;
    }
    if (c.attached) {
      for (const a of c.attached) {
        if (a.faceDown && a.rot) {
          a.rot = 0;
          changed = true;
        }
      }
    }
  }
  if (!changed) return;
  drawSelf();
  saveLocalState();
  broadcastState();
}

// ============================================================
// Render: DOM zones (deck, discard, hand) + canvases
// ============================================================
function renderSelf() {
  document.getElementById("selfDeckCount").textContent = self.deck.length;
  document.getElementById("selfDeckCounter").textContent =
    self.counters.deck || 0;
  const deckHost = document.querySelector("#selfDeckPile .card-host");
  deckHost.innerHTML = "";
  if (self.deck.length > 0) {
    const fd = faceDownCardEl();
    deckHost.appendChild(fd);
    attachGhostDrag(fd, () =>
      self.deck.length ? { type: "deckTop", cardId: self.deck[0].id } : null,
    );
  }

  document.getElementById("selfDiscardCount").textContent = self.discard.length;
  const discHost = document.querySelector("#selfDiscardPile .card-host");
  discHost.innerHTML = "";
  if (self.discard.length > 0) {
    const top = self.discard[self.discard.length - 1];
    const el = cardEl(top);
    discHost.appendChild(el);
    attachGhostDrag(el, () => {
      const t = self.discard[self.discard.length - 1];
      return t ? { type: "discardTop", cardId: t.id } : null;
    });
  }

  // "Set aside" pile — face-up top card with a count badge. The top
  // card is draggable to any other zone (same UX as discard).
  document.getElementById("selfSetCount").textContent = self.set.length;
  const setHost = document.querySelector("#selfSetPile .card-host");
  setHost.innerHTML = "";
  if (self.set.length > 0) {
    const top = self.set[self.set.length - 1];
    const el = cardEl(top);
    setHost.appendChild(el);
    attachGhostDrag(el, () => {
      const t = self.set[self.set.length - 1];
      return t ? { type: "setTop", cardId: t.id } : null;
    });
    attachCardTooltip(el, top);
  }

  const hand = document.getElementById("selfHand");
  // Remove only card-wraps so the hand-pip (count badge) stays in place.
  hand.querySelectorAll(".card-wrap").forEach((el) => el.remove());
  hand.classList.toggle("revealed", selfHandRevealed);
  document.getElementById("selfHandCount").textContent = self.hand.length;
  for (const c of self.hand) {
    const wrap = document.createElement("div");
    wrap.className = "card-wrap";
    wrap.appendChild(cardEl(c));
    attachGhostDrag(wrap, () => ({ type: "hand", cardId: c.id }));
    wrap.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openHandCardContext(e.clientX, e.clientY, c, wrap);
    });
    attachCardTooltip(wrap, c);
    hand.appendChild(wrap);
  }

  drawSelf();
}

function renderOpp() {
  document.getElementById("oppDeckCount").textContent = opp.deckCount;
  document.getElementById("oppDeckCounter").textContent =
    (opp.counters && opp.counters.deck) || 0;
  const dHost = document.querySelector("#oppDeckPile .card-host");
  dHost.innerHTML = "";
  if (opp.deckCount > 0) dHost.appendChild(faceDownCardEl());

  document.getElementById("oppDiscardCount").textContent = opp.discard.length;
  const discHost = document.querySelector("#oppDiscardPile .card-host");
  discHost.innerHTML = "";
  if (opp.discard.length > 0)
    discHost.appendChild(cardEl(opp.discard[opp.discard.length - 1]));

  document.getElementById("oppSetCount").textContent = opp.set.length;
  const oppSetHost = document.querySelector("#oppSetPile .card-host");
  oppSetHost.innerHTML = "";
  if (opp.set.length > 0) {
    const top = opp.set[opp.set.length - 1];
    const el = cardEl(top);
    oppSetHost.appendChild(el);
    attachCardTooltip(el, top);
  }

  const oh = document.getElementById("oppHand");
  oh.querySelectorAll(".card-wrap").forEach((el) => el.remove());
  document.getElementById("oppHandCount").textContent = opp.handCount;
  // If the opp chose to reveal their hand, render the actual cards
  // face-up (with tooltips). Otherwise fall back to N anonymous backs.
  const revealed = Array.isArray(opp.hand);
  oh.classList.toggle("revealed", revealed);
  const cards = revealed ? opp.hand : null;
  const n = revealed ? cards.length : opp.handCount;
  for (let i = 0; i < n; i++) {
    const w = document.createElement("div");
    w.className = "card-wrap";
    if (revealed) {
      const c = cards[i];
      w.appendChild(cardEl(c));
      attachCardTooltip(w, c);
    } else {
      w.appendChild(faceDownCardEl());
    }
    oh.appendChild(w);
  }
  drawOpp();
}

// ============================================================
// Right-click context menus
// ============================================================
const ctxMenu = document.getElementById("ctxMenu");
let ctxOpenWrap = null;

function closeCtx() {
  ctxMenu.classList.remove("open");
  ctxMenu.innerHTML = "";
  if (ctxOpenWrap) ctxOpenWrap.classList.remove("menu-open");
  ctxOpenWrap = null;
}

function buildCtx(items) {
  ctxMenu.innerHTML = "";
  buildCtxInto(ctxMenu, items);
}

// Recursive helper so items with `submenu: [...]` can render a nested
// menu inside the parent item. The submenu opens on hover (CSS-driven)
// and items inside it close the entire chain via closeCtx().
function buildCtxInto(container, items) {
  for (const it of items) {
    if (it.sep) {
      const s = document.createElement("div");
      s.className = "sep";
      container.appendChild(s);
    } else if (it.header) {
      const h = document.createElement("div");
      h.className = "header";
      h.textContent = it.header;
      container.appendChild(h);
    } else {
      const e = document.createElement("div");
      e.className = "item" + (it.disabled ? " disabled" : "");
      // Color preview rectangle, if any.
      if (it.swatch) {
        const sw = document.createElement("span");
        sw.className = "ctx-swatch";
        sw.style.background = it.swatch;
        e.appendChild(sw);
      }
      const lbl = document.createElement("span");
      lbl.className = "ctx-label";
      lbl.textContent = it.label;
      e.appendChild(lbl);
      if (it.submenu) {
        e.classList.add("has-submenu");
        const arrow = document.createElement("span");
        arrow.className = "ctx-arrow";
        arrow.textContent = "›";
        e.appendChild(arrow);
        const sub = document.createElement("div");
        sub.className = "ctx-submenu";
        buildCtxInto(sub, it.submenu);
        e.appendChild(sub);
        // Flip the submenu to the LEFT of the parent if opening to the
        // right would clip the viewport. Measured on first hover after
        // the submenu has a real layout.
        e.addEventListener("mouseenter", () => {
          const parentRect = e.getBoundingClientRect();
          // Temporarily reveal to measure, then restore so the existing
          // CSS-hover-driven open still works.
          const prevDisplay = sub.style.display;
          const prevVisibility = sub.style.visibility;
          sub.style.display = "flex";
          sub.style.visibility = "hidden";
          const subWidth = sub.offsetWidth;
          sub.style.display = prevDisplay;
          sub.style.visibility = prevVisibility;
          const overflowsRight =
            parentRect.right + subWidth > window.innerWidth - 4;
          e.classList.toggle("flip-left", overflowsRight);
          // Also flip up if the submenu would clip the bottom edge.
          const subHeight = sub.scrollHeight;
          const overflowsBottom =
            parentRect.top + subHeight > window.innerHeight - 4;
          e.classList.toggle("flip-up", overflowsBottom);
        });
      } else if (!it.disabled) {
        e.onclick = () => {
          it.onClick();
          closeCtx();
        };
      }
      container.appendChild(e);
    }
  }
}

function positionCtx(x, y) {
  ctxMenu.classList.add("open");
  const rect = ctxMenu.getBoundingClientRect();
  const vw = window.innerWidth,
    vh = window.innerHeight;
  ctxMenu.style.left = Math.min(x, vw - rect.width - 4) + "px";
  ctxMenu.style.top = Math.min(y, vh - rect.height - 4) + "px";
}

function centerPlayCoords() {
  const { w, h } = boardSize(selfCanvas);
  const maxXf = Math.max(0, 1 - CARD_W / w);
  const maxYf = Math.max(0, 1 - CARD_H / h);
  return { x: maxXf / 2, y: maxYf / 2 };
}

function openHandCardContext(x, y, card, wrap) {
  closeCtx();
  ctxOpenWrap = wrap;
  wrap.classList.add("menu-open");
  buildCtx([
    { header: cardLabel(card) },
    {
      label: "Play",
      onClick: () =>
        moveCard(
          { type: "hand", cardId: card.id },
          { type: "play" },
          centerPlayCoords(),
        ),
    },
    {
      label: "Discard",
      onClick: () =>
        moveCard({ type: "hand", cardId: card.id }, { type: "discard" }),
    },
    {
      label: "Put on top of deck",
      onClick: () =>
        moveCard({ type: "hand", cardId: card.id }, { type: "deckTop" }),
    },
    {
      label: "Send to bottom of deck",
      onClick: () =>
        moveCard({ type: "hand", cardId: card.id }, { type: "deckBottom" }),
    },
  ]);
  positionCtx(x, y);
}

// Right-click on the hand container itself (not a card) → toggle
// whether your hand is revealed to the opponent.
const selfHandEl = document.getElementById("selfHand");
selfHandEl.addEventListener("contextmenu", (e) => {
  // Cards inside the hand have their own contextmenu handler that
  // preventDefaults; this path only fires when the click misses a card.
  e.preventDefault();
  closeCtx();
  buildCtx([
    { header: "Hand" },
    {
      label: selfHandRevealed
        ? "Hide hand from opponent"
        : "Reveal hand to opponent",
      onClick: toggleHandReveal,
    },
  ]);
  positionCtx(e.clientX, e.clientY);
});

function toggleHandReveal() {
  selfHandRevealed = !selfHandRevealed;
  renderSelf();
  broadcastState();
}

function openPlayCardContext(x, y, card) {
  closeCtx();
  const items = [
    { header: cardLabel(card) + " (in play)" },
    {
      label: "Return to hand",
      onClick: () =>
        moveCard({ type: "play", cardId: card.id }, { type: "hand" }),
    },
    {
      label: "Discard",
      onClick: () =>
        moveCard({ type: "play", cardId: card.id }, { type: "discard" }),
    },
    {
      label: "Put on top of deck",
      onClick: () =>
        moveCard({ type: "play", cardId: card.id }, { type: "deckTop" }),
    },
    {
      label: "Send to bottom of deck",
      onClick: () =>
        moveCard({ type: "play", cardId: card.id }, { type: "deckBottom" }),
    },
  ];
  if (card.attached && card.attached.length > 0) {
    items.push({ sep: true });
    items.push({
      label: `Ungroup (${card.attached.length} attached)`,
      onClick: () => ungroupCard(card.id),
    });
  }
  buildCtx(items);
  positionCtx(x, y);
}

function openDeckContext(x, y) {
  closeCtx();
  buildCtx([
    { header: "Your deck" },
    // {
    //   label: "Draw (top → hand)",
    //   onClick: () => moveCard({ type: "deckTop" }, { type: "hand" }),
    //   disabled: self.deck.length === 0,
    // },
    {
      label: "Draw and choose…",
      onClick: openDrawMany,
      disabled: self.deck.length === 0,
    },
    {
      label: "Search…",
      onClick: searchDeck,
      disabled: self.deck.length === 0,
    },
    { label: "Shuffle", onClick: shuffleDeck, disabled: self.deck.length < 2 },
    { sep: true },
    {
      label: "Change color",
      swatch: ACCENT_PALETTES[selfPaletteName].cardBack,
      submenu: PALETTE_NAMES.map((name) => ({
        label: name.charAt(0).toUpperCase() + name.slice(1),
        swatch: ACCENT_PALETTES[name].cardBack,
        onClick: () => setSelfPalette(name),
      })),
    },
    ...(currentFormat === "fast"
      ? [{ label: "Edit Fast deck…", onClick: openFastFormatModal }]
      : []),
    { label: "Reset", onClick: newDeck },
  ]);
  positionCtx(x, y);
}

function openDiscardContext(x, y) {
  closeCtx();
  buildCtx([
    { header: "Your discard" },
    {
      label: "Search…",
      onClick: searchDiscard,
      disabled: self.discard.length === 0,
    },
    {
      label: "Return top to hand",
      onClick: () => moveCard({ type: "discardTop" }, { type: "hand" }),
      disabled: self.discard.length === 0,
    },
    // {
    //   label: "Shuffle into deck",
    //   onClick: discardToDeckShuffle,
    //   disabled: self.discard.length === 0,
    // },
  ]);
  positionCtx(x, y);
}

function openOppDiscardContext(x, y) {
  closeCtx();
  buildCtx([
    { header: "Opponent discard" },
    {
      label: "View pile…",
      onClick: () => viewDiscard(opp.discard, "Opponent's discard pile"),
      disabled: opp.discard.length === 0,
    },
  ]);
  positionCtx(x, y);
}

// ============================================================
// Pile click handlers (with drag suppression)
// ============================================================
function pileClick(handler) {
  return function (e) {
    if (suppressNextClick) {
      suppressNextClick = false;
      if (suppressNextClickTimer != null) {
        clearTimeout(suppressNextClickTimer);
        suppressNextClickTimer = null;
      }
      return;
    }
    e.stopPropagation();
    handler(e);
  };
}

// Deck counter +/- buttons (owner side only — opp counter has no buttons).
function bumpDeckCounter(delta) {
  self.counters.deck = (self.counters.deck || 0) + delta;
  log("HP: " + self.counters.deck);
  notifyOpp("set their HP to " + self.counters.deck);
  renderSelf();
  broadcastState();
}
document
  .querySelector("#selfDeckCounterUI [data-act='inc']")
  .addEventListener("click", (e) => {
    e.stopPropagation();
    bumpDeckCounter(1);
  });
document
  .querySelector("#selfDeckCounterUI [data-act='dec']")
  .addEventListener("click", (e) => {
    e.stopPropagation();
    bumpDeckCounter(-1);
  });

// C + scroll-wheel over a played card the owner controls → adjust the
// card's counter. We attach to selfCanvas (only the owner can edit).
selfCanvas.addEventListener(
  "wheel",
  (e) => {
    if (!cKeyDown) return;
    if (hoveredCardId === null) return;
    const card = self.play.find((c) => c.id === hoveredCardId);
    if (!card) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    card.counter = (card.counter || 0) + delta;
    drawSelf();
    broadcastState();
  },
  { passive: false },
);

document.getElementById("selfDeckPile").addEventListener(
  "click",
  pileClick(() => {
    if (self.deck.length) moveCard({ type: "deckTop" }, { type: "hand" });
  }),
);
document.getElementById("selfDeckPile").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  openDeckContext(e.clientX, e.clientY);
});

document.getElementById("selfDiscardPile").addEventListener(
  "click",
  pileClick(() => {
    if (self.discard.length) searchDiscard();
  }),
);
document
  .getElementById("selfDiscardPile")
  .addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openDiscardContext(e.clientX, e.clientY);
  });

document.getElementById("oppDiscardPile").addEventListener(
  "click",
  pileClick(() => {
    if (opp.discard.length) viewDiscard(opp.discard, "Opponent's discard pile");
  }),
);
document
  .getElementById("oppDiscardPile")
  .addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openOppDiscardContext(e.clientX, e.clientY);
  });

// Sigil slot — clicking your own opens the "Select Sigil" picker
// (the chosen card moves to the slot instead of the hand). The slot
// holds at most one card, so clicking it when it's already occupied
// does nothing — the player must drag the existing sigil out first
// to swap. Clicking opp's slot views their chosen sigil.
document.getElementById("selfSetPile").addEventListener(
  "click",
  pileClick(() => {
    if (self.set.length > 0) return;
    if (self.deck.length) searchDeckForSet();
  }),
);
document.getElementById("oppSetPile").addEventListener(
  "click",
  pileClick(() => {
    if (opp.set.length) viewDiscard(opp.set, "Opponent's sigil");
  }),
);

document.addEventListener("click", (e) => {
  if (e.target.closest(".ctx-menu")) return;
  closeCtx();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeCtx();
    closeModal();
    if (typeof closeGuide === "function") closeGuide();
    if (typeof closeFormatModal === "function") closeFormatModal();
    if (typeof closeChat === "function") closeChat();
    cleanupAnyDrag();
  }
});
window.addEventListener("contextmenu", (e) => {
  if (drag && drag.started) e.preventDefault();
});

// ============================================================
// Modal (search-deck / view-pile)
// ============================================================
function openModal(title, cards, onPick, opts) {
  opts = opts || {};
  // Bail out of any in-progress Draw-many session and restore the default
  // single-button footer.
  drawManyState = null;
  resetModalFooter();
  document.getElementById("modalTitle").textContent = title;
  const list = document.getElementById("modalList");
  list.innerHTML = "";
  list.style.minHeight = "";
  list.style.width = "";
  // `flat: true` skips the suit grouping and renders cards in the
  // caller-supplied order. Used for discard views, where pile order
  // matters more than suit organization.
  // `condensed: true` keeps the suit grouping + labels but drops the
  // fixed 14-column grid + rank divider — each suit just flex-wraps,
  // so the modal stays narrow when the cards are unevenly distributed.
  const flat = !!opts.flat;
  const condensed = !flat && !!opts.condensed;
  const renderCards = flat ? cards.slice() : cards.slice().sort(sortForView);
  if (renderCards.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--muted)";
    empty.style.fontStyle = "italic";
    empty.textContent = "Empty";
    list.appendChild(empty);
  } else if (flat) {
    const row = document.createElement("div");
    row.className = "suit-cards"; // reused as a generic flex-wrap row
    for (const c of renderCards) {
      const el = cardEl(c, { small: true });
      if (onPick) {
        el.classList.add("pickable");
        el.onclick = () => onPick(c);
      } else {
        el.style.cursor = "default";
      }
      attachCardTooltip(el, c);
      row.appendChild(el);
    }
    list.appendChild(row);
  } else {
    // Group by suit so the modal visually separates spades/hearts/diamonds/
    // clubs/jokers. `renderCards` is already sorted by suit then rank.
    const SUIT_NAMES = {
      S: "Spades",
      H: "Hearts",
      D: "Diamonds",
      C: "Clubs",
      J: "Jokers",
    };
    const isFaceOrAce = (r) => r === "A" || r === "J" || r === "Q" || r === "K";
    let currentSuit = null;
    let currentSection = null;
    let seenNumberInSuit = false;
    let dividerInsertedInSuit = false;
    for (const c of renderCards) {
      if (c.suit !== currentSuit) {
        currentSuit = c.suit;
        seenNumberInSuit = false;
        dividerInsertedInSuit = false;
        const group = document.createElement("div");
        group.className = "suit-group";
        const label = document.createElement("div");
        label.className =
          "suit-label" + (c.suit === "H" || c.suit === "D" ? " red" : "");
        const sym = document.createElement("span");
        sym.className = "sym";
        sym.textContent = SUIT_SYMBOL[c.suit] || "★";
        label.appendChild(sym);
        label.appendChild(document.createTextNode(SUIT_NAMES[c.suit] || ""));
        group.appendChild(label);
        currentSection = document.createElement("div");
        // Standard suits use a fixed 14-column grid (one column per
        // rank + a thin divider column) so face cards stay aligned
        // across suits even when number cards are missing. Jokers
        // keep the simple flex-wrap layout. `condensed` forces every
        // suit to flex-wrap so the modal stays narrow.
        currentSection.className =
          c.suit === "J" || condensed ? "suit-cards" : "suit-cards suit-grid";
        group.appendChild(currentSection);
        list.appendChild(group);
      }
      // Drop a thin divider between the number cards (2–10) and the
      // ace/face cards within a standard suit. Jokers have no numbers
      // so they're naturally skipped. Condensed view skips the divider
      // too since there's no fixed column alignment to anchor it to.
      if (
        c.suit !== "J" &&
        !condensed &&
        isFaceOrAce(c.rank) &&
        seenNumberInSuit &&
        !dividerInsertedInSuit
      ) {
        const divider = document.createElement("div");
        divider.className = "rank-divider";
        currentSection.appendChild(divider);
        dividerInsertedInSuit = true;
      }
      if (!isFaceOrAce(c.rank)) seenNumberInSuit = true;
      const el = cardEl(c, { small: true });
      if (onPick) {
        el.classList.add("pickable");
        el.onclick = () => onPick(c);
      } else {
        el.style.cursor = "default";
      }
      // Pin each card to its rank's column inside .suit-grid so missing
      // cards leave a gap, not a slide. Condensed view doesn't use the
      // grid, so no fixed column.
      if (c.suit !== "J" && !condensed)
        el.style.gridColumn = String(RANK_COL[c.rank]);
      attachCardTooltip(el, c);
      currentSection.appendChild(el);
    }
  }
  document.getElementById("modal").classList.add("open");
}

// View-only ordering: hearts, diamonds, spades, clubs, jokers. Within a
// suit, number cards 2–10 then ace, then jack, queen, king (ace sits
// with the face cards rather than at rank-1). RANK_COL pins each rank
// to a fixed column in the suit-grid layout so face cards stay aligned
// across suits even when number cards are missing — the divider sits
// at column 10.
const VIEW_SUIT_ORDER = { H: 0, D: 1, S: 2, C: 3, J: 4 };
const RANK_COL = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 7,
  9: 8,
  10: 9,
  A: 11,
  J: 12,
  Q: 13,
  K: 14,
};
const VIEW_RANK_ORDER = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "A",
  "J",
  "Q",
  "K",
];
function sortForView(a, b) {
  if (a.suit !== b.suit)
    return VIEW_SUIT_ORDER[a.suit] - VIEW_SUIT_ORDER[b.suit];
  if (a.suit === "J") return a.rank === "BLACK" ? -1 : 1;
  return VIEW_RANK_ORDER.indexOf(a.rank) - VIEW_RANK_ORDER.indexOf(b.rank);
}

function closeModal() {
  // If a "Draw many" session is open, closing the modal cancels it —
  // the revealed cards stay where they were (top of deck, untouched).
  if (drawManyState) drawManyState = null;
  resetModalFooter();
  document.getElementById("modal").classList.remove("open");
}

function resetModalFooter() {
  const footer = document.querySelector("#modal .footer");
  footer.innerHTML = '<button class="secondary" id="modalClose">Close</button>';
  document.getElementById("modalClose").onclick = closeModal;
}

// ============================================================
// Draw many — reveal cards off the top of the deck one at a time;
// click any to take it to hand; "Move rest to bottom" puts the
// unpicked revealed cards at the bottom of the deck and closes.
// Cancelling (Esc / Close) leaves everything in place.
// ----------
// We DON'T mutate self.deck while drawing — `revealed` mirrors the
// top N cards of the deck. Only `pick to hand` and `move rest to
// bottom` actually splice the deck.
// ============================================================
let drawManyState = null;

function openDrawMany() {
  if (self.deck.length === 0) return;
  drawManyState = { revealed: [] };
  renderDrawMany();
  document.getElementById("modal").classList.add("open");
}

function renderDrawMany() {
  if (!drawManyState) return;
  document.getElementById("modalTitle").textContent =
    "Click a card to move it into your hand";
  const list = document.getElementById("modalList");
  list.innerHTML = "";
  // Reserve a stable footprint so the footer buttons don't shift as
  // cards are revealed. Width is *pinned* (not just min-width) so the
  // row actually wraps at ~10 cards instead of letting the modal grow
  // sideways. Height covers 2 wrapped rows of small cards (76 + 6 gap +
  // 76 = 158) — enough for a normal draw-many session.
  list.style.width = "600px";
  list.style.minHeight = "160px";
  if (drawManyState.revealed.length === 0) {
    const hint = document.createElement("div");
    hint.style.color = "var(--muted)";
    hint.style.fontStyle = "italic";
    hint.textContent = 'No cards revealed yet — click "Draw card" to begin.';
    list.appendChild(hint);
  } else {
    // .suit-cards just gives us flex-wrap so the cards lay out
    // horizontally inside the (now flex-column) .deck-list container.
    const row = document.createElement("div");
    row.className = "suit-cards";
    for (const c of drawManyState.revealed) {
      const el = cardEl(c, { small: true });
      el.classList.add("pickable");
      el.onclick = () => drawManyPickToHand(c.id);
      attachCardTooltip(el, c);
      row.appendChild(el);
    }
    list.appendChild(row);
  }

  // Replace the footer with this flow's controls.
  const footer = document.querySelector("#modal .footer");
  footer.innerHTML = "";

  const drawBtn = document.createElement("button");
  drawBtn.type = "button";
  drawBtn.textContent = "Draw card";
  drawBtn.disabled =
    self.deck.length === drawManyState.revealed.length ||
    self.deck.length === 0;
  drawBtn.onclick = drawManyDrawOne;
  footer.appendChild(drawBtn);

  const bottomBtn = document.createElement("button");
  bottomBtn.type = "button";
  bottomBtn.className = "secondary";
  bottomBtn.textContent = "Move rest to bottom";
  bottomBtn.disabled = drawManyState.revealed.length === 0;
  bottomBtn.onclick = drawManyMoveRestToBottom;
  footer.appendChild(bottomBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = closeModal;
  footer.appendChild(cancelBtn);
}

function drawManyDrawOne() {
  if (!drawManyState) return;
  const idx = drawManyState.revealed.length;
  if (idx >= self.deck.length) return;
  drawManyState.revealed.push(self.deck[idx]);
  renderDrawMany();
}

function drawManyPickToHand(cardId) {
  if (!drawManyState) return;
  const ri = drawManyState.revealed.findIndex((c) => c.id === cardId);
  if (ri < 0) return;
  // `revealed` mirrors self.deck[0..revealed.length), so the same index
  // in the deck points to the same card.
  const [card] = self.deck.splice(ri, 1);
  drawManyState.revealed.splice(ri, 1);
  self.hand.push(card);
  log("Drew: " + cardLabel(card));
  notifyOpp("drew a card");
  renderSelf();
  broadcastState();
  renderDrawMany();
}

function drawManyMoveRestToBottom() {
  if (!drawManyState) return;
  const count = drawManyState.revealed.length;
  if (count > 0) {
    const moving = self.deck.splice(0, count);
    for (const c of moving) self.deck.push(c);
    log(`Sent ${count} card(s) to bottom of deck`);
    notifyOpp("moved cards to the bottom of their deck");
    renderSelf();
    broadcastState();
  }
  // Clear state BEFORE closeModal so its cancel branch is a no-op.
  drawManyState = null;
  closeModal();
}

document.getElementById("btnHost").onclick = host;
document.getElementById("btnJoin").onclick = join;
function rollD20() {
  const roll = 1 + Math.floor(Math.random() * 20);
  log("Rolled d20: " + roll);
  notifyOpp("rolled a d20: " + roll);
  // Also surface in the chat as a system message, and broadcast a
  // chat-formatted version to the opponent (they see "Opponent
  // rolled a d20: N").
  appendChatMessage("system", "You rolled a d20: " + roll, "roll-self");
  if (conn && conn.open) {
    conn.send({
      type: "chat",
      sender: "system",
      text: "Opponent rolled a d20: " + roll,
      // Receiver tags the row with this variant so it picks up the
      // opp's accent (we sent it, so from their side it's the opp).
      variant: "roll-opp",
    });
  }
}
// document.getElementById("btnRollD20").onclick = rollD20;

// End-turn: flip the active side locally and tell the opp. The wire
// value is from the receiver's perspective, so we send the inverse of
// our own new turn (we just ended → it's now "opp" for us, which is
// "self" for them). Exposed as a function so the button click and the
// spacebar shortcut can share one path. Bails when it's not your turn
// — you can only end your OWN turn, never grab the opp's.
function endTurn() {
  if (currentTurn !== "self") return;
  currentTurn = "opp";
  applyTurnVisual();
  saveLocalState();
  if (conn && conn.open) {
    conn.send({ type: "turnChange", turn: "self" });
  }
}
document.getElementById("btnEndTurn").onclick = endTurn;

function applyTurnVisual() {
  const selfHalf = document.querySelector(".half.self");
  const oppHalf = document.querySelector(".half.opp");
  if (selfHalf)
    selfHalf.classList.toggle("active-turn", currentTurn === "self");
  if (oppHalf) oppHalf.classList.toggle("active-turn", currentTurn === "opp");
  // End Turn button is only clickable on your own turn — disable it
  // (and the spacebar shortcut, via the endTurn guard below) the rest
  // of the time so you can't accidentally hand off the opp's turn.
  const btn = document.getElementById("btnEndTurn");
  if (btn) btn.disabled = currentTurn !== "self";
}

function receiveTurnChange(turn) {
  if (turn !== "self" && turn !== "opp") return;
  currentTurn = turn;
  applyTurnVisual();
  saveLocalState();
}

// Initial paint — the saved state may have started us on opp's turn,
// and the .half elements exist before this point in script load.
applyTurnVisual();

document.getElementById("modalClose").onclick = closeModal;
document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") closeModal();
});

// ============================================================
// Format selector
// ============================================================
const formatSelect = document.getElementById("formatSelect");
const formatModalEl = document.getElementById("formatModal");
const formatPremadesEl = document.getElementById("formatPremades");
const formatCardPickerEl = document.getElementById("formatCardPicker");
const formatCardCountEl = document.getElementById("formatCardCount");
const formatApplyBtn = document.getElementById("formatApply");
const formatClearBtn = document.getElementById("formatClearPick");
const formatExportBtn = document.getElementById("formatExport");
const formatImportBtn = document.getElementById("formatImport");
const formatDeckCodeEl = document.getElementById("formatDeckCode");
const formatShareStatusEl = document.getElementById("formatShareStatus");

// Reflect the persisted/current format in the dropdown on boot.
formatSelect.value = FORMATS[currentFormat] ? currentFormat : "full";

formatSelect.addEventListener("change", () => {
  const v = formatSelect.value;
  if (v === "full") {
    selectFullFormat();
  } else if (v === "fast") {
    openFastFormatModal();
  }
});

// Tracks the cards picked in the modal as a Set of "suit:rank" keys.
// Reset each time the modal opens from the last-applied deck so the
// player sees their previous selection.
const formatPickerSelection = new Set();

function specKey(c) {
  return c.suit + ":" + c.rank;
}
function specFromKey(k) {
  const [suit, rank] = k.split(":");
  return { suit, rank };
}

// All 54 unique cards (52 standard + 2 jokers), the deck the picker
// shows. Build once on first open and reuse.
let formatPickerAllCards = null;
function formatPickerAllCardsLazy() {
  if (formatPickerAllCards) return formatPickerAllCards;
  const cards = [];
  for (const suit of ["H", "D", "S", "C"]) {
    for (const rank of RANKS) cards.push({ suit, rank });
  }
  cards.push({ suit: "J", rank: "RED" });
  cards.push({ suit: "J", rank: "BLACK" });
  formatPickerAllCards = cards;
  return cards;
}

// Build the picker grid: standard suits in the same fixed 14-column
// grid the search-deck modal uses (so face cards align), jokers in a
// simple flex row.
function renderFormatCardPicker() {
  formatCardPickerEl.innerHTML = "";
  const SUIT_NAMES = {
    S: "Spades",
    H: "Hearts",
    D: "Diamonds",
    C: "Clubs",
    J: "Jokers",
  };
  const isFaceOrAce = (r) => r === "A" || r === "J" || r === "Q" || r === "K";
  const all = formatPickerAllCardsLazy();
  // Group by suit using VIEW_SUIT_ORDER so the order matches the
  // search-deck modal (hearts, diamonds, spades, clubs, jokers).
  const groups = { H: [], D: [], S: [], C: [], J: [] };
  for (const c of all) groups[c.suit].push(c);
  // Sort each suit by VIEW_RANK_ORDER for non-jokers.
  for (const suit of ["H", "D", "S", "C"]) {
    groups[suit].sort(
      (a, b) =>
        VIEW_RANK_ORDER.indexOf(a.rank) - VIEW_RANK_ORDER.indexOf(b.rank),
    );
  }
  for (const suit of ["H", "D", "S", "C", "J"]) {
    const cards = groups[suit];
    if (!cards || !cards.length) continue;
    const group = document.createElement("div");
    group.className = "suit-group";
    const label = document.createElement("div");
    label.className =
      "suit-label" + (suit === "H" || suit === "D" ? " red" : "");
    const sym = document.createElement("span");
    sym.className = "sym";
    sym.textContent = SUIT_SYMBOL[suit] || "★";
    label.appendChild(sym);
    label.appendChild(document.createTextNode(SUIT_NAMES[suit] || ""));
    group.appendChild(label);
    const row = document.createElement("div");
    row.className = "suit-cards" + (suit === "J" ? "" : " suit-grid");
    let seenNumber = false;
    let dividerInserted = false;
    for (const spec of cards) {
      // Drop a divider between number cards and ace/face within a
      // standard suit. Matches the search-deck modal.
      if (
        suit !== "J" &&
        isFaceOrAce(spec.rank) &&
        seenNumber &&
        !dividerInserted
      ) {
        const divider = document.createElement("div");
        divider.className = "rank-divider";
        row.appendChild(divider);
        dividerInserted = true;
      }
      if (!isFaceOrAce(spec.rank)) seenNumber = true;
      const cardObj = {
        id: "pick-" + spec.suit + "-" + spec.rank,
        suit: spec.suit,
        rank: spec.rank,
      };
      const el = cardEl(cardObj, { small: true });
      const key = specKey(spec);
      if (formatPickerSelection.has(key)) el.classList.add("picked");
      el.onclick = () => {
        if (formatPickerSelection.has(key)) {
          formatPickerSelection.delete(key);
          el.classList.remove("picked");
        } else {
          formatPickerSelection.add(key);
          el.classList.add("picked");
        }
        updateFormatCardCount();
      };
      attachCardTooltip(el, cardObj);
      if (suit !== "J") el.style.gridColumn = String(RANK_COL[spec.rank]);
      row.appendChild(el);
    }
    group.appendChild(row);
    formatCardPickerEl.appendChild(group);
  }
}

function openFastFormatModal() {
  // Populate the premade buttons.
  formatPremadesEl.innerHTML = "";
  for (const name of Object.keys(PREMADE_FAST_DECKS)) {
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.type = "button";
    btn.textContent = name;
    btn.onclick = () => {
      // Premades apply directly so users can start fast, but the
      // modal stays open so the player can tweak the selection
      // afterwards. Re-render the picker so the chosen cards show
      // their `picked` highlight, and refresh the count display.
      const specs = resolvePremadeDeck(PREMADE_FAST_DECKS[name]);
      if (!specs.length) return;
      formatPickerSelection.clear();
      for (const s of specs) formatPickerSelection.add(specKey(s));
      applyFastDeck(specs, name, specs.map(cardSpecToCode).join("\n"));
      renderFormatCardPicker();
      updateFormatCardCount();
    };
    formatPremadesEl.appendChild(btn);
  }
  // Prime the selection set from the last-applied deck text so the
  // modal reopens with the player's previous picks already toggled.
  formatPickerSelection.clear();
  if (lastFastDeckText) {
    const { cards } = parseDeckText(lastFastDeckText);
    for (const c of cards) formatPickerSelection.add(specKey(c));
  }
  renderFormatCardPicker();
  // updateFormatCardCount() also (re)populates the deck-code textbox
  // with the encoded current selection, so it always shows the live
  // code without the player needing to click Export first.
  updateFormatCardCount();
  // Clear any stale export/import status from last time.
  setFormatShareStatus("", null);
  formatModalEl.classList.add("open");
}

function closeFormatModal() {
  formatModalEl.classList.remove("open");
  // If the user cancelled or closed without applying, snap the select
  // back to whatever format is actually in effect (don't leave it
  // showing "Fast" when no Fast deck was applied).
  formatSelect.value = FORMATS[currentFormat] ? currentFormat : "full";
}

function updateFormatCardCount() {
  const n = formatPickerSelection.size;
  formatCardCountEl.textContent = `${n} / ${FAST_DECK_SIZE} cards`;
  const wrongSize = n !== FAST_DECK_SIZE && n > 0;
  formatCardCountEl.classList.toggle("error", wrongSize);
  formatApplyBtn.disabled = n === 0;
  // Keep the deck-code textbox in sync with the current picker
  // selection so the player can copy / share at any moment without
  // first clicking Export.
  formatDeckCodeEl.value = encodeFastDeck(
    Array.from(formatPickerSelection, specFromKey),
  );
}

formatApplyBtn.addEventListener("click", () => {
  if (formatPickerSelection.size === 0) return;
  const specs = Array.from(formatPickerSelection, specFromKey);
  applyFastDeck(
    specs,
    specs.length === FAST_DECK_SIZE
      ? "Custom"
      : `Custom (${specs.length} cards)`,
    specs.map(cardSpecToCode).join("\n"),
  );
  closeFormatModal();
});

formatClearBtn.addEventListener("click", () => {
  formatPickerSelection.clear();
  for (const el of formatCardPickerEl.querySelectorAll(".card.picked")) {
    el.classList.remove("picked");
  }
  updateFormatCardCount();
});

// Set the share-row status message with a flavour class. Empty `text`
// clears it. Auto-clears the ephemeral classes (ok/error) but leaves
// the text in case the user wants to read it.
let _formatShareStatusTimer = null;
function setFormatShareStatus(text, flavour) {
  formatShareStatusEl.textContent = text || "";
  formatShareStatusEl.classList.remove("ok", "error");
  if (flavour) formatShareStatusEl.classList.add(flavour);
  if (_formatShareStatusTimer != null) {
    clearTimeout(_formatShareStatusTimer);
    _formatShareStatusTimer = null;
  }
  if (text) {
    _formatShareStatusTimer = setTimeout(() => {
      formatShareStatusEl.classList.remove("ok", "error");
      _formatShareStatusTimer = null;
    }, 4000);
  }
}

formatExportBtn.addEventListener("click", () => {
  const specs = Array.from(formatPickerSelection, specFromKey);
  const code = encodeFastDeck(specs);
  formatDeckCodeEl.value = code;
  formatDeckCodeEl.focus();
  formatDeckCodeEl.select();
  // Best-effort copy to clipboard so the player can paste it anywhere.
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(code)
      .then(() => setFormatShareStatus("Copied to clipboard", "ok"))
      .catch(() =>
        setFormatShareStatus(
          `Exported ${specs.length} card${specs.length === 1 ? "" : "s"}`,
          "ok",
        ),
      );
  } else {
    setFormatShareStatus(
      `Exported ${specs.length} card${specs.length === 1 ? "" : "s"}`,
      "ok",
    );
  }
});

formatImportBtn.addEventListener("click", () => {
  const code = formatDeckCodeEl.value.trim();
  if (!code) {
    setFormatShareStatus("Paste a deck code first", "error");
    return;
  }
  const specs = decodeFastDeck(code);
  if (!specs) {
    setFormatShareStatus("Invalid deck code", "error");
    return;
  }
  formatPickerSelection.clear();
  for (const s of specs) formatPickerSelection.add(specKey(s));
  renderFormatCardPicker();
  updateFormatCardCount();
  setFormatShareStatus(
    `Imported ${specs.length} card${specs.length === 1 ? "" : "s"}`,
    "ok",
  );
});

document
  .getElementById("formatCancel")
  .addEventListener("click", closeFormatModal);
formatModalEl.addEventListener("click", (e) => {
  if (e.target === formatModalEl) closeFormatModal();
});

// ============================================================
// Chat panel
// ============================================================
// Floating collapsible chat. Sends `{ type: "chat", text }` over the
// data channel; receiver appends to the messages list and bumps an
// unread badge if the panel is collapsed.
const chatEl = document.getElementById("chat");
const chatHeaderBtn = document.getElementById("chatHeader");
const chatBadge = document.getElementById("chatBadge");
const chatMessagesEl = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
let chatUnread = 0;

function appendChatMessage(side, text, variant) {
  const row = document.createElement("div");
  row.className = "chat-message " + side;
  if (variant) row.classList.add(variant);
  if (side === "system") {
    // System events (dice rolls, etc.) — no "You/Opponent" label,
    // just a small icon + italic line so they read as game noise,
    // not chatter.
    const icon = document.createElement("span");
    icon.className = "chat-system-icon";
    icon.textContent = "🎲";
    const t = document.createElement("span");
    t.className = "chat-text";
    t.textContent = text;
    row.appendChild(icon);
    row.appendChild(t);
  } else {
    const sender = document.createElement("span");
    sender.className = "chat-sender";
    sender.textContent = side === "self" ? "You" : "Opponent";
    const t = document.createElement("span");
    t.className = "chat-text";
    t.textContent = text;
    row.appendChild(sender);
    row.appendChild(t);
  }
  chatMessagesEl.appendChild(row);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function setChatUnread(n) {
  chatUnread = n;
  // Badge is now a pure dot indicator (no count) — just show/hide.
  chatBadge.hidden = n === 0;
}

function openChat() {
  chatEl.classList.remove("collapsed");
  setChatUnread(0);
  // Defer focus + scroll until the panel has been laid out — while
  // collapsed the messages list has no height, so scrollHeight reads
  // as 0 and a synchronous scrollTop assignment is a no-op.
  setTimeout(() => {
    chatInput.focus();
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }, 0);
}

function closeChat() {
  chatEl.classList.add("collapsed");
}

function toggleChat() {
  if (chatEl.classList.contains("collapsed")) openChat();
  else closeChat();
}

function sendChatMessage(text) {
  text = text.trim();
  if (!text) return;
  appendChatMessage("self", text);
  if (conn && conn.open) {
    conn.send({ type: "chat", text });
  }
}

function receiveChatMessage(text, sender, variant) {
  text = String(text || "").slice(0, 1000);
  if (!text) return;
  const side = sender === "system" ? "system" : "opp";
  appendChatMessage(side, text, variant);
  if (chatEl.classList.contains("collapsed")) {
    setChatUnread(chatUnread + 1);
    playBoop();
  }
}

// Lazily-built AudioContext for the short "boop" we play when a chat
// message arrives with the panel collapsed. Browsers require a prior
// user gesture to unlock audio — by the time a peer message can arrive
// the user has already clicked/typed, so we can safely create it here.
let _boopCtx = null;
function playBoop() {
  try {
    if (!_boopCtx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      _boopCtx = new C();
    }
    const ctx = _boopCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(400, now);
    // Tiny ADSR: 8ms attack, ~180ms exponential decay. Peak gain is
    // intentionally quiet so it's a notification, not an alert.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (e) {}
}

// Top-level chat dispatch — slash commands are intercepted and never
// sent verbatim to the opp. Normal text falls through to sendChatMessage.
function submitChatInput(text) {
  text = text.trim();
  if (!text) return;
  if (text.startsWith("/")) handleChatCommand(text);
  else sendChatMessage(text);
}

function handleChatCommand(line) {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(" ").trim();
  switch (cmd) {
    case "/help":
      cmdHelp();
      break;
    case "/roll":
      cmdRoll();
      break;
    case "/win":
      cmdWin();
      break;
    case "/stats":
      cmdStats();
      break;
    case "/reset":
      cmdReset();
      break;
    case "/newgame":
      cmdNewGame();
      break;
    case "/myturn":
      cmdMyTurn();
      break;
    case "/format":
      cmdFormat(arg);
      break;
    case "/clear":
      cmdClear();
      break;
    default:
      appendChatMessage(
        "system",
        `Unknown command: ${cmd}. Type /help for the list.`,
      );
  }
}

function cmdHelp() {
  const lines = [
    "---",
    "/roll — roll a d20 (visible to both players)",
    "/win — record a win for this lobby",
    "/stats — show this lobby's score",
    "/reset — reset both boards and wins",
    "/newgame — reset both boards (keep wins/turn)",
    "/myturn — claim the current turn",
    "/format full — switch lobby to Full format",
    "/format fast — switch lobby to Fast format",
    "/clear — clear your local chat history",
    "/help — show this message",
    "---",
  ];
  for (const l of lines) appendChatMessage("system", l);
}

function cmdClear() {
  // Local-only — opp's history is theirs to manage.
  chatMessagesEl.innerHTML = "";
}

function cmdRoll() {
  // Call rollD20() directly — synthesizing a click on the button
  // would bubble up to the "click outside chat closes the panel"
  // handler and immediately close the chat after a /roll command.
  rollD20();
}

function statsLine() {
  // W–L per side. Your losses are the opp's wins (they won → you
  // lost); their losses are your wins. Both peers display the same
  // numbers in the same slots.
  return `You: ${selfWins}–${oppWins} · Opponent: ${oppWins}–${selfWins}`;
}

function cmdWin() {
  selfWins++;
  saveLocalState();
  appendChatMessage("system", `You won. ${statsLine()}`);
  if (conn && conn.open) {
    conn.send({ type: "winRecorded", wins: selfWins });
  }
}

function cmdStats() {
  appendChatMessage("system", statsLine());
}

function cmdReset() {
  selfWins = 0;
  oppWins = 0;
  selfHandRevealed = false;
  currentTurn = "self";
  applyTurnVisual();
  resetBoardKeepingFormat();
  saveLocalState();
  appendChatMessage("system", "Lobby state has been reset");
  if (conn && conn.open) {
    // Receiver flips to "opp" because the resetter (us) takes the
    // first turn — same convention as the End Turn button uses.
    conn.send({ type: "reset", turn: "opp" });
  }
}

// Reset only the board state — wins, turn, palette, format, chat, and
// hand-reveal flag are all preserved. Both sides reshuffle their deck.
function cmdNewGame() {
  resetBoardKeepingFormat();
  saveLocalState();
  appendChatMessage("system", "New game — boards reset");
  if (conn && conn.open) {
    conn.send({ type: "newgame" });
  }
}

// Claim the current turn. Sender becomes "self" turn locally, and the
// receiver flips to "opp" via the existing turnChange protocol.
function cmdMyTurn() {
  currentTurn = "self";
  applyTurnVisual();
  saveLocalState();
  appendChatMessage("system", "Made it their turn");
  if (conn && conn.open) {
    conn.send({ type: "turnChange", turn: "opp" });
  }
}

// Reset the board to a fresh shuffled deck while leaving the player's
// chosen format (and Fast deck list) intact. /reset uses this so wins
// reset to 0–0 without dragging a Fast-format player back to Full.
function resetBoardKeepingFormat() {
  if (currentFormat === "fast" && lastFastDeckText) {
    const { cards } = parseDeckText(lastFastDeckText);
    if (cards.length) {
      applyFastDeck(cards, "Fast", lastFastDeckText);
      return;
    }
  }
  newDeck();
}

function cmdFormat(arg) {
  const fmt = arg.toLowerCase();
  if (fmt === "full") {
    selectFullFormat();
    appendChatMessage("system", "Format set to Full");
    if (conn && conn.open) {
      conn.send({ type: "formatChange", format: "full" });
    }
  } else if (fmt === "fast") {
    formatSelect.value = "fast";
    openFastFormatModal();
    appendChatMessage("system", "Format set to Fast — choose a deck");
    if (conn && conn.open) {
      conn.send({ type: "formatChange", format: "fast" });
    }
  } else {
    appendChatMessage("system", "Usage: /format full | fast");
  }
}

function receiveWinRecorded(wins) {
  if (typeof wins !== "number") return;
  oppWins = wins;
  appendChatMessage("system", `Opponent won. ${statsLine()}`);
  if (chatEl.classList.contains("collapsed")) {
    setChatUnread(chatUnread + 1);
  }
}

function receiveFormatChange(format) {
  if (format === "full") {
    selectFullFormat();
    appendChatMessage("system", "Opponent switched to Full format");
  } else if (format === "fast") {
    formatSelect.value = "fast";
    openFastFormatModal();
    appendChatMessage(
      "system",
      "Opponent switched to Fast format — choose a deck",
    );
  }
  if (chatEl.classList.contains("collapsed")) {
    setChatUnread(chatUnread + 1);
  }
}

chatHeaderBtn.addEventListener("click", toggleChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const v = chatInput.value;
    chatInput.value = "";
    submitChatInput(v);
  } else if (e.key === "Escape") {
    chatInput.blur();
    closeChat();
  }
});
// Click outside the chat (panel or toggle) → close.
document.addEventListener("click", (e) => {
  if (chatEl.classList.contains("collapsed")) return;
  if (e.target.closest("#chat")) return;
  closeChat();
});

// Controls dropdown — same toggle + click-outside-to-close pattern as
// chat. Content is static, so there's no state to track beyond open/close.
const controlsMenuEl = document.getElementById("controlsMenu");
document.getElementById("controlsHeader").addEventListener("click", () => {
  controlsMenuEl.classList.toggle("collapsed");
});
document.addEventListener("click", (e) => {
  if (controlsMenuEl.classList.contains("collapsed")) return;
  if (e.target.closest("#controlsMenu")) return;
  controlsMenuEl.classList.add("collapsed");
});

// ============================================================
// Guide modal (image viewer with zoom + drag-to-pan)
// ============================================================
const guideModal = document.getElementById("guideModal");
const guideImg = document.getElementById("guideImage");
const guideContainer = document.getElementById("guideImageContainer");
const guideZoomLabel = document.getElementById("guideZoomLabel");
let guideZoom = 1;
// Saved scroll position across opens — populated when the modal closes
// and restored on the next open. `guideInitialized` tracks whether we've
// done the initial "Fit" once on first open.
let guideSavedScroll = null;
let guideInitialized = false;

function applyGuideZoom() {
  if (!guideImg.naturalWidth) return;
  guideImg.style.width = guideImg.naturalWidth * guideZoom + "px";
  guideImg.style.height = "auto";
  guideZoomLabel.textContent = Math.round(guideZoom * 100) + "%";
}

function fitGuideToContainer() {
  if (!guideImg.naturalWidth || !guideImg.naturalHeight) return;
  const cw = guideContainer.clientWidth - 4;
  const ch = guideContainer.clientHeight - 4;
  if (cw <= 0 || ch <= 0) return;
  const z = Math.min(
    cw / guideImg.naturalWidth,
    ch / guideImg.naturalHeight,
    1,
  );
  guideZoom = z > 0 ? z : 1;
  applyGuideZoom();
  guideContainer.scrollLeft = 0;
  guideContainer.scrollTop = 0;
}

function openGuide() {
  guideModal.classList.add("open");
  if (!guideImg.complete || !guideImg.naturalWidth) return;
  if (!guideInitialized) {
    fitGuideToContainer();
    guideInitialized = true;
  } else {
    applyGuideZoom();
    // Defer to the next frame so the modal has been laid out (and the
    // container has its real clientWidth/Height) before we restore scroll.
    requestAnimationFrame(() => {
      if (guideSavedScroll) {
        guideContainer.scrollLeft = guideSavedScroll.left;
        guideContainer.scrollTop = guideSavedScroll.top;
      }
    });
  }
}

function closeGuide() {
  // Stash the current scroll position so we can return to it next open.
  if (guideImg.complete && guideImg.naturalWidth) {
    guideSavedScroll = {
      left: guideContainer.scrollLeft,
      top: guideContainer.scrollTop,
    };
  }
  guideModal.classList.remove("open");
}

guideImg.addEventListener("load", () => {
  if (guideModal.classList.contains("open") && !guideInitialized) {
    fitGuideToContainer();
    guideInitialized = true;
  }
});

document.getElementById("btnGuide").onclick = openGuide;
document.getElementById("guideClose").onclick = closeGuide;
document.getElementById("guideZoomIn").onclick = () => {
  guideZoom = Math.min(8, guideZoom * 1.25);
  applyGuideZoom();
};
document.getElementById("guideZoomOut").onclick = () => {
  guideZoom = Math.max(0.1, guideZoom / 1.25);
  applyGuideZoom();
};
document.getElementById("guideZoomFit").onclick = fitGuideToContainer;
document.getElementById("guideOpenTab").onclick = () => {
  window.open("guide.png", "_blank", "noopener");
};
// Click the dim backdrop to close.
guideModal.addEventListener("click", (e) => {
  if (e.target === guideModal) closeGuide();
});

// Drag-to-pan inside the scrollable image container.
let guidePan = null;
guideContainer.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  guidePan = {
    x: e.clientX,
    y: e.clientY,
    sl: guideContainer.scrollLeft,
    st: guideContainer.scrollTop,
    id: e.pointerId,
  };
  guideContainer.setPointerCapture(e.pointerId);
  guideContainer.classList.add("grabbing");
});
guideContainer.addEventListener("pointermove", (e) => {
  if (!guidePan) return;
  guideContainer.scrollLeft = guidePan.sl - (e.clientX - guidePan.x);
  guideContainer.scrollTop = guidePan.st - (e.clientY - guidePan.y);
});
const endGuidePan = () => {
  if (!guidePan) return;
  try {
    guideContainer.releasePointerCapture(guidePan.id);
  } catch (_) {}
  guidePan = null;
  guideContainer.classList.remove("grabbing");
};
guideContainer.addEventListener("pointerup", endGuidePan);
guideContainer.addEventListener("pointercancel", endGuidePan);
guideContainer.addEventListener("pointerleave", endGuidePan);

// Ctrl+wheel zoom inside the guide container.
guideContainer.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    guideZoom = Math.max(0.1, Math.min(8, guideZoom * factor));
    applyGuideZoom();
  },
  { passive: false },
);

// ============================================================
// Bootstrap
// ============================================================
setupCanvases();
if (!tryRestoreSavedBoard()) {
  newDeck();
}
renderOpp();

// Restore the local board (deck/hand/play/discard/counters) from
// localStorage if a previous session is saved. Returns true if a
// restore happened; the caller falls back to newDeck() if not.
// Also re-seats `cardIdCounter` past the highest restored id so newly
// drawn cards don't collide with the restored ones.
function tryRestoreSavedBoard() {
  const saved = _savedForBoot;
  if (!saved || !Array.isArray(saved.deck)) return false;
  if (
    saved.deck.length +
      (saved.hand ? saved.hand.length : 0) +
      (saved.play ? saved.play.length : 0) +
      (saved.discard ? saved.discard.length : 0) +
      (saved.set ? saved.set.length : 0) ===
    0
  ) {
    // Nothing to restore — treat as a fresh boot so newDeck() runs.
    return false;
  }
  self.deck = saved.deck;
  self.hand = saved.hand || [];
  self.play = saved.play || [];
  self.discard = saved.discard || [];
  self.set = saved.set || [];
  self.counters = saved.counters || { deck: 30 };
  let maxId = 0;
  const bump = (list) => {
    for (const c of list || []) {
      const n = parseInt(String(c.id || "").slice(1), 10);
      if (!isNaN(n) && n > maxId) maxId = n;
      if (c.attached) bump(c.attached);
    }
  };
  bump(self.deck);
  bump(self.hand);
  bump(self.play);
  bump(self.discard);
  bump(self.set);
  if (maxId > cardIdCounter) cardIdCounter = maxId;
  log("Restored saved board (refresh-safe)");
  renderSelf();
  return true;
}

// If we landed here via a share link (`?join=PEER_ID`), auto-join.
// `autoJoining` tells join() to skip the fresh-deck reset so the
// player's restored board (loaded from localStorage above) survives
// the refresh.
(() => {
  const params = new URLSearchParams(window.location.search);
  const j = params.get("join");
  if (!j) return;
  document.getElementById("joinId").value = j;
  setTimeout(() => {
    autoJoining = true;
    Promise.resolve(join()).finally(() => {
      autoJoining = false;
    });
  }, 100);
})();
