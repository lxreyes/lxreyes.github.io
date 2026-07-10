// ============================================================
// dungeon.js — procedural dungeon generation.
// The crypt is a stack of floors; each floor is a grid of rooms
// (like Binding of Isaac) grown as a tree from the start room,
// so every room is guaranteed reachable.
//
// On floors above the bottom, the deepest room holds the central
// elevator (guarded!). On the bottom floor it holds the boss.
// Ordinary rooms are furnished: storage, libraries, tomb niches —
// and every floor hides one brewery, one forge, and one secret room.
// ============================================================

const DIRS = [
  { d: 'N', x: 0, y: -1, opp: 'S' },
  { d: 'S', x: 0, y: 1,  opp: 'N' },
  { d: 'E', x: 1, y: 0,  opp: 'W' },
  { d: 'W', x: -1, y: 0, opp: 'E' },
];

function roomKey(x, y) { return x + ',' + y; }

// The Founder's Rest: a short landing and the boss chamber.
function generateBossLair() {
  const rooms = new Map();
  const start = makeRoom(0, 0, 0);
  start.type = 'start';
  start.cleared = true;
  start.visited = true;
  start.seen = true;
  rooms.set(roomKey(0, 0), start);

  const lair = makeRoom(0, -1, 1);
  lair.type = 'boss';
  lair.biome = 0;
  start.doors.N = roomKey(0, -1);
  lair.doors.S = roomKey(0, 0);
  rooms.set(roomKey(0, -1), lair);

  addLantern(start);
  return { rooms, start };
}

