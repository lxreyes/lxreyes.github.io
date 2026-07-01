/* ============================================================
   engine.js — RULES for THE GAUNTLET, a hyperlinked slide-deck
   choose-your-adventure. Choices jump between slides; entering a
   slide applies its effects (lose/gain lives, suffering, eliminate
   a rival, grant a key, win, or die). No DOM here.
   ============================================================ */

(function () {
  "use strict";

const { AVATARS, CONTESTANTS, WHEEL, HOST, SLIDES, START } = window.GameData;

const SAVE_KEY = "gauntlet_slides_v1";
// Plus mode: harder run — start with 1 life instead of 3 and 4 rivals
// instead of 3. Reload when toggled so the new run starts fresh.
const START_LIVES = window.plusMode ? 1 : 3;
const RIVAL_COUNT = window.plusMode ? 4 : 3;
window.addEventListener('plusmode', function () { location.reload(); });

function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

const Game = {
  state: null,

  newGame(name, avatar) {
    const rivals = shuffle(CONTESTANTS.slice()).slice(0, RIVAL_COUNT).map((c) => ({ name: c.name, avatar: c.avatar, alive: true, you: false }));
    const you = { name: name || "You", avatar: avatar || AVATARS[0], lives: START_LIVES, suffering: 0, coins: 0, alive: true, you: true };
    this.state = { contestants: [you, ...rivals], slideId: START, visited: { [START]: true }, flags: {}, over: false, won: false };
    this.save();
    return this.state;
  },

  /* ----- accessors ----- */
  you() { return this.state.contestants[0]; },
  rivals() { return this.state.contestants.slice(1); },
  contestants() { return this.state.contestants; },
  aliveRivals() { return this.rivals().filter((c) => c.alive); },
  current() { return SLIDES[this.state.slideId]; },
  hasFlag(f) { return !!this.state.flags[f]; },
  isOver() { return this.state.over; },
  won() { return this.state.won; },
  hostLine(cat) { const a = HOST[cat] || []; return a.length ? randPick(a) : ""; },

  // Choices visible right now (gated by flags AND coin cost).
  availableChoices() {
    return this.current().choices.filter((c) =>
      (!c.requires || this.hasFlag(c.requires)) && (!c.cost || this.you().coins >= c.cost));
  },

  /* ----- life / suffering / coins / rivals ----- */
  loseLife(c, n) { c.lives -= (n || 1); if (c.lives <= 0) { c.lives = 0; c.alive = false; } },
  gainLife(c, n) { c.lives += (n || 1); },
  gainCoins(n) { this.you().coins = (this.you().coins || 0) + n; },
  spendCoins(n) { this.you().coins = Math.max(0, (this.you().coins || 0) - n); },
  suffer(c) { c.suffering = (c.suffering || 0) + 1; if (c.suffering >= 3) { c.suffering = 0; this.loseLife(c); return true; } return false; },
  eliminateRival() {
    const pool = this.aliveRivals();
    if (!pool.length) return null;
    const v = randPick(pool); v.alive = false; return v;
  },

  /* ----- navigate to a slide and apply its effects ----- */
  enter(id) {
    const s = SLIDES[id];
    if (!s) return null;
    this.state.slideId = id;
    this.state.visited[id] = true;
    const you = this.you();
    let eliminated = null;
    if (typeof s.life === "number") { if (s.life > 0) this.gainLife(you, s.life); else this.loseLife(you, -s.life); }
    if (typeof s.coins === "number") { if (s.coins > 0) this.gainCoins(s.coins); else this.spendCoins(-s.coins); }
    if (s.suffer) this.suffer(you);
    if (s.eliminateRival) eliminated = this.eliminateRival();
    if (s.set) this.state.flags[s.set] = true;
    if (s.win) { this.state.won = true; this.state.over = true; }
    if (s.kill) { you.lives = 0; you.alive = false; }
    if (!you.alive) this.state.over = true;
    this.save();
    return { slide: s, eliminated };
  },

  /* ----- the Wheel of Fate ----- */
  spinFateWheel() { const i = randInt(0, WHEEL.length - 1); return { index: i, seg: WHEEL[i] }; },
  applyWheelResult(seg) {
    const you = this.you();
    let eliminated = null;
    if (typeof seg.life === "number") { if (seg.life > 0) this.gainLife(you, seg.life); else this.loseLife(you, -seg.life); }
    if (seg.suffer) this.suffer(you);
    if (seg.eliminateRival) eliminated = this.eliminateRival();
    if (seg.kill) { you.lives = 0; you.alive = false; }
    if (!you.alive) this.state.over = true;
    this.save();
    return { eliminated };
  },

  /* ----- save / load ----- */
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); } catch (e) {} },
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.contestants) || !s.slideId || !SLIDES[s.slideId]) return false;
      this.state = s;
      return true;
    } catch (e) { return false; }
  },
  clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} },
};

window.GameEngine = { Game, SAVE_KEY };

})();
