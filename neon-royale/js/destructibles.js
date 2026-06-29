
const NUM_DESTRUCTIBLES = 46;
const DESTRUCTIBLE_HP = 60;

/**
 * Shootable neon barriers — tactical cover that blocks movement, line-of-sight
 * and bullets until you destroy it (opening new paths). Each registers a
 * collider in the world's spatial grid and removes it when broken.
 */
class Destructibles {
  constructor({ scene, audio, world }) {
    this.scene = scene;
    this.audio = audio;
    this.world = world;
    this.items = [];
    this.debris = [];
    this._spawn();
  }

  _spawn() {
    for (let i = 0; i < NUM_DESTRUCTIBLES; i++) {
      const p = this.world.randomClearPosition(8);
      this._make(p.x, p.z);
    }
  }

  _make(x, z) {
    const w = 2.4, h = 2.6, d = 2.4;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0x2a2150, emissive: 0x6a3aff, emissiveIntensity: 0.3, roughness: 0.7 }));
    mesh.position.set(x, h / 2, z);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0xb14dff }));
    mesh.add(edges);
    this.scene.add(mesh);

    const box = new THREE.Box3().setFromObject(mesh);
    this.world._registerCollider(box);
    const obj = { mesh, box, hp: DESTRUCTIBLE_HP, x, z, dead: false };
    mesh.userData.destructible = obj;
    this.items.push(obj);
  }

  getMeshes() {
    const m = [];
    for (const o of this.items) m.push(o.mesh);
    return m;
  }

  damage(obj, dmg) {
    if (obj.dead) return;
    obj.hp -= dmg;
    obj.mesh.material.emissiveIntensity = 0.3 + 0.5 * (1 - obj.hp / DESTRUCTIBLE_HP);
    if (obj.hp <= 0) this.destroy(obj);
  }

  destroy(obj) {
    if (obj.dead) return;
    obj.dead = true;
    this.world.removeCollider(obj.box);
    this.scene.remove(obj.mesh);
    const i = this.items.indexOf(obj);
    if (i >= 0) this.items.splice(i, 1);
    this._debris(obj.x, obj.z);
    this.audio.explosion();
  }

  _debris(x, z) {
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3),
        new THREE.MeshBasicMaterial({ color: 0xb14dff }));
      s.position.set(x, 1.2, z);
      const v = new THREE.Vector3((Math.random() - 0.5) * 7, 3 + Math.random() * 4, (Math.random() - 0.5) * 7);
      this.scene.add(s);
      this.debris.push({ mesh: s, v, life: 1.2 });
    }
  }

  update(delta) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.v.y -= 20 * delta;
      d.mesh.position.x += d.v.x * delta;
      d.mesh.position.y += d.v.y * delta;
      d.mesh.position.z += d.v.z * delta;
      if (d.mesh.position.y < 0.1) d.mesh.position.y = 0.1;
      d.mesh.rotation.x += delta * 6;
      d.mesh.rotation.y += delta * 4;
      d.life -= delta;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        d.mesh.material.dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  reset() {
    for (const o of this.items) { this.world.removeCollider(o.box); this.scene.remove(o.mesh); }
    this.items.length = 0;
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.debris.length = 0;
    this._spawn();
  }
}
