// ============================================================
// config.js — all game DATA lives here (no logic).
// Adding a new class, trait, or enemy = adding an entry below.
// ============================================================

const W = 960, H = 640, TILE = 64;
// Inner playable bounds (inside the 1-tile-thick walls)
const IX0 = 64, IX1 = W - 64, IY0 = 64, IY1 = H - 64;
// Door gap edges: N/S doors span GX0..GX1 in x, E/W doors span GY0..GY1 in y
const GX0 = 432, GX1 = 528, GY0 = 272, GY1 = 368;

// Each class has a unique PASSIVE (always on), an attack style
// ('melee' | 'bolt' | 'arrow' | 'flask'), and a SPECIAL on SHIFT.
// Classes with an `unlock` cost start locked and are bought at the Estate.
const CLASSES = {
  knight: {
    name: 'Knight', color: '#8fb4ff',
    hp: 100, speed: 210, dmg: 20, cd: 0.45, crit: 0.05, attack: 'melee',
    desc: 'Balanced and dependable',
    kit: { offhand: 'boneshield', items: ['potion'] },
    passive: 'Aegis — absorbs one hit every 8s',
    flags: { aegis: true },
    special: { id: 'block', name: 'Shield Wall', desc: 'Blocks blows and bolts, shoves foes back', cd: 5 },
  },
  rogue: {
    name: 'Rogue', color: '#9dffa5',
    hp: 70, speed: 260, dmg: 15, cd: 0.28, crit: 0.30, attack: 'melee',
    desc: 'Fast and fragile, deadly crits',
    kit: { items: ['swift', 'potion'] },
    passive: 'First Strike — always crits fresh foes',
    flags: { firstStrike: true },
    special: { id: 'dash', name: 'Dodge Roll', desc: 'Quick dash through danger', cd: 2 },
  },
  barbarian: {
    name: 'Barbarian', color: '#ff9a66',
    hp: 150, speed: 175, dmg: 30, cd: 0.65, crit: 0.05, attack: 'melee',
    desc: 'Slow, but hits like a wagon',
    task: { stat: 'kills', need: 40, text: 'Slay 40 monsters' },
    kit: { weapon: 'boneclub' },
    passive: 'Rage — up to +60% damage as HP drops',
    flags: { rage: true },
    special: { id: 'spin', name: 'Whirlwind', desc: 'Spin attack hits everything nearby', cd: 5 },
  },
  mage: {
    name: 'Mage', color: '#d9a5ff',
    hp: 65, speed: 205, dmg: 14, cd: 0.5, crit: 0.10, attack: 'bolt',
    desc: 'Flings bolts from a safe distance',
    task: { stat: 'blessings', need: 6, text: 'Receive 6 blessings' },
    kit: { items: ['potion', 'bomb'] },
    passive: 'Piercing — bolts punch through a foe',
    flags: { pierce: 1 },
    special: { id: 'nova', name: 'Arcane Nova', desc: 'Ring of bolts in all directions', cd: 5 },
  },
  ranger: {
    name: 'Ranger', color: '#8ee86a',
    hp: 75, speed: 230, dmg: 17, cd: 0.38, crit: 0.10, attack: 'arrow',
    desc: 'Longshots from the dark',
    task: { stat: 'chests', need: 15, text: 'Open 15 chests' },
    kit: { items: ['swift'] },
    passive: 'Deadeye — up to +60% damage at range',
    flags: { deadeye: true },
    special: { id: 'volley', name: 'Volley', desc: 'A fan of five arrows', cd: 5 },
  },
  paladin: {
    name: 'Paladin', color: '#ffe08a',
    hp: 120, speed: 190, dmg: 22, cd: 0.55, crit: 0.05, attack: 'melee',
    desc: 'Faith keeps the blood flowing',
    task: { stat: 'retires', need: 2, text: 'Retire alive twice' },
    kit: { armor: 'bonearmor' },
    passive: 'Devotion — regen never pauses',
    flags: { devotion: true },
    special: { id: 'sanctuary', name: 'Sanctuary', desc: 'Holy ground that heals you', cd: 9 },
  },
  shinobi: {
    name: 'Shinobi', color: '#7de8ff',
    hp: 55, speed: 285, dmg: 24, cd: 0.32, crit: 0.15, attack: 'melee',
    desc: 'Blinding speed, paper armor',
    task: { stat: 'puzzles', need: 3, text: 'Solve 3 puzzle rooms' },
    kit: { items: ['swift', 'swift'] },
    passive: 'Combo — hits stack +10% dmg (max +50%)',
    flags: { combo: true },
    special: { id: 'shadowstep', name: 'Shadow Step', desc: 'Teleport forward through enemies', cd: 3 },
  },
  alchemist: {
    name: 'Alchemist', color: '#6ae8c9',
    hp: 80, speed: 210, dmg: 16, cd: 0.6, crit: 0.05, attack: 'flask',
    desc: 'Throws things that explode',
    task: { stat: 'brews', need: 6, text: 'Brew 6 potions' },
    kit: { items: ['bomb', 'bomb', 'potion'] },
    passive: 'Chemist — cheap brews, strong potions',
    flags: { chemist: true },
    special: { id: 'barrage', name: 'Flask Barrage', desc: 'Three flasks in a fan', cd: 6 },
  },
  lich: {
    name: 'Lich', color: '#c9ffb0',
    hp: 60, speed: 200, dmg: 13, cd: 0.5, crit: 0.10, attack: 'bolt', lifesteal: 4,
    desc: 'Kills restore health',
    task: { stat: 'keymasters', need: 5, text: 'Fell 5 keymasters' },
    kit: { items: ['potion'] },
    passive: 'Hunger — homing bolts; kills heal 4',
    flags: { homing: true },
    special: { id: 'soulnova', name: 'Soul Nova', desc: 'Wide ring of hungry souls', cd: 6 },
  },
  necromancer: {
    name: 'Necromancer', color: '#8a6ae8',
    hp: 70, speed: 195, dmg: 12, cd: 0.5, crit: 0.05, attack: 'bolt',
    desc: 'Death is a staffing opportunity',
    task: { stat: 'deaths', need: 6, text: 'Lose 6 heirs' },
    kit: { items: ['potion'] },
    passive: 'Deathcall — kills may raise a skeleton',
    flags: { necro: true },
    special: { id: 'raisedead', name: 'Raise Dead', desc: 'Summon skeletal minions now', cd: 10 },
  },
  beastmaster: {
    name: 'Beastmaster', color: '#c98a4a',
    hp: 85, speed: 220, dmg: 16, cd: 0.45, crit: 0.08, attack: 'melee',
    desc: 'Never hunts alone',
    task: { stat: 'kills', need: 100, text: 'Slay 100 monsters' },
    kit: { items: ['potion'] },
    passive: 'Packleader — a loyal wolf fights beside you',
    flags: { packleader: true },
    special: { id: 'wolves', name: 'Call of the Wild', desc: 'Two more wolves answer', cd: 10 },
  },
  tinkerer: {
    name: 'Tinkerer', color: '#7de8ff',
    hp: 75, speed: 205, dmg: 14, cd: 0.5, crit: 0.05, attack: 'bolt',
    desc: 'Lets the machines argue',
    task: { stat: 'gauntlets', need: 2, text: 'Survive 2 gauntlets' },
    kit: { items: ['bomb', 'potion'] },
    passive: 'Engineer — deployed turrets last until broken',
    flags: { engineer: true },
    special: { id: 'turret', name: 'Deploy Turret', desc: 'Plant a turret where you stand (max 2)', cd: 9 },
  },
  beekeeper: {
    name: 'Beekeeper', color: '#ffd75e',
    hp: 90, speed: 215, dmg: 15, cd: 0.4, crit: 0.08, attack: 'melee',
    desc: 'The hive holds grudges',
    task: { stat: 'puzzles', need: 8, text: 'Solve 8 puzzle rooms' },
    kit: { items: ['potion'] },
    passive: 'Apiary — melee hits may release a bee',
    flags: { beekeeper: true },
    special: { id: 'swarm', name: 'The Swarm', desc: 'Release five very upset bees', cd: 8 },
  },
  revenant: {
    name: 'Revenant', color: '#ff5a5e',
    hp: 55, speed: 225, dmg: 26, cd: 0.4, crit: 0.15, attack: 'melee',
    desc: 'Came back wrong. Came back angry.',
    task: { stat: 'wins', need: 1, text: 'Defeat the Founder' },
    kit: { items: ['potion'] }, // one potion. that's it. hard mode.
    passive: 'Hard Mode — no regen, double gold',
    flags: { hardmode: true },
    special: { id: 'soulnova', name: 'Grave Nova', desc: 'A ring of what it remembers', cd: 6 },
  },
};

