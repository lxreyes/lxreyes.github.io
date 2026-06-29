
const CRATE_RESPAWN = 18;
const CRATE_RADIUS = 1.7;
const NUM_WEAPON_CRATES = 40;
const NUM_HYPER_CRATES = 26;
const EXTRA_CARS = 18;
const CAR_ENTER_DIST = 3.6;

// Weapons dropped by killed fighters: how long they linger, how close you must
// be to grab one, and how many can sit on the ground before the oldest fades.
const DROP_LIFE = 22;
const DROP_RADIUS = 2.0;
const MAX_DROPS = 14;

/**
 * Scatters loot crates (weapons + hyper-boosts) and drivable cars around the
 * city and in garages. The player walks over crates to open them; cars are
 * mounted with the E key (handled by toggleCar).
 */
class CrateManager {
  constructor({ scene, audio, hud, world, power }) {
    this.scene = scene;
    this.audio = audio;
    this.hud = hud;
    this.world = world;
    this.power = power || null;     // for MAGNET (pulls drops toward the player)
    this.crates = [];
    this.cars = [];
    this.drops = [];      // weapons dropped by killed fighters
    this.spin = 0;

    for (let i = 0; i < NUM_WEAPON_CRATES; i++) this._crate(this.world.randomClearPosition(10), 'weapon');
    for (let i = 0; i < NUM_HYPER_CRATES; i++) this._crate(this.world.randomClearPosition(10), 'hyper');

    // A car + a weapon crate in every garage, plus a few scattered cars.
    const spots = this.world.garageSpots || [];
    for (const s of spots) {
      this._car(s.x, s.z);
      this._crate(new THREE.Vector3(s.x + 2.4, 0, s.z), 'weapon');
    }
    for (let i = 0; i < EXTRA_CARS; i++) {
      const p = this.world.randomClearPosition(12);
      this._car(p.x, p.z);
    }
    // Loot-room crates inside some hollow buildings.
    for (const spot of (this.world.interiorSpots || [])) {
      if (Math.random() < 0.3) this._crate(new THREE.Vector3(spot.x, 0, spot.z), Math.random() < 0.55 ? 'weapon' : 'hyper');
    }
  }

