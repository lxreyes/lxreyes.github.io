// Centralized keyboard state. The rest of the game just reads booleans
// off `Input` rather than wiring up its own event listeners (separation
// of concerns: one place owns "what keys are down").

const Input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  fire: false,        // true while held
  firePressed: false, // true for a single frame on the press edge

  _firePrev: false,

  // Called once per frame by the game loop, AFTER input is consumed,
  // to compute edge-triggered values for the next frame.
  update() {
    this.firePressed = this.fire && !this._firePrev;
    this._firePrev = this.fire;
  },
};

function bindInput() {
  const down = (e) => set(e, true);
  const up = (e) => set(e, false);

  function set(e, pressed) {
    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        Input.forward = pressed; break;
      case "KeyS":
      case "ArrowDown":
        Input.back = pressed; break;
      case "KeyA":
      case "ArrowLeft":
        Input.left = pressed; break;
      case "KeyD":
      case "ArrowRight":
        Input.right = pressed; break;
      case "Space":
        Input.fire = pressed;
        e.preventDefault(); // stop the page from scrolling
        break;
      default:
        return;
    }
  }

  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);

  // Safety: if the window loses focus, release everything so the ship
  // doesn't sail off on its own.
  window.addEventListener("blur", () => {
    Input.forward = Input.back = Input.left = Input.right = Input.fire = false;
  });
}
