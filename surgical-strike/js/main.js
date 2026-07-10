// Game shell: state machine, planning input, progression, and the frame loop.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const timelineCanvas = document.getElementById("timeline");
const tctx = timelineCanvas.getContext("2d");
const $ = id => document.getElementById(id);

const SAVE_KEY = "surgical-strike-save";

function freshSave() {
  return {
    cash: 0, cleared: {}, intelCash: {}, gear: {},
    // The blade comes first; the rifle is the first big purchase.
    unitLevels: { scout: 1, assassin: 1, sniper: 0, spotter: 0, drone: 0, decoy: 0, hacker: 0, sapper: 0, gunner: 0, lockpick: 0 },
    paths: {},
    skills: {}, injured: {}, dev: false,
    devOpts: { revealMap: true, invincible: false, freezeEnemies: false },
  };
}

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s.cash === "number" && s.unitLevels) {
      // Older economy saves predate some units: the assassin joins free, and
      // anyone who already had the rifle keeps it.
      if (s.unitLevels.assassin == null) s.unitLevels.assassin = 1;
      if (s.unitLevels.sniper == null) s.unitLevels.sniper = 1;
      if (s.unitLevels.spotter == null) s.unitLevels.spotter = 0;
      if (!s.gear) s.gear = {};
      if (s.unitLevels.sapper == null) s.unitLevels.sapper = 0;
      if (s.unitLevels.gunner == null) s.unitLevels.gunner = 0;
      if (s.unitLevels.lockpick == null) s.unitLevels.lockpick = 0;
      if (!s.skills) s.skills = {};
      if (!s.injured) s.injured = {};
      if (s.dev == null) s.dev = false;
      if (!s.devOpts) s.devOpts = { revealMap: true, invincible: false, freezeEnemies: false };
      if (!s.paths) {
        // Migrate old linear ladders into path 1 of the new trees.
        s.paths = {};
        for (const k of Object.keys(s.unitLevels)) {
          const L = s.unitLevels[k] || 0;
          s.paths[k] = [Math.min(3, Math.max(0, L - 1)), 0, 0];
          if (L > 1) s.unitLevels[k] = 1; // tiers now live in paths
        }
      }
      return s;
    }
    if (s && typeof s.xp === "number") {
      // Migrate a pre-economy save: XP becomes cash, and they keep the rifle.
      const m = freshSave();
      m.cash = s.xp * 10;
      m.cleared = s.cleared || {};
      m.unitLevels.sniper = 1;
      return m;
    }
  } catch (e) { /* corrupted save: start fresh */ }
  return freshSave();
}
function persistSave() { localStorage.setItem(SAVE_KEY, JSON.stringify(app.save)); }

function fmtCash(n) { return "$" + n.toLocaleString("en-US"); }

// Hard-times rate: repeated failures earn shop discounts until the next win.
function mercyDiscount() {
  const f = app.save.mercyFails || 0;
  return f >= 9 ? 0.3 : f >= 6 ? 0.2 : f >= 3 ? 0.1 : 0;
}
function price(cost) { return Math.round(cost * (1 - mercyDiscount())); }

// ---------------------------------------------------------------- audio
const Sound = (() => {
  let ac = null;
  function ctxAudio() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    return ac;
  }
  function tone(freq, dur, type = "sine", gain = 0.08, when = 0, glideTo = null) {
    try {
      const a = ctxAudio();
      const o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.value = freq;
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, a.currentTime + when + dur);
      g.gain.setValueAtTime(gain, a.currentTime + when);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + when + dur);
      o.connect(g).connect(a.destination);
      o.start(a.currentTime + when);
      o.stop(a.currentTime + when + dur);
    } catch (e) { /* audio unavailable */ }
  }
  function noiseBurst(dur, gain = 0.2) {
    try {
      const a = ctxAudio();
      const len = Math.floor(a.sampleRate * dur);
      const buf = a.createBuffer(1, len, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource(), g = a.createGain();
      src.buffer = buf; g.gain.value = gain;
      src.connect(g).connect(a.destination);
      src.start();
    } catch (e) { /* audio unavailable */ }
  }
  return {
    click: () => tone(880, 0.05, "square", 0.03),
    shot: () => { noiseBurst(0.35, 0.25); tone(120, 0.3, "sawtooth", 0.1); },
    hit: () => tone(90, 0.4, "sine", 0.2),
    alert: () => { tone(700, 0.12, "square", 0.06); tone(500, 0.15, "square", 0.06, 0.13); },
    tap: () => tone(220, 0.08, "triangle", 0.1),
    error: () => tone(180, 0.3, "sawtooth", 0.06, 0, 90),
    powerDown: () => tone(320, 0.7, "sawtooth", 0.07, 0, 60),
    droneDown: () => { tone(900, 0.1, "square", 0.06, 0, 500); tone(500, 0.25, "square", 0.06, 0.1, 120); },
    levelUp: () => { tone(523, 0.12, "sine", 0.08); tone(659, 0.12, "sine", 0.08, 0.12); tone(784, 0.2, "sine", 0.08, 0.24); },
  };
})();

// ---------------------------------------------------------------- state
const app = {
  save: loadSave(),
  state: "menu", // menu | plan | exec
  mode: "hit",   // hit | recon (recon = observation run, no shot)
  resultMode: "hit",
  reconBase: null,
  missionIdx: null,
  level: null,
  intel: null,
  plan: null,
  perks: null,
  sim: null,
  previewT: 0,
  timeScale: 1,
  activeUnit: "scout", // scout | drone | decoy | hacker | sniper
  activeShot: 0,       // which sniper shot is being edited
  legMode: "sneak",
  decoyOrder: "move", // move | throw
  gunnerOrder: "move", // move | suppress
  assassinPick: false, // true while choosing an ATTACK target on the map
  unitsAvail: { scout: true, sniper: true, assassin: false, spotter: false, drone: false, decoy: false, hacker: false },
  cam: { x: 24, y: 16, zoom: 1 },
  holdTimer: 0,
  resultShown: false,
  impactAge: 0,
  shake: 0,
  intelStore: {}, // missionIdx -> intel (persists across attempts, per browser session)
};

function missionUnlocked(mi) { return app.save.dev || mi === 0 || app.save.cleared[mi - 1]; }
function hireable(kind) { return missionUnlocked(UNIT_INFO[kind].unlockMission); }

// ---------------------------------------------------------------- dev mode
// Type "cheese" anywhere to toggle developer mode: every mission unlocked, the
// whole crew hired and maxed, all gear and skills, and a pile of cash. A DEV
// panel then exposes playtest toggles (see the building, invincible crew,
// freeze foes). A pure testing cheat — none of this is reachable in play.
const DEV_DEFAULTS = { revealMap: true, invincible: false, freezeEnemies: false };
const DEV_LABELS = { revealMap: "🗺 SEE BUILDING", invincible: "🛡 INVINCIBLE", freezeEnemies: "⏸ FREEZE FOES" };

function grantEverything() {
  app.save.cash = 999999;
  for (const kind of Object.keys(UNIT_INFO)) app.save.unitLevels[kind] = 1;
  for (const kind of Object.keys(PATHS)) app.save.paths[kind] = PATHS[kind].map(p => p.tiers.length);
  for (const key of Object.keys(GEAR)) app.save.gear[key] = true;
  for (const key of Object.keys(SKILLS)) app.save.skills[key] = SKILLS[key].tiers.length;
  app.save.injured = {};
}

// Is dev mode on with a given playtest toggle set? (read by the sim + renderer)
function devOn(opt) { return !!(app.save.dev && app.save.devOpts && app.save.devOpts[opt]); }
// The dev options the sim needs each run.
function devSimOpts() {
  return app.save.dev ? { invincible: devOn("invincible"), freezeEnemies: devOn("freezeEnemies") } : {};
}

function renderDevPanel() {
  const panel = $("devPanel");
  panel.classList.toggle("hidden", !app.save.dev);
  if (!app.save.dev) return;
  if (!app.save.devOpts) app.save.devOpts = { ...DEV_DEFAULTS };
  panel.querySelectorAll(".devToggle").forEach(btn => {
    const k = btn.dataset.dev, on = !!app.save.devOpts[k];
    btn.classList.toggle("on", on);
    btn.textContent = `${DEV_LABELS[k]}: ${on ? "ON" : "OFF"}`;
  });
}

function toggleDevOpt(key) {
  if (!app.save.devOpts) app.save.devOpts = { ...DEV_DEFAULTS };
  app.save.devOpts[key] = !app.save.devOpts[key];
  persistSave();
  Sound.click();
  renderDevPanel();
  Renderer.forceFogRedraw();
  // Freeze/invincible only bite on the next run; reveal is immediate.
}

function toggleDev() {
  app.save.dev = !app.save.dev;
  if (app.save.dev) {
    grantEverything();
    if (!app.save.devOpts) app.save.devOpts = { ...DEV_DEFAULTS };
  }
  persistSave();
  afterPurchase();          // recompute perks + refresh crew/HUD/plan
  renderDevPanel();
  Renderer.forceFogRedraw();
  if (!$("missionOverlay").classList.contains("hidden")) showMissionSelect();
  Sound.levelUp();
  hint(app.save.dev
    ? "🧀 DEVELOPER MODE ON — every contract unlocked, full crew maxed, cash loaded. Use the DEV panel (top-left) to see the building, go invincible, or freeze foes. Type 'cheese' again to switch it off."
    : "Developer mode off. (Anything already bought stays bought.)");
}

// Type the cheat word anywhere to flip developer mode.
let cheatBuf = "";
window.addEventListener("keydown", e => {
  if (e.key && e.key.length === 1 && /[a-z]/i.test(e.key)) {
    cheatBuf = (cheatBuf + e.key.toLowerCase()).slice(-8);
    if (cheatBuf.endsWith("cheese")) { cheatBuf = ""; toggleDev(); }
  }
});

function refreshUnitsAvail() {
  for (const kind of Object.keys(UNIT_INFO)) {
    app.unitsAvail[kind] = (app.save.unitLevels[kind] || 0) > 0 && !app.save.injured[kind];
  }
}

function tryHire(kind) {
  const cost = price(HIRE_COSTS[kind]);
  if (app.save.cash < cost || app.save.unitLevels[kind] > 0 || !hireable(kind)) return;
  app.save.cash -= cost;
  app.save.unitLevels[kind] = 1;
  persistSave();
  Sound.levelUp();
  afterPurchase();
}

