# ☠️ Salt & Plunder

A simple **open-world pirate game** that runs in the browser — no build step, no
dependencies, just HTML5 Canvas and vanilla JavaScript. Sail a procedurally
generated sea, sink rival pirate ships, and scoop up floating gold.

![pirate game](https://img.shields.io/badge/play-in%20browser-c9a14a)

## 🎮 Controls

The game is fully mouse-driven:

| Input | Action |
| --- | --- |
| **Left-click** | Sail there (or walk, when ashore) |
| **Right-click** | Fire cannons straight at your cursor |
| `E` | Dock at The Pirate's Cove · go ashore at a village · board ship |

## ▶️ How to play it

Because the game is plain HTML/JS, you can run it three ways:

1. **Double-click `index.html`** — opens straight in your browser.
2. **VS Code Live Server** — install the "Live Server" extension, then
   right-click `index.html` → *Open with Live Server*. (Auto-reloads on save.)
3. **A tiny local server**, e.g. `python3 -m http.server` then visit
   <http://localhost:8000>.

## 🗺️ What's in the world

- A large 6000×6000 ocean with scattered, hand-wobbled islands and palm trees.
- Roaming **enemy pirate ships** that hunt you, circle, and fire broadsides.
- **Floating treasure** to collect — sunk ships spill extra loot.
- **Skyrates** — rare flying pirate airships that drift in and bomb you from
  above (dodge the telegraphed blast rings). Shoot one down for a big hoard.
- **The Pirate's Cove** — dock to buy bigger ships, more cannons, and upgrades.
- **Villages** on the larger islands — sail up and press `E` to launch a
  **turn-based grid battle**: storm the village with your captain (and crew
  recruited at the Cove) to rout the defenders and seize their loot.
- A **minimap**, **hull/health bar**, gold counter, and screen-shake juice.

## 🧱 Project structure

```
index.html        # markup + HUD + load order
css/style.css     # all styling
js/utils.js       # math helpers (shared, loads first)
js/entities.js    # Ship, Cannonball, Treasure, Particle, Villager
js/world.js       # island generation + ocean
js/plunder.js     # Battle: the turn-based grid plunder mini-game
js/game.js        # the loop, camera, collisions, shop, villages, rendering
js/main.js        # bootstrap / button wiring
```

Each file owns one concern, which keeps the code easy to extend — adding, say,
ports to trade at or weather would each touch only a file or two.

## 🚀 Ideas to extend it

- Trading ports where you spend gold on upgrades (faster ship, more cannons).
- A wind system that affects sailing speed by heading.
- Bigger boss galleons, ship classes, or a quest/bounty board.
- Sound effects for cannons and the sea.
