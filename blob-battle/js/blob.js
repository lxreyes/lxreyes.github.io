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
const GRIP_G = 4600; // "gravity" toward the island surface you're walking on (Bopl-style)
const WATER_DEATH_DEPTH = 44;   // before match point, sink past this and you drown

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
    this._inWater = false;
    this.mirror = false; // below the waterline once the mirror portal is open (at match point)
    this.dead = false;
    this.percent = 0; // Smash-style damage: higher % = you fly further
    this.oob = 0;     // time spent past a side barrier (grace before ring-out)
    this.onGround = false;
    this.grip = null;   // {nx,ny}: surface normal of the island you're walking on (Bopl surface-walk)
    this.gripCd = 0;    // brief no-grip window after jumping off a surface
    this.gripPlat = null; // the platform you're riding, so drifting islands carry you
    this.jumps = 0;
    this.jumpBuffer = 0;
    this.jumpCut = false;
    this.jumpHeld = false;
    this.facing = 1;
    this.invuln = 0;
    this.shieldFx = 0;
    this.dashing = 0;
    this.drilling = 0; // drilling through terrain (ignores platform collision)
    this.rolling = 0;  // Bopl-style roll: a momentum ball you steer
    this.rollSpeed = 0; this.rollHand = -1; // roll follows surfaces at this speed / handedness
    this._wasRolling = false; // detect the frame the roll ends (so we can shed its speed)
    this.drillSpeed = 0;
    this.dashLevel = 1;
    this.dashDamage = false; // Roll/Drill deal contact damage; plain Dash does not
    this.dashDmg = 22;
    this.dashKnock = 520;
    this.slow = 0;
    this.grow = 0;
    this.growLevel = 1;
    this.shrink = 0;
    this.shield = 0; // blocks all knockback while > 0
    this.stun = 0;   // frozen: can't move or act
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
    this.animT = BB.rand(0, 10);           // desync the two blobs' idle cycles
    this.blink = 0;
    this.blinkTimer = BB.rand(1.5, 4);
    this.wobblePhase = BB.rand(0, Math.PI * 2);
  }

  // all abilities fire at the match's chosen power level (menu "Ability power" mode)
  level(id) { return this.game.abilityLevel || BB.ABILITY_LEVEL; }

  // Smash-style: no instant death — damage raises your % and every hit launches
  // you further the higher your % is. Ring-out is still the only way to die.
  hurt(dmg, kx, ky, source) {
    if (this.dead || this.invuln > 0) return;
    if (this.shield > 0) { this.hitFlash = 0.1; BB.Particles.burst(this.x, this.y, "#8be0ff", 8, 140); BB.Audio.play("hit"); return; }
    this.percent = Math.min(9999, this.percent + dmg);
    const kb = 1 + this.percent * 0.014;              // knockback grows with damage
    if (this.grow > 0) { kx *= 0.5; ky *= 0.5; }      // heavier: resists knockback
    if (this.shrink > 0) { kx *= 1.6; ky *= 1.6; }    // lighter: flies further
    this.vx += kx * kb;
    this.vy += ky * kb;
    this.frozen = false;
    this.invuln = 0.25;
    this.hitFlash = 0.15;
    this.lastHitBy = source;
    BB.Particles.burst(this.x, this.y, this.color, 10, 180);
    BB.Audio.play("hit");
  }

  recoil(kx, ky) { this.vx += kx; this.vy += ky; }

  die(cause) {
    if (this.dead) return;
    // Revival: if armed, come back once instead of dying
    if (this.reviveArmed) {
      this.reviveArmed = false;
      this.healFx = 0.6;
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
    if (this.stun > 0) { this.jumpHeld = false; return; } // frozen: no input
    if (this.drilling > 0) {
      // steer the drill left/right as you bore through terrain
      if (moveDir !== 0) {
        const sp = Math.hypot(this.vx, this.vy) || this.drillSpeed;
        const ang = Math.atan2(this.vy, this.vx) + moveDir * 3.0 * this.game.dt;
        this.vx = Math.cos(ang) * sp; this.vy = Math.sin(ang) * sp;
      }
      this.facing = BB.sign(this.vx) || this.facing;
      return;
    }
    const ts = this.timeScale();
    const accel = (this.onGround || this.grip ? ACCEL_GROUND : ACCEL_AIR) * ts;
    const target = moveDir * MAX_SPEED;
    const dt = this.game.dt;
    if (this.rolling > 0) {
      // rolling ball: keep momentum, only gently steer
      if (moveDir !== 0) { this.vx = BB.clamp(this.vx + moveDir * 700 * dt, -900, 900); this.facing = BB.sign(moveDir); }
    } else if (this.grip) {
      // walk ALONG the island surface (works on walls & ceilings)
      const n = this.grip;
      let tx = -n.ny, ty = n.nx; // tangent to the surface
      // base tangent is screen-relative: "right" stays +x; on walls "right" climbs up
      if (tx < -0.001 || (Math.abs(tx) < 0.001 && ty > 0)) { tx = -tx; ty = -ty; }
      // upside down (hanging under a ceiling, normal points DOWN): invert controls
      const upsideDown = n.ny > 0.35;
      const md = upsideDown ? -moveDir : moveDir;
      let vt = this.vx * tx + this.vy * ty;        // tangential speed
      const vn = this.vx * n.nx + this.vy * n.ny;  // keep the normal part (stick/gravity)
      vt = BB.approach(vt, md * MAX_SPEED, accel * dt); // accelerate along the surface
      this.vx = vt * tx + vn * n.nx;
      this.vy = vt * ty + vn * n.ny;
      if (md !== 0) this.facing = BB.sign(md);
    } else if (moveDir !== 0) {
      if (!(BB.sign(this.vx) === BB.sign(target) && Math.abs(this.vx) > MAX_SPEED)) {
        this.vx = BB.approach(this.vx, target, accel * dt);
      }
      this.facing = BB.sign(moveDir);
    }
    if (moveDir !== 0 || wantJump) this.frozen = false; // acting on purpose = fair game for gravity
    if (wantJump) this.jumpBuffer = JUMP_BUFFER;
    this.jumpHeld = !!jumpHeld;
  }

  tryAbility(index, aimX, aimY, charge) {
    const id = this.abilities[index];
    if (!id) return;
    if ((this.cooldowns[id] || 0) > 0) return;
    const ab = BB.Abilities[id];
    if (ab.canUse && !ab.canUse(this)) return; // e.g. drill only from the ground
    const lvl = this.level(id);
    ab.activate(this, this.game, aimX, aimY, lvl, charge === undefined ? 1 : charge);
    this.cooldowns[id] = ab.cooldown * Math.max(0.55, 1 - 0.07 * (lvl - 1));
  }

  update(dt) {
    if (this.dead) return;
    const ts = this.timeScale();
    const A = this.game.arena, wy = A.waterY;
    const portal = !!this.game.atMatchPoint; // the water is a mirror portal at match point
    this.mirror = portal && this.y > wy;

    // ride the drifting island you're standing on
    if (this.gripPlat) { this.x += this.gripPlat.mvx || 0; this.y += this.gripPlat.mvy || 0; }

    // spawn-hover ends the instant you actually move (walk, jump, dash, knockback…)
    if (this.frozen && (Math.abs(this.vx) > 6 || Math.abs(this.vy) > 6)) this.frozen = false;

    this.invuln = Math.max(0, this.invuln - dt);
    this.shieldFx = Math.max(0, this.shieldFx - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.healFx = Math.max(0, this.healFx - dt);
    this.dashing = Math.max(0, this.dashing - dt);
    this.drilling = Math.max(0, this.drilling - dt);
    this.rolling = Math.max(0, this.rolling - dt);
    this.gripCd = Math.max(0, this.gripCd - dt);
    this.slow = Math.max(0, this.slow - dt);
    this.grow = Math.max(0, this.grow - dt);
    this.shrink = Math.max(0, this.shrink - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.squash = BB.approach(this.squash, 0, dt * 3);
    for (const id in this.cooldowns) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);

    // size
    let scale = 1;
    if (this.grow > 0) scale = 1.4;
    else if (this.shrink > 0) scale = 0.62;
    this.r = this.baseR * scale;

    // jump — launches away from whatever surface you're walking on
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.jumps < MAX_JUMPS) {
      if (this.grip) { this.vx += this.grip.nx * JUMP_V; this.vy += this.grip.ny * JUMP_V; this.grip = null; this.gripCd = 0.16; }
      else this.vy = -JUMP_V;
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

    // grapple: reel the rope in over time; the swing constraint runs after integrate
    if (this.grapple) {
      this.grapple.t -= dt;
      this.grapple.len = Math.max(28, this.grapple.len - this.grapple.reel * dt);
      const d = BB.dist(this.x, this.y, this.grapple.x, this.grapple.y);
      if (this.grapple.t <= 0 || d < 30) this.grapple = null;
    }

    // gravity — toward the island surface you're gripping (so you can walk on
    // walls and ceilings), else straight down. Suspended while frozen.
    if (this.dashing <= 0 && !this.frozen) {
      if (this.grip) {
        this.vx += -this.grip.nx * GRIP_G * dt * ts;
        this.vy += -this.grip.ny * GRIP_G * dt * ts;
      } else {
        const g = this.vy > 0 ? GRAV_DOWN : GRAV_UP;
        this.vy += g * dt * ts; // the mirror world is right-side-up: gravity still pulls down
      }
    }
    this.vy = BB.clamp(this.vy, -2600, 2600); // high cap so big-damage launches really fly (sub-stepping stops tunneling)
    if (this.dashing <= 0 && !this.grapple && !this.grip) this.vx *= 1 - AIR_DRAG * dt;

    // integrate + collide, SUB-STEPPED by speed so you can't tunnel through thin
    // walls at high velocity, and a fast roll can hug tight curves.
    this.onGround = false;
    this.grip = null;
    const stepLen = Math.hypot(this.vx, this.vy) * dt * ts;
    const steps = BB.clamp(Math.ceil(stepLen / (this.r * 0.45)), 1, 12);
    const sdt = (dt * ts) / steps;
    for (let s = 0; s < steps; s++) {
      this.onGround = false; this.grip = null; this.gripPlat = null;
      this.x += this.vx * sdt;
      this.y += this.vy * sdt;
      // grapple rope constraint — pendulum swing + reel-in
      if (this.grapple) {
        const dx = this.x - this.grapple.x, dy = this.y - this.grapple.y;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d > this.grapple.len) {
          const nx = dx / d, ny = dy / d;
          this.x = this.grapple.x + nx * this.grapple.len;
          this.y = this.grapple.y + ny * this.grapple.len;
          const vr = this.vx * nx + this.vy * ny;
          if (vr > 0) { this.vx -= vr * nx; this.vy -= vr * ny; }
        }
      }
      if (this.drilling <= 0) {
        this.mirror = portal && this.y > wy;
        const plats = this.mirror ? A.mirrorPlatforms : A.platforms;
        for (const p of plats) this.collidePlatform(p);
      }
      // rolling ball hugs the surface and rolls AROUND it (floor→wall→ceiling),
      // re-aimed each sub-step so a fast roll tracks tight curves. In a gap
      // (no grip) it just arcs across under normal gravity.
      if (this.rolling > 0 && this.grip) {
        const n = this.grip;
        const tx = this.rollHand < 0 ? -n.ny : n.ny;
        const ty = this.rollHand < 0 ? n.nx : -n.nx;
        const stick = 820;
        this.vx = tx * this.rollSpeed - n.nx * stick;
        this.vy = ty * this.rollSpeed - n.ny * stick;
      }
    }
    if (this.drilling > 0) BB.Particles.burst(this.x, this.y, "#b0f0ff", 3, 130, { life: 0.28 });

    // the roll pins you to full roll speed every sub-step; the instant it ends,
    // cap your speed to a runnable value so you don't rocket off (ground friction
    // then eases you to a stop). The gap-carry happens DURING the roll, so
    // capping at the end is safe — and a hard cap is robust to the grip state.
    if (this._wasRolling && this.rolling <= 0) {
      const cap = 380, sp = Math.hypot(this.vx, this.vy);
      if (sp > cap) { const k = cap / sp; this.vx *= k; this.vy *= k; }
    }
    this._wasRolling = this.rolling > 0;

    // Roll/Drill/Dash contact hit
    if ((this.dashing > 0 || this.rolling > 0) && this.dashDamage) {
      const lv = this.dashLevel || 1;
      for (const b of this.game.blobs) {
        if (b === this || b.dead) continue;
        if (BB.dist(this.x, this.y, b.x, b.y) < this.r + b.r + 4) {
          const n = BB.Vec.norm(b.x - this.x, b.y - this.y);
          b.hurt(this.dashDmg + 4 * (lv - 1), n.x * (this.dashKnock + 70 * (lv - 1)), -240, this);
          BB.Shake.add(10); BB.Hit.add(0.07);
          if (this.dashing > 0) { this.dashing = 0; this.vx *= -0.3; } // dash/drill stop on hit
          else { this.vx *= 0.8; } // a roll bowls through and keeps going
        }
      }
    }

    // hazards (editor spikes): knock you away + build damage on contact
    const hz = this.mirror ? A.mirrorHazards : A.hazards;
    if (hz && hz.length && this.invuln <= 0) {
      for (const h of hz) {
        if (BB.dist(this.x, this.y, h.x, h.y) < h.r + this.r) {
          const n = BB.Vec.norm((this.x - h.x) || 0.01, (this.y - h.y) || -0.01);
          this.hurt(16, n.x * 560, n.y * 560 - 120, null);
          BB.Particles.burst(this.x, this.y, "#ff5b5b", 10, 220);
          break;
        }
      }
    }

    // break the surface: splash + ripples (a portal shimmer at match point)
    const inNow = this.y + this.r > wy;
    if (inNow && !this._inWater) {
      BB.Particles.burst(this.x, wy, portal ? "#8be0ff" : "#dff2ff", portal ? 34 : 24, 360, { gravity: 320, life: 0.6 });
      BB.Particles.burst(this.x, wy, "#bfe3ff", 12, 150, { gravity: -140, vy: -180, life: 0.55 });
      for (let i = 0; i < (portal ? 5 : 3); i++) this.game.spawn(BB.makeRipple(this.x, wy, 4 + i * 12));
      BB.Shake.add(portal ? 8 : 5); BB.Audio.play("whoosh");
    }
    if (inNow && this.mirror && Math.random() < 0.3) BB.Particles.burst(this.x + BB.rand(-8, 8), this.y, "#bfe3ff", 1, 40, { gravity: -220, life: 0.6 });
    this._inWater = inNow;

    // ring-out. Water is now a PORTAL, not a kill — you die only at the outer
    // edges: off the top of the real world, the bottom of the mirror world, or
    // out the sides (with a brief red-alert grace on the sides).
    const g = this.game;
    const mirrorBottom = 2 * wy + 560;
    if (this.x < A.leftBound || this.x > A.rightBound) {
      this.oob += dt;
      if (this.oob > 1.0) this.die("fall");
    } else if (this.y < -560 || this.y - this.r > mirrorBottom) {
      this.die("fall"); // off the top of the real world / bottom of the mirror world
    } else if (!portal && this.y - this.r > wy + WATER_DEATH_DEPTH) {
      this.die("fall"); // drowned — the water is deadly until match point
    } else this.oob = 0;

    // land juice
    if (this.onGround && this.vy >= 0 && this._wasAir) {
      this.squash = 0.5;
      BB.Particles.burst(this.x, this.y + this.r, "#ffffff", 5, 90, { gravity: 200, vy: 20 });
      if (Math.abs(this.vx) > 60 || this._wasAir) BB.Audio.play("land");
    }
    this._wasAir = !this.onGround;

    // animation clocks
    this.animT += dt;
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) { this.blink = 0.12; this.blinkTimer = BB.rand(2.4, 5.5); }
    this.blink = Math.max(0, this.blink - dt);
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
    // grip the surface so you can WALK along it (top, sides, or ceiling);
    // a rolling ball grips too, so it can roll floor -> wall -> ceiling
    if (this.gripCd <= 0) {
      this.grip = { nx, ny };
      this.gripPlat = p; // ride this platform if it drifts
      this.jumps = 0;
      if (ny < -0.35) this.onGround = true; // top-ish surface (for land juice / animation)
    }
  }

  draw(ctx) {
    if (this.dead) return;
    const flashing = this.hitFlash > 0 && Math.floor(this.hitFlash * 40) % 2 === 0;
    const sq = this.squash;
    const r = this.r;
    const spd = Math.hypot(this.vx, this.vy);
    const moving = this.onGround && Math.abs(this.vx) > 35;
    const airborne = !this.onGround;
    const hitFace = this.hitFlash > 0;
    const surprised = spd > 520 || (airborne && Math.abs(this.vy) > 260);

    // procedural animation: walk bounce, idle breath, speed stretch, lean
    const walkT = this.animT * 15;
    const bounce = moving ? Math.abs(Math.sin(walkT)) * r * 0.14 : 0;
    const breathe = this.onGround && !moving ? Math.sin(this.animT * 3) * 0.035 : 0;
    const vStretch = BB.clamp(Math.abs(this.vy) / 1800, 0, 0.17);
    const hStretch = BB.clamp(Math.abs(this.vx) / 1600, 0, 0.13);
    const lean = BB.clamp(this.vx / 1000, -0.32, 0.32);
    let sx = 1 - sq * 0.4 + breathe - vStretch * 0.7 + hStretch;
    let sy = 1 + sq * 0.4 - breathe + vStretch - hStretch * 0.7;
    if (moving) sx += Math.sin(walkT) * 0.05;

    ctx.save();
    ctx.translate(this.x, this.y - bounce);
    ctx.rotate(lean * 0.5);
    if (this.rolling > 0) ctx.rotate(this.animT * 16 * (this.rollHand < 0 ? 1 : -1)); // spin like a ball (consistent around corners)

    // status rings (unscaled)
    if (this.slow > 0) { ctx.strokeStyle = "rgba(139,224,255,0.7)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Math.PI * 2); ctx.stroke(); }
    if (this.grow > 0) { ctx.strokeStyle = "rgba(255,200,90,0.8)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.stroke(); }
    if (this.shrink > 0) { ctx.strokeStyle = "rgba(255,120,200,0.8)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.stroke(); }
    if (this.shield > 0) {
      ctx.fillStyle = `rgba(139,224,255,${0.12 + 0.06 * Math.sin(this.game.time * 10)})`;
      ctx.beginPath(); ctx.arc(0, 0, r + 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(139,224,255,${0.6 + 0.3 * Math.sin(this.game.time * 12)})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, r + 7, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.stun > 0) {
      ctx.strokeStyle = "rgba(191,227,255,0.9)"; ctx.lineWidth = 2; ctx.lineCap = "round";
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + this.game.time; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5); ctx.lineTo(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6)); ctx.stroke(); }
    }

    ctx.scale(sx, sy);

    // --- gooey blob body: a smooth organic outline, not a scaled circle ---
    const rolling = this.rolling > 0;
    const grounded = this.onGround && !rolling;
    const jiggle = 0.05 + BB.clamp(spd / 3400, 0, 0.06) + (hitFace ? 0.06 : 0);
    const nose = (airborne && !rolling) ? BB.clamp(spd / 1500, 0, 0.13) : 0; // lead with a rounded nose when flying
    const ndir = Math.atan2(this.vy, this.vx);
    const N = 40;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      // organic, smooth, multi-frequency wobble (jelly surface)
      let wob = 1
        + Math.sin(a * 2 + this.animT * 3.0 + this.wobblePhase) * jiggle
        + Math.sin(a * 3 - this.animT * 4.5 + this.wobblePhase * 1.7) * jiggle * 0.55;
      const down = Math.sin(a); // +1 = bottom of the body in local space
      if (grounded) wob += Math.max(0, down) * (moving ? 0.03 : 0.075); // sag/settle at rest
      if (nose) wob += Math.cos(a - ndir) * nose;                       // teardrop toward motion
      const rr = r * wob;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    // trace a smooth closed curve THROUGH the points (quadratic midpoints => gooey)
    ctx.beginPath();
    ctx.moveTo((pts[N - 1][0] + pts[0][0]) / 2, (pts[N - 1][1] + pts[0][1]) / 2);
    for (let i = 0; i < N; i++) {
      const nxt = pts[(i + 1) % N];
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + nxt[0]) / 2, (pts[i][1] + nxt[1]) / 2);
    }
    ctx.closePath();

    // fill with a top-lit / bottom-shaded gradient for a soft gel volume
    const base = flashing ? "#ffffff" : this.healFx > 0 ? "#7dffb0" : (this.bodyColor || this.color);
    const grad = ctx.createLinearGradient(0, -r, 0, r);
    grad.addColorStop(0, BB.mixHex(base, "#ffffff", 0.24));
    grad.addColorStop(0.55, base);
    grad.addColorStop(1, BB.mixHex(base, "#0a0e1a", 0.22));
    ctx.fillStyle = grad;
    ctx.fill();
    if (!flashing) { ctx.strokeStyle = BB.mixHex(base, "#0a0e1a", 0.35); ctx.lineWidth = Math.max(1.4, r * 0.05); ctx.stroke(); }

    // glossy highlight — a soft ball of light, upper-left
    const hl = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.04, -r * 0.3, -r * 0.4, r * 0.62);
    hl.addColorStop(0, "rgba(255,255,255,0.5)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.4, r * 0.62, 0, Math.PI * 2); ctx.fill();

    this._drawFace(ctx, r, hitFace, surprised);
    ctx.restore();

    // world-space overlays (not squashed)
    if (this.grapple) {
      ctx.strokeStyle = "#4be0c0"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.grapple.x, this.grapple.y); ctx.stroke();
    }
    if (this.reviveArmed) {
      ctx.strokeStyle = `rgba(91,224,138,${0.5 + 0.4 * Math.sin(this.game.time * 8)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, r + 10, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.invuln > 0) {
      ctx.strokeStyle = `rgba(91,184,255,${0.4 + 0.4 * Math.sin(this.game.time * 20)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(this.x, this.y, r + 7, 0, Math.PI * 2); ctx.stroke();
    }

    if (this.isReflection) { // the enemy's reflection-clone: a shimmering ghost
      ctx.strokeStyle = `rgba(200,230,255,${0.4 + 0.35 * Math.sin(this.game.time * 6)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, r + 5, 0, Math.PI * 2); ctx.stroke();
    }

    // Smash-style damage percent floating above the blob
    const pct = Math.round(this.percent);
    const col = pct < 60 ? "#ffffff" : pct < 120 ? "#ffd24b" : pct < 200 ? "#ff8a3c" : "#ff4b4b";
    ctx.font = `bold ${13 + Math.min(pct / 18, 9)}px system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const ty = this.y - r - 16;
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillText(pct + "%", this.x + 1, ty + 1);
    ctx.fillStyle = col; ctx.fillText(pct + "%", this.x, ty);
  }

  _drawFace(ctx, r, hitFace, surprised) {
    const eyeDX = r * 0.36, eyeY = -r * 0.10;
    const eyeR = r * (surprised ? 0.26 : 0.22);
    const dark = "#0d1020";

    // pupils track velocity when moving, else stare at the opponent
    let lx = this.facing, ly = 0;
    if (Math.hypot(this.vx, this.vy) > 45) { const n = BB.Vec.norm(this.vx, this.vy); lx = n.x; ly = n.y * 0.6; }
    else { const o = this.game.blobs.find((b) => b !== this && !b.dead); if (o) { const n = BB.Vec.norm(o.x - this.x, o.y - this.y); lx = n.x; ly = n.y * 0.6; } }

    for (const side of [-1, 1]) {
      const cx = side * eyeDX;
      if (hitFace) { // X_X
        ctx.strokeStyle = dark; ctx.lineWidth = 2.4; ctx.lineCap = "round";
        const s = eyeR * 0.7;
        ctx.beginPath();
        ctx.moveTo(cx - s, eyeY - s); ctx.lineTo(cx + s, eyeY + s);
        ctx.moveTo(cx + s, eyeY - s); ctx.lineTo(cx - s, eyeY + s);
        ctx.stroke();
      } else if (this.blink > 0) { // closed
        ctx.strokeStyle = dark; ctx.lineWidth = 2.4; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(cx - eyeR * 0.8, eyeY); ctx.lineTo(cx + eyeR * 0.8, eyeY); ctx.stroke();
      } else { // white eye + tracking pupil
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(cx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(13,16,32,0.25)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, eyeY, eyeR, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.arc(cx + lx * eyeR * 0.42, eyeY + ly * eyeR * 0.42, eyeR * 0.52, 0, Math.PI * 2); ctx.fill();
      }
    }

    // mouth: open "o" when surprised/hit, otherwise a little smile
    const my = r * 0.36;
    if (hitFace || surprised) {
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(0, my, r * 0.13, r * 0.17, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(0, my - r * 0.12, r * 0.2, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke();
    }
  }
};
