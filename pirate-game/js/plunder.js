// Grid-based, turn-based tactics battle used when plundering a village.
// Self-contained: the Game creates a Battle, forwards clicks + the loop to it,
// and is told the outcome via game.onPlunderEnd(result, loot).
//
// Flow each player turn: select a unit -> (optionally) click a highlighted
// tile to move -> click an adjacent enemy to attack. "End Turn" hands the
// floor to the defenders' AI. Wipe out the defenders to plunder the village.

const PB_COLS = 12;
const PB_ROWS = 8;
const PB_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Cheap deterministic noise so grass texture is stable frame-to-frame.
function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

class Battle {
  constructor(game, village) {
    this.game = game;
    this.village = village;
    this.cols = PB_COLS;
    this.rows = PB_ROWS;

    this._layout();
    this._buildTerrain();
    this._buildUnits();
    this._decorate();

    // Loot scales with how stoutly the village is defended.
    this.loot = village.chest.value + 25 * this.units.filter((u) => u.side === "enemy").length;

    this.phase = "player";   // "player" | "enemy" | "over"
    this.selected = null;
    this.moveSet = new Set(); // "x,y" tiles the selected unit can reach
    this.attackable = [];     // enemy units the selected unit can hit now
    this.flashes = [];        // brief hit markers
    this.enemyQueue = [];
    this.enemyTimer = 0;
    this.message = "Your turn — reach the chest or rout the defenders!";
  }

  // ---- Setup ----
  _layout() {
    const cw = this.game.canvas.width;
    const ch = this.game.canvas.height;
    const cell = Math.floor(Math.min((cw * 0.92) / this.cols, (ch * 0.78) / this.rows));
    this.cell = clamp(cell, 34, 84);
    this.ox = Math.floor((cw - this.cell * this.cols) / 2);
    this.oy = Math.floor((ch - this.cell * this.rows) / 2) + 14;
  }

  _buildTerrain() {
    this.tiles = [];
    for (let y = 0; y < this.rows; y++) {
      const row = [];
      for (let x = 0; x < this.cols; x++) row.push({ obstacle: false });
      this.tiles.push(row);
    }
    // The loot chest sits at the top-centre — the objective you push toward.
    this.treasure = { x: Math.floor(this.cols / 2), y: 0 };

    // Scatter cover through the middle band, leaving the top (defenders +
    // chest), the bottom (your landing path) and the central road clear.
    const cxCol = Math.floor(this.cols / 2);
    const n = randInt(5, 9);
    for (let i = 0; i < n; i++) {
      const x = randInt(1, this.cols - 2);
      const y = randInt(2, this.rows - 3);
      if (x === cxCol) continue; // keep the central path open
      const t = this.tiles[y][x];
      t.obstacle = true;
      t.kind = pick(["hut", "hut", "rocks", "crates"]); // mostly huts
    }
    this.tiles[this.treasure.y][this.treasure.x].obstacle = false;
  }

  _buildUnits() {
    this.units = [];
    const crew = this.game.upgrades.crew || 0;
    const sword = (this.game.upgrades.cutlass || 0) * 2;  // +attack
    const gun = this.game.upgrades.musket || 0;           // +range
    const playerCount = 1 + crew;
    const enemyCount = Math.max(2, playerCount + 1);

    // You land at the bottom and fight your way up.
    const start = this._spawnCells("player", playerCount);
    this.units.push(this._mk("player", start[0], "Captain", 26, 8 + sword, 3, 1 + gun));
    for (let i = 1; i < playerCount; i++) {
      this.units.push(this._mk("player", start[i], "Crew", 16, 5 + sword, 3, 1 + gun));
    }

    const def = this._spawnCells("enemy", enemyCount);
    for (let i = 0; i < enemyCount; i++) {
      this.units.push(this._mk("enemy", def[i], "Defender", 10, 3, 3, 1));
    }
  }

  // Spawn cells: the player lands on a thin path up the middle from the
  // bottom; defenders hold the top rows.
  _spawnCells(side, count) {
    const cells = [];
    if (side === "player") {
      const cx = Math.floor(this.cols / 2);
      for (const c of [cx, cx - 1, cx + 1]) { // widen the lane only if needed
        for (let r = this.rows - 1; r >= 0 && cells.length < count; r--) cells.push({ x: c, y: r });
        if (cells.length >= count) break;
      }
    } else {
      for (let r = 0; r < this.rows && cells.length < count; r++) {
        for (let c = 1; c < this.cols - 1 && cells.length < count; c++) {
          if (c === this.treasure.x && r === this.treasure.y) continue; // leave the chest free
          cells.push({ x: c, y: r });
        }
      }
    }
    return cells;
  }