function generateDungeon(targetRooms) {
  const rooms = new Map();

  const start = makeRoom(0, 0, 0);
  start.type = 'start';
  start.cleared = true;
  start.visited = true;
  start.seen = true;
  rooms.set(roomKey(0, 0), start);

  // Grow the floor as a winding walk: usually extend the frontier
  // (long snaking paths that demand exploring), sometimes branch off
  // an older room.
  let placed = 1, guard = 0;
  let frontier = start;
  while (placed < targetRooms && guard++ < 1200) {
    const all = [...rooms.values()];
    const from = Math.random() < 0.65 ? frontier : all[Math.floor(Math.random() * all.length)];
    const dir = DIRS[Math.floor(Math.random() * 4)];
    const nx = from.x + dir.x, ny = from.y + dir.y;
    if (rooms.has(roomKey(nx, ny))) { frontier = all[Math.floor(Math.random() * all.length)]; continue; }

    const room = makeRoom(nx, ny, from.depth + 1);
    from.doors[dir.d] = roomKey(nx, ny);
    room.doors[dir.opp] = roomKey(from.x, from.y);
    rooms.set(roomKey(nx, ny), room);
    frontier = room;
    placed++;
  }

  // Guarantee a proper trek: if the layout came out compact, extend
  // a chain from the deepest room until the far end is genuinely far.
  const minDepth = Math.ceil(targetRooms / 3) + 1;
  let depthGuard = 0;
  while (depthGuard++ < 200) {
    let deepest0 = null;
    rooms.forEach(r => { if (!deepest0 || r.depth > deepest0.depth) deepest0 = r; });
    if (deepest0.depth >= minDepth) break;
    const dirs2 = shuffle([...DIRS]);
    let extended = false;
    for (const dir of dirs2) {
      const nx = deepest0.x + dir.x, ny = deepest0.y + dir.y;
      if (rooms.has(roomKey(nx, ny))) continue;
      const room = makeRoom(nx, ny, deepest0.depth + 1);
      deepest0.doors[dir.d] = roomKey(nx, ny);
      room.doors[dir.opp] = roomKey(deepest0.x, deepest0.y);
      rooms.set(roomKey(nx, ny), room);
      extended = true;
      break;
    }
    if (!extended) break; // boxed in on all sides; accept the layout
  }

  // Winding paths make few natural dead ends; stub in side rooms so
  // the specials always have places to live (and there's more to find).
  let stubGuard = 0;
  const countDeadEnds = () => [...rooms.values()].filter(r =>
    r.type === 'normal' && Object.keys(r.doors).length === 1).length;
  while (countDeadEnds() < 7 && stubGuard++ < 300) {
    const all = [...rooms.values()];
    const from = all[Math.floor(Math.random() * all.length)];
    const dir = DIRS[Math.floor(Math.random() * 4)];
    const nx = from.x + dir.x, ny = from.y + dir.y;
    if (rooms.has(roomKey(nx, ny))) continue;
    const room = makeRoom(nx, ny, from.depth + 1);
    from.doors[dir.d] = roomKey(nx, ny);
    room.doors[dir.opp] = roomKey(from.x, from.y);
    rooms.set(roomKey(nx, ny), room);
  }

  // Deepest room: the keymaster's hall — a mini boss holding the
  // Elevator Gear you need to ride deeper.
  let deepest = null;
  rooms.forEach(r => {
    if (r.type !== 'start' && (!deepest || r.depth > deepest.depth)) deepest = r;
  });
  deepest.type = 'guardian';

  // Special dead-end rooms (exactly one door): treasure hoard,
  // then the shop, then the shrine.
  const deadEnds = [...rooms.values()].filter(r =>
    r.type === 'normal' && Object.keys(r.doors).length === 1);
  shuffle(deadEnds);
  if (deadEnds.length > 0) {
    const t = deadEnds.pop();
    t.type = 'treasure';
    t.cleared = true;
    // the hoard sits on a dais in the middle — one chest model,
    // three very different hauls
    t.chests.push(makeChest(W / 2 - 90, H / 2, 'silver'));
    t.chests.push(makeChest(W / 2, H / 2 - 10, 'gold'));
    t.chests.push(makeChest(W / 2 + 90, H / 2, 'wood'));
  }
  if (deadEnds.length > 0) {
    const s = deadEnds.pop();
    s.type = 'shop';
    s.cleared = true;
    const stock = shuffle(Object.keys(SHOP_ITEMS)).slice(0, 3);
    s.shopItems = stock.map((id, i) => ({
      id, sold: false,
      x: W / 2 + (i - 1) * 150,
      y: H / 2 + 40,
    }));
  }
  // Remaining dead ends draw from a shuffled pool of special rooms,
  // so every floor gets a different mix.
  const specials = ['puzzle'].concat(shuffle(['shrine', 'arena', 'spring', 'prison', 'puzzle', 'puzzle', 'gauntlet', 'vault']));
  while (deadEnds.length > 0 && specials.length > 0) {
    const r = deadEnds.pop();
    const kind = specials.shift();
    r.type = kind;
    r.cleared = true;
    if (kind === 'puzzle') {
      r.puzzle = makePuzzle();
    } else if (kind === 'arena') {
      r.arena = { state: 'idle', t: 0 };
    } else if (kind === 'spring') {
      r.springUsed = false;
    } else if (kind === 'prison') {
      r.prisonOpened = false;
    } else if (kind === 'gauntlet') {
      r.gauntlet = { state: 'idle', t: 0, spawnT: 0 };
    } else if (kind === 'vault') {
      r.tollPaid = false;
      r.chests.push(makeChest(W / 2 - 60, H / 2, 'gold'));
      r.chests.push(makeChest(W / 2 + 60, H / 2, 'silver'));
    }
  }

  // Interiors: every ordinary room gets a theme. One room is always
  // the brewery (brewing stand) and one the forge (crafting table).
  const normals = shuffle([...rooms.values()].filter(r => r.type === 'normal'));
  if (normals.length >= 2) {
    normals[0].interior = 'brewery';
    normals[1].interior = 'forge';
    for (let i = 2; i < normals.length; i++) {
      normals[i].interior = INTERIOR_POOL[Math.floor(Math.random() * INTERIOR_POOL.length)];
    }
  } else if (normals.length === 1) {
    normals[0].interior = 'workshop'; // both stations crammed together
  }
  normals.forEach(furnishRoom);

  // Stone pillars only in undecorated rooms.
  normals.forEach(r => {
    if (r.interior !== 'plain') return;
    const n = Math.floor(Math.random() * 4);
    let tries = 0;
    while (r.pillars.length < n && tries++ < 30) {
      const x = IX0 + 130 + Math.random() * (IX1 - IX0 - 260);
      const y = IY0 + 110 + Math.random() * (IY1 - IY0 - 220);
      const inDoorLaneX = x > GX0 - 60 && x < GX1 + 60;
      const inDoorLaneY = y > GY0 - 60 && y < GY1 + 60;
      if (inDoorLaneX && inDoorLaneY) continue;
      if ((inDoorLaneX && (r.doors.N || r.doors.S)) ||
          (inDoorLaneY && (r.doors.E || r.doors.W))) continue;
      if (r.pillars.some(p => Math.hypot(p.x - x, p.y - y) < 90)) continue;
      r.pillars.push({ x, y, r: 24 });
    }
  });

  // Pre-placed loot chests, tucked sensibly against the walls.
  // A few of them are lying about being chests.
  normals.forEach(r => {
    if (Math.random() < 0.4) {
      const spot = findAnchor(r);
      if (spot) {
        const c = makeChest(spot.x, spot.y, Math.random() < 0.18 ? 'silver' : 'wood');
        if (Math.random() < 0.08) c.mimic = true;
        r.chests.push(c);
      }
    }
  });

  // Interior perks: armories rack spare gear, gardens sprout
  // materials, chapels keep a heart lit.
  normals.forEach(r => {
    if (r.interior === 'armory' && Math.random() < 0.5) {
      const rack = r.furniture.find(f => f.kind === 'rack');
      if (rack) {
        const ids = Object.keys(EQUIPMENT);
        r.loot.equip.push({
          x: rack.x, y: rack.y + rack.h / 2 + 26,
          def: EQUIPMENT[ids[Math.floor(Math.random() * ids.length)]], t: 0,
        });
      }
    } else if (r.interior === 'garden') {
      for (let g = 0; g < 2 + Math.floor(Math.random() * 2); g++) {
        r.loot.mats.push({
          x: IX0 + 120 + Math.random() * (IX1 - IX0 - 240),
          y: IY0 + 100 + Math.random() * (IY1 - IY0 - 200),
          id: Math.random() < 0.6 ? 'gel' : 'wing', t: Math.random() * 6,
        });
      }
    } else if (r.interior === 'chapel') {
      const altar = r.furniture.find(f => f.kind === 'altar');
      if (altar) r.loot.hearts.push({ x: altar.x, y: altar.y + altar.h / 2 + 26, heal: 30 });
    }
  });

  // Standing lanterns in the rooms that matter — their light keeps
  // the Shade at arm's length.
  rooms.forEach(r => {
    if (['start', 'guardian', 'shop', 'treasure', 'shrine', 'spring'].includes(r.type)) addLantern(r);
  });

  // Hidden rooms sealed behind cracked walls — up to two per floor,
  // each hiding a different kind of windfall.
  addSecretRoom(rooms);
  addSecretRoom(rooms);

  return { rooms, start };
}

