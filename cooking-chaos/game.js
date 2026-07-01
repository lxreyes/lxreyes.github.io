/* ============================================================
   COOKING CHAOS — Order Rush
   A button-tapping race: an order pops up and you must pick the
   exact set of ingredients that build it, faster than the rival
   bots. Best total over 8 rounds wins.

   Pure DOM + buttons (no canvas). Core logic lives in plain
   top-level functions so it can be tested headlessly.
   ============================================================ */

/* ---------- Config ---------- */
// Plus mode: 12 rounds instead of 8 (longer race) and stiffer wrong-combo
// penalty. Bots are also faster (see BOT_SPEED_MULT below).
const TOTAL_ROUNDS = window.plusMode ? 12 : 8;
const PLACE_POINTS = [100, 60, 35, 15];
const WRONG_PENALTY = window.plusMode ? 1.2 : 0.6;
const BOT_SPEED_MULT = window.plusMode ? 1.35 : 1;
window.addEventListener('plusmode', function () { location.reload(); });
const CHAOS_NAMES = {
  shuffle: "Shuffling Shelves! 🔀",
  rush: "Rush Hour! ⚡ bots sped up",
  decoys: "Decoy Frenzy! 🎭 extra items",
  switch: "Fickle Customer! 🔄 order may change",
  jiggle: "Greasy Buttons! 🧈 they're slippery",
};

/* ---------- Content ---------- */
const COMPONENTS = {
  bun: { e: "🍞", n: "Bun" }, patty: { e: "🥩", n: "Patty" }, cheese: { e: "🧀", n: "Cheese" },
  lettuce: { e: "🥬", n: "Lettuce" }, tomato: { e: "🍅", n: "Tomato" }, fries: { e: "🍟", n: "Fries" },
  egg: { e: "🥚", n: "Egg" }, bacon: { e: "🥓", n: "Bacon" }, fish: { e: "🐟", n: "Fish" },
  rice: { e: "🍚", n: "Rice" }, noodles: { e: "🍜", n: "Noodles" }, tortilla: { e: "🫓", n: "Tortilla" },
  mushroom: { e: "🍄", n: "Mushroom" }, onion: { e: "🧅", n: "Onion" }, pickle: { e: "🥒", n: "Pickle" },
  corn: { e: "🌽", n: "Corn" }, avocado: { e: "🥑", n: "Avocado" }, beans: { e: "🫘", n: "Beans" },
  shrimp: { e: "🦐", n: "Shrimp" }, chicken: { e: "🍗", n: "Chicken" }, sausage: { e: "🌭", n: "Sausage" },
  icecream: { e: "🍨", n: "Ice Cream" }, choco: { e: "🍫", n: "Chocolate" }, straw: { e: "🍓", n: "Strawberry" },
  syrup: { e: "🍯", n: "Syrup" }, butter: { e: "🧈", n: "Butter" }, milk: { e: "🥛", n: "Milk" }, potato: { e: "🥔", n: "Potato" },
};
const MEALS = [
  { e: "🍔", n: "Burger Combo", items: ["bun", "patty", "cheese", "lettuce", "fries"] },
  { e: "🌮", n: "Taco", items: ["tortilla", "patty", "cheese", "lettuce", "tomato"] },
  { e: "🍕", n: "Pizza", items: ["bun", "tomato", "cheese", "mushroom", "bacon"] },
  { e: "🥗", n: "Garden Salad", items: ["lettuce", "tomato", "pickle", "corn", "cheese"] },
  { e: "🍣", n: "Sushi Plate", items: ["rice", "fish", "avocado", "shrimp"] },
  { e: "🌭", n: "Hot Dog", items: ["bun", "sausage", "onion", "tomato"] },
  { e: "🍜", n: "Ramen Bowl", items: ["noodles", "egg", "chicken", "onion"] },
  { e: "🥪", n: "Club Sandwich", items: ["bun", "bacon", "cheese", "lettuce", "tomato"] },
  { e: "🌯", n: "Burrito", items: ["tortilla", "rice", "beans", "cheese", "tomato"] },
  { e: "🍳", n: "Big Breakfast", items: ["egg", "bacon", "bun", "beans"] },
  { e: "🍝", n: "Pasta", items: ["noodles", "tomato", "cheese", "mushroom"] },
  { e: "🍨", n: "Sundae", items: ["icecream", "choco", "straw", "syrup"] },
  { e: "🍗", n: "Chicken Combo", items: ["chicken", "fries", "corn", "butter"] },
  { e: "🥞", n: "Pancakes", items: ["butter", "syrup", "straw", "milk"] },
  { e: "🍤", n: "Shrimp Fry", items: ["shrimp", "rice", "fries", "corn"] },
  { e: "🥔", n: "Loaded Potato", items: ["potato", "cheese", "bacon", "butter", "onion"] },
];
const BOT_DEFS = [
  { name: "Sizzle Bot", avatar: "🤖", skill: 0.82 },
  { name: "Chef Chip", avatar: "👾", skill: 1.0 },
  { name: "Sir Sear-a-Lot", avatar: "🦾", skill: 1.22 },
];