// BTD6 rule: only one path per unit may go past tier 1.
function pathBuyState(kind, pi) {
  const tiers = app.save.paths[kind] || [0, 0, 0];
  const path = (PATHS[kind] || [])[pi];
  if (!path) return { locked: true };
  const cur = tiers[pi] || 0;
  if (cur >= path.tiers.length) return { maxed: true };
  const deepOther = tiers.some((t, i) => i !== pi && (t || 0) >= 2);
  if (cur + 1 >= 2 && deepOther) return { locked: true, why: "another path is your specialty" };
  const next = path.tiers[cur];
  return { next, cost: price(next.cost), tier: cur + 1 };
}

function tryUpgradePath(kind, pi) {
  const st = pathBuyState(kind, pi);
  if (!st.next || app.save.cash < st.cost) return;
  if (!app.save.paths[kind]) app.save.paths[kind] = [0, 0, 0];
  app.save.cash -= st.cost;
  app.save.paths[kind][pi] = (app.save.paths[kind][pi] || 0) + 1;
  persistSave();
  Sound.levelUp();
  afterPurchase();
}

function afterPurchase() {
  app.perks = perksFromPaths(app.save.unitLevels, app.save.paths, app.save.gear, app.save.skills);
  refreshUnitsAvail();
  refreshHud();
  if (app.state === "plan") {
    normalizeShots(app.plan, app.level, app.perks.extraShots);
    buildUnitButtons();
    refreshPlanPanel();
  }
}

function tryBuyGear(key) {
  const g = GEAR[key];
  if (!g || app.save.gear[key] || app.save.cash < price(g.cost)) return;
  if (g.needs && !(app.save.unitLevels[g.needs] > 0)) return;
  app.save.cash -= price(g.cost);
  app.save.gear[key] = true;
  persistSave();
  Sound.levelUp();
  afterPurchase();
}

function healCost(kind) {
    const base = Math.round((HIRE_COSTS[kind] || 1000) * 0.4);
    return app.perks.medDiscount ? Math.round(base / 2) : base;
}

function markInjuries() {
  if (!app.sim) return;
  for (const kind of Object.keys(app.sim.units)) {
    const u = app.sim.units[kind];
    if (!u || !u.dead || kind === "drone") continue;
    if (app.perks.autoHeal) continue; // the clinic patches everyone up free
    app.save.injured[kind] = healCost(kind);
  }
  if (app.perks.autoHeal) return;
}

function tryHeal(kind) {
  const cost = app.save.injured[kind];
  if (cost == null || app.save.cash < cost) return;
  app.save.cash -= cost;
  delete app.save.injured[kind];
  persistSave();
  Sound.levelUp();
  afterPurchase();
  buildHomebase();
}

function tryTrainSkill(key) {
  const sk = SKILLS[key];
  const cur = app.save.skills[key] || 0;
  const tier = sk && sk.tiers[cur];
  if (!tier || app.save.cash < price(tier.cost)) return;
  app.save.cash -= price(tier.cost);
  app.save.skills[key] = cur + 1;
  persistSave();
  Sound.levelUp();
  afterPurchase();
  buildHomebase();
}

function buildHomebase() {
  const wrap = $("homeCards");
  wrap.innerHTML = "";
  for (const [key, sk] of Object.entries(SKILLS)) {
    const cur = app.save.skills[key] || 0;
    const card = document.createElement("div");
    card.className = "unitCard";
    card.innerHTML = `<h4 style="color:#a3e635">${sk.name}${cur ? " " + "•".repeat(cur) : ""}</h4>`;
    sk.tiers.forEach((tier, ti) => {
      if (ti < cur) {
        card.insertAdjacentHTML("beforeend", `<div class="perk unlocked">${tier.desc}</div>`);
      } else if (ti === cur) {
        const row = document.createElement("div");
        row.className = "perk nextUp";
        row.textContent = `${tier.desc} `;
        const btn = document.createElement("button");
        btn.className = "btn small buy";
        btn.textContent = `TRAIN — ${fmtCash(price(tier.cost))}`;
        btn.disabled = app.save.cash < price(tier.cost);
        btn.onclick = () => tryTrainSkill(key);
        row.appendChild(btn);
        card.appendChild(row);
      } else {
        card.insertAdjacentHTML("beforeend", `<div class="perk locked">${tier.desc}</div>`);
      }
    });
    wrap.appendChild(card);
  }
  // the infirmary
  const inj = Object.entries(app.save.injured || {});
  const med = document.createElement("div");
  med.className = "unitCard";
  med.innerHTML = `<h4 style="color:#f87171">INFIRMARY</h4>` +
    (inj.length ? "" : `<div class="blurb">Everyone is on their feet.</div>`);
  for (const [kind, cost] of inj) {
    const row = document.createElement("div");
    row.className = "perk nextUp";
    row.textContent = `${UNIT_INFO[kind].label} is wounded `;
    const btn = document.createElement("button");
    btn.className = "btn small buy";
    btn.textContent = `HEAL — ${fmtCash(cost)}`;
    btn.disabled = app.save.cash < cost;
    btn.onclick = () => tryHeal(kind);
    row.appendChild(btn);
    med.appendChild(row);
  }
  wrap.appendChild(med);
}

function buildGearCards() {
  const wrap = $("gearCards");
  wrap.innerHTML = "";
  for (const [key, g] of Object.entries(GEAR)) {
    const owned = !!app.save.gear[key];
    const needsUnit = g.needs && !(app.save.unitLevels[g.needs] > 0);
    const card = document.createElement("div");
    card.className = "unitCard" + (owned ? "" : needsUnit ? " lockedUnit" : "");
    card.innerHTML = `<h4 style="color:#fbbf24">${g.name}${owned ? " — OWNED ✔" : ""}</h4>` +
      `<div class="blurb">${g.desc}</div>`;
    if (!owned) {
      if (needsUnit) {
        card.insertAdjacentHTML("beforeend",
          `<div class="perk locked">Requires the ${UNIT_INFO[g.needs].label} on the crew</div>`);
      } else {
        const btn = document.createElement("button");
        btn.className = "btn small buy";
        btn.textContent = `BUY — ${fmtCash(price(g.cost))}`;
        btn.disabled = app.save.cash < price(g.cost);
        btn.title = btn.disabled ? "Not enough cash — clear contracts to earn more" : `Add ${g.name} to the kit`;
        btn.onclick = () => tryBuyGear(key);
        card.appendChild(btn);
      }
    }
    wrap.appendChild(card);
  }
}

