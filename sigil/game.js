"use strict";

// ============================================================
// Constants
// ============================================================
const CARD_W = 70;
const CARD_H = 98;
const CARD_RADIUS = 6;
const DRAG_THRESHOLD_PX = 5;
const TOOLTIP_DELAY_MS = 250;

// ============================================================
// Per-card tooltips
// ----------
// Hover a card in the play area for ~1s to see its tooltip. Edit this
// table to attach notes/effects to specific cards. Keys are the card's
// display label, e.g. "K♥", "10♠", "Red Joker", "Black Joker".
// Multi-line strings are supported (newlines are preserved).
// ============================================================
const CARD_TOOLTIPS = {
  // Examples — uncomment / edit as needed:
  "A♠": "Spend X Power: Deal X damage to a unit or player. Discard",
  // "K♥": "King of Hearts\nHeals all allies by 5.",
  // "Red Joker": "Wild — counts as any card you choose.",
  // "Black Joker": "Negates the last action played.",
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
  play: [],
  counters: { deck: 30 },
};
const opp = {
  deckCount: 0,
  handCount: 0,
  discard: [],
  play: [],
  counters: { deck: 30 },
};

let peer = null;
let conn = null;
let drag = null;
let suppressNextClick = false;
let tKeyDown = false;
let cKeyDown = false;
let hoveredCardId = null;
let tooltipTimer = null;
const tooltipEl = document.getElementById("cardTooltip");

window.addEventListener("keydown", (e) => {
  if (e.key === "t" || e.key === "T") tKeyDown = true;
  if (e.key === "c" || e.key === "C") {
    if (!cKeyDown) {
      cKeyDown = true;
      drawSelf();
    }
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === "t" || e.key === "T") tKeyDown = false;
  if (e.key === "c" || e.key === "C") {
    if (cKeyDown) {
      cKeyDown = false;
      drawSelf();
    }
  }
});
window.addEventListener("blur", () => {
  tKeyDown = false;
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
  const rot = (card.rot || 0) + (opts.lifted ? 2 : 0);
  const hovered = !!opts.hovered && !opts.lifted;
  ctx.save();
  // Rotate around the card's center.
  ctx.translate(x + CARD_W / 2, y + CARD_H / 2);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  ctx.translate(-CARD_W / 2, -CARD_H / 2);
  // Shadow: blue glow on hover, deeper drop shadow when being dragged,
  // otherwise a subtle drop shadow.
  if (hovered) {
    ctx.shadowColor = "rgba(74, 158, 255, 0.9)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else {
    ctx.shadowColor = opts.lifted ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)";
    ctx.shadowBlur = opts.lifted ? 12 : 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = opts.lifted ? 6 : 2;
  }
  if (card.faceDown || !card.suit) {
    drawCardBack(ctx, 0, 0, hovered);
  } else {
    ctx.fillStyle = "#ffffff";
    roundRectPath(ctx, 0, 0, CARD_W, CARD_H, CARD_RADIUS);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = hovered ? "rgba(74, 158, 255, 0.85)" : "rgba(0,0,0,0.18)";
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.stroke();
    ctx.fillStyle = isRed(card) ? "#d04040" : "#1a1d23";
    if (card.suit === "J") drawJokerContent(ctx, card, 0, 0);
    else drawStandardContent(ctx, card, 0, 0);
  }
  if (card.counter != null && card.counter !== 0) {
    drawCardCounter(ctx, card.counter);
  }
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
  ctx.fillStyle = value > 0 ? "#4a9eff" : "#d04040";
  roundRectPath(ctx, bx, by, bw, bh, 9);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "white";
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
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "rgba(37, 41, 50, 0.97)";
  roundRectPath(ctx, r.left, r.top, r.w, r.h, 12);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(74, 158, 255, 0.6)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = "bold 16px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e6e8ec";
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
  ctx.fillStyle = "#e6e8ec";
  ctx.fillText(
    String(card.counter || 0),
    rects.value.left + rects.value.w / 2,
    rects.value.top + rects.value.h / 2 + 1,
  );
  ctx.restore();
}

