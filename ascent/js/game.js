'use strict';
/*
  ASCENT — a big, steep mountain platformer.
  One plain script (no modules) so it runs by double-clicking index.html.

  The mountain is a huge, sheer rock face that leans gently back as it rises (solid
  on the right, open sky + a long drop on the left). It's too steep to walk up — the
  ONLY way to the summit is the route of platforms: jump and double-jump between
  ledges, dash the wide gaps, cross the abandoned city buried inside the mountain on
  its last working machines, and grapple onto the face to wall-jump higher.

  Kit: run + jump · double jump · air dash · wall-jump · grapple (E → zips you to
  the rock and you hang on; Space launches off).

  Sections: 1 Level · 2 Helpers · 3 Input · 4 Particles · 5 Audio · 6 Player · 7 Game
*/

// ============================================================
// 1. LEVEL  (bottom = big y, summit = small y)
// ============================================================
const VIEW_W = 540, VIEW_H = 720;
const WORLD = { w: 540, h: 19700 };
const SNOWLINE = 3600;
const CITY = { x: -120, y: 4500, w: 560, h: 2050 };       // the buried city, carved into solid rock
const MINE = { x: -120, y: 11550, w: 560, h: 2010 };      // the old mine, bored into the lower rock
const INTERIORS = [CITY, MINE];

const rock = (x, y, w, h, kind, oneWay) => ({ x, y, w, h, kind: kind || 'rock', oneWay: !!oneWay });
const SOLIDS = [], MOVERS = [], GEARS = [], UPDRAFTS = [];
function body(x, y, w, h) { const s = rock(x, y, w, h, 'body'); SOLIDS.push(s); return s; }
function ruin(x, y, w, h) { const s = rock(x, y, w, h, 'ruin'); SOLIDS.push(s); return s; }
function plat(x, y, w) { const s = rock(x, y, w, 14, 'ledge', true); SOLIDS.push(s); return s; }
function mover(x, y, w, h, axis, dist, speed, ph) { const m = { x, y, w, h, kind: 'mover', oneWay: false, axis, from: axis === 'x' ? x : y, to: (axis === 'x' ? x : y) + dist, speed, phase: ph || 0, px: x, py: y, dx: 0, dy: 0 }; SOLIDS.push(m); MOVERS.push(m); return m; }
function bouncer(x, y, w) { const s = rock(x, y, w, 12, 'bounce', true); s.bounce = true; SOLIDS.push(s); return s; }   // trampoline
function updraft(x, y, w, h) { const u = { x, y, w, h }; UPDRAFTS.push(u); return u; }                                  // wind column
const CRUMBLES = [];
function ice(x, y, w) { const s = rock(x, y, w, 14, 'ice', true); SOLIDS.push(s); return s; }                          // slippery ledge
function crumble(x, y, w) { const s = rock(x, y, w, 14, 'crumble', true); s.solid = true; s.t = 0; s.gone = 0; SOLIDS.push(s); CRUMBLES.push(s); return s; }   // gives way when stood on

// --- The mountain face: a steep wall on the right that leans gently back as it rises (the "slope"). ---
// faceLeft(y) = x of the rock's left edge at world height y; higher up (smaller y) → further right.
function faceLeft(y) { const f = clamp((9340 - y) / 8550, 0, 1); return Math.round(300 + 175 * Math.pow(f, 1.35)); }
for (let ty = -260; ty < 19500; ty += 300) { const fx = faceLeft(ty); body(fx, ty, 780 - fx, 360); }
body(-80, 19400, 900, 400);                       // the glacier floor — the true base of the mountain

// A zig-zag run of "filler" ledges between the authored challenges (keeps the climb DRY).
function ladder(yBot, yTop, step) { let i = 0; for (let y = yBot; y >= yTop; y -= step, i++) plat(i % 2 ? 190 : 44, y, 100); }

// ---- Foothills — ride the wind up (WIND) ----
ladder(9120, 8420, 140);
updraft(90, 8140, 120, 280);                      // ── THE WIND · ride the updraft up, then jump out at the top ──
plat(80, 8080, 150);                              // top of the wind shaft (a jump-out from the column)
ladder(7940, 7100, 140);
plat(40, 7020, 80); plat(230, 7020, 80);          // ── dash the gap (Q) ──
ladder(6880, 6620, 140);
plat(110, 6450, 90);                              // under the mouth of the entry shaft

// ---- The Buried City: an abandoned hall carved INSIDE the mountain ----
// Solid rock on every side — natural stone walls, an ancient brick ceiling and
// floor. Climb UP a shaft through the broken floor, cross the ruined hall, and
// climb out a shaft in the ceiling. You are fully underground in here.
body(-120, 4500, 184, 2050);                      // west wall — solid mountain stone
ruin(64, 4500, 146, 90); ruin(300, 4500, 90, 90); // brick ceiling  (exit shaft: x 210..300)
ruin(64, 6300, 36, 90); ruin(190, 6300, 200, 90); // brick floor    (entry shaft: x 100..190)
plat(100, 6270, 96);                              // land inside, off the floor shaft
mover(90, 6150, 96, 16, 'x', 150, 0.02, 0);       // ferry across the hall
plat(210, 6040, 96);                              // landing
mover(150, 6040, 96, 16, 'y', -360, 0.016, 0);    // elevator up (boards flush with the landing)
plat(64, 5680, 110);                              // step off the elevator
plat(210, 5540, 96);
mover(96, 5410, 90, 16, 'x', 150, 0.02, 3.14);    // a second ferry, out of phase — time it
plat(64, 5280, 100); plat(200, 5150, 96); plat(72, 5020, 100); plat(200, 4890, 96);
plat(210, 4650, 96);                              // exit ledge → up the ceiling shaft
GEARS.push({ x: 96, y: 5940, r: 26 }, { x: 300, y: 5600, r: 20 }, { x: 110, y: 5040, r: 22 }, { x: 296, y: 4860, r: 18 });

// ---- Upper face: a dash gap, the Blank Face, a second dash, then a wall-jump chimney ----
plat(220, 4470, 100); plat(80, 4350, 100); plat(240, 4230, 100); plat(90, 4110, 100);
plat(240, 3990, 100); plat(90, 3880, 100); plat(180, 3780, 100);
plat(50, 3680, 90); plat(250, 3680, 90);          // ── dash across the void ──
plat(175, 3540, 110);
//  ── HARD · "The Blank Face": ~360px of sheer rock. Grapple the face (E) to hang
//     on, wall-jump off it, steer back and grapple again to climb it.
plat(180, 3180, 110);
plat(60, 3040, 84); plat(250, 3020, 84);          // ── a second dash gap ──
plat(120, 2880, 90);                              // foot of chimney A
body(74, 2500, 24, 360); body(184, 2500, 24, 360);// chimney A — wall-jump up the 86px gap
plat(60, 2440, 100);                              // top of chimney A

// ---- The Spire: tight ledges, a second chimney, a moving span, then the summit ----
plat(210, 2320, 96); plat(80, 2200, 96); plat(220, 2080, 96);
plat(110, 1980, 90);                              // foot of chimney B (main route)
// ── ALTERNATE ROUTE · "The East Ledges": hop the face on the right instead of the chimney ──
plat(300, 1980, 54); plat(250, 1860, 60); plat(320, 1740, 44); plat(250, 1620, 60); plat(300, 1520, 50);
body(72, 1600, 24, 360); body(182, 1600, 24, 360);// chimney B — wall-jump again
plat(60, 1540, 100);                              // top of chimney B
plat(220, 1420, 96); plat(90, 1300, 96);
mover(150, 1180, 100, 16, 'x', 120, 0.02, 0);     // a last moving span
plat(60, 1050, 96); plat(230, 940, 96); plat(110, 840, 100);
plat(150, 760, 180);                              // summit ledge

// ---- Fun stuff: trampolines to boing off, and an updraft you can glide up ----
bouncer(120, 8630, 80);                           // foothills spring (clear of the ladder rungs)
bouncer(40, 3820, 70);                            // upper-face spring
bouncer(70, 1250, 80);                            // spire spring
updraft(52, 3160, 84, 400);                       // wind rushing up the left of the Blank Face

// ================= THE LOWER MOUNTAIN — a much longer approach (new) =================
// A green valley & base camp, a pine forest, an old mine bored into the rock, and a
// frozen waterfall, all climbing up to the original foothills far above.
// -- The Glacier — everything's slippery underfoot (ICE) --
ice(60, 19200, 110); ice(190, 19060, 100); ice(60, 18920, 110); ice(190, 18780, 100);
ice(60, 18640, 110); ice(190, 18500, 100); ice(70, 18360, 110); ice(190, 18220, 100);
plat(70, 18100, 110);                             // solid footing before the crag
// -- The Crumbling Crag — the rock gives way; keep moving up (CRUMBLE) --
crumble(80, 17960, 90); crumble(190, 17820, 90); crumble(80, 17680, 90); crumble(190, 17540, 90);
crumble(80, 17400, 90); crumble(190, 17260, 90); crumble(80, 17120, 90); crumble(190, 16980, 90);
plat(80, 16840, 100); plat(200, 16700, 90); plat(80, 16560, 100);   // back to solid ground, up to the valley
// -- The Valley & Base Camp — big springs bounce you up (SPRINGS) --
ladder(16420, 16130, 145);
bouncer(90, 15990, 110);             // ── SPRING CHAIN · each pad launches ~430px, far past any jump ──
plat(90, 15620, 120);
bouncer(110, 15490, 110);
plat(120, 15120, 120);
// -- The Pine Woods & the Long Pit (needs GLIDE) --
ladder(14990, 14410, 145);
// ── THE LONG PIT · a wide gap only a GLIDE can cross (glide shrine is the near ledge) ──
plat(252, 14280, 46);                               // far side of the pit
plat(120, 14150, 100); plat(200, 14010, 90); plat(80, 13880, 100); plat(196, 13720, 90);
plat(110, 13530, 90);                               // approach the mine shaft
// -- The Old Mine (bored into the rock) --
body(-120, 11550, 184, 2010);                       // mine's west wall
ruin(64, 11600, 146, 90); ruin(300, 11600, 90, 90); // timber ceiling (exit shaft x210..300)
ruin(64, 13380, 36, 90); ruin(190, 13380, 200, 90); // floor (entry shaft x100..190)
plat(100, 13350, 96);                               // land inside off the shaft
mover(90, 13220, 96, 16, 'x', 150, 0.02, 0);        // minecart across
plat(196, 13110, 96);
mover(150, 13110, 96, 16, 'y', -360, 0.016, 0);     // ore lift up
plat(64, 12750, 110);
plat(196, 12610, 96); plat(72, 12470, 100); plat(196, 12330, 96);
plat(72, 12190, 100); plat(196, 12050, 96); plat(96, 11910, 100);
plat(196, 11750, 96);                               // exit ledge → up the ceiling shaft
// -- Out of the mine: The Sheer Wall (needs WALL CLIMB; the climb shrine is the near ledge) --
body(150, 11430, 24, 150);                          // ── THE SHEER WALL · hop to it and climb; jump won't do ──
plat(90, 11410, 100);                               // top of the wall
ladder(11270, 10690, 145);
// -- The Frozen Falls & the Dash Shaft (needs DOUBLE DASH; the dash shrine is the foot) --
plat(150, 10280, 90);                               // ── DASH SHAFT · two dash-ups, straight up ──
plat(60, 10140, 96);
updraft(140, 9600, 96, 540);                        // freezing mist rising up the falls
plat(200, 10000, 90); plat(70, 9860, 96);
ladder(9720, 9270, 145);                            // up to the original foothills