/* ---------- Helpers ---------- */
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- State ---------- */
const G = {
  phase: "menu",      // menu | playing | over
  round: 0,
  racers: [],         // [{id, name, avatar, you?, skill?, score, finishTime, progress, finished}]
  meal: null,
  pool: [],           // component ids shown as buttons this round
  selected: new Set(),
  elapsed: 0,
  penalty: 0,
  roundActive: false,
  over: false,
  // chaos
  chaos: null,
  shuffleTimer: 0,
  switchAt: 0,
  switched: false,
};

/* ---------- DOM refs (filled on init) ---------- */
const el = {};
function cache() {
  ["menu", "game", "gameover", "study", "recipe-list", "chaos-pill", "round-num", "round-total",
    "clock", "racers", "order-emoji", "order-name", "order-hint", "feedback", "ingredients",
    "round-result", "standings", "go-title"]
    .forEach((id) => (el[id] = typeof document !== "undefined" ? document.getElementById(id) : null));
}
function show(id) { if (el[id]) el[id].classList.remove("hidden"); }
function hide(id) { if (el[id]) el[id].classList.add("hidden"); }
function setText(id, t) { if (el[id]) el[id].textContent = t; }

/* ---------- Game flow ---------- */
function startGame() {
  G.phase = "playing"; G.round = 0; G.over = false;
  G.racers = [
    { id: "you", name: "You", avatar: "🧑‍🍳", you: true, score: 0 },
    ...BOT_DEFS.map((b, i) => ({ id: "bot" + i, name: b.name, avatar: b.avatar, skill: b.skill, score: 0 })),
  ];
  hide("menu"); hide("gameover"); show("game");
  if (el["round-total"]) setText("round-total", TOTAL_ROUNDS);
  nextRound();
}

function nextRound() {
  G.round++;
  if (G.round > TOTAL_ROUNDS) { finishGame(); return; }
  startRound();
}

function startRound() {
  G.meal = pick(MEALS);
  G.selected = new Set();
  G.elapsed = 0; G.penalty = 0; G.roundActive = true;

  // build the button pool: the correct items + distractors, shuffled
  const need = G.meal.items;
  const others = Object.keys(COMPONENTS).filter((k) => !need.includes(k));
  const distractorCount = clamp(need.length + 4, 8, 12) - need.length;
  G.pool = shuffle([...need, ...shuffle(others).slice(0, distractorCount)]);

  // bot finish times: faster each round, varied per bot personality
  const base = clamp(6.4 - G.round * 0.42, 2.6, 6.4);
  for (const r of G.racers) {
    if (r.you) { r.finishTime = null; r.finished = false; r.progress = 0; }
    else { r.finishTime = (base * r.skill * rand(0.85, 1.15) + need.length * 0.22) / BOT_SPEED_MULT; r.finished = false; r.progress = 0; }
  }

  setText("round-num", G.round);
  setupChaos();
  renderOrder(); renderButtons(); renderRacers();
}

