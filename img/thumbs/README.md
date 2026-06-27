# Tile thumbnails

Drop a screenshot here named after the card's `data-key` and it becomes the
tile background on the portfolio.

## Naming

`img/thumbs/<data-key>.jpg` (or `.png`).

`data-key` values (from `index.html`):

| File name              | Game / app           |
| ---------------------- | -------------------- |
| `gauntlet.jpg`         | THE GAUNTLET         |
| `kings-jewels.jpg`     | KING'S JEWELS        |
| `sky-sim.jpg`          | SKY SIM              |
| `salt-plunder.jpg`     | SALT & PLUNDER       |
| `deadzone.jpg`         | DEADZONE             |
| `mini-minecraft.jpg`   | MINI MINECRAFT       |
| `ball-bounce.jpg`      | BALL BOUNCE          |
| `neon-viper.jpg`       | NEON VIPER           |
| `chegg.jpg`            | CHEGG                |
| `calm.jpg`             | CALM                 |
| `autoclicker.jpg`      | AUTOCLICKER & MACRO  |

## Tips

- Square aspect ratio looks best (the tile is roughly 1:1). The featured tile
  is 2x2, so it'll show more of the image.
- ~600x600 px is plenty — they're CSS-`cover` clipped anyway.
- A short JPG (60-80% quality) loads faster than a PNG of the same dimensions.
- The dark scrim at the bottom of each tile keeps the title readable, so don't
  worry about busy areas in the lower-left.
- No file? The card just keeps its accent-coloured gradient — no broken
  image, no console error. Add files as you have them.
