
const RADIUS = 0.4;
const PLAYER_HEIGHT = 1.7;     // body column height, for height-aware wall collision
const CAR_RADIUS = 1.2;
const WALK_SPEED = 7.2;
const SPRINT_MULT = 1.5;
const ACCEL = 14;
const GRAVITY = 26;
const JUMP_VELOCITY = 8.5;
const PLAYER_MAX_HP = 100;
const REGEN_DELAY = 4;
const REGEN_RATE = 16;
const HYPER_TIME = 4;
const HYPER_MULT = 2.1;
const CAM_PIVOT_Y = 1.55;
const FP_EYE = 1.62;
const CAM_OFFSET = new THREE.Vector3(0.75, 0.35, 4.4);

// Arcade car physics.
const CAR_ACCEL = 26;
const CAR_DRAG = 1.1;
const CAR_MAX = 30;
const CAR_TURN = 2.3;

/**
 * The human fighter. Toggleable first/third person camera, a visible animated
 * body that holds a gun, movement, health, abilities (hyper-boost), and a
 * proper arcade-driving car.
 */
class Player {
  constructor(camera, world, audio) {
    this.world = world;
    this.audio = audio;
    this.camera = camera;
    this.team = 'player';
    this.name = 'YOU';

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.velocityY = 0;
    this.onGround = true;
    this.yawAngle = 0;
    this.pitchAngle = 0;

    this.maxHp = PLAYER_MAX_HP;
    this.hp = PLAYER_MAX_HP;
    this.alive = true;

    this.keys = {};
    this.sensitivity = 0.0022;
    this.controlsEnabled = false;
    this.thirdPerson = true;
    this.speedMult = 1;
    this.maxAirJumps = 0;
    this.airJumpsUsed = 0;
    this.prevSpace = false;
    this.knockVel = new THREE.Vector3();
    this.regenT = 0;
    this.regenBoostT = 0;
    this.hyperT = 0;
    this.hyperCharges = 0;
    this.inCar = false;
    this.carMesh = null;
    this.carYaw = 0;
    this.carSpeed = 0;
    this.shootKick = 0;
    this._walkPhase = 0;
    this.godMode = false;     // debug toggles
    this.noclip = false;

    this._camRay = new THREE.Raycaster();
    this._buildModel();
    this._bindInput();
    this.spawn(ARENA.center);
  }

  _buildModel() {
    // Built from the shared fighter factory, so the player and every bot are
    // the same model — here in the player's cyan/teal armour scheme.
    const parts = buildFighterModel({ armor: 0x7fe8ff, accent: 0x39d8ff, suit: 0x2a3340, skin: 0xe8d2b8 });
    this.model = parts.root;
    this.pivot = parts.pivot;
    this.legL = parts.legL; this.legR = parts.legR;
    this.armL = parts.armL; this.armR = parts.armR;
    this.gun = parts.gun;
    this.muzzle = parts.muzzle;

    this._buildViewModel();
  }