/* ---------- Chaos ---------- */
function setupChaos() {
  G.chaos = null; G.shuffleTimer = 0; G.switchAt = 0; G.switched = false;
  if (el["chaos-pill"]) el["chaos-pill"].classList.add("hidden");
  setFeedback("");
  // chance ramps up with the round; rounds 1-2 are calm
  const chance = clamp((G.round - 2) * 0.2, 0, 0.85);
  if (Math.random() > chance) return;
  applyChaos(pick(["shuffle", "rush", "decoys", "switch", "jiggle"]));
}
function applyChaos(type) {
  G.chaos = type;
  if (type === "rush") { for (const r of G.racers) if (!r.you) r.finishTime *= 0.68; }
  else if (type === "decoys") {
    const have = new Set(G.pool);
    const extra = shuffle(Object.keys(COMPONENTS).filter((k) => !have.has(k))).slice(0, 3);
    G.pool = shuffle([...G.pool, ...extra]);
  }
  else if (type === "shuffle") G.shuffleTimer = 1.3;
  else if (type === "switch") G.switchAt = rand(1.3, 2.4);
  // (jiggle is purely cosmetic — handled in renderButtons)
  announceChaos();
}
function announceChaos() {
  if (el["chaos-pill"]) el["chaos-pill"].classList.remove("hidden");
  setFeedback("🌀 CHAOS: " + (CHAOS_NAMES[G.chaos] || ""), true);
  shakeOrder();
}
function switchOrder() {
  G.switched = true;
  let m = pick(MEALS); let guard = 0; while (m === G.meal && guard++ < 10) m = pick(MEALS);
  G.meal = m; G.selected = new Set();
  const need = m.items, others = Object.keys(COMPONENTS).filter((k) => !need.includes(k));
  const distractorCount = clamp(need.length + 4, 8, 12) - need.length;
  G.pool = shuffle([...need, ...shuffle(others).slice(0, distractorCount)]);
  renderOrder(); renderButtons();
  setFeedback("🔄 The customer changed their order!", true); shakeOrder();
}

/* ---------- Study mode ---------- */
function openStudy() { hide("menu"); show("study"); renderRecipes(); }
function closeStudy() { hide("study"); show("menu"); }
function renderRecipes() {
  const box = el["recipe-list"]; if (!box) return;
  box.innerHTML = MEALS.map((m) => {
    const chips = m.items.map((id) => `<span class="chip">${COMPONENTS[id].e} ${COMPONENTS[id].n}</span>`).join("");
    return `<div class="recipe">
        <div class="recipe-head"><span class="r-emoji">${m.e}</span><span class="r-name">${m.n}</span><span class="r-count">${m.items.length} items</span></div>
        <div class="chips">${chips}</div>
      </div>`;
  }).join("");
}

function toggleComponent(id) {
  if (!G.roundActive) return;
  if (G.selected.has(id)) G.selected.delete(id); else G.selected.add(id);
  renderButtons(); renderRacers();
  checkComplete();
}

function checkComplete() {
  const need = G.meal.items;
  if (G.selected.size !== need.length) { setFeedback(`${G.selected.size}/${need.length} picked`); return; }
  const correct = need.every((id) => G.selected.has(id));
  if (correct) { playerServe(); }
  else { G.penalty += WRONG_PENALTY; setFeedback("❌ Not the right combo!"); if (el["order-card"] || true) shakeOrder(); }
}

function playerServe() {
  if (!G.roundActive) return;
  G.roundActive = false;
  const you = G.racers.find((r) => r.you);
  you.finishTime = G.elapsed + G.penalty;
  you.finished = true; you.progress = 1;

  // every racer that hasn't actually finished still has a scheduled finishTime → rank everyone
  const order = [...G.racers].sort((a, b) => a.finishTime - b.finishTime);
  order.forEach((r, i) => { r.score += PLACE_POINTS[i] || 0; });
  const place = order.findIndex((r) => r.you);
  if (place === 0) you.score += Math.max(0, Math.round(50 - you.finishTime * 6)); // speed bonus for the win

  if (el["chaos-pill"]) el["chaos-pill"].classList.add("hidden");
  renderRacers();
  showRoundResult(place, you.finishTime);
  scheduleNext(1700);
}

let _nextTimer = null;
function scheduleNext(ms) { if (typeof setTimeout === "function") _nextTimer = setTimeout(() => { hide("round-result"); nextRound(); }, ms); }

function finishGame() {
  G.phase = "over"; G.over = true; G.roundActive = false;
  hide("game"); show("gameover");
  const order = [...G.racers].sort((a, b) => b.score - a.score);
  const youPlace = order.findIndex((r) => r.you) + 1;
  setText("go-title", youPlace === 1 ? "🏆 You won the showdown!" : `You finished #${youPlace}`);
  renderStandings(order);
}

