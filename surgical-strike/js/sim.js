// Mission simulation. DOM-free so it can be tested headless.
//
// A Simulation runs one attempt: crew units follow their planned orders while
// enemies patrol / hear / see, and at fireTime the bullet resolves in slow
// motion ("cam" phase). Intel (fog grid, known enemies) is shared with the
// app and persists across attempts.

const TUNING = {
  sneakSpeed: 1.15,
  walkSpeed: 2.6,
  coverSpeed: 2.3,        // undercover scout: a confident, unhurried walk
  coverExposure: 3.5,     // seconds of direct scrutiny before a disguise is blown
  opSpeed: 1.3,           // decoy / hacker (they only ever creep)
  droneSpeed: 3.5,
  walkNoise: 6.5,
  opNoise: 2.0,           // decoy / hacker footsteps
  tapNoise: 16,
  stepInterval: 0.45,
  wallSoundDamp: 0.5,     // noise radius multiplier when a wall/window is in the way
  poisonReach: 1.2,       // how close a POISON waypoint must be to a routine stop
  poisonDelay: 2.5,       // seconds at a dosed stop before the poison takes hold
  suspicionTime: 5,       // seconds an enemy stays displaced after reacting
  investigateMax: 6,      // how far an investigator will walk toward a noise
  exposureLimit: 0.45,    // seconds an operative can sit in a vision cone before being spotted
  stillExposure: 3.5,     // a motionless assassin takes this long to register
  stillVisionMult: 0.5,   // and is only noticed at half the usual distance
  chaseSpeedMult: 1.6,    // guards run when they charge
  sprintSpeed: 3.0,       // hunted operatives sprint along their planned route
  sliceRange: 1.0,        // melee guards kill at arm's reach
  shootRange: 8,          // armed guards fire from here...
  aimTime: 1.2,           // ...after this long on target
  giveUpAfter: 2.5,       // seconds without sight before a chase is abandoned
  blackoutVision: 0.45,   // enemy vision multiplier while the power is cut
  boxRange: 1.8,          // how close the hacker must be to a junction box
  bulletSpeed: 240,       // m/s (sim time; the cam phase slows wall-clock time, not this)
  smokeDur: 8,            // seconds a smoke cloud blocks vision
  smokeRadius: 3.2,
  enemyRadius: 0.35,
  scoutSightRays: 60,
  opSightRange: 4,        // decoy / hacker reveal range
  exfilRadius: 2.6,       // how close to the insertion point counts as "slipped out"
  exfilLeaveDist: 4,      // must have ventured this far before a return counts as an exfil
};

const WORLD = { w: 48, h: 32, fogCell: 0.5, fogW: 96, fogH: 64 };

const GROUND_UNITS = ["scout", "assassin", "spotter", "decoy", "hacker", "sapper", "gunner", "lockpick"];
const RECON_UNITS = ["scout", "spotter", "drone", "assassin", "hacker", "lockpick"]; // deployable on recon ops

// Site alert ("heat"): a botched hit that DISTURBED the site leaves it warier.
// Senses sharpen a little, and targets shuffle their routines so memorized
// fire times go stale. Recon never adds heat — a clean recon op cools it.
const heatAlertMult = h => 1 + 0.06 * Math.min(3, h || 0);
const heatShift = h => 2.2 * Math.min(3, h || 0);

function fogIndex(x, y) {
  const cx = Math.max(0, Math.min(WORLD.fogW - 1, Math.floor(x / WORLD.fogCell)));
  const cy = Math.max(0, Math.min(WORLD.fogH - 1, Math.floor(y / WORLD.fogCell)));
  return cy * WORLD.fogW + cx;
}

function unitSpeedFor(kind) {
  if (kind === "drone") return () => TUNING.droneSpeed;
  if (kind === "scout") {
    return wp => wp.mode === "walk" ? TUNING.walkSpeed
      : wp.mode === "cover" ? TUNING.coverSpeed
      : TUNING.sneakSpeed;
  }
  if (kind === "assassin") {
    return wp => (wp.mode === "walk" || wp.mode === "cover") ? TUNING.walkSpeed : TUNING.sneakSpeed;
  }
  return () => TUNING.opSpeed;
}

// Where an enemy would be at time t if nothing disturbed its patrol.
// Returns { x, y, facing }. Used for planning ghosts.
function patrolPosAt(def, t) {
  const pts = def.patrol;
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, facing: pts[0].face ?? 0 };
  let cycle = def._cycle;
  if (!cycle) {
    cycle = [];
    let total = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const travel = G.dist(a.x, a.y, b.x, b.y) / def.speed;
      cycle.push({ a, b, wait: a.wait || 0, travel });
      total += (a.wait || 0) + travel;
    }
    cycle.total = total;
    def._cycle = cycle;
  }
  let rem = ((t % cycle.total) + cycle.total) % cycle.total;
  for (const seg of cycle) {
    if (rem < seg.wait) {
      const moveDir = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x);
      return { x: seg.a.x, y: seg.a.y, facing: seg.a.face ?? moveDir };
    }
    rem -= seg.wait;
    if (rem < seg.travel) {
      const f = rem / seg.travel;
      return {
        x: G.lerp(seg.a.x, seg.b.x, f),
        y: G.lerp(seg.a.y, seg.b.y, f),
        facing: Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x),
      };
    }
    rem -= seg.travel;
  }
  return { x: pts[0].x, y: pts[0].y, facing: pts[0].face ?? 0 };
}

// Full patrol machine state at time t — used to fast-forward a heated
// target's routine at mission start.
function patrolStateAt(def, t) {
  const pts = def.patrol;
  if (pts.length === 1) return null;
  patrolPosAt(def, 0); // ensure the cycle cache exists
  const cycle = def._cycle;
  let rem = ((t % cycle.total) + cycle.total) % cycle.total;
  for (let i = 0; i < cycle.length; i++) {
    const seg = cycle[i];
    if (rem < seg.wait) {
      const moveDir = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x);
      return {
        x: seg.a.x, y: seg.a.y, facing: seg.a.face ?? moveDir,
        mode: "wait", waitLeft: seg.wait - rem, prevWp: seg.a, patIdx: (i + 1) % pts.length,
      };
    }
    rem -= seg.wait;
    if (rem < seg.travel) {
      const f = rem / seg.travel;
      return {
        x: G.lerp(seg.a.x, seg.b.x, f), y: G.lerp(seg.a.y, seg.b.y, f),
        facing: Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x),
        mode: "move", waitLeft: 0, prevWp: seg.a, patIdx: (i + 1) % pts.length,
      };
    }
    rem -= seg.travel;
  }
  return null;
}

// Where a unit would be at time t following its path (with holds) undisturbed.
function pathPosAt(spawn, path, t, speedFor) {
  let px = spawn.x, py = spawn.y, clock = 0;
  let facing = path.length ? Math.atan2(path[0].y - py, path[0].x - px) : 0;
  for (const wp of path) {
    const legTime = G.dist(px, py, wp.x, wp.y) / speedFor(wp);
    if (G.dist(px, py, wp.x, wp.y) > 0.05) facing = Math.atan2(wp.y - py, wp.x - px);
    if (t < clock + legTime) {
      const f = (t - clock) / legTime;
      return { x: G.lerp(px, wp.x, f), y: G.lerp(py, wp.y, f), facing, done: false, holding: false };
    }
    clock += legTime;
    px = wp.x; py = wp.y;
    const hold = wp.hold || 0;
    if (t < clock + hold) return { x: px, y: py, facing, done: false, holding: true };
    clock += hold;
  }
  return { x: px, y: py, facing, done: true, holding: false };
}

