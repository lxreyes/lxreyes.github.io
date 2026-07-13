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
    this.forcedLayout = -1; // -1 = random each round; 0..N = a chosen map; >=MAP_NAMES.length = custom
    this.customMap = null;  // { platforms:[{x1,y1,x2,y2,r}], spawns, hazards } from the map editor
    this.hazards = [];      // spike balls that knock blobs away on contact
    this.waterY = h - 70;   // world y of the reflective water surface at the bottom
    this.leftBound = -20;   // world x of the left kill barrier
    this.rightBound = w + 20; // world x of the right kill barrier
    this.reset();
  }

  reset() {
    this.buildLayout();
  }

  buildLayout() {
    const w = this.w, h = this.h;
    this.platforms = [];
    this.hazards = [];
    // capsule: segment (x1,y1)-(x2,y2) + radius r. horizontal => flat top.
    const add = (x1, y1, x2, y2, r) =>
      this.platforms.push({ x1: x1 * w, y1: y1 * h, x2: x2 * w, y2: y2 * h, r, life: Infinity, pvx: BB.rand(-22, 22), pvy: BB.rand(-14, 14), mvx: 0, mvy: 0 });

    // every layout has a distinct LEFT and RIGHT ground island so both fighters
    // spawn on solid ground, spread apart (never perched on a tiny floating disc)
    // custom map from the editor (platforms stored in absolute coords)
    if (this.forcedLayout >= BB.MAP_NAMES.length && this.customMap && this.customMap.platforms.length) {
      this.platforms = this.customMap.platforms.map((p) => ({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, r: p.r, life: Infinity, pvx: BB.rand(-20, 20), pvy: BB.rand(-12, 12), mvx: 0, mvy: 0 }));
      if (this.customMap.spawns && this.customMap.spawns.length === 2) {
        this.spawns = this.customMap.spawns.map((s) => ({ x: s.x, y: s.y }));
      } else {
        const sorted = [...this.platforms].sort((a, b) => (a.x1 + a.x2) - (b.x1 + b.x2));
        const top = (p) => ({ x: (p.x1 + p.x2) / 2, y: Math.min(p.y1, p.y2) - p.r - 16 });
        this.spawns = [top(sorted[0]), top(sorted[sorted.length - 1])];
      }
      this.hazards = (this.customMap.hazards || []).map((h) => ({ x: h.x, y: h.y, r: h.r }));
      this._decorate(); this._buildBackdrop(); this._buildMirror();
      return;
    }

    const layout = this.forcedLayout >= 0 ? Math.min(this.forcedLayout, BB.MAP_NAMES.length - 1) : BB.randInt(0, BB.MAP_NAMES.length - 1);
    // big, chunky Bopl-style landmasses you walk right around
    if (layout === 0) {
      add(0.13, 0.64, 0.37, 0.64, 46);       // left landmass
      add(0.63, 0.64, 0.87, 0.64, 46);       // right landmass
      add(0.5, 0.40, 0.5, 0.40, 36);         // high middle island
    } else if (layout === 1) {
      add(0.06, 0.70, 0.42, 0.70, 44);       // wide ground, split by a center gap
      add(0.58, 0.70, 0.94, 0.70, 44);
    } else if (layout === 2) {
      add(0.08, 0.72, 0.32, 0.72, 40);       // staircase of three
      add(0.40, 0.54, 0.60, 0.54, 38);
      add(0.68, 0.72, 0.92, 0.72, 40);
    } else if (layout === 3) {
      add(0.24, 0.58, 0.24, 0.58, 62);       // two huge round islands
      add(0.76, 0.58, 0.76, 0.58, 62);
    } else if (layout === 4) {
      add(0.08, 0.66, 0.36, 0.66, 42);       // offset landmasses + high circle
      add(0.64, 0.54, 0.92, 0.54, 42);
      add(0.5, 0.36, 0.5, 0.36, 30);
    } else if (layout === 5) {
      add(0.20, 0.48, 0.20, 0.80, 30);       // three thick pillars
      add(0.50, 0.42, 0.50, 0.80, 30);
      add(0.80, 0.48, 0.80, 0.80, 30);
    } else if (layout === 6) {
      add(0.16, 0.76, 0.84, 0.76, 34);       // long fat bridge + high side isles
      add(0.07, 0.46, 0.27, 0.46, 36);
      add(0.73, 0.46, 0.93, 0.46, 36);
    } else if (layout === 7) {
      add(0.08, 0.60, 0.26, 0.60, 34);       // archipelago of chunky isles
      add(0.40, 0.72, 0.60, 0.72, 34);
      add(0.74, 0.60, 0.92, 0.60, 34);
    } else if (layout === 8) {
      add(0.28, 0.70, 0.72, 0.70, 54);       // one massive island + two side isles
      add(0.06, 0.52, 0.22, 0.52, 36);
      add(0.78, 0.52, 0.94, 0.52, 36);
    } else {
      add(0.08, 0.78, 0.30, 0.78, 34);       // ascending steps
      add(0.40, 0.60, 0.60, 0.60, 34);
      add(0.70, 0.44, 0.92, 0.44, 34);
    }

    // spawn resting ON the leftmost & rightmost islands (small blob radius clearance)
    const sorted = [...this.platforms].sort((a, b) => (a.x1 + a.x2) - (b.x1 + b.x2));
    const spawnTop = (p) => ({ x: (p.x1 + p.x2) / 2, y: Math.min(p.y1, p.y2) - p.r - 16 });
    this.spawns = [spawnTop(sorted[0]), spawnTop(sorted[sorted.length - 1])];

    this._decorate();
    this._buildBackdrop();
    this._buildMirror();
  }

  // the mirror world: islands + hazards reflected across the waterline. Fall
  // through the water and you play down here as your upside-down self.
  _buildMirror() {
    const wy = this.waterY;
    this.mirrorPlatforms = this.platforms.map((p) => ({ x1: p.x1, y1: 2 * wy - p.y1, x2: p.x2, y2: 2 * wy - p.y2, r: p.r, life: Infinity, mirror: true, mvx: 0, mvy: 0 }));
    this.mirrorHazards = this.hazards.map((h) => ({ x: h.x, y: 2 * wy - h.y, r: h.r }));
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
    // islands slowly DRIFT (Bopl-style movable platforms), bouncing off the side
    // bounds and staying between the sky and the water. Temp ledges just expire.
    const nIsl = this.mirrorPlatforms ? this.mirrorPlatforms.length : 0;
    for (let i = this.platforms.length - 1; i >= 0; i--) {
      const p = this.platforms[i];
      if (p.temp) {
        p.mvx = 0; p.mvy = 0;
        p.life -= dt;
        if (p.life <= 0) { BB.Particles.burst((p.x1 + p.x2) / 2, p.y1, "#4be0c0", 10, 120, { gravity: 400 }); this.platforms.splice(i, 1); }
        continue;
      }
      if (p.pvx === undefined) { p.mvx = 0; p.mvy = 0; continue; }
      const cx = (p.x1 + p.x2) / 2, cy = (p.y1 + p.y2) / 2;
      if ((cx <= this.leftBound + p.r + 40 && p.pvx < 0) || (cx >= this.rightBound - p.r - 40 && p.pvx > 0)) p.pvx *= -1;
      if ((cy <= this.h * 0.16 && p.pvy < 0) || (cy >= this.waterY - p.r - 30 && p.pvy > 0)) p.pvy *= -1;
      const ddx = p.pvx * dt, ddy = p.pvy * dt;
      p.x1 += ddx; p.x2 += ddx; p.y1 += ddy; p.y2 += ddy;
      p.mvx = ddx; p.mvy = ddy;
      if (p.decor) for (const d of p.decor) { d.x += ddx; d.y += ddy; }
      if (i < nIsl) { const m = this.mirrorPlatforms[i]; m.x1 += ddx; m.x2 += ddx; m.y1 -= ddy; m.y2 -= ddy; m.mvx = ddx; m.mvy = -ddy; } // keep the reflection in sync
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

  draw(ctx, time = 0) { this.drawIslands(ctx, time); this.drawHazards(ctx, time); }

  drawHazards(ctx, time, hazards) {
    for (const hz of (hazards || this.hazards)) {
      ctx.save(); ctx.translate(hz.x, hz.y); ctx.rotate(time * 0.7);
      ctx.fillStyle = "#ff4b5b";
      const N = 9;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * hz.r * 0.55, Math.sin(a) * hz.r * 0.55);
        ctx.lineTo(Math.cos(a + Math.PI / N) * hz.r, Math.sin(a + Math.PI / N) * hz.r);
        ctx.lineTo(Math.cos(a + 2 * Math.PI / N) * hz.r * 0.55, Math.sin(a + 2 * Math.PI / N) * hz.r * 0.55);
        ctx.fill();
      }
      ctx.fillStyle = "#8a1f2a"; ctx.beginPath(); ctx.arc(0, 0, hz.r * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ff9098"; ctx.beginPath(); ctx.arc(0, 0, hz.r * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // just the islands + decor (also re-used for the mirror-world terrain)
  drawIslands(ctx, time = 0, plats) {
    for (const p of (plats || this.platforms)) {
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

/* names for the island layouts (index = layout id) */
BB.MAP_NAMES = ["Twin Isles", "The Gap", "Staircase", "Twin Moons", "Sky Steps",
  "Pillars", "Bridge", "Archipelago", "Big Top", "Ascent"];

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