/* ---------- Per-frame update (driven by rAF, or directly in tests) ---------- */
function update(dt) {
  if (!G.roundActive) return;
  G.elapsed += dt;
  for (const r of G.racers) {
    if (r.you || r.finished) continue;
    r.progress = clamp(G.elapsed / r.finishTime, 0, 1);
    if (G.elapsed >= r.finishTime) { r.finished = true; r.progress = 1; }
  }
  // chaos that plays out over time
  if (G.chaos === "shuffle") { G.shuffleTimer -= dt; if (G.shuffleTimer <= 0) { shuffle(G.pool); G.shuffleTimer = 1.3; renderButtons(); } }
  if (G.chaos === "switch" && !G.switched && G.elapsed >= G.switchAt) switchOrder();
}

/* ---------- Rendering ---------- */
function renderOrder() {
  setText("order-emoji", G.meal.e);
  setText("order-name", G.meal.n);
  if (el["order-hint"]) el["order-hint"].innerHTML = `Pick <b>${G.meal.items.length}</b> ingredients`;
}
function setFeedback(t, chaos) { setText("feedback", t || " "); if (el["feedback"]) el["feedback"].classList[chaos ? "add" : "remove"]("chaos"); }
function shakeOrder() {
  const card = typeof document !== "undefined" ? document.getElementById("order-card") : null;
  if (!card) return; card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
}
function renderButtons() {
  const box = el["ingredients"]; if (!box) return;
  box.innerHTML = "";
  G.pool.forEach((id, i) => {
    const c = COMPONENTS[id];
    const b = document.createElement("button");
    b.className = "ing" + (G.selected.has(id) ? " selected" : "") + (G.chaos === "jiggle" ? " jiggle" : "");
    b.innerHTML = `<span class="ing-emoji">${c.e}</span><span class="ing-name">${c.n}</span>`;
    b.addEventListener("click", () => toggleComponent(id));
    box.appendChild(b);
  });
}
function renderOneRacer(r) {
  const pct = r.you ? (G.meal ? Math.round((G.selected.size / G.meal.items.length) * 100) : 0) : Math.round((r.progress || 0) * 100);
  return `<div class="racer ${r.you ? "you" : ""} ${r.finished ? "finished" : ""}">
      <div class="racer-avatar">${r.avatar}</div>
      <div class="racer-mid">
        <div class="racer-name">${r.name}${r.finished && !r.you ? " ✅" : ""}</div>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="racer-score">${r.score}</div>
    </div>`;
}
function renderRacers() {
  if (el["racers"]) el["racers"].innerHTML = G.racers.map(renderOneRacer).join("");
}
function showRoundResult(place, time) {
  const labels = ["🥇 1st place!", "🥈 2nd place", "🥉 3rd place", "4th place"];
  const r = el["round-result"]; if (!r) return;
  r.innerHTML = `<div class="place">${labels[place] || "Served!"}</div><div class="pts">+${PLACE_POINTS[place] || 0} pts · ${time.toFixed(1)}s</div>`;
  r.classList.remove("hidden");
}
function renderStandings(order) {
  const box = el["standings"]; if (!box) return;
  const medals = ["🥇", "🥈", "🥉", "4️⃣"];
  box.innerHTML = order.map((r, i) => `<div class="standing ${r.you ? "you" : ""}">
      <div class="rank">${medals[i] || i + 1}</div>
      <div class="av">${r.avatar}</div>
      <div class="nm">${r.name}</div>
      <div class="sc">${r.score}</div>
    </div>`).join("");
}

/* ---------- Loop & input ---------- */
let _last = 0;
function loop(ts) {
  const dt = Math.min(0.05, (ts - _last) / 1000 || 0); _last = ts;
  if (G.roundActive) { update(dt); setText("clock", `⏱️ ${G.elapsed.toFixed(1)}s`); renderRacers(); }
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(loop);
}

function init() {
  cache();
  const sb = document.getElementById("start-btn"); if (sb) sb.addEventListener("click", startGame);
  const ab = document.getElementById("again-btn"); if (ab) ab.addEventListener("click", startGame);
  const stb = document.getElementById("study-btn"); if (stb) stb.addEventListener("click", openStudy);
  const skb = document.getElementById("study-back"); if (skb) skb.addEventListener("click", closeStudy);
  window.addEventListener("keydown", (e) => {
    if (G.phase !== "playing" || !G.roundActive) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9 && G.pool[n - 1]) { toggleComponent(G.pool[n - 1]); e.preventDefault(); }
  });
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(loop);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
