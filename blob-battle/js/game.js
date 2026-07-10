/* ============================================================
   game.js  —  main controller: states, loop, UI, round flow
   Flow: menu -> draft -> playing -> roundover -> draft -> ... -> matchover
   Each round you DRAFT one new ability (Bopl-style); your kit grows.
   ============================================================ */

BB.Game = class {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.w = canvas.width;
    this.h = canvas.height;

    this.state = "menu";
    this.difficulty = "normal";
    this.winsNeeded = 3; // best of 5
    this.abilityLevel = BB.ABILITY_LEVEL; // "Ability power" mode (1..5); every ability fires at this level
    this.mapChoice = -1; // -1 = Any (random each round); 0..4 = a specific map
    this.botStyle = -1;  // -1 = Any (random each match); 0..4 = a specific playstyle
    this.botStyleResolved = 4;
    this.time = 0;
    this.dt = 1 / 60;

    this.arena = new BB.Arena(this.w, this.h);
    this.blobs = [];
    this.projectiles = [];
    this.bot = null;
    this.stateTimer = 0;
    this.roundIntro = 0;
    this.roundNumber = 0;
    this.matchWinner = null;

    this.prevLMB = false;
    this.prevRMB = false;
    this.cam = { x: this.w / 2, y: this.h / 2, zoom: 1.35 };

    BB.Input.init(canvas);
    BB.Audio.init();
    this._loop = this._loop.bind(this);
    requestAnimationFrame((ts) => { this._last = ts; this._loop(ts); });
  }

  spawn(obj) { this.projectiles.push(obj); }

  /* ---------------- match / round lifecycle ---------------- */
  startMatch() {
    this.roundNumber = 0;
    this.matchWinner = null;
    this.player = new BB.Blob(this, {
      name: "YOU", color: "#46c8ff", abilities: [], spawn: this.arena.spawns[0], isBot: false,
    });
    this.enemy = new BB.Blob(this, {
      name: "BOT", color: "#ff6b6b", abilities: [], spawn: this.arena.spawns[1], isBot: true,
    });
    this.blobs = [this.player, this.enemy];
    // resolve the bot's playstyle for this match (Any = pick one at random)
    this.botStyleResolved = this.botStyle >= 0 ? this.botStyle : BB.randInt(0, BB.PLAYSTYLES.length - 1);
    this.bot = new BB.Bot(this.enemy, this.player, this, this.difficulty);
    this.selected = []; // ability ids the player is picking on the loadout screen
    this.repicked = false;  // has the one match-point kit change been used yet?
    this.repicking = false; // are we currently in a match-point re-pick?
    this.state = "loadout";
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // lock in the player's 3 picks, draft the bot a style-appropriate kit, and fight
  confirmLoadout() {
    this.player.abilities = this.selected.slice();
    if (!this.repicking) this.enemy.abilities = this._botKit();
    this.repicking = false;
    this.startRound();
  }

  // pick 3 abilities from the resolved playstyle's pool
  _botKit() {
    const style = BB.PLAYSTYLES[this.botStyleResolved] || BB.PLAYSTYLES[BB.PLAYSTYLES.length - 1];
    return this._shuffle(style.pool.slice()).slice(0, 3);
  }

  // match point reached — let the player swap their kit before the decider (once)
  goToRepick() {
    this.repicked = true;
    this.repicking = true;
    this.selected = this.player.abilities.slice();
    this.state = "loadout";
  }

  startRound() {
    this.roundNumber++;
    this.arena.forcedLayout = this.mapChoice; // honor the chosen map (or -1 = random)
    this.arena.reset();
    this.projectiles.length = 0;
    BB.Particles.clear();
    this.player.reset(this.arena.spawns[0]);
    this.enemy.reset(this.arena.spawns[1]);
    this.roundIntro = 1.5;
    this._fightPlayed = false;
    BB.Hit.stop = 0;
    // snap the camera to the fresh arena so it doesn't lerp across the map
    this.cam.x = (this.arena.spawns[0].x + this.arena.spawns[1].x) / 2;
    this.cam.y = (this.arena.spawns[0].y + this.arena.spawns[1].y) / 2;
    this.cam.zoom = 1.35;
    this.state = "playing";
  }

  endRound(survivor) {
    this.state = "roundover";
    this.stateTimer = 2.0;
    if (survivor) { survivor.roundWins++; this.lastWinner = survivor; }
    else this.lastWinner = null;
    if (survivor === this.player) BB.Audio.play("win");
    else if (survivor === this.enemy) BB.Audio.play("lose");
    if (this.player.roundWins >= this.winsNeeded || this.enemy.roundWins >= this.winsNeeded) {
      this.matchWinner = this.player.roundWins > this.enemy.roundWins ? this.player : this.enemy;
    }
    this.atMatchPoint = this.player.roundWins === this.winsNeeded - 1 || this.enemy.roundWins === this.winsNeeded - 1;
  }

  /* ---------------- main loop ---------------- */
  _loop(ts) {
    let dt = (ts - this._last) / 1000;
    this._last = ts;
    if (dt > 0.05) dt = 0.05;
    this.dt = dt;
    this.time += dt;

    this.lmbClick = BB.Input.mouse.down && !this.prevLMB;
    this.rmbClick = BB.Input.mouse.rdown && !this.prevRMB;

    this.update(dt);
    this.draw();

    this.prevLMB = BB.Input.mouse.down;
    this.prevRMB = BB.Input.mouse.rdown;
    BB.Input.endFrame();
    requestAnimationFrame(this._loop);
  }

  clicked() { return this.lmbClick; }

  update(dt) {
    BB.Shake.update(dt);
    BB.Particles.update(dt);
    BB.Audio.tick(dt);
    if (this.state === "menu") this.updateMenu();
    else if (this.state === "loadout") this.updateLoadout();
    else if (this.state === "playing") this.updatePlaying(dt);
    else if (this.state === "roundover") this.updateInterlude(dt, false);
    else if (this.state === "matchover") this.updateInterlude(dt, true);
    if (this.state === "playing" || this.state === "roundover" || this.state === "matchover")
      this.updateCamera(dt);
  }

  updateCamera(dt) {
    const alive = this.blobs.filter((b) => !b.dead);
    const pts = alive.length ? alive : this.blobs;
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    for (const b of pts) {
      minx = Math.min(minx, b.x); maxx = Math.max(maxx, b.x);
      miny = Math.min(miny, b.y); maxy = Math.max(maxy, b.y);
    }
    const cx = (minx + maxx) / 2;
    const cy = (miny + maxy) / 2;
    const margin = 300;
    const spanx = maxx - minx + margin * 2;
    const spany = maxy - miny + margin * 2;
    let zoom = Math.min(this.w / spanx, this.h / spany);
    zoom = BB.clamp(zoom, 0.85, 1.9);
    const k = BB.clamp(dt * 4, 0, 1);
    this.cam.x = BB.lerp(this.cam.x, cx, k);
    this.cam.y = BB.lerp(this.cam.y, BB.clamp(cy, 140, this.h - 120), k);
    this.cam.zoom = BB.lerp(this.cam.zoom, zoom, k);
  }

  applyCamera(ctx) {
    ctx.translate(this.w / 2, this.h / 2);
    const s = BB.Shake.amount;
    if (s > 0) ctx.translate(BB.rand(-s, s), BB.rand(-s, s));
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);
  }

  screenToWorld(mx, my) {
    return {
      x: (mx - this.w / 2) / this.cam.zoom + this.cam.x,
      y: (my - this.h / 2) / this.cam.zoom + this.cam.y,
    };
  }

  // solid, mass-based collision between the two blobs (they shove each other)
  resolveBlobs() {
    const a = this.blobs[0], b = this.blobs[1];
    if (!a || !b || a.dead || b.dead) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    const min = a.r + b.r;
    if (d >= min) return;
    if (d < 0.0001) { d = 0.0001; }
    const nx = dx / d, ny = dy / d;
    const overlap = min - d;
    const ma = a.r * a.r, mb = b.r * b.r, tot = ma + mb;
    a.x -= nx * overlap * (mb / tot); a.y -= ny * overlap * (mb / tot);
    b.x += nx * overlap * (ma / tot); b.y += ny * overlap * (ma / tot);
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const e = 0.35;
      const j = (-(1 + e) * vn) / (1 / ma + 1 / mb);
      a.vx -= (j / ma) * nx; a.vy -= (j / ma) * ny;
      b.vx += (j / mb) * nx; b.vy += (j / mb) * ny;
    }
  }

  updatePlaying(dt) {
    if (this.roundIntro > 0) {
      const prev = this.roundIntro;
      this.roundIntro -= dt;
      if (prev > 0.3 && this.roundIntro <= 0.3 && !this._fightPlayed) {
        this._fightPlayed = true;
        BB.Audio.play("fight");
      }
      for (const b of this.blobs) b.update(dt);
      return;
    }

    // hitstop: freeze the world briefly on big impacts for punch
    if (BB.Hit.stop > 0) { BB.Hit.stop = Math.max(0, BB.Hit.stop - dt); return; }

    this.arena.update(dt);

    const inp = BB.Input;
    let dir = 0;
    if (inp.key("a") || inp.key("arrowleft")) dir -= 1;
    if (inp.key("d") || inp.key("arrowright")) dir += 1;
    const jump = inp.pressed("w") || inp.pressed(" ") || inp.pressed("arrowup");
    const jumpHeld = inp.key("w") || inp.key(" ") || inp.key("arrowup");
    if (!this.player.dead) {
      this.player.control(dir, jump, jumpHeld);
      const aim = this.screenToWorld(inp.mouse.x, inp.mouse.y); // aim in world space
      const ax = aim.x, ay = aim.y;
      for (let i = 0; i < this.player.abilities.length; i++) {
        if (inp.pressed(String(i + 1))) this.player.tryAbility(i, ax, ay);
      }
      if (this.lmbClick) this.player.tryAbility(0, ax, ay);
      if (this.rmbClick) this.player.tryAbility(1, ax, ay);
      if (inp.pressed("shift")) this.player.tryAbility(2, ax, ay);
    }

    if (this.bot) this.bot.update(dt);
    for (const b of this.blobs) b.update(dt);
    this.resolveBlobs();

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].update(dt, this) === false) this.projectiles.splice(i, 1);
    }

    const alive = this.blobs.filter((b) => !b.dead);
    if (alive.length <= 1) this.endRound(alive.length === 1 ? alive[0] : null);
  }

  updateInterlude(dt, isMatch) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].update(dt, this) === false) this.projectiles.splice(i, 1);
    }
    for (const b of this.blobs) if (!b.dead) b.update(dt);

    this.stateTimer -= dt;
    if (!isMatch && this.stateTimer <= 0) {
      if (this.matchWinner) this.state = "matchover";
      else if (this.atMatchPoint && !this.repicked) this.goToRepick(); // decider: let the player adjust
      else this.startRound(); // same kits carry into the next round
    }
    if (isMatch && this.clicked()) this.state = "menu";
  }

  /* ---------------- MENU ---------------- */
  menuLayout() {
    const cx = this.w / 2;
    const mkRow = (y, items, bw, bg, h) => {
      let x = cx - (items.length * bw + (items.length - 1) * bg) / 2;
      return items.map((it) => { const r = { ...it, x, y, w: bw, h }; x += bw + bg; return r; });
    };
    const num5 = [1, 2, 3, 4, 5].map((i) => ({ n: i, label: String(i) }));
    const choice6 = [-1, 0, 1, 2, 3, 4].map((v, i) => ({ v, label: i === 0 ? "Any" : String(i) }));
    return {
      diffs: mkRow(124, [{ id: "easy", label: "EASY" }, { id: "normal", label: "NORMAL" }, { id: "hard", label: "HARD" }], 126, 12, 34),
      wins: mkRow(194, num5, 52, 12, 30),
      powers: mkRow(260, num5, 52, 12, 30),
      maps: mkRow(326, choice6, 64, 8, 30),
      styles: mkRow(392, choice6, 64, 8, 30),
      start: { x: cx - 110, y: 440, w: 220, h: 44, label: "START" },
    };
  }

  updateMenu() {
    if (!this.clicked()) return;
    const L = this.menuLayout();
    const m = BB.Input.mouse;
    for (const d of L.diffs) if (this._hit(d, m.x, m.y)) { this.difficulty = d.id; BB.Audio.play("click"); }
    for (const wb of L.wins) if (this._hit(wb, m.x, m.y)) { this.winsNeeded = wb.n; BB.Audio.play("click"); }
    for (const pb of L.powers) if (this._hit(pb, m.x, m.y)) { this.abilityLevel = pb.n; BB.Audio.play("click"); }
    for (const mb of L.maps) if (this._hit(mb, m.x, m.y)) { this.mapChoice = mb.v; BB.Audio.play("click"); }
    for (const sb of L.styles) if (this._hit(sb, m.x, m.y)) { this.botStyle = sb.v; BB.Audio.play("click"); }
    if (this._hit(L.start, m.x, m.y)) { BB.Audio.play("click"); this.startMatch(); }
  }

  /* ---------------- LOADOUT (pick any 3, once) ---------------- */
  loadoutLayout() {
    // quick-combo chips
    const presets = BB.LOADOUT_PRESETS;
    const pw = 148, pgap = 8;
    const ptot = presets.length * pw + (presets.length - 1) * pgap;
    let px = (this.w - ptot) / 2;
    const chips = presets.map((p) => { const r = { ...p, x: px, y: 104, w: pw, h: 28 }; px += pw + pgap; return r; });

    // full ability grid
    const ids = BB.ABILITY_IDS;
    const cols = 6, cw = 143, ch = 78, gx = 10, gy = 8;
    const totalW = cols * cw + (cols - 1) * gx;
    const startX = (this.w - totalW) / 2;
    const startY = 150;
    const cards = ids.map((id, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      return { id, x: startX + c * (cw + gx), y: startY + r * (ch + gy), w: cw, h: ch };
    });
    return { chips, cards, fight: { x: this.w / 2 - 120, y: this.h - 46, w: 240, h: 38, label: "FIGHT ▸" } };
  }

  _isPreset(ids) {
    return ids.length === this.selected.length && ids.every((id) => this.selected.includes(id));
  }

  updateLoadout() {
    if (!this.clicked()) return;
    const L = this.loadoutLayout();
    const m = BB.Input.mouse;
    for (const chip of L.chips) {
      if (this._hit(chip, m.x, m.y)) { this.selected = chip.ids.slice(); BB.Audio.play("click"); return; }
    }
    for (const c of L.cards) {
      if (this._hit(c, m.x, m.y)) {
        const idx = this.selected.indexOf(c.id);
        if (idx >= 0) this.selected.splice(idx, 1);       // deselect
        else if (this.selected.length < 3) this.selected.push(c.id); // select (max 3)
        BB.Audio.play("click");
        return;
      }
    }
    if (this.selected.length === 3 && this._hit(L.fight, m.x, m.y)) {
      BB.Audio.play("click");
      this.confirmLoadout();
    }
  }

  _hit(r, x, y) { return x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h; }

  /* ============================================================
     RENDERING
     ============================================================ */
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this._drawBackground(ctx);

    if (this.state === "menu") this.drawMenu(ctx);
    else if (this.state === "loadout") this.drawLoadout(ctx);
    else {
      // world through the dynamic camera
      ctx.save();
      this.applyCamera(ctx);
      this.arena.draw(ctx, this.time);
      for (const p of this.projectiles) p.draw(ctx);
      for (const b of this.blobs) b.draw(ctx);
      BB.Particles.draw(ctx);
      this._drawWater(ctx);
      this.drawReticle(ctx);
      ctx.restore();
      // UI stays in screen space
      this.drawHUD(ctx);
      if (this.state === "playing" && this.roundIntro > 0) this.drawRoundIntro(ctx);
      if (this.state === "roundover") this.drawRoundBanner(ctx);
      if (this.state === "matchover") this.drawMatchOver(ctx);
    }
  }

  drawReticle(ctx) {
    if (this.state !== "playing" || !this.player || this.player.dead) return;
    const a = this.screenToWorld(BB.Input.mouse.x, BB.Input.mouse.y);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2 / this.cam.zoom;
    const s = 8;
    ctx.beginPath();
    ctx.moveTo(a.x - s, a.y); ctx.lineTo(a.x + s, a.y);
    ctx.moveTo(a.x, a.y - s); ctx.lineTo(a.x, a.y + s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a.x, a.y, s * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // reflective water across the bottom: mirrors islands, blobs and projectiles
  _drawWater(ctx) {
    const wy = this.arena.waterY;
    const t = this.time;
    const left = this.cam.x - this.w, right = this.cam.x + this.w;
    const seg = 26;
    const surfaceY = (x) => wy + Math.sin(x * 0.03 + t * 1.6) * 3;

    ctx.save();
    // clip to the water body (below the rippling surface)
    ctx.beginPath();
    ctx.moveTo(left, wy + this.h);
    ctx.lineTo(left, surfaceY(left));
    for (let x = left; x <= right; x += seg) ctx.lineTo(x, surfaceY(x));
    ctx.lineTo(right, wy + this.h);
    ctx.closePath();
    ctx.clip();

    // mirror the world about the waterline, faded
    ctx.save();
    ctx.translate(0, 2 * wy);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.38;
    this.arena.drawIslands(ctx, t);
    for (const p of this.projectiles) p.draw(ctx);
    for (const b of this.blobs) if (!b.dead) b.draw(ctx);
    ctx.restore();

    // blue depth wash over the reflection
    const g = ctx.createLinearGradient(0, wy, 0, wy + 150);
    g.addColorStop(0, "rgba(44,116,156,0.34)");
    g.addColorStop(1, "rgba(8,26,54,0.82)");
    ctx.fillStyle = g;
    ctx.fillRect(left, wy - 4, right - left, this.h + 60);

    // drifting ripple highlights
    ctx.strokeStyle = "rgba(150,205,255,0.12)";
    ctx.lineWidth = 1.5;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      for (let x = left; x <= right; x += seg) {
        const ry = wy + i * 15 + Math.sin(x * 0.05 + t * 2 + i) * 2.4;
        if (x === left) ctx.moveTo(x, ry); else ctx.lineTo(x, ry);
      }
      ctx.stroke();
    }
    ctx.restore();

    // bright wavy surface line
    ctx.strokeStyle = "rgba(175,218,255,0.55)";
    ctx.lineWidth = 2 / this.cam.zoom;
    ctx.beginPath();
    for (let x = left; x <= right; x += seg) { const yy = surfaceY(x); if (x === left) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
    ctx.stroke();
  }

  _drawBackground(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, "#141a2e");
    g.addColorStop(1, "#0b0f1c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // crescent moon, top-right
    ctx.fillStyle = "rgba(150,170,220,0.12)";
    ctx.beginPath(); ctx.arc(this.w * 0.82, this.h * 0.23, 66, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#141a2e";
    ctx.beginPath(); ctx.arc(this.w * 0.85, this.h * 0.20, 62, 0, Math.PI * 2); ctx.fill();

    // stars (varied brightness + size)
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 70; i++) {
      ctx.globalAlpha = 0.25 + (i % 5) * 0.13;
      const s = i % 9 === 0 ? 2 : 1;
      ctx.fillRect((i * 137.5) % this.w, (i * 61.3) % this.h, s, s);
    }
    ctx.globalAlpha = 1;

    // distant island silhouettes with subtle camera parallax
    const bd = this.arena && this.arena.backdrop;
    if (bd) {
      const cx = this.cam ? this.cam.x : this.w / 2, cy = this.cam ? this.cam.y : this.h / 2;
      ctx.lineCap = "round";
      for (const b of bd) {
        const ox = b.x - (cx - this.w / 2) * b.depth;
        const oy = b.y - (cy - this.h / 2) * b.depth;
        ctx.strokeStyle = `rgba(56,72,116,${0.22 + b.depth * 0.35})`;
        ctx.lineWidth = b.r * 2;
        ctx.beginPath(); ctx.moveTo(ox - b.len / 2, oy); ctx.lineTo(ox + b.len / 2, oy); ctx.stroke();
      }
    }
  }

  _button(ctx, r, opts = {}) {
    const hover = this._hit(r, BB.Input.mouse.x, BB.Input.mouse.y);
    ctx.fillStyle = opts.active ? "#46c8ff" : hover ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.10)";
    BB.roundRect(ctx, r.x, r.y, r.w, r.h, 12);
    ctx.fill();
    ctx.strokeStyle = opts.active ? "#ffffff" : "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = opts.active ? "#08111d" : "#eaf2ff";
    ctx.font = `bold ${opts.font || 22}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  }

  _text(ctx, txt, x, y, size, color, weight = "normal", align = "center") {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(txt, x, y);
  }

  drawMenu(ctx) {
    const cx = this.w / 2;
    this._text(ctx, "BLOB BATTLE", cx, 46, 42, "#ffffff", "bold");
    this._text(ctx, "a physics ability-brawler vs. a bot", cx, 78, 15, "#8fa3c8");
    const L = this.menuLayout();
    this._text(ctx, "Difficulty", cx, 110, 15, "#8fa3c8");
    for (const d of L.diffs) this._button(ctx, d, { active: this.difficulty === d.id, font: 17 });
    this._text(ctx, "First to how many round wins?", cx, 180, 15, "#8fa3c8");
    for (const wb of L.wins) this._button(ctx, wb, { active: this.winsNeeded === wb.n, font: 16 });
    this._text(ctx, "Ability power (Lv 1–5)", cx, 246, 15, "#8fa3c8");
    for (const pb of L.powers) this._button(ctx, pb, { active: this.abilityLevel === pb.n, font: 16 });
    const mapName = this.mapChoice < 0 ? "Any (random each round)" : BB.MAP_NAMES[this.mapChoice];
    this._text(ctx, "Map  —  " + mapName, cx, 312, 15, "#8fa3c8");
    for (const mb of L.maps) this._button(ctx, mb, { active: this.mapChoice === mb.v, font: 15 });
    const styleName = this.botStyle < 0 ? "Any (random each match)" : BB.PLAYSTYLES[this.botStyle].name;
    this._text(ctx, "Bot style  —  " + styleName, cx, 378, 15, "#8fa3c8");
    for (const sb of L.styles) this._button(ctx, sb, { active: this.botStyle === sb.v, font: 15 });
    this._button(ctx, L.start, { font: 24 });

    this._text(ctx, "Move A/D · Jump W/Space · Aim mouse · Abilities 1·2·3 / LMB·RMB·Shift", cx, 506, 13, "#7f92b6");
    this._text(ctx, "Pick ANY 3 abilities or a quick-combo. Ring the bot out!   (M toggles music)", cx, 526, 13, "#7f92b6");
  }

  // a rounded tile with the ability's vector symbol — used on cards and the HUD
  _abilityTile(ctx, ab, x, y, s) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    BB.roundRect(ctx, x, y, s, s, s * 0.22); ctx.fill();
    ctx.strokeStyle = ab.color; ctx.lineWidth = 2;
    BB.roundRect(ctx, x, y, s, s, s * 0.22); ctx.stroke();
    BB.drawAbilityIcon(ctx, ab.id, x + s / 2, y + s / 2, s * 0.72, ab.color);
  }

  drawLoadout(ctx) {
    const cx = this.w / 2;
    if (this.repicking) {
      this._text(ctx, "MATCH POINT — ADJUST YOUR KIT", cx, 42, 30, "#ffd24b", "bold");
      this._text(ctx, `swap any abilities, then fight the decider  —  selected ${this.selected.length}/3`, cx, 74, 16, "#8fa3c8");
    } else {
      this._text(ctx, "CHOOSE YOUR 3 ABILITIES", cx, 42, 34, "#ffffff", "bold");
      this._text(ctx, `pick any 3, or tap a quick-combo  —  selected ${this.selected.length}/3`, cx, 74, 16, "#8fa3c8");
    }
    this._text(ctx, "opponent: " + BB.PLAYSTYLES[this.botStyleResolved].name + " bot", this.w - 18, 22, 13, "#ff9aa0", "normal", "right");

    const L = this.loadoutLayout();

    // quick-combo chips
    for (const chip of L.chips) {
      const active = this._isPreset(chip.ids);
      const hover = this._hit(chip, BB.Input.mouse.x, BB.Input.mouse.y);
      ctx.fillStyle = active ? "rgba(70,200,255,0.22)" : hover ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)";
      BB.roundRect(ctx, chip.x, chip.y, chip.w, chip.h, 8); ctx.fill();
      ctx.strokeStyle = active ? "#46c8ff" : "rgba(255,255,255,0.22)"; ctx.lineWidth = active ? 2.5 : 1.5; ctx.stroke();
      this._text(ctx, chip.name, chip.x + chip.w / 2, chip.y + chip.h / 2 + 1, 14, active ? "#eaf2ff" : "#c9d6f0", "bold");
    }
    for (const c of L.cards) {
      const ab = BB.Abilities[c.id];
      const sel = this.selected.indexOf(c.id);
      const hover = this._hit(c, BB.Input.mouse.x, BB.Input.mouse.y);
      ctx.fillStyle = sel >= 0 ? "rgba(70,200,255,0.18)" : hover ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.05)";
      BB.roundRect(ctx, c.x, c.y, c.w, c.h, 10); ctx.fill();
      ctx.strokeStyle = sel >= 0 ? "#46c8ff" : hover ? "rgba(255,255,255,0.40)" : "rgba(255,255,255,0.15)";
      ctx.lineWidth = sel >= 0 ? 3 : 2; ctx.stroke();

      this._abilityTile(ctx, ab, c.x + 12, c.y + 12, 28);
      this._text(ctx, ab.name, c.x + 50, c.y + 21, 15, "#ffffff", "bold", "left");
      this._text(ctx, ab.role.toUpperCase(), c.x + 50, c.y + 39, 10, ab.color, "bold", "left");
      this._wrapText(ctx, ab.desc.split(" (")[0], c.x + 12, c.y + 58, c.w - 22, 13, 11, "#9fb0d0");

      if (sel >= 0) {
        ctx.fillStyle = "#46c8ff";
        ctx.beginPath(); ctx.arc(c.x + c.w - 16, c.y + 16, 11, 0, Math.PI * 2); ctx.fill();
        this._text(ctx, String(sel + 1), c.x + c.w - 16, c.y + 17, 13, "#08111d", "bold");
      }
    }

    const ready = this.selected.length === 3;
    ctx.globalAlpha = ready ? 1 : 0.4;
    this._button(ctx, L.fight, { font: 22, active: ready });
    ctx.globalAlpha = 1;
  }

  _wrapText(ctx, text, x, y, maxW, lh, size, color) {
    ctx.fillStyle = color;
    ctx.font = `normal ${size}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const words = text.split(" ");
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lh; }
      else line = test;
    }
    if (line) ctx.fillText(line, x, y);
  }

  drawHUD(ctx) {
    this._winPips(ctx, this.player, 24, 24, false);
    this._winPips(ctx, this.enemy, this.w - 24, 24, true);
    this._text(ctx, "YOU", 24, 52, 14, "#46c8ff", "bold", "left");
    this._text(ctx, "BOT", this.w - 24, 52, 14, "#ff6b6b", "bold", "right");
    this._text(ctx, BB.PLAYSTYLES[this.botStyleResolved].name, this.w - 24, 70, 11, "#ff9aa0", "normal", "right");
    this._text(ctx, `ROUND ${this.roundNumber}`, this.w / 2, 26, 18, "#c9d6f0", "bold");

    const aliases = ["LMB", "RMB", "Shift"];
    const n = this.player.abilities.length;
    const sw = 80, gap = 10;
    const totalW = n * sw + (n - 1) * gap;
    let x = this.w / 2 - totalW / 2;
    const y = this.h - 62;
    for (let i = 0; i < n; i++) {
      const id = this.player.abilities[i];
      const ab = BB.Abilities[id];
      const cd = this.player.cooldowns[id] || 0;
      const ready = cd <= 0;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      BB.roundRect(ctx, x, y, sw, 50, 10);
      ctx.fill();
      ctx.strokeStyle = ready ? ab.color : "rgba(255,255,255,0.2)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = ready ? 1 : 0.45;
      this._abilityTile(ctx, ab, x + 8, y + 7, 20);
      ctx.globalAlpha = 1;
      this._text(ctx, String(i + 1), x + 34, y + 15, 13, "#eaf2ff", "bold", "left");
      this._text(ctx, i < 3 ? aliases[i] : "", x + 48, y + 15, 10, "#93a6cc", "normal", "left");
      this._text(ctx, ab.name.split(" ")[0], x + 34, y + 34, 11, "#c9d6f0", "bold", "left");
      this._text(ctx, "Lv" + this.abilityLevel, x + sw - 6, y + 14, 12, "#cfe0ff", "bold", "right");
      if (!ready) {
        const frac = BB.clamp(cd / ab.cooldown, 0, 1);
        ctx.fillStyle = "rgba(0,0,0,0.62)";
        BB.roundRect(ctx, x, y + 50 * (1 - frac), sw, 50 * frac, 10);
        ctx.fill();
        this._text(ctx, cd.toFixed(1), x + sw / 2, y + 25, 15, "#ffffff", "bold");
      }
      x += sw + gap;
    }
  }

  _winPips(ctx, blob, x, y, right) {
    const r = 8, gap = 22;
    for (let i = 0; i < this.winsNeeded; i++) {
      const px = right ? x - i * gap : x + i * gap;
      ctx.beginPath();
      ctx.arc(px, y, r, 0, Math.PI * 2);
      ctx.fillStyle = i < blob.roundWins ? blob.color : "rgba(255,255,255,0.15)";
      ctx.fill();
    }
  }

  drawRoundIntro(ctx) {
    const t = this.roundIntro;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, this.w, this.h);
    const label = t > 1.1 ? "3" : t > 0.7 ? "2" : t > 0.3 ? "1" : "FIGHT!";
    this._text(ctx, `ROUND ${this.roundNumber}`, this.w / 2, this.h / 2 - 50, 30, "#c9d6f0", "bold");
    this._text(ctx, label, this.w / 2, this.h / 2 + 10, 72, "#ffffff", "bold");
  }

  drawRoundBanner(ctx) {
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, this.w, this.h);
    let msg, color;
    if (!this.lastWinner) { msg = "DOUBLE K.O."; color = "#ffd24b"; }
    else if (this.lastWinner === this.player) { msg = "ROUND WON!"; color = "#46c8ff"; }
    else { msg = "ROUND LOST"; color = "#ff6b6b"; }
    this._text(ctx, msg, this.w / 2, this.h / 2, 56, color, "bold");
  }

  drawMatchOver(ctx) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, this.w, this.h);
    const win = this.matchWinner === this.player;
    this._text(ctx, win ? "VICTORY!" : "DEFEAT", this.w / 2, this.h / 2 - 40, 72, win ? "#46c8ff" : "#ff6b6b", "bold");
    this._text(ctx, `${this.player.roundWins} — ${this.enemy.roundWins}`, this.w / 2, this.h / 2 + 30, 36, "#ffffff", "bold");
    const a = 0.5 + 0.5 * Math.sin(this.time * 4);
    this._text(ctx, "click to return to menu", this.w / 2, this.h / 2 + 90, 20, `rgba(255,255,255,${a})`);
  }
};

/* ---------------- bootstrap ---------------- */
window.addEventListener("DOMContentLoaded", () => {
  new BB.Game(document.getElementById("game"));
});