const SPAWN = { x: 90, y: 19340 };
const FLAG = { x: 250, y: 760 };
const GOAL = { x: 150, y: 676, w: 190, h: 86 };
const GEMS = [[130, 8980], [200, 8180], [40, 7020], [230, 6760], [150, 6160], [96, 5680], [260, 5280], [110, 4980], [250, 3680], [180, 3180], [220, 2080], [110, 840],
  [330, 1745],                                        // alternate-route reward
  [276, 14260], [150, 11480], [150, 10280],           // gate rewards: glide pit, sheer wall, dash shaft
  [200, 19000], [110, 17400], [200, 16300], [70, 15130], [150, 13330], [290, 12500], [96, 11910], [64, 10140], [200, 10000]]   // glacier, crag + the lower mountain
  .map(([x, y]) => ({ x, y }));

// Movement techs you unlock at shrines along the climb (placed just before where each shines).
// Each tech is unlocked at a shrine standing right before a section built for it.
const ABILITIES = [
  { key: 'glide', name: 'GLIDE',       hint: 'hold SPACE in the air to ride the wind down', color: '#8fe9ff', x: 44, y: 14260 },
  { key: 'climb', name: 'WALL CLIMB',  hint: 'hold W / ↑ against a wall to scramble up',  color: '#9ff0a8', x: 228, y: 11548 },
  { key: 'dash2', name: 'DOUBLE DASH', hint: 'a second air-dash (Q) before you land',        color: '#ffd27a', x: 195, y: 10620 },
];
ABILITIES.forEach((a) => plat(a.x - 28, a.y + 20, 56));   // a stone pedestal you stand on to take the tech

// ============================================================
// 2. HELPERS
// ============================================================
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function aabb(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function pointInSolid(x, y) { for (const s of SOLIDS) { if (s.oneWay || s.kind === 'mover') continue; if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return true; } return false; }

// ============================================================
// 3. INPUT  (all under the left hand)
// ============================================================
// Rebindable controls. Each action has one custom key (saved to localStorage); arrows/Enter are fixed extras.
const DEFAULT_BINDS = { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', jump: 'Space', dash: 'KeyQ', grapple: 'KeyE', restart: 'KeyR' };
const FIXED_KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'restart' };
let BINDS; try { BINDS = { ...DEFAULT_BINDS, ...(JSON.parse(localStorage.getItem('ascent-binds')) || {}) }; } catch (_) { BINDS = { ...DEFAULT_BINDS }; }
function buildKeymap() { const m = { ...FIXED_KEYS }; for (const a in BINDS) if (BINDS[a]) m[BINDS[a]] = a; return m; }
let KEYMAP = buildKeymap();
function saveBinds() { try { localStorage.setItem('ascent-binds', JSON.stringify(BINDS)); } catch (_) { } KEYMAP = buildKeymap(); }
function rebindKey(action, code) { const prev = BINDS[action]; for (const a in BINDS) if (BINDS[a] === code && a !== action) BINDS[a] = prev; BINDS[action] = code; saveBinds(); }
function keyName(code) {
  if (!code) return '—';
  if (code === 'Space') return 'Space'; if (code.startsWith('Key')) return code.slice(3); if (code.startsWith('Digit')) return code.slice(5);
  const arrows = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }; return arrows[code] || code;
}
class Input {
  constructor() {
    this.held = new Set(); this.edges = new Set();
    window.addEventListener('keydown', (e) => { const a = KEYMAP[e.code]; if (!a) return; if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault(); if (!e.repeat) this.edges.add(a); this.held.add(a); });
    window.addEventListener('keyup', (e) => { const a = KEYMAP[e.code]; if (a) this.held.delete(a); });
    window.addEventListener('blur', () => this.held.clear());
  }
  get left() { return this.held.has('left'); } get right() { return this.held.has('right'); }
  get up() { return this.held.has('up'); } get down() { return this.held.has('down'); }
  get jumpHeld() { return this.held.has('jump'); }
  consume(a) { if (this.edges.has(a)) { this.edges.delete(a); return true; } return false; }
  endFrame() { this.edges.clear(); }
}

// ============================================================
// 4. PARTICLES
// ============================================================
class Particles {
  constructor() { this.list = []; }
  spawn(x, y, o = {}) { this.list.push({ x, y, vx: o.vx ?? 0, vy: o.vy ?? 0, gravity: o.gravity ?? 0, life: o.life ?? 30, maxLife: o.life ?? 30, size: o.size ?? 3, color: o.color ?? '#fff' }); }
  burst(x, y, count, o = {}) { for (let i = 0; i < count; i++) { const a = Math.random() * 6.28, sp = (o.speed ?? 2) * (0.4 + Math.random() * 0.6); this.spawn(x, y, { ...o, vx: Math.cos(a) * sp + (o.vx ?? 0), vy: Math.sin(a) * sp + (o.vy ?? 0), life: (o.life ?? 30) * (0.6 + Math.random() * 0.6), size: (o.size ?? 3) * (0.6 + Math.random() * 0.8) }); } }
  update() { for (let i = this.list.length - 1; i >= 0; i--) { const p = this.list[i]; p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.vx *= 0.98; p.life--; if (p.life <= 0) this.list.splice(i, 1); } }
  draw(ctx, cam) { for (const p of this.list) { ctx.globalAlpha = Math.max(0, p.life / p.maxLife); ctx.fillStyle = p.color; const s = Math.max(1, Math.round(p.size)); ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - cam - s / 2), s, s); } ctx.globalAlpha = 1; }
}

// ============================================================
// 5. AUDIO
// ============================================================
let actx = null;
function initAudio() { if (actx) return; const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
function tone(freq, dur, { type = 'square', vol = 0.15, slideTo = null, delay = 0 } = {}) {
  if (!actx) return; const t0 = actx.currentTime + delay, osc = actx.createOscillator(), g = actx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, t0); if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(actx.destination); osc.start(t0); osc.stop(t0 + dur + 0.02);
}
function noise(dur, { vol = 0.2, hp = 800 } = {}) {
  if (!actx) return; const n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = actx.createBufferSource(); src.buffer = buf; const f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; const g = actx.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(actx.destination); src.start(actx.currentTime);
}
const sfx = {
  jump() { tone(340, 0.15, { type: 'square', vol: 0.11, slideTo: 600 }); }, double() { tone(520, 0.16, { type: 'triangle', vol: 0.12, slideTo: 880 }); },
  walljump() { tone(300, 0.13, { type: 'sawtooth', vol: 0.11, slideTo: 520 }); }, dash() { noise(0.16, { vol: 0.16, hp: 1200 }); tone(680, 0.14, { type: 'sawtooth', vol: 0.07, slideTo: 280 }); },
  fire() { noise(0.09, { vol: 0.12, hp: 1600 }); tone(900, 0.08, { type: 'square', vol: 0.05, slideTo: 1500 }); }, attach() { tone(760, 0.09, { type: 'square', vol: 0.12, slideTo: 1100 }); },
  land() { tone(150, 0.1, { type: 'sine', vol: 0.1, slideTo: 90 }); }, gem() { tone(880, 0.09, { type: 'triangle', vol: 0.13 }); tone(1320, 0.11, { type: 'triangle', vol: 0.09, delay: 0.06 }); },
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.18, delay: i * 0.12 })); },
  unlock() { [523, 659, 880, 1175].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.16, delay: i * 0.06 })); noise(0.2, { vol: 0.05, hp: 2200 }); },
  bounce() { tone(300, 0.13, { type: 'square', vol: 0.13, slideTo: 780 }); tone(620, 0.1, { type: 'triangle', vol: 0.08, slideTo: 1240, delay: 0.04 }); },
};

// ============================================================
// 6. PLAYER
// ============================================================
const GRAVITY = 0.72, MAX_FALL = 13, MOVE_SPEED = 3.7;
const GROUND_ACCEL = 0.9, AIR_ACCEL = 0.6, GROUND_FRICTION = 0.8, AIR_FRICTION = 0.22;
const JUMP_VEL = 13.0, DOUBLE_JUMP = 12.2, COYOTE = 7, JUMP_BUFFER = 7, JUMP_CUT = 0.45;
const WALL_SLIDE_FALL = 2.4, WALL_JUMP_VY = 12.8, WALL_JUMP_VX = 6.2, WALL_JUMP_LOCK = 9, WALL_COYOTE = 6;
const DASH_SPEED = 9.2, DASH_TIME = 10, DASH_END_KEEP = 0.5, DASH_COOLDOWN = 8;
const HOOK_SPEED = 46, HOOK_RANGE = 340, PULL_SPEED = 12;
// --- unlockable movement techs (found at shrines up the mountain) ---
const GLIDE_FALL = 2.2, CLIMB_SPEED = 2.4, CLIMB_BUDGET = 64;
const BOUNCE_VEL = 25, UPDRAFT_ACCEL = 1.15, UPDRAFT_MAX = 4.6;   // trampolines (~430px launch) & wind columns
const ICE_FRICTION = 0.03, ICE_ACCEL = 0.34;                     // slippery glacier ledges
const CRUMBLE_STAND = 40, CRUMBLE_GONE = 150;                    // crumbling platforms: frames to break, frames to respawn
function maxDash() { return typeof unlocked !== 'undefined' && unlocked.dash2 ? 2 : 1; }

