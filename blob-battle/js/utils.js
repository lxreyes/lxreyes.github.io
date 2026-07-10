/* ============================================================
   utils.js  —  math, vectors, input, small helpers
   Loaded first. Everything hangs off the global `BB` namespace.
   ============================================================ */

const BB = {};

/* ---------- math helpers ---------- */
BB.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
BB.lerp = (a, b, t) => a + (b - a) * t;
BB.rand = (a, b) => a + Math.random() * (b - a);
BB.randInt = (a, b) => Math.floor(BB.rand(a, b + 1));
BB.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
BB.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
BB.sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
BB.approach = (v, target, step) => {
  if (v < target) return Math.min(v + step, target);
  if (v > target) return Math.max(v - step, target);
  return v;
};

/* ---------- ability power ----------
   No in-match leveling: every ability always fires at this level. */
BB.ABILITY_LEVEL = 2;

/* ---------- 2D vector (lightweight, mostly plain {x,y}) ---------- */
BB.Vec = {
  len: (x, y) => Math.hypot(x, y),
  norm: (x, y) => {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  },
};

/* ---------- input ---------- */
BB.Input = {
  keys: {},
  mouse: { x: 0, y: 0, down: false, rdown: false },
  _justPressed: {},

  init(canvas) {
    window.addEventListener("keydown", (e) => {
      // avoid page scrolling on space / arrows
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key))
        e.preventDefault();
      const k = e.key.toLowerCase();
      if (!this.keys[k]) this._justPressed[k] = true;
      this.keys[k] = true;
    });
    window.addEventListener("keyup", (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    const rectPos = (e) => {
      const r = canvas.getBoundingClientRect();
      // canvas is drawn at internal resolution; scale mouse to it
      this.mouse.x = ((e.clientX - r.left) / r.width) * canvas.width;
      this.mouse.y = ((e.clientY - r.top) / r.height) * canvas.height;
    };
    canvas.addEventListener("mousemove", rectPos);
    canvas.addEventListener("mousedown", (e) => {
      rectPos(e);
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.rdown = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rdown = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  },

  key(k) {
    return !!this.keys[k];
  },
  // true only on the frame the key went down
  pressed(k) {
    return !!this._justPressed[k];
  },
  // call once at end of each frame
  endFrame() {
    this._justPressed = {};
  },
};

/* ---------- tiny particle system (juice) ---------- */
BB.Particles = {
  list: [],
  burst(x, y, color, count, speed, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.list.push({
        x, y,
        vx: Math.cos(a) * s + (opts.vx || 0),
        vy: Math.sin(a) * s + (opts.vy || 0),
        life: opts.life || 0.5,
        maxLife: opts.life || 0.5,
        r: opts.r || BB.rand(2, 4),
        color,
        gravity: opts.gravity !== undefined ? opts.gravity : 400,
      });
    }
  },
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.list.splice(i, 1);
    }
  },
  draw(ctx) {
    for (const p of this.list) {
      ctx.globalAlpha = BB.clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  clear() {
    this.list.length = 0;
  },
};

/* ---------- capsule/bean platform geometry ----------
   Platforms are capsules: a segment (x1,y1)-(x2,y2) with radius r.
   A circle is a capsule with x1==x2,y1==y2. Rounded => "soft" islands. */
BB.closestOnSeg = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = BB.clamp(t, 0, 1);
  return { x: x1 + dx * t, y: y1 + dy * t };
};
BB.pointInPlatform = (p, x, y, pad = 0) => {
  const c = BB.closestOnSeg(x, y, p.x1, p.y1, p.x2, p.y2);
  return BB.dist(x, y, c.x, c.y) <= p.r + pad;
};
// push a round object (needs x,y,vx,vy,r) out of a capsule; returns true if it was overlapping
BB.landOnPlatform = (obj, p) => {
  const c = BB.closestOnSeg(obj.x, obj.y, p.x1, p.y1, p.x2, p.y2);
  const dx = obj.x - c.x, dy = obj.y - c.y;
  const rr = obj.r + p.r;
  const d = Math.hypot(dx, dy) || 0.0001;
  if (d >= rr) return false;
  const nx = dx / d, ny = dy / d;
  obj.x += nx * (rr - d);
  obj.y += ny * (rr - d);
  const vn = obj.vx * nx + obj.vy * ny;
  if (vn < 0) { obj.vx -= vn * nx; obj.vy -= vn * ny; }
  return true;
};

/* ---------- hitstop (freeze-frame on big hits) ---------- */
BB.Hit = {
  stop: 0,
  add(t) { this.stop = Math.max(this.stop, t); },
};

/* ---------- screen shake ---------- */
BB.Shake = {
  amount: 0,
  add(a) {
    this.amount = Math.min(this.amount + a, 30);
  },
  update(dt) {
    this.amount = Math.max(0, this.amount - 60 * dt);
  },
  apply(ctx) {
    if (this.amount <= 0) return;
    const a = this.amount;
    ctx.translate(BB.rand(-a, a), BB.rand(-a, a));
  },
};
