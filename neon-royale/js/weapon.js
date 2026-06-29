
const RANGE = 200;

/**
 * The player's weapon controller. Holds a primary + secondary slot (each with
 * its own ammo), fires the active weapon using its catalog stats, and applies
 * the permanent upgrades (explosive/bouncy/pierce/multishot/damage/vampire) on
 * top. Third-person: bullets are aimed from the camera centre but the tracer +
 * muzzle flash come from the player model's gun.
 */
class Weapon {
  constructor({ camera, scene, world, bots, audio, hud, player, power, destructibles }) {
    this.camera = camera;
    this.scene = scene;
    this.world = world;
    this.bots = bots;
    this.audio = audio;
    this.hud = hud;
    this.player = player;
    this.power = power || null;
    this.destructibles = destructibles || null;

    this.slots = {
      primary: { key: 'rifle', ammo: WEAPONS.rifle.mag },
      secondary: { key: 'pistol', ammo: WEAPONS.pistol.mag },
    };
    this.activeSlot = 'primary';

    this.reloading = false;
    this.reloadT = 0;
    this.cooldown = 0;
    this.triggerHeld = false;
    this._wantFire = false;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = RANGE;
    this.tracers = [];
    this.explosions = [];
    this.flashes = [];
    this.tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  }

  def() { return WEAPONS[this.slots[this.activeSlot].key]; }
  _key() { return this.slots[this.activeSlot].key; }
  _lvl(name) { return this.power ? this.power.level(name) : 0; }

  // Do you currently hold this weapon in either slot? (weapon-specific perks)
  holds(key) { return this.slots.primary.key === key || this.slots.secondary.key === key; }

  // Public hook so grenades/other systems can trigger an explosion here.
  explodeAt(center, level) { this._explode(center, level); }

  // Equip a weapon from a crate (replaces its slot and switches to it).
  setWeapon(key) {
    const def = WEAPONS[key];
    if (!def) return;
    this.slots[def.slot] = { key, ammo: def.mag };
    this.activeSlot = def.slot;
    this.reloading = false;
    this.cooldown = 0.15;
    this.hud.setReloading(false);
  }

  swap() {
    this.activeSlot = this.activeSlot === 'primary' ? 'secondary' : 'primary';
    this.reloading = false;
    this.cooldown = 0.15;
    this.hud.setReloading(false);
  }

  startFire() { this.triggerHeld = true; this._wantFire = true; }
  stopFire() { this.triggerHeld = false; this._wantFire = false; }

  reload() {
    const def = this.def();
    const slot = this.slots[this.activeSlot];
    if (this.reloading || slot.ammo === def.mag) return;
    this.reloading = true;
    this.reloadT = def.reload;
    this.audio.reload();
    this.hud.setReloading(true);
  }

  update(delta) {
    this.cooldown -= delta;
    const def = this.def();
    const slot = this.slots[this.activeSlot];

    if (this.reloading) {
      this.reloadT -= delta;
      if (this.reloadT <= 0) {
        this.reloading = false;
        slot.ammo = def.mag;
        this.hud.setReloading(false);
      }
    } else if (this.cooldown <= 0 && this.player.alive && !this.player.inCar) {
      // Auto weapons fire while held; semi weapons fire once per click.
      if ((def.auto && this.triggerHeld) || (!def.auto && this._wantFire)) this._fire();
    }

    this._updateTracers(delta);
    this._updateExplosions(delta);
    this._updateFlashes(delta);
    this.hud.setAmmo(slot.ammo, def.mag);
    this.hud.setWeapon(def.name);
  }

