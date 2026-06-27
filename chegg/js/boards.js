/*
 * boards.js — selectable board layouts. Each board declares its size (rows/cols),
 * a list of "blocked" terrain tiles (you can't move/spawn/shoot through them) and
 * a visual theme. Layouts are kept 180°-symmetric so neither player is favoured.
 *
 * Coordinates are "row,col". Normal boards are 9x12; keep blocked tiles in the
 * middle rows so the spawn rows (top 2 / bottom 2) stay clear.
 */
(function () {
  window.BOARDS = [
    {
      id: "classic", name: "Classic", theme: "stone", rows: 9, cols: 12,
      desc: "An open field. No terrain.",
      blocked: [],
    },
    {
      id: "pillars", name: "Pillars", theme: "stone", rows: 9, cols: 12,
      desc: "Stone pillars give cover and break up sight-lines.",
      blocked: ["3,3", "3,8", "5,3", "5,8", "2,5", "2,6", "6,5", "6,6"],
    },
    {
      id: "rift", name: "Lava Rift", theme: "lava", rows: 9, cols: 12,
      desc: "A lava chasm splits the middle — go around it.",
      blocked: ["2,5", "3,5", "4,5", "5,5", "6,5", "2,6", "3,6", "4,6", "5,6", "6,6"],
    },
    {
      id: "trenches", name: "Trenches", theme: "water", rows: 9, cols: 12,
      desc: "Two staggered walls force winding approaches.",
      blocked: ["3,2", "3,3", "3,4", "5,7", "5,8", "5,9"],
    },
    // ----- bigger boards -----
    {
      id: "wide_field", name: "Wide Field", theme: "stone", rows: 10, cols: 16,
      desc: "A huge open plain — room for big armies. No terrain.",
      blocked: [],
    },
    {
      id: "citadel", name: "Citadel", theme: "stone", rows: 12, cols: 16,
      desc: "A large fortress with scattered stone pillars.",
      blocked: ["4,4", "4,11", "7,4", "7,11", "5,7", "6,8", "2,7", "9,8"],
    },
    {
      id: "lava_canyon", name: "Lava Canyon", theme: "lava", rows: 11, cols: 18,
      desc: "A vast canyon split by a lava river (with a bridge in the middle).",
      blocked: ["2,8", "3,8", "4,8", "6,8", "7,8", "8,8", "2,9", "3,9", "4,9", "6,9", "7,9", "8,9"],
    },
  ];
})();