  _crate(pos, kind) {
    const color = kind === 'hyper' ? 0x35ff8a : 0x4ea0ff;
    const g = new THREE.Group();

    // Metallic body with neon edge trim + a glowing lid.
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.86, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x141925, roughness: 0.45, metalness: 0.55 }));
    body.position.y = 0.48;
    body.add(new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({ color })));
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.18, 1.06),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.4, metalness: 0.4 }));
    lid.position.y = 1.0;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 2.6, 12, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.y = 1.6;

    // Icon hints at contents: a chevron for hyper, a little gun for weapons.
    let weaponKey = null, icon;
    if (kind === 'hyper') {
      icon = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.55, 6), new THREE.MeshBasicMaterial({ color }));
    } else {
      weaponKey = Math.random() < 0.85
        ? PRIMARY_WEAPONS[Math.floor(Math.random() * PRIMARY_WEAPONS.length)] : 'pistol';
      icon = new THREE.Group();
      const ib = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.16), new THREE.MeshBasicMaterial({ color }));
      const ibar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.12), new THREE.MeshBasicMaterial({ color }));
      ibar.position.set(-0.16, -0.14, 0);
      icon.add(ib, ibar);
    }
    icon.position.y = 1.7;

    g.add(body, lid, beam, icon);
    if (kind === 'weapon') {
      const label = this._label(WEAPONS[weaponKey].name, color);
      label.position.y = 2.25; label.scale.set(2.6, 0.62, 1);
      g.add(label);
    }
    g.position.set(pos.x, 0, pos.z);
    this.scene.add(g);
    this.crates.push({ group: g, icon, kind, weaponKey, x: pos.x, z: pos.z, active: true, respawnT: 0 });
  }

  _label(text, color) {
    this._labelCache = this._labelCache || new Map();
    const key = text + color;
    let tex = this._labelCache.get(key);
    if (!tex) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 256, 64);
      ctx.font = 'bold 36px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const hex = '#' + color.toString(16).padStart(6, '0');
      ctx.fillStyle = hex; ctx.shadowColor = hex; ctx.shadowBlur = 12;
      ctx.fillText(text, 128, 36);
      tex = new THREE.CanvasTexture(canvas);
      this._labelCache.set(key, tex);
    }
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  }

  _car(x, z) {
    const g = new THREE.Group();
    const colors = [0xff3b6e, 0x3bd1ff, 0x6dff7a, 0xffb43b, 0xb45cff];
    const bodyColor = colors[this.cars.length % colors.length];
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 4.4),
      new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.35, metalness: 0.5 }));
    body.position.y = 0.7;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x0a0e16, roughness: 0.2, metalness: 0.7 }));
    cabin.position.set(0, 1.25, -0.2);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 5.0),
      new THREE.MeshBasicMaterial({ color: bodyColor, transparent: true, opacity: 0.3 }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06;
    g.add(body, cabin, glow);
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.8 });
    for (const wx of [-1.0, 1.0]) for (const wz of [-1.4, 1.4]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2; w.position.set(wx, 0.38, wz);
      g.add(w);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.cars.push({ group: g, x, z, homeX: x, homeZ: z, taken: false });
  }

  reset() {
    for (const d of this.drops.slice()) this._removeDrop(d);
    for (const c of this.crates) { c.active = true; c.respawnT = 0; c.group.visible = true; }
    for (const car of this.cars) {
      car.taken = false; car.x = car.homeX; car.z = car.homeZ;
      car.group.position.set(car.homeX, 0, car.homeZ);
      car.group.rotation.y = 0;
    }
  }

  // DEMOLITION: detonate every drivable car within `radius`, calling back to
  // spawn an explosion at each (which can chain to further cars). Cars are
  // marked exploded so the chain terminates.
  detonateCarsNear(center, radius, explodeAt) {
    const r2 = radius * radius;
    const hit = [];
    for (const car of this.cars) {
      if (car.taken || car._exploded) continue;
      const dx = car.group.position.x - center.x, dz = car.group.position.z - center.z;
      if (dx * dx + dz * dz < r2) hit.push(car);
    }
    for (const car of hit) {
      car._exploded = true; car.taken = true; car.group.visible = false;
      if (explodeAt) explodeAt(car.group.position.clone());
    }
  }

  nearestCar(pos, maxDist) {
    let best = null, bestD = maxDist;
    for (const car of this.cars) {
      if (car.taken) continue;
      const d = Math.hypot(car.group.position.x - pos.x, car.group.position.z - pos.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  _enterExitCar(player) {
    if (player.inCar) {
      for (const car of this.cars) if (car.group === player.carMesh) car.taken = false;
      player.exitCar();
      this.audio.boost();
      return;
    }
    const car = this.nearestCar(player.position, CAR_ENTER_DIST);
    if (car) { car.taken = true; player.enterCar(car.group); this.audio.boost(); }
  }

  toggleCar(player) { this._enterExitCar(player); }   // (kept for compatibility)

  nearbyWeaponCrate(player) {
    if (player.inCar) return null;
    for (const c of this.crates) {
      if (!c.active || c.kind !== 'weapon') continue;
      const dx = player.position.x - c.x, dz = player.position.z - c.z;
      if (dx * dx + dz * dz < CRATE_RADIUS * CRATE_RADIUS) return c;
    }
    return null;
  }

  // Spawn a pickup where a fighter died: its rifle, hovering and glowing in the
  // fighter's colour with a name label. Grabbed with E, fades after a while.
  dropWeapon(pos, weaponKey, color) {
    if (!weaponKey || !WEAPONS[weaponKey]) return;
    color = (color != null) ? color : 0xffd27a;

    const g = new THREE.Group();
    const gun = buildGun({ glow: color }).group;
    gun.scale.setScalar(1.25);
    gun.position.y = 0.85;

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.7, 10, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.y = 0.85;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.5, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;

    const label = this._label(WEAPONS[weaponKey].name, color);
    label.position.y = 1.7; label.scale.set(2.2, 0.52, 1);

    g.add(gun, beam, ring, label);
    g.position.set(pos.x, 0, pos.z);
    this.scene.add(g);

    // Cap clutter: when full, retire the oldest drop.
    if (this.drops.length >= MAX_DROPS) this._removeDrop(this.drops[0]);
    this.drops.push({ group: g, gun, x: pos.x, z: pos.z, weaponKey, color, life: DROP_LIFE });
  }

  nearbyDrop(player) {
    if (player.inCar) return null;
    let best = null, bestD = DROP_RADIUS * DROP_RADIUS;
    for (const d of this.drops) {
      const dx = player.position.x - d.x, dz = player.position.z - d.z;
      const q = dx * dx + dz * dz;
      if (q < bestD) { bestD = q; best = d; }
    }
    return best;
  }

  _removeDrop(d) {
    const i = this.drops.indexOf(d);
    if (i >= 0) this.drops.splice(i, 1);
    this.scene.remove(d.group);
  }

  // What the E key would do right now (for the HUD prompt).
  interactPrompt(player) {
    if (player.inCar) return 'Press E to exit car';
    const wc = this.nearbyWeaponCrate(player);
    if (wc) return 'Press E to pick up ' + WEAPONS[wc.weaponKey].name;
    const dp = this.nearbyDrop(player);
    if (dp) return 'Press E to pick up ' + WEAPONS[dp.weaponKey].name;
    if (this.nearestCar(player.position, CAR_ENTER_DIST)) return 'Press E to drive';
    return null;
  }

  // The E key: pick up a weapon crate if on one, else a dropped weapon, else
  // enter/exit a car.
  interact(player, weapon) {
    if (player.inCar) { this._enterExitCar(player); return; }
    const wc = this.nearbyWeaponCrate(player);
    if (wc) {
      weapon.setWeapon(wc.weaponKey);
      this.hud.toast('PICKED UP ' + WEAPONS[wc.weaponKey].name, 0x4ea0ff);
      this.audio.powerup();
      wc.active = false; wc.respawnT = CRATE_RESPAWN; wc.group.visible = false;
      return;
    }
    const dp = this.nearbyDrop(player);
    if (dp) {
      weapon.setWeapon(dp.weaponKey);
      this.hud.toast('PICKED UP ' + WEAPONS[dp.weaponKey].name, dp.color);
      this.audio.powerup();
      this._removeDrop(dp);
      return;
    }
    this._enterExitCar(player);
  }

  _openHyper(c, player) {
    player.hyperCharges++;
    this.hud.toast('+ HYPER BOOST', 0x35ff8a);
    this.audio.powerup();
    c.active = false; c.respawnT = CRATE_RESPAWN; c.group.visible = false;
  }

  update(delta, player) {
    this.spin += delta;
    for (const c of this.crates) {
      if (c.active) {
        c.icon.rotation.y = this.spin * 1.8;
        c.icon.position.y = 1.7 + Math.sin(this.spin * 2 + c.x) * 0.1;
        // Hyper crates auto-collect; weapon crates need an E press (see interact()).
        if (c.kind === 'hyper' && player.alive && !player.inCar) {
          const dx = player.position.x - c.x, dz = player.position.z - c.z;
          if (dx * dx + dz * dz < CRATE_RADIUS * CRATE_RADIUS) this._openHyper(c, player);
        }
      } else {
        c.respawnT -= delta;
        if (c.respawnT <= 0) { c.active = true; c.group.visible = true; }
      }
    }

    // MAGNET: how far drops are reeled in, and how fast (0 when not owned).
    const mag = this.power ? this.power.level('magnet') : 0;
    const pullR = 6 + mag * 4;
    const pullSpeed = 5 + mag * 3;

    // Dropped weapons: spin + hover, then despawn (blinking out near the end).
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= delta;
      d.gun.rotation.y = this.spin * 1.6;
      d.gun.position.y = 0.85 + Math.sin(this.spin * 2.4 + d.x) * 0.12;

      // Reel the drop toward the player while they're on foot and in range.
      if (mag > 0 && player.alive && !player.inCar) {
        const dx = player.position.x - d.x, dz = player.position.z - d.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.4 && dist < pullR) {
          const step = Math.min(dist, pullSpeed * delta);
          d.x += (dx / dist) * step; d.z += (dz / dist) * step;
          d.group.position.set(d.x, 0, d.z);
        }
      }

      d.group.visible = d.life > 2 || Math.sin(this.spin * 18) > 0;   // blink last 2s
      if (d.life <= 0) this._removeDrop(d);
    }
  }
}
