/* ============================================================
   King's Jewels — a match-3 puzzle game (Royal Match-style clone)
   ------------------------------------------------------------
   Swap adjacent jewels to line up 3+ of a kind. Patterns forge
   special jewels:
     • 4 in a line  -> Rocket    (clears a row or column)
     • 2x2 square   -> Propeller (flies to a target and blasts it)
     • L / T shape  -> Bomb      (5x5 blast)
     • 5 in a line  -> Color Bomb (clears every jewel of one colour)
   Swap two specials to combine them. Smash 📦 crates by matching
   beside them. Collect the level's objectives before moves run out.
   Progress, lives, and stars are saved between sessions.
   ============================================================ */

(() => {
  "use strict";

  // ---- Configuration -------------------------------------------------------
  const COLS = 8;
  const ROWS = 8;
  const TILE = 64;
  const PAD = TILE * 0.14;
  const NUM_TYPES = 4;
  const BASE_MOVES = 25;
  const MAX_HEARTS = 5;
  const SAVE_KEY = "kings-jewels-progress";

  const GEMS = [
    { color: "#e8403f", glow: "#ff8a7a", shape: "circle" },   // red ruby
    { color: "#f5b81a", glow: "#ffd94d", shape: "diamond" },  // yellow topaz
    { color: "#25b965", glow: "#6ef0a0", shape: "rounded" },  // green emerald
    { color: "#3a8ee6", glow: "#79b8ff", shape: "triangle" }, // blue sapphire
  ];

  // ---- Canvas --------------------------------------------------------------
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = COLS * TILE * dpr;
  canvas.height = ROWS * TILE * dpr;
  ctx.scale(dpr, dpr);

  // ---- DOM -----------------------------------------------------------------
  const el = {
    mapScreen: document.getElementById("map-screen"),
    gameScreen: document.getElementById("game-screen"),
    mapPath: document.getElementById("map-path"),
    heartsMap: document.getElementById("hearts-map"),
    heartsGame: document.getElementById("hearts-game"),
    level: document.getElementById("level"),
    moves: document.getElementById("moves"),
    score: document.getElementById("score"),
    objectives: document.getElementById("objectives"),
    overlay: document.getElementById("overlay"),
    overlayEmoji: document.getElementById("overlay-emoji"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayStars: document.getElementById("overlay-stars"),
    overlayText: document.getElementById("overlay-text"),
    overlayBtn: document.getElementById("overlay-btn"),
    shuffleBtn: document.getElementById("shuffle-btn"),
    restartBtn: document.getElementById("restart-btn"),
    muteBtn: document.getElementById("mute-btn"),
    backBtn: document.getElementById("back-btn"),
    refillBtn: document.getElementById("refill-btn"),
    resetBtn: document.getElementById("reset-btn"),
  };

  // ---- State ---------------------------------------------------------------
  let grid = [];           // grid[r][c] = tile | null
  let cover = [];          // cover[r][c] = crate layers at that position (0 = none)
  let level = 1;
  let score = 0;
  let movesLeft = BASE_MOVES;
  let objectives = [];     // { kind:'gem', type, need, got } | { kind:'crate', need, got }
  let busy = false;
  let gameOver = false;
  let selected = null;
  let dragStart = null;
  let scene = "map";       // 'map' | 'game'

  // Persistent progress
  let progress = loadProgress();

  function loadProgress() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return { unlocked: p.unlocked || 1, hearts: p.hearts == null ? MAX_HEARTS : p.hearts, stars: p.stars || {} };
      }
    } catch (e) { /* ignore */ }
    return { unlocked: 1, hearts: MAX_HEARTS, stars: {} };
  }
  function saveProgress() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ }
  }

  // special: null | 'rocketH' | 'rocketV' | 'bomb' | 'light' | 'propeller'
  function makeTile(type, r, c) {
    return { type, special: null, x: c * TILE, y: r * TILE, scale: 1, alpha: 1 };
  }

  const keyOf = (r, c) => r + "," + c;
  const parseKey = (k) => {
    const i = k.indexOf(",");
    return { r: +k.slice(0, i), c: +k.slice(i + 1) };
  };

  // ============================================================
  //  Easing + tween engine
  // ============================================================
  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
  const easeInQuad = (t) => t * t;
  const easeOutBack = (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

  let tweens = [];
  function tween(obj, to, duration, ease) {
    ease = ease || easeOutQuad;
    return new Promise((resolve) => {
      const from = {};
      for (const k in to) from[k] = obj[k];
      tweens.push({ obj, from, to, duration, t: 0, ease, resolve });
    });
  }
  function updateTweens(dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt;
      const p = Math.min(tw.t / tw.duration, 1);
      const e = tw.ease(p);
      for (const k in tw.to) tw.obj[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      if (p >= 1) { tweens.splice(i, 1); tw.resolve(); }
    }
  }

  // ============================================================
  //  Board generation
  // ============================================================
  const randType = () => Math.floor(Math.random() * NUM_TYPES);

  function buildBoard() {
    do {
      grid = [];
      for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
          let type;
          do { type = randType(); } while (createsMatch(grid, row, r, c, type));
          row.push(makeTile(type, r, c));
        }
        grid.push(row);
      }
    } while (!hasAnyMove());
  }

  function createsMatch(g, currentRow, r, c, type) {
    if (c >= 2 && currentRow[c - 1].type === type && currentRow[c - 2].type === type) return true;
    if (r >= 2 && g[r - 1][c].type === type && g[r - 2][c].type === type) return true;
    // 2x2 square
    if (r >= 1 && c >= 1 && currentRow[c - 1].type === type && g[r - 1][c].type === type && g[r - 1][c - 1].type === type) return true;
    return false;
  }

  // ============================================================
  //  Match detection — line runs (3+) and 2x2 squares
  //  Specials don't match by colour.
  // ============================================================
  function getRuns() {
    const runs = [];
    const same = (r, c, type) => {
      const t = grid[r][c];
      return t && t.special === null && t.type === type;
    };
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const t = grid[r][c];
        if (t && t.special === null) {
          let c2 = c;
          while (c2 + 1 < COLS && same(r, c2 + 1, t.type)) c2++;
          if (c2 - c + 1 >= 3) {
            const cells = [];
            for (let k = c; k <= c2; k++) cells.push({ r, c: k });
            runs.push({ kind: "h", type: t.type, cells });
          }
          c = c2 + 1;
        } else c++;
      }
    }
    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < ROWS) {
        const t = grid[r][c];
        if (t && t.special === null) {
          let r2 = r;
          while (r2 + 1 < ROWS && same(r2 + 1, c, t.type)) r2++;
          if (r2 - r + 1 >= 3) {
            const cells = [];
            for (let k = r; k <= r2; k++) cells.push({ r: k, c });
            runs.push({ kind: "v", type: t.type, cells });
          }
          r = r2 + 1;
        } else r++;
      }
    }
    return runs;
  }

  function getSquares() {
    const squares = [];
    const normal = (r, c, type) => {
      const t = grid[r][c];
      return t && t.special === null && t.type === type;
    };
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        const t = grid[r][c];
        if (t && t.special === null &&
            normal(r, c + 1, t.type) && normal(r + 1, c, t.type) && normal(r + 1, c + 1, t.type)) {
          squares.push({
            kind: "square", type: t.type,
            cells: [{ r, c }, { r, c: c + 1 }, { r: r + 1, c }, { r: r + 1, c: c + 1 }],
          });
        }
      }
    }
    return squares;
  }

  function getFeatures() {
    return getRuns().concat(getSquares());
  }
  function anyMatchExists() {
    return getRuns().length > 0 || getSquares().length > 0;
  }

  // Union overlapping features into match-groups.
  function getMatchGroups() {
    const feats = getFeatures();
    if (feats.length === 0) return [];

    const parent = feats.map((_, i) => i);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const union = (a, b) => { parent[find(a)] = find(b); };

    const cellFeats = new Map();
    feats.forEach((f, i) => {
      for (const cell of f.cells) {
        const k = keyOf(cell.r, cell.c);
        if (!cellFeats.has(k)) cellFeats.set(k, []);
        cellFeats.get(k).push(i);
      }
    });
    for (const list of cellFeats.values())
      for (let i = 1; i < list.length; i++) union(list[0], list[i]);

    const byRoot = new Map();
    feats.forEach((f, i) => {
      const root = find(i);
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root).push(f);
    });

    const groups = [];
    for (const fs of byRoot.values()) {
      const cellSet = new Set();
      const runs = [], squares = [];
      let hasH = false, hasV = false, maxLen = 0;
      for (const f of fs) {
        if (f.kind === "square") squares.push(f);
        else { runs.push(f); if (f.kind === "h") hasH = true; else hasV = true; maxLen = Math.max(maxLen, f.cells.length); }
        for (const cell of f.cells) cellSet.add(keyOf(cell.r, cell.c));
      }
      groups.push({
        cells: [...cellSet].map(parseKey),
        features: fs, runs, squares,
        hasH, hasV, hasSquare: squares.length > 0, maxLen,
        type: fs[0].type,
      });
    }
    return groups;
  }

  function hasAnyMove() {
    const swap = (r1, c1, r2, c2) => {
      const t = grid[r1][c1].type;
      grid[r1][c1].type = grid[r2][c2].type;
      grid[r2][c2].type = t;
    };
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= ROWS || nc >= COLS) continue;
          swap(r, c, nr, nc);
          const found = anyMatchExists();
          swap(r, c, nr, nc);
          if (found) return true;
        }
    return false;
  }

  // ============================================================
  //  Deciding & placing special jewels
  // ============================================================
  function decideSpecial(g) {
    if (g.maxLen >= 5) return "light";
    if (g.hasH && g.hasV) return "bomb";
    if (g.maxLen === 4) {
      const run4 = g.runs.find((r) => r.cells.length >= 4);
      return run4.kind === "h" ? "rocketH" : "rocketV";
    }
    if (g.hasSquare) return "propeller";
    return null;
  }

  function choosePlace(g, swapCells) {
    const cellSet = new Set(g.cells.map((c) => keyOf(c.r, c.c)));
    if (swapCells)
      for (const sc of swapCells) if (cellSet.has(keyOf(sc.r, sc.c))) return sc;
    // cell shared by 2+ features (intersection)
    const counts = new Map();
    for (const f of g.features)
      for (const cell of f.cells) {
        const k = keyOf(cell.r, cell.c);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    for (const [k, n] of counts) if (n >= 2) return parseKey(k);
    // middle of the longest run, else a square cell
    if (g.runs.length) {
      let longest = g.runs[0];
      for (const run of g.runs) if (run.cells.length > longest.cells.length) longest = run;
      return longest.cells[Math.floor(longest.cells.length / 2)];
    }
    return g.squares[0].cells[0];
  }

  function planFromGroups(groups, swapCells) {
    const clearSet = new Set();
    const createSpecials = [];
    for (const g of groups) {
      const spec = decideSpecial(g);
      const place = choosePlace(g, swapCells);
      for (const cell of g.cells) clearSet.add(keyOf(cell.r, cell.c));
      if (spec) {
        createSpecials.push({ r: place.r, c: place.c, special: spec, type: g.type });
        clearSet.delete(keyOf(place.r, place.c));
      }
    }
    return { clearSet, createSpecials };
  }

  // ============================================================
  //  Special blast geometry
  // ============================================================
  function pickLightColor() {
    const counts = new Array(NUM_TYPES).fill(0);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const t = grid[r][c];
        if (t && t.special === null) counts[t.type]++;
      }
    let best = 0;
    for (let i = 1; i < NUM_TYPES; i++) if (counts[i] > counts[best]) best = i;
    return best;
  }

  // Where a propeller flies: nearest crate, else nearest needed-colour jewel, else centre.
  function propellerTarget(sr, sc) {
    let best = null, bestD = Infinity;
    const consider = (r, c) => {
      const d = (r - sr) * (r - sr) + (c - sc) * (c - sc);
      if (d < bestD) { bestD = d; best = { r, c }; }
    };
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (cover[r][c] > 0) consider(r, c);
    if (best) return best;

    const need = objectives.filter((o) => o.kind === "gem" && o.got < o.need).map((o) => o.type);
    if (need.length) {
      bestD = Infinity; best = null;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const t = grid[r][c];
          if (t && t.special === null && need.includes(t.type)) consider(r, c);
        }
      if (best) return best;
    }
    return { r: Math.floor(ROWS / 2), c: Math.floor(COLS / 2) };
  }

  function blastCells(special, r, c) {
    const out = [];
    if (special === "rocketH") {
      for (let cc = 0; cc < COLS; cc++) out.push(keyOf(r, cc));
    } else if (special === "rocketV") {
      for (let rr = 0; rr < ROWS; rr++) out.push(keyOf(rr, c));
    } else if (special === "bomb") {
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          if (dr * dr + dc * dc > 5.2) continue;
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) out.push(keyOf(rr, cc));
        }
    } else if (special === "light") {
      const color = pickLightColor();
      out.push(keyOf(r, c));
      for (let rr = 0; rr < ROWS; rr++)
        for (let cc = 0; cc < COLS; cc++) {
          const t = grid[rr][cc];
          if (t && t.special === null && t.type === color) out.push(keyOf(rr, cc));
        }
    } else if (special === "propeller") {
      out.push(keyOf(r, c));
      const tg = propellerTarget(r, c);
      out.push(keyOf(tg.r, tg.c));
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = tg.r + dr, cc = tg.c + dc;
        if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) out.push(keyOf(rr, cc));
      }
    }
    return out;
  }

  // Detonate every existing special caught in the clear set (chain reaction).
  function expandActivations(clearSet) {
    const queue = [...clearSet];
    const fired = new Set();
    while (queue.length) {
      const k = queue.pop();
      if (fired.has(k)) continue;
      const { r, c } = parseKey(k);
      const t = grid[r][c];
      if (!t || !t.special) continue;
      fired.add(k);
      triggerFx(t.special, r, c);
      for (const bk of blastCells(t.special, r, c))
        if (!clearSet.has(bk)) { clearSet.add(bk); queue.push(bk); }
    }
  }

  // ============================================================
  //  Core loop: swap -> match -> clear -> fall -> repeat
  // ============================================================
  async function trySwap(a, b) {
    if (busy || gameOver) return;
    busy = true;
    selected = null;

    await animateSwap(a, b);
    const ta = grid[a.r][a.c];
    const tb = grid[b.r][b.c];

    if (ta.special || tb.special) {
      movesLeft--; updateHud();
      await activateSwapCombo(a, b, ta, tb);
      checkLevelEnd();
      busy = false;
      return;
    }

    if (getMatchGroups().length > 0) {
      movesLeft--; updateHud();
      sound.swap();
      await resolveBoard([a, b]);
      checkLevelEnd();
    } else {
      sound.fail();
      await animateSwap(a, b);
    }
    busy = false;
  }

  function animateSwap(a, b) {
    const ta = grid[a.r][a.c];
    const tb = grid[b.r][b.c];
    grid[a.r][a.c] = tb;
    grid[b.r][b.c] = ta;
    return Promise.all([
      tween(ta, { x: b.c * TILE, y: b.r * TILE }, 0.16),
      tween(tb, { x: a.c * TILE, y: a.r * TILE }, 0.16),
    ]);
  }

  async function resolveBoard(swapCells) {
    let combo = 0;
    while (true) {
      const groups = getMatchGroups();
      if (groups.length === 0) break;
      combo++;
      const { clearSet, createSpecials } = planFromGroups(groups, combo === 1 ? swapCells : null);
      if (createSpecials.length) sound.create();
      await stepClear(clearSet, createSpecials, combo);
    }
  }

  async function stepClear(clearSet, createSpecials, combo) {
    expandActivations(clearSet);
    for (const cs of createSpecials) clearSet.delete(keyOf(cs.r, cs.c)); // protect new specials

    const changed = trackObjectives(clearSet);
    const peeled = peelCovers(clearSet);
    if (peeled) {
      const co = objectives.find((o) => o.kind === "crate");
      if (co) co.got = Math.min(co.need, co.got + peeled);
    }
    if (changed || peeled) renderObjectives(true);

    const pts = clearSet.size * 10 * combo;
    score += pts;
    updateHud();

    spawnParticles(clearSet);
    spawnPopup(clearSet, pts, combo);
    sound.match(combo);

    await animateClear(clearSet, createSpecials);

    for (const k of clearSet) {
      const { r, c } = parseKey(k);
      grid[r][c] = null;
    }
    await applyGravity();
  }

  function animateClear(clearSet, createSpecials) {
    const ps = [];
    for (const k of clearSet) {
      const { r, c } = parseKey(k);
      const t = grid[r][c];
      if (t) ps.push(tween(t, { scale: 0, alpha: 0 }, 0.2, easeInQuad));
    }
    for (const cs of createSpecials) {
      const t = grid[cs.r][cs.c];
      if (t) {
        t.special = cs.special;
        t.scale = 1.4;
        ps.push(tween(t, { scale: 1 }, 0.28, easeOutBack));
      }
    }
    return Promise.all(ps);
  }

  function applyGravity() {
    const falls = [];
    for (let c = 0; c < COLS; c++) {
      let writeRow = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (grid[r][c]) {
          if (r !== writeRow) {
            const tile = grid[r][c];
            grid[writeRow][c] = tile;
            grid[r][c] = null;
            falls.push(tween(tile, { y: writeRow * TILE }, 0.28, easeOutQuad));
          }
          writeRow--;
        }
      }
      let spawn = 1;
      for (let r = writeRow; r >= 0; r--) {
        const tile = makeTile(randType(), r, c);
        tile.y = -spawn * TILE;
        grid[r][c] = tile;
        falls.push(tween(tile, { y: r * TILE }, 0.34, easeOutBack));
        spawn++;
      }
    }
    return Promise.all(falls);
  }

  // ============================================================
  //  Special-vs-special swap combinations
  // ============================================================
  function addRow(set, r) { for (let c = 0; c < COLS; c++) set.add(keyOf(r, c)); }
  function addCol(set, c) { for (let r = 0; r < ROWS; r++) set.add(keyOf(r, c)); }
  function addAll(set) { for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) set.add(keyOf(r, c)); }
  function addRadius(set, r, c, rad) {
    for (let dr = -rad; dr <= rad; dr++)
      for (let dc = -rad; dc <= rad; dc++) {
        if (dr * dr + dc * dc > rad * rad + 0.5) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) set.add(keyOf(rr, cc));
      }
  }
  function addColor(set, type) {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const t = grid[r][c];
        if (t && t.type === type) set.add(keyOf(r, c));
      }
  }
  function addBlast(set, special, r, c) {
    for (const k of blastCells(special, r, c)) set.add(k);
  }

  async function activateSwapCombo(a, b, ta, tb) {
    const sa = ta.special, sb = tb.special;
    const isRocket = (s) => s === "rocketH" || s === "rocketV";
    const set = new Set([keyOf(a.r, a.c), keyOf(b.r, b.c)]);

    if (sa === "light" && sb === "light") {
      addAll(set);
    } else if (sa === "light" || sb === "light") {
      const otherSpec = sa === "light" ? sb : sa;
      const otherTile = sa === "light" ? tb : ta;
      if (otherSpec === null) addColor(set, otherTile.type);
      else addAll(set); // colour bomb + special = clear the board
    } else if (isRocket(sa) && isRocket(sb)) {
      addRow(set, a.r); addCol(set, a.c);
    } else if ((isRocket(sa) && sb === "bomb") || (sa === "bomb" && isRocket(sb))) {
      for (let d = -1; d <= 1; d++) {
        if (a.r + d >= 0 && a.r + d < ROWS) addRow(set, a.r + d);
        if (a.c + d >= 0 && a.c + d < COLS) addCol(set, a.c + d);
      }
    } else if (sa === "bomb" && sb === "bomb") {
      addRadius(set, a.r, a.c, 3);
    } else {
      if (sa) addBlast(set, sa, a.r, a.c);
      if (sb) addBlast(set, sb, b.r, b.c);
    }

    if (sa) triggerFx(sa, a.r, a.c);
    if (sb) triggerFx(sb, b.r, b.c);
    sound.special();
    ta.special = null;
    tb.special = null;

    await stepClear(set, [], 1);
    await resolveBoard(null);
  }

  // ============================================================
  //  Crates / covers
  // ============================================================
  function peelCovers(clearSet) {
    const affected = new Set();
    for (const k of clearSet) {
      const { r, c } = parseKey(k);
      for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && cover[rr][cc] > 0)
          affected.add(keyOf(rr, cc));
      }
    }
    let removed = 0;
    for (const k of affected) {
      const { r, c } = parseKey(k);
      cover[r][c]--;
      removed++;
      spawnCrateParticles(r, c);
    }
    if (removed) sound.crate();
    return removed;
  }

  // ============================================================
  //  Objectives, HUD, win/lose
  // ============================================================
  function trackObjectives(clearSet) {
    let changed = false;
    for (const k of clearSet) {
      const { r, c } = parseKey(k);
      const t = grid[r][c];
      if (!t) continue;
      const obj = objectives.find((o) => o.kind === "gem" && o.type === t.type && o.got < o.need);
      if (obj) { obj.got++; changed = true; }
    }
    return changed;
  }

  function objectivesComplete() {
    return objectives.every((o) => o.got >= o.need);
  }

  function checkLevelEnd() {
    if (objectivesComplete()) winLevel();
    else if (movesLeft <= 0) loseLevel();
  }

  function computeStars() {
    if (movesLeft >= 12) return 3;
    if (movesLeft >= 6) return 2;
    return 1;
  }

  function winLevel() {
    gameOver = true;
    sound.win();
    const stars = computeStars();
    progress.stars[level] = Math.max(progress.stars[level] || 0, stars);
    if (level >= progress.unlocked) progress.unlocked = level + 1;
    saveProgress();
    showOverlay("🏆", "Level Complete!", "★".repeat(stars) + "☆".repeat(3 - stars),
      "The kingdom rejoices!", "Continue", showMap);
  }

  function loseLevel() {
    gameOver = true;
    sound.lose();
    progress.hearts = Math.max(0, progress.hearts - 1);
    saveProgress();
    renderHearts();
    const txt = progress.hearts > 0
      ? `You lost a life — ${progress.hearts} left.`
      : "No lives left! Refill them on the map.";
    showOverlay("👑", "Out of Moves", "", txt, "Back to Map", showMap);
  }

  function showOverlay(emoji, title, stars, text, btnLabel, onClick) {
    el.overlayEmoji.textContent = emoji;
    el.overlayTitle.textContent = title;
    el.overlayStars.textContent = stars || "";
    el.overlayText.textContent = text;
    el.overlayBtn.textContent = btnLabel;
    el.overlay.classList.remove("hidden");
    el.overlayBtn.onclick = () => { el.overlay.classList.add("hidden"); onClick(); };
  }

  function updateHud() {
    el.level.textContent = level;
    el.moves.textContent = movesLeft;
    el.moves.classList.toggle("low", movesLeft <= 5);
    el.score.textContent = score.toLocaleString();
  }

  const gemIconCache = {};
  let crateIconCache = null;
  function renderObjectives(bump) {
    el.objectives.innerHTML = "";
    for (const o of objectives) {
      const chip = document.createElement("div");
      chip.className = "obj-chip" + (o.got >= o.need ? " done" : "");
      const img = document.createElement("img");
      img.className = "obj-icon";
      img.src = o.kind === "crate"
        ? (crateIconCache || (crateIconCache = makeCrateIcon()))
        : (gemIconCache[o.type] || (gemIconCache[o.type] = makeGemIcon(o.type)));
      const cnt = document.createElement("span");
      cnt.textContent = o.got >= o.need ? "✓" : o.need - o.got;
      chip.appendChild(img);
      chip.appendChild(cnt);
      el.objectives.appendChild(chip);
      if (bump && o.got < o.need) {
        chip.classList.add("bump");
        setTimeout(() => chip.classList.remove("bump"), 160);
      }
    }
  }

  // ============================================================
  //  Lives + level-select map
  // ============================================================
  function renderHearts() {
    const html = Array.from({ length: MAX_HEARTS }, (_, i) =>
      `<span class="heart${i < progress.hearts ? "" : " empty"}">❤️</span>`).join("");
    el.heartsMap.innerHTML = html;
    el.heartsGame.innerHTML = html;
  }

  function renderMap() {
    el.mapPath.innerHTML = "";
    const maxShown = Math.max(8, progress.unlocked + 2);
    for (let L = 1; L <= maxShown; L++) {
      const node = document.createElement("button");
      const done = L < progress.unlocked;
      const current = L === progress.unlocked;
      node.className = "map-node" + (done ? " done" : current ? " current" : " locked");
      const num = document.createElement("span");
      num.textContent = L;
      node.appendChild(num);
      if (done) {
        const stars = progress.stars[L] || 1;
        const s = document.createElement("div");
        s.className = "node-stars";
        s.textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
        node.appendChild(s);
      }
      if (L <= progress.unlocked) {
        node.addEventListener("click", () => playLevel(L));
      }
      el.mapPath.appendChild(node);
    }
    // keep the current level in view
    const cur = el.mapPath.querySelector(".current");
    if (cur) cur.scrollIntoView({ block: "center" });
  }

  function showMap() {
    scene = "map";
    el.gameScreen.classList.add("hidden");
    el.mapScreen.classList.remove("hidden");
    renderHearts();
    renderMap();
  }
  function showGame() {
    scene = "game";
    el.mapScreen.classList.add("hidden");
    el.gameScreen.classList.remove("hidden");
  }

  function playLevel(L) {
    if (L > progress.unlocked) return;          // locked
    if (progress.hearts <= 0) {                 // no lives
      flashNoLives();
      return;
    }
    level = L;
    showGame();
    startLevel();
  }

  function flashNoLives() {
    el.heartsMap.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }],
      { duration: 300 }
    );
  }

  // ============================================================
  //  Level setup
  // ============================================================
  function startLevel() {
    el.overlay.classList.add("hidden");

    // objectives: collect a few colours
    const numColors = Math.min(1 + Math.ceil(level / 2), 4);
    const perColor = 14 + (level - 1) * 4;
    const palette = [...Array(NUM_TYPES).keys()];
    for (let i = palette.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [palette[i], palette[j]] = [palette[j], palette[i]];
    }
    objectives = palette.slice(0, numColors).map((type) => ({ kind: "gem", type, need: perColor, got: 0 }));

    score = 0;
    movesLeft = BASE_MOVES;
    gameOver = false;
    selected = null;
    dragStart = null;
    particles.length = 0;
    popups.length = 0;
    beams.length = 0;

    buildBoard();

    // crates: appear from level 2, more (and tougher) as you climb
    cover = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    if (level >= 2) {
      const crateCount = Math.min(3 + (level - 1) * 2, 16);
      const tough = level >= 4;
      let placed = 0, layers = 0;
      let guard = 0;
      while (placed < crateCount && guard++ < 500) {
        const r = Math.floor(Math.random() * ROWS);
        const c = Math.floor(Math.random() * COLS);
        if (cover[r][c] === 0) {
          const hp = tough && Math.random() < 0.4 ? 2 : 1;
          cover[r][c] = hp;
          layers += hp;
          placed++;
        }
      }
      objectives.push({ kind: "crate", need: layers, got: 0 });
    }

    renderObjectives(false);
    renderHearts();
    updateHud();
  }

  // ============================================================
  //  Particles / popups / beams
  // ============================================================
  const particles = [];
  const popups = [];
  const beams = [];

  function spawnParticles(clearSet) {
    for (const k of clearSet) {
      const { r, c } = parseKey(k);
      const t = grid[r][c];
      if (!t) continue;
      const color = GEMS[t.type].glow;
      const cx = t.x + TILE / 2, cy = t.y + TILE / 2;
      for (let i = 0; i < 4; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 130;
        particles.push({
          x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 50,
          life: 0.45 + Math.random() * 0.35, max: 0.8, color, size: 3 + Math.random() * 4,
        });
      }
    }
  }

  function spawnCrateParticles(r, c) {
    const cx = c * TILE + TILE / 2, cy = r * TILE + TILE / 2;
    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 120;
      particles.push({
        x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40,
        life: 0.5, max: 0.5, color: i % 2 ? "#b07a3c" : "#8a5a28", size: 3 + Math.random() * 3,
      });
    }
  }

  function spawnPopup(clearSet, pts, combo) {
    if (pts <= 0) return;
    let sx = 0, sy = 0, n = 0;
    for (const k of clearSet) {
      const { r, c } = parseKey(k);
      const t = grid[r][c];
      if (!t) continue;
      sx += t.x; sy += t.y; n++;
    }
    if (n === 0) return;
    popups.push({
      x: sx / n + TILE / 2, y: sy / n + TILE / 2,
      text: "+" + pts + (combo > 1 ? "  x" + combo : ""),
      life: 0, max: 0.9, color: combo > 1 ? "#ffd45e" : "#ffffff",
    });
  }

  function triggerFx(special, r, c) {
    if (special === "rocketH") beams.push({ kind: "h", r, life: 0, max: 0.35 });
    else if (special === "rocketV") beams.push({ kind: "v", c, life: 0, max: 0.35 });
    else if (special === "bomb") beams.push({ kind: "ring", r, c, life: 0, max: 0.4 });
    else if (special === "light") beams.push({ kind: "flash", life: 0, max: 0.4 });
    else if (special === "propeller") {
      const tg = propellerTarget(r, c);
      beams.push({
        kind: "fly", life: 0, max: 0.34,
        x0: c * TILE + TILE / 2, y0: r * TILE + TILE / 2,
        x1: tg.c * TILE + TILE / 2, y1: tg.r * TILE + TILE / 2,
      });
    }
    sound.boom(special);
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 480 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function updatePopups(dt) {
    for (let i = popups.length - 1; i >= 0; i--) {
      popups[i].life += dt;
      popups[i].y -= 34 * dt;
      if (popups[i].life >= popups[i].max) popups.splice(i, 1);
    }
  }
  function updateBeams(dt) {
    for (let i = beams.length - 1; i >= 0; i--) {
      beams[i].life += dt;
      if (beams[i].life >= beams[i].max) beams.splice(i, 1);
    }
  }

  // ============================================================
  //  Rendering
  // ============================================================
  function render() {
    ctx.clearRect(0, 0, COLS * TILE, ROWS * TILE);
    if (!grid.length) return;

    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? "rgba(255,255,255,.045)" : "rgba(255,255,255,.02)";
        pathRoundRect(ctx, c * TILE + 3, r * TILE + 3, TILE - 6, TILE - 6, 10);
        ctx.fill();
      }

    if (selected) {
      ctx.fillStyle = "rgba(255,212,94,.20)";
      pathRoundRect(ctx, selected.c * TILE + 2, selected.r * TILE + 2, TILE - 4, TILE - 4, 12);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,212,94,.9)";
      ctx.lineWidth = 3;
      pathRoundRect(ctx, selected.c * TILE + 2, selected.r * TILE + 2, TILE - 4, TILE - 4, 12);
      ctx.stroke();
    }

    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const tile = grid[r][c];
        if (tile) drawGem(ctx, tile);
      }

    // crates over the jewels
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (cover[r] && cover[r][c] > 0) drawCrate(ctx, r, c, cover[r][c]);

    drawBeams();
    drawParticles();
    drawPopups();
  }

  function drawGem(g, tile) {
    const gem = GEMS[tile.type];
    const cx = tile.x + TILE / 2, cy = tile.y + TILE / 2;
    const radius = (TILE / 2 - PAD) * tile.scale;
    if (radius <= 0) return;

    g.save();
    g.globalAlpha = tile.alpha;
    g.shadowColor = "rgba(0,0,0,.35)";
    g.shadowBlur = 6;
    g.shadowOffsetY = 3;

    const grad = g.createRadialGradient(cx - radius * 0.3, cy - radius * 0.35, radius * 0.2, cx, cy, radius);
    grad.addColorStop(0, gem.glow);
    grad.addColorStop(1, gem.color);
    g.fillStyle = grad;
    pathShape(g, gem.shape, cx, cy, radius);
    g.fill();

    g.shadowColor = "transparent";
    g.globalAlpha = tile.alpha * 0.5;
    g.fillStyle = "rgba(255,255,255,.6)";
    g.beginPath();
    g.ellipse(cx - radius * 0.28, cy - radius * 0.4, radius * 0.32, radius * 0.18, -0.5, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = tile.alpha;

    if (tile.special) drawSpecial(g, tile.special, cx, cy, radius);
    g.restore();
  }

  function drawSpecial(g, special, cx, cy, r) {
    g.save();
    if (special === "rocketH" || special === "rocketV") {
      g.fillStyle = "rgba(255,255,255,.95)";
      const vert = special === "rocketV";
      for (const dir of [-1, 1]) {
        g.beginPath();
        if (vert) {
          const y = cy + dir * r * 0.62;
          g.moveTo(cx - r * 0.34, y - dir * r * 0.05);
          g.lineTo(cx + r * 0.34, y - dir * r * 0.05);
          g.lineTo(cx, y + dir * r * 0.42);
        } else {
          const x = cx + dir * r * 0.62;
          g.moveTo(x - dir * r * 0.05, cy - r * 0.34);
          g.lineTo(x - dir * r * 0.05, cy + r * 0.34);
          g.lineTo(x + dir * r * 0.42, cy);
        }
        g.closePath();
        g.fill();
      }
    } else if (special === "bomb") {
      g.fillStyle = "rgba(20,12,30,.85)";
      g.beginPath();
      g.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,.9)";
      g.lineWidth = 2.5;
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5);
        g.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
        g.stroke();
      }
    } else if (special === "propeller") {
      g.fillStyle = "rgba(255,255,255,.95)";
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI * 2 / 3) * i;
        g.save();
        g.translate(cx, cy);
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, -r * 0.42, r * 0.16, r * 0.42, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.fillStyle = "#2a1a4a";
      g.beginPath();
      g.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
      g.fill();
    } else if (special === "light") {
      for (let i = 0; i < NUM_TYPES; i++) {
        const a = (Math.PI * 2 / NUM_TYPES) * i - Math.PI / 2;
        g.fillStyle = GEMS[i].color;
        g.beginPath();
        g.arc(cx + Math.cos(a) * r * 0.52, cy + Math.sin(a) * r * 0.52, r * 0.2, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "rgba(255,255,255,.95)";
      g.beginPath();
      g.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function drawCrate(g, r, c, hp) {
    const x = c * TILE + 3, y = r * TILE + 3, s = TILE - 6;
    g.save();
    g.globalAlpha = hp >= 2 ? 0.92 : 0.62;
    const grad = g.createLinearGradient(x, y, x, y + s);
    grad.addColorStop(0, "#b5803f");
    grad.addColorStop(1, "#7c4f22");
    g.fillStyle = grad;
    pathRoundRect(g, x, y, s, s, 9);
    g.fill();
    // planks / cross-brace
    g.strokeStyle = "rgba(60,35,12,.7)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x + 4, y + 4); g.lineTo(x + s - 4, y + s - 4);
    g.moveTo(x + s - 4, y + 4); g.lineTo(x + 4, y + s - 4);
    g.stroke();
    pathRoundRect(g, x + 2, y + 2, s - 4, s - 4, 7);
    g.stroke();
    if (hp < 2) { // cracked when one hit from breaking
      g.strokeStyle = "rgba(20,12,4,.85)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x + s * 0.5, y + 4);
      g.lineTo(x + s * 0.42, y + s * 0.5);
      g.lineTo(x + s * 0.6, y + s * 0.7);
      g.stroke();
    }
    g.restore();
  }

  function drawBeams() {
    for (const b of beams) {
      const a = 1 - b.life / b.max;
      if (b.kind === "h") {
        ctx.fillStyle = `rgba(255,232,150,${a * 0.6})`;
        ctx.fillRect(0, b.r * TILE + TILE * 0.2, COLS * TILE, TILE * 0.6);
      } else if (b.kind === "v") {
        ctx.fillStyle = `rgba(255,232,150,${a * 0.6})`;
        ctx.fillRect(b.c * TILE + TILE * 0.2, 0, TILE * 0.6, ROWS * TILE);
      } else if (b.kind === "ring") {
        const rad = (1 - a) * TILE * 2.6;
        ctx.strokeStyle = `rgba(255,180,90,${a})`;
        ctx.lineWidth = 6 * a + 1;
        ctx.beginPath();
        ctx.arc(b.c * TILE + TILE / 2, b.r * TILE + TILE / 2, rad, 0, Math.PI * 2);
        ctx.stroke();
      } else if (b.kind === "flash") {
        ctx.fillStyle = `rgba(255,255,255,${a * 0.5})`;
        ctx.fillRect(0, 0, COLS * TILE, ROWS * TILE);
      } else if (b.kind === "fly") {
        const t = b.life / b.max;
        const px = b.x0 + (b.x1 - b.x0) * t;
        const py = b.y0 + (b.y1 - b.y0) * t;
        ctx.strokeStyle = `rgba(255,255,255,${a * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x0, b.y0);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(b.life * 30);
        for (let i = 0; i < 3; i++) {
          ctx.rotate((Math.PI * 2) / 3);
          ctx.beginPath();
          ctx.ellipse(0, -7, 3, 7, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups() {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of popups) {
      const a = 1 - p.life / p.max;
      ctx.globalAlpha = a;
      ctx.font = "700 22px Fredoka, sans-serif";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,.5)";
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---- Shape paths (shared by board + icons) -------------------------------
  function pathShape(g, shape, cx, cy, r) {
    g.beginPath();
    switch (shape) {
      case "circle": g.arc(cx, cy, r, 0, Math.PI * 2); break;
      case "diamond":
        g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.85, cy);
        g.lineTo(cx, cy + r); g.lineTo(cx - r * 0.85, cy); g.closePath(); break;
      case "rounded": pathRoundRect(g, cx - r * 0.86, cy - r * 0.86, r * 1.72, r * 1.72, r * 0.4); break;
      case "triangle":
        g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.92, cy + r * 0.7);
        g.lineTo(cx - r * 0.92, cy + r * 0.7); g.closePath(); break;
      case "star": pathStar(g, cx, cy, r, r * 0.46, 5); break;
      case "hexagon":
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
          i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
        }
        g.closePath(); break;
    }
  }
  function pathStar(g, cx, cy, outer, inner, points) {
    for (let i = 0; i < points * 2; i++) {
      const rad = i % 2 === 0 ? outer : inner;
      const a = (Math.PI / points) * i - Math.PI / 2;
      const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
      i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath();
  }
  function pathRoundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function makeGemIcon(type) {
    const size = 44, r = 15;
    const cnv = document.createElement("canvas");
    cnv.width = cnv.height = size;
    const g = cnv.getContext("2d");
    const gem = GEMS[type];
    const cx = size / 2, cy = size / 2;
    const grad = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
    grad.addColorStop(0, gem.glow);
    grad.addColorStop(1, gem.color);
    g.fillStyle = grad;
    pathShape(g, gem.shape, cx, cy, r);
    g.fill();
    g.fillStyle = "rgba(255,255,255,.55)";
    g.beginPath();
    g.ellipse(cx - r * 0.28, cy - r * 0.4, r * 0.32, r * 0.18, -0.5, 0, Math.PI * 2);
    g.fill();
    return cnv.toDataURL();
  }
  function makeCrateIcon() {
    const size = 44;
    const cnv = document.createElement("canvas");
    cnv.width = cnv.height = size;
    const g = cnv.getContext("2d");
    const grad = g.createLinearGradient(0, 6, 0, size - 6);
    grad.addColorStop(0, "#b5803f");
    grad.addColorStop(1, "#7c4f22");
    g.fillStyle = grad;
    pathRoundRect(g, 6, 6, size - 12, size - 12, 7);
    g.fill();
    g.strokeStyle = "rgba(60,35,12,.8)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(9, 9); g.lineTo(size - 9, size - 9);
    g.moveTo(size - 9, 9); g.lineTo(9, size - 9);
    g.stroke();
    return cnv.toDataURL();
  }

  // ============================================================
  //  Sound (Web Audio — generated)
  // ============================================================
  const sound = (() => {
    let ctxA = null;
    let muted = false;
    function ensure() {
      if (!ctxA) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ctxA = new AC();
      }
      if (ctxA && ctxA.state === "suspended") ctxA.resume();
    }
    function tone(freq, dur, type, vol, when) {
      if (muted || !ctxA) return;
      const t0 = ctxA.currentTime + (when || 0);
      const o = ctxA.createOscillator();
      const gn = ctxA.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      o.connect(gn); gn.connect(ctxA.destination);
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.linearRampToValueAtTime(vol, t0 + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.start(t0); o.stop(t0 + dur + 0.03);
    }
    function noise(dur, vol, freq) {
      if (muted || !ctxA) return;
      const len = Math.floor(ctxA.sampleRate * dur);
      const buf = ctxA.createBuffer(1, len, ctxA.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctxA.createBufferSource();
      src.buffer = buf;
      const lp = ctxA.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = freq || 1400;
      const gn = ctxA.createGain(); gn.gain.value = vol;
      src.connect(lp); lp.connect(gn); gn.connect(ctxA.destination);
      src.start();
    }
    return {
      resume: ensure,
      toggle() { muted = !muted; if (!muted) ensure(); return muted; },
      swap() { tone(330, 0.08, "triangle", 0.1); },
      fail() { tone(180, 0.12, "sawtooth", 0.06); },
      match(combo) {
        const base = 440 * Math.pow(1.122, Math.min(combo, 8));
        tone(base, 0.13, "sine", 0.16);
        tone(base * 1.5, 0.1, "sine", 0.06, 0.02);
      },
      create() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, "triangle", 0.12, i * 0.05)); },
      special() { [392, 523, 659, 880].forEach((f, i) => tone(f, 0.14, "square", 0.08, i * 0.04)); },
      crate() { noise(0.18, 0.12, 700); tone(160, 0.12, "square", 0.06); },
      boom(kind) {
        if (kind === "bomb" || kind === "light") noise(0.4, 0.18, 900);
        else if (kind === "propeller") { noise(0.25, 0.1, 1800); tone(700, 0.18, "sawtooth", 0.05); }
        else noise(0.22, 0.14, 2200);
      },
      win() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, "triangle", 0.16, i * 0.12)); },
      lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.35, "sine", 0.16, i * 0.16)); },
    };
  })();

  // ============================================================
  //  Input
  // ============================================================
  function pointerToCell(evt) {
    const rect = canvas.getBoundingClientRect();
    const px = (evt.clientX - rect.left) * (COLS * TILE / rect.width);
    const py = (evt.clientY - rect.top) * (ROWS * TILE / rect.height);
    const c = Math.floor(px / TILE), r = Math.floor(py / TILE);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return { r, c };
  }
  const adjacent = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

  function onPointerDown(evt) {
    sound.resume();
    if (busy || gameOver) return;
    evt.preventDefault();
    const cell = pointerToCell(evt);
    if (!cell) return;
    dragStart = cell;
    if (selected && adjacent(selected, cell)) trySwap(selected, cell);
    else if (selected && selected.r === cell.r && selected.c === cell.c) selected = null;
    else selected = cell;
  }
  function onPointerMove(evt) {
    if (busy || gameOver || !dragStart) return;
    const cell = pointerToCell(evt);
    if (!cell) return;
    if (adjacent(dragStart, cell)) {
      const from = dragStart;
      dragStart = null;
      selected = null;
      trySwap(from, cell);
    }
  }
  function onPointerUp() { dragStart = null; }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  // ============================================================
  //  Buttons
  // ============================================================
  el.shuffleBtn.addEventListener("click", () => {
    if (busy || gameOver) return;
    const cells = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (grid[r][c].special === null) cells.push(grid[r][c]);
    let guard = 0;
    do {
      const types = cells.map((t) => t.type);
      for (let i = types.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [types[i], types[j]] = [types[j], types[i]];
      }
      cells.forEach((t, i) => (t.type = types[i]));
    } while ((anyMatchExists() || !hasAnyMove()) && guard++ < 50);
  });

  el.restartBtn.addEventListener("click", () => { if (!busy) startLevel(); });
  el.backBtn.addEventListener("click", showMap);

  el.muteBtn.addEventListener("click", () => {
    const muted = sound.toggle();
    el.muteBtn.textContent = muted ? "🔇 Muted" : "🔊 Sound";
  });

  el.refillBtn.addEventListener("click", () => {
    progress.hearts = MAX_HEARTS;
    saveProgress();
    renderHearts();
  });
  el.resetBtn.addEventListener("click", () => {
    if (!window.confirm("Reset all progress, lives, and stars?")) return;
    progress = { unlocked: 1, hearts: MAX_HEARTS, stars: {} };
    saveProgress();
    renderHearts();
    renderMap();
  });

  // ============================================================
  //  Main loop + boot
  // ============================================================
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    updateTweens(dt);
    updateParticles(dt);
    updatePopups(dt);
    updateBeams(dt);
    if (scene === "game") render();
    requestAnimationFrame(loop);
  }

  showMap();
  requestAnimationFrame(loop);
})();
