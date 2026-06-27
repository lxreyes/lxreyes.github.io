/* ============================================================
   ui.js — THE GAUNTLET as a hyperlinked slide deck. Each slide
   shows an illustration, the Host's line, and choices that jump
   to other slides. Plus the spinning Wheel of Fate, standings,
   and endings.
   ============================================================ */

(function () {
  "use strict";

const { Game } = window.GameEngine;
const { AVATARS, WHEEL } = window.GameData;
const Sfx = window.GameAudio;

const el = (id) => document.getElementById(id);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sfx = (n) => { if (Sfx) Sfx.play(n); };
let slideNum = 0;

/* ---------------- hand-drawn illustrations (SVG doodles) ---------------- */
const D = (inner) => `<svg viewBox="0 0 120 80" class="doodle"><g fill="none" stroke="#222" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${inner}</g></svg>`;
const IMAGES = {
  gate: D('<rect x="20" y="30" width="80" height="40" fill="#fff"/><path d="M20 30 Q60 8 100 30"/><rect x="30" y="42" width="16" height="28" fill="#f2c14e"/><rect x="52" y="42" width="16" height="28" fill="#4a90d9"/><rect x="74" y="42" width="16" height="28" fill="#e4572e"/><line x1="8" y1="70" x2="112" y2="70"/>'),
  doors: D('<line x1="6" y1="68" x2="114" y2="68"/><rect x="12" y="22" width="20" height="46" rx="3" fill="#e4572e"/><circle cx="28" cy="46" r="2" fill="#222"/><rect x="38" y="22" width="20" height="46" rx="3" fill="#4a90d9"/><circle cx="54" cy="46" r="2" fill="#222"/><rect x="64" y="22" width="20" height="46" rx="3" fill="#3aa757"/><circle cx="80" cy="46" r="2" fill="#222"/><rect x="90" y="22" width="20" height="46" rx="3" fill="#f2c14e"/><circle cx="106" cy="46" r="2" fill="#222"/>'),
  spikes: D('<line x1="6" y1="64" x2="114" y2="64"/><path d="M14 64 L24 32 L34 64Z M40 64 L50 36 L60 64Z M66 64 L76 30 L86 64Z M92 64 L100 38 L108 64Z" fill="#e4572e"/>'),
  trapdoor: D('<line x1="6" y1="40" x2="114" y2="40"/><rect x="34" y="40" width="52" height="34" fill="#241a10"/><path d="M34 40 L50 22 L92 22 L88 38" fill="#a07b4a"/><path d="M60 48 L60 64 M52 56 L60 66 L68 56" stroke="#fff"/>'),
  bridge: D('<rect x="0" y="60" width="20" height="18" fill="#7a6645"/><rect x="100" y="60" width="20" height="18" fill="#7a6645"/><path d="M20 74 q8 -7 16 0 t16 0 t16 0 t16 0 t16 0" stroke="#e4572e"/><path d="M20 78 q8 -7 16 0 t16 0 t16 0 t16 0 t16 0" stroke="#f2c14e"/><line x1="20" y1="56" x2="100" y2="56"/><line x1="28" y1="56" x2="28" y2="64"/><line x1="40" y1="56" x2="40" y2="64"/><line x1="52" y1="56" x2="52" y2="64"/><line x1="64" y1="56" x2="64" y2="64"/><line x1="76" y1="56" x2="76" y2="64"/><line x1="88" y1="56" x2="88" y2="64"/>'),
  lavafall: D('<path d="M0 60 q15 -8 30 0 t30 0 t30 0 t30 0" stroke="#e4572e"/><path d="M0 66 q15 -8 30 0 t30 0 t30 0 t30 0" stroke="#f2c14e"/><circle cx="60" cy="24" r="6" fill="#fff"/><line x1="60" y1="30" x2="60" y2="44"/><line x1="60" y1="34" x2="48" y2="28"/><line x1="60" y1="34" x2="72" y2="28"/><line x1="60" y1="44" x2="52" y2="54"/><line x1="60" y1="44" x2="68" y2="54"/>'),
  goblin: D('<rect x="14" y="56" width="92" height="18" fill="#7a6645"/><path d="M42 30 q18 -22 36 0 q6 16 -18 20 q-24 -4 -18 -20Z" fill="#3aa757"/><path d="M44 28 L32 18 L46 26" fill="#3aa757"/><path d="M76 28 L88 18 L74 26" fill="#3aa757"/><circle cx="53" cy="32" r="2.6" fill="#222"/><circle cx="67" cy="32" r="2.6" fill="#222"/><path d="M52 40 q8 6 16 0"/>'),
  potion: D('<rect x="52" y="14" width="16" height="10" fill="#7a6645"/><path d="M54 24 L54 36 L40 64 q20 14 40 0 L66 36 L66 24Z" fill="#9b5de5"/><circle cx="52" cy="52" r="2.5" fill="#fff" stroke="none"/><circle cx="62" cy="48" r="2" fill="#fff" stroke="none"/>'),
  signpost: D('<line x1="60" y1="20" x2="60" y2="72"/><path d="M60 28 L32 28 L26 34 L32 40 L60 40Z" fill="#f2c14e"/><path d="M60 44 L88 44 L94 50 L88 56 L60 56Z" fill="#4a90d9"/><line x1="48" y1="74" x2="72" y2="74"/>'),
  wheel: D('<circle cx="60" cy="44" r="30" fill="#fff"/><path d="M60 14 A30 30 0 0 1 90 44 L60 44Z" fill="#f2c14e"/><path d="M90 44 A30 30 0 0 1 60 74 L60 44Z" fill="#e4572e"/><path d="M60 74 A30 30 0 0 1 30 44 L60 44Z" fill="#4a90d9"/><path d="M30 44 A30 30 0 0 1 60 14 L60 44Z" fill="#3aa757"/><circle cx="60" cy="44" r="4" fill="#222"/><path d="M60 8 L54 18 L66 18Z" fill="#222"/>'),
  monster: D('<line x1="4" y1="62" x2="116" y2="62"/><path d="M32 62 q-8 -42 28 -42 q36 0 28 42Z" fill="#9b5de5"/><circle cx="50" cy="36" r="5" fill="#fff"/><circle cx="70" cy="36" r="5" fill="#fff"/><circle cx="50" cy="37" r="2" fill="#222" stroke="none"/><circle cx="70" cy="37" r="2" fill="#222" stroke="none"/><path d="M46 48 L52 56 L58 48 L64 56 L70 48" fill="#fff"/>'),
  key: D('<circle cx="38" cy="40" r="14" fill="#f2c14e"/><circle cx="38" cy="40" r="5" fill="#fff"/><rect x="50" y="36" width="44" height="8" fill="#f2c14e"/><rect x="82" y="44" width="6" height="10" fill="#f2c14e"/><rect x="90" y="44" width="6" height="12" fill="#f2c14e"/><path d="M104 16 l3 6 6 3 -6 3 -3 6 -3 -6 -6 -3 6 -3Z" fill="#fff"/>'),
  chests: D('<line x1="6" y1="70" x2="114" y2="70"/><rect x="14" y="46" width="26" height="22" fill="#7a6645"/><path d="M14 46 q13 -12 26 0" fill="#a07b4a"/><rect x="23" y="52" width="8" height="8" fill="#f2c14e"/><rect x="47" y="46" width="26" height="22" fill="#7a6645"/><path d="M47 46 q13 -12 26 0" fill="#a07b4a"/><rect x="56" y="52" width="8" height="8" fill="#f2c14e"/><rect x="80" y="46" width="26" height="22" fill="#7a6645"/><path d="M80 46 q13 -12 26 0" fill="#a07b4a"/><rect x="89" y="52" width="8" height="8" fill="#f2c14e"/>'),
  trophy: D('<path d="M44 20 H76 V32 q0 16 -16 16 q-16 0 -16 -16Z" fill="#f2c14e"/><path d="M44 24 q-12 0 -12 10 q0 8 12 9"/><path d="M76 24 q12 0 12 10 q0 8 -12 9"/><rect x="56" y="48" width="8" height="10" fill="#f2c14e"/><rect x="46" y="58" width="28" height="8" fill="#a07b4a"/><path d="M28 14 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2Z" fill="#e4572e" stroke="none"/><path d="M92 12 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2Z" fill="#4a90d9" stroke="none"/>'),
  skull: D('<path d="M38 26 q22 -18 44 0 q9 13 1 27 l-7 6 -7 0 -4 7 -4 -7 -7 0 -7 -6 q-8 -14 1 -27Z" fill="#fff"/><circle cx="50" cy="42" r="6" fill="#222"/><circle cx="70" cy="42" r="6" fill="#222"/><path d="M58 50 L60 56 L62 50Z" fill="#222"/><line x1="52" y1="64" x2="52" y2="70"/><line x1="60" y1="64" x2="60" y2="72"/><line x1="68" y1="64" x2="68" y2="70"/>'),
  coin: D('<circle cx="60" cy="40" r="24" fill="#f2c14e"/><circle cx="60" cy="40" r="18" fill="none"/><path d="M60 26 l4 9 10 1 -7 7 2 10 -9 -5 -9 5 2 -10 -7 -7 10 -1Z" fill="#fff"/>'),
  casino: D('<rect x="30" y="20" width="56" height="48" rx="6" fill="#e4572e"/><rect x="36" y="30" width="44" height="18" fill="#fff"/><line x1="50.6" y1="30" x2="50.6" y2="48"/><line x1="65.3" y1="30" x2="65.3" y2="48"/><text x="43" y="45" font-size="13" font-weight="700" fill="#222" stroke="none">7</text><text x="58" y="45" font-size="13" font-weight="700" fill="#222" stroke="none">7</text><text x="72" y="45" font-size="13" font-weight="700" fill="#222" stroke="none">7</text><rect x="50" y="54" width="16" height="8" fill="#f2c14e"/><line x1="86" y1="34" x2="96" y2="28"/><circle cx="97" cy="26" r="4" fill="#f2c14e"/><line x1="14" y1="68" x2="106" y2="68"/>'),
  shop: D('<rect x="22" y="36" width="76" height="32" fill="#fff"/><path d="M16 36 H104 L94 22 H26Z" fill="#e4572e"/><path d="M34 22 v14 M48 22 v14 M62 22 v14 M76 22 v14 M90 22 v14"/><rect x="22" y="54" width="76" height="14" fill="#a07b4a"/><line x1="12" y1="68" x2="108" y2="68"/>'),
  voting: D('<rect x="38" y="38" width="44" height="32" fill="#4a90d9"/><rect x="48" y="33" width="24" height="6" fill="#fff"/><rect x="54" y="16" width="14" height="18" fill="#fff"/><path d="M57 24 l3 4 6 -8" stroke="#3aa757"/>'),
  trivia: D('<rect x="34" y="16" width="52" height="46" rx="6" fill="#9b5de5"/><text x="60" y="52" font-size="36" font-weight="700" fill="#fff" stroke="none" text-anchor="middle">?</text>'),
  sponsor: D('<rect x="28" y="20" width="64" height="40" rx="4" fill="#fff"/><rect x="34" y="26" width="52" height="28" fill="#4a90d9"/><text x="60" y="46" font-size="15" font-weight="700" fill="#fff" stroke="none" text-anchor="middle">AD</text><line x1="48" y1="60" x2="42" y2="70"/><line x1="72" y1="60" x2="78" y2="70"/>'),
  vip: D('<rect x="24" y="30" width="72" height="26" rx="4" fill="#f2c14e"/><line x1="74" y1="30" x2="74" y2="56" stroke-dasharray="3 3"/><text x="48" y="48" font-size="13" font-weight="700" fill="#222" stroke="none" text-anchor="middle">VIP</text><path d="M84 36 l2 4 4 1 -3 3 1 4 -4 -2 -4 2 1 -4 -3 -3 4 -1Z" fill="#fff"/>'),
};

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  el("screen-" + name).classList.add("active");
}
function logMsg(text, kind = "") {
  if (!text) return;
  const e = document.createElement("div"); e.className = "log-entry " + kind; e.textContent = text;
  const box = el("log"); box.appendChild(e); box.scrollTop = box.scrollHeight;
}
function clearLog() { el("log").innerHTML = ""; }
function clearChoices() { el("choices").innerHTML = ""; }
function addChoice(label, cb, cls) {
  const b = document.createElement("button"); b.className = "choice" + (cls ? " " + cls : ""); b.textContent = label; b.onclick = cb;
  el("choices").appendChild(b);
}

/* ---------------- the spinning Wheel of Fate (SVG) ---------------- */
function buildWheel(segs) {
  const K = segs.length, seg = 360 / K, r = 100;
  const colors = ["#e4572e", "#4a90d9", "#3aa757", "#f2c14e", "#9b5de5", "#ef476f", "#06d6a0", "#ff924c"];
  let out = '<g id="wheel-rot" style="transform-origin:0 0;">';
  for (let i = 0; i < K; i++) {
    const a0 = (i * seg - 90) * Math.PI / 180, a1 = ((i + 1) * seg - 90) * Math.PI / 180;
    const x0 = (r * Math.cos(a0)).toFixed(1), y0 = (r * Math.sin(a0)).toFixed(1);
    const x1 = (r * Math.cos(a1)).toFixed(1), y1 = (r * Math.sin(a1)).toFixed(1);
    out += `<path d="M0 0 L ${x0} ${y0} A ${r} ${r} 0 ${seg > 180 ? 1 : 0} 1 ${x1} ${y1} Z" fill="${colors[i % colors.length]}" stroke="#222" stroke-width="2"/>`;
    const am = ((i + 0.5) * seg - 90) * Math.PI / 180, lr = r * 0.62;
    const lx = (lr * Math.cos(am)).toFixed(1), ly = (lr * Math.sin(am)).toFixed(1);
    out += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="700" fill="#fff" transform="rotate(${((i + 0.5) * seg).toFixed(1)} ${lx} ${ly})">${segs[i].label}</text>`;
  }
  out += "</g><circle cx='0' cy='0' r='9' fill='#222'/>";
  return out;
}
async function showWheelSpin(segs, index) {
  const overlay = el("wheel-overlay"), svg = el("wheel-svg"), cap = el("wheel-caption");
  svg.innerHTML = buildWheel(segs);
  cap.textContent = "Spinning…";
  overlay.classList.remove("hidden");
  sfx("dice");
  const rot = document.getElementById("wheel-rot");
  rot.style.transition = "none"; rot.style.transform = "rotate(0deg)";
  await delay(40);
  const R = 360 * 5 - (index + 0.5) * (360 / segs.length);
  rot.style.transition = "transform 2.7s cubic-bezier(.15,.7,.18,1)";
  rot.style.transform = `rotate(${R}deg)`;
  await delay(2800);
  cap.textContent = segs[index].label;
  sfx("ding");
  await delay(900);
  overlay.classList.add("hidden");
}

/* ============================================================
   TITLE + CREATION
   ============================================================ */
function initTitle() {
  el("btn-continue").disabled = !Game.hasSave();
  el("btn-new-game").onclick = () => { initCreation(); showScreen("create"); };
  el("btn-continue").onclick = () => { if (Game.load()) { slideNum = 0; clearLog(); logMsg("— Show resumed —", "system"); enterGame(); } };
}
const creation = { name: "", avatar: null };
function initCreation() {
  creation.name = ""; creation.avatar = null;
  el("input-name").value = ""; el("btn-begin").disabled = true;
  const box = el("avatar-choices"); box.innerHTML = "";
  AVATARS.forEach((a) => {
    const b = document.createElement("button"); b.className = "avatar-pick"; b.textContent = a; b.dataset.avatar = a;
    b.onclick = () => { creation.avatar = a; document.querySelectorAll("#avatar-choices .avatar-pick").forEach((p) => p.classList.toggle("selected", p.dataset.avatar === a)); updateBegin(); };
    box.appendChild(b);
  });
  el("input-name").oninput = (e) => { creation.name = e.target.value.trim(); updateBegin(); };
  el("btn-back-title").onclick = () => showScreen("title");
  el("btn-begin").onclick = beginShow;
}
function updateBegin() { el("btn-begin").disabled = !(creation.name && creation.avatar); }
function beginShow() {
  Game.newGame(creation.name, creation.avatar);
  slideNum = 0; clearLog();
  logMsg("🎤 " + Game.hostLine("greet"), "system");
  logMsg("Contestants: " + Game.contestants().map((c) => c.avatar + " " + c.name).join(", ") + ".", "system");
  enterGame();
}

/* ============================================================
   PANELS
   ============================================================ */
function renderHUD() {
  const y = Game.you();
  el("hud").innerHTML =
    `<div><div class="hud-name">${y.avatar} ${y.name}</div><div class="hud-tag">THE GAUNTLET</div></div>` +
    `<div class="hud-spacer"></div>` +
    `<div class="hud-lives">${y.alive ? "❤️".repeat(y.lives) : "💀"}${y.suffering ? " · 😖" + y.suffering : ""} · 🪙${y.coins || 0}${Game.hasFlag("key") ? " · 🔑" : ""}${Game.hasFlag("vip") ? " · 🎟️" : ""}</div>`;
}
function renderStandings() {
  const box = el("standings"); if (!box) return;
  const cs = Game.contestants().slice().sort((a, b) => (Number(b.alive) - Number(a.alive)));
  box.innerHTML = cs.map((c) => {
    const status = c.you ? (c.alive ? "❤️".repeat(c.lives) : "💀 OUT") : (c.alive ? "in the game" : "💀 OUT");
    return `<div class="standing${c.you ? " you" : ""}${!c.alive ? " out" : ""}"><span class="c-av">${c.avatar}</span> ${c.name}<span class="c-status">${status}</span></div>`;
  }).join("");
}
function refresh() { renderHUD(); renderStandings(); }

/* ============================================================
   THE SLIDE DECK
   ============================================================ */
function enterGame() { showScreen("game"); refresh(); renderSlide(); }

function renderSlide() {
  if (Game.isOver()) { showEnding(Game.won()); return; }
  const s = Game.current();
  slideNum += 1;
  const sn = el("slide-num"); if (sn) sn.textContent = "slide " + slideNum;
  el("slide-image").innerHTML = IMAGES[s.img] || `<div class="img-fallback">${s.img || "❓"}</div>`;
  el("scene-text").innerHTML = `<span class="host-line">🎤 "${s.host || Game.hostLine("good")}"</span><p>${s.text}</p>`;
  clearChoices();
  Game.availableChoices().forEach((ch) => addChoice(ch.label, () => onChoose(ch), ch.wheel ? "next-btn" : null));
  refresh();
}

async function onChoose(ch) {
  clearChoices();
  if (ch.cost) { Game.spendCoins(ch.cost); logMsg(`Spent ${ch.cost} 🪙.`, "system"); }
  if (ch.wheel) {
    const sp = Game.spinFateWheel();
    await showWheelSpin(WHEEL, sp.index);
    const wr = Game.applyWheelResult(sp.seg);
    logMsg("🎡 " + sp.seg.text, sp.seg.good ? "good" : "bad");
    if (wr.eliminated) logMsg(`🎤 ${wr.eliminated.avatar} ${wr.eliminated.name} is ELIMINATED!`, "bad");
    sfx(sp.seg.good ? "coin" : "hurt");
    refresh();
    if (Game.isOver()) { showEnding(Game.won()); return; }
    Game.enter(ch.goto);
    renderSlide();
    return;
  }
  const r = Game.enter(ch.goto);
  const s = r.slide;
  const bad = s.kill || s.suffer || (typeof s.life === "number" && s.life < 0);
  const good = s.win || (typeof s.life === "number" && s.life > 0) || s.set || s.eliminateRival;
  sfx(s.kill ? "defeat" : bad ? "hurt" : good ? "coin" : "click");
  if (r.eliminated) logMsg(`🎤 ${r.eliminated.avatar} ${r.eliminated.name} is ELIMINATED!`, "bad");
  refresh();
  renderSlide(); // shows the consequence slide (or the ending, if over)
}

/* ============================================================
   ENDINGS
   ============================================================ */
function showEnding(win) {
  slideNum += 1;
  const sn = el("slide-num"); if (sn) sn.textContent = "slide " + slideNum;
  el("slide-image").innerHTML = win ? IMAGES.trophy : IMAGES.skull;
  el("scene-text").innerHTML =
    `<span class="host-line">🎤 "${Game.hostLine(win ? "win" : "lose")}"</span>` +
    `<p class="scene-crown">${win ? "You ESCAPED the Gauntlet. CHAMPION!" : "You've been eliminated. The show goes on."}</p>`;
  sfx(win ? "victory" : "defeat");
  refresh();
  clearChoices();
  addChoice("🎬 Play another show", restart, "next-btn");
}
function restart() { Game.clearSave(); clearLog(); slideNum = 0; initTitle(); showScreen("title"); }

/* ============================================================
   SOUND + BOOT
   ============================================================ */
function updateMuteButton() { const b = el("btn-mute"); if (b) b.textContent = Sfx.isMuted() ? "🔇" : "🔊"; }
function boot() {
  document.addEventListener("click", (e) => { if (e.target.closest("button, .choice, .avatar-pick")) sfx("click"); });
  el("btn-mute").onclick = () => { const m = Sfx.toggle(); updateMuteButton(); if (!m) sfx("click"); };
  updateMuteButton();
  initTitle();
}
boot();

})();