// Traits mutate the hero's stats (or set flags the renderer reads).
const TRAITS = {
  gigantism:   { name: 'Gigantism',   desc: '+25% HP, but you are a big target',
                 apply: s => { s.hp *= 1.25; s.radius *= 1.4; } },
  dwarfism:    { name: 'Dwarfism',    desc: 'Tiny and slippery: -15% HP, +10% speed',
                 apply: s => { s.hp *= 0.85; s.radius *= 0.65; s.speed *= 1.1; } },
  hyperactive: { name: 'Hyperactive', desc: '+25% move speed',
                 apply: s => { s.speed *= 1.25; } },
  frail:       { name: 'Frail',       desc: '-30% HP, +40% gold found',
                 apply: s => { s.hp *= 0.7; s.goldMult *= 1.4; } },
  greedy:      { name: 'Greedy',      desc: '+50% gold, -20% damage',
                 apply: s => { s.goldMult *= 1.5; s.dmg *= 0.8; } },
  berserk:     { name: 'Berserker',   desc: '+35% damage, +30% damage taken',
                 apply: s => { s.dmg *= 1.35; s.dmgTaken *= 1.3; } },
  stout:       { name: 'Stout',       desc: '-20% damage taken, -10% speed',
                 apply: s => { s.dmgTaken *= 0.8; s.speed *= 0.9; } },
  myopia:      { name: 'Myopia',      desc: 'Can only see what is nearby',
                 apply: s => { s.myopia = true; } },
  amnesia:     { name: 'Amnesia',     desc: 'Cannot remember the map',
                 apply: s => { s.noMap = true; } },
  colorblind:  { name: 'Colorblind',  desc: 'Sees the crypt in grayscale',
                 apply: s => { s.grayscale = true; } },
  trollblood:  { name: 'Troll Blood', desc: 'Regenerates twice as fast',
                 apply: s => { s.regenMult *= 2; } },
  anemic:      { name: 'Anemic',      desc: 'No regeneration, +30% gold',
                 apply: s => { s.regenMult = 0; s.goldMult *= 1.3; } },
};

