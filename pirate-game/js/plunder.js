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

class Battle {
  constructor(game, village) {
    this.game = game;
    this.village = village;
    this.cols = PB_COLS;
    this.rows = PB_ROWS;

    this._layout();
    this._buildTerrain();
    this._buildUnits();

    // Loot scales with how stoutly the village is defended.
    this.loot = village.chest.value + 25 * this.units.filter((u) => u.side === "enemy").length;

    this.phase = "player";   // "player" | "enemy" | "over"
    this.selected = null;
    this.moveSet = new Set(); // "x,y" tiles the selected unit can reach
    this.attackable = [];     // enemy units the selected unit can hit now
    this.flashes = [];        // brief hit markers
    this.enemyQueue = [];
    this.enemyTimer = 0;
    this.message = "Your turn — storm the village!";
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
    // Scatter cover (huts/rocks) in the middle — never in the spawn columns.
    const n = randInt(5, 9);
    for (let i = 0; i < n; i++) {
      const x = randInt(2, this.cols - 3);
      const y = randInt(1, this.rows - 2);
      this.tiles[y][x].obstacle = true;
    }
    // The loot sits on the defenders' side.
    this.treasure = { x: this.cols - 2, y: Math.floor(this.rows / 2) };
    this.tiles[this.treasure.y][this.treasure.x].obstacle = false;
  }

  _buildUnits() {
    this.units = [];
    const crew = this.game.upgrades.crew || 0;
    const playerCount = 1 + crew;
    const enemyCount = Math.max(2, playerCount + 1);

    const left = this._spawnCells("left", playerCount);
    this.units.push(this._mk("player", left[0], "Captain", 20, 6, 4));
    for (let i = 1; i < playerCount; i++) {
      this.units.push(this._mk("player", left[i], "Crew", 12, 4, 4));
    }

    const right = this._spawnCells("right", enemyCount);
    for (let i = 0; i < enemyCount; i++) {
      this.units.push(this._mk("enemy", right[i], "Defender", 11, 3, 3));
    }
  }

  // Distinct, obstacle-free cells in a side's spawn columns.
  _spawnCells(side, count) {
    const cols = side === "left" ? [0, 1] : [this.cols - 1, this.cols - 2];
    const cells = [];
    for (const c of cols) {
      for (let r = 0; r < this.rows && cells.length < count; r++) cells.push({ x: c, y: r });
      if (cells.length >= count) break;
    }
    return cells;
  }

  _mk(side, cell, name, hp, atk, move) {
    return {
      side, name, x: cell.x, y: cell.y,
      hp, maxHp: hp, atk, move, range: 1,
      hasMoved: false, hasActed: false, alive: true,
    };
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

  _attackTargets(unit) {
    const out = [];
    for (const [dx, dy] of PB_DIRS) {
      const e = this.unitAt(unit.x + dx, unit.y + dy);
      if (e && e.side !== unit.side) out.push(e);
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
      att.hp -= Math.ceil(def.atk * 0.6);
      this.flashes.push({ x: att.x, y: att.y, life: 0.3 });
      if (att.hp <= 0) att.alive = false;
    }
  }

  _checkEnd() {
    const enemies = this.units.filter((u) => u.alive && u.side === "enemy");
    const players = this.units.filter((u) => u.alive && u.side === "player");
    if (enemies.length === 0) {
      this.phase = "over";
      this.message = "Victory!";
      this.game.onPlunderEnd("win", this.loot);
    } else if (players.length === 0) {
      this.phase = "over";
      this.message = "Defeated!";
      this.game.onPlunderEnd("lose", 0);
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

    if (this._manhattan(e, target) > 1) {
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

    // Strike if we ended up adjacent to anyone.
    const victim = this.units.find(
      (u) => u.alive && u.side === "player" && this._manhattan(e, u) === 1
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

    // Earthy backdrop
    ctx.fillStyle = "#20301c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cell = this.cell;
    // Tiles
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const px = this.ox + x * cell;
        const py = this.oy + y * cell;
        ctx.fillStyle = (x + y) % 2 ? "#3f6b39" : "#447439"; // grass checker
        ctx.fillRect(px, py, cell, cell);
        if (this.tiles[y][x].obstacle) this._drawObstacle(ctx, px, py, cell);
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, cell, cell);
      }
    }

    // Treasure tile
    this._drawChest(ctx, this.ox + this.treasure.x * cell, this.oy + this.treasure.y * cell, cell);

    // Movement highlights
    if (this.phase === "player") {
      ctx.fillStyle = "rgba(90,170,255,0.30)";
      for (const k of this.moveSet) {
        const [x, y] = k.split(",").map(Number);
        ctx.fillRect(this.ox + x * cell, this.oy + y * cell, cell, cell);
      }
      // Attackable enemies
      ctx.strokeStyle = "rgba(231,76,60,0.95)";
      ctx.lineWidth = 3;
      for (const e of this.attackable) {
        ctx.strokeRect(this.ox + e.x * cell + 3, this.oy + e.y * cell + 3, cell - 6, cell - 6);
      }
    }

    // Selected ring
    if (this.selected) {
      ctx.strokeStyle = "#f0c860";
      ctx.lineWidth = 3;
      ctx.strokeRect(this.ox + this.selected.x * cell + 2, this.oy + this.selected.y * cell + 2, cell - 4, cell - 4);
    }

    // Units
    for (const u of this.units) if (u.alive) this._drawUnit(ctx, u, cell);

    // Hit flashes
    for (const f of this.flashes) {
      ctx.fillStyle = `rgba(255,80,60,${(f.life / 0.3) * 0.6})`;
      ctx.fillRect(this.ox + f.x * cell, this.oy + f.y * cell, cell, cell);
    }
  }

  _drawObstacle(ctx, px, py, cell) {
    const m = cell * 0.16;
    ctx.fillStyle = "#7a4a2a";
    ctx.fillRect(px + m, py + m, cell - 2 * m, cell - 2 * m);
    ctx.fillStyle = "#9c6b3f";
    ctx.fillRect(px + m, py + m, cell - 2 * m, (cell - 2 * m) * 0.45);
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

    // body
    const captain = u.name === "Captain";
    ctx.fillStyle = u.side === "enemy" ? "#a8322d" : captain ? "#2a6f97" : "#2e8b57";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // captain's hat dot
    if (captain) {
      ctx.fillStyle = "#15110a";
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.2, r * 0.45, 0, TWO_PI);
      ctx.fill();
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