// Per-waypoint [arrive, depart] times (depart = arrive + hold). For the timeline.
function pathIntervals(spawn, path, speedFor) {
  const out = [];
  let px = spawn.x, py = spawn.y, clock = 0;
  for (const wp of path) {
    const start = clock;
    clock += G.dist(px, py, wp.x, wp.y) / speedFor(wp);
    const arrive = clock;
    clock += wp.hold || 0;
    out.push({ start, arrive, depart: clock, wp });
    px = wp.x; py = wp.y;
  }
  out.total = clock;
  return out;
}

class Simulation {
  // plan: { scoutPath, dronePath, decoyPath, hackerPath, throws:[{t,x,y}],
  //         blackouts:[{t}], perchIndex, aim:{x,y}, fireTime }
  // perks: from perkValues(); avail: {drone,decoy,hacker} booleans;
  // intel: shared { grid, known:Set, lastSeen:{}, revealVersion }
  constructor(level, plan, perks, intel, avail = { assassin: true, spotter: true, drone: true, decoy: true, hacker: true, sapper: true, gunner: true, lockpick: true }, dev = {}) {
    this.level = level;
    this.dev = dev; // playtest toggles: { invincible, freezeEnemies }
    this.walls = level.walls.slice(); // per-run copy: the Sapper blows holes in it
    this.holes = []; // breach rubble, for the renderer
    this.keyholderKills = 0;
    // Locked doors: solid until cracked, brute-forced, or opened with a
    // keycard lifted from the marked keyholder's body.
    this.doors = (level.doors || []).map((d, i) => ({
      ...d, id: i, open: false, progress: 0, keyTaken: false,
      keyIdx: level.enemies.findIndex(e => e.name === d.key),
    }));
    for (const d of this.doors) {
      this.walls.push({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, doorId: d.id });
    }
    this.plan = plan;
    this.perks = perks;
    this.intel = intel;

    // Live render view: committed intel plus whatever watchers currently see
    // (undelivered reveals show on screen but don't persist between attempts).
    this.viewGrid = new Uint8Array(intel.grid.length);
    this.viewGrid.set(intel.grid);
    this.view = { grid: this.viewGrid, revealVersion: 0 };
    this._viewCommitVer = intel.revealVersion;
    this._viewPendCount = 0;
    this.hasJammer = level.enemies.some(e => e.jammer);
    this.lostIntel = 0;
    this.commsJammed = false;

    this.t = 0;
    this.phase = "run"; // run -> cam -> done
    this.result = null;
    this.events = [];
    this.noises = []; // recent, for ripple rendering: {x, y, r, t0}
    this.fired = false;
    this.bullet = null;
    this.recon = !!plan.recon; // observation run: no shot allowed
    this.assassinMark = plan.assassinMark ?? null;   // enemy index to hunt
    this.assassinGuard = plan.assassinGuard ?? null; // crew kind to bodyguard
    this.alertMult = heatAlertMult(intel.heat);
    this.targetShift = heatShift(intel.heat);
    this.disturbed = false; // did the site notice anything this attempt?

    // Shots: multi-target missions schedule several; old single-shot plans
    // (aim + fireTime) are wrapped for compatibility.
    const rawShots = plan.shots && plan.shots.length
      ? plan.shots
      : (plan.aim && plan.fireTime != null ? [{ aim: plan.aim, fireTime: plan.fireTime }] : []);
    this.shots = this.recon ? [] : rawShots
      .filter(s => s.aim && s.fireTime != null)
      .map(s => ({ aim: s.aim, fireTime: s.fireTime, fired: false }))
      .sort((a, b) => a.fireTime - b.fireTime);
    this.canFire = plan.perchIndex != null && this.shots.length > 0;

    // Poisonable routine stops: anywhere a target lingers 3s or more.
    this.poisonSpots = [];
    level.enemies.forEach((def, i) => {
      if (!def.isTarget) return;
      for (const w of def.patrol) {
        if ((w.wait || 0) >= 3) this.poisonSpots.push({ idx: i, x: w.x, y: w.y });
      }
    });
    this.planted = [];
    this.smokes = []; // active clouds: {x, y, t0}
    this.blackoutUntil = -1;
    this.knifeThrown = 0;
    this.breachesUsed = 0;
    this.susBumps = 0;   // sightings this run — permanent suspicion for the mission
    this.baseHeat = intel.heat || 0;
    this.throws = (plan.throws || []).map(th => ({ ...th, done: false }));
    this.blackouts = (plan.blackouts || []).map(b => ({ ...b, done: false }));
    this.blares = (plan.blares || []).map(b => ({ ...b, done: false }));
    this.suppresses = this.recon ? [] : (plan.suppresses || []).map(s => ({ ...s, done: false }));

    const mkUnit = (kind, path) => {
      const spawn = unitSpawn(level, kind);
      const first = path[0];
      return {
        kind, path,
        x: spawn.x, y: spawn.y, spawn: { x: spawn.x, y: spawn.y },
        facing: first ? Math.atan2(first.y - spawn.y, first.x - spawn.x) : 0,
        legIndex: 0, holdLeft: 0, stepTimer: 0, humTimer: 0,
        moving: false, done: path.length === 0,
        exposure: 0, exposureLimit: TUNING.exposureLimit, lastLimit: null,
        coverMode: false, dead: false,
        // Intel-delivery loop: reveals gather here and only reach the shared
        // intel when this unit either has a live feed or slips back out (exfil).
        // seenCells is everything this unit has ever revealed (an enemy standing
        // in one counts as spotted); pendGrid is the slice not yet delivered.
        seenCells: new Set(), pendGrid: new Set(), pendSeen: {}, leftSpawn: false, exfiled: false,
        speedFor: unitSpeedFor(kind),
      };
    };
    this.units = { scout: mkUnit("scout", plan.scoutPath || []) };
    if (avail.assassin && ((plan.assassinPath || []).length || plan.assassinMark != null || plan.assassinGuard))
      this.units.assassin = mkUnit("assassin", plan.assassinPath || []);
    if (avail.spotter && (plan.spotterPath || []).length) this.units.spotter = mkUnit("spotter", plan.spotterPath);
    if (avail.lockpick && (plan.lockpickPath || []).length) this.units.lockpick = mkUnit("lockpick", plan.lockpickPath);
    if (avail.sapper && (plan.sapperPath || []).length && !this.recon) this.units.sapper = mkUnit("sapper", plan.sapperPath);
    if (avail.gunner && ((plan.gunnerPath || []).length || (plan.suppresses || []).length) && !this.recon) this.units.gunner = mkUnit("gunner", plan.gunnerPath || []);
    if (avail.drone && (plan.dronePath || []).length) this.units.drone = mkUnit("drone", plan.dronePath);
    if (avail.decoy && ((plan.decoyPath || []).length || this.throws.length)) this.units.decoy = mkUnit("decoy", plan.decoyPath || []);
    if (avail.hacker && ((plan.hackerPath || []).length || this.blackouts.length)) this.units.hacker = mkUnit("hacker", plan.hackerPath || []);

    this.enemies = level.enemies.map((def, i) => {
      const first = def.patrol[0];
      const next = def.patrol.length > 1 ? def.patrol[1] : first;
      const e = {
        def, idx: i,
        x: first.x, y: first.y,
        facing: first.face ?? Math.atan2(next.y - first.y, next.x - first.x),
        mode: "wait", // wait | move | react-move | react-wait | return | attack
        patIdx: def.patrol.length > 1 ? 1 : 0,
        prevWp: first,
        waitLeft: first.wait || 0,
        home: null, noisePos: null, reactPoint: null,
        seesUnit: false, alive: true, lastReactLog: -99, droneReactAt: -99,
      };
      // A heated site's targets are mid-routine, not where you memorized them.
      if (def.isTarget && this.targetShift > 0) {
        const st = patrolStateAt(def, this.targetShift);
        if (st) Object.assign(e, st);
      }
      return e;
    });
  }