class Player {
  constructor(x, y) { this.w = 22; this.h = 28; this.reset(x, y); }
  reset(x, y) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.facing = 1; this.onGround = false; this.wall = 0; this.lastWall = 1;
    this.coyote = 0; this.wallCoyote = 0; this.jumpBuffer = 0; this.airLock = 0; this.airJumps = 1; this.dashCharges = maxDash(); this.dashTime = 0; this.dashCooldown = 0;
    this.gliding = false; this.landTimer = 0; this.gState = 'idle'; this.fireDir = 1; this.hx = 0; this.hy = 0; this.travel = 0; this.ax = 0; this.ay = 0; this.clingWall = 0; this.events = []; this.impact = 0; this.climbLeft = CLIMB_BUDGET; this.climbing = false; this.trail = []; this.inUpdraft = false; this.launched = false; this.onIce = false;
  }
  rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  get cx() { return this.x + this.w / 2; } get cy() { return this.y + this.h / 2; }

  step(input) {
    this.events = [];
    this.gliding = false;
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) this.facing = dir;
    if (this.coyote > 0) this.coyote--; if (this.wallCoyote > 0) this.wallCoyote--; if (this.jumpBuffer > 0) this.jumpBuffer--; if (this.airLock > 0) this.airLock--; if (this.dashCooldown > 0) this.dashCooldown--; if (this.landTimer > 0) this.landTimer--;
    if (input.consume('jump')) this.jumpBuffer = JUMP_BUFFER;
    if ((this.gState === 'idle' || this.gState === 'cling') && input.consume('grapple')) { this.gState = 'firing'; this.fireDir = this.facing; this.hx = this.cx; this.hy = this.cy; this.travel = 0; this.events.push('fire'); }
    if (this.gState === 'firing') this.#updateHook();
    if (this.gState === 'pull') this.#pull();
    else if (this.gState === 'cling') this.#clingMove(input, dir);
    else this.#move(input, dir);
    this.trail.push({ x: this.cx, y: this.y + 7 }); if (this.trail.length > 9) this.trail.shift();   // scarf
  }
  #updateHook() {
    for (let k = 0; k < HOOK_SPEED; k += 6) {
      this.hx += this.fireDir * 6; this.travel += 6;
      if (pointInSolid(this.hx, this.hy)) { this.ax = this.hx; this.ay = this.hy; this.gState = 'pull'; this.events.push('attach'); return; }
      if (this.travel >= HOOK_RANGE || this.hx < -40 || this.hx > WORLD.w + 40) { this.gState = 'idle'; return; }
    }
  }
  #pull() {
    if (this.jumpBuffer > 0) { this.gState = 'idle'; return; }
    const dx = this.ax - this.cx, dy = this.ay - this.cy, dist = Math.hypot(dx, dy) || 0.001;
    if (dist <= PULL_SPEED + 2) { if (this.#touchWall(1) || this.#touchWall(-1)) this.#startCling(); else this.gState = 'idle'; return; }
    this.vx = dx / dist * PULL_SPEED; this.vy = dy / dist * PULL_SPEED;
    this.#moveX(); this.#moveY();
    if (this.#touchWall(1) || this.#touchWall(-1)) this.#startCling();
    else if (this.#grounded()) this.gState = 'idle';
  }
  #startCling() { this.gState = 'cling'; this.clingWall = this.#touchWall(1) ? 1 : (this.#touchWall(-1) ? -1 : this.fireDir); this.vx = 0; this.vy = 0; this.airJumps = 1; this.dashCharges = maxDash(); this.climbLeft = CLIMB_BUDGET; this.events.push('cling'); }
  #clingMove(input, dir) {
    this.vx = 0; this.vy = 0; this.airJumps = 1; this.dashCharges = maxDash();
    if (this.jumpBuffer > 0) { const ws = this.clingWall; this.vy = -WALL_JUMP_VY; this.vx = -ws * WALL_JUMP_VX; this.facing = -ws; this.airLock = WALL_JUMP_LOCK; this.jumpBuffer = 0; this.gState = 'idle'; this.lastWall = ws; this.events.push('walljump'); return; }
    if ((this.clingWall < 0 && dir > 0) || (this.clingWall > 0 && dir < 0)) { this.gState = 'idle'; return; }
    if (!this.#touchWall(this.clingWall) && !this.#grounded()) this.gState = 'idle';
  }
  #move(input, dir) {
    this.climbing = false;
    if (this.vy >= 0) this.launched = false;   // a spring/launch is no longer active once you start falling
    if (this.dashTime > 0) { this.dashTime--; this.events.push('dashtrail'); if (this.dashTime === 0) { this.vx *= DASH_END_KEEP; this.vy = this.vy > 0 ? this.vy * DASH_END_KEEP : Math.min(this.vy, -2); } }
    else {
      const pushWall = (this.wall === -1 && input.left) || (this.wall === 1 && input.right);
      const wallSlide = !this.onGround && pushWall && this.vy > 0;
      const climbing = unlocked.climb && this.wall !== 0 && !this.onGround && input.up && this.climbLeft > 0;   // scramble up the rock
      const glide = unlocked.glide && !this.onGround && this.vy > 0 && input.jumpHeld && !wallSlide && !climbing; // ride the wind down
      if (this.airLock <= 0) { if (dir !== 0) { const a = this.onGround ? (this.onIce ? ICE_ACCEL : GROUND_ACCEL) : (glide ? 0.86 : AIR_ACCEL); this.vx = clamp(this.vx + dir * a, -MOVE_SPEED, MOVE_SPEED); } else { const f = this.onGround ? (this.onIce ? ICE_FRICTION : GROUND_FRICTION) : AIR_FRICTION; if (this.vx > 0) this.vx = Math.max(0, this.vx - f); else if (this.vx < 0) this.vx = Math.min(0, this.vx + f); } }
      if (climbing) { this.vy = -CLIMB_SPEED; this.climbLeft--; this.climbing = true; this.gliding = false; this.events.push('climb'); }
      else if (wallSlide) { this.vy = Math.min(this.vy + GRAVITY, WALL_SLIDE_FALL); this.gliding = false; }
      else if (glide) { this.vy = Math.min(this.vy + GRAVITY, GLIDE_FALL); this.gliding = true; this.events.push('glide'); }
      else { this.vy = Math.min(this.vy + GRAVITY, MAX_FALL); this.gliding = false; }
    }
    if (this.jumpBuffer > 0 && this.dashTime <= 0) {
      if (this.onGround || this.coyote > 0) { this.vy = -JUMP_VEL; this.jumpBuffer = 0; this.coyote = 0; this.events.push('jump'); }
      else if (this.wall !== 0 || this.wallCoyote > 0) { const ws = this.wall !== 0 ? this.wall : this.lastWall; this.vy = -WALL_JUMP_VY; this.vx = -ws * WALL_JUMP_VX; this.facing = -ws; this.airLock = WALL_JUMP_LOCK; this.jumpBuffer = 0; this.wallCoyote = 0; this.airJumps = 1; this.events.push('walljump'); }
      else if (this.airJumps > 0) { this.vy = -DOUBLE_JUMP; this.airJumps--; this.jumpBuffer = 0; this.events.push('double'); }
    }
    if (!input.jumpHeld && this.vy < 0 && this.dashTime <= 0 && !this.climbing && !this.inUpdraft && !this.launched) this.vy *= JUMP_CUT;
    if (input.consume('dash') && this.dashCharges > 0 && this.dashCooldown <= 0 && this.dashTime <= 0) {
      let dx = dir, dy = (input.down ? 1 : 0) - (input.up ? 1 : 0); if (dx === 0 && dy === 0) dx = this.facing;
      const len = Math.hypot(dx, dy) || 1; this.vx = (dx / len) * DASH_SPEED; this.vy = (dy / len) * DASH_SPEED; this.dashTime = DASH_TIME; this.dashCharges--; this.dashCooldown = DASH_COOLDOWN; this.events.push('dash');
    }
    const wasAir = !this.onGround;
    this.impact = this.vy;                          // descent speed at the moment of impact (for landing juice)
    this.#moveX(); this.#moveY();
    this.onGround = this.#grounded();
    this.onIce = this.onGround && this.#standingOn('ice');
    this.wall = this.#touchWall(-1) ? -1 : (this.#touchWall(1) ? 1 : 0); if (this.wall !== 0) this.lastWall = this.wall;
    if (this.onGround) { this.coyote = COYOTE; this.airJumps = 1; this.dashCharges = maxDash(); this.climbLeft = CLIMB_BUDGET; if (wasAir) { this.landTimer = 8; this.events.push('land'); } }
    else if (this.wall !== 0) { this.wallCoyote = WALL_COYOTE; this.dashCharges = Math.max(this.dashCharges, 1); }
  }
  #moveX() {
    this.x += this.vx; const r = this.rect();
    for (const s of SOLIDS) {
      if (s.oneWay || !aabb(r, s)) continue;
      if (this.vx > 0) this.x = s.x - this.w;
      else if (this.vx < 0) this.x = s.x + s.w;
      // vx === 0: the sloped face's edge slid into us as we changed height — pop out the nearer side
      else { const exitL = (r.x + r.w) - s.x, exitR = (s.x + s.w) - r.x; this.x += exitL <= exitR ? -exitL : exitR; }
      this.vx = 0; r.x = this.x;
    }
  }
  #moveY() {
    const prevTop = this.y, prevBottom = this.y + this.h; this.y += this.vy; const r = this.rect();
    for (const s of SOLIDS) {
      if (s.kind === 'crumble' && !s.solid) continue;   // a crumbled platform isn't there
      if (!aabb(r, s)) continue;
      if (s.oneWay) { if (this.vy > 0 && prevBottom <= s.y + 1) { this.y = s.y - this.h; if (s.bounce) { this.vy = -BOUNCE_VEL; this.launched = true; this.airJumps = 1; this.dashCharges = maxDash(); this.climbLeft = CLIMB_BUDGET; this.events.push('bounce'); } else this.vy = 0; r.y = this.y; } continue; }
      // Only resolve as a floor/ceiling hit if we actually crossed that edge this frame. A
      // sideways overlap (the sloped wall embedding us) must NOT snap Y — that was the teleport-down.
      if (this.vy > 0 && prevBottom <= s.y + 1) { this.y = s.y - this.h; this.vy = 0; r.y = this.y; }
      else if (this.vy < 0 && prevTop >= s.y + s.h - 1) { this.y = s.y + s.h; this.vy = 0; r.y = this.y; }
    }
  }
  #grounded() { const r = { x: this.x, y: this.y + 1, w: this.w, h: this.h }; for (const s of SOLIDS) { if (s.kind === 'crumble' && !s.solid) continue; if (s.oneWay) { if (aabb(r, s) && this.y + this.h <= s.y + 2) return true; } else if (aabb(r, s)) return true; } return false; }
  #touchWall(side) { const r = { x: this.x + side * 2, y: this.y + 2, w: this.w, h: this.h - 4 }; for (const s of SOLIDS) if (!s.oneWay && s.kind !== 'mover' && aabb(r, s)) return true; return false; }
  #standingOn(kind) { const r = { x: this.x, y: this.y + 1, w: this.w, h: this.h }; for (const s of SOLIDS) if (s.kind === kind && aabb(r, s) && this.y + this.h <= s.y + 3) return true; return false; }
}

