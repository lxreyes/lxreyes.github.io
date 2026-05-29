// Small math/helper toolbox shared across the game.
// Kept dependency-free so it can load first.

const TWO_PI = Math.PI * 2;

// Random helpers
function rand(min, max) {
  return min + Math.random() * (max - min);
}
function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

// Clamp a value into [min, max]
function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// Linear interpolation
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Distance between two points
function dist(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.hypot(dx, dy);
}
function distSq(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

// Angle (radians) pointing from A toward B
function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

// Shortest signed difference between two angles, result in [-PI, PI]
function angleDiff(a, b) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}