  isBlackout() { return this.t < this.blackoutUntil; }

  // Live alertness: base heat plus suspicion raised by sightings THIS run.
  aMult() { return heatAlertMult(this.baseHeat + Math.min(2, this.susBumps)); }

  susBump(e) {
    if (e.susFlag) return;
    e.susFlag = true;
    this.susBumps += 0.5;
  }

  // Sapper: blow a hole in the nearest wall within reach.
  breachWall(x, y) {
    let best = null, bestD = 1.5;
    for (const w of this.walls) {
      const d = G.pointSegDist(x, y, w.x1, w.y1, w.x2, w.y2);
      if (d < bestD) { bestD = d; best = w; }
    }
    if (!best) return false;
    const w = best;
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const L = Math.hypot(dx, dy) || 1;
    let s = ((x - w.x1) * dx + (y - w.y1) * dy) / (L * L);
    s = Math.max(0, Math.min(1, s)) * L;
    const half = this.perks.breachWidth ?? 1.2;
    const ux = dx / L, uy = dy / L;
    this.walls.splice(this.walls.indexOf(w), 1);
    if (s - half > 0.4) this.walls.push({ ...w, x2: w.x1 + ux * (s - half), y2: w.y1 + uy * (s - half) });
    if (L - (s + half) > 0.4) this.walls.push({ ...w, x1: w.x1 + ux * (s + half), y1: w.y1 + uy * (s + half) });
    this.holes.push({ x: w.x1 + ux * s, y: w.y1 + uy * s });
    this.intel.revealVersion++;
    return true;
  }

  log(msg) {
    this.events.push({ t: this.t, msg });
  }

