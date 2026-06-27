/*
 * ai.js — a greedy opponent that now also uses minion abilities.
 * Each call performs one "micro-action" so the UI can animate the turn.
 *
 * Decision order:
 *   1. Lethal — any attack that kills the enemy Villager.
 *   2. Best paid action — the higher-value of {best attack} vs {best ability}.
 *   3. Develop — spawn the strongest minion (Withers land next to enemies).
 *   4. Advance — free-move a minion toward the enemy Villager.
 *   5. Reposition — use a low-value ability (Enderman hops forward, Frog drags).
 *   6. Push — spend leftover mana to dash forward.
 *
 * Ability smarts:
 *   - Frog Pull: drag an enemy into a friendly's attack range (a combo), or
 *     drag the enemy Villager closer to our side.
 *   - Enderman Teleport: swap with a neighbour to advance / reach more enemies
 *     (it can't walk on its own).
 * Still one move deep — lots of room to improve.
 */
(function () {
  const M = () => window.MINIONS, KING = () => window.MINION_DIRS.KING;
  const val = t => (t === "villager" ? 100 : window.MINIONS[t].cost);
  // Manhattan distance — rewards marching forward even when the column is off.
  const dist = (ar, ac, br, bc) => Math.abs(ar - br) + Math.abs(ac - bc);

  function actablePieces(game, me) {
    return [].concat(...game.board.map(row => row.filter(Boolean)))
      .filter(p => p.owner === me && game.canAct(p));
  }
  function attacksFrom(game, p, r, c) { // what could p hit if it stood at (r,c)?
    const def = window.MINIONS[p.type];
    if (!def.attackTargets) return [];
    const or = p.r, oc = p.c;
    game.board[or][oc] = null; p.r = r; p.c = c; game.board[r][c] = p;
    const t = def.attackTargets(p, game);
    game.board[r][c] = null; p.r = or; p.c = oc; game.board[or][oc] = p;
    return t;
  }
  function enemiesAround(game, me, r, c) {
    let n = 0;
    for (const [dr, dc] of KING()) { const o = game.at(r + dr, c + dc); if (o && o.owner !== me) n++; }
    return n;
  }

  // ---- attacks --------------------------------------------------------------
  function enumerateAttacks(game, me, includeVillager) {
    const out = [];
    for (const p of actablePieces(game, me)) {
      if (p.type === "villager" && !includeVillager) continue;
      const def = window.MINIONS[p.type];
      if (p.type !== "villager" && game.players[me].mana < (def.attackCost || 1)) continue;

      const score = (target, fromR, fromC) => {
        let s;
        if (p.type === "creeper") {       // explosion: enemies hit minus friendlies hit
          s = 0;
          for (const [dr, dc] of KING()) { const o = game.at(fromR + dr, fromC + dc); if (o) s += o.owner === me ? -val(o.type) : val(o.type); }
        } else { const o = game.at(target.r, target.c); s = o ? val(o.type) : 0; }
        if (def.selfDestructs) s -= def.cost;   // Bee/Creeper die — discount their own cost
        return s;
      };

      const here = p.type === "villager" ? game.attackTargets(p) : (def.attackTargets ? def.attackTargets(p, game) : []);
      for (const t of here) out.push({ piece: p, move: null, target: t, value: score(t, p.r, p.c) });
      if (p.type !== "villager" && game.freeMovesLeft(p) > 0 && def.moveTargets) {
        for (const md of def.moveTargets(p, game))
          for (const t of attacksFrom(game, p, md.r, md.c)) out.push({ piece: p, move: md, target: t, value: score(t, md.r, md.c) });
      }
    }
    return out;
  }
  function doAttack(game, opt) { if (opt.move) game.move(opt.piece, opt.move); game.attack(opt.piece, opt.target); }

  // ---- abilities ------------------------------------------------------------
  function friendlyCanHit(game, me, r, c, exclude, manaAvail) {
    for (const q of actablePieces(game, me)) {
      if (q === exclude || q.attacked || q.villagerAttacked) continue;
      const qd = window.MINIONS[q.type];
      if (manaAvail < (qd.attackCost || 1)) continue;
      const tg = q.type === "villager" ? game.attackTargets(q) : (qd.attackTargets ? qd.attackTargets(q, game) : []);
      if (tg.some(s => s.r === r && s.c === c)) return true;
    }
    return false;
  }
  function bestAbility(game, me) {
    const enemyV = game.villagerOf(game.opponent(me));
    let best = null;
    for (const p of actablePieces(game, me)) {
      const def = window.MINIONS[p.type];
      if (!def.ability || !game.canAbility(p, def.ability.cost)) continue;
      for (const t of def.ability.targets(p, game)) {
        let value = 0;
        const occ = game.at(t.r, t.c);
        if (p.type === "frog") {
          if (!occ || occ.owner === me) continue;                 // only drag enemies
          const dr = Math.sign(t.r - p.r), dc = Math.sign(t.c - p.c);
          const pull = Math.min(2, (Math.abs(t.r - p.r) + Math.abs(t.c - p.c)) - 1);
          const nr = t.r - dr * pull, nc = t.c - dc * pull;
          const sr = occ.r, sc = occ.c;                            // simulate the pull
          game.board[sr][sc] = null; occ.r = nr; occ.c = nc; game.board[nr][nc] = occ;
          const combo = friendlyCanHit(game, me, nr, nc, p, game.players[me].mana - def.ability.cost);
          game.board[nr][nc] = null; occ.r = sr; occ.c = sc; game.board[sr][sc] = occ;
          value = combo ? val(occ.type) + 3 : occ.type === "villager" ? 3 : 1;
        } else if (p.type === "enderman") {
          const before = enemyV ? dist(p.r, p.c, enemyV.r, enemyV.c) : 0;
          const after = enemyV ? dist(t.r, t.c, enemyV.r, enemyV.c) : 0;
          value = (after < before ? 2 : 0) + enemiesAround(game, me, t.r, t.c); // advance + reach enemies
        }
        if (!best || value > best.value) best = { piece: p, target: t, value };
      }
    }
    return best;
  }

  // ---- development / movement ----------------------------------------------
  function trySpawn(game, me) {
    const pl = game.players[me], enemyV = game.villagerOf(game.opponent(me));
    const affordable = [...new Set(pl.hand)].filter(t => window.MINIONS[t].cost <= pl.mana && game.spawnTargets(t).length);
    if (!affordable.length) return false;
    affordable.sort((a, b) => window.MINIONS[b].cost - window.MINIONS[a].cost);
    const type = affordable[0];
    let tiles = game.spawnTargets(type);
    if (window.MINIONS[type].blastOnSpawn) tiles = tiles.sort((a, b) => enemiesAround(game, me, b.r, b.c) - enemiesAround(game, me, a.r, a.c)); // drop the Wither on a crowd
    else if (enemyV) tiles = tiles.sort((a, b) => dist(a.r, a.c, enemyV.r, enemyV.c) - dist(b.r, b.c, enemyV.r, enemyV.c));
    return game.spawn(type, tiles[0].r, tiles[0].c);
  }
  function tryAdvance(game, me, paid) {
    const enemyV = game.villagerOf(game.opponent(me));
    if (!enemyV) return false;
    let best = null, bestGain = 0;
    for (const p of actablePieces(game, me)) {
      if (p.type === "villager") continue;
      const def = window.MINIONS[p.type];
      if (!def.moveTargets) continue;
      if (paid ? !(game.freeMovesLeft(p) === 0 && game.canDash(p)) : game.freeMovesLeft(p) <= 0) continue;
      const cur = dist(p.r, p.c, enemyV.r, enemyV.c);
      for (const d of def.moveTargets(p, game)) {
        const gain = cur - dist(d.r, d.c, enemyV.r, enemyV.c);
        if (gain > bestGain) { bestGain = gain; best = { piece: p, dest: d }; }
      }
    }
    if (best && bestGain > 0) return game.move(best.piece, best.dest);
    return false;
  }

  const AI = {
    takeOneAction(game) {
      const me = game.current, enemyV = game.villagerOf(game.opponent(me));

      // 1. lethal
      if (enemyV) {
        const lethal = enumerateAttacks(game, me, true).find(o => o.target.r === enemyV.r && o.target.c === enemyV.c);
        if (lethal) { doAttack(game, lethal); return true; }
      }
      // 2. best paid action: attack vs ability
      const kill = enumerateAttacks(game, me, false).filter(o => o.value >= 1).sort((a, b) => b.value - a.value)[0] || null;
      const abil = bestAbility(game, me);
      const kv = kill ? kill.value : 0, av = abil ? abil.value : 0;
      if (kv >= av && kv >= 1) { doAttack(game, kill); return true; }
      if (av >= 2) { game.useAbility(abil.piece, abil.target); return true; }
      if (kv >= 1) { doAttack(game, kill); return true; }
      // 3. develop
      if (trySpawn(game, me)) return true;
      // 4. advance (free)
      if (tryAdvance(game, me, false)) return true;
      // 5. reposition with a low-value ability (recompute — board moved)
      const reposition = bestAbility(game, me);
      if (reposition && reposition.value >= 1) { game.useAbility(reposition.piece, reposition.target); return true; }
      // 6. push (paid dash)
      if (game.players[me].mana > 0 && tryAdvance(game, me, true)) return true;

      return false;
    },
  };

  window.AI = AI;
})();
