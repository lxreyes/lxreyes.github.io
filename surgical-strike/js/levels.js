// Mission definitions. World units are meters; the world is 48 x 32 m.
// Walls are segments; { window: true } means bullets and vision pass through,
// but bodies cannot, and sound is muffled.
// Angles: 0 = east, PI/2 = south (canvas y grows downward), PI = west, -PI/2 = north.

// Crew roster. unlockMission is the mission index a unit enters the hire
// market at — once that contract is open, the unit can be HIRED for cash.
const UNIT_INFO = {
  scout: {
    label: "SCOUT", color: "#4ade80", unlockMission: 0,
    blurb: "Ground recon. Sneaks quietly or walks loudly; taps walls on command.",
  },
  assassin: {
    label: "ASSASSIN", color: "#f43f5e", unlockMission: 0,
    blurb: "Your first killer. Automatically knifes any target that walks within reach. Holding still, they're hard to notice — position them and let the routine deliver the victim.",
  },
  sniper: {
    label: "SNIPER", color: "#f87171", unlockMission: 1,
    blurb: "The long gun. One perch, one aim point, one exact fire time. Windows only — glass is the way in.",
  },
  spotter: {
    label: "SPOTTER", color: "#2dd4bf", unlockMission: 1,
    blurb: "Sniper support with long glass. If they can see your aim point when the shot fires, the hit window widens by half. Sharp recon eyes, too.",
  },
  drone: {
    label: "DRONE", color: "#22d3ee", unlockMission: 1,
    blurb: "Flies over walls and reveals rooms from above. Its hum draws ears; loiter in view and it gets shot down.",
  },
  decoy: {
    label: "DECOY", color: "#c084fc", unlockMission: 2,
    blurb: "Throws noisemakers to an exact spot at an exact time. Herd targets without risking the scout.",
  },
  hacker: {
    label: "HACKER", color: "#60a5fa", unlockMission: 3,
    blurb: "Reach a junction box (⚡), then cut the power on schedule — enemy vision drops hard while the lights are out.",
  },
  lockpick: {
    label: "LOCKPICK", color: "#eab308", unlockMission: 2,
    blurb: "Doors are a suggestion. Cracks locks three times faster than brute force, and quietly. Welcome on recon ops.",
  },
  sapper: {
    label: "SAPPER", color: "#fb923c", unlockMission: 1,
    blurb: "The bomb guy. Plants a breach charge at a waypoint and blows a hole in the nearest wall — new lanes for bullets, bodies, and eyes. LOUD.",
  },
  gunner: {
    label: "GUNNER", color: "#a78bfa", unlockMission: 2,
    blurb: "Suppressive fire on schedule: a burst that pins every guard near the point face-down for seconds. Very loud, very persuasive.",
  },
};

// Hiring: specialists cost cash to bring onto the crew.
// (Scout and Assassin are founding members — the rifle is the first big purchase.)
const HIRE_COSTS = { sniper: 1400, spotter: 1500, drone: 1200, decoy: 1800, hacker: 2500, sapper: 2000, gunner: 2200, lockpick: 1300 };

// Recon ops are free — surveillance is how this crew is SUPPOSED to work.
const RECON_COST = 0;

// Per-unit upgrade ladders, bought one tier at a time.
// Index 0 is tier 2 (tier 1 is what you get on hire).
const UPGRADES = {
  scout: [
    { name: "Sharp Eyes", desc: "Vision 8m → 10.5m", cost: 800 },
    { name: "Trained Ear", desc: "See enemy hearing rings", cost: 1200 },
    { name: "Pattern Analysis", desc: "Known patrol routes drawn on the map", cost: 1800 },
    { name: "Phantom Step", desc: "Near-silent sneaking (2.2m → 0.9m)", cost: 2600 },
    { name: "Deep Cover", desc: "New COVER move mode: walk disguised in the open — footsteps draw no attention; takes 3.5s of direct scrutiny to be made", cost: 3200 },
    { name: "Toxin Kit", desc: "New POISON order: dose a target's routine stop (☠ marks) — a silent kill, no gunshot, no panic", cost: 2800 },
  ],
  sniper: [
    { name: "Steady Hands", desc: "Hit window 0.45m → 0.6m", cost: 900 },
    { name: "Ballistic Computer", desc: "Target position predicted at fire time", cost: 1400 },
    { name: "Match Grade", desc: "Hit window → 0.75m", cost: 2000 },
    { name: "Penetrator", desc: "Bullet punches through one interior wall", cost: 3000 },
  ],
  assassin: [
    { name: "Garrote", desc: "Suffocate instead of stabbing — kills make no noise at all", cost: 700 },
    { name: "Long Reach", desc: "Strike range 1.1m → 1.6m", cost: 1200 },
    { name: "Silent Feet", desc: "Near-silent sneaking (2.2m → 0.9m)", cost: 1800 },
  ],
  spotter: [
    { name: "Field Glasses", desc: "Spotting range 10m → 13m", cost: 900 },
    { name: "Wind Caller", desc: "Hit window bonus +50% → +85%", cost: 1400 },
    { name: "Steady Whisper", desc: "Near-silent footsteps (2.0m → 0.9m)", cost: 1600 },
  ],
  drone: [
    { name: "Quiet Rotors", desc: "Hum noise 3.5m → 2.5m", cost: 700 },
    { name: "Better Optics", desc: "Aerial reveal 5m → 6.5m", cost: 1200 },
    { name: "Hardened Frame", desc: "Survives 2.5s of gunfire (up from 1.2s)", cost: 1800 },
  ],
  decoy: [
    { name: "Strong Arm", desc: "Throw range 14m → 18m", cost: 800 },
    { name: "Big Bang", desc: "Noisemaker radius 10m → 13m", cost: 1500 },
  ],
  hacker: [
    { name: "Deep Access", desc: "Blackout 8s → 12s", cost: 1600 },
  ],
};

function unitMaxLevel(kind) {
  return 1 + (UPGRADES[kind] || []).length;
}

// BTD6-style upgrade trees: 3 named paths per unit. Rule: only ONE path may
// go past tier 1 — pick a specialty, dabble in one other.
const PATHS = {
  scout: [
    { name: "Optics", tiers: [
      { desc: "Sharp Eyes: vision 8m → 10.5m", cost: 800 },
      { desc: "Trained Ear: see enemy hearing rings", cost: 1200 },
      { desc: "Pattern Analysis: patrol routes drawn", cost: 1800 } ] },
    { name: "Ghost", tiers: [
      { desc: "Soft Step: sneak noise 2.2m → 1.5m", cost: 700 },
      { desc: "Phantom Step: sneak noise → 0.9m", cost: 1500 },
      { desc: "Deep Cover: the COVER disguise walk", cost: 2800 } ] },
    { name: "Chemist", tiers: [
      { desc: "Loud Knuckles: wall taps carry 16m → 20m", cost: 600 },
      { desc: "Toxin Kit: the POISON order", cost: 2400 },
      { desc: "Fast-Acting: poison drops them in 1s", cost: 1600 } ] },
  ],
  sniper: [
    { name: "Precision", tiers: [
      { desc: "Steady Hands: hit window 0.45m → 0.6m", cost: 900 },
      { desc: "Match Grade: hit window → 0.75m", cost: 2000 },
      { desc: "Dead Zero: hit window → 0.9m", cost: 3000 } ] },
    { name: "Ballistics", tiers: [
      { desc: "Ballistic Computer: target predicted at fire time", cost: 1200 },
      { desc: "Cold Bore: first shot gets +0.15m window", cost: 1400 },
      { desc: "Penetrator: bullet pierces one wall", cost: 3000 } ] },
    { name: "Arsenal", tiers: [
      { desc: "Overwatch: +1 schedulable shot", cost: 2600 },
      { desc: "Wrapped Barrel: impact noise capped at 12m", cost: 1600 } ] },
  ],
  assassin: [
    { name: "Blade", tiers: [
      { desc: "Long Reach: strike range 1.1m → 1.6m", cost: 1200 },
      { desc: "Reaper Stride: strike range → 2.0m", cost: 2000 },
      { desc: "No Witnesses: the blade also drops GUARDS in reach", cost: 2800 } ] },
    { name: "Silence", tiers: [
      { desc: "Garrote: kills make no noise", cost: 700 },
      { desc: "Silent Feet: sneak noise → 0.9m", cost: 1500 },
      { desc: "Still Air: motionless scrutiny 3.5s → 6s", cost: 2200 } ] },
    { name: "Knives", tiers: [
      { desc: "Balanced Knife: one thrown kill from 4m", cost: 1800 },
      { desc: "Quiver: two thrown kills per contract", cost: 2400 },
      { desc: "Long Throw: thrown range → 6m", cost: 2000 } ] },
  ],
  spotter: [
    { name: "Glass", tiers: [
      { desc: "Field Glasses: spotting range 10m → 13m", cost: 900 },
      { desc: "Eagle Eye: range → 16m", cost: 1400 },
      { desc: "Observatory: range → 18m", cost: 1800 } ] },
    { name: "Wind", tiers: [
      { desc: "Wind Caller: hit bonus +50% → +85%", cost: 1400 },
      { desc: "Zeroed: bonus → +105%", cost: 1800 },
      { desc: "Perfect Call: bonus → +130%", cost: 2400 } ] },
    { name: "Fieldcraft", tiers: [
      { desc: "Steady Whisper: footsteps 2.0m → 0.9m", cost: 1600 },
      { desc: "Dug In: motionless spotter concealed like the assassin", cost: 1800 } ] },
  ],
  drone: [
    { name: "Rotors", tiers: [
      { desc: "Quiet Rotors: hum 3.5m → 2.5m", cost: 700 },
      { desc: "Whisper Blades: hum → 1.8m", cost: 1200 },
      { desc: "Feathered: hum → 1.2m", cost: 1800 } ] },
    { name: "Optics", tiers: [
      { desc: "Better Optics: aerial reveal 5m → 6.5m", cost: 1200 },
      { desc: "Wide Lens: reveal → 8m", cost: 1800 } ] },
    { name: "Frame", tiers: [
      { desc: "Hardened Frame: survives 2.5s of gunfire", cost: 1800 },
      { desc: "Kevlar Shell: survives 4s", cost: 2200 } ] },
  ],
  decoy: [
    { name: "Arm", tiers: [
      { desc: "Strong Arm: throw range 14m → 18m", cost: 800 },
      { desc: "Cannon Arm: range → 22m", cost: 1400 } ] },
    { name: "Payload", tiers: [
      { desc: "Big Bang: noisemaker radius 10m → 13m", cost: 1500 },
      { desc: "Screamers: radius → 16m", cost: 2000 } ] },
    { name: "Satchel", tiers: [
      { desc: "Extra Satchel: 6 noisemakers", cost: 1200 },
      { desc: "Bandolier: 8 noisemakers", cost: 1600 } ] },
  ],
  hacker: [
    { name: "Deep Access", tiers: [
      { desc: "Deep Access: blackout 8s → 12s", cost: 1600 },
      { desc: "Rolling Blackout: → 16s", cost: 2200 } ] },
    { name: "Cells", tiers: [
      { desc: "Backup Cell: 2 blackouts per contract", cost: 1900 },
      { desc: "Grid Master: 3 blackouts", cost: 2400 } ] },
    { name: "Fingers", tiers: [
      { desc: "Long Leads: works 3m from a junction box", cost: 900 } ] },
  ],
  sapper: [
    { name: "Demolition", tiers: [
      { desc: "Second Charge: 2 breaches per contract", cost: 1400 },
      { desc: "Full Kit: 3 breaches", cost: 1800 } ] },
    { name: "Shaped", tiers: [
      { desc: "Muffled Charge: blast noise 20m → 10m", cost: 1600 },
      { desc: "Whisper Charge: → 6m", cost: 2000 } ] },
    { name: "Big Bore", tiers: [
      { desc: "Wide Breach: hole width 2.4m → 4m", cost: 1500 } ] },
  ],
  lockpick: [
    { name: "Tension", tiers: [
      { desc: "Feather Touch: cracks locks in 2s", cost: 1100 },
      { desc: "Master Keys: cracks locks in 1s", cost: 1800 } ] },
    { name: "Nerves", tiers: [
      { desc: "Cool Hands: motionless concealment like the assassin", cost: 1600 } ] },
  ],
  gunner: [
    { name: "Belt", tiers: [
      { desc: "Spare Belt: 2 bursts per contract", cost: 1200 },
      { desc: "Full Crate: 3 bursts", cost: 1600 } ] },
    { name: "Reach", tiers: [
      { desc: "Long Barrel: burst range 12m → 16m", cost: 1300 },
      { desc: "Tripod: range → 20m", cost: 1700 } ] },
    { name: "Terror", tiers: [
      { desc: "Sustained Fire: guards cower 5s → 8s", cost: 1500 },
      { desc: "Beaten Zone: cower radius 4m → 6m", cost: 1900 } ] },
  ],
};