  emitNoise(x, y, r) {
    this.noises.push({ x, y, r, t0: this.t });
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = G.dist(e.x, e.y, x, y);
      const damp = G.losBlocked(e.x, e.y, x, y, this.walls, false) ? TUNING.wallSoundDamp : 1;
      if (d < r * damp * e.def.hearingMult * this.aMult()) this.react(e, x, y);
    }
  }

  react(e, nx, ny) {
    if (this.dev.freezeEnemies) return; // dev: frozen foes ignore noise
    if (e.mode === "attack") return; // a charging guard doesn't chase noises
    this.disturbed = true;
    const investigate = e.def.behavior === "investigate";
    if (e.mode === "wait" || e.mode === "move") e.home = { x: e.x, y: e.y };
    e.noisePos = { x: nx, y: ny };
    const d = G.dist(e.x, e.y, nx, ny);
    let dir, dist;
    if (investigate) {
      dir = G.norm(nx - e.x, ny - e.y);
      dist = Math.min(TUNING.investigateMax, Math.max(0, d - 0.8));
    } else {
      dir = G.norm(e.x - nx, e.y - ny);
      dist = e.def.retreatDist;
    }
    // Don't let the reaction move them through a wall.
    const ex = e.x + dir.x * dist, ey = e.y + dir.y * dist;
    const hit = G.raycast(e.x, e.y, ex, ey, this.walls);
    const usable = hit ? Math.max(0, hit.t * dist - 0.5) : dist;
    e.reactPoint = { x: e.x + dir.x * usable, y: e.y + dir.y * usable };
    e.mode = "react-move";
    if (this.t - e.lastReactLog > 4) {
      this.log(`${e.def.name} ${investigate ? "moved to investigate a sound" : "backed away from a sound"}`);
      e.lastReactLog = this.t;
    }
  }

  moveToward(o, tx, ty, speed, dt) {
    const d = G.dist(o.x, o.y, tx, ty);
    const step = speed * dt;
    if (d <= step || d < 0.05) {
      o.x = tx; o.y = ty;
      return true;
    }
    o.x += ((tx - o.x) / d) * step;
    o.y += ((ty - o.y) / d) * step;
    return false;
  }

  updateEnemy(e, dt) {
    const def = e.def;
    let facingGoal = e.facing;

    // A dosed routine stop kills quietly a moment after the target settles in.
    if (e.mode === "wait" && def.isTarget && this.planted.length) {
      const spot = this.planted.find(s => s.idx === e.idx && G.dist(s.x, s.y, e.x, e.y) < 0.7);
      if (spot) {
        e.poisonT = (e.poisonT || 0) + dt;
        if (e.poisonT > (this.perks.poisonDelay ?? TUNING.poisonDelay)) {
          e.alive = false;
          this.log(`${def.name} collapsed — the poison took hold`);
          const remaining = this.enemies.filter(en => en.def.isTarget && en.alive);
          if (!remaining.length) {
            const many = this.enemies.filter(en => en.def.isTarget).length > 1;
            this.result = {
              success: true, reason: "hit-target",
              title: many ? "ALL TARGETS ELIMINATED" : "TARGET ELIMINATED",
              detail: "Quiet work — nobody heard a thing.",
            };
            this.phase = "done";
          }
          return;
        }
      }
    }

    if (e.mode === "cower") {
      if (this.t >= e.cowerUntil) e.mode = "return";
    } else if (e.mode === "wait") {
      e.waitLeft -= dt;
      facingGoal = e.prevWp.face ?? e.facing;
      if (e.waitLeft <= 0 && def.patrol.length > 1) e.mode = "move";
    } else if (e.mode === "move") {
      const wp = def.patrol[e.patIdx];
      facingGoal = Math.atan2(wp.y - e.y, wp.x - e.x);
      if (this.moveToward(e, wp.x, wp.y, def.speed, dt)) {
        e.prevWp = wp;
        e.waitLeft = wp.wait || 0;
        e.patIdx = (e.patIdx + 1) % def.patrol.length;
        e.mode = "wait";
      }
    } else if (e.mode === "attack") {
      const u = this.units[e.attackTarget];
      if (!u || u.dead) {
        e.mode = "return";
      } else {
        const d = G.dist(e.x, e.y, u.x, u.y);
        const sees = this.enemySees(e, u.x, u.y, 1.2); // a chasing guard is locked on
        if (sees) e.lastSawT = this.t;
        facingGoal = Math.atan2(u.y - e.y, u.x - e.x);
        const label = e.attackTarget[0].toUpperCase() + e.attackTarget.slice(1);
        if (this.t - (e.lastSawT ?? -99) > TUNING.giveUpAfter) {
          this.log(`${def.name} lost them`);
          e.mode = "return";
        } else if (def.armed && sees && d <= TUNING.shootRange) {
          e.aimT = (e.aimT || 0) + dt;
          if (e.aimT >= TUNING.aimTime) {
            this.killUnit(u, `${def.name} shot the ${label}`);
            this.emitNoise(e.x, e.y, 16);
            e.mode = "return";
            e.aimT = 0;
          }
        } else if (d <= TUNING.sliceRange) {
          this.killUnit(u, `${def.name} cut the ${label} down`);
          this.emitNoise(e.x, e.y, 3);
          e.mode = "return";
        } else {
          e.aimT = 0;
          // Run them down — but walls are still walls.
          const step = def.speed * TUNING.chaseSpeedMult * dt;
          const dir = G.norm(u.x - e.x, u.y - e.y);
          const hit = G.raycast(e.x, e.y, e.x + dir.x * (step + 0.3), e.y + dir.y * (step + 0.3), this.walls);
          if (!hit) {
            e.x += dir.x * step;
            e.y += dir.y * step;
          }
        }
      }
    } else if (e.mode === "react-move") {
      facingGoal = Math.atan2(e.noisePos.y - e.y, e.noisePos.x - e.x);
      if (this.moveToward(e, e.reactPoint.x, e.reactPoint.y, def.speed * 1.15, dt)) {
        e.mode = "react-wait";
        e.waitLeft = TUNING.suspicionTime;
      }
    } else if (e.mode === "react-wait") {
      facingGoal = Math.atan2(e.noisePos.y - e.y, e.noisePos.x - e.x);
      e.waitLeft -= dt;
      if (e.waitLeft <= 0) e.mode = "return";
    } else if (e.mode === "return") {
      facingGoal = Math.atan2(e.home.y - e.y, e.home.x - e.x);
      if (this.moveToward(e, e.home.x, e.home.y, def.speed, dt)) {
        e.mode = def.patrol.length > 1 ? "move" : "wait";
        e.waitLeft = 0;
      }
    }

    const diff = G.angleDiff(e.facing, facingGoal);
    const turn = 6 * dt;
    e.facing += Math.abs(diff) < turn ? diff : Math.sign(diff) * turn;
  }

  // Can enemy e see world point (x, y)? rangeMult widens the check (drones are airborne
  // and easier to notice); blackout shrinks everyone's vision.
  enemySees(e, x, y, rangeMult = 1) {
    if (this.dev.freezeEnemies) return false; // dev: foes are blind while frozen
    if (e.mode === "cower") return false;
    const vision = e.def.vision * rangeMult * this.aMult() * (this.isBlackout() ? TUNING.blackoutVision : 1);
    const d = G.dist(e.x, e.y, x, y);
    if (d > vision) return false;
    const ang = Math.atan2(y - e.y, x - e.x);
    if (Math.abs(G.angleDiff(e.facing, ang)) > e.def.fovRad / 2) return false;
    for (const s of this.smokes) {
      if (this.t - s.t0 < TUNING.smokeDur &&
          G.pointSegDist(s.x, s.y, e.x, e.y, x, y) < TUNING.smokeRadius) return false;
    }
    return !G.losBlocked(e.x, e.y, x, y, this.walls, true);
  }

  updateUnit(u, dt) {
    if (u.dead) return;
    const path = u.path;
    u.moving = false;

    // The assassin drops its planned route to pursue a reachable mark/attacker;
    // the standing-orders block moves it instead this tick.
    if (u.kind === "assassin" && this.assassinActiveGoal()) return;

    // The drone hums constantly — quieter while hovering.
    if (u.kind === "drone") {
      u.humTimer -= dt;
      if (u.humTimer <= 0) {
        u.humTimer = 0.4;
        const r = this.perks.droneHum * (u.done || u.holdLeft > 0 ? 0.6 : 1);
        this.emitNoise(u.x, u.y, r);
      }
    }

    if (u.done) return;
    if (u.holdLeft > 0) { u.holdLeft -= dt; return; }

    const wp = path[u.legIndex];
    // Hunted operatives bolt along their planned route (loudly) by default —
    // unless you've ordered this unit to HOLD, in which case they keep their
    // pace and stay quiet instead of panicking.
    const hunted = u.kind !== "drone" &&
      this.enemies.some(en => en.alive && en.mode === "attack" && en.attackTarget === u.kind);
    const runAway = hunted && ((this.plan.stance || {})[u.kind] || "run") === "run";
    const speed = runAway ? Math.max(u.speedFor(wp), this.perks.sprintSpeed ?? TUNING.sprintSpeed) : u.speedFor(wp);
    // A locked door in the way: wait there and work the lock (updateDoors).
    if (u.kind !== "drone" && this.doors.some(d => !d.open)) {
      const step = speed * dt + 0.25;
      const dir = G.norm(wp.x - u.x, wp.y - u.y);
      if (G.raycast(u.x, u.y, u.x + dir.x * step, u.y + dir.y * step, this.walls, w => w.doorId != null)) {
        u.moving = false;
        return;
      }
    }
    u.moving = true;
    u.curMode = wp.mode;
    if (u.kind === "scout") u.coverMode = !hunted && wp.mode === "cover";
    // Look where you're going — your sight arc points along your travel.
    if (G.dist(u.x, u.y, wp.x, wp.y) > 0.05) u.facing = Math.atan2(wp.y - u.y, wp.x - u.x);

    if (this.moveToward(u, wp.x, wp.y, speed, dt)) {
      if (wp.tap && u.kind === "scout") {
        this.emitNoise(u.x, u.y, this.perks.tapRadius ?? TUNING.tapNoise);
        this.log("Scout tapped on the wall");
      }
      if (wp.smoke && u.kind === "scout" && this.perks.smoke) {
        this.smokes.push({ x: u.x, y: u.y, t0: this.t });
        this.emitNoise(u.x, u.y, 3);
        this.log("Smoke popped — nobody sees through it");
      }
      if (wp.breach && u.kind === "sapper" && !this.recon) {
        if (this.breachesUsed >= (this.perks.breachCount ?? 1)) {
          this.log("No charges left");
        } else if (this.breachWall(u.x, u.y)) {
          this.breachesUsed++;
          this.disturbed = true;
          this.emitNoise(u.x, u.y, this.perks.breachNoise ?? 20);
          this.log("BREACH — the wall came down");
        } else {
          this.log("Breach wasted — no wall within reach");
        }
      }
      if (wp.poison && u.kind === "scout" && !this.recon) {
        const spot = this.poisonSpots.find(s =>
          G.dist(s.x, s.y, u.x, u.y) <= TUNING.poisonReach && !this.planted.includes(s));
        if (spot) {
          this.planted.push(spot);
          this.log("Poison planted at a routine stop");
        } else {
          this.log("Poison wasted — nothing here a target uses");
        }
      }
      u.holdLeft = wp.hold || 0;
      u.legIndex++;
      if (u.legIndex >= path.length) u.done = true;
    } else if (u.kind !== "drone" && !(u.kind === "scout" && wp.mode === "cover")) {
      // Undercover footsteps sound like anyone's — no noise events at all.
      u.stepTimer -= dt;
      if (u.stepTimer <= 0) {
        u.stepTimer = TUNING.stepInterval;
        const pubWalk = this.level.publicVenue &&
          !((u.kind === "scout" || u.kind === "assassin") && (!wp.mode || wp.mode === "sneak"));
        if (pubWalk && !runAway) { u.stepTimer = TUNING.stepInterval; return; }
        const r = runAway ? TUNING.walkNoise
          : u.kind === "scout"
            ? (wp.mode === "walk" ? TUNING.walkNoise : this.perks.sneakNoise)
          : u.kind === "assassin"
            ? (wp.mode === "sneak" || !wp.mode ? this.perks.assassinSneak : TUNING.walkNoise)
            : u.kind === "spotter" ? this.perks.spotterNoise
            : TUNING.opNoise;
        this.emitNoise(u.x, u.y, r);
      }
    }
  }

  openDoor(d, msg) {
    d.open = true;
    this.walls = this.walls.filter(w => w.doorId !== d.id);
    this.log(msg);
    this.intel.revealVersion++;
  }

  updateDoors(dt) {
    for (const d of this.doors) {
      if (d.open) continue;
      // Lift the keycard from a dead keyholder's body.
      if (!d.keyTaken && d.keyIdx >= 0) {
        const holder = this.enemies[d.keyIdx];
        if (holder && !holder.alive) {
          for (const k of GROUND_UNITS) {
            const u = this.units[k];
            if (u && !u.dead && G.dist(u.x, u.y, holder.x, holder.y) < 1.2) {
              d.keyTaken = true;
              this.log(`Lifted the keycard off ${holder.def.name}`);
              break;
            }
          }
        }
      }
      // Anyone at the door: keycard opens it instantly; otherwise they work
      // the lock — the hacker fast, everyone else slowly.
      let rate = 0;
      for (const k of GROUND_UNITS) {
        const u = this.units[k];
        if (!u || u.dead) continue;
        if (G.pointSegDist(u.x, u.y, d.x1, d.y1, d.x2, d.y2) > 1.3) continue;
        rate = Math.max(rate, k === "lockpick" ? (this.perks.lockRate ?? 1 / 3) : k === "hacker" ? 1 / 5 : 1 / 12);
      }
      if (rate > 0) {
        if (d.keyTaken) this.openDoor(d, "The keycard clicks — door open");
        else {
          d.progress += rate * dt;
          if (d.progress >= 1) this.openDoor(d, "Lock forced — door open");
        }
      }
    }
  }

  processOrders() {
    for (const th of this.throws) {
      if (th.done || this.t < th.t) continue;
      th.done = true;
      const decoy = this.units.decoy;
      if (decoy && !decoy.dead && G.dist(decoy.x, decoy.y, th.x, th.y) <= this.perks.throwRange) {
        this.emitNoise(th.x, th.y, this.perks.throwNoise);
        this.log("Noisemaker cracked where the Decoy threw it");
      } else {
        this.log("Throw failed — the Decoy was out of range");
      }
    }
    for (const sp of this.suppresses) {
      if (sp.done || this.t < sp.t) continue;
      sp.done = true;
      const g = this.units.gunner;
      if (g && !g.dead && G.dist(g.x, g.y, sp.x, sp.y) <= (this.perks.suppressRange ?? 12) &&
          !G.losBlocked(g.x, g.y, sp.x, sp.y, this.walls, true)) {
        this.disturbed = true;
        this.emitNoise(sp.x, sp.y, 18);
        this.log("Suppressive fire — heads down!");
        for (const e of this.enemies) {
          if (!e.alive || e.def.civilian || e.def.isTarget) continue;
          if (G.dist(e.x, e.y, sp.x, sp.y) > (this.perks.cowerRadius ?? 4)) continue;
          if (e.mode === "wait" || e.mode === "move") e.home = { x: e.x, y: e.y };
          e.mode = "cower";
          e.cowerUntil = this.t + (this.perks.cowerDur ?? 5);
        }
      } else {
        this.log("Suppression failed — the Gunner had no line of fire");
      }
    }
    for (const b of this.blares) {
      if (b.done || this.t < b.t) continue;
      b.done = true;
      const drone = this.units.drone;
      if (drone && !drone.dead && this.perks.blare) {
        this.emitNoise(drone.x, drone.y, 14);
        this.log("The drone blared from above");
      } else {
        this.log("Blare failed — no drone in the air");
      }
    }
    for (const b of this.blackouts) {
      if (b.done || this.t < b.t) continue;
      b.done = true;
      const hacker = this.units.hacker;
      const atBox = hacker && !hacker.dead &&
        (this.level.junctionBoxes || []).some(j => G.dist(hacker.x, hacker.y, j.x, j.y) <= (this.perks.boxRange ?? TUNING.boxRange));
      if (atBox) {
        this.blackoutUntil = this.t + this.perks.blackoutDur;
        this.log(`Power cut — lights out for ${this.perks.blackoutDur}s`);
      } else {
        this.log("Blackout failed — the Hacker wasn't at a junction box");
      }
    }
  }

  // How far a unit's eyes reach.
  unitSightRange(u) {
    return u.kind === "scout" ? this.perks.scoutVision
      : u.kind === "spotter" ? this.perks.spotterVision
      : u.kind === "drone" ? this.perks.droneReveal
      : TUNING.opSightRange;
  }

  // Comms: a live, un-incapacitated radio jammer blacks out your feed, so what
  // your watchers see only reaches you when they physically slip back out
  // (exfil). Kill or suppress the jammer — or work a site with none — and the
  // intel streams live.
  liveFeed() {
    return !this.enemies.some(e => e.alive && e.def.jammer && e.mode !== "cower");
  }

  // Merge a unit's gathered-but-unsent intel into the shared, persistent record.
  deliver(u) {
    let changed = false;
    for (const idx of u.pendGrid) {
      if (!this.intel.grid[idx]) { this.intel.grid[idx] = 1; changed = true; }
    }
    u.pendGrid.clear();
    for (const k of Object.keys(u.pendSeen)) {
      const idx = +k;
      if (!this.intel.known.has(idx)) {
        this.intel.known.add(idx);
        const def = this.enemies[idx].def;
        this.log(`Intel: ${def.name}${def.isTarget ? " (TARGET)" : ""} located`);
      }
      this.intel.lastSeen[idx] = u.pendSeen[k];
    }
    u.pendSeen = {};
    if (changed) this.intel.revealVersion++;
  }

  updateIntel() {
    const live = this.liveFeed();

    // 1. GATHER — each watcher lights fog into its cumulative sight (seenCells)
    //    and the not-yet-delivered slice (pendGrid).
    const mark = (u, idx) => {
      u.seenCells.add(idx);
      if (!this.intel.grid[idx]) u.pendGrid.add(idx);
    };
    const rayGather = (u, range) => {
      const rays = TUNING.scoutSightRays;
      for (let i = 0; i < rays; i++) {
        const ang = (i / rays) * Math.PI * 2;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const hit = G.raycast(u.x, u.y, u.x + dx * range, u.y + dy * range, this.walls, w => !w.window);
        const maxD = hit ? hit.t * range : range;
        for (let d = 0; d <= maxD; d += 0.35) mark(u, fogIndex(u.x + dx * d, u.y + dy * d));
      }
    };

    for (const key of Object.keys(this.units)) {
      const u = this.units[key];
      if (u.dead) continue;
      if (u.kind === "drone") {
        const r = this.perks.droneReveal;
        for (let ox = -r; ox <= r; ox += WORLD.fogCell) {
          for (let oy = -r; oy <= r; oy += WORLD.fogCell) {
            if (ox * ox + oy * oy > r * r) continue;
            mark(u, fogIndex(u.x + ox, u.y + oy));
          }
        }
      } else {
        rayGather(u, this.unitSightRange(u));
      }
      // An enemy standing anywhere this unit has mapped is a logged sighting.
      for (const e of this.enemies) {
        if (e.alive && u.seenCells.has(fogIndex(e.x, e.y))) {
          u.pendSeen[e.idx] = { x: e.x, y: e.y, facing: e.facing };
        }
      }
    }

    // 2. DELIVER — a live feed drops everything on the map at once; jammed, a
    //    watcher only reports once it slips back to the insertion point.
    for (const key of Object.keys(this.units)) {
      const u = this.units[key];
      if (u.dead) continue;
      if (!u.leftSpawn && G.dist(u.x, u.y, u.spawn.x, u.spawn.y) > TUNING.exfilLeaveDist) u.leftSpawn = true;
      const backHome = u.leftSpawn && G.dist(u.x, u.y, u.spawn.x, u.spawn.y) <= TUNING.exfilRadius;
      if (live) {
        this.deliver(u);
      } else if (backHome && (u.pendGrid.size || Object.keys(u.pendSeen).length)) {
        const firstReport = !u.exfiled;
        u.exfiled = true;
        this.deliver(u);
        if (firstReport) this.log(`${u.kind[0].toUpperCase() + u.kind.slice(1)} slipped out and reported in`);
      }
    }

    // 3. LIVE VIEW — committed map plus whatever alive watchers see right now, so
    //    the screen shows the sweep even while it's undelivered.
    this.viewGrid.set(this.intel.grid);
    let pendCount = 0;
    for (const key of Object.keys(this.units)) {
      const u = this.units[key];
      if (u.dead) continue;
      pendCount += u.pendGrid.size;
      for (const idx of u.pendGrid) this.viewGrid[idx] = 1;
    }
    if (this.intel.revealVersion !== this._viewCommitVer || pendCount !== this._viewPendCount) {
      this.view.revealVersion++;
      this._viewCommitVer = this.intel.revealVersion;
      this._viewPendCount = pendCount;
    }
  }

  // At run's end, tally sightings that never made it home (jammed + no exfil).
  finalizeIntel() {
    const lost = new Set();
    for (const key of Object.keys(this.units)) {
      const u = this.units[key];
      for (const k of Object.keys(u.pendSeen)) {
        const idx = +k;
        if (!this.intel.known.has(idx)) lost.add(idx);
      }
    }
    this.lostIntel = lost.size;
    this.commsJammed = !this.liveFeed();
  }

  // The assassin's live target: intercept whoever's charging its ward, else
  // hunt its mark, else shadow its ward. Returns {x,y,keep,speed} or null.
  //
  // The MARK hunt breaks off the planned route the moment the mark is reachable
  // in a straight line — you don't have to walk to the last waypoint to attack.
  // Bodyguard duty (shadow + intercept) waits until the route is done, so the
  // assassin first navigates its player-drawn path into position around walls.
  assassinActiveGoal() {
    const asn = this.units.assassin;
    if (!asn || asn.dead) return null;
    const done = asn.done;

    // Emergency: someone is charging the ward. Sprint to cut them down.
    if (done && this.assassinGuard) {
      const attacker = this.enemies.find(en =>
        en.alive && en.mode === "attack" && en.attackTarget === this.assassinGuard);
      if (attacker) return { x: attacker.x, y: attacker.y, keep: 0, speed: this.perks.sprintSpeed ?? 3 };
    }
    // Hunt the marked enemy — mid-route too, as soon as it's reachable.
    if (this.assassinMark != null) {
      const tgt = this.enemies[this.assassinMark];
      if (tgt && tgt.alive && (done || !G.losBlocked(asn.x, asn.y, tgt.x, tgt.y, this.walls, false)))
        return { x: tgt.x, y: tgt.y, keep: 0, speed: 1.6 };
    }
    // Shadow the ward at arm's length once in position — jog to catch up when
    // trailing so a fast-walking ward never leaves the bodyguard behind.
    if (done && this.assassinGuard) {
      const w = this.units[this.assassinGuard];
      if (w && !w.dead) {
        const d = G.dist(asn.x, asn.y, w.x, w.y);
        return { x: w.x, y: w.y, keep: 1.5, speed: d > 2.5 ? (this.perks.sprintSpeed ?? 3) : 1.8 };
      }
    }
    return null;
  }

  fire(shot) {
    this.fired = true;
    this.disturbed = true;
    shot.fired = true;
    const perch = this.level.perches[this.plan.perchIndex];
    const aim = shot.aim;
    const dir = G.norm(aim.x - perch.x, aim.y - perch.y);
    const range = 80;
    const ex = perch.x + dir.x * range, ey = perch.y + dir.y * range;

    // Ordered solid-wall hits; the Penetrator perk skips the first one.
    const hits = [];
    for (const w of this.walls) {
      if (w.window) continue;
      const t = G.segIntersect(perch.x, perch.y, ex, ey, w.x1, w.y1, w.x2, w.y2);
      if (t !== null) hits.push(t * range);
    }
    hits.sort((a, b) => a - b);
    let pierceLeft = this.perks.pierce ? 1 : 0;
    let impactDist = range;
    for (const h of hits) {
      if (pierceLeft > 0) { pierceLeft--; continue; }
      impactDist = h;
      break;
    }

    // A spotter with eyes on the aim point steadies the shot.
    let hitRadius = this.perks.hitRadius;
    const sp = this.units.spotter;
    if (sp && !sp.dead && G.dist(sp.x, sp.y, aim.x, aim.y) <= this.perks.spotterVision &&
        !G.losBlocked(sp.x, sp.y, aim.x, aim.y, this.walls, true)) {
      hitRadius *= this.perks.spotterMult;
      this.log("Spotter called the correction — steadied shot");
    }

    // Nearest enemy on the bullet's path before the wall impact.
    let hitEnemy = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const proj = (e.x - perch.x) * dir.x + (e.y - perch.y) * dir.y;
      if (proj < 0.3 || proj > impactDist) continue;
      const perp = G.pointSegDist(e.x, e.y, perch.x, perch.y,
        perch.x + dir.x * impactDist, perch.y + dir.y * impactDist);
      if (perp < hitRadius + TUNING.enemyRadius) {
        if (!hitEnemy || proj < hitEnemy.proj) hitEnemy = { e, proj };
      }
    }
    if (hitEnemy) impactDist = hitEnemy.proj;

    // How close did we come to the nearest living target? (for miss feedback)
    let missDist = Infinity;
    for (const e of this.enemies) {
      if (!e.def.isTarget || !e.alive) continue;
      missDist = Math.min(missDist, G.pointSegDist(e.x, e.y, perch.x, perch.y,
        perch.x + dir.x * impactDist, perch.y + dir.y * impactDist));
    }

    this.bullet = {
      x: perch.x, y: perch.y, dir,
      dist: 0, impactDist,
      impact: { x: perch.x + dir.x * impactDist, y: perch.y + dir.y * impactDist },
      hitEnemy: hitEnemy ? hitEnemy.e : null,
      missDist, trail: [],
    };
    this.phase = "cam";
    this.log("Shot fired");
  }

  // Civilians don't blow the mission — they scream, and every guard in
  // earshot comes running.
  civilianAlarm(e) {
    if (this.t - (e.screamAt ?? -99) < 6) return;
    this.disturbed = true;
    this.susBump(e);
    e.screamAt = this.t;
    this.log(`${e.def.name} screamed!`);
    this.emitNoise(e.x, e.y, 12);
  }

  // Can anything in the plan still kill the remaining targets?
  lethalRemaining(remaining) {
    if (this.shots.some(s => !s.fired)) return true;
    if (this.units.assassin && !this.units.assassin.dead) return true;
    return this.planted.some(s => remaining.some(e => e.idx === s.idx));
  }

  killUnit(u, msg) {
    if (this.dev.invincible) { this.log(`${u.kind[0].toUpperCase() + u.kind.slice(1)} shrugged off a hit (dev: invincible)`); return; }
    u.dead = true;
    this.disturbed = true;
    this.log(msg);
    if (this.recon) { this.susBumps += 2; return; } // a body found mid-surveillance
    const remaining = this.enemies.filter(en => en.def.isTarget && en.alive);
    if (remaining.length && !this.lethalRemaining(remaining)) {
      this.result = {
        success: false, reason: "crew-lost", title: "CONTRACT INCOMPLETE",
        detail: "The kill team is gone — nothing left in the plan can finish the list. The survivors pulled out.",
      };
      this.phase = "done";
    }
  }

  finishShot() {
    const b = this.bullet;
    const targets = this.enemies.filter(e => e.def.isTarget);
    const many = targets.length > 1;

    if (b.hitEnemy && !b.hitEnemy.def.isTarget) {
      b.hitEnemy.alive = false;
      if (b.hitEnemy.def.keyHolder) {
        // Sanctioned: killing the keyholder is one way through the door.
        this.keyholderKills++;
        this.emitNoise(b.impact.x, b.impact.y, this.perks.shotNoise);
        this.log(`${b.hitEnemy.def.name} is down — the keycard is loose`);
        if (this.lethalRemaining(targets.filter(e => e.alive))) {
          this.phase = "run";
        } else {
          this.result = {
            success: false, reason: "miss", title: "CONTRACT INCOMPLETE",
            detail: "The keyholder is dead but nothing left in the plan can finish the list.",
          };
          this.phase = "done";
        }
        return;
      }
      if (b.hitEnemy.def.civilian) {
        this.log(`${b.hitEnemy.def.name} — a civilian — was killed`);
        this.result = {
          success: false, reason: "civilian", title: "CONTRACT VOIDED",
          detail: `${b.hitEnemy.def.name} was an innocent bystander. The client walked — no pay, no intel money, nothing. We don't kill civilians.`,
          missDist: b.missDist,
        };
      } else {
        this.log(`${b.hitEnemy.def.name} was hit — wrong person`);
        this.result = {
          success: false, reason: "hit-other", title: "WRONG TARGET",
          detail: `You hit ${b.hitEnemy.def.name}. The contract was the target${many ? "s" : ""} alone — the client is not paying for this.`,
          missDist: b.missDist,
        };
      }
      this.phase = "done";
      return;
    }

    if (b.hitEnemy) {
      b.hitEnemy.alive = false;
      this.log(`${b.hitEnemy.def.name} eliminated`);
      // A rifle shot is not subtle: everyone nearby reacts to the impact.
      this.emitNoise(b.impact.x, b.impact.y, this.perks.shotNoise);
      const remaining = targets.filter(e => e.alive);
      if (!remaining.length) {
        this.result = {
          success: true, reason: "hit-target",
          title: many ? "ALL TARGETS ELIMINATED" : "TARGET ELIMINATED",
          detail: many ? "Every name on the contract is crossed off. Clean exit." : `${b.hitEnemy.def.name} is down. Clean exit.`,
        };
        this.phase = "done";
      } else if (this.lethalRemaining(remaining)) {
        this.phase = "run"; // back to real time — the plan can still finish the list
      } else {
        const down = targets.length - remaining.length;
        this.result = {
          success: false, reason: "miss", title: "CONTRACT INCOMPLETE",
          detail: `${down} of ${targets.length} targets eliminated — ${remaining.map(e => e.def.name).join(", ")} got away. The client pays for a finished list.`,
        };
        this.phase = "done";
      }
      return;
    }

    // Clean miss.
    const m = Math.round(b.missDist * 10) / 10;
    this.log(`Shot missed by ${m}m`);
    this.emitNoise(b.impact.x, b.impact.y, this.perks.shotNoise);
    if (this.lethalRemaining(targets.filter(e => e.alive))) {
      this.phase = "run";
    } else {
      const remaining = targets.filter(e => e.alive);
      const down = targets.length - remaining.length;
      this.result = many && down > 0
        ? {
            success: false, reason: "miss", title: "CONTRACT INCOMPLETE",
            detail: `${down} of ${targets.length} targets eliminated — the last shot passed ${m}m from ${remaining.map(e => e.def.name).join(", ")}.`,
            missDist: b.missDist,
          }
        : {
            success: false, reason: "miss", title: "MISSED",
            detail: `The bullet passed ${m}m from the target${many ? "s" : ""}.`,
            missDist: b.missDist,
          };
      this.phase = "done";
    }
  }

  update(dt) {
    if (this.phase === "done") return;

    if (this.phase === "cam") {
      const b = this.bullet;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 40) b.trail.shift();
      b.dist = Math.min(b.impactDist, b.dist + TUNING.bulletSpeed * dt);
      b.x = this.level.perches[this.plan.perchIndex].x + b.dir.x * b.dist;
      b.y = this.level.perches[this.plan.perchIndex].y + b.dir.y * b.dist;
      if (b.dist >= b.impactDist) this.finishShot();
      return;
    }

    this.t += dt;
    for (const key of Object.keys(this.units)) this.updateUnit(this.units[key], dt);

    // Assassin standing orders: hunt the marked enemy, or shadow the ward — and
    // sprint to intercept anyone charging the ward. It pursues the moment a
    // reachable target exists, mid-route or not (updateUnit paused its route).
    const asn0 = this.units.assassin;
    if (asn0 && !asn0.dead) {
      const goal = this.assassinActiveGoal();
      if (goal && G.dist(asn0.x, asn0.y, goal.x, goal.y) > goal.keep + 0.2) {
        const step = goal.speed * dt;
        const dir = G.norm(goal.x - asn0.x, goal.y - asn0.y);
        if (!G.raycast(asn0.x, asn0.y, asn0.x + dir.x * (step + 0.3), asn0.y + dir.y * (step + 0.3), this.walls)) {
          asn0.x += dir.x * step;
          asn0.y += dir.y * step;
          asn0.facing = Math.atan2(dir.y, dir.x);
          asn0.moving = true;
          asn0.stepTimer -= dt;
          if (asn0.stepTimer <= 0) {
            asn0.stepTimer = TUNING.stepInterval;
            this.emitNoise(asn0.x, asn0.y, this.perks.assassinSneak ?? 2.2);
          }
        }
      }
    }

    this.updateDoors(dt);
    this.processOrders();
    if (!this.dev.freezeEnemies) for (const e of this.enemies) if (e.alive) this.updateEnemy(e, dt);
    this.updateIntel();

    // The assassin's blade: any living target within reach and line of sight
    // dies. Checked before spotting, so the knife beats the scream.
    const asn = this.units.assassin;
    if (asn && !asn.dead) {
      for (const e of this.enemies) {
        if (!e.alive || e.def.civilian) continue;
        const attackingUs = e.mode === "attack";
        const marked = e.idx === this.assassinMark;
        if (!e.def.isTarget && !this.perks.bladeGuards && !e.def.keyHolder && !attackingUs && !marked) continue;
        const d = G.dist(e.x, e.y, asn.x, asn.y);
        const inReach = d <= this.perks.strikeRange;
        const canThrow = !inReach && this.perks.throwKnife && this.knifeThrown < (this.perks.throwCount ?? 1) && d <= (this.perks.thrownRange ?? 4);
        if (!inReach && !canThrow) continue;
        if (G.losBlocked(asn.x, asn.y, e.x, e.y, this.walls, false)) continue;
        if (this.recon && e.mode !== "attack") {
          // Assassinations during surveillance blow the whole op
          // (cutting down someone who charged you is another matter).
          this.susBumps += 4;
          this.log("The Assassin struck during recon — the site erupted");
          this.result = {
            success: false, reason: "spotted", title: "RECON BLOWN",
            detail: "A body dropped during surveillance. The op is scrapped and the site is rattled — suspicion soared.",
          };
          this.phase = "done";
          return;
        }
        e.alive = false;
        if (this.recon) this.susBumps += 2;
        if (!e.def.isTarget && (e.def.keyHolder || e.idx === this.assassinMark)) this.keyholderKills++;
        if (canThrow) {
          this.knifeThrown++;
          this.log(`${e.def.name} caught the thrown blade`);
          this.emitNoise(e.x, e.y, 2);
        } else if (this.perks.strikeNoise > 0) {
          this.log(`${e.def.name} was knifed — a brief struggle`);
          this.emitNoise(asn.x, asn.y, this.perks.strikeNoise);
        } else {
          this.log(`${e.def.name} was suffocated without a sound`);
        }
        if (!this.enemies.some(en => en.def.isTarget && en.alive)) {
          const many = this.enemies.filter(en => en.def.isTarget).length > 1;
          this.result = {
            success: true, reason: "hit-target",
            title: many ? "ALL TARGETS ELIMINATED" : "TARGET ELIMINATED",
            detail: "Close work. The client will hear about the craftsmanship.",
          };
          this.phase = "done";
          return;
        }
      }
    }

    // The gunner covers the crew: anyone charging an operative gets a second
    // of tracking, then a burst.
    const gun = this.units.gunner;
    if (gun && !gun.dead) {
      for (const e of this.enemies) {
        if (!e.alive || e.mode !== "attack") { if (e) e.gunTrack = 0; continue; }
        if (G.dist(e.x, e.y, gun.x, gun.y) > 8 ||
            G.losBlocked(gun.x, gun.y, e.x, e.y, this.walls, true)) { e.gunTrack = 0; continue; }
        e.gunTrack = (e.gunTrack || 0) + dt;
        if (e.gunTrack >= 1) {
          e.alive = false;
          this.disturbed = true;
          this.emitNoise(gun.x, gun.y, 16);
          this.log(`The Gunner dropped ${e.def.name} mid-charge`);
        }
      }
    }

    // Spotting. Ground operatives seen too long => mission fail.
    // The drone just attracts attention — and gunfire, if it loiters.
    for (const e of this.enemies) e.seesUnit = false;
    for (const kind of GROUND_UNITS) {
      const u = this.units[kind];
      if (!u || u.dead) continue;
      // Undercover scouts endure scrutiny far longer, and a motionless
      // assassin barely registers. Switching states in plain view doesn't
      // grant a free reset.
      const covered = kind === "scout" && u.coverMode;
      const still = (kind === "assassin" || (kind === "lockpick" && this.perks.lockStill)) && !u.moving;
      // Public venues: a MOVING, non-sneaking operative reads as a visitor —
      // scrutiny takes as long as your disguise craft holds up.
      const disguised = !!this.level.publicVenue && u.moving &&
        !((kind === "scout" || kind === "assassin") && (!u.curMode || u.curMode === "sneak"));
      // Ghillie wrap: a motionless scout is also harder to pick out.
      const seeMult = still ? TUNING.stillVisionMult
        : (kind === "scout" && !u.moving) ? this.perks.scoutStillMult : 1;
      const stillLimit = this.perks.stillExposure ?? TUNING.stillExposure;
      const limit = covered ? TUNING.coverExposure
        : disguised ? (this.perks.disguiseTime ?? 1.2)
        : still ? stillLimit : TUNING.exposureLimit;
      let seen = false;
      const seers = [];
      for (const e of this.enemies) {
        if (!e.alive || !this.enemySees(e, u.x, u.y, seeMult)) continue;
        e.seesUnit = true;
        if (e.def.civilian) {
          if (!disguised) this.civilianAlarm(e); // visitors don't cause screams
        } else {
          seen = true;
          seers.push(e);
          u.spotter = e.def.name;
        }
      }
      if (u.lastLimit != null && u.lastLimit !== limit) u.exposure = Math.min(u.exposure, limit * 0.9);
      u.lastLimit = limit;
      u.exposureLimit = limit;
      u.exposure = seen ? u.exposure + dt : Math.max(0, u.exposure - dt * 2);
      u.maxExposureFrac = Math.max(u.maxExposureFrac || 0, u.exposure / limit);
      if (u.exposure > limit) {
        const label = kind[0].toUpperCase() + kind.slice(1);
        // Being made starts a fight, not a fade to black — on recon too.
        // Run for it, or let the assassin meet the chaser.
        u.exposure = limit;
        for (const e of seers) {
          this.susBump(e); // each new witness leaves the site permanently warier
          if (e.def.isTarget) {
            // Targets don't fight — they bolt.
            if (this.t - (e.boltAt ?? -99) > 2.5) {
              e.boltAt = this.t;
              if (!e.boltLogged) {
                this.log(`${e.def.name} bolted — they've seen the ${label}!`);
                e.boltLogged = true;
              }
              this.react(e, u.x, u.y);
            }
          } else if (e.mode !== "attack") {
            if (e.mode === "wait" || e.mode === "move") e.home = { x: e.x, y: e.y };
            e.mode = "attack";
            e.attackTarget = kind;
            e.lastSawT = this.t;
            e.aimT = 0;
            this.log(`${e.def.name} charged the ${label}!`);
          }
        }
      }
    }

    const drone = this.units.drone;
    if (drone && !drone.dead) {
      let seen = false;
      for (const e of this.enemies) {
        if (!e.alive || !this.enemySees(e, drone.x, drone.y, 1.1)) continue;
        e.seesUnit = true;
        if (e.def.civilian) {
          this.civilianAlarm(e);
          continue; // civilians don't shoot drones down
        }
        seen = true;
        if (this.t - e.droneReactAt > 2.5) {
          e.droneReactAt = this.t;
          this.react(e, drone.x, drone.y);
        }
      }
      drone.exposure = seen ? drone.exposure + dt : Math.max(0, drone.exposure - dt * 2);
      if (drone.exposure > this.perks.droneTough) {
        drone.dead = true;
        this.log("The drone was shot down");
      }
    }

    // Cull old noise ripples (kept only for rendering).
    this.noises = this.noises.filter(n => this.t - n.t0 < 0.9);

    if (this.canFire) {
      const next = this.shots.find(s => !s.fired && this.t >= s.fireTime);
      if (next) {
        this.fire(next);
        return;
      }
    }

    if (this.t >= this.level.duration) {
      this.finalizeIntel();
      if (this.recon) {
        this.log("Watchers pulled back unseen");
        let detail = "The watchers pulled back without being seen. Everything they delivered is logged on the map.";
        if (this.commsJammed && this.lostIntel > 0) {
          detail = `COMMS JAMMED — ${this.lostIntel} sighting${this.lostIntel === 1 ? "" : "s"} never reached you. A watcher has to slip back to the insertion point to report, or you have to take the radio jammer off the board for a live feed.`;
        } else if (this.commsJammed) {
          detail = "COMMS JAMMED, but your watchers slipped back out and reported in — everything they saw is logged.";
        }
        this.result = {
          success: true, reason: "recon-done", title: "RECON COMPLETE", detail,
        };
      } else {
        this.log("Extraction window closed");
        const targets = this.enemies.filter(e => e.def.isTarget);
        const down = targets.filter(e => !e.alive).length;
        this.result = {
          success: false, reason: "timeout", title: "WINDOW CLOSED",
          detail: down > 0
            ? `Time ran out with ${down} of ${targets.length} targets down. The client pays for a finished list.`
            : "Time ran out before the shot. The team exfiltrated with the intel they gathered.",
        };
      }
      this.phase = "done";
    }
  }
}

if (typeof module !== "undefined") module.exports = { Simulation, TUNING, WORLD, fogIndex, patrolPosAt, pathPosAt, pathIntervals, unitSpeedFor };
