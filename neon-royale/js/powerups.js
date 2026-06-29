
// Permanent, stackable upgrades. Pick one up and you keep it for the match;
// grab more of the same to stack the effect. Combos are emergent — e.g.
// EXPLOSIVE + SPEED lets you rocket-jump, CRYO + EXPLOSIVE shatters frozen foes.
// `shape` selects the little icon that hovers above the gem so each upgrade
// reads at a glance. `weapon` marks a weapon-specific perk — only claimable
// while you're holding that weapon, and only useful with it.
const UPGRADES = {
  explosive: { label: 'EXPLOSIVE',  color: 0xff7a1a, stack: true, shape: 'burst' },
  bouncy:    { label: 'BOUNCY',     color: 0x6dfff0, stack: true, shape: 'ball' },
  multishot: { label: 'MULTI-SHOT', color: 0x9b5cff, stack: true, shape: 'trio' },
  pierce:    { label: 'PIERCE',     color: 0x21ffa3, stack: true, shape: 'arrow' },
  rapid:     { label: 'RAPID',      color: 0xffe24d, stack: true, shape: 'bolt' },
  damage:    { label: 'DAMAGE',     color: 0xff4d87, stack: true, shape: 'blade' },
  speed:     { label: 'SPEED',      color: 0x4dff7a, stack: true, shape: 'wing' },
  clone:     { label: 'CLONE',      color: 0x6df0ff, stack: true, shape: 'twins' },   // summons an ally
  vampire:   { label: 'VAMPIRE',    color: 0xff2b5e, stack: true, shape: 'fang' },    // lifesteal
  vitality:  { label: 'VITALITY',   color: 0x2bffd0, stack: true, shape: 'cross' },   // +max HP
  jump:      { label: 'HIGH-JUMP',  color: 0xa0ff3a, stack: true, shape: 'spring' },  // extra air jumps
  // --- new upgrades that open up fresh combos ---
  cryo:      { label: 'CRYO',       color: 0x8ff0ff, stack: true, shape: 'crystal' }, // slows enemies you hit
  tesla:     { label: 'TESLA',      color: 0xfff35c, stack: true, shape: 'spark' },   // shots chain to nearby foes
  magnet:    { label: 'MAGNET',     color: 0xff9a3a, stack: true, shape: 'magnet' },  // pulls in loot
  aegis:     { label: 'AEGIS',      color: 0x7ad1ff, stack: true, shape: 'shield' },  // grenades orbit you as a shield
  grenadier: { label: 'GRENADIER',  color: 0xc6ff5c, stack: true, shape: 'grenade' }, // bigger, faster grenades
  repair:    { label: 'REPAIR',     color: 0x4da0ff, stack: false, shape: 'medkit' }, // instant heal
  // --- weapon-specific perks (only claimable while holding that weapon) ---
  demolition:  { label: 'DEMOLITION', color: 0xff5a1a, stack: false, shape: 'bomb',    weapon: 'rocket' },
  executioner: { label: 'EXECUTIONER',color: 0x7dffe6, stack: false, shape: 'reticle', weapon: 'sniper' },
  dragonbreath:{ label: "DRAGON'S BREATH", color: 0xff7a1a, stack: false, shape: 'flame', weapon: 'shotgun' },
  overclock:   { label: 'OVERCLOCK',  color: 0x9be8ff, stack: false, shape: 'gear',    weapon: 'smg' },
};