// Every hero is a descendant of Sir Greg. Every. Single. One.
const GREG_NAMES = [
  'Greg II', 'Gregory', 'Gregoria', 'Gregwyn', 'Gregbert', 'Gregina',
  'Greglet', 'Gregatha', 'McGreg', 'Gregzilla', 'Gregsworth', 'Gregolas',
  'Gregfried', 'Gregantine', 'Von Greg', 'Greguel', 'Gregette',
  'Gregstopher', 'Grognak Greg', 'Gregory the Bold',
];

const ENEMIES = {
  slime:    { hp: 30, speed: 95,  dmg: 10, r: 18, gold: [3, 6],  color: '#6dd66d' },
  bat:      { hp: 16, speed: 175, dmg: 8,  r: 12, gold: [2, 4],  color: '#b98ae8' },
  skeleton: { hp: 45, speed: 85,  dmg: 12, r: 16, gold: [5, 9],  color: '#e8e2d0' },
  turret:   { hp: 55, speed: 0,   dmg: 11, r: 17, gold: [6, 10], color: '#9aa4b8' },
  // the locals: every floor breeds its own trouble
  rat:      { hp: 12, speed: 215, dmg: 6,  r: 9,  gold: [1, 3],  color: '#9a8a72' },
  golem:    { hp: 95, speed: 55,  dmg: 20, r: 24, gold: [8, 14], color: '#8a8a7a' },
  sparker:  { hp: 28, speed: 150, dmg: 9,  r: 13, gold: [5, 9],  color: '#ffd75e' },
  frostling:{ hp: 35, speed: 90,  dmg: 8,  r: 14, gold: [5, 9],  color: '#9adcff' },
  imp:      { hp: 26, speed: 170, dmg: 10, r: 12, gold: [6, 10], color: '#ff8a5e' },
  mimic:    { hp: 70, speed: 0,   dmg: 14, r: 18, gold: [25, 40], color: '#8a6a3a' },
  guardian: { hp: 190, speed: 125, dmg: 17, r: 26, gold: [30, 50], color: '#d8c9a0' },
  target:   { hp: 1,  speed: 0,   dmg: 0,  r: 14, gold: [0, 0],   color: '#ffd75e' },
  ancestor: { hp: 45, speed: 160, dmg: 11, r: 12, gold: [4, 8],   color: '#c9b8ff' },
  boss:     { hp: 450, speed: 135, dmg: 24, r: 42, gold: [150, 200], color: '#ffd75e' },
};

