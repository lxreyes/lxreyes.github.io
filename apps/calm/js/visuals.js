/*
 * visuals.js — a pixel-art engine with a pseudo-3D ground plane and a
 * first-person "walking" camera.
 *
 * Resolution is driven by a single scale factor S (base grid 128x72). Bumping S
 * gives more, finer pixels — sharper dithering and detail — without changing any
 * scene logic. Every pixel-measured constant is written as `n * S`.
 *
 * Surfaces are quantized to small hand-picked, hue-shifted PALETTES and blended
 * with ORDERED (Bayer) DITHERING for the crafted pixel-art look.
 *
 * The camera walks: a slow heading weave (cam.x, world units) + a footstep
 * head-bob that raises/lowers the whole horizon (hz) each step, so sky, ground
 * and everything anchored to the world bob together.
 */
(function () {
  "use strict";

  const S = 3;                 // resolution scale (1 = 128x72, 2 = 256x144, 3 = 384x216)
  const W = 128 * S, H = 72 * S;
  const HORIZON0 = 30 * S;     // resting horizon row
  const FOCAL = 40 * S;
  const CAM_H = 1;
  const NEAR_Z = (CAM_H * FOCAL) / (H - HORIZON0);

  const cam = { x: 0, f: 0 };  // x = lateral (path), f = how far we've walked
  const WALK = 1.25;           // forward walking speed (world units / sec) — a slow amble
  let hz = HORIZON0;           // current (bobbing) horizon row
  function updateCam(t) {
    cam.f = t * WALK;                  // walk forward through the world
    cam.x = Math.sin(t * 0.06) * 0.5;  // gentle wander, kept within the clear lane
    hz = HORIZON0;                     // steady horizon — no bouncing
  }
  function projY(z) { return hz + (CAM_H * FOCAL) / z; }
  function projX(wx, z) { return W / 2 + ((wx - cam.x) * FOCAL) / z; }

  function lerp(a, b, f) { return a + (b - a) * f; }
  function rnd() { return Math.random(); }

  // ---- ordered dither ----
  const BAYER = [
    [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
  ].map((r) => r.map((v) => (v + 0.5) / 16));
  function bayer(x, y) { return BAYER[y & 3][x & 3]; }
  function ramp(rmp, p, x, y) {
    const max = rmp.length - 1;
    if (p <= 0) return rmp[0];
    if (p >= max) return rmp[max];
    const i = p | 0;
    return (p - i) > bayer(x, y) ? rmp[i + 1] : rmp[i];
  }

  // ---- painting API ----
  let data = null;
  // aerial-perspective haze: while > 0, opaque pixels blend toward hazeC. Set per
  // prop from its distance so far things go soft and pale; cleared for sky/ground.
  let hazeB = 0, hazeC = null;
  function setHaze(z, col) { hazeB = col ? Math.min(0.82, Math.max(0, (z - NEAR_Z) / (FOCAL * 0.55)) * 0.85) : 0; hazeC = col; }
  const P = {
    w: W, h: H,
    set(x, y, r, g, b) {
      x |= 0; y |= 0;
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      if (hazeB > 0) { r += (hazeC[0] - r) * hazeB; g += (hazeC[1] - g) * hazeB; b += (hazeC[2] - b) * hazeB; }
      const i = (y * W + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    },
    put(x, y, c) { this.set(x, y, c[0], c[1], c[2]); },
    add(x, y, r, g, b, a) {
      x |= 0; y |= 0;
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      if (a <= 0) return; if (a > 1) a = 1;
      const i = (y * W + x) * 4;
      data[i]     = data[i]     * (1 - a) + r * a;
      data[i + 1] = data[i + 1] * (1 - a) + g * a;
      data[i + 2] = data[i + 2] * (1 - a) + b * a;
      data[i + 3] = 255;
    },
    glow(x, y, c, a) {
      x |= 0; y |= 0;
      if (a > bayer(x, y)) this.add(x, y, c[0], c[1], c[2], 0.5 + a * 0.5);
    },
    disc(cx, cy, r, c) {
      for (let y = -r; y <= r; y++)
        for (let x = -r; x <= r; x++)
          if (x * x + y * y <= r * r) this.set(cx + x, cy + y, c[0], c[1], c[2]);
    },
  };

  // =========================================================================
  //  PALETTES
  // =========================================================================
  const PAL = {
    rainSky:    [[16, 20, 32], [24, 30, 46], [34, 42, 60], [48, 58, 78], [66, 78, 100]],
    rainGround: [[16, 19, 27], [24, 29, 39], [34, 42, 56], [58, 70, 92], [92, 108, 132]],
    fireNight:  [[8, 9, 22], [12, 13, 28], [18, 18, 36], [28, 22, 40], [44, 30, 40], [64, 41, 37]],
    earth:      [[20, 16, 18], [32, 24, 22], [48, 34, 28], [72, 50, 36], [100, 70, 48]],
    oceanSky:   [[26, 42, 80], [40, 62, 100], [70, 98, 134], [126, 152, 176], [182, 200, 210]],
    oceanWater: [[8, 28, 56], [12, 40, 72], [20, 58, 92], [38, 84, 116], [96, 150, 176], [196, 224, 234]],
    daySky:     [[88, 138, 198], [116, 162, 210], [148, 186, 218], [184, 208, 226], [210, 224, 230]],
    grass:      [[26, 56, 38], [38, 78, 46], [54, 102, 54], [78, 128, 62], [112, 158, 82]],
    forestSky:  [[112, 162, 196], [140, 182, 206], [168, 200, 214], [192, 214, 216], [212, 226, 214]],
    forestFloor:[[28, 46, 30], [40, 60, 36], [52, 74, 42], [66, 88, 50], [86, 108, 62]],
    nightSky:   [[10, 11, 28], [16, 17, 38], [24, 24, 50], [36, 34, 66], [56, 52, 88]],
    nightGround:[[7, 9, 18], [11, 13, 24], [16, 18, 30], [24, 26, 40], [34, 36, 52]],
    stormSky:   [[20, 24, 36], [28, 32, 46], [38, 42, 56], [50, 54, 70], [66, 70, 86]],
    streamWater:[[18, 52, 78], [28, 72, 102], [46, 98, 128], [88, 144, 168], [150, 194, 210], [212, 234, 240]],
    duskSky:    [[44, 36, 76], [78, 54, 96], [122, 72, 100], [178, 104, 98], [224, 152, 122]],
    snowSky:    [[118, 130, 156], [140, 152, 176], [164, 176, 196], [188, 198, 214], [210, 218, 230]],
    snowGround: [[180, 192, 212], [198, 208, 224], [214, 224, 236], [230, 238, 246], [246, 249, 252]],
  };
  const FIRE_PAL = [
    [9, 8, 14], [31, 12, 10], [50, 16, 10], [70, 18, 9], [88, 22, 9],
    [105, 28, 9], [121, 30, 9], [144, 38, 9], [160, 46, 9], [176, 60, 9],
    [192, 70, 9], [200, 72, 9], [216, 80, 10], [222, 88, 11], [221, 92, 13],
    [214, 96, 14], [214, 100, 16], [214, 104, 22], [206, 112, 22], [206, 120, 24],
    [206, 128, 26], [206, 136, 34], [198, 136, 34], [198, 144, 36], [198, 152, 44],
    [190, 160, 46], [190, 162, 50], [190, 168, 58], [192, 172, 64], [196, 178, 80],
    [200, 184, 100], [206, 192, 120], [214, 200, 142], [224, 212, 168],
    [236, 226, 196], [246, 240, 224], [255, 255, 255],
  ];

  // =========================================================================
  //  SHARED HELPERS  (pixel params are logical 128x72 units; scaled by S inside)
  // =========================================================================
  function sky(rmp) {
    const max = rmp.length - 1;
    const bottom = hz + 3 * S; // a little extra so the bob never reveals a gap
    for (let y = 0; y <= bottom; y++) {
      const p = (Math.min(y, hz) / hz) * max;
      for (let x = 0; x < W; x++) P.put(x, y, ramp(rmp, p, x, y));
    }
  }

  function ground(rmp, levelFn, fogCol, fogMax) {
    fogMax = fogMax == null ? 0.85 : fogMax;
    for (let y = hz + 1; y < H; y++) {
      const z = (CAM_H * FOCAL) / (y - hz);
      const fog = Math.min(1, (z - NEAR_Z) / (FOCAL * 0.8)) * fogMax;
      for (let x = 0; x < W; x++) {
        const wx = cam.x + ((x - W / 2) * z) / FOCAL;
        // the texture is sampled at the ABSOLUTE forward coord (z + cam.f), so
        // the whole ground scrolls toward you as you walk.
        let c = ramp(rmp, levelFn(wx, z + cam.f, x, y), x, y);
        if (fogCol && fog > bayer(x + 1, y + 2)) c = fogCol;
        P.put(x, y, c);
      }
    }
  }

  function groundRing(wx, wz, r, col, alpha) {
    const steps = 30;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const pz = wz + Math.sin(a) * r;
      if (pz <= NEAR_Z) continue;
      P.add(projX(wx + Math.cos(a) * r, pz), projY(pz), col[0], col[1], col[2], alpha);
    }
  }

  // swaying blade clump (worldH is in WORLD units, so it auto-scales with FOCAL)
  function cloud(cx, cy, w, h) {
    for (let j = -h; j <= h; j++)
      for (let i = -w; i <= w; i++) {
        const e = (i * i) / (w * w) + (j * j) / (h * h);
        if (e > 1) continue;
        if ((1 - e) > bayer(cx + i, cy + j) * 0.85) {
          const top = j < -h * 0.15;
          P.add(cx + i, cy + j, top ? 250 : 214, top ? 252 : 222, top ? 255 : 234, 0.85);
        }
      }
  }

  function moon(cxL, cyL, rL) {
    const cx = cxL * S, cy = cyL * S, r = rL * S;
    for (let j = -r - 3 * S; j <= r + 3 * S; j++)
      for (let i = -r - 3 * S; i <= r + 3 * S; i++) {
        const d = i * i + j * j;
        if (d > r * r && d <= (r + 3 * S) * (r + 3 * S))
          P.glow(cx + i, cy + j, [206, 212, 236], 1 - (Math.sqrt(d) - r) / (3 * S));
      }
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        if (i * i + j * j > r * r) continue;
        const v = 222 - (i + j) / (r * 2) * 34;
        P.set(cx + i, cy + j, v - 4, v - 2, v + 6);
      }
    P.disc(cx - 2 * S, cy - S, S, [196, 200, 220]);
    P.disc(cx + 2 * S, cy + S, S, [196, 200, 220]);
  }

  // distant ridge on baseY; heightL/freqL/pfL are logical, scaled inside
  function ridge(baseY, heightL, col, freqL, phase, pfL) {
    const height = heightL * S, freq = freqL / S, pf = pfL * S;
    const sh = cam.x * pf;
    for (let x = 0; x < W; x++) {
      const u = x + sh;
      const h = baseY - (Math.abs(Math.sin(u * freq + phase)) * height * 0.6 +
                         Math.abs(Math.sin(u * freq * 0.43 + phase * 1.7)) * height * 0.4);
      for (let y = h | 0; y <= baseY; y++)
        P.put(x, y, y < h + 1.2 * S ? [col[0] + 14, col[1] + 14, col[2] + 18] : col);
    }
  }

  function mist(yc, halfL, col, alpha) {
    const half = halfL * S;
    for (let y = yc - half; y <= yc + half; y++) {
      if (y < 0 || y >= H) continue;
      const a = alpha * (1 - Math.abs(y - yc) / (half + 1));
      for (let x = 0; x < W; x++) if (a > bayer(x, y) * 0.9) P.add(x, y, col[0], col[1], col[2], 0.4 + a * 0.6);
    }
  }

  function flame(cx, baseY, hgt, halfBase, phase, t) {
    for (let yy = 0; yy < hgt; yy++) {
      const tn = yy / hgt;
      const halfW = halfBase * (1 - tn) * (0.7 + 0.3 * (1 - tn));
      if (halfW < 0.3) continue;
      const fx = cx + Math.sin(t * 6 + phase + yy * 0.4) * 1.4 * S * tn + Math.sin(t * 13 + phase + yy) * 0.7 * S * tn;
      for (let dx = -halfW; dx <= halfW; dx++) {
        const edge = Math.abs(dx) / halfW;
        let heat = (1 - tn) * 0.7 + (1 - edge) * 0.5 + Math.sin(t * 22 + yy * 2 + dx) * 0.06 - edge * edge * 0.45;
        let v = (heat * 36) | 0;
        if (v < 3) continue; if (v > 36) v = 36;
        P.put(fx + dx, baseY - yy, FIRE_PAL[v]);
      }
    }
  }

  // ----- streaming world props (they stream toward you as you walk) -----
  // each prop has an ABSOLUTE forward position wf; its depth is wf - cam.f.
  // lateral position for a streamed prop. With corridor > 0 the prop is kept
  // OUTSIDE a clear central lane (|wl| >= corridor, to one side), so the walker
  // never collides with it — you pass between obstacles. corridor 0 = anywhere.
  function streamLat(spreadF, atZ, corridor) {
    if (corridor > 0) return (rnd() < 0.5 ? -1 : 1) * (corridor + rnd() * spreadF * atZ);
    return cam.x + (rnd() * 2 - 1) * spreadF * atZ;
  }
  function streamInit(count, minZ, maxZ, spreadF, corridor) {
    corridor = corridor || 0;
    const arr = [];
    for (let i = 0; i < count; i++) {
      const z = minZ + ((i + rnd()) / count) * (maxZ - minZ);
      arr.push({ wf: z, wl: streamLat(spreadF, z, corridor), seed: rnd() * 6.28, sc: 0.75 + rnd() * 0.6 });
    }
    arr.corridor = corridor;
    return arr;
  }
  function streamRecycle(arr, maxZ, spreadF) {
    for (const p of arr)
      if (p.wf - cam.f < NEAR_Z + 0.3) { // walked past it -> respawn far ahead
        p.wf = cam.f + maxZ; p.wl = streamLat(spreadF, maxZ, arr.corridor || 0);
        p.seed = rnd() * 6.28; p.sc = 0.75 + rnd() * 0.6;
      }
  }
  function streamStep(arr, maxZ, spreadF) {
    streamRecycle(arr, maxZ, spreadF);
    arr.sort((a, b) => b.wf - a.wf); // draw far -> near
  }
  // recycle several prop pools and draw them interleaved by depth (far -> near).
  // pools: [{ arr, maxZ, spread, fn(sx, sy, z, p, t) }]. hazeCol fades distant
  // props toward the horizon for aerial perspective.
  function drawMerged(t, pools, hazeCol) {
    const items = [];
    for (const pool of pools) {
      streamRecycle(pool.arr, pool.maxZ, pool.spread);
      for (const p of pool.arr) { const z = p.wf - cam.f; if (z > NEAR_Z) items.push({ z, p, fn: pool.fn }); }
    }
    items.sort((a, b) => b.z - a.z);
    for (const it of items) {
      setHaze(it.z, hazeCol);
      it.fn(projX(it.p.wl, it.z), projY(it.z), it.z, it.p, t);
    }
    setHaze(0, null);
  }

  function drawPine(sx, sy, hgt, dark, lit) {
    if (hgt < 2) { P.put(sx, sy, dark); return; }
    const trunkH = Math.max(1, hgt * 0.16);
    for (let k = 0; k < trunkH; k++) { P.put(sx, sy - k, [38, 26, 18]); }
    const w0 = hgt * 0.34;
    for (let yy = trunkH; yy < hgt; yy++) {
      const w = w0 * (1 - (yy - trunkH) / (hgt - trunkH));
      for (let dx = -w; dx <= w; dx++) P.put(sx + dx, sy - yy, dx < -w * 0.25 ? lit : dark);
    }
  }

  function drawTuftP(p, t, lit, dark, worldH, blades) {
    const z = p.wf - cam.f;
    if (z <= NEAR_Z) return;
    const sx = projX(p.wl, z), sy = projY(z), h = (worldH * FOCAL) / z;
    if (h < 1) { P.put(sx, sy, dark); return; }
    const sway = Math.sin(t * 1.1 + p.seed) * Math.min(5 * S, h * 0.4);
    const n = blades || 3;
    for (let b = 0; b < n; b++) {
      const bx = b - (n - 1) / 2, col = b < n / 2 ? dark : lit;
      for (let k = 0; k <= h; k++) { const f = k / h; P.put(sx + bx * (1 - f * 0.4) + sway * f * f, sy - k, col); }
    }
  }

  // a depth-scaled campfire you walk up to and past
  function drawCampfireAt(sx, sy, z, t, seed) {
    const k = FOCAL / z; // pixels per world unit at this depth
    const fl = 0.8 + Math.sin(t * 7 + seed) * 0.15;
    const gr = Math.max(2, 2.4 * k);
    for (let dy = -gr * 0.5; dy <= gr * 0.5; dy++)
      for (let dx = -gr; dx <= gr; dx++) {
        const d = Math.hypot(dx / gr, dy / (gr * 0.5));
        if (d < 1) P.glow(sx + dx, sy + dy, [255, 128, 46], (1 - d) * 0.6 * fl);
      }
    const lw = Math.max(1, (0.55 * k) | 0);
    for (let dx = -lw; dx <= lw; dx++) P.set(sx + dx, sy, 60, 40, 28);
    const fh = Math.max(2, (0.95 * k) | 0), fw = Math.max(1, 0.5 * k);
    for (let yy = 0; yy < fh; yy++) {
      const tn = yy / fh, hw = fw * (1 - tn);
      if (hw < 0.3) continue;
      const fx = sx + Math.sin(t * 6 + seed + yy * 0.5) * 0.12 * k * tn;
      for (let dx = -hw; dx <= hw; dx++) {
        const edge = Math.abs(dx) / hw;
        let v = (((1 - tn) * 0.7 + (1 - edge) * 0.5 - edge * edge * 0.4) * 36) | 0;
        if (v < 4) continue; if (v > 36) v = 36;
        P.put(fx + dx, sy - 1 - yy, FIRE_PAL[v]);
      }
    }
    P.add(sx, sy - 1, 255, 240, 210, 0.6 * fl);
  }

  // a roadside lamp post with a warm glow and a wet reflection below it
  function drawLamp(sx, sy, z) {
    const k = FOCAL / z;
    const ph = Math.max(4, Math.min(((0.85 * H) | 0), (2.6 * k) | 0));
    for (let yy = 0; yy < ph; yy++) for (let q = 0; q < S; q++) P.put(sx + q - (S >> 1), sy - yy, [44, 44, 54]);
    const ly = sy - ph, r = Math.max(1, (0.5 * k) | 0);
    P.disc(sx, ly, r, [255, 224, 150]);
    const gr = Math.max(2, 1.7 * k);
    for (let dy = -gr; dy <= gr; dy++) for (let dx = -gr; dx <= gr; dx++) {
      const d = Math.hypot(dx, dy) / gr; if (d < 1) P.glow(sx + dx, ly + dy, [255, 200, 120], (1 - d) * 0.55);
    }
    for (let yy = 1; yy < ph * 0.7; yy++) P.add(sx, sy + yy, 255, 200, 120, 0.22 * (1 - yy / (ph * 0.7)));
  }

  // a wet rock poking out of the sea, with a faint reflection
  function drawSeaRock(sx, sy, z) {
    const r = Math.max(1, (0.5 * FOCAL / z) | 0);
    for (let dy = 0; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy * 1.5 <= r * r) P.put(sx + dx, sy - dy, dx < 0 ? [44, 50, 60] : [26, 30, 40]);
    for (let dy = 1; dy <= r; dy++) P.add(sx, sy + dy, 60, 70, 84, 0.2 * (1 - dy / r));
  }

  // a snow-laden pine
  function drawSnowPine(sx, sy, hgt) {
    if (hgt < 2) { P.put(sx, sy, [210, 218, 230]); return; }
    const trunkH = Math.max(1, hgt * 0.16);
    for (let k = 0; k < trunkH; k++) P.put(sx, sy - k, [48, 38, 30]);
    const w0 = hgt * 0.34;
    for (let yy = trunkH; yy < hgt; yy++) {
      const w = w0 * (1 - (yy - trunkH) / (hgt - trunkH));
      for (let dx = -w; dx <= w; dx++) {
        const snow = dx < -w * 0.15 || (Math.sin(yy * 1.9 + dx * 0.7) > 0.55 && dx < w * 0.2);
        P.put(sx + dx, sy - yy, snow ? [214, 224, 236] : [34, 60, 48]);
      }
    }
  }

  // a garden post with a little hanging wind-chime that sways
  function drawChimePost(sx, sy, z, t, seed) {
    const k = FOCAL / z;
    const ph = Math.max(5, Math.min(((0.8 * H) | 0), (2.4 * k) | 0));
    for (let yy = 0; yy < ph; yy++) for (let q = 0; q < S; q++) P.put(sx + q - (S >> 1), sy - yy, [72, 54, 46]);
    const topY = sy - ph, barW = Math.max(2, (1.1 * k) | 0);
    for (let dx = -barW; dx <= barW; dx++) P.put(sx + dx, topY, [88, 66, 54]);
    const tlen = Math.max(2, (2.8 * k) | 0);
    for (let i = 0; i < 4; i++) {
      const tx = sx - barW + (i / 3) * 2 * barW;
      const sway = Math.sin(t * 1.3 + seed + i) * 0.25 * k;
      for (let kk = 0; kk < tlen; kk++) P.put(tx + sway * (kk / tlen), topY + 1 + kk, [198, 202, 216]);
    }
    P.add(sx, topY - 1, 255, 210, 150, 0.3);
  }

  // ---------- detailed background ridges ----------
  // a ridge crowned with a band of tiny tree silhouettes
  function ridgeForest(baseY, heightL, col, treeCol, freqL, phase, pfL) {
    ridge(baseY, heightL, col, freqL, phase, pfL);
    const height = heightL * S, freq = freqL / S, sh = cam.x * pfL * S;
    for (let x = 0; x < W; x += 2 * S) {
      const u = x + sh;
      const h = baseY - (Math.abs(Math.sin(u * freq + phase)) * height * 0.6 + Math.abs(Math.sin(u * freq * 0.43 + phase * 1.7)) * height * 0.4);
      if ((((x / S) | 0) * 7 % 5) < 2) for (let yy = 0; yy < 3 * S; yy++) { const w = (1 - yy / (3 * S)) * 1.3 * S; for (let dx = -w; dx <= w; dx++) P.put(x + dx, (h | 0) - yy, treeCol); }
    }
  }
  // a distant city skyline of blocky buildings with a few lit windows
  function ridgeCity(baseY, maxHL, pfL) {
    const sh = cam.x * pfL * S;
    let x = 0;
    while (x < W) {
      const seed = Math.sin((x + sh) * 0.13) * 0.5 + 0.5;
      const bw = ((6 + seed * 10) * S) | 0;
      const bh = ((8 + Math.abs(Math.sin((x + sh) * 0.21 + 1)) * maxHL) * S) | 0;
      const top = baseY - bh, col = [16 + seed * 12, 18 + seed * 12, 28 + seed * 14];
      for (let yy = top; yy <= baseY; yy++) for (let dx = 0; dx < bw; dx++) P.put(x + dx, yy, col);
      for (let wy = top + 2 * S; wy < baseY - S; wy += 3 * S)
        for (let wx = x + S; wx < x + bw - S; wx += 3 * S)
          if (((wx * 7 + wy) % 5) < 2) for (let q = 0; q < S; q++) P.set(wx + q, wy, 255, 208, 120);
      x += bw + S;
    }
  }

  // ---------- streaming prop drawers (sx, sy = base on the ground) ----------
  function drawBush(sx, sy, z, dark, lit) {
    const r = Math.max(1, (0.7 * FOCAL / z) | 0);
    for (let dy = 0; dy <= r * 1.3; dy++) for (let dx = -r; dx <= r; dx++)
      if (dx * dx + (dy * 1.3) * (dy * 1.3) <= r * r) P.put(sx + dx, sy - dy, (dx < -r * 0.2 && dy > r * 0.3) ? lit : dark);
  }
  function drawBoulder(sx, sy, z) {
    const r = Math.max(1, (0.95 * FOCAL / z) | 0);
    for (let dy = 0; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy * 1.7 <= r * r) P.put(sx + dx, sy - dy, dx < -r * 0.25 ? [92, 90, 98] : [56, 54, 64]);
    for (let dx = -r; dx <= r; dx++) P.add(sx + dx, sy + 1, 0, 0, 0, 0.2);
  }
  function drawFlower(sx, sy, z, col) {
    const h = Math.max(2, (0.55 * FOCAL / z) | 0);
    for (let k = 0; k < h; k++) P.put(sx, sy - k, [54, 92, 54]);
    P.put(sx, sy - h - 1, col); P.put(sx - 1, sy - h, col); P.put(sx + 1, sy - h, col); P.put(sx, sy - h + 1, col);
    P.put(sx, sy - h, [252, 232, 130]);
  }
  function drawBirch(sx, sy, hgt) {
    if (hgt < 2) { P.put(sx, sy, [60, 96, 64]); return; }
    const trunkH = hgt * 0.55;
    for (let k = 0; k < trunkH; k++) { P.put(sx, sy - k, [218, 222, 224]); if ((k % (3 * S)) < S) P.put(sx, sy - k, [40, 44, 48]); }
    const r = hgt * 0.3;
    for (let dy = 0; dy <= r * 1.6; dy++) for (let dx = -r; dx <= r; dx++)
      if (dx * dx + (dy - r) * (dy - r) <= r * r) P.put(sx + dx, sy - trunkH - dy + r, dx < -r * 0.3 ? [96, 150, 86] : [56, 110, 62]);
  }
  function drawDeadTree(sx, sy, hgt, col) {
    if (hgt < 2) { P.put(sx, sy, col); return; }
    for (let k = 0; k < hgt; k++) P.put(sx, sy - k, col);
    const branches = 3 + ((hgt | 0) % 3);
    for (let b = 0; b < branches; b++) {
      const by = sy - hgt * (0.45 + b * 0.16), dir = b & 1 ? 1 : -1, bl = hgt * (0.22 + 0.12 * (b % 2));
      for (let k = 0; k < bl; k++) P.put(sx + dir * k, by - k * 0.7, col);
    }
  }
  function drawReeds(sx, sy, z, t, seed) {
    const h = Math.max(2, (0.9 * FOCAL / z) | 0);
    for (let i = -1; i <= 1; i++) {
      const sway = Math.sin(t * 1.4 + seed + i) * 0.5 * S;
      for (let k = 0; k <= h; k++) P.put(sx + i * S + sway * (k / h), sy - k, [70, 92, 56]);
      P.put(sx + i * S + sway, sy - h - 1, [86, 64, 40]); // seed head
    }
  }

  // ---------- landmark drawers ----------
  function drawCabin(sx, sy, z, warm) {
    if (z < 5) return; // a building, kept at a distance so it never fills the view
    const k = FOCAL / z;
    const w = Math.max(3, (1.7 * k) | 0), hWall = Math.max(3, (1.5 * k) | 0), hRoof = Math.max(2, (1.2 * k) | 0);
    for (let yy = 0; yy < hWall; yy++) for (let dx = -w; dx <= w; dx++) P.put(sx + dx, sy - yy, dx < -w * 0.3 ? [66, 48, 36] : [52, 38, 28]);
    for (let dx = -w - S; dx <= w + S; dx++) { const top = hWall + Math.round(hRoof * (1 - Math.abs(dx) / (w + S))); for (let yy = hWall; yy <= top; yy++) P.put(sx + dx, sy - yy, [44, 36, 42]); }
    const wx0 = sx + ((w * 0.35) | 0), wy0 = sy - ((hWall * 0.5) | 0), ws = Math.max(1, (0.4 * k) | 0);
    for (let dy = -ws; dy <= ws; dy++) for (let dx = -ws; dx <= ws; dx++) P.add(wx0 + dx, wy0 + dy, 255, 205, 120, 0.9);
    if (warm) for (let r = ws; r < ws * 3; r++) for (let a = 0; a < 6.28; a += 0.4) P.glow(wx0 + Math.cos(a) * r, wy0 + Math.sin(a) * r, [255, 200, 120], 0.4 - (r - ws) * 0.12);
  }
  function drawTower(sx, sy, z) {
    if (z < 6) return;
    const k = FOCAL / z;
    const w = Math.max(2, (1.0 * k) | 0), h = Math.max(5, (5.0 * k) | 0);
    for (let yy = 0; yy < h; yy++) for (let dx = -w; dx <= w; dx++) P.put(sx + dx, sy - yy, dx < -w * 0.3 ? [86, 82, 88] : [58, 54, 62]);
    for (let dx = -w - 1; dx <= w + 1; dx++) { P.put(sx + dx, sy - h, [70, 66, 74]); if (((dx + 99) & 1) === 0) P.put(sx + dx, sy - h - 1, [70, 66, 74]); } // crenellations
    for (let wy = sy - h + 2 * S; wy < sy - 2 * S; wy += 3 * S) P.add(sx, wy, 20, 24, 34, 0.8); // slit windows
  }
  function drawLighthouse(sx, sy, z, t) {
    if (z < 6) return;
    const k = FOCAL / z;
    const w = Math.max(2, (1.0 * k) | 0), h = Math.max(6, (5.5 * k) | 0);
    for (let yy = 0; yy < h; yy++) { const ww = w * (1 - 0.3 * yy / h); for (let dx = -ww; dx <= ww; dx++) P.put(sx + dx, sy - yy, ((((sy - yy) / (2 * S)) | 0) & 1) ? [230, 230, 236] : [200, 70, 64]); }
    const ly = sy - h - S;
    P.disc(sx, ly, Math.max(1, (0.7 * k) | 0), [255, 240, 180]);
    const beam = 0.4 + 0.6 * (Math.sin(t * 1.5) * 0.5 + 0.5);
    for (let r = 1; r < 5 * k; r++) for (let a = -0.3; a < 0.3; a += 0.1) P.glow(sx + Math.cos(a) * r * 4, ly + Math.sin(a) * r, [255, 240, 180], beam * (1 - r / (5 * k)) * 0.5);
  }
  function drawWindmill(sx, sy, z, t) {
    if (z < 7) return;
    const k = FOCAL / z;
    const w = Math.max(2, (1.2 * k) | 0), h = Math.max(5, (4.0 * k) | 0);
    for (let yy = 0; yy < h; yy++) { const ww = w * (1 - 0.35 * yy / h); for (let dx = -ww; dx <= ww; dx++) P.put(sx + dx, sy - yy, dx < -ww * 0.3 ? [150, 138, 120] : [120, 108, 92]); }
    const hy = sy - h, ang = t * 1.1;
    for (let b = 0; b < 4; b++) {
      const a = ang + b * 1.5708, bl = h * 1.1;
      for (let r = 0; r < bl; r++) P.put(sx + Math.cos(a) * r, hy + Math.sin(a) * r, [60, 50, 44]);
    }
  }
  function drawBridge(sx, sy, z) {
    const k = FOCAL / z, span = Math.max(4, (3.0 * k) | 0), rise = Math.max(2, (1.2 * k) | 0);
    for (let dx = -span; dx <= span; dx++) {
      const arch = rise * (1 - (dx / span) * (dx / span));
      for (let yy = 0; yy < S * 2; yy++) P.put(sx + dx, sy - arch - yy, [96, 70, 48]);
      P.put(sx + dx, sy - arch - S * 2, [120, 92, 64]); // rail
    }
  }

  // ---------- small detail props ----------
  function drawStump(sx, sy, z) {
    const k = FOCAL / z, w = Math.max(1, (0.45 * k) | 0), h = Math.max(1, (0.45 * k) | 0);
    for (let yy = 0; yy < h; yy++) for (let dx = -w; dx <= w; dx++) P.put(sx + dx, sy - yy, dx < -w * 0.3 ? [98, 72, 48] : [70, 50, 32]);
    for (let dx = -w; dx <= w; dx++) P.put(sx + dx, sy - h, [122, 94, 62]);
    P.put(sx, sy - h, [150, 120, 84]);
  }
  function drawFallenLog(sx, sy, z) {
    const k = FOCAL / z, len = Math.max(2, (1.4 * k) | 0), r = Math.max(1, (0.35 * k) | 0);
    for (let dx = -len; dx <= len; dx++) for (let dy = 0; dy <= r; dy++) P.put(sx + dx, sy - dy, dy < r * 0.4 ? [112, 84, 56] : [78, 56, 36]);
    P.put(sx - len, sy - r, [140, 110, 74]); P.put(sx + len, sy - r, [140, 110, 74]);
  }
  function drawMushroom(sx, sy, z) {
    const k = FOCAL / z, r = Math.max(1, (0.2 * k) | 0), st = Math.max(1, (0.22 * k) | 0);
    for (let yy = 0; yy < st; yy++) P.put(sx, sy - yy, [232, 226, 212]);
    for (let dx = -r; dx <= r; dx++) for (let dy = 0; dy <= r * 0.8; dy++) if (dx * dx + (dy * 1.4) * (dy * 1.4) <= r * r) P.put(sx + dx, sy - st - dy, [198, 58, 50]);
    P.put(sx - 1, sy - st - 1, [244, 244, 244]); P.put(sx + 1, sy - st, [244, 244, 244]);
  }
  function drawFence(sx, sy, z) {
    const k = FOCAL / z, ph = Math.max(2, (0.75 * k) | 0), span = Math.max(2, (1.0 * k) | 0);
    for (let yy = 0; yy < ph; yy++) { P.put(sx - span, sy - yy, [92, 70, 48]); P.put(sx + span, sy - yy, [92, 70, 48]); }
    for (let dx = -span; dx <= span; dx++) { P.put(sx + dx, sy - (ph * 0.4 | 0), [112, 86, 58]); P.put(sx + dx, sy - (ph * 0.8 | 0), [112, 86, 58]); }
  }
  function drawDeer(sx, sy, z) {
    const k = FOCAL / z; if (k < 2) { P.put(sx, sy, [54, 42, 34]); return; }
    const col = [54, 42, 34], bl = Math.max(3, (1.0 * k) | 0), bh = Math.max(2, (0.42 * k) | 0), lh = Math.max(2, (0.5 * k) | 0);
    for (let dx = -bl; dx <= bl; dx++) for (let dy = 0; dy < bh; dy++) P.put(sx + dx, sy - lh - dy, col);
    for (const lx of [sx - bl, sx - bl + S, sx + bl - S, sx + bl]) for (let yy = 0; yy < lh; yy++) P.put(lx, sy - yy, col);
    const nx = sx + bl;
    for (let yy = 0; yy < bh * 1.6; yy++) P.put(nx, sy - lh - bh - yy + (bh * 0.3 | 0), col); // neck
    const hy = sy - lh - bh - (bh * 1.3 | 0);
    P.put(nx, hy, col); P.put(nx + 1, hy, col);
    P.put(nx, hy - S, col); P.put(nx - S, hy - 2 * S, col); P.put(nx + S, hy - 2 * S, col); // antlers
  }
  function drawSailboat(sx, sy, z, t, seed) {
    const k = FOCAL / z, hw = Math.max(2, (0.7 * k) | 0), hh = Math.max(1, (0.3 * k) | 0), mast = Math.max(3, (1.9 * k) | 0);
    const bob = Math.sin(t * 0.9 + seed) * 0.4 * S;
    for (let dy = 0; dy < hh; dy++) { const w = hw * (1 - (dy / hh) * 0.45); for (let dx = -w; dx <= w; dx++) P.put(sx + dx, sy - dy - bob, [48, 40, 38]); }
    for (let yy = 0; yy < mast; yy++) P.put(sx, sy - hh - yy - bob, [62, 52, 46]);
    for (let yy = 0; yy < mast; yy++) { const w = (mast - yy) * 0.5; for (let dx = 1; dx <= w; dx++) P.put(sx + dx, sy - hh - yy - bob, [236, 234, 228]); }
    for (let dy = 1; dy <= hh + 2; dy++) P.add(sx, sy + dy - bob, 230, 230, 224, 0.12);
  }
  function drawSnowman(sx, sy, z) {
    const k = FOCAL / z, r = Math.max(1, (0.4 * k) | 0);
    P.disc(sx, sy - r, r, [240, 246, 252]);
    const my = sy - 2 * r - (r * 0.5 | 0), mr = Math.max(1, (r * 0.75) | 0);
    P.disc(sx, my, mr, [240, 246, 252]);
    const hy = my - mr - (r * 0.4 | 0), hr = Math.max(1, (r * 0.5) | 0);
    P.disc(sx, hy, hr, [240, 246, 252]);
    P.put(sx - 1, hy, [40, 40, 44]); P.put(sx + 1, hy, [40, 40, 44]); P.put(sx, hy + 1, [228, 120, 40]);
    for (let dx = -hr; dx <= hr; dx++) P.put(sx + dx, hy - hr, [40, 40, 44]); // hat brim
  }

  // =========================================================================
  //  SCENES
  // =========================================================================
  const Scenes = {};

  // ---- walking a wet street in the rain, past lamp posts ----
  Scenes.rain = {
    drops: [], ripples: [], rt: 0, lamps: null,
    reset() {
      this.drops = [];
      for (let i = 0; i < 360; i++) {
        const d = rnd();
        this.drops.push({ x: rnd() * W, y: rnd() * H, depth: d, sp: (55 + d * 130) * S, slant: -(7 + d * 12) * S });
      }
      this.ripples = []; this.rt = 0;
      this.lamps = streamInit(8, NEAR_Z + 2, 30, 1.0, 1.7);
      this.trees = streamInit(26, NEAR_Z + 1.5, 26, 1.4, 1.6);
    },
    draw(P, t, dt) {
      if (!this.lamps) this.reset();
      sky(PAL.rainSky);
      // a distant rain-soaked city skyline, two depths
      ridgeCity(hz, 16, 0.8);
      ridgeCity(hz - 2 * S, 10, 1.6);
      ground(PAL.rainGround, (wx, zt) => {
        const pud = Math.sin(wx * 1.1 + Math.sin(zt * 0.6) * 2) * Math.sin(zt * 0.8 - 1.2);
        let p = 0.4 + Math.sin(wx * 0.8 + zt * 0.6 - t * 1.6) * 0.3;
        if (pud > 0.25) p = 2.6 + (pud - 0.25) * 2.5;
        return p;
      }, PAL.rainSky[4], 0.8);
      // wet roadside trees + lamp posts, interleaved by depth
      drawMerged(t, [
        { arr: this.trees, maxZ: 26, spread: 1.4, fn: (sx, sy, z, p) => drawPine(sx, sy, (3.6 * p.sc * FOCAL) / z, [18, 26, 30], [26, 36, 40]) },
        { arr: this.lamps, maxZ: 30, spread: 1.0, fn: (sx, sy, z) => drawLamp(sx, sy, z) },
      ], PAL.rainSky[4]);
      this.rt -= dt;
      if (this.rt <= 0) { this.rt = 0.03 + rnd() * 0.05; this.ripples.push({ wx: (rnd() * 2 - 1) * 22, wz: NEAR_Z + 0.5 + rnd() * 20, r: 0, life: 1 }); }
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const rp = this.ripples[i]; rp.r += dt * 2.2; rp.life -= dt * 0.9;
        if (rp.life <= 0) { this.ripples.splice(i, 1); continue; }
        groundRing(rp.wx, rp.wz, rp.r, [150, 180, 212], rp.life * 0.5);
      }
      for (const d of this.drops) {
        d.y += d.sp * dt; d.x += d.slant * dt;
        if (d.y > H) { d.y = -4; d.x = rnd() * W; }
        const len = (2 + d.depth * 4) * S | 0;
        for (let k = 0; k < len; k++) P.add(d.x - d.slant * 0.02 * k, d.y - k, 168, 192, 224, (0.4 + d.depth * 0.6) * 0.6 - k * 0.06 / S);
      }
    },
  };

  // ---- walking a forest trail at night, past campfires ----
  Scenes.fire = {
    stars: [], shoot: null, shootT: 0, trees: null, fires: null, flies: null,
    reset() {
      this.stars = [];
      for (let i = 0; i < 150; i++) {
        const big = rnd() < 0.12;
        this.stars.push({ x: rnd() * W * 1.4, y: rnd() * (HORIZON0 - 4 * S), p: rnd() * 6.28, sp: 0.6 + rnd() * 1.8, big });
      }
      this.shoot = null; this.shootT = 3 + rnd() * 6;
      this.trees = streamInit(64, NEAR_Z + 1, 26, 1.4, 1.6);
      this.fires = streamInit(3, NEAR_Z + 4, 30, 0.45, 1.6);
      this.bushes = streamInit(28, NEAR_Z + 0.6, 22, 1.35, 1.5);
      this.rocks = streamInit(16, NEAR_Z + 0.6, 22, 1.3, 1.5);
      this.logs = streamInit(8, NEAR_Z + 0.8, 22, 1.4, 1.4);
      this.stumps = streamInit(8, NEAR_Z + 0.8, 22, 1.4, 1.4);
      this.cabins = streamInit(1, NEAR_Z + 10, 36, 0.5, 3.0);
      this.flies = streamInit(16, NEAR_Z + 0.5, 16, 1.1);
    },
    draw(P, t, dt) {
      if (!this.trees) this.reset();
      const cx = cam.x;
      sky(PAL.fireNight);
      // Milky Way
      for (let x = 0; x < W; x++) {
        const yc = 4 * S + x * (0.14 / S);
        for (let y = (yc - 4 * S) | 0; y <= yc + 4 * S; y++) {
          if (y < 0 || y > hz) continue;
          if (0.22 * (1 - Math.abs(y - yc) / (5 * S)) > bayer(x, y)) P.add(x, y, 150, 152, 196, 0.18);
        }
      }
      for (const s of this.stars) {
        const sx = (((s.x - cx * 1.2 * S) % (W * 1.4)) + W * 1.4) % (W * 1.4);
        if (sx >= W) continue;
        const b = Math.sin(t * s.sp + s.p) * 0.5 + 0.5;
        const a = (s.big ? 0.5 + 0.5 * b : 0.18 + 0.5 * b) * (1 - s.y / hz * 0.5);
        P.add(sx, s.y, 232, 232, 252, a);
        if (s.big && b > 0.6) { P.add(sx + 1, s.y, 232, 232, 252, a * 0.5); P.add(sx, s.y + 1, 232, 232, 252, a * 0.5); }
      }
      this.shootT -= dt;
      if (this.shootT <= 0 && !this.shoot) { this.shootT = 5 + rnd() * 9; this.shoot = { x: rnd() * W * 0.6 + 20 * S, y: (3 + rnd() * 10) * S, life: 1 }; }
      if (this.shoot) {
        const sh = this.shoot; sh.x += 70 * S * dt; sh.y += 26 * S * dt; sh.life -= dt * 1.4;
        if (sh.life <= 0) this.shoot = null;
        else for (let k = 0; k < 6 * S; k++) P.add(sh.x - k * 1.6, sh.y - k * 0.6, 235, 238, 255, sh.life * (0.9 - k * 0.16 / S));
      }
      moon(99, 12, 4);
      mist(hz - 9 * S, 4, [40, 42, 66], 0.5);
      ridge(hz, 15, [30, 32, 54], 0.038, 0.4, 1.0);
      ridgeForest(hz, 11, [16, 18, 36], [9, 11, 24], 0.07, 2.1, 1.9);

      // forest floor with a moonlit dirt trail running away from you
      ground(PAL.nightGround, (wx, zt) => {
        const path = Math.abs(wx) < 0.5 ? 1.6 : (Math.abs(wx) < 0.75 ? 0.7 : 0);
        return 1.2 + Math.sin(wx * 3 + zt * 2) * 0.7 + path;
      }, PAL.nightSky[3], 0.5);

      // trees, campfires, a cabin, rocks and bushes, interleaved by depth
      drawMerged(t, [
        { arr: this.cabins, maxZ: 36, spread: 0.5, fn: (sx, sy, z) => drawCabin(sx, sy, z, true) },
        { arr: this.fires, maxZ: 30, spread: 0.45, fn: (sx, sy, z, p) => drawCampfireAt(sx, sy, z, t, p.seed) },
        { arr: this.trees, maxZ: 26, spread: 1.4, fn: (sx, sy, z, p) => drawPine(sx, sy, (3.6 * p.sc * FOCAL) / z, [11, 17, 15], [20, 30, 24]) },
        { arr: this.bushes, maxZ: 22, spread: 1.35, fn: (sx, sy, z) => drawBush(sx, sy, z, [10, 16, 16], [18, 28, 24]) },
        { arr: this.logs, maxZ: 22, spread: 1.4, fn: (sx, sy, z) => drawFallenLog(sx, sy, z) },
        { arr: this.stumps, maxZ: 22, spread: 1.4, fn: (sx, sy, z) => drawStump(sx, sy, z) },
        { arr: this.rocks, maxZ: 22, spread: 1.3, fn: (sx, sy, z) => drawBoulder(sx, sy, z) },
      ], PAL.nightSky[2]);
      // fireflies drifting over the trail
      streamStep(this.flies, 16, 1.1);
      for (const f of this.flies) {
        const z = f.wf - cam.f; if (z <= NEAR_Z) continue;
        const lift = (0.25 + 0.12 * Math.sin(t * 1.3 + f.seed)) * FOCAL / z;
        const glow = Math.sin(t * 2 + f.seed) * 0.5 + 0.5;
        P.add(projX(f.wl, z), projY(z) - lift, 190, 230, 120, glow * 0.9);
      }
    },
  };

  // ---- drifting across the sea, past rocks, buoys and a lighthouse ----
  Scenes.ocean = {
    rocks: null, buoys: null, houses: null,
    reset() {
      this.rocks = streamInit(11, NEAR_Z + 2, 30, 1.2, 1.5);
      this.buoys = streamInit(6, NEAR_Z + 2, 28, 1.2, 1.4);
      this.boats = streamInit(2, NEAR_Z + 6, 30, 1.0, 2.0);
      this.houses = streamInit(1, NEAR_Z + 9, 34, 0.7, 3.0);
    },
    draw(P, t) {
      if (!this.rocks) this.reset();
      sky(PAL.oceanSky);
      moon(96, 9, 4);
      // distant headland / islands on the horizon
      ridge(hz, 7, [54, 70, 92], 0.05, 0.6, 0.7);
      ridge(hz, 4, [40, 54, 74], 0.10, 2.3, 1.3);
      ground(PAL.oceanWater, (wx, zt) => {
        const wave = Math.sin(zt * 1.0 - t * 1.3 + wx * 0.15) + 0.5 * Math.sin(zt * 2.1 - t * 0.8 + wx * 0.4);
        if (wave > 1.2) return PAL.oceanWater.length - 1;
        return 0.8 + (wave * 0.5 + 0.5) * 3.0;
      }, PAL.oceanSky[4], 0.55);
      for (let y = hz + 1; y < H; y++)
        if (Math.sin(y * 0.7 / S - t * 2.4) > 0.45) {
          const mx = 96 * S;
          P.add(mx, y, 224, 232, 238, 0.3); P.add(mx - 1, y, 224, 232, 238, 0.12); P.add(mx + 1, y, 224, 232, 238, 0.12);
        }
      drawMerged(t, [
        { arr: this.houses, maxZ: 34, spread: 0.7, fn: (sx, sy, z) => drawLighthouse(sx, sy, z, t) },
        { arr: this.boats, maxZ: 30, spread: 1.0, fn: (sx, sy, z, p) => { if (z > 5) drawSailboat(sx, sy, z, t, p.seed); } },
        { arr: this.rocks, maxZ: 30, spread: 1.2, fn: (sx, sy, z) => drawSeaRock(sx, sy, z) },
        { arr: this.buoys, maxZ: 28, spread: 1.2, fn: (sx, sy, z, p) => { const k = FOCAL / z, r = Math.max(1, Math.min(4 * S, (0.18 * k) | 0)); const bob = Math.sin(t * 1.6 + p.seed) * 0.5 * S; P.disc(sx, sy - r - bob, r, [220, 70, 60]); P.put(sx, sy - bob, [60, 44, 40]); P.put(sx, sy - bob - 1, [60, 44, 40]); } },
      ], PAL.oceanSky[4]);
    },
  };

  // ---- a rolling meadow of hills, flowers and a far windmill ----
  Scenes.wind = {
    grass: null, flowers: null, bushes: null, mills: null, fences: null, deer: null, clouds: [],
    reset() {
      this.grass = streamInit(210, NEAR_Z + 0.2, 24, 1.45);
      this.flowers = streamInit(100, NEAR_Z + 0.3, 16, 1.35);
      this.bushes = streamInit(26, NEAR_Z + 1, 22, 1.3, 1.5);
      this.mills = streamInit(2, NEAR_Z + 7, 32, 0.7, 3.0);
      this.fences = streamInit(14, NEAR_Z + 1.5, 24, 0.9, 1.7);
      this.deer = streamInit(2, NEAR_Z + 3, 22, 1.1, 1.7);
      this.clouds = [];
      for (let i = 0; i < 6; i++) this.clouds.push({ x: rnd() * W, y: (5 + rnd() * 15) * S, s: (1.5 + rnd() * 3) * S, w: (9 + rnd() * 10) * S, h: (3 + rnd() * 2) * S });
    },
    draw(P, t, dt) {
      if (!this.grass) this.reset();
      sky(PAL.daySky);
      P.disc(22 * S, 11 * S, 5 * S, [255, 246, 214]);
      for (let r = 6 * S; r < 13 * S; r++) for (let a = 0; a < 6.28; a += 0.25 / S) P.glow(22 * S + Math.cos(a) * r, 11 * S + Math.sin(a) * r, [255, 244, 210], 0.4 - (r - 6 * S) * 0.05 / S);
      for (const c of this.clouds) {
        c.x += c.s * dt * 4; if (c.x - c.w > W) { c.x = -c.w; c.y = (5 + rnd() * 15) * S; }
        cloud(c.x | 0, c.y | 0, c.w, c.h);
      }
      // three layers of hills, the middle one wooded
      ridge(hz, 12, [150, 174, 188], 0.04, 0.3, 0.9);
      ridgeForest(hz, 8, [108, 150, 122], [70, 120, 80], 0.08, 2.0, 1.8);
      ridge(hz, 5, [80, 128, 92], 0.13, 3.5, 3.0);
      ground(PAL.grass, (wx, zt) => 1.8 + (Math.sin(wx * 2.3 + zt * 1.1) + 0.5 * Math.sin(wx * 5 - zt * 3)) * 1.5, PAL.daySky[4], 0.78);
      const FC = [[232, 92, 110], [242, 162, 80], [206, 122, 224], [244, 246, 250]];
      drawMerged(t, [
        { arr: this.mills, maxZ: 32, spread: 0.7, fn: (sx, sy, z) => drawWindmill(sx, sy, z, t) },
        { arr: this.deer, maxZ: 22, spread: 1.1, fn: (sx, sy, z) => drawDeer(sx, sy, z) },
        { arr: this.fences, maxZ: 24, spread: 0.9, fn: (sx, sy, z) => drawFence(sx, sy, z) },
        { arr: this.bushes, maxZ: 22, spread: 1.3, fn: (sx, sy, z) => drawBush(sx, sy, z, [40, 86, 46], [78, 128, 72]) },
        { arr: this.grass, maxZ: 24, spread: 1.45, fn: (sx, sy, z, p) => drawTuftP(p, t, PAL.grass[3], PAL.grass[1], 0.62, 4) },
        { arr: this.flowers, maxZ: 16, spread: 1.35, fn: (sx, sy, z, p) => drawFlower(sx, sy, z, FC[(p.seed * 97 | 0) % 4]) },
      ], PAL.daySky[4]);
    },
  };

  // ---- a sunlit forest of mixed trees, ferns, flowers and a cabin ----
  Scenes.forest = {
    pines: null, birches: null, ferns: null, bushes: null, flowers: null, cabins: null,
    stumps: null, logs: null, shrooms: null, deer: null, birds: [], timer: 0,
    reset() {
      this.pines = streamInit(55, NEAR_Z + 1, 24, 1.4, 1.7);
      this.birches = streamInit(28, NEAR_Z + 1, 24, 1.4, 1.7);
      this.ferns = streamInit(140, NEAR_Z + 0.3, 18, 1.4);
      this.bushes = streamInit(34, NEAR_Z + 0.6, 20, 1.35, 1.5);
      this.flowers = streamInit(60, NEAR_Z + 0.3, 14, 1.3);
      this.stumps = streamInit(10, NEAR_Z + 0.8, 20, 1.4, 1.4);
      this.logs = streamInit(8, NEAR_Z + 0.8, 20, 1.4, 1.4);
      this.shrooms = streamInit(30, NEAR_Z + 0.3, 12, 1.3);
      this.deer = streamInit(2, NEAR_Z + 3, 22, 1.0, 1.7);
      this.cabins = streamInit(1, NEAR_Z + 8, 34, 0.6, 3.0);
      this.birds = []; this.timer = 1;
    },
    draw(P, t, dt) {
      if (!this.pines) this.reset();
      sky(PAL.forestSky);
      P.disc(104 * S, 10 * S, 6 * S, [255, 250, 226]);
      for (let r = 7 * S; r < 13 * S; r++) for (let a = 0; a < 6.28; a += 0.25 / S) P.glow(104 * S + Math.cos(a) * r, 10 * S + Math.sin(a) * r, [255, 248, 222], 0.35 - (r - 7 * S) * 0.05 / S);
      // layered far treelines
      ridgeForest(hz, 14, [60, 100, 76], [38, 78, 54], 0.06, 0.4, 0.9);
      ridge(hz, 9, [40, 82, 56], 0.13, 1, 1.7);
      ground(PAL.forestFloor, (wx, zt) => 1.6 + Math.sin(wx * 2.3 + zt * 1.1) * 1.2, PAL.forestSky[4], 0.7);
      const FC = [[236, 96, 110], [246, 196, 90], [232, 240, 250]];
      drawMerged(t, [
        { arr: this.cabins, maxZ: 34, spread: 0.6, fn: (sx, sy, z) => drawCabin(sx, sy, z, false) },
        { arr: this.deer, maxZ: 22, spread: 1.0, fn: (sx, sy, z) => drawDeer(sx, sy, z) },
        { arr: this.pines, maxZ: 24, spread: 1.4, fn: (sx, sy, z, p) => drawPine(sx, sy, (4.2 * p.sc * FOCAL) / z, [30, 64, 44], [60, 102, 68]) },
        { arr: this.birches, maxZ: 24, spread: 1.4, fn: (sx, sy, z, p) => drawBirch(sx, sy, (4.4 * p.sc * FOCAL) / z) },
        { arr: this.bushes, maxZ: 20, spread: 1.35, fn: (sx, sy, z) => drawBush(sx, sy, z, [34, 72, 44], [64, 108, 64]) },
        { arr: this.logs, maxZ: 20, spread: 1.4, fn: (sx, sy, z) => drawFallenLog(sx, sy, z) },
        { arr: this.stumps, maxZ: 20, spread: 1.4, fn: (sx, sy, z) => drawStump(sx, sy, z) },
        { arr: this.ferns, maxZ: 18, spread: 1.4, fn: (sx, sy, z, p) => drawTuftP(p, t, PAL.forestFloor[4], PAL.forestFloor[2], 0.5, 5) },
        { arr: this.shrooms, maxZ: 12, spread: 1.3, fn: (sx, sy, z) => drawMushroom(sx, sy, z) },
        { arr: this.flowers, maxZ: 14, spread: 1.3, fn: (sx, sy, z, p) => drawFlower(sx, sy, z, FC[(p.seed * 97 | 0) % 3]) },
      ], PAL.forestSky[4]);
      // birds across the sky
      this.timer -= dt;
      if (this.timer <= 0) { this.timer = 2.5 + rnd() * 4; this.birds.push({ x: -6 * S, y: (6 + rnd() * 14) * S, s: (9 + rnd() * 6) * S, p: rnd() * 10 }); }
      for (let i = this.birds.length - 1; i >= 0; i--) {
        const b = this.birds[i]; b.x += b.s * dt;
        if (b.x > W + 6) { this.birds.splice(i, 1); continue; }
        const flap = Math.sin(t * 8 + b.p) > 0 ? S : -S;
        for (let q = 0; q < S; q++) { P.set(b.x + q, b.y, 30, 34, 40); P.set(b.x - S + q, b.y - flap, 30, 34, 40); P.set(b.x + S + q, b.y - flap, 30, 34, 40); }
      }
    },
  };

  // ---- a moonlit field with a far cabin and fireflies ----
  Scenes.night = {
    stars: [], tufts: null, bushes: null, cabins: null, flies: null,
    reset() {
      this.stars = [];
      for (let i = 0; i < 150; i++) this.stars.push({ x: rnd() * W, y: rnd() * HORIZON0, p: rnd() * 6.28, sp: 1 + rnd() * 2, big: rnd() < 0.1 });
      this.tufts = streamInit(180, NEAR_Z + 0.3, 22, 1.45);
      this.bushes = streamInit(24, NEAR_Z + 0.8, 22, 1.3, 1.5);
      this.fences = streamInit(14, NEAR_Z + 1.5, 24, 0.9, 1.7);
      this.deer = streamInit(1, NEAR_Z + 3, 22, 1.1, 1.7);
      this.cabins = streamInit(1, NEAR_Z + 8, 34, 0.6, 3.0);
      this.flies = streamInit(16, NEAR_Z + 0.5, 16, 1.1);
    },
    draw(P, t) {
      if (!this.tufts) this.reset();
      sky(PAL.nightSky);
      for (const s of this.stars) {
        const b = Math.sin(t * s.sp + s.p) * 0.5 + 0.5;
        const a = (0.2 + 0.7 * b) * (1 - s.y / hz * 0.6);
        P.add(s.x, Math.min(s.y, hz), 232, 232, 255, a);
        if (s.big && b > 0.6) { P.add(s.x + 1, s.y, 232, 232, 255, a * 0.5); P.add(s.x, s.y + 1, 232, 232, 255, a * 0.5); }
      }
      moon(26, 12, 7);
      ridge(hz, 13, [22, 24, 44], 0.05, 1.1, 1.1);
      ridgeForest(hz, 9, [12, 14, 28], [6, 8, 18], 0.09, 3.2, 2.4);
      ground(PAL.nightGround, (wx, zt) => 1.5 + Math.sin(wx * 2 + zt * 1.3) * 1.2, PAL.nightSky[3], 0.5);
      drawMerged(t, [
        { arr: this.cabins, maxZ: 34, spread: 0.6, fn: (sx, sy, z) => drawCabin(sx, sy, z, true) },
        { arr: this.deer, maxZ: 22, spread: 1.1, fn: (sx, sy, z) => drawDeer(sx, sy, z) },
        { arr: this.fences, maxZ: 24, spread: 0.9, fn: (sx, sy, z) => drawFence(sx, sy, z) },
        { arr: this.bushes, maxZ: 22, spread: 1.3, fn: (sx, sy, z) => drawBush(sx, sy, z, [16, 26, 24], [28, 42, 36]) },
        { arr: this.tufts, maxZ: 22, spread: 1.45, fn: (sx, sy, z, p) => drawTuftP(p, t, PAL.grass[1], PAL.nightGround[2], 0.55, 4) },
      ], PAL.nightSky[2]);
      streamStep(this.flies, 16, 1.1);
      for (const f of this.flies) {
        const z = f.wf - cam.f; if (z <= NEAR_Z) continue;
        const lift = (0.25 + 0.12 * Math.sin(t * 1.3 + f.seed)) * FOCAL / z;
        const glow = Math.sin(t * 2 + f.seed) * 0.5 + 0.5;
        P.add(projX(f.wl, z), projY(z) - lift, 190, 230, 120, glow * 0.9);
      }
    },
  };

  // ---- walking through a thunderstorm, past wind-thrown trees ----
  Scenes.storm = {
    drops: [], ripples: [], rt: 0, flash: 0, flashT: 1.5, bolt: null, boltLife: 0, trees: null,
    reset() {
      this.drops = [];
      for (let i = 0; i < 560; i++) { const d = rnd(); this.drops.push({ x: rnd() * W, y: rnd() * H, depth: d, sp: (95 + d * 170) * S, slant: -(12 + d * 16) * S }); }
      this.ripples = []; this.rt = 0; this.flash = 0; this.flashT = 1 + rnd() * 3; this.bolt = null; this.boltLife = 0;
      this.trees = streamInit(40, NEAR_Z + 1.5, 26, 1.4, 1.6);
      this.dead = streamInit(16, NEAR_Z + 1, 26, 1.4, 1.7);
      this.bushes = streamInit(20, NEAR_Z + 0.8, 22, 1.3, 1.5);
      this.towers = streamInit(1, NEAR_Z + 9, 34, 0.6, 3.0);
    },
    draw(P, t, dt) {
      if (!this.trees) this.reset();
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flashT = 3 + rnd() * 7; this.flash = 1; this.boltLife = 0.18;
        const pts = []; let bx = 18 * S + rnd() * (W - 36 * S), by = 0;
        while (by < hz) { pts.push([bx, by]); bx += (rnd() * 2 - 1) * 6 * S; by += (2 + rnd() * 3) * S; }
        this.bolt = pts;
      }
      this.flash = Math.max(0, this.flash - dt * 3);
      sky(PAL.stormSky);
      ridge(hz, 14, [30, 34, 46], 0.045, 0.5, 0.9);
      ridgeForest(hz, 9, [18, 22, 32], [12, 16, 24], 0.09, 2.4, 1.9);
      ground(PAL.rainGround, (wx, zt) => 0.4 + Math.sin(wx * 0.8 + zt * 0.6 - t * 2) * 0.4, PAL.stormSky[4], 0.85);
      // wind-thrown trees, bare snags, bushes and a far ruined tower
      drawMerged(t, [
        { arr: this.towers, maxZ: 34, spread: 0.6, fn: (sx, sy, z) => drawTower(sx, sy, z) },
        { arr: this.trees, maxZ: 26, spread: 1.4, fn: (sx, sy, z, p) => drawPine(sx, sy, (3.8 * p.sc * FOCAL) / z, [14, 18, 24], [22, 28, 34]) },
        { arr: this.dead, maxZ: 26, spread: 1.4, fn: (sx, sy, z, p) => drawDeadTree(sx, sy, (3.4 * p.sc * FOCAL) / z, [20, 22, 28]) },
        { arr: this.bushes, maxZ: 22, spread: 1.3, fn: (sx, sy, z) => drawBush(sx, sy, z, [16, 20, 24], [26, 30, 34]) },
      ], PAL.stormSky[4]);
      if (this.bolt && this.boltLife > 0) {
        this.boltLife -= dt;
        for (const pt of this.bolt) { for (let q = 0; q < S; q++) P.add(pt[0] + q, pt[1], 235, 240, 255, 0.9); P.add(pt[0] + S, pt[1], 200, 210, 255, 0.4); }
      }
      this.rt -= dt;
      if (this.rt <= 0) { this.rt = 0.02 + rnd() * 0.04; this.ripples.push({ wx: (rnd() * 2 - 1) * 22, wz: NEAR_Z + 0.5 + rnd() * 20, r: 0, life: 1 }); }
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const rp = this.ripples[i]; rp.r += dt * 2.5; rp.life -= dt;
        if (rp.life <= 0) { this.ripples.splice(i, 1); continue; }
        groundRing(rp.wx, rp.wz, rp.r, [150, 170, 200], rp.life * 0.5);
      }
      for (const d of this.drops) {
        d.y += d.sp * dt; d.x += d.slant * dt;
        if (d.y > H) { d.y = -4; d.x = rnd() * W; }
        const len = (3 + d.depth * 5) * S | 0;
        for (let k = 0; k < len; k++) P.add(d.x - d.slant * 0.02 * k, d.y - k, 172, 192, 222, (0.4 + d.depth * 0.6) * 0.7 - k * 0.05 / S);
      }
      const fl = this.flash;
      if (fl > 0.02) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fl * 0.85 > bayer(x, y)) P.add(x, y, 226, 232, 250, fl * 0.5);
    },
  };

  Scenes.stream = {
    sparks: [], reeds: null, trees: null, bushes: null, bridges: null,
    reset() {
      this.sparks = [];
      this.reeds = streamInit(40, NEAR_Z + 0.6, 20, 1.0);   // along the banks
      this.trees = streamInit(26, NEAR_Z + 1.2, 24, 1.5, 1.6);   // set back from the water
      this.bushes = streamInit(28, NEAR_Z + 0.6, 22, 1.5, 1.5);
      this.bridges = streamInit(1, NEAR_Z + 8, 30, 0.05);   // crosses the stream
    },
    draw(P, t, dt) {
      if (!this.reeds) this.reset();
      sky(PAL.daySky);
      P.disc(100 * S, 10 * S, 5 * S, [255, 248, 220]);
      ridgeForest(hz, 11, [96, 142, 110], [60, 110, 76], 0.06, 0.5, 1.0);
      const HALF = 0.75;
      for (let y = hz + 1; y < H; y++) {
        const z = (CAM_H * FOCAL) / (y - hz);
        const fog = Math.min(1, (z - NEAR_Z) / (FOCAL * 0.8)) * 0.78;
        for (let x = 0; x < W; x++) {
          const wx = cam.x + ((x - W / 2) * z) / FOCAL;
          const zt = z + cam.f; // walk along the bank
          let c;
          if (Math.abs(wx) < HALF) {
            const flow = Math.sin(zt * 2.2 + t * 3 + wx * 1.5) + 0.5 * Math.sin(zt * 5 - t * 5);
            c = flow > 1.0 ? PAL.streamWater[5] : ramp(PAL.streamWater, 1 + (flow * 0.5 + 0.5) * 3, x, y);
          } else if (Math.abs(wx) - HALF < 0.4) {
            c = [120, 108, 88];
          } else {
            c = ramp(PAL.grass, 1.6 + Math.sin(wx * 2 + zt * 1.3) * 1.2, x, y);
          }
          if (fog > bayer(x + 1, y + 2)) c = PAL.daySky[4];
          P.put(x, y, c);
        }
      }
      // bank plants, set-back trees and a little footbridge over the water
      drawMerged(t, [
        { arr: this.bridges, maxZ: 30, spread: 0.05, fn: (sx, sy, z) => drawBridge(sx, sy, z) },
        { arr: this.trees, maxZ: 24, spread: 1.5, fn: (sx, sy, z, p) => { if (Math.abs(p.wl - cam.x) > HALF + 0.4) drawPine(sx, sy, (4.0 * p.sc * FOCAL) / z, [40, 80, 52], [70, 116, 70]); } },
        { arr: this.bushes, maxZ: 22, spread: 1.5, fn: (sx, sy, z, p) => { if (Math.abs(p.wl - cam.x) > HALF + 0.2) drawBush(sx, sy, z, [44, 90, 50], [82, 132, 76]); } },
        { arr: this.reeds, maxZ: 20, spread: 1.0, fn: (sx, sy, z, p) => { if (Math.abs(p.wl - cam.x) > HALF - 0.1 && Math.abs(p.wl - cam.x) < HALF + 0.5) drawReeds(sx, sy, z, t, p.seed); } },
      ], PAL.daySky[4]);
      if (rnd() < 0.7) this.sparks.push({ wx: (rnd() * 2 - 1) * 0.7, wz: NEAR_Z + 1 + rnd() * 16, life: 1 });
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const s = this.sparks[i]; s.wz -= dt * 3; s.life -= dt * 1.2;
        if (s.life <= 0 || s.wz <= NEAR_Z) { this.sparks.splice(i, 1); continue; }
        P.add(projX(s.wx, s.wz), projY(s.wz), 236, 246, 250, s.life * 0.6);
      }
    },
  };

  // ---- a dusk garden of chimes, lanterns and flowers ----
  Scenes.chimes = {
    posts: null, bushes: null, flowers: null, lanterns: null, stars: [],
    reset() {
      this.posts = streamInit(6, NEAR_Z + 2, 28, 0.9, 1.6);
      this.bushes = streamInit(60, NEAR_Z + 0.4, 20, 1.3, 1.5);
      this.flowers = streamInit(60, NEAR_Z + 0.3, 15, 1.3);
      this.lanterns = streamInit(5, NEAR_Z + 2, 26, 1.0, 1.6);
      this.stars = [];
      for (let i = 0; i < 44; i++) this.stars.push({ x: rnd() * W, y: rnd() * 16 * S, p: rnd() * 6.28, sp: 1 + rnd() * 2 });
    },
    draw(P, t, dt) {
      if (!this.posts) this.reset();
      sky(PAL.duskSky);
      for (const s of this.stars) { const b = Math.sin(t * s.sp + s.p) * 0.5 + 0.5; P.add(s.x, s.y, 255, 250, 235, (0.18 + 0.5 * b) * (1 - s.y / (16 * S))); }
      ridgeForest(hz, 9, [90, 70, 96], [60, 46, 70], 0.07, 0.6, 1.0);
      ground(PAL.grass, (wx, zt) => 0.8 + Math.sin(wx * 2.5 + zt * 1.4) * 0.8, PAL.duskSky[3], 0.7);
      const FC = [[236, 96, 130], [250, 180, 90], [210, 130, 230], [120, 160, 250]];
      drawMerged(t, [
        { arr: this.posts, maxZ: 28, spread: 0.9, fn: (sx, sy, z, p) => drawChimePost(sx, sy, z, t, p.seed) },
        { arr: this.lanterns, maxZ: 26, spread: 1.0, fn: (sx, sy, z, p) => { const k = FOCAL / z, ph = Math.max(3, Math.min((0.7 * H) | 0, (2.2 * k) | 0)), r = Math.max(1, (0.45 * k) | 0); for (let yy = 0; yy < ph; yy++) for (let q = 0; q < S; q++) P.put(sx + q - (S >> 1), sy - yy, [60, 48, 40]); const ly = sy - ph; P.disc(sx, ly - r, r, [255, 180, 90]); for (let rr = r; rr < r * 3; rr++) for (let a = 0; a < 6.28; a += 0.4) P.glow(sx + Math.cos(a) * rr, ly - r + Math.sin(a) * rr, [255, 170, 90], 0.5 - (rr - r) * 0.12); } },
        { arr: this.bushes, maxZ: 20, spread: 1.3, fn: (sx, sy, z) => drawBush(sx, sy, z, [40, 60, 48], [70, 96, 66]) },
        { arr: this.flowers, maxZ: 15, spread: 1.3, fn: (sx, sy, z, p) => drawFlower(sx, sy, z, FC[(p.seed * 97 | 0) % 4]) },
      ], PAL.duskSky[2]);
    },
  };

  // ---- a snowy forest valley with a warm cabin ----
  Scenes.snow = {
    flakes: [], trees: null, rocks: null, cabins: null, snowmen: null,
    reset() {
      this.flakes = [];
      for (let i = 0; i < 560; i++) { const d = rnd(); this.flakes.push({ x: rnd() * W, y: rnd() * H, depth: d, sp: (6 + d * 16) * S, ph: rnd() * 6.28 }); }
      this.trees = streamInit(55, NEAR_Z + 1, 26, 1.4, 1.6);
      this.rocks = streamInit(18, NEAR_Z + 0.7, 22, 1.3, 1.5);
      this.snowmen = streamInit(2, NEAR_Z + 2, 22, 1.0, 1.6);
      this.cabins = streamInit(1, NEAR_Z + 9, 34, 0.6, 3.0);
    },
    draw(P, t, dt) {
      if (!this.trees) this.reset();
      sky(PAL.snowSky);
      ridge(hz, 16, [150, 162, 184], 0.04, 0.7, 1.0);
      ridge(hz, 11, [128, 142, 168], 0.07, 2.0, 1.7);
      ridgeForest(hz, 7, [96, 112, 138], [70, 84, 110], 0.11, 3.4, 2.8);
      ground(PAL.snowGround, (wx, zt) => {
        const spark = Math.sin(wx * 9 + zt * 7 - t * 1.5) > 0.96 ? 1.2 : 0;
        return 1.4 + (Math.sin(wx * 3 + zt * 2) * 0.5 + 0.5) * 1.6 + spark;
      }, PAL.snowSky[4], 0.7);
      drawMerged(t, [
        { arr: this.cabins, maxZ: 34, spread: 0.6, fn: (sx, sy, z) => drawCabin(sx, sy, z, true) },
        { arr: this.trees, maxZ: 26, spread: 1.4, fn: (sx, sy, z, p) => drawSnowPine(sx, sy, (3.8 * p.sc * FOCAL) / z) },
        { arr: this.snowmen, maxZ: 22, spread: 1.0, fn: (sx, sy, z) => drawSnowman(sx, sy, z) },
        { arr: this.rocks, maxZ: 22, spread: 1.3, fn: (sx, sy, z) => { drawBoulder(sx, sy, z); const r = Math.max(1, (0.95 * FOCAL / z) | 0); for (let dx = -r; dx <= 0; dx++) P.put(sx + dx, sy - r + 1, [224, 232, 240]); } },
      ], PAL.snowSky[4]);
      for (const fk of this.flakes) {
        fk.y += fk.sp * dt; fk.x += Math.sin(t * 0.8 + fk.ph) * 4 * S * fk.depth * dt;
        if (fk.y > H) { fk.y = -2; fk.x = rnd() * W; }
        const a = 0.5 + fk.depth * 0.5;
        P.add(fk.x, fk.y, 250, 252, 255, a);
        if (fk.depth > 0.7) { P.add(fk.x + 1, fk.y, 250, 252, 255, a * 0.6); P.add(fk.x, fk.y + 1, 250, 252, 255, a * 0.6); }
      }
    },
  };

  // ---- idle: a calm grid drifting toward you ----
  Scenes.idle = {
    draw(P, t) {
      sky([[14, 18, 30], [22, 26, 42], [30, 34, 50]]);
      ground(PAL.nightGround, (wx, z) => {
        const gx = Math.abs(((wx % 1) + 1.5) % 1 - 0.5) < 0.05;
        const gz = Math.abs((((z - t * 0.5) % 1) + 1.5) % 1 - 0.5) < 0.05;
        return (gx || gz) ? 4 : 1.2;
      }, [40, 46, 64], 0.7);
    },
  };

  // =========================================================================
  //  RENDER LOOP
  // =========================================================================
  let canvas = null, g = null, img = null;
  let current = Scenes.idle;
  let startT = 0, last = 0;

  function loop(ts) {
    if (!startT) { startT = ts; last = ts; }
    const t = (ts - startT) / 1000;
    let dt = (ts - last) / 1000;
    if (!(dt > 0) || dt > 0.1) dt = 0.016;
    last = ts;
    updateCam(t);
    if (current && current.draw) current.draw(P, t, dt);
    g.putImageData(img, 0, 0);
    requestAnimationFrame(loop);
  }

  window.PixelScene = {
    init(cv) {
      canvas = cv;
      canvas.width = W; canvas.height = H;
      g = canvas.getContext("2d");
      img = g.createImageData(W, H);
      data = img.data;
      for (let i = 0; i < data.length; i += 4) data[i + 3] = 255;
      requestAnimationFrame(loop);
    },
    set(name) {
      const next = Scenes[name];
      if (!next) return;
      current = next;
      if (current.reset) current.reset();
    },
    has(name) { return !!Scenes[name]; },
  };
})();
