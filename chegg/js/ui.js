/*
 * ui.js — everything the player sees and clicks. Renders Game state into #app
 * and turns clicks into engine calls. The engine never touches the DOM; the UI
 * never decides rules. (Separation of concerns.)
 */
(function () {
  const DECK_SIZE = 40;
  // Default deck = at least one of every minion, then padded with cheap commons.
  function buildDefaultDeck() {
    const all = window.DECK_POOL.slice();
    const cheap = window.DECK_POOL.filter(t => window.MINIONS[t].cost <= 2);
    let i = 0;
    while (all.length < DECK_SIZE) { all.push(cheap[i % cheap.length]); i++; }
    return all.slice(0, DECK_SIZE);
  }
  const DEFAULT_DECK = buildDefaultDeck();

  const sprite = (type, owner, size) => window.eggSprite(type, owner, size);

  const UI = {
    app: null,
    game: null,
    difficulty: "normal",   // "easy" buffs your minions, "hard" buffs the enemy
    mode: { redIsCPU: false },
    selection: null,      // { kind:'hand', idx } | { kind:'piece', piece }
    handoff: false,
    aiThinking: false,
    draftDecks: null,
    buildingOwner: null,

    init() { this.app = document.getElementById("app"); this.showMenu(); },

    difficultyBlurb() {
      if (this.difficulty === "easy") return "Easy: YOUR minions get 2 free moves and can dash AND attack in the same turn.";
      if (this.difficulty === "hard") return "Hard: the ENEMY's minions get the extra moves & attacks, and bosses are tougher.";
      return "Normal: standard rules for both sides.";
    },
    // Which side (if any) gets the action-economy buff this game.
    buffSide() { return this.difficulty === "easy" ? "blue" : this.difficulty === "hard" ? "red" : null; },

    // ===================================================================== MENU
    showMenu() {
      this.game = null; this.selection = null; this.handoff = false; this.aiThinking = false;
      this.app.innerHTML = `
        <div class="panel menu">
          <h2>How CHEGG works</h2>
          <div class="rules">
            <p>Destroy the enemy <strong>Villager</strong> 👑 (your king) to win.</p>
            <ul>
              <li>Each turn: <strong>+1 max mana</strong> (cap 6) and <strong>draw 1</strong> minion.</li>
              <li><strong>Spawn</strong> minions onto your coloured home rows (costs mana).</li>
              <li>Every minion gets <strong>1 free move</strong>; pay 1 mana to <strong>dash</strong> <em>or</em> <strong>attack</strong> — not both.</li>
              <li>A minion <strong>can't act the turn it spawns</strong>. Click a minion to see how it moves.</li>
            </ul>
          </div>
          <div class="menu-grid">
            <button class="primary" data-act="quick2">Quick Play · 2 Players</button>
            <button class="primary" data-act="quickcpu">Quick Play · vs Computer</button>
            <button data-act="build2">Build Decks · 2 Players</button>
            <button data-act="buildcpu">Build Decks · vs Computer</button>
          </div>
          <div class="row"><button class="danger boss-btn" data-act="boss">☠ BOSS MODE ☠</button></div>
          <div class="diff-row">
            <span class="diff-label">Difficulty:</span>
            <button data-diff="easy" class="${this.difficulty === "easy" ? "diff-on" : ""}">😊 Easy</button>
            <button data-diff="normal" class="${this.difficulty === "normal" ? "diff-on" : ""}">⚔ Normal</button>
            <button data-diff="hard" class="${this.difficulty === "hard" ? "diff-on" : ""}">💀 Hard</button>
          </div>
          <p class="tip">${this.difficultyBlurb()}</p>
        </div>`;
      const on = (a, fn) => this.app.querySelector(`[data-act="${a}"]`).onclick = fn;
      this.app.querySelectorAll("[data-diff]").forEach(b => b.onclick = () => { this.difficulty = b.dataset.diff; this.showMenu(); });
      on("quick2", () => this.pickBoardThen({ blue: DEFAULT_DECK.slice(), red: DEFAULT_DECK.slice(), redIsCPU: false }));
      on("quickcpu", () => this.pickBoardThen({ blue: DEFAULT_DECK.slice(), red: DEFAULT_DECK.slice(), redIsCPU: true }));
      on("build2", () => this.startBuilder(false));
      on("buildcpu", () => this.startBuilder(true));
      on("boss", () => this.renderBossSelect());
    },

    // ============================================================ BOARD PICKER
    pickBoardThen(pending) { this.pending = pending; this.renderBoardPicker(); },
    boardMiniHTML(board) {
      const blocked = new Set(board.blocked);
      const rows = board.rows || 8, cols = board.cols || 10;
      let cells = "";
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const dark = (r + c) % 2 === 1;
        const zone = (r < 2) ? "mini-red" : (r >= rows - 2) ? "mini-blue" : "";
        const wall = blocked.has(r + "," + c) ? "mini-wall mini-" + board.theme : "";
        cells += `<span class="mini-cell ${dark ? "mini-dark" : "mini-light"} ${zone} ${wall}"></span>`;
      }
      return `<div class="board-mini" style="grid-template-columns:repeat(${cols},1fr);aspect-ratio:${cols} / ${rows};">${cells}</div>`;
    },
    renderBoardPicker() {
      const cards = window.BOARDS.map((b, i) => `
        <div class="card board-card" data-board="${i}">
          ${this.boardMiniHTML(b)}
          <div class="nm">${b.name}</div>
          <div class="desc">${b.desc}</div>
        </div>`).join("");
      this.app.innerHTML = `
        <div class="panel builder">
          <h2>Choose your battlefield</h2>
          <div class="palette board-grid">${cards}</div>
          <div class="row"><button data-act="back">← Back</button></div>
        </div>`;
      this.app.querySelectorAll("[data-board]").forEach(el => el.onclick = () => {
        const board = window.BOARDS[+el.dataset.board];
        if (this.pending.boss) this.startBossGame(this.pending.boss, board);
        else this.startGame(this.pending.blue, this.pending.red, this.pending.redIsCPU, board);
      });
      this.app.querySelector('[data-act="back"]').onclick = () => this.showMenu();
    },

    // ================================================================ BOSS MODE
    renderBossSelect() {
      const cards = window.BOSSES.map((b, i) => `
        <div class="card boss-card" data-boss="${i}">
          <div class="boss-portrait">${b.emoji}</div>
          <div class="nm">${b.name}</div>
          <div class="desc">${b.tagline}</div>
          <div class="boss-stats">❤ ${b.hp} HP · ✨ ${b.ability.name}</div>
          <div class="boss-lair">🗺 Lair: ${b.board.name}</div>
        </div>`).join("");
      this.app.innerHTML = `
        <div class="panel builder">
          <h2>☠ Choose your nightmare ☠</h2>
          <p class="rules">You face the boss alone with a full default army, in <strong>its own lair</strong>. Defeat the boss before it slays your Villager.</p>
          <div class="palette board-grid">${cards}</div>
          <div class="row"><button data-act="back">← Back</button></div>
        </div>`;
      this.app.querySelectorAll("[data-boss]").forEach(el => el.onclick = () => {
        const boss = window.BOSSES[+el.dataset.boss];
        this.startBossGame(boss, boss.board);   // each boss fights on its themed map
      });
      this.app.querySelector('[data-act="back"]').onclick = () => this.showMenu();
    },
    // Boss mode skips placement: it auto-sets your king, then gives you a big
    // one-time mana surge and a full hand on turn 1 so you can deploy your own army.
    startBossGame(bossDef, boardDef) {
      const MUSTER_MANA = 20, OPENING_HAND = 12;
      this.mode = { redIsCPU: true, boss: true, bossDef };
      this.board = boardDef;
      this.game = new window.Game({ blue: DEFAULT_DECK.slice(), red: [] }, boardDef);
      this.game.buffedOwner = this.buffSide();   // easy buffs your army; hard handled below
      this.game.onChange = () => this.render();
      const g = this.game, mid = Math.floor(g.COLS / 2);
      const hard = this.difficulty === "hard";
      const boss = g._spawnPiece(bossDef.id, "red", 0, mid, 0);
      boss.isBoss = true; boss.bossId = bossDef.id; boss.abilityCd = 2;
      boss.hp = boss.maxHp = hard ? Math.round(bossDef.hp * 1.5) : bossDef.hp;  // hard: tougher boss
      boss.moveBonus = hard ? 1 : 0;                                            // hard: faster boss
      g.players.red.villagerPlaced = true;
      g._spawnPiece("villager", "blue", g.ROWS - 1, mid, 0);
      g.players.blue.villagerPlaced = true;
      for (let i = 0; i < OPENING_HAND; i++) g.draw("blue");
      g.phase = "play"; g._beginTurn();          // begin blue's first turn (draws 1 more)
      g.players.blue.mana = MUSTER_MANA;          // big one-time muster to deploy an army
      g.log(`You muster your forces — ${MUSTER_MANA} mana this turn! Deploy your army.`, "blue");
      this.selection = null; this.handoff = false; this.aiThinking = false;
      this.render();
    },
    runBoss() {
      this.aiThinking = true;
      window.Boss.beginTurn(this.game);
      this.render();
      let steps = 0;
      const tick = () => {
        const g = this.game;
        if (g.phase !== "play" || g.current !== "red") { this.aiThinking = false; this.render(); return; }
        const did = window.Boss.takeOneAction(g, this.mode.bossDef);
        steps++;
        if (did && steps < 24) setTimeout(tick, 420);
        else { this.aiThinking = false; g.endTurn(); this.render(); }
      };
      setTimeout(tick, 520);
    },

    // ============================================================== DECK BUILDER
    startBuilder(redIsCPU) {
      this.mode = { redIsCPU };
      this.draftDecks = { blue: {}, red: {} };   // every minion starts at 0 — build from scratch
      this.buildingOwner = "blue";
      this.renderBuilder();
    },
    deckTotal(owner) { return Object.values(this.draftDecks[owner]).reduce((a, b) => a + b, 0); },
    renderBuilder() {
      const owner = this.buildingOwner, total = this.deckTotal(owner);
      const cards = window.DECK_POOL.map(t => {
        const m = window.MINIONS[t], n = this.draftDecks[owner][t] || 0;
        return `<div class="card">
          <div class="top">${sprite(t, owner, 24)}<span class="nm">${m.name}</span><span class="cost">${m.cost}</span></div>
          <div class="desc">${m.desc}</div>
          <div class="qty"><button data-dec="${t}">−</button><span class="n">${n}</span><button data-inc="${t}">+</button><button class="add5" data-add5="${t}">+5</button></div>
        </div>`;
      }).join("");
      const last = this.mode.redIsCPU || owner === "red";
      this.app.innerHTML = `
        <div class="panel builder">
          <h2><span class="who ${owner}">${owner.toUpperCase()}</span> — build your deck</h2>
          <p class="rules">Pick exactly <strong>${DECK_SIZE}</strong> minions. Total: <span class="deck-count">${total}</span>/${DECK_SIZE}</p>
          <div class="palette">${cards}</div>
          <div class="row">
            <button data-act="default">Default (all cards)</button>
            <button data-act="random">Randomize</button>
            <button class="primary" data-act="confirm" ${total === DECK_SIZE ? "" : "disabled"}>
              ${owner === "blue" && !this.mode.redIsCPU ? "Confirm — RED next" : "Confirm — start game"}
            </button>
          </div>
        </div>`;
      this.app.querySelectorAll("[data-inc]").forEach(b => b.onclick = () => {
        if (this.deckTotal(owner) < DECK_SIZE) { this.draftDecks[owner][b.dataset.inc] = (this.draftDecks[owner][b.dataset.inc] || 0) + 1; this.renderBuilder(); }
      });
      this.app.querySelectorAll("[data-add5]").forEach(b => b.onclick = () => {
        const t = b.dataset.add5, room = DECK_SIZE - this.deckTotal(owner);
        if (room > 0) { this.draftDecks[owner][t] = (this.draftDecks[owner][t] || 0) + Math.min(5, room); this.renderBuilder(); }
      });
      this.app.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => {
        if (this.draftDecks[owner][b.dataset.dec] > 0) { this.draftDecks[owner][b.dataset.dec]--; this.renderBuilder(); }
      });
      this.app.querySelector('[data-act="default"]').onclick = () => {
        this.draftDecks[owner] = {}; for (const t of DEFAULT_DECK) this.draftDecks[owner][t] = (this.draftDecks[owner][t] || 0) + 1; this.renderBuilder();
      };
      this.app.querySelector('[data-act="random"]').onclick = () => {
        this.draftDecks[owner] = {};
        for (let i = 0; i < DECK_SIZE; i++) { const t = window.DECK_POOL[Math.floor(Math.random() * window.DECK_POOL.length)]; this.draftDecks[owner][t] = (this.draftDecks[owner][t] || 0) + 1; }
        this.renderBuilder();
      };
      this.app.querySelector('[data-act="confirm"]').onclick = () => {
        if (this.deckTotal(owner) !== DECK_SIZE) return;
        if (owner === "blue" && !this.mode.redIsCPU) { this.buildingOwner = "red"; this.renderBuilder(); }
        else {
          const blue = this.deckToArray("blue");
          const red = this.mode.redIsCPU ? DEFAULT_DECK.slice() : this.deckToArray("red");
          this.pickBoardThen({ blue, red, redIsCPU: this.mode.redIsCPU });
        }
      };
    },
    deckToArray(owner) { const out = []; for (const [t, n] of Object.entries(this.draftDecks[owner])) for (let i = 0; i < n; i++) out.push(t); return out; },

    // ================================================================== NEW GAME
    startGame(blueDeck, redDeck, redIsCPU, boardDef) {
      this.mode = { redIsCPU: !!redIsCPU };
      this.board = boardDef || window.BOARDS[0];
      this.game = new window.Game({ blue: blueDeck, red: redDeck }, this.board);
      this.game.buffedOwner = this.buffSide();
      this.game.onChange = () => this.render();
      this.selection = null; this.handoff = false; this.aiThinking = false;
      this.render();
    },

    // ============================================================ RENDER (GAME)
    render() {
      const g = this.game;
      if (g.phase === "place") return this.renderPlacement();
      this.app.innerHTML = `
        <div class="game">
          ${this.sidePanel("blue")}
          <div class="board-wrap">
            ${this.boardHTML()}
            <div id="inspector" class="inspector">${this.inspectorHTML(this.inspectType())}</div>
            <div class="controls">
              <button class="primary" data-act="end" ${g.phase === "play" && !this.aiThinking ? "" : "disabled"}>End turn ⏭</button>
              <button data-act="deselect">Clear</button>
              <button class="danger" data-act="resign">Resign</button>
            </div>
            ${this.aiThinking ? '<div class="ai-banner">🤖 Computer is thinking…</div>' : ""}
            ${this.logHTML()}
          </div>
          ${this.sidePanel("red")}
        </div>`;
      this.wire();
      if (g.phase === "gameover") this.renderGameOver();
      else if (this.handoff) this.renderHandoff();
    },

    isCPU(owner) { return owner === "red" && this.mode.redIsCPU; },

    sidePanel(owner) {
      const g = this.game, pl = g.players[owner];
      const isCurrent = g.current === owner && g.phase === "play";
      if (this.mode.boss && owner === "red") return this.bossPanel(isCurrent);
      const showHand = isCurrent && !this.handoff && !this.isCPU(owner);
      let hand;
      if (showHand) {
        hand = pl.hand.map((t, i) => {
          const m = window.MINIONS[t], afford = pl.mana >= m.cost;
          const sel = this.selection && this.selection.kind === "hand" && this.selection.idx === i;
          return `<div class="handcard ${afford ? "" : "unaffordable"} ${sel ? "selected" : ""}" data-hand="${i}" data-inspect="${t}">
            ${sprite(t, owner, 22)}<span class="nm">${m.name}</span><span class="cost">${m.cost}</span></div>`;
        }).join("") || `<div class="hidden-hand">— empty hand —</div>`;
      } else {
        hand = `<div class="hidden-hand">🂠 ${pl.hand.length} card${pl.hand.length === 1 ? "" : "s"} (hidden)</div>`;
      }
      return `<div class="side ${owner} ${isCurrent ? "active" : ""} ${this.isCPU(owner) ? "cpu" : ""}">
        <h3>${owner === "blue" ? "🔵" : "🔴"} ${owner.toUpperCase()} ${isCurrent ? "▶" : ""}</h3>
        ${this.manaBarHTML(pl)}
        <div class="statline">Deck: ${pl.deck.length} cards</div>
        <div class="hand">${hand}</div>
      </div>`;
    },

    bossPanel(isCurrent) {
      const def = this.mode.bossDef;
      const boss = window.Boss.findBoss(this.game);
      const hp = boss ? boss.hp : 0, max = def.hp;
      const pct = Math.max(0, Math.round((hp / max) * 100));
      const cd = boss ? (boss.abilityCd || 0) : 0;
      return `<div class="side red boss-side ${isCurrent ? "active" : ""}">
        <h3>${def.emoji} ${def.name.toUpperCase()}</h3>
        <div class="hpwrap"><div class="hpbar"><div class="hpfill" style="width:${pct}%"></div></div></div>
        <div class="statline">❤ ${hp}/${max} HP</div>
        <div class="boss-ability">✨ <strong>${def.ability.name}</strong>${cd > 0 ? ` (ready in ${cd})` : " — READY"}<br>${def.ability.desc}</div>
      </div>`;
    },

    manaBarHTML(pl) {
      const total = Math.max(pl.manaMax, pl.mana, 1);
      let cells = "";
      for (let i = 0; i < total; i++) {
        const on = i < pl.mana, bonus = i >= pl.manaMax; // mana above normal max (Cat aura)
        cells += `<span class="mcell ${on ? "on" : ""} ${on && bonus ? "bonus" : ""}"></span>`;
      }
      return `<div class="manawrap"><div class="manabar">${cells}</div><span class="manatext">${pl.mana}/${pl.manaMax}</span></div>`;
    },

    boardStyle() {
      const g = this.game;
      const cell = Math.max(22, Math.min(50, Math.floor(640 / g.COLS)));
      return `--cell:${cell}px;grid-template-columns:repeat(${g.COLS},var(--cell));grid-template-rows:repeat(${g.ROWS},var(--cell));`;
    },
    pieceVisual(p) {
      if (p.isBoss) {
        const def = window.BOSSES.find(b => b.id === p.bossId) || { emoji: "☠" };
        const frozen = p.thawTurn && this.game.turnId < p.thawTurn ? "frozen" : "";
        return `<span class="piece boss ${frozen}"><span class="boss-emoji">${def.emoji}</span></span>`;
      }
      const fresh = p.spawnTurn === this.game.turnId && p.owner === this.game.current ? "fresh" : "";
      const crown = p.type === "villager" ? '<span class="crown">👑</span>' : "";
      const frozen = p.thawTurn && this.game.turnId < p.thawTurn ? "frozen" : "";
      const buff = (p.buffed && p.type !== "villager") ? '<span class="buffbadge">⚡</span>' : "";
      return `<span class="piece ${p.owner} ${fresh} ${frozen}">${sprite(p.type, p.owner)}${crown}${buff}${frozen ? '<span class="ice">❄</span>' : ""}</span>`;
    },

    boardHTML() {
      const g = this.game;
      const moveSet = new Set(), atkSet = new Set(), abiSet = new Set(), spawnSet = new Set(), breakSet = new Set();
      let selKey = null;
      if (this.selection && this.selection.kind === "piece") {
        const p = this.selection.piece; selKey = p.r + "," + p.c;
        for (const t of g.moveTargets(p)) moveSet.add(t.r + "," + t.c);
        for (const t of g.attackTargets(p)) atkSet.add(t.r + "," + t.c);
        for (const t of g.abilityTargets(p)) { const k = t.r + "," + t.c; if (!moveSet.has(k) && !atkSet.has(k)) abiSet.add(k); }
        for (const t of g.breakTargets(p)) breakSet.add(t.r + "," + t.c);
      } else if (this.selection && this.selection.kind === "hand") {
        for (const t of g.spawnTargets(g.players[g.current].hand[this.selection.idx])) spawnSet.add(t.r + "," + t.c);
      }
      let html = `<div class="board biome-${g.boardBiome}" style="${this.boardStyle()}">`;
      for (let r = 0; r < g.ROWS; r++) for (let c = 0; c < g.COLS; c++) {
        const key = r + "," + c, p = g.board[r][c];
        const cls = ["tile", (r + c) % 2 === 1 ? "dark" : "light"];
        if (g.isBlocked(r, c)) cls.push("wall", "wall-" + g.boardTheme);
        const zone = g.inSpawnZone("blue", r) ? "spawn-blue" : g.inSpawnZone("red", r) ? "spawn-red" : "";
        if (zone) cls.push(zone);
        if (moveSet.has(key)) cls.push("hl-move", "clickable");
        if (atkSet.has(key)) cls.push("hl-attack", "clickable");
        if (abiSet.has(key)) cls.push("hl-ability", "clickable");
        if (breakSet.has(key)) cls.push("hl-break", "clickable");
        if (spawnSet.has(key)) cls.push("hl-spawn", "clickable");
        if (key === selKey) cls.push("selected");
        let inner = "";
        if (p) { inner = this.pieceVisual(p); cls.push("clickable"); }
        const insp = p ? `data-inspect="${p.type}"` : "";
        html += `<div class="${cls.join(" ")}" data-r="${r}" data-c="${c}" ${insp}>${inner}</div>`;
      }
      return html + "</div>";
    },

    // ---- inspector ("how it moves") ----
    inspectType() {
      if (this.selection && this.selection.kind === "piece") return this.selection.piece.type;
      if (this.selection && this.selection.kind === "hand") return this.game.players[this.game.current].hand[this.selection.idx];
      return null;
    },
    inspectorHTML(type) {
      if (!type) return `<div class="insp-empty">Hover or click a minion to see how it moves & attacks.</div>`;
      const m = window.MINIONS[type];
      const abi = m.ability ? ` <span class="lg lg-abi"></span>${m.ability.name}` : "";
      const abiLine = m.ability ? `<div class="insp-desc">✨ <strong>${m.ability.name}</strong> (${m.ability.cost} mana): ${m.ability.desc}</div>` : "";
      return `
        ${this.patternPreviewHTML(type)}
        <div class="insp-head">${sprite(type, null, 24)}<div><div class="insp-name">${m.name}</div><div class="insp-cost">Cost ${m.cost}</div></div></div>
        <div class="insp-desc">${m.desc}</div>
        ${abiLine}
        <div class="insp-legend"><span class="lg lg-move"></span>move <span class="lg lg-atk"></span>attack${abi}</div>`;
    },
    patternPreviewHTML(type) {
      const pat = window.MINIONS[type].pattern || { move: [], attack: [] };
      const mv = new Set(pat.move.map(o => o[0] + "," + o[1]));
      const at = new Set((pat.attack || []).map(o => o[0] + "," + o[1]));
      let h = '<div class="pp">';
      for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
        const k = dr + "," + dc; let cls = "pp-cell";
        if (dr === 0 && dc === 0) cls += " pp-self";
        else { if (mv.has(k)) cls += " pp-move"; if (at.has(k)) cls += " pp-atk"; }
        h += `<div class="${cls}">${dr === 0 && dc === 0 ? sprite(type, null, 14) : ""}</div>`;
      }
      return h + "</div>";
    },
    updateInspector(type) { const el = document.getElementById("inspector"); if (el) el.innerHTML = this.inspectorHTML(type); },

    logHTML() {
      const items = this.game.logs.slice(-12).map(l => `<div class="${l.side ? l.side + "-ev" : ""}">${l.text}</div>`).join("");
      return `<div class="log">${items}</div>`;
    },

    // ---- input wiring ----
    wire() {
      this.app.querySelector('[data-act="end"]').onclick = () => this.endTurn();
      this.app.querySelector('[data-act="deselect"]').onclick = () => { this.selection = null; this.render(); };
      this.app.querySelector('[data-act="resign"]').onclick = () => {
        this.game.phase = "gameover"; this.game.winner = this.game.opponent(this.game.current);
        this.game.log(`${this.game.current} resigned.`, this.game.winner); this.aiThinking = false; this.render();
      };
      this.app.querySelectorAll("[data-hand]").forEach(el => el.onclick = () => {
        if (this.aiThinking) return;
        const idx = +el.dataset.hand, t = this.game.players[this.game.current].hand[idx];
        if (this.game.players[this.game.current].mana < window.MINIONS[t].cost) return;
        this.selection = (this.selection && this.selection.kind === "hand" && this.selection.idx === idx) ? null : { kind: "hand", idx };
        this.render();
      });
      this.app.querySelectorAll(".board .tile").forEach(el => el.onclick = () => this.onTileClick(+el.dataset.r, +el.dataset.c));
      // hover -> inspector
      this.app.querySelectorAll("[data-inspect]").forEach(el =>
        el.addEventListener("mouseenter", () => this.updateInspector(el.dataset.inspect)));
    },

    endTurn() {
      if (this.game.phase !== "play" || this.aiThinking) return;
      this.selection = null;
      if (this.mode.boss) { this.game.endTurn(); if (this.game.current === "red") this.runBoss(); }
      else if (this.mode.redIsCPU) { this.game.endTurn(); if (this.game.current === "red") this.runAI(); }
      else { this.handoff = true; this.game.endTurn(); }
    },

    onTileClick(r, c) {
      const g = this.game;
      if (g.phase !== "play" || this.handoff || this.aiThinking) return;
      const sel = this.selection;
      if (sel && sel.kind === "hand") {
        const t = g.players[g.current].hand[sel.idx];
        if (g.spawnTargets(t).some(s => s.r === r && s.c === c)) { g.spawn(t, r, c); this.selection = null; return; }
      }
      if (sel && sel.kind === "piece") {
        const p = sel.piece;
        if (g.attackTargets(p).some(s => s.r === r && s.c === c)) { g.attack(p, { r, c }); return this.afterAction(p); }
        if (g.abilityTargets(p).some(s => s.r === r && s.c === c)) { g.useAbility(p, { r, c }); return this.afterAction(p); }
        if (g.breakTargets(p).some(s => s.r === r && s.c === c)) { g.breakWall(p, r, c); return this.afterAction(p); }
        if (g.moveTargets(p).some(s => s.r === r && s.c === c)) { g.move(p, this.destAt(p, r, c)); return this.afterAction(p); }
      }
      const here = g.board[r][c];
      if (here && here.owner === g.current && g.canAct(here)) this.selection = { kind: "piece", piece: here };
      else this.selection = null;
      this.render();
    },
    destAt(p, r, c) { return this.game.moveTargets(p).find(t => t.r === r && t.c === c) || { r, c }; },
    afterAction(p) {
      const alive = this.game.board[p.r] && this.game.board[p.r][p.c] === p;
      const more = alive && (this.game.moveTargets(p).length || this.game.attackTargets(p).length || this.game.abilityTargets(p).length || this.game.breakTargets(p).length);
      this.selection = more ? { kind: "piece", piece: p } : null;
      this.render();
    },

    // ---- AI driver ----
    runAI() {
      this.aiThinking = true; this.render();
      let steps = 0;
      const tick = () => {
        const g = this.game;
        if (g.phase !== "play" || g.current !== "red") { this.aiThinking = false; this.render(); return; }
        const did = window.AI.takeOneAction(g);
        steps++;
        if (did && steps < 80) setTimeout(tick, 360);
        else { this.aiThinking = false; g.endTurn(); this.render(); }
      };
      setTimeout(tick, 480);
    },

    // ============================================================== PLACEMENT
    renderPlacement() {
      const g = this.game;
      const owner = g.players.blue.villagerPlaced ? "red" : "blue";
      if (owner === "red" && this.isCPU("red")) {       // CPU auto-places its king
        const tiles = this.placementTargets("red");
        const t = tiles.sort((a, b) => Math.abs(a.c - 4.5) - Math.abs(b.c - 4.5))[0] || tiles[0];
        g.placeVillager("red", t.r, t.c);
        return;
      }
      const spawnSet = new Set(this.placementTargets(owner).map(t => t.r + "," + t.c));
      let board = `<div class="board biome-${g.boardBiome}" style="${this.boardStyle()}">`;
      for (let r = 0; r < g.ROWS; r++) for (let c = 0; c < g.COLS; c++) {
        const key = r + "," + c, p = g.board[r][c];
        const cls = ["tile", (r + c) % 2 === 1 ? "dark" : "light"];
        if (g.isBlocked(r, c)) cls.push("wall", "wall-" + g.boardTheme);
        const zone = g.inSpawnZone("blue", r) ? "spawn-blue" : g.inSpawnZone("red", r) ? "spawn-red" : "";
        if (zone) cls.push(zone);
        if (spawnSet.has(key)) cls.push("hl-spawn", "clickable");
        board += `<div class="${cls.join(" ")}" data-r="${r}" data-c="${c}">${p ? this.pieceVisual(p) : ""}</div>`;
      }
      board += "</div>";
      this.app.innerHTML = `
        <div class="panel menu">
          <h2><span class="who ${owner}">${owner.toUpperCase()}</span>: place your Villager 👑</h2>
          <p class="rules">Click any tile in your highlighted home rows.</p>
          <div class="board-wrap">${board}</div>
        </div>`;
      this.app.querySelectorAll(".board .tile").forEach(el => el.onclick = () =>
        g.placeVillager(owner, +el.dataset.r, +el.dataset.c));
    },
    placementTargets(owner) {
      const g = this.game, out = [];
      for (let r = 0; r < g.ROWS; r++) for (let c = 0; c < g.COLS; c++)
        if (g.inSpawnZone(owner, r) && g.isEmpty(r, c)) out.push({ r, c });
      return out;
    },

    // ============================================================== OVERLAYS
    renderHandoff() {
      const g = this.game;
      const div = document.createElement("div");
      div.className = "overlay";
      div.innerHTML = `<div class="box">
        <div class="big-emoji">${g.current === "blue" ? "🔵" : "🔴"}</div>
        <h2 class="${g.current === "blue" ? "win-blue" : "win-red"}">${g.current.toUpperCase()}'s turn</h2>
        <p class="tip">Pass the device — no peeking at the other hand!</p>
        <button class="primary" data-act="ready">Show my hand</button></div>`;
      this.app.appendChild(div);
      div.querySelector('[data-act="ready"]').onclick = () => { this.handoff = false; this.render(); };
    },
    renderGameOver() {
      const g = this.game;
      const div = document.createElement("div");
      div.className = "overlay";
      let emoji = "👑", title = `${g.winner.toUpperCase()} wins!`, titleCls = g.winner === "blue" ? "win-blue" : "win-red", tip = "The enemy Villager has fallen.";
      if (this.mode.boss) {
        if (g.winner === "blue") { emoji = "🏆"; title = "VICTORY!"; titleCls = "win-blue"; tip = `You defeated the ${this.mode.bossDef.name}!`; }
        else { emoji = this.mode.bossDef.emoji; title = "DEFEATED"; titleCls = "win-red"; tip = `The ${this.mode.bossDef.name} slew your Villager…`; }
      }
      div.innerHTML = `<div class="box">
        <div class="big-emoji">${emoji}</div>
        <h2 class="${titleCls}">${title}</h2>
        <p class="tip">${tip}</p>
        <button class="primary" data-act="again">Play again</button></div>`;
      this.app.appendChild(div);
      div.querySelector('[data-act="again"]').onclick = () => this.showMenu();
    },
  };

  window.UI = UI;
})();
