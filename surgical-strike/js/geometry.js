// 2D vector and segment math shared by the sim and the renderer.
const G = {
  dist(ax, ay, bx, by) {
    return Math.hypot(bx - ax, by - ay);
  },

  norm(x, y) {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  },

  lerp(a, b, t) {
    return a + (b - a) * t;
  },

  // Returns t in [0,1] along segment a->b where it crosses c->d, or null.
  segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const r1x = bx - ax, r1y = by - ay;
    const r2x = dx - cx, r2y = dy - cy;
    const denom = r1x * r2y - r1y * r2x;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((cx - ax) * r2y - (cy - ay) * r2x) / denom;
    const u = ((cx - ax) * r1y - (cy - ay) * r1x) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t;
    return null;
  },

  // Nearest wall hit along segment a->b. filter(wall) decides which walls block.
  // Returns { t, wall } or null.
  raycast(ax, ay, bx, by, walls, filter) {
    let best = null;
    for (const w of walls) {
      if (filter && !filter(w)) continue;
      const t = G.segIntersect(ax, ay, bx, by, w.x1, w.y1, w.x2, w.y2);
      if (t !== null && (best === null || t < best.t)) best = { t, wall: w };
    }
    return best;
  },

  // seeThroughWindows: windows don't block (vision); false: everything blocks (movement, sound damping check).
  losBlocked(ax, ay, bx, by, walls, seeThroughWindows) {
    return G.raycast(ax, ay, bx, by, walls, w => !(seeThroughWindows && w.window)) !== null;
  },

  // Distance from point p to segment a-b.
  pointSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return G.dist(px, py, ax + dx * t, ay + dy * t);
  },

  // Smallest signed angle from a to b, in [-PI, PI].
  angleDiff(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  },
};

if (typeof module !== "undefined") module.exports = { G };
