/* ============================================================
   abilities.js  —  ability registry + projectiles / effects
   Roster mirrors Bopl Battle's ability set (original code).
   activate(blob, game, aimX, aimY, level): level scales the effect.
   Every ability fires at the match's chosen power (game.abilityLevel).
   ============================================================ */

BB.explode = (game, owner, x, y, R, dmg, force) => {
  BB.Shake.add(12);
  BB.Hit.add(0.06);
  BB.Audio.play("boom");
  game.spawn(BB.makeShock(x, y, R, "#ffb15b"));
  BB.Particles.burst(x, y, "#ff9a3c", 18, 260);
  for (const b of game.blobs) {
    if (b.dead || b.invuln > 0) continue;
    const d = BB.dist(x, y, b.x, b.y);
    if (d < R) {
      const n = BB.Vec.norm((b.x - x) || 0.001, b.y - y - 8);
      const s = 1 - d / R;
      b.hurt(dmg * s + 4, n.x * force * s, -(force * 0.55 * s) - 120, owner);
    }
  }
};

/* ---------------- projectiles / effects ---------------- */
BB.makeRock = (owner, x, y, vx, vy) => ({
  kind: "rock", owner, x, y, vx, vy, r: 11, life: 3,
  update(dt, game) {
    this.vy += 900 * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.life -= dt;
    for (const p of game.arena.platforms)
      if (BB.pointInPlatform(p, this.x, this.y, this.r)) { BB.Particles.burst(this.x, this.y, "#c9a06a", 8, 160); return false; }
    for (const b of game.blobs) {
      if (b === this.owner || b.dead) continue;
      if (BB.dist(this.x, this.y, b.x, b.y) < this.r + b.r) {
        const n = BB.Vec.norm(this.vx, this.vy);
        b.hurt(16, n.x * 340 + 40, n.y * 280 - 140, this.owner);
        BB.Particles.burst(this.x, this.y, "#c9a06a", 12, 200); BB.Shake.add(6); return false;
      }
    }
    return !(this.life <= 0 || this.x < -50 || this.x > game.w + 50 || this.y > game.h + 80);
  },
  draw(ctx) {
    ctx.fillStyle = "#8a6a3f"; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#b08a55"; ctx.beginPath(); ctx.arc(this.x - 3, this.y - 3, this.r * 0.5, 0, Math.PI * 2); ctx.fill();
  },
});

BB.makeArrow = (owner, x, y, vx, vy) => ({
  kind: "arrow", owner, x, y, vx, vy, r: 6, life: 2.2,
  update(dt, game) {
    this.vy += 260 * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.life -= dt;
    for (const p of game.arena.platforms)
      if (BB.pointInPlatform(p, this.x, this.y, this.r)) return false;
    for (const b of game.blobs) {
      if (b === this.owner || b.dead) continue;
      if (BB.dist(this.x, this.y, b.x, b.y) < this.r + b.r) {
        const n = BB.Vec.norm(this.vx, this.vy);
        const sp = Math.hypot(this.vx, this.vy); // charged arrows fly faster → hit harder
        b.hurt(8 + sp * 0.006, n.x * sp * 0.42, n.y * sp * 0.34 - 80, this.owner);
        BB.Particles.burst(this.x, this.y, "#e8e8ff", 8, 160); BB.Shake.add(4); return false;
      }
    }
    return !(this.life <= 0 || this.x < -50 || this.x > game.w + 50 || this.y > game.h + 80);
  },
  draw(ctx) {
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(Math.atan2(this.vy, this.vx));
    ctx.strokeStyle = "#dfe6ff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(8, 0); ctx.stroke();
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(2, -4); ctx.lineTo(2, 4); ctx.fill();
    ctx.restore();
  },
});

