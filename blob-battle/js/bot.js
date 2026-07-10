/* ============================================================
   bot.js  —  the AI opponent. Drives a Blob with the same
   controls the player has. Re-classifies its loadout each frame
   (roles), so it uses whatever it drafts.
   ============================================================ */

BB.DIFFICULTY = {
  easy:   { react: 0.34, aimErr: 0.20, dodge: 0.35, aggro: 0.5,  spacing: 300 },
  normal: { react: 0.18, aimErr: 0.10, dodge: 0.6,  aggro: 0.75, spacing: 260 },
  hard:   { react: 0.08, aimErr: 0.035, dodge: 0.92, aggro: 0.95, spacing: 240 },
};

BB.Bot = class {
  constructor(blob, target, game, difficulty) {
    this.blob = blob;
    this.target = target;
    this.game = game;
    this.d = BB.DIFFICULTY[difficulty] || BB.DIFFICULTY.normal;
    this.reactTimer = 0;
    this.aim = { x: target.x, y: target.y };
    this.strafeDir = 1;
    this.strafeTimer = 0;
    this.jumpHold = 0;
  }

  classify() {
    this.attackAbs = [];
    this.mobilityAbs = [];
    this.defenseAbs = [];
    this.blob.abilities.forEach((id, i) => {
      const role = BB.Abilities[id].role;
      if (role === "attack" || role === "control") this.attackAbs.push(i);
      else if (role === "mobility") this.mobilityAbs.push(i);
      else if (role === "defense") this.defenseAbs.push(i);
    });
  }

  groundNear(x, y) {
    for (const p of this.game.arena.platforms) {
      const left = Math.min(p.x1, p.x2) - p.r, right = Math.max(p.x1, p.x2) + p.r;
      const top = Math.min(p.y1, p.y2) - p.r;
      if (x > left - 6 && x < right + 6 && top > y - 30 && top < y + 220) return true;
    }
    return false;
  }

  nearestPlatformPoint() {
    let best = null, bd = Infinity;
    for (const p of this.game.arena.platforms) {
      const px = BB.clamp(this.blob.x, Math.min(p.x1, p.x2), Math.max(p.x1, p.x2));
      const top = Math.min(p.y1, p.y2) - p.r;
      const d = BB.dist(this.blob.x, this.blob.y, px, top);
      if (d < bd) { bd = d; best = { x: px, y: top - 20 }; }
    }
    return best;
  }

  incomingThreat() {
    for (const pr of this.game.projectiles) {
      if (pr.owner === this.blob) continue;
      if (!["rock", "arrow", "bomb", "gravnade", "missile", "meteor"].includes(pr.kind)) continue;
      const d = BB.dist(pr.x, pr.y, this.blob.x, this.blob.y);
      const closing = (pr.x - this.blob.x) * pr.vx + (pr.y - this.blob.y) * pr.vy < 0;
      if (d < 160 && closing) return pr;
    }
    return null;
  }

  chooseReady(list) {
    for (const i of list) {
      const id = this.blob.abilities[i];
      if ((this.blob.cooldowns[id] || 0) <= 0) return i;
    }
    return -1;
  }

  meleeOnly() {
    return (
      this.attackAbs.length > 0 &&
      this.attackAbs.every((i) => BB.Abilities[this.blob.abilities[i]].botRange < 240)
    );
  }

  update(dt) {
    const b = this.blob;
    const t = this.target;
    if (b.dead) return;
    this.classify();

    this.reactTimer -= dt;
    this.strafeTimer -= dt;
    if (this.jumpHold > 0) this.jumpHold -= dt;

    const dx = t.x - b.x;
    const dy = t.y - b.y;
    const dist = Math.hypot(dx, dy);

    // refresh aim on a reaction cadence (lead the target)
    if (this.reactTimer <= 0) {
      this.reactTimer = this.d.react;
      const travel = BB.clamp(dist / 780, 0, 0.5);
      const err = this.d.aimErr * dist;
      this.aim = {
        x: t.x + t.vx * travel + BB.rand(-err, err),
        y: t.y + t.vy * travel - 40 + BB.rand(-err, err),
      };
    }

    let moveDir = 0;
    let wantJump = false;
    const noGround = this.game.arena.platforms.length === 0; // open-void map: don't walk off into nothing

    if (!noGround) {
    // 1) recovery: falling with no ground below -> head for a platform
    const belowGround = this.groundNear(b.x, b.y);
    if (!belowGround && b.vy > 60) {
      const pt = this.nearestPlatformPoint();
      if (pt) {
        moveDir = BB.sign(pt.x - b.x);
        const mi = this.chooseReady(this.mobilityAbs);
        if (mi >= 0 && (b.y > this.game.h * 0.72 || !this.groundNear(b.x, b.y + 60))) {
          const id = b.abilities[mi];
          if (id === "trampoline") b.tryAbility(mi, b.x, b.y + 60);
          else b.tryAbility(mi, pt.x, pt.y - 40);
        }
      }
    } else {
      // 2) combat spacing
      const preferred = this.meleeOnly() ? 40 : this.attackAbs.length ? this.d.spacing : 120;
      if (this.meleeOnly()) {
        moveDir = BB.sign(dx);
      } else if (dist > preferred + 40) {
        moveDir = BB.sign(dx);
      } else if (dist < preferred - 60) {
        moveDir = -BB.sign(dx);
      } else {
        if (this.strafeTimer <= 0) { this.strafeTimer = BB.rand(0.6, 1.3); this.strafeDir *= -1; }
        moveDir = this.strafeDir;
      }
    }

    // edge safety: don't stroll into a gap unless hopping toward the enemy
    if (b.onGround && moveDir !== 0) {
      if (!this.groundNear(b.x + moveDir * 46, b.y)) {
        if (BB.sign(dx) === moveDir && Math.abs(dx) < 260) wantJump = true;
        else moveDir = 0;
      }
    }

    // jump to chase a higher target
    if (dy < -70 && (b.onGround || b.jumps < 2) && this.jumpHold <= 0 && Math.random() < 0.6) {
      wantJump = true;
      this.jumpHold = 0.5;
    }
    } // end grounded movement (skipped on the open-void map — just hover & shoot)

    // 3) dodging
    const threat = this.incomingThreat();
    if (threat && Math.random() < this.d.dodge) {
      const di = this.chooseReady(this.defenseAbs);
      const bi = this.chooseReady(this.mobilityAbs);
      if (di >= 0) {
        b.tryAbility(di, b.x, b.y);
      } else if (bi >= 0 && BB.Abilities[b.abilities[bi]].id === "blink") {
        b.tryAbility(bi, b.x - BB.sign(threat.vx) * 200, b.y - 60);
      } else if (!noGround && b.onGround && this.jumpHold <= 0) {
        wantJump = true;
        this.jumpHold = 0.4;
      }
    }

    // 4) offense: pick an attack whose range fits the distance
    if (dist < 720 && Math.random() < this.d.aggro) {
      let bestI = -1;
      for (const i of this.attackAbs) {
        const id = b.abilities[i];
        if ((b.cooldowns[id] || 0) > 0) continue;
        const range = BB.Abilities[id].botRange;
        if (dist <= range + 60) {
          bestI = i;
          if (Math.abs(range - dist) < 180) break;
        }
      }
      if (bestI >= 0) b.tryAbility(bestI, this.aim.x, this.aim.y);
    }

    // defensive ability when pressured near the edge
    if (dist < 240 && !this.groundNear(b.x + BB.sign(b.x - t.x) * 60, b.y)) {
      const di = this.chooseReady(this.defenseAbs);
      if (di >= 0 && Math.random() < 0.05) b.tryAbility(di, b.x, b.y);
    }

    b.control(moveDir, wantJump, true); // bot uses full-height jumps
  }
};
