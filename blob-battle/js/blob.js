/* ============================================================
   blob.js  —  the round fighter. Shared by player and bot.
   Game-feel: variable jump height, jump buffer, asymmetric
   gravity, momentum-preserving air control.
   ============================================================ */

const JUMP_V = 600;
const MAX_SPEED = 320;
const ACCEL_GROUND = 3000;
const ACCEL_AIR = 1700;
const GRAV_UP = 1400;
const GRAV_DOWN = 1950;
const AIR_DRAG = 0.2;
const JUMP_BUFFER = 0.12;
const MAX_JUMPS = 2;

BB.Blob = class {
  constructor(game, opts) {
    this.game = game;
    this.color = opts.color;
    this.name = opts.name;
    this.isBot = !!opts.isBot;
    this.baseR = 16; // small, soft blob
    this.abilities = opts.abilities.slice();
    this.roundWins = 0;
    this.reset(opts.spawn);
  }

  reset(spawn) {
    this.x = spawn.x;
    this.y = spawn.y;
    this.vx = 0;
    this.vy = 0;
    this.frozen = true; // hover at spawn — you don't fall until you move
    this.hp = 100;
    this.maxHp = 100;
    this.dead = false;
    this.onGround = false;
    this.jumps = 0;
    this.jumpBuffer = 0;
    this.jumpCut = false;
    this.jumpHeld = false;
    this.facing = 1;
    this.invuln = 0;
    this.shieldFx = 0;
    this.dashing = 0;
    this.dashLevel = 1;
    this.dashDamage = false; // Roll/Drill deal contact damage; plain Dash does not
    this.dashDmg = 22;
    this.dashKnock = 520;
    this.slow = 0;
    this.grow = 0;
    this.growLevel = 1;
    this.shrink = 0;
    this.spikeTime = 0;
    this._spikeCd = 0;
    this.reviveArmed = false;
    this.grapple = null;
    this.hitFlash = 0;
    this.healFx = 0;
    this.r = this.baseR;
    // team colour, nudged slightly toward the average colour of your kit
    this.bodyColor = this.abilities.length
      ? BB.mixHex(this.color, BB.avgHex(this.abilities.map((id) => BB.Abilities[id].color)), 0.28)
      : this.color;
    this.cooldowns = {};
    for (const id of this.abilities) this.cooldowns[id] = 0;
    this.squash = 0;
    this._wasAir = false;
  }

  // all abilities fire at the match's chosen power level (menu "Ability power" mode)
  level(id) { return this.game.abilityLevel || BB.ABILITY_LEVEL; }

  hurt(dmg, kx, ky, source) {
    if (this.dead || this.invuln > 0) return;
    if (this.grow > 0) { kx *= 0.5; ky *= 0.5; }      // heavier: resists knockback
    if (this.shrink > 0) { kx *= 1.6; ky *= 1.6; }    // lighter: flies further
    this.hp -= dmg;
    this.vx += kx;
    this.vy += ky;
    this.invuln = 0.25;
    this.hitFlash = 0.15;
    this.lastHitBy = source;
    BB.Particles.burst(this.x, this.y, this.color, 10, 180);
    BB.Audio.play("hit");
    if (this.hp <= 0) this.die("hp");
  }

  heal(amt) {
    if (this.dead) return;
    this.hp = Math.min(this.maxHp, this.hp + amt);
    this.healFx = 0.6;
    BB.Particles.burst(this.x, this.y, "#5be08a", 12, 140, { gravity: -60, life: 0.6 });
  }

  recoil(kx, ky) { this.vx += kx; this.vy += ky; }

  die(cause) {
    if (this.dead) return;
    // Revival: if armed, come back once instead of dying
    if (this.reviveArmed) {
      this.reviveArmed = false;
      this.hp = 45;
      this.invuln = 1.2;
      // reposition onto the nearest platform so a void death doesn't repeat
      let best = null, bd = 1e9;
      for (const p of this.game.arena.platforms) {
        const px = BB.clamp(this.x, Math.min(p.x1, p.x2), Math.max(p.x1, p.x2));
        const top = Math.min(p.y1, p.y2) - p.r;
        const d = BB.dist(this.x, this.y, px, top);
        if (d < bd) { bd = d; best = { x: px, y: top - this.r - 4 }; }
      }
      if (best) { this.x = best.x; this.y = best.y; }
      this.vx = 0; this.vy = 0;
      BB.Particles.burst(this.x, this.y, "#5be08a", 30, 260, { life: 0.7 });
      BB.Audio.play("heal");
      return;
    }
    this.dead = true;
    this.deathCause = cause;
    BB.Particles.burst(this.x, this.y, this.color, 40, 320, { life: 0.8 });
    BB.Shake.add(14);
    BB.Hit.add(0.08);
    BB.Audio.play("death");
  }

  timeScale() { return this.slow > 0 ? 0.4 : 1; }

  control(moveDir, wantJump, jumpHeld) {
    const ts = this.timeScale();
    const accel = (this.onGround ? ACCEL_GROUND : ACCEL_AIR) * ts;
    const target = moveDir * MAX_SPEED;
    const dt = this.game.dt;
    if (moveDir !== 0) {
      if (!(BB.sign(this.vx) === BB.sign(target) && Math.abs(this.vx) > MAX_SPEED)) {
        this.vx = BB.approach(this.vx, target, accel * dt);
      }
      this.facing = BB.sign(moveDir);
    } else if (this.onGround) {
      this.vx = BB.approach(this.vx, 0, accel * dt);
    }
    if (moveDir !== 0 || wantJump) this.frozen = false; // acting on purpose = fair game for gravity
    if (wantJump) this.jumpBuffer = JUMP_BUFFER;
    this.jumpHeld = !!jumpHeld;
  }

  tryAbility(index, aimX, aimY) {
    const id = this.abilities[index];
    if (!id) return;
    if ((this.cooldowns[id] || 0) > 0) return;
    const ab = BB.Abilities[id];
    const lvl = this.level(id);
    ab.activate(this, this.game, aimX, aimY, lvl);
    this.cooldowns[id] = ab.cooldown * Math.max(0.55, 1 - 0.07 * (lvl - 1));
  }

  update(dt) {
    if (this.dead) return;
    const ts = this.timeScale();

    // spawn-hover ends the instant you actually move (walk, jump, dash, knockback…)
    if (this.frozen && (Math.abs(this.vx) > 6 || Math.abs(this.vy) > 6)) this.frozen = false;

    this.invuln = Math.max(0, this.invuln - dt);
    this.shieldFx = Math.max(0, this.shieldFx - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.healFx = Math.max(0, this.healFx - dt);
    this.dashing = Math.max(0, this.dashing - dt);
    this.slow = Math.max(0, this.slow - dt);
    this.grow = Math.max(0, this.grow - dt);
    this.shrink = Math.max(0, this.shrink - dt);
    this.spikeTime = Math.max(0, this.spikeTime - dt);
    this._spikeCd = Math.max(0, this._spikeCd - dt);
    this.squash = BB.approach(this.squash, 0, dt * 3);
    for (const id in this.cooldowns) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);

    // size
    let scale = 1;
    if (this.grow > 0) scale = 1.4;
    else if (this.shrink > 0) scale = 0.62;
    this.r = this.baseR * scale;

    // jump
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.jumps < MAX_JUMPS) {
      this.vy = -JUMP_V;
      this.jumps++;
      this.jumpBuffer = 0;
      this.jumpCut = true;
      this.onGround = false;
      this.squash = -0.5;
      BB.Particles.burst(this.x, this.y + this.r, "#ffffff", 6, 120, { gravity: 200, vy: 40 });
      BB.Audio.play("jump");
    }
    if (this.jumpCut && !this.jumpHeld && this.vy < -160) { this.vy *= 0.5; this.jumpCut = false; }
    if (this.vy >= 0) this.jumpCut = false;

    // grapple pull
    if (this.grapple) {
      this.grapple.t -= dt;
      const d = BB.dist(this.x, this.y, this.grapple.x, this.grapple.y);
      if (this.grapple.t <= 0 || d < 40) {
        this.grapple = null;
      } else {
        const n = BB.Vec.norm(this.grapple.x - this.x, this.grapple.y - this.y);
        const power = this.grapple.power || 1900;
        this.vx += n.x * power * dt;
        this.vy += n.y * power * dt;
        this.vx *= 0.9;
      }
    }

    // gravity — suspended while frozen, so you hover at spawn until you move
    if (this.dashing <= 0 && !this.frozen) {
      const g = this.vy > 0 ? GRAV_DOWN : GRAV_UP;
      this.vy += g * dt * ts;
    }
    this.vy = BB.clamp(this.vy, -900, 1100);
    if (this.dashing <= 0 && !this.grapple && !this.onGround) this.vx *= 1 - AIR_DRAG * dt;

    // integrate
    this.x += this.vx * dt * ts;
    this.y += this.vy * dt * ts;

    // collide
    this.onGround = false;
    for (const p of this.game.arena.platforms) this.collidePlatform(p);

    // Roll/Drill contact hit
    if (this.dashing > 0 && this.dashDamage) {
      for (const b of this.game.blobs) {
        if (b === this || b.dead) continue;
        if (BB.dist(this.x, this.y, b.x, b.y) < this.r + b.r + 4) {
          const n = BB.Vec.norm(b.x - this.x, b.y - this.y);
          const lv = this.dashLevel || 1;
          b.hurt(this.dashDmg + 4 * (lv - 1), n.x * (this.dashKnock + 70 * (lv - 1)), -240, this);
          this.dashing = 0;
          this.vx *= -0.3;
          BB.Shake.add(10);
          BB.Hit.add(0.07);
        }
      }
    }

    // Spike contact damage (spikes out)
    if (this.spikeTime > 0 && this._spikeCd <= 0) {
      for (const b of this.game.blobs) {
        if (b === this || b.dead) continue;
        if (BB.dist(this.x, this.y, b.x, b.y) < this.r + b.r + 8) {
          const n = BB.Vec.norm(b.x - this.x, b.y - this.y);
          b.hurt(14, n.x * 460, -220, this);
          this._spikeCd = 0.35;
          BB.Shake.add(6);
        }
      }
    }

    // void death
    if (this.y - this.r > this.game.h + 40) this.die("fall");

    // land juice
    if (this.onGround && this.vy >= 0 && this._wasAir) {
      this.squash = 0.5;
      BB.Particles.burst(this.x, this.y + this.r, "#ffffff", 5, 90, { gravity: 200, vy: 20 });
      if (Math.abs(this.vx) > 60 || this._wasAir) BB.Audio.play("land");
    }
    this._wasAir = !this.onGround;
  }

  collidePlatform(p) {
    // circle (blob) vs capsule (island): resolve against closest point on the segment
    const c = BB.closestOnSeg(this.x, this.y, p.x1, p.y1, p.x2, p.y2);
    const dx = this.x - c.x;
    const dy = this.y - c.y;
    const rr = this.r + p.r;
    const d2 = dx * dx + dy * dy;
    if (d2 > rr * rr) return;
    const d = Math.sqrt(d2) || 0.0001;
    const nx = dx / d;
    const ny = dy / d;
    const overlap = rr - d;
    this.x += nx * overlap;
    this.y += ny * overlap;
    const vn = this.vx * nx + this.vy * ny;
    if (vn < 0) { this.vx -= vn * nx; this.vy -= vn * ny; }
    if (ny < -0.5) { this.onGround = true; this.jumps = 0; this.vy = Math.min(this.vy, 0); }
  }

  draw(ctx) {
    if (this.dead) return;
    const flashing = this.hitFlash > 0 && Math.floor(this.hitFlash * 40) % 2 === 0;
    const sq = this.squash;

    // spikes
    if (this.spikeTime > 0) {
      ctx.fillStyle = "#d0d8e0";
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + this.game.time * 2;
        const c = Math.cos(a), s = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(this.x + c * this.r, this.y + s * this.r);
        ctx.lineTo(this.x + c * (this.r + 10), this.y + s * (this.r + 10));
        ctx.lineTo(this.x + Math.cos(a + 0.25) * this.r, this.y + Math.sin(a + 0.25) * this.r);
        ctx.fill();
      }
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(1 - sq * 0.4, 1 + sq * 0.4);
    if (this.slow > 0) { ctx.strokeStyle = "rgba(139,224,255,0.7)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, this.r + 4, 0, Math.PI * 2); ctx.stroke(); }
    if (this.grow > 0) { ctx.strokeStyle = "rgba(255,200,90,0.8)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, this.r + 3, 0, Math.PI * 2); ctx.stroke(); }
    if (this.shrink > 0) { ctx.strokeStyle = "rgba(255,120,200,0.8)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, this.r + 3, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = flashing ? "#ffffff" : this.healFx > 0 ? "#7dffb0" : (this.bodyColor || this.color);
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath(); ctx.arc(-this.r * 0.35, -this.r * 0.35, this.r * 0.4, 0, Math.PI * 2); ctx.fill();
    const ex = this.facing * 5;
    ctx.fillStyle = "#0d1020";
    ctx.beginPath();
    ctx.arc(ex - 5, -3, 3.2, 0, Math.PI * 2);
    ctx.arc(ex + 5, -3, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (this.grapple) {
      ctx.strokeStyle = "#4be0c0"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.grapple.x, this.grapple.y); ctx.stroke();
    }
    if (this.reviveArmed) {
      ctx.strokeStyle = `rgba(91,224,138,${0.5 + 0.4 * Math.sin(this.game.time * 8)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 10, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.invuln > 0) {
      ctx.strokeStyle = `rgba(91,184,255,${0.4 + 0.4 * Math.sin(this.game.time * 20)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 7, 0, Math.PI * 2); ctx.stroke();
    }

    const bw = 46;
    const bx = this.x - bw / 2;
    const by = this.y - this.r - 16;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    BB.roundRect(ctx, bx, by, bw, 6, 3); ctx.fill();
    ctx.fillStyle = this.hp > 40 ? "#5be08a" : "#ff5b5b";
    BB.roundRect(ctx, bx, by, bw * BB.clamp(this.hp / this.maxHp, 0, 1), 6, 3); ctx.fill();
  }
};