// The keymasters: each floor's Gear is held by a miniboss drawn
// from this pool, each with its own temperament and arsenal.
const GUARDIANS = {
  warden: {
    name: 'The Warden', color: '#d8c9a0',
    hp: 190, speed: 125, dmg: 17, style: 'warden',
    blurb: 'stalks, lunges, fans bones',
  },
  butcher: {
    name: 'The Butcher', color: '#c9495a',
    hp: 170, speed: 140, dmg: 21, style: 'butcher',
    blurb: 'telegraphed, terrible charges',
  },
  plague: {
    name: 'The Plaguebringer', color: '#8aa84a',
    hp: 160, speed: 110, dmg: 14, style: 'plague',
    blurb: 'lobbed filth and fresh slimes',
  },
  bellringer: {
    name: 'The Bellringer', color: '#c9a05a',
    hp: 220, speed: 95, dmg: 16, style: 'bell',
    blurb: 'slow, loud, radial',
  },
  puppeteer: {
    name: 'The Puppeteer', color: '#8a6ae8',
    hp: 150, speed: 115, dmg: 13, style: 'puppet',
    blurb: 'blinks away and sends friends',
  },
  watcher: {
    name: 'The Watcher', color: '#7de8ff',
    hp: 165, speed: 100, dmg: 15, style: 'watcher',
    blurb: 'eyes that follow you home',
  },
};

// The lantern: every floor drains it. At zero the lights go out
// and Greg's Shade — unkillable — comes hunting. Descend to escape.
const POWER_MAX = 100;
const POWER_DRAIN = 0.5;           // per second, +10% per floor down
const SHADE = { dmg: 25, speed: 110, maxSpeed: 260, ramp: 5 };

// Friendly minion breeds: the necromancer's skeletons, the
// beastmaster's wolves, the tinkerer's turrets, the beekeeper's bees.
const MINIONS = {
  skeleton: { r: 10, dmg: 8,  hp: 25, speed: 230, life: 25,   cap: 2, color: '#8a6ae8' },
  wolf:     { r: 12, dmg: 12, hp: 45, speed: 260, life: 9999, cap: 3, color: '#c98a4a' },
  bee:      { r: 5,  dmg: 4,  hp: 6,  speed: 300, life: 5,    cap: 6, color: '#ffd75e' },
  turret:   { r: 14, dmg: 9,  hp: 40, speed: 0,   life: 9999, cap: 2, color: '#7de8ff' },
};
// Standing lanterns hold the Shade at bay (it circles, but won't
// enter the light). They don't kill it, and the clock keeps running.
const LANTERN_RADIUS = 130;

// The merchant's stock. Each shop room offers 3 of these.
// Final price scales up with the crypt level.
const SHOP_ITEMS = {
  bandages: { name: 'Bandages',        desc: 'Heal 40 HP',                base: 25 },
  potion:   { name: 'Health Potion',   desc: 'Carried — Q drinks it',     base: 40 },
  battery:  { name: 'Lantern Battery', desc: '+45 power, scares shades',  base: 30 },
  blessing: { name: 'Mystery Blessing', desc: 'A random blessing',        base: 90 },
  elixir:   { name: "Greg's Elixir",   desc: '+20 max HP this run',       base: 60 },
  bomb:     { name: 'Bomb',            desc: 'Carried — Q lights the fuse', base: 35 },
  totem:    { name: 'Totem of the Founder', desc: 'Carried — cheats death once', base: 130 },
};

