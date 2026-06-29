
const BOT_SPEED = 5.4;
const BOT_RADIUS = 0.4;
const EYE = 1.5;
const BOT_MAX_HP = 100;

const PREF_NEAR = 10;
const PREF_FAR = 22;
const FIRE_RANGE = 40;
const VISION_RANGE = 72;     // bots only notice enemies they can actually see
const MEMORY_TIME = 3.5;     // ...then investigate the last-seen spot for a bit
const MAX_CLONES = 3;

// Distinct vivid colours so every combatant reads as its own fighter (FFA).
const BOT_COLORS = [
  0xff5a5a, 0x4ea0ff, 0x4dff7a, 0xffe24d, 0xff7adf, 0x7a5cff,
  0x21ffd0, 0xff9a3a, 0xa0ff3a, 0x3affff, 0xff3a7a, 0xc08aff,
];
const CALLSIGNS = [
  'Vega', 'Rook', 'Echo', 'Nyx', 'Ghost', 'Pike', 'Cobra', 'Slate',
  'Zephyr', 'Talon', 'Wren', 'Onyx', 'Dash', 'Fury', 'Kilo', 'Reaper',
  'Vortex', 'Blitz', 'Saber', 'Halo', 'Drift', 'Karma', 'Quartz', 'Jett',
];

/** A single AI fighter. Free-for-all: everyone else is an enemy. */
class Bot {
  constructor(name, color, manager, opts = {}) {
    this.name = name;
    this.color = color;
    this.isClone = !!opts.isClone;
    // Unique team => everyone is an enemy (FFA). Clones share the player's team.
    this.team = opts.team || name;
    this.manager = manager;
    // The weapon this fighter carries — dropped as loot when it dies.
    this.weaponKey = opts.weaponKey || 'rifle';

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.knock = new THREE.Vector3();   // explosion knockback, decays
    this.facing = 0;
    this.maxHp = this.isClone ? 55 : BOT_MAX_HP;   // clones are weaker copies of you
    this.hp = this.maxHp;
    this.alive = true;

    this.skill = this.isClone ? 0.42 : 0.32 + Math.random() * 0.33;
    this.fireInterval = this.isClone ? 0.5 + Math.random() * 0.3 : 0.55 + Math.random() * 0.5;
    this.fireCd = Math.random();
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 0;
    this.losT = 0;
    this.reaction = 0.18 + Math.random() * 0.22;
    this.walkPhase = 0;
    this.memT = 0;                       // remaining "I just saw someone" memory
    this.lastSeen = new THREE.Vector3();

    this._buildMesh();
  }

  _buildMesh() {
    // Same humanoid model as the player, recoloured in this fighter's team
    // colour: bright plates + glow in the colour, a darkened bodysuit beneath.
    const parts = buildFighterModel({
      armor: this.color,
      accent: this.color,
      suit: darkenHex(this.color, 0.4),
      skin: 0xd8c0a8,
      holo: this.isClone,
    });
    this.root = parts.root;
    this.pivot = parts.pivot;
    this.legL = parts.legL; this.legR = parts.legR;
    this.armL = parts.armL; this.armR = parts.armR;
    this.rifle = parts.gun;
    this.head = parts.head;
    this.body = parts.body;
    this.head.userData = { bot: this, part: 'head' };
    this.body.userData = { bot: this, part: 'body' };

    this._buildHealthBar(this.color);
    this.manager.scene.add(this.root);
  }