  // First-person viewmodel: a gun pinned to the camera, lower-right, drawn on
  // top of the world so it never clips through walls. Only shown in 1st person.
  _buildViewModel() {
    const vm = buildGun({ glow: 0x39d8ff, overlay: true });
    this.viewModel = vm.group;
    this.vmMuzzle = vm.muzzle;
    this.viewModel.position.set(0.32, -0.3, -0.62);
    this.viewModel.rotation.set(0, 0.05, 0);
    this.viewModel.scale.setScalar(1.15);
    this.viewModel.visible = false;
    this._vmBob = 0;
    this.camera.add(this.viewModel);
  }

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    document.addEventListener('mousemove', (e) => {
      if (!this.controlsEnabled || document.pointerLockElement === null) return;
      this.yawAngle -= e.movementX * this.sensitivity;
      this.pitchAngle -= e.movementY * this.sensitivity;
      const lim = 1.3;
      this.pitchAngle = Math.max(-lim, Math.min(lim, this.pitchAngle));
    });
  }

  get aimPoint() {
    return new THREE.Vector3(this.position.x, this.position.y + 1.3, this.position.z);
  }

  toggleView() { this.thirdPerson = !this.thirdPerson; }

  spawn(pos) {
    this.position.set(pos.x, 0, pos.z);
    this.velocity.set(0, 0, 0);
    this.velocityY = 0;
    this.knockVel.set(0, 0, 0);
    this.maxHp = PLAYER_MAX_HP;
    this.hp = PLAYER_MAX_HP;
    this.regenT = 0;
    this.regenBoostT = 0;
    this.hyperT = 0;
    this.hyperCharges = 0;
    this.airJumpsUsed = 0;
    this.alive = true;
    this.inCar = false;
    this.carMesh = null;
    this.carSpeed = 0;
    this.model.visible = true;
    this.yawAngle = Math.atan2(ARENA.center.x - pos.x, ARENA.center.z - pos.z);
    this.pitchAngle = 0;
    this._syncModel(0);
    this._updateCamera();
  }

  // ---- abilities & effects ----
  applyImpulse(dir, power) {
    this.knockVel.x += dir.x * power;
    this.knockVel.z += dir.z * power;
    if (dir.y > 0) { this.velocityY += dir.y * power; this.onGround = false; }
  }
  heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); }
  addMaxHp(n) { this.maxHp += n; this.hp += n; }
  onKill() { this.regenBoostT = 5; this.regenT = Math.max(this.regenT, REGEN_DELAY * 0.5); }
  boost(v) { this.velocityY = v; this.onGround = false; this.airJumpsUsed = 0; }
  onShoot() { this.shootKick = 1; }

  activateHyper() {
    this.hyperT = HYPER_TIME;
    this.knockVel.x += Math.sin(this.yawAngle) * -8;
    this.knockVel.z += Math.cos(this.yawAngle) * -8;
  }

  enterCar(carMesh) {
    this.inCar = true; this.carMesh = carMesh; this.carYaw = this.yawAngle; this.carSpeed = 0;
  }
  exitCar() { this.inCar = false; this.carMesh = null; this.carSpeed = 0; }

  takeDamage(amount, attacker) {
    if (!this.alive || this.godMode) return;
    this.hp -= amount;
    this.regenT = 0;
    this.audio.hurt();
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.lastAttacker = attacker; }
  }

  update(delta) {
    if (!this.alive) {
      if (this.viewModel) this.viewModel.visible = false;
      this._updateCamera();
      return;
    }

    if (this.inCar) this._driveCar(delta);
    else this._moveOnFoot(delta);

    // Regen (faster shortly after a kill).
    this.regenBoostT = Math.max(0, this.regenBoostT - delta);
    const regenDelay = this.regenBoostT > 0 ? REGEN_DELAY * 0.5 : REGEN_DELAY;
    const regenRate = this.regenBoostT > 0 ? REGEN_RATE * 1.8 : REGEN_RATE;
    this.regenT += delta;
    if (this.regenT > regenDelay && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + regenRate * delta);
    }

    this.model.visible = this.thirdPerson && !this.inCar;
    if (this.viewModel) this.viewModel.visible = !this.thirdPerson && !this.inCar;
    this._syncModel(delta);
    this._updateCamera();
  }

  _moveOnFoot(delta) {
    const wish = new THREE.Vector3();
    if (this.controlsEnabled) {
      if (this.keys['KeyW']) wish.z -= 1;
      if (this.keys['KeyS']) wish.z += 1;
      if (this.keys['KeyA']) wish.x -= 1;
      if (this.keys['KeyD']) wish.x += 1;
    }
    const sprinting = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    this.hyperT = Math.max(0, this.hyperT - delta);
    const speed = WALK_SPEED * (sprinting ? SPRINT_MULT : 1) * this.speedMult * (this.hyperT > 0 ? HYPER_MULT : 1);

    if (wish.lengthSq() > 0) wish.normalize().applyEuler(new THREE.Euler(0, this.yawAngle, 0));
    const targetVel = wish.multiplyScalar(speed);
    this.velocity.x += (targetVel.x - this.velocity.x) * Math.min(1, ACCEL * delta);
    this.velocity.z += (targetVel.z - this.velocity.z) * Math.min(1, ACCEL * delta);

    this.position.x += (this.velocity.x + this.knockVel.x) * delta;
    this.position.z += (this.velocity.z + this.knockVel.z) * delta;
    this.knockVel.multiplyScalar(Math.max(0, 1 - delta * 2.5));

    // Noclip (debug): free 3D flight, no gravity, no collision.
    if (this.noclip) {
      const lift = (this.keys['Space'] ? 1 : 0) - ((this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 1 : 0);
      this.position.y += lift * speed * delta;
      this.velocityY = 0; this.onGround = false;
      return;
    }

    const space = !!this.keys['Space'];
    if (this.controlsEnabled && space && !this.prevSpace) {
      if (this.onGround) { this.velocityY = JUMP_VELOCITY; this.onGround = false; this.airJumpsUsed = 0; }
      else if (this.airJumpsUsed < this.maxAirJumps) { this.velocityY = JUMP_VELOCITY; this.airJumpsUsed++; }
    }
    this.prevSpace = space;

    // Height-aware horizontal collision (so roofs don't shove you off their edge).
    this.world.resolveCollision(this.position, RADIUS, this.position.y, this.position.y + PLAYER_HEIGHT);

    // Vertical: fall until we land on the street or whatever roof is underfoot.
    this.velocityY -= GRAVITY * delta;
    this.position.y += this.velocityY * delta;
    const support = this.velocityY <= 0 ? this.world.supportHeight(this.position.x, this.position.z, this.position.y) : 0;
    if (this.position.y <= support) {
      this.position.y = support; this.velocityY = 0; this.onGround = true; this.airJumpsUsed = 0;
    } else {
      this.onGround = false;
    }
  }

  _driveCar(delta) {
    const k = this.controlsEnabled ? this.keys : {};
    const throttle = (k['KeyW'] ? 1 : 0) - (k['KeyS'] ? 1 : 0);
    this.carSpeed += throttle * CAR_ACCEL * delta;
    this.carSpeed *= Math.max(0, 1 - CAR_DRAG * delta);
    this.carSpeed = Math.max(-CAR_MAX * 0.5, Math.min(CAR_MAX, this.carSpeed));

    const steer = (k['KeyA'] ? 1 : 0) - (k['KeyD'] ? 1 : 0);
    const speedFactor = Math.min(1, Math.abs(this.carSpeed) / 4);
    this.carYaw += steer * CAR_TURN * delta * speedFactor * (this.carSpeed >= 0 ? 1 : -1);

    const fx = -Math.sin(this.carYaw), fz = -Math.cos(this.carYaw);
    const before = this.position.clone();
    this.position.x += fx * this.carSpeed * delta;
    this.position.z += fz * this.carSpeed * delta;
    this.world.resolveCollision(this.position, CAR_RADIUS, 0, 2.0);
    const moved = Math.hypot(this.position.x - before.x, this.position.z - before.z);
    const intended = Math.abs(this.carSpeed * delta);
    if (intended > 0.02 && moved < intended * 0.5) this.carSpeed *= 0.35;   // hit a wall

    this.position.y = 0; this.velocityY = 0; this.onGround = true;
    this.yawAngle = this.carYaw;     // camera rides behind the car
  }

  _syncModel(delta) {
    if (this.inCar && this.carMesh) {
      this.carMesh.position.set(this.position.x, 0, this.position.z);
      this.carMesh.rotation.y = this.carYaw;
      return;
    }
    this.model.position.copy(this.position);
    this.model.rotation.y = this.yawAngle;

    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    this._walkPhase += sp * delta * 2.4;
    const swing = Math.sin(this._walkPhase) * Math.min(0.6, sp * 0.12);
    this.legL.rotation.x = swing; this.legR.rotation.x = -swing;

    this.shootKick = Math.max(0, this.shootKick - delta * 5);
    const aim = Math.max(-0.5, Math.min(0.5, this.pitchAngle * 0.55));
    this.armL.rotation.x = 1.35 + aim;
    this.armR.rotation.x = 1.35 + aim;
    this.gun.rotation.x = aim;
    this.gun.position.z = -0.32 + this.shootKick * 0.1;

    // First-person viewmodel: a gentle walk-bob plus a recoil kick when firing.
    if (this.viewModel && this.viewModel.visible) {
      this._vmBob += delta * (5 + sp * 0.8);
      const bob = this.onGround ? Math.sin(this._vmBob) * Math.min(0.018, sp * 0.004) : 0;
      const kick = this.shootKick * 0.14;
      this.viewModel.position.set(0.32, -0.3 + bob, -0.62 + kick);
      this.viewModel.rotation.x = -kick * 1.1;   // muzzle climbs as it recoils
    }
  }

  _updateCamera() {
    const camQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitchAngle, this.yawAngle, 0, 'YXZ'));

    if (!this.thirdPerson && !this.inCar) {
      this.camera.position.set(this.position.x, this.position.y + FP_EYE, this.position.z);
      this.camera.quaternion.copy(camQuat);
      this.camera.updateMatrixWorld();
      return;
    }

    const pivot = new THREE.Vector3(this.position.x, this.position.y + CAM_PIVOT_Y, this.position.z);
    const off = CAM_OFFSET.clone();
    if (this.inCar) off.z *= 1.5;
    off.applyQuaternion(camQuat);
    let dist = off.length();
    const dir = off.clone().multiplyScalar(1 / dist);
    const hitDist = this.world.raycastDistance(pivot, dir, dist);
    if (hitDist < dist) dist = Math.max(0.6, hitDist - 0.25);
    this.camera.position.copy(pivot).addScaledVector(dir, dist);
    this.camera.quaternion.copy(camQuat);
    this.camera.updateMatrixWorld();
  }

  getMuzzleWorld() {
    const v = new THREE.Vector3();
    // In first person, tracers/flash come from the viewmodel's barrel.
    const src = (!this.thirdPerson && !this.inCar && this.vmMuzzle) ? this.vmMuzzle : this.muzzle;
    src.getWorldPosition(v);
    return v;
  }

  getAimDirection() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  get hpFraction() { return this.hp / this.maxHp; }
}
