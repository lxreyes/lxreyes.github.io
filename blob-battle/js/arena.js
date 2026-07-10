/* ============================================================
   arena.js  —  soft, rounded "bean" islands (capsules). Flat-topped
   capsules give blobs a surface to sit/stick on; circles are
   balance-y perches. Islands are stable (they don't crumble).
   ============================================================ */

BB.Arena = class {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.platforms = [];
    this.forcedLayout = -1; // -1 = random each round; 0..4 = a chosen map
    this.waterY = h - 70;   // world y of the reflective water surface at the bottom
    this.reset();
  }

  reset() {
    this.buildLayout();
  }

  buildLayout() {
    const w = this.w, h = this.h;
    this.platforms = [];
    // capsule: segment (x1,y1)-(x2,y2) + radius r. horizontal => flat top.
    const add = (x1, y1, x2, y2, r) =>
      this.platforms.push({ x1: x1 * w, y1: y1 * h, x2: x2 * w, y2: y2 * h, r, life: Infinity });

    // every layout has a distinct LEFT and RIGHT ground island so both fighters
    // spawn on solid ground, spread apart (never perched on a tiny floating disc)
    const layout = this.forcedLayout >= 0 ? this.forcedLayout : BB.randInt(0, 4);
    if (layout === 0) {
      add(0.14, 0.64, 0.34, 0.64, 30);       // left bean
      add(0.66, 0.64, 0.86, 0.64, 30);       // right bean
      add(0.5, 0.44, 0.5, 0.44, 24);         // high middle perch
    } else if (layout === 1) {
      add(0.08, 0.70, 0.40, 0.70, 30);       // wide ground, split by a center gap
      add(0.60, 0.70, 0.92, 0.70, 30);
    } else if (layout === 2) {
      add(0.10, 0.72, 0.30, 0.72, 28);       // staircase of three beans
      add(0.42, 0.56, 0.58, 0.56, 26);
      add(0.70, 0.72, 0.90, 0.72, 28);
    } else if (layout === 3) {
      add(0.22, 0.62, 0.22, 0.62, 40);       // two big round islands
      add(0.78, 0.62, 0.78, 0.62, 40);
    } else {
      add(0.10, 0.66, 0.34, 0.66, 28);       // offset beans + floating center circle
      add(0.66, 0.56, 0.90, 0.56, 28);
      add(0.5, 0.40, 0.5, 0.40, 20);
    }

    // spawn resting ON the leftmost & rightmost islands (small blob radius clearance)
    const sorted = [...this.platforms].sort((a, b) => (a.x1 + a.x2) - (b.x1 + b.x2));
    const spawnTop = (p) => ({ x: (p.x1 + p.x2) / 2, y: Math.min(p.y1, p.y2) - p.r - 16 });
    this.spawns = [spawnTop(sorted[0]), spawnTop(sorted[sorted.length - 1])];

    this._decorate();
    this._buildBackdrop();
  }

  // scatter grass tufts / flowers / pebbles along each island's rim (once per round)
  _decorate() {
    const palette = ["#ff7ab0", "#ffd24b", "#8be0ff", "#ff9a3c", "#c58bff"];
    for (const p of this.platforms) {
      if (p.temp) continue;
      p.decor = [];
      const topY = Math.min(p.y1, p.y2) - p.r + 3;
      const xL = Math.min(p.x1, p.x2), xR = Math.max(p.x1, p.x2);
      const span = xR - xL;
      const count = Math.max(3, Math.round((span + p.r) / 24));
      for (let i = 0; i < count; i++) {
        const x = span > 4 ? BB.rand(xL + 4, xR - 4) : (xL + xR) / 2 + BB.rand(-p.r * 0.45, p.r * 0.45);
        const roll = Math.random();
        if (roll < 0.15) p.decor.push({ kind: "flower", x, y: topY, c: BB.pick(palette), h: BB.rand(7, 12), ph: BB.rand(0, 6.28) });
        else if (roll < 0.30) p.decor.push({ kind: "pebble", x, y: topY + BB.rand(0, 2), rr: BB.rand(2, 3.6) });
        else p.decor.push({ kind: "grass", x, y: topY, h: BB.rand(6, 13), tilt: BB.rand(-3, 3), ph: BB.rand(0, 6.28) });
      }
    }
  }

  // a few distant island silhouettes that parallax behind the fight
  _buildBackdrop() {
    this.backdrop = [];
    for (let i = 0; i < 5; i++) {
      this.backdrop.push({
        x: BB.rand(0.05, 0.95) * this.w, y: BB.rand(0.15, 0.8) * this.h,
        len: BB.rand(60, 160), r: BB.rand(12, 26), depth: BB.rand(0.15, 0.4),
      });
    }
  }

  // conjure a temporary bean ledge (Platform ability)
  addTemp(cx, cy, len, r, life) {
    this.platforms.push({ x1: cx - len / 2, y1: cy, x2: cx + len / 2, y2: cy, r, life, temp: true });
  }

  update(dt) {
    // the islands are stable now; only conjured (temp) ledges expire
    for (let i = this.platforms.length - 1; i >= 0; i--) {
      const p = this.platforms[i];
      if (!p.temp) continue;
      p.life -= dt;
      if (p.life <= 0) { BB.Particles.burst((p.x1 + p.x2) / 2, p.y1, "#4be0c0", 10, 120, { gravity: 400 }); this.platforms.splice(i, 1); }
    }
  }

  _capsule(ctx, p, inset, color) {
    const w = Math.max(1, (p.r - inset) * 2);
    ctx.fillStyle = color;
    // circle islands are a zero-length segment; some browsers won't render a
    // round-cap stroke there, so draw the disc explicitly instead.
    if (p.x1 === p.x2 && p.y1 === p.y2) {
      ctx.beginPath();
      ctx.arc(p.x1, p.y1, w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x1, p.y1);
    ctx.lineTo(p.x2, p.y2);
    ctx.stroke();
  }

  draw(ctx, time = 0) { this.drawIslands(ctx, time); }

  // just the islands + decor (also re-used, flipped, for the water reflection)
  drawIslands(ctx, time = 0) {
    for (const p of this.platforms) {
      if (p.temp) {
        const blink = p.life < 1.2 ? 0.4 + 0.5 * Math.abs(Math.sin(p.life * 14)) : 1;
        ctx.globalAlpha = blink;
        this._capsule(ctx, p, 0, "#2f6f66");
        this._capsule(ctx, p, 3, "#3f8f82");
        ctx.globalAlpha = 1;
        // top rim
        ctx.strokeStyle = "#4be0c0"; ctx.lineWidth = 4; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(p.x1, Math.min(p.y1, p.y2) - p.r + 4); ctx.lineTo(p.x2, Math.min(p.y1, p.y2) - p.r + 4); ctx.stroke();
        continue;
      }
      this._capsule(ctx, p, 0, "#20283f");      // dark base
      this._capsule(ctx, p, 4, "#3f4b6b");      // body
      // grassy top crust — arc for circle islands, flat bar for beans
      const isCircle = p.x1 === p.x2 && p.y1 === p.y2;
      ctx.lineCap = "round";
      if (isCircle) {
        for (const [col, wd] of [["#3f7a46", 7], ["#6fbf5b", 3]]) {
          ctx.strokeStyle = col; ctx.lineWidth = wd;
          ctx.beginPath(); ctx.arc(p.x1, p.y1, p.r - 3, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
        }
      } else {
        const crust = Math.min(p.y1, p.y2) - p.r + 3;
        ctx.strokeStyle = "#3f7a46"; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(p.x1, crust); ctx.lineTo(p.x2, crust); ctx.stroke();
        ctx.strokeStyle = "#6fbf5b"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(p.x1, crust - 1); ctx.lineTo(p.x2, crust - 1); ctx.stroke();
      }
      if (p.decor) this._drawDecor(ctx, p, time);
    }
  }

  _drawDecor(ctx, p, time) {
    for (const d of p.decor) {
      if (d.kind === "grass") {
        const sway = d.tilt + Math.sin(time * 2.2 + d.ph) * 1.4;
        ctx.strokeStyle = "#5b9f48"; ctx.lineWidth = 1.8; ctx.lineCap = "round";
        for (const off of [-3, 0, 3]) {
          ctx.beginPath();
          ctx.moveTo(d.x + off, d.y);
          ctx.quadraticCurveTo(d.x + off + sway * 0.6, d.y - d.h * 0.6, d.x + off + sway, d.y - d.h);
          ctx.stroke();
        }
      } else if (d.kind === "flower") {
        const sway = Math.sin(time * 2.0 + d.ph) * 1.6;
        ctx.strokeStyle = "#5b9f48"; ctx.lineWidth = 1.8; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.quadraticCurveTo(d.x + sway * 0.5, d.y - d.h * 0.6, d.x + sway, d.y - d.h); ctx.stroke();
        const fx = d.x + sway, fy = d.y - d.h;
        ctx.fillStyle = d.c;
        for (let k = 0; k < 5; k++) { const a = k * (Math.PI * 2 / 5) + time * 0.5; ctx.beginPath(); ctx.arc(fx + Math.cos(a) * 2.4, fy + Math.sin(a) * 2.4, 2.1, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = "#fff4c2"; ctx.beginPath(); ctx.arc(fx, fy, 1.6, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "#586786"; ctx.beginPath(); ctx.arc(d.x, d.y, d.rr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#6b7a9a"; ctx.beginPath(); ctx.arc(d.x - d.rr * 0.3, d.y - d.rr * 0.3, d.rr * 0.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
};

/* names for the five island layouts (index = layout id) */
BB.MAP_NAMES = ["Twin Isles", "The Gap", "Staircase", "Twin Moons", "Sky Steps"];

/* rounded-rect helper shared by UI */
BB.roundRect = (ctx, x, y, w, h, r) => {
  r = Math.min(r, w / 2, h / 2);
  if (r < 0) r = 0;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};