  _buildHealthBar(color) {
    this.healthBar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    this.hpFill = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.14),
      new THREE.MeshBasicMaterial({ color }));
    this.hpFill.position.z = 0.001;
    this.healthBar.add(bg, this.hpFill);
    this.healthBar.position.y = 2.35;
    this.root.add(this.healthBar);
  }

  get aimPoint() { return new THREE.Vector3(this.position.x, this.position.y + 1.3, this.position.z); }
  get eyePoint() { return new THREE.Vector3(this.position.x, this.position.y + EYE, this.position.z); }

  spawn(pos) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.hp = this.maxHp;
    this.alive = true;
    this.dying = false;
    this.memT = 0;
    this.root.visible = true;
    this.root.position.y = 0;
    this.pivot.rotation.z = 0;
    this.pivot.position.y = 0;
    this.losT = 0;
    this._syncMesh();
  }

  die() {
    this.alive = false;
    this.dying = true;             // play a topple-over before vanishing (no respawn)
    this.deathT = 0;
  }

  takeDamage(amount, attacker) {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
      this.manager.onBotKilled(this, attacker);
      return true;
    }
    return false;
  }

  applyImpulse(dir, power) {
    this.knock.x += dir.x * power;
    this.knock.z += dir.z * power;
  }

  // CRYO: keep the strongest active slow (mul < 1) for `time` seconds.
  applySlow(time, mul) {
    this.slowT = Math.max(this.slowT || 0, time);
    this.slowMul = Math.min(this.slowMul != null ? this.slowMul : 1, mul);
  }

  update(delta, combatants, world, storm) {
    if (!this.alive) {
      if (this.dying) this._animateDeath(delta);
      return;
    }

    // Acquire a target ONLY if it can actually be seen: scan enemies within
    // vision range, nearest first, and line-of-sight check up to a few. This is
    // what lets you sneak up and surprise them — break sight and they lose you.
    const cands = [];
    for (const c of combatants) {
      if (c === this || !c.alive || c.team === this.team) continue;
      const dSq = this.position.distanceToSquared(c.position);
      if (dSq < VISION_RANGE * VISION_RANGE) cands.push({ c, dSq });
    }
    cands.sort((a, b) => a.dSq - b.dSq);

    let target = null, checks = 0;
    for (const cand of cands) {
      if (checks >= 4) break;
      checks++;
      if (this.manager.hasLineOfSight(this.eyePoint, cand.c.aimPoint)) { target = cand.c; break; }
    }

    let los = false, dist = Infinity, dir = null;
    if (target) {
      los = true;
      this.losT += delta;
      this.memT = MEMORY_TIME;
      this.lastSeen.copy(target.position);
      const toT = new THREE.Vector3().subVectors(target.position, this.position); toT.y = 0;
      dist = toT.length();
      dir = dist > 1e-4 ? toT.multiplyScalar(1 / dist) : new THREE.Vector3(0, 0, 1);
    } else {
      this.losT = 0;
      this.memT = Math.max(0, this.memT - delta);
    }

    // Run for the safe zone if caught outside the storm.
    let toSafety = null;
    if (storm) {
      const dxC = this.position.x - storm.center.x, dzC = this.position.z - storm.center.z;
      if (Math.hypot(dxC, dzC) > storm.radius - 4) {
        toSafety = new THREE.Vector3(storm.center.x - this.position.x, 0, storm.center.z - this.position.z).normalize();
      }
    }

    // Clones leash to the player: regroup when there's no visible enemy or they stray.
    let follow = null;
    if (this.isClone && this.manager.player && this.manager.player.alive) {
      const p = this.manager.player.position;
      const fdist = Math.hypot(p.x - this.position.x, p.z - this.position.z);
      if (!target || fdist > 18) {
        follow = new THREE.Vector3(p.x - this.position.x, 0, p.z - this.position.z);
        if (follow.length() > 4) follow.normalize(); else follow.set(0, 0, 0);
      }
    }

    let move = new THREE.Vector3();
    if (toSafety) {
      move.copy(toSafety);
    } else if (follow) {
      move.copy(follow);
    } else if (target) {
      if (dist > PREF_FAR) move.copy(dir);
      else if (dist < PREF_NEAR) move.copy(dir).negate();
      else move.set(-dir.z, 0, dir.x).multiplyScalar(this.strafeDir);
    } else if (this.memT > 0) {
      // Lost sight — go investigate where they were last seen.
      move.set(this.lastSeen.x - this.position.x, 0, this.lastSeen.z - this.position.z);
      if (move.length() > 1.5) move.normalize(); else move.set(0, 0, 0);
    } else if (storm) {
      // Nothing in sight: drift toward the zone centre (so the map converges).
      move.set(storm.center.x - this.position.x, 0, storm.center.z - this.position.z);
      if (move.length() > 6) move.normalize(); else move.set(0, 0, 0);
    }

    this.strafeT -= delta;
    if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = 1.2 + Math.random() * 1.5; }

    if (move.lengthSq() > 0) {
      move.normalize();
      // Short probe so bots commit close to gaps and push through doorways.
      const probe = this.position.clone().add(new THREE.Vector3(0, EYE, 0));
      if (this.manager.blocked(probe, move, 1.1)) {
        move.add(new THREE.Vector3(-move.z, 0, move.x).multiplyScalar(this.strafeDir)).normalize();
      }
    }

    this.slowT = Math.max(0, (this.slowT || 0) - delta);
    const speedMul = this.slowT > 0 ? (this.slowMul != null ? this.slowMul : 1) : 1;
    this.velocity.lerp(move.multiplyScalar(BOT_SPEED * speedMul), Math.min(1, delta * 8));
    this.position.x += (this.velocity.x + this.knock.x) * delta;
    this.position.z += (this.velocity.z + this.knock.z) * delta;
    this.knock.multiplyScalar(Math.max(0, 1 - delta * 3));
    // feetY/headY so bots collide with walls but ignore the thin roof colliders.
    world.resolveCollision(this.position, BOT_RADIUS, this.position.y, this.position.y + 1.9);
    this._clampToArena();

    if (dir) this.facing = Math.atan2(dir.x, dir.z);
    this.fireCd -= delta;
    if (los && dist <= FIRE_RANGE && this.losT >= this.reaction && this.fireCd <= 0) {
      this._shoot(target, dist);
      this.fireCd = this.fireInterval;
    }

    this._animateWalk(delta);
    this._syncMesh();
  }

  _animateWalk(delta) {
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkPhase += sp * delta * 2.4;
    const swing = Math.sin(this.walkPhase) * Math.min(0.7, sp * 0.13);
    if (this.legL) { this.legL.rotation.x = swing; this.legR.rotation.x = -swing; }
    // Arms counter-swing while still holding the rifle forward.
    if (this.armL) {
      this.armL.rotation.x = 1.35 - swing * 0.4;
      this.armR.rotation.x = 1.35 + swing * 0.4;
    }
    // Subtle torso bob while moving.
    this.pivot.position.y = Math.abs(Math.sin(this.walkPhase)) * Math.min(0.06, sp * 0.012);
    // Firing recoil kick, decays.
    this.shootKick = Math.max(0, (this.shootKick || 0) - delta * 5);
    if (this.rifle) this.rifle.position.z = -0.32 + this.shootKick * 0.13;
  }

  _animateDeath(delta) {
    this.deathT += delta;
    const k = Math.min(1, this.deathT / 0.6);
    this.pivot.rotation.z = k * (Math.PI / 2);     // topple over
    this.root.position.y = this.position.y - k * 0.15;
    if (this.deathT >= 0.7) { this.dying = false; this.root.visible = false; }
  }

  _shoot(target, dist) {
    this.shootKick = 1;
    const muzzle = this.eyePoint.add(
      new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)).multiplyScalar(0.4));
    const acc = clamp(this.skill * (1 - (dist / FIRE_RANGE) * 0.7), 0.07, 0.58);
    let endPoint;
    if (Math.random() < acc) {
      endPoint = target.aimPoint;
      const dmg = this.isClone ? 4 + Math.floor(Math.random() * 3) : 5 + Math.floor(Math.random() * 4);
      target.takeDamage(dmg, this);
    } else {
      endPoint = target.aimPoint.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3));
    }
    this.manager.onBotFired(this, muzzle, endPoint, dist);
  }

  _clampToArena() {
    const lim = ARENA.half - 1;
    this.position.x = clamp(this.position.x, -lim, lim);
    this.position.z = clamp(this.position.z, -lim, lim);
  }

  _syncMesh() {
    this.root.position.copy(this.position);
    this.pivot.rotation.y = this.facing;
    const frac = this.hp / this.maxHp;
    this.hpFill.scale.x = Math.max(0.001, frac);
    this.hpFill.position.x = -(1 - frac) * 0.5;
    this.healthBar.quaternion.copy(this.manager.camQuat);
  }
}