  _fire() {
    const def = this.def();
    const slot = this.slots[this.activeSlot];
    this._wantFire = false;
    if (slot.ammo <= 0) { this.audio.empty(); this.cooldown = 0.25; return; }
    slot.ammo--;
    this.cooldown = Math.max(0.03, def.fireInterval * Math.pow(0.85, this._lvl('rapid')));
    if (this._key() === 'smg' && this._lvl('overclock')) this.cooldown *= 0.55;   // OVERCLOCK
    this.audio.shoot();
    if (this.player.onShoot) this.player.onShoot();

    const muzzle = this.player.getMuzzleWorld();
    this._spawnFlash(muzzle);

    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const origin = this.raycaster.ray.origin.clone();
    const baseDir = this.raycaster.ray.direction.clone();
    this._targets = [...this.world.getObstacleMeshes(), ...this.bots.getAliveMeshes(),
      ...(this.destructibles ? this.destructibles.getMeshes() : [])];

    const pellets = def.pellets + this._lvl('multishot');
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < pellets; i++) {
      const d = baseDir.clone();
      if (def.spread > 0 || pellets > 1) {
        const sp = def.spread || 0.05;
        d.applyAxisAngle(up, (Math.random() - 0.5) * sp * 2);
        const right = new THREE.Vector3().crossVectors(d, up).normalize();
        d.applyAxisAngle(right, (Math.random() - 0.5) * sp * 2);
        d.normalize();
      }
      this._fireBullet(origin.clone(), d, muzzle, def);
    }
  }

  _fireBullet(rayOrigin, dir, tracerStart, def) {
    const wkey = this._key();
    let dmgMult = 1 + 0.6 * this._lvl('damage');
    const explosive = Math.max(def.explosive, this._lvl('explosive'));
    let bounces = this._lvl('bouncy') * 2;
    let pierces = this._lvl('pierce');
    const vamp = this._lvl('vampire');
    const cryo = this._lvl('cryo');
    const tesla = this._lvl('tesla');

    // Weapon-specific perks only matter while you hold the matching weapon.
    let headBonus = 1;
    if (wkey === 'smg' && this._lvl('overclock')) dmgMult *= 1.25;
    if (wkey === 'shotgun' && this._lvl('dragonbreath')) { dmgMult *= 1.6; pierces += 1; }
    if (wkey === 'sniper' && this._lvl('executioner')) { headBonus = 2.2; pierces += 2; }

    const hot = (wkey === 'shotgun' && this._lvl('dragonbreath'));
    const color = hot ? 0xff7a1a : explosive ? 0xffae42 : tesla ? 0xfff35c : def.tracer;
    const baseDmg = def.damage * dmgMult;

    let curOrigin = rayOrigin;
    let curDir = dir;
    let tStart = tracerStart.clone();

    for (let step = 0; step < 16; step++) {
      this.raycaster.set(curOrigin, curDir);
      this.raycaster.far = RANGE;
      const hits = this.raycaster.intersectObjects(this._targets, false);

      if (hits.length === 0) {
        this._spawnTracer(tStart, curOrigin.clone().addScaledVector(curDir, RANGE), color);
        return;
      }
      const hit = hits[0];
      this._spawnTracer(tStart, hit.point.clone(), color);

      const bot = hit.object.userData.bot;
      if (bot) {
        const dmg = hit.object.userData.part === 'head' ? baseDmg * def.headMult * headBonus : baseDmg;
        if (cryo && bot.applySlow) bot.applySlow(2.2, 1 - Math.min(0.6, 0.22 * cryo));   // CRYO
        const died = bot.takeDamage(dmg, this.player);
        this.audio.hit();
        this.hud.showHitmarker(died);
        if (died) this.audio.kill();
        if (vamp) this.player.heal(dmg * 0.12 * vamp);
        if (tesla) this._chainLightning(bot, baseDmg * 0.5, tesla, new Set([bot]));   // TESLA
        if (explosive) this._explode(hit.point, explosive);
        if (pierces > 0) {
          pierces--;
          curOrigin = hit.point.clone().addScaledVector(curDir, 0.15);
          tStart = curOrigin.clone();
          continue;
        }
        return;
      }

      const dobj = hit.object.userData.destructible;
      if (dobj) {
        this.destructibles.damage(dobj, baseDmg);
        this.audio.hit();
        this.hud.showHitmarker(false);
        if (explosive) this._explode(hit.point, explosive);
        return;
      }

      if (explosive) this._explode(hit.point, explosive);
      if (bounces > 0 && hit.face) {
        bounces--;
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        curDir = curDir.clone().reflect(n).normalize();
        curOrigin = hit.point.clone().addScaledVector(n, 0.05);
        tStart = curOrigin.clone();
        continue;
      }
      return;
    }
  }

  // TESLA: arc from a hit enemy to the nearest other enemy, losing power each jump.
  _chainLightning(fromBot, dmg, jumps, visited) {
    if (jumps <= 0) return;
    let best = null, bestD = 11 * 11;
    for (const b of this.bots.all) {
      if (!b.alive || visited.has(b)) continue;
      const d = b.position.distanceToSquared(fromBot.position);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) return;
    visited.add(best);
    this._spawnTracer(fromBot.aimPoint, best.aimPoint, 0xfff35c);
    const died = best.takeDamage(dmg, this.player);
    if (died) this.audio.kill();
    const vamp = this._lvl('vampire');
    if (vamp) this.player.heal(dmg * 0.08 * vamp);
    this._chainLightning(best, dmg * 0.8, jumps - 1, visited);
  }

  _explode(center, level) {
    const radius = 4 + level * 1.6;
    const dmg = 42 + level * 16;
    const vamp = this._lvl('vampire');

    // DEMOLITION (rocket perk): blow up nearby cars in a chain reaction.
    if (this._lvl('demolition') && this.crates && this.crates.detonateCarsNear) {
      this.crates.detonateCarsNear(center, radius + 2, (pos) => this.explodeAt(pos, level));
    }

    for (const b of this.bots.all) {
      if (!b.alive) continue;
      const d = b.position.distanceTo(center);
      if (d < radius) {
        const f = 1 - d / radius;
        const dir = b.position.clone().sub(center); dir.y = 0;
        if (dir.lengthSq() > 1e-4) dir.normalize();
        b.takeDamage(dmg * f, this.player);
        b.applyImpulse(dir, (7 + level * 2) * f);
        if (vamp) this.player.heal(dmg * f * 0.08 * vamp);
      }
    }

    const pc = new THREE.Vector3(this.player.position.x, this.player.position.y + 0.9, this.player.position.z);
    const pd = pc.distanceTo(center);
    if (pd < radius && this.player.alive) {
      const f = 1 - pd / radius;
      const dir = pc.clone().sub(center);
      dir.y = Math.max(dir.y, 0.55);
      if (dir.lengthSq() > 1e-4) dir.normalize();
      this.player.applyImpulse(dir, (15 + level * 4) * f);
    }

    if (this.destructibles) {
      for (const o of this.destructibles.items.slice()) {
        const dd = Math.hypot(o.x - center.x, o.z - center.z);
        if (dd < radius) this.destructibles.damage(o, dmg * (1 - dd / radius));
      }
    }

    this._spawnExplosion(center, radius);
    this.audio.explosion();
  }

  _spawnExplosion(center, radius) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.55 }));
    mesh.position.copy(center);
    const light = new THREE.PointLight(0xff8a3a, 6, radius * 3);
    light.position.copy(center);
    this.scene.add(mesh, light);
    this.explosions.push({ mesh, light, t: 0, dur: 0.32, radius });
  }

  _updateExplosions(delta) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.t += delta;
      const k = e.t / e.dur;
      e.mesh.scale.setScalar(0.4 + k * e.radius);
      e.mesh.material.opacity = Math.max(0, 0.55 * (1 - k));
      e.light.intensity = Math.max(0, 6 * (1 - k));
      if (e.t >= e.dur) {
        this.scene.remove(e.mesh, e.light);
        e.mesh.geometry.dispose();
        e.mesh.material.dispose();
        this.explosions.splice(i, 1);
      }
    }
  }

  _spawnFlash(pos) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.flashes.push({ mesh, life: 0.05 });
  }

  _updateFlashes(delta) {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= delta;
      f.mesh.material.opacity = Math.max(0, f.life / 0.05) * 0.9;
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
        this.flashes.splice(i, 1);
      }
    }
  }

  _spawnTracer(from, to, color) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 1e-3) return;
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    mesh.scale.set(0.07, len, 0.07);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(1 / len));
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.14, max: 0.14 });
  }

  _updateTracers(delta) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= delta;
      t.mesh.material.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        t.mesh.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }
}
