
/**
 * Debug / cheat overlay. Self-contained: it injects its own switch, panel and
 * styles and reaches into the live game systems, so the whole feature can be
 * dropped in or removed by toggling the one <script src="js/debug.js"> tag.
 *
 * Hidden by default: type the unlock code 1-2-3-4 in the menu (the start or
 * game-over screen) to reveal the corner switch. Once unlocked, toggle it with
 * that switch (top-right) or the backtick key (`, left of 1). While it's on, a
 * live stats panel shows in the top-left with clickable buttons to force-grant
 * any upgrade or perk, plus these cheat keys:
 *
 *   G  god mode (no damage)        K  kill nearest bot
 *   N  noclip / fly                L  kill ALL bots (instant win)
 *   T  cycle time scale            U  +1 of every upgrade & perk
 *   B  cycle weapon                Y  full heal + refill ammo
 *   I  +5 hyper / +3 clone         R  respawn all bots
 *
 * Turning debug OFF cleanly removes every effect (god, noclip, slow-mo) so the
 * match returns to normal. Note: the on-screen buttons/switch are clickable only
 * while the mouse is free (start screen or after Esc) — in-play, use the keys.
 */
class Debug {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.timeScale = 1;
    this._fps = 60;
    this._weapIdx = 0;
    this._weaponList = ['pistol', ...PRIMARY_WEAPONS];

    // Time-scale presets cycled by T: normal, slow-mo, slower, fast.
    this._scales = [1, 0.5, 0.25, 2];
    this._scaleIdx = 0;

    this._badges = {};       // upgrade type -> level-badge <span>
    this._utilBtns = {};     // name -> toggle <button> (for on/off styling)

    // Debug is hidden until unlocked by typing the code 1-2-3-4 in the menu.
    this.unlocked = false;
    this._seq = '';
    this._code = '1234';

    this._injectStyles();
    this._buildSwitch();
    this._buildPanel();