/** Owns every bot: spawning, the per-frame FFA tick, shared LOS, tracers. */
class BotManager {
  constructor({ scene, world, audio, camera, count = 19 }) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.camera = camera;
    this.onKill = null;
    this.player = null;

    this.camQuat = new THREE.Quaternion();
    this.raycaster = new THREE.Raycaster();
    this.tracers = [];
    this.tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);

    this.bots = [];        // enemy fighters
    this.clones = [];      // ally clones summoned by the player
    const names = shuffle(CALLSIGNS.slice());
    for (let i = 0; i < count; i++) {
      const name = names[i % names.length] + (i >= names.length ? '-' + i : '');
      const weaponKey = PRIMARY_WEAPONS[Math.floor(Math.random() * PRIMARY_WEAPONS.length)];
      this.bots.push(new Bot(name, BOT_COLORS[i % BOT_COLORS.length], this, { weaponKey }));
    }
    this.all = this.bots;  // enemies only — weapon explosions target these
    this.scatterSpawn();
  }

  setPlayer(player) { this.player = player; }

  scatterSpawn() {
    this.clearClones();
    for (const b of this.bots) b.spawn(this.world.randomClearPosition(12));
  }

  clearClones() {
    for (const c of this.clones) this.scene.remove(c.root);
    this.clones.length = 0;
  }

  spawnClone(player) {
    if (this.clones.length >= MAX_CLONES) return;
    const clone = new Bot('CLONE', 0x6df0ff, this, { isClone: true, team: 'player' });
    const ang = Math.random() * Math.PI * 2;
    const pos = new THREE.Vector3(player.position.x + Math.cos(ang) * 3, 0, player.position.z + Math.sin(ang) * 3);
    this.world.resolveCollision(pos, 0.4);
    clone.spawn(pos);
    this.clones.push(clone);
  }

  allFighters() { return this.bots.concat(this.clones); }

  get combatants() {
    const base = [...this.bots, ...this.clones];
    return this.player ? [this.player, ...base] : base;
  }

  // All living bot hitboxes — the player can damage anyone (FFA).
  getAliveMeshes() {
    const meshes = [];
    for (const b of this.bots) if (b.alive) meshes.push(b.body, b.head);
    return meshes;
  }

  hasLineOfSight(from, to) {
    return !this.world.segmentBlocked(from, to);
  }

  blocked(from, dir, dist) {
    return this.world.segmentBlocked(from, from.clone().addScaledVector(dir, dist));
  }

  onBotKilled(bot, attacker) { if (this.onKill) this.onKill(attacker, bot); }

  onBotFired(bot, from, to, dist) {
    this.spawnTracer(from, to, bot.color);
    const toPlayer = this.player ? this.player.position.distanceTo(bot.position) : dist;
    if (toPlayer < 40 && Math.random() < 0.5) {
      this.audio.shootDistant(clamp(1 - toPlayer / 42, 0.05, 0.6));
    }
  }

  spawnTracer(from, to, color) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 1e-3) return;
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    mesh.scale.set(0.05, len, 0.05);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(1 / len));
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.1, max: 0.1 });
  }

  countAlive() { return this.bots.reduce((n, b) => n + (b.alive ? 1 : 0), 0); }

  update(delta, storm) {
    this.camera.getWorldQuaternion(this.camQuat);
    const combatants = this.combatants;
    for (const b of this.bots) b.update(delta, combatants, this.world, storm);
    for (const c of this.clones) c.update(delta, combatants, this.world, storm);

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= delta;
      t.mesh.material.opacity = Math.max(0, t.life / t.max) * 0.9;
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        t.mesh.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
