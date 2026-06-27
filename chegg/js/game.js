/*
 * game.js — the CHEGG rules engine. No DOM here; this is pure game state so it
 * could be unit-tested or driven by an AI later. The UI (ui.js) reads this state
 * and calls these methods in response to clicks.
 *
 * Board: 10 columns x 8 rows. BLUE (player 1) owns the bottom 2 rows and moves
 * "up"; RED (player 2) owns the top 2 rows and moves "down".
 */
(function () {
  const DEFAULT_ROWS = 8, DEFAULT_COLS = 10;

  let nextId = 1;

  class Game {
    constructor(decks, boardDef) {
      // Board size is configurable (boss arenas are bigger). Spawn zones are
      // always the two rows at each end.
      this.ROWS = (boardDef && boardDef.rows) || DEFAULT_ROWS;
      this.COLS = (boardDef && boardDef.cols) || DEFAULT_COLS;
      this.spawnRows = { blue: [this.ROWS - 2, this.ROWS - 1], red: [0, 1] };
      this.walls = new Set((boardDef && boardDef.blocked) || []); // impassable terrain tiles
      this.boardTheme = (boardDef && boardDef.theme) || "stone";
      this.boardBiome = (boardDef && boardDef.biome) || "grass";  // tints the whole board
      this.board = Array.from({ length: this.ROWS }, () => Array(this.COLS).fill(null));
      this.players = {
        blue: this._makePlayer(decks.blue),
        red:  this._makePlayer(decks.red),
      };
      this.current = "blue";
      this.buffedOwner = null;  // easy mode: this owner's minions get +1 HP
      this.turnId = 0;          // increments at the start of every turn
      this.phase = "place";     // "place" -> "play" -> "gameover"
      this.winner = null;
      this.logs = [];
      this.onChange = null;     // UI sets this to a re-render callback
    }

    _makePlayer(deckTypes) {
      const deck = deckTypes.slice();
      this._shuffle(deck);
      return { deck, hand: [], manaMax: 0, mana: 0, villagerPlaced: false, manaPenalty: 0 };
    }
    _shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
    }

    // ---- board helpers (also used by minions.js) ----------------------------
    inBounds(r, c) { return r >= 0 && r < this.ROWS && c >= 0 && c < this.COLS; }
    at(r, c) { return this.inBounds(r, c) ? this.board[r][c] : null; }
    isBlocked(r, c) { return this.walls.has(r + "," + c); }   // a (thin) terrain wall
    // "empty" = a piece can stand here. Walls are THIN now: you can stand on /
    // move across them, so they don't count as occupied. (They still block
    // ranged line-of-sight until broken — see rayEnemies.)
    isEmpty(r, c) { return this.inBounds(r, c) && this.board[r][c] === null; }
    isEnemy(p, r, c) { const o = this.at(r, c); return !!o && o.owner !== p.owner; }
    isFriendly(p, r, c) { const o = this.at(r, c); return !!o && o.owner === p.owner; }
    forward(owner) { return owner === "blue" ? -1 : 1; }
    isDark(r, c) { return (r + c) % 2 === 1; }   // matches the .dark tiles (for the Phantom)
    opponent(owner) { return owner === "blue" ? "red" : "blue"; }
    inSpawnZone(owner, r) { return this.spawnRows[owner].includes(r); }
    def(p) { return window.MINIONS[p.type]; }

    log(text, side) { this.logs.push({ text, side: side || null }); }
    changed() { if (this.onChange) this.onChange(); }

    // ---- setup --------------------------------------------------------------
    placeVillager(owner, r, c) {
      if (this.phase !== "place") return false;
      const pl = this.players[owner];
      if (pl.villagerPlaced || !this.inSpawnZone(owner, r) || !this.isEmpty(r, c)) return false;
      this._spawnPiece("villager", owner, r, c, 0);
      pl.villagerPlaced = true;
      // Opening hand: each player draws 3 when the game starts.
      for (let i = 0; i < 3; i++) this.draw(owner);
      this.log(`${owner} placed their Villager.`, owner);
      if (this.players.blue.villagerPlaced && this.players.red.villagerPlaced) {
        this.phase = "play";
        this._beginTurn(); // BLUE's first turn
      }
      this.changed();
      return true;
    }

    // ---- turn structure -----------------------------------------------------
    _beginTurn() {
      this.turnId++;
      const pl = this.players[this.current];
      pl.manaMax = Math.min(6, pl.manaMax + 1);
      pl.mana = pl.manaMax;
      // Reset per-turn action flags for the moving player's pieces.
      for (const p of this._allPieces()) if (p.owner === this.current) {
        p.freeMovesUsed = 0; p.dashed = false; p.attacked = false; p.abilityUsed = false;
        p.villagerMoves = 0; p.villagerAttacked = false;
      }
      // Cat aura: +1 extra mana per living Cat you control (stacks).
      const cats = this._allPieces().filter(p => p.owner === this.current && p.type === "cat").length;
      if (cats > 0) { pl.mana += cats; this.log(`${this.current}: +${cats} mana from Cat${cats > 1 ? "s" : ""}.`, this.current); }
      // Difficulty mana bonus: the buffed side gets extra mana each turn.
      if (this.buffedOwner === this.current) { pl.mana += 2; this.log(`${this.current}: +2 mana (difficulty bonus).`, this.current); }
      // Curse: a boss debuff that drains mana for one turn.
      if (pl.manaPenalty) { pl.mana = Math.max(0, pl.mana - pl.manaPenalty); this.log(`${this.current} is cursed: −${pl.manaPenalty} mana!`, this.opponent(this.current)); pl.manaPenalty = 0; }
      this.draw(this.current);
      // Allay aura: draw +1 extra card per living Allay you control.
      const allays = this._allPieces().filter(p => p.owner === this.current && p.type === "allay").length;
      if (allays > 0) { this.log(`${this.current}: +${allays} card${allays > 1 ? "s" : ""} from Allay${allays > 1 ? "s" : ""}.`, this.current); for (let i = 0; i < allays; i++) this.draw(this.current); }
      this.log(`— ${this.current.toUpperCase()}'s turn (mana ${pl.mana}/${pl.manaMax}) —`, this.current);
    }
    endTurn() {
      if (this.phase !== "play") return;
      this.current = this.opponent(this.current);
      this._beginTurn();
      this.changed();
    }

    draw(owner) {
      const pl = this.players[owner];
      if (pl.deck.length === 0) { this.log(`${owner}'s deck is empty — no draw.`, owner); return; }
      pl.hand.push(pl.deck.pop());
    }
    stealFromOpponent(owner, n) {           // Sniffer: take cards off the enemy's deck
      const opp = this.players[this.opponent(owner)], me = this.players[owner];
      for (let i = 0; i < n && opp.deck.length; i++) me.hand.push(opp.deck.pop());
    }
    discardRandom(owner, n) {               // Sniffer death cost
      const pl = this.players[owner];
      for (let i = 0; i < n && pl.hand.length; i++) pl.hand.splice(Math.floor(Math.random() * pl.hand.length), 1);
    }

    // ---- pieces -------------------------------------------------------------
    _spawnPiece(type, owner, r, c, spawnTurn) {
      const buffed = this.buffedOwner === owner;     // easy/hard mode: extra actions (2 free moves + dash&attack)
      const hp = 1;
      const p = {
        id: nextId++, type, owner, r, c, spawnTurn, buffed,
        freeMovesUsed: 0, dashed: false, attacked: false, abilityUsed: false,
        villagerMoves: 0, villagerAttacked: false,
        hp, maxHp: hp, thawTurn: 0,   // thawTurn>turnId means frozen
      };
      this.board[r][c] = p;
      return p;
    }
    _allPieces() {
      const out = [];
      for (let r = 0; r < this.ROWS; r++) for (let c = 0; c < this.COLS; c++) if (this.board[r][c]) out.push(this.board[r][c]);
      return out;
    }
    villagerOf(owner) { return this._allPieces().find(p => p.type === "villager" && p.owner === owner) || null; }

    // A piece may act on its owner's turn, but not the turn it was spawned, and
    // not while frozen (thawTurn ahead of the current turn).
    canAct(p) {
      return this.phase === "play" && p.owner === this.current && p.spawnTurn < this.turnId
        && !(p.thawTurn && this.turnId < p.thawTurn);
    }

    // ---- spawning from hand -------------------------------------------------
    spawnTargets(type) {
      const owner = this.current;
      const def = window.MINIONS[type];
      if (!def || this.players[owner].mana < def.cost) return [];
      const out = [];
      for (const r of this.spawnRows[owner]) for (let c = 0; c < this.COLS; c++) if (this.isEmpty(r, c)) out.push({ r, c });
      return out;
    }
    spawn(type, r, c) {
      if (this.phase !== "play") return false;
      const owner = this.current, pl = this.players[owner], def = window.MINIONS[type];
      const idx = pl.hand.indexOf(type);
      if (idx < 0 || pl.mana < def.cost || !this.inSpawnZone(owner, r) || !this.isEmpty(r, c)) return false;
      pl.hand.splice(idx, 1);
      pl.mana -= def.cost;
      const p = this._spawnPiece(type, owner, r, c, this.turnId);
      this.log(`${owner} spawned ${def.name} (−${def.cost} mana).`, owner);
      if (def.onSpawn) def.onSpawn(p, this);
      this.changed();
      return true;
    }

    // ---- action economy -----------------------------------------------------
    // Normal minions: 1 free move + ONE paid action (dash OR attack OR ability).
    // Buffed minions (easy mode): 2 free moves and each paid action independently
    // (so they can dash AND attack in the same turn).
    _buffActions(p) { return p.buffed && p.type !== "villager"; }
    freeMoveCap(p) { return this._buffActions(p) ? 2 : 1; }
    freeMovesLeft(p) { return p.type === "villager" ? 0 : this.freeMoveCap(p) - p.freeMovesUsed; }
    _otherPaidUsed(p, self) { return ["dashed", "attacked", "abilityUsed"].some(k => k !== self && p[k]); }
    canDash(p) {
      if (p.dashed || this.players[p.owner].mana < 1) return false;
      return this._buffActions(p) || !this._otherPaidUsed(p, "dashed");
    }
    canAttackNow(p, cost) {
      if (p.attacked || this.players[p.owner].mana < cost) return false;
      return this._buffActions(p) || !this._otherPaidUsed(p, "attacked");
    }
    canAbility(p, cost) {
      if (p.abilityUsed || this.players[p.owner].mana < cost) return false;
      return this._buffActions(p) || !this._otherPaidUsed(p, "abilityUsed");
    }

    // ---- movement -----------------------------------------------------------
    moveTargets(p) {
      if (!this.canAct(p)) return [];
      const pl = this.players[p.owner];
      if (p.type === "villager") {
        if (p.villagerMoves >= 2 || pl.mana < 1) return [];
        return adjacentEmptyKing(this, p);
      }
      if (this.freeMovesLeft(p) <= 0 && !this.canDash(p)) return [];
      return this.def(p).moveTargets(p, this);
    }
    move(p, dest) {
      if (!this.canAct(p)) return false;
      const pl = this.players[p.owner];
      if (p.type === "villager") {
        if (p.villagerMoves >= 2 || pl.mana < 1) return false;
        pl.mana -= 1; p.villagerMoves++;
        this._relocate(p, dest.r, dest.c);
        this.log(`${p.owner}'s Villager moved.`, p.owner);
        this.changed();
        return true;
      }
      if (this.freeMovesLeft(p) > 0) {
        p.freeMovesUsed++;                            // free move
      } else if (this.canDash(p)) {
        p.dashed = true; pl.mana -= 1;                // dash
      } else return false;
      this._relocate(p, dest.r, dest.c);
      const def = this.def(p);
      if (def.onMove) def.onMove(p, dest, this);
      this.changed();
      return true;
    }
    _relocate(p, r, c) {
      this.board[p.r][p.c] = null;
      p.r = r; p.c = c;
      this.board[r][c] = p;
    }
    relocatePublic(p, r, c) { this._relocate(p, r, c); } // used by abilities (Frog pull)
    swapPieces(a, b) {                                   // used by abilities (Enderman teleport)
      const ar = a.r, ac = a.c, br = b.r, bc = b.c;
      this.board[ar][ac] = b; b.r = ar; b.c = ac;
      this.board[br][bc] = a; a.r = br; a.c = bc;
    }

    // ---- abilities (Frog pull, Enderman teleport, …) ------------------------
    abilityTargets(p) {
      const def = this.def(p);
      if (!this.canAct(p) || !def.ability || !this.canAbility(p, def.ability.cost)) return [];
      return def.ability.targets(p, this);
    }
    useAbility(p, target) {
      const def = this.def(p);
      if (!this.canAct(p) || !def.ability || !this.canAbility(p, def.ability.cost)) return false;
      p.abilityUsed = true;
      this.players[p.owner].mana -= def.ability.cost;
      def.ability.resolve(p, target, this);
      this.changed();
      return true;
    }

    // ---- attacking ----------------------------------------------------------
    attackTargets(p) {
      if (!this.canAct(p)) return [];
      const pl = this.players[p.owner];
      if (p.type === "villager") {
        if (p.villagerMoves >= 2 || p.villagerAttacked || pl.mana < 1) return [];
        return adjacentEnemiesKing(this, p);
      }
      const def = this.def(p);
      if (!def.attackTargets || !this.canAttackNow(p, def.attackCost || 1)) return [];
      return def.attackTargets(p, this);
    }
    attack(p, target) {
      if (!this.canAct(p)) return false;
      const pl = this.players[p.owner];
      if (p.type === "villager") {
        if (p.villagerMoves >= 2 || p.villagerAttacked || pl.mana < 1) return false;
        pl.mana -= 1; p.villagerMoves++; p.villagerAttacked = true;
        const tr = target.r, tc = target.c;
        this.destroyAt(tr, tc);
        if (this.phase === "play" && this.isEmpty(tr, tc)) this._relocate(p, tr, tc); // king takes the square
        this.log(`${p.owner}'s Villager attacked.`, p.owner);
        this.changed();
        return true;
      }
      const def = this.def(p), cost = def.attackCost || 1;
      if (!def.attackTargets || !this.canAttackNow(p, cost)) return false;
      p.attacked = true; pl.mana -= cost;
      this.log(`${p.owner}'s ${def.name} attacked${cost > 1 ? ` (−${cost} mana)` : ""}.`, p.owner);
      def.onAttack(p, target, this);
      this.changed();
      return true;
    }

    // ---- breaking walls -----------------------------------------------------
    // Any minion next to a wall can spend its paid action to break it.
    breakTargets(p) {
      if (!this.canAct(p)) return [];
      const ok = p.type === "villager"
        ? (p.villagerMoves < 2 && !p.villagerAttacked && this.players[p.owner].mana >= 1)
        : this.canAttackNow(p, 1);
      if (!ok) return [];
      const out = [];
      for (const [dr, dc] of window.MINION_DIRS.KING) {
        const r = p.r + dr, c = p.c + dc;
        if (this.inBounds(r, c) && this.isBlocked(r, c)) out.push({ r, c });
      }
      return out;
    }
    breakWall(p, r, c) {
      if (!this.canAct(p) || !this.isBlocked(r, c)) return false;
      if (Math.max(Math.abs(r - p.r), Math.abs(c - p.c)) !== 1) return false;
      const pl = this.players[p.owner];
      if (p.type === "villager") {
        if (p.villagerMoves >= 2 || p.villagerAttacked || pl.mana < 1) return false;
        pl.mana -= 1; p.villagerMoves++; p.villagerAttacked = true;
      } else {
        if (!this.canAttackNow(p, 1)) return false;
        pl.mana -= 1; p.attacked = true;
      }
      this.walls.delete(r + "," + c);
      this.log(`${p.owner} broke a wall.`, p.owner);
      this.changed();
      return true;
    }

    // Deal `amount` damage to whatever is on (r,c). Most pieces have hp 1 and die
    // in one hit. Bosses have lots of hp. An empty wall tile gets broken instead.
    destroyAt(r, c, amount = 1) {
      const p = this.at(r, c);
      if (!p) {
        if (this.isBlocked(r, c)) { this.walls.delete(r + "," + c); this.log("A wall was destroyed.", null); }
        return null;
      }
      if ((p.hp || 1) > amount) {
        p.hp -= amount;
        if (p.isBoss) this.log(`${p.owner === "blue" ? "🔵" : "☠"} boss took a hit (${p.hp}/${p.maxHp} HP).`, "blue");
        return p;
      }
      this.board[r][c] = null;
      const def = window.MINIONS[p.type];          // bosses aren't in the registry
      if (def && def.onDeath) def.onDeath(p, this);
      if (p.type === "villager" || p.isBoss) {
        this.phase = "gameover";
        this.winner = this.opponent(p.owner);
        const what = p.isBoss ? "The BOSS has been defeated" : `${p.owner}'s Villager was slain`;
        this.log(`👑 ${what} — ${this.winner.toUpperCase()} wins!`, this.winner);
      }
      return p;
    }
  }

  // Villager-only geometry (kept here so minions.js stays free of king logic).
  function adjacentEmptyKing(game, p) {
    const out = [];
    for (const [dr, dc] of window.MINION_DIRS.KING) {
      const r = p.r + dr, c = p.c + dc;
      if (game.inBounds(r, c) && game.isEmpty(r, c)) out.push({ r, c });
    }
    return out;
  }
  function adjacentEnemiesKing(game, p) {
    const out = [];
    for (const [dr, dc] of window.MINION_DIRS.KING) {
      const r = p.r + dr, c = p.c + dc;
      if (game.inBounds(r, c) && game.isEnemy(p, r, c)) out.push({ r, c });
    }
    return out;
  }

  window.Game = Game;
})();