function addSecretRoom(rooms) {
  const laneFor = d =>
    d === 'N' ? { x0: GX0 - 36, x1: GX1 + 36, y0: IY0, y1: IY0 + 150 }
    : d === 'S' ? { x0: GX0 - 36, x1: GX1 + 36, y0: IY1 - 150, y1: IY1 }
    : d === 'W' ? { x0: IX0, x1: IX0 + 150, y0: GY0 - 36, y1: GY1 + 36 }
    : { x0: IX1 - 150, x1: IX1, y0: GY0 - 36, y1: GY1 + 36 };

  const hosts = shuffle([...rooms.values()].filter(r => r.type !== 'secret'));
  for (const host of hosts) {
    const dirs = shuffle([...DIRS]);
    for (const dir of dirs) {
      const nx = host.x + dir.x, ny = host.y + dir.y;
      if (rooms.has(roomKey(nx, ny))) continue;
      // the hidden doorway must not already be furnished shut
      const l = laneFor(dir.d);
      const laneBlocked =
        host.furniture.some(f =>
          f.x + f.w / 2 > l.x0 && f.x - f.w / 2 < l.x1 &&
          f.y + f.h / 2 > l.y0 && f.y - f.h / 2 < l.y1) ||
        host.pillars.some(pp =>
          pp.x + pp.r > l.x0 && pp.x - pp.r < l.x1 &&
          pp.y + pp.r > l.y0 && pp.y - pp.r < l.y1);
      if (laneBlocked) continue;

      const secret = makeRoom(nx, ny, host.depth + 1);
      secret.type = 'secret';
      secret.cleared = true;
      secret.discovered = false;
      host.doors[dir.d] = roomKey(nx, ny);
      secret.doors[dir.opp] = roomKey(host.x, host.y);
      stockSecretRoom(secret, rooms);
      rooms.set(roomKey(nx, ny), secret);
      return;
    }
  }
}