  _mk(side, cell, name, hp, atk, move, range) {
    return {
      side, name, x: cell.x, y: cell.y,
      hp, maxHp: hp, atk, move, range,
      hasMoved: false, hasActed: false, alive: true,
    };
  }

  // Cosmetic dressing so the field reads as a village on an island.
  _decorate() {
    // Per-vertex wobble for the organic land outline.
    this.outline = [];
    for (let i = 0; i < 30; i++) this.outline.push(0.9 + Math.random() * 0.16);

    // Palms ringing the beach.
    this.palms = [];
    const pc = randInt(6, 9);
    for (let i = 0; i < pc; i++) {
      this.palms.push({ ang: (i / pc) * TWO_PI + rand(-0.25, 0.25), h: rand(0.55, 0.9) });
    }

    // The main road runs up the middle (where you land), with a cross street.
    const cx = Math.floor(this.cols / 2);
    const my = Math.floor(this.rows / 2);
    this.paths = [
      [{ x: cx, y: this.rows - 1 }, { x: cx, y: 0 }],
      [{ x: 0, y: my }, { x: this.cols - 1, y: my }],
    ];
  }

  // ---- Queries ----
  unitAt(x, y) {
    return this.units.find((u) => u.alive && u.x === x && u.y === y) || null;
  }

