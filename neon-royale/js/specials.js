
const PAD_RADIUS = 2.6;
const PET_RANGE = 46;
const PET_DMG = 7;
const PET_COOLDOWN = 0.8;

// Landmark buildings, each with a function you trigger by standing on its pad.
const SPECIAL_DEFS = [
  { type: 'PET LAB', color: 0x35ff8a },
  { type: 'ARMORY',  color: 0xff7a1a },
  { type: 'VAULT',   color: 0xffe24d },
  { type: 'CLINIC',  color: 0x4da0ff },
  { type: 'ARMORY',  color: 0xff7a1a },
  { type: 'VAULT',   color: 0xffe24d },
  { type: 'CLINIC',  color: 0x4da0ff },
];

/** A floating companion drone: follows you and zaps the nearest enemy it sees. */
class Pet {
  constructor(scene) {
    this.scene = scene;
    this.name = 'PET';
    this.team = 'player';
    this.color = 0x35ff8a;
    this.cooldown = 0;
    this.spin = 0;

    this.group = new THREE.Group();
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32),
      new THREE.MeshBasicMaterial({ color: this.color }));
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 20),
      new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.8 }));
    this.ring.rotation.x = Math.PI / 2;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eye.position.z = -0.28;
    this.group.add(this.orb, this.ring, eye);
    this.group.position.set(0, 2.5, 0);
    scene.add(this.group);
  }

  update(delta, player, bots) {
    this.spin += delta;
    // Hover behind/above the player.
    const back = 1.8;
    const tgt = new THREE.Vector3(
      player.position.x + Math.sin(player.yawAngle) * back,
      2.4 + Math.sin(this.spin * 2) * 0.15,
      player.position.z + Math.cos(player.yawAngle) * back
    );
    this.group.position.lerp(tgt, Math.min(1, delta * 4));
    this.orb.rotation.y = this.spin * 2;
    this.ring.rotation.z = this.spin * 1.5;

    this.cooldown -= delta;
    if (this.cooldown > 0) return;
    const eye = this.group.position.clone();
    let target = null, bestSq = PET_RANGE * PET_RANGE;
    for (const b of bots.bots) {
      if (!b.alive) continue;
      const dsq = eye.distanceToSquared(b.position);
      if (dsq < bestSq && bots.hasLineOfSight(eye, b.aimPoint)) { bestSq = dsq; target = b; }
    }
    if (target) {
      target.takeDamage(PET_DMG, this);
      bots.spawnTracer(eye, target.aimPoint, this.color);
      this.cooldown = PET_COOLDOWN;
    } else {
      this.cooldown = 0.3;
    }
  }
}

/**
 * Builds the special landmark buildings and runs their pad effects + the pet.
 */
class SpecialsManager {
  constructor({ scene, audio, hud, world }) {
    this.scene = scene;
    this.audio = audio;
    this.hud = hud;
    this.world = world;
    this.buildings = [];
    this.pet = null;
    this.spin = 0;
    this._labelCache = new Map();

    for (const def of SPECIAL_DEFS) this._build(def);
  }

  _build(def) {
    const p = this.world.randomClearPosition(34);
    const w = 11, d = 11, h = 18;
    this.world._addBox(p.x, p.z, w, h, d,
      new THREE.MeshStandardMaterial({ color: 0x10131b, roughness: 0.85 }));   // solid, collidable

    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.5, d + 0.3),
      new THREE.MeshBasicMaterial({ color: def.color }));
    band.position.set(p.x, h - 0.5, p.z);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10),
      new THREE.MeshBasicMaterial({ color: def.color }));
    beacon.position.set(p.x, h + 0.9, p.z);
    const sign = this._label(def.type, def.color);
    sign.position.set(p.x, h + 2.6, p.z); sign.scale.set(9, 2.3, 1);
    this.scene.add(band, beacon, sign);

    // Interaction pad on the +Z face.
    const padX = p.x, padZ = p.z + d / 2 + 2.6;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.3, 28),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.35 }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(padX, 0.06, padZ);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 4.5, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: def.color, transparent: true, opacity: 0.14, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    beam.position.set(padX, 2.2, padZ);
    this.scene.add(disc, beam);

    this.buildings.push({ type: def.type, color: def.color, x: p.x, z: p.z, padX, padZ, disc, cooldown: 0 });
  }

  _label(text, color) {
    const key = text + color;
    let tex = this._labelCache.get(key);
    if (!tex) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 256, 64);
      ctx.font = 'bold 40px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const hex = '#' + color.toString(16).padStart(6, '0');
      ctx.fillStyle = hex; ctx.shadowColor = hex; ctx.shadowBlur = 14;
      ctx.fillText(text, 128, 36);
      tex = new THREE.CanvasTexture(canvas);
      this._labelCache.set(key, tex);
    }
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  }

  reset() {
    if (this.pet) { this.scene.remove(this.pet.group); this.pet = null; }
    for (const b of this.buildings) b.cooldown = 0;
  }

  update(delta, player, weapon, powerups, bots) {
    this.spin += delta;
    for (const b of this.buildings) {
      b.cooldown = Math.max(0, b.cooldown - delta);
      b.disc.material.opacity = 0.3 + 0.12 * Math.sin(this.spin * 3 + b.x);
      if (!player.alive || player.inCar) continue;
      const dx = player.position.x - b.padX, dz = player.position.z - b.padZ;
      if (dx * dx + dz * dz <= PAD_RADIUS * PAD_RADIUS) this._effect(b, player, weapon, powerups, delta);
    }
    if (this.pet) this.pet.update(delta, player, bots);
  }

  _effect(b, player, weapon, powerups, delta) {
    if (b.type === 'PET LAB') {
      if (!this.pet) {
        this.pet = new Pet(this.scene);
        this.hud.toast('GOT A PET!', b.color);
        this.audio.powerup();
      }
    } else if (b.type === 'CLINIC') {
      player.heal(45 * delta);               // continuous heal while you stand on it
    } else if (b.cooldown <= 0) {
      if (b.type === 'ARMORY') {
        const key = Math.random() < 0.5 ? 'sniper' : 'rocket';
        weapon.setWeapon(key);
        this.hud.toast('ARMORY: ' + WEAPONS[key].name, b.color);
        this.audio.powerup();
        b.cooldown = 12;
      } else if (b.type === 'VAULT') {
        const label = powerups.grantRandom();
        player.heal(50);
        this.hud.toast('VAULT: ' + label, b.color);
        this.audio.powerup();
        b.cooldown = 20;
      }
    }
  }
}
