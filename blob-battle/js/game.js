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
    this.kitSize = 3;    // how many abilities each fighter brings (3..5)
    this.keys = this._loadKeys();
    this.rebindAction = null;
    this.customMap = this._loadCustomMap();
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
    this.chargeSlot = -1; // which ability slot is being charged (hold-to-charge)
    this.chargeTime = 0;
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
    return this._shuffle(style.pool.slice()).slice(0, this.kitSize);
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
    this.arena.customMap = this.customMap;
    this.arena.reset();
    this.projectiles.length = 0;
    BB.Particles.clear();
    this.player.reset(this.arena.spawns[0]);
    this.enemy.reset(this.arena.spawns[1]);
    this.roundIntro = 1.5;
    this._fightPlayed = false;
    this.timeFreeze = 0;
    this.chargeSlot = -1; this.chargeTime = 0;
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
    else if (this.state === "keybinds") this.updateKeybinds();
    else if (this.state === "editor") this.updateEditor();
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
    this.cam.y = BB.lerp(this.cam.y, BB.clamp(cy, 120, 2 * this.arena.waterY - 60), k); // follow into the mirror world
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

    // Time Stop (Bopl-style): everything but the caster freezes in place
    this.timeFreeze = Math.max(0, (this.timeFreeze || 0) - dt);
    const frozen = this.timeFreeze > 0 ? (this.timeFreezeOwner === this.player ? this.enemy : this.player) : null;

    const inp = BB.Input;
    const K = this.keys;
    let dir = 0;
    if (inp.key(K.left) || inp.key("arrowleft")) dir -= 1;
    if (inp.key(K.right) || inp.key("arrowright")) dir += 1;
    const jump = inp.pressed(K.jump) || inp.pressed(" ") || inp.pressed("arrowup");
    const jumpHeld = inp.key(K.jump) || inp.key(" ") || inp.key("arrowup");
    if (!this.player.dead && this.player !== frozen) {
      this.player.control(dir, jump, jumpHeld);
      const aim = this.screenToWorld(inp.mouse.x, inp.mouse.y); // aim in world space
      const ax = aim.x, ay = aim.y;
      const abKeys = [K.a1, K.a2, K.a3, K.a4, K.a5];
      const heldSlot = (i) => inp.key(abKeys[i]) || (i === 0 && inp.mouse.down) || (i === 1 && inp.mouse.rdown) || (i === 2 && inp.key("shift"));
      const pressedSlot = (i) => inp.pressed(abKeys[i]) || (i === 0 && this.lmbClick) || (i === 1 && this.rmbClick) || (i === 2 && inp.pressed("shift"));
      for (let i = 0; i < this.player.abilities.length; i++) {
        const id = this.player.abilities[i], ab = BB.Abilities[id];
        if (ab.charge) {
          const maxC = ab.maxCharge || 1;
          if (this.chargeSlot === -1 && pressedSlot(i) && (this.player.cooldowns[id] || 0) <= 0) { this.chargeSlot = i; this.chargeTime = 0; }
          if (this.chargeSlot === i) {
            if (heldSlot(i)) this.chargeTime = Math.min(maxC, this.chargeTime + dt);
            else { this.player.tryAbility(i, ax, ay, BB.clamp(this.chargeTime / maxC, 0, 1)); this.chargeSlot = -1; this.chargeTime = 0; }
          }
        } else if (pressedSlot(i)) {
          this.player.tryAbility(i, ax, ay);
        }
      }
    } else { this.chargeSlot = -1; }

    if (this.bot && this.enemy !== frozen) this.bot.update(dt);
    for (const b of this.blobs) if (b !== frozen) b.update(dt);
    this.resolveBlobs();

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.timeFreeze > 0) continue; // projectiles are frozen in time
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
  mapMax() { return BB.MAP_NAMES.length - 1 + (this.customMap ? 1 : 0); }
  mapName(v) { return v < 0 ? "Any (random)" : v >= BB.MAP_NAMES.length ? "★ Custom" : BB.MAP_NAMES[v]; }

  menuLayout() {
    const cx = this.w / 2, Lx = 258, Rx = 702;
    const mkRow = (cx0, y, items, bw, bg, h) => {
      let x = cx0 - (items.length * bw + (items.length - 1) * bg) / 2;
      return items.map((it) => { const r = { ...it, x, y, w: bw, h }; x += bw + bg; return r; });
    };
    const cyc = (cx0, y) => ({ left: { x: cx0 - 150, y, w: 28, h: 30, label: "‹" }, right: { x: cx0 + 122, y, w: 28, h: 30, label: "›" }, nameX: cx0, nameY: y + 15 });
    const num5 = [1, 2, 3, 4, 5].map((n) => ({ n, label: String(n) }));
    return {
      diffs: mkRow(Lx, 132, [{ id: "easy", label: "EASY" }, { id: "normal", label: "NORMAL" }, { id: "hard", label: "HARD" }], 108, 8, 34),
      wins: mkRow(Lx, 208, num5, 40, 8, 30),
      powers: mkRow(Lx, 280, num5, 40, 8, 30),
      styleCyc: cyc(Rx, 132),
      mapCyc: cyc(Rx, 208),
      kits: mkRow(Rx, 280, [3, 4, 5].map((n) => ({ n, label: String(n) })), 56, 8, 30),
      keybinds: { x: cx - 194, y: 356, w: 184, h: 40, label: "KEYBINDS" },
      editor: { x: cx + 10, y: 356, w: 184, h: 40, label: "MAP EDITOR" },
      start: { x: cx - 120, y: 414, w: 240, h: 50, label: "START" },
    };
  }

  updateMenu() {
    if (!this.clicked()) return;
    const L = this.menuLayout();
    const m = BB.Input.mouse;
    const cyc = (v, d, lo, hi) => { let n = v + d; if (n > hi) n = lo; if (n < lo) n = hi; return n; };
    for (const d of L.diffs) if (this._hit(d, m.x, m.y)) { this.difficulty = d.id; BB.Audio.play("click"); }
    for (const wb of L.wins) if (this._hit(wb, m.x, m.y)) { this.winsNeeded = wb.n; BB.Audio.play("click"); }
    for (const pb of L.powers) if (this._hit(pb, m.x, m.y)) { this.abilityLevel = pb.n; BB.Audio.play("click"); }
    for (const kb of L.kits) if (this._hit(kb, m.x, m.y)) { this.kitSize = kb.n; BB.Audio.play("click"); }
    if (this._hit(L.styleCyc.left, m.x, m.y)) { this.botStyle = cyc(this.botStyle, -1, -1, BB.PLAYSTYLES.length - 1); BB.Audio.play("click"); }
    if (this._hit(L.styleCyc.right, m.x, m.y)) { this.botStyle = cyc(this.botStyle, 1, -1, BB.PLAYSTYLES.length - 1); BB.Audio.play("click"); }
    if (this._hit(L.mapCyc.left, m.x, m.y)) { this.mapChoice = cyc(this.mapChoice, -1, -1, this.mapMax()); BB.Audio.play("click"); }
    if (this._hit(L.mapCyc.right, m.x, m.y)) { this.mapChoice = cyc(this.mapChoice, 1, -1, this.mapMax()); BB.Audio.play("click"); }
    if (this._hit(L.keybinds, m.x, m.y)) { BB.Audio.play("click"); this.state = "keybinds"; }
    if (this._hit(L.editor, m.x, m.y)) { BB.Audio.play("click"); this.editorEnter(); }
    if (this._hit(L.start, m.x, m.y)) { BB.Audio.play("click"); this.startMatch(); }
  }

  /* ---------------- persistence (localStorage, guarded) ---------------- */
  _defaultKeys() { return { left: "a", right: "d", jump: "w", a1: "1", a2: "2", a3: "3", a4: "4", a5: "5" }; }
  _loadKeys() { try { if (typeof localStorage !== "undefined") { const s = localStorage.getItem("bb_keys"); if (s) return Object.assign(this._defaultKeys(), JSON.parse(s)); } } catch (e) {} return this._defaultKeys(); }
  _saveKeys() { try { if (typeof localStorage !== "undefined") localStorage.setItem("bb_keys", JSON.stringify(this.keys)); } catch (e) {} }
  _loadCustomMap() { try { if (typeof localStorage !== "undefined") { const s = localStorage.getItem("bb_custommap"); if (s) return JSON.parse(s); } } catch (e) {} return null; }
  _saveCustomMap() { try { if (typeof localStorage !== "undefined") localStorage.setItem("bb_custommap", JSON.stringify(this.customMap)); } catch (e) {} }
  _keyLabel(k) { if (k === " ") return "Space"; if (!k) return "?"; if (k.indexOf("arrow") === 0) return k.slice(5).toUpperCase(); return k.toUpperCase(); }

  /* ---------------- KEYBINDS ---------------- */
  keybindsLayout() {
    const cx = this.w / 2;
    const actions = [["left", "Move Left"], ["right", "Move Right"], ["jump", "Jump"], ["a1", "Ability 1"], ["a2", "Ability 2"], ["a3", "Ability 3"], ["a4", "Ability 4"], ["a5", "Ability 5"]];
    const rows = actions.map(([k, label], i) => ({ k, label, x: cx + 30, y: 132 + i * 42, w: 150, h: 34 }));
    return { rows, back: { x: cx - 230, y: 536, w: 150, h: 40, label: "‹ BACK" }, reset: { x: cx + 80, y: 536, w: 150, h: 40, label: "RESET" } };
  }

  updateKeybinds() {
    if (this.rebindAction) {
      const jp = Object.keys(BB.Input._justPressed);
      if (BB.Input._justPressed["escape"]) { this.rebindAction = null; return; }
      const key = jp.find((k) => k !== "escape");
      if (key) { this.keys[this.rebindAction] = key; this.rebindAction = null; this._saveKeys(); BB.Audio.play("click"); }
      return;
    }
    if (!this.clicked()) return;
    const L = this.keybindsLayout(), m = BB.Input.mouse;
    for (const r of L.rows) if (this._hit(r, m.x, m.y)) { this.rebindAction = r.k; BB.Audio.play("click"); return; }
    if (this._hit(L.back, m.x, m.y)) { BB.Audio.play("click"); this.state = "menu"; }
    if (this._hit(L.reset, m.x, m.y)) { this.keys = this._defaultKeys(); this._saveKeys(); BB.Audio.play("click"); }
  }

  drawKeybinds(ctx) {
    const cx = this.w / 2;
    this._text(ctx, "KEYBINDS", cx, 62, 40, "#ffffff", "bold");
    this._text(ctx, "click a binding, then press the new key  ·  Esc cancels", cx, 98, 15, "#8fa3c8");
    const L = this.keybindsLayout();
    for (const r of L.rows) {
      this._text(ctx, r.label, r.x - 18, r.y + r.h / 2, 15, "#c9d6f0", "normal", "right");
      const rebinding = this.rebindAction === r.k;
      this._button(ctx, { ...r, label: rebinding ? "press…" : this._keyLabel(this.keys[r.k]) }, { active: rebinding, font: 15 });
    }
    this._text(ctx, "LMB · RMB · Shift always fire abilities 1 · 2 · 3.  Arrows / Space also work.", cx, 500, 13, "#7f92b6");
    this._button(ctx, L.back, { font: 16 });
    this._button(ctx, L.reset, { font: 16 });
  }

  /* ---------------- MAP EDITOR (freehand draw) ---------------- */
  editorEnter() {
    this.editorPlatforms = this.customMap ? this.customMap.platforms.map((p) => ({ ...p })) : [];
    this.editorSpawns = this.customMap && this.customMap.spawns ? this.customMap.spawns.map((s) => ({ ...s })) : [];
    this.editorHazards = this.customMap && this.customMap.hazards ? this.customMap.hazards.map((h) => ({ ...h })) : [];
    this.editorR = 22;
    this.editorTool = "draw"; // draw | erase | spawn | spikes
    this.editorLast = null;
    this._paintLock = false;
    this.state = "editor";
  }

  editorLayout() {
    const cx = this.w / 2, barY = this.h - 42;
    return {
      barY,
      draw: { x: 14, y: barY, w: 58, h: 32, label: "DRAW" },
      erase: { x: 76, y: barY, w: 58, h: 32, label: "ERASE" },
      spawn: { x: 138, y: barY, w: 72, h: 32, label: "SPAWNS" },
      spikes: { x: 214, y: barY, w: 66, h: 32, label: "SPIKES" },
      sizeDown: { x: 286, y: barY, w: 28, h: 32, label: "–" },
      sizeUp: { x: 318, y: barY, w: 28, h: 32, label: "+" },
      clear: { x: cx + 96, y: barY, w: 92, h: 32, label: "CLEAR" },
      save: { x: cx + 196, y: barY, w: 150, h: 32, label: "SAVE & USE" },
      back: { x: this.w - 112, y: barY, w: 96, h: 32, label: "‹ BACK" },
    };
  }

  updateEditor() {
    const m = BB.Input.mouse, L = this.editorLayout();
    const inField = m.y > 78 && m.y < L.barY - 10;
    if (this.lmbClick) {
      if (this._hit(L.back, m.x, m.y)) { BB.Audio.play("click"); this.state = "menu"; this._paintLock = true; return; }
      if (this._hit(L.draw, m.x, m.y)) { this.editorTool = "draw"; BB.Audio.play("click"); this._paintLock = true; return; }
      if (this._hit(L.erase, m.x, m.y)) { this.editorTool = "erase"; BB.Audio.play("click"); this._paintLock = true; return; }
      if (this._hit(L.spawn, m.x, m.y)) { this.editorTool = "spawn"; BB.Audio.play("click"); this._paintLock = true; return; }
      if (this._hit(L.spikes, m.x, m.y)) { this.editorTool = "spikes"; BB.Audio.play("click"); this._paintLock = true; return; }
      if (this._hit(L.sizeDown, m.x, m.y)) { this.editorR = BB.clamp(this.editorR - 3, 10, 50); BB.Audio.play("click"); this._paintLock = true; return; }
      if (this._hit(L.sizeUp, m.x, m.y)) { this.editorR = BB.clamp(this.editorR + 3, 10, 50); BB.Audio.play("click"); this._paintLock = true; return; }
      if (this._hit(L.clear, m.x, m.y)) { this.editorPlatforms = []; this.editorSpawns = []; this.editorHazards = []; BB.Audio.play("click"); this._paintLock = true; return; }
      if (this._hit(L.save, m.x, m.y)) { this._editorSave(); this._paintLock = true; return; }
      if (inField) {
        this._paintLock = false; this.editorLast = null;
        if (this.editorTool === "spawn") { this.editorSpawns.push({ x: m.x, y: m.y }); while (this.editorSpawns.length > 2) this.editorSpawns.shift(); BB.Audio.play("click"); this._paintLock = true; }
      } else this._paintLock = true;
    }
    if (BB.Input.mouse.down && !this._paintLock && inField && this.editorTool !== "spawn") this._editorStroke(m.x, m.y);
    if (!BB.Input.mouse.down) { this.editorLast = null; this._paintLock = false; }
  }

  _editorStroke(x, y) {
    if (this.editorTool === "erase") {
      for (let i = this.editorPlatforms.length - 1; i >= 0; i--) {
        const p = this.editorPlatforms[i];
        if (BB.dist(x, y, (p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2) < p.r + this.editorR) this.editorPlatforms.splice(i, 1);
      }
      for (let i = this.editorHazards.length - 1; i >= 0; i--) {
        const h = this.editorHazards[i];
        if (BB.dist(x, y, h.x, h.y) < h.r + this.editorR) this.editorHazards.splice(i, 1);
      }
      return;
    }
    if (this.editorTool === "spikes") {
      if (this.editorHazards.length > 120) return;
      if (this.editorLast && BB.dist(this.editorLast.x, this.editorLast.y, x, y) < this.editorR * 1.3) return;
      this.editorHazards.push({ x, y, r: Math.max(14, this.editorR) });
      this.editorLast = { x, y };
      return;
    }
    if (this.editorPlatforms.length > 500) return; // safety cap
    if (!this.editorLast) { this.editorPlatforms.push({ x1: x, y1: y, x2: x, y2: y, r: this.editorR }); this.editorLast = { x, y }; return; }
    if (BB.dist(this.editorLast.x, this.editorLast.y, x, y) > this.editorR * 0.6) {
      this.editorPlatforms.push({ x1: this.editorLast.x, y1: this.editorLast.y, x2: x, y2: y, r: this.editorR });
      this.editorLast = { x, y };
    }
  }

  _editorSave() {
    if (this.editorPlatforms.length < 1) { BB.Audio.play("hit"); return; }
    const map = { platforms: this.editorPlatforms.map((p) => ({ ...p })) };
    if (this.editorSpawns.length === 2) map.spawns = this.editorSpawns.map((s) => ({ ...s }));
    if (this.editorHazards.length) map.hazards = this.editorHazards.map((h) => ({ ...h }));
    this.customMap = map;
    this._saveCustomMap();
    this.mapChoice = BB.MAP_NAMES.length; // select the Custom slot
    BB.Audio.play("click"); this.state = "menu";
  }

  drawEditor(ctx) {
    const cx = this.w / 2, A = this.arena, L = this.editorLayout();
    this._text(ctx, "MAP EDITOR", cx, 32, 30, "#ffffff", "bold");
    this._text(ctx, "DRAG to paint islands · ERASE removes · SPAWNS sets where the two fighters start", cx, 58, 13, "#8fa3c8");
    // bounds + water preview
    ctx.save();
    ctx.strokeStyle = "rgba(255,90,110,0.4)"; ctx.setLineDash([6, 8]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(A.leftBound, 72); ctx.lineTo(A.leftBound, this.h - 56); ctx.moveTo(A.rightBound, 72); ctx.lineTo(A.rightBound, this.h - 56); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    ctx.strokeStyle = "rgba(120,180,230,0.45)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, A.waterY); ctx.lineTo(this.w, A.waterY); ctx.stroke();
    // islands
    ctx.lineCap = "round";
    for (const p of this.editorPlatforms) {
      if (p.x1 === p.x2 && p.y1 === p.y2) { ctx.fillStyle = "#3f4b6b"; ctx.beginPath(); ctx.arc(p.x1, p.y1, p.r, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.strokeStyle = "#3f4b6b"; ctx.lineWidth = p.r * 2; ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke(); }
    }
    // hazards (spike balls)
    for (const h of this.editorHazards) {
      ctx.fillStyle = "#ff4b5b";
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(h.x + Math.cos(a) * h.r * 0.5, h.y + Math.sin(a) * h.r * 0.5); ctx.lineTo(h.x + Math.cos(a + 0.4) * h.r, h.y + Math.sin(a + 0.4) * h.r); ctx.lineTo(h.x + Math.cos(a + 0.8) * h.r * 0.5, h.y + Math.sin(a + 0.8) * h.r * 0.5); ctx.fill(); }
      ctx.fillStyle = "#8a1f2a"; ctx.beginPath(); ctx.arc(h.x, h.y, h.r * 0.55, 0, Math.PI * 2); ctx.fill();
    }
    // spawn markers
    this.editorSpawns.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? "#46c8ff" : "#ff6b6b";
      ctx.beginPath(); ctx.arc(s.x, s.y, 10, 0, Math.PI * 2); ctx.fill();
      this._text(ctx, i === 0 ? "P1" : "P2", s.x, s.y - 18, 12, i === 0 ? "#46c8ff" : "#ff6b6b", "bold");
    });
    // cursor
    const m = BB.Input.mouse;
    if (m.y > 78 && m.y < L.barY - 10) {
      if (this.editorTool === "spawn") { ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(m.x, m.y, 10, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.strokeStyle = this.editorTool === "erase" ? "rgba(255,90,110,0.7)" : this.editorTool === "spikes" ? "rgba(255,75,91,0.8)" : "rgba(111,191,91,0.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(m.x, m.y, this.editorR, 0, Math.PI * 2); ctx.stroke(); }
    }
    // toolbar
    this._button(ctx, L.draw, { active: this.editorTool === "draw", font: 13 });
    this._button(ctx, L.erase, { active: this.editorTool === "erase", font: 13 });
    this._button(ctx, L.spawn, { active: this.editorTool === "spawn", font: 12 });
    this._button(ctx, L.spikes, { active: this.editorTool === "spikes", font: 13 });
    this._text(ctx, "size", 302, L.barY - 8, 10, "#8fa3c8");
    this._button(ctx, L.sizeDown, { font: 18 }); this._button(ctx, L.sizeUp, { font: 18 });
    this._button(ctx, L.clear, { font: 14 }); this._button(ctx, L.save, { font: 15 }); this._button(ctx, L.back, { font: 14 });
  }

  /* ---------------- LOADOUT (icon grid grouped by role) ---------------- */
  loadoutLayout() {
    // quick-combo chips
    const presets = BB.LOADOUT_PRESETS;
    const pw = 148, pgap = 8;
    const ptot = presets.length * pw + (presets.length - 1) * pgap;
    let px = (this.w - ptot) / 2;
    const chips = presets.map((p) => { const r = { ...p, x: px, y: 92, w: pw, h: 26 }; px += pw + pgap; return r; });

    // ability tiles grouped by role
    const roles = ["attack", "mobility", "control", "defense"];
    const byRole = { attack: [], mobility: [], control: [], defense: [] };
    for (const id of BB.ABILITY_IDS) (byRole[BB.Abilities[id].role] || byRole.attack).push(id);
    const ts = 40, gap = 6;
    const groups = [];
    const tiles = [];
    let y = 142;
    for (const role of roles) {
      const ids = byRole[role];
      const rowW = ids.length * ts + (ids.length - 1) * gap;
      let x = (this.w - rowW) / 2;
      groups.push({ role, y: y - 8 });
      for (const id of ids) { tiles.push({ id, x, y, w: ts, h: ts }); x += ts + gap; }
      y += 66;
    }
    return { chips, tiles, groups, fight: { x: this.w / 2 - 120, y: this.h - 44, w: 240, h: 38, label: "FIGHT ▸" } };
  }

  _isPreset(ids) {
    return ids.length === this.selected.length && ids.every((id) => this.selected.includes(id));
  }

  updateLoadout() {
    if (!this.clicked()) return;
    const L = this.loadoutLayout();
    const m = BB.Input.mouse;
    for (const chip of L.chips) {
      if (this._hit(chip, m.x, m.y)) { this.selected = chip.ids.slice(0, this.kitSize); BB.Audio.play("click"); return; }
    }
    for (const t of L.tiles) {
      if (this._hit(t, m.x, m.y)) {
        const idx = this.selected.indexOf(t.id);
        if (idx >= 0) this.selected.splice(idx, 1);
        else if (this.selected.length < this.kitSize) this.selected.push(t.id);
        BB.Audio.play("click");
        return;
      }
    }
    if (this.selected.length === this.kitSize && this._hit(L.fight, m.x, m.y)) {
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
    else if (this.state === "keybinds") this.drawKeybinds(ctx);
    else if (this.state === "editor") this.drawEditor(ctx);
    else if (this.state === "loadout") this.drawLoadout(ctx);
    else {
      // world through the dynamic camera
      ctx.save();
      this.applyCamera(ctx);
      this.arena.draw(ctx, this.time);
      for (const p of this.projectiles) p.draw(ctx);
      for (const b of this.blobs) if (!b.mirror) b.draw(ctx); // mirror-world blobs drawn in _drawWater
      BB.Particles.draw(ctx);
      if (this.chargeSlot >= 0 && this.player && !this.player.dead) {
        const ab = BB.Abilities[this.player.abilities[this.chargeSlot]];
        const frac = BB.clamp(this.chargeTime / (ab.maxCharge || 1), 0, 1);
        const p = this.player;
        ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 13, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = frac >= 1 ? "#ffd24b" : ab.color; ctx.lineWidth = 4; ctx.lineCap = "round";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 13, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
      }
      this._drawBounds(ctx);
      this._drawWater(ctx);
      this.drawReticle(ctx);
      ctx.restore();
      // UI stays in screen space
      this.drawHUD(ctx);
      this._drawOOBWarning(ctx);
      if (this.timeFreeze > 0) {
        ctx.fillStyle = "rgba(139,224,255,0.09)"; ctx.fillRect(0, 0, this.w, this.h);
        this._text(ctx, "◷ TIME STOP", this.w / 2, 92, 26, "rgba(160,230,255,0.85)", "bold");
      }
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

  // big red alert when a fighter is out past a side barrier (grace before ring-out)
  _drawOOBWarning(ctx) {
    for (const b of this.blobs) {
      if (b.dead || b.oob <= 0) continue;
      const left = b.x < this.arena.leftBound;
      const frac = BB.clamp(b.oob / 1.0, 0, 1);
      const flash = 0.45 + 0.55 * Math.abs(Math.sin(this.time * 18));
      const gw = 150;
      const grad = ctx.createLinearGradient(left ? 0 : this.w, 0, left ? gw : this.w - gw, 0);
      grad.addColorStop(0, `rgba(255,40,50,${0.55 * flash})`);
      grad.addColorStop(1, "rgba(255,40,50,0)");
      ctx.fillStyle = grad; ctx.fillRect(left ? 0 : this.w - gw, 0, gw, this.h);
      const sy = BB.clamp((b.y - this.cam.y) * this.cam.zoom + this.h / 2, 50, this.h - 50);
      ctx.fillStyle = `rgba(255,70,70,${flash})`;
      ctx.font = "bold 34px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(left ? "◄" : "►", left ? 34 : this.w - 34, sy);
      this._text(ctx, b === this.player ? "RECOVER!" : "RING-OUT!", this.w / 2, 118, 40, `rgba(255,60,60,${flash})`, "bold");
      ctx.fillStyle = "rgba(0,0,0,0.5)"; BB.roundRect(ctx, this.w / 2 - 110, 146, 220, 10, 5); ctx.fill();
      ctx.fillStyle = "#ff3b3b"; BB.roundRect(ctx, this.w / 2 - 110, 146, 220 * (1 - frac), 10, 5); ctx.fill();
    }
  }

  // dotted side kill-barriers: calm blue normally, flashing red as a blob nears
  _drawBounds(ctx) {
    const A = this.arena;
    const alive = this.blobs.filter((b) => !b.dead);
    const yTop = -300, yBot = A.waterY + 30;
    for (const bx of [A.leftBound, A.rightBound]) {
      let md = 1e9;
      for (const b of alive) md = Math.min(md, Math.abs(b.x - bx));
      const danger = BB.clamp(1 - md / 170, 0, 1);
      const flash = danger > 0 ? 0.5 + 0.5 * Math.sin(this.time * (6 + danger * 22)) : 0;
      const alpha = BB.clamp(0.26 + danger * (0.15 + 0.6 * flash), 0, 1);
      const rC = Math.round(120 + (255 - 120) * danger);
      const gC = Math.round(160 + (55 - 160) * danger);
      const bC = Math.round(220 + (55 - 220) * danger);
      ctx.save();
      ctx.setLineDash([7, 9]);
      ctx.lineDashOffset = -(this.time * 40) % 16;
      ctx.strokeStyle = `rgba(${rC},${gC},${bC},${alpha})`;
      ctx.lineWidth = 3 + danger * 2;
      ctx.beginPath(); ctx.moveTo(bx, yTop); ctx.lineTo(bx, yBot); ctx.stroke();
      ctx.restore();
    }
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
    this.arena.drawIslands(ctx, t); // the flipped islands ARE the mirror-world terrain
    for (const p of this.projectiles) p.draw(ctx);
    for (const b of this.blobs) if (!b.dead && !b.mirror) b.draw(ctx); // reflect only real-world fighters
    ctx.restore();

    // blue depth wash — light enough to see into the mirror world you can play in
    const g = ctx.createLinearGradient(0, wy, 0, wy + 240);
    g.addColorStop(0, "rgba(44,116,156,0.30)");
    g.addColorStop(1, "rgba(20,52,92,0.44)");
    ctx.fillStyle = g;
    ctx.fillRect(left, wy - 4, right - left, this.h + 900);

    // the mirror-world fighters, drawn over the wash so they read clearly
    for (const b of this.blobs) if (!b.dead && b.mirror) b.draw(ctx);

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

  _cycleControl(ctx, cyc, name) {
    this._button(ctx, cyc.left, { font: 18 });
    this._button(ctx, cyc.right, { font: 18 });
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    BB.roundRect(ctx, cyc.left.x + 34, cyc.left.y, 240, 30, 8); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1.5;
    BB.roundRect(ctx, cyc.left.x + 34, cyc.left.y, 240, 30, 8); ctx.stroke();
    this._text(ctx, name, cyc.nameX, cyc.nameY, 15, "#eaf2ff", "bold");
  }

  drawMenu(ctx) {
    const cx = this.w / 2, Lx = 258, Rx = 702;
    this._text(ctx, "BLOB BATTLE", cx, 46, 42, "#ffffff", "bold");
    this._text(ctx, "a physics ability-brawler vs. a bot", cx, 78, 15, "#8fa3c8");
    const L = this.menuLayout();

    this._text(ctx, "Difficulty", Lx, 116, 14, "#8fa3c8");
    for (const d of L.diffs) this._button(ctx, d, { active: this.difficulty === d.id, font: 16 });
    this._text(ctx, "First to how many wins?", Lx, 192, 14, "#8fa3c8");
    for (const wb of L.wins) this._button(ctx, wb, { active: this.winsNeeded === wb.n, font: 16 });
    this._text(ctx, "Ability power (Lv)", Lx, 264, 14, "#8fa3c8");
    for (const pb of L.powers) this._button(ctx, pb, { active: this.abilityLevel === pb.n, font: 16 });

    this._text(ctx, "Bot style", Rx, 116, 14, "#8fa3c8");
    this._cycleControl(ctx, L.styleCyc, this.botStyle < 0 ? "Any (random)" : BB.PLAYSTYLES[this.botStyle].name);
    this._text(ctx, "Map", Rx, 192, 14, "#8fa3c8");
    this._cycleControl(ctx, L.mapCyc, this.mapName(this.mapChoice));
    this._text(ctx, "Kit size (abilities)", Rx, 264, 14, "#8fa3c8");
    for (const kb of L.kits) this._button(ctx, kb, { active: this.kitSize === kb.n, font: 16 });

    this._button(ctx, L.keybinds, { font: 16 });
    this._button(ctx, L.editor, { font: 16 });
    this._button(ctx, L.start, { font: 24 });

    this._text(ctx, "Move A/D · Jump W/Space · Aim mouse · Abilities 1–5 / LMB·RMB·Shift   (M toggles music)", cx, 500, 13, "#7f92b6");
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
    const m = BB.Input.mouse;
    const need = this.kitSize;
    if (this.repicking) {
      this._text(ctx, "MATCH POINT — ADJUST YOUR KIT", cx, 34, 28, "#ffd24b", "bold");
      this._text(ctx, `swap any abilities, then fight  —  selected ${this.selected.length}/${need}`, cx, 62, 15, "#8fa3c8");
    } else {
      this._text(ctx, `CHOOSE YOUR ${need} ABILITIES`, cx, 34, 30, "#ffffff", "bold");
      this._text(ctx, `hover to read · click to pick  —  selected ${this.selected.length}/${need}`, cx, 62, 15, "#8fa3c8");
    }
    this._text(ctx, "opponent: " + BB.PLAYSTYLES[this.botStyleResolved].name + " bot", this.w - 16, 20, 13, "#ff9aa0", "normal", "right");

    const L = this.loadoutLayout();

    // quick-combo chips
    for (const chip of L.chips) {
      const active = this._isPreset(chip.ids);
      const hover = this._hit(chip, m.x, m.y);
      ctx.fillStyle = active ? "rgba(70,200,255,0.22)" : hover ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)";
      BB.roundRect(ctx, chip.x, chip.y, chip.w, chip.h, 8); ctx.fill();
      ctx.strokeStyle = active ? "#46c8ff" : "rgba(255,255,255,0.22)"; ctx.lineWidth = active ? 2.5 : 1.5; ctx.stroke();
      this._text(ctx, chip.name, chip.x + chip.w / 2, chip.y + chip.h / 2 + 1, 13, active ? "#eaf2ff" : "#c9d6f0", "bold");
    }

    // group headers
    for (const g of L.groups) this._text(ctx, g.role.toUpperCase(), cx, g.y - 2, 11, "#6b7ea3", "bold");

    // ability tiles (icon only)
    let hovered = null;
    for (const t of L.tiles) {
      const ab = BB.Abilities[t.id];
      const sel = this.selected.indexOf(t.id);
      const hover = this._hit(t, m.x, m.y);
      if (hover) hovered = ab;
      ctx.globalAlpha = sel >= 0 || hover ? 1 : 0.9;
      this._abilityTile(ctx, ab, t.x, t.y, t.w);
      ctx.globalAlpha = 1;
      if (sel >= 0) {
        ctx.strokeStyle = "#46c8ff"; ctx.lineWidth = 3;
        BB.roundRect(ctx, t.x - 1, t.y - 1, t.w + 2, t.h + 2, t.w * 0.24); ctx.stroke();
        ctx.fillStyle = "#46c8ff";
        ctx.beginPath(); ctx.arc(t.x + t.w - 4, t.y + 4, 8, 0, Math.PI * 2); ctx.fill();
        this._text(ctx, String(sel + 1), t.x + t.w - 4, t.y + 5, 11, "#08111d", "bold");
      } else if (hover) {
        ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 2;
        BB.roundRect(ctx, t.x - 1, t.y - 1, t.w + 2, t.h + 2, t.w * 0.24); ctx.stroke();
      }
    }

    // detail panel for the hovered ability
    const py = this.h - 128, pw = 560, pxx = cx - pw / 2;
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    BB.roundRect(ctx, pxx, py, pw, 58, 10); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1.5;
    BB.roundRect(ctx, pxx, py, pw, 58, 10); ctx.stroke();
    if (hovered) {
      this._abilityTile(ctx, hovered, pxx + 12, py + 13, 32);
      this._text(ctx, hovered.name, pxx + 56, py + 18, 16, "#ffffff", "bold", "left");
      this._text(ctx, hovered.role.toUpperCase() + "  ·  cooldown " + hovered.cooldown + "s", pxx + 56, py + 36, 11, hovered.color, "bold", "left");
      this._wrapText(ctx, hovered.desc.split(" (")[0], pxx + 200, py + 20, pw - 214, 14, 12, "#c9d6f0");
    } else {
      this._text(ctx, "hover an ability to see what it does", cx, py + 29, 14, "#6b7ea3");
    }

    const ready = this.selected.length === need;
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
    this._portalPip(ctx, this.player, 62, 50, false);
    this._portalPip(ctx, this.enemy, this.w - 62, 50, true);
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

  // little water-portal meter: dip the water enough and the mirror world opens
  _portalPip(ctx, blob, x, y, right) {
    if (blob.portalOpen) {
      const a = 0.6 + 0.4 * Math.sin(this.time * 8);
      this._text(ctx, "◈ PORTAL", x, y, 11, `rgba(139,224,255,${a})`, "bold", right ? "right" : "left");
      return;
    }
    if (!blob.waterDips) return;
    const bw = 46, bx = right ? x - bw : x;
    ctx.fillStyle = "rgba(0,0,0,0.4)"; BB.roundRect(ctx, bx, y - 4, bw, 6, 3); ctx.fill();
    ctx.fillStyle = "#8be0ff"; BB.roundRect(ctx, bx, y - 4, bw * BB.clamp(blob.waterDips / 4, 0, 1), 6, 3); ctx.fill();
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
