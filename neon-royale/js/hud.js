/** Thin wrapper over the DOM HUD. The game calls these; no game logic lives here. */
class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      healthFill: document.getElementById('health-fill'),
      ammo: document.getElementById('ammo'),
      ammoCurrent: document.getElementById('ammo-current'),
      ammoReserve: document.getElementById('ammo-reserve'),
      reloadHint: document.getElementById('reload-hint'),
      hitmarker: document.getElementById('hitmarker'),
      vignette: document.getElementById('damage-vignette'),
      alive: document.getElementById('alive-count'),
      zone: document.getElementById('zone-status'),
      zoneWarn: document.getElementById('zone-warning'),
      killfeed: document.getElementById('killfeed'),
      upgrades: document.getElementById('powerups'),
      combo: document.getElementById('combo-banner'),
      weaponName: document.getElementById('weapon-name'),
      prompt: document.getElementById('prompt'),
      toastEl: document.getElementById('toast'),
      abilities: document.getElementById('abilities'),
    };
    this._hitTimer = null;
    this._vigTimer = null;
    this._comboTimer = null;
    this._toastTimer = null;
    this._upgradeKey = '';
    this._abilKey = '';
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setHealth(frac) {
    const pct = Math.max(0, Math.min(1, frac)) * 100;
    this.el.healthFill.style.width = pct + '%';
    this.el.healthFill.style.background = frac > 0.5
      ? 'linear-gradient(90deg, #4ee1a0, #7af7c0)'
      : frac > 0.25
        ? 'linear-gradient(90deg, #e1c84e, #f7e07a)'
        : 'linear-gradient(90deg, #ff4d4d, #ff8080)';
  }

  setAmmo(current, mag) {
    this.el.ammoCurrent.textContent = current;
    this.el.ammoReserve.textContent = '∞';
    this.el.ammo.classList.toggle('low', current <= Math.ceil(mag * 0.25));
  }

  setReloading(on) { this.el.reloadHint.classList.toggle('hidden', !on); }

  setWeapon(name) { this.el.weaponName.textContent = name; }

  setPrompt(text) {
    if (text) { this.el.prompt.textContent = text; this.el.prompt.classList.remove('hidden'); }
    else this.el.prompt.classList.add('hidden');
  }

  // clone summon charges + hyper-boost charges
  setAbilities(clones, hypers) {
    const key = clones + '|' + hypers;
    if (key === this._abilKey) return;
    this._abilKey = key;
    let html = '';
    if (clones > 0) html += `<span style="color:#6df0ff">CLONE ×${clones}</span> <span class="ab-key">C</span>`;
    if (hypers > 0) html += `<span style="color:#35ff8a">HYPER ×${hypers}</span> <span class="ab-key">F</span>`;
    this.el.abilities.innerHTML = html;
  }

  toast(text, color) {
    const hex = '#' + (color || 0xffffff).toString(16).padStart(6, '0');
    this.el.toastEl.textContent = text;
    this.el.toastEl.style.color = hex;
    this.el.toastEl.classList.remove('hidden');
    this.el.toastEl.classList.remove('pop');
    void this.el.toastEl.offsetWidth;
    this.el.toastEl.classList.add('pop');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toastEl.classList.add('hidden'), 1600);
  }

  setAlive(n) { this.el.alive.textContent = n; }

  setZone(text, closing) {
    this.el.zone.textContent = text;
    this.el.zone.classList.toggle('closing', !!closing);
  }

  setZoneWarning(on) { this.el.zoneWarn.classList.toggle('hidden', !on); }

  showHitmarker(killed) {
    const m = this.el.hitmarker;
    m.classList.toggle('kill', killed);
    m.classList.add('show');
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => m.classList.remove('show'), killed ? 220 : 110);
  }

  showDamage() {
    const v = this.el.vignette;
    v.classList.add('show');
    clearTimeout(this._vigTimer);
    this._vigTimer = setTimeout(() => v.classList.remove('show'), 120);
  }

  _nameColor(c) {
    if (!c) return '#e9eef2';
    if (c.isStorm) return '#b14dff';
    if (c.color != null) return '#' + c.color.toString(16).padStart(6, '0');
    return '#4ee1a0';                 // the player
  }

  addKillFeed(killer, victim, weapon, involvesPlayer) {
    const line = document.createElement('div');
    line.className = 'kf-line' + (involvesPlayer ? ' kf-involved' : '');
    const k = `<span class="kf-name" style="color:${this._nameColor(killer)}">${killer.name}</span>`;
    const v = `<span class="kf-name" style="color:${this._nameColor(victim)}">${victim.name}</span>`;
    line.innerHTML = `${k}<span class="kf-weapon">${weapon}</span>${v}`;
    this.el.killfeed.prepend(line);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.removeChild(this.el.killfeed.lastChild);
    setTimeout(() => line.remove(), 5000);
  }

  // list: [{ label, color, level }]
  setUpgrades(list) {
    const key = list.map((p) => p.label + p.level).join('|');
    if (key === this._upgradeKey) return;
    this._upgradeKey = key;

    this.el.upgrades.innerHTML = '';
    for (const p of list) {
      const hex = '#' + p.color.toString(16).padStart(6, '0');
      const chip = document.createElement('div');
      chip.className = 'pu-chip';
      chip.style.color = hex;
      chip.style.borderColor = hex;
      chip.style.boxShadow = `0 0 12px ${hex}66, inset 0 0 8px ${hex}33`;
      chip.innerHTML = `<span class="pu-label">${p.label}</span>` +
        (p.level > 1 ? `<span class="pu-time">x${p.level}</span>` : '');
      this.el.upgrades.appendChild(chip);
    }
  }

  showCombo(name) {
    const c = this.el.combo;
    c.textContent = name + '!';
    c.classList.remove('hidden');
    c.classList.remove('pop');
    void c.offsetWidth;          // restart the animation
    c.classList.add('pop');
    clearTimeout(this._comboTimer);
    this._comboTimer = setTimeout(() => c.classList.add('hidden'), 1800);
  }
}
