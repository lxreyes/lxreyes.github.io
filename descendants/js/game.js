// ============================================================
// game.js — game state, update loop, and rendering.
//
// The game is a state machine:
//   title -> name -> estate -> heirs -> floorselect -> play
//     -> (descend -> play ...) -> (gameover | victory) -> estate -> ...
// Each state has its own draw function and input handling.
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let state = 'title';
let keys = {};
let save = loadSave();
let run = null;            // everything about the current attempt
let heirsOffered = [];     // the 3 descendants to choose from
let heirIndex = 0;
let estateIndex = 0;
let nameBuffer = '';
let descend = null;        // elevator ride animation
let menu = null;           // in-run overlay: 'inventory' | 'craft' | 'brew' | 'chest' | 'floors'
let activeChest = null;    // the container being looted
let menuIndex = 0;
let paused = false;
let muted = false;
let confirmReset = false;  // first R arms the wipe, second R fires it
let animT = 0;             // global clock for menu/torch animation

// ---------------------------------------------------------
// Save data (persists in the browser via localStorage)
// ---------------------------------------------------------
function defaultSave() {
  const classes = {};
  for (const id in CLASSES) classes[id] = !CLASSES[id].task; // tasked classes start locked
  const upgrades = {};
  for (const id in UPGRADES) upgrades[id] = 0;
  return {
    gold: 0,
    upgrades,
    classes,
    generation: 1,
    wins: 0,
    floorUnlocked: 0,
    family: '',
    lastName: 'Sir Greg',
    lastFate: 'fallen',
    fallen: [],  // dead heirs; the Founder collects them
    stats: { kills: 0, chests: 0, blessings: 0, brews: 0, puzzles: 0, keymasters: 0, retires: 0, deaths: 0, gauntlets: 0 },
    minigames: { horde: 0, range: 0, coins: 0, dodge: 0, lava: 0, blitz: 0, shade: 0, whack: 0, mimics: 0, flame: 0, duel: 0, snake: 0, simon: 0 },
  };
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    const defaults = defaultSave();
    const merged = Object.assign(defaults, parsed);
    merged.classes = Object.assign(defaultSave().classes, parsed.classes || {});
    merged.upgrades = Object.assign(defaultSave().upgrades, parsed.upgrades || {});
    merged.stats = Object.assign(defaultSave().stats, parsed.stats || {});
    merged.minigames = Object.assign(defaultSave().minigames, parsed.minigames || {});
    return merged;
  } catch (e) {
    return defaultSave();
  }
}

function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
}

// Lifetime tally for a class-unlock task.
function taskValue(stat) {
  return stat === 'wins' ? save.wins : (save.stats[stat] || 0);
}

// Bump a lifetime stat and see if any class earned its way in.
function bumpStat(stat, n) {
  save.stats[stat] = (save.stats[stat] || 0) + (n || 1);
  checkClassTasks();
}

function checkClassTasks() {
  for (const id in CLASSES) {
    const t = CLASSES[id].task;
    if (!t || save.classes[id]) continue;
    if (taskValue(t.stat) >= t.need) {
      save.classes[id] = true;
      saveGame();
      if (run && state === 'play') {
        addText(run.hero.x, run.hero.y - 44, 'New class: ' + CLASSES[id].name + '!', '#7de8ff');
      }
      SFX.unlock();
    }
  }
}

// Difficulty level: rises with each floor and each lineage victory.
function crypLevel() { return save.wins * 3 + (run ? Math.max(0, run.floor) : 0); }

// Palette for wherever we currently stand.
function floorPal() { return run.floor < 0 ? SURFACE : FLOORS[run.floor]; }

// ---------------------------------------------------------
// Heirs — every death, three descendants offer to take up the sword
// ---------------------------------------------------------
function unlockedClasses() {
  return Object.keys(CLASSES).filter(id => save.classes[id]);
}

function generateHeir(taken) {
  const classIds = unlockedClasses();
  const classId = classIds[Math.floor(Math.random() * classIds.length)];

  const roll = Math.random();
  const traitCount = roll < 0.15 ? 0 : roll < 0.75 ? 1 : 2;
  const traitIds = Object.keys(TRAITS);
  const traits = [];
  while (traits.length < traitCount) {
    const t = traitIds[Math.floor(Math.random() * traitIds.length)];
    if (!traits.includes(t)) traits.push(t);
  }

  let name;
  do {
    name = GREG_NAMES[Math.floor(Math.random() * GREG_NAMES.length)];
  } while (taken.includes(name) || name === save.lastName);

  return { name, classId, traits };
}

function offerHeirs() {
  heirsOffered = [];
  for (let i = 0; i < 3; i++) {
    heirsOffered.push(generateHeir(heirsOffered.map(h => h.name)));
  }
  heirIndex = 0;
}

// Turn a chosen heir into a live hero: class stats -> estate
// upgrades -> traits, in that order. Blessings apply later, on pickup.
function buildHero(heir) {
  const c = CLASSES[heir.classId];
  const s = {
    hp: c.hp, speed: c.speed, dmg: c.dmg, cd: c.cd, crit: c.crit,
    attack: c.attack, lifesteal: c.lifesteal || 0,
    radius: 15, goldMult: 1, dmgTaken: 1, regenMult: 1,
    myopia: false, noMap: false, grayscale: false,
    ...(c.flags || {}), // class passive flags: aegis, rage, pierce, necro...
  };
  s.hp += save.upgrades.vitality * 15;
  s.dmg += save.upgrades.strength * 3;
  s.speed *= 1 + save.upgrades.agility * 0.05;
  s.goldMult *= 1 + save.upgrades.fortune * 0.10;
  s.regen = REGEN_BASE + save.upgrades.recovery * 0.5;
  heir.traits.forEach(t => TRAITS[t].apply(s));
  s.regen *= s.regenMult;
  if (s.hardmode) { s.regen = 0; s.goldMult *= 2; } // the Revenant's bargain

  const hero = {
    ...s,
    maxHp: Math.round(s.hp),
    hp: Math.round(s.hp),
    x: W / 2, y: H / 2,
    face: { x: 0, y: -1 },
    swing: null,       // active melee arc
    spin: null,        // whirlwind special animation
    dash: null,        // dash special in progress
    spCd: 0,           // special ability cooldown remaining
    items: [],         // carried consumables
    itemSel: 0,        // which item Q uses (Tab / wheel to change)
    armor: null,       // crafted armor: { name, mult, color }
    weapon: null,      // main hand: flat damage bonus
    offhand: null,     // shield or trinket
    blockT: 0,         // Shield Wall active time (blocks projectiles)
    swiftT: 0,         // swiftness potion time remaining
    strengthT: 0,      // strength potion time remaining
    comboN: 0,         // shinobi combo stacks
    comboT: 0,
    chillT: 0,         // frost shard slow
    aegisT: 8,         // knight passive shield recharge
    aegisReady: false,
    regenDelay: 0,     // no regen for a few seconds after a hit
    attackTimer: 0,
    invuln: 0,
    bobT: 0,           // walk-cycle bounce
    heir,
  };

  // the class starting kit: a blade, a shield, a bottle — something
  const kit = c.kit || {};
  if (kit.weapon) hero.weapon = EQUIPMENT[kit.weapon];
  if (kit.offhand) hero.offhand = EQUIPMENT[kit.offhand];
  if (kit.armor) hero.armor = EQUIPMENT[kit.armor];
  hero.items = [];
  for (const id of (kit.items || [])) {
    const max = ITEMS[id].stack || 1;
    const st = hero.items.find(s2 => s2.id === id && s2.n < max);
    if (st) st.n++;
    else hero.items.push({ id, n: 1 });
  }
  return hero;
}

// ---------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------
function startRun(heir) {
  save.lastName = heir.name;
  // every ghost shuffles one floor closer to the Founder
  (save.fallen || []).forEach(f => {
    f.floor = Math.min(FLOORS.length - 1, (f.floor === undefined ? -1 : f.floor) + 1);
  });
  saveGame();
  run = {
    hero: buildHero(heir),
    floor: -1,
    dungeon: null,
    room: null,
    gold: 0,
    kills: 0,
    roomsCleared: 0,
    time: 0,
    lastHit: 'the crypt',
    blessings: [],
    materials: Object.keys(MATERIALS).reduce((m, id) => (m[id] = 0, m), {}),
    enemies: [],
    party: [],         // rescued ghost heirs fighting at your side
    minions: [],       // necromancer skeletons (persist across rooms)
    zones: [],         // paladin sanctuaries (per room)
    projectiles: [],
    particles: [],
    rings: [],
    texts: [],
    shake: 0,
    hitStop: 0,
    fade: 0.35,
    power: POWER_MAX,   // the lantern; when it dies, the Shade comes
    blackout: false,
    shade: null,
    onElevator: false,
    bossDead: false,
    victoryTimer: 0,
  };
  makeSurface();
  if (run.hero.packleader) {
    spawnMinionOf(run.hero.x + 34, run.hero.y, 'wolf');
  }
  state = 'play';
  paused = false;
  menu = null;
}

// ---------------------------------------------------------
// Minigames: one room, one rule, one high score.
// ---------------------------------------------------------
const MINIGAMES = [
  { id: 'horde', name: 'Horde', desc: 'Endless waves. Score: kills.' },
  { id: 'range', name: 'Target Range', desc: '30 seconds of pop-up targets.' },
  { id: 'coins', name: 'Coin Chase', desc: '30 seconds. Grab gold, dodge bats.' },
  { id: 'dodge', name: 'Bonestorm', desc: 'Survive the crossfire. Score: seconds.' },
  { id: 'lava', name: 'The Floor Is Lava', desc: 'Trust nothing you stand on. Score: seconds.' },
  { id: 'blitz', name: 'Lantern Blitz', desc: '45 seconds of lights-out boards. Score: boards.' },
  { id: 'shade', name: 'Shade Run', desc: 'Grab gems in the dark. It gets faster.' },
  { id: 'whack', name: 'Whack-a-Target', desc: 'They pop up. They pop away. 30 seconds.' },
  { id: 'mimics', name: 'Mimic Roulette', desc: 'Open chests. Some bite back. Score: safe opens.' },
  { id: 'flame', name: 'Keep the Flames', desc: 'Relight the braziers. All five dark and it ends.' },
  { id: 'duel', name: 'Keymaster Rush', desc: 'Endless duels, one keymaster at a time.' },
  { id: 'snake', name: 'Bone Snake', desc: 'Every gem grows your tail. Never touch it.' },
  { id: 'simon', name: 'Simon Says', desc: 'Watch the plates, then repeat the song.' },
];

// Simon's four plates, classic colors.
const SIMON_PADS = [
  { x: W / 2 - 110, y: H / 2 - 90, color: '#5ecf6a' },
  { x: W / 2 + 110, y: H / 2 - 90, color: '#e85454' },
  { x: W / 2 - 110, y: H / 2 + 90, color: '#ffd75e' },
  { x: W / 2 + 110, y: H / 2 + 90, color: '#5ea8e8' },
];
let minigameIndex = 0;

function startMinigame(id) {
  const heir = generateHeir([]);
  run = {
    hero: buildHero(heir),
    floor: 0,
    dungeon: null,
    room: null,
    gold: 0, kills: 0, roomsCleared: 0, time: 0,
    lastHit: 'the arena',
    blessings: [],
    materials: Object.keys(MATERIALS).reduce((m, k) => (m[k] = 0, m), {}),
    enemies: [], party: [], minions: [], zones: [],
    projectiles: [], particles: [], rings: [], texts: [],
    shake: 0, hitStop: 0, fade: 0.35,
    power: POWER_MAX, blackout: false, shade: null,
    onElevator: false, bossDead: false, victoryTimer: 0,
    minigame: {
      id, score: 0, spawnT: 0.5, cycleT: 1, tiles: [], seeded: false,
      t: ({ range: 30, coins: 30, whack: 30, blitz: 45 })[id] || 0,
      pz: id === 'blitz' ? genLightsBoard() : null,
    },
  };
  const room = makeRoom(0, 0, 0);
  room.type = 'normal';
  room.spawned = true;
  room.cleared = true;
  room.visited = true;
  room.seen = true;
  const rooms = new Map();
  rooms.set(roomKey(0, 0), room);
  run.dungeon = { rooms, start: room };
  enterRoom(room, null);
  const mg = run.minigame;
  if (id === 'mimics') { mg.batch = 1; mg.chests = mimicBatch(1); }
  if (id === 'flame') {
    mg.braziers = [
      { x: W / 2, y: H / 2 },
      { x: IX0 + 130, y: IY0 + 110 }, { x: IX1 - 130, y: IY0 + 110 },
      { x: IX0 + 130, y: IY1 - 110 }, { x: IX1 - 130, y: IY1 - 110 },
    ].map(b => ({ x: b.x, y: b.y, lit: true }));
  }
  if (id === 'simon') {
    mg.seq = [Math.floor(Math.random() * 4)];
    mg.phase = 'show'; mg.showI = 0; mg.phaseT = 1.0; mg.inputI = 0; mg.onPad = -1; mg.flash = null;
  }
  if (id === 'snake') { mg.trail = []; mg.segs = 0; mg.last = null; }
  if (id === 'duel') mg.spawnT = 0.8;
  if (run.hero.packleader) spawnMinionOf(run.hero.x + 34, run.hero.y, 'wolf');
  state = 'play';
  paused = false;
  menu = null;
}

function updateMinigame(dt) {
  const mg = run.minigame;
  run.power = POWER_MAX; // no lantern pressure in the arena

  if (mg.id === 'horde') {
    mg.t += dt;
    run.floor = Math.min(4, Math.floor(mg.t / 25)); // the waves grow up
    mg.spawnT -= dt;
    if (mg.spawnT <= 0 && run.enemies.length < 8) {
      mg.spawnT = Math.max(1.1, 2.4 - mg.t * 0.015);
      const pool = floorPool(run.floor);
      spawnEnemy(pool[Math.floor(Math.random() * pool.length)]);
      if (mg.t > 40) spawnEnemy(pool[Math.floor(Math.random() * pool.length)]);
    }
    mg.score = run.kills;
  } else if (mg.id === 'range') {
    mg.t -= dt;
    while (run.enemies.filter(e => e.type === 'target').length < 2) {
      spawnTargetAt({
        x: IX0 + 80 + Math.random() * (IX1 - IX0 - 160),
        y: IY0 + 70 + Math.random() * (IY1 - IY0 - 140),
      });
    }
    if (mg.t <= 0) endMinigame();
  } else if (mg.id === 'coins') {
    mg.t -= dt;
    mg.spawnT -= dt;
    if (mg.spawnT <= 0) {
      mg.spawnT = 1.4;
      dropCoins(
        IX0 + 80 + Math.random() * (IX1 - IX0 - 160),
        IY0 + 70 + Math.random() * (IY1 - IY0 - 140), 14, 4);
      if (Math.random() < 0.35 && run.enemies.length < 4) spawnEnemy('bat');
    }
    mg.score = run.gold;
    if (mg.t <= 0) endMinigame();
  } else if (mg.id === 'dodge') {
    // volleys of bone from the walls, faster and faster
    mg.t += dt;
    mg.score = Math.floor(mg.t);
    mg.spawnT -= dt;
    if (mg.spawnT <= 0) {
      mg.spawnT = Math.max(0.35, 1.1 - mg.t * 0.012);
      const side = Math.floor(Math.random() * 4);
      const ox = side === 0 ? IX0 + 10 : side === 1 ? IX1 - 10 : IX0 + 40 + Math.random() * (IX1 - IX0 - 80);
      const oy = side === 2 ? IY0 + 10 : side === 3 ? IY1 - 10 : IY0 + 40 + Math.random() * (IY1 - IY0 - 80);
      const base = Math.atan2(run.hero.y - oy, run.hero.x - ox);
      for (const spread of [-0.25, 0, 0.25]) {
        run.projectiles.push({
          x: ox, y: oy,
          vx: Math.cos(base + spread) * 240, vy: Math.sin(base + spread) * 240,
          r: 6, dmg: 12, friendly: false, kind: 'bone', rot: 0, color: '#e8e2d0',
        });
      }
    }
  } else if (mg.id === 'lava') {
    // patches of floor warn, then burn
    mg.t += dt;
    mg.score = Math.floor(mg.t);
    mg.cycleT -= dt;
    if (mg.cycleT <= 0) {
      mg.cycleT = Math.max(1.0, 2.1 - mg.t * 0.02);
      const n = Math.min(26, 6 + Math.floor(mg.t / 6));
      for (let i = 0; i < n; i++) {
        mg.tiles.push({
          tx: 1 + Math.floor(Math.random() * (W / TILE - 2)),
          ty: 1 + Math.floor(Math.random() * (H / TILE - 2)),
          phase: 'warn', pt: 0.8,
        });
      }
    }
    const hx = Math.floor(run.hero.x / TILE), hy = Math.floor(run.hero.y / TILE);
    mg.tiles = mg.tiles.filter(tl => {
      tl.pt -= dt;
      if (tl.phase === 'warn' && tl.pt <= 0) { tl.phase = 'hot'; tl.pt = 0.6; }
      else if (tl.phase === 'hot') {
        if (tl.tx === hx && tl.ty === hy) hurtPlayer(15, 'the floor');
        if (tl.pt <= 0) return false;
      }
      return true;
    });
  } else if (mg.id === 'blitz') {
    mg.t -= dt;
    if (mg.t <= 0) endMinigame();
  } else if (mg.id === 'shade') {
    // one gem at a time, in the dark, with company
    run.power = 0;
    run.blackout = true;
    run.shadeRespawn = undefined;
    if (!run.shade) {
      run.shade = { x: IX0 + 40, y: IY0 + 40, speed: SHADE.speed, t: 0 };
    }
    run.shade.speed = Math.min(SHADE.maxSpeed + 60, SHADE.speed + mg.score * 14);
    if (run.room.loot.coins.length === 0) {
      if (mg.seeded) mg.score++;
      mg.seeded = true;
      run.room.loot.coins.push({
        x: IX0 + 80 + Math.random() * (IX1 - IX0 - 160),
        y: IY0 + 70 + Math.random() * (IY1 - IY0 - 140),
        vx: 0, vy: 0, gem: true, val: 5, t: 0,
      });
    }
  } else if (mg.id === 'whack') {
    mg.t -= dt;
    mg.spawnT -= dt;
    if (mg.spawnT <= 0 && run.enemies.length < 4) {
      mg.spawnT = Math.max(0.5, 0.95 - (30 - mg.t) * 0.012);
      spawnTargetAt({
        x: IX0 + 80 + Math.random() * (IX1 - IX0 - 160),
        y: IY0 + 70 + Math.random() * (IY1 - IY0 - 140),
      });
      run.enemies[run.enemies.length - 1].moleT = 1.25;
    }
    run.enemies = run.enemies.filter(e =>
      e.type !== 'target' || (e.moleT = (e.moleT === undefined ? 99 : e.moleT) - dt) > 0);
    if (mg.t <= 0) {
      run.enemies = run.enemies.filter(e => e.type !== 'target');
      endMinigame();
    }
  } else if (mg.id === 'mimics') {
    mg.t += dt;
    if (mg.chests.every(c => c.open)) {
      mg.batch++;
      mg.chests = mimicBatch(mg.batch);
    }
  } else if (mg.id === 'flame') {
    mg.t += dt;
    mg.cycleT -= dt;
    if (mg.cycleT <= 0) {
      mg.cycleT = Math.max(0.9, 2.4 - mg.t * 0.03);
      const lit = mg.braziers.filter(b => b.lit);
      if (lit.length) lit[Math.floor(Math.random() * lit.length)].lit = false;
      if (mg.braziers.every(b => !b.lit)) {
        addText(W / 2, H / 2, 'The dark takes the room.', '#b06aff');
        SFX.blackout();
        endMinigame();
      }
    }
  } else if (mg.id === 'duel') {
    mg.t += dt;
    if (!run.enemies.some(e => e.type === 'guardian')) {
      if (mg.seeded) {
        mg.seeded = false;
        mg.score++;
        run.hero.hp = Math.min(run.hero.maxHp, run.hero.hp + run.hero.maxHp * 0.4);
        addText(run.hero.x, run.hero.y - 26, 'Duel won!', '#7dff8a');
        mg.spawnT = 1.6;
      }
      mg.spawnT -= dt;
      if (mg.spawnT <= 0) {
        spawnEnemy('guardian');
        applyGuardianVariant(run.enemies[run.enemies.length - 1]);
        mg.seeded = true;
      }
    }
  } else if (mg.id === 'snake') {
    mg.t += dt;
    const h = run.hero;
    // the tail follows your footprints — and only grows when you move
    if (!mg.last || Math.hypot(h.x - mg.last.x, h.y - mg.last.y) > 4) {
      mg.trail.unshift({ x: h.x, y: h.y });
      mg.last = mg.trail[0];
      if (mg.trail.length > 40 + mg.segs * 14) mg.trail.pop();
    }
    if (run.room.loot.coins.length === 0) {
      if (mg.seeded) { mg.score++; mg.segs++; }
      mg.seeded = true;
      run.room.loot.coins.push({
        x: IX0 + 80 + Math.random() * (IX1 - IX0 - 160),
        y: IY0 + 70 + Math.random() * (IY1 - IY0 - 140),
        vx: 0, vy: 0, gem: true, val: 5, t: 0,
      });
    }
    for (let i = 2; i < mg.segs; i++) {
      const seg = mg.trail[(i + 1) * 13];
      if (seg && Math.hypot(h.x - seg.x, h.y - seg.y) < h.radius + 8) {
        addText(h.x, h.y - 26, 'Bitten by your own bones!', '#e85454');
        SFX.death();
        endMinigame();
        break;
      }
    }
  } else if (mg.id === 'simon') {
    mg.t += dt;
    if (mg.flash) { mg.flash.t -= dt; if (mg.flash.t <= 0) mg.flash = null; }
    if (mg.phase === 'show') {
      mg.phaseT -= dt;
      if (mg.phaseT <= 0) {
        mg.showI++;
        if (mg.showI >= mg.seq.length) {
          mg.phase = 'input';
          mg.inputI = 0;
          mg.onPad = padUnder(run.hero);
        } else mg.phaseT = 0.55;
      }
    } else {
      const cur = padUnder(run.hero);
      if (cur !== mg.onPad) {
        mg.onPad = cur;
        if (cur !== -1) {
          mg.flash = { i: cur, t: 0.3 };
          if (cur === mg.seq[mg.inputI]) {
            mg.inputI++;
            SFX.select();
            if (mg.inputI >= mg.seq.length) {
              mg.score++;
              SFX.blessing();
              mg.seq.push(Math.floor(Math.random() * 4));
              mg.phase = 'show'; mg.showI = 0; mg.phaseT = 1.1;
            }
          } else {
            addText(W / 2, H / 2, 'Wrong note!', '#e85454');
            SFX.denied();
            endMinigame();
          }
        }
      }
    }
  }
}

// Six chests, some of them hungry. More mimics each batch.
function mimicBatch(batch) {
  const chests = [];
  for (let i = 0; i < 6; i++) {
    chests.push({
      x: W / 2 + ((i % 3) - 1) * 150,
      y: H / 2 + (i < 3 ? -75 : 75),
      open: false, mimic: false,
    });
  }
  let m = Math.min(3, 1 + Math.floor(batch / 2));
  while (m > 0) {
    const c = chests[Math.floor(Math.random() * 6)];
    if (!c.mimic) { c.mimic = true; m--; }
  }
  return chests;
}

// Which Simon plate is the hero standing on? -1 for none.
function padUnder(h) {
  for (let i = 0; i < SIMON_PADS.length; i++) {
    if (Math.hypot(h.x - SIMON_PADS[i].x, h.y - SIMON_PADS[i].y) < 44) return i;
  }
  return -1;
}

// E does minigame-specific work before anything else gets a turn.
function minigamePress() {
  const mg = run.minigame;
  const h = run.hero;
  if (mg.id === 'blitz') return blitzPress();
  if (mg.id === 'mimics') {
    let best = null, bd = 52;
    for (const c of mg.chests) {
      if (c.open) continue;
      const d = Math.hypot(h.x - c.x, h.y - c.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return false;
    best.open = true;
    if (best.mimic) {
      spawnEnemy('mimic');
      const m = run.enemies[run.enemies.length - 1];
      m.x = best.x; m.y = best.y; m.spawnT = 0.7;
      addText(best.x, best.y - 26, 'MIMIC!', '#e85454');
      SFX.curse();
    } else {
      mg.score++;
      dropCoins(best.x, best.y, 6, 2);
      SFX.chest();
    }
    return true;
  }
  if (mg.id === 'flame') {
    for (const b of mg.braziers) {
      if (!b.lit && Math.hypot(h.x - b.x, h.y - b.y) < 48) {
        b.lit = true;
        mg.score++;
        addText(b.x, b.y - 30, 'Relit!', '#ffb35e');
        SFX.blessing();
        return true;
      }
    }
  }
  return false;
}

// A fresh lights-out board, scrambled from solved (always winnable).
function genLightsBoard() {
  const grid = 3;
  const cells = new Array(9).fill(true);
  const press = i => {
    const cx = i % grid, cy = Math.floor(i / grid);
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      const nx2 = cx + dx, ny2 = cy + dy;
      if (nx2 >= 0 && nx2 < grid && ny2 >= 0 && ny2 < grid) {
        cells[ny2 * grid + nx2] = !cells[ny2 * grid + nx2];
      }
    });
  };
  for (let k = 0; k < 4 + Math.floor(Math.random() * 3); k++) press(Math.floor(Math.random() * 9));
  if (cells.every(v => v)) press(4);
  const nodes = [];
  for (let i = 0; i < 9; i++) {
    nodes.push({ x: W / 2 + ((i % 3) - 1) * 120, y: H / 2 + (Math.floor(i / 3) - 1) * 100 });
  }
  return { kind: 'lightsout', grid, cells, nodes, solved: false };
}

// Lantern Blitz press: solve a board, get a fresh one, score climbs.
function blitzPress() {
  const mg = run.minigame;
  const pz = mg.pz;
  const h = run.hero;
  for (let i = 0; i < pz.nodes.length; i++) {
    if (Math.hypot(h.x - pz.nodes[i].x, h.y - pz.nodes[i].y) < 48) {
      const cx = i % 3, cy = Math.floor(i / 3);
      [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx2 = cx + dx, ny2 = cy + dy;
        if (nx2 >= 0 && nx2 < 3 && ny2 >= 0 && ny2 < 3) {
          pz.cells[ny2 * 3 + nx2] = !pz.cells[ny2 * 3 + nx2];
        }
      });
      SFX.clank();
      if (pz.cells.every(v => v)) {
        mg.score++;
        addText(W / 2, H / 2 - 40, 'SOLVED! Next board.', '#7dff8a');
        SFX.win();
        mg.pz = genLightsBoard();
      }
      return true;
    }
  }
  return false;
}

function endMinigame() {
  const mg = run.minigame;
  if (mg.id === 'horde') mg.score = run.kills;
  if (mg.id === 'coins') mg.score = run.gold;
  save.minigames[mg.id] = Math.max(save.minigames[mg.id] || 0, mg.score);
  saveGame();
  state = 'mgover';
  SFX.win();
}

// Every run begins above ground, at the family plot, beside the
// elevator that leads down into the crypt.
function makeSurface() {
  run.floor = -1;
  run.power = POWER_MAX;
  run.blackout = false;
  run.shade = null;
  const surface = makeRoom(0, 0, 0);
  surface.type = 'surface';
  surface.cleared = true;
  surface.visited = true;
  surface.seen = true;
  const rooms = new Map();
  rooms.set(roomKey(0, 0), surface);
  run.dungeon = { rooms, start: surface };
  enterRoom(surface, null);
}

function makeFloor(floorIdx) {
  run.floor = floorIdx;
  if (floorIdx > save.floorUnlocked) {
    save.floorUnlocked = floorIdx;
    saveGame();
  }
  // A fresh floor means fresh lantern power — descending outruns the Shade.
  run.power = POWER_MAX;
  run.blackout = false;
  run.shade = null;
  // the pack keeps up: a fallen wolf rejoins on the next floor
  if (run.hero.packleader && !run.minions.some(m => m.type === 'wolf')) {
    spawnMinionOf(run.hero.x + 34, run.hero.y, 'wolf');
  }
  if (floorIdx >= FLOORS.length - 1) {
    run.dungeon = generateBossLair();
  } else {
    const roomCount = Math.min(10 + floorIdx * 3 + save.wins, 24);
    run.dungeon = generateDungeon(roomCount);
    // any ghost heirs wandering this floor can be found and recruited
    const ghosts = (save.fallen || []).filter(f => (f.floor || 0) === floorIdx);
    const spots = shuffle([...run.dungeon.rooms.values()].filter(r => r.type === 'normal'));
    for (let i = 0; i < Math.min(2, ghosts.length, spots.length); i++) {
      spots[i].ghostHeir = ghosts[i];
      spots[i].ghostSpot = findAnchor(spots[i]) || { x: W / 2 + 150, y: H / 2 - 110 };
    }
  }
  enterRoom(run.dungeon.start, null);
}

function roomAt(key) { return run.dungeon.rooms.get(key); }

function enterRoom(room, fromDir) {
  const firstVisit = !room.visited;
  run.room = room;
  room.visited = true;
  room.seen = true;

  // running through rooms shakes the Shade off your trail
  if (run.shade) {
    run.shadeRooms = (run.shadeRooms || 0) + 1;
    if (run.shadeRooms >= 3) {
      run.shade = null;
      run.shadeRooms = 0;
      run.shadeRespawn = 20; // it will catch the scent again
      addText(run.hero.x, run.hero.y - 40, 'You lost it... for now.', '#c9b8ff');
      SFX.door();
    }
  }
  for (const d in room.doors) {
    const n = roomAt(room.doors[d]);
    // undiscovered secret rooms stay off the map
    if (n && !(n.type === 'secret' && !n.discovered)) n.seen = true;
  }

  run.projectiles = [];
  run.particles = [];
  run.rings = [];
  run.texts = [];
  run.enemies = [];
  run.zones = [];
  run.fade = 0.25;

  const h = run.hero;
  const pad = h.radius + 10;
  if (fromDir === 'N') { h.x = W / 2; h.y = IY0 + pad; }
  else if (fromDir === 'S') { h.x = W / 2; h.y = IY1 - pad; }
  else if (fromDir === 'E') { h.x = IX1 - pad; h.y = H / 2; }
  else if (fromDir === 'W') { h.x = IX0 + pad; h.y = H / 2; }
  else { h.x = W / 2; h.y = H / 2; }

  // never spawn wedged into furniture — walk the spawn point toward
  // the middle of the room until it's clear
  for (let tries = 0; tries < 80 && heroStuck(room, h); tries++) {
    h.x += (W / 2 - h.x) * 0.06 + (Math.random() - 0.5) * 2;
    h.y += (H / 2 - h.y) * 0.06 + (Math.random() - 0.5) * 2;
  }

  // the vault takes its toll in blood, once
  if (room.type === 'vault' && !room.tollPaid) {
    room.tollPaid = true;
    h.hp = Math.max(1, h.hp - 10);
    h.regenDelay = REGEN_DELAY;
    addText(h.x, h.y - 34, 'The vault takes its toll. -10', '#ff6666');
    run.shake = 6;
    SFX.curse();
  }

  if (room.savedEnemies && room.savedEnemies.length > 0) {
    // the monsters you ran from, right where you left them
    run.enemies = room.savedEnemies;
    room.savedEnemies = null;
  } else if (!room.spawned) {
    room.spawned = true;
    if (room.type === 'normal' && room.interior !== 'plain' || room.type === 'normal') {
      // ordinary rooms get a trial spawner instead of an instant pack
      const plan = enemyPlanFor(room, run.floor, save.wins);
      if (plan.length > 0) {
        room.spawner = {
          x: W / 2 + (Math.random() - 0.5) * 120,
          y: H / 2 + (Math.random() - 0.5) * 80,
          remaining: plan.map(p => p.type),
          cd: 0.8, active: true,
        };
      }
    } else {
      const plan = enemyPlanFor(room, run.floor, save.wins);
      for (const p of plan) spawnEnemy(p.type);
      if (run.enemies.length > 0) SFX.door();
    }
    // every keymaster is somebody different
    if (room.type === 'guardian') {
      const g = run.enemies.find(e2 => e2.type === 'guardian');
      if (g) applyGuardianVariant(g);
    }
    // Cursed Greg keeps the family close (only those who reached him)
    if (room.type === 'boss') {
      run.fallenQueue = shuffle((save.fallen || []).filter(f => (f.floor || 0) >= FLOORS.length - 1));
    }
  }

  // minions and the party shuffle along behind (turrets stay planted
  // and are left behind)
  run.minions = run.minions.filter(m => m.type !== 'turret');
  for (const m of run.minions.concat(run.party)) {
    m.x = h.x + (Math.random() - 0.5) * 60;
    m.y = h.y + (Math.random() - 0.5) * 60;
  }

  // exploration feeds the lantern: new ground, new light.
  // (not during a blackout — the Shade snuffs anything you kindle)
  if (firstVisit && run.floor >= 0 && !run.blackout && room.type !== 'surface') {
    addPower(6, run.hero.x, run.hero.y - 26);
  }

  // The Shade follows you from room to room, appearing in the far corner.
  if (run.shade) {
    const corners = [[IX0 + 40, IY0 + 40], [IX1 - 40, IY0 + 40], [IX0 + 40, IY1 - 40], [IX1 - 40, IY1 - 40]];
    let best = corners[0], bestD = -1;
    for (const [cx, cy] of corners) {
      const d = Math.hypot(cx - h.x, cy - h.y);
      if (d > bestD) { bestD = d; best = [cx, cy]; }
    }
    run.shade.x = best[0];
    run.shade.y = best[1];
  }
}

function spawnEnemy(type) {
  const def = ENEMIES[type];
  const lvl = crypLevel();
  const h = run.hero;
  let x, y, tries = 0;
  do {
    x = IX0 + 60 + Math.random() * (IX1 - IX0 - 120);
    y = IY0 + 60 + Math.random() * (IY1 - IY0 - 120);
    tries++;
  } while ((Math.hypot(x - h.x, y - h.y) < 180 ||
            (run.room.type === 'start' && Math.hypot(x - W / 2, y - H / 2) < 140))
           && tries < 40);

  run.enemies.push({
    type, x, y,
    hp: def.hp * (1 + lvl * 0.35), maxHp: def.hp * (1 + lvl * 0.35),
    r: def.r, speed: def.speed,
    dmg: Math.round(def.dmg * (1 + lvl * 0.2)),
    color: def.color,
    t: Math.random() * 10,
    spawnT: 0.35,            // scale-in animation; harmless while spawning
    wanderAngle: Math.random() * Math.PI * 2,
    shootTimer: 1.2 + Math.random(),
    kx: 0, ky: 0,
    flash: 0,
    ai: { mode: 'idle', t: 1.2, vx: 0, vy: 0 },
  });
}

// You can run past ordinary monsters — doors only bar shut for the
// boss, the arena, and sprung ambushes.
function doorsLocked() {
  if (run.enemies.length === 0) return false;
  return run.room.type === 'boss' || run.room.type === 'arena' ||
    run.room.type === 'guardian' || !!run.room.ambush ||
    (run.room.type === 'gauntlet' && run.room.gauntlet.state === 'live');
}

// ---------------------------------------------------------
// The party: rescued ghost heirs who fight beside you.
// Enemies go for them (and your skeletons) before they go for you.
// ---------------------------------------------------------
function makePartyMember(spec) {
  const c = CLASSES[spec.classId] || CLASSES.knight;
  return {
    name: spec.name, classId: spec.classId,
    x: run.hero.x + 30, y: run.hero.y + 30,
    r: 13, hp: 80, maxHp: 80, dmg: 14, speed: 210,
    color: c.color, hitCd: 0, invuln: 0, t: Math.random() * 6, dead: false,
  };
}

function recruitGhost() {
  const room = run.room;
  const spec = room.ghostHeir;
  run.party.push(makePartyMember(spec));
  save.fallen = (save.fallen || []).filter(f => f !== spec);
  saveGame();
  room.ghostHeir = null;
  addText(run.hero.x, run.hero.y - 34, spec.name + ' joins you!', '#7dff8a');
  run.rings.push({ x: run.hero.x, y: run.hero.y, r: 16, vr: 220, life: 0.4, maxLife: 0.4, color: '#7dff8a' });
  SFX.blessing();
}

function updateParty(dt) {
  const h = run.hero;
  run.party = run.party.filter(p => !p.dead);
  for (const m of run.party) {
    m.t += dt;
    if (m.hitCd > 0) m.hitCd -= dt;
    if (m.invuln > 0) m.invuln -= dt;
    else if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + 1.5 * dt);

    let target = null, bestD = Infinity;
    for (const e of run.enemies) {
      if (e.spawnT > 0) continue;
      const d = Math.hypot(e.x - m.x, e.y - m.y);
      if (d < bestD) { bestD = d; target = e; }
    }
    if (target && bestD < 420) {
      const nx = (target.x - m.x) / (bestD || 1), ny = (target.y - m.y) / (bestD || 1);
      if (bestD > target.r + m.r - 4) {
        m.x += nx * m.speed * dt;
        m.y += ny * m.speed * dt;
      }
      if (bestD < target.r + m.r + 6 && m.hitCd <= 0) {
        m.hitCd = 0.7;
        target.kx += nx * 100;
        target.ky += ny * 100;
        damageEnemy(target, m.dmg, false);
      }
    } else {
      const dh = Math.hypot(h.x - m.x, h.y - m.y);
      if (dh > 80) {
        m.x += (h.x - m.x) / dh * 220 * dt;
        m.y += (h.y - m.y) / dh * 220 * dt;
      }
    }
    m.x = Math.min(Math.max(m.x, IX0 + m.r), IX1 - m.r);
    m.y = Math.min(Math.max(m.y, IY0 + m.r), IY1 - m.r);
    pushOutOfPillars(m, m.r);
    collideFurniture(m, m.r);
  }
}