// Permanent upgrades bought at the Estate between runs.
// cost = base * 1.7^level, max level 10.
const UPGRADES = {
  vitality: { name: 'Vitality', desc: '+15 max HP per rank',        base: 80 },
  strength: { name: 'Strength', desc: '+3 damage per rank',         base: 100 },
  agility:  { name: 'Agility',  desc: '+5% speed per rank',         base: 90 },
  fortune:  { name: 'Fortune',  desc: '+10% gold per rank',         base: 120 },
  recovery: { name: 'Recovery', desc: '+0.5 HP/s regen per rank',   base: 110 },
};
const UPGRADE_MAX = 10;

// Regeneration (Minecraft-style): heroes slowly heal, but taking a
// hit pauses it, and the Shade's presence suppresses it entirely.
const REGEN_BASE = 1.2;    // HP per second
const REGEN_DELAY = 4;     // seconds of no regen after taking damage

// The crypt is 3 floors deep, connected by the central elevator.
// Each floor has its own look, a sub-biome variant, and its own danger.
const FLOORS = [
  // down through the works, each floor meaner than the last
  { name: 'The Sewers',   floorA: '#1e3230', floorB: '#192b29', wall: '#0f1c1a', mortar: '#091210', torch: '#8affc1',
    sub: { name: 'The Flooded Tunnels', floorA: '#173038', floorB: '#142a30', decor: 'puddle' } },
  { name: 'The Mines',    floorA: '#2b2620', floorB: '#252118', wall: '#171310', mortar: '#0d0b08', torch: '#ffb347',
    sub: { name: 'The Crystal Hollows', floorA: '#232433', floorB: '#1e1f2c', decor: 'crystal' } },
  { name: 'The Factory',  floorA: '#2e2a24', floorB: '#28241e', wall: '#191612', mortar: '#0f0d0a', torch: '#ffb347',
    sub: { name: 'The Assembly Line',   floorA: '#33291e', floorB: '#2c2319', decor: 'gears' } },
  { name: 'The Frozen Deep', floorA: '#20303d', floorB: '#1b2a36', wall: '#101c26', mortar: '#0a121a', torch: '#9adcff',
    sub: { name: 'The Glacier Court',   floorA: '#243848', floorB: '#1e303e', decor: 'puddle' } },
  { name: 'The Hellmouth', floorA: '#331a16', floorB: '#2c1512', wall: '#180a08', mortar: '#0e0504', torch: '#ff6a5e',
    sub: { name: 'The Burning Court',   floorA: '#3a1e14', floorB: '#331a10', decor: 'lava' } },
  // beneath everything: a short dark landing and the Founder himself
  { name: "The Founder's Rest", floorA: '#241521', floorB: '#1e111b', wall: '#120810', mortar: '#0a0408', torch: '#ff5a5e' },
];

// Consumable items — found in chests, sold by the merchant.
// The hero carries at most two; Q uses the oldest one.
const ITEMS = {
  potion:   { name: 'Health Potion',    desc: 'Heal half your max HP',        stack: 5 },
  apple:    { name: 'Golden Apple',     desc: 'Heal 30 and gain 10 max HP',   stack: 5 },
  bomb:     { name: 'Bomb',             desc: 'Blast every enemy in the room', stack: 5 },
  swift:    { name: 'Swiftness Potion', desc: '+30% speed for 10 seconds',    stack: 5 },
  strength: { name: 'Strength Potion',  desc: '+50% damage for 10 seconds',   stack: 5 },
  totem:    { name: 'Totem of the Founder', desc: 'Cheats death once, all on its own', stack: 1 },
};
const ITEM_CAP = 9; // a proper hotbar
// what chests actually hold, beyond gold
const CHEST_COMMON_ITEMS = ['potion', 'swift', 'apple', 'bomb'];
const CHEST_RARE_ITEMS = ['strength', 'totem'];

