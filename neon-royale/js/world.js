
// Map dimensions. Battle-royale scale: a big open city.
const ARENA = {
  half: 430,                 // map spans [-half, half] on X and Z — a giant city
  wallHeight: 40,
  center: new THREE.Vector3(0, 0, 0),
};

// How high a step the player can walk straight up onto (curbs, low ledges).
const STEP_HEIGHT = 0.7;

// Neon palette — each building glows a single hue for a cohesive skyline.
const NEON = [0x00e5ff, 0xff2bd6, 0x9b5cff, 0x21ffa3, 0xff7a1a, 0xffe24d];

/**
 * The World owns all static level geometry for the giant neon city. It exposes
 * the collider boxes (for movement) and the solid meshes (for line-of-sight and
 * bullet/explosion raycasts), plus a helper to find clear spawn spots.
 */
class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.obstacleMeshes = [];
    this._matCache = new Map();

    // Uniform spatial grid (XZ) so collision/line-of-sight only test nearby
    // colliders instead of all of them — what keeps the giant map fast.
    this.cell = 18;
    this.gridMin = -(ARENA.half + 8);
    this.gridDim = Math.ceil((ARENA.half + 8) * 2 / this.cell);
    this.grid = new Array(this.gridDim * this.gridDim);
    this._stamp = 0;

    this.boostPads = [];
    this.garageSpots = [];
    this.interiorSpots = [];   // centres of hollow buildings (for "loot rooms")
    this._buildSkyAndLights();
    this._buildGround();
    this._buildBuildings();
    this._buildGarages();
    this._buildCars();
    this._buildLamps();
    this._buildBoostPads();
    this._buildBoundary();
  }

  // Open-fronted garages (3 walls + roof) that house a car and a weapon crate.
  _buildGarages() {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1e27, roughness: 0.9 });
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    for (let i = 0; i < 20; i++) {
      const p = this.randomClearPosition(20);
      const w = 9, d = 9, h = 5, t = 0.5;
      this._addBox(p.x, p.z - d / 2, w, h, t, wallMat);          // back wall
      this._addBox(p.x - w / 2, p.z, t, h, d, wallMat);          // left wall
      this._addBox(p.x + w / 2, p.z, t, h, d, wallMat);          // right wall
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + t, 0.4, d), wallMat);
      roof.position.set(p.x, h, p.z); this.scene.add(roof);      // decorative (no collider)
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, 0.2), trimMat);
      trim.position.set(p.x, h - 0.3, p.z + d / 2); this.scene.add(trim);
      this.garageSpots.push({ x: p.x, z: p.z });
    }
  }

  _buildSkyAndLights() {
    this.scene.background = new THREE.Color(0x070611);
    this.scene.fog = new THREE.Fog(0x0a0718, 90, 620);

    this.scene.add(new THREE.HemisphereLight(0x556ad8, 0x0a0a16, 0.6));
    const moon = new THREE.DirectionalLight(0x8fa6ff, 0.5);
    moon.position.set(-60, 90, -40);
    this.scene.add(moon);
    const fill = new THREE.DirectionalLight(0xff3bb0, 0.18);
    fill.position.set(70, 40, 60);
    this.scene.add(fill);
  }

  _buildGround() {
    const size = ARENA.half * 2 + 10;
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: 0x0c0d16, roughness: 0.85, metalness: 0.2 })
    );
    road.rotation.x = -Math.PI / 2;
    this.scene.add(road);

    const grid = new THREE.GridHelper(size, 130, 0xff2bd6, 0x1b2a55);
    grid.material.transparent = true;
    grid.material.opacity = 0.4;
    grid.position.y = 0.02;
    this.scene.add(grid);
  }

  _buildBuildings() {
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.9 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 0.9 });
    const step = 48;                               // wider spacing => wider roads
    let seed = 0;

    for (let gx = -ARENA.half + 30; gx <= ARENA.half - 30; gx += step) {
      for (let gz = -ARENA.half + 30; gz <= ARENA.half - 30; gz += step) {
        if (Math.hypot(gx, gz) < 34) continue;     // central plaza
        if (Math.random() < 0.12) continue;        // scattered gaps / squares

        const x = gx + (Math.random() - 0.5) * 12;
        const z = gz + (Math.random() - 0.5) * 12;

        // Varied building types. Mid-rise blocks and warehouses are HOLLOW —
        // walls + doorways you can walk inside; towers/hulks stay solid.
        let fx, fz, h, hollow = false;
        const r = Math.random();
        if (r < 0.26) {                  // slim skyscraper (solid)
          fx = fz = 8 + Math.random() * 4; h = 28 + Math.random() * 26;
        } else if (r < 0.58) {           // mid-rise block (enterable)
          fx = 13 + Math.random() * 9; fz = 13 + Math.random() * 9; h = 11 + Math.random() * 12; hollow = true;
        } else if (r < 0.86) {           // wide warehouse (enterable)
          fx = 18 + Math.random() * 11; fz = 15 + Math.random() * 10; h = 7 + Math.random() * 6; hollow = true;
        } else {                         // chunky hulk (solid)
          fx = 15 + Math.random() * 7; fz = 15 + Math.random() * 7; h = 16 + Math.random() * 16;
        }

        const hue = NEON[seed % NEON.length];
        seed++;
        this._sidewalk(x, z, Math.max(fx, fz) + 2.6);
        const facade = this._facadeMaterial((fx + fz) / 2, h, hue);
        if (hollow) {
          this._hollowBuilding(x, z, fx, fz, h, hue, facade, roofMat);
        } else {
          this._addBox(x, z, fx, h, fz, [facade, facade, roofMat, baseMat, facade, facade]);
          this._neonRim(x, z, fx, fz, h, hue);
        }
      }
    }
  }

  // An enterable building: perimeter walls (colliders) with a doorway gap in the
  // front and back walls, a decorative roof, and neon trim. The hollow interior
  // is free of colliders, so you can walk in (and loot can spawn inside).
  _hollowBuilding(x, z, fx, fz, h, hue, facade, roofMat) {
    const t = 0.6;
    const doorW = Math.max(3.5, Math.min(6, fx * 0.35));
    const seg = (fx - doorW) / 2;

    // Solid side walls.
    this._addBox(x - fx / 2, z, t, h, fz, facade);
    this._addBox(x + fx / 2, z, t, h, fz, facade);

    // Front (+z) and back (-z) walls, each split around a central doorway.
    for (const sz of [fz / 2, -fz / 2]) {
      this._addBox(x - (doorW / 2 + seg / 2), z + sz, seg, h, t, facade);
      this._addBox(x + (doorW / 2 + seg / 2), z + sz, seg, h, t, facade);
      // Decorative lintel above the doorway (no collider — the gap stays walkable).
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW, h - 3, t), facade);
      lintel.position.set(x, 3 + (h - 3) / 2, z + sz);
      this.scene.add(lintel);
    }

    const roof = new THREE.Mesh(new THREE.BoxGeometry(fx + t, 0.5, fz + t), roofMat);
    roof.position.set(x, h, z);
    this.scene.add(roof);
    // A thin collider at the roof so the player can stand on it (height-aware
    // collision lets ground-level bots/cars ignore it — see resolveCollision).
    this._roofCollider(x, z, fx + t, fz + t, h);
    this._neonRim(x, z, fx, fz, h, hue);
    this.interiorSpots.push({ x, z });   // a "loot room" can be placed inside
  }

  // Register a flat, thin collider box flush with a roof top (max.y === top).
  _roofCollider(x, z, w, d, top) {
    const box = new THREE.Box3(
      new THREE.Vector3(x - w / 2, top - 0.5, z - d / 2),
      new THREE.Vector3(x + w / 2, top, z + d / 2)
    );
    this._registerCollider(box);
  }

  _buildBoostPads() {
    for (let i = 0; i < 70; i++) {
      const p = this.randomClearPosition(12);
      this._boostPad(p.x, p.z);
    }
  }

  // A jump pad that flings the player skyward to reach rooftops.
  _boostPad(x, z) {
    const color = 0x35ff8a;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.7, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4 }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0.06, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 24),
      new THREE.MeshBasicMaterial({ color }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.1, z);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 7, 16, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
    beam.position.set(x, 3.5, z);
    this.scene.add(disc, ring, beam);
    for (let i = 0; i < 3; i++) {           // upward chevrons
      const chev = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.5, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }));
      chev.position.set(x, 0.9 + i * 0.95, z);
      this.scene.add(chev);
    }
    this.boostPads.push({ x, z, r: 1.8 });
  }

  _sidewalk(x, z, size) {
    const s = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: 0x161824, roughness: 0.95 })
    );
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, 0.025, z);
    this.scene.add(s);
  }

  _neonRim(x, z, fx, fz, h, hue) {
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(fx + 0.25, 0.3, fz + 0.25),
      new THREE.MeshBasicMaterial({ color: hue })
    );
    band.position.set(x, h - 0.6, z);
    this.scene.add(band);
  }

  // Emissive window-grid facade (cached by quantised size + hue so the giant
  // skyline reuses a small set of textures).
  _facadeMaterial(wWorld, hWorld, hue) {
    const cols = clamp(Math.round(wWorld / 3), 2, 5);
    const rows = clamp(Math.round(hWorld / 3), 3, 12);
    const key = `${cols}x${rows}x${hue}`;
    if (this._matCache.has(key)) return this._matCache.get(key);

    const cell = 16;
    const canvas = document.createElement('canvas');
    canvas.width = cols * cell;
    canvas.height = rows * cell;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0c16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const hueHex = '#' + hue.toString(16).padStart(6, '0');
    for (let yy = 0; yy < rows; yy++) {
      for (let xx = 0; xx < cols; xx++) {
        const roll = Math.random();
        ctx.fillStyle = roll < 0.42 ? hueHex : roll < 0.5 ? '#ffffff' : '#0c0f1a';
        ctx.fillRect(xx * cell + 3, yy * cell + 3, cell - 6, cell - 7);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.25, roughness: 0.85,
    });
    this._matCache.set(key, mat);
    return mat;
  }

  _buildCars() {
    const carColors = [0x8a3b5b, 0x35506f, 0x2f6b66, 0x6b4a8a, 0x7a6a3a];
    const glow = [0x00e5ff, 0xff2bd6, 0x21ffa3, 0x9b5cff, 0xff7a1a];
    for (let i = 0; i < 120; i++) {
      const p = this.randomClearPosition(12);
      this._car(p.x, p.z, carColors[i % carColors.length], glow[i % glow.length], Math.random() < 0.5);
    }
  }

  _car(x, z, color, glowColor, alongZ) {
    const g = new THREE.Group();
    const w = alongZ ? 2 : 4.2, d = alongZ ? 4.2 : 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 }));
    body.position.y = 0.6;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.7, d * 0.55),
      new THREE.MeshStandardMaterial({ color: 0x0a0e16, roughness: 0.2, metalness: 0.7 }));
    cabin.position.y = 1.35;
    const ug = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, d + 0.6),
      new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.35 }));
    ug.rotation.x = -Math.PI / 2;
    ug.position.y = 0.06;
    g.add(body, cabin, ug);
    g.position.set(x, 0, z);
    this.scene.add(g);

    this.obstacleMeshes.push(body);
    this._registerCollider(new THREE.Box3().setFromObject(g));
  }

  _buildLamps() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x141821, roughness: 0.8 });
    for (let i = 0; i < 82; i++) {
      const p = this.randomClearPosition(8);
      const hue = NEON[i % NEON.length];
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 5, 8), poleMat);
      pole.position.set(p.x, 2.5, p.z);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8),
        new THREE.MeshBasicMaterial({ color: hue }));
      bulb.position.set(p.x, 5.0, p.z);
      this.scene.add(pole, bulb);
    }
  }

  _buildBoundary() {
    const h = ARENA.wallHeight, t = 3, s = ARENA.half + 1.5;
    const mat = new THREE.MeshStandardMaterial({ color: 0x08090f, roughness: 0.95 });
    this._addBox(0, -s, 2 * s + t, h, t, mat);
    this._addBox(0,  s, 2 * s + t, h, t, mat);
    this._addBox(-s, 0, t, h, 2 * s + t, mat);
    this._addBox( s, 0, t, h, 2 * s + t, mat);
  }

  _addBox(x, z, w, h, d, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, h / 2, z);
    this.scene.add(mesh);
    this.obstacleMeshes.push(mesh);
    this._registerCollider(new THREE.Box3().setFromObject(mesh));
    return mesh;
  }

  // ---- spatial grid ----
  _cc(v) {
    let c = Math.floor((v - this.gridMin) / this.cell);
    if (c < 0) c = 0; else if (c >= this.gridDim) c = this.gridDim - 1;
    return c;
  }

  _registerCollider(box) {
    this.colliders.push(box);
    const x0 = this._cc(box.min.x), x1 = this._cc(box.max.x);
    const z0 = this._cc(box.min.z), z1 = this._cc(box.max.z);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const ci = cz * this.gridDim + cx;
        (this.grid[ci] || (this.grid[ci] = [])).push(box);
      }
    }
    return box;
  }

  removeCollider(box) {
    const i = this.colliders.indexOf(box);
    if (i >= 0) this.colliders.splice(i, 1);
    const x0 = this._cc(box.min.x), x1 = this._cc(box.max.x);
    const z0 = this._cc(box.min.z), z1 = this._cc(box.max.z);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.grid[cz * this.gridDim + cx];
        if (!cell) continue;
        const j = cell.indexOf(box);
        if (j >= 0) cell.splice(j, 1);
      }
    }
  }

  // 3D segment-vs-AABB (slab). Returns entry param s in [0,1], or -1 if missed.
  _segBox(ox, oy, oz, dx, dy, dz, box) {
    let tmin = 0, tmax = 1, t1, t2, tt;
    if (Math.abs(dx) < 1e-9) { if (ox < box.min.x || ox > box.max.x) return -1; }
    else { t1 = (box.min.x - ox) / dx; t2 = (box.max.x - ox) / dx; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    if (Math.abs(dy) < 1e-9) { if (oy < box.min.y || oy > box.max.y) return -1; }
    else { t1 = (box.min.y - oy) / dy; t2 = (box.max.y - oy) / dy; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    if (Math.abs(dz) < 1e-9) { if (oz < box.min.z || oz > box.max.z) return -1; }
    else { t1 = (box.min.z - oz) / dz; t2 = (box.max.z - oz) / dz; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    return tmin;
  }

  // Is the 3D segment from `from` to `to` blocked by any collider?
  segmentBlocked(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const stamp = ++this._stamp;
    const cx0 = this._cc(Math.min(from.x, to.x)), cx1 = this._cc(Math.max(from.x, to.x));
    const cz0 = this._cc(Math.min(from.z, to.z)), cz1 = this._cc(Math.max(from.z, to.z));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = this.grid[cz * this.gridDim + cx];
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const box = cell[i];
          if (box._st === stamp) continue; box._st = stamp;
          if (this._segBox(from.x, from.y, from.z, dx, dy, dz, box) >= 0) return true;
        }
      }
    }
    return false;
  }

  // Nearest obstacle distance along `dir` (unit) up to `maxDist` (for camera).
  raycastDistance(from, dir, maxDist) {
    const dx = dir.x * maxDist, dy = dir.y * maxDist, dz = dir.z * maxDist;
    const tox = from.x + dx, toz = from.z + dz;
    const stamp = ++this._stamp;
    const cx0 = this._cc(Math.min(from.x, tox)), cx1 = this._cc(Math.max(from.x, tox));
    const cz0 = this._cc(Math.min(from.z, toz)), cz1 = this._cc(Math.max(from.z, toz));
    let minS = Infinity;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = this.grid[cz * this.gridDim + cx];
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const box = cell[i];
          if (box._st === stamp) continue; box._st = stamp;
          const s = this._segBox(from.x, from.y, from.z, dx, dy, dz, box);
          if (s >= 0 && s < minS) minS = s;
        }
      }
    }
    return minS === Infinity ? maxDist : minS * maxDist;
  }

  // Find a position not inside a building (used for scattered spawns/loot/cars).
  randomClearPosition(margin = 10) {
    for (let i = 0; i < 56; i++) {
      const p = new THREE.Vector3(
        (Math.random() * 2 - 1) * (ARENA.half - margin), 0,
        (Math.random() * 2 - 1) * (ARENA.half - margin)
      );
      const before = p.clone();
      this.resolveCollision(p, 0.8);
      if (p.distanceTo(before) < 0.01) return p;   // was already clear
    }
    const p = new THREE.Vector3(0, 0, 0);
    this.resolveCollision(p, 0.8);
    return p;
  }

  // Push `pos` out of any collider it overlaps in XZ. When `feetY` is given the
  // resolve is height-aware: a box is ignored unless the body column
  // [feetY, headY] vertically overlaps it — so a player standing on a roof isn't
  // shoved off, and ground-level bots ignore the thin roof colliders far above.
  resolveCollision(pos, radius, feetY, headY) {
    const checkY = feetY !== undefined;
    const stamp = ++this._stamp;
    const cx0 = this._cc(pos.x - radius), cx1 = this._cc(pos.x + radius);
    const cz0 = this._cc(pos.z - radius), cz1 = this._cc(pos.z + radius);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = this.grid[cz * this.gridDim + cx];
        if (!cell) continue;
        for (let bi = 0; bi < cell.length; bi++) {
          const box = cell[bi];
          if (box._st === stamp) continue; box._st = stamp;   // dedup across cells
          if (checkY && (feetY >= box.max.y - 0.05 || headY <= box.min.y + 0.05)) continue;

          const nx = clamp(pos.x, box.min.x, box.max.x);
          const nz = clamp(pos.z, box.min.z, box.max.z);
          const dx = pos.x - nx;
          const dz = pos.z - nz;
          const distSq = dx * dx + dz * dz;
          if (distSq >= radius * radius) continue;

          if (distSq > 1e-8) {
            const dist = Math.sqrt(distSq);
            const push = radius - dist;
            pos.x += (dx / dist) * push;
            pos.z += (dz / dist) * push;
          } else {
            const toMinX = pos.x - box.min.x, toMaxX = box.max.x - pos.x;
            const toMinZ = pos.z - box.min.z, toMaxZ = box.max.z - pos.z;
            const min = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
            if (min === toMinX) pos.x = box.min.x - radius;
            else if (min === toMaxX) pos.x = box.max.x + radius;
            else if (min === toMinZ) pos.z = box.min.z - radius;
            else pos.z = box.max.z + radius;
          }
        }
      }
    }
  }

  // Highest standable surface directly under (x,z) that feet at `feetY` can rest
  // on (a roof or the box top, if no more than a step above the feet). Returns 0
  // (the street) when nothing applies — this is what makes rooftops walkable.
  supportHeight(x, z, feetY) {
    let best = 0;
    const cell = this.grid[this._cc(z) * this.gridDim + this._cc(x)];
    if (cell) {
      const stamp = ++this._stamp;
      for (let i = 0; i < cell.length; i++) {
        const box = cell[i];
        if (box._st === stamp) continue; box._st = stamp;
        if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue;
        const top = box.max.y;
        if (top <= feetY + STEP_HEIGHT && top > best) best = top;
      }
    }
    return best;
  }

  getObstacleMeshes() {
    return this.obstacleMeshes;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
