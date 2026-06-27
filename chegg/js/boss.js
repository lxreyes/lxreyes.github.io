/*
 * boss.js — BOSS MODE. The red "team" is a single, huge boss mob with lots of
 * HP and a godly ability. You win by defeating it; you lose if it destroys your
 * Villager. Each boss is a mega form of a mob we already have, plus a brand-new
 * Elder Guardian with a debuffing curse.
 *
 * The boss is driven directly here (not through the normal minion rules): it
 * moves toward your king, attacks with a signature pattern, and periodically
 * casts a debuff. takeOneAction() performs one step per call so the UI animates.
 */
(function () {
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const dist = (ar, ac, br, bc) => Math.abs(ar - br) + Math.abs(ac - bc);

  const bluePieces = game => [].concat(...game.board.map(row => row.filter(Boolean))).filter(p => p.owner === "blue");
  const blueMinions = game => bluePieces(game).filter(p => p.type !== "villager" && !p.isBoss);

  function freezeRandom(game, n) {
    const mins = blueMinions(game).filter(p => !(p.thawTurn && game.turnId < p.thawTurn));
    for (let i = 0; i < n && mins.length; i++) {
      const idx = Math.floor(Math.random() * mins.length);
      mins[idx].thawTurn = game.turnId + 2;   // frozen through blue's next turn
      mins.splice(idx, 1);
    }
  }
  function adjacentToKing(game, boss) {
    const v = game.villagerOf("blue");
    return v && Math.max(Math.abs(v.r - boss.r), Math.abs(v.c - boss.c)) === 1 ? v : null;
  }
  // Damage the nearest blue minion in each orthogonal direction (a piercing beam,
  // stopped by terrain walls).
  function beamMinions(game, boss) {
    let did = false;
    for (const [dr, dc] of ORTHO) for (let s = 1; s < Math.max(game.ROWS, game.COLS); s++) {
      const r = boss.r + dr * s, c = boss.c + dc * s;
      if (!game.inBounds(r, c) || game.isBlocked(r, c)) break;
      const o = game.at(r, c);
      if (o) { if (o.owner === "blue" && o.type !== "villager" && !o.isBoss) { game.destroyAt(r, c); did = true; } break; }
    }
    return did;
  }

  const BOSSES = [
    {
      id: "elder_guardian", name: "Elder Guardian", emoji: "🔱", hp: 14, move: 1,
      tagline: "An ancient warden of the deep with a cursing gaze.",
      board: { name: "Ocean Monument", theme: "water", biome: "ocean", rows: 11, cols: 14, blocked: ["4,6", "4,7", "6,6", "6,7", "3,3", "3,10", "7,3", "7,10", "5,5", "5,8"] },
      attack(boss, game) {
        const v = adjacentToKing(game, boss);
        if (v) { game.destroyAt(v.r, v.c); return true; }       // bites the king
        const did = beamMinions(game, boss);
        if (did) game.log("🔱 Elder Guardian fires piercing beams!", "red");
        return did;
      },
      ability: {
        name: "Mining Fatigue", cd: 4,
        desc: "Curses you: −2 mana next turn and freezes a minion.",
        cast(boss, game) {
          game.players.blue.manaPenalty += 2;
          freezeRandom(game, 1);
          game.log("🔱 Elder Guardian casts MINING FATIGUE — you are weakened!", "red");
        },
      },
    },
    {
      id: "wither_storm", name: "Wither Storm", emoji: "💀", hp: 16, move: 1,
      tagline: "A growing horror that rains decay on your ranks.",
      board: { name: "Nether Wastes", theme: "lava", biome: "nether", rows: 11, cols: 14, blocked: ["3,4", "3,9", "7,4", "7,9", "5,6", "5,7", "4,2", "6,11"] },
      attack(boss, game) {
        const blues = bluePieces(game);
        if (!blues.length) return false;
        let best = blues[0], bestN = -1;                        // aim at the densest cluster
        for (const b of blues) {
          let n = 0;
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const o = game.at(b.r + dr, b.c + dc); if (o && o.owner === "blue" && !o.isBoss) n++; }
          if (n > bestN) { bestN = n; best = b; }
        }
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) game.destroyAt(best.r + dr, best.c + dc);
        game.log("💀 Wither Storm unleashes a DECAY BLAST!", "red");
        return true;
      },
      ability: {
        name: "Withering", cd: 4,
        desc: "Destroys 1 of your minions and drains 1 mana.",
        cast(boss, game) {
          const mins = blueMinions(game);
          if (mins.length) { const m = mins[Math.floor(Math.random() * mins.length)]; game.destroyAt(m.r, m.c); }
          game.players.blue.manaPenalty += 1;
          game.log("💀 Wither Storm casts WITHERING — your minions rot away!", "red");
        },
      },
    },
    {
      id: "warden", name: "Warden", emoji: "🧿", hp: 14, move: 1,
      tagline: "A blind brute whose shriek shakes the whole board.",
      board: { name: "Deep Dark", theme: "stone", biome: "cave", rows: 11, cols: 14, blocked: ["3,3", "3,10", "7,3", "7,10", "4,6", "4,7", "6,6", "6,7", "5,4", "5,9"] },
      attack(boss, game) {
        const v = adjacentToKing(game, boss);
        if (v) { game.destroyAt(v.r, v.c); return true; }
        // Sonic Boom down a single line: pick the row or column with more targets.
        const row = blueMinions(game).filter(p => p.r === boss.r);
        const col = blueMinions(game).filter(p => p.c === boss.c);
        const targets = row.length >= col.length ? row : col;
        for (const t of targets) game.destroyAt(t.r, t.c);
        if (targets.length) game.log("🧿 Warden screams a SONIC BOOM!", "red");
        return targets.length > 0;
      },
      ability: {
        name: "Sonic Shriek", cd: 3,
        desc: "Freezes 1 of your minions and drains 1 mana.",
        cast(boss, game) {
          freezeRandom(game, 1);
          game.players.blue.manaPenalty += 1;
          game.log("🧿 Warden casts SONIC SHRIEK — your minions are stunned!", "red");
        },
      },
    },
    {
      id: "ender_dragon", name: "Ender Dragon", emoji: "🐉", hp: 16, move: 2,
      tagline: "A soaring terror that breathes ruin from above.",
      board: { name: "The End", theme: "end", biome: "end", rows: 11, cols: 14, blocked: ["2,6", "2,7", "8,6", "8,7", "5,3", "5,10", "4,6", "6,7"] },
      attack(boss, game) {
        const v = adjacentToKing(game, boss);
        if (v) { game.destroyAt(v.r, v.c); return true; }
        // Dragon's Breath: damage every blue minion within 2 tiles.
        const hits = blueMinions(game).filter(p => Math.max(Math.abs(p.r - boss.r), Math.abs(p.c - boss.c)) <= 2);
        for (const t of hits) game.destroyAt(t.r, t.c);
        if (hits.length) game.log("🐉 Ender Dragon exhales DRAGON'S BREATH!", "red");
        return hits.length > 0;
      },
      ability: {
        name: "Dragon Roar", cd: 4,
        desc: "Freezes a minion and curses you for −2 mana.",
        cast(boss, game) {
          freezeRandom(game, 1);
          game.players.blue.manaPenalty += 2;
          game.log("🐉 Ender Dragon ROARS — the air itself turns against you!", "red");
        },
      },
    },
  ];

  function findBoss(game) { return [].concat(...game.board.map(r => r.filter(Boolean))).find(p => p && p.isBoss) || null; }

  function stepToward(game, boss, target) {
    let best = null, bestD = Infinity;
    for (const [dr, dc] of KING) {
      const r = boss.r + dr, c = boss.c + dc;
      if (game.isEmpty(r, c)) { const d = dist(r, c, target.r, target.c); if (d < bestD) { bestD = d; best = { r, c }; } }
    }
    if (best) { game.relocatePublic(boss, best.r, best.c); return true; }
    return false;
  }

  const Boss = {
    findBoss,
    // Reset the boss's per-turn bookkeeping and tick its ability cooldown.
    beginTurn(game) {
      const boss = findBoss(game);
      if (!boss) return;
      boss.abilityCd = Math.max(0, (boss.abilityCd || 0) - 1);
      boss._cast = false; boss._attacked = false;
      boss._movesLeft = (BOSSES.find(b => b.id === boss.bossId) || { move: 1 }).move + (boss.moveBonus || 0);
    },
    takeOneAction(game, bossDef) {
      const boss = findBoss(game);
      if (!boss || game.phase !== "play") return false;
      // 1. cast the godly ability when ready
      if (!boss._cast && boss.abilityCd <= 0) { boss._cast = true; boss.abilityCd = bossDef.ability.cd; bossDef.ability.cast(boss, game); return true; }
      // 2. attack
      if (!boss._attacked) { boss._attacked = true; if (bossDef.attack(boss, game)) return true; }
      // 3. advance toward the king
      const v = game.villagerOf("blue");
      if (v && boss._movesLeft > 0) { boss._movesLeft--; if (stepToward(game, boss, v)) return true; }
      return false;
    },
  };

  window.BOSSES = BOSSES;
  window.Boss = Boss;
})();
