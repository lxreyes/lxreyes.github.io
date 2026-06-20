/* app.js — wires the soundscape cards, the play/pause + volume controls,
 * the audio engine, and the pixel scene together. */
(function () {
  "use strict";

  const SOUNDSCAPES = [
    { id: "rain",   icon: "🌧️", name: "Rain on Metal", desc: "steady drops on a tin roof" },
    { id: "fire",   icon: "🔥", name: "Fireplace",     desc: "a slow, popping hearth" },
    { id: "ocean",  icon: "🌊", name: "Ocean Waves",   desc: "tide rolling in and out" },
    { id: "wind",   icon: "🍃", name: "Wind",          desc: "gusts over open hills" },
    { id: "forest", icon: "🌲", name: "Forest Birds",  desc: "a bright woodland morning" },
    { id: "night",  icon: "🌙", name: "Night Crickets", desc: "fireflies and quiet chirps" },
    { id: "storm",  icon: "⛈️", name: "Thunderstorm",  desc: "downpour and far-off thunder" },
    { id: "stream", icon: "🏞️", name: "Babbling Brook", desc: "water running over rocks" },
    { id: "chimes", icon: "🎐", name: "Wind Chimes",    desc: "soft bells at dusk" },
    { id: "snow",   icon: "❄️", name: "Snowfall",       desc: "a hush of falling snow" },
  ];

  const $ = (id) => document.getElementById(id);
  let currentId = null;

  function init() {
    PixelScene.init($("scene"));
    PixelScene.set("idle");
    buildGrid();
    wireControls();
  }

  function buildGrid() {
    const grid = $("grid");
    for (const s of SOUNDSCAPES) {
      const card = document.createElement("button");
      card.className = "card";
      card.dataset.id = s.id;
      card.innerHTML =
        `<span class="c-icon">${s.icon}</span>` +
        `<span class="c-name">${s.name}</span>` +
        `<span class="c-desc">${s.desc}</span>`;
      card.addEventListener("click", () => choose(s.id));
      grid.appendChild(card);
    }
  }

  function choose(id) {
    const s = SOUNDSCAPES.find((x) => x.id === id);
    if (!s) return;
    currentId = id;

    AudioEngine.select(id);
    PixelScene.set(id);

    // highlight the active card
    document.querySelectorAll(".card").forEach((c) =>
      c.classList.toggle("active", c.dataset.id === id)
    );

    // now-playing pill
    const np = $("nowPlaying");
    np.hidden = false;
    $("npIcon").textContent = s.icon;
    $("npName").textContent = s.name;

    setPlayingUI(true);
  }

  function wireControls() {
    $("playToggle").disabled = true;

    const toggle = () => {
      if (!currentId) { choose(SOUNDSCAPES[0].id); return; }
      if (AudioEngine.isPlaying()) {
        AudioEngine.pause();
        setPlayingUI(false);
      } else {
        AudioEngine.resume();
        setPlayingUI(true);
      }
    };

    $("playToggle").addEventListener("click", toggle);
    $("playOverlay").addEventListener("click", toggle);

    $("volume").addEventListener("input", (e) => {
      AudioEngine.setVolume(e.target.value / 100);
    });
    AudioEngine.setVolume($("volume").value / 100);

    // spacebar = play/pause (ignore when typing in a field)
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        toggle();
      }
    });
  }

  function setPlayingUI(playing) {
    $("playToggle").disabled = false;
    $("stage").classList.toggle("playing", playing);
    $("playToggle").querySelector(".i-play").hidden = playing;
    $("playToggle").querySelector(".i-pause").hidden = !playing;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
