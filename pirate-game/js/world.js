// The open world: a big square of ocean dotted with islands.
// Generation happens once at construction; everything else just reads it.

class World {
  constructor(size) {
    this.size = size;
    this.islands = [];
    this._generate();
  }

  _generate() {
    const count = 16;
    let attempts = 0;
    while (this.islands.length < count && attempts < 400) {
      attempts++;
      const r = rand(90, 320);
      const margin = r + 80;
      const x = rand(margin, this.size - margin);
      const y = rand(margin, this.size - margin);

      // Don't spawn islands on top of each other, and leave the very
      // center clear so the player's starting spot is open water.
      const center = this.size / 2;
      if (dist(x, y, center, center) < 500) continue;

      let overlaps = false;
      for (const isle of this.islands) {
        if (dist(x, y, isle.x, isle.y) < r + isle.radius + 140) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      this.islands.push(this._makeIsland(x, y, r));
    }
  }

  _makeIsland(x, y, r) {
    // Precompute a wobbly outline + a few palm trees so the island looks
    // hand-placed instead of a perfect circle.
    const verts = [];
    const steps = 22;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TWO_PI;
      const rr = r * rand(0.82, 1.05);
      verts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }

    const palms = [];
    const palmCount = randInt(2, Math.max(2, Math.floor(r / 70)));
    for (let i = 0; i < palmCount; i++) {
      const a = rand(0, TWO_PI);
      const pr = rand(0, r * 0.55);
      palms.push({ x: Math.cos(a) * pr, y: Math.sin(a) * pr, h: rand(14, 24) });
    }

    return { x, y, radius: r, verts, palms };
  }

  // Draw every island visible within the given world-space view rectangle.
  draw(ctx, view) {
    for (const isle of this.islands) {
      if (
        isle.x + isle.radius < view.x ||
        isle.x - isle.radius > view.x + view.w ||
        isle.y + isle.radius < view.y ||
        isle.y - isle.radius > view.y + view.h
      ) {
        continue; // off-screen — skip
      }
      this._drawIsland(ctx, isle);
    }
  }

  _drawIsland(ctx, isle) {
    ctx.save();
    ctx.translate(isle.x, isle.y);

    // Shallow-water halo
    ctx.fillStyle = "rgba(120, 200, 200, 0.25)";
    ctx.beginPath();
    ctx.arc(0, 0, isle.radius * 1.18, 0, TWO_PI);
    ctx.fill();

    // Sand
    this._outlinePath(ctx, isle.verts, 1.0);
    ctx.fillStyle = "#e9d8a6";
    ctx.fill();

    // Grass interior
    this._outlinePath(ctx, isle.verts, 0.7);
    ctx.fillStyle = "#5a8a3c";
    ctx.fill();

    // Palms
    for (const p of isle.palms) {
      // trunk
      ctx.strokeStyle = "#6b4423";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - p.h);
      ctx.stroke();
      // fronds
      ctx.fillStyle = "#2f7d32";
      ctx.beginPath();
      ctx.arc(p.x, p.y - p.h, p.h * 0.5, 0, TWO_PI);
      ctx.fill();
    }

    ctx.restore();
  }

  _outlinePath(ctx, verts, scale) {
    ctx.beginPath();
    ctx.moveTo(verts[0].x * scale, verts[0].y * scale);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x * scale, verts[i].y * scale);
    }
    ctx.closePath();
  }

  // A random open-water point, used to scatter treasure & enemies.
  randomOpenPoint(minClear) {
    for (let tries = 0; tries < 60; tries++) {
      const x = rand(100, this.size - 100);
      const y = rand(100, this.size - 100);
      let ok = true;
      for (const isle of this.islands) {
        if (dist(x, y, isle.x, isle.y) < isle.radius + minClear) {
          ok = false;
          break;
        }
      }
      if (ok) return { x, y };
    }
    return { x: this.size / 2, y: this.size / 2 };
  }
}
