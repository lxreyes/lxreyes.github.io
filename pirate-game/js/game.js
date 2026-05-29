// The Game owns the loop, the camera, and every entity list. It wires the
// pieces (world, ships, input) together but pushes the actual behavior down
// into those objects — this file is the conductor, not the orchestra.

const WORLD_SIZE = 6000;
const ENEMY_TARGET = 6;
const TREASURE_TARGET = 16;

// Buyable ship hulls, smallest to grandest. Each is a complete stat profile;
// the shop just swaps which one the player sails.
const TIERS = [
  { name: "Sloop",      hp: 100, speed: 230, cannons: 1, length: 46, width: 22, cost: 0,
    hull: "#7a4a23", deck: "#a9743b", sail: "#f4ecd6" },
  { name: "Brigantine", hp: 160, speed: 250, cannons: 2, length: 54, width: 26, cost: 160,
    hull: "#6b3f1d", deck: "#9c6a34", sail: "#efe3c2" },
  { name: "Frigate",    hp: 240, speed: 240, cannons: 3, length: 64, width: 30, cost: 420,
    hull: "#5c3a2a", deck: "#8a5a36", sail: "#e9dcc0" },
  { name: "Galleon",    hp: 360, speed: 215, cannons: 4, length: 76, width: 36, cost: 950,
    hull: "#4a2e22", deck: "#7a4d30", sail: "#e6d6a8" },
];

// Repeatable, leveled upgrades. `key` matches a field on Game.upgrades, and
// applyUpgrades() reads the level to compute the player's live stats.
const UPGRADES = [
  { key: "damage",    name: "Cannon Forge",    icon: "💥", desc: "+4 cannon damage",        max: 6, baseCost: 60, growth: 1.6 },
  { key: "reload",    name: "Powder Store",    icon: "🛢️", desc: "-9% reload time",          max: 5, baseCost: 70, growth: 1.7 },
  { key: "speed",     name: "Rigging & Sails", icon: "⛵", desc: "+6% top speed",            max: 6, baseCost: 55, growth: 1.55 },
  { key: "hull",      name: "Reinforced Hull", icon: "🛡️", desc: "+25 max hull",             max: 8, baseCost: 50, growth: 1.5 },
  { key: "range",     name: "Long Nines",      icon: "🎯", desc: "+12% shot range & speed",  max: 4, baseCost: 90, growth: 1.8 },
  { key: "extraGuns", name: "Extra Gun Deck",  icon: "⚓", desc: "+1 cannon per side",        max: 2, baseCost: 300, growth: 2.2 },
  { key: "crew",      name: "Recruit Crew",    icon: "🏴‍☠️", desc: "+1 pirate in plunder raids", max: 4, baseCost: 120, growth: 1.6 },
  { key: "cutlass",   name: "Cutlasses",       icon: "🗡️", desc: "+2 raid attack damage",     max: 3, baseCost: 90,  growth: 1.6 },
  { key: "musket",    name: "Muskets",         icon: "🔫", desc: "+1 attack range in raids",  max: 2, baseCost: 150, growth: 1.9 },
];

// Cost to go from the current level to the next.
function upgradeCost(def, level) {
  return Math.round(def.baseCost * Math.pow(def.growth, level));
}

class Game {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.minimap = minimap;
    this.mctx = minimap.getContext("2d");

    this.running = false;
    this.time = 0;
    this.lastTime = 0;

    this.camX = 0;
    this.camY = 0;
    this.shakeAmt = 0;

    this.shopOpen = false;

    this.resize();
    window.addEventListener("resize", () => this.resize());