// A hurt ally close enough to share a potion with.
function nearestHurtAlly() {
  const h = run.hero;
  if (itemCount('potion') === 0) return null;
  let best = null, bestD = 55;
  for (const a of run.party.concat(run.minions)) {
    if (a.dead || a.hp >= a.maxHp) continue;
    const d = Math.hypot(a.x - h.x, a.y - h.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

function feedAlly(a) {
  if (!takeItemOne('potion')) return;
  const heal = Math.round(a.maxHp / 2);
  a.hp = Math.min(a.maxHp, a.hp + heal);
  addText(a.x, a.y - 24, '+' + heal, '#7dff8a');
  burstParticles(a.x, a.y, '#7dff8a', 10);
  SFX.potion();
}

// Damage routed to a teammate or skeleton instead of the hero.
function damageAlly(a, dmg) {
  if (a.invuln > 0 || a.dead) return;
  a.invuln = 0.6;
  a.hp = (a.hp === undefined ? 25 : a.hp) - dmg;
  addText(a.x, a.y - 18, '-' + dmg, '#ff9a9a');
  SFX.hit();
  if (a.hp <= 0) {
    a.dead = true;
    burstParticles(a.x, a.y, a.color || '#c9b8ff', 14);
    if (a.name) addText(a.x, a.y - 32, a.name + ' passes on...', '#c9b8ff');
  }
}

// Who does this monster want? Teammates and skeletons draw its
// eye first; you come last.
function pickTarget(e) {
  const h = run.hero;
  let best = null, bestD = Infinity;
  for (const a of run.party) {
    const d = Math.hypot(a.x - e.x, a.y - e.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  for (const a of run.minions) {
    if (a.dead) continue;
    const d = Math.hypot(a.x - e.x, a.y - e.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  if (best && bestD < Math.hypot(h.x - e.x, h.y - e.y) + 160) return best;
  return h;
}

// A dead heir, back in the Founder's colors. Small, sad, and bitey.
function spawnAncestor(spec, x, y) {
  spawnEnemy('ancestor');
  const a = run.enemies[run.enemies.length - 1];
  a.x = Math.min(Math.max(x + (Math.random() - 0.5) * 160, IX0 + 40), IX1 - 40);
  a.y = Math.min(Math.max(y + (Math.random() - 0.5) * 160, IY0 + 40), IY1 - 40);
  a.spawnT = 0.4;
  a.classId = spec.classId;
  a.name = spec.name;
  a.color = CLASSES[spec.classId] ? CLASSES[spec.classId].color : '#c9b8ff';
  addText(a.x, a.y - 30, spec.name + ' rises to serve!', '#c9b8ff');
  SFX.curse();
}

// Dress a freshly spawned keymaster as one of the pool.
function applyGuardianVariant(e) {
  const ids = Object.keys(GUARDIANS);
  const v = GUARDIANS[ids[Math.floor(Math.random() * ids.length)]];
  const lvl = crypLevel();
  e.variant = v.style;
  e.name = v.name;
  e.color = v.color;
  e.hp = e.maxHp = v.hp * (1 + lvl * 0.35);
  e.speed = v.speed;
  e.dmg = Math.round(v.dmg * (1 + lvl * 0.2));
  e.shootTimer = 1.2;
  e.telegraphT = 0;
}

// Pressing into a cracked wall reveals the hidden room behind it.
function tryRevealSecret(dir, inGap) {
  if (!inGap || doorsLocked()) return;
  const key = run.room.doors[dir];
  if (!key) return;
  const tgt = roomAt(key);
  if (tgt.type === 'secret' && !tgt.discovered) {
    tgt.discovered = true;
    tgt.seen = true;
    run.shake = 6;
    addText(run.hero.x, run.hero.y - 30, 'A hidden passage!', '#c9a5ff');
    SFX.unlock();
  }
}

function tryTransition(dir) {
  const targetKey = run.room.doors[dir];
  if (!targetKey) return;
  // whatever you didn't kill waits for you
  if (run.enemies.length > 0) run.room.savedEnemies = run.enemies;
  else run.room.savedEnemies = null;
  SFX.door();
  enterRoom(roomAt(targetKey), DIRS.find(d => d.d === dir).opp);
}

// ---------------------------------------------------------
// The central elevator
// ---------------------------------------------------------
function descendTo(floorIdx) {
  descend = { t: 0, dur: 1.8, toFloor: floorIdx };
  state = 'descend';
  menu = null;
  SFX.elevator();
}

// Boarding: free from the surface (pick any unlocked floor);
// deeper descents cost an Elevator Gear found in chests.
function tryBoardElevator() {
  if (run.floor < 0) {
    if (save.floorUnlocked > 0) {
      menu = 'floors';
      menuIndex = 0;
      SFX.select();
    } else {
      descendTo(0);
    }
    return;
  }
  if (run.floor >= FLOORS.length - 1) return; // nowhere deeper to go
  if (run.materials.gear >= 1) {
    run.materials.gear -= 1;
    descendTo(run.floor + 1);
  } else {
    addText(run.hero.x, run.hero.y - 30, 'The keymaster has the Gear', '#ff6666');
    SFX.denied();
  }
}

// Ride the elevator home instead: the heir survives, the gold is banked.
function retire() {
  save.gold += run.gold;
  save.generation += 1;
  save.lastFate = 'retired';
  bumpStat('retires');
  saveGame();
  SFX.elevator();
  state = 'retired';
}

function updateDescend(dt) {
  descend.t += dt;
  if (descend.t >= descend.dur) {
    SFX.clank();
    makeFloor(descend.toFloor);
    descend = null;
    state = 'play';
  }
}

// ---------------------------------------------------------
// Chests & blessings
// ---------------------------------------------------------
function maybeSpawnChest(room) {
  // Beating the keymaster earns a silver chest beside the gear he drops.
  if (room.type === 'guardian') {
    const c = makeChest(W / 2, H / 2 - 130, 'silver');
    c.spawnT = 0.3;
    room.chests.push(c);
    return;
  }
  const roll = Math.random();
  let tier = null;
  if (roll < 0.03) tier = 'gold';
  else if (roll < 0.14) tier = 'silver';
  else if (roll < 0.42) tier = 'wood';
  if (!tier) return;
  const spot = findAnchor(room);
  if (!spot) return;
  const c = makeChest(spot.x, spot.y, tier);
  c.spawnT = 0.3;
  room.chests.push(c);
}

// Which lootable chest is close enough to open with E?
// (an opened chest with things still inside can be reopened)
function nearestChest() {
  const h = run.hero;
  let best = null, bestD = 58;
  for (const c of run.room.chests) {
    if (c.spawnT > 0) continue;
    if (c.opened && (!c.contents || c.contents.length === 0)) continue;
    const d = Math.hypot(c.x - h.x, c.y - h.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// E opens the chest like a Minecraft container: the lid creaks up
// and a screen shows what's inside for you to take.
function openChest(chest) {
  // some chests are teeth all the way down
  if (chest.mimic) {
    run.room.chests = run.room.chests.filter(c => c !== chest);
    spawnEnemy('mimic');
    const m = run.enemies[run.enemies.length - 1];
    m.x = chest.x; m.y = chest.y;
    m.spawnT = 0.2;
    addText(chest.x, chest.y - 34, 'MIMIC!', '#ff6666');
    MUSIC.excite(0.7);
    run.shake = 8;
    SFX.curse();
    return;
  }
  if (!chest.opened) {
    chest.opened = true;
    chest.openT = 0.001;
    bumpStat('chests');
    SFX.chest();
  }
  if (!chest.contents) chest.contents = buildChestContents(chest);
  activeChest = chest;
  menu = 'chest';
  menuIndex = 0;
}

// Roll the tier's loot table into a list of container entries.
function buildChestContents(chest) {
  const def = CHEST_TIERS[chest.tier];
  const lvl = crypLevel();
  const entries = [];
  entries.push({
    kind: 'gold',
    val: Math.round((def.gold[0] + Math.random() * (def.gold[1] - def.gold[0])) * (1 + lvl * 0.2)),
  });
  if (chest.bonusGear) entries.push({ kind: 'mat', id: 'gear' });
  for (const drop of rollLootDrops('chest_' + chest.tier)) {
    const e = dropToEntry(drop);
    if (e) entries.push(e);
    // armor never travels alone: at least half the set
    if (e && e.kind === 'equip' && EQUIPMENT[e.id].slot === 'armor') {
      entries.push({ kind: 'equip', id: matchingShield(e.id) });
    }
  }
  return entries;
}

// Bone armor pairs with a bone shield, iron with iron.
function matchingShield(armorId) {
  return armorId === 'ironarmor' ? 'ironshield' : 'boneshield';
}

function dropToEntry(drop) {
  if (drop.startsWith('mat:')) return { kind: 'mat', id: drop.slice(4) };
  if (drop === 'gem') return { kind: 'gem', val: 40 + Math.round(Math.random() * 25 * (1 + crypLevel() * 0.2)) };
  if (drop === 'heart') return { kind: 'heart', heal: 30 };
  if (drop === 'goldheart') return { kind: 'heart', heal: 60 };
  if (drop === 'cell') return { kind: 'cell' };
  if (drop === 'blessing') return { kind: 'blessing' };
  if (drop === 'item') {
    return { kind: 'item', id: CHEST_COMMON_ITEMS[Math.floor(Math.random() * CHEST_COMMON_ITEMS.length)] };
  }
  if (drop === 'rareitem') {
    const pool = Math.random() < 0.5 ? CHEST_RARE_ITEMS : CHEST_COMMON_ITEMS;
    return { kind: 'item', id: pool[Math.floor(Math.random() * pool.length)] };
  }
  if (drop === 'equip') {
    const ids = Object.keys(EQUIPMENT);
    return { kind: 'equip', id: ids[Math.floor(Math.random() * ids.length)] };
  }
  return null;
}

// Take one entry out of the chest. Returns 'remove' (taken),
// 'swapped' (equipment traded places with what you wore), or
// 'skip' (couldn't take it).
function takeChestEntry(entry, auto) {
  const h = run.hero;
  if (entry.kind === 'gold') {
    run.gold += Math.round(entry.val * h.goldMult);
    SFX.coin();
    return 'remove';
  }
  if (entry.kind === 'gem') {
    run.gold += Math.round(entry.val * h.goldMult);
    SFX.gem();
    return 'remove';
  }
  if (entry.kind === 'heart') {
    if (h.hp >= h.maxHp) {
      if (!auto) addText(h.x, h.y - 24, 'Already healthy', '#8888aa');
      return 'skip';
    }
    h.hp = Math.min(h.maxHp, h.hp + entry.heal);
    addText(h.x, h.y - 24, '+' + entry.heal, '#7dff8a');
    SFX.heart();
    return 'remove';
  }
  if (entry.kind === 'cell') {
    addPower(30, h.x, h.y - 24);
    SFX.gem();
    return 'remove';
  }
  if (entry.kind === 'mat') {
    run.materials[entry.id]++;
    addText(h.x, h.y - 24, '+1 ' + MATERIALS[entry.id].name, MATERIALS[entry.id].color);
    SFX.select();
    return 'remove';
  }
  if (entry.kind === 'blessing') {
    grantBlessing(h.x, h.y);
    return 'remove';
  }
  if (entry.kind === 'item') {
    if (!gainItem(entry.id, h.x, h.y - 24)) {
      if (!auto) addText(h.x, h.y - 24, 'Hands full', '#ff6666');
      return 'skip';
    }
    return 'remove';
  }
  if (entry.kind === 'equip') {
    const def = EQUIPMENT[entry.id];
    const old = h[def.slot];
    if (old && auto) return 'skip'; // take-all won't force a swap
    h[def.slot] = def;
    addText(h.x, h.y - 30, def.name + ' equipped!', def.color);
    SFX.unlock();
    if (old) {
      const oldId = Object.keys(EQUIPMENT).find(k => EQUIPMENT[k] === old);
      if (oldId) { entry.id = oldId; return 'swapped'; } // the old piece stays in the chest
    }
    return 'remove';
  }
  return 'skip';
}

// ---------------------------------------------------------
// Loot tables (defined in config.js) — roll one into a list
// of drop keywords.
// ---------------------------------------------------------
function rollLootDrops(name) {
  const table = LOOT_TABLES[name];
  if (!table) return [];
  const drops = [];
  if (table.always) drops.push(...table.always);
  if (table.pickOne) {
    const total = table.pickOne.reduce((s, e) => s + e.w, 0);
    let r = Math.random() * total;
    for (const e of table.pickOne) {
      r -= e.w;
      if (r <= 0) { drops.push(e.drop); break; }
    }
  }
  if (table.rolls) {
    for (const e of table.rolls) if (Math.random() < e.chance) drops.push(e.drop);
  }
  return drops;
}

function spawnDrop(drop, x, y) {
  const loot = run.room.loot;
  if (drop.startsWith('mat:')) return dropMaterial(x, y, drop.slice(4));
  if (drop === 'gem') return dropGem(x, y);
  if (drop === 'heart') return void loot.hearts.push({ x, y, heal: 30 });
  if (drop === 'goldheart') return void loot.hearts.push({ x, y, heal: 60 });
  if (drop === 'cell') return void loot.cells.push({ x, y, t: Math.random() * 6 });
  if (drop === 'blessing') return grantBlessing(x, y);
  if (drop === 'item') {
    return dropItem(x, y, CHEST_COMMON_ITEMS[Math.floor(Math.random() * CHEST_COMMON_ITEMS.length)]);
  }
  if (drop === 'rareitem') {
    const pool = Math.random() < 0.5 ? CHEST_RARE_ITEMS : CHEST_COMMON_ITEMS;
    return dropItem(x, y, pool[Math.floor(Math.random() * pool.length)]);
  }
  if (drop === 'equip') {
    const ids = Object.keys(EQUIPMENT);
    const id = ids[Math.floor(Math.random() * ids.length)];
    dropEquip(x, y, id);
    if (EQUIPMENT[id].slot === 'armor') dropEquip(x + 34, y, matchingShield(id));
    return;
  }
}

// Items sit on the floor until picked up (walk over with a free slot).
function dropItem(x, y, id) {
  run.room.loot.items.push({ x, y, id, t: Math.random() * 6 });
}

function dropMaterial(x, y, id) {
  run.room.loot.mats.push({
    x: x + (Math.random() - 0.5) * 30,
    y: y + (Math.random() - 0.5) * 30,
    id, t: Math.random() * 6,
  });
}

// ---------------------------------------------------------
// Equipment — one weapon, one offhand. Swapping drops the old
// piece on the floor for a descendant with regrets.
// ---------------------------------------------------------
function dropEquip(x, y, id) {
  run.room.loot.equip.push({ x, y, def: EQUIPMENT[id], t: Math.random() * 6 });
}

function equipItem(def) {
  const h = run.hero;
  const old = h[def.slot];
  h[def.slot] = def;
  addText(h.x, h.y - 30, def.name + ' equipped!', def.color);
  burstParticles(h.x, h.y, def.color, 12);
  SFX.unlock();
  if (old) run.room.loot.equip.push({ x: h.x, y: h.y + 26, def: old, t: 0 });
}

function nearestEquip() {
  const h = run.hero;
  let best = null, bestD = 55;
  for (const q of run.room.loot.equip) {
    const d = Math.hypot(q.x - h.x, q.y - h.y);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

// Restore lantern power; enough of it drives the Shade away.
function addPower(amount, x, y) {
  run.power = Math.min(POWER_MAX, run.power + amount);
  if (run.blackout && run.power > 10) {
    run.blackout = false;
    run.shade = null;
    addText(x, y, 'The Shade recoils!', '#c9b8ff');
  } else {
    addText(x, y, '+' + amount + ' power', '#ffd75e');
  }
}

// Gems: a single big-value pickup, from gold chests and the boss.
function dropGem(x, y) {
  const a = Math.random() * Math.PI * 2;
  run.room.loot.coins.push({
    x, y, gem: true,
    vx: Math.cos(a) * 80, vy: Math.sin(a) * 80,
    val: 40 + Math.round(Math.random() * 25 * (1 + crypLevel() * 0.2)),
    t: Math.random() * 6,
  });
}

function grantBlessing(x, y) {
  const available = Object.keys(BLESSINGS).filter(id => !run.blessings.includes(id));
  if (available.length === 0) {
    dropCoins(x, y, 60, 6); // all blessings owned: gold instead
    return;
  }
  const id = available[Math.floor(Math.random() * available.length)];
  run.blessings.push(id);
  bumpStat('blessings');
  BLESSINGS[id].apply(run.hero);
  addText(x, y - 60, BLESSINGS[id].name + '!', '#ffd75e');
  addText(x, y - 40, BLESSINGS[id].desc, '#c9c9e0');
  run.rings.push({ x, y, r: 20, vr: 220, life: 0.5, maxLife: 0.5, color: '#ffd75e' });
  SFX.blessing();
}

// Current attack damage / move speed, including gear, buffs, passives.
function heroDmg() {
  const h = run.hero;
  let m = h.strengthT > 0 ? 1.5 : 1;
  if (h.rage) m *= 1 + 0.6 * (1 - h.hp / h.maxHp);        // barbarian: angrier when hurt
  if (h.combo && h.comboN > 0) m *= 1 + 0.1 * h.comboN;   // shinobi: momentum
  return (h.dmg + (h.weapon ? h.weapon.dmg : 0)) * m;
}

// Crit roll for melee hits — the rogue always crits untouched foes.
function rollCrit(e) {
  const h = run.hero;
  if (h.firstStrike && e.hp >= e.maxHp) return true;
  return Math.random() < h.crit;
}
function heroSpeed() {
  const h = run.hero;
  return h.speed * (h.swiftT > 0 ? 1.3 : 1) * (h.chillT > 0 ? 0.7 : 1);
}

// ---------------------------------------------------------
// Consumable items (Q to use the oldest one)
// ---------------------------------------------------------
// Items live in stacks: { id, n }, up to ITEMS[id].stack per slot.
function canGain(id) {
  const h = run.hero;
  const max = ITEMS[id].stack || 1;
  return h.items.some(st => st.id === id && st.n < max) || h.items.length < ITEM_CAP;
}

function itemCount(id) {
  return run.hero.items.reduce((a, st) => a + (st.id === id ? st.n : 0), 0);
}

function gainItem(id, x, y) {
  const h = run.hero;
  const max = ITEMS[id].stack || 1;
  const st = h.items.find(s2 => s2.id === id && s2.n < max);
  if (st) st.n++;
  else if (h.items.length < ITEM_CAP) h.items.push({ id, n: 1 });
  else return false;
  addText(x, y, ITEMS[id].name, '#7de8ff');
  SFX.chest();
  return true;
}

// Consume one of an item from anywhere in the inventory.
function takeItemOne(id) {
  const h = run.hero;
  const i = h.items.findIndex(st => st.id === id);
  if (i === -1) return false;
  if (--h.items[i].n <= 0) {
    h.items.splice(i, 1);
    h.itemSel = Math.max(0, Math.min(h.itemSel, h.items.length - 1));
  }
  return true;
}

function cycleItem(dir) {
  const h = run.hero;
  if (h.items.length < 2) return;
  h.itemSel = (h.itemSel + dir + h.items.length) % h.items.length;
  SFX.select();
}

function useItem() {
  const h = run.hero;
  if (h.items.length === 0) { SFX.denied(); return; }
  h.itemSel = Math.min(h.itemSel, h.items.length - 1);
  const stack = h.items[h.itemSel];
  const id = stack.id;

  if (id === 'totem') { // the totem refuses to be used; it acts on its own
    addText(h.x, h.y - 24, 'The totem waits...', '#ffd75e');
    SFX.denied();
    return;
  }
  if (id === 'potion' && h.hp >= h.maxHp) { SFX.denied(); return; }

  if (--stack.n <= 0) {
    h.items.splice(h.itemSel, 1);
    h.itemSel = Math.max(0, Math.min(h.itemSel, h.items.length - 1));
  }
  const pot = h.chemist ? 1.5 : 1; // alchemist potions hit harder
  if (id === 'potion') {
    const heal = Math.round(h.maxHp / 2 * pot);
    h.hp = Math.min(h.maxHp, h.hp + heal);
    addText(h.x, h.y - 24, '+' + heal, '#7dff8a');
    burstParticles(h.x, h.y, '#7dff8a', 12);
    SFX.potion();
  } else if (id === 'apple') {
    h.maxHp += Math.round(10 * pot);
    h.hp = Math.min(h.maxHp, h.hp + Math.round(30 * pot));
    addText(h.x, h.y - 24, 'Golden!', '#ffd75e');
    burstParticles(h.x, h.y, '#ffd75e', 12);
    SFX.potion();
  } else if (id === 'bomb') {
    run.shake = 14;
    run.hitStop = 0.08;
    run.rings.push({ x: h.x, y: h.y, r: 30, vr: 600, life: 0.45, maxLife: 0.45, color: '#ff9a3a' });
    burstParticles(h.x, h.y, '#ff9a3a', 30);
    for (const e of [...run.enemies]) {
      const d = Math.hypot(e.x - h.x, e.y - h.y) || 1;
      e.kx += (e.x - h.x) / d * 350;
      e.ky += (e.y - h.y) / d * 350;
      damageEnemy(e, 45, false);
    }
    SFX.blackout();
  } else if (id === 'swift') {
    h.swiftT = 10 * pot;
    addText(h.x, h.y - 24, 'Swiftness!', '#7de8ff');
    SFX.potion();
  } else if (id === 'strength') {
    h.strengthT = 10 * pot;
    addText(h.x, h.y - 24, 'Strength!', '#ff9a3a');
    SFX.potion();
  }
}

// ---------------------------------------------------------
// The shop — a hooded merchant deep in the crypt
// ---------------------------------------------------------
function shopPrice(id) {
  return Math.round(SHOP_ITEMS[id].base * (1 + crypLevel() * 0.2));
}

function nearestShopItem() {
  const h = run.hero;
  if (!run.room.shopItems) return null;
  let best = null, bestD = 60;
  for (const item of run.room.shopItems) {
    if (item.sold) continue;
    const d = Math.hypot(item.x - h.x, item.y - h.y);
    if (d < bestD) { bestD = d; best = item; }
  }
  return best;
}

function tryBuy() {
  const item = nearestShopItem();
  if (!item) return;
  const h = run.hero;
  const price = shopPrice(item.id);
  const carried = ['potion', 'bomb', 'totem'].includes(item.id);
  if (run.gold < price) { SFX.denied(); addText(item.x, item.y - 40, 'Not enough gold', '#ff6666'); return; }
  if (carried && !canGain(item.id)) {
    SFX.denied(); addText(item.x, item.y - 40, 'Hands full', '#ff6666'); return;
  }

  run.gold -= price;
  item.sold = true;
  SFX.buy();
  if (item.id === 'bandages') {
    h.hp = Math.min(h.maxHp, h.hp + 40);
    addText(h.x, h.y - 24, '+40', '#7dff8a');
  } else if (carried) {
    gainItem(item.id, item.x, item.y - 40);
  } else if (item.id === 'battery') {
    addPower(45, item.x, item.y - 40);
  } else if (item.id === 'blessing') {
    grantBlessing(item.x, item.y - 30);
  } else if (item.id === 'elixir') {
    h.maxHp += 20;
    h.hp += 20;
    addText(item.x, item.y - 40, '+20 max HP', '#7dff8a');
  }
}


// ---------------------------------------------------------
// Stations live inside the crypt now: the brewery has the brewing
// stand, the forge has the crafting table.
// ---------------------------------------------------------
function nearFurniture(kind) {
  return nearestFurnitureOf(kind) !== null;
}

function nearestFurnitureOf(kind) {
  const h = run.hero;
  let best = null, bestD = 85;
  for (const f of run.room.furniture) {
    if (f.kind !== kind) continue;
    const d = Math.hypot(h.x - f.x, h.y - f.y);
    if (d < bestD) { bestD = d; best = { f, d }; }
  }
  return best;
}

// One-use interactables: the kitchen's stew pot and the bar's keg.
function nearUsable(kind) {
  const h = run.hero;
  return run.room.furniture.find(f => f.kind === kind && !f.used &&
    Math.hypot(h.x - f.x, h.y - f.y) < 65) || null;
}

function eatStew(f) {
  const h = run.hero;
  f.used = true;
  h.hp = Math.min(h.maxHp, h.hp + 50);
  addText(h.x, h.y - 24, "Grandma Greg's stew! +50", '#7dff8a');
  burstParticles(f.x, f.y - 10, '#c9a05a', 10);
  SFX.potion();
}

function tapKeg(f) {
  const h = run.hero;
  f.used = true;
  const roll = Math.random();
  if (roll < 0.35) {
    h.swiftT = 10;
    addText(h.x, h.y - 24, 'Something fizzy! Swiftness!', '#7de8ff');
  } else if (roll < 0.7) {
    h.strengthT = 10;
    addText(h.x, h.y - 24, 'Something strong! Strength!', '#ff9a3a');
  } else if (roll < 0.9) {
    h.hp = Math.min(h.maxHp, h.hp + 25);
    addText(h.x, h.y - 24, 'Ancient ale. +25', '#7dff8a');
  } else {
    addText(h.x, h.y - 24, 'Watered down. Typical.', '#8888aa');
  }
  SFX.potion();
}

// Is this spot inside any furniture or pillar?
function heroStuck(room, h) {
  const r = h.radius + 2;
  for (const f of room.furniture) {
    if (Math.abs(h.x - f.x) < f.w / 2 + r && Math.abs(h.y - f.y) < f.h / 2 + r) return true;
  }
  for (const p of room.pillars) {
    if (Math.hypot(h.x - p.x, h.y - p.y) < p.r + r) return true;
  }
  return false;
}

// Circle-vs-furniture collision: shove out along the least overlap.
function collideFurniture(ent, radius) {
  for (const f of run.room.furniture) {
    const hw = f.w / 2 + radius, hh = f.h / 2 + radius;
    const dx = ent.x - f.x, dy = ent.y - f.y;
    if (Math.abs(dx) < hw && Math.abs(dy) < hh) {
      const ox = hw - Math.abs(dx), oy = hh - Math.abs(dy);
      if (ox < oy) ent.x = f.x + (dx > 0 ? hw : -hw);
      else ent.y = f.y + (dy > 0 ? hh : -hh);
    }
  }
}

// Effective recipe cost — the alchemist brews on a discount.
function effCost(recipe) {
  const cost = Object.assign({}, recipe.cost);
  if (menu === 'brew' && run.hero.chemist) {
    let top = null;
    for (const id in cost) if (!top || cost[id] > cost[top]) top = id;
    cost[top] = Math.max(1, cost[top] - 1);
  }
  return cost;
}

function canAfford(recipe) {
  const cost = effCost(recipe);
  return Object.keys(cost).every(id => run.materials[id] >= cost[id]);
}

function attemptRecipe(recipe) {
  const h = run.hero;
  if (!canAfford(recipe)) { SFX.denied(); return; }
  if (recipe.item && !canGain(recipe.item)) {
    addText(h.x, h.y - 24, 'Hands full', '#ff6666');
    SFX.denied();
    return;
  }
  const cost = effCost(recipe);
  for (const id in cost) run.materials[id] -= cost[id];
  if (menu === 'brew') bumpStat('brews');
  if (recipe.item) {
    gainItem(recipe.item, h.x, h.y - 30);
  } else if (recipe.equipId) {
    equipItem(EQUIPMENT[recipe.equipId]);
  } else if (recipe.armor) {
    h.armor = recipe.armor;
    addText(h.x, h.y - 30, recipe.armor.name + ' equipped!', recipe.armor.color);
    burstParticles(h.x, h.y, recipe.armor.color, 16);
    SFX.unlock();
  }
}

// ---------------------------------------------------------
// The puzzle room — one of four riddles, one golden reward.
// ---------------------------------------------------------
function puzzleReward() {
  bumpStat('puzzles');
  const reward = makeChest(W / 2, IY0 + 90, 'gold');
  reward.spawnT = 0.3;
  run.room.chests.push(reward);
  addText(W / 2, H / 2 - 90, 'The floor rumbles open!', '#ffd75e');
  run.shake = 8;
  SFX.win();
}

function updatePuzzle(dt) {
  const pz = run.room.puzzle;
  if (!pz || pz.solved) return;
  if (pz.kind === 'seq') updatePuzzleSeq(pz);
  else if (pz.kind === 'path') updatePuzzlePath(pz, dt);
  else if (pz.kind === 'targets') updatePuzzleTargets(pz, dt);
  else if (pz.kind === 'push') updatePuzzlePush(pz);
  else if (pz.kind === 'orbs') {
    if (pz.hideT > 0) {
      pz.hideT -= dt;
      if (pz.hideT <= 0) {
        for (const st of pz.stones) if (!st.matched) st.revealed = false;
        pz.first = -1;
      }
    }
  } else if (pz.kind === 'beacons') {
    if (pz.litA && !pz.solved) {
      pz.timer -= dt;
      if (pz.timer <= 0) {
        pz.litA = false;
        addText(pz.a.x, pz.a.y - 34, 'The flame dies.', '#ff6666');
        SFX.denied();
      }
    }
  } else if (pz.kind === 'vigil') {
    if (!pz.started || pz.solved) return;
    const h = run.hero;
    if (Math.hypot(h.x - pz.x, h.y - pz.y) > pz.r) {
      pz.started = false;
      pz.t = 0;
      addText(pz.x, pz.y - 40, 'The vigil breaks.', '#ff6666');
      SFX.denied();
      return;
    }
    pz.t += dt;
    // the dark sends objections in waves
    const due = Math.floor(pz.t / 2.5) + 1;
    while (pz.wave < due && pz.wave < 3) {
      pz.wave++;
      for (let i = 0; i < 2; i++) spawnEnemy('bat');
    }
    if (pz.t >= pz.window) {
      pz.solved = true;
      puzzleReward();
    }
  }
}

// Push blocks: lean on a stone and it slides. Park one on each socket.
function updatePuzzlePush(pz) {
  const h = run.hero;
  for (const b of pz.blocks) {
    const hw = b.w / 2 + h.radius, hh = b.h / 2 + h.radius;
    const dx = h.x - b.x, dy = h.y - b.y;
    if (Math.abs(dx) >= hw || Math.abs(dy) >= hh) continue;
    const ox = hw - Math.abs(dx), oy = hh - Math.abs(dy);
    // the block gives way along the push axis
    let nbx = b.x, nby = b.y;
    if (ox < oy) nbx = b.x + (dx > 0 ? -ox : ox);
    else nby = b.y + (dy > 0 ? -oy : oy);
    nbx = Math.min(Math.max(nbx, IX0 + b.w / 2), IX1 - b.w / 2);
    nby = Math.min(Math.max(nby, IY0 + b.h / 2), IY1 - b.h / 2);
    // blocks don't pass through each other
    const clash = pz.blocks.some(o => o !== b &&
      Math.abs(nbx - o.x) < b.w && Math.abs(nby - o.y) < b.h);
    if (!clash) { b.x = nbx; b.y = nby; }
    // and the hero doesn't pass through the block
    const hw2 = b.w / 2 + h.radius, hh2 = b.h / 2 + h.radius;
    const dx2 = h.x - b.x, dy2 = h.y - b.y;
    if (Math.abs(dx2) < hw2 && Math.abs(dy2) < hh2) {
      const ox2 = hw2 - Math.abs(dx2), oy2 = hh2 - Math.abs(dy2);
      if (ox2 < oy2) h.x = b.x + (dx2 > 0 ? hw2 : -hw2);
      else h.y = b.y + (dy2 > 0 ? hh2 : -hh2);
    }
  }
  // every socket wants a stone
  if (pz.sockets.every(sk => pz.blocks.some(b => Math.hypot(b.x - sk.x, b.y - sk.y) < 26))) {
    pz.solved = true;
    puzzleReward();
  }
}

// Lights-out lanterns: E on one flips it and its neighbors.
function pressLantern(pz, i) {
  const cx = i % pz.grid, cy = Math.floor(i / pz.grid);
  [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
    const nx2 = cx + dx, ny2 = cy + dy;
    if (nx2 >= 0 && nx2 < pz.grid && ny2 >= 0 && ny2 < pz.grid) {
      pz.cells[ny2 * pz.grid + nx2] = !pz.cells[ny2 * pz.grid + nx2];
    }
  });
  SFX.clank();
  run.rings.push({ x: pz.nodes[i].x, y: pz.nodes[i].y, r: 8, vr: 120, life: 0.25, maxLife: 0.25, color: '#ffd75e' });
  if (pz.cells.every(v => v)) {
    pz.solved = true;
    puzzleReward();
  }
}

// Simon plates: step them in the order they glow.
function updatePuzzleSeq(pz) {
  const h = run.hero;
  let on = -1;
  pz.plates.forEach((p, i) => {
    if (Math.hypot(h.x - p.x, h.y - p.y) < 30) on = i;
  });

  if (on !== -1 && on !== pz.lastPlate) {
    const plate = pz.plates[on];
    if (on === pz.seq[pz.progress]) {
      pz.progress++;
      run.rings.push({ x: plate.x, y: plate.y, r: 12, vr: 140, life: 0.3, maxLife: 0.3, color: '#7dff8a' });
      SFX.select();
      if (pz.progress >= pz.seq.length) {
        pz.solved = true;
        puzzleReward();
      }
    } else {
      pz.progress = 0;
      run.shake = 6;
      addText(plate.x, plate.y - 30, 'Wrong order!', '#ff6666');
      hurtPlayer(5, 'a trapped floor plate');
      SFX.denied();
    }
  }
  pz.lastPlate = on;
}

// Is this tile part of the path? Diagonal steps in the route also
// bless the corner tile between them, so the walk is always possible.
function pathTileSafe(pz, c, r) {
  if (r === pz.safe[c]) return true;
  return c > 0 && r === pz.safe[c - 1] && Math.abs(pz.safe[c] - pz.safe[c - 1]) === 1;
}

// Memory path: once armed, only the flashed tiles hold your weight.
function updatePuzzlePath(pz, dt) {
  if (!pz.armed) return;
  if (pz.zapT > 0) { pz.zapT -= dt; return; }
  const h = run.hero;
  const c = Math.floor((h.x - pz.ox) / pz.tile);
  const r = Math.floor((h.y - pz.oy) / pz.tile);
  if (c < 0 || c >= pz.cols || r < 0 || r >= pz.rows) return;

  // grace at tile borders: grazing an edge or corner never bites
  const lx = (h.x - pz.ox) - c * pz.tile;
  const ly = (h.y - pz.oy) - r * pz.tile;
  if (lx < 12 || lx > pz.tile - 12 || ly < 12 || ly > pz.tile - 12) return;

  if (!pathTileSafe(pz, c, r)) {
    pz.zapT = 0.6;
    run.shake = 6;
    addText(h.x, h.y - 30, 'The tile gives way!', '#ff6666');
    hurtPlayer(5, 'a treacherous tile');
    h.x = pz.ox - 46; // back to the near side
    SFX.denied();
  } else if (c === pz.cols - 1) {
    pz.solved = true;
    puzzleReward();
  }
}

// Shooting gallery: three marks before the clock runs out.
function updatePuzzleTargets(pz, dt) {
  if (!pz.started) return;
  pz.timer -= dt;
  if (pz.timer <= 0) {
    pz.started = false;
    pz.hit = 0;
    run.enemies = run.enemies.filter(e => e.type !== 'target');
    addText(W / 2, H / 2 - 40, 'Too slow. Ring it again.', '#ff6666');
    SFX.denied();
  }
}

function spawnTargetAt(spot) {
  spawnEnemy('target');
  const t = run.enemies[run.enemies.length - 1];
  t.x = spot.x;
  t.y = spot.y;
  t.spawnT = 0.2;
}

// Levers flip themselves and their neighbors. Light every lamp.
function pullPuzzleLever(pz, i) {
  for (const j of [i - 1, i, i + 1]) {
    if (j >= 0 && j < pz.state.length) pz.state[j] = !pz.state[j];
  }
  SFX.clank();
  run.rings.push({ x: pz.levers[i].x, y: pz.levers[i].y, r: 10, vr: 120, life: 0.25, maxLife: 0.25, color: '#ffd75e' });
  if (pz.state.every(v => v)) {
    pz.solved = true;
    puzzleReward();
  }
}

// E pressed in a puzzle room: route to whatever the riddle wants.
function puzzleInteract() {
  const pz = run.room.puzzle;
  const h = run.hero;
  if (!pz || pz.solved) return false;
  if (pz.kind === 'levers') {
    for (let i = 0; i < pz.levers.length; i++) {
      if (Math.hypot(h.x - pz.levers[i].x, h.y - pz.levers[i].y) < 55) {
        pullPuzzleLever(pz, i);
        return true;
      }
    }
    return false;
  }
  if (pz.kind === 'counting') {
    for (const st of pz.stones) {
      if (st.lit || Math.hypot(h.x - st.x, h.y - st.y) >= 48) continue;
      if (st.n === pz.next) {
        st.lit = true;
        pz.next++;
        run.rings.push({ x: st.x, y: st.y, r: 10, vr: 130, life: 0.25, maxLife: 0.25, color: '#7dff8a' });
        SFX.select();
        if (pz.next > pz.stones.length) {
          pz.solved = true;
          puzzleReward();
        }
      } else {
        pz.next = 1;
        pz.stones.forEach(s2 => s2.lit = false);
        addText(st.x, st.y - 30, 'Out of order!', '#ff6666');
        hurtPlayer(5, 'a spiteful rune');
        SFX.denied();
      }
      return true;
    }
    return false;
  }
  if (pz.kind === 'vigil') {
    if (!pz.started && Math.hypot(h.x - pz.x, h.y - pz.y) < pz.r) {
      pz.started = true;
      pz.t = 0;
      pz.wave = 0;
      addText(pz.x, pz.y - 40, 'HOLD.', '#ff9a3a');
      SFX.unlock();
      return true;
    }
    return false;
  }
  if (pz.kind === 'orbs') {
    if (pz.hideT > 0) return true; // wait for the stones to settle
    for (let i = 0; i < pz.stones.length; i++) {
      const st = pz.stones[i];
      if (st.matched || st.revealed) continue;
      if (Math.hypot(h.x - st.x, h.y - st.y) < 48) {
        st.revealed = true;
        SFX.select();
        if (pz.first === -1) {
          pz.first = i;
        } else {
          const other = pz.stones[pz.first];
          if (other.sym === st.sym) {
            st.matched = other.matched = true;
            pz.first = -1;
            run.rings.push({ x: st.x, y: st.y, r: 10, vr: 140, life: 0.3, maxLife: 0.3, color: '#7dff8a' });
            SFX.chest();
            if (pz.stones.every(s2 => s2.matched)) {
              pz.solved = true;
              puzzleReward();
            }
          } else {
            pz.hideT = 0.9; // a moment to memorize, then they hide
          }
        }
        return true;
      }
    }
    return false;
  }
  if (pz.kind === 'statues') {
    for (let i = 0; i < pz.statues.length; i++) {
      if (Math.hypot(h.x - pz.statues[i].x, h.y - pz.statues[i].y) < 52) {
        for (const j of [i - 1, i, i + 1]) {
          if (j >= 0 && j < 4) pz.facing[j] = (pz.facing[j] + 1) % 4;
        }
        SFX.clank();
        run.rings.push({ x: pz.statues[i].x, y: pz.statues[i].y, r: 10, vr: 120, life: 0.25, maxLife: 0.25, color: '#c9c9e0' });
        if (pz.facing.every(f => f === 0)) {
          pz.solved = true;
          puzzleReward();
        }
        return true;
      }
    }
    return false;
  }
  if (pz.kind === 'beacons') {
    if (!pz.litA && Math.hypot(h.x - pz.a.x, h.y - pz.a.y) < 55) {
      pz.litA = true;
      pz.timer = pz.window;
      addText(pz.a.x, pz.a.y - 34, 'RUN.', '#ff9a3a');
      SFX.unlock();
      return true;
    }
    if (pz.litA && Math.hypot(h.x - pz.b.x, h.y - pz.b.y) < 55) {
      pz.solved = true;
      puzzleReward();
      return true;
    }
    return false;
  }
  if (pz.kind === 'lightsout') {
    for (let i = 0; i < pz.nodes.length; i++) {
      if (Math.hypot(h.x - pz.nodes[i].x, h.y - pz.nodes[i].y) < 48) {
        pressLantern(pz, i);
        return true;
      }
    }
    return false;
  }
  if (pz.kind === 'path' && !pz.armed &&
      Math.hypot(h.x - pz.plaque.x, h.y - pz.plaque.y) < 60) {
    pz.armed = true;
    addText(pz.plaque.x, pz.plaque.y - 34, 'The floor wakes...', '#ff9a3a');
    SFX.unlock();
    return true;
  }
  if (pz.kind === 'targets' && !pz.started &&
      Math.hypot(h.x - pz.plaque.x, h.y - pz.plaque.y) < 60) {
    pz.started = true;
    pz.hit = 0;
    pz.timer = 14;
    spawnTargetAt(pz.spots[0]);
    addText(pz.plaque.x, pz.plaque.y - 34, 'Three marks. Fourteen seconds.', '#ff9a3a');
    SFX.unlock();
    return true;
  }
  return false;
}

// ---------------------------------------------------------
// Trial spawners: ordinary rooms trickle their monsters out of a
// caged brazier, a couple at a time. Outlast the cage and it breaks
// open with food and loot.
// ---------------------------------------------------------
function updateSpawner(dt) {
  const sp = run.room.spawner;
  if (!sp || !sp.active) return;

  if (sp.remaining.length > 0) {
    sp.cd -= dt;
    const alive = run.enemies.length;
    if (sp.cd <= 0 && alive < 4) {
      // let out a couple at a time
      for (let i = 0; i < 2 && sp.remaining.length > 0; i++) {
        spawnEnemy(sp.remaining.pop());
        const e = run.enemies[run.enemies.length - 1];
        e.x = sp.x + (Math.random() - 0.5) * 90;
        e.y = sp.y + (Math.random() - 0.5) * 70;
        e.x = Math.min(Math.max(e.x, IX0 + e.r), IX1 - e.r);
        e.y = Math.min(Math.max(e.y, IY0 + e.r), IY1 - e.r);
      }
      sp.cd = 2.0;
      SFX.door();
    }
  } else if (run.enemies.length === 0) {
    // trial complete: the cage cracks open
    sp.active = false;
    run.room.cleared = true;
    run.room.unlockT = 0.4;
    run.roomsCleared++;
    burstParticles(sp.x, sp.y, '#ff9a3a', 24);
    run.rings.push({ x: sp.x, y: sp.y, r: 16, vr: 260, life: 0.4, maxLife: 0.4, color: '#ff9a3a' });
    addText(sp.x, sp.y - 34, 'The trial is done.', '#ffd75e');
    // food and loot
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      run.room.loot.hearts.push({
        x: sp.x + (i - n / 2) * 34, y: sp.y + 44, heal: 20, food: true,
      });
    }
    dropCoins(sp.x, sp.y + 10, Math.round(20 * (1 + crypLevel() * 0.2)), 5);
    maybeSpawnChest(run.room);
    SFX.win();
  }
}

// ---------------------------------------------------------
// The arena: ring the banner, survive two waves, take the purse.
// ---------------------------------------------------------
function startArena() {
  const room = run.room;
  room.arena.state = 'wave1';
  addText(W / 2, H / 2 - 40, 'WAVE 1', '#ff9a3a');
  run.shake = 5;
  SFX.unlock();
  const lvl = crypLevel();
  const pool = floorPool(Math.max(0, run.floor));
  for (let i = 0; i < Math.min(4 + Math.floor(lvl / 2), 7); i++) {
    spawnEnemy(pool[Math.floor(Math.random() * pool.length)]);
  }
}

function updateArena(dt) {
  const a = run.room.arena;
  if (!a || a.state === 'idle' || a.state === 'done') return;
  if (run.enemies.length > 0) return;
  a.t += dt;
  if (a.t < 0.8) return; // a breath between waves
  a.t = 0;
  if (a.state === 'wave1') {
    a.state = 'wave2';
    addText(W / 2, H / 2 - 40, 'WAVE 2', '#ff6666');
    SFX.unlock();
    const lvl = crypLevel();
    for (let i = 0; i < Math.min(5 + Math.floor(lvl / 2), 8); i++) {
      spawnEnemy(['skeleton', 'skeleton', 'bat', 'slime'][Math.floor(Math.random() * 4)]);
    }
  } else if (a.state === 'wave2') {
    a.state = 'done';
    const reward = makeChest(W / 2, H / 2, 'gold');
    reward.spawnT = 0.3;
    run.room.chests.push(reward);
    addText(W / 2, H / 2 - 60, 'THE CROWD (of ghosts) ROARS', '#ffd75e');
    SFX.win();
  }
}

// The gauntlet: ring the bell, survive twenty seconds of everything.
function startGauntlet() {
  MUSIC.excite(1);
  const g = run.room.gauntlet;
  g.state = 'live';
  g.t = 20;
  g.spawnT = 0.5;
  addText(W / 2, H / 2 - 40, 'SURVIVE', '#ff5a5a');
  run.shake = 6;
  SFX.unlock();
}

function updateGauntlet(dt) {
  const g = run.room.gauntlet;
  if (g.state !== 'live') return;
  g.t -= dt;
  g.spawnT -= dt;
  if (g.spawnT <= 0 && run.enemies.length < 7) {
    g.spawnT = 1.6;
    const pool = floorPool(Math.max(0, run.floor));
    spawnEnemy(pool[Math.floor(Math.random() * pool.length)]);
  }
  if (g.t <= 0) {
    g.state = 'done';
    bumpStat('gauntlets');
    const reward = makeChest(W / 2, H / 2, 'gold');
    reward.spawnT = 0.3;
    run.room.chests.push(reward);
    addText(W / 2, H / 2 - 60, 'THE BELL FALLS SILENT', '#ffd75e');
    SFX.win();
  }
}

// The spring: one long drink, once.
function drinkSpring() {
  const room = run.room;
  const h = run.hero;
  room.springUsed = true;
  h.hp = h.maxHp;
  addText(h.x, h.y - 30, 'The spring restores you.', '#7de8ff');
  run.rings.push({ x: W / 2, y: H / 2, r: 20, vr: 240, life: 0.5, maxLife: 0.5, color: '#7de8ff' });
  SFX.blessing();
}

// The prison: something is in the cage. Probably friendly.
function openPrison() {
  const room = run.room;
  const h = run.hero;
  room.prisonOpened = true;
  if (Math.random() < 0.65) {
    addText(W / 2, H / 2 - 70, 'A grateful spirit slips free...', '#c9b8ff');
    grantBlessing(W / 2, H / 2 - 30);
    dropCoins(W / 2, H / 2 + 30, Math.round(40 * (1 + crypLevel() * 0.2)), 6);
  } else {
    addText(W / 2, H / 2 - 70, 'It was never a prisoner.', '#ff6666');
    run.shake = 8;
    SFX.curse();
    for (let i = 0; i < 3; i++) spawnEnemy('bat');
    spawnEnemy('skeleton');
    room.cleared = false;
    room.ambush = true; // the doors slam until the ambush is dealt with
  }
}

// ---------------------------------------------------------
// The Shrine of the Founder — pray for a gift, risk a curse
// ---------------------------------------------------------
function prayShrine() {
  const room = run.room;
  const h = run.hero;
  if (room.type !== 'shrine' || room.shrineUsed) return;
  if (Math.hypot(h.x - W / 2, h.y - (H / 2 - 10)) > 85) return;
  room.shrineUsed = true;

  const roll = Math.random();
  if (roll < 0.5) {
    grantBlessing(W / 2, H / 2 - 60);
  } else if (roll < 0.7) {
    addText(W / 2, H / 2 - 70, 'The Founder provides.', '#ffd75e');
    dropCoins(W / 2, H / 2 + 40, Math.round(60 * (1 + crypLevel() * 0.2)), 8);
    SFX.chest();
  } else {
    const curse = Math.floor(Math.random() * 3);
    run.shake = 10;
    SFX.curse();
    if (curse === 0) {
      h.hp = Math.max(1, Math.round(h.hp * 0.55));
      h.regenDelay = 6;
      addText(W / 2, H / 2 - 70, 'The Founder demands blood.', '#ff6666');
    } else if (curse === 1) {
      h.maxHp = Math.max(20, h.maxHp - 15);
      h.hp = Math.min(h.hp, h.maxHp);
      addText(W / 2, H / 2 - 70, 'A piece of you stays here.', '#ff6666');
    } else {
      addText(W / 2, H / 2 - 70, 'The Founder sends a test.', '#ff6666');
      for (let i = 0; i < 3; i++) spawnEnemy('bat');
      room.cleared = false;
      room.ambush = true; // the doors slam shut until the test is passed
    }
  }
}

// ---------------------------------------------------------
// Combat helpers
// ---------------------------------------------------------
function hurtPlayer(amount, sourceName) {
  const h = run.hero;
  if (h.invuln > 0 || state !== 'play') return;

  // Knight's Aegis: a charged shield eats the hit entirely.
  if (h.aegisReady) {
    h.aegisReady = false;
    h.aegisT = 8;
    h.invuln = Math.max(h.invuln, 0.6);
    addText(h.x, h.y - 24, 'Blocked!', '#8fb4ff');
    run.rings.push({ x: h.x, y: h.y, r: h.radius + 6, vr: 180, life: 0.3, maxLife: 0.3, color: '#8fb4ff' });
    SFX.hit();
    return;
  }

  const guard = h.offhand && h.offhand.guard ? h.offhand.guard : 1;
  const dmg = Math.max(1, Math.round(amount * h.dmgTaken * (h.armor ? h.armor.mult : 1) * guard));
  h.hp -= dmg;
  h.invuln = 0.9;
  h.regenDelay = REGEN_DELAY;
  MUSIC.excite(0.45);
  run.lastHit = sourceName;
  run.shake = 9;
  run.hitStop = Math.max(run.hitStop, 0.08);
  addText(h.x, h.y - 24, '-' + dmg, '#ff6666');
  SFX.hurt();
  if (h.hp <= 0) {
    // in a minigame, death just ends the game — no lineage business
    if (run.minigame) {
      h.hp = 0;
      SFX.death();
      burstParticles(h.x, h.y, CLASSES[h.heir.classId].color, 30);
      endMinigame();
      return;
    }
    // A carried Totem of the Founder spends itself to cheat death.
    const totemIdx = h.items.findIndex(st => st.id === 'totem');
    if (totemIdx !== -1) {
      if (--h.items[totemIdx].n <= 0) h.items.splice(totemIdx, 1);
      h.hp = Math.round(h.maxHp * 0.3);
      h.invuln = 2;
      h.regenDelay = 0;
      run.shake = 14;
      addText(h.x, h.y - 40, 'THE TOTEM SHATTERS', '#ffd75e');
      burstParticles(h.x, h.y, '#ffd75e', 35);
      run.rings.push({ x: h.x, y: h.y, r: 20, vr: 400, life: 0.5, maxLife: 0.5, color: '#ffd75e' });
      SFX.blessing();
      return;
    }
    h.hp = 0;
    SFX.death();
    burstParticles(h.x, h.y, CLASSES[h.heir.classId].color, 30);
    save.gold += run.gold;
    save.generation += 1;
    save.lastFate = 'fallen';
    // the Founder claims another descendant — their ghost starts
    // at the surface and descends one floor per generation
    save.fallen.push({ name: h.heir.name, classId: h.heir.classId, floor: -1 });
    if (save.fallen.length > 8) save.fallen.shift();
    bumpStat('deaths');
    saveGame();
    state = 'gameover';
  }
}

function damageEnemy(e, amount, isCrit) {
  e.hp -= amount;
  e.flash = 0.12;
  run.hitStop = Math.max(run.hitStop, e.type === 'boss' ? 0.06 : 0.04);
  addText(e.x, e.y - e.r - 8, Math.round(amount) + (isCrit ? '!' : ''),
    isCrit ? '#ffd75e' : '#ffffff');
  if (e.type === 'boss') SFX.bossHit(); else SFX.hit();
  if (isCrit) SFX.crit();
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  run.enemies = run.enemies.filter(x => x !== e);
  run.kills++;
  MUSIC.excite(0.12);
  if (e.type !== 'target') bumpStat('kills');
  if (e.type === 'guardian') bumpStat('keymasters');
  burstParticles(e.x, e.y, e.color, e.type === 'boss' ? 40 : 12);
  run.rings.push({ x: e.x, y: e.y, r: e.r * 0.7, vr: 180, life: 0.3, maxLife: 0.3, color: e.color });

  // shooting-gallery targets score the trial and drop nothing
  if (e.type === 'target') {
    if (run.minigame && (run.minigame.id === 'range' || run.minigame.id === 'whack')) run.minigame.score++;
    const pz = run.room.puzzle;
    if (pz && pz.kind === 'targets' && pz.started && !pz.solved) {
      pz.hit++;
      if (pz.hit >= pz.spots.length) {
        pz.solved = true;
        pz.started = false;
        puzzleReward();
      } else {
        spawnTargetAt(pz.spots[pz.hit]);
      }
    }
    return;
  }

  const h = run.hero;
  if (h.lifesteal > 0 && h.hp > 0) {
    h.hp = Math.min(h.maxHp, h.hp + h.lifesteal);
    addText(h.x, h.y - 24, '+' + h.lifesteal, '#c9ffb0');
  }
  // necromancer: the dead sometimes get back up, on our side
  if (h.necro && e.type !== 'boss' &&
      run.minions.filter(m => m.type === 'skeleton').length < MINIONS.skeleton.cap &&
      Math.random() < 0.3) {
    spawnMinion(e.x, e.y);
    addText(e.x, e.y - 20, 'Rise!', '#8a6ae8');
  }

  const def = ENEMIES[e.type];
  const goldMult = 1 + crypLevel() * 0.2;
  const value = Math.round((def.gold[0] + Math.random() * (def.gold[1] - def.gold[0])) * goldMult);
  dropCoins(e.x, e.y, value, e.type === 'boss' ? 10 : 3);

  // per-enemy loot tables: monsters drop the parts they're made of
  if (ENEMY_LOOT[e.type]) {
    for (const entry of ENEMY_LOOT[e.type]) {
      if (Math.random() < entry.chance) spawnDrop(entry.drop, e.x, e.y);
    }
  }
  if (run.floor >= 1 && e.type !== 'boss' && Math.random() < 0.06) dropMaterial(e.x, e.y, 'essence');

  if (e.type === 'boss') {
    run.bossDead = true;
    run.victoryTimer = 1.6;
    run.shake = 16;
    SFX.win();
  }

  const sp = run.room.spawner;
  const trialRunning = sp && sp.active;
  if (run.enemies.length === 0 && !run.room.cleared && !trialRunning) {
    run.room.cleared = true;
    run.room.unlockT = 0.4; // door bars slide away
    run.roomsCleared++;
    if (!run.bossDead) SFX.door();
    if (Math.random() < 0.15) {
      run.room.loot.hearts.push({ x: e.x, y: e.y, heal: 30 });
    }
    maybeSpawnChest(run.room);
  }
}

function dropCoins(x, y, totalValue, pieces) {
  for (let i = 0; i < pieces; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 140;
    run.room.loot.coins.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      val: Math.max(1, Math.round(totalValue / pieces)),
      t: Math.random() * 6,
    });
  }
}

function addText(x, y, txt, color) {
  run.texts.push({ x, y, txt, color, life: 0.9 });
}

function burstParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 180;
    run.particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.3 + Math.random() * 0.4, color,
      size: 2 + Math.random() * 4,
    });
  }
}

// Fire the hero's projectile: bolt, arrow, or flask, with class
// passives (pierce, homing, deadeye) attached.
function fireProjectile(angle, dmgMult) {
  const h = run.hero;
  const isCrit = Math.random() < h.crit;
  const speed = h.attack === 'arrow' ? 560 : h.attack === 'flask' ? 330 : 430;
  const p = {
    x: h.x + Math.cos(angle) * (h.radius + 6),
    y: h.y + Math.sin(angle) * (h.radius + 6),
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    r: h.attack === 'flask' ? 7 : 6,
    dmg: heroDmg() * (isCrit ? 2 : 1) * dmgMult, isCrit,
    friendly: true, kind: h.attack,
    color: CLASSES[h.heir.classId].color,
    sx: h.x, sy: h.y, travel: 0,
  };
  if (h.pierce) { p.pierce = h.pierce; p.hitSet = new Set(); }
  if (h.homing) p.homing = true;
  if (h.deadeye) p.deadeye = true;
  if (h.attack === 'flask') p.maxTravel = 250;
  run.projectiles.push(p);
}

// Alchemist flasks explode: everything near the blast takes the hit.
function explodeFlask(p) {
  run.rings.push({ x: p.x, y: p.y, r: 14, vr: 280, life: 0.3, maxLife: 0.3, color: p.color });
  burstParticles(p.x, p.y, p.color, 14);
  run.shake = Math.max(run.shake, 4);
  for (const e of [...run.enemies]) {
    if (e.spawnT > 0) continue;
    if (Math.hypot(e.x - p.x, e.y - p.y) < 62 + e.r * 0.5) {
      damageEnemy(e, p.dmg, p.isCrit);
    }
  }
}

// ---------------------------------------------------------
// Skeleton minions — the necromancer's staffing solution
// ---------------------------------------------------------
function spawnMinion(x, y) {
  return spawnMinionOf(x, y, 'skeleton');
}

function spawnMinionOf(x, y, type) {
  const def = MINIONS[type];
  if (run.minions.filter(m => m.type === type).length >= def.cap) return;
  run.minions.push({
    type, x, y, r: def.r, dmg: def.dmg, hp: def.hp, maxHp: def.hp,
    speed: def.speed, hitCd: 0, invuln: 0, shootT: 1,
    life: def.life, t: Math.random() * 6, dead: false, color: def.color,
  });
  burstParticles(x, y, def.color, 10);
}

function updateMinions(dt) {
  const h = run.hero;
  run.minions = run.minions.filter(m => (m.life -= dt) > 0 && !m.dead);
  for (const m of run.minions) {
    m.t += dt;
    if (m.hitCd > 0) m.hitCd -= dt;
    if (m.invuln > 0) m.invuln -= dt;
    else if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + 1.5 * dt);

    // chase the nearest awake enemy; otherwise heel to the master
    let target = null, bestD = Infinity;
    for (const e of run.enemies) {
      if (e.spawnT > 0) continue;
      const d = Math.hypot(e.x - m.x, e.y - m.y);
      if (d < bestD) { bestD = d; target = e; }
    }
    if (m.type === 'turret') {
      // planted metal doesn't chase; it argues at range
      m.shootT -= dt;
      if (target && bestD < 420 && m.shootT <= 0) {
        m.shootT = 1.4;
        const a = Math.atan2(target.y - m.y, target.x - m.x);
        run.projectiles.push({
          x: m.x + Math.cos(a) * (m.r + 4), y: m.y + Math.sin(a) * (m.r + 4),
          vx: Math.cos(a) * 340, vy: Math.sin(a) * 340,
          r: 5, dmg: m.dmg, isCrit: false, friendly: true, kind: 'bolt', color: m.color,
        });
        SFX.turret();
      }
      continue;
    }
    const chaseSpeed = m.speed || 230;
    if (target) {
      const nx = (target.x - m.x) / (bestD || 1), ny = (target.y - m.y) / (bestD || 1);
      if (bestD > target.r + m.r - 4) {
        m.x += nx * chaseSpeed * dt;
        m.y += ny * chaseSpeed * dt;
      }
      if (bestD < target.r + m.r + 4 && m.hitCd <= 0) {
        m.hitCd = m.type === 'bee' ? 0.5 : 0.8;
        target.kx += nx * 80;
        target.ky += ny * 80;
        damageEnemy(target, m.dmg, false);
      }
    } else {
      const dh = Math.hypot(h.x - m.x, h.y - m.y);
      if (dh > 70) {
        m.x += (h.x - m.x) / dh * chaseSpeed * 0.85 * dt;
        m.y += (h.y - m.y) / dh * chaseSpeed * 0.85 * dt;
      }
    }
    m.x = Math.min(Math.max(m.x, IX0 + m.r), IX1 - m.r);
    m.y = Math.min(Math.max(m.y, IY0 + m.r), IY1 - m.r);
    pushOutOfPillars(m, m.r);
    collideFurniture(m, m.r);
  }
}

// ---------------------------------------------------------
// Special abilities (SHIFT / K) — one per class
// ---------------------------------------------------------
function useSpecial() {
  const h = run.hero;
  if (h.spCd > 0) return;
  const spec = CLASSES[h.heir.classId].special;
  h.spCd = spec.cd;
  const angle = Math.atan2(h.face.y, h.face.x);

  if (spec.id === 'block') {
    h.invuln = Math.max(h.invuln, 1.2);
    h.blockT = 1.2;
    for (const e of run.enemies) {
      const d = Math.hypot(e.x - h.x, e.y - h.y) || 1;
      if (d < 150) {
        e.kx += (e.x - h.x) / d * 500;
        e.ky += (e.y - h.y) / d * 500;
      }
    }
    run.rings.push({ x: h.x, y: h.y, r: 20, vr: 350, life: 0.4, maxLife: 0.4, color: '#8fb4ff' });
    SFX.special();
  } else if (spec.id === 'dash') {
    h.dash = { t: 0.16, vx: Math.cos(angle) * 780, vy: Math.sin(angle) * 780 };
    h.invuln = Math.max(h.invuln, 0.35);
    SFX.dash();
  } else if (spec.id === 'spin') {
    h.spin = { t: 0, dur: 0.35 };
    for (const e of [...run.enemies]) {
      const d = Math.hypot(e.x - h.x, e.y - h.y) || 1;
      if (d < h.radius + 70) {
        e.kx += (e.x - h.x) / d * 300;
        e.ky += (e.y - h.y) / d * 300;
        damageEnemy(e, heroDmg() * 1.2, Math.random() < h.crit);
      }
    }
    SFX.special();
  } else if (spec.id === 'nova' || spec.id === 'soulnova') {
    const n = spec.id === 'nova' ? 8 : 12;
    const color = spec.id === 'nova' ? '#d9a5ff' : '#c9ffb0';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      run.projectiles.push({
        x: h.x, y: h.y,
        vx: Math.cos(a) * 320, vy: Math.sin(a) * 320,
        r: 6, dmg: heroDmg() * 0.8, isCrit: false,
        friendly: true, kind: 'bolt', color,
      });
    }
    run.rings.push({ x: h.x, y: h.y, r: 14, vr: 280, life: 0.35, maxLife: 0.35, color });
    SFX.special();
  } else if (spec.id === 'shadowstep') {
    burstParticles(h.x, h.y, '#7de8ff', 14);
    h.x = Math.min(Math.max(h.x + Math.cos(angle) * 160, IX0 + h.radius), IX1 - h.radius);
    h.y = Math.min(Math.max(h.y + Math.sin(angle) * 160, IY0 + h.radius), IY1 - h.radius);
    h.invuln = Math.max(h.invuln, 0.4);
    burstParticles(h.x, h.y, '#7de8ff', 14);
    SFX.dash();
  } else if (spec.id === 'volley') {
    for (const spread of [-0.35, -0.17, 0, 0.17, 0.35]) {
      fireProjectile(angle + spread, 0.8);
    }
    SFX.special();
  } else if (spec.id === 'barrage') {
    for (const spread of [-0.3, 0, 0.3]) {
      fireProjectile(angle + spread, 0.9);
    }
    SFX.special();
  } else if (spec.id === 'sanctuary') {
    run.zones.push({ x: h.x, y: h.y, r: 85, t: 4 });
    run.rings.push({ x: h.x, y: h.y, r: 20, vr: 200, life: 0.4, maxLife: 0.4, color: '#ffe08a' });
    SFX.blessing();
  } else if (spec.id === 'wolves') {
    spawnMinionOf(h.x - 34, h.y, 'wolf');
    spawnMinionOf(h.x + 34, h.y, 'wolf');
    addText(h.x, h.y - 30, 'The pack answers!', '#c98a4a');
    SFX.special();
  } else if (spec.id === 'turret') {
    const turrets = run.minions.filter(m => m.type === 'turret');
    if (turrets.length >= MINIONS.turret.cap) {
      turrets[0].dead = true; // the oldest is recycled
      burstParticles(turrets[0].x, turrets[0].y, '#7de8ff', 8);
    }
    spawnMinionOf(h.x, h.y, 'turret');
    addText(h.x, h.y - 30, 'Deployed.', '#7de8ff');
    SFX.clank();
  } else if (spec.id === 'swarm') {
    for (let i = 0; i < 5; i++) {
      spawnMinionOf(h.x + (Math.random() - 0.5) * 50, h.y + (Math.random() - 0.5) * 50, 'bee');
    }
    addText(h.x, h.y - 30, 'The hive objects!', '#ffd75e');
    SFX.special();
  } else if (spec.id === 'raisedead') {
    while (run.minions.filter(m => m.type === 'skeleton').length < MINIONS.skeleton.cap) {
      spawnMinionOf(h.x + (Math.random() - 0.5) * 70, h.y + (Math.random() - 0.5) * 70, 'skeleton');
    }
    run.minions.forEach(m => { if (m.type === 'skeleton') m.life = 25; });
    addText(h.x, h.y - 30, 'Rise!', '#8a6ae8');
    SFX.special();
  }
}

// ---------------------------------------------------------
// Update — one tick of the simulation
// ---------------------------------------------------------
function update(dt) {
  // Hit-stop: the world freezes for a few frames on impact.
  if (run.hitStop > 0) { run.hitStop -= dt; return; }

  run.time += dt;
  if (run.shake > 0) run.shake = Math.max(0, run.shake - dt * 30);
  if (run.fade > 0) run.fade -= dt;
  if (run.room.unlockT > 0) run.room.unlockT -= dt;

  // a shaken-off Shade circles back if the lights are still out
  if (run.blackout && !run.shade && run.shadeRespawn !== undefined) {
    run.shadeRespawn -= dt;
    if (run.shadeRespawn <= 0) {
      run.shadeRespawn = undefined;
      run.shade = { x: IX0 + 40, y: IY0 + 40, speed: SHADE.speed, t: 0 };
      run.shadeRooms = 0;
      addText(run.hero.x, run.hero.y - 40, 'It found your scent again.', '#ff6666');
      run.shake = 8;
      SFX.blackout();
    }
  }

  // the lantern burns down; at zero, the lights go out and the Shade
  // comes. The surface is safe — daylight, of a sort.
  if (!run.blackout && run.floor >= 0) {
    const save2 = run.hero.offhand && run.hero.offhand.powerSave ? run.hero.offhand.powerSave : 1;
    run.power -= POWER_DRAIN * (1 + run.floor * 0.1) * save2 * dt;
    if (run.power <= 0) {
      run.power = 0;
      run.blackout = true;
      run.shade = { x: IX0 + 40, y: IY0 + 40, speed: SHADE.speed, t: 0 };
      run.shadeRooms = 0;
      MUSIC.excite(1);
      addText(run.hero.x, run.hero.y - 60, 'THE LANTERN DIES', '#c9b8ff');
      run.shake = 12;
      SFX.blackout();
    }
  }
  if (run.shade) updateShade(dt);

  updatePlayer(dt);
  if (run.minigame) updateMinigame(dt);
  if (run.room.type === 'puzzle') updatePuzzle(dt);
  if (run.room.type === 'arena') updateArena(dt);
  if (run.room.type === 'gauntlet') updateGauntlet(dt);
  updateSpawner(dt);
  updateEnemies(dt);
  updateMinions(dt);
  updateParty(dt);
  updateProjectiles(dt);
  updateLoot(dt);

  // paladin sanctuaries: holy ground that heals whoever stands in it
  run.zones = run.zones.filter(z => (z.t -= dt) > 0);
  for (const z of run.zones) {
    const h = run.hero;
    if (Math.hypot(h.x - z.x, h.y - z.y) < z.r && h.hp < h.maxHp) {
      h.hp = Math.min(h.maxHp, h.hp + 10 * dt);
    }
  }

  run.texts = run.texts.filter(t => (t.life -= dt) > 0);
  run.texts.forEach(t => t.y -= 40 * dt);
  run.particles = run.particles.filter(p => (p.life -= dt) > 0);
  run.particles.forEach(p => {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
  });
  run.rings = run.rings.filter(r => (r.life -= dt) > 0);
  run.rings.forEach(r => r.r += r.vr * dt);

  if (run.bossDead && run.victoryTimer > 0) {
    run.victoryTimer -= dt;
    if (run.victoryTimer <= 0) {
      save.gold += run.gold;
      save.wins += 1;
      save.generation += 1;
      save.lastFate = 'triumphant';
      saveGame();
      checkClassTasks(); // the Revenant waits on the first win
      state = 'victory';
    }
  }
}

// Circle-vs-pillar collision: shove the entity out along the normal.
function pushOutOfPillars(ent, radius) {
  for (const p of run.room.pillars) {
    const dx = ent.x - p.x, dy = ent.y - p.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const min = radius + p.r;
    if (d < min) {
      ent.x = p.x + dx / d * min;
      ent.y = p.y + dy / d * min;
    }
  }
}

// Greg's Shade: unkillable, ignores walls, only ever gets faster.
// Your options are the elevator or the grave.
function updateShade(dt) {
  const s = run.shade;
  const h = run.hero;
  s.t += dt;
  s.speed = Math.min(SHADE.maxSpeed, s.speed + SHADE.ramp * dt);
  const d = Math.hypot(h.x - s.x, h.y - s.y) || 1;
  s.x += (h.x - s.x) / d * s.speed * dt;
  s.y += (h.y - s.y) / d * s.speed * dt;

  // lantern light holds it at the edge — hungry, circling, patient
  for (const f of run.room.furniture) {
    if (f.kind !== 'lantern') continue;
    const ld = Math.hypot(s.x - f.x, s.y - f.y) || 1;
    if (ld < LANTERN_RADIUS) {
      s.x = f.x + (s.x - f.x) / ld * LANTERN_RADIUS;
      s.y = f.y + (s.y - f.y) / ld * LANTERN_RADIUS;
    }
  }

  if (Math.hypot(h.x - s.x, h.y - s.y) < h.radius + 20) {
    hurtPlayer(SHADE.dmg, "Greg's Shade");
  }
}

function updatePlayer(dt) {
  const h = run.hero;
  if (h.invuln > 0) h.invuln -= dt;
  if (h.attackTimer > 0) h.attackTimer -= dt;
  if (h.spCd > 0) h.spCd -= dt;
  if (h.spin) { h.spin.t += dt; if (h.spin.t >= h.spin.dur) h.spin = null; }
  if (h.swiftT > 0) h.swiftT -= dt;
  if (h.strengthT > 0) h.strengthT -= dt;
  if (h.blockT > 0) h.blockT -= dt;
  if (h.chillT > 0) h.chillT -= dt;

  // shinobi combo fades; knight aegis recharges
  if (h.comboT > 0) { h.comboT -= dt; if (h.comboT <= 0) h.comboN = 0; }
  if (h.aegis && !h.aegisReady) {
    h.aegisT -= dt;
    if (h.aegisT <= 0) h.aegisReady = true;
  }

  // regeneration: paused briefly after a hit (unless devout),
  // silenced by the Shade
  if (h.regenDelay > 0) h.regenDelay -= dt;
  if ((h.regenDelay <= 0 || h.devotion) &&
      h.regen > 0 && !run.blackout && h.hp > 0 && h.hp < h.maxHp) {
    h.hp = Math.min(h.maxHp, h.hp + h.regen * dt);
  }

  // --- movement (or dash) ---
  let moving = false;
  if (h.dash && h.dash.t > 0) {
    h.dash.t -= dt;
    h.x += h.dash.vx * dt;
    h.y += h.dash.vy * dt;
    moving = true;
    if (Math.random() < 0.6) {
      run.particles.push({
        x: h.x, y: h.y, vx: 0, vy: 0, life: 0.25,
        color: CLASSES[h.heir.classId].color, size: 4,
      });
    }
    if (h.dash.t <= 0) h.dash = null;
  } else {
    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup']) dy -= 1;
    if (keys['s'] || keys['arrowdown']) dy += 1;
    if (keys['a'] || keys['arrowleft']) dx -= 1;
    if (keys['d'] || keys['arrowright']) dx += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx /= len; dy /= len;
      h.face = { x: dx, y: dy };
      h.x += dx * heroSpeed() * dt;
      h.y += dy * heroSpeed() * dt;
      moving = true;
    }
  }
  h.bobT += dt * (moving ? 11 : 3);

  pushOutOfPillars(h, h.radius);
  collideFurniture(h, h.radius);

  // --- walls & doors ---
  const r = h.radius;
  const locked = doorsLocked();
  const inGapX = h.x - r >= GX0 && h.x + r <= GX1;
  const inGapY = h.y - r >= GY0 && h.y + r <= GY1;
  const canPass = d => {
    const key = run.room.doors[d];
    if (!key || locked) return false;
    const tgt = roomAt(key);
    return !(tgt.type === 'secret' && !tgt.discovered);
  };

  if (h.y - r < IY0) {
    if (canPass('N') && inGapX) {
      h.x = Math.min(Math.max(h.x, GX0 + r), GX1 - r);
      if (h.y < 34) return tryTransition('N');
    } else { tryRevealSecret('N', inGapX); h.y = IY0 + r; }
  }
  if (h.y + r > IY1) {
    if (canPass('S') && inGapX) {
      h.x = Math.min(Math.max(h.x, GX0 + r), GX1 - r);
      if (h.y > H - 34) return tryTransition('S');
    } else { tryRevealSecret('S', inGapX); h.y = IY1 - r; }
  }
  if (h.x - r < IX0) {
    if (canPass('W') && inGapY) {
      h.y = Math.min(Math.max(h.y, GY0 + r), GY1 - r);
      if (h.x < 34) return tryTransition('W');
    } else { tryRevealSecret('W', inGapY); h.x = IX0 + r; }
  }
  if (h.x + r > IX1) {
    if (canPass('E') && inGapY) {
      h.y = Math.min(Math.max(h.y, GY0 + r), GY1 - r);
      if (h.x > W - 34) return tryTransition('E');
    } else { tryRevealSecret('E', inGapY); h.x = IX1 - r; }
  }

  // --- the central elevator: the same car you arrived in ---
  run.onElevator = (run.room.type === 'surface' || run.room.type === 'start') &&
    Math.hypot(h.x - W / 2, h.y - H / 2) < 60;

  // --- attacking (keyboard swings where you face; the mouse aims) ---
  if ((keys[' '] || keys['j'] || mouse.down) && h.attackTimer <= 0) {
    h.attackTimer = h.cd;
    const angle = mouse.active
      ? Math.atan2(mouse.y - h.y, mouse.x - h.x)
      : Math.atan2(h.face.y, h.face.x);
    if (h.attack === 'melee') {
      h.swing = { t: 0, dur: 0.16, angle, hit: new Set() };
    } else {
      fireProjectile(angle, 1);
    }
    SFX.swing();
  }

  // --- special ability ---
  if (keys['shift'] || keys['k']) useSpecial();

  // --- resolve melee swing ---
  if (h.swing) {
    h.swing.t += dt;
    const range = h.radius + 38;
    for (const e of [...run.enemies]) {
      if (h.swing.hit.has(e) || e.spawnT > 0) continue;
      const dist = Math.hypot(e.x - h.x, e.y - h.y);
      if (dist > range + e.r) continue;
      let diff = Math.atan2(e.y - h.y, e.x - h.x) - h.swing.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 1.15) continue;

      h.swing.hit.add(e);
      if (h.beekeeper && Math.random() < 0.25) {
        spawnMinionOf(h.x, h.y, 'bee'); // the hive takes an interest
      }
      const isCrit = rollCrit(e);
      const kb = 200 / (e.type === 'boss' ? 6 : 1);
      e.kx += (e.x - h.x) / (dist || 1) * kb;
      e.ky += (e.y - h.y) / (dist || 1) * kb;
      if (h.combo) { h.comboN = Math.min(5, h.comboN + 1); h.comboT = 1.5; }
      damageEnemy(e, heroDmg() * (isCrit ? 2 : 1), isCrit);
    }
    if (h.swing.t >= h.swing.dur) h.swing = null;
  }

}