const COMBOS = [
  { name: 'ROCKET JUMPER',   need: ['explosive', 'speed'] },
  { name: 'BOUNCING BOMBS',  need: ['explosive', 'bouncy'] },
  { name: 'CLUSTER BOMBS',   need: ['explosive', 'multishot'] },
  { name: 'RAILGUN',         need: ['pierce', 'damage'] },
  { name: 'BULLET STORM',    need: ['rapid', 'multishot', 'bouncy'] },
  { name: 'CLONE ARMY',      need: ['clone', 'rapid'] },
  { name: 'DEMOLITION SQUAD',need: ['clone', 'explosive'] },
  { name: 'VAMPIRE LORD',    need: ['vampire', 'damage'] },
  { name: 'LIFE LEECH',      need: ['vampire', 'multishot'] },
  { name: 'JUGGERNAUT',      need: ['vitality', 'speed'] },
  { name: 'SKY KING',        need: ['jump', 'explosive'] },
  { name: 'TITAN',           need: ['vitality', 'damage'] },
  // combos using the new upgrades
  { name: 'CRYO BREACH',     need: ['cryo', 'explosive'] },
  { name: 'ABSOLUTE ZERO',   need: ['cryo', 'damage'] },
  { name: 'BLIZZARD',        need: ['cryo', 'multishot'] },
  { name: 'STATIC STORM',    need: ['tesla', 'rapid'] },
  { name: 'CHAIN REACTION',  need: ['tesla', 'multishot'] },
  { name: 'OVERLOAD',        need: ['tesla', 'explosive'] },
  { name: 'BLACK HOLE',      need: ['magnet', 'explosive'] },
  { name: 'EVENT HORIZON',   need: ['magnet', 'tesla'] },
  { name: 'AEGIS PROTOCOL',  need: ['aegis', 'grenadier'] },
  { name: 'WAR MACHINE',     need: ['grenadier', 'damage'] },
  { name: 'FORTRESS',        need: ['aegis', 'vitality'] },
];

const LOOT_COUNT = 100;
const RESPAWN_TIME = 20;
const PICKUP_RADIUS = 1.6;

/**
 * Scatters permanent-upgrade loot across the city, handles the player picking
 * it up, tracks owned upgrade levels (queried by weapon.js / player.js), and
 * announces combos.
 */
class PowerupManager {
  constructor({ scene, audio, hud, world, bots }) {
    this.scene = scene;
    this.audio = audio;
    this.hud = hud;
    this.world = world;
    this.bots = bots || null;  // AEGIS orbs damage these
    this.weapon = null;        // set by main once the Weapon exists (claim gate)

    this.owned = {};           // type -> level (CLONE level = summon charges)
    this.announced = new Set();
    this.pickups = [];
    this.orbs = [];            // AEGIS shield orbs orbiting the player
    this._orbCount = 0;
    this.spin = 0;
    this._labelCache = new Map();

    // General loot pulls from the non-weapon-specific upgrades.
    const types = Object.keys(UPGRADES).filter((t) => !UPGRADES[t].weapon);
    const rnd = () => types[Math.floor(Math.random() * types.length)];
    for (let i = 0; i < LOOT_COUNT; i++) {
      const p = world.randomClearPosition(10);
      this._make(p.x, p.z, rnd());
    }
    // Weapon-specific perks are scattered in smaller numbers (need the weapon).
    for (const t of Object.keys(UPGRADES).filter((u) => UPGRADES[u].weapon)) {
      for (let i = 0; i < 5; i++) {
        const p = world.randomClearPosition(10);
        this._make(p.x, p.z, t);
      }
    }
    // "Loot rooms" — extra pickups inside hollow buildings to reward going in.
    for (const spot of (world.interiorSpots || [])) {
      if (Math.random() < 0.45) this._make(spot.x, spot.z, rnd());
    }
  }