    // Secret unlock: listen for the code (only while not actively playing).
    window.addEventListener('keydown', (e) => this._onUnlockKey(e));
  }

  // Type the code (default 1234) in the menu to reveal the debug switch.
  _onUnlockKey(e) {
    if (this.unlocked) return;
    if (this.game.active) { this._seq = ''; return; }   // only "in the menu"
    const k = e.key;
    if (k.length === 1 && k >= '0' && k <= '9') {
      this._seq = (this._seq + k).slice(-this._code.length);
      if (this._seq === this._code) this._unlock();
    } else {
      this._seq = '';
    }
  }

  _unlock() {
    this.unlocked = true;
    this._seq = '';
    this.switchEl.style.display = '';          // reveal the corner switch...
    this.switchEl.classList.add('reveal');     // ...with an attention-grabbing pop
    this._say('🔓 DEBUG UNLOCKED — flip the switch (top-right) or press `');
  }

  _injectStyles() {
    const css = `
      #debug-switch{position:fixed;top:12px;right:14px;z-index:10000;display:flex;
        align-items:center;gap:8px;cursor:pointer;user-select:none;
        font:11px/1 ui-monospace,Menlo,Consolas,monospace;color:#7d93a8;
        background:rgba(6,12,18,.72);border:1px solid #2a3a4a;border-radius:20px;
        padding:5px 9px 5px 11px}
      #debug-switch .ds-label{letter-spacing:1.5px;font-weight:bold}
      #debug-switch .ds-track{width:30px;height:16px;border-radius:9px;background:#33414f;
        position:relative;transition:background .15s}
      #debug-switch .ds-knob{position:absolute;top:2px;left:2px;width:12px;height:12px;
        border-radius:50%;background:#8fa3b5;transition:left .15s,background .15s}
      #debug-switch.on{color:#9affc8;border-color:transparent;animation:dbgpulse 2.4s ease-in-out infinite}
      #debug-switch.on .ds-track{background:#1f7a52}
      #debug-switch.on .ds-knob{left:16px;background:#5cff9a}
      @keyframes dbgpulse{0%,100%{box-shadow:0 0 9px rgba(60,255,160,.3)}50%{box-shadow:0 0 20px rgba(60,255,160,.65)}}
      #debug-switch.reveal{animation:dbgreveal .65s ease-out}
      @keyframes dbgreveal{0%{transform:scale(.4);opacity:0}55%{transform:scale(1.18);opacity:1;
        box-shadow:0 0 28px rgba(60,255,160,.85)}100%{transform:scale(1)}}

      /* Animated neon-gradient border: a slowly spinning conic gradient (::before)
         masked by a dark inner fill (::after), leaving a glowing 2px ring. */
      #debug-panel{position:fixed;top:10px;left:10px;z-index:9999;display:none;
        pointer-events:none;border-radius:9px;padding:11px 13px;max-width:330px;
        overflow:hidden;box-shadow:0 6px 22px rgba(0,0,0,.55),0 0 24px rgba(60,255,160,.16)}
      #debug-panel.on{display:block}
      #debug-panel::before{content:'';position:absolute;left:-50%;top:-50%;width:200%;height:200%;
        z-index:-2;background:conic-gradient(from 0deg,#00ffc8,#22d3ff,#6a8aff,#ff5ca8,#ffd24d,#00ffc8);
        animation:dbgspin 5s linear infinite}
      #debug-panel::after{content:'';position:absolute;inset:2px;z-index:-1;border-radius:7px;
        background:rgba(5,11,9,.95)}
      @keyframes dbgspin{to{transform:rotate(1turn)}}
      #debug-panel .dbg-stats{white-space:pre;margin:0 0 8px;
        font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#9affc8;
        text-shadow:0 0 6px rgba(60,255,160,.35)}
      #debug-panel .dbg-stats .dim{color:#5a8a72}
      #debug-panel .dbg-stats .don{color:#6dffb0}
      #debug-panel .dbg-stats .doff{color:#ff7a7a}
      #debug-panel .dbg-sec{pointer-events:none;font:9px/1 ui-monospace,monospace;
        letter-spacing:1.5px;color:#5a8a72;margin:7px 0 4px}
      #debug-panel .dbg-tools{pointer-events:auto;display:flex;flex-wrap:wrap;gap:4px}
      #debug-panel .dbtn{pointer-events:auto;cursor:pointer;
        font:10px/1 ui-monospace,Menlo,Consolas,monospace;color:#d9f7ff;
        background:rgba(255,255,255,.05);border:1px solid #2a4a5a;border-left-width:3px;
        border-radius:4px;padding:4px 6px}
      #debug-panel .dbtn:hover{background:rgba(255,255,255,.14)}
      #debug-panel .dbtn:active{transform:translateY(1px)}
      #debug-panel .dbtn .lv{color:#5cff9a;font-weight:bold;margin-left:3px}
      #debug-panel .dbtn.perk{border-top-style:dashed}
      #debug-panel .dbtn.util{border-left-color:#6a8aff}
      #debug-panel .dbtn.util.on{background:rgba(60,255,160,.22);color:#bfffd9;border-color:#1f7a52}
      #debug-panel .dbtn.resume{border-left-color:#5cff9a;color:#bfffd9;
        background:rgba(60,255,160,.18);font-weight:bold}
      #debug-panel .dbtn.resume:hover{background:rgba(60,255,160,.3)}`;
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  _buildSwitch() {
    const sw = document.createElement('div');
    sw.id = 'debug-switch';
    sw.innerHTML = '<span class="ds-label">DEBUG</span>' +
      '<span class="ds-track"><span class="ds-knob"></span></span>';
    sw.title = 'Toggle debug mode (or press ` )';
    sw.style.display = 'none';   // hidden until the unlock code is entered
    sw.addEventListener('click', () => this.toggle());
    document.body.appendChild(sw);
    this.switchEl = sw;
  }

  _buildPanel() {
    this.panel = document.createElement('div');
    this.panel.id = 'debug-panel';

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'dbg-stats';
    this.panel.appendChild(this.statsEl);

    // Quick toggles / actions.
    this._sec('ACTIONS');
    const util = this._toolRow();
    this._btn(util, '▶ RESUME', 'util resume', () => this._resume());
    this._utilBtns.god = this._btn(util, 'GOD', 'util', () => this._toggleGod());
    this._utilBtns.noclip = this._btn(util, 'NOCLIP', 'util', () => this._toggleNoclip());
    this._btn(util, 'HEAL', 'util', () => this._heal());
    this._btn(util, 'KILL ALL', 'util', () => this._killAll());
    this._btn(util, 'CLEAR', 'util', () => this._clearUpgrades());

    // Force-grant buttons: every upgrade, then the weapon perks.
    this._sec('FORCE UPGRADE  (+1 each click)');
    const grid = this._toolRow();
    const keys = Object.keys(UPGRADES);
    for (const t of keys.filter((k) => !UPGRADES[k].weapon)) this._upgradeBtn(grid, t);
    this._sec('WEAPON PERKS  (work while holding that gun)');
    const perks = this._toolRow();
    for (const t of keys.filter((k) => UPGRADES[k].weapon)) this._upgradeBtn(perks, t, true);

    document.body.appendChild(this.panel);
  }

  _sec(text) {
    const d = document.createElement('div');
    d.className = 'dbg-sec';
    d.textContent = text;
    this.panel.appendChild(d);
  }

  _toolRow() {
    const d = document.createElement('div');
    d.className = 'dbg-tools';
    this.panel.appendChild(d);
    return d;
  }

  _btn(row, label, cls, onClick) {
    const b = document.createElement('button');
    b.className = 'dbtn ' + (cls || '');
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    row.appendChild(b);
    return b;
  }

  _upgradeBtn(row, type, isPerk) {
    const cfg = UPGRADES[type];
    const label = (cfg.weapon ? cfg.label + '·' + cfg.weapon : cfg.label);
    const b = this._btn(row, '', isPerk ? 'perk' : '', () => this._grant(type));
    b.style.borderLeftColor = '#' + cfg.color.toString(16).padStart(6, '0');
    b.appendChild(document.createTextNode(label));
    const badge = document.createElement('span');
    badge.className = 'lv';
    b.appendChild(badge);
    this._badges[type] = badge;
  }

  toggle() {
    if (!this.unlocked) return;   // backtick/switch do nothing until unlocked
    this.enabled = !this.enabled;
    this.panel.classList.toggle('on', this.enabled);
    this.switchEl.classList.toggle('on', this.enabled);
    const g = this.game;
    if (this.enabled) {
      // Free the mouse so the menu is clickable — this pauses an active match.
      if (g.started && !g.over) document.exitPointerLock();
      this._say('DEBUG ON — click the menu, then click the game to resume');
    } else {
      this._clearEffects();
      // Re-lock to resume if we paused a live match for the menu.
      if (g.started && !g.over && !document.pointerLockElement) this._resume();
      this._say('DEBUG OFF');
    }
  }

  // Re-capture the mouse (resume play after a debug pause). Only meaningful
  // mid-match; from the start screen the player should use the PLAY button.
  _resume() {
    const g = this.game;
    if (!g.started || g.over) return;
    const req = g.renderer.domElement.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  }

  // Strip every debug effect so the game plays normally again.
  _clearEffects() {
    this.timeScale = 1;
    this._scaleIdx = 0;
    const p = this.game.player;
    if (p) { p.godMode = false; p.noclip = false; }
  }

  // ---- shared cheat actions (used by both the hotkeys and the buttons) ----
  _toggleGod() {
    const p = this.game.player;
    p.godMode = !p.godMode;
    if (p.godMode && !p.alive) { p.alive = true; p.hp = p.maxHp; }
    this._say('GOD MODE ' + (p.godMode ? 'ON' : 'OFF'));
  }
  _toggleNoclip() {
    const p = this.game.player;
    p.noclip = !p.noclip;
    this._say('NOCLIP ' + (p.noclip ? 'ON' : 'OFF'));
  }
  _cycleTime() {
    this._scaleIdx = (this._scaleIdx + 1) % this._scales.length;
    this.timeScale = this._scales[this._scaleIdx];
    this._say('TIME ×' + this.timeScale);
  }
  _cycleWeapon() {
    this._weapIdx = (this._weapIdx + 1) % this._weaponList.length;
    this.game.weapon.setWeapon(this._weaponList[this._weapIdx]);
    this._say('WEAPON: ' + WEAPONS[this._weaponList[this._weapIdx]].name);
  }
  _grant(type) {
    this.game.powerups.grantUpgrade(type, this.game.player);
    this._say('+1 ' + UPGRADES[type].label);
  }
  _grantAll() {
    for (const t of Object.keys(UPGRADES)) {
      if (t === 'repair') continue;          // instant-heal, nothing to stack
      this.game.powerups.grantUpgrade(t, this.game.player);
    }
    this._say('+1 EVERY UPGRADE & PERK');
  }
  _clearUpgrades() {
    const g = this.game;
    g.powerups.owned = {};
    g.powerups.announced = new Set();
    g.player.maxHp = 100;                     // undo VITALITY's +max HP
    g.player.hp = Math.min(g.player.hp, 100);
    this._say('CLEARED ALL UPGRADES');
  }
  _heal() {
    const g = this.game, p = g.player;
    p.hp = p.maxHp; p.hyperT = 0;
    g.weapon.slots.primary.ammo = WEAPONS[g.weapon.slots.primary.key].mag;
    g.weapon.slots.secondary.ammo = WEAPONS[g.weapon.slots.secondary.key].mag;
    this._say('HEALED + AMMO');
  }
  _charges() {
    const g = this.game;
    g.player.hyperCharges += 5;
    g.powerups.owned.clone = (g.powerups.owned.clone || 0) + 3;
    this._say('+5 HYPER  +3 CLONE');
  }
  _killNearest() {
    const g = this.game, pos = g.player.position;
    let best = null, bestD = Infinity;
    for (const b of g.bots.bots) {
      if (!b.alive) continue;
      const d = b.position.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) { best.takeDamage(99999, g.player); this._say('KILLED NEAREST BOT'); }
    else this._say('NO BOTS LEFT');
  }
  _killAll() {
    const g = this.game;
    let n = 0;
    for (const b of g.bots.bots.slice()) {
      if (b.alive) { b.takeDamage(99999, g.player); n++; }
    }
    this._say('KILLED ' + n + ' BOTS');
  }
  _respawn() {
    this.game.bots.scatterSpawn();   // spawn() fully resets hp/alive/visibility
    this._say('RESPAWNED ALL BOTS');
  }

  // Returns true if the key was a debug command (so the game ignores it).
  handleKey(code) {
    if (!this.unlocked) return false;
    switch (code) {
      case 'KeyG': this._toggleGod(); return true;
      case 'KeyN': this._toggleNoclip(); return true;
      case 'KeyT': this._cycleTime(); return true;
      case 'KeyB': this._cycleWeapon(); return true;
      case 'KeyU': this._grantAll(); return true;
      case 'KeyY': this._heal(); return true;
      case 'KeyI': this._charges(); return true;
      case 'KeyK': this._killNearest(); return true;
      case 'KeyL': this._killAll(); return true;
      case 'KeyR': this._respawn(); return true;
    }
    return false;
  }

  _say(msg) { if (this.game.hud) this.game.hud.toast(msg, 0x5cff9a); }

  // `raw` is the true (un-scaled) frame time, for an honest FPS read-out.
  update(raw) {
    if (!this.enabled) return;
    if (raw > 0) this._fps += ((1 / raw) - this._fps) * 0.1;

    const g = this.game, p = g.player, w = g.weapon;
    const pos = p.position;
    const f = (n) => n.toFixed(1);
    const onoff = (b) => b ? '<span class="don">ON</span>' : '<span class="doff">off</span>';

    this.statsEl.innerHTML =
      'fps    ' + Math.round(this._fps) + '   time ×' + this.timeScale + '\n' +
      'pos    ' + f(pos.x) + ', ' + f(pos.y) + ', ' + f(pos.z) + '\n' +
      'hp     ' + Math.ceil(p.hp) + ' / ' + p.maxHp + (p.onGround ? '' : '  (air)') + (p.inCar ? '  (car)' : '') + '\n' +
      'weapon ' + w.def().name + '  ' + w.slots[w.activeSlot].ammo + '/' + w.def().mag + '\n' +
      'bots   ' + g.bots.countAlive() + ' / ' + g.bots.bots.length + '  clones ' + g.bots.clones.length + '\n' +
      'storm  ' + (g.storm.shrinking ? 'closing' : 'in ' + Math.ceil(g.storm.countdown) + 's') + '\n' +
      'god ' + onoff(p.godMode) + '  noclip ' + onoff(p.noclip) +
      '   <span class="dim">` or switch to close</span>';

    // Reflect live state on the buttons.
    for (const type of Object.keys(this._badges)) {
      const lvl = g.powerups.owned[type] || 0;
      this._badges[type].textContent = lvl > 0 ? lvl : '';
    }
    this._utilBtns.god.classList.toggle('on', p.godMode);
    this._utilBtns.noclip.classList.toggle('on', p.noclip);
  }
}