function updateEnemies(dt) {
  const h = run.hero;
  for (const e of [...run.enemies]) {
    e.t += dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.spawnT > 0) { e.spawnT -= dt; continue; } // still materializing

    e.x += e.kx * dt; e.y += e.ky * dt;
    e.kx *= 0.85; e.ky *= 0.85;

    const tgt = pickTarget(e);
    const distX = tgt.x - e.x, distY = tgt.y - e.y;
    const dist = Math.hypot(distX, distY) || 1;
    const nx = distX / dist, ny = distY / dist;

    if (e.type === 'slime') {
      if (dist < 260) {
        e.x += nx * e.speed * dt;
        e.y += ny * e.speed * dt;
      } else {
        if (Math.random() < dt * 0.8) e.wanderAngle = Math.random() * Math.PI * 2;
        e.x += Math.cos(e.wanderAngle) * e.speed * 0.5 * dt;
        e.y += Math.sin(e.wanderAngle) * e.speed * 0.5 * dt;
      }
    } else if (e.type === 'bat') {
      const px = -ny, py = nx;
      const wave = Math.sin(e.t * 7) * 90;
      e.x += (nx * e.speed + px * wave) * dt;
      e.y += (ny * e.speed + py * wave) * dt;
    } else if (e.type === 'skeleton') {
      if (dist < 190) { e.x -= nx * e.speed * dt; e.y -= ny * e.speed * dt; }
      else if (dist > 330) { e.x += nx * e.speed * dt; e.y += ny * e.speed * dt; }
      else { const px = -ny, py = nx; e.x += px * Math.sin(e.t * 1.5) * 60 * dt; e.y += py * Math.sin(e.t * 1.5) * 60 * dt; }
      e.shootTimer -= dt;
      if (e.shootTimer <= 0) {
        e.shootTimer = 1.8;
        run.projectiles.push({
          x: e.x, y: e.y, vx: nx * 240, vy: ny * 240,
          r: 6, dmg: e.dmg, friendly: false, kind: 'bone',
          rot: 0, color: '#e8e2d0',
        });
      }
    } else if (e.type === 'rat') {
      // fast, twitchy, straight at you with a zigzag
      const px = -ny, py = nx;
      e.x += (nx * e.speed + px * Math.sin(e.t * 11) * 70) * dt;
      e.y += (ny * e.speed + py * Math.sin(e.t * 11) * 70) * dt;
    } else if (e.type === 'golem') {
      // slow stone; hits like a rockslide, barely notices knockback
      e.kx *= 0.5; e.ky *= 0.5;
      e.x += nx * e.speed * dt;
      e.y += ny * e.speed * dt;
    } else if (e.type === 'sparker') {
      // skitters close, then vents a ring of short-lived sparks
      if (dist > 120) { e.x += nx * e.speed * dt; e.y += ny * e.speed * dt; }
      e.shootTimer -= dt;
      if (e.shootTimer <= 0 && dist < 240) {
        e.shootTimer = 2.8;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + e.t;
          run.projectiles.push({
            x: e.x, y: e.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
            r: 4, dmg: e.dmg, friendly: false, kind: 'bolt', color: '#ffd75e',
            travel: 0, maxTravel: 150,
          });
        }
        SFX.turret();
      }
    } else if (e.type === 'frostling') {
      // holds mid-range and throws shards that chill the blood
      if (dist < 160) { e.x -= nx * e.speed * dt; e.y -= ny * e.speed * dt; }
      else if (dist > 300) { e.x += nx * e.speed * dt; e.y += ny * e.speed * dt; }
      e.shootTimer -= dt;
      if (e.shootTimer <= 0) {
        e.shootTimer = 2.2;
        run.projectiles.push({
          x: e.x, y: e.y, vx: nx * 250, vy: ny * 250,
          r: 6, dmg: e.dmg, friendly: false, kind: 'bolt', color: '#9adcff',
          chill: true,
        });
      }
    } else if (e.type === 'imp') {
      // hops through space and lobs fire from the new spot
      e.shootTimer -= dt;
      if (e.shootTimer <= 0) {
        e.shootTimer = 2.0;
        burstParticles(e.x, e.y, e.color, 8);
        const a = Math.random() * Math.PI * 2;
        e.x = Math.min(Math.max(tgt.x + Math.cos(a) * 160, IX0 + e.r), IX1 - e.r);
        e.y = Math.min(Math.max(tgt.y + Math.sin(a) * 160, IY0 + e.r), IY1 - e.r);
        burstParticles(e.x, e.y, e.color, 8);
        const d2 = Math.hypot(tgt.x - e.x, tgt.y - e.y) || 1;
        run.projectiles.push({
          x: e.x, y: e.y,
          vx: (tgt.x - e.x) / d2 * 330, vy: (tgt.y - e.y) / d2 * 330,
          r: 5, dmg: e.dmg, friendly: false, kind: 'bolt', color: '#ff8a5e',
        });
      } else {
        e.x += nx * e.speed * 0.5 * dt;
        e.y += ny * e.speed * 0.5 * dt;
      }
    } else if (e.type === 'guardian') {
      updateGuardian(e, dt, nx, ny, dist, tgt);
    } else if (e.type === 'ancestor') {
      // drifts after you with a familiar gait
      const px = -ny, py = nx;
      const wave = Math.sin(e.t * 5) * 40;
      e.x += (nx * e.speed + px * wave) * dt;
      e.y += (ny * e.speed + py * wave) * dt;
    } else if (e.type === 'mimic') {
      // hops at you in hungry bursts
      e.shootTimer -= dt;
      if (e.shootTimer <= 0) {
        e.shootTimer = 0.9;
        e.kx += nx * 380;
        e.ky += ny * 380;
      }
    } else if (e.type === 'turret') {
      // Bolted down. Tracks you and fires a three-bolt fan.
      e.kx = 0; e.ky = 0;
      e.aim = Math.atan2(distY, distX);
      e.shootTimer -= dt;
      if (e.shootTimer <= 0) {
        e.shootTimer = 2.3;
        for (const spread of [-0.22, 0, 0.22]) {
          const a = e.aim + spread;
          run.projectiles.push({
            x: e.x + Math.cos(a) * (e.r + 6), y: e.y + Math.sin(a) * (e.r + 6),
            vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
            r: 5, dmg: e.dmg, friendly: false, kind: 'bolt', color: '#ff8866',
          });
        }
        SFX.turret();
      }
    } else if (e.type === 'boss') {
      updateBoss(e, dt, nx, ny, dist);
    }

    e.x = Math.min(Math.max(e.x, IX0 + e.r), IX1 - e.r);
    e.y = Math.min(Math.max(e.y, IY0 + e.r), IY1 - e.r);
    if (e.type !== 'bat') { // bats fly over the clutter
      pushOutOfPillars(e, e.r);
      if (e.type !== 'boss') collideFurniture(e, e.r);
    }

    if (e.dmg > 0) {
      const hd = Math.hypot(h.x - e.x, h.y - e.y);
      if (hd < e.r + h.radius) {
        hurtPlayer(e.dmg, e.type === 'boss' ? 'Cursed Greg' : 'a ' + e.type);
      }
      if (tgt !== h && dist < e.r + tgt.r) {
        damageAlly(tgt, e.dmg);
      }
    }
  }
}