    // Left-click the sea to sail there; right-click to fire the broadside
    // that bears on the cursor. The minimap doubles as a navigation chart.
    this.canvas.addEventListener("mousedown", (e) => this._onCanvasMouseDown(e));
    this.minimap.addEventListener("mousedown", (e) => this._onMapClick(e));
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Bound once so requestAnimationFrame keeps the right `this`.
    this._loop = this._loop.bind(this);
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // ---- Lifecycle ----
  start() {
    this.world = new World(WORLD_SIZE);
    const c = WORLD_SIZE / 2;
    this.player = new Ship(c, c, "player");
    this.player.angle = -Math.PI / 2;

    // The home port: dock here to open the shop. Placed just "north" of the
    // spawn so a new captain sails right into it.
    this.port = { x: c, y: c - 360, radius: 150 };

    // Villages to explore on foot (built from the larger islands).
    this.villages = this._makeVillages();

    // Modes: "sailing" the ship vs. "plunder" (grid battle ashore).
    this.mode = "sailing";
    this.battle = null;         // active Battle while plundering a village
    this.interaction = null;    // what pressing E does right now

    // Fresh upgrade slate for a new run.
    this.upgrades = { shipTier: 0, damage: 0, reload: 0, speed: 0, hull: 0, range: 0, extraGuns: 0, crew: 0, cutlass: 0, musket: 0 };
    this.applyUpgrades();
    this.player.health = this.player.maxHealth;

    this.enemies = [];
    this.cannonballs = [];
    this.treasures = [];
    this.particles = [];
    this.airships = [];
    this.bombs = [];
    this.skyratesDowned = 0;
    this.skyrateTimer = rand(24, 42); // time until the first skyrate appears

    for (let i = 0; i < ENEMY_TARGET; i++) this._spawnEnemy();
    for (let i = 0; i < TREASURE_TARGET; i++) this._spawnTreasure();

    this.gold = 0;
    this.shipsSunk = 0;
    this.gameOver = false;
    this.shopOpen = false;
    document.getElementById("shop").classList.add("hidden");

    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this._loop);
  }

  // Recompute the player's live stats from the current ship tier + upgrade
  // levels. Called at start and after every purchase — one source of truth.
  applyUpgrades() {
    const u = this.upgrades;
    const tier = TIERS[u.shipTier];
    const p = this.player;

    p.length = tier.length;
    p.width = tier.width;
    p.radius = tier.length * 0.48;
    p.hullColor = tier.hull;
    p.deckColor = tier.deck;
    p.sailColor = tier.sail;

    p.cannonsPerSide = tier.cannons + u.extraGuns;
    p.maxSpeed = tier.speed * (1 + u.speed * 0.06);
    p.maxHealth = tier.hp + u.hull * 25;
    p.cannonDamage = 12 + u.damage * 4;
    p.fireCooldownTime = Math.max(0.18, 0.65 * (1 - u.reload * 0.09));
    p.ballSpeed = SHIP.ballSpeed * (1 + u.range * 0.12);
    p.ballLife = SHIP.ballLife * (1 + u.range * 0.25);

    if (p.health > p.maxHealth) p.health = p.maxHealth;
  }

  _loop(now) {
    if (!this.running) return;
    // Clamp dt so a backgrounded tab doesn't teleport everything.
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.time += dt;

    this.update(dt);
    this.render();

    requestAnimationFrame(this._loop);
  }

  // ---- Update ----
  update(dt) {
    if (this.gameOver || this.shopOpen) return;

    // Plundering: only the grid battle ticks; the sea waits for our return.
    if (this.mode === "plunder") {
      this.battle.update(dt);
      this.shakeAmt *= 0.85;
      this._updateHUD();
      return;
    }

    this.player.update(dt, this);
    for (const e of this.enemies) e.update(dt, this);
    for (const b of this.cannonballs) b.update(dt);
    for (const t of this.treasures) t.update(dt);
    for (const p of this.particles) p.update(dt);
    for (const a of this.airships) a.update(dt, this);
    for (const bomb of this.bombs) bomb.update(dt, this);

    this._collisions();

    // Remove dead things
    this.cannonballs = this.cannonballs.filter((b) => !b.dead);
    this.particles = this.particles.filter((p) => !p.dead);
    this.treasures = this.treasures.filter((t) => !t.dead);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.airships = this.airships.filter((a) => !a.dead);
    this.bombs = this.bombs.filter((b) => !b.dead);

    // Keep the world populated
    if (this.enemies.length < ENEMY_TARGET && Math.random() < 0.01) this._spawnEnemy();
    if (this.treasures.length < TREASURE_TARGET && Math.random() < 0.02) this._spawnTreasure();

    // A rare skyrate raid drifts in from time to time.
    this.skyrateTimer -= dt;
    if (this.skyrateTimer <= 0) {
      if (this.airships.length < 1) {
        this._spawnAirship();
        this.skyrateTimer = rand(45, 80);
      } else {
        this.skyrateTimer = rand(15, 25);
      }
    }

    // Camera follows the player; shake decays over time.
    this.camX = this.player.x - this.canvas.width / 2;
    this.camY = this.player.y - this.canvas.height / 2;
    this.shakeAmt *= 0.85;

    // Decide what (if anything) pressing E does right now, and show its prompt.
    this._updatePrompt();

    this._updateHUD();
  }

  canDock() {
    return (
      this.running && !this.gameOver && !this.shopOpen && this.mode === "sailing" &&
      this.port &&
      dist(this.player.x, this.player.y, this.port.x, this.port.y) < this.port.radius
    );
  }

  // The nearest village whose island the ship is close enough to land on.
  _nearbyVillage() {
    for (const v of this.villages) {
      if (dist(this.player.x, this.player.y, v.island.x, v.island.y) < v.island.radius + 70) {
        return v;
      }
    }
    return null;
  }

  // One place decides the current contextual action + its on-screen prompt.
  _updatePrompt() {
    let it = null;
    if (this.mode === "plunder") {
      // No contextual prompt during a battle.
    } else if (this.canDock()) {
      it = { type: "cove", text: "⚓ Press <b>E</b> to dock at The Pirate's Cove" };
    } else {
      const v = this._nearbyVillage();
      if (v && !v.plundered) it = { type: "village", village: v, text: `⚔️ Press <b>E</b> to plunder ${v.name}` };
    }

    this.interaction = it;
    const el = document.getElementById("dock-prompt");
    if (it) {
      el.innerHTML = it.text;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }

  // Routed from the E key (see main.js): act on whatever prompt is showing.
  interact() {
    const it = this.interaction;
    if (!it) return;
    if (it.type === "cove") this.openShop();
    else if (it.type === "village") this.startPlunder(it.village);
  }

  // ---- Plunder (grid battle) ----
  startPlunder(village) {
    this.mode = "plunder";
    this.player.moveTarget = null; // drop anchor
    this.battle = new Battle(this, village);
    this.interaction = null;
    document.getElementById("dock-prompt").classList.add("hidden");
    document.getElementById("plunder-ui").classList.remove("hidden");
  }

  // Battle reports its outcome here. result: "win" | "lose".
  onPlunderEnd(result, loot, text) {
    document.getElementById("plunder-ui").classList.add("hidden");
    let title;
    if (result === "win") {
      this.gold += loot;
      this.battle.village.plundered = true;
      title = "🏆 Village Plundered!";
    } else {
      const dmg = 20;
      this.player.health = Math.max(1, this.player.health - dmg);
      title = "🏳️ Driven Off!";
      text = text + ` Your hull took ${dmg} damage in the retreat.`;
    }
    document.getElementById("plunder-result-title").textContent = title;
    document.getElementById("plunder-result-text").textContent = text;
    document.getElementById("plunder-result").classList.remove("hidden");
  }

  // "Continue" after a finished battle returns to the open sea.
  endPlunder() {
    document.getElementById("plunder-result").classList.add("hidden");
    document.getElementById("plunder-ui").classList.add("hidden");
    this.battle = null;
    this.mode = "sailing";
    this.lastTime = performance.now();
  }

  // Bail out mid-raid: no loot, no penalty.
  retreatPlunder() {
    document.getElementById("plunder-ui").classList.add("hidden");
    document.getElementById("plunder-result").classList.add("hidden");
    this.battle = null;
    this.mode = "sailing";
    this.lastTime = performance.now();
  }

  // Turn the biggest islands into villages you can land on.
  _makeVillages() {
    const names = ["Tortuga Hollow", "Skull Bay", "Mermaid's Rest", "Rumport", "Gull's Landing"];
    const big = this.world.islands.filter((i) => i.radius > 150).sort((a, b) => b.radius - a.radius);
    return big.slice(0, 3).map((isle, i) => this._makeVillage(isle, names[i % names.length]));
  }

  _makeVillage(isle, name) {
    const huts = [];
    const hutCount = randInt(3, 5);
    for (let i = 0; i < hutCount; i++) {
      const a = rand(0, TWO_PI);
      const r = rand(isle.radius * 0.15, isle.radius * 0.5);
      huts.push({
        x: isle.x + Math.cos(a) * r,
        y: isle.y + Math.sin(a) * r,
        size: rand(11, 16),
        rot: rand(-0.3, 0.3),
      });
    }

    const villagers = [];
    const vc = randInt(3, 5);
    for (let i = 0; i < vc; i++) {
      const a = rand(0, TWO_PI);
      const r = rand(0, isle.radius * 0.45);
      villagers.push(new Villager(isle.x + Math.cos(a) * r, isle.y + Math.sin(a) * r, isle));
    }

    const ca = rand(0, TWO_PI);
    const cr = rand(0, isle.radius * 0.3);
    const chest = {
      x: isle.x + Math.cos(ca) * cr,
      y: isle.y + Math.sin(ca) * cr,
      value: randInt(40, 90),
    };

    return { name, island: isle, huts, villagers, chest, plundered: false };
  }

  _collisions() {
    // Cannonballs vs ships & islands
    for (const b of this.cannonballs) {
      if (b.dead) continue;

      let hitIsland = false;
      for (const isle of this.world.islands) {
        if (distSq(b.x, b.y, isle.x, isle.y) < (isle.radius + b.radius) ** 2) {
          hitIsland = true;
          break;
        }
      }
      if (hitIsland) {
        b.dead = true;
        this.spawnSplash(b.x, b.y);
        continue;
      }

      const ships = [this.player, ...this.enemies];
      for (const s of ships) {
        if (s.dead || s.faction === b.faction) continue;
        if (distSq(b.x, b.y, s.x, s.y) < (s.radius + b.radius) ** 2) {
          s.takeDamage(b.damage, this);
          b.dead = true;
          this.spawnSplash(b.x, b.y);
          this.spawnSmoke(b.x, b.y);
          if (s.isPlayer) this.shake(8);
          break;
        }
      }

      // Your shots can also bring down skyrate airships.
      if (!b.dead && b.faction === "player") {
        for (const a of this.airships) {
          if (distSq(b.x, b.y, a.x, a.y) < (a.radius + b.radius) ** 2) {
            a.takeDamage(b.damage, this);
            b.dead = true;
            this.spawnSmoke(b.x, b.y);
            break;
          }
        }
      }
    }

    // Player scooping up treasure
    for (const t of this.treasures) {
      if (t.dead) continue;
      if (distSq(this.player.x, this.player.y, t.x, t.y) <
          (this.player.radius + t.radius) ** 2) {
        t.dead = true;
        this.gold += t.value;
        this._spawnPickupBurst(t.x, t.y);
      }
    }
  }

  onShipSunk(ship) {
    // A satisfying sink: smoke, splash, and a screen kick.
    for (let i = 0; i < 18; i++) {
      const a = rand(0, TWO_PI);
      const sp = rand(20, 120);
      this.particles.push(new Particle(ship.x, ship.y, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.5, 1.1), size: rand(3, 7),
        color: i % 2 ? "#444" : "#caa24a", grow: 6,
      }));
    }
    this.shake(12);

    if (ship.isPlayer) {
      this.gameOver = true;
      this._showGameOver();
    } else {
      this.shipsSunk++;
      // Sunken ships spill their loot.
      const drops = randInt(1, 3);
      for (let i = 0; i < drops; i++) {
        this.treasures.push(new Treasure(
          ship.x + rand(-30, 30),
          ship.y + rand(-30, 30),
          randInt(15, 40)
        ));
      }
    }
  }

  // ---- Skyrates (flying airships) ----
  _spawnAirship() {
    // Drift in from somewhere off-screen around the player.
    const ang = rand(0, TWO_PI);
    const d = 820;
    const x = clamp(this.player.x + Math.cos(ang) * d, 0, this.world.size);
    const y = clamp(this.player.y + Math.sin(ang) * d, 0, this.world.size);
    this.airships.push(new Airship(x, y));
  }

  dropBomb(airship, player) {
    // Lead the target a little so dodging actually works.
    const lead = 0.55;
    const tx = player.x + Math.cos(player.angle) * player.speed * lead;
    const ty = player.y + Math.sin(player.angle) * player.speed * lead;
    this.bombs.push(new Bomb(airship.x, airship.y, tx, ty));
  }

  onSkyrateDowned(airship) {
    this.skyratesDowned++;
    this.spawnExplosion(airship.x, airship.y);
    this.shake(16);
    // A skyrate's hoard rains down — sail through it to collect.
    const drops = randInt(5, 7);
    for (let i = 0; i < drops; i++) {
      this.treasures.push(new Treasure(
        airship.x + rand(-60, 60),
        airship.y + rand(-60, 60),
        randInt(25, 55)
      ));
    }
  }

  spawnExplosion(x, y) {
    for (let i = 0; i < 22; i++) {
      const a = rand(0, TWO_PI);
      const sp = rand(30, 150);
      this.particles.push(new Particle(x, y, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.4, 0.9), size: rand(3, 8),
        color: i % 2 ? "#ff8c3b" : "#444", grow: 4,
      }));
    }
    this.spawnSplash(x, y);
  }

  // ---- Spawning helpers ----
  _spawnEnemy() {
    // Spawn out of sight of the player so ships don't pop in.
    let pt;
    for (let tries = 0; tries < 20; tries++) {
      pt = this.world.randomOpenPoint(120);
      if (!this.player || dist(pt.x, pt.y, this.player.x, this.player.y) > 700) break;
    }
    this.enemies.push(new Ship(pt.x, pt.y, "enemy"));
  }

  _spawnTreasure() {
    const pt = this.world.randomOpenPoint(60);
    this.treasures.push(new Treasure(pt.x, pt.y, randInt(8, 20)));
  }

  spawnWake(x, y) {
    this.particles.push(new Particle(x, y, {
      life: 0.8, size: 3, color: "rgba(255,255,255,0.9)", grow: 8,
    }));
  }
  spawnSmoke(x, y) {
    for (let i = 0; i < 4; i++) {
      this.particles.push(new Particle(x, y, {
        vx: rand(-20, 20), vy: rand(-20, 20),
        life: rand(0.3, 0.7), size: rand(2, 5), color: "#bbb", grow: 10,
      }));
    }
  }
  spawnSplash(x, y) {
    for (let i = 0; i < 6; i++) {
      const a = rand(0, TWO_PI);
      this.particles.push(new Particle(x, y, {
        vx: Math.cos(a) * rand(20, 70), vy: Math.sin(a) * rand(20, 70),
        life: rand(0.2, 0.5), size: rand(1.5, 3.5),
        color: "rgba(200,235,255,0.95)", grow: 2,
      }));
    }
  }
  _spawnPickupBurst(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = rand(0, TWO_PI);
      this.particles.push(new Particle(x, y, {
        vx: Math.cos(a) * rand(30, 90), vy: Math.sin(a) * rand(30, 90),
        life: rand(0.3, 0.6), size: rand(2, 4), color: "#f0c860", grow: -2,
      }));
    }
  }

  shake(n) {
    this.shakeAmt = Math.max(this.shakeAmt, n);
  }

  // ---- Render ----
  render() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // The plunder battle is its own full-screen view.
    if (this.mode === "plunder" && this.battle) {
      this.battle.draw(ctx, this.canvas);
      return;
    }

    // Ocean base (drawn in screen space so it always fills the view).
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#1b6f93");
    grad.addColorStop(1, "#0c3a54");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Enter world space (with screen shake).
    const sx = (Math.random() * 2 - 1) * this.shakeAmt;
    const sy = (Math.random() * 2 - 1) * this.shakeAmt;
    ctx.save();
    ctx.translate(-this.camX + sx, -this.camY + sy);

    const view = { x: this.camX, y: this.camY, w: W, h: H };
    this._drawWaves(ctx, view);
    this.world.draw(ctx, view);
    this._drawPort(ctx);
    this._drawVillages(ctx, view);

    for (const t of this.treasures) t.draw(ctx);
    for (const p of this.particles) p.draw(ctx);
    for (const bomb of this.bombs) bomb.draw(ctx); // target rings sit on the water
    for (const e of this.enemies) e.draw(ctx);
    this.player.draw(ctx);
    for (const b of this.cannonballs) b.draw(ctx);
    for (const a of this.airships) a.draw(ctx); // skyrates fly above everything
    this._drawMoveTarget(ctx);

    ctx.restore();

    this._drawMinimap();
  }

  // Scrolling wave glints give the open ocean a sense of motion.
  _drawWaves(ctx, view) {
    const spacing = 80;
    const startX = Math.floor(view.x / spacing) * spacing;
    const startY = Math.floor(view.y / spacing) * spacing;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (let x = startX; x < view.x + view.w + spacing; x += spacing) {
      for (let y = startY; y < view.y + view.h + spacing; y += spacing) {
        const phase = x * 0.01 + y * 0.013 + this.time * 0.9;
        const off = Math.sin(phase) * 4;
        const a = 0.05 + 0.05 * (Math.sin(phase) * 0.5 + 0.5);
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath();
        ctx.moveTo(x - 6, y + off);
        ctx.lineTo(x + 6, y - off);
        ctx.stroke();
      }
    }
  }

  _drawMinimap() {
    const ctx = this.mctx;
    const S = this.minimap.width; // square
    const scale = S / this.world.size;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "rgba(12,58,84,0.85)";
    ctx.fillRect(0, 0, S, S);

    // Islands
    ctx.fillStyle = "#cdbd86";
    for (const isle of this.world.islands) {
      ctx.beginPath();
      ctx.arc(isle.x * scale, isle.y * scale, isle.radius * scale, 0, TWO_PI);
      ctx.fill();
    }
    // Treasure
    ctx.fillStyle = "#f0c860";
    for (const t of this.treasures) {
      ctx.fillRect(t.x * scale - 1, t.y * scale - 1, 2.5, 2.5);
    }
    // Enemies
    ctx.fillStyle = "#e74c3c";
    for (const e of this.enemies) {
      ctx.beginPath();
      ctx.arc(e.x * scale, e.y * scale, 2.5, 0, TWO_PI);
      ctx.fill();
    }
    // Skyrates
    ctx.fillStyle = "#c77dff";
    for (const a of this.airships) {
      ctx.beginPath();
      ctx.arc(a.x * scale, a.y * scale, 3.5, 0, TWO_PI);
      ctx.fill();
    }
    // Villages
    ctx.fillStyle = "#f0a04b";
    for (const v of this.villages) {
      ctx.fillRect(v.island.x * scale - 2, v.island.y * scale - 2, 4, 4);
    }

    // Home port
    ctx.fillStyle = "#5ad1ff";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⚓", this.port.x * scale, this.port.y * scale);

    // Your ship
    ctx.fillStyle = "#46e08a";
    ctx.beginPath();
    ctx.arc(this.player.x * scale, this.player.y * scale, 3.5, 0, TWO_PI);
    ctx.fill();
  }

  _updateHUD() {
    const frac = clamp(this.player.health / this.player.maxHealth, 0, 1);
    document.getElementById("health-fill").style.width = frac * 100 + "%";
    document.getElementById("gold").textContent = `🪙 ${this.gold} gold`;
    document.getElementById("bounty").textContent = `☠️ Ships sunk: ${this.shipsSunk}`;
    document.getElementById("skyrates").textContent = `🎈 Skyrates downed: ${this.skyratesDowned}`;
  }

  // ---- Port & click-to-move rendering ----
  _drawPort(ctx) {
    const p = this.port;
    ctx.save();
    ctx.translate(p.x, p.y);

    // Dock range ring — gentle pulse when you can dock.
    const inRange = this.canDock();
    ctx.strokeStyle = inRange ? "rgba(90,209,255,0.8)" : "rgba(90,209,255,0.3)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, p.radius, 0, TWO_PI);
    ctx.stroke();

    // Wooden dock platform
    ctx.fillStyle = "#8a5a2b";
    ctx.strokeStyle = "#5b3a1a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.rect(-46, -34, 92, 68);
    ctx.fill();
    ctx.stroke();
    // Planks
    ctx.strokeStyle = "rgba(91,58,26,0.6)";
    ctx.lineWidth = 1.5;
    for (let i = -34; i <= 34; i += 12) {
      ctx.beginPath();
      ctx.moveTo(-46, i);
      ctx.lineTo(46, i);
      ctx.stroke();
    }
    // Harbor hut
    ctx.fillStyle = "#b5651d";
    ctx.fillRect(-22, -22, 44, 30);
    ctx.fillStyle = "#7a1f1f"; // roof
    ctx.beginPath();
    ctx.moveTo(-28, -22);
    ctx.lineTo(0, -40);
    ctx.lineTo(28, -22);
    ctx.closePath();
    ctx.fill();
    // Flag
    ctx.strokeStyle = "#3a2410";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, -22);
    ctx.lineTo(30, -50);
    ctx.stroke();
    ctx.fillStyle = "#f0c860";
    ctx.fillRect(30, -50, 16, 10);

    // Label
    ctx.fillStyle = "#f5e9c9";
    ctx.font = "bold 16px Trebuchet MS, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⚓ THE PIRATE'S COVE", 0, 58);

    ctx.restore();
  }

  // Draw all villages: huts, treasure chest, wandering villagers, name banner.
  _drawVillages(ctx, view) {
    for (const v of this.villages) {
      const isle = v.island;
      // Cull villages whose island is fully off-screen.
      if (
        isle.x + isle.radius < view.x || isle.x - isle.radius > view.x + view.w ||
        isle.y + isle.radius < view.y || isle.y - isle.radius > view.y + view.h
      ) continue;

      for (const h of v.huts) this._drawHut(ctx, h);

      // Treasure chest (until the village is plundered)
      if (!v.plundered) {
        const ch = v.chest;
        ctx.save();
        ctx.translate(ch.x, ch.y);
        ctx.fillStyle = "#6b4423";
        ctx.strokeStyle = "#3a2410";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(-8, -6, 16, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#f0c860"; // lid band + lock
        ctx.fillRect(-8, -1, 16, 3);
        ctx.fillRect(-2, -3, 4, 5);
        ctx.restore();
      }

      for (const villager of v.villagers) villager.draw(ctx);

      // Name banner above the island
      ctx.fillStyle = "rgba(245,233,201,0.92)";
      ctx.font = "bold 15px Trebuchet MS, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🏝️ " + v.name, isle.x, isle.y - isle.radius - 10);
    }
  }

  _drawHut(ctx, h) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    const s = h.size;
    // Walls
    ctx.fillStyle = "#9c6b3f";
    ctx.strokeStyle = "#5b3a1a";
    ctx.lineWidth = 2;
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.strokeRect(-s, -s, s * 2, s * 2);
    // Thatched roof (top-down: a lighter inset square + ridge line)
    ctx.fillStyle = "#c79a5b";
    ctx.fillRect(-s * 0.8, -s * 0.8, s * 1.6, s * 1.6);
    ctx.strokeStyle = "rgba(91,58,26,0.7)";
    ctx.beginPath();
    ctx.moveTo(-s * 0.8, 0);
    ctx.lineTo(s * 0.8, 0);
    ctx.stroke();
    ctx.restore();
  }

  _drawMoveTarget(ctx) {
    const t = this.player.moveTarget;
    if (!t || this.player.dead) return;
    const pulse = 9 + Math.sin(this.time * 6) * 3;
    ctx.strokeStyle = "rgba(245,233,201,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(t.x, t.y, pulse, 0, TWO_PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(t.x - 5, t.y - 5); ctx.lineTo(t.x + 5, t.y + 5);
    ctx.moveTo(t.x + 5, t.y - 5); ctx.lineTo(t.x - 5, t.y + 5);
    ctx.stroke();
  }

  // ---- Input: mouse ----
  _onCanvasMouseDown(e) {
    if (!this.running || this.gameOver || this.shopOpen) return;
    const wx = e.clientX + this.camX;
    const wy = e.clientY + this.camY;

    if (this.mode === "plunder") {
      // The battle is screen-space; forward the raw click to the grid.
      if (e.button === 0 && this.battle) this.battle.handleClick(e.clientX, e.clientY);
      return;
    }

    if (e.button === 0) {
      // Left-click: set sail for that point.
      this.player.moveTarget = { x: wx, y: wy };
    } else if (e.button === 2) {
      // Right-click: open fire on the side facing the cursor.
      this._fireAtCursor(wx, wy);
    }
  }

  _fireAtCursor(wx, wy) {
    const p = this.player;
    if (p.dead || p.cooldown > 0) return;
    p.fireAt(this, wx, wy); // cannonballs fly straight at the click point
    p.cooldown = p.fireCooldownTime;
    this.shake(6);
  }

  _onMapClick(e) {
    if (!this.running || this.gameOver || this.shopOpen || this.mode !== "sailing") return;
    const r = this.minimap.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    this.player.moveTarget = {
      x: clamp(fx, 0, 1) * this.world.size,
      y: clamp(fy, 0, 1) * this.world.size,
    };
  }

  // ---- Shop ----
  openShop() {
    if (!this.canDock()) return;
    this.shopOpen = true;
    this.player.moveTarget = null; // you're docked — stop drifting
    document.getElementById("dock-prompt").classList.add("hidden");
    document.getElementById("shop").classList.remove("hidden");
    this.renderShop();
  }

  closeShop() {
    this.shopOpen = false;
    document.getElementById("shop").classList.add("hidden");
    // Reset the clock so the frozen time doesn't cause a big dt jump.
    this.lastTime = performance.now();
  }

  buyShip(tierIndex) {
    const tier = TIERS[tierIndex];
    if (tierIndex <= this.upgrades.shipTier) return; // already own / current
    if (this.gold < tier.cost) return;
    this.gold -= tier.cost;
    this.upgrades.shipTier = tierIndex;
    this.applyUpgrades();
    this.player.health = this.player.maxHealth; // a brand new ship is pristine
    this.renderShop();
  }

  buyUpgrade(key) {
    const def = UPGRADES.find((u) => u.key === key);
    const level = this.upgrades[key];
    if (level >= def.max) return;
    const cost = upgradeCost(def, level);
    if (this.gold < cost) return;
    this.gold -= cost;
    this.upgrades[key]++;
    if (key === "hull") this.player.health += 25; // new plating, more hull now
    this.applyUpgrades();
    this.renderShop();
  }

  repairHull() {
    const missing = this.player.maxHealth - this.player.health;
    if (missing <= 0) return;
    const cost = Math.ceil(missing * 0.4);
    if (this.gold < cost) return;
    this.gold -= cost;
    this.player.health = this.player.maxHealth;
    this.renderShop();
  }

  // Rebuild the shop DOM from current state. Buttons carry data-attributes
  // that one delegated listener (wired in main.js) turns into purchases.
  renderShop() {
    const g = this.gold;
    let html = `<div class="shop-gold">🪙 ${g} gold</div>`;

    // Ships
    html += `<h2>🚢 Ships</h2><div class="shop-grid">`;
    TIERS.forEach((tier, i) => {
      const owned = i <= this.upgrades.shipTier;
      const current = i === this.upgrades.shipTier;
      const afford = g >= tier.cost;
      let btn;
      if (current) btn = `<span class="tag current">Current</span>`;
      else if (owned) btn = `<span class="tag">Owned</span>`;
      else btn = `<button data-buy="ship" data-i="${i}" ${afford ? "" : "disabled"}>Buy · ${tier.cost}🪙</button>`;
      html += `
        <div class="card">
          <div class="card-title">${tier.name}</div>
          <div class="card-stats">🛡️ ${tier.hp} · ⛵ ${tier.speed} · 🔫 ${tier.cannons}/side</div>
          ${btn}
        </div>`;
    });
    html += `</div>`;

    // Upgrades
    html += `<h2>🛠️ Upgrades & Guns</h2><div class="shop-grid">`;
    UPGRADES.forEach((def) => {
      const level = this.upgrades[def.key];
      const maxed = level >= def.max;
      const cost = maxed ? 0 : upgradeCost(def, level);
      const afford = g >= cost;
      const pips = "●".repeat(level) + "○".repeat(def.max - level);
      const btn = maxed
        ? `<span class="tag current">Maxed</span>`
        : `<button data-buy="upgrade" data-key="${def.key}" ${afford ? "" : "disabled"}>Buy · ${cost}🪙</button>`;
      html += `
        <div class="card">
          <div class="card-title">${def.icon} ${def.name}</div>
          <div class="card-stats">${def.desc}</div>
          <div class="pips">${pips}</div>
          ${btn}
        </div>`;
    });
    html += `</div>`;

    // Services
    const missing = this.player.maxHealth - this.player.health;
    const repairCost = Math.ceil(missing * 0.4);
    html += `<h2>⚒️ Services</h2><div class="shop-grid">`;
    html += `
      <div class="card">
        <div class="card-title">🔧 Repair Hull</div>
        <div class="card-stats">Hull ${Math.round(this.player.health)}/${this.player.maxHealth}</div>
        ${missing <= 0
          ? `<span class="tag current">Full</span>`
          : `<button data-buy="repair" ${g >= repairCost ? "" : "disabled"}>Repair · ${repairCost}🪙</button>`}
      </div>`;
    html += `</div>`;

    document.getElementById("shop-body").innerHTML = html;
  }

  _showGameOver() {
    document.getElementById("final-score").textContent =
      `You plundered ${this.gold} gold and sank ${this.shipsSunk} ships.`;
    document.getElementById("gameover").classList.remove("hidden");
  }
}