// What's behind the cracked wall? One of four kinds of windfall.
function stockSecretRoom(secret, rooms) {
  const used = [...rooms.values()].filter(r => r.type === 'secret').map(r => r.secretKind);
  const kinds = shuffle(['hoard', 'armory', 'grove', 'bank'].filter(k => !used.includes(k)));
  const kind = kinds[0] || 'hoard';
  secret.secretKind = kind;

  if (kind === 'hoard') {
    // the classic: two chests and loose gems
    secret.chests.push(makeChest(W / 2 - 60, H / 2, 'gold'));
    secret.chests.push(makeChest(W / 2 + 60, H / 2, 'silver'));
    for (let g = 0; g < 2; g++) {
      secret.loot.coins.push({
        x: W / 2 + (g === 0 ? -130 : 130), y: H / 2 + 40,
        vx: 0, vy: 0, gem: true, val: 35 + Math.floor(Math.random() * 25),
        t: Math.random() * 6,
      });
    }
  } else if (kind === 'armory') {
    // a forgotten cache of gear
    const ids = shuffle(Object.keys(EQUIPMENT));
    for (let i = 0; i < 3; i++) {
      secret.loot.equip.push({
        x: W / 2 + (i - 1) * 110, y: H / 2,
        def: EQUIPMENT[ids[i % ids.length]], t: Math.random() * 6,
      });
    }
    secret.chests.push(makeChest(W / 2, H / 2 + 110, 'wood'));
  } else if (kind === 'grove') {
    // something green survived down here
    for (let i = 0; i < 6; i++) {
      const mats = ['gel', 'wing', 'bone', 'scrap', 'essence'];
      secret.loot.mats.push({
        x: IX0 + 140 + Math.random() * (IX1 - IX0 - 280),
        y: IY0 + 120 + Math.random() * (IY1 - IY0 - 240),
        id: mats[Math.floor(Math.random() * mats.length)], t: Math.random() * 6,
      });
    }
    secret.loot.hearts.push({ x: W / 2 - 50, y: H / 2, heal: 20, food: true });
    secret.loot.hearts.push({ x: W / 2 + 50, y: H / 2, heal: 20, food: true });
    secret.loot.hearts.push({ x: W / 2, y: H / 2 - 60, heal: 30 });
  } else {
    // the bank: somebody's rainy-day pile
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      secret.loot.coins.push({
        x: W / 2 + Math.cos(a) * (40 + Math.random() * 50),
        y: H / 2 + Math.sin(a) * (30 + Math.random() * 40),
        vx: 0, vy: 0, val: 6 + Math.floor(Math.random() * 8), t: Math.random() * 6,
      });
    }
    for (let g = 0; g < 3; g++) {
      secret.loot.coins.push({
        x: W / 2 + (g - 1) * 70, y: H / 2 - 70,
        vx: 0, vy: 0, gem: true, val: 40 + Math.floor(Math.random() * 25),
        t: Math.random() * 6,
      });
    }
  }
}

function makeRoom(x, y, depth) {
  return {
    x, y, depth,
    type: 'normal',
    doors: {},          // e.g. { N: '0,-1' } — direction -> key of neighbor
    cleared: false,     // true once all enemies are dead
    visited: false,     // player has stood in this room
    seen: false,        // shows on the minimap (visited or adjacent)
    spawned: false,     // enemies have been created for this room
    discovered: true,   // secret rooms start false (wall looks solid)
    unlockT: 0,         // door-bars slide-away animation timer
    interior: 'plain',  // decor theme: storage / library / tombs / brewery / forge
    furniture: [],      // solid furnishings: {x, y, w, h, kind}
    chests: [],         // loot chests in this room
    shopItems: null,    // merchant stock, if this is a shop room
    shrineUsed: false,  // each shrine answers one prayer
    pillars: [],        // stone pillars that block movement and shots
    biome: Math.random() < 0.35 ? 1 : 0, // 0 = floor default, 1 = sub-biome
    loot: { coins: [], hearts: [], items: [], cells: [], mats: [], equip: [] },
  };
}

function makeChest(x, y, tier) {
  return { x, y, tier, opened: false, looted: false, openT: 0, spawnT: 0 };
}