// Keymaster brains: one body, six temperaments.
function updateGuardian(e, dt, nx, ny, dist, tgt) {
  const style = e.variant || 'warden';
  e.shootTimer -= dt;

  if (style === 'warden') {
    // slow stalk, heavy lunge, occasional bone fan
    e.x += nx * e.speed * dt;
    e.y += ny * e.speed * dt;
    if (e.shootTimer <= 0) {
      if (Math.random() < 0.5) {
        e.kx += nx * 420;
        e.ky += ny * 420;
      } else {
        for (const spread of [-0.4, -0.13, 0.13, 0.4]) {
          const a = Math.atan2(ny, nx) + spread;
          run.projectiles.push({
            x: e.x, y: e.y, vx: Math.cos(a) * 230, vy: Math.sin(a) * 230,
            r: 6, dmg: Math.round(e.dmg * 0.7), friendly: false,
            kind: 'bone', rot: 0, color: '#e8e2d0',
          });
        }
      }
      e.shootTimer = 2.2;
    }
  } else if (style === 'butcher') {
    // shivering telegraph, then a terrible charge
    if (e.telegraphT > 0) {
      e.telegraphT -= dt;
      e.x += (Math.random() - 0.5) * 4;
      if (e.telegraphT <= 0) {
        e.kx += nx * 720;
        e.ky += ny * 720;
        run.shake = Math.max(run.shake, 4);
      }
    } else {
      e.x += nx * e.speed * dt;
      e.y += ny * e.speed * dt;
      if (e.shootTimer <= 0) {
        e.telegraphT = 0.5;
        e.shootTimer = 2.4;
      }
    }
  } else if (style === 'plague') {
    // keeps its distance, lobs filth, breeds slimes
    if (dist < 220) { e.x -= nx * e.speed * dt; e.y -= ny * e.speed * dt; }
    else if (dist > 360) { e.x += nx * e.speed * dt; e.y += ny * e.speed * dt; }
    if (e.shootTimer <= 0) {
      e.shootTimer = 2.0;
      run.projectiles.push({
        x: e.x, y: e.y,
        vx: nx * 260, vy: ny * 260,
        r: 8, dmg: e.dmg, friendly: false,
        kind: 'gob', color: '#8aa84a',
        travel: 0, maxTravel: Math.max(120, dist - 10),
      });
      if (Math.random() < 0.3 && run.enemies.length < 5) spawnEnemy('slime');
    }
  } else if (style === 'bell') {
    // trudges forward and rings out rings of bone
    e.x += nx * e.speed * dt;
    e.y += ny * e.speed * dt;
    if (e.shootTimer <= 0) {
      e.shootTimer = 3.2;
      run.shake = Math.max(run.shake, 6);
      SFX.clank();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        run.projectiles.push({
          x: e.x, y: e.y, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190,
          r: 6, dmg: Math.round(e.dmg * 0.6), friendly: false,
          kind: 'bone', rot: 0, color: '#e8e2d0',
        });
      }
    }
  } else if (style === 'puppet') {
    // blinks away from company; sends friends instead
    if (dist < 180) {
      const bx = IX0 + 60 + Math.random() * (IX1 - IX0 - 120);
      const by = IY0 + 60 + Math.random() * (IY1 - IY0 - 120);
      burstParticles(e.x, e.y, e.color, 10);
      e.x = bx; e.y = by;
      burstParticles(e.x, e.y, e.color, 10);
      SFX.dash();
    } else {
      e.x += nx * e.speed * 0.5 * dt;
      e.y += ny * e.speed * 0.5 * dt;
    }
    if (e.shootTimer <= 0) {
      e.shootTimer = 3.6;
      if (run.enemies.length < 6) {
        spawnEnemy('bat');
        spawnEnemy('bat');
        addText(e.x, e.y - e.r - 20, 'Dance.', '#8a6ae8');
      }
    }
  } else if (style === 'watcher') {
    // hovers at range and sends eyes that follow
    if (dist < 260) { e.x -= nx * e.speed * dt; e.y -= ny * e.speed * dt; }
    else { e.x += nx * e.speed * 0.5 * dt; e.y += ny * e.speed * 0.5 * dt; }
    if (e.shootTimer <= 0) {
      e.shootTimer = 2.6;
      for (const off of [-0.5, 0.5]) {
        const a = Math.atan2(ny, nx) + off;
        run.projectiles.push({
          x: e.x, y: e.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240,
          r: 6, dmg: e.dmg, friendly: false,
          kind: 'bolt', color: '#7de8ff', ehoming: true, travel: 0,
        });
      }
    }
  }
}

// The final boss: Cursed Greg, the Founder. Alternates between
// charging at you and spraying rings of bones. Gets angry below 40% HP.
function updateBoss(e, dt, nx, ny, dist) {
  const ai = e.ai;
  const enraged = e.hp < e.maxHp * 0.4;
  const speedUp = enraged ? 1.4 : 1;
  ai.t -= dt;

  // every so often, a fallen descendant rises to serve the Founder
  e.summonT = (e.summonT === undefined ? 4 : e.summonT) - dt;
  if (e.summonT <= 0 && run.fallenQueue && run.fallenQueue.length > 0 &&
      run.enemies.filter(x => x.type === 'ancestor').length < 3) {
    e.summonT = 8;
    spawnAncestor(run.fallenQueue.pop(), e.x, e.y);
  }

  if (ai.mode === 'idle') {
    e.x += nx * e.speed * 0.6 * speedUp * dt;
    e.y += ny * e.speed * 0.6 * speedUp * dt;
    if (ai.t <= 0) {
      const adds = run.enemies.filter(x => x !== e && x.type !== 'ancestor').length;
      const roll = Math.random();
      if (roll < 0.4) { ai.mode = 'telegraph'; ai.t = 0.55; }
      else if (roll < 0.7 || adds >= 4) { ai.mode = 'spray'; ai.t = 1.4; ai.waves = 0; }
      else if (roll < 0.85) { ai.mode = 'raise'; ai.t = 0.9; }
      else { ai.mode = 'swarm'; ai.t = 0.9; }
    }
  } else if (ai.mode === 'raise') {
    // a trick learned from the necromancers he keeps
    e.x += (Math.random() - 0.5) * 3;
    if (ai.t <= 0) {
      const n = enraged ? 3 : 2;
      for (let i = 0; i < n; i++) {
        spawnEnemy('skeleton');
        const sk = run.enemies[run.enemies.length - 1];
        sk.x = Math.min(Math.max(e.x + (Math.random() - 0.5) * 180, IX0 + 40), IX1 - 40);
        sk.y = Math.min(Math.max(e.y + (Math.random() - 0.5) * 140, IY0 + 40), IY1 - 40);
        sk.spawnT = 0.5;
      }
      run.rings.push({ x: e.x, y: e.y, r: 24, vr: 260, life: 0.4, maxLife: 0.4, color: '#8a6ae8' });
      addText(e.x, e.y - e.r - 26, 'RISE.', '#8a6ae8');
      SFX.curse();
      ai.mode = 'idle';
      ai.t = enraged ? 0.8 : 1.4;
    }
  } else if (ai.mode === 'swarm') {
    // and one from the belfry
    e.x += (Math.random() - 0.5) * 3;
    if (ai.t <= 0) {
      for (let i = 0; i < 3; i++) {
        spawnEnemy('bat');
        const b = run.enemies[run.enemies.length - 1];
        b.x = e.x; b.y = e.y;
        b.spawnT = 0.3;
      }
      run.rings.push({ x: e.x, y: e.y, r: 20, vr: 220, life: 0.35, maxLife: 0.35, color: '#b98ae8' });
      SFX.curse();
      ai.mode = 'idle';
      ai.t = enraged ? 0.8 : 1.4;
    }
  } else if (ai.mode === 'telegraph') {
    e.x += (Math.random() - 0.5) * 5;
    e.y += (Math.random() - 0.5) * 5;
    if (ai.t <= 0) {
      ai.mode = 'charge';
      ai.t = 0.55;
      ai.vx = nx * 540 * speedUp;
      ai.vy = ny * 540 * speedUp;
    }
  } else if (ai.mode === 'charge') {
    e.x += ai.vx * dt;
    e.y += ai.vy * dt;
    if (ai.t <= 0) { ai.mode = 'idle'; ai.t = enraged ? 0.7 : 1.2; }
  } else if (ai.mode === 'spray') {
    if (ai.t <= 1.4 - ai.waves * 0.45 - 0.01) {
      ai.waves++;
      const n = 12;
      const offset = Math.random() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = offset + (i / n) * Math.PI * 2;
        run.projectiles.push({
          x: e.x, y: e.y,
          vx: Math.cos(a) * 200, vy: Math.sin(a) * 200,
          r: 6, dmg: Math.round(e.dmg * 0.6), friendly: false,
          kind: 'bone', rot: 0, color: '#e8e2d0',
        });
      }
    }
    if (ai.waves >= 3 || ai.t <= 0) { ai.mode = 'idle'; ai.t = enraged ? 0.7 : 1.3; }
  }
}

// The Plaguebringer's filth bursts where it lands.
function explodeGob(p) {
  const h = run.hero;
  run.rings.push({ x: p.x, y: p.y, r: 12, vr: 240, life: 0.3, maxLife: 0.3, color: '#8aa84a' });
  burstParticles(p.x, p.y, '#8aa84a', 12);
  if (Math.hypot(h.x - p.x, h.y - p.y) < 62) {
    hurtPlayer(p.dmg, 'a burst of filth');
  }
  for (const a of run.party.concat(run.minions)) {
    if (!a.dead && Math.hypot(a.x - p.x, a.y - p.y) < 62) damageAlly(a, p.dmg);
  }
}

function updateProjectiles(dt) {
  const h = run.hero;
  run.projectiles = run.projectiles.filter(p => {
    // the Watcher's eyes curve after the hero (and eventually tire)
    if (p.ehoming) {
      if ((p.travel || 0) > 900) return false;
      const speed = Math.hypot(p.vx, p.vy);
      const cur = Math.atan2(p.vy, p.vx);
      const want = Math.atan2(h.y - p.y, h.x - p.x);
      let diff = want - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
      p.vx = Math.cos(cur + turn) * speed;
      p.vy = Math.sin(cur + turn) * speed;
    }
    // lich soul bolts curve toward the nearest enemy
    if (p.homing) {
      let target = null, bestD = Infinity;
      for (const e of run.enemies) {
        if (e.spawnT > 0) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bestD) { bestD = d; target = e; }
      }
      if (target) {
        const speed = Math.hypot(p.vx, p.vy);
        const cur = Math.atan2(p.vy, p.vx);
        const want = Math.atan2(target.y - p.y, target.x - p.x);
        let diff = want - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = Math.max(-3.5 * dt, Math.min(3.5 * dt, diff));
        p.vx = Math.cos(cur + turn) * speed;
        p.vy = Math.sin(cur + turn) * speed;
      }
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.travel = (p.travel || 0) + Math.hypot(p.vx, p.vy) * dt;
    if (p.kind === 'bone') p.rot = (p.rot || 0) + 9 * dt;

    // flasks and gobs burst at the end of their arc
    if (p.kind === 'flask' && p.travel >= p.maxTravel) {
      explodeFlask(p);
      return false;
    }
    if (p.kind === 'gob' && p.travel >= p.maxTravel) {
      explodeGob(p);
      return false;
    }
    if (p.maxTravel && p.kind === 'bolt' && p.travel >= p.maxTravel) {
      return false; // sparks fizzle out
    }
    if (p.x < IX0 || p.x > IX1 || p.y < IY0 || p.y > IY1) {
      if (p.kind === 'flask') explodeFlask(p);
      if (p.kind === 'gob') explodeGob(p);
      return false;
    }
    for (const pil of run.room.pillars) {
      if (Math.hypot(pil.x - p.x, pil.y - p.y) < pil.r) {
        if (p.kind === 'flask') explodeFlask(p);
        return false; // shatters
      }
    }
    for (const f of run.room.furniture) {
      if (Math.abs(p.x - f.x) < f.w / 2 + 3 && Math.abs(p.y - f.y) < f.h / 2 + 3) {
        if (p.kind === 'flask') explodeFlask(p);
        return false; // thunks into the furniture
      }
    }

    if (p.friendly) {
      for (const e of [...run.enemies]) {
        if (e.spawnT > 0) continue;
        if (p.hitSet && p.hitSet.has(e)) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r) {
          if (p.kind === 'flask') {
            explodeFlask(p);
            return false;
          }
          let dmg = p.dmg;
          // ranger's deadeye: damage grows with distance flown
          if (p.deadeye) dmg *= 1 + Math.min(0.6, (p.travel || 0) / 700);
          damageEnemy(e, dmg, p.isCrit);
          if (p.pierce > 0) {
            p.pierce--;
            p.hitSet.add(e);
            continue; // punches through
          }
          return false;
        }
      }
    } else {
      // Shield Wall catches incoming projectiles before they land
      if (h.blockT > 0 && Math.hypot(h.x - p.x, h.y - p.y) < h.radius + p.r + 26) {
        burstParticles(p.x, p.y, '#8fb4ff', 6);
        SFX.hit();
        return false;
      }
      if (Math.hypot(h.x - p.x, h.y - p.y) < h.radius + p.r) {
        if (p.kind === 'gob') { explodeGob(p); return false; }
        hurtPlayer(p.dmg, p.kind === 'bone' ? 'a flying bone'
          : p.chill ? 'a frost shard'
          : p.ehoming ? 'a following eye' : 'a turret bolt');
        if (p.chill && h.hp > 0) {
          h.chillT = 2;
          addText(h.x, h.y - 38, 'Chilled!', '#9adcff');
        }
        return false;
      }
      for (const a of run.party.concat(run.minions)) {
        if (!a.dead && Math.hypot(a.x - p.x, a.y - p.y) < a.r + p.r) {
          damageAlly(a, p.dmg);
          return false;
        }
      }
    }
    return true;
  });
}