// ============================================================
// 7. GAME
// ============================================================
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const input = new Input();
const particles = new Particles();
const STATE = { MENU: 'menu', PLAY: 'play', WIN: 'win' };
let player, gems, camY, rcam, frames, gemsGot, state, toast, unlocked, abilities;
state = STATE.MENU;
const stars = Array.from({ length: 130 }, () => ({ x: Math.random() * VIEW_W, y: Math.random() * WORLD.h, r: Math.random() < 0.5 ? 1 : 2, tw: Math.random() * 6.28 }));
const birds = Array.from({ length: 6 }, () => ({ x: Math.random() * VIEW_W, y: 46 + Math.random() * 230, sp: 0.25 + Math.random() * 0.5, ph: Math.random() * 6.28, dir: Math.random() < 0.5 ? 1 : -1 }));
let shootT = 200, shoot = null;

function resetGame() {
  for (const m of MOVERS) { if (m.axis === 'x') m.x = m.from; else m.y = m.from; m.px = m.x; m.py = m.y; m.dx = 0; m.dy = 0; }
  unlocked = { glide: false, dash2: false, climb: false };            // techs persist across falls, reset on full restart
  abilities = ABILITIES.map((a) => ({ ...a, taken: false }));
  for (const s of CRUMBLES) { s.solid = true; s.t = 0; s.gone = 0; }
  player = new Player(SPAWN.x, SPAWN.y);
  gems = GEMS.map((g) => ({ ...g, taken: false, bob: Math.random() * 6.28 }));
  camY = clamp(player.y - VIEW_H * 0.55, 0, WORLD.h - VIEW_H); rcam = Math.round(camY);
  frames = 0; gemsGot = 0; toast = null; particles.list.length = 0;
  initWeather(); bannersShown.clear(); shake = 0;
}

const STEP_MS = 1000 / 60;
let acc = 0, last = performance.now();
function frame(now) { acc += now - last; last = now; if (acc > 200) acc = 200; while (acc >= STEP_MS) { update(); acc -= STEP_MS; } render(); requestAnimationFrame(frame); }

function updateMovers() { for (const m of MOVERS) { m.px = m.x; m.py = m.y; const t = (Math.sin(frames * m.speed + m.phase) + 1) / 2, v = m.from + (m.to - m.from) * t; if (m.axis === 'x') m.x = v; else m.y = v; m.dx = m.x - m.px; m.dy = m.y - m.py; } }
function carryPlayer() { const feet = player.y + player.h; for (const m of MOVERS) { if (player.onGround && Math.abs(feet - m.py) < 6 && player.x + player.w > m.px + 3 && player.x < m.px + m.w - 3) { player.x += m.dx; player.y += m.dy; break; } } }
function updateCrumble() {
  const feet = player.y + player.h;
  for (const s of CRUMBLES) {
    if (s.solid) {
      const standing = player.onGround && Math.abs(feet - s.y) < 3 && player.x + player.w > s.x + 2 && player.x < s.x + s.w - 2;
      if (standing || s.t > 0) s.t++;                              // once touched, it keeps crumbling
      if (s.t >= CRUMBLE_STAND) { s.solid = false; s.gone = CRUMBLE_GONE; if (Math.abs(feet - s.y) < 40) particles.burst(s.x + s.w / 2, s.y + 6, 10, { color: '#8a6b57', gravity: 0.3, speed: 2, life: 30, size: 3 }); }
    } else if (--s.gone <= 0) { s.solid = true; s.t = 0; }
  }
}

function update() {
  if (state !== STATE.PLAY) { input.endFrame(); return; }
  frames++;
  if (input.consume('restart')) respawn();
  updateMovers(); carryPlayer();
  player.inUpdraft = false;
  for (const u of UPDRAFTS) if (player.gState === 'idle' && aabb(player.rect(), u)) {   // ride the wind up
    if (player.vy > -UPDRAFT_MAX) player.vy = Math.max(player.vy - UPDRAFT_ACCEL, -UPDRAFT_MAX);   // lift up to a cap, but never slow a jump out of it
    player.airJumps = Math.max(player.airJumps, 1);   // keep a jump handy so you can always launch out of the top
    player.inUpdraft = true;
    if (frames % 2 === 0) particles.spawn(u.x + Math.random() * u.w, player.y + player.h + 4, { color: 'rgba(206,236,255,0.85)', vy: -3.6, life: 22, size: 2 });
  }
  player.step(input); reactToEvents(); updateCrumble();

  for (const g of gems) { if (g.taken) continue; if (aabb(player.rect(), { x: g.x - 11, y: g.y - 11, w: 24, h: 24 })) { g.taken = true; gemsGot++; particles.burst(g.x, g.y, 10, { color: '#7ee7ff', speed: 2.6, life: 26, size: 3 }); sfx.gem(); } }
  for (const a of abilities) { if (a.taken) continue; if (aabb(player.rect(), { x: a.x - 15, y: a.y - 15, w: 30, h: 30 })) { a.taken = true; unlocked[a.key] = true; player.dashCharges = maxDash(); particles.burst(a.x, a.y, 30, { color: a.color, speed: 3.6, life: 42, size: 3 }); sfx.unlock(); addShake(4); showToast('NEW TECH · ' + a.name + ' — ' + a.hint); } }

  if (player.gState !== 'pull' && player.gState !== 'cling' && player.y > SPAWN.y + 220) respawn();   // fell off the left into the void
  if (aabb(player.rect(), GOAL)) { state = STATE.WIN; sfx.win(); addShake(9); particles.burst(FLAG.x, FLAG.y - 40, 46, { color: '#ffd166', speed: 4, life: 60, size: 3 }); showWin(); }
  for (let i = 0; i < BANNERS.length; i++) if (!bannersShown.has(i) && player.y < BANNERS[i].y) { bannersShown.add(i); showToast(BANNERS[i].text); }

  const look = clamp(player.vy * 4.5, -46, 66);   // lead the camera the way you're moving
  const target = clamp(player.cy - VIEW_H * 0.55 + look, 0, WORLD.h - VIEW_H); camY += (target - camY) * 0.11;
  particles.update(); if (toast) toast.life--; input.endFrame();
}

function reactToEvents() {
  const cx = player.cx;
  for (const e of player.events) {
    switch (e) {
      case 'jump': sfx.jump(); particles.burst(cx, player.y + player.h, 7, { color: '#eef4fa', vy: 1, speed: 1.6, life: 20, size: 3 }); break;
      case 'double': sfx.double(); particles.burst(cx, player.cy, 11, { color: '#b0f0ff', speed: 2.4, life: 24, size: 3 }); break;
      case 'walljump': sfx.walljump(); addShake(2); particles.burst(player.x + (player.lastWall < 0 ? 0 : player.w), player.cy, 9, { color: '#d9c6ff', speed: 2.2, life: 22, size: 3 }); break;
      case 'dash': sfx.dash(); addShake(2.5); particles.burst(cx, player.cy, 14, { color: '#fff', speed: 3, life: 20, size: 3 }); break;
      case 'dashtrail': particles.spawn(cx, player.cy, { color: '#8fe9ff', life: 12, size: 7 }); break;
      case 'fire': sfx.fire(); break;
      case 'attach': sfx.attach(); particles.burst(player.ax, player.ay, 8, { color: '#ffe08a', speed: 2, life: 20, size: 3 }); break;
      case 'cling': sfx.land(); addShake(1.5); particles.burst(player.ax, player.ay, 8, { color: '#cbd8ef', speed: 1.8, life: 18, size: 3 }); break;
      case 'land': { const imp = Math.max(0, player.impact); sfx.land(); addShake(clamp(imp * 0.45, 0.4, 6)); particles.burst(cx, player.y + player.h, Math.round(6 + imp), { color: '#eef4fa', vy: -0.5, speed: 1.8 + imp * 0.07, life: 18, size: 3 }); break; }
      case 'glide': if (frames % 4 === 0) particles.spawn(cx - player.facing * 10, player.cy, { color: 'rgba(180,230,255,0.9)', vx: -player.facing * 0.6, life: 16, size: 2 }); break;
      case 'bounce': sfx.bounce(); addShake(4); particles.burst(cx, player.y + player.h, 16, { color: '#ffe08a', vy: -1, speed: 3, life: 24, size: 3 }); break;
      case 'climb': if (frames % 3 === 0) particles.spawn(player.x + (player.wall < 0 ? 0 : player.w), player.y + player.h - 4, { color: '#8a7d6e', vy: 1.1, gravity: 0.05, life: 16, size: 2 }); break;
    }
  }
}
function respawn() {
  particles.burst(player.cx, player.cy, 14, { color: '#9fb4d8', speed: 2.4, life: 22, size: 3 });
  player.reset(SPAWN.x, SPAWN.y);
  camY = clamp(player.y - VIEW_H * 0.55, 0, WORLD.h - VIEW_H); rcam = Math.round(camY);   // snap the camera back with you — don't leave the player off-screen
}