BB.makeGrenade = (owner, x, y, vx, vy, level) => ({
  kind: "bomb", owner, x, y, vx, vy, r: 10, fuse: 1.1, level: level || 1,
  update(dt, game) {
    this.vy += 900 * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.fuse -= dt;
    for (const p of game.arena.platforms) if (BB.landOnPlatform(this, p)) this.vx *= 0.6;
    if (this.fuse <= 0) {
      const l = this.level;
      BB.explode(game, this.owner, this.x, this.y, 150 * (1 + 0.2 * (l - 1)), 16 * (1 + 0.12 * (l - 1)), 620 * (1 + 0.1 * (l - 1)));
      return false;
    }
    return this.y < game.h + 100;
  },
  draw(ctx) {
    const p = 0.5 + 0.5 * Math.sin(this.fuse * 24);
    ctx.fillStyle = "#2a2a30"; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,120,60,${p})`; ctx.beginPath(); ctx.arc(this.x, this.y - this.r - 2, 3, 0, Math.PI * 2); ctx.fill();
  },
});

BB.makeGravnade = (owner, x, y, vx, vy, level) => ({
  kind: "gravnade", owner, x, y, vx, vy, r: 9, fuse: 0.9, level: level || 1,
  update(dt, game) {
    this.vy += 700 * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.fuse -= dt;
    for (const p of game.arena.platforms) if (BB.landOnPlatform(this, p)) this.vx *= 0.4;
    if (this.fuse <= 0) { game.spawn(BB.makeBlackhole(this.owner, this.x, this.y, this.level)); BB.Shake.add(10); return false; }
    return true;
  },
  draw(ctx) {
    const pulse = 0.5 + 0.5 * Math.sin(this.fuse * 30);
    ctx.fillStyle = "#7a3cff"; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(200,160,255,${pulse})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 4, 0, Math.PI * 2); ctx.stroke();
  },
});

BB.makeBlackhole = (owner, x, y, level) => {
  const l = level || 1;
  return {
    kind: "blackhole", owner, x, y, r: 26,
    pullR: 190 * (1 + 0.18 * (l - 1)), strength: 1400 * (1 + 0.2 * (l - 1)),
    life: 1.1 + 0.3 * (l - 1), hitCd: 0, dmg: 9 + 2 * (l - 1),
    update(dt, game) {
      this.life -= dt; this.hitCd -= dt;
      for (const b of game.blobs) {
        if (b.dead || b.invuln > 0) continue;
        const d = BB.dist(this.x, this.y, b.x, b.y);
        if (d < this.pullR) {
          const n = BB.Vec.norm(this.x - b.x, this.y - b.y);
          const s = (1 - d / this.pullR) * this.strength;
          b.vx += n.x * s * dt; b.vy += n.y * s * dt;
          if (d < this.r + b.r && this.hitCd <= 0) { b.hurt(this.dmg, n.x * -80, -180, this.owner); this.hitCd = 0.35; }
        }
      }
      // also drag in flying projectiles (Bopl-style)
      for (const pr of game.projectiles) {
        if (pr === this || pr.vx === undefined || pr.vy === undefined) continue;
        const d = BB.dist(this.x, this.y, pr.x, pr.y);
        if (d < this.pullR && d > 1) {
          const n = BB.Vec.norm(this.x - pr.x, this.y - pr.y);
          const s = (1 - d / this.pullR) * this.strength * 0.85;
          pr.vx += n.x * s * dt; pr.vy += n.y * s * dt;
        }
      }
      BB.Particles.list.push({ x: this.x + BB.rand(-this.pullR, this.pullR), y: this.y + BB.rand(-this.pullR, this.pullR), vx: 0, vy: 0, life: 0.3, maxLife: 0.3, r: 2, color: "#b98cff", gravity: 0 });
      return this.life > 0;
    },
    draw(ctx) {
      const a = BB.clamp(this.life, 0, 1);
      const g = ctx.createRadialGradient(this.x, this.y, 2, this.x, this.y, this.pullR);
      g.addColorStop(0, `rgba(40,0,80,${0.7 * a})`); g.addColorStop(0.4, `rgba(120,60,255,${0.25 * a})`); g.addColorStop(1, "rgba(120,60,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(this.x, this.y, this.pullR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0a0016"; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
    },
  };
};

BB.makeMissile = (owner, x, y, vx, vy) => ({
  kind: "missile", owner, x, y, vx, vy, r: 7, life: 2.4, speed: 520,
  update(dt, game) {
    const target = game.blobs.find((b) => b !== this.owner && !b.dead);
    if (target) {
      const des = BB.Vec.norm(target.x - this.x, target.y - this.y);
      const cur = BB.Vec.norm(this.vx, this.vy);
      const k = Math.min(1, 3.2 * dt);
      const nn = BB.Vec.norm(cur.x + (des.x - cur.x) * k, cur.y + (des.y - cur.y) * k);
      this.vx = nn.x * this.speed; this.vy = nn.y * this.speed;
    }
    this.x += this.vx * dt; this.y += this.vy * dt; this.life -= dt;
    BB.Particles.list.push({ x: this.x, y: this.y, vx: 0, vy: 0, life: 0.25, maxLife: 0.25, r: 3, color: "#ffb15b", gravity: 0 });
    for (const p of game.arena.platforms)
      if (BB.pointInPlatform(p, this.x, this.y, this.r)) { BB.explode(game, this.owner, this.x, this.y, 90, 12, 420); return false; }
    for (const b of game.blobs) {
      if (b === this.owner || b.dead) continue;
      if (BB.dist(this.x, this.y, b.x, b.y) < this.r + b.r) { BB.explode(game, this.owner, this.x, this.y, 90, 12, 420); return false; }
    }
    if (this.life <= 0) { BB.explode(game, this.owner, this.x, this.y, 90, 12, 420); return false; }
    return true;
  },
  draw(ctx) {
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(Math.atan2(this.vy, this.vx));
    ctx.fillStyle = "#d0d0d8"; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -5); ctx.lineTo(-6, 5); ctx.fill();
    ctx.restore();
  },
});

BB.makeMeteor = (owner, x, y, level) => ({
  kind: "meteor", owner, x, y, vx: 0, vy: 80, r: 16, level: level || 1,
  _boom(game) { const l = this.level; BB.explode(game, this.owner, this.x, this.y, 140 * (1 + 0.15 * (l - 1)), 20 + 4 * (l - 1), 660); },
  update(dt, game) {
    this.vy += 1800 * dt; this.y += this.vy * dt;
    BB.Particles.list.push({ x: this.x + BB.rand(-6, 6), y: this.y - this.r, vx: 0, vy: -40, life: 0.3, maxLife: 0.3, r: 4, color: "#ff8a3c", gravity: 0 });
    for (const p of game.arena.platforms)
      if (BB.pointInPlatform(p, this.x, this.y, this.r)) { this._boom(game); return false; }
    for (const b of game.blobs) {
      if (b === this.owner || b.dead) continue;
      if (BB.dist(this.x, this.y, b.x, b.y) < this.r + b.r) { this._boom(game); return false; }
    }
    if (this.y > game.h + 80) { this._boom(game); return false; }
    return true;
  },
  draw(ctx) {
    ctx.fillStyle = "#7a3a20"; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff8a3c"; ctx.beginPath(); ctx.arc(this.x - 4, this.y - 4, this.r * 0.5, 0, Math.PI * 2); ctx.fill();
  },
});

BB.makeMine = (owner, x, y, level) => {
  const l = level || 1;
  return {
    kind: "mine", owner, x, y, vx: 0, vy: 0, r: 8, arm: 0.5, life: 8, R: 110 + 30 * (l - 1), dmg: 14 + 4 * (l - 1),
    update(dt, game) {
      this.vy += 900 * dt; this.x += this.vx * dt; this.y += this.vy * dt;
      for (const p of game.arena.platforms) if (BB.landOnPlatform(this, p)) this.vx *= 0.5;
      this.arm -= dt; this.life -= dt;
      if (this.arm <= 0) {
        for (const b of game.blobs) {
          if (b === this.owner || b.dead) continue;
          if (BB.dist(this.x, this.y, b.x, b.y) < this.r + b.r + 30) { BB.explode(game, this.owner, this.x, this.y, this.R, this.dmg, 600); return false; }
        }
      }
      return this.life > 0 && this.y < game.h + 100;
    },
    draw(ctx) {
      const armed = this.arm <= 0;
      const p = armed ? 0.4 + 0.6 * Math.abs(Math.sin(this.life * 6)) : 0.4;
      ctx.fillStyle = "#3a3a44"; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,60,60,${p})`; ctx.beginPath(); ctx.arc(this.x, this.y, 3, 0, Math.PI * 2); ctx.fill();
    },
  };
};