// The HOMEBASE: crew-wide skills trained between contracts.
const SKILLS = {
  disguise: {
    name: "Disguise Workshop", tiers: [
      { desc: "Delivery uniforms: 2.5s of scrutiny in public venues (up from 1.2s)", cost: 1200 },
      { desc: "Forged lanyards: 4s of scrutiny", cost: 2000 },
      { desc: "Perfect covers: 6s of scrutiny", cost: 3000 } ],
  },
  medical: {
    name: "Medical Bay", tiers: [
      { desc: "Field surgeon: healing the wounded costs half", cost: 1500 },
      { desc: "Full clinic: the wounded are patched up free after every job", cost: 2500 } ],
  },
  fitness: {
    name: "Conditioning", tiers: [
      { desc: "Cardio: hunted operatives sprint at 3.4 m/s", cost: 1000 },
      { desc: "Parkour: sprint at 3.8 m/s", cost: 1800 } ],
  },
};

// Perks derived from BTD6-style paths (paths[unit] = [tiersA, tiersB, tiersC]).
function perksFromPaths(unitLevels, paths, gear = {}, skills = {}) {
  const hired = k => (unitLevels[k] || 0) > 0;
  const p = (k, i) => (paths[k] || [0, 0, 0])[i] || 0;
  return {
    // scout
    scoutVision: p("scout", 0) >= 1 ? 10.5 : 8,
    // Clear intel imagery once you buy the Scout's optics (Sharp Eyes), or run a
    // drone (its camera); until then your read on the map is rough.
    sharpVisuals: p("scout", 0) >= 1 || hired("drone"),
    showHearing: p("scout", 0) >= 2,
    showPatrols: p("scout", 0) >= 3,
    sneakNoise: p("scout", 1) >= 2 ? 0.9 : p("scout", 1) >= 1 ? 1.5 : 2.2,
    undercover: p("scout", 1) >= 3,
    tapRadius: p("scout", 2) >= 1 ? 20 : 16,
    poison: p("scout", 2) >= 2,
    poisonDelay: p("scout", 2) >= 3 ? 1.0 : 2.5,
    // sniper
    hitRadius: (p("sniper", 0) >= 3 ? 0.9 : p("sniper", 0) >= 2 ? 0.75 : p("sniper", 0) >= 1 ? 0.6 : 0.45) + (gear.rangefinder ? 0.1 : 0),
    fireGhost: p("sniper", 1) >= 1,
    firstShotBonus: p("sniper", 1) >= 2 ? 0.15 : 0,
    pierce: p("sniper", 1) >= 3,
    extraShots: (p("sniper", 2) >= 1 ? 1 : 0) + (gear.spareRound ? 1 : 0),
    shotNoise: Math.min(gear.suppressor ? 6 : 18, p("sniper", 2) >= 2 ? 12 : 18),
    // assassin
    strikeRange: p("assassin", 0) >= 2 ? 2.0 : p("assassin", 0) >= 1 ? 1.6 : 1.1,
    bladeGuards: p("assassin", 0) >= 3,
    strikeNoise: p("assassin", 1) >= 1 ? 0 : 2.5,
    assassinSneak: p("assassin", 1) >= 2 ? 0.9 : 2.2,
    stillExposure: p("assassin", 1) >= 3 ? 6 : 3.5,
    throwKnife: gear.throwKnife || p("assassin", 2) >= 1,
    throwCount: p("assassin", 2) >= 2 ? 2 : 1,
    thrownRange: p("assassin", 2) >= 3 ? 6 : 4,
    // spotter
    spotterVision: p("spotter", 0) >= 3 ? 18 : p("spotter", 0) >= 2 ? 16 : p("spotter", 0) >= 1 ? 13 : 10,
    spotterMult: p("spotter", 1) >= 3 ? 2.3 : p("spotter", 1) >= 2 ? 2.05 : p("spotter", 1) >= 1 ? 1.85 : 1.5,
    spotterNoise: p("spotter", 2) >= 1 ? 0.9 : 2.0,
    spotterStill: p("spotter", 2) >= 2,
    // drone
    droneHum: p("drone", 0) >= 3 ? 1.2 : p("drone", 0) >= 2 ? 1.8 : p("drone", 0) >= 1 ? 2.5 : 3.5,
    droneReveal: p("drone", 1) >= 2 ? 8 : p("drone", 1) >= 1 ? 6.5 : 5,
    droneTough: p("drone", 2) >= 2 ? 4 : p("drone", 2) >= 1 ? 2.5 : 1.2,
    // decoy
    throwRange: p("decoy", 0) >= 2 ? 22 : p("decoy", 0) >= 1 ? 18 : 14,
    throwNoise: p("decoy", 1) >= 2 ? 16 : p("decoy", 1) >= 1 ? 13 : 10,
    maxThrows: (p("decoy", 2) >= 2 ? 8 : p("decoy", 2) >= 1 ? 6 : 4) + (gear.satchel ? 2 : 0),
    // hacker
    blackoutDur: p("hacker", 0) >= 2 ? 16 : p("hacker", 0) >= 1 ? 12 : 8,
    maxBlackouts: Math.max(p("hacker", 1) >= 2 ? 3 : p("hacker", 1) >= 1 ? 2 : 1, gear.backupCell ? 2 : 1),
    boxRange: p("hacker", 2) >= 1 ? 3 : 1.8,
    // sapper
    breachCount: p("sapper", 0) >= 2 ? 3 : p("sapper", 0) >= 1 ? 2 : 1,
    breachNoise: p("sapper", 1) >= 2 ? 6 : p("sapper", 1) >= 1 ? 10 : 20,
    breachWidth: p("sapper", 2) >= 1 ? 2.0 : 1.2,
    // gunner
    burstCount: p("gunner", 0) >= 2 ? 3 : p("gunner", 0) >= 1 ? 2 : 1,
    suppressRange: p("gunner", 1) >= 2 ? 20 : p("gunner", 1) >= 1 ? 16 : 12,
    cowerDur: p("gunner", 2) >= 1 ? 8 : 5,
    cowerRadius: p("gunner", 2) >= 2 ? 6 : 4,
    // lockpick
    lockRate: p("lockpick", 0) >= 2 ? 1 : p("lockpick", 0) >= 1 ? 1 / 2 : 1 / 3,
    lockStill: p("lockpick", 1) >= 1,
    // homebase skills
    disguiseTime: [1.2, 2.5, 4, 6][skills.disguise || 0],
    sprintSpeed: 3 + 0.4 * (skills.fitness || 0),
    medDiscount: (skills.medical || 0) >= 1,
    autoHeal: (skills.medical || 0) >= 2,
    // shared gear
    smoke: !!gear.smoke,
    scoutStillMult: gear.ghillie ? 0.7 : 1,
    blare: !!gear.loudspeaker,
    hiredSniper: hired("sniper"),
  };
}

// The armory: one-time gear purchases, separate from crew upgrades.
// `needs` gates an item behind having that unit on the crew.
const GEAR = {
  suppressor: {
    name: "Suppressed Rifle", cost: 2000, needs: "sniper",
    desc: "Impact noise 18m → 6m. On multi-target contracts the survivor barely flinches.",
  },
  spareRound: {
    name: "Spare Round", cost: 1800, needs: "sniper",
    desc: "Plan one extra shot per contract — insurance for a miss.",
  },
  smoke: {
    name: "Smoke Bombs", cost: 1600, needs: null,
    desc: "New scout order: pop smoke at a waypoint. Nobody sees through the cloud for 8s.",
  },
  ghillie: {
    name: "Ghillie Wrap", cost: 1400, needs: null,
    desc: "A motionless scout is noticed at 30% shorter range.",
  },
  throwKnife: {
    name: "Throwing Knife", cost: 2200, needs: "assassin",
    desc: "Once per contract, the Assassin's blade strikes from 4m instead of arm's reach.",
  },
  loudspeaker: {
    name: "Drone Loudspeaker", cost: 1500, needs: "drone",
    desc: "New drone order: BLARE on schedule — a 14m wall of noise from wherever it hovers.",
  },
  satchel: {
    name: "Extra Satchel", cost: 1200, needs: "decoy",
    desc: "The Decoy carries 6 noisemakers instead of 4.",
  },
  backupCell: {
    name: "Backup Cell", cost: 1900, needs: "hacker",
    desc: "Rig a second blackout per contract.",
  },
  rangefinder: {
    name: "Rangefinder", cost: 1300, needs: "spotter",
    desc: "Precision ranging: every shot's hit window grows +0.1m.",
  },
};

