
/**
 * A 2D top-down minimap drawn on its own <canvas> (separate from the WebGL
 * view). North-up: the player arrow rotates to show facing. Shows the storm
 * circle, enemies, clones, the pet, cars and special buildings.
 */
class Minimap {
  constructor() {
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
  }

  _px(x, z) {
    const s = this.canvas.width, h = ARENA.half;
    return [(x + h) / (2 * h) * s, (z + h) / (2 * h) * s];
  }

  draw(player, bots, storm, crates, specials) {
    const ctx = this.ctx, s = this.canvas.width;
    if (!s) return;
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(8,10,18,0.72)';
    ctx.fillRect(0, 0, s, s);

    // Storm safe-circle.
    const [cx, cy] = this._px(storm.center.x, storm.center.z);
    ctx.strokeStyle = '#b14dff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, storm.radius / (2 * ARENA.half) * s, 0, Math.PI * 2);
    ctx.stroke();

    const dot = (x, z, color, r) => {
      const [px, py] = this._px(x, z);
      ctx.fillStyle = color;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    };

    if (specials) for (const b of specials.buildings) dot(b.x, b.z, '#ffd24a', 2.4);
    for (const car of crates.cars) dot(car.group.position.x, car.group.position.z, '#3bd1ff', 1.4);
    for (const b of bots.bots) if (b.alive) dot(b.position.x, b.position.z, '#ff5a5a', 1.7);
    for (const c of bots.clones) if (c.alive) dot(c.position.x, c.position.z, '#6df0ff', 1.7);
    if (specials && specials.pet) dot(specials.pet.group.position.x, specials.pet.group.position.z, '#35ff8a', 1.6);

    // Player arrow (rotates with facing).
    const [pxp, pyp] = this._px(player.position.x, player.position.z);
    ctx.save();
    ctx.translate(pxp, pyp);
    ctx.rotate(player.yawAngle);
    ctx.fillStyle = '#7fe8ff';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, s - 1, s - 1);
  }
}