// Crafting materials — monsters drop the parts they're made of.
// Elevator gears come from chests and pay for each descent.
const MATERIALS = {
  gel:     { name: 'Slime Gel',     color: '#6dd66d' },
  wing:    { name: 'Bat Wing',      color: '#b98ae8' },
  bone:    { name: 'Bone',          color: '#e8e2d0' },
  scrap:   { name: 'Iron Scrap',    color: '#9aa4b8' },
  essence: { name: 'Ghost Essence', color: '#c9a5ff' },
  gear:    { name: 'Elevator Gear', color: '#ffd75e' },
};

// The surface: where every run begins, above the crypt.
const SURFACE = {
  name: 'The Family Plot',
  floorA: '#243824', floorB: '#1f3220',
  wall: '#16220f', mortar: '#0e160a', torch: '#ffb347',
};

// Weapons and offhand gear: found in gold chests or forged.
// A weapon adds flat damage; shields soak hits; the charm slows
// the lantern's drain. One weapon slot, one offhand slot.
const EQUIPMENT = {
  boneclub:   { slot: 'weapon',  name: 'Bone Club',     dmg: 5,  color: '#e8e2d0' },
  ironblade:  { slot: 'weapon',  name: 'Iron Blade',    dmg: 9,  color: '#9aa4b8' },
  scythe:     { slot: 'weapon',  name: 'Grave Scythe',  dmg: 14, color: '#c9a5ff' },
  boneshield: { slot: 'offhand', name: 'Bone Shield',   guard: 0.88, color: '#e8e2d0' },
  ironshield: { slot: 'offhand', name: 'Iron Shield',   guard: 0.78, color: '#9aa4b8' },
  charm:      { slot: 'offhand', name: 'Lantern Charm', powerSave: 0.7, color: '#ffd75e' },
  bonearmor:  { slot: 'armor', id: 'bone', name: 'Bone Armor', mult: 0.85, color: '#e8e2d0' },
  ironarmor:  { slot: 'armor', id: 'iron', name: 'Iron Armor', mult: 0.70, color: '#9aa4b8' },
};

// Recipes: the brewery's stand turns materials into potions, the
// forge's crafting table makes gear, armor, and worse ideas.
const RECIPES = {
  brew: [
    { out: 'Health Potion',    item: 'potion',   cost: { gel: 3 } },
    { out: 'Swiftness Potion', item: 'swift',    cost: { wing: 3 } },
    { out: 'Strength Potion',  item: 'strength', cost: { bone: 2, gel: 1 } },
  ],
  craft: [
    { out: 'Bomb',                item: 'bomb',  cost: { bone: 3 } },
    { out: 'Totem of the Founder', item: 'totem', cost: { essence: 3 } },
    { out: 'Bone Club (+5 dmg)',      equipId: 'boneclub',   cost: { bone: 4 } },
    { out: 'Iron Blade (+9 dmg)',     equipId: 'ironblade',  cost: { scrap: 3, bone: 1 } },
    { out: 'Grave Scythe (+14 dmg)',  equipId: 'scythe',     cost: { essence: 2, bone: 3 } },
    { out: 'Bone Shield (-12% hurt)', equipId: 'boneshield', cost: { bone: 4, gel: 2 } },
    { out: 'Iron Shield (-22% hurt)', equipId: 'ironshield', cost: { scrap: 3 } },
    { out: 'Lantern Charm (slow drain)', equipId: 'charm',   cost: { essence: 2 } },
    { out: 'Bone Armor (-15% hurt)',  equipId: 'bonearmor', cost: { bone: 5 } },
    { out: 'Iron Armor (-30% hurt)',  equipId: 'ironarmor', cost: { scrap: 4 } },
  ],
};
// Interior themes for ordinary rooms. Every floor gets one brewery
// (brewing stand) and one forge (crafting table); the rest roll from
// the weighted pool. Kitchens serve one free stew; bars pour one
// mystery drink.
const INTERIOR_POOL = ['plain', 'plain', 'storage', 'library', 'tombs', 'kitchen', 'bar', 'armory', 'barracks', 'garden', 'chapel'];

// Loot chest tiers — every chest looks the same on the outside;
// the tier decides the gold range and which loot table rolls.
const CHEST_TIERS = {
  wood:   { color: '#8a6a3a', trim: '#5a4526', glow: null,      gold: [18, 30] },
  silver: { color: '#b8c0cc', trim: '#7a8494', glow: '#dfe8ff', gold: [35, 55] },
  gold:   { color: '#e8b83a', trim: '#a87f1e', glow: '#ffd75e', gold: [60, 95] },
};