// levels: per-unit tiers (0 = not hired); gear: owned armory items.
function perkValues(levels, gear = {}) {
  const l = k => levels[k] || 0;
  return {
    shotNoise: gear.suppressor ? 6 : 18,
    extraShots: gear.spareRound ? 1 : 0,
    smoke: !!gear.smoke,
    scoutStillMult: gear.ghillie ? 0.7 : 1,
    throwKnife: !!gear.throwKnife,
    blare: !!gear.loudspeaker,
    maxThrows: gear.satchel ? 6 : 4,
    maxBlackouts: gear.backupCell ? 2 : 1,
    scoutVision: l("scout") >= 2 ? 10.5 : 8,
    // Clear intel imagery once you buy the Scout's optics, or run a drone (its
    // camera feeds you clean pictures); until then, your read on the map is rough.
    sharpVisuals: l("scout") >= 2 || l("drone") >= 1,
    showHearing: l("scout") >= 3,
    showPatrols: l("scout") >= 4,
    sneakNoise: l("scout") >= 5 ? 0.9 : 2.2,
    undercover: l("scout") >= 6,
    poison: l("scout") >= 7,
    strikeRange: l("assassin") >= 3 ? 1.6 : 1.1,
    strikeNoise: l("assassin") >= 2 ? 0 : 2.5,
    assassinSneak: l("assassin") >= 4 ? 0.9 : 2.2,
    spotterVision: l("spotter") >= 2 ? 13 : 10,
    spotterMult: l("spotter") >= 3 ? 1.85 : 1.5,
    spotterNoise: l("spotter") >= 4 ? 0.9 : 2.0,
    hitRadius: (l("sniper") >= 4 ? 0.75 : l("sniper") >= 2 ? 0.6 : 0.45) + (gear.rangefinder ? 0.1 : 0),
    fireGhost: l("sniper") >= 3,
    pierce: l("sniper") >= 5,
    droneHum: l("drone") >= 2 ? 2.5 : 3.5,
    droneReveal: l("drone") >= 3 ? 6.5 : 5,
    droneTough: l("drone") >= 4 ? 2.5 : 1.2,
    throwRange: l("decoy") >= 2 ? 18 : 14,
    throwNoise: l("decoy") >= 3 ? 13 : 10,
    blackoutDur: l("hacker") >= 2 ? 12 : 8,
  };
}

// Deterministic spawn offsets so crew members don't stack on one tile.
const UNIT_SPAWN_OFFSETS = {
  scout: { x: 0, y: 0 },
  assassin: { x: -1.4, y: -1.2 },
  spotter: { x: 0, y: -1.6 },
  drone: { x: 1.4, y: -1.2 },
  decoy: { x: -1.4, y: 1.2 },
  hacker: { x: 1.4, y: 1.2 },
  sapper: { x: -2.6, y: 0 },
  gunner: { x: 2.6, y: 0 },
  lockpick: { x: 0, y: 1.8 },
};

function unitSpawn(level, kind) {
  const o = UNIT_SPAWN_OFFSETS[kind] || { x: 0, y: 0 };
  return {
    x: Math.max(0.8, Math.min(47.2, level.scoutSpawn.x + o.x)),
    y: Math.max(0.8, Math.min(31.2, level.scoutSpawn.y + o.y)),
  };
}


