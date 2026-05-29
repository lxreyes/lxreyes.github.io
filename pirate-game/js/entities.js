// Game entities: ships (player + AI), cannonballs, treasure, wake particles.
// All positions are in WORLD coordinates. The camera (in game.js) handles
// converting world -> screen, so entities never need to know about scrolling.

// ---- Tunable ship physics (units are pixels & seconds) ----
const SHIP = {
  accel: 170,
  drag: 0.7,         // fraction of speed shed per second
  maxSpeed: 230,
  maxReverse: 70,
  turnRate: 2.1,     // radians/sec at full effectiveness
  fireCooldown: 0.65,
  ballSpeed: 430,
  ballLife: 1.25,    // seconds before a cannonball drops into the sea
};

class Ship {
  constructor(x, y, faction) {
    this.x = x;
    this.y = y;
    this.angle = rand(0, TWO_PI);
    this.speed = 0;
    this.faction = faction; // "player" | "enemy"
    this.isPlayer = faction === "player";

    this.length = 46;
    this.width = 22;
    this.radius = 22;       // collision radius

    this.maxHealth = this.isPlayer ? 100 : 60;
    this.health = this.maxHealth;
    this.dead = false;

    // Per-ship tunables. These start at the global defaults but the player's
    // copy gets rewritten by the shop (see Game.applyUpgrades), which is why
    // they live on the instance instead of being read from SHIP directly.
    this.maxSpeed = SHIP.maxSpeed;
    this.accel = SHIP.accel;
    this.turnRate = SHIP.turnRate;
    this.fireCooldownTime = SHIP.fireCooldown;
    this.ballSpeed = SHIP.ballSpeed;
    this.ballLife = SHIP.ballLife;
    this.cannonDamage = 12;
    this.cannonsPerSide = 1;

    // Appearance (overwritten per ship tier for the player).
    this.hullColor = this.isPlayer ? "#7a4a23" : "#3a2b3d";
    this.deckColor = this.isPlayer ? "#a9743b" : "#574257";
    this.sailColor = this.isPlayer ? "#f4ecd6" : "#7c1f1f";

    this.cooldown = 0;
    this.moveTarget = null; // {x, y} set by click-to-move

    // AI state
    this.wanderAngle = this.angle;
    this.wanderTimer = 0;
    this.circleSide = Math.random() < 0.5 ? 1 : -1;
  }

  // ---- Per-frame update ----
  update(dt, game) {
    if (this.isPlayer) this._playerControls(dt, game);
    else this._ai(dt, game);

    // Water drag pulls speed toward zero, giving the ship momentum.
    this.speed -= this.speed * SHIP.drag * dt;
    this.speed = clamp(this.speed, -SHIP.maxReverse, this.maxSpeed);

    // Move
    const vx = Math.cos(this.angle) * this.speed;
    const vy = Math.sin(this.angle) * this.speed;
    this.x += vx * dt;
    this.y += vy * dt;

    // Keep inside the world bounds
    this.x = clamp(this.x, 0, game.world.size);
    this.y = clamp(this.y, 0, game.world.size);

    // Bounce off islands
    this._resolveIslands(game);

    if (this.cooldown > 0) this.cooldown -= dt;

    // Spawn a wake when moving with any real speed
    if (Math.abs(this.speed) > 40 && Math.random() < 0.6) {
      const back = this.angle + Math.PI;
      game.spawnWake(
        this.x + Math.cos(back) * this.length * 0.45,
        this.y + Math.sin(back) * this.length * 0.45
      );
    }
  }

  _steer(dt, turnInput) {
    // A nearly-stopped ship still answers the helm a little, but turns
    // best with way on — that small detail sells the feel of sailing.
    const eff = 0.35 + 0.65 * clamp(Math.abs(this.speed) / this.maxSpeed, 0, 1);
    this.angle += turnInput * this.turnRate * eff * dt;
  }

  _playerControls(dt, game) {
    // The player sails entirely by click-to-move; firing is driven by the
    // game on right-click (see Game._fireAtCursor).
    if (this.moveTarget) this._navigateTo(dt, this.moveTarget);
  }