// Loot tables. `always` drops every time; `pickOne` rolls a weighted
// choice; `rolls` are independent chances. Drop keywords:
//   gem, heart, goldheart, cell, item (common), rareitem,
//   blessing, equip (random equipment), mat:<material id>
const LOOT_TABLES = {
  chest_wood: {
    pickOne: [
      { drop: 'item', w: 45 },
      { drop: 'heart', w: 30 },
      { drop: 'cell', w: 25 },
    ],
    rolls: [
      { drop: 'mat:gear', chance: 0.15 },
      { drop: 'gem', chance: 0.15 },
      { drop: 'mat:bone', chance: 0.5 },
      { drop: 'mat:gel', chance: 0.5 },
      { drop: 'mat:wing', chance: 0.35 },
    ],
  },
  chest_silver: {
    always: ['heart', 'item'],
    rolls: [
      { drop: 'mat:gear', chance: 0.6 },
      { drop: 'cell', chance: 0.5 },
      { drop: 'gem', chance: 0.4 },
      { drop: 'mat:bone', chance: 0.6 },
      { drop: 'mat:gel', chance: 0.5 },
      { drop: 'mat:scrap', chance: 0.35 },
    ],
  },
  chest_gold: {
    always: ['blessing', 'mat:gear', 'gem', 'gem', 'goldheart', 'cell', 'rareitem'],
    rolls: [
      { drop: 'gem', chance: 0.5 },
      { drop: 'equip', chance: 0.25 },
      { drop: 'mat:bone', chance: 0.6 },
      { drop: 'mat:scrap', chance: 0.6 },
      { drop: 'mat:essence', chance: 0.5 },
    ],
  },
};

// What monsters leave behind, beyond their gold.
const ENEMY_LOOT = {
  slime:    [{ drop: 'mat:gel', chance: 0.45 }],
  rat:      [{ drop: 'mat:bone', chance: 0.15 }],
  golem:    [{ drop: 'mat:scrap', chance: 0.5 }, { drop: 'mat:bone', chance: 0.3 }],
  sparker:  [{ drop: 'mat:scrap', chance: 0.5 }],
  frostling:[{ drop: 'mat:essence', chance: 0.15 }, { drop: 'mat:gel', chance: 0.3 }],
  imp:      [{ drop: 'mat:essence', chance: 0.2 }],
  guardian: [
    { drop: 'mat:gear', chance: 1 },   // the keymaster carries the key
    { drop: 'gem', chance: 0.6 },
    { drop: 'item', chance: 0.5 },
  ],
  mimic: [
    { drop: 'item', chance: 1 },
    { drop: 'gem', chance: 0.5 },
    { drop: 'mat:gear', chance: 0.5 },
  ],
  bat:      [{ drop: 'mat:wing', chance: 0.45 }],
  skeleton: [{ drop: 'mat:bone', chance: 0.45 }],
  turret:   [{ drop: 'mat:scrap', chance: 0.45 }],
  boss: [
    { drop: 'mat:essence', chance: 1 },
    { drop: 'mat:essence', chance: 1 },
    { drop: 'gem', chance: 1 },
    { drop: 'gem', chance: 1 },
  ],
};

// Blessings: found in gold chests, last until this hero dies.
const BLESSINGS = {
  wrath:     { name: "Founder's Wrath", desc: '+20% damage',      apply: h => { h.dmg *= 1.2; } },
  boots:     { name: 'Fleet Boots',     desc: '+15% speed',       apply: h => { h.speed *= 1.15; } },
  stew:      { name: 'Hearty Stew',     desc: '+30 max HP',       apply: h => { h.maxHp += 30; h.hp += 30; } },
  luck:      { name: 'Lucky Coin',      desc: '+25% gold',        apply: h => { h.goldMult *= 1.25; } },
  whetstone: { name: 'Whetstone',       desc: 'Attack 20% faster', apply: h => { h.cd *= 0.8; } },
};

const SAVE_KEY = 'gregs-descendants-save';