function drawCardBack(ctx, x, y, hovered) {
  ctx.fillStyle = "#1e5a99";
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.fill();
  ctx.shadowColor = "transparent";
  // Diagonal stripes clipped to the rounded rect.
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.clip();
  ctx.strokeStyle = "#2d7fd6";
  ctx.lineWidth = 4;
  for (let i = -CARD_H; i < CARD_W + CARD_H; i += 8) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + CARD_H, y + CARD_H);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = hovered ? "rgba(74, 158, 255, 0.85)" : "#1a4477";
  ctx.lineWidth = 2;
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
  ctx.clearRect(0, 0, w, h);
  // Draw in order; the currently directly-dragged card is drawn last
  // (so it floats above the others) with a lifted effect.
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
    drawCard(ctx, c, c.x * w, c.y * h, { hovered: hoverId === c.id });
  }
  if (liftedCard) {
    drawCard(ctx, liftedCard, liftedCard.x * w, liftedCard.y * h, {
      lifted: true,
    });
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
    )
      return c;
  }
  return null;
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
  e.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(e);
  el.scrollTop = el.scrollHeight;
}

// PeerJS options — uses the default PeerJS Cloud broker. STUN servers help
// peers discover their public IPs so direct WebRTC connections can form.
const PEER_OPTS = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
    ],
  },
};

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