BB.makeTesla = (owner, x, y, level) => {
  const l = level || 1;
  return {
    kind: "tesla", owner, x, y, vx: 0, vy: 0, r: 12, life: 4.5, zapCd: 0.4, range: 240 + 40 * (l - 1), dmg: 8 + 2 * (l - 1),
    update(dt, game) {
      this.vy += 900 * dt; this.x += this.vx * dt; this.y += this.vy * dt;
      for (const p of game.arena.platforms) if (BB.landOnPlatform(this, p)) this.vx *= 0.5;
      this.life -= dt; this.zapCd -= dt;
      if (this.zapCd <= 0) {
        let tgt = null, bd = this.range;
        for (const b of game.blobs) { if (b === this.owner || b.dead) continue; const d = BB.dist(this.x, this.y, b.x, b.y); if (d < bd) { bd = d; tgt = b; } }
        if (tgt) { this.zapCd = 0.5; tgt.hurt(this.dmg, BB.sign(tgt.x - this.x) * 120, -120, this.owner); game.spawn(BB.makeBeam(this.x, this.y, tgt.x, tgt.y, "#8be0ff", 2)); BB.Audio.play("laser"); }
        else this.zapCd = 0.2;
      }
      return this.life > 0;
    },
    draw(ctx) {
      ctx.fillStyle = "#3a5a7a"; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(139,224,255,${0.5 + 0.5 * Math.sin(this.life * 10)})`; ctx.beginPath(); ctx.arc(this.x, this.y - this.r, 3, 0, Math.PI * 2); ctx.fill();
    },
  };
};

BB.makeBlinkOrb = (owner, x, y, vx, vy) => ({
  kind: "blinkorb", owner, x, y, vx, vy, r: 8, t: 0,
  update(dt, game) {
    this.t += dt; this.x += this.vx * dt; this.y += this.vy * dt;
    let stop = this.t > 0.4;
    for (const p of game.arena.platforms)
      if (BB.pointInPlatform(p, this.x, this.y, this.r)) stop = true;
    for (const b of game.blobs)
      if (b !== this.owner && !b.dead && BB.dist(this.x, this.y, b.x, b.y) < this.r + b.r) stop = true;
    if (this.x < 0 || this.x > game.w || this.y > game.h) stop = true;
    if (stop) {
      if (!this.owner.dead) {
        this.owner.x = BB.clamp(this.x, 20, game.w - 20);
        this.owner.y = BB.clamp(this.y, 20, game.h - 20);
        this.owner.vx *= 0.3; this.owner.vy *= 0.3;
        this.owner.invuln = Math.max(this.owner.invuln, 0.25);
        this.owner.frozen = false;
        BB.Particles.burst(this.owner.x, this.owner.y, "#ffd24b", 14, 220);
      }
      return false;
    }
    return true;
  },
  draw(ctx) {
    ctx.fillStyle = "#ffd24b"; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,210,75,0.6)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 3, 0, Math.PI * 2); ctx.stroke();
  },
});


BB.makeBoomerang = (owner, x, y, vx, vy, level) => ({
  kind: "boomerang", owner, x, y, vx, vy, r: 9, t: 0, phase: "out", life: 2.6, spin: 0, level: level || 1, struck: [],
  update(dt, game) {
    this.t += dt; this.life -= dt; this.spin += dt * 20;
    if (this.phase === "out" && this.t > 0.45) this.phase = "back";
    if (this.phase === "back" && !this.owner.dead) {
      const n = BB.Vec.norm(this.owner.x - this.x, this.owner.y - this.y);
      const k = Math.min(1, 6 * dt);
      this.vx = BB.lerp(this.vx, n.x * 620, k); this.vy = BB.lerp(this.vy, n.y * 620, k);
      if (BB.dist(this.x, this.y, this.owner.x, this.owner.y) < this.owner.r + 12) return false;
    }
    this.x += this.vx * dt; this.y += this.vy * dt;
    for (const b of game.blobs) {
      if (b === this.owner || b.dead || this.struck.includes(b)) continue;
      if (BB.dist(this.x, this.y, b.x, b.y) < this.r + b.r) {
        const n = BB.Vec.norm(this.vx, this.vy);
        b.hurt(9, n.x * (360 + 40 * this.level), n.y * 200 - 150, this.owner);
        this.struck.push(b); BB.Shake.add(5);
      }
    }
    return this.life > 0;
  },
  draw(ctx) {
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.spin);
    ctx.strokeStyle = "#ffd24b"; ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-9, -3); ctx.lineTo(2, -9); ctx.moveTo(-9, 3); ctx.lineTo(2, 9); ctx.stroke();
    ctx.restore();
  },
});

BB.makeTrampoline = (owner, x, y, level) => ({
  kind: "trampoline", owner, x, y, vx: 0, vy: 0, r: 11, life: 6 + (level - 1), squish: 0, level: level || 1,
  update(dt, game) {
    this.vy += 900 * dt; this.x += this.vx * dt; this.y += this.vy * dt;
    for (const p of game.arena.platforms) if (BB.landOnPlatform(this, p)) { this.vx *= 0.5; this.vy = 0; }
    this.life -= dt; this.squish = Math.max(0, this.squish - dt * 4);
    for (const b of game.blobs) {
      if (b.dead) continue;
      if (BB.dist(this.x, this.y - 6, b.x, b.y) < this.r + b.r && b.vy > -60) {
        b.vy = -820 - 60 * (this.level - 1); b.jumps = 0; b.frozen = false;
        this.squish = 1; BB.Audio.play("jump");
        BB.Particles.burst(this.x, this.y - this.r, "#4be0c0", 8, 160);
      }
    }
    return this.life > 0;
  },
  draw(ctx) {
    const w = this.r * 2.4, sq = this.squish;
    ctx.fillStyle = "#2f6f66"; BB.roundRect(ctx, this.x - w / 2, this.y - 3 + sq * 4, w, 8, 4); ctx.fill();
    ctx.strokeStyle = "#4be0c0"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(this.x - w / 2, this.y - 3 + sq * 4); ctx.quadraticCurveTo(this.x, this.y - 14 + sq * 12, this.x + w / 2, this.y - 3 + sq * 4); ctx.stroke();
  },
});

BB.makeRipple = (x, y, r0) => ({
  kind: "ripple", owner: null, x, y, r: r0 || 4, life: 1.0, max: 1.0,
  update(dt) { this.r += 150 * dt; this.life -= dt; return this.life > 0; },
  draw(ctx) {
    ctx.globalAlpha = BB.clamp(this.life / this.max, 0, 1) * 0.6;
    ctx.strokeStyle = "#bfe3ff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(this.x, this.y, this.r, this.r * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  },
});

BB.makeShock = (x, y, maxR, color) => ({
  kind: "shock", owner: null, x, y, r: 6, maxR, life: 0.35,
  update(dt) { this.r += (this.maxR - this.r) * Math.min(1, 10 * dt); this.life -= dt; return this.life > 0; },
  draw(ctx) { ctx.globalAlpha = BB.clamp(this.life / 0.35, 0, 1); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; },
});

BB.makeBeam = (x1, y1, x2, y2, color, width) => ({
  kind: "beam", owner: null, x1, y1, x2, y2, color, width, life: 0.14,
  update(dt) { this.life -= dt; return this.life > 0; },
  draw(ctx) {
    ctx.globalAlpha = BB.clamp(this.life / 0.14, 0, 1);
    ctx.strokeStyle = this.color; ctx.lineWidth = this.width;
    ctx.beginPath(); ctx.moveTo(this.x1, this.y1); ctx.lineTo(this.x2, this.y2); ctx.stroke();
    ctx.lineWidth = this.width * 0.4; ctx.strokeStyle = "#ffffff";
    ctx.beginPath(); ctx.moveTo(this.x1, this.y1); ctx.lineTo(this.x2, this.y2); ctx.stroke();
    ctx.globalAlpha = 1;
  },
});

/* Bopl-style Spike: a row of spikes that erupts from the FAR face of the
   platform you're standing on. (dx,dy) is the outward spike direction; the
   base sits on the opposite surface. Rides the island if it drifts, grows in
   quickly, then retracts. Launches any blob it catches. */
BB.makeSpikeWall = (owner, plat, c, dx, dy, level) => {
  const life = 3.2 + 0.5 * (level - 1);
  return {
    kind: "spikewall", owner, plat,
    bx: c.x + dx * (plat ? plat.r : 20), by: c.y + dy * (plat ? plat.r : 20),
    dx, dy, level,
    len: 30 + 6 * (level - 1),   // how far the spikes stick out
    half: 42 + 7 * (level - 1),  // half-width of the row along the surface
    count: 5, age: 0, maxLife: life, life,
    cds: [],
    _reach() {
      const grow = BB.clamp(this.age / 0.13, 0, 1);          // shoot up fast
      const fade = this.life < 0.35 ? BB.clamp(this.life / 0.35, 0, 1) : 1; // retract at the end
      return this.len * grow * fade;
    },
    update(dt, game) {
      if (this.plat) { this.bx += this.plat.mvx || 0; this.by += this.plat.mvy || 0; } // ride the island
      this.age += dt; this.life -= dt;
      for (const e of this.cds) e.t -= dt;
      const reach = this._reach();
      const tx = -this.dy, ty = this.dx;
      for (const b of game.blobs) {
        if (b.dead) continue;
        if (b === this.owner && this.age < 0.18) continue;    // don't nick the caster on spawn
        const rx = b.x - this.bx, ry = b.y - this.by;
        const along = rx * tx + ry * ty;                      // along the surface
        const out = rx * this.dx + ry * this.dy;              // outward from the face
        if (Math.abs(along) < this.half + b.r && out > -b.r && out < reach + b.r) {
          const e = this.cds.find((x) => x.b === b);
          if (e && e.t > 0) continue;                         // per-target re-hit cooldown
          b.hurt(11 + 2 * this.level, this.dx * (430 + 55 * this.level), this.dy * (430 + 55 * this.level) - 130, this.owner);
          b.vx += this.dx * 90; b.vy += this.dy * 90;         // shove clear of the spikes
          if (e) e.t = 0.5; else this.cds.push({ b, t: 0.5 });
          BB.Shake.add(6); BB.Hit.add(0.04);
        }
      }
      return this.life > 0;
    },
    draw(ctx) {
      const reach = this._reach();
      if (reach < 1) return;
      const tx = -this.dy, ty = this.dx, n = this.count;
      ctx.save();
      ctx.fillStyle = "#cdd6e0"; ctx.strokeStyle = "#7f8b99"; ctx.lineWidth = 1.5; ctx.lineJoin = "round";
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;        // -1..1 across the width
        const cx = this.bx + tx * f * this.half, cy = this.by + ty * f * this.half;
        const w = (this.half / n) * 0.85;
        ctx.beginPath();
        ctx.moveTo(cx - tx * w, cy - ty * w);
        ctx.lineTo(cx + this.dx * reach, cy + this.dy * reach);
        ctx.lineTo(cx + tx * w, cy + ty * w);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    },
  };
};

BB.raycastPlatforms = (game, x, y, dx, dy, maxLen) => {
  const step = 6;
  const n = BB.Vec.norm(dx, dy);
  for (let t = 0; t < maxLen; t += step) {
    const px = x + n.x * t, py = y + n.y * t;
    for (const p of game.arena.platforms)
      if (BB.pointInPlatform(p, px, py)) return { x: px, y: py, hit: true };
  }
  return { x: x + n.x * maxLen, y: y + n.y * maxLen, hit: false };
};

BB.fan = (baseAng, count, step) => {
  const out = [];
  for (let i = 0; i < count; i++) out.push(baseAng + (i - (count - 1) / 2) * step);
  return out;
};

/* Aimed "ray" for Shrink / Growth. Works like the Beam: fire along your
   aim and resize the first blob the ray strikes. Aim near yourself to
   target yourself (so Growth can bulk you up), aim at the foe to zap them. */
BB.aimResize = (blob, game, ax, ay, color, apply) => {
  const ang = Math.atan2(ay - blob.y, ax - blob.x);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const selfAim = BB.dist(ax, ay, blob.x, blob.y) < blob.r * 2.0;
  let tgt = null, ex = blob.x, ey = blob.y;
  if (selfAim) {
    tgt = blob;
  } else {
    const hit = BB.raycastPlatforms(game, blob.x, blob.y, dx, dy, 760);
    ex = hit.x; ey = hit.y;
    const endLen = BB.dist(blob.x, blob.y, hit.x, hit.y);
    for (const b of game.blobs) {
      if (b === blob || b.dead) continue;
      const rx = b.x - blob.x, ry = b.y - blob.y;
      const proj = rx * dx + ry * dy;
      if (proj < 0 || proj > endLen + b.r) continue;
      if (Math.abs(rx * dy - ry * dx) < b.r + 10) { tgt = b; ex = b.x; ey = b.y; break; }
    }
    game.spawn(BB.makeBeam(blob.x, blob.y, ex, ey, color, 3));
  }
  if (tgt) { apply(tgt); BB.Particles.burst(ex, ey, color, 16, 180); }
  BB.Audio.play("whoosh");
  return !!tgt;
};

/* ---------------- ability registry (Bopl-aligned) ---------------- */
BB.Abilities = {
  /* --- ranged attacks --- */
  rock: {
    id: "rock", name: "Rock", desc: "Hurl a rock. Big knockback.",
    color: "#c9a06a", cooldown: 0.85, role: "attack", botRange: 520,
    activate(blob, game, ax, ay, lvl) {
      const base = Math.atan2(ay - blob.y, ax - blob.x);
      for (const a of BB.fan(base, lvl, 0.12)) { const dx = Math.cos(a), dy = Math.sin(a); game.spawn(BB.makeRock(blob, blob.x + dx * (blob.r + 12), blob.y + dy * (blob.r + 12), dx * 780, dy * 780 - 60)); }
      blob.recoil(-Math.cos(base) * 60, -Math.sin(base) * 20); BB.Audio.play("shoot");
    },
  },
  bow: {
    id: "bow", name: "Bow", desc: "Hold to draw the bow, release for a faster, harder-hitting arrow.",
    color: "#dfe6ff", cooldown: 0.5, role: "attack", botRange: 640, charge: true, maxCharge: 0.9,
    activate(blob, game, ax, ay, lvl, charge) {
      const c = charge === undefined ? 1 : charge;
      const n = BB.Vec.norm(ax - blob.x, ay - blob.y);
      const sp = 600 + 820 * c;
      game.spawn(BB.makeArrow(blob, blob.x + n.x * (blob.r + 8), blob.y + n.y * (blob.r + 8), n.x * sp, n.y * sp));
      BB.Audio.play("shoot");
    },
  },
  grenade: {
    id: "grenade", name: "Grenade", desc: "Lobbed explosive.",
    color: "#ff7a3c", cooldown: 2.4, role: "attack", botRange: 400,
    activate(blob, game, ax, ay, lvl) { const n = BB.Vec.norm(ax - blob.x, ay - blob.y); game.spawn(BB.makeGrenade(blob, blob.x + n.x * 20, blob.y + n.y * 20, n.x * 560, n.y * 560 - 180, lvl)); BB.Audio.play("shoot"); },
  },
  blackhole: {
    id: "blackhole", name: "Black Hole", desc: "Detonates into a pulling black hole.",
    color: "#7a3cff", cooldown: 5.0, role: "attack", botRange: 460,
    activate(blob, game, ax, ay, lvl) { const n = BB.Vec.norm(ax - blob.x, ay - blob.y); game.spawn(BB.makeGravnade(blob, blob.x + n.x * 20, blob.y + n.y * 20, n.x * 520, n.y * 520 - 160, lvl)); BB.Audio.play("shoot"); },
  },
  missile: {
    id: "missile", name: "Missile", desc: "Homing missile chases the foe.",
    color: "#ff5bb0", cooldown: 3.4, role: "attack", botRange: 720,
    activate(blob, game, ax, ay, lvl) {
      const base = Math.atan2(ay - blob.y, ax - blob.x);
      for (const a of BB.fan(base, lvl, 0.25)) { const dx = Math.cos(a), dy = Math.sin(a); game.spawn(BB.makeMissile(blob, blob.x + dx * 20, blob.y + dy * 20, dx * 420, dy * 420)); }
      BB.Audio.play("shoot");
    },
  },
  beam: {
    id: "beam", name: "Beam", desc: "Instant laser along your aim.",
    color: "#ff4b6b", cooldown: 2.4, role: "attack", botRange: 620,
    activate(blob, game, ax, ay, lvl) {
      const ang = Math.atan2(ay - blob.y, ax - blob.x);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const hit = BB.raycastPlatforms(game, blob.x, blob.y, dx, dy, 900);
      const endLen = BB.dist(blob.x, blob.y, hit.x, hit.y);
      for (const b of game.blobs) {
        if (b === blob || b.dead) continue;
        const rx = b.x - blob.x, ry = b.y - blob.y;
        const proj = rx * dx + ry * dy;
        if (proj < 0 || proj > endLen) continue;
        if (Math.abs(rx * dy - ry * dx) < b.r + 6) b.hurt(16 + 8 * lvl, dx * (260 + 80 * lvl), -160, blob);
      }
      game.spawn(BB.makeBeam(blob.x, blob.y, hit.x, hit.y, "#ff4b6b", 3 + lvl));
      BB.Shake.add(6); BB.Hit.add(0.04); BB.Audio.play("laser");
    },
  },
  meteor: {
    id: "meteor", name: "Meteor", desc: "Call a meteor down onto your aim.",
    color: "#ff8a3c", cooldown: 3.5, role: "attack", botRange: 520,
    activate(blob, game, ax, ay, lvl) { game.spawn(BB.makeMeteor(blob, ax, ay - 360, lvl)); BB.Audio.play("shoot"); },
  },
  mine: {
    id: "mine", name: "Mine", desc: "Drop a proximity mine.",
    color: "#e05b5b", cooldown: 3.2, role: "attack", botRange: 170,
    activate(blob, game, ax, ay, lvl) { game.spawn(BB.makeMine(blob, blob.x, blob.y - 4, lvl)); BB.Audio.play("click"); },
  },
  tesla: {
    id: "tesla", name: "Tesla Coil", desc: "Drop a coil that zaps nearby foes.",
    color: "#8be0ff", cooldown: 5.5, role: "attack", botRange: 360,
    activate(blob, game, ax, ay, lvl) { game.spawn(BB.makeTesla(blob, blob.x, blob.y - 4, lvl)); BB.Audio.play("click"); },
  },
  spike: {
    id: "spike", name: "Spike", desc: "Standing on a platform, sprout a row of spikes from its FAR side — a hazard that launches any blob it catches. (Stand on top → spikes erupt underneath.)",
    color: "#d0d8e0", cooldown: 4.0, role: "attack", botRange: 150,
    canUse: (blob) => !!(blob.grip || blob.gripPlat || blob.onGround),
    activate(blob, game, ax, ay, lvl) {
      const A = game.arena;
      const plats = blob.mirror ? A.mirrorPlatforms : A.platforms;
      let best = null, bestD = Infinity, bc = null;
      for (const p of plats) {
        const c = BB.closestOnSeg(blob.x, blob.y, p.x1, p.y1, p.x2, p.y2);
        const d = BB.dist(blob.x, blob.y, c.x, c.y);
        if (d < bestD) { bestD = d; best = p; bc = c; }
      }
      if (!best) return;
      let nx = blob.x - bc.x, ny = blob.y - bc.y; const nl = Math.hypot(nx, ny) || 1; // outward normal → the blob's side
      nx /= nl; ny /= nl;
      game.spawn(BB.makeSpikeWall(blob, best, bc, -nx, -ny, lvl)); // spikes erupt from the OPPOSITE face
      BB.Shake.add(4); BB.Audio.play("whoosh");
    },
  },

  /* --- movement / melee --- */
  dash: {
    id: "dash", name: "Dash", desc: "Quick burst dash with i-frames.",
    color: "#c9d6f0", cooldown: 1.8, role: "mobility", botRange: 260,
    activate(blob, game, ax, ay, lvl) {
      const n = BB.Vec.norm(ax - blob.x, ay - blob.y); const sp = 900 + 100 * (lvl - 1);
      blob.vx = n.x * sp; blob.vy = n.y * sp - 40; blob.dashing = 0.2; blob.dashDamage = false; blob.invuln = Math.max(blob.invuln, 0.2); blob.frozen = false;
      BB.Particles.burst(blob.x, blob.y, "#c9d6f0", 8, 160); BB.Audio.play("whoosh");
    },
  },
  roll: {
    id: "roll", name: "Roll", desc: "Hold to wind up, release to rocket off as a rolling ball — carries across gaps.",
    color: "#b8c8e8", cooldown: 2.0, role: "attack", botRange: 320, charge: true, maxCharge: 0.7,
    activate(blob, game, ax, ay, lvl, charge) {
      const c = charge === undefined ? 1 : charge;
      const dir = BB.sign(ax - blob.x) || blob.facing || 1;
      const sp = 780 + 820 * c; // full charge ≈ 1600 → very fast (sub-stepping keeps it gripped)
      blob.vx = dir * sp; blob.vy = -30 - 40 * c; blob.rolling = 1.1 + 0.9 * c;
      blob.rollSpeed = sp; blob.rollHand = -dir; // roll clockwise/counter around islands
      blob.dashDamage = true; blob.dashDmg = 12 + 11 * c; blob.dashKnock = 400 + 420 * c; blob.dashLevel = lvl; blob.facing = dir; blob.frozen = false;
      BB.Particles.burst(blob.x, blob.y, "#b8c8e8", 10, 160); BB.Audio.play("whoosh");
    },
  },
  drill: {
    id: "drill", name: "Drill", desc: "From the ground, bore THROUGH islands — steer as you dig. Connecting knocks hard.",
    color: "#b0f0ff", cooldown: 2.4, role: "attack", botRange: 260,
    canUse: (blob) => !!(blob.grip || blob.onGround), // can only start from a surface
    activate(blob, game, ax, ay, lvl) {
      const n = BB.Vec.norm(ax - blob.x, ay - blob.y);
      const sp = 620; // slower than before, but steerable and lasts longer
      blob.drillSpeed = sp;
      blob.vx = n.x * sp; blob.vy = n.y * sp; blob.dashing = 0.75; blob.drilling = 0.75; blob.dashDamage = true; blob.dashDmg = 20; blob.dashKnock = 540; blob.dashLevel = lvl; blob.invuln = Math.max(blob.invuln, 0.4); blob.frozen = false; blob.grip = null;
      BB.Particles.burst(blob.x, blob.y, "#b0f0ff", 10, 160); BB.Audio.play("whoosh");
    },
  },
  grapple: {
    id: "grapple", name: "Grappling Hook", desc: "Latch onto a surface and SWING on the rope as it reels you in.",
    color: "#4be0c0", cooldown: 1.6, role: "mobility", botRange: 999,
    activate(blob, game, ax, ay, lvl) {
      const range = 520 * (1 + 0.1 * (lvl - 1));
      const hit = BB.raycastPlatforms(game, blob.x, blob.y, ax - blob.x, ay - blob.y, range);
      const len = BB.dist(blob.x, blob.y, hit.x, hit.y);
      blob.grapple = { x: hit.x, y: hit.y, len: Math.max(40, len), reel: 240 + 30 * (lvl - 1), t: 1.5 + 0.2 * (lvl - 1) };
      blob.frozen = false;
      BB.Particles.burst(hit.x, hit.y, "#4be0c0", 6, 120); BB.Audio.play("shoot");
    },
  },
  teleport: {
    id: "teleport", name: "Teleport", desc: "Blink a short distance with i-frames.",
    color: "#ffd24b", cooldown: 2.4, role: "mobility", botRange: 260,
    activate(blob, game, ax, ay, lvl) {
      const n = BB.Vec.norm(ax - blob.x, ay - blob.y); const dist = 175 * (1 + 0.15 * (lvl - 1));
      BB.Particles.burst(blob.x, blob.y, "#ffd24b", 14, 220);
      blob.x = BB.clamp(blob.x + n.x * dist, 20, game.w - 20);
      blob.y = BB.clamp(blob.y + n.y * dist, 20, game.h - 20);
      blob.invuln = Math.max(blob.invuln, 0.3); blob.frozen = false;
      BB.Particles.burst(blob.x, blob.y, "#ffd24b", 14, 220); BB.Audio.play("whoosh");
    },
  },
  blinkgun: {
    id: "blinkgun", name: "Blink Gun", desc: "Fire an orb, then teleport to where it lands.",
    color: "#ffe08a", cooldown: 3.0, role: "mobility", botRange: 420,
    activate(blob, game, ax, ay, lvl) { const n = BB.Vec.norm(ax - blob.x, ay - blob.y); game.spawn(BB.makeBlinkOrb(blob, blob.x + n.x * 20, blob.y + n.y * 20, n.x * 700, n.y * 700)); BB.Audio.play("shoot"); },
  },
  platform: {
    id: "platform", name: "Platform", desc: "Conjure a temporary ledge.",
    color: "#4be0c0", cooldown: 3.5, role: "mobility", botRange: 300,
    activate(blob, game, ax, ay, lvl) {
      const len = 150 + 30 * (lvl - 1), r = 20;
      const cx = BB.clamp(ax, 40, game.w - 40);
      const cy = BB.clamp(ay, 60, game.h - 30);
      game.arena.addTemp(cx, cy, len, r, 5.5 + (lvl - 1));
      BB.Particles.burst(cx, cy, "#4be0c0", 10, 120); BB.Audio.play("click");
    },
  },

  /* --- control --- */
  push: {
    id: "push", name: "Push", desc: "Shove everything near you away.",
    color: "#a8ffe0", cooldown: 2.5, role: "control", botRange: 200,
    activate(blob, game, ax, ay, lvl) {
      const range = 150 + 30 * (lvl - 1), force = 560 + 120 * (lvl - 1);
      for (const b of game.blobs) {
        if (b === blob || b.dead) continue;
        const rx = b.x - blob.x, ry = b.y - blob.y; const d = Math.hypot(rx, ry) || 1;
        if (d > range) continue;
        const s = 1 - d / range;
        b.vx += (rx / d) * force * s; b.vy += (ry / d) * force * s - 60;
      }
      game.spawn(BB.makeShock(blob.x, blob.y, range, "#a8ffe0")); BB.Shake.add(4); BB.Audio.play("whoosh");
    },
  },
  gust: {
    id: "gust", name: "Gust", desc: "Blow foes away in a cone. Great ring-out.",
    color: "#a8ffe0", cooldown: 2.2, role: "control", botRange: 180,
    activate(blob, game, ax, ay, lvl) {
      const ang = Math.atan2(ay - blob.y, ax - blob.x);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const range = 150 + 40 * (lvl - 1), force = 520 + 130 * (lvl - 1);
      for (const b of game.blobs) {
        if (b === blob || b.dead) continue;
        const rx = b.x - blob.x, ry = b.y - blob.y; const d = Math.hypot(rx, ry) || 1;
        if (d > range) continue;
        if ((rx * dx + ry * dy) / d < 0.35) continue;
        b.vx += (rx / d) * force; b.vy += (ry / d) * force - 80;
      }
      for (let i = 0; i < 14; i++) { const a = ang + BB.rand(-0.5, 0.5); BB.Particles.list.push({ x: blob.x + Math.cos(a) * 20, y: blob.y + Math.sin(a) * 20, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, life: 0.3, maxLife: 0.3, r: 3, color: "#a8ffe0", gravity: 0 }); }
      BB.Shake.add(3); BB.Audio.play("whoosh");
    },
  },
  timestop: {
    id: "timestop", name: "Time Stop", desc: "Freeze time — everything but you stops dead for a moment.",
    color: "#8be0ff", cooldown: 6.5, role: "control", botRange: 999,
    activate(blob, game, ax, ay, lvl) {
      game.timeFreeze = 1.7 + 0.4 * (lvl - 1);
      game.timeFreezeOwner = blob;
      for (const b of game.blobs) if (b !== blob) BB.Particles.burst(b.x, b.y, "#8be0ff", 16, 160);
      BB.Particles.burst(blob.x, blob.y, "#8be0ff", 20, 220);
      BB.Audio.play("whoosh");
    },
  },
  shrink: {
    id: "shrink", name: "Shrink Ray", desc: "Aimed ray — shrinks whatever blob it hits. Aim at the foe to make them tiny and easy to fling.",
    color: "#ff78c8", cooldown: 6.0, role: "control", botRange: 500,
    activate(blob, game, ax, ay, lvl) { BB.aimResize(blob, game, ax, ay, "#ff78c8", (t) => { t.shrink = Math.max(t.shrink, 4 + (lvl - 1)); }); },
  },

  /* --- defense --- */
  growth: {
    id: "growth", name: "Growth Ray", desc: "Aimed ray — grows & steadies whatever blob it hits. Aim at yourself to bulk up and resist knockback.",
    color: "#ffc45b", cooldown: 7.0, role: "defense", botRange: 0,
    activate(blob, game, ax, ay, lvl) { BB.aimResize(blob, game, ax, ay, "#ffc45b", (t) => { t.grow = Math.max(t.grow, 3.5 + 1.0 * lvl); }); },
  },
  revival: {
    id: "revival", name: "Revival", desc: "Arm a second chance: revive once if killed. (re-arm on cooldown)",
    color: "#5be08a", cooldown: 10.0, role: "defense", botRange: 0,
    activate(blob) { blob.reviveArmed = true; BB.Particles.burst(blob.x, blob.y, "#5be08a", 14, 160); BB.Audio.play("heal"); },
  },

  /* --- new abilities --- */
  boomerang: {
    id: "boomerang", name: "Boomerang", desc: "Throw a boomerang that flies out and curves back.",
    color: "#ffd24b", cooldown: 2.2, role: "attack", botRange: 560,
    activate(blob, game, ax, ay, lvl) { const n = BB.Vec.norm(ax - blob.x, ay - blob.y); game.spawn(BB.makeBoomerang(blob, blob.x + n.x * 20, blob.y + n.y * 20, n.x * 680, n.y * 680, lvl)); BB.Audio.play("shoot"); },
  },
  magnet: {
    id: "magnet", name: "Magnet", desc: "Yank the enemy sharply toward you.",
    color: "#ff9a3c", cooldown: 3.0, role: "control", botRange: 460,
    activate(blob, game, ax, ay, lvl) {
      for (const b of game.blobs) { if (b === blob || b.dead) continue; const n = BB.Vec.norm(blob.x - b.x, blob.y - b.y); const f = 560 + 130 * (lvl - 1); b.vx += n.x * f; b.vy += n.y * f - 60; b.frozen = false; }
      game.spawn(BB.makeShock(blob.x, blob.y, 150, "#ff9a3c")); BB.Audio.play("whoosh");
    },
  },
  freeze: {
    id: "freeze", name: "Freeze", desc: "Freeze the enemy solid — they can't move or act.",
    color: "#bfe3ff", cooldown: 6.0, role: "control", botRange: 520,
    activate(blob, game, ax, ay, lvl) { for (const b of game.blobs) { if (b === blob || b.dead) continue; b.stun = Math.max(b.stun, 1.1 + 0.3 * lvl); BB.Particles.burst(b.x, b.y, "#bfe3ff", 16, 160); } BB.Audio.play("whoosh"); },
  },
  shield: {
    id: "shield", name: "Shield", desc: "Raise a bubble that blocks all knockback for a moment.",
    color: "#8be0ff", cooldown: 6.5, role: "defense", botRange: 0,
    activate(blob, game, ax, ay, lvl) { blob.shield = Math.max(blob.shield, 1.5 + 0.4 * lvl); blob.invuln = Math.max(blob.invuln, 0.2); BB.Particles.burst(blob.x, blob.y, "#8be0ff", 14, 180); BB.Audio.play("heal"); },
  },
  trampoline: {
    id: "trampoline", name: "Trampoline", desc: "Drop a springy pad that bounces blobs high into the air.",
    color: "#4be0c0", cooldown: 4.0, role: "mobility", botRange: 200,
    activate(blob, game, ax, ay, lvl) { game.spawn(BB.makeTrampoline(blob, blob.x, blob.y - 2, lvl)); BB.Audio.play("click"); },
  },
};

/* ---------------- ability symbols ----------------
   Simple monochrome vector glyphs (not emoji) drawn on the canvas, tinted
   with the ability's colour. Centred at (cx,cy) inside a box of size s. */
BB.drawAbilityIcon = (ctx, id, cx, cy, s, color) => {
  const u = s * 0.42; // working radius
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.4, s * 0.1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const circ = (x, y, r, fill) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); fill ? ctx.fill() : ctx.stroke(); };
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const poly = (pts, fill) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); fill ? ctx.fill() : ctx.stroke(); };
  const arc = (r, a0, a1) => { ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke(); };
  const head = (x, y, ang, k) => { ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-k, -k * 0.6); ctx.lineTo(-k, k * 0.6); ctx.closePath(); ctx.fill(); ctx.restore(); };

  switch (id) {
    case "rock": circ(0, u * 0.1, u * 0.85, true); break;
    case "bow":
      arc(u * 0.95, -Math.PI * 0.55, Math.PI * 0.55);      // bow
      line(u * 0.55, -u * 0.8, u * 0.55, u * 0.8);          // string
      line(-u * 0.9, 0, u * 0.6, 0); head(u * 0.95, 0, 0, u * 0.35); // arrow
      break;
    case "grenade": circ(0, u * 0.2, u * 0.7, true); line(u * 0.35, -u * 0.45, u * 0.75, -u * 0.85); break;
    case "blackhole": circ(0, 0, u * 0.9, false); circ(0, 0, u * 0.34, true); break;
    case "missile":
      poly([[u * 0.9, 0], [-u * 0.25, -u * 0.55], [-u * 0.25, u * 0.55]], true);
      line(-u * 0.25, -u * 0.35, -u * 0.85, -u * 0.35); line(-u * 0.25, u * 0.35, -u * 0.85, u * 0.35);
      break;
    case "beam": line(-u * 0.95, -u * 0.2, u * 0.95, -u * 0.2); line(-u * 0.95, u * 0.2, u * 0.95, u * 0.2); break;
    case "meteor":
      circ(u * 0.4, -u * 0.4, u * 0.48, true);
      line(-u * 0.1, u * 0.05, -u * 0.85, u * 0.8); line(-u * 0.45, -u * 0.15, -u * 0.9, u * 0.35); line(0.15 * u, u * 0.35, -u * 0.4, u * 0.95);
      break;
    case "mine":
      circ(0, 0, u * 0.5, false);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line(Math.cos(a) * u * 0.55, Math.sin(a) * u * 0.55, Math.cos(a) * u * 0.95, Math.sin(a) * u * 0.95); }
      break;
    case "tesla": ctx.beginPath(); ctx.moveTo(u * 0.25, -u * 0.9); ctx.lineTo(-u * 0.3, -u * 0.05); ctx.lineTo(u * 0.12, -u * 0.05); ctx.lineTo(-u * 0.25, u * 0.9); ctx.stroke(); break;
    case "spike":
      line(-u * 0.9, u * 0.55, u * 0.9, u * 0.55); // ground line
      for (const bx of [-u * 0.6, -u * 0.2, u * 0.2, u * 0.6]) poly([[bx - u * 0.18, u * 0.55], [bx, -u * 0.45], [bx + u * 0.18, u * 0.55]], true);
      break;
    case "dash": for (const dx of [-u * 0.7, -u * 0.1, u * 0.5]) { ctx.beginPath(); ctx.moveTo(dx, -u * 0.55); ctx.lineTo(dx + u * 0.38, 0); ctx.lineTo(dx, u * 0.55); ctx.stroke(); } break;
    case "roll": arc(u * 0.72, Math.PI * 0.85, Math.PI * 2.25); { const ea = Math.PI * 2.25; head(Math.cos(ea) * u * 0.72, Math.sin(ea) * u * 0.72, ea + Math.PI / 2, u * 0.3); } break;
    case "drill":
      poly([[-u * 0.55, -u * 0.75], [u * 0.55, -u * 0.75], [0, u * 0.95]], false);
      line(-u * 0.4, -u * 0.4, u * 0.4, -u * 0.4); line(-u * 0.25, -u * 0.05, u * 0.25, -u * 0.05);
      break;
    case "grapple": line(0, -u * 0.9, 0, u * 0.15); arc(u * 0.32, -Math.PI * 0.1, Math.PI * 1.15); ctx.beginPath(); ctx.arc(0, u * 0.15, u * 0.32, -Math.PI * 0.1, Math.PI * 1.15); ctx.stroke(); break;
    case "teleport": arc(u * 0.85, Math.PI * 0.2, Math.PI * 1.55); ctx.beginPath(); ctx.arc(0, 0, u * 0.45, Math.PI * 0.7, Math.PI * 2.0); ctx.stroke(); circ(0, 0, u * 0.13, true); break;
    case "blinkgun": line(-u * 0.9, 0, u * 0.15, 0); head(u * 0.15, 0, 0, u * 0.28); circ(u * 0.62, 0, u * 0.28, true); break;
    case "platform": ctx.save(); ctx.lineWidth = s * 0.22; ctx.lineCap = "round"; line(-u * 0.8, u * 0.15, u * 0.8, u * 0.15); ctx.restore(); break;
    case "push": for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) { const dx = Math.cos(a), dy = Math.sin(a); line(dx * u * 0.2, dy * u * 0.2, dx * u * 0.68, dy * u * 0.68); head(dx * u * 0.92, dy * u * 0.92, a, u * 0.3); } break;
    case "gust": for (const yy of [-u * 0.5, 0, u * 0.5]) { ctx.beginPath(); ctx.moveTo(-u * 0.9, yy); ctx.quadraticCurveTo(u * 0.2, yy - u * 0.35, u * 0.9, yy); ctx.stroke(); } break;
    case "timestop": circ(0, 0, u * 0.85, false); line(0, 0, 0, -u * 0.55); line(0, 0, u * 0.45, u * 0.12); break;
    case "shrink":
      line(-u * 0.95, 0, -u * 0.35, 0); poly([[-u * 0.2, 0], [-u * 0.55, -u * 0.3], [-u * 0.55, u * 0.3]], true);
      line(u * 0.95, 0, u * 0.35, 0); poly([[u * 0.2, 0], [u * 0.55, -u * 0.3], [u * 0.55, u * 0.3]], true);
      break;
    case "growth":
      line(-u * 0.35, 0, -u * 0.95, 0); poly([[-u * 0.95, 0], [-u * 0.6, -u * 0.3], [-u * 0.6, u * 0.3]], true);
      line(u * 0.35, 0, u * 0.95, 0); poly([[u * 0.95, 0], [u * 0.6, -u * 0.3], [u * 0.6, u * 0.3]], true);
      break;
    case "revival": ctx.save(); ctx.lineWidth = s * 0.16; line(0, -u * 0.85, 0, u * 0.85); line(-u * 0.85, 0, u * 0.85, 0); ctx.restore(); break;
    case "boomerang": ctx.beginPath(); ctx.moveTo(-u * 0.2, -u * 0.8); ctx.lineTo(u * 0.7, u * 0.1); ctx.lineTo(-u * 0.2, u * 0.35); ctx.stroke(); break;
    case "magnet":
      arc(u * 0.6, Math.PI * 0.15, Math.PI * 0.85);
      line(-u * 0.6, u * 0.35, -u * 0.6, u * 0.85); line(u * 0.6, u * 0.35, u * 0.6, u * 0.85);
      break;
    case "freeze": for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; line(-Math.cos(a) * u * 0.9, -Math.sin(a) * u * 0.9, Math.cos(a) * u * 0.9, Math.sin(a) * u * 0.9); } break;
    case "shield": poly([[0, -u * 0.85], [u * 0.75, -u * 0.4], [u * 0.55, u * 0.75], [0, u * 0.95], [-u * 0.55, u * 0.75], [-u * 0.75, -u * 0.4]], false); break;
    case "trampoline": ctx.save(); ctx.lineWidth = s * 0.12; arc(u * 0.8, Math.PI * 1.15, Math.PI * 1.85); ctx.restore(); line(-u * 0.55, u * 0.35, -u * 0.55, u * 0.85); line(u * 0.55, u * 0.35, u * 0.55, u * 0.85); break;
    default: circ(0, 0, u * 0.6, false);
  }
  ctx.restore();
};

BB.ABILITY_IDS = Object.keys(BB.Abilities);

/* one-click starter combos for the loadout screen */
BB.LOADOUT_PRESETS = [
  { name: "Artillery", ids: ["rock", "grenade", "meteor"] },
  { name: "Sniper", ids: ["bow", "beam", "missile"] },
  { name: "Brawler", ids: ["roll", "drill", "spike"] },
  { name: "Trickster", ids: ["dash", "teleport", "blinkgun"] },
  { name: "Zoner", ids: ["mine", "tesla", "timestop"] },
  { name: "Tank", ids: ["growth", "revival", "push"] },
];