// Eleven kinds of puzzle; the room rolls one.
function makePuzzle() {
  const kind = ['seq', 'path', 'levers', 'targets', 'push', 'lightsout',
    'orbs', 'statues', 'beacons', 'counting', 'vigil'][Math.floor(Math.random() * 11)];

  if (kind === 'counting') {
    // five numbered stones; press them in ascending order
    const spots = shuffle([
      { x: W / 2 - 220, y: H / 2 - 80 }, { x: W / 2 + 40, y: H / 2 - 120 },
      { x: W / 2 + 220, y: H / 2 - 40 }, { x: W / 2 - 80, y: H / 2 + 90 },
      { x: W / 2 + 140, y: H / 2 + 110 },
    ]);
    return {
      kind, solved: false, next: 1,
      stones: spots.map((sp, i) => ({ x: sp.x, y: sp.y, n: i + 1, lit: false })),
    };
  }

  if (kind === 'vigil') {
    // stand in the circle while the dark objects to it
    return {
      kind, solved: false, started: false, t: 0, window: 8, wave: 0,
      x: W / 2, y: H / 2, r: 95,
    };
  }

  if (kind === 'orbs') {
    // six rune stones, three matching pairs — find them
    const syms = shuffle([0, 0, 1, 1, 2, 2]);
    const stones = [];
    for (let i = 0; i < 6; i++) {
      stones.push({
        x: W / 2 + ((i % 3) - 1) * 150,
        y: H / 2 + (Math.floor(i / 3) - 0.5) * 130,
        sym: syms[i], revealed: false, matched: false,
      });
    }
    return { kind, stones, first: -1, hideT: 0, solved: false };
  }

  if (kind === 'statues') {
    // turning one statue turns its neighbors; face them all north
    const facing = [0, 0, 0, 0];
    const press = i => {
      for (const j of [i - 1, i, i + 1]) {
        if (j >= 0 && j < 4) facing[j] = (facing[j] + 1) % 4;
      }
    };
    for (let k = 0; k < 3 + Math.floor(Math.random() * 4); k++) {
      press(Math.floor(Math.random() * 4));
    }
    if (facing.every(f => f === 0)) press(Math.floor(Math.random() * 4));
    return {
      kind, facing, solved: false,
      statues: [0, 1, 2, 3].map(i => ({ x: W / 2 + (i - 1.5) * 140, y: H / 2 })),
    };
  }

  if (kind === 'beacons') {
    // light one brazier, then reach the other before the flame dies
    return {
      kind, solved: false, litA: false, timer: 0, window: 4,
      a: { x: IX0 + 90, y: IY1 - 90 },
      b: { x: IX1 - 90, y: IY0 + 90 },
    };
  }

  if (kind === 'push') {
    // shove the stones into their sockets
    return {
      kind, solved: false,
      blocks: [
        { x: W / 2 - 70, y: H / 2 - 40, w: 40, h: 40 },
        { x: W / 2 + 70, y: H / 2 + 40, w: 40, h: 40 },
      ],
      sockets: [
        { x: W / 2 - 190, y: H / 2 + 80 },
        { x: W / 2 + 190, y: H / 2 - 80 },
      ],
    };
  }

  if (kind === 'lightsout') {
    // press a lantern: it and its neighbors flip. Light all nine.
    const grid = 3;
    const cells = new Array(grid * grid).fill(true);
    const press = i => {
      const cx = i % grid, cy = Math.floor(i / grid);
      [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx2 = cx + dx, ny2 = cy + dy;
        if (nx2 >= 0 && nx2 < grid && ny2 >= 0 && ny2 < grid) {
          cells[ny2 * grid + nx2] = !cells[ny2 * grid + nx2];
        }
      });
    };
    // scramble from the solved state so it's always solvable
    for (let k = 0; k < 4 + Math.floor(Math.random() * 3); k++) {
      press(Math.floor(Math.random() * grid * grid));
    }
    if (cells.every(v => v)) press(4);
    const nodes = [];
    for (let i = 0; i < grid * grid; i++) {
      nodes.push({
        x: W / 2 + ((i % grid) - 1) * 120,
        y: H / 2 + (Math.floor(i / grid) - 1) * 100,
      });
    }
    return { kind, grid, cells, nodes, solved: false };
  }

  if (kind === 'seq') {
    const seq = [];
    while (seq.length < 4) {
      const n = Math.floor(Math.random() * 3);
      if (seq.length && seq[seq.length - 1] === n) continue;
      seq.push(n);
    }
    return {
      kind, seq, progress: 0, solved: false, lastPlate: -1,
      plates: [
        { x: W / 2 - 140, y: H / 2 + 50 },
        { x: W / 2, y: H / 2 - 50 },
        { x: W / 2 + 140, y: H / 2 + 50 },
      ],
    };
  }

  if (kind === 'path') {
    // a safe route across a treacherous floor, one tile per column
    const cols = 5, rows = 4, tile = 64;
    const safe = [Math.floor(Math.random() * rows)];
    for (let c = 1; c < cols; c++) {
      const prev = safe[c - 1];
      const opts = [prev, Math.max(0, prev - 1), Math.min(rows - 1, prev + 1)];
      safe.push(opts[Math.floor(Math.random() * opts.length)]);
    }
    const ox = W / 2 - (cols * tile) / 2;
    const oy = H / 2 - (rows * tile) / 2;
    return { kind, safe, cols, rows, tile, ox, oy, solved: false, armed: false, zapT: 0,
      plaque: { x: ox - 54, y: H / 2 } };
  }

  if (kind === 'levers') {
    // each lever flips itself and its neighbors; light all three lamps
    let state;
    do {
      state = [Math.random() < 0.5, Math.random() < 0.5, Math.random() < 0.5];
    } while (state.every(v => v));
    return {
      kind, state, solved: false,
      levers: [
        { x: W / 2 - 140, y: H / 2 + 10 },
        { x: W / 2, y: H / 2 + 10 },
        { x: W / 2 + 140, y: H / 2 + 10 },
      ],
    };
  }

  // targets: three marks, one clock
  return {
    kind, solved: false, started: false, hit: 0, timer: 0,
    plaque: { x: W / 2, y: H / 2 + 90 },
    spots: [
      { x: IX0 + 100, y: IY0 + 90 },
      { x: IX1 - 100, y: IY0 + 90 },
      { x: W / 2, y: IY1 - 80 },
    ],
  };
}

