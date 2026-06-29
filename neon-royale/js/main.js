
const NUM_BOTS = 27;                 // + the player = 28-fighter lobby

// After the mouse is freed (Esc / opening debug) ignore click-to-resume on the
// game world for this long, so a stray click doesn't instantly re-lock. The
// explicit ▶ RESUME button bypasses this.
const RESUME_GRACE_MS = 500;

class Game {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('game').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070611);
    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 5000);

    this.audio = new AudioFX();
    this.hud = new HUD();
    this.world = new World(this.scene);
    this.player = new Player(this.camera, this.world, this.audio);
    this.scene.add(this.player.model);
    // The first-person gun viewmodel is parented to the camera, so the camera
    // must be in the scene graph for it to render.
    this.scene.add(this.camera);
    this.player.spawn(this.world.randomClearPosition(12));

    this.bots = new BotManager({
      scene: this.scene, world: this.world, audio: this.audio,
      camera: this.camera, count: NUM_BOTS,
    });
    this.bots.setPlayer(this.player);
    this.bots.onKill = (killer, victim) => this.registerKill(killer, victim);

    this.powerups = new PowerupManager({
      scene: this.scene, audio: this.audio, hud: this.hud, world: this.world,
      bots: this.bots,   // AEGIS orbs damage enemies
    });

    // Built before crates so loot avoids landing inside special buildings.
    this.specials = new SpecialsManager({
      scene: this.scene, audio: this.audio, hud: this.hud, world: this.world,
    });
    this.destructibles = new Destructibles({
      scene: this.scene, audio: this.audio, world: this.world,
    });

    this.weapon = new Weapon({
      camera: this.camera, scene: this.scene, world: this.world,
      bots: this.bots, audio: this.audio, hud: this.hud, player: this.player,
      power: this.powerups, destructibles: this.destructibles,
    });
    // Weapon-specific perks need to know which gun you hold (claim gate).
    this.powerups.weapon = this.weapon;

    this.crates = new CrateManager({
      scene: this.scene, audio: this.audio, hud: this.hud, world: this.world,
      power: this.powerups,   // MAGNET pulls dropped weapons toward you
    });
    // DEMOLITION chains explosions through parked cars.
    this.weapon.crates = this.crates;

    this.minimap = new Minimap();
    this.storm = new Storm(this.scene, ARENA.half * 1.5);

    // Debug/cheat overlay — backtick (`) toggles it. Built last so it can see
    // every other system through `this`.
    this.debug = new Debug(this);

    this.total = NUM_BOTS + 1;
    this.playerKills = 0;
    this.active = false;
    this.over = false;
    this.started = false;   // a match is in progress (used by debug pause/resume)
    this._unlockTime = 0;   // when the mouse was last freed (for the resume grace)

    this.clock = new THREE.Clock();

    this._bindUI();
    this._bindInput();
    window.addEventListener('resize', () => this._onResize());

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._loop());
  }

  _bindUI() {
    document.getElementById('start-btn').addEventListener('click', () => this._beginPlay());
    document.getElementById('restart-btn').addEventListener('click', () => this._restart());
  }

  _bindInput() {
    const canvas = this.renderer.domElement;

    document.addEventListener('pointerlockerror', () => {
      document.getElementById('overlay').classList.remove('hidden');
      if (window.__bootError) {
        window.__bootError('Couldn’t capture the mouse (Pointer Lock was blocked).\n' +
          'This usually means the page is running inside an embedded preview.\n' +
          'Open it in a real browser (Chrome, Safari, Firefox) instead.');
      }
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (locked) {
        this.active = !this.over;
        this.player.controlsEnabled = true;
        this.audio.resume();
        document.getElementById('overlay').classList.add('hidden');
      } else {
        this.active = false;
        this._unlockTime = performance.now();
        this.player.controlsEnabled = false;
        this.weapon.stopFire();
        // While the debug menu is open the cursor is freed on purpose — don't
        // pop the start overlay; the debug pause owns the screen instead.
        if (!this.over && !this.debug.enabled) document.getElementById('overlay').classList.remove('hidden');
      }
    });

    canvas.addEventListener('mousedown', (e) => {
      // Debug pause: the mouse was freed for the menu — click the world to resume,
      // but only after a short grace period so a stray click doesn't re-lock
      // instantly. (The ▶ RESUME button has no grace, for a deliberate resume.)
      if (!this.active && this.started && !this.over && this.debug.enabled && document.pointerLockElement !== canvas) {
        if (performance.now() - this._unlockTime < RESUME_GRACE_MS) return;
        const req = canvas.requestPointerLock();
        if (req && typeof req.catch === 'function') req.catch(() => {});
        return;
      }
      if (this.active && this.player.alive && !this.player.inCar && e.button === 0) this.weapon.startFire();
    });
    window.addEventListener('mouseup', () => this.weapon.stopFire());

    window.addEventListener('keydown', (e) => {
      // Debug overlay: backtick toggles it; its hotkeys take priority while on.
      if (e.code === 'Backquote') { this.debug.toggle(); return; }
      if (this.debug.enabled && this.debug.handleKey(e.code)) return;
      if (!this.active) return;
      switch (e.code) {
        case 'KeyR': this.weapon.reload(); break;
        case 'KeyQ': this.weapon.swap(); break;
        case 'KeyV': this.player.toggleView(); break;
        case 'KeyH': document.getElementById('controls-hud').classList.toggle('hidden'); break;
        case 'KeyE': this.crates.interact(this.player, this.weapon); break;
        case 'KeyC':
          if (this.bots.clones.length < 3 && this.powerups.consumeCloneCharge()) {
            this.bots.spawnClone(this.player);
          }
          break;
        case 'KeyF':
          if (this.player.hyperCharges > 0 && this.player.hyperT <= 0) {
            this.player.hyperCharges--;
            this.player.activateHyper();
            this.audio.boost();
          }
          break;
      }
    });
  }

  _beginPlay() {
    this.started = true;
    this.audio.init();
    this.audio.resume();
    this.hud.show();
    document.getElementById('overlay').classList.add('hidden');
    const req = this.renderer.domElement.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  }

  _restart() {
    this.over = false;
    this.started = true;
    this.playerKills = 0;
    this.player.spawn(this.world.randomClearPosition(12));
    this.player.speedMult = 1;
    this.weapon.setWeapon('pistol');
    this.weapon.setWeapon('rifle');
    this.bots.scatterSpawn();
    this.powerups.reset();
    this.crates.reset();
    this.specials.reset();
    this.destructibles.reset();
    this.storm.reset(ARENA.half * 1.5);
    document.getElementById('gameover').classList.add('hidden');
    this.hud.setZoneWarning(false);
    this.hud.setPrompt(null);
    this.hud.show();
    const req = this.renderer.domElement.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  }

  // Every elimination flows through here for the kill feed + the player's count.
  registerKill(killer, victim) {
    // The fallen fighter drops its weapon as loot (clones leave nothing).
    if (victim && victim !== this.player && !victim.isClone && victim.weaponKey) {
      this.crates.dropWeapon(victim.position, victim.weaponKey, victim.color);
    }
    if (!killer) return;
    if (killer === this.player) { this.playerKills++; this.player.onKill(); }
    const involvesPlayer = killer === this.player || victim === this.player;
    this.hud.addKillFeed(killer, victim, killer.isStorm ? 'zone' : 'rifle', involvesPlayer);
  }

  _endMatch(won, placement) {
    this.over = true;
    this.active = false;
    this.weapon.stopFire();
    document.exitPointerLock();

    const title = document.getElementById('result-title');
    const sub = document.getElementById('result-sub');
    title.classList.toggle('defeat', !won);
    if (won) {
      title.textContent = '#1 VICTORY';
      sub.innerHTML = `Last one standing — <b>${this.playerKills}</b> eliminations`;
    } else {
      title.textContent = 'ELIMINATED';
      sub.innerHTML = `You placed <b>#${placement}</b> of ${this.total} — <b>${this.playerKills}</b> eliminations`;
    }
    document.getElementById('gameover').classList.remove('hidden');
    this.audio.matchEnd(won);
  }

  _checkBoostPads() {
    if (!this.player.onGround) return;
    for (const pad of this.world.boostPads) {
      const dx = this.player.position.x - pad.x, dz = this.player.position.z - pad.z;
      if (dx * dx + dz * dz < pad.r * pad.r) {
        this.player.boost(30);
        this.audio.boost();
        break;
      }
    }
  }

  _updateCarPrompt() {
    this.hud.setPrompt(this.crates.interactPrompt(this.player));
  }

  _updateZoneHud() {
    if (this.storm.shrinking) this.hud.setZone('ZONE CLOSING', true);
    else this.hud.setZone('ZONE SHRINKS ' + Math.ceil(this.storm.countdown) + 's', false);
    this.hud.setZoneWarning(this.player.alive && this.storm.isOutside(this.player.position));
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    // `raw` is the real frame time; `delta` is scaled by the debug slow-mo/fast
    // toggle (×1 normally) and drives every game system.
    const raw = Math.min(this.clock.getDelta(), 0.05);
    const delta = raw * this.debug.timeScale;

    if (this.active && !this.over) {
      const prevHp = this.player.hp;
      this.player.speedMult = Math.min(2.2, 1 + 0.18 * this.powerups.level('speed'));
      this.player.maxAirJumps = this.powerups.level('jump');
      this.player.update(delta);
      this._checkBoostPads();
      this.weapon.update(delta);
      this.bots.update(delta, this.storm);
      this.powerups.update(delta, this.player);
      this.crates.update(delta, this.player);
      this.specials.update(delta, this.player, this.weapon, this.powerups, this.bots);
      this.destructibles.update(delta);
      this.storm.update(delta, this.bots.allFighters(), this.player);

      if (this.player.hp < prevHp && this.player.alive) this.hud.showDamage();
      this.hud.setHealth(this.player.hpFraction);

      const botsAlive = this.bots.countAlive();
      this.hud.setAlive(botsAlive + (this.player.alive ? 1 : 0));
      this.hud.setAbilities(this.powerups.level('clone'), this.player.hyperCharges);
      this._updateCarPrompt();
      this._updateZoneHud();
      this.minimap.draw(this.player, this.bots, this.storm, this.crates, this.specials);

      // Win / lose (no respawn — death is final).
      if (!this.player.alive) {
        this.hud.addKillFeed(this.player.lastAttacker || { name: '???' }, this.player,
          (this.player.lastAttacker && this.player.lastAttacker.isStorm) ? 'zone' : 'rifle', true);
        this._endMatch(false, botsAlive + 1);
      } else if (botsAlive === 0) {
        this._endMatch(true, 1);
      }
    }

    this.debug.update(raw);
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

try {
  new Game();
  window.__GAME_READY = true;
} catch (err) {
  console.error(err);
  const msg = err && err.stack ? err.stack : String(err);
  if (window.__bootError) window.__bootError('Startup error:\n' + msg);
  else throw err;
}