  _manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  // Breadth-first flood of empty, passable tiles within a unit's move range.
  _reachable(unit) {
    const key = (x, y) => x + "," + y;
    const distMap = { [key(unit.x, unit.y)]: 0 };
    const set = new Set();
    const queue = [{ x: unit.x, y: unit.y }];
    while (queue.length) {
      const c = queue.shift();
      const d = distMap[key(c.x, c.y)];
      if (d >= unit.move) continue;
      for (const [dx, dy] of PB_DIRS) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        if (this.tiles[ny][nx].obstacle) continue;
        if (this.unitAt(nx, ny)) continue; // can't pass through anyone
        const k = key(nx, ny);
        if (distMap[k] === undefined) {
          distMap[k] = d + 1;
          set.add(k);
          queue.push({ x: nx, y: ny });
        }
      }
    }
    return set;
  }

  // Enemies within this unit's attack range (Manhattan). Melee = 1; muskets
  // reach further, and can fire without drawing a counter from melee foes.
  _attackTargets(unit) {
    const out = [];
    for (const u of this.units) {
      if (u.alive && u.side !== unit.side && this._manhattan(unit, u) <= unit.range) out.push(u);
    }
    return out;
  }

  _done(u) {
    // A unit is finished when it has attacked, or moved with nothing to hit.
    return u.hasActed || (u.hasMoved && this._attackTargets(u).length === 0);
  }

  _select(unit) {
    this.selected = unit;
    this.moveSet = unit && !unit.hasMoved ? this._reachable(unit) : new Set();
    this.attackable = unit ? this._attackTargets(unit) : [];
  }

  // ---- Player input ----
  handleClick(sx, sy) {
    if (this.phase !== "player") return;
    const g = this.screenToGrid(sx, sy);
    if (!g) return;
    const clicked = this.unitAt(g.x, g.y);
    const sel = this.selected;

    if (sel) {
      // Attack a highlighted enemy.
      if (clicked && clicked.side === "enemy" && this.attackable.includes(clicked)) {
        this._resolveAttack(sel, clicked);
        sel.hasActed = true;
        this._select(null);
        this._checkEnd();
        return;
      }
      // Move onto a reachable empty tile.
      if (!clicked && this.moveSet.has(g.x + "," + g.y)) {
        sel.x = g.x;
        sel.y = g.y;
        sel.hasMoved = true;
        // Reaching the loot chest cracks it open and wins the raid.
        if (sel.x === this.treasure.x && sel.y === this.treasure.y) {
          this._openChest();
          return;
        }
        this._select(sel); // refresh: no more move, maybe new attack targets
        if (this.attackable.length === 0) this._select(null);
        return;
      }
      // Switch to another ready unit, or deselect.
      if (clicked && clicked.side === "player" && !this._done(clicked)) this._select(clicked);
      else this._select(null);
      return;
    }

    if (clicked && clicked.side === "player" && !this._done(clicked)) this._select(clicked);
  }

  endTurn() {
    if (this.phase !== "player") return;
    this._select(null);
    this.phase = "enemy";
    this.message = "Defenders' turn…";
    this.enemyQueue = this.units.filter((u) => u.alive && u.side === "enemy");
    this.enemyTimer = 0.35;
  }

  // ---- Combat ----
  _resolveAttack(att, def) {
    def.hp -= att.atk;
    this.flashes.push({ x: def.x, y: def.y, life: 0.3 });
    this.game.shake(5);
    if (def.hp <= 0) {
      def.alive = false;
      return;
    }
    // Counter-attack if the defender survives and the attacker is in reach.
    if (this._manhattan(att, def) <= def.range) {
      att.hp -= Math.max(1, Math.ceil(def.atk * 0.5));
      this.flashes.push({ x: att.x, y: att.y, life: 0.3 });
      if (att.hp <= 0) att.alive = false;
    }
  }

  // Reaching the chest = grab the loot and go.
  _openChest() {
    if (this.phase === "over") return;
    this.phase = "over";
    this.message = "Loot seized!";
    this._select(null);
    this.game.onPlunderEnd("win", this.loot, `You cracked open the loot chest and escaped with ${this.loot} gold!`);
  }

  _checkEnd() {
    const enemies = this.units.filter((u) => u.alive && u.side === "enemy");
    const players = this.units.filter((u) => u.alive && u.side === "player");
    if (enemies.length === 0) {
      this.phase = "over";
      this.message = "Victory!";
      this.game.onPlunderEnd("win", this.loot, `You routed the defenders and carried off ${this.loot} gold.`);
    } else if (players.length === 0) {
      this.phase = "over";
      this.message = "Defeated!";
      this.game.onPlunderEnd("lose", 0, "Your raiding party was cut down.");
    }
  }

  // ---- Enemy AI (stepped so it's readable) ----
  update(dt) {
    for (const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter((f) => f.life > 0);

    this._syncUI();

    if (this.phase !== "enemy") return;
    this.enemyTimer -= dt;
    if (this.enemyTimer > 0) return;
    this.enemyTimer = 0.35;

    if (this.enemyQueue.length === 0) {
      // Back to the player; refresh everyone's action budget.
      this.phase = "player";
      this.message = "Your turn";
      for (const u of this.units) {
        u.hasMoved = false;
        u.hasActed = false;
      }
      return;
    }

    const e = this.enemyQueue.shift();
    if (e && e.alive) {
      this._enemyAct(e);
      this._checkEnd();
    }
  }

  _enemyAct(e) {
    const targets = this.units.filter((u) => u.alive && u.side === "player");
    if (!targets.length) return;

    // Aim for the closest captain/crew.
    let target = targets[0];
    for (const t of targets) if (this._manhattan(e, t) < this._manhattan(e, target)) target = t;

    if (this._manhattan(e, target) > e.range) {
      // Step toward the target as far as our move range allows.
      const reach = this._reachable(e);
      let best = null;
      let bestD = this._manhattan(e, target);
      for (const k of reach) {
        const [x, y] = k.split(",").map(Number);
        const d = Math.abs(x - target.x) + Math.abs(y - target.y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
      if (best) {
        e.x = best.x;
        e.y = best.y;
      }
    }

    // Strike if anyone is now within range.
    const victim = this.units.find(
      (u) => u.alive && u.side === "player" && this._manhattan(e, u) <= e.range
    );
    if (victim) this._resolveAttack(e, victim);
  }

  // ---- View ----
  screenToGrid(sx, sy) {
    const gx = Math.floor((sx - this.ox) / this.cell);
    const gy = Math.floor((sy - this.oy) / this.cell);
    if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return null;
    return { x: gx, y: gy };
  }

  _syncUI() {
    const banner = document.getElementById("plunder-banner");
    const p = this.units.filter((u) => u.alive && u.side === "player").length;
    const e = this.units.filter((u) => u.alive && u.side === "enemy").length;
    banner.textContent = `⚔️ ${this.village.name} — ${this.message}   (You ${p} · Defenders ${e})`;
    const endBtn = document.getElementById("end-turn");
    endBtn.disabled = this.phase !== "player";
  }

  draw(ctx, canvas) {
    this._layout(); // keep grid centered if the window was resized
    const W = canvas.width;
    const H = canvas.height;
    const cell = this.cell;

    const gw = cell * this.cols;
    const gh = cell * this.rows;
    const cx = this.ox + gw / 2;
    const cy = this.oy + gh / 2;
    const hw = gw / 2;
    const hh = gh / 2;

    // The village sits on an island in the sea.
    const sea = ctx.createLinearGradient(0, 0, 0, H);
    sea.addColorStop(0, "#15506e");
    sea.addColorStop(1, "#0c3a54");
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, W, H);

    // Beach + grass as organic blobs so the field isn't a hard rectangle.
    this._islandPath(ctx, cx, cy, hw * 1.62, hh * 1.62);
    ctx.fillStyle = "#e3cf94";
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = "rgba(130,205,205,0.22)"; // shallow-water rim
    ctx.stroke();
    this._islandPath(ctx, cx, cy, hw * 1.42, hh * 1.42);
    ctx.fillStyle = "#4d8e41";
    ctx.fill();

    // Dirt footpaths winding through the village.
    ctx.strokeStyle = "rgba(120,86,45,0.45)";
    ctx.lineWidth = cell * 0.42;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const path of this.paths) {
      ctx.beginPath();
      path.forEach((p, i) => {
        const x = this.ox + (p.x + 0.5) * cell;
        const y = this.oy + (p.y + 0.5) * cell;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }

    // Gentle grass texture + a faint grid (kept subtle so it stays natural,
    // but enough to read tile positions for tactics).
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        ctx.fillStyle = hash2(x, y) < 0.5 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)";
        ctx.fillRect(this.ox + x * cell, this.oy + y * cell, cell, cell);
      }
    }
    ctx.strokeStyle = "rgba(0,0,0,0.10)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= this.cols; x++) {
      ctx.beginPath();
      ctx.moveTo(this.ox + x * cell, this.oy);
      ctx.lineTo(this.ox + x * cell, this.oy + gh);
      ctx.stroke();
    }
    for (let y = 0; y <= this.rows; y++) {
      ctx.beginPath();
      ctx.moveTo(this.ox, this.oy + y * cell);
      ctx.lineTo(this.ox + gw, this.oy + y * cell);
      ctx.stroke();
    }

    // Palms around the beach.
    for (const p of this.palms) {
      const px = cx + Math.cos(p.ang) * hw * 1.5;
      const py = cy + Math.sin(p.ang) * hh * 1.5;
      this._drawPalmAt(ctx, px, py, cell * p.h);
    }

    // Village buildings (obstacles) + the loot chest.
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const t = this.tiles[y][x];
        if (t.obstacle) this._drawObstacle(ctx, this.ox + x * cell, this.oy + y * cell, cell, t.kind);
      }
    }
    // Objective glow so it's clear the chest is the goal.
    const tpx = this.ox + this.treasure.x * cell;
    const tpy = this.oy + this.treasure.y * cell;
    const pulse = 0.5 + 0.5 * Math.sin(this.game.time * 4);
    ctx.strokeStyle = `rgba(240,200,96,${0.45 + 0.4 * pulse})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(tpx + 3, tpy + 3, cell - 6, cell - 6);
    this._drawChest(ctx, tpx, tpy, cell);

    // Movement + attack highlights.
    if (this.phase === "player") {
      ctx.fillStyle = "rgba(90,170,255,0.32)";
      for (const k of this.moveSet) {
        const [x, y] = k.split(",").map(Number);
        ctx.fillRect(this.ox + x * cell, this.oy + y * cell, cell, cell);
      }
      ctx.strokeStyle = "rgba(231,76,60,0.95)";
      ctx.lineWidth = 3;
      for (const e of this.attackable) {
        ctx.strokeRect(this.ox + e.x * cell + 3, this.oy + e.y * cell + 3, cell - 6, cell - 6);
      }
    }

    // Selected ring.
    if (this.selected) {
      ctx.strokeStyle = "#f0c860";
      ctx.lineWidth = 3;
      ctx.strokeRect(this.ox + this.selected.x * cell + 2, this.oy + this.selected.y * cell + 2, cell - 4, cell - 4);
    }

    // Units + hit flashes.
    for (const u of this.units) if (u.alive) this._drawUnit(ctx, u, cell);
    for (const f of this.flashes) {
      ctx.fillStyle = `rgba(255,80,60,${(f.life / 0.3) * 0.6})`;
      ctx.fillRect(this.ox + f.x * cell, this.oy + f.y * cell, cell, cell);
    }
  }

  // Wobbly ellipse used for the beach/grass outlines.
  _islandPath(ctx, cx, cy, ax, ay) {
    const o = this.outline;
    const N = o.length;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const idx = i % N;
      const ang = (idx / N) * TWO_PI;
      const x = cx + Math.cos(ang) * ax * o[idx];
      const y = cy + Math.sin(ang) * ay * o[idx];
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  _drawPalmAt(ctx, x, y, s) {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(x, y + 2, s * 0.4, s * 0.18, 0, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = "#6b4423";
    ctx.lineWidth = Math.max(2, s * 0.16);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - s);
    ctx.stroke();
    ctx.fillStyle = "#2f7d32";
    ctx.beginPath();
    ctx.arc(x, y - s, s * 0.5, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = "#3a9540";
    ctx.beginPath();
    ctx.arc(x - s * 0.22, y - s * 1.04, s * 0.28, 0, TWO_PI);
    ctx.fill();
  }

  _drawObstacle(ctx, px, py, cell, kind) {
    const cx = px + cell / 2;
    const cy = py + cell / 2;

    // soft shadow
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + cell * 0.28, cell * 0.34, cell * 0.16, 0, 0, TWO_PI);
    ctx.fill();

    if (kind === "rocks") {
      ctx.fillStyle = "#8a8f95";
      ctx.beginPath(); ctx.arc(cx - cell * 0.12, cy, cell * 0.2, 0, TWO_PI); ctx.fill();
      ctx.fillStyle = "#a4a9af";
      ctx.beginPath(); ctx.arc(cx + cell * 0.12, cy - cell * 0.05, cell * 0.16, 0, TWO_PI); ctx.fill();
      ctx.fillStyle = "#777c82";
      ctx.beginPath(); ctx.arc(cx + cell * 0.02, cy + cell * 0.12, cell * 0.14, 0, TWO_PI); ctx.fill();
      return;
    }

    if (kind === "crates") {
      const s = cell * 0.5;
      ctx.fillStyle = "#9c6b3f";
      ctx.strokeStyle = "#5b3a1a";
      ctx.lineWidth = 2;
      ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
      ctx.beginPath();
      ctx.moveTo(cx - s / 2, cy - s / 2); ctx.lineTo(cx + s / 2, cy + s / 2);
      ctx.moveTo(cx + s / 2, cy - s / 2); ctx.lineTo(cx - s / 2, cy + s / 2);
      ctx.stroke();
      return;
    }

    // hut (default)
    const s = cell * 0.62;
    ctx.fillStyle = "#9c6b3f";
    ctx.strokeStyle = "#5b3a1a";
    ctx.lineWidth = 2;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
    ctx.fillStyle = "#caa15b"; // thatch
    ctx.fillRect(cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.5);
    ctx.strokeStyle = "rgba(91,58,26,0.6)";
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.42, cy - s * 0.17);
    ctx.lineTo(cx + s * 0.42, cy - s * 0.17);
    ctx.stroke();
    ctx.fillStyle = "#5b3a1a"; // door
    ctx.fillRect(cx - s * 0.12, cy + s * 0.06, s * 0.24, s * 0.24);
  }

  _drawChest(ctx, px, py, cell) {
    const cx = px + cell / 2;
    const cy = py + cell / 2;
    const w = cell * 0.5;
    const h = cell * 0.36;
    ctx.fillStyle = "#6b4423";
    ctx.strokeStyle = "#3a2410";
    ctx.lineWidth = 2;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    ctx.fillStyle = "#f0c860";
    ctx.fillRect(cx - w / 2, cy - h * 0.1, w, h * 0.22);
  }

  _drawUnit(ctx, u, cell) {
    const cx = this.ox + u.x * cell + cell / 2;
    const cy = this.oy + u.y * cell + cell / 2;
    const r = cell * 0.3;

    ctx.globalAlpha = this.phase === "player" && u.side === "player" && this._done(u) ? 0.5 : 1;

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.7, r, r * 0.5, 0, 0, TWO_PI);
    ctx.fill();

    // body (coat)
    const captain = u.name === "Captain";
    ctx.fillStyle = u.side === "enemy" ? "#a8322d" : captain ? "#2a6f97" : "#2e8b57";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // head
    ctx.fillStyle = "#e8b98e";
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.15, r * 0.5, 0, TWO_PI);
    ctx.fill();

    // captain's tricorn hat
    if (captain) {
      ctx.fillStyle = "#15110a";
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.32, r * 0.58, Math.PI, TWO_PI);
      ctx.fill();
      ctx.fillRect(cx - r * 0.58, cy - r * 0.36, r * 1.16, r * 0.16);
    }

    ctx.globalAlpha = 1;

    // HP bar
    const bw = cell * 0.62;
    const frac = clamp(u.hp / u.maxHp, 0, 1);
    const by = cy - r - 8;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(cx - bw / 2, by, bw, 5);
    ctx.fillStyle = u.side === "enemy" ? "#e74c3c" : "#46c46a";
    ctx.fillRect(cx - bw / 2, by, bw * frac, 5);
  }
}
