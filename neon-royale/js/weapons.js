
// Weapon catalog. `slot` decides whether a pickup replaces your primary or
// secondary. Upgrades (explosive/bouncy/pierce/multishot/damage) stack on top
// of these base stats; the rocket has innate explosive.
const WEAPONS = {
  pistol: {
    name: 'PISTOL', slot: 'secondary', damage: 22, headMult: 2.2,
    fireInterval: 0.22, mag: 14, auto: false, pellets: 1, spread: 0.004,
    reload: 1.1, tracer: 0xbff2ff, explosive: 0,
  },
  smg: {
    name: 'SMG', slot: 'primary', damage: 14, headMult: 2,
    fireInterval: 0.07, mag: 32, auto: true, pellets: 1, spread: 0.03,
    reload: 1.5, tracer: 0x9be8ff, explosive: 0,
  },
  rifle: {
    name: 'RIFLE', slot: 'primary', damage: 34, headMult: 3,
    fireInterval: 0.1, mag: 24, auto: true, pellets: 1, spread: 0.012,
    reload: 1.4, tracer: 0x9be8ff, explosive: 0,
  },
  shotgun: {
    name: 'SHOTGUN', slot: 'primary', damage: 11, headMult: 1.8,
    fireInterval: 0.8, mag: 6, auto: false, pellets: 9, spread: 0.13,
    reload: 1.9, tracer: 0xffd27a, explosive: 0,
  },
  sniper: {
    name: 'SNIPER', slot: 'primary', damage: 95, headMult: 2,
    fireInterval: 1.1, mag: 5, auto: false, pellets: 1, spread: 0.0,
    reload: 2.0, tracer: 0x7dffe6, explosive: 0,
  },
  rocket: {
    name: 'ROCKET', slot: 'primary', damage: 30, headMult: 1,
    fireInterval: 1.0, mag: 4, auto: false, pellets: 1, spread: 0.0,
    reload: 2.2, tracer: 0xffae42, explosive: 2,
  },
};

// Pools a crate can roll from.
const PRIMARY_WEAPONS = ['smg', 'rifle', 'shotgun', 'sniper', 'rocket'];
const SECONDARY_WEAPONS = ['pistol'];
