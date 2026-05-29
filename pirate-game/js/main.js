// Entry point: build the game, wire up the buttons, set sail.

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("game");
  const minimap = document.getElementById("minimap");

  // Give the minimap a crisp internal resolution (CSS sizes it on screen).
  minimap.width = 180;
  minimap.height = 180;

  const game = new Game(canvas, minimap);

  const overlay = document.getElementById("overlay");
  const gameover = document.getElementById("gameover");

  document.getElementById("start-btn").addEventListener("click", () => {
    overlay.classList.add("hidden");
    game.start();
  });

  document.getElementById("restart-btn").addEventListener("click", () => {
    gameover.classList.add("hidden");
    game.start();
  });

  // E is the contextual action: dock at the Cove, go ashore at a village,
  // or board your ship — whatever the on-screen prompt currently offers.
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return; // ignore auto-repeat so holding E doesn't spam toggles
    if (e.code === "KeyE") {
      if (game.shopOpen) game.closeShop();
      else game.interact();
    } else if (e.code === "Escape" && game.shopOpen) {
      game.closeShop();
    }
  });

  document.getElementById("leave-port").addEventListener("click", () => game.closeShop());

  // One delegated listener turns any shop buy-button into the right purchase.
  document.getElementById("shop").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-buy]");
    if (!btn) return;
    const kind = btn.dataset.buy;
    if (kind === "ship") game.buyShip(Number(btn.dataset.i));
    else if (kind === "upgrade") game.buyUpgrade(btn.dataset.key);
    else if (kind === "repair") game.repairHull();
  });
});