const LEVELS = [
  // ---------------------------------------------------------- MISSION 1
  {
    name: "First Contract",
    briefing:
      "Target: Marco 'The Pen' Bellini, holed up in a lakeside cabin. " +
      "He paces between his desk and the west window.\n\n" +
      "Sneak your scout close to learn his routine — then send the ASSASSIN in for close " +
      "work. Route them beside a spot Bellini lingers, hold, and let his own schedule " +
      "deliver him to the blade.\n\n" +
      "CONTROLS: follow the checklist above the map. Pick a unit, then click the map to " +
      "give orders (right-click undoes). HOLD makes a unit wait; drag the timeline to see " +
      "where everyone will be at any second. Then EXECUTE.\n\n" +
      "Earn enough and the SNIPER joins the hire market — then the windows start mattering.",
    hint:
      "Walking is loud — a spooked target backs away from noise, and he'll hear sneaking " +
      "within a couple of meters. Don't creep up on him: slip in through the door while " +
      "he's at the window (his back is to it), park just south of the window, hold STILL, " +
      "and wait for him to come back to the glass.",
    duration: 45,
    pay: 1000,
    scoutSpawn: { x: 6, y: 26 },
    perches: [{ x: 8, y: 14 }, { x: 6, y: 20 }],
    rooms: [{ x: 30, y: 10, w: 12, h: 12 }],
    junctionBoxes: [{ x: 34, y: 23.2 }],
    props: [
      { kind: "tree", x: 12, y: 18 }, { kind: "tree", x: 19, y: 24 }, { kind: "tree", x: 25, y: 28 },
      { kind: "desk", x: 39.5, y: 16.8, w: 1.6, h: 0.9 },
      { kind: "shelf", x: 41, y: 11, w: 0.8, h: 3 },
      { kind: "bed", x: 36, y: 20.5, w: 2.4, h: 1 },
    ],
    walls: [
      { x1: 30, y1: 10, x2: 42, y2: 10 },
      { x1: 42, y1: 10, x2: 42, y2: 22 },
      { x1: 30, y1: 22, x2: 42, y2: 22 },
      { x1: 30, y1: 10, x2: 30, y2: 13 },
      { x1: 30, y1: 13, x2: 30, y2: 16, window: true },
      { x1: 30, y1: 16, x2: 30, y2: 18.5 },
      // door gap 18.5 - 20.5
      { x1: 30, y1: 20.5, x2: 30, y2: 22 },
    ],
    enemies: [
      {
        name: "Bellini", isTarget: true, behavior: "retreat",
        speed: 1.2, vision: 8, fov: 75, hearingMult: 1, retreatDist: 3.2,
        patrol: [
          { x: 39, y: 18, wait: 4, face: Math.PI },
          { x: 32, y: 15, wait: 3, face: -Math.PI / 2 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 2
  {
    name: "House Guest",
    briefing:
      "Aldo Verga runs his books from a guarded safehouse. A bodyguard patrols the west wing; " +
      "Verga works in the east room — desk, bookshelf, and a pause at the south window.\n\n" +
      "The contract is Verga ALONE. Hit the bodyguard and the deal is off.",
    hint:
      "The west perch only sees into the bodyguard's room — wrong window, wrong man. " +
      "Use the south perches. Verga looks south at the window; approach it from an angle.",
    duration: 55,
    pay: 1400,
    scoutSpawn: { x: 6, y: 29 },
    perches: [{ x: 34, y: 30 }, { x: 39, y: 29 }, { x: 8, y: 13 }],
    rooms: [{ x: 18, y: 8, w: 22, h: 16 }],
    junctionBoxes: [{ x: 16.5, y: 20 }, { x: 30, y: 26 }],
    props: [
      { kind: "tree", x: 12, y: 26 }, { kind: "tree", x: 22, y: 28 }, { kind: "tree", x: 10, y: 17 },
      { kind: "car", x: 43, y: 14, w: 1.6, h: 3.4 },
      { kind: "desk", x: 37.5, y: 10.5, w: 2, h: 1 },
      { kind: "shelf", x: 38.8, y: 18.5, w: 0.9, h: 2.4 },
      { kind: "table", x: 23, y: 15.5, w: 1.6, h: 1 },
    ],
    walls: [
      { x1: 18, y1: 8, x2: 40, y2: 8 },
      { x1: 40, y1: 8, x2: 40, y2: 24 },
      { x1: 18, y1: 24, x2: 26, y2: 24 },
      // door gap 26 - 28
      { x1: 28, y1: 24, x2: 33, y2: 24 },
      { x1: 33, y1: 24, x2: 36, y2: 24, window: true },
      { x1: 36, y1: 24, x2: 40, y2: 24 },
      { x1: 18, y1: 8, x2: 18, y2: 12 },
      { x1: 18, y1: 12, x2: 18, y2: 15, window: true },
      { x1: 18, y1: 15, x2: 18, y2: 24 },
      // inner wall
      { x1: 29, y1: 8, x2: 29, y2: 14 },
      // door gap 14 - 16.5
      { x1: 29, y1: 16.5, x2: 29, y2: 24 },
    ],
    enemies: [
      {
        name: "Bodyguard Renko", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 90, hearingMult: 1,
        patrol: [
          { x: 21, y: 11, wait: 2, face: Math.PI },
          { x: 21, y: 21, wait: 2 },
          { x: 26, y: 21, wait: 1 },
          { x: 26, y: 11, wait: 1 },
        ],
      },
      {
        name: "Verga", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 8, fov: 90, hearingMult: 1, retreatDist: 3.2,
        patrol: [
          { x: 36, y: 12, wait: 6, face: Math.PI / 2 },
          { x: 38, y: 20, wait: 4 },
          { x: 34.5, y: 22.5, wait: 2.5, face: Math.PI / 2 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 3
  {
    name: "Cold Call",
    briefing:
      "Silas Kade never goes near a window — smart man. The north window covers a narrow lane " +
      "inside his office, and he stays out of it.\n\n" +
      "But Kade is jumpy. A knock on the wall and he backs straight away from the sound. " +
      "Herd him into the lane.\n\n" +
      "NEW ORDER: TAP WALL ♪ — marks the last waypoint, and your scout raps the wall there.",
    hint:
      "Peek through the small west window to learn his routine. A tap from the west pushes him east — " +
      "line the noise up so 'away from the sound' means 'into your firing lane', and have the sniper " +
      "fire during the few seconds he stands there rattled.",
    duration: 60,
    pay: 1800,
    scoutSpawn: { x: 6, y: 28 },
    perches: [{ x: 29.5, y: 2 }, { x: 14, y: 4 }],
    rooms: [{ x: 20, y: 8, w: 20, h: 16 }],
    junctionBoxes: [{ x: 18.5, y: 21 }, { x: 34, y: 25.5 }],
    props: [
      { kind: "tree", x: 13, y: 26 }, { kind: "tree", x: 14.5, y: 17 },
      { kind: "tree", x: 24, y: 4 }, { kind: "tree", x: 35, y: 3 },
      { kind: "desk", x: 20.6, y: 20.8, w: 1.4, h: 0.8 },
      { kind: "cabinet", x: 24.5, y: 9, w: 1, h: 1.5 },
      { kind: "table", x: 33, y: 15, w: 2, h: 1.2 },
    ],
    walls: [
      { x1: 20, y1: 8, x2: 27, y2: 8 },
      { x1: 27, y1: 8, x2: 32, y2: 8, window: true },
      { x1: 32, y1: 8, x2: 40, y2: 8 },
      { x1: 40, y1: 8, x2: 40, y2: 24 },
      { x1: 20, y1: 24, x2: 37, y2: 24 },
      // door gap 37 - 39
      { x1: 39, y1: 24, x2: 40, y2: 24 },
      { x1: 20, y1: 8, x2: 20, y2: 14 },
      { x1: 20, y1: 14, x2: 20, y2: 17, window: true },
      { x1: 20, y1: 17, x2: 20, y2: 24 },
    ],
    enemies: [
      {
        name: "Kade", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 7, fov: 100, hearingMult: 1.2, retreatDist: 4,
        patrol: [
          { x: 23, y: 20, wait: 8, face: 0 },
          { x: 23, y: 12, wait: 4, face: 0 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 4
  {
    name: "Double Watch",
    briefing:
      "Dr. Elm Vasser. An exterior guard sweeps the grounds on a long loop, and a house guard " +
      "holds the west wing. Vasser keeps a tight routine in the east room, with a pause at the " +
      "south window.\n\n" +
      "Thread the patrol gaps, learn the routine, take the shot.",
    hint:
      "Time your scout's approach for when the exterior guard is on the far side of her loop. " +
      "Vasser stops at the window AND at the cabinet — both are visible from the south perch.",
    duration: 60,
    pay: 2200,
    scoutSpawn: { x: 4, y: 30 },
    perches: [{ x: 37, y: 28 }, { x: 18, y: 30 }],
    rooms: [{ x: 22, y: 6, w: 22, h: 14 }],
    junctionBoxes: [{ x: 20.5, y: 15 }, { x: 40, y: 21.5 }],
    props: [
      { kind: "tree", x: 10, y: 14 }, { kind: "tree", x: 18, y: 23 }, { kind: "tree", x: 27, y: 29 },
      { kind: "car", x: 8, y: 24, w: 1.6, h: 3.2 },
      { kind: "desk", x: 41.5, y: 8, w: 1.6, h: 1 },
      { kind: "shelf", x: 42.8, y: 13, w: 0.9, h: 3 },
      { kind: "cabinet", x: 33.8, y: 15.5, w: 1, h: 1 },
      { kind: "table", x: 27, y: 12.5, w: 1.6, h: 1.2 },
    ],
    walls: [
      { x1: 22, y1: 6, x2: 44, y2: 6 },
      { x1: 44, y1: 6, x2: 44, y2: 20 },
      { x1: 22, y1: 20, x2: 28, y2: 20 },
      // door gap 28 - 30
      { x1: 30, y1: 20, x2: 35, y2: 20 },
      { x1: 35, y1: 20, x2: 38, y2: 20, window: true },
      { x1: 38, y1: 20, x2: 44, y2: 20 },
      { x1: 22, y1: 6, x2: 22, y2: 9 },
      { x1: 22, y1: 9, x2: 22, y2: 12, window: true },
      { x1: 22, y1: 12, x2: 22, y2: 20 },
      // inner wall
      { x1: 33, y1: 6, x2: 33, y2: 12 },
      // door gap 12 - 14.5
      { x1: 33, y1: 14.5, x2: 33, y2: 20 },
    ],
    enemies: [
      {
        name: "Patrol Guard Iva", behavior: "investigate",
        speed: 1.9, vision: 10, fov: 70, hearingMult: 1,
        patrol: [
          { x: 14, y: 8, wait: 1 },
          { x: 14, y: 26, wait: 1 },
          { x: 34, y: 26, wait: 2 },
          { x: 14, y: 26, wait: 0 },
        ],
      },
      {
        name: "House Guard Bren", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 90, hearingMult: 1,
        patrol: [
          { x: 25, y: 9, wait: 2, face: 0 },
          { x: 25, y: 17, wait: 2 },
          { x: 30, y: 17, wait: 1 },
          { x: 30, y: 9, wait: 1 },
        ],
      },
      {
        name: "Dr. Vasser", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 8, fov: 90, hearingMult: 1, retreatDist: 3,
        patrol: [
          { x: 40, y: 9, wait: 7, face: Math.PI / 2 },
          { x: 35, y: 16, wait: 3, face: Math.PI / 2 },
          { x: 36.5, y: 18.7, wait: 2, face: Math.PI / 2 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 5
  {
    name: "The Penthouse",
    briefing:
      "Viktor 'The Ledger' Malov. Four guards. Two windows. One bullet.\n\n" +
      "A perimeter guard circles the whole mansion. A bodyguard shadows Malov in the study — " +
      "and his ears are sharp. Two more hold the lounge and the west wing.\n\n" +
      "Everything you've learned.",
    hint:
      "The east window looks straight onto Malov's desk — if you can get eyes on it between " +
      "perimeter sweeps. The bodyguard will come LOOKING for any noise he hears; a well-placed " +
      "tap can pull him away... or pull him onto your scout.",
    duration: 75,
    pay: 2800,
    scoutSpawn: { x: 2, y: 16 },
    perches: [{ x: 45, y: 13.5 }, { x: 27.5, y: 1 }],
    rooms: [{ x: 12, y: 6, w: 28, h: 20 }],
    junctionBoxes: [{ x: 10.5, y: 18 }, { x: 41.5, y: 22 }],
    props: [
      { kind: "tree", x: 5.5, y: 16 }, { kind: "tree", x: 42.3, y: 7.8 },
      { kind: "tree", x: 26, y: 29.6 }, { kind: "tree", x: 41, y: 30.5 },
      { kind: "desk", x: 34.5, y: 9.2, w: 2, h: 1 },
      { kind: "shelf", x: 24.4, y: 7, w: 0.9, h: 2.5 },
      { kind: "sofa", x: 30, y: 21.5, w: 2.4, h: 1 },
      { kind: "table", x: 17, y: 15, w: 1.8, h: 1.2 },
    ],
    walls: [
      { x1: 12, y1: 6, x2: 26, y2: 6 },
      { x1: 26, y1: 6, x2: 29, y2: 6, window: true },
      { x1: 29, y1: 6, x2: 40, y2: 6 },
      { x1: 40, y1: 6, x2: 40, y2: 12 },
      { x1: 40, y1: 12, x2: 40, y2: 15, window: true },
      { x1: 40, y1: 15, x2: 40, y2: 26 },
      { x1: 12, y1: 26, x2: 20, y2: 26 },
      // door gap 20 - 22
      { x1: 22, y1: 26, x2: 40, y2: 26 },
      { x1: 12, y1: 6, x2: 12, y2: 26 },
      // inner vertical x=24
      { x1: 24, y1: 6, x2: 24, y2: 13 },
      // door gap 13 - 15
      { x1: 24, y1: 15, x2: 24, y2: 26 },
      // inner horizontal y=17
      { x1: 24, y1: 17, x2: 30, y2: 17 },
      // door gap 30 - 32
      { x1: 32, y1: 17, x2: 40, y2: 17 },
    ],
    enemies: [
      {
        name: "Malov", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 7, fov: 100, hearingMult: 1.2, retreatDist: 4,
        patrol: [
          { x: 36, y: 11, wait: 8, face: Math.PI },
          { x: 28, y: 12, wait: 4, face: -Math.PI / 2 },
        ],
      },
      {
        name: "Bodyguard Grim", behavior: "investigate",
        speed: 1.8, vision: 9, fov: 80, hearingMult: 1.4,
        patrol: [
          { x: 26, y: 8, wait: 2, face: Math.PI / 2 },
          { x: 27, y: 15, wait: 2 },
          { x: 33, y: 14, wait: 2 },
          { x: 33, y: 8, wait: 2 },
        ],
      },
      {
        name: "Lounge Guard", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 27, y: 20, wait: 2 },
          { x: 38, y: 20, wait: 2 },
          { x: 38, y: 24, wait: 1 },
          { x: 27, y: 24, wait: 1 },
        ],
      },
      {
        name: "West Guard", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 15, y: 9, wait: 2 },
          { x: 15, y: 23, wait: 2 },
          { x: 21, y: 23, wait: 1 },
          { x: 21, y: 9, wait: 1 },
        ],
      },
      {
        name: "Perimeter Guard", behavior: "investigate",
        speed: 2.0, vision: 10, fov: 75, hearingMult: 1,
        patrol: [
          { x: 8, y: 4, wait: 1 },
          { x: 44, y: 4, wait: 1 },
          { x: 44, y: 28, wait: 1 },
          { x: 8, y: 28, wait: 1 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 6
  {
    name: "Night Shift",
    briefing:
      "Enzo Marchetti launders money after dark, and his people know every approach: " +
      "one watcher sweeps the north grounds, another owns the east side. Their patrol " +
      "gaps are thin — thinner than a scout's nerves.\n\n" +
      "But buildings need power, and power has junction boxes. Kill the lights at the " +
      "right moment and those watchers go half-blind while your crew moves.",
    hint:
      "The west box is quiet; the south-east one sits right in a patrol lane. Schedule the " +
      "blackout for the seconds your scout crosses to the east window — or skip the ground " +
      "game entirely and let the drone map his desk hours. Careful firing east: the watcher " +
      "walks through your bullet's path.",
    duration: 70,
    pay: 3000,
    scoutSpawn: { x: 4, y: 28 },
    perches: [{ x: 45, y: 17.5 }, { x: 26.5, y: 5 }],
    rooms: [{ x: 16, y: 10, w: 24, h: 16 }],
    junctionBoxes: [{ x: 13, y: 22 }, { x: 43, y: 27 }],
    props: [
      { kind: "tree", x: 12, y: 14 }, { kind: "tree", x: 20, y: 29 },
      { kind: "planter", x: 20, y: 8.4, w: 1.8, h: 0.8 },
      { kind: "car", x: 44, y: 25, w: 1.8, h: 3.5 },
      { kind: "desk", x: 37.5, y: 13.5, w: 1.8, h: 0.9 },
      { kind: "shelf", x: 17, y: 11.5, w: 0.9, h: 2.5 },
    ],
    walls: [
      { x1: 16, y1: 10, x2: 25, y2: 10 },
      { x1: 25, y1: 10, x2: 28, y2: 10, window: true },
      { x1: 28, y1: 10, x2: 40, y2: 10 },
      { x1: 40, y1: 10, x2: 40, y2: 16 },
      { x1: 40, y1: 16, x2: 40, y2: 19, window: true },
      { x1: 40, y1: 19, x2: 40, y2: 26 },
      { x1: 16, y1: 26, x2: 26, y2: 26 },
      // door gap 26 - 28
      { x1: 28, y1: 26, x2: 40, y2: 26 },
      { x1: 16, y1: 10, x2: 16, y2: 26 },
      // inner wall
      { x1: 24, y1: 10, x2: 24, y2: 16 },
      // door gap 16 - 18
      { x1: 24, y1: 18, x2: 24, y2: 26 },
    ],
    enemies: [
      {
        name: "Marchetti", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 7, fov: 95, hearingMult: 1.1, retreatDist: 3.5,
        patrol: [
          { x: 36, y: 15, wait: 7, face: Math.PI },
          { x: 38, y: 22, wait: 5, face: Math.PI },
          { x: 31, y: 13, wait: 3 },
        ],
      },
      {
        name: "Guard Mole", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 19, y: 13, wait: 2, face: 0 },
          { x: 19, y: 23, wait: 2 },
          { x: 22, y: 23, wait: 1 },
          { x: 22, y: 13, wait: 1 },
        ],
      },
      {
        name: "Watcher North", behavior: "investigate",
        speed: 1.9, vision: 10, fov: 70, hearingMult: 1,
        patrol: [
          { x: 18, y: 7, wait: 1 },
          { x: 43, y: 7, wait: 1 },
        ],
      },
      {
        name: "Watcher East", behavior: "investigate",
        speed: 1.9, vision: 10, fov: 70, hearingMult: 1,
        patrol: [
          { x: 43, y: 9, wait: 1 },
          { x: 43, y: 24, wait: 1 },
          { x: 34, y: 29, wait: 2 },
          { x: 43, y: 24, wait: 0 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 7
  {
    name: "Two Steps Back",
    briefing:
      "Silvio Kade — yes, Silas's brother, and twice as jumpy. He learned from what happened: " +
      "he works deep in the south room, far from the one lane your rifle can reach... which " +
      "threads TWO aligned windows, outer and inner.\n\n" +
      "One knock moves him three and a half meters. Do the math: he needs to back up twice, " +
      "on a schedule, while the Minder upstairs is out of earshot.",
    hint:
      "The Decoy carries this one. Park them outside the west wall, then schedule two throws " +
      "a few seconds apart — each landing WEST of wherever Silvio is standing, so 'away from " +
      "the noise' walks him straight into the lane. Time it for when the Minder is in the " +
      "north strip, and fire while Silvio is still rattled.",
    duration: 75,
    pay: 3200,
    scoutSpawn: { x: 4, y: 29 },
    perches: [{ x: 27.5, y: 2 }, { x: 14, y: 4 }],
    rooms: [{ x: 18, y: 8, w: 22, h: 18 }],
    junctionBoxes: [{ x: 15, y: 24 }],
    props: [
      { kind: "tree", x: 10, y: 25 }, { kind: "tree", x: 22, y: 3 }, { kind: "tree", x: 33, y: 2.5 },
      { kind: "desk", x: 19, y: 18.5, w: 1.2, h: 0.9 },
      { kind: "shelf", x: 38.5, y: 8.5, w: 0.9, h: 2 },
      { kind: "crate", x: 33, y: 23, w: 1.2, h: 1.2 },
    ],
    walls: [
      { x1: 18, y1: 8, x2: 26, y2: 8 },
      { x1: 26, y1: 8, x2: 30, y2: 8, window: true },
      { x1: 30, y1: 8, x2: 40, y2: 8 },
      { x1: 40, y1: 8, x2: 40, y2: 26 },
      { x1: 18, y1: 26, x2: 33, y2: 26 },
      // door gap 33 - 35
      { x1: 35, y1: 26, x2: 40, y2: 26 },
      { x1: 18, y1: 8, x2: 18, y2: 26 },
      // inner wall with the aligned window
      { x1: 18, y1: 14, x2: 26, y2: 14 },
      { x1: 26, y1: 14, x2: 30, y2: 14, window: true },
      { x1: 30, y1: 14, x2: 36, y2: 14 },
      // door gap 36 - 38
      { x1: 38, y1: 14, x2: 40, y2: 14 },
    ],
    enemies: [
      {
        name: "Silvio Kade", isTarget: true, behavior: "retreat",
        speed: 1.2, vision: 7, fov: 100, hearingMult: 1.2, retreatDist: 3.5,
        patrol: [
          { x: 22, y: 20, wait: 9, face: 0 },
          { x: 22, y: 24, wait: 4, face: 0 },
        ],
      },
      {
        name: "The Minder", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 21, y: 11, wait: 2, face: Math.PI / 2 },
          { x: 37, y: 11, wait: 2 },
          { x: 37, y: 20, wait: 3 },
          { x: 37, y: 11, wait: 0 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 8
  {
    name: "Eyes Everywhere",
    briefing:
      "Professor Arno Weiss sold the wrong formula to the wrong people, and now a private " +
      "army babysits him. Three rooms, three inside guards, a perimeter runner — and the " +
      "Warden in the study hears a pin drop at five meters.\n\n" +
      "You cannot walk this one blind. Put the drone up, map every routine, and take the " +
      "one clean shot through the west window when Weiss sits down.",
    hint:
      "The Warden's west-bound sweep looks straight out the window — a peeking scout gets " +
      "made. The drone doesn't care about walls: hover it high in room corners, away from " +
      "ears. If you must use the scout, the junction box is west; darkness beats the " +
      "Warden's eyes.",
    duration: 70,
    pay: 3400,
    scoutSpawn: { x: 4, y: 30 },
    perches: [{ x: 8, y: 16.5 }, { x: 6, y: 24 }],
    rooms: [{ x: 14, y: 8, w: 28, h: 18 }],
    junctionBoxes: [{ x: 7, y: 20 }],
    props: [
      { kind: "tree", x: 5, y: 24 }, { kind: "tree", x: 12, y: 6.5 },
      { kind: "tree", x: 43.5, y: 20 }, { kind: "tree", x: 30, y: 27.6 },
      { kind: "desk", x: 19, y: 17.4, w: 1.6, h: 0.8 },
      { kind: "crate", x: 28, y: 15, w: 1.2, h: 1.2 },
      { kind: "shelf", x: 40.9, y: 15, w: 0.8, h: 3 },
    ],
    walls: [
      { x1: 14, y1: 8, x2: 42, y2: 8 },
      { x1: 42, y1: 8, x2: 42, y2: 26 },
      { x1: 14, y1: 26, x2: 24, y2: 26 },
      // door gap 24 - 26
      { x1: 26, y1: 26, x2: 42, y2: 26 },
      { x1: 14, y1: 8, x2: 14, y2: 15 },
      { x1: 14, y1: 15, x2: 14, y2: 18, window: true },
      { x1: 14, y1: 18, x2: 14, y2: 26 },
      // inner wall x=24
      { x1: 24, y1: 8, x2: 24, y2: 14 },
      // door gap 14 - 16
      { x1: 24, y1: 16, x2: 24, y2: 26 },
      // inner wall x=33
      { x1: 33, y1: 8, x2: 33, y2: 19 },
      // door gap 19 - 21
      { x1: 33, y1: 21, x2: 33, y2: 26 },
    ],
    enemies: [
      {
        name: "Prof. Weiss", isTarget: true, behavior: "retreat",
        speed: 1.2, vision: 7, fov: 95, hearingMult: 1.1, retreatDist: 3,
        patrol: [
          { x: 20, y: 16.5, wait: 6, face: 0 },
          { x: 18, y: 11, wait: 4, face: Math.PI / 2 },
          { x: 21, y: 22, wait: 5, face: Math.PI },
        ],
      },
      {
        name: "The Warden", behavior: "investigate",
        speed: 1.6, vision: 8, fov: 90, hearingMult: 1.5,
        patrol: [
          { x: 17, y: 20, wait: 2, face: -Math.PI / 2 },
          { x: 22, y: 13, wait: 2 },
          { x: 22, y: 20, wait: 2 },
        ],
      },
      {
        name: "Hall Guard", keyHolder: true, behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 26, y: 11, wait: 2 },
          { x: 31, y: 11, wait: 2 },
          { x: 31, y: 24, wait: 2 },
          { x: 26, y: 24, wait: 2 },
        ],
      },
      {
        name: "East Guard", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 36, y: 11, wait: 2 },
          { x: 40, y: 11, wait: 2 },
          { x: 40, y: 24, wait: 2 },
          { x: 36, y: 24, wait: 2 },
        ],
      },
      {
        name: "Perimeter Runner", behavior: "investigate",
        speed: 2.0, vision: 10, fov: 75, hearingMult: 1,
        patrol: [
          { x: 10, y: 5, wait: 1 },
          { x: 45, y: 5, wait: 1 },
          { x: 45, y: 29, wait: 1 },
          { x: 10, y: 29, wait: 1 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 9
  {
    name: "Glass Gauntlet",
    briefing:
      "Viktoria Malova — the Ledger's sister — inherited the books and doubled the security. " +
      "Her villa sits behind a second building, an alley sentry walks the gap between them, " +
      "and a roamer circles the whole block.\n\n" +
      "Two firing solutions exist. A long shot over the annex roof through the west window. " +
      "And the gauntlet: a bullet threaded from the south perch through an open door, across " +
      "the guard room, through a second doorway, into her study. Both lanes have people " +
      "walking through them.\n\n" +
      "Everything you have. Everything you've learned.",
    hint:
      "The thread shot only connects when Viktoria admires the painting — and the lounge " +
      "guard crosses that lane on his loop, so the fire time must dodge HIM too. Drone maps " +
      "the routines, blackout blinds the alley sentry, a decoy throw can hold someone out of " +
      "your lane. Stack the timeline carefully.",
    duration: 85,
    pay: 4000,
    scoutSpawn: { x: 2, y: 30 },
    perches: [{ x: 36, y: 30 }, { x: 14, y: 5 }],
    rooms: [{ x: 30, y: 8, w: 14, h: 18 }, { x: 10, y: 10, w: 14, h: 14 }],
    junctionBoxes: [{ x: 8, y: 20 }, { x: 33, y: 29 }],
    props: [
      { kind: "tree", x: 9, y: 4.5 }, { kind: "tree", x: 18, y: 8.4 }, { kind: "tree", x: 24, y: 27.5 },
      { kind: "desk", x: 40.9, y: 10.4, w: 1.5, h: 0.8 },
      { kind: "cabinet", x: 42.8, y: 9, w: 0.9, h: 2 },
      { kind: "sofa", x: 33.5, y: 21.5, w: 2.2, h: 1 },
    ],
    walls: [
      // Villa
      { x1: 30, y1: 8, x2: 44, y2: 8 },
      { x1: 44, y1: 8, x2: 44, y2: 26 },
      { x1: 30, y1: 26, x2: 35, y2: 26 },
      // door gap 35 - 37 (the south thread lane)
      { x1: 37, y1: 26, x2: 44, y2: 26 },
      { x1: 30, y1: 8, x2: 30, y2: 12 },
      { x1: 30, y1: 12, x2: 30, y2: 15, window: true },
      { x1: 30, y1: 15, x2: 30, y2: 26 },
      // Villa inner wall y=17
      { x1: 30, y1: 17, x2: 36, y2: 17 },
      // door gap 36 - 38 (second half of the thread lane)
      { x1: 38, y1: 17, x2: 44, y2: 17 },
      // Annex (cover building, no reason to enter)
      { x1: 10, y1: 10, x2: 24, y2: 10 },
      { x1: 24, y1: 10, x2: 24, y2: 24 },
      { x1: 10, y1: 24, x2: 24, y2: 24 },
      { x1: 10, y1: 10, x2: 10, y2: 15 },
      // door gap 15 - 17
      { x1: 10, y1: 17, x2: 10, y2: 24 },
    ],
    enemies: [
      {
        name: "Viktoria Malova", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 8, fov: 100, hearingMult: 1.3, retreatDist: 4,
        patrol: [
          { x: 40, y: 11, wait: 8, face: Math.PI },
          { x: 36.8, y: 10.5, wait: 4, face: -Math.PI / 2 },
          { x: 34, y: 14, wait: 5, face: Math.PI },
        ],
      },
      {
        name: "Bodyguard Vex", behavior: "investigate", armed: true,
        speed: 1.8, vision: 9, fov: 80, hearingMult: 1.4,
        patrol: [
          { x: 33, y: 14, wait: 2 },
          { x: 42, y: 13, wait: 2 },
          { x: 38, y: 9, wait: 2 },
        ],
      },
      {
        name: "Lounge Guard", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 32, y: 20, wait: 2 },
          { x: 42, y: 20, wait: 2 },
          { x: 42, y: 24, wait: 1 },
          { x: 32, y: 24, wait: 1 },
        ],
      },
      {
        name: "Alley Sentry", behavior: "investigate",
        speed: 1.8, vision: 9, fov: 80, hearingMult: 1,
        patrol: [
          { x: 27, y: 6, wait: 1 },
          { x: 27, y: 28, wait: 1 },
        ],
      },
      {
        name: "Block Roamer", behavior: "investigate",
        speed: 2.1, vision: 10, fov: 75, hearingMult: 1,
        patrol: [
          { x: 6, y: 6, wait: 1 },
          { x: 46, y: 6, wait: 1 },
          { x: 46, y: 29, wait: 1 },
          { x: 6, y: 29, wait: 1 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 10
  {
    name: "Double Booking",
    briefing:
      "The Dane twins, Castor and Pollux — two names, one contract, and your sniper " +
      "carries a second round. They work in adjoining offices with mirrored windows.\n\n" +
      "Here is the problem: the first impact is LOUD. The moment one brother drops, the " +
      "other bolts from the sound. Plan BOTH shots — the SHOT buttons switch between " +
      "them — and keep the gap tight, or lead the runner.",
    hint:
      "Their desk schedules overlap for a few seconds each cycle — recon it. A double-tap " +
      "0.3s apart beats his reaction; a slow second shot must aim where he'll flee, not " +
      "where he stood.",
    duration: 60,
    pay: 3600,
    scoutSpawn: { x: 4, y: 29 },
    perches: [{ x: 30, y: 30 }, { x: 8, y: 16 }],
    rooms: [{ x: 18, y: 10, w: 24, h: 14 }],
    junctionBoxes: [{ x: 15, y: 27 }],
    props: [
      { kind: "tree", x: 14, y: 28 }, { kind: "tree", x: 22, y: 29.5 }, { kind: "tree", x: 40, y: 28.5 },
      { kind: "desk", x: 25, y: 15.8, w: 1.4, h: 0.8 },
      { kind: "desk", x: 33.6, y: 15.8, w: 1.4, h: 0.8 },
      { kind: "shelf", x: 18.4, y: 12, w: 0.8, h: 2.5 },
    ],
    walls: [
      { x1: 18, y1: 10, x2: 28, y2: 10 },
      // door gap 28 - 30
      { x1: 30, y1: 10, x2: 42, y2: 10 },
      { x1: 42, y1: 10, x2: 42, y2: 24 },
      { x1: 18, y1: 10, x2: 18, y2: 24 },
      { x1: 18, y1: 24, x2: 26, y2: 24 },
      { x1: 26, y1: 24, x2: 29, y2: 24, window: true },
      { x1: 29, y1: 24, x2: 31, y2: 24 },
      { x1: 31, y1: 24, x2: 34, y2: 24, window: true },
      { x1: 34, y1: 24, x2: 42, y2: 24 },
      // dividing wall between the twin offices
      { x1: 30, y1: 10, x2: 30, y2: 16 },
      // door gap 16 - 18
      { x1: 30, y1: 18, x2: 30, y2: 24 },
    ],
    enemies: [
      {
        name: "Castor Dane", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 8, fov: 90, hearingMult: 1, retreatDist: 3.2,
        patrol: [
          { x: 26.5, y: 17, wait: 8, face: Math.PI / 2 },
          { x: 22, y: 13, wait: 5 },
        ],
      },
      {
        name: "Pollux Dane", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 8, fov: 90, hearingMult: 1, retreatDist: 3.2,
        patrol: [
          { x: 38, y: 13, wait: 2 },
          { x: 33.5, y: 17, wait: 8, face: Math.PI / 2 },
        ],
      },
      {
        name: "Night Porter", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 80, hearingMult: 1,
        patrol: [
          { x: 12, y: 12, wait: 2 },
          { x: 12, y: 26, wait: 2 },
          { x: 20, y: 28, wait: 2 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 11
  {
    name: "House of Ledgers",
    briefing:
      "The end of the family. Viktor Jr. and Mira Malova inherited everything — the books, " +
      "the mansion, and their parents' enemies. Two targets in opposite wings, a shadow " +
      "bodyguard pacing each one, a guard in the south hall, and a runner circling the block.\n\n" +
      "Both firing lanes thread the north windows from a single perch — and both lanes are " +
      "crossed by the bodyguards' rounds. Two bullets, four ways to fail the timing.\n\n" +
      "This is the last name on the list. Make it clean.",
    hint:
      "The heirs keep matching routines — there are moments when both stand in their lanes " +
      "at once. The wings are far enough apart that a wall-muffled shot may not carry... " +
      "recon everything, dodge the shadows' crossings, and double-tap.",
    duration: 90,
    pay: 5000,
    scoutSpawn: { x: 2, y: 30 },
    perches: [{ x: 27, y: 1 }, { x: 5, y: 12 }],
    rooms: [{ x: 12, y: 6, w: 30, h: 20 }],
    junctionBoxes: [{ x: 9, y: 22 }, { x: 44.5, y: 10 }],
    doors: [{ x1: 20, y1: 26, x2: 22, y2: 26, key: "Hall Guard" }],
    props: [
      { kind: "tree", x: 17, y: 4.2 }, { kind: "tree", x: 37, y: 4.2 },
      { kind: "tree", x: 9, y: 10 }, { kind: "tree", x: 25, y: 27.4 },
      { kind: "shelf", x: 12.4, y: 11, w: 0.8, h: 2.5 },
      { kind: "shelf", x: 40.8, y: 11, w: 0.8, h: 2.5 },
      { kind: "sofa", x: 28, y: 22, w: 2.2, h: 1 },
    ],
    walls: [
      { x1: 12, y1: 6, x2: 23, y2: 6 },
      { x1: 23, y1: 6, x2: 26, y2: 6, window: true },
      { x1: 26, y1: 6, x2: 28, y2: 6 },
      { x1: 28, y1: 6, x2: 31, y2: 6, window: true },
      { x1: 31, y1: 6, x2: 42, y2: 6 },
      { x1: 42, y1: 6, x2: 42, y2: 26 },
      { x1: 12, y1: 26, x2: 20, y2: 26 },
      // door gap 20 - 22
      { x1: 22, y1: 26, x2: 42, y2: 26 },
      { x1: 12, y1: 6, x2: 12, y2: 26 },
      // inner wall between the wings
      { x1: 27, y1: 6, x2: 27, y2: 12 },
      // door gap 12 - 14
      { x1: 27, y1: 14, x2: 27, y2: 18 },
      // south hall wall
      { x1: 12, y1: 18, x2: 24, y2: 18 },
      // door gap 24 - 26
      { x1: 26, y1: 18, x2: 33, y2: 18 },
      // door gap 33 - 35
      { x1: 35, y1: 18, x2: 42, y2: 18 },
    ],
    enemies: [
      {
        name: "Mira Malova", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 8, fov: 100, hearingMult: 1.2, retreatDist: 3.5,
        patrol: [
          { x: 21, y: 12, wait: 6, face: Math.PI / 2 },
          { x: 16, y: 10, wait: 4 },
          { x: 18, y: 15, wait: 4 },
        ],
      },
      {
        name: "Viktor Jr.", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 8, fov: 100, hearingMult: 1.2, retreatDist: 3.5,
        patrol: [
          { x: 33, y: 12, wait: 6, face: Math.PI / 2 },
          { x: 38, y: 10, wait: 4 },
          { x: 36, y: 15, wait: 4 },
        ],
      },
      {
        name: "West Shadow", behavior: "investigate", armed: true,
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1.3,
        patrol: [
          { x: 15, y: 8, wait: 2 },
          { x: 24, y: 8, wait: 2 },
        ],
      },
      {
        name: "East Shadow", behavior: "investigate", armed: true,
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1.3,
        patrol: [
          { x: 39, y: 8, wait: 2 },
          { x: 30, y: 8, wait: 2 },
        ],
      },
      {
        name: "Hall Guard", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 16, y: 21, wait: 2 },
          { x: 38, y: 21, wait: 2 },
        ],
      },
      {
        name: "Block Runner", behavior: "investigate",
        speed: 2.1, vision: 10, fov: 75, hearingMult: 1,
        patrol: [
          { x: 8, y: 3, wait: 1 },
          { x: 44, y: 3, wait: 1 },
          { x: 44, y: 29, wait: 1 },
          { x: 8, y: 29, wait: 1 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 12
  {
    name: "The Quiet Floor",
    briefing:
      "Epilogue. Bram Holt kept the Ledger family's secrets, and he learned from their " +
      "funerals: his office has one tiny window, and his desk sits just outside its lane. " +
      "Sweepers patrol both neighboring rooms and the floor below his office.\n\n" +
      "No clean lanes. This one is close work: walk someone in. His eyes are going and his " +
      "hearing went years ago — but the sweepers' haven't.",
    hint:
      "Three doors in: south, then the inner gaps. The Assassin can park beside his desk " +
      "while he's away and let the routine deliver him. Poison works on any ☠ stop. Or get " +
      "creative — he still backs away from noises, and the window lane is only a meter from " +
      "his desk...",
    duration: 75,
    pay: 4200,
    scoutSpawn: { x: 4, y: 29 },
    perches: [{ x: 25.5, y: 3 }, { x: 8, y: 20 }, { x: 8, y: 12 }], // P3 stares at solid wall — Sapper work
    walls_note: "P3 only has a lane after a breach in the west wall",
    rooms: [{ x: 14, y: 8, w: 26, h: 18 }],
    junctionBoxes: [{ x: 12, y: 20 }, { x: 42, y: 14 }],
    doors: [{ x1: 31, y1: 20, x2: 31, y2: 22, key: "East Sweep" }],
    props: [
      { kind: "tree", x: 10, y: 12 }, { kind: "tree", x: 22, y: 29 }, { kind: "tree", x: 36, y: 28.6 },
      { kind: "shelf", x: 28.9, y: 10.5, w: 0.9, h: 2.4 },
      { kind: "table", x: 16.8, y: 15, w: 1.6, h: 1.1 },
      { kind: "crate", x: 35, y: 15, w: 1.2, h: 1.2 },
    ],
    walls: [
      { x1: 14, y1: 8, x2: 24.5, y2: 8 },
      { x1: 24.5, y1: 8, x2: 26.5, y2: 8, window: true },
      { x1: 26.5, y1: 8, x2: 40, y2: 8 },
      { x1: 40, y1: 8, x2: 40, y2: 26 },
      { x1: 14, y1: 8, x2: 14, y2: 26 },
      { x1: 14, y1: 26, x2: 18, y2: 26 },
      // door gap 18 - 20
      { x1: 20, y1: 26, x2: 40, y2: 26 },
      // inner wall west
      { x1: 22, y1: 8, x2: 22, y2: 14 },
      // door gap 14 - 16
      { x1: 22, y1: 16, x2: 22, y2: 26 },
      // inner wall east
      { x1: 31, y1: 8, x2: 31, y2: 20 },
      // door gap 20 - 22
      { x1: 31, y1: 22, x2: 31, y2: 26 },
    ],
    enemies: [
      {
        name: "Bram Holt", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 6, fov: 90, hearingMult: 0.8, retreatDist: 3,
        patrol: [
          { x: 27.8, y: 12, wait: 9, face: 0 },
          { x: 24, y: 21, wait: 4 },
          { x: 28.5, y: 23, wait: 3 },
        ],
      },
      {
        name: "West Sweep", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 16, y: 11, wait: 2 },
          { x: 16, y: 23, wait: 2 },
          { x: 19, y: 23, wait: 1 },
          { x: 19, y: 11, wait: 1 },
        ],
      },
      {
        name: "East Sweep", keyHolder: true, behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 34, y: 11, wait: 2 },
          { x: 37, y: 11, wait: 2 },
          { x: 37, y: 23, wait: 2 },
          { x: 34, y: 23, wait: 2 },
        ],
      },
      {
        name: "Floor Walker", behavior: "investigate",
        speed: 1.6, vision: 9, fov: 85, hearingMult: 1.2,
        patrol: [
          { x: 23.5, y: 25, wait: 2 },
          { x: 29.5, y: 25, wait: 2 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 13
  {
    name: "Hotel Meridian",
    publicVenue: true,
    briefing:
      "Ren Okafor launders through a boutique hotel he half-owns — a guest wing up top, a " +
      "lobby bar below, and his suite in the east corner. Twice an hour he drifts down the " +
      "corridor for a drink at his own bar.\n\n" +
      "The bar is FULL of innocent people. Kill a civilian and the contract is VOID — no " +
      "pay, no intel money, nothing. They aren't threats: if they see your crew they " +
      "scream, and security comes running.\n\n" +
      "Suite window from the east. Bar habits below. Choose your moment.",
    hint:
      "The restaurant window looks tempting — until a guest wanders through your lane. The " +
      "suite window is clean but his desk visits are short. Or work the bar: his drink " +
      "sits there for six seconds at a time (☠), and a blade by the bar stool never " +
      "endangers anyone else.",
    duration: 80,
    pay: 4600,
    scoutSpawn: { x: 4, y: 30 },
    perches: [{ x: 46, y: 9.5 }, { x: 31.5, y: 30 }],
    rooms: [{ x: 10, y: 6, w: 32, h: 20 }],
    junctionBoxes: [{ x: 8, y: 22 }, { x: 44, y: 20 }],
    doors: [{ x1: 39, y1: 12, x2: 41, y2: 12, key: "House Security" }],
    props: [
      { kind: "tree", x: 6, y: 18 }, { kind: "tree", x: 27, y: 29 }, { kind: "tree", x: 44, y: 22 },
      { kind: "table", x: 14, y: 20.4, w: 5.5, h: 0.8 }, // the bar counter
      { kind: "sofa", x: 20, y: 25.2, w: 2.2, h: 0.8 },
      { kind: "table", x: 29.6, y: 18.4, w: 1.4, h: 1 },
      { kind: "table", x: 36, y: 18.6, w: 1.4, h: 1 },
      { kind: "bed", x: 35, y: 7, w: 2.4, h: 1.2 },
      { kind: "desk", x: 39, y: 8, w: 1.6, h: 0.9 },
    ],
    walls: [
      { x1: 10, y1: 6, x2: 42, y2: 6 },
      { x1: 42, y1: 6, x2: 42, y2: 8 },
      { x1: 42, y1: 8, x2: 42, y2: 11, window: true },
      { x1: 42, y1: 11, x2: 42, y2: 26 },
      { x1: 10, y1: 26, x2: 24, y2: 26 },
      // entrance gap 24 - 26
      { x1: 26, y1: 26, x2: 30, y2: 26 },
      { x1: 30, y1: 26, x2: 33, y2: 26, window: true },
      { x1: 33, y1: 26, x2: 42, y2: 26 },
      { x1: 10, y1: 6, x2: 10, y2: 26 },
      // guest-room floor wall (y=12), four doors
      { x1: 10, y1: 12, x2: 15, y2: 12 },
      { x1: 17, y1: 12, x2: 23, y2: 12 },
      { x1: 25, y1: 12, x2: 31, y2: 12 },
      { x1: 33, y1: 12, x2: 39, y2: 12 },
      { x1: 41, y1: 12, x2: 42, y2: 12 },
      // room dividers
      { x1: 18, y1: 6, x2: 18, y2: 12 },
      { x1: 26, y1: 6, x2: 26, y2: 12 },
      { x1: 34, y1: 6, x2: 34, y2: 12 },
      // corridor south wall (y=16)
      { x1: 10, y1: 16, x2: 20, y2: 16 },
      { x1: 22, y1: 16, x2: 30, y2: 16 },
      { x1: 32, y1: 16, x2: 42, y2: 16 },
      // lobby / restaurant divider
      { x1: 26, y1: 16, x2: 26, y2: 20 },
      { x1: 26, y1: 22, x2: 26, y2: 26 },
    ],
    enemies: [
      {
        name: "Ren Okafor", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 8, fov: 90, hearingMult: 1, retreatDist: 3.2,
        patrol: [
          { x: 38, y: 9, wait: 6, face: -Math.PI / 2 },
          { x: 40, y: 13.5, wait: 0 },
          { x: 21, y: 14, wait: 0 },
          { x: 21, y: 22, wait: 6, face: -Math.PI / 2 },
          { x: 21, y: 14, wait: 0 },
          { x: 40, y: 13.5, wait: 0 },
        ],
      },
      {
        name: "House Security", keyHolder: true, behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 12, y: 14, wait: 2 },
          { x: 40, y: 14, wait: 2 },
        ],
      },
      {
        name: "Door Security", behavior: "investigate",
        speed: 1.6, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 24.5, y: 24.5, wait: 3 },
          { x: 12, y: 25, wait: 3 },
        ],
      },
      {
        name: "Bartender Roz", civilian: true, behavior: "retreat",
        speed: 1.1, vision: 6, fov: 100, hearingMult: 1,
        patrol: [
          { x: 15, y: 19.4, wait: 4 },
          { x: 19, y: 19.4, wait: 4 },
        ],
      },
      {
        name: "Barfly Lou", civilian: true, behavior: "retreat",
        speed: 1.1, vision: 6, fov: 100, hearingMult: 1,
        patrol: [
          { x: 17.5, y: 22.5, wait: 6 },
          { x: 22.5, y: 23.5, wait: 5 },
          { x: 13, y: 23.5, wait: 4 },
        ],
      },
      {
        name: "Guest Mia", civilian: true, behavior: "retreat",
        speed: 1.1, vision: 6, fov: 100, hearingMult: 1,
        patrol: [
          { x: 12.5, y: 18.5, wait: 5 },
          { x: 12.2, y: 23, wait: 4 },
        ],
      },
      {
        name: "Guest Omar", civilian: true, behavior: "retreat",
        speed: 1.1, vision: 6, fov: 100, hearingMult: 1,
        patrol: [
          { x: 30, y: 20, wait: 5 },
          { x: 38, y: 22, wait: 4 },
          { x: 33, y: 24, wait: 3 },
        ],
      },
    ],
  },

  // ---------------------------------------------------------- MISSION 14
  {
    name: "Fort Halvard",
    briefing:
      "Colonel Voss sells his garrison's weapons out the back gate, and the client wants " +
      "the arrangement ended. The fort is chain-link all around — eyes and bullets pass " +
      "through the fence, bodies don't.\n\n" +
      "Two static sentries watch the yard from the corners with long glass. A patrol rings " +
      "the command hut, crossing your firing lane on every lap. Voss works his map table " +
      "behind the hut's only window.\n\n" +
      "A RADIO POST in the west barracks jams your comms: while it lives, your watchers' " +
      "feed is dead — nothing they see reaches you until they slip back out to the insertion " +
      "corner and report. Kill or suppress the operator for a live feed.\n\n" +
      "Soldiers everywhere. One quiet colonel. Timing is everything.",
    hint:
      "The north perch threads the fence and the hut window to the map table — but the hut " +
      "patrol crosses that lane on his top leg, so learn his lap before you set the fire " +
      "time. The fence is see-through: sneaking the yard means beating the tower sentries' " +
      "cones, not hiding behind wire. Under the jam, route recon legs that END back at your " +
      "insertion corner so the intel comes home — or take the Radio Post down first.",
    duration: 80,
    pay: 5200,
    scoutSpawn: { x: 4, y: 31 },
    perches: [{ x: 35.5, y: 2 }, { x: 46, y: 12 }],
    rooms: [{ x: 12, y: 10, w: 10, h: 6 }, { x: 30, y: 9, w: 10, h: 6 }],
    junctionBoxes: [{ x: 6, y: 16 }, { x: 29, y: 30 }],
    doors: [{ x1: 34, y1: 15, x2: 36, y2: 15, key: "Gate Sentry" }],
    props: [
      { kind: "tree", x: 4, y: 10 }, { kind: "tree", x: 5, y: 24 }, { kind: "tree", x: 45.6, y: 17 },
      { kind: "crate", x: 25, y: 20, w: 1.2, h: 1.2 },
      { kind: "crate", x: 26.4, y: 21.3, w: 1.2, h: 1.2 },
      { kind: "crate", x: 24, y: 13, w: 1.4, h: 1.2 },
      { kind: "car", x: 37, y: 21, w: 1.6, h: 3.2 },
      { kind: "car", x: 40.5, y: 21, w: 1.6, h: 3.2 },
    ],
    walls: [
      // chain-link fence: vision and bullets pass, bodies don't
      { x1: 8, y1: 6, x2: 14, y2: 6, window: true },
      // north gate gap 14 - 16
      { x1: 16, y1: 6, x2: 44, y2: 6, window: true },
      { x1: 44, y1: 6, x2: 44, y2: 28, window: true },
      { x1: 8, y1: 28, x2: 24, y2: 28, window: true },
      // south gate gap 24 - 27
      { x1: 27, y1: 28, x2: 44, y2: 28, window: true },
      { x1: 8, y1: 6, x2: 8, y2: 28, window: true },
      // barracks
      { x1: 12, y1: 10, x2: 22, y2: 10 },
      { x1: 22, y1: 10, x2: 22, y2: 16 },
      { x1: 12, y1: 16, x2: 22, y2: 16 },
      { x1: 12, y1: 10, x2: 12, y2: 13 },
      // barracks door 13 - 15
      { x1: 12, y1: 15, x2: 12, y2: 16 },
      // command hut
      { x1: 30, y1: 9, x2: 34, y2: 9 },
      { x1: 34, y1: 9, x2: 37, y2: 9, window: true },
      { x1: 37, y1: 9, x2: 40, y2: 9 },
      { x1: 40, y1: 9, x2: 40, y2: 15 },
      { x1: 30, y1: 15, x2: 34, y2: 15 },
      // hut door 34 - 36
      { x1: 36, y1: 15, x2: 40, y2: 15 },
      { x1: 30, y1: 9, x2: 30, y2: 15 },
    ],
    enemies: [
      {
        name: "Colonel Voss", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 8, fov: 90, hearingMult: 1.1, retreatDist: 3,
        patrol: [
          { x: 35.5, y: 12, wait: 8, face: Math.PI / 2 },
          { x: 32, y: 13.5, wait: 4 },
          { x: 38, y: 10.5, wait: 3 },
        ],
      },
      {
        name: "Hut Patrol", behavior: "investigate", armed: true,
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 28, y: 8, wait: 1 },
          { x: 28, y: 17, wait: 1 },
          { x: 42, y: 17, wait: 1 },
          { x: 42, y: 8, wait: 1 },
        ],
      },
      {
        name: "Yard Patrol", behavior: "investigate", armed: true,
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 10, y: 18, wait: 2 },
          { x: 23, y: 18, wait: 2 },
          { x: 23, y: 26, wait: 2 },
          { x: 10, y: 26, wait: 2 },
        ],
      },
      {
        name: "Gate Sentry", keyHolder: true, behavior: "investigate", armed: true,
        speed: 1.7, vision: 10, fov: 70, hearingMult: 1,
        patrol: [{ x: 25.5, y: 26.5, wait: 1, face: Math.PI / 2 }],
      },
      {
        name: "Tower NE", behavior: "investigate", armed: true,
        speed: 1.7, vision: 12, fov: 60, hearingMult: 1,
        patrol: [{ x: 42.5, y: 7.5, wait: 1, face: 2.36 }],
      },
      {
        name: "Tower SW", behavior: "investigate", armed: true,
        speed: 1.7, vision: 12, fov: 60, hearingMult: 1,
        patrol: [{ x: 9.5, y: 26.5, wait: 1, face: -0.79 }],
      },
      {
        name: "Radio Post", jammer: true, behavior: "investigate",
        speed: 1.4, vision: 8, fov: 100, hearingMult: 1,
        patrol: [{ x: 17, y: 13, wait: 1, face: -Math.PI / 2 }],
      },
    ],
  },
  // ---------------------------------------------------------- MISSION 15
  {
    name: "The Vault",
    publicVenue: true,
    briefing:
      "Auditor Finch cooks the syndicate's books inside a private bank vault — no windows, " +
      "one LOCKED door, and the only keycard hangs around the Vault Manager's neck as he " +
      "walks his rounds.\n\n" +
      "Three ways through a locked door: the Hacker cracks it in seconds, anyone else can " +
      "brute-force it slowly, or you put the keyholder (🔑) down — that's sanctioned, but " +
      "the client docks pay for mess — and lift the card off the body.\n\n" +
      "A lobby full of staff, a corridor ring, a sentry, and the vault at the center.",
    hint:
      "Units whose route hits a locked door WAIT there and work the lock automatically. " +
      "The east window covers the manager's corridor rounds if you'd rather shoot the key " +
      "loose. Or ignore the door entirely — the Sapper doesn't believe in walls.",
    duration: 85,
    pay: 4800,
    scoutSpawn: { x: 4, y: 30 },
    perches: [{ x: 46, y: 11.5 }, { x: 6, y: 16 }],
    rooms: [{ x: 10, y: 6, w: 32, h: 20 }],
    junctionBoxes: [{ x: 8, y: 20 }, { x: 44, y: 18 }],
    doors: [{ x1: 23, y1: 15, x2: 25, y2: 15, key: "Vault Manager" }],
    props: [
      { kind: "tree", x: 6, y: 10 }, { kind: "tree", x: 44, y: 24 }, { kind: "tree", x: 30, y: 29 },
      { kind: "sofa", x: 19.5, y: 22.6, w: 2.2, h: 1 },
      { kind: "desk", x: 19.6, y: 9.4, w: 1.6, h: 0.8 },
      { kind: "planter", x: 33, y: 22, w: 1.6, h: 0.8 },
    ],
    walls: [
      { x1: 10, y1: 6, x2: 42, y2: 6 },
      { x1: 42, y1: 6, x2: 42, y2: 10 },
      { x1: 42, y1: 10, x2: 42, y2: 13, window: true },
      { x1: 42, y1: 13, x2: 42, y2: 26 },
      { x1: 10, y1: 26, x2: 23, y2: 26 },
      // entrance gap 23 - 25
      { x1: 25, y1: 26, x2: 42, y2: 26 },
      { x1: 10, y1: 6, x2: 10, y2: 26 },
      // teller wall between lobby and corridor ring
      { x1: 10, y1: 18, x2: 16, y2: 18 },
      // staff gap 16 - 18
      { x1: 18, y1: 18, x2: 28, y2: 18 },
      // second gap 28 - 30
      { x1: 30, y1: 18, x2: 42, y2: 18 },
      // the vault block (door on its south face)
      { x1: 18, y1: 9, x2: 30, y2: 9 },
      { x1: 30, y1: 9, x2: 30, y2: 15 },
      { x1: 18, y1: 9, x2: 18, y2: 15 },
      { x1: 18, y1: 15, x2: 23, y2: 15 },
      // LOCKED DOOR spans 23 - 25
      { x1: 25, y1: 15, x2: 30, y2: 15 },
    ],
    enemies: [
      {
        name: "Auditor Finch", isTarget: true, behavior: "retreat",
        speed: 1.25, vision: 7, fov: 95, hearingMult: 1, retreatDist: 3,
        patrol: [
          { x: 21, y: 11, wait: 8, face: Math.PI / 2 },
          { x: 27, y: 10.5, wait: 6 },
        ],
      },
      {
        name: "Vault Manager", keyHolder: true, behavior: "investigate",
        speed: 1.2, vision: 8, fov: 90, hearingMult: 1,
        patrol: [
          { x: 17, y: 22, wait: 4 },
          { x: 17, y: 12, wait: 2 },
          { x: 15, y: 8, wait: 0 },
          { x: 36, y: 8, wait: 3 },
          { x: 36, y: 13, wait: 4 },
          { x: 36, y: 8, wait: 0 },
          { x: 15, y: 8, wait: 0 },
          { x: 17, y: 12, wait: 0 },
        ],
      },
      {
        name: "Lobby Guard", behavior: "investigate",
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 12, y: 20, wait: 2 },
          { x: 40, y: 20, wait: 2 },
        ],
      },
      {
        name: "Vault Sentry", behavior: "investigate", armed: true,
        speed: 1.7, vision: 9, fov: 85, hearingMult: 1,
        patrol: [
          { x: 33, y: 12, wait: 2 },
          { x: 33, y: 7.5, wait: 2 },
        ],
      },
      {
        name: "Teller Rou", civilian: true, behavior: "retreat",
        speed: 1.1, vision: 6, fov: 100, hearingMult: 1,
        patrol: [
          { x: 12, y: 23, wait: 6, face: Math.PI },
          { x: 15, y: 25, wait: 5, face: Math.PI / 2 },
        ],
      },
      {
        name: "Client Ama", civilian: true, behavior: "retreat",
        speed: 1.1, vision: 6, fov: 100, hearingMult: 1,
        patrol: [
          { x: 30, y: 23, wait: 6 },
          { x: 36, y: 24, wait: 5 },
        ],
      },
    ],
  },
];

// Props are solid cover: convert each one into wall segments (flagged prop so
// the renderer draws furniture instead of wall lines). They block vision,
// movement, and bullets, and muffle sound — for everyone.
for (const lvl of LEVELS) {
  for (const p of lvl.props || []) {
    if (p.kind === "tree") { p.w = p.w || 0.9; p.h = p.h || 0.9; }
    lvl.walls.push(
      { x1: p.x, y1: p.y, x2: p.x + p.w, y2: p.y, prop: true },
      { x1: p.x + p.w, y1: p.y, x2: p.x + p.w, y2: p.y + p.h, prop: true },
      { x1: p.x + p.w, y1: p.y + p.h, x2: p.x, y2: p.y + p.h, prop: true },
      { x1: p.x, y1: p.y + p.h, x2: p.x, y2: p.y, prop: true },
    );
  }
}

// Fill in enemy defaults and precompute radian FOVs once.
for (const lvl of LEVELS) {
  for (const e of lvl.enemies) {
    e.speed = e.speed ?? 1.7;
    e.vision = e.vision ?? 9;
    e.fov = e.fov ?? 85;
    e.fovRad = (e.fov * Math.PI) / 180;
    e.hearingMult = e.hearingMult ?? 1;
    e.behavior = e.behavior ?? "investigate";
    e.retreatDist = e.retreatDist ?? 3.2;
  }
}

if (typeof module !== "undefined") module.exports = { LEVELS, UNIT_INFO, HIRE_COSTS, UPGRADES, PATHS, GEAR, SKILLS, RECON_COST, unitMaxLevel, perkValues, perksFromPaths, unitSpawn };