// Sensible spots for chests and furniture: corners and wall nooks,
// never blocking a door lane.
function wallAnchors() {
  return [
    { x: IX0 + 70, y: IY0 + 64 }, { x: IX1 - 70, y: IY0 + 64 },
    { x: IX0 + 70, y: IY1 - 64 }, { x: IX1 - 70, y: IY1 - 64 },
    { x: 250, y: IY0 + 54 }, { x: 710, y: IY0 + 54 },
    { x: 250, y: IY1 - 54 }, { x: 710, y: IY1 - 54 },
    { x: IX0 + 54, y: 180 }, { x: IX1 - 54, y: 180 },
    { x: IX0 + 54, y: 460 }, { x: IX1 - 54, y: 460 },
  ];
}

function findAnchor(room) {
  const spots = shuffle(wallAnchors());
  for (const s of spots) {
    if (room.furniture.some(f => Math.hypot(f.x - s.x, f.y - s.y) < 70)) continue;
    if (room.chests.some(c => Math.hypot(c.x - s.x, c.y - s.y) < 70)) continue;
    if (room.pillars.some(p => Math.hypot(p.x - s.x, p.y - s.y) < 70)) continue;
    return s;
  }
  return null;
}

// ---------------------------------------------------------
// Furnishing — arranged the way people would actually live:
// rows against walls, clusters in corners, pews facing the altar.
// ---------------------------------------------------------
function pickFreeWall(room) {
  const free = ['N', 'S', 'E', 'W'].filter(d => !room.doors[d]);
  return free.length ? free[Math.floor(Math.random() * free.length)] : 'N';
}

// The walking corridors in front of each door. Furniture that
// intersects one (padded by a hero's width) would block the way in.
function blocksDoorLane(room, x, y, w, h) {
  const pad = 36;
  const lanes = [];
  if (room.doors.N) lanes.push({ x0: GX0 - pad, x1: GX1 + pad, y0: IY0, y1: IY0 + 150 });
  if (room.doors.S) lanes.push({ x0: GX0 - pad, x1: GX1 + pad, y0: IY1 - 150, y1: IY1 });
  if (room.doors.W) lanes.push({ x0: IX0, x1: IX0 + 150, y0: GY0 - pad, y1: GY1 + pad });
  if (room.doors.E) lanes.push({ x0: IX1 - 150, x1: IX1, y0: GY0 - pad, y1: GY1 + pad });
  return lanes.some(l =>
    x + w / 2 > l.x0 && x - w / 2 < l.x1 &&
    y + h / 2 > l.y0 && y - h / 2 < l.y1);
}

// Place one piece, unless it would block a doorway.
function placePiece(room, x, y, w, h, kind) {
  if (blocksDoorLane(room, x, y, w, h)) return;
  room.furniture.push({ x, y, w, h, kind });
}

// The brewing stand and crafting table are load-bearing: if the row
// couldn't fit them, fall back to any safe wall anchor.
function ensurePiece(room, kind, w, h) {
  if (room.furniture.some(f => f.kind === kind)) return;
  const a = findAnchor(room);
  if (a && !blocksDoorLane(room, a.x, a.y, w, h)) {
    room.furniture.push({ x: a.x, y: a.y, w, h, kind });
  }
}