  _make(x, z, type) {
    const cfg = UPGRADES[type];
    const group = new THREE.Group();

    // Glowing faceted gem that catches light, with a faint wire overlay.
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0),
      new THREE.MeshStandardMaterial({ color: cfg.color, emissive: cfg.color, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.2 }));
    core.position.y = 1.3;
    core.add(new THREE.LineSegments(new THREE.EdgesGeometry(core.geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })));

    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.04, 8, 32),
      new THREE.MeshBasicMaterial({ color: cfg.color }));
    ring1.position.y = 1.3; ring1.rotation.x = Math.PI / 2;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.035, 8, 32),
      new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.7 }));
    ring2.position.y = 1.3; ring2.rotation.x = Math.PI / 3;

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 3.4, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: cfg.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    beam.position.y = 1.6;
    const groundRing = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.06, 8, 36),
      new THREE.MeshBasicMaterial({ color: cfg.color }));
    groundRing.rotation.x = -Math.PI / 2; groundRing.position.y = 0.05;

    // A distinctive little shape hovering above the gem so the upgrade is
    // recognisable from a distance, before you can read the label.
    const icon = this._iconFor(cfg.shape, cfg.color);
    icon.position.y = 2.15;

    const label = this._label(cfg.label, cfg.color);   // floating name, faces camera
    label.position.y = 2.7;

    group.add(core, ring1, ring2, beam, groundRing, icon, label);
    group.position.set(x, 0, z);
    this.scene.add(group);
    this.pickups.push({ group, core, ring1, ring2, icon, type, x, z, active: true, respawnT: 0 });
  }

  // Build the floating icon for an upgrade shape from a few glowing primitives.
  _iconFor(shape, color) {
    const g = new THREE.Group();
    const M = () => new THREE.MeshBasicMaterial({ color });
    const add = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, M());
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
    };
    switch (shape) {
      case 'ball':    add(new THREE.SphereGeometry(0.26, 16, 12)); break;
      case 'burst':   add(new THREE.OctahedronGeometry(0.3, 0)); add(new THREE.TorusGeometry(0.34, 0.04, 6, 18), 0, 0, 0, Math.PI / 2); break;
      case 'trio':    for (const dx of [-0.26, 0, 0.26]) add(new THREE.SphereGeometry(0.12, 10, 8), dx); break;
      case 'arrow':   add(new THREE.ConeGeometry(0.16, 0.5, 12), 0, 0.12, 0); add(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8), 0, -0.2, 0); break;
      case 'bolt':    add(new THREE.BoxGeometry(0.1, 0.34, 0.06), -0.08, 0.14, 0, 0, 0, 0.5); add(new THREE.BoxGeometry(0.1, 0.34, 0.06), 0.08, -0.14, 0, 0, 0, 0.5); break;
      case 'blade':   add(new THREE.ConeGeometry(0.12, 0.55, 4), 0, 0.12, 0); add(new THREE.BoxGeometry(0.34, 0.07, 0.07), 0, -0.16, 0); break;
      case 'wing':    add(new THREE.ConeGeometry(0.14, 0.34, 4), -0.16, 0, 0, 0, 0, -Math.PI / 2); add(new THREE.ConeGeometry(0.14, 0.34, 4), 0.16, 0, 0, 0, 0, -Math.PI / 2); break;
      case 'twins':   add(new THREE.BoxGeometry(0.26, 0.26, 0.26), -0.12, -0.08, 0); add(new THREE.BoxGeometry(0.26, 0.26, 0.26), 0.12, 0.08, 0); break;
      case 'fang':    add(new THREE.ConeGeometry(0.2, 0.5, 12), 0, 0, 0, Math.PI); break;
      case 'cross':   add(new THREE.BoxGeometry(0.16, 0.5, 0.16)); add(new THREE.BoxGeometry(0.5, 0.16, 0.16)); break;
      case 'spring':  for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(0.2 - i * 0.02, 0.04, 6, 16), 0, -0.18 + i * 0.18, 0, Math.PI / 2); break;
      case 'crystal': add(new THREE.OctahedronGeometry(0.32, 0)); break;
      case 'spark':   add(new THREE.BoxGeometry(0.5, 0.08, 0.08), 0, 0, 0, 0, 0, 0.4); add(new THREE.BoxGeometry(0.5, 0.08, 0.08), 0, 0, 0, 0, 0, -0.4); add(new THREE.SphereGeometry(0.1, 8, 6)); break;
      case 'magnet':  add(new THREE.TorusGeometry(0.26, 0.08, 8, 16, Math.PI), 0, 0.05, 0); add(new THREE.BoxGeometry(0.08, 0.16, 0.16), -0.26, -0.1, 0); add(new THREE.BoxGeometry(0.08, 0.16, 0.16), 0.26, -0.1, 0); break;
      case 'shield':  add(new THREE.TorusGeometry(0.28, 0.05, 8, 24)); for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; add(new THREE.SphereGeometry(0.08, 8, 6), Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0); } break;
      case 'grenade': add(new THREE.SphereGeometry(0.24, 12, 10)); add(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8), 0, 0.26, 0); break;
      case 'bomb':    add(new THREE.SphereGeometry(0.28, 12, 10)); add(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 6), 0, 0.3, 0); add(new THREE.ConeGeometry(0.06, 0.1, 6), 0.16, 0.32, 0, 0, 0, -0.6); break;
      case 'reticle': add(new THREE.TorusGeometry(0.28, 0.04, 8, 24)); add(new THREE.BoxGeometry(0.62, 0.04, 0.04)); add(new THREE.BoxGeometry(0.04, 0.62, 0.04)); break;
      case 'flame':   add(new THREE.ConeGeometry(0.2, 0.5, 10), 0, 0.05, 0); add(new THREE.ConeGeometry(0.1, 0.28, 8), 0, 0.22, 0); break;
      case 'gear':    add(new THREE.TorusGeometry(0.24, 0.09, 6, 12)); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(new THREE.BoxGeometry(0.1, 0.1, 0.1), Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0); } break;
      case 'medkit':  add(new THREE.BoxGeometry(0.42, 0.42, 0.42), 0, 0, 0); add(new THREE.BoxGeometry(0.1, 0.3, 0.06), 0, 0, 0.22, 0, 0, 0); add(new THREE.BoxGeometry(0.3, 0.1, 0.06), 0, 0, 0.22); break;
      default:        add(new THREE.SphereGeometry(0.22, 12, 10)); break;
    }
    return g;
  }

  _label(text, color) {
    const key = text + color;
    let tex = this._labelCache.get(key);
    if (!tex) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 256, 64);
      ctx.font = 'bold 34px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const hex = '#' + color.toString(16).padStart(6, '0');
      ctx.fillStyle = hex;
      ctx.shadowColor = hex;
      ctx.shadowBlur = 12;
      ctx.fillText(text, 128, 36);
      tex = new THREE.CanvasTexture(canvas);
      this._labelCache.set(key, tex);
    }
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    spr.scale.set(2.6, 0.65, 1);
    return spr;
  }

  reset() {
    this.owned = {};
    this.announced = new Set();
    for (const p of this.pickups) { p.active = true; p.respawnT = 0; p.group.visible = true; }
    for (const o of this.orbs) this.scene.remove(o.mesh);
    this.orbs = [];
    this._orbCount = 0;
  }

  level(type) { return this.owned[type] || 0; }

  // CLONE is spent by pressing the summon key.
  consumeCloneCharge() {
    if ((this.owned.clone || 0) > 0) { this.owned.clone--; return true; }
    return false;
  }

  // Add one level of a specific upgrade and apply its side effects (used by the
  // debug "give everything" cheat). Mirrors the relevant bits of _collect.
  grantUpgrade(type, player) {
    if (!UPGRADES[type]) return;
    this.owned[type] = (this.owned[type] || 0) + 1;
    if (type === 'vitality' && player) player.addMaxHp(30);
    this._checkCombos();
  }

  // Grant a random stackable upgrade (used by the VAULT). Returns its label.
  // Skips weapon-specific perks — those require holding the matching weapon.
  grantRandom() {
    const types = Object.keys(UPGRADES).filter((t) => UPGRADES[t].stack && !UPGRADES[t].weapon);
    const type = types[Math.floor(Math.random() * types.length)];
    this.owned[type] = (this.owned[type] || 0) + 1;
    this._checkCombos();
    return UPGRADES[type].label;
  }

  _collect(p, player) {
    const cfg = UPGRADES[p.type];
    // Weapon-specific perks can only be claimed while you hold that weapon.
    if (cfg.weapon && !(this.weapon && this.weapon.holds(cfg.weapon))) {
      this.hud.toast('NEED ' + WEAPONS[cfg.weapon].name + ' TO CLAIM', 0xff6a6a);
      p.lockoutT = 1.2;             // brief pause before it can re-prompt
      return;                       // leave the gem for later
    }
    if (p.type === 'repair') {
      player.heal(60);
    } else {
      this.owned[p.type] = (this.owned[p.type] || 0) + 1;
      if (p.type === 'vitality') player.addMaxHp(30);
      this._checkCombos();
    }
    this.audio.powerup();
    p.active = false;
    p.respawnT = RESPAWN_TIME;
    p.group.visible = false;
  }

  _checkCombos() {
    for (const combo of COMBOS) {
      if (this.announced.has(combo.name)) continue;
      if (combo.need.every((t) => this.level(t) > 0)) {
        this.announced.add(combo.name);
        this.hud.showCombo(combo.name);
      }
    }
  }

  update(delta, player) {
    this.spin += delta;
    // MAGNET widens your pickup reach (and pulls weapon drops — see crates.js).
    const reach = PICKUP_RADIUS * (1 + 0.7 * this.level('magnet'));
    const reachSq = reach * reach;
    for (const p of this.pickups) {
      if (p.active) {
        p.core.rotation.y = this.spin * 1.6;
        p.core.rotation.x = this.spin * 1.1;
        p.core.position.y = 1.3 + Math.sin(this.spin * 2 + p.x) * 0.12;
        p.core.scale.setScalar(1 + Math.sin(this.spin * 3 + p.x) * 0.08);
        p.ring1.rotation.z = this.spin * 0.8;
        p.ring2.rotation.z = this.spin * 1.2;
        if (p.icon) { p.icon.rotation.y = this.spin * 1.3; p.icon.position.y = 2.15 + Math.sin(this.spin * 2.2 + p.x) * 0.1; }
        if (p.lockoutT > 0) p.lockoutT -= delta;
        if (player.alive && !(p.lockoutT > 0)) {
          const dx = player.position.x - p.x, dz = player.position.z - p.z;
          if (dx * dx + dz * dz < reachSq) this._collect(p, player);
        }
      } else {
        p.respawnT -= delta;
        if (p.respawnT <= 0) { p.active = true; p.group.visible = true; }
      }
    }
    this._updateAegis(delta, player);
    this._pushHud();
  }

  // AEGIS: spawn one orbiting orb per level (capped). GRENADIER pumps their
  // size, orbit speed/reach, and the contact damage they deal — so the two
  // upgrades combo (AEGIS PROTOCOL) into a heavy, fast-spinning shield wall.
  _ensureOrbs(count) {
    if (this._orbCount === count) return;
    this._orbCount = count;
    for (const o of this.orbs) this.scene.remove(o.mesh);
    this.orbs = [];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 12, 10),
        new THREE.MeshBasicMaterial({
          color: 0x7ad1ff, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
      // A faint trailing halo so the orbs read as energy, not marbles.
      mesh.add(new THREE.Mesh(
        new THREE.SphereGeometry(0.46, 12, 10),
        new THREE.MeshBasicMaterial({
          color: 0x7ad1ff, transparent: true, opacity: 0.18,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })));
      this.scene.add(mesh);
      this.orbs.push({ mesh, cool: 0 });
    }
  }

  _updateAegis(delta, player) {
    const lvl = this.level('aegis');
    this._ensureOrbs(Math.min(lvl, 6));
    if (!this.orbs.length) return;

    const gren = this.level('grenadier');
    const orbitR = 2.2 + 0.25 * gren;
    const size = 1 + 0.4 * gren;
    const hitR = (0.5 + 0.16 * gren) * size;
    const dmg = (18 + 8 * lvl) * (1 + 0.45 * gren);
    const knock = 6 + gren * 2;
    const ang = this.spin * (1.7 + 0.5 * gren);
    const baseY = player.position.y + 1.1;

    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      const a = ang + (i / this.orbs.length) * Math.PI * 2;
      const ox = player.position.x + Math.cos(a) * orbitR;
      const oz = player.position.z + Math.sin(a) * orbitR;
      orb.mesh.position.set(ox, baseY + Math.sin(this.spin * 3 + i) * 0.15, oz);
      orb.mesh.scale.setScalar(size);

      orb.cool -= delta;
      if (orb.cool > 0 || !this.bots || !player.alive) continue;
      for (const b of this.bots.all) {
        if (!b.alive) continue;
        const dx = b.position.x - ox, dz = b.position.z - oz;
        if (dx * dx + dz * dz < hitR * hitR) {
          const died = b.takeDamage(dmg, player);
          const dir = new THREE.Vector3(dx, 0, dz);
          if (dir.lengthSq() > 1e-4) dir.normalize();
          if (b.applyImpulse) b.applyImpulse(dir, knock);
          this.audio.hit();
          if (died) this.audio.kill();
          orb.cool = 0.45;   // brief per-orb cooldown so it shields, not shreds
          break;
        }
      }
    }
  }

  _pushHud() {
    const list = [];
    for (const type of Object.keys(UPGRADES)) {
      if (!UPGRADES[type].stack) continue;
      const lvl = this.level(type);
      if (lvl > 0) list.push({ label: UPGRADES[type].label, color: UPGRADES[type].color, level: lvl });
    }
    this.hud.setUpgrades(list);
  }
}