// ---------------- rendering ----------------
function render() {
  rcam = Math.round(camY);
  drawSky(); drawSun(); drawStars(); drawShootingStar(); drawBirds();   // far layers — steady behind the shake
  const sh = shakeXY();
  ctx.save(); ctx.translate(sh.x, sh.y);
  drawBackdrop(); drawInterior(); drawGears();
  for (const s of SOLIDS) { if (s.kind === 'mover') drawMover(s); else if (s.kind === 'bounce') drawBouncer(s); else if (s.kind === 'ice') drawIce(s); else if (s.kind === 'crumble') drawCrumble(s); else if (s.kind === 'ledge') drawLedge(s); else if (s.kind === 'ruin') drawRuin(s); else drawBody(s); }
  drawUpdrafts();
  drawPeak();
  drawCityAmbience();
  drawFalls(); drawTrees(); drawCabins(); drawCrystals();
  drawGems(); drawAbilities(); drawFlag(); drawGrapple();
  particles.draw(ctx, rcam);
  if (state !== STATE.MENU) drawPlayer();
  ctx.restore();
  drawBiomeTint(); drawWeather(); drawVignette();
  if (state !== STATE.MENU) drawHUD();
  shake *= 0.86; if (shake < 0.3) shake = 0;
}
const SKY = [{ t: 0, top: '#0a1230', bot: '#20305e' }, { t: 0.4, top: '#33487f', bot: '#6a8ec4' }, { t: 0.72, top: '#6f9bcb', bot: '#b6d3ea' }, { t: 1, top: '#bcd8e6', bot: '#e9dcc0' }];
function lerpC(a, b, t) { const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)], pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)]; return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`; }
function skyAt(alt) { for (let i = 0; i < SKY.length - 1; i++) { const a = SKY[i], b = SKY[i + 1]; if (alt >= a.t && alt <= b.t) { const t = (alt - a.t) / (b.t - a.t); return { top: lerpC(a.top, b.top, t), bot: lerpC(a.bot, b.bot, t) }; } } return SKY[SKY.length - 1]; }
function drawSky() { const alt = clamp(rcam / (WORLD.h - VIEW_H), 0, 1), c = skyAt(alt), g = ctx.createLinearGradient(0, 0, 0, VIEW_H); g.addColorStop(0, c.top); g.addColorStop(1, c.bot); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
function drawStars() { const alt = clamp(rcam / (WORLD.h - VIEW_H), 0, 1), a = clamp((alt - 0.1) / 0.5, 0, 1); if (a <= 0) return; for (const s of stars) { const sy = Math.round(s.y - rcam * 0.5); if (sy < -4 || sy > VIEW_H) continue; ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(frames * 0.05 + s.tw)); ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(s.x), sy, s.r, s.r); } ctx.globalAlpha = 1; }
function drawBirds() {
  for (const b of birds) {
    b.x += b.sp * b.dir; if (b.x > VIEW_W + 24) b.x = -24; else if (b.x < -24) b.x = VIEW_W + 24;
    const wy = Math.round(b.y + Math.sin(frames * 0.02 + b.ph) * 8), flap = Math.sin(frames * 0.3 + b.ph) * 4;
    ctx.strokeStyle = 'rgba(28,34,50,0.5)'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(Math.round(b.x - 6 * b.dir), wy + flap); ctx.lineTo(Math.round(b.x), wy); ctx.lineTo(Math.round(b.x + 6 * b.dir), wy + flap); ctx.stroke();
  }
}
function drawShootingStar() {
  const alt = clamp(rcam / (WORLD.h - VIEW_H), 0, 1), vis = clamp((alt - 0.1) / 0.5, 0, 1);
  if (vis < 0.3) { shoot = null; return; }
  if (!shoot) { if (--shootT <= 0) shoot = { x: Math.random() * VIEW_W, y: Math.random() * 150, vx: (2 + Math.random() * 2) * (Math.random() < 0.5 ? 1 : -1), vy: 1.4 + Math.random() * 1.6, life: 26 }; return; }
  shoot.x += shoot.vx; shoot.y += shoot.vy; shoot.life--;
  ctx.globalAlpha = clamp(shoot.life / 26, 0, 1) * vis; ctx.strokeStyle = '#dffbff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x - shoot.vx * 5, shoot.y - shoot.vy * 5); ctx.stroke(); ctx.globalAlpha = 1;
  if (shoot.life <= 0) { shoot = null; shootT = 160 + Math.floor(Math.random() * 380); }
}
function drawUpdrafts() {
  for (const u of UPDRAFTS) {
    if (u.y - rcam > VIEW_H || u.y + u.h - rcam < 0) continue;
    ctx.strokeStyle = 'rgba(196,228,255,0.4)'; ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const sx = Math.round(u.x + 8 + i * (u.w - 16) / 6), yy = Math.round(u.y + u.h - ((frames * 3 + i * 47) % u.h) - rcam);
      ctx.beginPath(); ctx.moveTo(sx, yy); ctx.lineTo(sx, yy - 13); ctx.stroke();
    }
  }
}
function drawIce(s) {
  const x = Math.round(s.x), y = Math.round(s.y - rcam); if (y > VIEW_H || y + 14 < 0) return;
  ctx.fillStyle = '#b7e0f2'; ctx.fillRect(x, y, s.w, 14);
  ctx.fillStyle = '#eafaff'; ctx.fillRect(x, y, s.w, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; for (let i = 3; i < s.w - 4; i += 15) ctx.fillRect(x + i, y + 6, 5, 2);
  ctx.fillStyle = 'rgba(50,95,125,0.3)'; ctx.fillRect(x, y + 12, s.w, 2);
}
function drawCrumble(s) {
  const y = Math.round(s.y - rcam); if (y > VIEW_H || y + 14 < 0) return;
  if (!s.solid) { ctx.globalAlpha = 0.16; ctx.strokeStyle = '#8a6b57'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(s.x) + 0.5, y + 0.5, s.w - 1, 13); ctx.globalAlpha = 1; return; }
  const shake = s.t > 0 ? Math.round(Math.sin(frames * 0.9) * (s.t / CRUMBLE_STAND) * 2.5) : 0, x = Math.round(s.x) + shake;
  ctx.fillStyle = '#7a5c48'; ctx.fillRect(x, y, s.w, 14);
  ctx.fillStyle = '#946f57'; ctx.fillRect(x, y, s.w, 4);
  ctx.strokeStyle = 'rgba(28,18,12,0.55)'; ctx.lineWidth = 1;
  for (let i = 12; i < s.w; i += 17) { ctx.beginPath(); ctx.moveTo(x + i + 0.5, y); ctx.lineTo(x + i - 4 + 0.5, y + 14); ctx.stroke(); }
  if (s.t > CRUMBLE_STAND * 0.5) { ctx.fillStyle = 'rgba(30,20,14,0.4)'; ctx.fillRect(x, y + 11, s.w, 3); }   // darkening as it fails
}
function drawBouncer(s) {
  const x = Math.round(s.x), y = Math.round(s.y - rcam); if (y > VIEW_H || y + 20 < 0) return;
  const on = player && Math.abs((player.y + player.h) - s.y) < 30 && player.x + player.w > s.x && player.x < s.x + s.w, c = on ? 3 : 0;
  ctx.fillStyle = '#2a2f3a'; ctx.fillRect(x, y + 6 - c, s.w, 9 + c);
  ctx.fillStyle = '#ff5470'; ctx.fillRect(x, y - c, s.w, 6);
  ctx.fillStyle = '#ffd166'; for (let bx = x + 4; bx < x + s.w - 2; bx += 10) ctx.fillRect(bx, y + 1 - c, 4, 3);
}
// Cozy mountaineers' huts perched at each section (decorative — you climb past them).
const CABINS = [
  { x: 30, y: 19400, w: 80 },   // base camp on the glacier floor
  { x: 210, y: 18100, w: 46 },  // shelter above the crag
  { x: 30, y: 16600, w: 66 },   // valley waystation
  { x: 70, y: 15410, w: 46 },   // valley waystation
  { x: 120, y: 13530, w: 46 },  // hut at the mine mouth
  { x: 66, y: 10130, w: 44 },   // camp by the frozen falls
  { x: 205, y: 7300, w: 52 },   // foothills waystation
  { x: 116, y: 6450, w: 46 },   // camp at the mouth of the buried city
  { x: 95, y: 4110, w: 46 },    // upper-face hut
  { x: 168, y: 760, w: 56 },    // summit shelter by the flag
];
const TREES = [{ x: 120, y: 16600 }, { x: 165, y: 16600 }, { x: 210, y: 16600 }, { x: 255, y: 16600 }, { x: 80, y: 16600 }, { x: 110, y: 15410 }, { x: 100, y: 14110 }];
const CRYSTALS = [{ x: 300, y: 12900, c: '#8fe9ff' }, { x: 78, y: 12500, c: '#9ff0a8' }, { x: 300, y: 12150, c: '#c9a0ff' }, { x: 90, y: 11850, c: '#8fe9ff' }, { x: 296, y: 13150, c: '#ffd27a' }, { x: 70, y: 13000, c: '#8fe9ff' }, { x: 296, y: 10700, c: '#bfe6ff' }, { x: 296, y: 11100, c: '#bfe6ff' },
  { x: 300, y: 19000, c: '#d6f0ff' }, { x: 300, y: 18500, c: '#bfe6ff' }, { x: 300, y: 18960, c: '#eafaff' }];   // glacier ice
const FALLS = [{ x: 296, y: 9880, w: 38, h: 1560 }];
function drawTrees() { for (const t of TREES) drawTree(t); }
function drawCrystals() { for (const c of CRYSTALS) drawCrystal(c); }
function drawFalls() {
  for (const f of FALLS) {
    const y0 = f.y - rcam; if (y0 > VIEW_H || y0 + f.h < 0) continue;
    for (let i = 0; i < 5; i++) { const cx = Math.round(f.x + 6 + i * (f.w - 12) / 4); ctx.fillStyle = i % 2 ? 'rgba(198,226,246,0.5)' : 'rgba(226,242,252,0.6)'; ctx.fillRect(cx, Math.max(0, Math.round(y0)), 5, Math.min(f.h, VIEW_H - Math.max(0, y0))); }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 9; i++) { const sx = f.x + (h2(i * 31, 5) / 100) * f.w, yy = f.y + ((frames * 2 + i * 47) % f.h) - rcam; if (yy > 0 && yy < VIEW_H) ctx.fillRect(Math.round(sx), Math.round(yy), 2, 9); }
  }
}
function drawTree(t) {
  const x = Math.round(t.x), gy = Math.round(t.y - rcam); if (gy < -70 || gy > VIEW_H + 20) return;
  const snowy = t.y < SNOWLINE;
  ctx.fillStyle = '#4a3526'; ctx.fillRect(x - 2, gy - 10, 4, 11);
  for (let i = 0; i < 3; i++) { const w = 22 - i * 6, ty = gy - 8 - i * 12; ctx.fillStyle = snowy ? '#335641' : '#2e5636'; ctx.beginPath(); ctx.moveTo(x - w, ty); ctx.lineTo(x, ty - 16); ctx.lineTo(x + w, ty); ctx.closePath(); ctx.fill(); if (snowy) { ctx.fillStyle = '#eef4fb'; ctx.beginPath(); ctx.moveTo(x, ty - 16); ctx.lineTo(x + w * 0.45, ty - 8); ctx.lineTo(x, ty - 5); ctx.closePath(); ctx.fill(); } }
}
function drawCrystal(c) {
  const x = Math.round(c.x), y = Math.round(c.y - rcam); if (y < -30 || y > VIEW_H + 30) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, 22); g.addColorStop(0, c.c); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.35 + 0.25 * Math.sin(frames * 0.08 + c.x); ctx.fillStyle = g; ctx.fillRect(x - 22, y - 22, 44, 44); ctx.globalAlpha = 1;
  ctx.fillStyle = c.c; ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + 7, y - 4); ctx.lineTo(x + 11, y + 2); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x + 3, y + 2); ctx.closePath(); ctx.fill();
}
function drawCabins() { for (const c of CABINS) drawCabin(c); }
function drawCabin(c) {
  const w = c.w, wh = Math.round(w * 0.6), rh = Math.round(w * 0.5);
  const x = Math.round(c.x), gy = Math.round(c.y - rcam), top = gy - wh;   // gy = the surface it stands on
  if (gy < -140 || top - rh > VIEW_H) return;
  ctx.fillStyle = '#6b4a33'; ctx.fillRect(x, top, w, wh);                  // log walls
  ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 1;
  for (let ly = top + 6; ly < gy; ly += 7) { ctx.beginPath(); ctx.moveTo(x, ly + 0.5); ctx.lineTo(x + w, ly + 0.5); ctx.stroke(); }
  ctx.fillStyle = '#3a2618'; ctx.fillRect(x + Math.round(w * 0.12), gy - Math.round(wh * 0.6), Math.round(w * 0.24), Math.round(wh * 0.6));   // door
  const ws = Math.max(6, Math.round(w * 0.2)), wx = x + Math.round(w * 0.56), wy = top + Math.round(wh * 0.3);   // warm window
  const flick = 0.72 + 0.28 * Math.sin(frames * 0.14 + c.x);
  const g = ctx.createRadialGradient(wx + ws / 2, wy + ws / 2, 0, wx + ws / 2, wy + ws / 2, ws * 3);
  g.addColorStop(0, `rgba(255,196,110,${0.7 * flick})`); g.addColorStop(1, 'rgba(255,196,110,0)');
  ctx.fillStyle = g; ctx.fillRect(wx - ws * 2.5, wy - ws * 2.5, ws * 6, ws * 6);
  ctx.fillStyle = `rgba(255,208,120,${0.85 * flick})`; ctx.fillRect(wx, wy, ws, ws);
  ctx.fillStyle = '#3a2618'; ctx.fillRect(wx + Math.floor(ws / 2), wy, 1, ws); ctx.fillRect(wx, wy + Math.floor(ws / 2), ws, 1);
  ctx.fillStyle = '#4a3324'; ctx.beginPath(); ctx.moveTo(x - 7, top + 3); ctx.lineTo(x + w / 2, top - rh); ctx.lineTo(x + w + 7, top + 3); ctx.closePath(); ctx.fill();   // roof
  ctx.fillStyle = '#eef4fb'; ctx.beginPath(); ctx.moveTo(x + w / 2 - (w / 2 + 7) * 0.5, top - rh * 0.5); ctx.lineTo(x + w / 2, top - rh); ctx.lineTo(x + w / 2 + (w / 2 + 7) * 0.5, top - rh * 0.5); ctx.closePath(); ctx.fill();   // snow cap
  const cxp = x + Math.round(w * 0.7), cty = top - Math.round(rh * 0.5);   // chimney + smoke
  ctx.fillStyle = '#514a52'; ctx.fillRect(cxp, cty, Math.max(4, Math.round(w * 0.12)), Math.round(rh * 0.7));
  ctx.fillStyle = '#b8bcc6';
  for (let i = 0; i < 3; i++) { const t = (frames * 0.5 + i * 22) % 66; ctx.globalAlpha = 0.4 * (1 - t / 66); ctx.beginPath(); ctx.arc(cxp + 2 + Math.sin((t + i * 12) * 0.12) * 5, cty - t, 2 + t * 0.05, 0, 6.2832); ctx.fill(); }
  ctx.globalAlpha = 1;
}
function h2(a, b) { let n = (a * 73856093) ^ (b * 19349663); n = (n ^ (n >> 13)) >>> 0; return n % 100; }
function drawBackdrop() {
  // Fewer, larger triangular peaks with long diagonal slopes — reads as sloped mountains.
  const layers = [
    { p: 0.14, base: 0.52, h: 240, col: '#222d52', snow: '#8096c6', seed: 3, n: 3 },
    { p: 0.26, base: 0.68, h: 200, col: '#334670', snow: '#a3b6de', seed: 6, n: 4 },
    { p: 0.40, base: 0.84, h: 165, col: '#45598c', snow: '#c4d3ef', seed: 9, n: 5 },
  ];
  for (const L of layers) {
    const baseY = VIEW_H * L.base + ((rcam * L.p) % 320), step = VIEW_W / L.n, peaks = [];
    ctx.fillStyle = L.col; ctx.beginPath(); ctx.moveTo(-40, VIEW_H + 40);
    for (let i = 0; i <= L.n; i++) {
      const jx = (h2(i * 53, L.seed * 17) / 100 - 0.5) * step * 0.5;
      const px = i * step + jx, ph = L.h * (0.5 + 0.5 * (h2(i * 37, L.seed * 91) / 100)), py = baseY - ph;
      peaks.push([px, py]); ctx.lineTo(px, py);
    }
    ctx.lineTo(VIEW_W + 40, VIEW_H + 40); ctx.closePath(); ctx.fill();
    ctx.fillStyle = L.snow;
    for (const [x, y] of peaks) { ctx.beginPath(); ctx.moveTo(x - 18, y + 26); ctx.lineTo(x, y); ctx.lineTo(x + 18, y + 26); ctx.lineTo(x + 8, y + 19); ctx.lineTo(x, y + 24); ctx.lineTo(x - 8, y + 19); ctx.closePath(); ctx.fill(); }
  }
}
// The climbable mountain's own snowy summit — a long left slope up to a peak.
function drawPeak() {
  if (rcam > 1500) return;
  const y = -rcam;
  ctx.fillStyle = '#5b606f';
  ctx.beginPath(); ctx.moveTo(232, 812 + y); ctx.lineTo(498, 470 + y); ctx.lineTo(560, 552 + y); ctx.lineTo(560, 812 + y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e9f1fb';
  ctx.beginPath(); ctx.moveTo(330, 700 + y); ctx.lineTo(498, 470 + y); ctx.lineTo(540, 522 + y);
  ctx.lineTo(486, 556 + y); ctx.lineTo(452, 588 + y); ctx.lineTo(410, 628 + y); ctx.lineTo(372, 664 + y); ctx.closePath(); ctx.fill();
}
function drawInterior() {
  for (const R of INTERIORS) {
    const sy = R.y - rcam; if (sy > VIEW_H || sy + R.h < 0) continue;
    const g = ctx.createLinearGradient(0, sy, 0, sy + R.h); g.addColorStop(0, '#161119'); g.addColorStop(1, '#0c0910');
    ctx.fillStyle = g; ctx.fillRect(R.x, Math.max(sy, 0), R.w, Math.min(R.h, VIEW_H - Math.max(sy, 0)));
    ctx.strokeStyle = 'rgba(150,130,170,0.06)'; ctx.lineWidth = 1;
    for (let by = Math.floor(R.y / 32) * 32; by < R.y + R.h; by += 32) { const yy = Math.round(by - rcam) + 0.5; ctx.beginPath(); ctx.moveTo(R.x, yy); ctx.lineTo(R.x + R.w, yy); ctx.stroke(); }
  }
}
function drawGears() { for (const gr of GEARS) { const y = gr.y - rcam; if (y < -60 || y > VIEW_H + 60) continue; ctx.save(); ctx.translate(gr.x, y); ctx.rotate(frames * 0.012 * (gr.r % 2 ? 1 : -1)); ctx.fillStyle = '#4a4450'; for (let i = 0; i < 8; i++) { ctx.rotate(0.7854); ctx.fillRect(-4, gr.r - 5, 8, 10); } ctx.beginPath(); ctx.arc(0, 0, gr.r, 0, 6.2832); ctx.fillStyle = '#574f5e'; ctx.fill(); ctx.beginPath(); ctx.arc(0, 0, gr.r * 0.4, 0, 6.2832); ctx.fillStyle = '#221d29'; ctx.fill(); ctx.restore(); } }
function speckle(x0, y0, w, h) { const wyTop = Math.max(y0, rcam), wyBot = Math.min(y0 + h, rcam + VIEW_H), xEnd = Math.min(x0 + w, VIEW_W + 10); for (let wy = Math.floor(wyTop / 12) * 12; wy < wyBot; wy += 12) for (let wx = Math.floor(x0 / 12) * 12; wx < xEnd; wx += 12) { const v = h2(wx, wy); if (v < 15) { ctx.fillStyle = '#463f3a'; ctx.fillRect(wx, wy - rcam, 6, 6); } else if (v > 88) { ctx.fillStyle = '#6b625b'; ctx.fillRect(wx + 4, wy - rcam + 4, 4, 4); } } }
function drawBody(s) {
  const sy = s.y - rcam; if (sy > VIEW_H || sy + s.h < 0) return;
  const x = Math.round(s.x), w = Math.round(s.w), top = Math.max(Math.round(sy), 0), bot = Math.min(Math.round(sy + s.h), VIEW_H); if (bot <= top) return;
  const snowY = Math.round(SNOWLINE - rcam);
  ctx.fillStyle = '#5a4f47'; ctx.fillRect(x, top, w, bot - top);
  if (snowY > top) { ctx.fillStyle = '#8f99a8'; ctx.fillRect(x, top, w, Math.min(bot, snowY) - top); }
  speckle(s.x, s.y, s.w, s.h);
  drawFaceEdge(s.x, top, bot);
}
function drawFaceEdge(faceX, top, bot) { const fx = Math.round(faceX); for (let yy = top - (top % 12); yy < bot; yy += 12) { const worldY = yy + rcam, bump = 6 + (h2(fx, Math.floor(worldY / 12)) % 16), px = fx - bump; if (worldY < SNOWLINE) { ctx.fillStyle = '#dfeaf5'; ctx.fillRect(px, yy, bump, 12); ctx.fillStyle = '#c6d6e2'; ctx.fillRect(px, yy + 9, bump, 3); } else { ctx.fillStyle = '#6b625b'; ctx.fillRect(px, yy, bump, 12); } } }
function drawLedge(s) { const x = Math.round(s.x), y = Math.round(s.y - rcam); if (y > VIEW_H || y + s.h < 0) return; const snowy = s.y < SNOWLINE; ctx.fillStyle = '#5a4f47'; ctx.fillRect(x, y, s.w, s.h); ctx.fillStyle = snowy ? '#eef4fa' : '#7a6f63'; ctx.fillRect(x, y, s.w, 4); if (snowy) { ctx.fillStyle = '#c6d6e2'; ctx.fillRect(x, y + 4, s.w, 2); } ctx.fillStyle = 'rgba(20,16,26,0.25)'; ctx.fillRect(x, y + s.h - 2, s.w, 2); }
function drawRuin(s) {
  const x = Math.round(s.x), y = Math.round(s.y - rcam); if (y > VIEW_H || y + s.h < 0) return;
  ctx.fillStyle = '#453c4c'; ctx.fillRect(x, y, s.w, s.h);
  ctx.strokeStyle = 'rgba(18,14,22,0.7)'; ctx.lineWidth = 1; let row = 0;
  for (let by = s.y; by < s.y + s.h; by += 13, row++) { const yy = Math.round(by - rcam) + 0.5; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + s.w, yy); ctx.stroke(); for (let bx = x + (row % 2 ? 0 : 13); bx < x + s.w; bx += 26) { ctx.beginPath(); ctx.moveTo(bx + 0.5, Math.round(by - rcam)); ctx.lineTo(bx + 0.5, Math.round(by - rcam) + 13); ctx.stroke(); } }
  ctx.fillStyle = '#564b5f'; ctx.fillRect(x, y, s.w, 3);
}
function drawMover(m) { const x = Math.round(m.x), y = Math.round(m.y - rcam); if (y > VIEW_H || y + m.h < 0) return; ctx.fillStyle = '#7a6f5a'; ctx.fillRect(x, y, m.w, m.h); ctx.fillStyle = '#9a8d70'; ctx.fillRect(x, y, m.w, 3); ctx.fillStyle = '#4b4436'; for (let bx = x + 4; bx < x + m.w - 2; bx += 10) ctx.fillRect(bx, y + m.h - 4, 4, 3); }
function drawGems() { for (const g of gems) { if (g.taken) continue; const sy = Math.round(g.y - rcam + Math.sin(frames * 0.08 + g.bob) * 3); if (sy < -12 || sy > VIEW_H + 12) continue; const x = Math.round(g.x); const gl = ctx.createRadialGradient(x, sy, 0, x, sy, 13); gl.addColorStop(0, 'rgba(126,231,255,0.45)'); gl.addColorStop(1, 'rgba(126,231,255,0)'); ctx.fillStyle = gl; ctx.fillRect(x - 13, sy - 13, 26, 26); ctx.fillStyle = '#7ee7ff'; ctx.fillRect(x - 2, sy - 5, 4, 10); ctx.fillRect(x - 5, sy - 2, 10, 4); ctx.fillStyle = '#d8f6ff'; ctx.fillRect(x - 1, sy - 4, 2, 3); } }
function drawAbilities() {
  if (!abilities) return;
  for (const a of abilities) {
    const px = Math.round(a.x), capY = Math.round(a.y + 20 - rcam);          // top of the pedestal ledge
    if (capY > -30 && capY < VIEW_H + 44) {                                   // stone pedestal — stays as a monument once taken
      ctx.fillStyle = '#4f4a59'; ctx.fillRect(px - 16, capY + 14, 32, 14);
      ctx.fillStyle = '#413c49'; ctx.fillRect(px - 23, capY + 26, 46, 6);
      ctx.fillStyle = a.taken ? 'rgba(150,150,175,0.5)' : a.color; ctx.fillRect(px - 9, capY + 17, 18, 3);   // rune inlay
    }
    if (a.taken) continue;
    const sy = a.y - rcam + Math.sin(frames * 0.06 + a.x) * 4; if (sy < -34 || sy > VIEW_H + 34) continue;
    const y = Math.round(sy);
    ctx.globalAlpha = 0.22; ctx.strokeStyle = a.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, y + 9); ctx.lineTo(px, capY); ctx.stroke(); ctx.globalAlpha = 1;   // beam to the pedestal
    const g = ctx.createRadialGradient(px, y, 0, px, y, 30);
    g.addColorStop(0, a.color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.45 + 0.3 * Math.sin(frames * 0.12 + a.x); ctx.fillStyle = g; ctx.fillRect(px - 30, y - 30, 60, 60); ctx.globalAlpha = 1;
    const r = 9 + Math.sin(frames * 0.1 + a.x) * 1.5;             // pulsing diamond shard
    ctx.fillStyle = a.color; ctx.beginPath(); ctx.moveTo(px, y - r); ctx.lineTo(px + r * 0.7, y); ctx.lineTo(px, y + r); ctx.lineTo(px - r * 0.7, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(px - 2, y - 3, 3, 5);
  }
}
function drawFlag() { const x = Math.round(FLAG.x), y = Math.round(FLAG.y - rcam); ctx.fillStyle = '#e9eefc'; ctx.fillRect(x, y - 64, 3, 64); const wav = Math.sin(frames * 0.15) * 3; ctx.fillStyle = '#ff5470'; ctx.beginPath(); ctx.moveTo(x + 3, y - 64); ctx.lineTo(x + 32, y - 58 + wav); ctx.lineTo(x + 3, y - 46); ctx.closePath(); ctx.fill(); }
function drawGrapple() {
  const p = player; if (!p) return;
  if (p.gState === 'idle' || p.gState === 'cling') { if (p.onGround && p.gState === 'idle' && state === STATE.PLAY) { ctx.globalAlpha = 0.16; ctx.fillStyle = '#fff'; for (let d = 20; d < HOOK_RANGE; d += 18) ctx.fillRect(Math.round(p.cx + p.facing * d), Math.round(p.cy - rcam), 3, 2); ctx.globalAlpha = 1; } return; }
  const hx = p.gState === 'firing' ? p.hx : p.ax, hy = (p.gState === 'firing' ? p.hy : p.ay) - rcam, hand = p.cx, handY = p.cy - rcam;
  for (let i = 0; i <= 10; i++) { const t = i / 10; ctx.fillStyle = i % 2 ? '#8a7a63' : '#6d5f4c'; ctx.fillRect(Math.round(hand + (hx - hand) * t) - 1, Math.round(handY + (hy - handY) * t) - 1, 3, 3); }
  ctx.fillStyle = '#c8ccd6'; ctx.fillRect(Math.round(hx) - 3, Math.round(hy) - 3, 6, 6);
}
function drawPlayer() {
  const p = player, bx = Math.round(p.x), by = Math.round(p.y - rcam), f = p.facing;
  const grip = p.gState === 'pull' || p.gState === 'cling';
  const run = p.onGround && Math.abs(p.vx) > 0.6, t = frames * 0.4;
  let sx = 1, syc = 1;
  if (p.landTimer > 0) { const k = p.landTimer / 8; syc = 1 - 0.3 * k; sx = 1 + 0.3 * k; }
  else if (!p.onGround && !grip) { syc = 1 + clamp(p.vy, -8, 10) / 50; sx = 1 / syc; }
  const bob = run ? Math.round(Math.abs(Math.sin(t)) * 2) : 0;
  for (let i = 0; i < p.trail.length - 1; i++) { const tp = p.trail[i], k = i / p.trail.length; ctx.globalAlpha = 0.12 + 0.5 * k; ctx.fillStyle = '#e0483f'; const s = 1 + Math.round(k * 4); ctx.fillRect(Math.round(tp.x - s / 2), Math.round(tp.y - rcam - s / 2), s, s); } ctx.globalAlpha = 1;   // scarf
  if (p.onGround && !grip) { const shy = Math.round(p.y + p.h - rcam) + 1; ctx.globalAlpha = 0.2; ctx.fillStyle = '#05070d'; ctx.beginPath(); ctx.ellipse(bx + p.w / 2, shy, p.w * 0.52, 3.4, 0, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1; }
  ctx.save(); ctx.translate(bx + p.w / 2, by + p.h / 2 - bob); ctx.scale(sx, syc); ctx.translate(-p.w / 2, -p.h / 2);
  // legs — animated run cycle / tucked in the air
  ctx.fillStyle = '#2f4668';
  if (!p.onGround) { ctx.fillRect(5, p.h - 5, 5, 5); ctx.fillRect(p.w - 10, p.h - 5, 5, 5); }
  else if (run) { const s = Math.sin(t) * 3; ctx.fillRect(Math.round(4 + s), p.h - 6, 5, 6); ctx.fillRect(Math.round(p.w - 9 - s), p.h - 6, 5, 6); }
  else { ctx.fillRect(4, p.h - 6, 5, 6); ctx.fillRect(p.w - 9, p.h - 6, 5, 6); }
  ctx.fillStyle = '#3a5f8a'; ctx.fillRect(f > 0 ? -3 : p.w - 3, 10, 6, 11);   // backpack
  ctx.fillStyle = p.gliding ? '#ffb14e' : '#e0563b'; ctx.fillRect(2, 8, p.w - 4, p.h - 13);   // torso
  // arm — reaches toward the rock when gripping, up when airborne, at side on the ground
  ctx.fillStyle = '#c94a34';
  if (grip) { const d = p.gState === 'cling' ? p.clingWall : (Math.sign(p.ax - p.cx) || f); ctx.fillRect(d > 0 ? p.w - 3 : -3, 8, 6, 4); }
  else if (!p.onGround) ctx.fillRect(f > 0 ? p.w - 4 : -1, 6, 5, 5);
  else ctx.fillRect(f > 0 ? p.w - 4 : -1, 12, 4, 6);
  ctx.fillStyle = '#f2c9a0'; ctx.fillRect(4, 0, p.w - 8, 9);                  // head
  ctx.fillStyle = '#d43f2a'; ctx.fillRect(3, 0, p.w - 6, 4);                  // helmet
  ctx.fillStyle = '#20242e'; ctx.fillRect(f > 0 ? p.w - 8 : 5, 4, 3, 3);      // eye
  ctx.restore();
  if (p.gliding) {                                   // glider canopy stretched overhead
    ctx.fillStyle = 'rgba(143,233,255,0.9)'; ctx.beginPath();
    ctx.moveTo(bx - 7, by + 1); ctx.lineTo(bx + p.w + 7, by + 1); ctx.lineTo(bx + p.w / 2, by - 9); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx + 2, by + 1); ctx.lineTo(bx + p.w / 2, by - 9); ctx.lineTo(bx + p.w - 2, by + 1); ctx.stroke();
  }
  if (p.dashCharges > 0 && !p.onGround && p.dashTime <= 0 && !grip) { ctx.globalAlpha = 0.5 + 0.3 * Math.sin(frames * 0.3); ctx.fillStyle = '#8fe9ff'; for (let i = 0; i < p.dashCharges; i++) ctx.fillRect(Math.round(bx + p.w / 2 - 1 + (i - (p.dashCharges - 1) / 2) * 5), by - 7, 3, 3); ctx.globalAlpha = 1; }
}
// ---- polish: screen shake · sky sun · ambient weather · buried-city glow · vignette · banners ----
let shake = 0, ambient = [];
const bannersShown = new Set();
const BANNERS = [
  { y: 19100, text: 'THE GLACIER — mind your footing, the ice is slick' },
  { y: 17920, text: 'THE CRUMBLING CRAG — keep moving, the rock gives way' },
  { y: 15600, text: 'THE VALLEY — base camp' },
  { y: 14350, text: 'THE PINE WOODS' },
  { y: 13600, text: 'THE OLD MINE — abandoned diggings' },
  { y: 11400, text: 'THE FROZEN FALLS' },
  { y: 9150, text: 'THE FOOTHILLS' },
  { y: 7100, text: 'THE LOWER FACE' },
  { y: 6300, text: 'THE BURIED CITY — an abandoned hall inside the mountain' },
  { y: 4500, text: 'BACK ONTO THE OPEN FACE' },
  { y: SNOWLINE, text: 'ABOVE THE SNOWLINE' },
  { y: 2650, text: 'THE SPIRE — wall-jump the chimney, or take the East Ledges' },
];
function addShake(v) { shake = Math.min(11, shake + v); }
function shakeXY() { if (shake < 0.3) return { x: 0, y: 0 }; return { x: Math.round((Math.random() * 2 - 1) * shake), y: Math.round((Math.random() * 2 - 1) * shake) }; }
function initWeather() { ambient = Array.from({ length: 64 }, () => ({ x: Math.random() * VIEW_W, y: Math.random() * VIEW_H, sp: 0.5 + Math.random() * 1.6, len: 3 + Math.random() * 9 })); }
function drawWeather() {
  if (!ambient.length) return;
  const alt = clamp(rcam / (WORLD.h - VIEW_H), 0, 1), mid = rcam + VIEW_H * 0.5;
  let indoor = false; for (const R of INTERIORS) if (mid > R.y + 40 && mid < R.y + R.h - 40) indoor = true;
  const snowy = rcam < SNOWLINE;
  const vis = indoor ? 0 : (snowy ? 1 : 0.4), wind = 1.0 + alt * 1.8, fall = snowy ? 1.05 : 0.5;
  for (const w of ambient) {
    w.x -= w.sp * wind; w.y += w.sp * fall;
    if (w.x < -12) { w.x = VIEW_W + 12; w.y = Math.random() * VIEW_H; }
    if (w.y > VIEW_H + 12) { w.y = -12; w.x = Math.random() * VIEW_W; }
    if (vis <= 0) continue;
    ctx.globalAlpha = vis * (snowy ? 0.5 : 0.26);
    if (snowy) { ctx.fillStyle = '#eef4fb'; const s = w.sp > 1.4 ? 2 : 1; ctx.fillRect(Math.round(w.x), Math.round(w.y), s, s); }
    else { ctx.fillStyle = '#c9d3e6'; ctx.fillRect(Math.round(w.x), Math.round(w.y), Math.round(w.len), 1); }
  }
  ctx.globalAlpha = 1;
}
function drawSun() {
  const alt = clamp(rcam / (WORLD.h - VIEW_H), 0, 1), cx = VIEW_W * 0.72, cy = 118 - alt * 34, R = 150, a = 0.10 + alt * 0.34;
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  halo.addColorStop(0, `rgba(255,231,178,${a})`); halo.addColorStop(0.5, `rgba(255,214,150,${a * 0.35})`); halo.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = halo; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.globalAlpha = 0.35 + alt * 0.5; ctx.fillStyle = '#fff3d6'; ctx.beginPath(); ctx.arc(cx, cy, 20 + alt * 8, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
}
const LANTERNS = [{ x: 120, y: 6220 }, { x: 300, y: 5600 }, { x: 96, y: 5040 }, { x: 300, y: 4860 }, { x: 255, y: 4640 }];
function drawCityAmbience() {
  if (CITY.y + CITY.h - rcam < -40 || CITY.y - rcam > VIEW_H + 40) return;
  const gy = 4590 - rcam;                                   // daylight pouring down the ceiling shaft
  const shaft = ctx.createLinearGradient(0, gy, 0, gy + 300);
  shaft.addColorStop(0, 'rgba(214,228,248,0.22)'); shaft.addColorStop(1, 'rgba(214,228,248,0)');
  ctx.fillStyle = shaft; ctx.beginPath(); ctx.moveTo(210, gy); ctx.lineTo(300, gy); ctx.lineTo(330, gy + 300); ctx.lineTo(180, gy + 300); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 16; i++) {                             // slow drifting dust motes (kept inside the hall)
    const mx = 84 + (h2(i * 13, 7) / 100) * 244 + Math.sin(frames * 0.015 + i) * 10;
    const sy = 4620 + ((((i * 121 - frames * 0.3) % 1640) + 1640) % 1640) - rcam;
    if (sy < 0 || sy > VIEW_H) continue;
    ctx.globalAlpha = 0.16 + 0.12 * Math.sin(frames * 0.05 + i); ctx.fillStyle = '#d8c7a6'; ctx.fillRect(Math.round(mx), Math.round(sy), 2, 2);
  }
  ctx.globalAlpha = 1;
  for (const L of LANTERNS) {                                // warm, flickering lantern glow
    const ly = L.y - rcam; if (ly < -80 || ly > VIEW_H + 80) continue;
    const fl = 0.72 + 0.28 * Math.sin(frames * 0.2 + L.x) + (h2(L.x, frames >> 2) / 100 - 0.5) * 0.2, R = 62;
    const g = ctx.createRadialGradient(L.x, ly, 0, L.x, ly, R);
    g.addColorStop(0, `rgba(255,183,92,${0.5 * fl})`); g.addColorStop(0.5, `rgba(255,150,70,${0.16 * fl})`); g.addColorStop(1, 'rgba(255,150,70,0)');
    ctx.fillStyle = g; ctx.fillRect(L.x - R, ly - R, R * 2, R * 2);
    ctx.fillStyle = '#ffd27a'; ctx.fillRect(Math.round(L.x) - 2, Math.round(ly) - 2, 4, 4);
    ctx.fillStyle = `rgba(255,241,205,${0.85 * fl})`; ctx.fillRect(Math.round(L.x) - 1, Math.round(ly) - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
}
const BIOMES = [
  { y: 19500, c: [206, 228, 244] }, // glacier — pale ice
  { y: 18050, c: [140, 100, 78] },  // crumbling crag — brown rock
  { y: 16900, c: [96, 150, 84] },   // valley — green
  { y: 14300, c: [70, 118, 74] },   // pine woods — deep green
  { y: 12400, c: [112, 82, 132] },  // the mine — purple gloom
  { y: 10500, c: [128, 176, 216] }, // frozen falls — icy blue
  { y: 8500, c: [150, 150, 162] },  // foothills — grey stone
  { y: 5400, c: [122, 108, 142] },  // buried city — dusk
  { y: 3400, c: [198, 214, 236] },  // snowfields — white-blue
  { y: 900, c: [92, 104, 146] },    // the summit — cold
];
function drawBiomeTint() {
  const cy = rcam + VIEW_H / 2; let c = BIOMES[BIOMES.length - 1].c;
  if (cy >= BIOMES[0].y) c = BIOMES[0].c;
  else for (let i = 0; i < BIOMES.length - 1; i++) if (cy < BIOMES[i].y && cy >= BIOMES[i + 1].y) { const k = (BIOMES[i].y - cy) / (BIOMES[i].y - BIOMES[i + 1].y); c = BIOMES[i].c.map((v, j) => Math.round(v + (BIOMES[i + 1].c[j] - v) * k)); break; }
  ctx.globalAlpha = 0.17; ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.globalAlpha = 1;
}
function drawVignette() {
  const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.46, VIEW_H * 0.34, VIEW_W / 2, VIEW_H * 0.52, VIEW_H * 0.82);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(6,8,16,0.4)'); ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function hudControls() {
  const k = (a) => keyName(BINDS[a]);
  const c = [k('left') + ' ' + k('right') + '  move', k('jump') + '  jump ×2 · wall-jump', k('dash') + '  dash' + (unlocked.dash2 ? ' ×2' : ''), k('grapple') + '  grapple → zip & hang'];
  if (unlocked.glide) c.push(k('jump') + ' (air)  glide');
  if (unlocked.climb) c.push(k('up') + ' on wall  climb');
  return c;
}
function drawHUD() {
  const lines = hudControls();
  ctx.fillStyle = 'rgba(0,0,0,0.32)'; roundRect(10, 10, 220, 20 + lines.length * 17, 8); ctx.fill();
  ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,0.9)';
  lines.forEach((c, i) => ctx.fillText(c, 20, 26 + i * 17));
  const height = Math.max(0, Math.round((SPAWN.y - (player.y + player.h)) / 10));
  ctx.font = '700 16px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillText(`▲ ${height} m`, VIEW_W - 14, 24); ctx.fillText(`◆ ${gemsGot}/${gems.length}`, VIEW_W - 14, 46);
  if (toast && toast.life > 0) { ctx.globalAlpha = toast.life < 30 ? toast.life / 30 : 1; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(VIEW_W / 2 - 200, VIEW_H - 44, 400, 30, 8); ctx.fill(); ctx.font = '700 13px system-ui, sans-serif'; ctx.fillStyle = '#ffe08a'; ctx.fillText(toast.text, VIEW_W / 2, VIEW_H - 29); ctx.globalAlpha = 1; }
}
function showToast(text) { toast = { text, life: 320 }; }
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

const startEl = document.getElementById('start');
const winEl = document.getElementById('win');
function startGame() { initAudio(); resetGame(); state = STATE.PLAY; startEl.classList.add('hidden'); winEl.classList.add('hidden'); showToast('Climb the face · grapple (E) the rock to wall-jump · touch glowing shrines to learn new movement techs.'); }
function showWin() {
  const t = frames / 60, secs = t.toFixed(1);
  let best = null; try { best = JSON.parse(localStorage.getItem('ascent-best') || 'null'); } catch (_) { }
  const improved = best && (t < best.time || gemsGot > best.gems);
  const nb = { time: best ? Math.min(best.time, t) : t, gems: Math.max(gemsGot, best ? best.gems : 0) };
  try { localStorage.setItem('ascent-best', JSON.stringify(nb)); } catch (_) { }
  document.getElementById('winStats').innerHTML =
    `Time: <b>${secs}s</b> &nbsp;·&nbsp; Crystals: <b>${gemsGot} / ${gems.length}</b>` +
    (best ? `<br><span style="opacity:.65">Best: ${nb.time.toFixed(1)}s · ${nb.gems} crystals</span>` : '') +
    (improved ? `<br><b style="color:#ffe08a">★ NEW BEST!</b>` : '');
  winEl.classList.remove('hidden');
}
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('replayBtn').addEventListener('click', startGame);

// ---- Keybinds panel ----
const bindsEl = document.getElementById('binds');
const bindListEl = document.getElementById('bindList');
const BIND_ROWS = [['left', 'Move left'], ['right', 'Move right'], ['up', 'Up / climb'], ['down', 'Down / dash-down'], ['jump', 'Jump / glide'], ['dash', 'Dash'], ['grapple', 'Grapple'], ['restart', 'Restart']];
let rebindAction = null;
function renderBinds() {
  bindListEl.innerHTML = '';
  for (const [act, label] of BIND_ROWS) {
    const l = document.createElement('div'); l.className = 'lbl'; l.textContent = label;
    const b = document.createElement('button'); b.className = 'keybtn' + (rebindAction === act ? ' listening' : '');
    b.textContent = rebindAction === act ? 'press a key…' : keyName(BINDS[act]);
    b.addEventListener('click', () => { rebindAction = act; renderBinds(); });
    bindListEl.appendChild(l); bindListEl.appendChild(b);
  }
}
window.addEventListener('keydown', (e) => {
  if (rebindAction === null) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.code !== 'Escape') rebindKey(rebindAction, e.code);
  rebindAction = null; renderBinds();
}, true);
document.getElementById('bindsBtn').addEventListener('click', () => { startEl.classList.add('hidden'); bindsEl.classList.remove('hidden'); renderBinds(); });
document.getElementById('bindsDone').addEventListener('click', () => { rebindAction = null; bindsEl.classList.add('hidden'); startEl.classList.remove('hidden'); });
document.getElementById('bindsReset').addEventListener('click', () => { BINDS = { ...DEFAULT_BINDS }; saveBinds(); renderBinds(); });

resetGame();
requestAnimationFrame(frame);