// A row of furniture shoulder-to-shoulder against a wall. If the
// wall has a door, the row shifts aside instead of straddling it.
function wallRow(room, side, items, inset = 18) {
  const gap = 12;
  if (side === 'N' || side === 'S') {
    const cx = room.doors[side] ? 236 : W / 2;
    const total = items.reduce((a, it) => a + it.w, 0) + gap * (items.length - 1);
    let x = cx - total / 2;
    for (const it of items) {
      const y = side === 'N' ? IY0 + inset + it.h / 2 : IY1 - inset - it.h / 2;
      placePiece(room, x + it.w / 2, y, it.w, it.h, it.kind);
      x += it.w + gap;
    }
  } else {
    const cy = room.doors[side] ? 150 : H / 2;
    const total = items.reduce((a, it) => a + it.h, 0) + gap * (items.length - 1);
    let y = cy - total / 2;
    for (const it of items) {
      const x = side === 'W' ? IX0 + inset + it.w / 2 : IX1 - inset - it.w / 2;
      placePiece(room, x, y + it.h / 2, it.w, it.h, it.kind);
      y += it.h + gap;
    }
  }
}

// A corner of the room, preferring corners away from the doors.
function roomCorner(room) {
  const cs = [
    { x: IX0 + 62, y: IY0 + 56, bad: !!(room.doors.N || room.doors.W) },
    { x: IX1 - 62, y: IY0 + 56, bad: !!(room.doors.N || room.doors.E) },
    { x: IX0 + 62, y: IY1 - 56, bad: !!(room.doors.S || room.doors.W) },
    { x: IX1 - 62, y: IY1 - 56, bad: !!(room.doors.S || room.doors.E) },
  ];
  const good = cs.filter(c => !c.bad);
  const pool = good.length ? good : cs;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Crates and barrels stacked into a corner, the way storage happens.
function cornerCluster(room, kinds, size) {
  const c = roomCorner(room);
  const sx = c.x < W / 2 ? 1 : -1;
  const sy = c.y < H / 2 ? 1 : -1;
  kinds.forEach((kind, i) => {
    placePiece(room,
      c.x + (i % 2) * (size + 8) * sx,
      c.y + Math.floor(i / 2) * (size + 8) * sy,
      size, size, kind);
  });
}

// A standing lantern in a free corner. Its light matters (see SHADE).
function addLantern(room) {
  if (room.furniture.some(f => f.kind === 'lantern')) return;
  const cs = shuffle([
    { x: IX0 + 52, y: IY0 + 52 }, { x: IX1 - 52, y: IY0 + 52 },
    { x: IX0 + 52, y: IY1 - 52 }, { x: IX1 - 52, y: IY1 - 52 },
  ]);
  for (const c of cs) {
    if (room.furniture.some(f => Math.hypot(f.x - c.x, f.y - c.y) < 64)) continue;
    if (room.chests.some(ch => Math.hypot(ch.x - c.x, ch.y - c.y) < 64)) continue;
    room.furniture.push({ x: c.x, y: c.y, w: 18, h: 18, kind: 'lantern' });
    return;
  }
}

function furnishRoom(room) {
  const t = room.interior;
  const side = pickFreeWall(room);

  if (t === 'storage') {
    cornerCluster(room, shuffle(['crate', 'crate', 'barrel', 'crate', 'barrel'])
      .slice(0, 3 + Math.floor(Math.random() * 3)), 30);
  } else if (t === 'library') {
    const shelves = [];
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) shelves.push({ kind: 'shelf', w: 88, h: 26 });
    wallRow(room, side, shelves);
    if (Math.random() < 0.5) cornerCluster(room, ['crate'], 30);
  } else if (t === 'tombs') {
    // coffins in quiet rows along the side walls
    const walls = ['E', 'W'].filter(d => !room.doors[d]);
    for (const w2 of (walls.length ? walls : [side])) {
      wallRow(room, w2, [{ kind: 'coffin', w: 30, h: 52 }, { kind: 'coffin', w: 30, h: 52 }]);
    }
  } else if (t === 'kitchen') {
    wallRow(room, side, [
      { kind: 'shelf', w: 88, h: 26 },
      { kind: 'stove', w: 40, h: 30 },
      { kind: 'pot', w: 34, h: 30 },
    ]);
    cornerCluster(room, ['crate', 'barrel'], 30);
  } else if (t === 'bar') {
    wallRow(room, side, [
      { kind: 'counter', w: 96, h: 26 },
      { kind: 'keg', w: 32, h: 30 },
    ]);
    // stools pulled up in front of the counter
    const counter = room.furniture.find(f => f.kind === 'counter');
    if (counter) {
      const ox = side === 'W' ? 46 : side === 'E' ? -46 : 0;
      const oy = side === 'N' ? 46 : side === 'S' ? -46 : 0;
      for (const d of [-26, 26]) {
        placePiece(room,
          counter.x + ox + (ox === 0 ? d : 0),
          counter.y + oy + (oy === 0 ? d : 0),
          18, 18, 'stool');
      }
    }
    cornerCluster(room, ['barrel', 'barrel'], 30);
  } else if (t === 'armory') {
    wallRow(room, side, [{ kind: 'rack', w: 88, h: 26 }, { kind: 'rack', w: 88, h: 26 }]);
    cornerCluster(room, ['crate'], 30);
  } else if (t === 'barracks') {
    // a couple of bunks in a neat row against one wall
    wallRow(room, side, [
      { kind: 'bunk', w: 56, h: 28 },
      { kind: 'bunk', w: 56, h: 28 },
      { kind: 'bunk', w: 56, h: 28 },
    ]);
    cornerCluster(room, ['crate', 'crate'], 30); // footlockers
  } else if (t === 'garden') {
    wallRow(room, side, [{ kind: 'planter', w: 44, h: 24 }, { kind: 'planter', w: 44, h: 24 }], 90);
    cornerCluster(room, ['barrel'], 30); // the water barrel
  } else if (t === 'brewery') {
    wallRow(room, side, [
      { kind: 'shelf', w: 88, h: 26 },
      { kind: 'brew', w: 44, h: 32 },
      { kind: 'barrel', w: 30, h: 30 },
      { kind: 'barrel', w: 30, h: 30 },
    ]);
    ensurePiece(room, 'brew', 44, 32);
  } else if (t === 'forge') {
    wallRow(room, side, [
      { kind: 'craft', w: 50, h: 38 },
      { kind: 'anvil', w: 36, h: 24 },
    ]);
    cornerCluster(room, ['crate'], 30);
    ensurePiece(room, 'craft', 50, 38);
  } else if (t === 'workshop') {
    wallRow(room, side, [
      { kind: 'brew', w: 44, h: 32 },
      { kind: 'craft', w: 50, h: 38 },
    ]);
    ensurePiece(room, 'brew', 44, 32);
    ensurePiece(room, 'craft', 50, 38);
  } else if (t === 'chapel') {
    wallRow(room, side, [{ kind: 'altar', w: 40, h: 26 }]);
    // pews in two rows, facing the altar
    const pewC = room.doors[side] ? (side === 'N' || side === 'S' ? 236 : 150)
      : (side === 'N' || side === 'S' ? W / 2 : H / 2);
    for (let row = 0; row < 2; row++) {
      const d = 96 + row * 44;
      if (side === 'N' || side === 'S') {
        const y = side === 'N' ? IY0 + d : IY1 - d;
        placePiece(room, pewC - 45, y, 70, 22, 'pew');
        placePiece(room, pewC + 45, y, 70, 22, 'pew');
      } else {
        const x = side === 'W' ? IX0 + d : IX1 - d;
        placePiece(room, x, pewC - 45, 22, 70, 'pew');
        placePiece(room, x, pewC + 45, 22, 70, 'pew');
      }
    }
  }

  // most lived-in rooms kept a lantern burning
  if (t !== 'plain' || Math.random() < 0.6) addLantern(room);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Decide what enemies live in a room, based on which floor of the
// crypt we're on and how many times the lineage has won (new game+).
function enemyPlanFor(room, floor, wins) {
  if (room.type === 'boss') return [{ type: 'boss' }];

  const level = wins * 3 + floor;

  if (room.type === 'guardian') {
    // The keymaster and a couple of retainers.
    return [{ type: 'guardian' }, { type: 'skeleton' }, { type: 'skeleton' }];
  }

  if (room.type !== 'normal') return [];
  const extra = room.interior === 'barracks' ? 2 : 0; // the garrison never left
  const count = Math.min(2 + extra + Math.floor(room.depth * 0.7 + level * 0.8), 9);
  const pool = (floor === 0 && wins === 0 && room.depth < 2)
    ? ['rat', 'rat', 'slime'] : floorPool(floor);
  const plan = [];
  for (let i = 0; i < count; i++) {
    plan.push({ type: pool[Math.floor(Math.random() * pool.length)] });
  }
  return plan;
}

// Who lives where: each floor has its locals plus the usual vermin.
function floorPool(floor) {
  if (floor === 0) return ['rat', 'rat', 'slime', 'slime', 'bat'];           // the Sewers
  if (floor === 1) return ['golem', 'slime', 'bat', 'skeleton', 'rat'];      // the Mines
  if (floor === 2) return ['sparker', 'sparker', 'turret', 'skeleton', 'slime']; // the Factory
  if (floor === 3) return ['frostling', 'frostling', 'skeleton', 'bat', 'turret']; // the Frozen Deep
  return ['imp', 'imp', 'skeleton', 'sparker', 'turret'];                    // the Hellmouth
}