// The cheapest purchase the player could make right now, for nudges.
function firstAffordable() {
  for (const kind of Object.keys(UNIT_INFO)) {
    const lvl = app.save.unitLevels[kind] || 0;
    if (lvl === 0 && hireable(kind) && app.save.cash >= price(HIRE_COSTS[kind])) return `${UNIT_INFO[kind].label} for hire`;
    if (lvl > 0) {
      for (let pi = 0; pi < 3; pi++) {
        const st = pathBuyState(kind, pi);
        if (st.next && app.save.cash >= st.cost) return `${UNIT_INFO[kind].label} upgrade`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- intel
function makeIntel(mi) {
  const level = LEVELS[mi];
  const intel = {
    grid: new Uint8Array(WORLD.fogW * WORLD.fogH),
    known: new Set(),
    lastSeen: {},
    revealVersion: 0,
    attempts: 0,
    heat: 0,
    plan: null,
  };
  // Pre-reveal everything with a clear line of sight from the insertion point
  // or a perch (windows stay opaque — interiors need the crew).
  const sources = [level.scoutSpawn, ...level.perches];
  for (let cy = 0; cy < WORLD.fogH; cy++) {
    for (let cx = 0; cx < WORLD.fogW; cx++) {
      const wx = cx * WORLD.fogCell + WORLD.fogCell / 2;
      const wy = cy * WORLD.fogCell + WORLD.fogCell / 2;
      for (const s of sources) {
        if (!G.losBlocked(s.x, s.y, wx, wy, level.walls, false)) {
          intel.grid[cy * WORLD.fogW + cx] = 1;
          break;
        }
      }
    }
  }
  intel.revealVersion++;
  return intel;
}

function defaultPlan(level) {
  return {
    scoutPath: [], assassinPath: [], spotterPath: [],
    dronePath: [], decoyPath: [], hackerPath: [], sapperPath: [], gunnerPath: [], lockpickPath: [],
    throws: [], blackouts: [], blares: [], suppresses: [],
    perchIndex: null,
    assassinMark: null, assassinGuard: null, stance: {},
    shots: [{ aim: null, fireTime: Math.round(level.duration / 2) }],
    fireTouched: false,
  };
}

function targetCount(level) {
  return level.enemies.filter(e => e.isTarget).length;
}

// One plan shot per contract target, plus any spare rounds from the armory.
function normalizeShots(plan, level, extraShots) {
  if (!plan.shots || !plan.shots.length) {
    plan.shots = [{ aim: plan.aim || null, fireTime: plan.fireTime ?? Math.round(level.duration / 2) }];
  }
  const n = Math.max(1, targetCount(level)) + (extraShots || 0);
  while (plan.shots.length < n) {
    plan.shots.push({ aim: null, fireTime: Math.min(level.duration, Math.round(level.duration / 2) + plan.shots.length * 2) });
  }
  if (plan.shots.length > n) plan.shots.splice(n);
}

function activeShotObj() {
  const shots = app.plan.shots || [];
  return shots[app.activeShot] || shots[0] || { aim: null, fireTime: 0 };
}

// Recon plans have no shot at all — fireTime null keeps the sim from ever firing.
function defaultReconPlan() {
  return {
    scoutPath: [], assassinPath: [], spotterPath: [],
    dronePath: [], decoyPath: [], hackerPath: [], sapperPath: [], gunnerPath: [], lockpickPath: [],
    throws: [], blackouts: [], blares: [], suppresses: [],
    perchIndex: null, assassinMark: null, assassinGuard: null, stance: {}, aim: null, fireTime: null, fireTouched: true,
  };
}

function setMode(mode) {
  app.mode = mode;
  app.plan = mode === "recon" ? app.intel.reconPlan : app.intel.plan;
  app.activeUnit = "scout";
  app.decoyOrder = "move";
  app.assassinPick = false;
  timelineCanvas.height = Renderer.timelineHeight(app);
  buildUnitButtons();
  refreshPlanPanel();
}

function countRevealed() {
  let n = 0;
  for (const v of app.intel.grid) n += v;
  return n;
}

function pathsByKind() {
  return {
    scout: app.plan.scoutPath, assassin: app.plan.assassinPath, spotter: app.plan.spotterPath,
    drone: app.plan.dronePath, decoy: app.plan.decoyPath, hacker: app.plan.hackerPath,
    sapper: app.plan.sapperPath, gunner: app.plan.gunnerPath, lockpick: app.plan.lockpickPath,
  };
}

function activePath() {
  return pathsByKind()[app.activeUnit] || null;
}

// ---------------------------------------------------------------- missions
function openMission(mi) {
  app.missionIdx = mi;
  app.level = LEVELS[mi];
  refreshUnitsAvail();
  if (!app.intelStore[mi]) app.intelStore[mi] = makeIntel(mi);
  app.intel = app.intelStore[mi];
  app.perks = perksFromPaths(app.save.unitLevels, app.save.paths, app.save.gear, app.save.skills);
  app.plan = Object.assign(defaultPlan(app.level), app.intel.plan || {});
  normalizeShots(app.plan, app.level, app.perks.extraShots);
  app.intel.plan = app.plan;
  app.intel.reconPlan = Object.assign(defaultReconPlan(), app.intel.reconPlan || {});
  app.mode = "hit";
  app.activeShot = 0;
  app.sim = null;
  app.previewT = 0;
  app.activeUnit = "scout";
  app.decoyOrder = "move";
  app.cam = { x: 24, y: 16, zoom: 1 };
  Renderer.forceFogRedraw();

  $("fireSlider").max = app.level.duration;
  $("scrubSlider").max = app.level.duration;
  $("fireSlider").value = app.plan.shots[0].fireTime;
  $("scrubSlider").value = 0;
  timelineCanvas.height = Renderer.timelineHeight(app);
  $("missionLabel").textContent = `#${mi + 1} — ${app.level.name}`;

  // Briefing, plus a note for any specialist who just hit the hire market.
  let brief = app.level.briefing;
  if (app.level.publicVenue) {
    brief += `\n\nPUBLIC VENUE: your people can walk in the front door as visitors — moving, non-sneaking operatives take ${app.perks.disguiseTime}s of scrutiny to be made (train Disguise at the HOMEBASE for better covers). Standing around or sneaking looks as suspicious as ever.`;
  }
  for (const kind of ["assassin", "spotter", "drone", "decoy", "hacker", "lockpick", "sapper", "gunner"]) {
    if (UNIT_INFO[kind].unlockMission === mi && !app.unitsAvail[kind]) {
      brief += `\n\nFOR HIRE — ${UNIT_INFO[kind].label} (${fmtCash(HIRE_COSTS[kind])}): ${UNIT_INFO[kind].blurb} Hire from the CREW panel when you have the cash.`;
    }
  }
  $("missionOverlay").classList.add("hidden");
  $("resultOverlay").classList.add("hidden");
  $("briefTitle").textContent = `#${mi + 1} ${app.level.name}`;
  $("briefBody").textContent = brief;
  $("briefHint").textContent = "INTEL: " + app.level.hint;
  $("briefOverlay").classList.remove("hidden");
}

function startPlanning() {
  app.state = "plan";
  app.sim = null;
  app.impactAge = 0;
  app.shake = 0;
  app.cam = { x: 24, y: 16, zoom: 1 };
  $("briefOverlay").classList.add("hidden");
  $("resultOverlay").classList.add("hidden");
  $("planPanel").classList.remove("hidden");
  $("execPanel").classList.add("hidden");
  $("coach").classList.remove("hidden");
  buildUnitButtons();
  refreshPlanPanel();
  refreshHud(); // surface this mission's alert / jammed badges
  hint(app.mode === "recon"
    ? "RECON OP: route your watchers, then RUN RECON. Intel persists into the hit."
    : "Case the site first under 🔭 RECON OP ($150), or plan the hit directly. Pick a unit and click the map to give orders.");
}

function showMissionSelect() {
  app.state = "menu";
  app.sim = null;
  refreshUnitsAvail();
  const list = $("missionList");
  list.innerHTML = "";
  LEVELS.forEach((lvl, i) => {
    const card = document.createElement("div");
    const unlocked = missionUnlocked(i);
    card.className = "missionCard" + (unlocked ? "" : " locked");
    const status = app.save.cleared[i]
      ? '<span class="status done">CLEARED</span>'
      : unlocked ? '<span class="status">OPEN</span>' : '<span class="status">LOCKED</span>';
    const attempts = app.intelStore[i] ? ` · ${app.intelStore[i].attempts} attempts` : "";
    card.innerHTML = `<div class="num">${String(i + 1).padStart(2, "0")}</div>
      <div class="info"><b>${lvl.name}</b><div>pays ${fmtCash(lvl.pay)}${attempts}</div></div>${status}`;
    if (unlocked) card.onclick = () => { Sound.click(); openMission(i); };
    list.appendChild(card);
  });
  $("missionOverlay").classList.remove("hidden");
  $("briefOverlay").classList.add("hidden");
  $("resultOverlay").classList.add("hidden");
  $("coach").classList.add("hidden");
  refreshHud();
}

// ---------------------------------------------------------------- HUD / panels
// At-a-glance HUD pills: progress, crew, and live threat state.
function renderBadges() {
  const wrap = $("badges");
  wrap.innerHTML = "";
  const add = (text, cls, title) => {
    const b = document.createElement("span");
    b.className = "badge " + cls;
    b.textContent = text;
    if (title) b.title = title;
    wrap.appendChild(b);
  };

  const cleared = Object.keys(app.save.cleared).filter(k => app.save.cleared[k]).length;
  add(`🎯 ${cleared}/${LEVELS.length}`, "prog", "Contracts cleared");

  const crew = Object.keys(UNIT_INFO).filter(k => (app.save.unitLevels[k] || 0) > 0).length;
  add(`👥 ${crew}`, "crew", "Operatives on the payroll");

  const wounded = Object.keys(app.save.injured || {}).filter(k => app.save.injured[k]).length;
  if (wounded > 0) add(`🩹 ${wounded}`, "wound", `${wounded} operative${wounded > 1 ? "s" : ""} wounded — can't deploy until healed at the HOMEBASE`);

  // Current-mission threat state.
  if (app.level && app.intel) {
    const heat = app.intel.heat || 0;
    if (heat > 0) add(`🔥 ${"●".repeat(heat)}${"○".repeat(3 - heat)}`, "alert",
      `Site alert — enemy senses +${heat * 6}%, target routines shifted. A clean recon op cools it.`);
    if (app.level.enemies.some(e => e.jammer) && !(app.sim && app.sim.liveFeed())) {
      add("📡 JAMMED", "jam", "Comms jammed — watchers must slip back out to deliver intel, or take the radio jammer down for a live feed.");
    }
  }

  if (app.save.dev) add("🧀 DEV", "dev", "Developer mode is ON — type 'cheese' again to turn it off");
}

function refreshHud() {
  $("cashLabel").textContent = fmtCash(app.save.cash);
  renderBadges();
  renderDevPanel();
  const d = mercyDiscount();
  $("mercyNote").classList.toggle("hidden", d === 0);
  if (d > 0) {
    $("mercyNote").textContent = `HARD TIMES RATE: −${Math.round(d * 100)}% off everything below — the fixer takes pity. Resets on your next win.`;
  }
  buildUnitCards();
  buildGearCards();
}

// The CREW panel doubles as the shop: hire specialists, buy upgrades one tier at a time.
function buildUnitCards() {
  refreshUnitsAvail();
  const wrap = $("unitCards");
  wrap.innerHTML = "";
  for (const kind of Object.keys(UNIT_INFO)) {
    const info = UNIT_INFO[kind];
    const lvl = app.save.unitLevels[kind] || 0;
    const hired = lvl > 0;
    const card = document.createElement("div");
    card.className = "unitCard" + (hired ? "" : " lockedUnit");
    card.innerHTML =
      `<h4 style="color:${info.color}">${info.label}</h4>` +
      `<div class="blurb">${info.blurb}</div>`;

    if (!hired) {
      if (!hireable(kind)) {
        card.insertAdjacentHTML("beforeend",
          `<div class="perk locked">Joins the hire market at Contract #${info.unlockMission + 1}</div>`);
      } else {
        const btn = document.createElement("button");
        btn.className = "btn small buy";
        btn.textContent = `HIRE — ${fmtCash(price(HIRE_COSTS[kind]))}`;
        btn.disabled = app.save.cash < price(HIRE_COSTS[kind]);
        btn.title = btn.disabled ? "Not enough cash — clear contracts to earn more" : `Add the ${info.label} to your crew`;
        btn.onclick = () => tryHire(kind);
        card.appendChild(btn);
      }
    } else {
      // BTD6-style: three paths; only one may go past tier 1.
      const tiers = app.save.paths[kind] || [0, 0, 0];
      (PATHS[kind] || []).forEach((path, pi) => {
        const cur = tiers[pi] || 0;
        const block = document.createElement("div");
        block.className = "pathBlock";
        block.innerHTML = `<div class="pathName" style="color:${info.color}">▸ ${path.name} ${cur > 0 ? "•".repeat(cur) : ""}</div>`;
        path.tiers.forEach((tier, ti) => {
          if (ti + 1 <= cur) {
            block.insertAdjacentHTML("beforeend", `<div class="perk unlocked">${tier.desc}</div>`);
          } else if (ti + 1 === cur + 1) {
            const st = pathBuyState(kind, pi);
            if (st.locked) {
              block.insertAdjacentHTML("beforeend", `<div class="perk locked">${tier.desc} — ${st.why || "locked"}</div>`);
            } else if (st.next) {
              const row = document.createElement("div");
              row.className = "perk nextUp";
              row.textContent = `${tier.desc} `;
              const btn = document.createElement("button");
              btn.className = "btn small buy";
              btn.textContent = `BUY — ${fmtCash(st.cost)}`;
              btn.disabled = app.save.cash < st.cost;
              btn.onclick = () => tryUpgradePath(kind, pi);
              row.appendChild(btn);
              block.appendChild(row);
            }
          } else {
            block.insertAdjacentHTML("beforeend", `<div class="perk locked">${tier.desc}</div>`);
          }
        });
        card.appendChild(block);
      });
    }
    wrap.appendChild(card);
  }
}

function buildUnitButtons() {
  const wrap = $("unitButtons");
  wrap.innerHTML = "";
  const kinds = app.mode === "recon" ? RECON_UNITS : Object.keys(UNIT_INFO);
  for (const kind of kinds) {
    const info = UNIT_INFO[kind];
    const btn = document.createElement("button");
    btn.className = "btn small unitBtn" + (app.activeUnit === kind ? " active" : "");
    btn.textContent = app.unitsAvail[kind] ? info.label : `🔒${info.label}`;
    btn.disabled = !app.unitsAvail[kind];
    btn.title = app.unitsAvail[kind] ? info.blurb
      : hireable(kind) ? `Not on the crew yet — hire for ${fmtCash(HIRE_COSTS[kind])} in the CREW panel`
      : `Joins the hire market at Contract #${info.unlockMission + 1}`;
    if (app.activeUnit === kind) btn.style.borderColor = info.color, btn.style.color = info.color;
    btn.onclick = () => {
      app.activeUnit = kind;
      Sound.click();
      hint({
        scout: "SCOUT: click to add waypoints (right-click undoes). Toggle SNEAK/WALK per leg; TAP knocks on arrival; HOLD makes them wait.",
        assassin: "ASSASSIN: route them next to a target and wait — any target in reach gets the knife. Or hit ⚔ ATTACK and click an enemy to hunt them down, and 🛡 DEFEND to bodyguard a teammate.",
        spotter: "SPOTTER: park them with a clear line to your AIM POINT. If they can see it when the shot fires, the hit window widens by half. Great recon eyes, too.",
        drone: "DRONE: click anywhere — it flies over walls and reveals from above. Its hum attracts ears, and loitering in sight gets it shot down.",
        decoy: "DECOY: path them in MOVE mode, then switch to THROW and click a landing spot — it schedules itself for when they're in position. Drag the ♪ on the timeline to retime.",
        hacker: "HACKER: path them to a ⚡ junction box, scrub PREVIEW to the moment you want darkness, then press BLACKOUT.",
        sapper: "SAPPER: route them beside a wall, arm BREACH 💥 on the waypoint — the blast opens a lane for bullets, bodies, and eyes. Very loud (unless upgraded).",
        lockpick: "LOCKPICK: path them to a locked door — they crack it three times faster than brute force. Welcome on recon ops.",
        gunner: "GUNNER: in MOVE mode click to path; in SUPPRESS mode click a point — a scheduled burst pins every guard near it face-down.",
        sniper: "SNIPER: click a perch marker, then click the aim point. The dashed line shows whether the shot is clear.",
      }[kind]);
      buildUnitButtons();
      refreshPlanPanel();
    };
    wrap.appendChild(btn);
  }
}

function hackerBlackoutCheck() {
  // Will the hacker actually be at a box every time a blackout order fires?
  const bs = app.plan.blackouts || [];
  if (!bs.length) return null;
  const spawn = unitSpawn(app.level, "hacker");
  return bs.every(b => {
    const pos = pathPosAt(spawn, app.plan.hackerPath, b.t, unitSpeedFor("hacker"));
    return (app.level.junctionBoxes || []).some(j => G.dist(pos.x, pos.y, j.x, j.y) <= TUNING.boxRange);
  });
}

// The coach bar: the plan's steps, checked off as they're completed.
function renderCoach(steps) {
  const next = steps.find(s => !s.done && !s.optional);
  $("coach").innerHTML = steps.map(s => {
    const cls = s.done ? "done" : (s === next ? "next" : "todo") + (s.optional ? " optional" : "");
    return `<span class="chip ${cls}">${s.done ? "✓ " : ""}${s.label}</span>`;
  }).join("");
}

function refreshCoach() {
  if (app.mode === "recon") {
    const anyOrders = RECON_UNITS.some(k => (pathsByKind()[k] || []).length);
    renderCoach([
      { label: "1 ROUTE YOUR WATCHERS", done: !!anyOrders },
      { label: "2 RUN THE RECON — FREE", done: false },
    ]);
    return;
  }
  const anyOrders = app.plan.scoutPath.length || app.plan.dronePath.length ||
    app.plan.decoyPath.length || app.plan.throws.length || app.plan.blackouts.length;
  const shots = app.plan.shots || [];
  const aimed = shots.filter(s => s.aim).length;
  const poisons = app.plan.scoutPath.filter(w => w.poison).length;
  const melee = app.plan.assassinPath.length ? 1 : 0;
  const quiet = poisons + melee;
  const kills = aimed + quiet;
  const n = targetCount(app.level);
  if (!app.unitsAvail.sniper) {
    // No rifle yet: the plan is blade and poison.
    renderCoach([
      { label: "1 SCOUT THE APPROACH", done: !!anyOrders, optional: true },
      { label: `2 PLAN A KILL PER TARGET (${Math.min(kills, n)}/${n})`, done: kills >= n },
      { label: "3 EXECUTE", done: false },
    ]);
    return;
  }
  renderCoach([
    { label: "1 SCOUT THE APPROACH", done: !!anyOrders, optional: true },
    { label: "2 PICK A PERCH", done: app.plan.perchIndex != null, optional: aimed === 0 && quiet > 0 },
    { label: n > 1 || quiet ? `3 PLAN A KILL PER TARGET (${Math.min(kills, n)}/${n})` : "3 SET THE AIM", done: kills >= n },
    { label: n > 1 ? "4 SET FIRE TIMES" : "4 SET FIRE TIME", done: !!app.plan.fireTouched || (aimed === 0 && quiet > 0) },
    { label: "5 EXECUTE", done: false },
  ]);
}

function refreshPlanPanel() {
  const recon = app.mode === "recon";
  $("tabRecon").classList.toggle("active", recon);
  $("tabHit").classList.toggle("active", !recon);
  $("fireRow").classList.toggle("hidden", recon || !app.unitsAvail.sniper);
  $("attemptLabel").textContent = recon
    ? `· OP ${(app.intel.reconOps || 0) + 1}`
    : `· ATTEMPT ${app.intel.attempts + 1}`;
  const perchOk = app.plan.perchIndex != null;
  const shots = app.plan.shots || [];
  const aimOk = shots.every(s => s.aim);

  const lines = [];
  const push = (kind, txt) => lines.push(`<span style="color:${UNIT_INFO[kind].color}">${UNIT_INFO[kind].label}</span> ${txt}`);
  const heat = app.intel.heat || 0;
  if (heat > 0) {
    lines.push(`<span class="bad">SITE ALERT ${"●".repeat(heat)}${"○".repeat(3 - heat)}</span> — senses +${heat * 6}%, target routines shifted ${(heat * 2.2).toFixed(1)}s. A clean recon op cools it.`);
  }
  if (app.level.enemies.some(e => e.jammer)) {
    lines.push(`<span class="bad">📡 COMMS JAMMED</span> — a live radio jammer kills your feed. Route watchers back to the insertion point to deliver what they saw, or take the jammer down for a live feed.`);
  }
  if (!app.perks.sharpVisuals) {
    lines.push(`<span class="dim">ROUGH OPTICS</span> — hostile fixes read as fuzzy blobs (?). Buy the Scout's Optics (Sharp Eyes) or field the Drone for a clean picture.`);
  }
  const iv = p => p.length ? `${p.length} wp, done ${pathIntervals(unitSpawn(app.level, "scout"), p, unitSpeedFor("scout")).total.toFixed(1)}s` : "no orders";
  push("scout", iv(app.plan.scoutPath));
  if (app.unitsAvail.assassin) {
    const bits = [];
    if (app.plan.assassinPath.length) bits.push(`${app.plan.assassinPath.length} wp — strikes anything in ${app.perks.strikeRange}m`);
    if (app.plan.assassinMark != null) bits.push(`⚔ hunting ${app.level.enemies[app.plan.assassinMark].name}`);
    if (app.plan.assassinGuard) bits.push(`🛡 guarding ${UNIT_INFO[app.plan.assassinGuard].label}`);
    push("assassin", bits.length ? bits.join(" · ") : "no orders");
  }
  if (app.unitsAvail.spotter) push("spotter", app.plan.spotterPath.length ? `${app.plan.spotterPath.length} wp` : "no orders");
  if (app.unitsAvail.drone) push("drone", app.plan.dronePath.length ? `${app.plan.dronePath.length} wp` : "no orders");
  if (!recon) {
    if (app.unitsAvail.decoy) {
      const spawnD = unitSpawn(app.level, "decoy");
      const badThrows = app.plan.throws.filter(th => {
        const pos = pathPosAt(spawnD, app.plan.decoyPath, th.t, unitSpeedFor("decoy"));
        return G.dist(pos.x, pos.y, th.x, th.y) > app.perks.throwRange;
      }).length;
      push("decoy", `${app.plan.decoyPath.length} wp · ${app.plan.throws.length} throw${app.plan.throws.length === 1 ? "" : "s"}` +
        (badThrows ? ` <span class="bad">⚠ ${badThrows} out of reach</span>` : ""));
    }
    if (app.unitsAvail.hacker) {
      if (app.plan.blackouts.length) {
        const ok = hackerBlackoutCheck();
        const times = app.plan.blackouts.map(b => `${b.t.toFixed(1)}s`).join(", ");
        push("hacker", `blackout${app.plan.blackouts.length > 1 ? "s" : ""} @ ${times} ${ok ? '<span class="ok">✓ at box</span>' : '<span class="bad">⚠ won’t be at a box</span>'}`);
      } else {
        push("hacker", `${app.plan.hackerPath.length} wp · no blackout set`);
      }
    }
    if (app.unitsAvail.sapper && app.plan.sapperPath.length) {
      const charges = app.plan.sapperPath.filter(w => w.breach).length;
      push("sapper", `${app.plan.sapperPath.length} wp · ${charges}/${app.perks.breachCount ?? 1} charge${charges === 1 ? "" : "s"} armed`);
    }
    if (app.unitsAvail.gunner && (app.plan.gunnerPath.length || app.plan.suppresses.length)) {
      push("gunner", `${app.plan.gunnerPath.length} wp · ${app.plan.suppresses.length}/${app.perks.burstCount ?? 1} burst${app.plan.suppresses.length === 1 ? "" : "s"}`);
    }
    if (app.unitsAvail.drone && app.plan.blares.length) {
      push("drone", `📢 blare${app.plan.blares.length > 1 ? "s" : ""} @ ${app.plan.blares.map(b => b.t.toFixed(1) + "s").join(", ")}`);
    }
    if (app.unitsAvail.sniper) {
      const shotBits = shots.map((s, i) =>
        `<span class="${s.aim ? "ok" : "bad"}">S${i + 1}${s.aim ? "✓" : "—"}@${s.fireTime.toFixed(1)}s</span>`).join(" · ");
      push("sniper", `<span class="${perchOk ? "ok" : "bad"}">${perchOk ? "P" + (app.plan.perchIndex + 1) : "no perch"}</span> · ${shotBits}`);
    }
  } else {
    lines.push(`<span class="ok">Observation only — no shot. Spotted watchers just abort the op.</span>`);
  }
  $("planStatus").innerHTML = lines.join("<br>");

  if (!recon) {
    $("fireLabel").textContent = `${shots.length > 1 ? `SHOT ${app.activeShot + 1} · ` : ""}${activeShotObj().fireTime.toFixed(1)}s`;
  }
  $("scrubLabel").textContent = `${app.previewT.toFixed(1)}s`;
  if (recon) {
    const anyOrders = RECON_UNITS.some(k => (pathsByKind()[k] || []).length);
    $("btnExecute").disabled = !anyOrders;
    $("btnExecute").textContent = anyOrders ? "▶ RUN RECON — FREE" : "ROUTE A WATCHER FIRST";
  } else {
    const aimedShots = shots.filter(s => s.aim).length;
    const poisons = app.plan.scoutPath.filter(w => w.poison).length;
    const melee = app.plan.assassinPath.length ? 1 : 0;
    const kills = aimedShots + poisons + melee;
    const n = targetCount(app.level);
    const ok = kills >= 1 && (aimedShots === 0 || perchOk);
    $("btnExecute").disabled = !ok;
    $("btnExecute").textContent =
      kills === 0 ? (app.unitsAvail.sniper ? "PLAN A KILL — SHOT, POISON, OR BLADE" : "PLAN A KILL — PARK THE ASSASSIN OR ARM POISON")
      : (aimedShots > 0 && !perchOk) ? "PICK A PERCH FIRST"
      : kills < n ? `▶ EXECUTE — ${kills}/${n} KILLS PLANNED`
      : aimedShots === 0 ? "▶ EXECUTE — SILENT PLAN, NO RIFLE"
      : n > 1 ? `▶ EXECUTE — ${kills} KILLS PLANNED`
      : `▶ EXECUTE — FIRES @ ${shots[0].fireTime.toFixed(1)}s`;
  }

  // Shot selector (multi-target contracts only).
  const sc = $("shotControls");
  if (!recon && app.activeUnit === "sniper" && shots.length > 1) {
    sc.classList.remove("hidden");
    sc.innerHTML = "";
    shots.forEach((s, i) => {
      const b = document.createElement("button");
      b.className = "btn small" + (i === app.activeShot ? " active" : "");
      b.textContent = `SHOT ${i + 1} ${s.aim ? "✓" : "—"} ${s.fireTime.toFixed(1)}s`;
      b.onclick = () => {
        app.activeShot = i;
        $("fireSlider").value = s.fireTime;
        Sound.click();
        refreshPlanPanel();
      };
      sc.appendChild(b);
    });
  } else {
    sc.classList.add("hidden");
  }
  $("btnLegMode").textContent = `MOVE: ${app.legMode.toUpperCase()}`;
  $("btnLegMode").classList.toggle("active", app.legMode === "sneak");
  $("btnDecoyOrder").textContent = `ORDER: ${app.decoyOrder.toUpperCase()}`;
  $("btnDecoyOrder").classList.toggle("active", app.decoyOrder === "throw");

  // Contextual control rows (the assassin shares the MOVE toggle, not the scout's tricks).
  $("scoutControls").classList.toggle("hidden", !["scout", "assassin"].includes(app.activeUnit));
  $("btnTap").classList.toggle("hidden", app.activeUnit !== "scout");
  $("btnPoison").classList.toggle("hidden", app.activeUnit !== "scout" || !app.perks.poison || app.mode === "recon");
  $("btnSmoke").classList.toggle("hidden", app.activeUnit !== "scout" || !app.perks.smoke);
  $("holdControls").classList.toggle("hidden", !["scout", "drone", "decoy", "hacker"].includes(app.activeUnit));
  $("decoyControls").classList.toggle("hidden", app.activeUnit !== "decoy");
  $("hackerControls").classList.toggle("hidden", app.activeUnit !== "hacker");
  $("droneControls").classList.toggle("hidden", app.activeUnit !== "drone" || !app.perks.blare);
  $("gunnerControls").classList.toggle("hidden", app.activeUnit !== "gunner" || app.mode === "recon");
  $("sapperControls").classList.toggle("hidden", app.activeUnit !== "sapper" || app.mode === "recon");

  // Assassin ATTACK / DEFEND orders.
  if (app.activeUnit !== "assassin") app.assassinPick = false;
  $("assassinControls").classList.toggle("hidden", app.activeUnit !== "assassin");
  const mk = app.plan.assassinMark;
  $("btnAttack").textContent = app.assassinPick ? "⚔ CLICK A TARGET"
    : mk != null ? `⚔ HUNTING ${app.level.enemies[mk].name}` : "⚔ ATTACK";
  $("btnAttack").classList.toggle("active", app.assassinPick || mk != null);
  const wd = app.plan.assassinGuard;
  $("btnDefend").textContent = wd ? `🛡 GUARDING ${UNIT_INFO[wd].label}` : "🛡 DEFEND";
  $("btnDefend").classList.toggle("active", !!wd);

  // Per-unit RUN / HOLD stance (any unit that can be hunted on foot).
  const stanceKinds = ["scout", "assassin", "spotter", "decoy", "hacker", "sapper", "gunner", "lockpick"];
  $("stanceControls").classList.toggle("hidden", !stanceKinds.includes(app.activeUnit));
  const st = (app.plan.stance || {})[app.activeUnit] || "run";
  $("btnStance").textContent = `IF SEEN: ${st.toUpperCase()}`;
  $("btnStance").classList.toggle("active", st === "hold");
  refreshCoach();
}

let hintTimer = null;
function hint(msg, flash = false) {
  const el = $("hintText");
  el.textContent = msg;
  el.classList.toggle("flash", flash);
  if (flash) {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => el.classList.remove("flash"), 1200);
  }
}

function setPreview(t) {
  app.previewT = Math.max(0, Math.min(app.level.duration, t));
  $("scrubSlider").value = app.previewT;
  $("scrubLabel").textContent = `${app.previewT.toFixed(1)}s`;
}

// ---------------------------------------------------------------- planning input
function canvasToWorld(e) {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) * (canvas.width / rect.width)) / 20;
  const y = ((e.clientY - rect.top) * (canvas.height / rect.height)) / 20;
  return { x, y };
}

canvas.addEventListener("mousemove", e => {
  app.hover = app.state === "plan" ? canvasToWorld(e) : null;
});
canvas.addEventListener("mouseleave", () => { app.hover = null; });

// Is this unit currently shown on the planning map? (mirrors the renderer's rule)
function unitOnMap(kind) {
  if (kind === "scout") return true;
  if (!app.unitsAvail[kind]) return false;
  if ((pathsByKind()[kind] || []).length) return true;
  if (kind === "decoy" && app.plan.throws.length) return true;
  if (kind === "hacker" && app.plan.blackouts.length) return true;
  return false;
}

canvas.addEventListener("click", e => {
  if (app.state !== "plan") return;
  const p = canvasToWorld(e);

  // ATTACK order: a click while picking marks the nearest located enemy.
  if (app.activeUnit === "assassin" && app.assassinPick) {
    let best = -1, bestD = 1.4;
    app.level.enemies.forEach((def, i) => {
      if (!app.intel.known.has(i) && !devOn("revealMap")) return;
      const g = patrolPosAt(def, app.previewT);
      const d = G.dist(g.x, g.y, p.x, p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) {
      app.plan.assassinMark = best;
      app.assassinPick = false;
      Sound.click();
      hint(`Assassin will hunt ${app.level.enemies[best].name} — breaking off to strike the moment they're reachable.`);
    } else {
      hint("Mark a located enemy — click one you've actually spotted (a solid marker, not a fuzzy blob or fog).", true);
    }
    refreshPlanPanel();
    return;
  }

  // Clicking near a perch selects it (needs a hired sniper; they stay home during recon).
  if (app.mode !== "recon" && app.unitsAvail.sniper) {
    const near = app.level.perches.findIndex(pc => G.dist(pc.x, pc.y, p.x, p.y) < 1.3);
    if (near >= 0) {
      app.plan.perchIndex = near;
      app.activeUnit = "sniper";
      Sound.click();
      hint(`Sniper set up at perch P${near + 1}. Now click where the bullet should go.`);
      buildUnitButtons();
      refreshPlanPanel();
      return;
    }
  }

  // Clicking a crew member on the map selects them (not while placing throws —
  // there, every click means "the noisemaker lands here").
  if (!(app.activeUnit === "decoy" && app.decoyOrder === "throw")) {
    for (const kind of ["scout", "assassin", "spotter", "drone", "decoy", "hacker", "sapper", "gunner", "lockpick"]) {
      if (kind === app.activeUnit || !unitOnMap(kind)) continue;
      const pos = pathPosAt(unitSpawn(app.level, kind), pathsByKind()[kind] || [], app.previewT, unitSpeedFor(kind));
      if (G.dist(pos.x, pos.y, p.x, p.y) < 0.9) {
        app.activeUnit = kind;
        Sound.click();
        hint(`${UNIT_INFO[kind].label} selected.`);
        buildUnitButtons();
        refreshPlanPanel();
        return;
      }
    }
  }

  if (app.activeUnit === "sniper") {
    if (app.plan.perchIndex == null) { hint("Pick a perch first — click one of the crosshair markers.", true); return; }
    activeShotObj().aim = { x: p.x, y: p.y };
    Sound.click();
    // Multi-shot contracts: hop to the next un-aimed shot automatically.
    const next = app.plan.shots.findIndex(s => !s.aim);
    if (next >= 0) {
      app.activeShot = next;
      $("fireSlider").value = app.plan.shots[next].fireTime;
      hint(`Shot ${next === 0 ? 1 : next + 1}? Aim SHOT ${next + 1} now — each target needs its own bullet.`);
    } else if (app.plan.shots.length > 1) {
      hint("All shots aimed. Stagger the fire times — the first impact is LOUD, and the other target will bolt.");
    }
    refreshPlanPanel();
    return;
  }

  if (app.activeUnit === "decoy" && app.decoyOrder === "throw") {
    if (app.plan.throws.length >= app.perks.maxThrows) {
      hint(`${app.perks.maxThrows} noisemakers is all the Decoy carries${app.perks.maxThrows < 6 ? " — the Extra Satchel holds more" : ""}.`, true);
      return;
    }
    // Never schedule a throw before the decoy has finished walking its path.
    const spawnD = unitSpawn(app.level, "decoy");
    const arrive = pathIntervals(spawnD, app.plan.decoyPath, unitSpeedFor("decoy")).total;
    const t = Math.max(app.previewT, Math.round(arrive * 10) / 10);
    const pos = pathPosAt(spawnD, app.plan.decoyPath, t, unitSpeedFor("decoy"));
    if (G.dist(pos.x, pos.y, p.x, p.y) > app.perks.throwRange) {
      hint("Out of throwing range — path the Decoy closer first (ORDER: MOVE), or pick a nearer landing spot.", true);
      return;
    }
    app.plan.throws.push({ t, x: p.x, y: p.y });
    app.plan.throws.sort((a, b) => a.t - b.t);
    Sound.tap();
    if (t > app.previewT + 0.01) setPreview(t);
    hint(`Throw scheduled at ${t.toFixed(1)}s${t > arrive + 0.05 ? "" : " — the moment the Decoy is in position"}. Drag the ♪ on the timeline to retime it.`);
    refreshPlanPanel();
    return;
  }

  if (app.activeUnit === "gunner" && app.gunnerOrder === "suppress") {
    if (app.plan.suppresses.length >= (app.perks.burstCount ?? 1)) {
      hint(`${app.perks.burstCount ?? 1} burst${(app.perks.burstCount ?? 1) > 1 ? "s" : ""} is all the belt holds.`, true);
      return;
    }
    const spawnG = unitSpawn(app.level, "gunner");
    const arrive = pathIntervals(spawnG, app.plan.gunnerPath, unitSpeedFor("gunner")).total;
    const t = Math.max(app.previewT, Math.round(arrive * 10) / 10);
    const pos = pathPosAt(spawnG, app.plan.gunnerPath, t, unitSpeedFor("gunner"));
    if (G.dist(pos.x, pos.y, p.x, p.y) > (app.perks.suppressRange ?? 12)) {
      hint("Out of burst range — path the Gunner closer, or pick a nearer point.", true);
      return;
    }
    app.plan.suppresses.push({ t, x: p.x, y: p.y });
    app.plan.suppresses.sort((a, b) => a.t - b.t);
    Sound.tap();
    if (t > app.previewT + 0.01) setPreview(t);
    hint(`Burst scheduled at ${t.toFixed(1)}s — guards near the point eat dirt for ${app.perks.cowerDur ?? 5}s. Drag the 🔫 on the timeline to retime.`);
    refreshPlanPanel();
    return;
  }

  // Waypoint for the active path unit. Ground units can't cross walls; the drone flies.
  const path = activePath();
  if (!path) return;
  const spawn = unitSpawn(app.level, app.activeUnit);
  const last = path.length ? path[path.length - 1] : spawn;
  if (app.activeUnit !== "drone" && G.losBlocked(last.x, last.y, p.x, p.y, app.level.walls, false)) {
    hint("Path blocked by a wall — go around, or through a door gap.", true);
    return;
  }
  const wp = {
    x: Math.max(0.5, Math.min(WORLD.w - 0.5, p.x)),
    y: Math.max(0.5, Math.min(WORLD.h - 0.5, p.y)),
    hold: 0,
  };
  if (app.activeUnit === "scout") { wp.mode = app.legMode; wp.tap = false; }
  if (app.activeUnit === "assassin") wp.mode = app.legMode === "cover" ? "walk" : app.legMode;
  path.push(wp);
  Sound.click();
  refreshPlanPanel();
});

canvas.addEventListener("contextmenu", e => {
  e.preventDefault();
  if (app.state !== "plan") return;
  if (app.activeUnit === "decoy" && app.decoyOrder === "throw") app.plan.throws.pop();
  else if (app.activeUnit === "sniper") activeShotObj().aim = null;
  else (activePath() || []).pop();
  refreshPlanPanel();
});

// Timeline: drag the FIRE marker, a throw ♪, or the blackout ⚡ to retime it;
// drag anywhere else to scrub the preview.
let tlDragging = null; // null | "scrub" | "fire" | "order"
let tlDragObj = null;  // the throw/blackout being retimed
timelineCanvas.addEventListener("pointerdown", e => {
  if (app.state !== "plan") return;
  const rect = timelineCanvas.getBoundingClientRect();
  const xpix = (e.clientX - rect.left) * (timelineCanvas.width / rect.width);
  const distTo = t => Math.abs(xpix - Renderer.timelineXOf(timelineCanvas, app, t));
  tlDragObj = null;
  let bestShot = null;
  if (app.mode !== "recon") {
    for (const s of app.plan.shots) {
      if (s.fireTime == null) continue;
      if (distTo(s.fireTime) < 12 && (!bestShot || distTo(s.fireTime) < distTo(bestShot.fireTime))) bestShot = s;
    }
  }
  if (bestShot) {
    tlDragging = "fire";
    tlDragObj = bestShot;
    app.activeShot = app.plan.shots.indexOf(bestShot);
  } else {
    for (const list of [app.plan.throws, app.plan.blackouts, app.plan.blares, app.plan.suppresses]) {
      for (const o of list || []) {
        if (distTo(o.t) < 9 && (!tlDragObj || distTo(o.t) < distTo(tlDragObj.t))) tlDragObj = o;
      }
    }
    tlDragging = tlDragObj ? "order" : "scrub";
  }
  timelineCanvas.setPointerCapture(e.pointerId);
  tlDrag(e);
});
function tlDrag(e) {
  const t = Renderer.timelineTimeAt(timelineCanvas, app, e.clientX);
  if (tlDragging === "fire") {
    tlDragObj.fireTime = t;
    app.plan.fireTouched = true;
    $("fireSlider").value = t;
    refreshPlanPanel();
  } else if (tlDragging === "order") {
    tlDragObj.t = t;
    refreshPlanPanel();
  } else {
    setPreview(t);
  }
}
timelineCanvas.addEventListener("pointermove", e => {
  if (tlDragging && app.state === "plan") tlDrag(e);
});
timelineCanvas.addEventListener("pointerup", () => {
  if (tlDragging === "order") {
    for (const list of [app.plan.throws, app.plan.blackouts, app.plan.blares, app.plan.suppresses]) {
      (list || []).sort((a, b) => a.t - b.t);
    }
  }
  tlDragging = null;
  tlDragObj = null;
});

// ---------------------------------------------------------------- buttons
$("btnLegMode").onclick = () => {
  const modes = app.perks.undercover ? ["sneak", "walk", "cover"] : ["sneak", "walk"];
  app.legMode = modes[(modes.indexOf(app.legMode) + 1) % modes.length];
  if (app.legMode === "cover") {
    hint("COVER: the scout walks in the open, disguised — footsteps draw no attention, but 3.5 seconds under direct scrutiny blows the disguise.");
  }
  refreshPlanPanel();
};
$("btnTap").onclick = () => {
  const path = app.plan.scoutPath;
  if (!path.length) { hint("Add a waypoint first — the scout taps the wall when they arrive there.", true); return; }
  path[path.length - 1].tap = !path[path.length - 1].tap;
  Sound.tap();
  hint(path[path.length - 1].tap
    ? "Tap armed: the scout knocks on arrival. Targets back AWAY from the sound, guards come TOWARD it."
    : "Tap removed from the last waypoint.");
  refreshPlanPanel();
};

$("btnSmoke").onclick = () => {
  const path = app.plan.scoutPath;
  if (!path.length) { hint("Add a waypoint first — the scout pops smoke when they arrive there.", true); return; }
  const wp = path[path.length - 1];
  wp.smoke = !wp.smoke;
  Sound.tap();
  hint(wp.smoke
    ? "Smoke armed: an 8-second cloud nobody can see through. Cover a crossing, blind a cone, or screen the assassin's approach."
    : "Smoke removed from the last waypoint.");
  refreshPlanPanel();
};

$("btnPoison").onclick = () => {
  const path = app.plan.scoutPath;
  if (!path.length) { hint("Add a waypoint first — the scout doses the spot when they arrive there.", true); return; }
  const wp = path[path.length - 1];
  wp.poison = !wp.poison;
  Sound.tap();
  if (wp.poison) {
    // Sanity-check the placement against known routine stops.
    const nearSpot = app.level.enemies.some(def => def.isTarget &&
      def.patrol.some(w => (w.wait || 0) >= 3 && G.dist(w.x, w.y, wp.x, wp.y) <= TUNING.poisonReach));
    hint(nearSpot
      ? "Poison armed: the scout doses this routine stop on arrival. The target dies quietly next time they linger here — no gunshot, no panic."
      : "Poison armed — but this waypoint isn't within reach of a ☠ routine stop. Move it onto one or the dose is wasted.", !nearSpot);
  } else {
    hint("Poison removed from the last waypoint.");
  }
  refreshPlanPanel();
};

function adjustHold(delta) {
  const path = activePath();
  if (!path || !path.length) { hint("Add a waypoint first — HOLD makes the unit wait there.", true); return; }
  const wp = path[path.length - 1];
  wp.hold = Math.max(0, (wp.hold || 0) + delta);
  hint(`Holding ${wp.hold}s at waypoint ${path.length}. Use holds to sync arrivals with the fire time.`);
  refreshPlanPanel();
}
$("btnHoldPlus").onclick = () => adjustHold(5);
$("btnHoldMinus").onclick = () => adjustHold(-5);

$("btnStance").onclick = () => {
  if (!app.plan.stance) app.plan.stance = {};
  const cur = app.plan.stance[app.activeUnit] || "run";
  app.plan.stance[app.activeUnit] = cur === "run" ? "hold" : "run";
  Sound.click();
  hint(app.plan.stance[app.activeUnit] === "hold"
    ? `${UNIT_INFO[app.activeUnit].label} will HOLD if spotted — no panic sprint, stays quiet and on-plan (still fights back if able).`
    : `${UNIT_INFO[app.activeUnit].label} will RUN if spotted — sprint the route to try to escape.`);
  refreshPlanPanel();
};

// DEV panel: each toggle flips one playtest option.
$("devPanel").addEventListener("click", e => {
  const btn = e.target.closest(".devToggle");
  if (btn) toggleDevOpt(btn.dataset.dev);
});

// Teammates the assassin can bodyguard: any deployed crew (with orders), plus a
// leading OFF entry so cycling can turn the order back off.
function guardableWards() {
  const kinds = ["scout", "spotter", "drone", "decoy", "hacker", "sapper", "gunner", "lockpick"];
  const deployed = kinds.filter(k => app.unitsAvail[k] && (pathsByKind()[k] || []).length);
  return [null, ...deployed];
}
$("btnAttack").onclick = () => {
  if (app.plan.assassinMark != null) {
    app.plan.assassinMark = null;
    app.assassinPick = false;
    hint("Hunt order cleared.");
  } else {
    app.assassinPick = !app.assassinPick;
    hint(app.assassinPick
      ? "Click a located enemy on the map — the assassin will hunt them down, breaking off its route the moment they're reachable."
      : "");
  }
  Sound.click();
  refreshPlanPanel();
};
$("btnDefend").onclick = () => {
  const wards = guardableWards();
  const i = wards.indexOf(app.plan.assassinGuard ?? null);
  const next = wards[(i + 1) % wards.length];
  app.plan.assassinGuard = next;
  app.assassinPick = false;
  hint(next
    ? `Assassin will bodyguard the ${UNIT_INFO[next].label} — shadowing them and cutting down anyone who charges.`
    : (wards.length === 1 ? "No teammate is deployed to guard — give another unit orders first." : "Bodyguard order cleared."), wards.length === 1 && !next);
  Sound.click();
  refreshPlanPanel();
};

$("btnDecoyOrder").onclick = () => {
  app.decoyOrder = app.decoyOrder === "move" ? "throw" : "move";
  hint(app.decoyOrder === "throw"
    ? "THROW mode: scrub PREVIEW to the moment, then click where the noisemaker should land (range matters!)."
    : "MOVE mode: click to path the Decoy closer to where the throws need to reach.");
  refreshPlanPanel();
};

$("btnBlackout").onclick = () => {
  // Never schedule the blackout before the hacker has finished walking there.
  const spawnH = unitSpawn(app.level, "hacker");
  const arrive = pathIntervals(spawnH, app.plan.hackerPath, unitSpeedFor("hacker")).total;
  const t = Math.max(app.previewT, Math.round(arrive * 10) / 10);
  if (app.plan.blackouts.length >= app.perks.maxBlackouts) app.plan.blackouts.shift();
  app.plan.blackouts.push({ t });
  app.plan.blackouts.sort((a, b) => a.t - b.t);
  Sound.powerDown();
  if (t > app.previewT + 0.01) setPreview(t);
  const ok = hackerBlackoutCheck();
  hint(ok
    ? `Blackout scheduled at ${t.toFixed(1)}s — lights out for ${app.perks.blackoutDur}s. Drag the ⚡ on the timeline to retime it.`
    : `Blackout scheduled at ${t.toFixed(1)}s — but the Hacker won't be at a ⚡ box then. Path them to a box first (their path should END at the ⚡).`, !ok);
  refreshPlanPanel();
};
$("btnBlackoutClear").onclick = () => { app.plan.blackouts = []; refreshPlanPanel(); };

$("btnBlare").onclick = () => {
  if (app.plan.blares.length >= 3) { hint("Three blares is plenty — the speaker overheats.", true); return; }
  app.plan.blares.push({ t: app.previewT });
  app.plan.blares.sort((a, b) => a.t - b.t);
  Sound.tap();
  hint(`Blare scheduled at ${app.previewT.toFixed(1)}s — a 14m wall of noise from wherever the drone is at that moment. Drag the 📢 on the timeline to retime.`);
  refreshPlanPanel();
};
$("btnBlareClear").onclick = () => { app.plan.blares = []; refreshPlanPanel(); };

$("btnGunnerOrder").onclick = () => {
  app.gunnerOrder = app.gunnerOrder === "move" ? "suppress" : "move";
  $("btnGunnerOrder").textContent = `ORDER: ${app.gunnerOrder.toUpperCase()}`;
  hint(app.gunnerOrder === "suppress"
    ? "SUPPRESS mode: click a point — the burst schedules itself for when the Gunner is in position. Guards near it eat dirt."
    : "MOVE mode: click to path the Gunner into a firing position.");
  refreshPlanPanel();
};

$("btnBreach").onclick = () => {
  const path = app.plan.sapperPath;
  if (!path.length) { hint("Add a waypoint first — the Sapper plants the charge when they arrive there.", true); return; }
  const wp = path[path.length - 1];
  wp.breach = !wp.breach;
  Sound.tap();
  hint(wp.breach
    ? "Charge armed 💥: the nearest wall within 1.5m of this waypoint gets a hole blown in it. New lanes for bullets, bodies, and eyes — and everyone will hear it."
    : "Charge removed from the last waypoint.");
  refreshPlanPanel();
};

$("btnReset").onclick = () => {
  if (!confirm("HARD RESET: wipe your save (cash, crew, upgrades, gear, progress) and start over?")) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
};

$("btnUndo").onclick = () => {
  if (app.activeUnit === "decoy" && app.decoyOrder === "throw") app.plan.throws.pop();
  else (activePath() || []).pop();
  refreshPlanPanel();
};
$("btnClear").onclick = () => {
  if (app.activeUnit === "sniper") { app.plan.shots.forEach(s => { s.aim = null; }); app.plan.perchIndex = null; }
  else if (app.activeUnit === "decoy") { app.plan.decoyPath = []; app.plan.throws = []; }
  else if (app.activeUnit === "hacker") { app.plan.hackerPath = []; app.plan.blackouts = []; }
  else if (app.activeUnit === "gunner") { app.plan.gunnerPath = []; app.plan.suppresses = []; }
  else {
    const pk = pathsByKind()[app.activeUnit];
    if (pk) pk.length = 0;
    if (app.activeUnit === "assassin") { app.plan.assassinMark = null; app.plan.assassinGuard = null; app.assassinPick = false; }
  }
  refreshPlanPanel();
};

$("fireSlider").oninput = e => { activeShotObj().fireTime = Number(e.target.value); app.plan.fireTouched = true; refreshPlanPanel(); };
$("scrubSlider").oninput = e => { setPreview(Number(e.target.value)); refreshPlanPanel(); };

$("btnExecute").onclick = () => {
  const recon = app.mode === "recon";
  if (recon) {
    const anyOrders = RECON_UNITS.some(k => (pathsByKind()[k] || []).length);
    if (!anyOrders) return;
    app.reconBase = { known: app.intel.known.size };
  } else {
    const aimedShots = app.plan.shots.filter(s => s.aim).length;
    const poisons = app.plan.scoutPath.filter(w => w.poison).length;
    const melee = app.plan.assassinPath.length ? 1 : 0;
    if (aimedShots + poisons + melee === 0) return;
    if (aimedShots > 0 && app.plan.perchIndex == null) return;
  }
  Sound.click();
  $("execTitle").textContent = recon ? "RECON LIVE" : "MISSION LIVE";
  app.sim = new Simulation(app.level, recon ? { ...app.plan, recon: true } : app.plan,
    app.perks, app.intel, app.unitsAvail, devSimOpts());
  app.state = "exec";
  app.timeScale = 1;
  app.holdTimer = 0;
  app.resultShown = false;
  app.impactAge = 0;
  app.shake = 0;
  app.shotPlayed = false;
  app.alertPlayed = false;
  app.blackoutPlayed = false;
  app.dronePlayed = false;
  app.lastEventCount = 0;
  app.hover = null;
  $("planPanel").classList.add("hidden");
  $("execPanel").classList.remove("hidden");
  $("coach").classList.add("hidden");
  setSpeedButtons(1);
};

function setSpeedButtons(s) {
  app.timeScale = s;
  for (const [id, v] of [["btnSpeed1", 1], ["btnSpeed2", 2], ["btnSpeed4", 4]]) {
    $(id).classList.toggle("active", v === s);
  }
}
$("btnSpeed1").onclick = () => setSpeedButtons(1);
$("btnSpeed2").onclick = () => setSpeedButtons(2);
$("btnSpeed4").onclick = () => setSpeedButtons(4);
$("btnAbort").onclick = () => {
  if (app.mode === "hit") app.intel.attempts++;
  else app.intel.reconOps = (app.intel.reconOps || 0) + 1;
  startPlanning();
};

$("tabRecon").onclick = () => {
  if (app.mode === "recon" || app.state !== "plan") return;
  Sound.click();
  setMode("recon");
  hint("RECON OP: route your scout and drone to observe the site. No shot — a spotted watcher just ends the op, and everything they saw stays on the map.");
};
$("tabHit").onclick = () => {
  if (app.mode === "hit" || app.state !== "plan") return;
  Sound.click();
  setMode("hit");
  hint("THE HIT: full crew, one bullet. Everything your recon learned is still on the map.");
};

$("btnMissions").onclick = () => showMissionSelect();
$("btnLegend").onclick = () => $("legendOverlay").classList.toggle("hidden");
$("btnHome").onclick = () => { buildHomebase(); $("homeOverlay").classList.toggle("hidden"); };
$("btnHomeClose").onclick = () => $("homeOverlay").classList.add("hidden");
$("btnLegendClose").onclick = () => $("legendOverlay").classList.add("hidden");
$("btnDeploy").onclick = () => { Sound.click(); startPlanning(); };
$("btnRetry").onclick = () => { Sound.click(); startPlanning(); };
$("btnToMissions").onclick = () => showMissionSelect();
$("btnNext").onclick = () => {
  if (app.resultMode === "recon") {
    setMode("hit");
    startPlanning();
    return;
  }
  const next = app.missionIdx + 1;
  if (next < LEVELS.length) openMission(next);
  else showMissionSelect();
};

// ---------------------------------------------------------------- results
function showResult() {
  const r = app.sim.result;
  app.resultMode = app.mode;

  // Recon debrief: no pay, no attempt burned — just what the watchers learned.
  if (app.mode === "recon") {
    app.intel.reconOps = (app.intel.reconOps || 0) + 1;
    const newKnown = app.intel.known.size - (app.reconBase ? app.reconBase.known : 0);
    const coverage = Math.round((countRevealed() / app.intel.grid.length) * 100);
    let reconDetail = r.detail;
    // Sightings and bodies during recon raise the alert too.
    const reconBump = Math.floor(Math.min(4, app.sim.susBumps) / 2);
    if (reconBump > 0) {
      app.intel.heat = Math.min(3, (app.intel.heat || 0) + reconBump);
      reconDetail += `\nSITE ALERT ${"●".repeat(app.intel.heat)}${"○".repeat(3 - app.intel.heat)} — they know something happened.`;
    }
    // A clean recon op lets the site cool off.
    if (r.success && app.sim.susBumps === 0 && (app.intel.heat || 0) > 0) {
      app.intel.heat -= 1;
      reconDetail += `\nThe site settled down while you watched — SITE ALERT ${"●".repeat(app.intel.heat)}${"○".repeat(3 - app.intel.heat)}.`;
    }
    $("resultTitle").textContent = r.title;
    $("resultTitle").className = r.success ? "success" : "fail";
    $("resultDetail").textContent = reconDetail;
    $("resultTip").textContent = r.success ? "" :
      "TRY THIS: watchers obey the same senses as everyone else — sneak, stay out of the cones, and let the drone take the risky rooms.";
    $("resultTip").classList.toggle("hidden", r.success);
    const lost = app.sim.lostIntel || 0;
    $("resultXP").textContent = `FREE op · ${newKnown} new hostile${newKnown === 1 ? "" : "s"} located · ${coverage}% of the site mapped` +
      (lost > 0 ? ` · ${lost} sighting${lost === 1 ? "" : "s"} LOST to the jam` : "");
    $("resultEvents").innerHTML = app.sim.events
      .map(ev => `<div>T+${ev.t.toFixed(1)}s — ${ev.msg}</div>`)
      .join("");
    $("btnNext").classList.remove("hidden");
    $("btnNext").textContent = "PLAN THE HIT ▶";
    $("btnRetry").textContent = "ANOTHER PASS";
    $("resultOverlay").classList.remove("hidden");
    refreshHud();
    return;
  }

  app.intel.attempts++;

  let pay;
  const cuts = [];
  if (r.success) {
    const base = app.save.cleared[app.missionIdx] ? 300 : app.level.pay;
    pay = base;
    // The client docks pay for sloppy work.
    for (const kind of ["scout", "assassin", "spotter", "decoy", "hacker"]) {
      const u = app.sim.units[kind];
      if (!u) continue;
      if (u.dead) {
        const cut = Math.round(base * 0.25);
        cuts.push(`−${fmtCash(cut)} ${UNIT_INFO[kind].label} lost in the field`);
        pay -= cut;
      } else if ((u.maxExposureFrac || 0) >= 0.5) {
        const cut = Math.round(base * 0.15);
        cuts.push(`−${fmtCash(cut)} ${UNIT_INFO[kind].label} nearly caught`);
        pay -= cut;
      }
    }
    if (app.sim.units.drone && app.sim.units.drone.dead) {
      cuts.push(`−${fmtCash(200)} drone lost`);
      pay -= 200;
    }
    if (app.sim.keyholderKills > 0) {
      const cut = Math.round(base * 0.1) * app.sim.keyholderKills;
      cuts.push(`−${fmtCash(cut)} keyholder${app.sim.keyholderKills > 1 ? "s" : ""} killed — messy`);
      pay -= cut;
    }
    pay = Math.max(Math.round(base * 0.25), pay);
    app.save.cleared[app.missionIdx] = true;
    app.save.mercyFails = 0; // a win ends the hard times
  } else if (r.reason === "civilian") {
    pay = 0; // the client walked: no pay, no intel money
    app.save.mercyFails = (app.save.mercyFails || 0) + 1;
  } else {
    // The client pays a little for intel from failed runs — capped so it can't be farmed.
    const earned = app.save.intelCash[app.missionIdx] || 0;
    pay = earned < 600 ? 150 : 0;
    app.save.intelCash[app.missionIdx] = earned + pay;
    app.save.mercyFails = (app.save.mercyFails || 0) + 1;
  }
  // Witnesses drive the alert now: each guard/civilian who saw your crew
  // leaves the site permanently warier for this mission. A noisy fail with
  // zero witnesses still rattles them a little.
  {
    const bump = Math.floor(Math.min(4, app.sim.susBumps)) +
      ((!r.success && app.sim.disturbed && app.sim.susBumps < 1) ? 1 : 0);
    if (bump > 0) app.intel.heat = Math.min(3, (app.intel.heat || 0) + bump);
  }
  markInjuries();
  app.save.cash += pay;
  persistSave();

  $("resultTitle").textContent = r.title;
  $("resultTitle").className = r.success ? "success" : "fail";
  let detail = r.detail;
  if (!r.success && r.reason === "miss") {
    detail += "\nIntel persists — adjust the plan and try again.";
  }
  if (!r.success && app.sim.disturbed) {
    detail += `\nSITE ALERT ${"●".repeat(app.intel.heat)}${"○".repeat(3 - app.intel.heat)} — they noticed something: slightly sharper senses, and the target has shuffled their routine. A clean RECON OP calms things back down.`;
  } else if (!r.success && (app.intel.heat || 0) === 0) {
    detail += "\nNobody noticed a thing — the site is still calm.";
  }
  $("resultDetail").textContent = detail;
  const tips = {
    "civilian": "TRY THIS: check who's near your bullet's whole path, not just the aim point — drag the timeline and watch the pale civilian ghosts. Or kill quietly: blade and poison never hit bystanders.",
    "miss": "TRY THIS: drag the timeline to your fire time — the ghosts show where everyone should be. If a noise moved him, the event log has the exact second it happened.",
    "spotted": "TRY THIS: watch the yellow vision cones while you scrub. Sneak instead of walking, route in behind their facing — or have the Hacker cut the lights.",
    "crew-lost": "TRY THIS: a spotted operative gets CHASED now — plan escape legs that outrun the guards, or keep a second killer (blade, poison, rifle) in reserve so one casualty doesn't end the contract.",
    "hit-other": "TRY THIS: someone walked through your bullet's lane. Nudge the fire time a second or two either way and rerun.",
    "timeout": "TRY THIS: the rifle never fired. Drag the red FIRE marker on the timeline to a moment when your aim point is actually occupied.",
  };
  $("resultTip").textContent = r.success ? "" : (tips[r.reason] || "");
  $("resultTip").classList.toggle("hidden", r.success);
  const nudge = firstAffordable();
  $("resultXP").textContent = `+${fmtCash(pay)} ${r.success ? "contract pay" : r.reason === "civilian" ? "— the client walked" : "intel pay"}` +
    (cuts.length ? `  (${cuts.join(" · ")})` : "") +
    (nudge ? `  ·  💰 ${nudge} affordable — see CREW` : "");
  $("resultEvents").innerHTML = app.sim.events
    .map(ev => `<div>T+${ev.t.toFixed(1)}s — ${ev.msg}</div>`)
    .join("");
  $("btnNext").classList.toggle("hidden", !r.success);
  $("btnNext").textContent = "NEXT CONTRACT";
  $("btnRetry").textContent = r.success ? "REPLAY MISSION" : "ADJUST PLAN";
  $("resultOverlay").classList.remove("hidden");
  refreshHud();
}

// ---------------------------------------------------------------- frame loop
function updateTicker() {
  const evts = app.sim.events.slice(-4);
  $("ticker").innerHTML = evts.map(ev => `<div class="evt">T+${ev.t.toFixed(1)} ${ev.msg}</div>`).join("");
  $("execTime").textContent = `T+${app.sim.t.toFixed(1)}s`;
}

function execSounds(sim) {
  if (sim.blackoutUntil > 0 && !app.blackoutPlayed) { Sound.powerDown(); app.blackoutPlayed = true; }
  if (sim.units.drone && sim.units.drone.dead && !app.dronePlayed) { Sound.droneDown(); app.dronePlayed = true; }
  // React to new sim events as they happen.
  while (app.lastEventCount < sim.events.length) {
    const msg = sim.events[app.lastEventCount].msg;
    if (msg.includes("Noisemaker") || msg.includes("tapped")) Sound.tap();
    else if (msg.includes("charged") || msg.includes("bolted")) Sound.alert();
    else if (msg.includes("BREACH") || msg.includes("Suppressive")) Sound.shot();
    else if (msg.includes("shot the") || msg.includes("cut the")) Sound.droneDown();
    else if (msg.includes("failed")) Sound.error();
    app.lastEventCount++;
  }
}

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (app.state === "exec" && app.sim) {
    const sim = app.sim;
    if (sim.phase === "run") {
      app.shotPlayed = false; // re-arm the shot sound for follow-up shots
      sim.update(dt * app.timeScale);
      updateTicker();
      execSounds(sim);
      app.cam.x = G.lerp(app.cam.x, 24, 0.04);
      app.cam.y = G.lerp(app.cam.y, 16, 0.04);
      app.cam.zoom = G.lerp(app.cam.zoom, 1, 0.06);
      if (sim.phase === "cam" && !app.shotPlayed) { Sound.shot(); app.shotPlayed = true; }
      if (sim.result && !sim.result.success && sim.result.reason === "spotted" && !app.alertPlayed) {
        Sound.alert(); app.alertPlayed = true;
      }
    } else if (sim.phase === "cam") {
      if (!app.shotPlayed) { Sound.shot(); app.shotPlayed = true; }
      sim.update(dt * 0.07); // slow motion
      app.cam.x = G.lerp(app.cam.x, sim.bullet.x, 0.18);
      app.cam.y = G.lerp(app.cam.y, sim.bullet.y, 0.18);
      app.cam.zoom = G.lerp(app.cam.zoom, 3.2, 0.1);
      if (sim.phase === "done") {
        app.holdTimer = 1.2;
        app.shake = sim.bullet.hitEnemy ? 0.8 : 0.4;
        if (sim.result.success || sim.result.reason === "hit-other") Sound.hit();
      }
    } else if (sim.phase === "done") {
      if (sim.bullet) app.impactAge += dt;
      app.shake = Math.max(0, app.shake - dt * 2.2);
      if (["spotted", "timeout", "crew-lost"].includes(sim.result.reason)) {
        if (!app.resultShown) { app.holdTimer = 0.6; app.resultShown = true; }
      }
      if (app.holdTimer > 0) {
        app.holdTimer -= dt;
        if (app.holdTimer <= 0) showResult();
      } else if ($("resultOverlay").classList.contains("hidden") && !app.resultShown) {
        app.holdTimer = 0.9;
        app.resultShown = true;
      }
    }
  }

  Renderer.draw(ctx, app);
  if (app.level && app.state !== "menu") Renderer.drawTimeline(tctx, app);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
refreshHud();
showMissionSelect();
hint("Pick a unit, then click the map to give orders. Drag the timeline to scrub the plan.");
requestAnimationFrame(frame);
