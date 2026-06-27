/*
 * minions.js — the CHEGG minion registry + the "spawn egg" sprites.
 *
 * Each minion is DATA + small pattern functions the engine (game.js) calls:
 *   moveTargets(p, game)   -> [{ r, c, jumpedOver? }]   empty tiles it may move to
 *   attackTargets(p, game) -> [{ r, c }]                enemy tiles it may attack
 *   onAttack(p, target, game)   resolves an attack (handles AoE / explosions)
 *   onMove / onSpawn / onDeath  optional lifecycle hooks
 *   ability { name, cost, desc, targets(p,game), resolve(p,target,game) }  optional
 *
 * `pattern` is a purely-visual move/attack offset list used by the inspector
 * preview (forward = up = negative row). It never affects the rules.
 */
(function () {
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIAG  = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const KING  = ORTHO.concat(DIAG);

  // --- geometry helpers -------------------------------------------------------
  function adjacentEmpty(p, game, dirs) {
    const out = [];
    for (const [dr, dc] of dirs) {
      const r = p.r + dr, c = p.c + dc;
      if (game.inBounds(r, c) && game.isEmpty(r, c)) out.push({ r, c });
    }
    return out;
  }
  function adjacentEnemies(p, game, dirs) {
    const out = [];
    for (const [dr, dc] of dirs) {
      const r = p.r + dr, c = p.c + dc;
      if (game.inBounds(r, c) && game.isEnemy(p, r, c)) out.push({ r, c });
    }
    return out;
  }
  function rayEnemies(p, game, dirs, range) {
    const out = [];
    for (const [dr, dc] of dirs) {
      for (let step = 1; step <= range; step++) {
        const r = p.r + dr * step, c = p.c + dc * step;
        if (!game.inBounds(r, c)) break;
        if (game.isEnemy(p, r, c)) { out.push({ r, c }); break; }
        if (game.isBlocked(r, c)) break;  // an intact wall is cover — blocks the shot
        if (!game.isEmpty(r, c)) break;   // a friendly piece blocks the shot
      }
    }
    return out;
  }
  function arcTiles(p, dr, dc) {
    const front = { r: p.r + dr, c: p.c + dc };
    return [front, { r: front.r + dc, c: front.c + dr }, { r: front.r - dc, c: front.c - dr }];
  }
  // diagonal offsets out to a range, as a flat pattern list
  function diagPattern(range) {
    const out = [];
    for (const [dr, dc] of DIAG) for (let s = 1; s <= range; s++) out.push([dr * s, dc * s]);
    return out;
  }
  function orthoPattern(range) {
    const out = [];
    for (const [dr, dc] of ORTHO) for (let s = 1; s <= range; s++) out.push([dr * s, dc * s]);
    return out;
  }
  function chebPattern(range) { // every tile within king-distance `range`
    const out = [];
    for (let dr = -range; dr <= range; dr++) for (let dc = -range; dc <= range; dc++) if (dr || dc) out.push([dr, dc]);
    return out;
  }

  const MINIONS = {
    /* ---------------------------- the King ---------------------------------- */
    villager: {
      name: "Villager", cost: 0, deckable: false,
      desc: "Your king. Moves/attacks the 8 surrounding tiles (1 mana each). If it dies, you lose.",
      pattern: { move: KING, attack: KING },
    },

    /* ------------------------------- cost 1 --------------------------------- */
    zombie: {
      name: "Zombie", cost: 1, deckable: true,
      desc: "Moves up to 3 tiles straight forward. Attacks the 4 orthogonally-adjacent tiles.",
      pattern: { move: [[-1, 0], [-2, 0], [-3, 0]], attack: ORTHO },
      moveTargets(p, game) {
        const dir = game.forward(p.owner), out = [];
        for (let step = 1; step <= 3; step++) {
          const r = p.r + dir * step, c = p.c;
          if (!game.inBounds(r, c) || !game.isEmpty(r, c)) break;
          out.push({ r, c });
        }
        return out;
      },
      attackTargets(p, game) { return adjacentEnemies(p, game, ORTHO); },
      onAttack(p, t, game) { game.destroyAt(t.r, t.c); },
    },

    creeper: {
      name: "Creeper", cost: 1, deckable: true,
      desc: "Moves to any of the 8 surrounding tiles. Attack = EXPLODE: destroys all adjacent minions (and itself).",
      pattern: { move: KING, attack: KING },
      selfDestructs: true,
      moveTargets(p, game) { return adjacentEmpty(p, game, KING); },
      attackTargets(p, game) { return adjacentEnemies(p, game, KING); },
      onAttack(p, _t, game) {
        for (const [dr, dc] of KING) game.destroyAt(p.r + dr, p.c + dc);
        game.destroyAt(p.r, p.c); // self-destruct
      },
    },

    pig: {
      name: "Pig", cost: 1, deckable: true,
      desc: "Cannot attack. Moves to the 8 surrounding tiles. Draw 1 when it spawns AND when it dies.",
      pattern: { move: KING, attack: [] },
      moveTargets(p, game) { return adjacentEmpty(p, game, KING); },
      attackTargets() { return []; },
      onSpawn(p, game) { game.log(`${p.owner}: Pig spawned — draw a minion.`, p.owner); game.draw(p.owner); },
      onDeath(p, game) { game.log(`${p.owner}: Pig died — draw a minion.`, p.owner); game.draw(p.owner); },
    },

    /* ------------------------------- cost 2 --------------------------------- */
    rabbit: {
      name: "Rabbit", cost: 2, deckable: true,
      desc: "Cannot attack. Hops exactly 2 tiles orthogonally (over pieces). Draw 1 if it hops over a minion.",
      pattern: { move: [[-2, 0], [2, 0], [0, -2], [0, 2]], attack: [] },
      moveTargets(p, game) {
        const out = [];
        for (const [dr, dc] of ORTHO) {
          const mr = p.r + dr, mc = p.c + dc;
          const r = p.r + dr * 2, c = p.c + dc * 2;
          if (!game.inBounds(r, c) || !game.isEmpty(r, c)) continue;
          out.push({ r, c, jumpedOver: game.inBounds(mr, mc) && !game.isEmpty(mr, mc) });
        }
        return out;
      },
      attackTargets() { return []; },
      onMove(p, dest, game) {
        if (dest.jumpedOver) { game.log(`${p.owner}: Rabbit hopped a piece — draw a minion.`, p.owner); game.draw(p.owner); }
      },
    },

    puffer: {
      name: "Puffer-Fish", cost: 2, deckable: true,
      desc: "Moves 1 tile orthogonally. Attacks ALL 4 diagonal tiles at once.",
      pattern: { move: ORTHO, attack: DIAG },
      moveTargets(p, game) { return adjacentEmpty(p, game, ORTHO); },
      attackTargets(p, game) { return adjacentEnemies(p, game, DIAG); },
      onAttack(p, _t, game) {
        for (const [dr, dc] of DIAG) {
          const r = p.r + dr, c = p.c + dc;
          if (game.inBounds(r, c) && game.isEnemy(p, r, c)) game.destroyAt(r, c);
        }
      },
    },

    frog: {
      name: "Frog", cost: 2, deckable: true,
      desc: "Cannot attack. Moves 1 tile orthogonally. Ability: pull the nearest minion in a straight line 2 tiles closer.",
      pattern: { move: ORTHO, attack: [] },
      moveTargets(p, game) { return adjacentEmpty(p, game, ORTHO); },
      attackTargets() { return []; },
      ability: {
        name: "Pull", cost: 1,
        desc: "Drag the nearest minion in a row/column 2 tiles toward the Frog.",
        targets(p, game) {
          const out = [];
          for (const [dr, dc] of ORTHO) {
            for (let s = 1; s < Math.max(game.ROWS, game.COLS); s++) {
              const r = p.r + dr * s, c = p.c + dc * s;
              if (!game.inBounds(r, c)) break;
              if (!game.isEmpty(r, c)) { if (s >= 2 && game.at(r, c)) out.push({ r, c }); break; } // a piece (not a wall), with room to pull
            }
          }
          return out;
        },
        resolve(p, target, game) {
          const dr = Math.sign(target.r - p.r), dc = Math.sign(target.c - p.c);
          const dist = Math.abs(target.r - p.r) + Math.abs(target.c - p.c); // straight line, so one axis
          const pull = Math.min(2, dist - 1);
          const nr = target.r - dr * pull, nc = target.c - dc * pull;
          const piece = game.at(target.r, target.c);
          game.relocatePublic(piece, nr, nc);
          game.log(`${p.owner}'s Frog pulled a minion closer.`, p.owner);
        },
      },
    },

    irongolem: {
      name: "Iron-Golem", cost: 2, deckable: true,
      desc: "Moves to the 8 surrounding tiles. Attacks a 3-tile arc in a chosen direction.",
      pattern: { move: KING, attack: [[-1, 0], [-1, -1], [-1, 1]] }, // representative (up) arc
      moveTargets(p, game) { return adjacentEmpty(p, game, KING); },
      attackTargets(p, game) {
        const seen = new Set(), out = [];
        for (const [dr, dc] of ORTHO) for (const t of arcTiles(p, dr, dc)) {
          const key = t.r + "," + t.c;
          if (game.inBounds(t.r, t.c) && game.isEnemy(p, t.r, t.c) && !seen.has(key)) { seen.add(key); out.push(t); }
        }
        return out;
      },
      onAttack(p, target, game) {
        let best = null, bestKills = -1;
        for (const [dr, dc] of ORTHO) {
          const arc = arcTiles(p, dr, dc);
          if (!arc.some(t => t.r === target.r && t.c === target.c)) continue;
          const kills = arc.filter(t => game.inBounds(t.r, t.c) && game.isEnemy(p, t.r, t.c)).length;
          if (kills > bestKills) { bestKills = kills; best = arc; }
        }
        if (best) for (const t of best) if (game.inBounds(t.r, t.c) && game.isEnemy(p, t.r, t.c)) game.destroyAt(t.r, t.c);
      },
    },

    /* ------------------------------- cost 3 --------------------------------- */
    skeleton: {
      name: "Skeleton", cost: 3, deckable: true,
      desc: "Moves 1 tile orthogonally. Ranged: shoots an enemy up to 3 tiles away diagonally (blocked by pieces).",
      pattern: { move: ORTHO, attack: diagPattern(3) },
      moveTargets(p, game) { return adjacentEmpty(p, game, ORTHO); },
      attackTargets(p, game) { return rayEnemies(p, game, DIAG, 3); },
      onAttack(p, t, game) { game.destroyAt(t.r, t.c); },
    },

    blaze: {
      name: "Blaze", cost: 3, deckable: true,
      desc: "Moves 1 tile diagonally. Ranged: shoots an enemy up to 2 tiles away orthogonally (blocked by pieces).",
      pattern: { move: DIAG, attack: orthoPattern(2) },
      moveTargets(p, game) { return adjacentEmpty(p, game, DIAG); },
      attackTargets(p, game) { return rayEnemies(p, game, ORTHO, 2); },
      onAttack(p, t, game) { game.destroyAt(t.r, t.c); },
    },

    phantom: {
      name: "Phantom", cost: 3, deckable: true,
      desc: "Ghost of the dark tiles. Moves & attacks the diagonally-adjacent (dark) tiles only.",
      pattern: { move: DIAG, attack: DIAG },
      moveTargets(p, game) {
        return adjacentEmpty(p, game, KING).filter(t => game.isDark(t.r, t.c));
      },
      attackTargets(p, game) {
        return adjacentEnemies(p, game, KING).filter(t => game.isDark(t.r, t.c));
      },
      onAttack(p, t, game) { game.destroyAt(t.r, t.c); },
    },

    /* ------------------------------- cost 4 --------------------------------- */
    enderman: {
      name: "Enderman", cost: 4, deckable: true,
      desc: "Cannot walk. Attacks all 8 surrounding tiles. Ability: teleport-swap with an adjacent minion.",
      pattern: { move: [], attack: KING },
      moveTargets() { return []; },              // cannot move normally
      attackTargets(p, game) { return adjacentEnemies(p, game, KING); },
      onAttack(p, t, game) { game.destroyAt(t.r, t.c); },
      ability: {
        name: "Teleport", cost: 1,
        desc: "Swap places with an orthogonally-adjacent minion (not a Villager).",
        targets(p, game) {
          const out = [];
          for (const [dr, dc] of ORTHO) {
            const r = p.r + dr, c = p.c + dc, o = game.at(r, c);
            if (o && o.type !== "villager") out.push({ r, c });
          }
          return out;
        },
        resolve(p, target, game) { game.swapPieces(p, game.at(target.r, target.c)); game.log(`${p.owner}'s Enderman teleported.`, p.owner); },
      },
    },

    /* ------------------------------- cost 5 --------------------------------- */
    sniffer: {
      name: "Sniffer", cost: 5, deckable: true,
      desc: "Cannot attack. Moves to the 8 surrounding tiles. On spawn: steal 2 cards from the enemy deck. On death: discard 2.",
      pattern: { move: KING, attack: [] },
      moveTargets(p, game) { return adjacentEmpty(p, game, KING); },
      attackTargets() { return []; },
      onSpawn(p, game) { game.log(`${p.owner}: Sniffer sniffs the enemy deck — steal 2 cards.`, p.owner); game.stealFromOpponent(p.owner, 2); },
      onDeath(p, game) { game.log(`${p.owner}: Sniffer died — discard 2 cards.`, p.owner); game.discardRandom(p.owner, 2); },
    },

    cat: {
      name: "Cat", cost: 5, deckable: true,
      desc: "Cannot move or attack. While alive, you gain +1 extra mana at the start of every turn (stacks).",
      pattern: { move: [], attack: [] },
      moveTargets() { return []; },
      attackTargets() { return []; },
      // The mana bonus is applied in game._beginTurn (passive aura).
    },

    slime: {
      name: "Slime", cost: 4, deckable: true,
      desc: "Bouncy. Moves to a surrounding tile or jumps 2 (through a piece). Attacks by hopping onto an adjacent enemy.",
      pattern: { move: KING.concat([[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [-2, 2], [2, -2], [2, 2]]), attack: KING },
      moveTargets(p, game) {
        const out = [];
        for (const [dr, dc] of KING) {
          const r1 = p.r + dr, c1 = p.c + dc;
          if (game.inBounds(r1, c1) && game.isEmpty(r1, c1)) out.push({ r: r1, c: c1 });
          const r2 = p.r + dr * 2, c2 = p.c + dc * 2;            // jump 2, passing through a piece
          if (game.inBounds(r2, c2) && game.isEmpty(r2, c2)) out.push({ r: r2, c: c2 });
        }
        return out;
      },
      attackTargets(p, game) { return adjacentEnemies(p, game, KING); },
      onAttack(p, t, game) { game.destroyAt(t.r, t.c); if (game.isEmpty(t.r, t.c)) game.relocatePublic(p, t.r, t.c); },
    },

    shulker: {
      name: "Shulker-Box", cost: 4, deckable: true,
      desc: "A turret. Cannot move. Fires down any row or column, hitting the first enemy (blocked by pieces).",
      pattern: { move: [], attack: orthoPattern(3) },
      moveTargets() { return []; },
      attackTargets(p, game) { return rayEnemies(p, game, ORTHO, Math.max(game.ROWS, game.COLS)); },
      onAttack(p, t, game) { game.destroyAt(t.r, t.c); },
    },

    parrot: {
      name: "Parrot", cost: 5, deckable: true,
      desc: "Mimic. Moves to the 8 surrounding tiles. Copies the attack pattern of any minion standing next to it.",
      pattern: { move: KING, attack: [] },
      moveTargets(p, game) { return adjacentEmpty(p, game, KING); },
      attackTargets(p, game) {
        const out = [], seen = new Set();
        for (const [dr, dc] of KING) {
          const m = game.at(p.r + dr, p.c + dc);
          if (!m) continue;
          const pat = (MINIONS[m.type].pattern && MINIONS[m.type].pattern.attack) || [];
          for (const [or, oc] of pat) {
            const r = p.r + or, c = p.c + oc, k = r + "," + c;
            if (game.inBounds(r, c) && game.isEnemy(p, r, c) && !seen.has(k)) { seen.add(k); out.push({ r, c }); }
          }
        }
        return out;
      },
      onAttack(p, t, game) { game.destroyAt(t.r, t.c); },
    },

    wither: {
      name: "Wither", cost: 6, deckable: true,
      desc: "Boss. On spawn it blasts all 8 adjacent tiles. Moves to 8 surrounding. Ranged attack (2 mana): up to 3 in a line, with splash.",
      pattern: { move: KING, attack: orthoPattern(3) },
      attackCost: 2, blastOnSpawn: true,
      moveTargets(p, game) { return adjacentEmpty(p, game, KING); },
      attackTargets(p, game) { return rayEnemies(p, game, ORTHO, 3); },
      onSpawn(p, game) {
        game.log(`${p.owner}: Wither erupts — all adjacent tiles destroyed!`, p.owner);
        for (const [dr, dc] of KING) game.destroyAt(p.r + dr, p.c + dc);
      },
      onAttack(p, t, game) {
        game.destroyAt(t.r, t.c);
        for (const [dr, dc] of ORTHO) game.destroyAt(t.r + dr, t.c + dc); // splash to 4 lateral tiles
      },
    },

    /* ===================== bonus mobs (beyond gerg's roster) ================= */
    bee: {
      name: "Bee", cost: 1, deckable: true,
      desc: "Kamikaze. Moves to the 8 surrounding tiles. Sting: destroy one adjacent enemy — but the Bee dies too.",
      pattern: { move: KING, attack: KING },
      selfDestructs: true,
      moveTargets(p, game) { return adjacentEmpty(p, game, KING); },
      attackTargets(p, game) { return adjacentEnemies(p, game, KING); },
      onAttack(p, t, game) { game.destroyAt(t.r, t.c); game.destroyAt(p.r, p.c); },
    },

    allay: {
      name: "Allay", cost: 2, deckable: true,
      desc: "Helper. Cannot attack. Moves to the 8 surrounding tiles. While alive, draw +1 card at the start of your turn.",
      pattern: { move: KING, attack: [] },
      moveTargets(p, game) { return adjacentEmpty(p, game, KING); },
      attackTargets() { return []; },
      // bonus draw applied in game._beginTurn (passive aura)
    },

    ghast: {
      name: "Ghast", cost: 5, deckable: true,
      desc: "Floating bombarder. Moves to the 8 surrounding tiles. Fireball: hit any enemy within 3 tiles (any direction, ignores cover) with splash.",
      pattern: { move: KING, attack: chebPattern(3) },
      moveTargets(p, game) { return adjacentEmpty(p, game, KING); },
      attackTargets(p, game) {
        const out = [];
        for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
          if (!dr && !dc) continue;
          const r = p.r + dr, c = p.c + dc;
          if (game.inBounds(r, c) && game.isEnemy(p, r, c)) out.push({ r, c });
        }
        return out;
      },
      onAttack(p, t, game) { game.destroyAt(t.r, t.c); for (const [dr, dc] of ORTHO) game.destroyAt(t.r + dr, t.c + dc); },
    },

    warden: {
      name: "Warden", cost: 6, deckable: true,
      desc: "Blind brute. Moves to the 8 surrounding tiles. Sonic Boom: hit any enemy in its row or column at ANY distance — nothing blocks it.",
      pattern: { move: KING, attack: orthoPattern(3) },
      moveTargets(p, game) { return adjacentEmpty(p, game, KING); },
      attackTargets(p, game) {
        const out = [], far = Math.max(game.ROWS, game.COLS);
        for (const [dr, dc] of ORTHO) for (let s = 1; s < far; s++) {
          const r = p.r + dr * s, c = p.c + dc * s;
          if (!game.inBounds(r, c)) break;
          if (game.isEnemy(p, r, c)) out.push({ r, c }); // pierces — never breaks on a blocker
        }
        return out;
      },
      onAttack(p, t, game) { game.destroyAt(t.r, t.c); },
    },
  };

  /* ============================ SPAWN-EGG SPRITES ============================
   * Pixel-art "spawn egg" textures, drawn as <rect> pixels from a hand-authored
   * 16x16 mask. This recreates the *look* of the modern Minecraft spawn egg (the
   * rounded egg silhouette + speckled two-tone overlay) as original art — it does
   * not use Mojang's texture files. Each minion just supplies a base + spot colour.
   */
  const EGG_COLORS = {
    villager:  { base: "#8a6a52", spot: "#caa07e" },
    zombie:    { base: "#2fa9a0", spot: "#6f9b5f" },
    creeper:   { base: "#4fbf4a", spot: "#1d6b1a" },
    pig:       { base: "#f2a7a3", spot: "#d9706b" },
    rabbit:    { base: "#b08358", spot: "#7a5638" },
    puffer:    { base: "#f4c430", spot: "#36c0e8" },
    frog:      { base: "#6fae3e", spot: "#d8623b" },
    irongolem: { base: "#d8d2c8", spot: "#8fae6b" },
    skeleton:  { base: "#d7d7d7", spot: "#5a5a5a" },
    blaze:     { base: "#f7c331", spot: "#fff07a" },
    phantom:   { base: "#586a86", spot: "#222f45" },
    enderman:  { base: "#1b1726", spot: "#9b59ff" },
    sniffer:   { base: "#c45a3b", spot: "#6fae8f" },
    cat:       { base: "#3a3a3a", spot: "#c98b3a" },
    slime:     { base: "#6fd06b", spot: "#3f8f3a" },
    shulker:   { base: "#9a7d96", spot: "#46324a" },
    parrot:    { base: "#37a82f", spot: "#e23b3b" },
    wither:    { base: "#2f3431", spot: "#5a5f59" },
    bee:       { base: "#f2c84b", spot: "#3a2e16" },
    allay:     { base: "#4fa6e0", spot: "#bfe6ff" },
    ghast:     { base: "#ededed", spot: "#9a9a9a" },
    warden:    { base: "#13403e", spot: "#36e0d0" },
  };

  // 1px-per-cell egg silhouette (16x16). 'O' = outline, 'F' = fill, '.' = transparent.
  const EGG_MASK = [
    "................", "......OOOO......", ".....OFFFFO.....", "....OFFFFFFO....",
    "....OFFFFFFO....", "...OFFFFFFFFO...", "...OFFFFFFFFO...", "..OFFFFFFFFFFO..",
    "..OFFFFFFFFFFO..", "..OFFFFFFFFFFO..", "..OFFFFFFFFFFO..", "...OFFFFFFFFO...",
    "...OFFFFFFFFO...", "....OFFFFFFO....", ".....OFFFFO.....", "......OOOO......",
  ];
  const SPOTS = new Set(["2,8", "3,6", "4,9", "5,4", "6,7", "7,11", "8,5", "9,8", "10,4", "10,11", "11,7", "13,8"]);
  const HIGHS = new Set(["2,6", "3,5", "4,6", "5,5", "6,4", "7,4"]);
  const SHADES = new Set(["8,12", "9,12", "10,12", "11,10", "12,9"]);

  // shift a hex colour toward white (amt>0) or black (amt<0)
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const t = amt < 0 ? 0 : 255, k = Math.abs(amt);
    const ch = (sh) => { const v = (n >> sh) & 255; return Math.round(v + (t - v) * k); };
    return "#" + ((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1);
  }

  function eggSprite(type, owner, size) {
    const p = EGG_COLORS[type] || { base: "#aaa", spot: "#777" };
    const outline = shade(p.base, -0.5), hi = shade(p.base, 0.34), sh = shade(p.base, -0.18);
    let rects = "";
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
      const ch = EGG_MASK[r][c];
      if (ch === ".") continue;
      let col;
      if (ch === "O") col = outline;
      else { const k = r + "," + c; col = SPOTS.has(k) ? p.spot : HIGHS.has(k) ? hi : SHADES.has(k) ? sh : p.base; }
      rects += `<rect x="${c}" y="${r}" width="1.02" height="1.02" fill="${col}"/>`;
    }
    const dim = size ? `width="${size}" height="${size}"` : "";
    return `<svg class="egg" viewBox="0 0 16 16" ${dim} shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${rects}</svg>`;
  }

  // Exports
  window.MINIONS = MINIONS;
  window.MINION_DIRS = { ORTHO, DIAG, KING };
  window.EGG_COLORS = EGG_COLORS;
  window.eggSprite = eggSprite;
  window.DECK_POOL = Object.keys(MINIONS).filter(k => MINIONS[k].deckable);
})();