function host() {
  if (peer) peer.destroy();
  setStatus("Creating room…");
  peer = new Peer(PEER_OPTS);
  peer.on("open", (id) => {
    const link = hostLink(id);
    setStatus("Share the link below to invite your opponent", "connected");
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

function join() {
  const target = extractPeerId(document.getElementById("joinId").value);
  if (!target) return;
  if (peer) peer.destroy();
  setStatus("Connecting…");
  peer = new Peer(PEER_OPTS);
  peer.on("open", () => {
    log("Joining " + target);
    conn = peer.connect(target, { reliable: true });
    wireConn();
  });
  peer.on("error", (e) => logPeerError(e));
}

function logPeerError(e) {
  const type = (e && e.type) || "unknown";
  const detail = (e && e.message) ? ` — ${e.message}` : "";
  setStatus("Error: " + type, "error");
  log("Peer error [" + type + "]" + detail);
  // eslint-disable-next-line no-console
  console.error("[PeerJS error]", e);
}

function wireConn() {
  conn.on("open", () => {
    setStatus("Connected", "connected");
    log("Connection established");
    broadcastState();
  });
  conn.on("data", (data) => {
    if (data && data.type === "state") {
      opp.deckCount = data.deckCount;
      opp.handCount = data.handCount;
      opp.discard = data.discard;
      opp.play = data.play;
      opp.counters = data.counters || { deck: 0 };
      renderOpp();
    } else if (data && data.type === "log") {
      log("Opponent: " + data.message);
    }
  });
  conn.on("close", () => {
    setStatus("Disconnected", "error");
    log("Connection closed");
  });
}

function broadcastState() {
  if (!conn || !conn.open) return;
  // For face-down cards we hide the rank/suit from the opponent so they
  // can't peek by inspecting the wire data. The counter is still sent so
  // the opponent can see it (and any other table-visible per-card state).
  const playForOpp = self.play.map((c) =>
    c.faceDown
      ? {
          id: c.id,
          x: c.x,
          y: c.y,
          rot: c.rot || 0,
          faceDown: true,
          counter: c.counter,
        }
      : c,
  );
  conn.send({
    type: "state",
    deckCount: self.deck.length,
    handCount: self.hand.length,
    discard: self.discard,
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
  self.play = [];
  self.counters = { deck: 30 };
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

function viewDiscard(pile, title) {
  openModal(title, pile, null);
}

// Search your own discard pile — clicking a card in the modal moves it
// to your hand (mirrors searchDeck behaviour).
function searchDiscard() {
  openModal("Your discard pile — pick a card", self.discard, (c) => {
    const idx = self.discard.findIndex((x) => x.id === c.id);
    if (idx < 0) return;
    const [card] = self.discard.splice(idx, 1);
    self.hand.push(card);
    log("Took from discard: " + cardLabel(card));
    notifyOpp("took a card from their discard pile");
    renderSelf();
    broadcastState();
    closeModal();
  });
}

function moveCard(source, target, opts) {
  opts = opts || {};
  let card;
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
  } else if (source.type === "play") {
    const i = self.play.findIndex((c) => c.id === source.cardId);
    if (i < 0) return;
    [card] = self.play.splice(i, 1);
    delete card.x;
    delete card.y;
    delete card.rot;
    delete card.faceDown;
    delete card.counter;
  }
  if (!card) return;

  if (target.type === "hand") self.hand.push(card);
  else if (target.type === "deckTop") self.deck.unshift(card);
  else if (target.type === "deckBottom") self.deck.push(card);
  else if (target.type === "discard") self.discard.push(card);
  else if (target.type === "play") {
    card.x = opts.x;
    card.y = opts.y;
    self.play.push(card);
  }

  log(`${describeAction(source.type, target.type)} ${cardLabel(card)}`);
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
    "#selfBoard, #selfDeckPile, #selfDiscardPile, #selfHand, .half.self .hand-row",
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
  highlightDropZone(findDropZone(under));
}

function onGhostUp(e) {
  if (!drag || drag.kind !== "ghost") return;
  if (drag.started) {
    drag.ghost.style.display = "none";
    const under = document.elementFromPoint(e.clientX, e.clientY);
    drag.ghost.style.display = "";
    const target = findDropZone(under);
    performGhostDrop(target);
    suppressNextClick = true;
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

  if (tKeyDown) {
    // Rotate: pick the cardinal direction (N/E/S/W) the cursor sits in,
    // relative to the card's center, and snap rot to 0/90/180/270.
    const cx = card.x * w + CARD_W / 2;
    const cy = card.y * h + CARD_H / 2;
    const ddx = px - cx,
      ddy = py - cy;
    if (Math.abs(ddx) > Math.abs(ddy)) card.rot = ddx > 0 ? 90 : 270;
    else card.rot = ddy > 0 ? 180 : 0;
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
  drawSelf();

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

  if (!wasStarted) {
    // Click without drag → flip the card face up/down.
    const card = self.play.find((c) => c.id === cardId);
    if (card) {
      card.faceDown = !card.faceDown;
      log(
        (card.faceDown ? "Flipped face-down: " : "Flipped face-up: ") +
          cardLabel(card),
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
    else moveCard(src, { type: "hand" });
  } else {
    drawSelf();
    broadcastState();
  }
  suppressNextClick = true;
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

// Attach hover-tooltip handlers to a DOM card-wrap in the hand.
function attachHandTooltip(wrap, card) {
  let hovering = false;
  wrap.addEventListener("pointerenter", () => {
    hovering = true;
    if (drag) return;
    scheduleTooltip(
      card,
      () => wrap.getBoundingClientRect(),
      () => hovering,
    );
  });
  wrap.addEventListener("pointerleave", () => {
    hovering = false;
    hideTooltip();
  });
  wrap.addEventListener("pointerdown", () => {
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
  if (!card) return;
  e.preventDefault();
  hideTooltip();
  openPlayCardContext(e.clientX, e.clientY, card);
});

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

  const hand = document.getElementById("selfHand");
  hand.innerHTML = "";
  for (const c of self.hand) {
    const wrap = document.createElement("div");
    wrap.className = "card-wrap";
    wrap.appendChild(cardEl(c));
    attachGhostDrag(wrap, () => ({ type: "hand", cardId: c.id }));
    wrap.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openHandCardContext(e.clientX, e.clientY, c, wrap);
    });
    attachHandTooltip(wrap, c);
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

  const oh = document.getElementById("oppHand");
  oh.innerHTML = "";
  for (let i = 0; i < opp.handCount; i++) {
    const w = document.createElement("div");
    w.className = "card-wrap";
    w.appendChild(faceDownCardEl());
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
  for (const it of items) {
    if (it.sep) {
      const s = document.createElement("div");
      s.className = "sep";
      ctxMenu.appendChild(s);
    } else if (it.header) {
      const h = document.createElement("div");
      h.className = "header";
      h.textContent = it.header;
      ctxMenu.appendChild(h);
    } else {
      const e = document.createElement("div");
      e.className = "item" + (it.disabled ? " disabled" : "");
      e.textContent = it.label;
      if (!it.disabled)
        e.onclick = () => {
          it.onClick();
          closeCtx();
        };
      ctxMenu.appendChild(e);
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

function openPlayCardContext(x, y, card) {
  closeCtx();
  buildCtx([
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
  ]);
  positionCtx(x, y);
}

function openDeckContext(x, y) {
  closeCtx();
  buildCtx([
    { header: "Your deck" },
    {
      label: "Draw (top → hand)",
      onClick: () => moveCard({ type: "deckTop" }, { type: "hand" }),
      disabled: self.deck.length === 0,
    },
    {
      label: "Draw and choose…",
      onClick: openDrawMany,
      disabled: self.deck.length === 0,
    },
    { label: "Shuffle", onClick: shuffleDeck, disabled: self.deck.length < 2 },
    {
      label: "Search deck…",
      onClick: searchDeck,
      disabled: self.deck.length === 0,
    },
    { sep: true },
    { label: "Reset board", onClick: newDeck },
  ]);
  positionCtx(x, y);
}

function openDiscardContext(x, y) {
  closeCtx();
  buildCtx([
    { header: "Your discard" },
    {
      label: "Search pile…",
      onClick: searchDiscard,
      disabled: self.discard.length === 0,
    },
    {
      label: "Return top to hand",
      onClick: () => moveCard({ type: "discardTop" }, { type: "hand" }),
      disabled: self.discard.length === 0,
    },
    {
      label: "Shuffle into deck",
      onClick: discardToDeckShuffle,
      disabled: self.discard.length === 0,
    },
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
      return;
    }
    e.stopPropagation();
    handler(e);
  };
}

// Deck counter +/- buttons (owner side only — opp counter has no buttons).
function bumpDeckCounter(delta) {
  self.counters.deck = (self.counters.deck || 0) + delta;
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

document.addEventListener("click", (e) => {
  if (e.target.closest(".ctx-menu")) return;
  closeCtx();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeCtx();
    closeModal();
    cleanupAnyDrag();
  }
});
window.addEventListener("contextmenu", (e) => {
  if (drag && drag.started) e.preventDefault();
});

// ============================================================
// Modal (search-deck / view-pile)
// ============================================================
function openModal(title, cards, onPick) {
  // Bail out of any in-progress Draw-many session and restore the default
  // single-button footer.
  drawManyState = null;
  resetModalFooter();
  document.getElementById("modalTitle").textContent = title;
  const list = document.getElementById("modalList");
  list.innerHTML = "";
  const sorted = cards.slice().sort(sortForView);
  if (sorted.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--muted)";
    empty.style.fontStyle = "italic";
    empty.textContent = "Empty";
    list.appendChild(empty);
  }
  for (const c of sorted) {
    const el = cardEl(c, { small: true });
    if (onPick) {
      el.classList.add("pickable");
      el.onclick = () => onPick(c);
    } else el.style.cursor = "default";
    list.appendChild(el);
  }
  document.getElementById("modal").classList.add("open");
}

function sortForView(a, b) {
  const suitOrder = { S: 0, H: 1, D: 2, C: 3, J: 4 };
  if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
  if (a.suit === "J") return a.rank === "BLACK" ? -1 : 1;
  return RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank);
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
  if (drawManyState.revealed.length === 0) {
    const hint = document.createElement("div");
    hint.style.color = "var(--muted)";
    hint.style.fontStyle = "italic";
    hint.textContent = 'No cards revealed yet — click "Draw card" to begin.';
    list.appendChild(hint);
  } else {
    for (const c of drawManyState.revealed) {
      const el = cardEl(c, { small: true });
      el.classList.add("pickable");
      el.onclick = () => drawManyPickToHand(c.id);
      list.appendChild(el);
    }
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
document.getElementById("modalClose").onclick = closeModal;
document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") closeModal();
});

// ============================================================
// Bootstrap
// ============================================================
setupCanvases();
newDeck();
renderOpp();

// If we landed here via a share link (`?join=PEER_ID`), auto-join.
(() => {
  const params = new URLSearchParams(window.location.search);
  const j = params.get("join");
  if (!j) return;
  document.getElementById("joinId").value = j;
  // Defer slightly so PeerJS's cloud broker has a chance to be reachable.
  setTimeout(join, 100);
})();