  // Sail automatically toward a clicked point: steer onto the bearing, give
  // more throttle the better we're aimed, and ease off as we arrive.
  _navigateTo(dt, target) {
    const d = dist(this.x, this.y, target.x, target.y);
    if (d < 16) {
      this.moveTarget = null; // arrived — coast to a stop
      return;
    }
    const bearing = angleTo(this.x, this.y, target.x, target.y);
    const err = angleDiff(this.angle, bearing);
    this._steer(dt, clamp(err * 3, -1, 1));

    const align = Math.cos(err);                 // 1 when pointed at target
    const ease = clamp(d / 110, 0.25, 1);        // slow down near the target
    const throttle = clamp(align, 0.25, 1) * ease;
    this.speed += this.accel * throttle * dt;
  }

  _ai(dt, game) {
    const p = game.player;
    const d = p && !p.dead ? dist(this.x, this.y, p.x, p.y) : Infinity;
    const aggro = 560;

    let targetAngle;
    if (d > aggro) {
      // Wander: drift toward a heading we re-roll every few seconds.
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderAngle += rand(-1, 1);
        this.wanderTimer = rand(2.5, 5);
      }
      targetAngle = this.wanderAngle;
      this.speed += this.accel * 0.45 * dt;
    } else if (d > 430) {
      // Close the distance.
      targetAngle = angleTo(this.x, this.y, p.x, p.y);
      this.speed += this.accel * 0.8 * dt;
    } else {
      // In range: circle so our broadside bears on the player.
      const toPlayer = angleTo(this.x, this.y, p.x, p.y);
      targetAngle = toPlayer - this.circleSide * Math.PI / 2;
      this.speed += this.accel * 0.6 * dt;

      // Fire the side that faces the player when it's lined up.
      const side = this.circleSide; // the side we keep toward the player
      const sideAngle = this.angle + side * Math.PI / 2;
      if (
        this.cooldown <= 0 &&
        Math.abs(angleDiff(sideAngle, toPlayer)) < 0.4 &&
        d < 470
      ) {
        this.fireSide(game, side);
        this.cooldown = this.fireCooldownTime * rand(1.3, 2.0);
      }
    }

