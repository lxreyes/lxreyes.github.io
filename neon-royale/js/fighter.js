
/**
 * Shared model builders so the player and the AI bots are literally the same
 * fighter — only recoloured. Keeping one factory here means a tweak to the
 * silhouette (a new pauldron, a longer barrel) shows up on everyone at once,
 * instead of drifting out of sync between player.js and bots.js (DRY).
 */

// A neon rifle (body, barrel, scope, mag, stock, accent) with a muzzle marker.
// `glow` tints the emissive bits; `overlay` makes it a first-person viewmodel
// that always draws on top of the world (never clips into walls).
function buildGun(opts = {}) {
  const glowColor = opts.glow != null ? opts.glow : 0x39d8ff;
  const bodyColor = opts.body != null ? opts.body : 0x12151c;
  const group = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.5, metalness: 0.5 });
  const glow = new THREE.MeshBasicMaterial({ color: glowColor });

  const rbody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.72), gunMat); rbody.position.z = -0.08;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.5, 10), gunMat);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.03, -0.56);
  const scope = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.2), gunMat); scope.position.set(0, 0.15, -0.04);
  const scopeGlow = new THREE.Mesh(new THREE.CircleGeometry(0.028, 12), glow); scopeGlow.position.set(0, 0.15, 0.07);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.26, 0.13), gunMat); mag.position.set(0, -0.2, 0.05);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.26), gunMat); stock.position.set(0, -0.02, 0.33);
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.42), glow); accent.position.set(0, 0.09, -0.1);
  group.add(rbody, mag, stock, scope, barrel, accent, scopeGlow);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.82);
  group.add(muzzle);

  if (opts.overlay) {
    group.traverse((o) => {
      if (o.isMesh) { o.material.depthTest = false; o.material.depthWrite = false; o.renderOrder = 999; }
    });
  }
  return { group, muzzle };
}

/**
 * The humanoid fighter: animated legs, armoured torso, helmet + visor, arms
 * reaching forward, and a held rifle. Returns the group plus the parts the
 * animation code drives (legs/arms/gun) and the hit parts (head/body).
 *   armor  — the bright plates (boots, forearms, chest, helmet, pauldrons)
 *   accent — the neon glow (emblem, visor, gun accents)
 *   suit   — the bodysuit underneath
 *   holo   — translucent, emissive "hologram" look (used by clones)
 */
function buildFighterModel(opts = {}) {
  const accent = opts.accent != null ? opts.accent : 0x39d8ff;
  const armorColor = opts.armor != null ? opts.armor : 0x7fe8ff;
  const suitColor = opts.suit != null ? opts.suit : 0x2a3340;
  const skinColor = opts.skin != null ? opts.skin : 0xe8d2b8;
  const holo = !!opts.holo;
  const op = holo ? 0.6 : 1;

  const suit = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.6, metalness: 0.3,
    emissive: holo ? armorColor : 0x000000, emissiveIntensity: holo ? 0.5 : 0, transparent: holo, opacity: op });
  const armor = new THREE.MeshStandardMaterial({ color: armorColor, emissive: armorColor,
    emissiveIntensity: holo ? 0.85 : 0.28, roughness: 0.45, metalness: 0.45, transparent: holo, opacity: op });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.7, transparent: holo, opacity: op });
  const glow = new THREE.MeshBasicMaterial({ color: accent, transparent: holo, opacity: op });
  const skin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.55, transparent: holo, opacity: op });

  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);

  // ----- legs (thigh + shin + boot), animated from the hip -----
  const mkLeg = (sx) => {
    const grp = new THREE.Group(); grp.position.set(sx, 0.92, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.46, 0.3), suit); thigh.position.y = -0.22;
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.46, 0.26), dark); shin.position.y = -0.62;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.44), armor); boot.position.set(0, -0.85, -0.06);
    grp.add(thigh, shin, boot); pivot.add(grp); return grp;
  };
  const legL = mkLeg(-0.18), legR = mkLeg(0.18);

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.3, 0.36), suit); pelvis.position.y = 1.0; pivot.add(pelvis);

  // ----- torso, chest armour, emblem, backpack, pauldrons -----
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.66, 0.36), suit); torso.position.y = 1.32; pivot.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.12), armor); chest.position.set(0, 1.36, -0.2); pivot.add(chest);
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), glow); emblem.position.set(0, 1.4, -0.27); pivot.add(emblem);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.52, 0.22), dark); pack.position.set(0, 1.34, 0.26); pivot.add(pack);
  const packGlow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.02), glow); packGlow.position.set(0, 1.48, 0.38); pivot.add(packGlow);
  for (const sx of [-0.4, 0.4]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.34), armor); p.position.set(sx, 1.55, 0); pivot.add(p);
  }

  // ----- neck, head, helmet, visor, antenna -----
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.13, 8), skin); neck.position.y = 1.72; pivot.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin); head.position.y = 1.86; pivot.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.235, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), armor); helmet.position.y = 1.9; pivot.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.12), glow); visor.position.set(0, 1.85, -0.16); pivot.add(visor);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6), dark); antenna.position.set(0.16, 2.06, 0.04); pivot.add(antenna);
  const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), glow); antTip.position.set(0.16, 2.22, 0.04); pivot.add(antTip);

  // ----- arms (upper + forearm + glove), hold the gun forward -----
  const mkArm = (sx) => {
    const grp = new THREE.Group(); grp.position.set(sx, 1.52, -0.02); grp.rotation.x = 1.35;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.18), suit); upper.position.y = -0.16;
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.32, 0.16), armor); fore.position.y = -0.46;
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.18), dark); glove.position.y = -0.64;
    grp.add(upper, fore, glove); pivot.add(grp); return grp;
  };
  const armL = mkArm(-0.34), armR = mkArm(0.34);

  const gunParts = buildGun({ glow: accent });
  const gun = gunParts.group;
  gun.position.set(0.24, 1.42, -0.34);
  pivot.add(gun);

  return { root, pivot, legL, legR, armL, armR, gun, muzzle: gunParts.muzzle, head, body: torso };
}

// Multiply a hex colour toward black (used to derive a bot's dark bodysuit from
// its bright team colour, so the whole fighter still reads as that colour).
function darkenHex(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return c.getHex();
}
