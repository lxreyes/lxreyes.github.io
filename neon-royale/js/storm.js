
// Each phase: hold at the current radius for `hold`s, then shrink to `radius`
// over `shrink`s. `dps` is the damage-per-second taken outside the safe zone
// while/after that phase.
// Target radius is a fraction of the start radius, so it scales with the map.
const STORM_PHASES = [
  { frac: 0.58, hold: 20, shrink: 18, dps: 1 },
  { frac: 0.38, hold: 18, shrink: 16, dps: 2 },
  { frac: 0.23, hold: 16, shrink: 14, dps: 4 },
  { frac: 0.12, hold: 13, shrink: 12, dps: 7 },
  { frac: 0.05, hold: 12, shrink: 10, dps: 12 },
  { frac: 0.02, hold: 9999, shrink: 8, dps: 20 },
];

/**
 * The shrinking "storm" zone. A neon wall marks the safe circle; standing
 * outside it deals escalating damage, which forces fights and ends matches.
 * Damages the player and bots, and tells bots where safety is.
 */
class Storm {
  constructor(scene, startRadius) {
    this.center = new THREE.Vector3(0, 0, 0);
    this.startRadius = startRadius;
    this.radius = startRadius;
    this.dps = 1;

    this.phaseIndex = 0;
    this.mode = 'hold';        // 'hold' | 'shrink'
    this.timer = 8;            // initial grace before the first shrink
    this.fromR = startRadius;
    this.toR = startRadius;

    this._buildWall(scene);
  }

  _buildWall(scene) {
    // Open-ended cylinder, rendered from the inside, pulsing neon.
    this.wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 60, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xb14dff, transparent: true, opacity: 0.16, side: THREE.BackSide,
      })
    );
    this.wall.position.y = 30;
    scene.add(this.wall);
  }

  reset(startRadius) {
    this.startRadius = startRadius;
    this.radius = startRadius;
    this.fromR = this.toR = startRadius;
    this.dps = 1;
    this.phaseIndex = 0;
    this.mode = 'hold';
    this.timer = 8;
  }

  // Seconds until the next shrink starts (0 while shrinking).
  get countdown() { return this.mode === 'hold' ? Math.max(0, this.timer) : 0; }
  get shrinking() { return this.mode === 'shrink'; }

  isOutside(pos) {
    const dx = pos.x - this.center.x, dz = pos.z - this.center.z;
    return dx * dx + dz * dz > this.radius * this.radius;
  }

  update(delta, bots, player) {
    this._advance(delta);

    // Apply zone damage.
    for (const b of bots) {
      if (b.alive && this.isOutside(b.position)) b.takeDamage(this.dps * delta, STORM);
    }
    if (player.alive && this.isOutside(player.position)) {
      player.hp -= this.dps * delta;
      player.regenT = 0;        // no regen while the storm is hurting you
      if (player.hp <= 0) { player.hp = 0; player.alive = false; player.lastAttacker = STORM; }
    }

    // Pulse + size the wall.
    const r = Math.max(0.5, this.radius);
    this.wall.scale.set(r, 1, r);
    this.wall.position.set(this.center.x, 30, this.center.z);
    this.wall.material.opacity = 0.12 + 0.06 * (0.5 + 0.5 * Math.sin(this._t = (this._t || 0) + delta * 3));
  }

  _advance(delta) {
    if (this.mode === 'hold') {
      this.timer -= delta;
      if (this.timer <= 0) {
        const p = STORM_PHASES[this.phaseIndex];
        this.fromR = this.radius;
        this.toR = this.startRadius * p.frac;
        this.dps = p.dps;
        this.timer = p.shrink;
        this.mode = 'shrink';
      }
    } else {
      this.timer -= delta;
      const p = STORM_PHASES[this.phaseIndex];
      const t = 1 - Math.max(0, this.timer) / p.shrink;
      this.radius = this.fromR + (this.toR - this.fromR) * t;
      if (this.timer <= 0) {
        this.radius = this.toR;
        this.phaseIndex = Math.min(this.phaseIndex + 1, STORM_PHASES.length - 1);
        this.timer = STORM_PHASES[this.phaseIndex].hold;
        this.mode = 'hold';
      }
    }
  }
}

// Pseudo-combatant credited with storm kills (shows up in the kill feed).
const STORM = { name: 'THE STORM', team: 'storm', isStorm: true };