    const turn = Math.sign(angleDiff(this.angle, targetAngle));
    this._steer(dt, turn);
  }

  // Fire a broadside. side = +1 (starboard) or -1 (port). More cannons per
  // side means more balls, spread evenly along the hull.
  fireSide(game, side) {
    const dir = this.angle + side * Math.PI / 2;
    const n = this.cannonsPerSide;
    for (let i = 0; i < n; i++) {
      // t spreads the guns from stern (-0.5) to bow (+0.5) along the hull.
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      const along = t * this.length * 0.55;
      const px = this.x + Math.cos(this.angle) * along + Math.cos(dir) * this.width * 0.6;
      const py = this.y + Math.sin(this.angle) * along + Math.sin(dir) * this.width * 0.6;
      // Inherit a little of the ship's momentum so shots feel physical.
      const vx = Math.cos(dir) * this.ballSpeed + Math.cos(this.angle) * this.speed * 0.5;
      const vy = Math.sin(dir) * this.ballSpeed + Math.sin(this.angle) * this.speed * 0.5;
      game.cannonballs.push(
        new Cannonball(px, py, vx, vy, this.faction, this.cannonDamage, this.ballLife)
      );
      game.spawnSmoke(px, py);
    }
  }

  // Fire a volley straight toward a world point (tx, ty) — used by the player
  // to aim cannonballs directly at the mouse. All balls travel on the same
  // bearing; with more cannons they spawn side by side for a wider volley.
  fireAt(game, tx, ty) {
    const dir = angleTo(this.x, this.y, tx, ty);
    const perp = dir + Math.PI / 2;
    const muzzle = this.length * 0.45; // clear the hull
    const bx = this.x + Math.cos(dir) * muzzle;
    const by = this.y + Math.sin(dir) * muzzle;
    const n = this.cannonsPerSide;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;   // -0.5 .. 0.5
      const offset = t * this.width * 0.9;
      const mx = bx + Math.cos(perp) * offset;
      const my = by + Math.sin(perp) * offset;
      // Velocity points exactly at the cursor (no momentum skew) so the shot
      // lands where you click.
      const vx = Math.cos(dir) * this.ballSpeed;
      const vy = Math.sin(dir) * this.ballSpeed;
      game.cannonballs.push(
        new Cannonball(mx, my, vx, vy, this.faction, this.cannonDamage, this.ballLife)
      );
      game.spawnSmoke(mx, my);
    }
  }

  takeDamage(n, game) {
    this.health -= n;
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      game.onShipSunk(this);
    }
  }

  _resolveIslands(game) {
    for (const isle of game.world.islands) {
      const d = dist(this.x, this.y, isle.x, isle.y);
      const min = isle.radius + this.radius;
      if (d < min && d > 0) {
        const nx = (this.x - isle.x) / d;
        const ny = (this.y - isle.y) / d;
        this.x = isle.x + nx * min;
        this.y = isle.y + ny * min;
        this.speed *= 0.3; // running aground kills your way
      }
    }
  }

  // ---- Rendering (drawn in local space, bow pointing +x) ----
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const L = this.length;
    const W = this.width;

    // Hull (pointed bow, rounded stern)
    const hull = this.hullColor;
    const deck = this.deckColor;
    ctx.fillStyle = hull;
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L * 0.55, 0);                 // bow tip
    ctx.quadraticCurveTo(L * 0.25, -W * 0.55, -L * 0.45, -W * 0.42);
    ctx.quadraticCurveTo(-L * 0.55, 0, -L * 0.45, W * 0.42);
    ctx.quadraticCurveTo(L * 0.25, W * 0.55, L * 0.55, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Deck inset
    ctx.fillStyle = deck;
    ctx.beginPath();
    ctx.ellipse(-L * 0.02, 0, L * 0.32, W * 0.3, 0, 0, TWO_PI);
    ctx.fill();

    // Sail (billowing) — a curved quad that gives the ship life
    ctx.fillStyle = this.sailColor;
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.moveTo(2, -W * 0.18);
    ctx.quadraticCurveTo(L * 0.42, -W * 0.05, 2, W * 0.18);
    ctx.lineTo(2, -W * 0.18);
    ctx.fill();
    ctx.stroke();

    // Mast
    ctx.fillStyle = "#2b1c0e";
    ctx.beginPath();
    ctx.arc(2, 0, 2.4, 0, TWO_PI);
    ctx.fill();

    // Stern flag
    ctx.fillStyle = this.isPlayer ? "#1d3557" : "#111";
    ctx.fillRect(-L * 0.5, -W * 0.5, 9, 6);

    ctx.restore();

    // Health bar above non-full-health ships
    if (this.health < this.maxHealth) {
      const w = 40;
      const frac = clamp(this.health / this.maxHealth, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(this.x - w / 2, this.y - this.length * 0.7, w, 5);
      ctx.fillStyle = this.isPlayer ? "#46c46a" : "#e74c3c";
      ctx.fillRect(this.x - w / 2, this.y - this.length * 0.7, w * frac, 5);
    }
  }
}

// ---------------------------------------------------------------------------
class Cannonball {
  constructor(x, y, vx, vy, faction, damage = 12, life = SHIP.ballLife) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.faction = faction;
    this.life = life;
    this.maxLife = life;
    this.radius = 4;
    this.damage = damage;
    this.dead = false;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    // Fade and shrink as the ball loses energy
    const t = clamp(this.life / this.maxLife, 0, 1);
    ctx.fillStyle = "#1a1a1a";
    ctx.globalAlpha = 0.4 + 0.6 * t;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
class Treasure {
  constructor(x, y, value) {
    this.x = x;
    this.y = y;
    this.value = value;
    this.radius = 14;
    this.bob = rand(0, TWO_PI);
    this.dead = false;
  }

  update(dt) {
    this.bob += dt * 3;
  }

  draw(ctx) {
    const yOff = Math.sin(this.bob) * 2;
    // Floating barrel
    ctx.save();
    ctx.translate(this.x, this.y + yOff);
    ctx.fillStyle = "#7a4a23";
    ctx.strokeStyle = "#3a2410";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 8, 0, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
    // Gold glint on top
    ctx.fillStyle = "#f0c860";
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Lightweight particle used for wakes, smoke, and splashes.
class Particle {
  constructor(x, y, opts) {
    this.x = x;
    this.y = y;
    this.vx = opts.vx || 0;
    this.vy = opts.vy || 0;
    this.life = opts.life;
    this.maxLife = opts.life;
    this.size = opts.size;
    this.color = opts.color;
    this.grow = opts.grow || 0;
    this.dead = false;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.size += this.grow * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    const t = clamp(this.life / this.maxLife, 0, 1);
    ctx.globalAlpha = t * 0.7;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