function updateLoot(dt) {
  const h = run.hero;
  const loot = run.room.loot;

  for (const chest of run.room.chests) {
    if (chest.spawnT > 0) chest.spawnT -= dt;
    if (chest.openT > 0 && chest.openT < 0.3) chest.openT += dt;
  }

  loot.coins = loot.coins.filter(c => {
    c.t += dt;
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.vx *= 0.9; c.vy *= 0.9;
    const dist = Math.hypot(h.x - c.x, h.y - c.y);
    if (dist < 110) {
      c.vx += (h.x - c.x) / dist * 900 * dt;
      c.vy += (h.y - c.y) / dist * 900 * dt;
    }
    if (dist < h.radius + 10) {
      run.gold += Math.round(c.val * h.goldMult);
      if (c.gem) SFX.gem(); else SFX.coin();
      return false;
    }
    return true;
  });

  loot.hearts = loot.hearts.filter(ht => {
    if (Math.hypot(h.x - ht.x, h.y - ht.y) < h.radius + 14) {
      h.hp = Math.min(h.maxHp, h.hp + ht.heal);
      addText(h.x, h.y - 24, '+' + ht.heal, '#7dff8a');
      SFX.heart();
      return false;
    }
    return true;
  });

  loot.items = loot.items.filter(it => {
    it.t += dt;
    if (Math.hypot(h.x - it.x, h.y - it.y) < h.radius + 16) {
      return !gainItem(it.id, it.x, it.y - 24); // stays if hands are full
    }
    return true;
  });

  loot.cells = loot.cells.filter(c => {
    c.t += dt;
    if (Math.hypot(h.x - c.x, h.y - c.y) < h.radius + 14) {
      addPower(30, c.x, c.y - 24);
      SFX.gem();
      return false;
    }
    return true;
  });

  loot.mats = loot.mats.filter(m => {
    m.t += dt;
    if (Math.hypot(h.x - m.x, h.y - m.y) < h.radius + 14) {
      run.materials[m.id]++;
      addText(m.x, m.y - 20, '+1 ' + MATERIALS[m.id].name, MATERIALS[m.id].color);
      SFX.select();
      return false;
    }
    return true;
  });

  // equipment auto-equips into an empty slot; a full slot needs E to swap
  loot.equip = loot.equip.filter(q => {
    q.t += dt;
    if (Math.hypot(h.x - q.x, h.y - q.y) < h.radius + 16 && !h[q.def.slot]) {
      equipItem(q.def);
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------

// Deterministic pseudo-random per tile, so each room's floor
// decoration is stable frame to frame.
function hash2(a, b) {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = ((x ^ (x >>> 13)) * 1274126177) | 0;
  return (((x ^ (x >>> 16)) >>> 0) % 1000) / 1000;
}

function drawShadow(x, y, r) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.85, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHeartShape(x, y, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x - size * 0.45, y - size * 0.25, size * 0.5, 0, Math.PI * 2);
  ctx.arc(x + size * 0.45, y - size * 0.25, size * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - size * 0.92, y - size * 0.05);
  ctx.lineTo(x + size * 0.92, y - size * 0.05);
  ctx.lineTo(x, y + size * 0.85);
  ctx.closePath();
  ctx.fill();
}

function drawPadlock(x, y, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y - size * 0.3, size * 0.45, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(x - size * 0.6, y - size * 0.3, size * 1.2, size * 0.9);
}

// The character model: a little adventurer with a head, torso,
// arms, and legs that scissor as they walk. Every hero, heir card,
// party ghost, and ancestor renders through this one function.
function drawHeroSprite(x, y, radius, classId, faceAngle, walkPhase) {
  const c = CLASSES[classId] || CLASSES.knight;
  const sSc = radius / 15;           // everything scales off a 15px hero
  const step = Math.sin(walkPhase || 0) * 3 * sSc;
  const headY = y - 7 * sSc;
  const headR = 6.5 * sSc;

  // legs, scissoring
  ctx.fillStyle = '#2b2b38';
  ctx.fillRect(x - 5 * sSc, y + 6 * sSc + Math.max(0, step), 4 * sSc, 6 * sSc);
  ctx.fillRect(x + 1 * sSc, y + 6 * sSc + Math.max(0, -step), 4 * sSc, 6 * sSc);

  // torso in class colors
  ctx.fillStyle = c.color;
  ctx.beginPath();
  ctx.moveTo(x - 7 * sSc, y - 3 * sSc);
  ctx.lineTo(x + 7 * sSc, y - 3 * sSc);
  ctx.lineTo(x + 6 * sSc, y + 8 * sSc);
  ctx.lineTo(x - 6 * sSc, y + 8 * sSc);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2 * sSc;
  ctx.stroke();
  // belt
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x - 6 * sSc, y + 4 * sSc, 12 * sSc, 2.5 * sSc);

  // arms, swinging opposite the legs
  ctx.fillStyle = c.color;
  ctx.beginPath();
  ctx.arc(x - 8 * sSc, y + 1 * sSc - step * 0.4, 2.6 * sSc, 0, Math.PI * 2);
  ctx.arc(x + 8 * sSc, y + 1 * sSc + step * 0.4, 2.6 * sSc, 0, Math.PI * 2);
  ctx.fill();

  // head
  ctx.fillStyle = '#e8cfae';
  ctx.beginPath();
  ctx.arc(x, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5 * sSc;
  ctx.stroke();

  // eyes look where you're aiming
  const ex = Math.cos(faceAngle) * headR * 0.4;
  const ey = Math.sin(faceAngle) * headR * 0.35;
  ctx.fillStyle = '#2b2233';
  ctx.beginPath();
  ctx.arc(x - 2.2 * sSc + ex, headY - 0.5 * sSc + ey, 1.3 * sSc, 0, Math.PI * 2);
  ctx.arc(x + 2.2 * sSc + ex, headY - 0.5 * sSc + ey, 1.3 * sSc, 0, Math.PI * 2);
  ctx.fill();

  // class headgear, worn on the head where it belongs
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(2, headR * 0.3);
  if (classId === 'knight') {
    ctx.fillStyle = '#9aa4b8';
    ctx.beginPath();
    ctx.arc(x, headY - headR * 0.15, headR * 1.05, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x - headR * 1.05, headY - headR * 0.2, headR * 2.1, headR * 0.35);
  } else if (classId === 'barbarian') {
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath();
    ctx.moveTo(x - headR * 0.7, headY - headR * 0.4);
    ctx.lineTo(x - headR * 1.5, headY - headR * 1.3);
    ctx.lineTo(x - headR * 0.3, headY - headR * 0.9);
    ctx.closePath();
    ctx.moveTo(x + headR * 0.7, headY - headR * 0.4);
    ctx.lineTo(x + headR * 1.5, headY - headR * 1.3);
    ctx.lineTo(x + headR * 0.3, headY - headR * 0.9);
    ctx.closePath();
    ctx.fill();
  } else if (classId === 'rogue' || classId === 'shinobi') {
    ctx.fillStyle = classId === 'shinobi' ? '#26424d' : '#2e4030';
    ctx.beginPath();
    ctx.arc(x, headY, headR * 1.08, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
  } else if (classId === 'mage' || classId === 'lich') {
    ctx.fillStyle = classId === 'lich' ? '#3d5240' : '#4a3a66';
    ctx.beginPath();
    ctx.moveTo(x - headR * 1.4, headY - headR * 0.35);
    ctx.lineTo(x + headR * 1.4, headY - headR * 0.35);
    ctx.lineTo(x + headR * 0.15, headY - headR * 2.3);
    ctx.closePath();
    ctx.fill();
  } else if (classId === 'ranger') {
    ctx.fillStyle = '#3d5230';
    ctx.beginPath();
    ctx.arc(x, headY - headR * 0.2, headR * 1.02, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath();
    ctx.moveTo(x + headR * 0.5, headY - headR * 0.9);
    ctx.lineTo(x + headR * 1.6, headY - headR * 1.8);
    ctx.lineTo(x + headR * 0.9, headY - headR * 0.6);
    ctx.closePath();
    ctx.fill();
  } else if (classId === 'paladin') {
    ctx.fillStyle = '#9aa4b8';
    ctx.beginPath();
    ctx.arc(x, headY - headR * 0.15, headR * 1.05, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#ff5a6e';
    ctx.fillRect(x - headR * 0.18, headY - headR * 2, headR * 0.36, headR * 1.1);
  } else if (classId === 'alchemist') {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - headR, headY - headR * 0.45, headR * 2, headR * 0.3);
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(x - headR * 0.45, headY - headR * 0.3, headR * 0.32, 0, Math.PI * 2);
    ctx.arc(x + headR * 0.45, headY - headR * 0.3, headR * 0.32, 0, Math.PI * 2);
    ctx.fill();
  } else if (classId === 'necromancer') {
    ctx.fillStyle = '#2e2440';
    ctx.beginPath();
    ctx.arc(x, headY, headR * 1.12, Math.PI * 0.85, Math.PI * 2.15);
    ctx.fill();
    ctx.fillStyle = '#c9ffb0';
    ctx.fillRect(x - headR * 0.5, headY - headR * 0.3, headR * 0.32, headR * 0.26);
    ctx.fillRect(x + headR * 0.2, headY - headR * 0.3, headR * 0.32, headR * 0.26);
  } else if (classId === 'beastmaster') {
    // a fur hood with ears
    ctx.fillStyle = '#8a5c30';
    ctx.beginPath();
    ctx.arc(x, headY, headR * 1.08, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - headR * 0.7, headY - headR * 0.6);
    ctx.lineTo(x - headR * 0.9, headY - headR * 1.5);
    ctx.lineTo(x - headR * 0.2, headY - headR * 0.95);
    ctx.closePath();
    ctx.moveTo(x + headR * 0.7, headY - headR * 0.6);
    ctx.lineTo(x + headR * 0.9, headY - headR * 1.5);
    ctx.lineTo(x + headR * 0.2, headY - headR * 0.95);
    ctx.closePath();
    ctx.fill();
  } else if (classId === 'tinkerer') {
    // a cap with a little cog
    ctx.fillStyle = '#3d4452';
    ctx.beginPath();
    ctx.arc(x, headY - headR * 0.2, headR * 1.02, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#7de8ff';
    ctx.lineWidth = headR * 0.22;
    ctx.beginPath();
    ctx.arc(x + headR * 0.6, headY - headR * 1.05, headR * 0.34, 0, Math.PI * 2);
    ctx.stroke();
  } else if (classId === 'beekeeper') {
    // the wide-brimmed veil hat
    ctx.fillStyle = '#c9b05a';
    ctx.fillRect(x - headR * 1.5, headY - headR * 0.55, headR * 3, headR * 0.32);
    ctx.beginPath();
    ctx.arc(x, headY - headR * 0.6, headR * 0.75, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(220, 220, 240, 0.25)'; // the veil
    ctx.fillRect(x - headR * 0.9, headY - headR * 0.45, headR * 1.8, headR * 1.2);
  } else if (classId === 'revenant') {
    // a broken circlet and eyes that glow the wrong color
    ctx.strokeStyle = '#ff5a5e';
    ctx.lineWidth = headR * 0.28;
    ctx.beginPath();
    ctx.arc(x, headY - headR * 0.2, headR * 0.95, Math.PI * 1.1, Math.PI * 1.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, headY - headR * 0.2, headR * 0.95, Math.PI * 1.75, Math.PI * 1.95);
    ctx.stroke();
    ctx.fillStyle = '#ff5a5e';
    ctx.fillRect(x - 3.2 * sSc + ex, headY - 1 * sSc + ey, 2 * sSc, 2 * sSc);
    ctx.fillRect(x + 1.2 * sSc + ex, headY - 1 * sSc + ey, 2 * sSc, 2 * sSc);
  }
}

// ---------------------------------------------------------
// Drawing — the world
// ---------------------------------------------------------
let vignetteCache = null;
function getVignette() {
  if (vignetteCache) return vignetteCache;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const vctx = c.getContext('2d');
  const g = vctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  vctx.fillStyle = g;
  vctx.fillRect(0, 0, W, H);
  vignetteCache = c;
  return c;
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (state === 'title') return drawTitle();
  if (state === 'minigames') return drawMinigamesMenu();
  if (state === 'name') return drawNameEntry();
  if (state === 'estate') return drawEstate();
  if (state === 'heirs') return drawHeirs();
  if (state === 'descend') return drawDescend();

  // world states: play / gameover / victory
  const h = run.hero;
  ctx.save();
  if (run.shake > 0) {
    ctx.translate((Math.random() - 0.5) * run.shake, (Math.random() - 0.5) * run.shake);
  }

  drawRoom();
  drawZones();
  if (run.minigame) drawMinigameWorld();
  drawChests();
  drawLoot();
  run.enemies.forEach(drawEnemy);
  run.minions.forEach(drawMinion);
  run.party.forEach(drawPartyMember);
  if (run.room.ghostHeir) drawGhostHeir(run.room);
  if (state !== 'gameover') drawHero();
  if (run.shade) drawShade();
  drawProjectiles();
  drawTorchGlow();

  run.rings.forEach(ring => {
    ctx.globalAlpha = Math.max(0, ring.life / ring.maxLife) * 0.8;
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  run.particles.forEach(p => {
    ctx.globalAlpha = Math.min(1, p.life * 3);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  });
  ctx.globalAlpha = 1;

  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  run.texts.forEach(t => {
    ctx.globalAlpha = Math.min(1, t.life * 2.5);
    ctx.fillStyle = t.color;
    ctx.fillText(t.txt, t.x, t.y);
  });
  ctx.globalAlpha = 1;

  // Colorblind trait: desaturate the whole world.
  if (h.grayscale) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#808080';
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (h.myopia && state === 'play') drawMyopiaFog();
  if (run.blackout && state === 'play') {
    drawBlackoutFog();
    ctx.globalCompositeOperation = 'lighter';
    drawLanternGlows();
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.drawImage(getVignette(), 0, 0);

  if (run.fade > 0) {
    ctx.globalAlpha = Math.min(1, run.fade / 0.25) * 0.7;
    ctx.fillStyle = '#000';
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // crosshair where the mouse points
  if (state === 'play' && mouse.active && !menu && !paused) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 8, 0, Math.PI * 2);
    ctx.moveTo(mouse.x - 12, mouse.y); ctx.lineTo(mouse.x - 4, mouse.y);
    ctx.moveTo(mouse.x + 4, mouse.y); ctx.lineTo(mouse.x + 12, mouse.y);
    ctx.moveTo(mouse.x, mouse.y - 12); ctx.lineTo(mouse.x, mouse.y - 4);
    ctx.moveTo(mouse.x, mouse.y + 4); ctx.lineTo(mouse.x, mouse.y + 12);
    ctx.stroke();
  }

  drawHUD();
  if (state === 'gameover') drawGameOver();
  if (state === 'victory') drawVictory();
  if (state === 'retired') drawRetired();
  if (state === 'mgover') drawMgOver();
  if (menu && state === 'play') drawMenu();
  if (paused && state === 'play') drawPauseOverlay();
}

function chestEntryName(entry) {
  if (entry.kind === 'gold') return entry.val + ' gold';
  if (entry.kind === 'gem') return 'Gem — worth ' + entry.val + ' gold';
  if (entry.kind === 'heart') return (entry.heal >= 50 ? 'Golden Heart' : 'Heart') + ' — heal ' + entry.heal;
  if (entry.kind === 'cell') return 'Power Cell — +30 lantern power';
  if (entry.kind === 'mat') return MATERIALS[entry.id].name;
  if (entry.kind === 'item') return ITEMS[entry.id].name + ' — ' + ITEMS[entry.id].desc;
  if (entry.kind === 'equip') {
    const d = EQUIPMENT[entry.id];
    return d.name + (d.dmg ? ' — +' + d.dmg + ' damage'
      : d.guard ? ' — ' + Math.round((1 - d.guard) * 100) + '% less damage taken'
      : d.mult ? ' — armor, ' + Math.round((1 - d.mult) * 100) + '% less damage'
      : ' — the lantern burns slower');
  }
  if (entry.kind === 'blessing') return 'A Blessing of the Founder';
  return '???';
}

function drawLootEntryIcon(entry, x, y) {
  if (entry.kind === 'gold') {
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd75e';
    ctx.fill();
    ctx.strokeStyle = '#b8952e';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (entry.kind === 'gem') {
    ctx.fillStyle = '#7de8ff';
    ctx.beginPath();
    ctx.moveTo(x, y - 11);
    ctx.lineTo(x + 9, y - 3);
    ctx.lineTo(x, y + 11);
    ctx.lineTo(x - 9, y - 3);
    ctx.closePath();
    ctx.fill();
  } else if (entry.kind === 'heart') {
    drawHeartShape(x, y, entry.heal >= 50 ? 13 : 11, entry.heal >= 50 ? '#ffd75e' : '#ff5a6e');
  } else if (entry.kind === 'cell') {
    ctx.fillStyle = '#ffd75e';
    ctx.fillRect(x - 6, y - 9, 12, 19);
    ctx.fillRect(x - 3, y - 12, 6, 3);
    ctx.fillStyle = '#8a6a1e';
    ctx.fillRect(x - 2, y - 5, 4, 10);
  } else if (entry.kind === 'mat') {
    drawMaterialIcon(entry.id, x, y);
  } else if (entry.kind === 'item') {
    drawItemIcon(entry.id, x, y);
  } else if (entry.kind === 'equip') {
    drawEquipIcon(EQUIPMENT[entry.id], x, y);
  } else if (entry.kind === 'blessing') {
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.moveTo(x, y - 11);
    ctx.lineTo(x + 8, y);
    ctx.lineTo(x, y + 11);
    ctx.lineTo(x - 8, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff2c9';
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }
}

// ---------------------------------------------------------
// In-run menus: inventory / crafting table / brewing stand
// ---------------------------------------------------------
function drawMenu() {
  const h = run.hero;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, W, H);

  const px = W / 2 - 280, pw = 560;
  ctx.fillStyle = '#1a1a28';
  ctx.fillRect(px, 90, pw, 460);
  ctx.strokeStyle = '#33334a';
  ctx.lineWidth = 2;
  ctx.strokeRect(px, 90, pw, 460);

  ctx.textAlign = 'center';
  ctx.font = 'bold 24px monospace';

  if (menu === 'chest') {
    const c = activeChest;
    ctx.fillStyle = '#ffd75e';
    ctx.fillText('CHEST', W / 2, 130);

    const entries = c && c.contents ? c.contents : [];
    const cols = 6, size = 60, gap = 10;
    const gridW = cols * (size + gap) - gap;
    const gx0 = W / 2 - gridW / 2;
    entries.forEach((entry, i) => {
      const gx = gx0 + (i % cols) * (size + gap);
      const gy = 170 + Math.floor(i / cols) * (size + gap);
      ctx.fillStyle = '#000000aa';
      ctx.fillRect(gx, gy, size, size);
      ctx.strokeStyle = i === menuIndex ? '#ffd75e' : '#33334a';
      ctx.lineWidth = i === menuIndex ? 3 : 2;
      ctx.strokeRect(gx, gy, size, size);
      drawLootEntryIcon(entry, gx + size / 2, gy + size / 2);
      if (entry.kind === 'gold' || entry.kind === 'gem') {
        ctx.textAlign = 'right';
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#ffd75e';
        ctx.fillText(entry.val, gx + size - 5, gy + size - 6);
        ctx.textAlign = 'center';
      }
    });

    const sel = entries[menuIndex];
    ctx.font = 'bold 15px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(sel ? chestEntryName(sel) : 'Empty.', W / 2, 420);

    ctx.font = '13px monospace';
    ctx.fillStyle = '#666680';
    ctx.fillText('arrows — select · ENTER / Q — take · SPACE — take all', W / 2, 490);
    ctx.fillText('E or ESC — close the lid', W / 2, 514);
    return;
  }

  if (menu === 'floors') {
    ctx.fillStyle = '#7de8ff';
    ctx.fillText('THE CENTRAL ELEVATOR', W / 2, 130);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#8888aa';
    ctx.fillText('The old lift remembers every floor an ancestor reached.', W / 2, 160);

    for (let i = 0; i <= save.floorUnlocked && i < FLOORS.length; i++) {
      const y = 200 + i * 90;
      const sel = i === menuIndex;
      ctx.fillStyle = sel ? '#26263a' : '#1f1f2e';
      ctx.fillRect(px + 40, y, pw - 80, 72);
      if (sel) {
        ctx.strokeStyle = '#7de8ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 40, y, pw - 80, 72);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 17px monospace';
      ctx.fillText('Floor ' + (i + 1) + ' — ' + FLOORS[i].name, px + 66, y + 32);
      for (let d = 0; d <= i; d++) {
        ctx.fillStyle = '#ff5a5a';
        const dx = px + 66 + d * 18, dy = y + 52;
        ctx.beginPath();
        ctx.moveTo(dx, dy - 5);
        ctx.lineTo(dx + 5, dy);
        ctx.lineTo(dx, dy + 5);
        ctx.lineTo(dx - 5, dy);
        ctx.closePath();
        ctx.fill();
      }
      ctx.textAlign = 'center';
    }
    ctx.font = '13px monospace';
    ctx.fillStyle = '#666680';
    ctx.fillText('↑↓ choose floor · ENTER ride down · E or ESC — stay up top', W / 2, 514);
    return;
  }

  if (menu === 'inventory') {
    ctx.fillStyle = '#ffffff';
    ctx.fillText('INVENTORY', W / 2, 130);

    // carried items
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#8888aa';
    ctx.fillText('Carried (Q uses the highlighted one)', W / 2, 168);
    const sel = Math.min(h.itemSel, Math.max(0, h.items.length - 1));
    const invSlot = 50, invW = ITEM_CAP * invSlot - 6;
    for (let i = 0; i < ITEM_CAP; i++) {
      const x = W / 2 - invW / 2 + i * invSlot, y = 186;
      ctx.fillStyle = '#000000aa';
      ctx.fillRect(x, y, invSlot - 6, invSlot - 6);
      ctx.strokeStyle = h.items[i] && i === sel ? '#7de8ff' : '#33334a';
      ctx.lineWidth = h.items[i] && i === sel ? 3 : 2;
      ctx.strokeRect(x, y, invSlot - 6, invSlot - 6);
      if (h.items[i]) {
        drawItemIcon(h.items[i].id, x + invSlot / 2 - 3, y + invSlot / 2 - 1);
        if (h.items[i].n > 1) {
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'right';
          ctx.fillText(String(h.items[i].n), x + invSlot - 9, y + invSlot - 10);
        }
      }
      ctx.fillStyle = '#55556a';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(String(i + 1), x + 3, y + 11);
      ctx.textAlign = 'center';
    }
    ctx.font = '13px monospace';
    ctx.fillStyle = '#7de8ff';
    ctx.fillText(h.items.length > 0
      ? ITEMS[h.items[sel].id].name + (h.items[sel].n > 1 ? ' x' + h.items[sel].n : '') +
        ' — ' + ITEMS[h.items[sel].id].desc
      : 'Nothing carried. Chests and brewing fix that.', W / 2, 262);

    // materials
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#8888aa';
    ctx.fillText('Materials', W / 2, 302);
    const matIds = Object.keys(MATERIALS);
    matIds.forEach((id, i) => {
      const x = W / 2 - (matIds.length * 92) / 2 + i * 92 + 46;
      drawMaterialIcon(id, x - 18, 330);
      ctx.textAlign = 'left';
      ctx.font = 'bold 15px monospace';
      ctx.fillStyle = run.materials[id] > 0 ? '#ffffff' : '#555570';
      ctx.fillText('x' + run.materials[id], x - 2, 335);
      ctx.textAlign = 'center';
    });
    ctx.font = '12px monospace';
    ctx.fillStyle = '#666680';
    matIds.forEach((id, i) => {
      const x = W / 2 - (matIds.length * 92) / 2 + i * 92 + 46;
      ctx.fillText(MATERIALS[id].name.split(' ').pop(), x - 8, 356);
    });

    // equipment: weapon, offhand, armor
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#8888aa';
    ctx.fillText('Equipment', W / 2, 392);
    ctx.font = 'bold 13px monospace';
    const eqLines = [
      ['Weapon: ' + (h.weapon ? h.weapon.name + ' (+' + h.weapon.dmg + ' dmg)' : 'bare hands'),
        h.weapon && h.weapon.color],
      ['Offhand: ' + (h.offhand ? h.offhand.name : 'empty'),
        h.offhand && h.offhand.color],
      ['Armor: ' + (h.armor ? h.armor.name + ' (-' + Math.round((1 - h.armor.mult) * 100) + '% dmg)' : 'none'),
        h.armor && h.armor.color],
    ];
    eqLines.forEach((l, i) => {
      ctx.fillStyle = l[1] || '#555570';
      ctx.fillText(l[0], W / 2, 414 + i * 20);
    });

    ctx.font = '13px monospace';
    ctx.fillStyle = '#666680';
    ctx.fillText('TAB / wheel — select · Q — use · the forge & brewery are below', W / 2, 494);
    ctx.fillText('E or ESC — close', W / 2, 516);
  } else {
    const isCraft = menu === 'craft';
    ctx.fillStyle = isCraft ? '#ffd75e' : '#7de8ff';
    ctx.fillText(isCraft ? 'CRAFTING TABLE' : 'BREWING STAND', W / 2, 130);

    // what you're holding, for reference
    const matIds = Object.keys(MATERIALS);
    matIds.forEach((id, i) => {
      const x = W / 2 - (matIds.length * 80) / 2 + i * 80 + 40;
      drawMaterialIcon(id, x - 14, 164);
      ctx.textAlign = 'left';
      ctx.font = 'bold 13px monospace';
      ctx.fillStyle = run.materials[id] > 0 ? '#ffffff' : '#555570';
      ctx.fillText('x' + run.materials[id], x, 169);
      ctx.textAlign = 'center';
    });

    const list = RECIPES[menu];
    list.forEach((r, i) => {
      const y = 196 + i * 31;
      const selRow = i === menuIndex;
      const afford = canAfford(r);

      ctx.fillStyle = selRow ? '#26263a' : '#1f1f2e';
      ctx.fillRect(px + 24, y, pw - 48, 28);
      if (selRow) {
        ctx.strokeStyle = afford ? (isCraft ? '#ffd75e' : '#7de8ff') : '#553344';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 24, y, pw - 48, 28);
      }

      ctx.textAlign = 'left';
      ctx.font = 'bold 13px monospace';
      ctx.fillStyle = afford ? '#ffffff' : '#555570';
      ctx.fillText(r.out, px + 38, y + 19);

      // cost icons, right-aligned (the alchemist sees discounted brews)
      const cost = effCost(r);
      const keys2 = Object.keys(cost);
      let cx2 = px + pw - 60 - (keys2.length - 1) * 58;
      ctx.font = 'bold 12px monospace';
      for (const id of keys2) {
        drawMaterialIcon(id, cx2 - 12, y + 14);
        ctx.fillStyle = run.materials[id] >= cost[id] ? '#7dff8a' : '#ff6666';
        ctx.fillText('x' + cost[id], cx2, y + 18);
        cx2 += 58;
      }
      ctx.textAlign = 'center';
    });

    ctx.font = '13px monospace';
    ctx.fillStyle = '#666680';
    ctx.fillText('↑↓ select · ENTER ' + (isCraft ? 'craft' : 'brew') + ' · E or ESC — close', W / 2, 514);
  }
}

function drawRoom() {
  const room = run.room;
  const base = floorPal();
  // sub-biome rooms reuse the floor's walls but change the ground
  const pal = room.biome === 1 && base.sub
    ? Object.assign({}, base, { floorA: base.sub.floorA, floorB: base.sub.floorB })
    : base;

  // walls with a brick pattern (floor tiles are painted over the middle)
  ctx.fillStyle = pal.wall;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = pal.mortar;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let y = 0; y <= H; y += 20) {
    ctx.moveTo(0, y); ctx.lineTo(W, y);
  }
  for (let y = 0, row = 0; y < H; y += 20, row++) {
    for (let x = (row % 2) * 28; x <= W; x += 56) {
      ctx.moveTo(x, y); ctx.lineTo(x, y + 20);
    }
  }
  ctx.stroke();

  // floor tiles with stable per-tile variation
  for (let ty = 1; ty < H / TILE - 1; ty++) {
    for (let tx = 1; tx < W / TILE - 1; tx++) {
      const v = hash2(room.x * 61 + tx, room.y * 73 + ty);
      ctx.fillStyle = (tx + ty) % 2 === 0 ? pal.floorA : pal.floorB;
      ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      if (v > 0.65) { // subtle shade variation on some tiles
        ctx.fillStyle = v > 0.82 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
      if (v > 0.93) { // a crack
        const cx = tx * TILE + 10 + v * 30, cy = ty * TILE + 12 + v * 20;
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 14, cy + 9);
        ctx.lineTo(cx + 20, cy + 22);
        ctx.stroke();
      } else if (v < 0.05) { // a pebble
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.arc(tx * TILE + 20 + v * 400, ty * TILE + 30, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // faint tile grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = IX0; x <= IX1; x += TILE) { ctx.moveTo(x, IY0); ctx.lineTo(x, IY1); }
  for (let y = IY0; y <= IY1; y += TILE) { ctx.moveTo(IX0, y); ctx.lineTo(IX1, y); }
  ctx.stroke();

  if (room.biome === 1 && base.sub) drawBiomeDecor(room, base.sub.decor);

  if (room.type === 'boss') {
    ctx.fillStyle = 'rgba(120, 20, 20, 0.12)';
    ctx.fillRect(IX0, IY0, IX1 - IX0, IY1 - IY0);
  }

  drawTorches();

  const locked = doorsLocked();
  for (const d in room.doors) {
    const tgt = roomAt(room.doors[d]);
    if (tgt && tgt.type === 'secret' && !tgt.discovered) {
      drawSecretCrack(d); // looks like wall... almost
      continue;
    }
    drawDoor(d, locked, room.unlockT);
  }

  // the one elevator: you arrived on it, you leave on it
  if (room.type === 'start') drawElevatorPlatform(true);
  if (room.type === 'surface') drawSurfaceScene();

  // stone pillars
  for (const p of room.pillars) {
    drawShadow(p.x, p.y + p.r * 0.4, p.r);
    ctx.fillStyle = '#3a3a48';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a4a5e';
    ctx.beginPath();
    ctx.arc(p.x - p.r * 0.15, p.y - p.r * 0.2, p.r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.stroke();
    if (hash2(p.x | 0, p.y | 0) > 0.5) { // some pillars are cracked
      ctx.beginPath();
      ctx.moveTo(p.x - 6, p.y - p.r * 0.6);
      ctx.lineTo(p.x + 2, p.y - 2);
      ctx.lineTo(p.x - 3, p.y + p.r * 0.5);
      ctx.stroke();
    }
  }

  drawFurnitureAll(room);
  if (room.spawner) drawSpawner(room.spawner);

  if (room.type === 'secret') drawSecretFlavor(room);
  if (room.type === 'shop') drawShopRoom(room);
  if (room.type === 'shrine') drawShrineRoom(room);
  if (room.type === 'puzzle') drawPuzzleRoom(room);
  if (room.type === 'arena') drawArenaRoom(room);
  if (room.type === 'spring') drawSpringRoom(room);
  if (room.type === 'prison') drawPrisonRoom(room);
  if (room.type === 'gauntlet') drawGauntletRoom(room);
  if (room.type === 'vault') drawVaultRoom(room);
}

// The gauntlet: a rusted bell and a bad idea.
function drawGauntletRoom(room) {
  const g = room.gauntlet;
  const bx = W / 2, by = IY0 + 90;
  drawShadow(bx, by + 20, 16);
  ctx.fillStyle = '#8a6a3a';
  ctx.fillRect(bx - 3, by - 40, 6, 14);
  ctx.fillStyle = g.state === 'live' ? '#c9a05a' : '#8a7d5a';
  ctx.beginPath();
  ctx.moveTo(bx - 16, by + 8);
  ctx.quadraticCurveTo(bx - 16, by - 26, bx, by - 26);
  ctx.quadraticCurveTo(bx + 16, by - 26, bx + 16, by + 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3a3a48';
  ctx.beginPath();
  ctx.arc(bx + (g.state === 'live' ? Math.sin(animT * 14) * 5 : 0), by + 10, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  if (g.state === 'idle') {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('A bell, and everything that answers it.', W / 2, H / 2 + 120);
    if (Math.hypot(run.hero.x - bx, run.hero.y - by) < 75) {
      ctx.fillStyle = '#ff5a5a';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('E — ring it (twenty seconds)', bx, by + 46);
    }
  } else if (g.state === 'live') {
    ctx.fillStyle = '#000000aa';
    ctx.fillRect(W / 2 - 120, IY0 + 18, 240, 14);
    ctx.fillStyle = g.t > 6 ? '#ff9a3a' : '#ff5544';
    ctx.fillRect(W / 2 - 118, IY0 + 20, 236 * Math.max(0, g.t / 20), 10);
  } else {
    ctx.fillStyle = 'rgba(255, 215, 94, 0.5)';
    ctx.fillText('The bell hangs satisfied.', W / 2, H / 2 + 120);
  }
}

// The vault: spiked threshold, honest riches.
function drawVaultRoom(room) {
  // spikes at every doorway
  ctx.fillStyle = '#565670';
  for (const d in room.doors) {
    if (d === 'N' || d === 'S') {
      const y = d === 'N' ? IY0 + 8 : IY1 - 8;
      for (let i = 0; i < 6; i++) {
        const x = GX0 + 10 + i * 16;
        ctx.beginPath();
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x + 5, y - 6);
        ctx.lineTo(x + 10, y + 6);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      const x = d === 'W' ? IX0 + 8 : IX1 - 8;
      for (let i = 0; i < 6; i++) {
        const y = GY0 + 10 + i * 16;
        ctx.beginPath();
        ctx.moveTo(x - 6, y);
        ctx.lineTo(x + 6, y + 5);
        ctx.lineTo(x - 6, y + 10);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = 'rgba(255, 215, 94, 0.4)';
  ctx.fillText('The vault. It already took its share.', W / 2, IY1 - 24);
}

// The arena: a banner, a ring, and an audience you can't see.
function drawArenaRoom(room) {
  const a = room.arena;
  // the fighting ring
  ctx.strokeStyle = 'rgba(255, 154, 58, 0.25)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 150, 0, Math.PI * 2);
  ctx.stroke();

  // the banner
  const bx = W / 2, by = IY0 + 90;
  ctx.fillStyle = '#5a4526';
  ctx.fillRect(bx - 3, by - 44, 6, 76);
  const wave = Math.sin(animT * 3) * 4;
  ctx.fillStyle = a.state === 'idle' ? '#a03050' : '#552838';
  ctx.beginPath();
  ctx.moveTo(bx + 3, by - 44);
  ctx.lineTo(bx + 44 + wave, by - 36);
  ctx.lineTo(bx + 3, by - 12);
  ctx.closePath();
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  if (a.state === 'idle') {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('The old fighting pit. Two waves. One purse.', W / 2, H / 2 + 120);
    if (Math.hypot(run.hero.x - bx, run.hero.y - by) < 75) {
      ctx.fillStyle = '#ff9a3a';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('E — ring the banner', bx, by + 52);
    }
  } else if (a.state === 'done') {
    ctx.fillStyle = 'rgba(255, 215, 94, 0.5)';
    ctx.fillText('The pit is satisfied.', W / 2, H / 2 + 120);
  }
}

// The spring: clean water this deep is a miracle. Drink up.
function drawSpringRoom(room) {
  const x = W / 2, y = H / 2;
  const used = room.springUsed;
  ctx.fillStyle = used ? 'rgba(60, 90, 110, 0.5)' : 'rgba(90, 180, 220, 0.55)';
  ctx.beginPath();
  ctx.ellipse(x, y, 90, 55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a3a48';
  ctx.lineWidth = 4;
  ctx.stroke();
  if (!used) {
    // ripples and glow
    for (let i = 0; i < 2; i++) {
      const rp = (animT * 0.5 + i * 0.5) % 1;
      ctx.strokeStyle = 'rgba(180, 230, 255, ' + (0.5 * (1 - rp)) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, 20 + rp * 60, 12 + rp * 36, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 10, x, y, 120);
    g.addColorStop(0, 'rgba(125, 232, 255, 0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 130, y - 130, 260, 260);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(used ? 'The spring is still.' : 'A healing spring.', x, y + 90);
  if (!used && Math.hypot(run.hero.x - x, run.hero.y - y) < 75) {
    ctx.fillStyle = '#7de8ff';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('E — drink deep', x, y + 110);
  }
}

// The prison: a cage, and something pale behind the bars.
function drawPrisonRoom(room) {
  const x = W / 2, y = H / 2 - 10;
  const opened = room.prisonOpened;

  if (!opened) {
    // the pale prisoner, swaying gently
    const sway = Math.sin(animT * 1.5) * 3;
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#c9b8ff';
    ctx.beginPath();
    ctx.arc(x + sway, y, 16, Math.PI, 0);
    ctx.lineTo(x + sway + 16, y + 22);
    for (let i = 0; i < 3; i++) {
      ctx.quadraticCurveTo(x + sway + 16 - (i + 0.5) * 11, y + 28, x + sway + 16 - (i + 1) * 11, y + 22);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3a1030';
    ctx.fillRect(x + sway - 8, y - 4, 5, 4);
    ctx.fillRect(x + sway + 3, y - 4, 5, 4);
    ctx.globalAlpha = 1;
  }

  // the cage
  ctx.strokeStyle = opened ? '#33334a' : '#565670';
  ctx.lineWidth = 4;
  ctx.strokeRect(x - 44, y - 36, 88, 76);
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 44 + i * 17.6, y - 36);
    ctx.lineTo(x - 44 + i * 17.6, opened ? y - 20 : y + 40); // opened: bars raised
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(opened ? 'The cage stands empty.' : 'Something waits in the cage.', x, y + 70);
  if (!opened && Math.hypot(run.hero.x - x, run.hero.y - y) < 80) {
    ctx.fillStyle = '#c9a5ff';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('E — open the cage', x, y + 90);
  }
}

// One of four riddles; each draws its own furniture.
function drawPuzzleRoom(room) {
  const pz = room.puzzle;
  if (!pz) return;
  if (pz.kind === 'seq') drawPuzzleSeq(pz);
  else if (pz.kind === 'path') drawPuzzlePath(pz);
  else if (pz.kind === 'levers') drawPuzzleLevers(pz);
  else if (pz.kind === 'targets') drawPuzzleTargets(pz);
  else if (pz.kind === 'push') drawPuzzlePush(pz);
  else if (pz.kind === 'lightsout') drawPuzzleLightsOut(pz);
  else if (pz.kind === 'orbs') drawPuzzleOrbs(pz);
  else if (pz.kind === 'statues') drawPuzzleStatues(pz);
  else if (pz.kind === 'beacons') drawPuzzleBeacons(pz);
  else if (pz.kind === 'counting') drawPuzzleCounting(pz);
  else if (pz.kind === 'vigil') drawPuzzleVigil(pz);
}

// Numbered runes: one through five, in order, no guessing.
function drawPuzzleCounting(pz) {
  const h = run.hero;
  pz.stones.forEach(st => {
    drawShadow(st.x, st.y + 14, 18);
    ctx.fillStyle = st.lit ? '#3a5a40' : '#3a3a48';
    ctx.beginPath();
    ctx.arc(st.x, st.y, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = st.lit ? '#7dff8a' : '#565670';
    ctx.lineWidth = 3;
    ctx.stroke();
    // n dots
    ctx.fillStyle = st.lit ? '#7dff8a' : '#c9c9e0';
    for (let d = 0; d < st.n; d++) {
      const a = (d / st.n) * Math.PI * 2 - Math.PI / 2;
      const rr = st.n === 1 ? 0 : 9;
      ctx.beginPath();
      ctx.arc(st.x + Math.cos(a) * rr, st.y + Math.sin(a) * rr, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!pz.solved && !st.lit && Math.hypot(h.x - st.x, h.y - st.y) < 48) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#ffd75e';
      ctx.fillText('E', st.x, st.y + 40);
    }
  });
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = pz.solved ? 'rgba(125,255,138,0.5)' : 'rgba(255,255,255,0.4)';
  ctx.fillText(pz.solved ? 'One to five. Take your prize.'
    : 'Press the runes in counting order.', W / 2, IY1 - 24);
}

// The vigil: a circle to hold and reasons not to.
function drawPuzzleVigil(pz) {
  const active = pz.started && !pz.solved;
  ctx.strokeStyle = pz.solved ? 'rgba(125,255,138,0.6)'
    : active ? 'rgba(255, 154, 58, 0.7)' : 'rgba(200, 200, 224, 0.35)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(pz.x, pz.y, pz.r, 0, Math.PI * 2);
  ctx.stroke();
  if (active) {
    ctx.fillStyle = '#000000aa';
    ctx.fillRect(W / 2 - 100, IY0 + 18, 200, 12);
    ctx.fillStyle = '#ff9a3a';
    ctx.fillRect(W / 2 - 98, IY0 + 20, 196 * Math.min(1, pz.t / pz.window), 8);
  }
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = pz.solved ? 'rgba(125,255,138,0.5)' : 'rgba(255,255,255,0.4)';
  ctx.fillText(pz.solved ? 'The circle held. Take your prize.'
    : active ? 'HOLD THE CIRCLE.'
    : 'Stand in the circle and press E. Then don\'t leave.', W / 2, IY1 - 24);
}

// Rune stones: three shapes, two of each, and a short memory.
function drawPuzzleOrbs(pz) {
  const h = run.hero;
  pz.stones.forEach(st => {
    drawShadow(st.x, st.y + 18, 20);
    ctx.fillStyle = st.matched ? '#2e4030' : '#3a3a48';
    ctx.fillRect(st.x - 22, st.y - 26, 44, 52);
    ctx.strokeStyle = st.matched ? '#7dff8a' : '#565670';
    ctx.lineWidth = 3;
    ctx.strokeRect(st.x - 22, st.y - 26, 44, 52);
    if (st.revealed || st.matched) {
      ctx.fillStyle = st.matched ? '#7dff8a' : '#ffd75e';
      if (st.sym === 0) {
        ctx.beginPath();
        ctx.arc(st.x, st.y, 11, 0, Math.PI * 2);
        ctx.fill();
      } else if (st.sym === 1) {
        ctx.beginPath();
        ctx.moveTo(st.x, st.y - 12);
        ctx.lineTo(st.x + 11, st.y + 9);
        ctx.lineTo(st.x - 11, st.y + 9);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(st.x - 10, st.y - 10, 20, 20);
      }
    } else if (!pz.solved && pz.hideT <= 0 &&
               Math.hypot(h.x - st.x, h.y - st.y) < 48) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#ffd75e';
      ctx.fillText('E', st.x, st.y + 42);
    }
  });
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = pz.solved ? 'rgba(125,255,138,0.5)' : 'rgba(255,255,255,0.4)';
  ctx.fillText(pz.solved ? 'The pairs remember. Take your prize.'
    : 'Reveal the stones two at a time. Match all three pairs.', W / 2, IY1 - 24);
}

// Four statues; turning one turns its neighbors. Face them north.
function drawPuzzleStatues(pz) {
  const h = run.hero;
  pz.statues.forEach((st, i) => {
    drawShadow(st.x, st.y + 24, 20);
    // pedestal + bust
    ctx.fillStyle = '#3a3a48';
    ctx.fillRect(st.x - 20, st.y + 10, 40, 16);
    ctx.fillStyle = pz.facing[i] === 0 ? '#5a6a58' : '#565670';
    ctx.beginPath();
    ctx.arc(st.x, st.y - 6, 17, 0, Math.PI * 2);
    ctx.fill();
    // the way it faces
    const ang = pz.facing[i] * Math.PI / 2 - Math.PI / 2; // 0=N
    ctx.fillStyle = pz.facing[i] === 0 ? '#7dff8a' : '#ffd75e';
    ctx.save();
    ctx.translate(st.x, st.y - 6);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(7, -10);
    ctx.lineTo(-7, -10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (!pz.solved && Math.hypot(h.x - st.x, h.y - st.y) < 52) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#ffd75e';
      ctx.fillText('E — turn', st.x, st.y + 44);
    }
  });
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = pz.solved ? 'rgba(125,255,138,0.5)' : 'rgba(255,255,255,0.4)';
  ctx.fillText(pz.solved ? 'They face the dawn. Take your prize.'
    : 'Turning one statue turns its neighbors. Face all four north.', W / 2, IY1 - 24);
}

// Two braziers and not enough time.
function drawPuzzleBeacons(pz) {
  const h = run.hero;
  const drawBrazier = (p2, lit) => {
    drawShadow(p2.x, p2.y + 14, 16);
    ctx.fillStyle = '#3a3a48';
    ctx.fillRect(p2.x - 14, p2.y - 4, 28, 18);
    ctx.fillRect(p2.x - 18, p2.y - 8, 36, 6);
    if (lit) {
      const fl = 0.7 + Math.sin(animT * 10 + p2.x) * 0.3;
      ctx.fillStyle = 'rgba(255, 154, 58, ' + fl + ')';
      ctx.beginPath();
      ctx.ellipse(p2.x, p2.y - 16, 8, 12 * fl, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  drawBrazier(pz.a, pz.litA || pz.solved);
  drawBrazier(pz.b, pz.solved);
  if (!pz.solved) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px monospace';
    if (!pz.litA && Math.hypot(h.x - pz.a.x, h.y - pz.a.y) < 55) {
      ctx.fillStyle = '#ff9a3a';
      ctx.fillText('E — light it', pz.a.x, pz.a.y + 36);
    }
    if (pz.litA) {
      ctx.fillStyle = '#000000aa';
      ctx.fillRect(W / 2 - 100, IY0 + 18, 200, 12);
      ctx.fillStyle = pz.timer > 1.5 ? '#ff9a3a' : '#ff5544';
      ctx.fillRect(W / 2 - 98, IY0 + 20, 196 * Math.max(0, pz.timer / pz.window), 8);
      if (Math.hypot(h.x - pz.b.x, h.y - pz.b.y) < 55) {
        ctx.fillStyle = '#ff9a3a';
        ctx.fillText('E — light it', pz.b.x, pz.b.y + 36);
      }
    }
  }
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = pz.solved ? 'rgba(125,255,138,0.5)' : 'rgba(255,255,255,0.4)';
  ctx.fillText(pz.solved ? 'Both flames hold. Take your prize.'
    : 'Carry the flame from one brazier to the other. Quickly.', W / 2, IY1 - 24);
}

// Push blocks: worn stones and the sockets that miss them.
function drawPuzzlePush(pz) {
  for (const sk of pz.sockets) {
    const filled = pz.blocks.some(b => Math.hypot(b.x - sk.x, b.y - sk.y) < 26);
    ctx.strokeStyle = filled ? '#7dff8a' : '#565670';
    ctx.lineWidth = 3;
    ctx.strokeRect(sk.x - 24, sk.y - 24, 48, 48);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(sk.x - 24, sk.y - 24, 48, 48);
  }
  for (const b of pz.blocks) {
    drawShadow(b.x, b.y + b.h / 2 - 4, b.w / 2);
    ctx.fillStyle = '#565670';
    ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
    ctx.fillStyle = '#6a6a80';
    ctx.fillRect(b.x - b.w / 2 + 4, b.y - b.h / 2 + 4, b.w - 8, b.h - 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
  }
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = pz.solved ? 'rgba(125,255,138,0.5)' : 'rgba(255,255,255,0.4)';
  ctx.fillText(pz.solved ? 'The stones settle. Take your prize.'
    : 'Push the stones into their sockets.', W / 2, IY1 - 24);
}

// Lights-out lanterns in a 3x3 grid.
function drawPuzzleLightsOut(pz) {
  pz.nodes.forEach((n, i) => {
    const lit = pz.cells[i];
    // the little lantern
    ctx.fillStyle = '#3a3a48';
    ctx.fillRect(n.x - 3, n.y - 4, 6, 16);
    ctx.fillRect(n.x - 8, n.y + 10, 16, 4);
    ctx.fillStyle = '#2b2b38';
    ctx.fillRect(n.x - 9, n.y - 20, 18, 18);
    ctx.fillStyle = lit ? 'rgba(255, 200, 100, 0.9)' : '#191922';
    ctx.fillRect(n.x - 6, n.y - 17, 12, 12);
    if (lit) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(n.x, n.y - 11, 4, n.x, n.y - 11, 46);
      g.addColorStop(0, 'rgba(255, 200, 100, 0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(n.x - 50, n.y - 60, 100, 100);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (!pz.solved && Math.hypot(run.hero.x - n.x, run.hero.y - n.y) < 48) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#ffd75e';
      ctx.fillText('E', n.x, n.y + 28);
    }
  });
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = pz.solved ? 'rgba(125,255,138,0.5)' : 'rgba(255,255,255,0.4)';
  ctx.fillText(pz.solved ? 'All lit. Take your prize.'
    : 'Press a lantern: it and its neighbors flip. Light all nine.', W / 2, IY1 - 24);
}

// Three stone plates. They light up in an order. Remember it.
function drawPuzzleSeq(pz) {
  let hint = -1;
  if (!pz.solved) {
    const T = pz.seq.length * 0.7 + 1.6;
    const t = animT % T;
    const idx = Math.floor(t / 0.7);
    if (idx < pz.seq.length && (t % 0.7) < 0.45) hint = pz.seq[idx];
  }

  pz.plates.forEach((p, i) => {
    const lit = i === hint;
    ctx.fillStyle = pz.solved ? '#3a5a40' : lit ? '#8a7d3a' : '#3a3a48';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pz.solved ? '#7dff8a' : lit ? '#ffd75e' : '#565670';
    ctx.lineWidth = 3;
    ctx.stroke();
    if (lit) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(p.x, p.y, 5, p.x, p.y, 55);
      g.addColorStop(0, 'rgba(255,215,94,0.3)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - 60, p.y - 60, 120, 120);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = lit ? '#fff2c9' : '#8888aa';
    for (let d = 0; d <= i; d++) {
      ctx.beginPath();
      ctx.arc(p.x - i * 7 + d * 14, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  if (!pz.solved) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('The plates glow in an order. Walk it.', W / 2, H / 2 + 120);
    for (let i = 0; i < pz.seq.length; i++) {
      ctx.fillStyle = i < pz.progress ? '#7dff8a' : '#33334a';
      ctx.fillRect(W / 2 - pz.seq.length * 10 + i * 20, H / 2 + 136, 12, 12);
    }
  } else {
    ctx.fillStyle = 'rgba(125,255,138,0.5)';
    ctx.fillText('The floor remembers. Take your prize.', W / 2, H / 2 + 120);
  }
}

// The memory path: a grid of tiles, and only one row of them is honest.
function drawPuzzlePath(pz) {
  let hintCol = -1;
  if (pz.armed && !pz.solved) {
    const T = pz.cols * 0.5 + 1.4;
    const t = animT % T;
    const idx = Math.floor(t / 0.5);
    if (idx < pz.cols && (t % 0.5) < 0.34) hintCol = idx;
  }

  for (let c = 0; c < pz.cols; c++) {
    for (let r = 0; r < pz.rows; r++) {
      const x = pz.ox + c * pz.tile, y = pz.oy + r * pz.tile;
      const isSafe = pathTileSafe(pz, c, r);
      const lit = (c === hintCol && isSafe) || (pz.solved && isSafe);
      ctx.fillStyle = lit ? 'rgba(255,215,94,0.35)' : 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + 3, y + 3, pz.tile - 6, pz.tile - 6);
      ctx.strokeStyle = lit ? '#ffd75e' : pz.armed ? '#565670' : '#33334a';
      ctx.lineWidth = lit ? 3 : 1.5;
      ctx.strokeRect(x + 3, y + 3, pz.tile - 6, pz.tile - 6);
    }
  }

  // the plaque that wakes the floor
  const pq = pz.plaque;
  ctx.fillStyle = '#565670';
  ctx.fillRect(pq.x - 14, pq.y - 20, 28, 40);
  ctx.fillStyle = pz.armed ? '#ff9a3a' : '#8888aa';
  ctx.fillRect(pq.x - 7, pq.y - 12, 14, 10);

  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  if (pz.solved) {
    ctx.fillStyle = 'rgba(125,255,138,0.5)';
    ctx.fillText('The floor holds. Take your prize.', W / 2, pz.oy + pz.rows * pz.tile + 26);
  } else if (!pz.armed) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('A dormant floor of loose tiles.', W / 2, pz.oy + pz.rows * pz.tile + 26);
    if (Math.hypot(run.hero.x - pq.x, run.hero.y - pq.y) < 60) {
      ctx.fillStyle = '#ff9a3a';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('E — wake the floor', pq.x, pq.y + 44);
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('Cross on the tiles that glow. Left to right.', W / 2, pz.oy + pz.rows * pz.tile + 26);
  }
}

// Three levers, three lamps. Every pull flips the neighbors too.
function drawPuzzleLevers(pz) {
  pz.levers.forEach((lv, i) => {
    const on = pz.state[i];
    // the lamp
    const ly = lv.y - 70;
    ctx.fillStyle = on ? '#ffd75e' : '#2b2b38';
    ctx.beginPath();
    ctx.arc(lv.x, ly, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#565670';
    ctx.lineWidth = 3;
    ctx.stroke();
    if (on) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(lv.x, ly, 4, lv.x, ly, 50);
      g.addColorStop(0, 'rgba(255,215,94,0.3)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(lv.x - 55, ly - 55, 110, 110);
      ctx.globalCompositeOperation = 'source-over';
    }
    // the lever
    drawShadow(lv.x, lv.y + 12, 14);
    ctx.fillStyle = '#3a3a48';
    ctx.fillRect(lv.x - 12, lv.y, 24, 12);
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(lv.x, lv.y + 4);
    ctx.lineTo(lv.x + (on ? 14 : -14), lv.y - 22);
    ctx.stroke();
    ctx.fillStyle = '#c9495a';
    ctx.beginPath();
    ctx.arc(lv.x + (on ? 14 : -14), lv.y - 22, 5, 0, Math.PI * 2);
    ctx.fill();

    if (!pz.solved && Math.hypot(run.hero.x - lv.x, run.hero.y - lv.y) < 55) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#ffd75e';
      ctx.fillText('E — pull', lv.x, lv.y + 36);
    }
  });

  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = pz.solved ? 'rgba(125,255,138,0.5)' : 'rgba(255,255,255,0.4)';
  ctx.fillText(pz.solved ? 'All lamps lit. Take your prize.'
    : 'Every lever pulls its neighbors. Light all three lamps.', W / 2, H / 2 + 110);
}

// The shooting gallery: plaque, clock, and pop-up marks.
function drawPuzzleTargets(pz) {
  const pq = pz.plaque;
  ctx.fillStyle = '#565670';
  ctx.fillRect(pq.x - 16, pq.y - 22, 32, 44);
  ctx.fillStyle = pz.started ? '#ff9a3a' : '#8888aa';
  ctx.beginPath();
  ctx.arc(pq.x, pq.y - 8, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  if (pz.solved) {
    ctx.fillStyle = 'rgba(125,255,138,0.5)';
    ctx.fillText('Three of three. Take your prize.', W / 2, pq.y + 50);
  } else if (!pz.started) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('An old shooting gallery.', W / 2, pq.y + 50);
    if (Math.hypot(run.hero.x - pq.x, run.hero.y - pq.y) < 60) {
      ctx.fillStyle = '#ff9a3a';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('E — begin the trial', pq.x, pq.y + 70);
    }
  } else {
    // the clock
    ctx.fillStyle = '#000000aa';
    ctx.fillRect(W / 2 - 120, IY0 + 18, 240, 14);
    ctx.fillStyle = pz.timer > 5 ? '#ff9a3a' : '#ff5544';
    ctx.fillRect(W / 2 - 118, IY0 + 20, 236 * Math.max(0, pz.timer / 14), 10);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(pz.hit + ' / ' + pz.spots.length, W / 2, IY0 + 52);
  }
}

// The trial spawner: an iron cage with something burning inside.
function drawSpawner(sp) {
  drawShadow(sp.x, sp.y + 14, 18);
  if (sp.active) {
    const fl = 0.7 + Math.sin(animT * 10 + sp.x) * 0.3;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(sp.x, sp.y, 3, sp.x, sp.y, 60);
    g.addColorStop(0, 'rgba(255, 120, 40, ' + 0.3 * fl + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sp.x - 65, sp.y - 65, 130, 130);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255, 120, 40, ' + fl + ')';
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y - 2, 7, 10 * fl, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = sp.active ? '#565670' : '#33334a';
  ctx.lineWidth = 3;
  ctx.strokeRect(sp.x - 18, sp.y - 20, 36, 40);
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(sp.x - 18 + i * 12, sp.y - 20);
    ctx.lineTo(sp.x - 18 + i * 12, sp.y + 20);
    ctx.stroke();
  }
  if (!sp.active && sp.remaining.length === 0) {
    ctx.strokeStyle = '#2b2b38';
    ctx.beginPath();
    ctx.moveTo(sp.x - 10, sp.y - 20);
    ctx.lineTo(sp.x + 4, sp.y);
    ctx.lineTo(sp.x - 6, sp.y + 20);
    ctx.stroke();
  }
}

// The family plot: gravestones, night air, and the way down.
function drawSurfaceScene() {
  for (let i = 0; i < 7; i++) {
    const v1 = hash2(i * 13, 7), v2 = hash2(i * 29, 3);
    const gx = IX0 + 60 + v1 * (IX1 - IX0 - 120);
    const gy = IY0 + 50 + v2 * (IY1 - IY0 - 140);
    if (Math.hypot(gx - W / 2, gy - H / 2) < 150) continue; // clear of the elevator
    drawShadow(gx, gy + 14, 14);
    ctx.fillStyle = '#6a6a78';
    ctx.fillRect(gx - 11, gy - 12, 22, 26);
    ctx.beginPath();
    ctx.arc(gx, gy - 12, 11, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#4a4a58';
    ctx.fillRect(gx - 5, gy - 8, 10, 3);
    ctx.fillRect(gx - 3, gy - 12, 6, 10);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '15px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('The Family Plot', W / 2, IY0 + 36);
  if (save.generation === 1) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '13px monospace';
    ctx.fillText('WASD move · SPACE attack · SHIFT special · E inventory', W / 2, H - 92);
    ctx.fillText('Step onto the elevator and press ENTER to descend', W / 2, H - 72);
  }
}

// Hidden room flavor text, by what's inside.
function drawSecretFlavor(room) {
  const names = {
    hoard: 'A hidden hoard.',
    armory: 'A forgotten cache of gear.',
    grove: 'Something green survived down here.',
    bank: "Somebody's rainy-day pile.",
  };
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(names[room.secretKind] || 'A hidden room.', W / 2, IY0 + 36);
}

// A cracked wall where a door hides — someone should lean on it.
function drawSecretCrack(dir) {
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  let x = W / 2, y = dir === 'N' ? IY0 - 20 : IY1 + 20;
  if (dir === 'E' || dir === 'W') {
    y = H / 2;
    x = dir === 'W' ? IX0 - 20 : IX1 + 20;
  }
  ctx.beginPath();
  ctx.moveTo(x - 12, y - 9);
  ctx.lineTo(x - 2, y - 1);
  ctx.lineTo(x - 8, y + 7);
  ctx.moveTo(x + 3, y - 7);
  ctx.lineTo(x + 10, y + 3);
  ctx.stroke();
}

// Themed furnishings, drawn as solid top-down props.
function drawFurnitureAll(room) {
  const h = run.hero;
  for (const f of room.furniture) {
    drawShadow(f.x, f.y + f.h / 2 - 2, f.w / 2);
    if (f.kind === 'crate') {
      ctx.fillStyle = '#8a6a3a';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.strokeStyle = '#5a4526';
      ctx.lineWidth = 2;
      ctx.strokeRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.beginPath();
      ctx.moveTo(f.x - f.w / 2, f.y - f.h / 2);
      ctx.lineTo(f.x + f.w / 2, f.y + f.h / 2);
      ctx.moveTo(f.x + f.w / 2, f.y - f.h / 2);
      ctx.lineTo(f.x - f.w / 2, f.y + f.h / 2);
      ctx.stroke();
    } else if (f.kind === 'barrel') {
      ctx.fillStyle = '#7a5a30';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4a3820';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.w / 2 - 6, 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.kind === 'shelf') {
      ctx.fillStyle = '#5a4526';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      const spines = ['#a05050', '#5070a0', '#50a070', '#a09050', '#8050a0'];
      for (let b = 0; b < 10; b++) {
        ctx.fillStyle = spines[(b * 7 + (f.x | 0)) % spines.length];
        ctx.fillRect(f.x - f.w / 2 + 5 + b * 8, f.y - f.h / 2 + 4, 6, f.h - 8);
      }
    } else if (f.kind === 'coffin') {
      ctx.fillStyle = '#6a5a48';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.strokeStyle = '#463b2e';
      ctx.lineWidth = 2;
      ctx.strokeRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.beginPath(); // a cross on the lid
      ctx.moveTo(f.x, f.y - f.h / 4);
      ctx.lineTo(f.x, f.y + f.h / 4);
      ctx.moveTo(f.x - f.w / 4, f.y - f.h / 8);
      ctx.lineTo(f.x + f.w / 4, f.y - f.h / 8);
      ctx.stroke();
    } else if (f.kind === 'anvil') {
      ctx.fillStyle = '#4a4a58';
      ctx.fillRect(f.x - f.w / 2, f.y - 4, f.w, f.h / 2);
      ctx.fillRect(f.x - f.w / 2 + 4, f.y - f.h / 2, f.w - 8, f.h / 2);
      ctx.fillStyle = '#6a6a78';
      ctx.fillRect(f.x - f.w / 2 + 4, f.y - f.h / 2, f.w - 8, 4);
    } else if (f.kind === 'brew') {
      ctx.fillStyle = '#3a3a48';
      ctx.fillRect(f.x - f.w / 2, f.y + 2, f.w, 10);
      ctx.fillStyle = '#565670';
      ctx.fillRect(f.x - 2, f.y - f.h / 2, 4, f.h - 6);
      const bottleColors = ['#ff5a6e', '#7de8ff', '#ff9a3a'];
      bottleColors.forEach((col, i) => {
        const bx = f.x - 13 + i * 13;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(bx, f.y, 5, 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (f.kind === 'craft') {
      ctx.fillStyle = '#8a6a3a';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.strokeStyle = '#5a4526';
      ctx.lineWidth = 3;
      ctx.strokeRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.beginPath(); // 2x2 crafting grid
      ctx.moveTo(f.x, f.y - f.h / 2); ctx.lineTo(f.x, f.y + f.h / 2);
      ctx.moveTo(f.x - f.w / 2, f.y); ctx.lineTo(f.x + f.w / 2, f.y);
      ctx.stroke();
    } else if (f.kind === 'stove') {
      ctx.fillStyle = '#4a4a58';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.strokeStyle = '#2e2e3a';
      ctx.lineWidth = 2;
      ctx.strokeRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      const ember = 0.5 + Math.sin(animT * 7) * 0.4;
      ctx.fillStyle = 'rgba(255, 120, 40, ' + ember + ')';
      ctx.fillRect(f.x - 8, f.y - 4, 16, 10);
    } else if (f.kind === 'pot') {
      ctx.fillStyle = '#3a3a48';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = f.used ? '#2b2b38' : '#c9a05a'; // the stew
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.w / 2 - 5, 0, Math.PI * 2);
      ctx.fill();
      if (!f.used) { // steam
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        const sy = f.y - 16 - (animT * 14 % 10);
        ctx.beginPath();
        ctx.arc(f.x + Math.sin(animT * 3) * 3, sy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (f.kind === 'keg') {
      ctx.fillStyle = '#7a5a30';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.strokeStyle = '#4a3820';
      ctx.lineWidth = 2;
      ctx.strokeRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.fillStyle = f.used ? '#3a3a48' : '#ffd75e'; // the tap
      ctx.fillRect(f.x - 3, f.y + f.h / 2 - 4, 6, 8);
    } else if (f.kind === 'counter') {
      ctx.fillStyle = '#6a4e2a';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.fillStyle = '#8a6a3a';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, 6);
      // a couple of abandoned mugs
      ctx.fillStyle = '#c9c9e0';
      ctx.fillRect(f.x - f.w / 4, f.y - 4, 8, 8);
      ctx.fillRect(f.x + f.w / 4 - 8, f.y - 4, 8, 8);
    } else if (f.kind === 'stool') {
      ctx.fillStyle = '#7a5a30';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4a3820';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (f.kind === 'lantern') {
      // a standing lantern: post, glass box, warm flame
      ctx.fillStyle = '#3a3a48';
      ctx.fillRect(f.x - 3, f.y - 6, 6, 20);
      ctx.fillRect(f.x - 8, f.y + 12, 16, 4);
      ctx.fillStyle = '#2b2b38';
      ctx.fillRect(f.x - 8, f.y - 22, 16, 18);
      const fl = 0.75 + Math.sin(animT * 8 + f.x) * 0.25;
      ctx.fillStyle = 'rgba(255, 200, 100, ' + fl + ')';
      ctx.fillRect(f.x - 5, f.y - 19, 10, 12);
    } else if (f.kind === 'rack') {
      ctx.fillStyle = '#5a4526';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      // racked blades
      ctx.strokeStyle = '#9aa4b8';
      ctx.lineWidth = 3;
      for (let b = 0; b < 4; b++) {
        const bx = f.x - f.w / 2 + 14 + b * 20;
        ctx.beginPath();
        ctx.moveTo(bx, f.y + f.h / 2 - 4);
        ctx.lineTo(bx, f.y - f.h / 2 + 3);
        ctx.stroke();
      }
    } else if (f.kind === 'bunk') {
      ctx.fillStyle = '#5a4526';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.fillStyle = '#6a6a88'; // blanket
      ctx.fillRect(f.x - f.w / 2 + 4, f.y - f.h / 2 + 4, f.w - 24, f.h - 8);
      ctx.fillStyle = '#c9c9e0'; // pillow
      ctx.fillRect(f.x + f.w / 2 - 18, f.y - f.h / 2 + 5, 13, f.h - 10);
    } else if (f.kind === 'planter') {
      ctx.fillStyle = '#5a4526';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.fillStyle = '#3d2e1e';
      ctx.fillRect(f.x - f.w / 2 + 4, f.y - f.h / 2 + 4, f.w - 8, f.h - 8);
      ctx.fillStyle = '#6ae89a'; // sprouts
      for (let sp = 0; sp < 3; sp++) {
        const sx = f.x - f.w / 2 + 10 + sp * 12;
        ctx.fillRect(sx, f.y - 6 + Math.sin(animT * 2 + sp) * 1.5, 3, 9);
      }
    } else if (f.kind === 'pew') {
      ctx.fillStyle = '#6a4e2a';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.fillStyle = '#5a4526';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, 6);
    } else if (f.kind === 'altar') {
      ctx.fillStyle = '#565670';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      ctx.fillStyle = '#6a6a88';
      ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, 5);
      // candle flames
      const fl = 0.7 + Math.sin(animT * 9) * 0.3;
      ctx.fillStyle = 'rgba(255, 200, 100, ' + fl + ')';
      ctx.beginPath();
      ctx.arc(f.x - 12, f.y - f.h / 2 - 4, 3, 0, Math.PI * 2);
      ctx.arc(f.x + 12, f.y - f.h / 2 - 4, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if ((f.kind === 'brew' || f.kind === 'craft') &&
        Math.hypot(h.x - f.x, h.y - f.y) < 70) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#ffd75e';
      ctx.fillText(f.kind === 'brew' ? 'E — brew' : 'E — craft', f.x, f.y + f.h / 2 + 18);
    }
    if ((f.kind === 'pot' || f.kind === 'keg') && !f.used &&
        Math.hypot(h.x - f.x, h.y - f.y) < 65) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#ffd75e';
      ctx.fillText(f.kind === 'pot' ? 'E — eat stew' : 'E — tap the keg', f.x, f.y + f.h / 2 + 18);
    }
  }
}

function drawBiomeDecor(room, kind) {
  for (let k = 0; k < 6; k++) {
    const v1 = hash2(room.x * 91 + k * 7, room.y * 57 + k * 13);
    const v2 = hash2(room.x * 43 + k * 17, room.y * 71 + k * 3);
    const x = IX0 + 50 + v1 * (IX1 - IX0 - 100);
    const y = IY0 + 50 + v2 * (IY1 - IY0 - 100);

    if (kind === 'puddle') {
      ctx.fillStyle = 'rgba(90, 180, 200, 0.18)';
      ctx.beginPath();
      ctx.ellipse(x, y, 26 + v1 * 20, 12 + v2 * 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140, 220, 240, 0.15)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (kind === 'mushroom') {
      ctx.fillStyle = '#5a4a6e';
      ctx.fillRect(x - 2, y - 6, 4, 8);
      ctx.fillStyle = v1 > 0.5 ? '#9a6ae8' : '#6ae89a';
      ctx.beginPath();
      ctx.arc(x, y - 7, 6 + v2 * 3, Math.PI, 0);
      ctx.fill();
    } else if (kind === 'crystal') {
      // a jut of glowing crystal
      const ch2 = 10 + v1 * 12;
      ctx.fillStyle = 'rgba(150, 190, 255, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x - 7, y + 5);
      ctx.lineTo(x - 3, y - ch2);
      ctx.lineTo(x + 2, y + 5);
      ctx.moveTo(x + 1, y + 6);
      ctx.lineTo(x + 6, y - ch2 * 0.6);
      ctx.lineTo(x + 10, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      const gC = ctx.createRadialGradient(x, y - 4, 2, x, y - 4, 26);
      gC.addColorStop(0, 'rgba(150, 190, 255, 0.15)');
      gC.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gC;
      ctx.fillRect(x - 28, y - 32, 56, 56);
      ctx.globalCompositeOperation = 'source-over';
    } else if (kind === 'gears') {
      // a half-sunken gear, still turning after all these years
      const gr = 14 + v1 * 10;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(animT * (v2 > 0.5 ? 0.6 : -0.6));
      ctx.strokeStyle = 'rgba(160, 140, 100, 0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, gr, 0, Math.PI * 2);
      ctx.stroke();
      for (let tt = 0; tt < 8; tt++) {
        const a = (tt / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * gr, Math.sin(a) * gr);
        ctx.lineTo(Math.cos(a) * (gr + 5), Math.sin(a) * (gr + 5));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, gr * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (kind === 'lava') {
      ctx.strokeStyle = 'rgba(255, 120, 40, 0.55)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 18, y);
      ctx.lineTo(x - 6, y + 6 - v1 * 12);
      ctx.lineTo(x + 6, y - 4 + v2 * 8);
      ctx.lineTo(x + 18, y + 3);
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 2, x, y, 30);
      g.addColorStop(0, 'rgba(255,120,40,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 30, y - 30, 60, 60);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

function drawShrineRoom(room) {
  const h = run.hero;
  const x = W / 2, y = H / 2 - 10;
  const used = room.shrineUsed;

  drawShadow(x, y + 34, 34);
  // pedestal
  ctx.fillStyle = '#3a3a48';
  ctx.fillRect(x - 34, y + 14, 68, 20);
  ctx.fillStyle = '#2b2b38';
  ctx.fillRect(x - 26, y - 2, 52, 16);
  // the Founder's stone bust
  ctx.fillStyle = used ? '#3d3d4a' : '#565668';
  ctx.beginPath();
  ctx.arc(x, y - 22, 20, 0, Math.PI * 2);
  ctx.fill();
  // stone crown
  ctx.fillStyle = used ? '#4a4438' : '#8a7d4e';
  const cy = y - 42;
  ctx.beginPath();
  ctx.moveTo(x - 14, cy);
  ctx.lineTo(x - 14, cy - 10);
  ctx.lineTo(x - 7, cy - 3);
  ctx.lineTo(x, cy - 12);
  ctx.lineTo(x + 7, cy - 3);
  ctx.lineTo(x + 14, cy - 10);
  ctx.lineTo(x + 14, cy);
  ctx.closePath();
  ctx.fill();
  // eyes glow while a prayer remains
  if (!used) {
    const pulse = 0.5 + Math.sin(animT * 3) * 0.5;
    ctx.fillStyle = 'rgba(255, 215, 94, ' + (0.4 + pulse * 0.6) + ')';
    ctx.fillRect(x - 10, y - 26, 6, 4);
    ctx.fillRect(x + 4, y - 26, 6, 4);
  } else {
    ctx.fillStyle = '#222230';
    ctx.fillRect(x - 10, y - 26, 6, 4);
    ctx.fillRect(x + 4, y - 26, 6, 4);
  }

  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  if (!used) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('The Shrine of the Founder', x, y + 62);
    if (Math.hypot(h.x - x, h.y - y) < 85) {
      ctx.fillStyle = '#ffd75e';
      ctx.fillText('E — pray (gifts... or grudges)', x, y + 82);
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText('The shrine is silent.', x, y + 62);
  }
}

function drawShopRoom(room) {
  const h = run.hero;

  // the hooded merchant, presiding over the stock
  const mx = W / 2, my = IY0 + 88;
  drawShadow(mx, my + 8, 20);
  ctx.fillStyle = '#4a3a5a';
  ctx.beginPath(); // cloak
  ctx.moveTo(mx - 24, my + 26);
  ctx.quadraticCurveTo(mx - 26, my - 24, mx, my - 30);
  ctx.quadraticCurveTo(mx + 26, my - 24, mx + 24, my + 26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#120a18'; // hood shadow
  ctx.beginPath();
  ctx.arc(mx, my - 8, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd75e'; // gleaming eyes
  ctx.fillRect(mx - 7, my - 11, 4, 3);
  ctx.fillRect(mx + 3, my - 11, 4, 3);

  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('"Everything has a price, little descendant."', mx, my + 52);

  for (const item of room.shopItems) {
    // pedestal
    ctx.fillStyle = '#3a3a48';
    ctx.fillRect(item.x - 30, item.y + 8, 60, 14);
    ctx.fillStyle = '#2b2b38';
    ctx.fillRect(item.x - 24, item.y - 2, 48, 10);
    if (item.sold) continue;

    drawShopIcon(item.id, item.x, item.y - 22);

    const near = Math.hypot(item.x - h.x, item.y - h.y) < 60;
    const def = SHOP_ITEMS[item.id];
    ctx.font = near ? 'bold 13px monospace' : '12px monospace';
    ctx.fillStyle = near ? '#ffffff' : '#8888aa';
    ctx.fillText(def.name, item.x, item.y + 42);
    ctx.fillStyle = run.gold >= shopPrice(item.id) ? '#ffd75e' : '#775544';
    ctx.fillText(shopPrice(item.id) + ' g', item.x, item.y + 60);
    if (near) {
      ctx.fillStyle = '#7de8ff';
      ctx.fillText('E — buy · ' + def.desc, item.x, item.y + 80);
    }
  }
}

// Icons for carryable consumables (ground drops, HUD slots, shop).
function drawItemIcon(id, x, y) {
  if (id === 'potion') {
    ctx.fillStyle = '#ff5a6e';
    ctx.beginPath();
    ctx.arc(x, y + 3, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(x - 3, y - 13, 6, 8);
  } else if (id === 'apple') {
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(x, y + 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7dff8a';
    ctx.fillRect(x + 1, y - 11, 6, 4); // leaf
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(x - 1, y - 10, 2, 5); // stem
  } else if (id === 'bomb') {
    ctx.fillStyle = '#2b2b38';
    ctx.beginPath();
    ctx.arc(x, y + 3, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 3, y - 5);
    ctx.quadraticCurveTo(x + 9, y - 12, x + 5, y - 15);
    ctx.stroke();
    if (Math.floor(animT * 6) % 2 === 0) { // fizzing spark
      ctx.fillStyle = '#ffd75e';
      ctx.fillRect(x + 3, y - 17, 4, 4);
    }
  } else if (id === 'swift') {
    ctx.fillStyle = '#7de8ff';
    ctx.beginPath();
    ctx.arc(x, y + 3, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(x - 3, y - 13, 6, 8);
  } else if (id === 'strength') {
    ctx.fillStyle = '#ff9a3a';
    ctx.beginPath();
    ctx.arc(x, y + 3, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(x - 3, y - 13, 6, 8);
  } else if (id === 'totem') {
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(x, y - 7, 6, 0, Math.PI * 2); // head
    ctx.fill();
    ctx.fillRect(x - 4, y - 3, 8, 12);    // body
    ctx.fillRect(x - 10, y - 1, 6, 4);    // arms
    ctx.fillRect(x + 4, y - 1, 6, 4);
    ctx.fillStyle = '#3a2a10';
    ctx.fillRect(x - 4, y - 9, 3, 3);     // eyes
    ctx.fillRect(x + 1, y - 9, 3, 3);
  }
}

function drawShopIcon(id, x, y) {
  if (ITEMS[id]) return drawItemIcon(id, x, y);
  if (id === 'bandages') {
    ctx.fillStyle = '#e8e2d0';
    ctx.fillRect(x - 12, y - 4, 24, 8);
    ctx.fillRect(x - 4, y - 12, 8, 24);
  } else if (id === 'battery') {
    ctx.fillStyle = '#ffd75e';
    ctx.fillRect(x - 7, y - 10, 14, 22);
    ctx.fillRect(x - 3, y - 14, 6, 4);
    ctx.fillStyle = '#8a6a1e';
    ctx.beginPath(); // little bolt mark
    ctx.moveTo(x + 3, y - 6);
    ctx.lineTo(x - 4, y + 2);
    ctx.lineTo(x + 1, y + 2);
    ctx.lineTo(x - 3, y + 9);
    ctx.lineTo(x + 5, y);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  } else if (id === 'blessing') {
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x + 9, y);
    ctx.lineTo(x, y + 12);
    ctx.lineTo(x - 9, y);
    ctx.closePath();
    ctx.fill();
  } else if (id === 'elixir') {
    drawHeartShape(x, y, 10, '#7dff8a');
  }
}

const TORCH_SPOTS = [[216, 40], [744, 40], [216, H - 28], [744, H - 28]];

function drawTorches() {
  const pal = floorPal();
  TORCH_SPOTS.forEach(([x, y], i) => {
    const flick = 0.8 + Math.sin(animT * 11 + i * 2.1) * 0.12 + Math.sin(animT * 23 + i * 5.7) * 0.08;
    // sconce
    ctx.fillStyle = '#3a3a48';
    ctx.fillRect(x - 4, y + 2, 8, 12);
    // flame: three stacked blobs
    const sway = Math.sin(animT * 9 + i * 3) * 2;
    ctx.fillStyle = pal.torch;
    ctx.beginPath();
    ctx.ellipse(x + sway * 0.4, y - 4, 6 * flick, 9 * flick, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff2c9';
    ctx.beginPath();
    ctx.ellipse(x + sway * 0.7, y - 2, 3 * flick, 4.5 * flick, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawTorchGlow() {
  const pal = floorPal();
  ctx.globalCompositeOperation = 'lighter';
  TORCH_SPOTS.forEach(([x, y], i) => {
    const flick = 0.8 + Math.sin(animT * 11 + i * 2.1) * 0.12;
    const g = ctx.createRadialGradient(x, y, 4, x, y, 150 * flick);
    g.addColorStop(0, pal.torch + '30'); // hex alpha ~0.19
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 160, y - 160, 320, 320);
  });
  drawLanternGlows();
  ctx.globalCompositeOperation = 'source-over';
}

// Lantern pools of light — the radius the Shade respects.
function drawLanternGlows() {
  for (const f of run.room.furniture) {
    if (f.kind !== 'lantern') continue;
    const flick = 0.85 + Math.sin(animT * 9 + f.x) * 0.1;
    const g = ctx.createRadialGradient(f.x, f.y - 12, 6, f.x, f.y - 12, LANTERN_RADIUS * flick);
    g.addColorStop(0, 'rgba(255, 200, 100, 0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(f.x - LANTERN_RADIUS - 10, f.y - LANTERN_RADIUS - 22,
      LANTERN_RADIUS * 2 + 20, LANTERN_RADIUS * 2 + 20);
  }
}

function drawDoor(dir, locked, unlockT) {
  ctx.fillStyle = '#101018'; // dark passage
  if (dir === 'N') ctx.fillRect(GX0, 0, GX1 - GX0, IY0);
  if (dir === 'S') ctx.fillRect(GX0, IY1, GX1 - GX0, IY0);
  if (dir === 'W') ctx.fillRect(0, GY0, IX0, GY1 - GY0);
  if (dir === 'E') ctx.fillRect(IX1, GY0, IX0, GY1 - GY0);

  // stone door frame
  ctx.fillStyle = '#3a3a48';
  if (dir === 'N' || dir === 'S') {
    const y = dir === 'N' ? IY0 - 8 : IY1;
    ctx.fillRect(GX0 - 10, y, 10, 8);
    ctx.fillRect(GX1, y, 10, 8);
  } else {
    const x = dir === 'W' ? IX0 - 8 : IX1;
    ctx.fillRect(x, GY0 - 10, 8, 10);
    ctx.fillRect(x, GY1, 8, 10);
  }

  // bars: solid while locked, sliding away just after the room clears
  const sliding = !locked && unlockT > 0;
  if (locked || sliding) {
    const slide = sliding ? (1 - unlockT / 0.4) * 16 : 0;
    ctx.globalAlpha = sliding ? unlockT / 0.4 : 1;
    ctx.fillStyle = '#8a4a3a';
    if (dir === 'N' || dir === 'S') {
      const y = (dir === 'N' ? IY0 - 14 : IY1) + (dir === 'N' ? -slide : slide);
      for (let i = 0; i < 5; i++) ctx.fillRect(GX0 + 8 + i * 20, y, 8, 14);
    } else {
      const x = (dir === 'W' ? IX0 - 14 : IX1) + (dir === 'W' ? -slide : slide);
      for (let i = 0; i < 5; i++) ctx.fillRect(x, GY0 + 8 + i * 20, 14, 8);
    }
    ctx.globalAlpha = 1;
  }
}

function drawElevatorPlatform(active, arrival) {
  const x = W / 2, y = H / 2;

  // cables up into the dark
  ctx.strokeStyle = '#3a3a48';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - 48, y - 34); ctx.lineTo(x - 48, 0);
  ctx.moveTo(x + 48, y - 34); ctx.lineTo(x + 48, 0);
  ctx.stroke();

  // platform
  ctx.fillStyle = arrival ? '#23232e' : '#2a2a38';
  ctx.fillRect(x - 65, y - 45, 130, 90);
  ctx.strokeStyle = '#454558';
  ctx.lineWidth = 3;
  ctx.strokeRect(x - 65, y - 45, 130, 90);
  ctx.beginPath(); // cross braces
  ctx.moveTo(x - 65, y - 45); ctx.lineTo(x + 65, y + 45);
  ctx.moveTo(x + 65, y - 45); ctx.lineTo(x - 65, y + 45);
  ctx.strokeStyle = 'rgba(69,69,88,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // corner rivets
  ctx.fillStyle = '#565670';
  for (const [rx, ry] of [[-56, -36], [56, -36], [-56, 36], [56, 36]]) {
    ctx.beginPath();
    ctx.arc(x + rx, y + ry, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (active) {
    // pulsing glow + down arrow: this thing is ready to ride
    const pulse = 0.6 + Math.sin(animT * 5) * 0.4;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 10, x, y, 90);
    g.addColorStop(0, 'rgba(125,232,255,' + (0.25 * pulse) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 100, y - 100, 200, 200);
    ctx.globalCompositeOperation = 'source-over';

    ctx.strokeStyle = 'rgba(125,232,255,' + (0.5 + pulse * 0.5) + ')';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 65, y - 45, 130, 90);

    ctx.fillStyle = '#7de8ff';
    const ay = y + Math.sin(animT * 5) * 4;
    ctx.beginPath();
    ctx.moveTo(x - 12, ay - 8);
    ctx.lineTo(x + 12, ay - 8);
    ctx.lineTo(x, ay + 10);
    ctx.closePath();
    ctx.fill();
  } else if (!arrival) {
    // locked lamp
    ctx.fillStyle = '#8a3a3a';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawChests() {
  const h = run.hero;
  for (const chest of run.room.chests) {
    // Every chest wears the same wooden face — the tier is a surprise.
    const scale = chest.spawnT > 0 ? 1 - chest.spawnT / 0.3 : 1;
    if (scale <= 0) continue;

    ctx.save();
    ctx.translate(chest.x, chest.y);
    ctx.scale(scale, scale);

    drawShadow(0, 10, 24);

    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(-22, -8, 44, 26);
    ctx.strokeStyle = '#5a4526';
    ctx.lineWidth = 3;
    ctx.strokeRect(-22, -8, 44, 26);
    ctx.beginPath(); // metal bands
    ctx.moveTo(-10, -8); ctx.lineTo(-10, 18);
    ctx.moveTo(10, -8); ctx.lineTo(10, 18);
    ctx.stroke();

    // lid: creaks up once opened
    const lidLift = chest.opened ? Math.min(1, chest.openT / 0.25) : 0;
    ctx.fillStyle = '#8a6a3a';
    ctx.strokeStyle = '#5a4526';
    ctx.save();
    ctx.translate(0, -8);
    ctx.rotate(-lidLift * 0.9);
    ctx.fillRect(-22, -14, 44, 14);
    ctx.strokeRect(-22, -14, 44, 14);
    ctx.restore();

    // latch
    if (!chest.opened) {
      ctx.fillStyle = '#3d3020';
      ctx.fillRect(-4, -10, 8, 10);
    }
    ctx.restore();

    if (!chest.opened && chest.spawnT <= 0 &&
        Math.hypot(chest.x - h.x, chest.y - h.y) < 58) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#ffd75e';
      ctx.fillText(chest.opened ? 'E — loot' : 'E — open', chest.x, chest.y + 34);
    }
  }
}

function drawHero() {
  const h = run.hero;
  if (h.invuln > 0 && Math.floor(h.invuln * 12) % 2 === 0 && !h.dash) return;

  const bob = Math.abs(Math.sin(h.bobT)) * -2.5;
  const y = h.y + bob;
  const angle = Math.atan2(h.face.y, h.face.x);

  drawShadow(h.x, h.y, h.radius);

  // melee swing: blade + arc trail
  if (h.swing) {
    const prog = h.swing.t / h.swing.dur;
    const swingA = h.swing.angle - 0.9 + prog * 1.8;
    for (let k = 0; k < 3; k++) {
      const trailA = swingA - k * 0.28;
      ctx.globalAlpha = 0.45 - k * 0.13;
      ctx.beginPath();
      ctx.moveTo(h.x, y);
      ctx.arc(h.x, y, h.radius + 38, trailA - 0.25, trailA + 0.12);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // the blade itself
    ctx.save();
    ctx.translate(h.x, y);
    ctx.rotate(swingA);
    ctx.strokeStyle = '#e8e8f4';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(h.radius + 4, 0);
    ctx.lineTo(h.radius + 36, 0);
    ctx.stroke();
    ctx.strokeStyle = '#8a8a9a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(h.radius + 10, -6);
    ctx.lineTo(h.radius + 10, 6);
    ctx.stroke();
    ctx.restore();
  }

  // whirlwind special
  if (h.spin) {
    const prog = h.spin.t / h.spin.dur;
    const a0 = prog * Math.PI * 4;
    ctx.globalAlpha = 0.5 * (1 - prog);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(h.x, y, h.radius + 55, a0, a0 + Math.PI * 1.3);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Shield Wall: a glowing barrier that eats projectiles
  if (h.blockT > 0) {
    const a = 0.35 + Math.sin(animT * 14) * 0.15;
    ctx.strokeStyle = 'rgba(143, 180, 255, ' + a + ')';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(h.x, y, h.radius + 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(143, 180, 255, 0.1)';
    ctx.fill();
  }

  drawHeroSprite(h.x, y, h.radius, h.heir.classId, angle, h.bobT);

  // crafted armor is worn: a plate over the torso, pads on the shoulders
  if (h.armor) {
    const aSc = h.radius / 15;
    ctx.fillStyle = h.armor.color;
    ctx.beginPath();
    ctx.moveTo(h.x - 7.6 * aSc, y - 3.6 * aSc);
    ctx.lineTo(h.x + 7.6 * aSc, y - 3.6 * aSc);
    ctx.lineTo(h.x + 6.2 * aSc, y + 6.5 * aSc);
    ctx.lineTo(h.x - 6.2 * aSc, y + 6.5 * aSc);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.6 * aSc;
    ctx.stroke();
    // shoulder pads over the arms
    ctx.beginPath();
    ctx.arc(h.x - 8 * aSc, y - 1.5 * aSc, 3.4 * aSc, 0, Math.PI * 2);
    ctx.arc(h.x + 8 * aSc, y - 1.5 * aSc, 3.4 * aSc, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // seam and sheen
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.moveTo(h.x, y - 3.6 * aSc);
    ctx.lineTo(h.x, y + 6.5 * aSc);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(h.x - 5.5 * aSc, y - 2.6 * aSc, 2.4 * aSc, 7 * aSc);
  }

  // offhand gear is carried at the hip, not orbiting like a moon
  if (h.offhand) {
    const gx = h.x - h.radius * 0.95;
    const gy = y + h.radius * 0.25;
    if (h.offhand.guard) {
      // a small strapped shield
      ctx.fillStyle = h.offhand.color;
      ctx.beginPath();
      ctx.moveTo(gx - 6, gy - 7);
      ctx.lineTo(gx + 6, gy - 7);
      ctx.lineTo(gx + 6, gy + 1);
      ctx.quadraticCurveTo(gx + 6, gy + 7, gx, gy + 10);
      ctx.quadraticCurveTo(gx - 6, gy + 7, gx - 6, gy + 1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // the lantern charm dangles from the belt
      ctx.fillStyle = '#3a3a48';
      ctx.fillRect(gx - 3, gy - 6, 6, 2);
      ctx.fillStyle = h.offhand.color;
      ctx.fillRect(gx - 4, gy - 4, 8, 9);
      ctx.fillStyle = '#fff2c9';
      ctx.fillRect(gx - 2, gy - 2, 4, 5);
    }
  }
}

// Paladin sanctuaries: pools of holy light on the floor.
function drawZones() {
  for (const z of run.zones) {
    const a = Math.min(1, z.t) * (0.18 + Math.sin(animT * 6) * 0.05);
    ctx.fillStyle = 'rgba(255, 224, 138, ' + a + ')';
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 224, 138, ' + Math.min(1, z.t) * 0.5 + ')';
    ctx.lineWidth = 2;
    ctx.stroke();
    // rising motes
    for (let i = 0; i < 5; i++) {
      const mx = z.x + Math.sin(i * 2.3 + animT) * z.r * 0.6;
      const my = z.y + Math.cos(i * 1.7) * z.r * 0.5 - (animT * 30 + i * 17) % 40;
      ctx.fillStyle = 'rgba(255, 240, 190, ' + Math.min(1, z.t) * 0.5 + ')';
      ctx.fillRect(mx, my, 2, 6);
    }
  }
}

// A rescued heir: solid enough to fight, see-through enough to grieve.
function drawPartyMember(m) {
  drawShadow(m.x, m.y, m.r);
  const bob = Math.sin(m.t * 4) * 2.5;
  ctx.globalAlpha = 0.85;
  drawHeroSprite(m.x, m.y + bob, m.r, m.classId, Math.atan2(run.hero.y - m.y, run.hero.x - m.x));
  ctx.globalAlpha = 0.7;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7dff8a';
  ctx.fillText(m.name, m.x, m.y - m.r - 12);
  // a sliver of health
  ctx.fillStyle = '#000000aa';
  ctx.fillRect(m.x - 14, m.y - m.r - 8, 28, 4);
  ctx.fillStyle = '#7dff8a';
  ctx.fillRect(m.x - 13, m.y - m.r - 7, 26 * Math.max(0, m.hp / m.maxHp), 2);
  if (m.hp < m.maxHp && itemCount('potion') > 0 &&
      Math.hypot(run.hero.x - m.x, run.hero.y - m.y) < 55) {
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#7dff8a';
    ctx.fillText('E — feed potion', m.x, m.y + m.r + 18);
  }
  ctx.globalAlpha = 1;
}

// A ghost heir waiting to be found, one floor from the Founder.
function drawGhostHeir(room) {
  const g = room.ghostSpot;
  const spec = room.ghostHeir;
  const bob = Math.sin(animT * 2.5) * 4;
  ctx.globalAlpha = 0.55;
  drawHeroSprite(g.x, g.y + bob, 13, spec.classId, Math.PI / 2);
  ctx.globalAlpha = 0.8;
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7dff8a';
  ctx.fillText(spec.name, g.x, g.y - 26 + bob);
  if (Math.hypot(run.hero.x - g.x, run.hero.y - g.y) < 70) {
    ctx.fillStyle = '#ffd75e';
    ctx.fillText('E — recruit', g.x, g.y + 34);
  }
  ctx.globalAlpha = 1;
}

// Friendly minions, each breed with its own face.
function drawMinion(m) {
  drawShadow(m.x, m.y, m.r);
  const bob = Math.sin(m.t * 9) * 1.5;
  const fade = m.life < 3 ? 0.4 + 0.6 * (m.life / 3) : 1;
  ctx.globalAlpha = fade;

  if (m.type === 'wolf') {
    // a loyal quadruped, mid-trot
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.ellipse(m.x, m.y + bob, m.r + 4, m.r - 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); // head
    ctx.arc(m.x + m.r + 2, m.y - 3 + bob, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); // ears
    ctx.moveTo(m.x + m.r - 1, m.y - 8 + bob);
    ctx.lineTo(m.x + m.r + 1, m.y - 15 + bob);
    ctx.lineTo(m.x + m.r + 4, m.y - 8 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = m.color; // tail
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(m.x - m.r - 2, m.y + bob);
    ctx.quadraticCurveTo(m.x - m.r - 9, m.y - 8 + Math.sin(m.t * 6) * 3 + bob, m.x - m.r - 5, m.y - 11 + bob);
    ctx.stroke();
    ctx.fillStyle = '#2b2233'; // eye
    ctx.beginPath();
    ctx.arc(m.x + m.r + 4, m.y - 4 + bob, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (m.type === 'bee') {
    const flap = Math.sin(m.t * 30) * 3;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.ellipse(m.x, m.y + bob, 6, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2233'; // stripes
    ctx.fillRect(m.x - 2, m.y - 4 + bob, 2, 8);
    ctx.fillRect(m.x + 2, m.y - 4 + bob, 2, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; // wings
    ctx.beginPath();
    ctx.ellipse(m.x - 1, m.y - 5 + bob + flap, 4, 2, -0.4, 0, Math.PI * 2);
    ctx.ellipse(m.x + 2, m.y - 5 + bob - flap, 4, 2, 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (m.type === 'turret') {
    // friendly hardware with a blue lens
    ctx.fillStyle = '#2e3340';
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9aa4b8';
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // the skeleton: small, loyal, rattly
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath();
    ctx.arc(m.x, m.y + bob, m.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a6ae8';
    ctx.fillRect(m.x - 5, m.y - 3 + bob, 3, 3);
    ctx.fillRect(m.x + 2, m.y - 3 + bob, 3, 3);
    ctx.fillStyle = '#b8b2a0';
    ctx.fillRect(m.x - 4, m.y + 4 + bob, 8, 2);
  }
  if (m.hp < m.maxHp) {
    ctx.fillStyle = '#000000aa';
    ctx.fillRect(m.x - 12, m.y - m.r - 10, 24, 4);
    ctx.fillStyle = '#7dff8a';
    ctx.fillRect(m.x - 11, m.y - m.r - 9, 22 * Math.max(0, m.hp / m.maxHp), 2);
  }
  if (!m.dead && m.hp < m.maxHp && itemCount('potion') > 0 &&
      Math.hypot(run.hero.x - m.x, run.hero.y - m.y) < 55) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#7dff8a';
    ctx.fillText('E — feed potion', m.x, m.y + m.r + 16);
  }
  ctx.globalAlpha = 1;
}

// Weapons, shields, and trinkets drawn as ground icons.
function drawEquipIcon(def, x, y) {
  if (def.slot === 'weapon') {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.6);
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-3, 3);
    ctx.lineTo(11, -11);
    ctx.stroke();
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-2, -4);
    ctx.lineTo(4, 2);
    ctx.moveTo(-4, 4);
    ctx.lineTo(-8, 8);
    ctx.stroke();
    ctx.restore();
  } else if (def.guard) {
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 9);
    ctx.lineTo(x + 9, y - 9);
    ctx.lineTo(x + 9, y + 2);
    ctx.quadraticCurveTo(x + 9, y + 10, x, y + 13);
    ctx.quadraticCurveTo(x - 9, y + 10, x - 9, y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (def.mult) {
    // a chestplate
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 9);
    ctx.lineTo(x + 10, y - 9);
    ctx.lineTo(x + 8, y + 10);
    ctx.lineTo(x - 8, y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x - 10, y - 9, 5, 8); // shoulder
    ctx.fillRect(x + 5, y - 9, 5, 8);
  } else {
    // the lantern charm
    ctx.fillStyle = '#3a3a48';
    ctx.fillRect(x - 5, y - 9, 10, 3);
    ctx.fillStyle = def.color;
    ctx.fillRect(x - 6, y - 6, 12, 14);
    ctx.fillStyle = '#fff2c9';
    ctx.fillRect(x - 3, y - 3, 6, 8);
  }
}

function drawMaterialIcon(id, x, y) {
  const col = MATERIALS[id].color;
  if (id === 'gel') {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(x - 3, y - 1, 3, 2, -0.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'wing') {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 6);
    ctx.lineTo(x + 9, y);
    ctx.lineTo(x - 9, y + 6);
    ctx.lineTo(x - 4, y);
    ctx.closePath();
    ctx.fill();
  } else if (id === 'bone') {
    ctx.fillStyle = col;
    ctx.fillRect(x - 7, y - 2, 14, 4);
    ctx.beginPath();
    ctx.arc(x - 7, y - 2, 3, 0, Math.PI * 2);
    ctx.arc(x - 7, y + 2, 3, 0, Math.PI * 2);
    ctx.arc(x + 7, y - 2, 3, 0, Math.PI * 2);
    ctx.arc(x + 7, y + 2, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'scrap') {
    ctx.fillStyle = col;
    ctx.fillRect(x - 7, y - 7, 14, 14);
    ctx.fillStyle = '#565f70';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'essence') {
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 1, x, y, 12);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 12, y - 12, 24, 24);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Six keymasters, six silhouettes. Shared bulk, distinct dressing.
function drawKeymasterBody(e) {
  const bob = Math.sin(e.t * 3) * 1.5;
  const ey = e.y + bob;
  const aim = Math.atan2(run.hero.y - e.y, run.hero.x - e.x);
  const va = e.variant || 'warden';

  // the broad body dome, garbed per keymaster
  const garb = {
    warden: '#8a7d5a', butcher: '#7a4040', plague: '#3a4a2e',
    bell: '#6a5636', puppet: '#5a4a8a', watcher: '#2e4a56',
  }[va] || '#8a7d5a';
  if (va === 'puppet') ctx.globalAlpha = 0.92;
  ctx.fillStyle = garb;
  ctx.beginPath();
  ctx.arc(e.x, ey + 6, e.r, Math.PI, 0);
  ctx.rect(e.x - e.r, ey + 6, e.r * 2, e.r * 0.5);
  ctx.fill();

  if (va === 'warden') {
    // horned steel helm over a bone face, visor slit and all
    ctx.fillStyle = '#d8c9a0';
    ctx.beginPath();
    ctx.moveTo(e.x - e.r * 0.7, ey - 8);
    ctx.lineTo(e.x - e.r * 1.25, ey - 22);
    ctx.lineTo(e.x - e.r * 0.45, ey - 16);
    ctx.moveTo(e.x + e.r * 0.7, ey - 8);
    ctx.lineTo(e.x + e.r * 1.25, ey - 22);
    ctx.lineTo(e.x + e.r * 0.45, ey - 16);
    ctx.fill();
    ctx.fillStyle = '#9aa2b0';
    ctx.beginPath();
    ctx.arc(e.x, ey - 6, e.r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(e.x - e.r * 0.55, ey - 10, e.r * 1.1, 5);
    ctx.fillStyle = '#c9d2e0';
    ctx.fillRect(e.x - 2, ey - 20, 4, 8); // crest ridge
  } else if (va === 'butcher') {
    // stained apron, pale head, and a cleaver that never rests
    ctx.fillStyle = '#d8cfc0';
    ctx.fillRect(e.x - e.r * 0.5, ey - 2, e.r, e.r * 0.85);
    ctx.fillStyle = '#c9495a';
    ctx.beginPath();
    ctx.arc(e.x - 4, ey + 4, 3, 0, Math.PI * 2);
    ctx.arc(e.x + 5, ey + 9, 2.2, 0, Math.PI * 2);
    ctx.arc(e.x - 2, ey + 13, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8a890';
    ctx.beginPath();
    ctx.arc(e.x, ey - 8, e.r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(e.x - 5, ey - 10, 2.5, 0, Math.PI * 2);
    ctx.arc(e.x + 5, ey - 10, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.save(); // the cleaver, idly swinging
    ctx.translate(e.x + e.r + 2, ey + 2);
    ctx.rotate(Math.sin(e.t * 2.2) * 0.25 - 0.2);
    ctx.fillStyle = '#6a441e';
    ctx.fillRect(-2, -2, 4, 12);
    ctx.fillStyle = '#b8c0c8';
    ctx.fillRect(-9, -18, 18, 16);
    ctx.fillStyle = '#e0e6ec';
    ctx.fillRect(-9, -4, 18, 3);
    ctx.restore();
  } else if (va === 'plague') {
    // hood, goggles, and the long pale beak, tracking you
    ctx.fillStyle = '#2e3a24';
    ctx.beginPath();
    ctx.arc(e.x, ey - 6, e.r * 0.8, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
    ctx.save();
    ctx.translate(e.x, ey - 6);
    ctx.rotate(aim);
    ctx.fillStyle = '#d8cfc0';
    ctx.beginPath();
    ctx.moveTo(4, -6);
    ctx.lineTo(e.r * 1.15, 0);
    ctx.lineTo(4, 6);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#e8e2d0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x - 6, ey - 9, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(e.x + 6, ey - 9, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#8aa84a';
    ctx.beginPath();
    ctx.arc(e.x - 6, ey - 9, 2, 0, Math.PI * 2);
    ctx.arc(e.x + 6, ey - 9, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (va === 'bell') {
    // a robed ringer with a rope belt and the bell itself
    ctx.fillStyle = '#c9a05a';
    ctx.fillRect(e.x - e.r, ey + 8, e.r * 2, 3);
    ctx.fillStyle = '#4a3a26';
    ctx.beginPath();
    ctx.arc(e.x, ey - 7, e.r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(e.x - 5, ey - 9, 2.2, 0, Math.PI * 2);
    ctx.arc(e.x + 5, ey - 9, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.save(); // the bell swings from a raised fist
    ctx.translate(e.x - e.r - 4, ey - 4);
    ctx.rotate(Math.sin(e.t * 4) * 0.3);
    ctx.fillStyle = '#c9a05a';
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(-9, 14);
    ctx.lineTo(9, 14);
    ctx.lineTo(3, 0);
    ctx.fill();
    ctx.fillStyle = '#8a6a1e';
    ctx.fillRect(-10, 13, 20, 3);
    ctx.fillStyle = '#3a2a12';
    ctx.beginPath();
    ctx.arc(0, 18, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (va === 'puppet') {
    // porcelain face, jester collar, strings up to a turning crossbar
    ctx.fillStyle = '#ffd75e';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(e.x + i * 8 - 4, ey + 2);
      ctx.lineTo(e.x + i * 8, ey + 10);
      ctx.lineTo(e.x + i * 8 + 4, ey + 2);
      ctx.fill();
    }
    ctx.fillStyle = '#e8e2d8';
    ctx.beginPath();
    ctx.arc(e.x, ey - 8, e.r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e88aa0';
    ctx.beginPath();
    ctx.arc(e.x - 6, ey - 5, 2, 0, Math.PI * 2);
    ctx.arc(e.x + 6, ey - 5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(e.x - 4, ey - 11, 2, 0, Math.PI * 2);
    ctx.arc(e.x + 4, ey - 11, 2, 0, Math.PI * 2);
    ctx.fill();
    const tilt = Math.sin(e.t * 0.8) * 0.3;
    ctx.strokeStyle = '#b0a8c8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e.x - Math.cos(tilt) * 22, ey - 38 - Math.sin(tilt) * 6);
    ctx.lineTo(e.x + Math.cos(tilt) * 22, ey - 38 + Math.sin(tilt) * 6);
    ctx.stroke();
    ctx.strokeStyle = '#ccccd8';
    ctx.lineWidth = 1;
    for (const sx of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(e.x + sx * Math.cos(tilt) * 22, ey - 38 + sx * Math.sin(tilt) * 6);
      ctx.lineTo(e.x + sx * 14, ey - 10 + Math.abs(sx) * 12);
      ctx.stroke();
    }
  } else if (va === 'watcher') {
    // no face — one enormous eye that never blinks, and never misses
    ctx.strokeStyle = '#3a5a66';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const wx = e.x - 10 + i * 10;
      ctx.beginPath();
      ctx.moveTo(wx, ey + e.r * 0.9);
      ctx.quadraticCurveTo(wx + Math.sin(e.t * 3 + i) * 6, ey + e.r * 0.9 + 8,
        wx + Math.sin(e.t * 3 + i + 1) * 4, ey + e.r * 0.9 + 15);
      ctx.stroke();
    }
    ctx.fillStyle = '#e8f4f8';
    ctx.beginPath();
    ctx.arc(e.x, ey - 5, e.r * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7de8ff';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const la = (i / 8) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(la) * e.r * 0.82, ey - 5 + Math.sin(la) * e.r * 0.82);
      ctx.lineTo(e.x + Math.cos(la) * e.r * 1.05, ey - 5 + Math.sin(la) * e.r * 1.05);
      ctx.stroke();
    }
    const ix = e.x + Math.cos(aim) * 5, iy = ey - 5 + Math.sin(aim) * 5;
    ctx.fillStyle = '#7de8ff';
    ctx.beginPath();
    ctx.arc(ix, iy, e.r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#16222c';
    ctx.beginPath();
    ctx.arc(ix, iy, e.r * 0.17, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawEnemy(e) {
  const scale = e.spawnT > 0 ? Math.max(0.05, 1 - e.spawnT / 0.35) : 1;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(scale, scale);
  ctx.translate(-e.x, -e.y);

  if (e.spawnT <= 0) drawShadow(e.x, e.y, e.r);

  if (e.type === 'slime') {
    const squash = 1 + Math.sin(e.t * 6) * 0.15;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + e.r * (1 - squash) * 0.5, e.r, e.r * squash, 0, 0, Math.PI * 2);
    ctx.fillStyle = e.color;
    ctx.fill();
    // glossy highlight
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(e.x - e.r * 0.35, e.y - e.r * 0.35 * squash, e.r * 0.25, e.r * 0.15, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(e.x - 7, e.y - 4, 4, 5);
    ctx.fillRect(e.x + 3, e.y - 4, 4, 5);
  } else if (e.type === 'bat') {
    const flap = Math.sin(e.t * 16) * 12;
    ctx.fillStyle = e.color;
    // wings: two segments each side
    ctx.beginPath();
    ctx.moveTo(e.x - e.r + 2, e.y);
    ctx.lineTo(e.x - e.r - 10, e.y - 4 + flap);
    ctx.lineTo(e.x - e.r - 20, e.y + 2 + flap * 1.3);
    ctx.lineTo(e.x - e.r + 2, e.y + 7);
    ctx.closePath();
    ctx.moveTo(e.x + e.r - 2, e.y);
    ctx.lineTo(e.x + e.r + 10, e.y - 4 + flap);
    ctx.lineTo(e.x + e.r + 20, e.y + 2 + flap * 1.3);
    ctx.lineTo(e.x + e.r - 2, e.y + 7);
    ctx.closePath();
    ctx.fill();
    // body + ears
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(e.x - 8, e.y - e.r + 2);
    ctx.lineTo(e.x - 5, e.y - e.r - 7);
    ctx.lineTo(e.x - 1, e.y - e.r + 1);
    ctx.moveTo(e.x + 8, e.y - e.r + 2);
    ctx.lineTo(e.x + 5, e.y - e.r - 7);
    ctx.lineTo(e.x + 1, e.y - e.r + 1);
    ctx.fill();
    ctx.fillStyle = '#2a1a3a';
    ctx.fillRect(e.x - 6, e.y - 3, 4, 4);
    ctx.fillRect(e.x + 2, e.y - 3, 4, 4);
  } else if (e.type === 'skeleton') {
    // skull
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y - 2, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(e.x - e.r * 0.55, e.y + e.r * 0.4, e.r * 1.1, e.r * 0.5); // jaw
    ctx.fillStyle = '#222';
    ctx.beginPath(); // eye sockets
    ctx.arc(e.x - 6, e.y - 4, 4, 0, Math.PI * 2);
    ctx.arc(e.x + 6, e.y - 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(e.x - 5, e.y + e.r * 0.45, 2, 5); // teeth gaps
    ctx.fillRect(e.x - 1, e.y + e.r * 0.45, 2, 5);
    ctx.fillRect(e.x + 3, e.y + e.r * 0.45, 2, 5);
  } else if (e.type === 'rat') {
    // low, quick, all whiskers and tail
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, e.r + 3, e.r - 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); // ears
    ctx.arc(e.x + 5, e.y - e.r + 1, 3, 0, Math.PI * 2);
    ctx.arc(e.x + 9, e.y - e.r + 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c9a08a'; // tail
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e.x - e.r - 2, e.y);
    ctx.quadraticCurveTo(e.x - e.r - 10, e.y + Math.sin(e.t * 9) * 4, e.x - e.r - 15, e.y - 2);
    ctx.stroke();
    ctx.fillStyle = '#2b2233';
    ctx.beginPath();
    ctx.arc(e.x + 8, e.y - 2, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.type === 'golem') {
    // stacked stone with grudges
    ctx.fillStyle = e.color;
    ctx.fillRect(e.x - e.r, e.y - e.r * 0.6, e.r * 2, e.r * 1.4);
    ctx.fillRect(e.x - e.r * 0.7, e.y - e.r * 1.1, e.r * 1.4, e.r * 0.7);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(e.x - e.r, e.y - e.r * 0.6, e.r * 2, e.r * 1.4);
    ctx.fillStyle = '#ffb347'; // ember eyes
    ctx.fillRect(e.x - 8, e.y - e.r * 0.85, 5, 4);
    ctx.fillRect(e.x + 3, e.y - e.r * 0.85, 5, 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; // cracks
    ctx.beginPath();
    ctx.moveTo(e.x - 4, e.y - e.r * 0.4);
    ctx.lineTo(e.x + 2, e.y + 2);
    ctx.lineTo(e.x - 3, e.y + e.r * 0.6);
    ctx.stroke();
  } else if (e.type === 'sparker') {
    // a jittery core wrapped in live current
    const jx = (Math.random() - 0.5) * 2, jy = (Math.random() - 0.5) * 2;
    ctx.fillStyle = '#3d4452';
    ctx.beginPath();
    ctx.arc(e.x + jx, e.y + jy, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x + jx, e.y + jy, e.r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 215, 94, 0.7)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const a = e.t * 5 + k * 2.1;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r);
      ctx.lineTo(e.x + Math.cos(a + 0.4) * (e.r + 7), e.y + Math.sin(a + 0.4) * (e.r + 7));
      ctx.stroke();
    }
  } else if (e.type === 'frostling') {
    // a walking shard of old ice
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - e.r - 4);
    ctx.lineTo(e.x + e.r, e.y + 2);
    ctx.lineTo(e.x + e.r * 0.5, e.y + e.r);
    ctx.lineTo(e.x - e.r * 0.5, e.y + e.r);
    ctx.lineTo(e.x - e.r, e.y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(e.x - 2, e.y - e.r);
    ctx.lineTo(e.x + 3, e.y - 2);
    ctx.lineTo(e.x - 4, e.y + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2b3a4d';
    ctx.fillRect(e.x - 5, e.y - 2, 3, 3);
    ctx.fillRect(e.x + 2, e.y - 2, 3, 3);
  } else if (e.type === 'imp') {
    // small, horned, pleased with itself
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); // horns
    ctx.moveTo(e.x - 7, e.y - e.r + 2);
    ctx.lineTo(e.x - 10, e.y - e.r - 7);
    ctx.lineTo(e.x - 3, e.y - e.r + 1);
    ctx.closePath();
    ctx.moveTo(e.x + 7, e.y - e.r + 2);
    ctx.lineTo(e.x + 10, e.y - e.r - 7);
    ctx.lineTo(e.x + 3, e.y - e.r + 1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = e.color; // tail
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(e.x - e.r, e.y + 4);
    ctx.quadraticCurveTo(e.x - e.r - 9, e.y + 8 + Math.sin(e.t * 5) * 3, e.x - e.r - 7, e.y - 2);
    ctx.stroke();
    ctx.fillStyle = '#3a1030';
    ctx.fillRect(e.x - 5, e.y - 4, 4, 3);
    ctx.fillRect(e.x + 1, e.y - 4, 4, 3);
  } else if (e.type === 'turret') {
    // base plate + bolts
    ctx.fillStyle = '#2e3340';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#565f70';
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(a) * (e.r + 1), e.y + Math.sin(a) * (e.r + 1), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // barrel tracks the player
    const aim = e.aim || 0;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(aim);
    ctx.fillStyle = '#3d4452';
    ctx.fillRect(0, -5, e.r + 12, 10);
    ctx.fillStyle = '#1d222c';
    ctx.fillRect(e.r + 8, -3, 6, 6);
    ctx.restore();
    // body + charging lens
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * 0.75, 0, Math.PI * 2);
    ctx.fill();
    const charge = e.shootTimer < 0.4 ? 1 : 0.4;
    ctx.fillStyle = 'rgba(255,80,60,' + charge + ')';
    ctx.beginPath();
    ctx.arc(e.x, e.y, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.type === 'guardian') {
    // the keymaster's name and health, miniboss-style
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = e.color;
    ctx.fillText(e.name || 'The Keymaster', e.x, e.y - e.r - 22);
    ctx.fillStyle = '#000000aa';
    ctx.fillRect(e.x - 26, e.y - e.r - 18, 52, 5);
    ctx.fillStyle = e.color;
    ctx.fillRect(e.x - 25, e.y - e.r - 17, 50 * Math.max(0, e.hp / e.maxHp), 3);
    // each keymaster wears its own silhouette
    drawKeymasterBody(e);
    // the gear amulet: the thing you actually need
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(e.x, e.y + 12, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a6a1e';
    ctx.beginPath();
    ctx.arc(e.x, e.y + 12, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.type === 'ancestor') {
    // a translucent little ghost of someone you used to be
    const bob = Math.sin(e.t * 4) * 3;
    ctx.globalAlpha = 0.7;
    drawHeroSprite(e.x, e.y + bob, e.r, e.classId || 'knight',
      Math.atan2(run.hero.y - e.y, run.hero.x - e.x));
    ctx.globalAlpha = 0.55;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c9b8ff';
    ctx.fillText(e.name || '', e.x, e.y - e.r - 12);
    ctx.globalAlpha = 1;
  } else if (e.type === 'target') {
    // a bullseye on a stand
    ctx.fillStyle = '#5a4526';
    ctx.fillRect(e.x - 3, e.y, 6, 22);
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath();
    ctx.arc(e.x, e.y - 4, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9495a';
    ctx.beginPath();
    ctx.arc(e.x, e.y - 4, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath();
    ctx.arc(e.x, e.y - 4, 4.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.type === 'mimic') {
    // a chest with regrets: open maw, teeth, tongue
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(e.x - 20, e.y - 6, 40, 24);
    ctx.strokeStyle = '#5a4526';
    ctx.lineWidth = 3;
    ctx.strokeRect(e.x - 20, e.y - 6, 40, 24);
    const jaw = Math.sin(e.t * 8) * 0.2 - 0.7;
    ctx.save();
    ctx.translate(e.x, e.y - 6);
    ctx.rotate(jaw);
    ctx.fillRect(-20, -14, 40, 14);
    ctx.strokeRect(-20, -14, 40, 14);
    ctx.fillStyle = '#e8e2d0'; // upper teeth
    for (let tt = 0; tt < 5; tt++) {
      ctx.beginPath();
      ctx.moveTo(-16 + tt * 8, 0);
      ctx.lineTo(-12 + tt * 8, 7);
      ctx.lineTo(-8 + tt * 8, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#a03050'; // tongue
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + 4, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e2d0'; // lower teeth
    for (let tt = 0; tt < 5; tt++) {
      ctx.beginPath();
      ctx.moveTo(e.x - 16 + tt * 8, e.y - 6);
      ctx.lineTo(e.x - 12 + tt * 8, e.y - 1);
      ctx.lineTo(e.x - 8 + tt * 8, e.y - 6);
      ctx.closePath();
      ctx.fill();
    }
  } else if (e.type === 'boss') {
    drawBossGhost(e);
  }

  // white flash on hit (drawn overlay — works in every browser)
  if (e.flash > 0) {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawBossGhost(e) {
  const bob = Math.sin(e.t * 2.5) * 6;
  const y = e.y + bob;
  const color = e.ai.mode === 'telegraph' ? '#ff8888' : '#c9b8ff';

  // spectral aura
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(e.x, y, e.r * 0.5, e.x, y, e.r * 2);
  g.addColorStop(0, 'rgba(160,130,255,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(e.x - e.r * 2.2, y - e.r * 2.2, e.r * 4.4, e.r * 4.4);
  ctx.globalCompositeOperation = 'source-over';

  // ghost body: dome top, wavy tail bottom
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(e.x, y, e.r, Math.PI, 0);
  const tailY = y + e.r * 0.85;
  const waveAmp = 7 + Math.sin(e.t * 6) * 3;
  ctx.lineTo(e.x + e.r, tailY);
  for (let i = 0; i < 4; i++) {
    const x0 = e.x + e.r - (i + 0.5) * (e.r / 2);
    const x1 = e.x + e.r - (i + 1) * (e.r / 2);
    ctx.quadraticCurveTo(x0, tailY + waveAmp * (i % 2 === 0 ? 1 : -0.4), x1, tailY);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // crown
  ctx.fillStyle = '#ffd75e';
  const cy = y - e.r - 4;
  ctx.beginPath();
  ctx.moveTo(e.x - 22, cy);
  ctx.lineTo(e.x - 22, cy - 16);
  ctx.lineTo(e.x - 11, cy - 5);
  ctx.lineTo(e.x, cy - 18);
  ctx.lineTo(e.x + 11, cy - 5);
  ctx.lineTo(e.x + 22, cy - 16);
  ctx.lineTo(e.x + 22, cy);
  ctx.closePath();
  ctx.fill();

  // angry eyes
  ctx.fillStyle = '#3a1030';
  ctx.fillRect(e.x - 18, y - 10, 12, 8);
  ctx.fillRect(e.x + 6, y - 10, 12, 8);
}

function drawProjectiles() {
  for (const p of run.projectiles) {
    if (p.kind === 'arrow') {
      // shaft, head, and fletching along the flight path
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.strokeStyle = '#a8845a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(8, 0);
      ctx.stroke();
      ctx.fillStyle = '#d8d8e4';
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(5, -4);
      ctx.lineTo(5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.fillRect(-11, -3, 4, 6);
      ctx.restore();
      continue;
    }
    if (p.kind === 'flask') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.travel || 0) / 30);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a6a3a';
      ctx.fillRect(-2, -10, 4, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(-3, -1, 3, 3);
      ctx.restore();
      continue;
    }
    if (p.kind === 'gob') {
      ctx.fillStyle = '#8aa84a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.arc(p.x - 2, p.y - 2, 3, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if (p.ehoming) {
      // a lidless little eye
      ctx.fillStyle = '#e8e2d0';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 8, 5.5, Math.atan2(p.vy, p.vx), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7de8ff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if (p.kind === 'bone') {
      // a spinning bone: shaft + knobs
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot || 0);
      ctx.fillStyle = p.color;
      ctx.fillRect(-8, -2.5, 16, 5);
      ctx.beginPath();
      ctx.arc(-8, -2, 3.5, 0, Math.PI * 2);
      ctx.arc(-8, 2, 3.5, 0, Math.PI * 2);
      ctx.arc(8, -2, 3.5, 0, Math.PI * 2);
      ctx.arc(8, 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // a glowing bolt
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 14);
      g.addColorStop(0, p.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - 14, p.y - 14, 28, 28);
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
  }
}

function drawLoot() {
  const loot = run.room.loot;
  for (const c of loot.coins) {
    if (c.gem) {
      // a cut gem: diamond silhouette with a facet line and sparkle
      const bob = Math.sin(c.t * 3) * 2;
      ctx.fillStyle = '#7de8ff';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 10 + bob);
      ctx.lineTo(c.x + 8, c.y - 3 + bob);
      ctx.lineTo(c.x, c.y + 10 + bob);
      ctx.lineTo(c.x - 8, c.y - 3 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#d5f7ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c.x - 8, c.y - 3 + bob);
      ctx.lineTo(c.x + 8, c.y - 3 + bob);
      ctx.stroke();
      if (Math.sin(c.t * 5) > 0.7) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(c.x + 2, c.y - 7 + bob, 2, 2);
      }
      continue;
    }
    // spinning coin: width oscillates
    const wobble = Math.abs(Math.cos(c.t * 6));
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 6 * Math.max(0.25, wobble), 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd75e';
    ctx.fill();
    ctx.strokeStyle = '#b8952e';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  for (const ht of loot.hearts) {
    const bob = Math.sin(animT * 4 + ht.x) * 3;
    drawShadow(ht.x, ht.y + 6, 10);
    if (ht.food) {
      // a drumstick, obviously
      ctx.fillStyle = '#b8763a';
      ctx.beginPath();
      ctx.ellipse(ht.x - 2, ht.y + bob, 9, 7, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8e2d0';
      ctx.beginPath();
      ctx.arc(ht.x + 8, ht.y - 7 + bob, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e8e2d0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ht.x + 3, ht.y - 2 + bob);
      ctx.lineTo(ht.x + 8, ht.y - 7 + bob);
      ctx.stroke();
    } else {
      // golden hearts are the big heals
      drawHeartShape(ht.x, ht.y + bob, ht.heal >= 50 ? 13 : 11, ht.heal >= 50 ? '#ffd75e' : '#ff5a6e');
    }
  }
  for (const c of loot.cells) {
    const bob = Math.sin(c.t * 3.5) * 3;
    drawShadow(c.x, c.y + 10, 9);
    ctx.fillStyle = '#ffd75e';
    ctx.fillRect(c.x - 6, c.y - 9 + bob, 12, 19);
    ctx.fillRect(c.x - 3, c.y - 12 + bob, 6, 3);
    ctx.fillStyle = '#8a6a1e';
    ctx.beginPath(); // bolt mark
    ctx.moveTo(c.x + 3, c.y - 5 + bob);
    ctx.lineTo(c.x - 3, c.y + 1 + bob);
    ctx.lineTo(c.x + 1, c.y + 1 + bob);
    ctx.lineTo(c.x - 2, c.y + 7 + bob);
    ctx.lineTo(c.x + 4, c.y - 1 + bob);
    ctx.lineTo(c.x, c.y - 1 + bob);
    ctx.closePath();
    ctx.fill();
  }
  for (const it of loot.items) {
    const bob = Math.sin(it.t * 3) * 3;
    drawShadow(it.x, it.y + 10, 10);
    drawItemIcon(it.id, it.x, it.y + bob);
  }
  for (const m of loot.mats) {
    const bob = Math.sin(m.t * 3.2) * 2.5;
    drawShadow(m.x, m.y + 8, 8);
    drawMaterialIcon(m.id, m.x, m.y + bob);
  }
  const h2 = run.hero;
  for (const q of loot.equip) {
    const bob = Math.sin(q.t * 3) * 3;
    drawShadow(q.x, q.y + 10, 11);
    drawEquipIcon(q.def, q.x, q.y + bob);
    if (Math.hypot(q.x - h2.x, q.y - h2.y) < 55) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = q.def.color;
      ctx.fillText(q.def.name + (h2[q.def.slot] ? ' — E swap' : ''), q.x, q.y + 30);
    }
  }
}

// Greg's Shade: a hole in the light with hungry eyes.
function drawShade() {
  const s = run.shade;
  const pulse = 1 + Math.sin(s.t * 6) * 0.08;

  ctx.globalCompositeOperation = 'multiply';
  const g = ctx.createRadialGradient(s.x, s.y, 5, s.x, s.y, 90);
  g.addColorStop(0, 'rgba(30,10,50,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(s.x - 95, s.y - 95, 190, 190);
  ctx.globalCompositeOperation = 'source-over';

  ctx.fillStyle = 'rgba(10, 4, 20, 0.88)';
  ctx.beginPath();
  ctx.arc(s.x, s.y, 24 * pulse, Math.PI, 0);
  const tailY = s.y + 20 * pulse;
  ctx.lineTo(s.x + 24 * pulse, tailY);
  for (let i = 0; i < 3; i++) {
    const x0 = s.x + 24 * pulse - (i + 0.5) * 16 * pulse;
    const x1 = s.x + 24 * pulse - (i + 1) * 16 * pulse;
    ctx.quadraticCurveTo(x0, tailY + 8 + Math.sin(s.t * 8 + i) * 4, x1, tailY);
  }
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ff3344';
  ctx.fillRect(s.x - 10, s.y - 8, 7, 4);
  ctx.fillRect(s.x + 3, s.y - 8, 7, 4);
}

function drawBlackoutFog() {
  const h = run.hero;
  const flicker = 1 + Math.sin(animT * 17) * 0.04;
  const g = ctx.createRadialGradient(h.x, h.y, 90 * flicker, h.x, h.y, 190 * flicker);
  g.addColorStop(0, 'rgba(4,3,10,0)');
  g.addColorStop(1, 'rgba(4,3,10,0.97)');
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, W + 40, H + 40);
}

function drawMyopiaFog() {
  const h = run.hero;
  const g = ctx.createRadialGradient(h.x, h.y, 130, h.x, h.y, 250);
  g.addColorStop(0, 'rgba(8,8,14,0)');
  g.addColorStop(1, 'rgba(8,8,14,0.96)');
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, W + 40, H + 40);
}

// ---------------------------------------------------------
// HUD
// ---------------------------------------------------------
function drawHUD() {
  const h = run.hero;
  const c = CLASSES[h.heir.classId];

  ctx.textAlign = 'left';
  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(h.heir.name + '  ·  ' + c.name + '  ·  Gen ' + save.generation, 16, 26);

  // HP bar
  const bw = 220;
  ctx.fillStyle = '#000000aa';
  ctx.fillRect(16, 36, bw, 18);
  ctx.fillStyle = h.hp / h.maxHp > 0.3 ? '#e05a5a' : '#ff2222';
  ctx.fillRect(18, 38, (bw - 4) * Math.max(0, h.hp / h.maxHp), 14);
  ctx.fillStyle = '#ffffff';
  ctx.font = '12px monospace';
  ctx.fillText(Math.ceil(h.hp) + ' / ' + h.maxHp, 22, 49);

  // special ability cooldown bar
  const spec = c.special;
  const ready = h.spCd <= 0;
  ctx.fillStyle = '#000000aa';
  ctx.fillRect(16, 58, bw, 10);
  ctx.fillStyle = ready ? '#7de8ff' : '#3d5a66';
  ctx.fillRect(18, 60, (bw - 4) * (ready ? 1 : 1 - h.spCd / spec.cd), 6);
  ctx.fillStyle = ready ? '#7de8ff' : '#667788';
  ctx.font = '11px monospace';
  ctx.fillText(spec.name + (ready ? ' — SHIFT' : ''), 18, 80);

  // lantern power bar with a drawn bolt icon
  const pFrac = run.power / POWER_MAX;
  const pColor = run.blackout ? '#ff3344' : pFrac > 0.5 ? '#ffd75e' : pFrac > 0.25 ? '#ff9a3a' : '#ff5544';
  ctx.fillStyle = pColor;
  ctx.beginPath(); // bolt
  ctx.moveTo(24, 90);
  ctx.lineTo(17, 100);
  ctx.lineTo(22, 100);
  ctx.lineTo(18, 109);
  ctx.lineTo(27, 98);
  ctx.lineTo(22, 98);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#000000aa';
  ctx.fillRect(34, 93, 202, 12);
  if (run.blackout) {
    if (Math.floor(animT * 4) % 2 === 0) {
      ctx.fillStyle = '#ff3344';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('THE SHADE HUNTS — RUN', 40, 103);
    }
  } else {
    const low = pFrac <= 0.25 && Math.floor(animT * 4) % 2 === 0;
    ctx.fillStyle = low ? '#ffffff' : pColor;
    ctx.fillRect(36, 95, 198 * Math.max(0, pFrac), 8);
  }

  // gold — a small drawn coin next to the count
  ctx.beginPath();
  ctx.arc(24, 124, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd75e';
  ctx.fill();
  ctx.strokeStyle = '#b8952e';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = '#ffd75e';
  ctx.fillText(run.gold + ' gold', 40, 129);

  // the hotbar: nine slots, bottom-center, Minecraft-style.
  // 1-9 / Tab / wheel select; Q uses.
  const sel = Math.min(h.itemSel, Math.max(0, h.items.length - 1));
  const slotW = 36, hbW = ITEM_CAP * slotW;
  const hbX = W / 2 - hbW / 2, hbY = H - 46;
  for (let i = 0; i < ITEM_CAP; i++) {
    const x = hbX + i * slotW;
    ctx.fillStyle = '#000000aa';
    ctx.fillRect(x, hbY, slotW - 4, slotW - 4);
    ctx.strokeStyle = h.items[i] && i === sel ? '#7de8ff' : '#33334a';
    ctx.lineWidth = h.items[i] && i === sel ? 3 : 2;
    ctx.strokeRect(x, hbY, slotW - 4, slotW - 4);
    if (h.items[i]) {
      drawItemIcon(h.items[i].id, x + slotW / 2 - 2, hbY + 18);
      if (h.items[i].n > 1) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(String(h.items[i].n), x + slotW - 8, hbY + slotW - 9);
      }
    }
    ctx.fillStyle = '#55556a';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(i + 1), x + 3, hbY + 10);
  }
  if (h.items.length > 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7de8ff';
    ctx.font = 'bold 12px monospace';
    const selStack = h.items[sel];
    ctx.fillText(ITEMS[selStack.id].name +
      (selStack.n > 1 ? ' x' + selStack.n : '') + ' — Q', W / 2, hbY - 8);
    ctx.textAlign = 'left';
  }

  // armor, passives, and active potion buffs
  let buffY = 188;
  ctx.font = 'bold 12px monospace';
  if (h.armor) {
    ctx.fillStyle = h.armor.color;
    ctx.fillText(h.armor.name, 16, buffY);
    buffY += 18;
  }
  if (h.aegis) {
    ctx.fillStyle = h.aegisReady ? '#8fb4ff' : '#4a5a77';
    ctx.fillText(h.aegisReady ? 'Aegis ready' : 'Aegis ' + Math.ceil(h.aegisT) + 's', 16, buffY);
    buffY += 18;
  }
  if (h.combo && h.comboN > 0) {
    ctx.fillStyle = '#7de8ff';
    ctx.fillText('Combo x' + h.comboN, 16, buffY);
    buffY += 18;
  }
  if (h.necro && run.minions.length > 0) {
    ctx.fillStyle = '#8a6ae8';
    ctx.fillText('Skeletons: ' + run.minions.length, 16, buffY);
    buffY += 18;
  }
  if (h.swiftT > 0) {
    ctx.fillStyle = '#7de8ff';
    ctx.fillText('Swiftness ' + Math.ceil(h.swiftT) + 's', 16, buffY);
    buffY += 18;
  }
  if (h.strengthT > 0) {
    ctx.fillStyle = '#ff9a3a';
    ctx.fillText('Strength ' + Math.ceil(h.strengthT) + 's', 16, buffY);
    buffY += 18;
  }
  for (const m of run.party) {
    ctx.fillStyle = '#7dff8a';
    ctx.font = '12px monospace';
    ctx.fillText(m.name, 16, buffY);
    ctx.fillStyle = '#000000aa';
    ctx.fillRect(100, buffY - 9, 60, 8);
    ctx.fillStyle = '#7dff8a';
    ctx.fillRect(101, buffY - 8, 58 * Math.max(0, m.hp / m.maxHp), 6);
    buffY += 18;
  }

  // standing on the elevator: show the choice
  if (run.onElevator && state === 'play') {
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#000000aa';
    ctx.fillRect(W / 2 - 280, H - 92, 560, 34);
    ctx.fillStyle = '#7de8ff';
    let prompt;
    if (run.floor < 0) prompt = 'ENTER — descend into the crypt';
    else if (run.floor < FLOORS.length - 1) {
      prompt = (run.materials.gear >= 1
        ? 'ENTER — descend deeper (1 Gear)'
        : 'the keymaster holds the Gear') + '   ·   E — ride home';
    } else prompt = 'E — ride home · the Founder waits north';
    ctx.fillText(prompt, W / 2, H - 69);
    ctx.textAlign = 'left';
  }

  // blessings, bottom-left
  run.blessings.forEach((id, i) => {
    const y = H - 18 - i * 20;
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.moveTo(24, y - 9);
    ctx.lineTo(29, y - 4);
    ctx.lineTo(24, y + 1);
    ctx.lineTo(19, y - 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c9c9e0';
    ctx.font = '12px monospace';
    ctx.fillText(BLESSINGS[id].name, 38, y);
  });

  // floor label, bottom-right (sub-biome rooms show their own name)
  const basePal = floorPal();
  const placeName = run.room.biome === 1 && basePal.sub ? basePal.sub.name : basePal.name;
  ctx.textAlign = 'right';
  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = '#8888aa';
  ctx.fillText((run.floor < 0 ? placeName
    : 'Floor ' + (run.floor + 1) + ' — ' + placeName) +
    '  ·  Crypt level ' + (save.wins + 1), W - 14, H - 14);
  ctx.textAlign = 'left';

  // minigame score and clock
  if (run.minigame) {
    const mg = run.minigame;
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#7de8ff';
    const timed = mg.id === 'range' || mg.id === 'coins' || mg.id === 'whack' || mg.id === 'blitz';
    ctx.fillText('SCORE ' + mg.score +
      (timed ? '   ·   ' + Math.max(0, Math.ceil(mg.t)) + 's left'
        : '   ·   ' + Math.floor(mg.t) + 's'), W / 2, 30);
    ctx.textAlign = 'left';
  }

  // boss health bar
  const boss = run.enemies.find(e => e.type === 'boss');
  if (boss) {
    ctx.fillStyle = '#000000aa';
    ctx.fillRect(W / 2 - 200, 18, 400, 20);
    ctx.fillStyle = '#a03050';
    ctx.fillRect(W / 2 - 198, 20, 396 * Math.max(0, boss.hp / boss.maxHp), 16);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CURSED GREG, THE FOUNDER', W / 2, 32);
  }

  if (!h.noMap && run.floor >= 0) drawMinimap();
}

function drawMinimap() {
  const cell = 17, gap = 3;
  const cur = run.room;
  const originX = W - 90, originY = 60;

  run.dungeon.rooms.forEach(r => {
    if (!r.seen) return;
    const x = originX + (r.x - cur.x) * (cell + gap);
    const y = originY + (r.y - cur.y) * (cell + gap);
    if (x < W - 175 || x > W - 15 || y < 12 || y > 120) return;

    if (r.visited) ctx.fillStyle = r === cur ? '#8fb4ff' : '#4a4a66';
    else ctx.fillStyle = '#26263a';
    ctx.fillRect(x, y, cell, cell * 0.75);

    // drawn markers: red diamond = boss, gold dot = treasure, cyan arrow = elevator
    const cx = x + cell / 2, cy = y + cell * 0.375;
    if (r.type === 'boss') {
      ctx.fillStyle = '#ff5a5a';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 5);
      ctx.lineTo(cx + 5, cy);
      ctx.lineTo(cx, cy + 5);
      ctx.lineTo(cx - 5, cy);
      ctx.closePath();
      ctx.fill();
    } else if (r.type === 'treasure') {
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (r.type === 'start') {
      // the elevator: up and down arrows
      ctx.fillStyle = '#7de8ff';
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy - 1);
      ctx.lineTo(cx, cy - 6);
      ctx.lineTo(cx + 4, cy - 1);
      ctx.closePath();
      ctx.moveTo(cx - 4, cy + 1);
      ctx.lineTo(cx, cy + 6);
      ctx.lineTo(cx + 4, cy + 1);
      ctx.closePath();
      ctx.fill();
    } else if (r.type === 'gauntlet') {
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(cx - 1.5, cy - 5, 3, 6);
      ctx.fillRect(cx - 1.5, cy + 3, 3, 3);
    } else if (r.type === 'vault') {
      ctx.strokeStyle = '#ffd75e';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - 4, cy - 4, 8, 8);
    } else if (r.type === 'guardian') {
      // the keymaster: a little gear
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a6a1e';
      ctx.beginPath();
      ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (r.type === 'shop') {
      ctx.fillStyle = '#7dff8a';
      ctx.fillRect(cx - 4, cy - 2, 8, 5);
      ctx.fillRect(cx - 2, cy - 5, 4, 3);
    } else if (r.type === 'secret') {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (r.type === 'puzzle') {
      ctx.fillStyle = '#ff9a3a';
      ctx.fillRect(cx - 3, cy - 3, 7, 7);
    } else if (r.type === 'arena') {
      ctx.strokeStyle = '#ff5a5a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (r.type === 'spring') {
      ctx.fillStyle = '#7de8ff';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (r.type === 'prison') {
      ctx.fillStyle = '#c9c9e0';
      ctx.fillRect(cx - 4, cy - 4, 2, 9);
      ctx.fillRect(cx - 1, cy - 4, 2, 9);
      ctx.fillRect(cx + 2, cy - 4, 2, 9);
    } else if (r.type === 'shrine') {
      ctx.fillStyle = '#c9a5ff';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 5);
      ctx.lineTo(cx + 5, cy + 4);
      ctx.lineTo(cx - 5, cy + 4);
      ctx.closePath();
      ctx.fill();
    }
  });
}

// ---------------------------------------------------------
// Screens
// ---------------------------------------------------------
function drawTitle() {
  ctx.fillStyle = '#11111a';
  ctx.fillRect(0, 0, W, H);

  // drifting dust motes
  for (let i = 0; i < 24; i++) {
    const px = (hash2(i, 7) * W + animT * (6 + hash2(i, 3) * 14)) % W;
    const py = hash2(i, 13) * H;
    ctx.globalAlpha = 0.12 + hash2(i, 5) * 0.15;
    ctx.fillStyle = '#c9b8ff';
    ctx.fillRect(px, py, 2, 2);
  }
  ctx.globalAlpha = 1;

  // the ghost of Sir Greg drifts behind the title
  const gx = W / 2 + Math.sin(animT * 0.7) * 180;
  const gy = 150 + Math.sin(animT * 1.3) * 16;
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#c9b8ff';
  ctx.beginPath();
  ctx.arc(gx, gy, 36, Math.PI, 0);
  ctx.lineTo(gx + 36, gy + 30);
  for (let i = 0; i < 4; i++) {
    ctx.quadraticCurveTo(gx + 36 - (i + 0.5) * 18, gy + 40, gx + 36 - (i + 1) * 18, gy + 30);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd75e';
  ctx.font = 'bold 64px monospace';
  ctx.fillText('DESCENDANTS', W / 2, 180 + Math.sin(animT * 1.5) * 3);

  ctx.fillStyle = '#8888aa';
  ctx.font = '17px monospace';
  ctx.fillText('Sir Greg fell in the Cursed Crypt. His ghost now rules it.', W / 2, 240);
  ctx.fillText('One by one, his descendants descend to set him free.', W / 2, 266);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px monospace';
  if (Math.floor(animT * 1.6) % 2 === 0) ctx.fillText('Press ENTER to begin', W / 2, 360);
  ctx.fillStyle = '#7de8ff';
  ctx.font = '15px monospace';
  ctx.fillText('G — minigames', W / 2, 396);

  ctx.fillStyle = '#666680';
  ctx.font = '14px monospace';
  ctx.fillText('WASD / arrows — move · SPACE / J — attack · SHIFT / K — special', W / 2, 448);
  ctx.fillText('E — interact / inventory · Q — use item · TAB / wheel — switch item', W / 2, 472);
  ctx.fillText('Forge and brew in the crypt. Watch the lantern — when it dies, the Shade comes.', W / 2, 496);

  if (save.family) {
    ctx.fillStyle = '#8888aa';
    ctx.fillText('House ' + save.family + ' · generation ' + save.generation +
      ' · victories: ' + save.wins + ' · bank: ' + save.gold + ' gold', W / 2, 540);
  }
  ctx.fillStyle = confirmReset ? '#ff5a5a' : '#553344';
  ctx.fillText(confirmReset
    ? 'Really erase EVERYTHING? Press R again to confirm.'
    : '(press R twice for a full reset)', W / 2, 564);
}

// Minigame world furniture: lava tiles and blitz boards.
function drawMinigameWorld() {
  const mg = run.minigame;
  if (mg.id === 'lava') {
    for (const tl of mg.tiles) {
      const x = tl.tx * TILE, y = tl.ty * TILE;
      if (tl.phase === 'warn') {
        const pulse = 0.35 + Math.sin(animT * 14) * 0.2;
        ctx.strokeStyle = 'rgba(255, 154, 58, ' + pulse + ')';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
      } else {
        ctx.fillStyle = 'rgba(255, 90, 40, 0.65)';
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        ctx.fillStyle = 'rgba(255, 200, 100, 0.5)';
        ctx.fillRect(x + 12, y + 12, TILE - 24, TILE - 24);
      }
    }
  } else if (mg.id === 'blitz' && mg.pz) {
    drawPuzzleLightsOut(mg.pz);
  } else if (mg.id === 'mimics') {
    for (const c of mg.chests) {
      if (c.open) {
        ctx.fillStyle = '#3a2a1a';
        ctx.fillRect(c.x - 17, c.y - 10, 34, 22);
        ctx.fillStyle = '#241a10';
        ctx.fillRect(c.x - 14, c.y - 7, 28, 12);
      } else {
        ctx.fillStyle = '#8a5a2a';
        ctx.fillRect(c.x - 17, c.y - 12, 34, 24);
        ctx.fillStyle = '#6a441e';
        ctx.fillRect(c.x - 17, c.y - 12, 34, 8);
        ctx.fillStyle = '#ffd75e';
        ctx.fillRect(c.x - 3, c.y - 6, 6, 7);
      }
    }
  } else if (mg.id === 'flame') {
    for (const b of mg.braziers) {
      ctx.fillStyle = '#4a4a55';
      ctx.beginPath();
      ctx.arc(b.x, b.y + 6, 13, 0, Math.PI * 2);
      ctx.fill();
      if (b.lit) {
        const fl = 1 + Math.sin(animT * 11 + b.x) * 0.2;
        ctx.fillStyle = 'rgba(255, 160, 60, 0.25)';
        ctx.beginPath();
        ctx.arc(b.x, b.y - 4, 30 * fl, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff9a3a';
        ctx.beginPath();
        ctx.arc(b.x, b.y - 4, 8 * fl, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe08a';
        ctx.beginPath();
        ctx.arc(b.x, b.y - 6, 4 * fl, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#2a2a33';
        ctx.beginPath();
        ctx.arc(b.x, b.y - 3, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (mg.id === 'snake') {
    for (let i = mg.segs - 1; i >= 0; i--) {
      const seg = mg.trail[(i + 1) * 13];
      if (!seg) continue;
      ctx.fillStyle = i < 2 ? '#cfc8b8' : '#e8e2d0';
      ctx.beginPath();
      ctx.arc(seg.x, seg.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#22222c';
      ctx.fillRect(seg.x - 5, seg.y - 3, 3, 4);
      ctx.fillRect(seg.x + 2, seg.y - 3, 3, 4);
    }
  } else if (mg.id === 'simon') {
    SIMON_PADS.forEach((pad, i) => {
      const showing = mg.phase === 'show' && mg.showI < mg.seq.length &&
        mg.seq[mg.showI] === i && mg.phaseT > 0.18;
      const lit = showing || (mg.flash && mg.flash.i === i);
      ctx.globalAlpha = lit ? 1 : 0.3;
      ctx.fillStyle = pad.color;
      ctx.fillRect(pad.x - 36, pad.y - 36, 72, 72);
      ctx.globalAlpha = 1;
      if (lit) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.strokeRect(pad.x - 40, pad.y - 40, 80, 80);
      }
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = mg.phase === 'show' ? '#8888aa' : '#7de8ff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(mg.phase === 'show' ? 'Watch...' : 'Repeat! (' + mg.inputI + '/' + mg.seq.length + ')',
      W / 2, IY0 + 40);
    ctx.textAlign = 'left';
  }
}

// The minigames menu: a whole arcade cabinet of small games.
function drawMinigamesMenu() {
  ctx.fillStyle = '#11111a';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#7de8ff';
  ctx.font = 'bold 30px monospace';
  ctx.fillText('MINIGAMES', W / 2, 62);
  ctx.fillStyle = '#8888aa';
  ctx.font = '13px monospace';
  ctx.fillText('The crypt, without the consequences.', W / 2, 88);

  MINIGAMES.forEach((mgd, i) => {
    const y = 112 + i * 33;
    const sel = i === minigameIndex;
    if (sel) {
      ctx.fillStyle = '#26263a';
      ctx.fillRect(W / 2 - 290, y, 580, 30);
      ctx.strokeStyle = '#7de8ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(W / 2 - 290, y, 580, 30);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = sel ? '#ffffff' : '#a8a8c0';
    ctx.font = (sel ? 'bold ' : '') + '16px monospace';
    ctx.fillText(mgd.name, W / 2 - 268, y + 21);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd75e';
    ctx.font = '14px monospace';
    ctx.fillText('best ' + (save.minigames[mgd.id] || 0), W / 2 + 268, y + 21);
    ctx.textAlign = 'center';
  });

  const cur = MINIGAMES[minigameIndex];
  ctx.fillStyle = '#7de8ff';
  ctx.font = '14px monospace';
  ctx.fillText(cur.desc, W / 2, 112 + MINIGAMES.length * 33 + 26);

  ctx.fillStyle = '#666680';
  ctx.font = '13px monospace';
  ctx.fillText('↑↓ choose · ENTER play · ESC back', W / 2, H - 18);
}

function drawMgOver() {
  const mg = run.minigame;
  const mgd = MINIGAMES.find(d => d.id === mg.id);
  ctx.fillStyle = 'rgba(8, 12, 18, 0.82)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#7de8ff';
  ctx.font = 'bold 40px monospace';
  ctx.fillText(mgd.name.toUpperCase() + ' OVER', W / 2, 220);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px monospace';
  ctx.fillText('Score: ' + mg.score, W / 2, 290);
  ctx.fillStyle = mg.score >= (save.minigames[mg.id] || 0) && mg.score > 0 ? '#ffd75e' : '#8888aa';
  ctx.font = '17px monospace';
  ctx.fillText(mg.score >= (save.minigames[mg.id] || 0) && mg.score > 0
    ? 'A new best!' : 'Best: ' + (save.minigames[mg.id] || 0), W / 2, 326);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px monospace';
  ctx.fillText('Press ENTER for the menu', W / 2, 420);
}

function drawNameEntry() {
  ctx.fillStyle = '#11111a';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px monospace';
  ctx.fillText('Name your house', W / 2, 200);
  ctx.fillStyle = '#8888aa';
  ctx.font = '16px monospace';
  ctx.fillText('The descendants of Sir Greg need a family name.', W / 2, 240);

  // input box
  ctx.fillStyle = '#1a1a28';
  ctx.fillRect(W / 2 - 220, 290, 440, 56);
  ctx.strokeStyle = '#ffd75e';
  ctx.lineWidth = 2;
  ctx.strokeRect(W / 2 - 220, 290, 440, 56);

  const shown = nameBuffer || '';
  const cursor = Math.floor(animT * 2.5) % 2 === 0 ? '_' : ' ';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px monospace';
  ctx.fillText('House ' + shown + cursor, W / 2, 328);

  ctx.fillStyle = '#666680';
  ctx.font = '14px monospace';
  ctx.fillText('Type a name · ENTER to confirm' + (shown ? '' : ' (or leave blank for House Greg)'), W / 2, 400);
}

function drawHeirs() {
  ctx.fillStyle = '#11111a';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  const fateLine = {
    fallen: ' has fallen.',
    retired: ' retired to count their gold.',
    triumphant: ' freed Sir Greg... for a while.',
  }[save.lastFate] || ' has fallen.';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px monospace';
  ctx.fillText(save.lastName + fateLine, W / 2, 76);
  ctx.fillStyle = '#8888aa';
  ctx.font = '16px monospace';
  ctx.fillText('House ' + (save.family || 'Greg') + ' sends its next descendant  (← → pick, ENTER descend)', W / 2, 110);

  const cardW = 280, cardH = 340, gapX = 24;
  const startX = W / 2 - (cardW * 3 + gapX * 2) / 2;

  heirsOffered.forEach((heir, i) => {
    const x = startX + i * (cardW + gapX);
    const y = 150;
    const sel = i === heirIndex;
    const c = CLASSES[heir.classId];

    ctx.fillStyle = sel ? '#26263a' : '#1a1a28';
    ctx.fillRect(x, y, cardW, cardH);
    ctx.strokeStyle = sel ? c.color : '#33334a';
    ctx.lineWidth = sel ? 3 : 1;
    ctx.strokeRect(x, y, cardW, cardH);

    const bob = sel ? Math.sin(animT * 3) * 3 : 0;
    drawHeroSprite(x + cardW / 2, y + 66 + bob, 30, heir.classId, -Math.PI / 2);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 19px monospace';
    ctx.fillText(heir.name, x + cardW / 2, y + 130);
    ctx.fillStyle = c.color;
    ctx.font = 'bold 16px monospace';
    ctx.fillText(c.name, x + cardW / 2, y + 152);
    ctx.fillStyle = '#8888aa';
    ctx.font = '11px monospace';
    ctx.fillText(c.desc, x + cardW / 2, y + 170);
    ctx.fillStyle = '#ffd75e';
    ctx.fillText(c.passive, x + cardW / 2, y + 188);
    ctx.fillStyle = '#7de8ff';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(c.special.name + ' (SHIFT)', x + cardW / 2, y + 208);
    ctx.fillStyle = '#8888aa';
    ctx.font = '11px monospace';
    ctx.fillText(c.special.desc, x + cardW / 2, y + 224);

    let ty = y + 254;
    if (heir.traits.length === 0) {
      ctx.fillStyle = '#666680';
      ctx.fillText('No traits. Suspiciously normal.', x + cardW / 2, ty);
    }
    for (const t of heir.traits) {
      ctx.fillStyle = '#ffd75e';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(TRAITS[t].name, x + cardW / 2, ty);
      ctx.fillStyle = '#8888aa';
      ctx.font = '12px monospace';
      ctx.fillText(TRAITS[t].desc, x + cardW / 2, ty + 18);
      ty += 46;
    }
  });

  ctx.fillStyle = '#666680';
  ctx.font = '14px monospace';
  ctx.fillText('Generation ' + save.generation + ' · Crypt level ' + (save.wins + 1), W / 2, 560);
}

function drawDescend() {
  ctx.fillStyle = '#08080e';
  ctx.fillRect(0, 0, W, H);

  const t = descend.t;
  ctx.save();
  ctx.translate((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);

  // shaft walls rushing upward
  ctx.strokeStyle = '#26263a';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 160, 0); ctx.lineTo(W / 2 - 160, H);
  ctx.moveTo(W / 2 + 160, 0); ctx.lineTo(W / 2 + 160, H);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#33334a';
  const offset = 70 - (t * 420) % 70;
  ctx.beginPath();
  for (let y = -70 + offset; y < H + 70; y += 70) {
    ctx.moveTo(W / 2 - 160, y); ctx.lineTo(W / 2 - 200, y + 24);
    ctx.moveTo(W / 2 + 160, y); ctx.lineTo(W / 2 + 200, y + 24);
  }
  ctx.stroke();

  // rising dust
  for (let i = 0; i < 18; i++) {
    const px = W / 2 - 150 + hash2(i, 3) * 300;
    const py = (hash2(i, 9) * H - t * 260 + H) % H;
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#8888aa';
    ctx.fillRect(px, py, 2, 8);
  }
  ctx.globalAlpha = 1;

  // the elevator car
  const carY = 260;
  ctx.strokeStyle = '#454558';
  ctx.lineWidth = 3;
  ctx.beginPath(); // cables
  ctx.moveTo(W / 2 - 70, 0); ctx.lineTo(W / 2 - 70, carY - 70);
  ctx.moveTo(W / 2 + 70, 0); ctx.lineTo(W / 2 + 70, carY - 70);
  ctx.stroke();
  ctx.fillStyle = '#2a2a38';
  ctx.fillRect(W / 2 - 100, carY - 70, 200, 150);
  ctx.strokeStyle = '#454558';
  ctx.strokeRect(W / 2 - 100, carY - 70, 200, 150);
  ctx.fillStyle = '#1a1a26';
  ctx.fillRect(W / 2 - 84, carY - 54, 168, 118);

  drawHeroSprite(W / 2, carY + 20, 16, run.hero.heir.classId, Math.PI / 2);
  ctx.restore();

  // arriving floor name fades in
  const toFloor = FLOORS[descend.toFloor];
  if (t > 0.8) {
    ctx.globalAlpha = Math.min(1, (t - 0.8) / 0.5);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px monospace';
    ctx.fillText('Floor ' + (descend.toFloor + 1), W / 2, 480);
    ctx.fillStyle = '#8888aa';
    ctx.font = '18px monospace';
    ctx.fillText(toFloor.name, W / 2, 514);
    ctx.globalAlpha = 1;
  }
}

// Estate layout: stats on the left, class unlocks on the right.
const ESTATE_STATS = ['vitality', 'strength', 'agility', 'fortune', 'recovery'];
const ESTATE_CLASSES = Object.keys(CLASSES).filter(id => !!CLASSES[id].task);

function drawEstate() {
  ctx.fillStyle = '#11111a';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#ffd75e';
  ctx.font = 'bold 30px monospace';
  ctx.fillText('THE FAMILY ESTATE', W / 2, 62);
  ctx.fillStyle = '#8888aa';
  ctx.font = '15px monospace';
  ctx.fillText('Spend the inheritance. Everything here lasts forever.', W / 2, 90);

  ctx.beginPath();
  ctx.arc(W / 2 - 62, 118, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd75e';
  ctx.fill();
  ctx.strokeStyle = '#b8952e';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(save.gold + ' gold', W / 2 - 46, 124);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#8888aa';
  ctx.font = 'bold 15px monospace';
  ctx.fillText('BLOODLINE', 250, 168);
  ctx.fillText('TRAINING HALL', 710, 168);

  // left column: stat upgrades
  ESTATE_STATS.forEach((id, i) => {
    const u = UPGRADES[id];
    const level = save.upgrades[id];
    const cost = Math.floor(u.base * Math.pow(1.7, level));
    const maxed = level >= UPGRADE_MAX;
    const y = 168 + i * 76;
    const sel = estateIndex === i;

    ctx.fillStyle = sel ? '#26263a' : '#1a1a28';
    ctx.fillRect(40, y, 420, 64);
    if (sel) {
      ctx.strokeStyle = '#ffd75e';
      ctx.lineWidth = 2;
      ctx.strokeRect(40, y, 420, 64);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(u.name, 60, y + 26);
    ctx.fillStyle = '#8888aa';
    ctx.font = '12px monospace';
    ctx.fillText(u.desc, 60, y + 46);

    for (let p = 0; p < UPGRADE_MAX; p++) {
      ctx.fillStyle = p < level ? '#ffd75e' : '#33334a';
      ctx.fillRect(230 + p * 15, y + 36, 10, 10);
    }

    ctx.textAlign = 'right';
    ctx.font = 'bold 14px monospace';
    if (maxed) {
      ctx.fillStyle = '#7dff8a';
      ctx.fillText('MAX', 440, y + 28);
    } else {
      ctx.fillStyle = save.gold >= cost ? '#ffd75e' : '#775544';
      ctx.fillText(cost + ' g', 440, y + 28);
    }
  });

  // right column: classes earn their way in with deeds, not gold
  ESTATE_CLASSES.forEach((id, i) => {
    const c = CLASSES[id];
    const owned = save.classes[id];
    const y = 168 + i * 42;
    const sel = estateIndex === i + ESTATE_STATS.length;

    ctx.fillStyle = sel ? '#26263a' : '#1a1a28';
    ctx.fillRect(500, y, 420, 36);
    if (sel) {
      ctx.strokeStyle = '#7de8ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(500, y, 420, 36);
    }

    drawHeroSprite(526, y + 18, 10, id, -Math.PI / 2);

    ctx.textAlign = 'left';
    ctx.fillStyle = owned ? '#ffffff' : '#c9c9e0';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(c.name, 548, y + 23);

    ctx.textAlign = 'right';
    ctx.font = 'bold 13px monospace';
    if (owned) {
      ctx.fillStyle = '#7dff8a';
      ctx.fillText('JOINED', 900, y + 23);
    } else {
      const done = Math.min(taskValue(c.task.stat), c.task.need);
      ctx.fillStyle = done > 0 ? '#ffd75e' : '#775544';
      ctx.fillText(done + ' / ' + c.task.need, 900, y + 23);
    }
  });

  // detail strip for whatever is selected
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  if (estateIndex >= ESTATE_STATS.length) {
    const c = CLASSES[ESTATE_CLASSES[estateIndex - ESTATE_STATS.length]];
    if (!save.classes[ESTATE_CLASSES[estateIndex - ESTATE_STATS.length]]) {
      ctx.fillStyle = '#ffd75e';
      ctx.fillText('Task: ' + c.task.text, W / 2, 562);
    } else {
      ctx.fillStyle = '#c9c9e0';
      ctx.fillText(c.desc + '  ·  ' + c.passive, W / 2, 562);
    }
    ctx.fillStyle = '#7de8ff';
    ctx.fillText(c.special.name + ' (SHIFT): ' + c.special.desc, W / 2, 582);
  } else {
    ctx.fillStyle = '#666680';
    ctx.fillText('Permanent upgrades for every future descendant.', W / 2, 576);
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px monospace';
  ctx.fillText('arrows navigate · ENTER buy · SPACE continue to the crypt', W / 2, 618);
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(10, 5, 10, 0.82)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#ff5a5a';
  ctx.font = 'bold 40px monospace';
  ctx.fillText('HERE LIES ' + run.hero.heir.name.toUpperCase(), W / 2, 200);
  ctx.fillStyle = '#8888aa';
  ctx.font = 'bold 18px monospace';
  ctx.fillText('of House ' + (save.family || 'Greg'), W / 2, 234);

  ctx.font = '16px monospace';
  ctx.fillText('Slain by ' + run.lastHit + ' on floor ' + (run.floor + 1) +
    ' after ' + Math.round(run.time) + ' seconds.', W / 2, 284);
  ctx.fillText(run.gold + ' gold sent home · ' + run.kills + ' monsters slain · ' +
    run.roomsCleared + ' rooms cleared', W / 2, 312);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('Press ENTER — the family endures', W / 2, 400);
}

function drawVictory() {
  ctx.fillStyle = 'rgba(20, 16, 4, 0.82)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#ffd75e';
  ctx.font = 'bold 44px monospace';
  ctx.fillText('THE CURSE IS LIFTED', W / 2, 210);

  ctx.fillStyle = '#ffffff';
  ctx.font = '18px monospace';
  ctx.fillText(run.hero.heir.name + ' of House ' + (save.family || 'Greg') +
    ' has freed the ghost of Sir Greg.', W / 2, 262);
  ctx.fillStyle = '#8888aa';
  ctx.font = '16px monospace';
  ctx.fillText(run.gold + ' gold brought home · ' + run.kills + ' monsters slain', W / 2, 296);
  ctx.fillText('...but curses run deep. The crypt stirs again, stronger.', W / 2, 340);
  ctx.fillText('Crypt level ' + (save.wins + 1) + ' awaits the next generation.', W / 2, 366);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('Press ENTER to continue the lineage', W / 2, 440);
}

function drawRetired() {
  ctx.fillStyle = 'rgba(6, 12, 16, 0.82)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#7de8ff';
  ctx.font = 'bold 40px monospace';
  ctx.fillText(run.hero.heir.name.toUpperCase() + ' RETIRED', W / 2, 210);

  ctx.fillStyle = '#8888aa';
  ctx.font = '16px monospace';
  ctx.fillText('Rode the elevator home from floor ' + (run.floor + 1) +
    ' with ' + run.gold + ' gold.', W / 2, 262);
  ctx.fillText(run.kills + ' monsters slain · ' + run.roomsCleared + ' rooms cleared', W / 2, 290);
  ctx.fillText('Not every legend dies in the dark. Some just get rich.', W / 2, 334);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('Press ENTER — the family prospers', W / 2, 420);
}

function drawPauseOverlay() {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('PAUSED', W / 2, H / 2);
  ctx.font = '15px monospace';
  ctx.fillStyle = '#8888aa';
  ctx.fillText('P to resume', W / 2, H / 2 + 36);
}

// ---------------------------------------------------------
// Input
// ---------------------------------------------------------
function proceedFromTitle() {
  checkClassTasks();
  const anyUpgrades = Object.values(save.upgrades).some(v => v > 0) ||
    Object.keys(CLASSES).some(id => CLASSES[id].task && save.classes[id]);
  if (save.gold > 0 || anyUpgrades) { state = 'estate'; estateIndex = 0; }
  else { offerHeirs(); state = 'heirs'; }
}

function confirmHeir() {
  startRun(heirsOffered[heirIndex]);
}

window.addEventListener('keydown', e => {
  SFX.ensure();
  const key = e.key.toLowerCase();
  keys[key] = true;

  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(key)) {
    e.preventDefault();
  }
  if (key === 'm') { muted = SFX.toggleMute(); MUSIC.toggleMute(); }

  if (state === 'title') {
    if (key === 'enter') {
      confirmReset = false;
      SFX.select();
      if (!save.family) { nameBuffer = ''; state = 'name'; }
      else proceedFromTitle();
    } else if (key === 'g') {
      confirmReset = false;
      minigameIndex = 0;
      state = 'minigames';
      SFX.select();
    } else if (key === 'r') {
      if (!confirmReset) {
        confirmReset = true;
        SFX.denied();
      } else {
        // the full reset: everything gone, back to the very beginning
        confirmReset = false;
        try { localStorage.removeItem(SAVE_KEY); } catch (err) {}
        save = defaultSave();
        SFX.curse();
      }
    } else {
      confirmReset = false;
    }
  } else if (state === 'name') {
    if (key === 'enter') {
      save.family = (nameBuffer.trim() || 'Greg');
      saveGame();
      SFX.select();
      proceedFromTitle();
    } else if (key === 'backspace') {
      nameBuffer = nameBuffer.slice(0, -1);
      SFX.type();
    } else if (e.key.length === 1 && /[a-zA-Z0-9 '-]/.test(e.key) && nameBuffer.length < 14) {
      nameBuffer += e.key;
      SFX.type();
    }
  } else if (state === 'estate') {
    const leftLen = ESTATE_STATS.length, rightLen = ESTATE_CLASSES.length;
    const inLeft = estateIndex < leftLen;
    const colLen = inLeft ? leftLen : rightLen;
    const row = inLeft ? estateIndex : estateIndex - leftLen;
    if (key === 'arrowup' || key === 'w') {
      const r = (row + colLen - 1) % colLen;
      estateIndex = inLeft ? r : leftLen + r;
      SFX.select();
    } else if (key === 'arrowdown' || key === 's') {
      const r = (row + 1) % colLen;
      estateIndex = inLeft ? r : leftLen + r;
      SFX.select();
    } else if (key === 'arrowleft' || key === 'arrowright' || key === 'a' || key === 'd') {
      estateIndex = inLeft
        ? leftLen + Math.min(row, rightLen - 1)
        : Math.min(row, leftLen - 1);
      SFX.select();
    } else if (key === 'enter') {
      if (inLeft) {
        const id = ESTATE_STATS[estateIndex];
        const u = UPGRADES[id];
        const level = save.upgrades[id];
        const cost = Math.floor(u.base * Math.pow(1.7, level));
        if (level < UPGRADE_MAX && save.gold >= cost) {
          save.gold -= cost;
          save.upgrades[id] += 1;
          saveGame();
          SFX.buy();
        } else SFX.denied();
      } else {
        SFX.denied(); // classes join for deeds, not gold
      }
    } else if (key === ' ' || key === 'escape') {
      offerHeirs();
      state = 'heirs';
      SFX.select();
    }
  } else if (state === 'heirs') {
    if (key === 'arrowleft' || key === 'a') { heirIndex = (heirIndex + 2) % 3; SFX.select(); }
    else if (key === 'arrowright' || key === 'd') { heirIndex = (heirIndex + 1) % 3; SFX.select(); }
    else if (key === '1' || key === '2' || key === '3') { heirIndex = Number(key) - 1; SFX.select(); }
    else if (key === 'enter') { SFX.select(); confirmHeir(); }
  } else if (state === 'minigames') {
    if (key === 'arrowup' || key === 'w') { minigameIndex = (minigameIndex + MINIGAMES.length - 1) % MINIGAMES.length; SFX.select(); }
    else if (key === 'arrowdown' || key === 's') { minigameIndex = (minigameIndex + 1) % MINIGAMES.length; SFX.select(); }
    else if (key === 'enter') { SFX.select(); startMinigame(MINIGAMES[minigameIndex].id); }
    else if (key === 'escape') { state = 'title'; SFX.select(); }
  } else if (state === 'mgover') {
    if (key === 'enter' || key === 'escape') { state = 'title'; SFX.select(); }
  } else if (state === 'play') {
    if (menu) {
      handleMenuKey(key);
    } else if (key === 'p') paused = !paused;
    else if (!paused && key === 'q') useItem();
    else if (!paused && key === 'tab') cycleItem(1);
    else if (!paused && key >= '1' && key <= '9') {
      const idx = Number(key) - 1;
      if (idx < run.hero.items.length) { run.hero.itemSel = idx; SFX.select(); }
    }
    else if (!paused && key === 'enter' && run.onElevator) tryBoardElevator();
    else if (!paused && key === 'e') {
      const chest = nearestChest();
      const swap = nearestEquip();
      if (run.minigame && minigamePress()) {}
      else if (run.onElevator && run.floor >= 0 && !run.minigame) retire();
      else if (run.room.type === 'shrine' && !run.room.shrineUsed &&
               Math.hypot(run.hero.x - W / 2, run.hero.y - (H / 2 - 10)) < 85) prayShrine();
      else if (chest) openChest(chest);
      else if (swap) {
        run.room.loot.equip = run.room.loot.equip.filter(q => q !== swap);
        equipItem(swap.def);
      }
      else if (nearestShopItem()) tryBuy();
      else if (run.room.ghostHeir && run.room.ghostSpot &&
               Math.hypot(run.hero.x - run.room.ghostSpot.x, run.hero.y - run.room.ghostSpot.y) < 70) recruitGhost();
      else if (run.room.type === 'puzzle' && puzzleInteract()) {}
      else if (run.room.type === 'gauntlet' && run.room.gauntlet.state === 'idle' &&
               Math.hypot(run.hero.x - W / 2, run.hero.y - (IY0 + 90)) < 75) startGauntlet();
      else if (run.room.type === 'arena' && run.room.arena.state === 'idle' &&
               Math.hypot(run.hero.x - W / 2, run.hero.y - (IY0 + 90)) < 75) startArena();
      else if (run.room.type === 'spring' && !run.room.springUsed &&
               Math.hypot(run.hero.x - W / 2, run.hero.y - H / 2) < 75) drinkSpring();
      else if (run.room.type === 'prison' && !run.room.prisonOpened &&
               Math.hypot(run.hero.x - W / 2, run.hero.y - (H / 2 - 10)) < 80) openPrison();
      else if (nearUsable('pot')) eatStew(nearUsable('pot'));
      else if (nearUsable('keg')) tapKeg(nearUsable('keg'));
      else if (nearestHurtAlly()) feedAlly(nearestHurtAlly());
      else if (nearFurniture('craft') || nearFurniture('brew')) {
        // in a workshop both stations sit together: open the nearer one
        const c1 = nearestFurnitureOf('craft');
        const b1 = nearestFurnitureOf('brew');
        menu = (!b1 || (c1 && c1.d < b1.d)) ? 'craft' : 'brew';
        menuIndex = 0;
        SFX.select();
      }
      else { menu = 'inventory'; SFX.select(); }
    }
  } else if (state === 'gameover' || state === 'victory' || state === 'retired') {
    if (key === 'enter') {
      SFX.select();
      state = 'estate';
      estateIndex = 0;
    }
  }
});

function handleMenuKey(key) {
  if (key === 'e' || key === 'escape') { menu = null; SFX.select(); return; }
  if (menu === 'chest') {
    const c = activeChest;
    if (!c || !c.contents || c.contents.length === 0) { menu = null; return; }
    const cols = 6;
    if (key === 'arrowleft' || key === 'a') { menuIndex = Math.max(0, menuIndex - 1); SFX.select(); }
    else if (key === 'arrowright' || key === 'd') { menuIndex = Math.min(c.contents.length - 1, menuIndex + 1); SFX.select(); }
    else if (key === 'arrowup' || key === 'w') { menuIndex = Math.max(0, menuIndex - cols); SFX.select(); }
    else if (key === 'arrowdown' || key === 's') { menuIndex = Math.min(c.contents.length - 1, menuIndex + cols); SFX.select(); }
    else if (key === 'enter' || key === 'q') {
      const r = takeChestEntry(c.contents[menuIndex], false);
      if (r === 'remove') c.contents.splice(menuIndex, 1);
      menuIndex = Math.max(0, Math.min(menuIndex, c.contents.length - 1));
      if (c.contents.length === 0) menu = null;
    } else if (key === ' ') {
      // take everything that fits
      for (let i = c.contents.length - 1; i >= 0; i--) {
        if (takeChestEntry(c.contents[i], true) === 'remove') c.contents.splice(i, 1);
      }
      menuIndex = Math.max(0, Math.min(menuIndex, c.contents.length - 1));
      if (c.contents.length === 0) menu = null;
    }
    return;
  }
  if (menu === 'floors') {
    const count = save.floorUnlocked + 1;
    if (key === 'arrowup' || key === 'w') { menuIndex = (menuIndex + count - 1) % count; SFX.select(); }
    else if (key === 'arrowdown' || key === 's') { menuIndex = (menuIndex + 1) % count; SFX.select(); }
    else if (key === 'enter') descendTo(menuIndex);
  } else if (menu === 'inventory') {
    if (key === 'tab' || key === 'arrowright' || key === 'd') cycleItem(1);
    else if (key === 'arrowleft' || key === 'a') cycleItem(-1);
    else if (key === 'q') useItem();
  } else {
    const list = RECIPES[menu];
    if (key === 'arrowup' || key === 'w') { menuIndex = (menuIndex + list.length - 1) % list.length; SFX.select(); }
    else if (key === 'arrowdown' || key === 's') { menuIndex = (menuIndex + 1) % list.length; SFX.select(); }
    else if (key === 'enter') attemptRecipe(list[menuIndex]);
  }
}

window.addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false;
});

// Mouse aim: the cursor is the crosshair; click (or hold) to attack.
const mouse = { x: W / 2, y: H / 2, active: false, down: false };
window.addEventListener('mousemove', e => {
  if (typeof canvas.getBoundingClientRect !== 'function') return;
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  mouse.x = (e.clientX - r.left) * (W / r.width);
  mouse.y = (e.clientY - r.top) * (H / r.height);
  mouse.active = true;
});
window.addEventListener('mousedown', () => {
  SFX.ensure();
  if (state === 'play' && !paused && !menu) mouse.down = true;
});
window.addEventListener('mouseup', () => { mouse.down = false; });

// mouse wheel scrolls through carried items
window.addEventListener('wheel', e => {
  if (state === 'play' && run && !paused) {
    cycleItem(e.deltaY > 0 ? 1 : -1);
  }
}, { passive: true });

// ---------------------------------------------------------
// Main loop
// ---------------------------------------------------------
let lastTime = 0;
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05); // clamp big frame gaps
  lastTime = now;
  animT += dt;
  if (state === 'play' && !paused && !menu) update(dt); // menus freeze the crypt
  else if (state === 'descend') updateDescend(dt);
  draw();

  // the score follows the situation
  const guardianLive = run && run.room && run.room.type === 'guardian' &&
    run.enemies.some(e2 => e2.type === 'guardian');
  const fightLive = run && run.room &&
    ((run.room.type === 'arena' && run.room.arena &&
      run.room.arena.state !== 'idle' && run.room.arena.state !== 'done') ||
     (run.room.type === 'gauntlet' && run.room.gauntlet &&
      run.room.gauntlet.state === 'live'));
  MUSIC.setMood(
    state !== 'play' && state !== 'descend' ? 'menu'
    : !run || run.floor < 0 ? 'surface'
    : run.room && run.room.type === 'boss' ? 'boss'
    : guardianLive ? 'guardian'
    : fightLive ? 'fight'
    : run.blackout ? 'blackout'
    : 'floor' + Math.min(run.floor, 5));
  MUSIC.setCombat(state === 'play' && run && run.enemies.length > 0);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
