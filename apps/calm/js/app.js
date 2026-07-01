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

  // Curated playlists — layer several soundscapes with per-layer gain so the
  // mix stays balanced. Weights are relative to each layer, master volume is
  // still driven by the slider.
  const PLAYLISTS = [
    { id: "rainy-cabin",   icon: "🏡", name: "Rainy Cabin",   layers: [{ id: "rain", gain: 0.9 }, { id: "fire", gain: 0.7 }], scene: "rain" },
    { id: "storm-front",   icon: "⛈️", name: "Storm Front",   layers: [{ id: "storm", gain: 1 }, { id: "wind", gain: 0.5 }], scene: "storm" },
    { id: "deep-focus",    icon: "🎯", name: "Deep Focus",    layers: [{ id: "ocean", gain: 0.8 }, { id: "wind", gain: 0.35 }], scene: "ocean" },
    { id: "sleep",         icon: "😴", name: "Sleep",          layers: [{ id: "rain", gain: 0.55 }, { id: "night", gain: 0.55 }], scene: "night" },
    { id: "forest-morning",icon: "🌅", name: "Forest Morning", layers: [{ id: "forest", gain: 1 }, { id: "stream", gain: 0.55 }, { id: "wind", gain: 0.25 }], scene: "forest" },
    { id: "cozy-evening",  icon: "🕯️", name: "Cozy Evening",   layers: [{ id: "fire", gain: 0.9 }, { id: "chimes", gain: 0.55 }], scene: "fire" },
    { id: "winter-porch",  icon: "❄️", name: "Winter Porch",   layers: [{ id: "snow", gain: 0.85 }, { id: "wind", gain: 0.4 }, { id: "chimes", gain: 0.4 }], scene: "snow" },
    { id: "ocean-storm",   icon: "🌊", name: "Ocean Storm",    layers: [{ id: "ocean", gain: 0.9 }, { id: "storm", gain: 0.55 }, { id: "wind", gain: 0.4 }], scene: "ocean" },
  ];

  const CUSTOM_KEY = "calm-custom-playlists";

  const $ = (id) => document.getElementById(id);
  let currentPlaylistId = null; // id of a curated or custom playlist, if any
  let customPlaylists = [];
  try { customPlaylists = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]"); } catch (_) { customPlaylists = []; }

  function init() {
    PixelScene.init($("scene"));
    PixelScene.set("idle");
    buildPlaylistBar();
    buildGrid();
    wireControls();
  }

  function buildGrid() {
    const grid = $("grid");
    grid.innerHTML = "";
    for (const s of SOUNDSCAPES) {
      const card = document.createElement("button");
      card.className = "card";
      card.dataset.id = s.id;
      card.innerHTML =
        `<span class="c-icon">${s.icon}</span>` +
        `<span class="c-name">${s.name}</span>` +
        `<span class="c-desc">${s.desc}</span>` +
        `<span class="c-layer" aria-hidden="true">+</span>`;
      // Plain click = solo (replace whatever's playing).
      // Shift/Cmd/Ctrl click OR clicking the "+" chip = layer/toggle.
      card.addEventListener("click", (e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey || e.target.classList.contains("c-layer")) {
          toggleLayer(s.id);
        } else {
          chooseSolo(s.id);
        }
      });
      grid.appendChild(card);
    }
    refreshCards();
  }

  function buildPlaylistBar() {
    // Insert the playlist bar between the controls and the grid.
    const grid = $("grid");
    let bar = document.getElementById("playlistBar");
    if (!bar) {
      bar = document.createElement("section");
      bar.id = "playlistBar";
      bar.className = "playlist-bar";
      bar.setAttribute("aria-label", "Playlists");
      grid.parentNode.insertBefore(bar, grid);
    }
    renderPlaylistBar();
  }

  function renderPlaylistBar() {
    const bar = $("playlistBar");
    bar.innerHTML =
      `<div class="pl-head">
        <span class="pl-title">Playlists</span>
        <span class="pl-hint">tap to layer a mix &middot; shift+click a sound to add it to any mix</span>
      </div>
      <div class="pl-list" id="plList"></div>`;
    const list = $("plList");
    // Curated + custom in the same row
    const all = PLAYLISTS.concat(customPlaylists.map(function (c) {
      return { id: "custom-" + c.id, icon: "★", name: c.name, layers: c.layers, scene: c.scene || null, custom: true, storageId: c.id };
    }));
    all.forEach(function (p) {
      const b = document.createElement("button");
      b.className = "pl-chip";
      if (p.custom) b.classList.add("is-custom");
      b.dataset.pid = p.id;
      b.innerHTML =
        `<span class="pl-icon">${p.icon}</span>` +
        `<span class="pl-name">${p.name}</span>` +
        `<span class="pl-count">${p.layers.length}</span>` +
        (p.custom ? `<span class="pl-remove" data-storage-id="${p.storageId}" aria-label="Delete">×</span>` : "");
      b.addEventListener("click", function (e) {
        if (e.target.classList.contains("pl-remove")) {
          removeCustomPlaylist(e.target.dataset.storageId);
          e.stopPropagation();
          return;
        }
        playPlaylist(p);
      });
      list.appendChild(b);
    });
    // "New playlist" tile — opens the full editor
    const create = document.createElement("button");
    create.className = "pl-chip pl-save";
    create.innerHTML = `<span class="pl-icon">＋</span><span class="pl-name">New playlist</span>`;
    create.addEventListener("click", function () { openEditor(null); });
    list.appendChild(create);
    // "Save current mix" — quick capture of what's playing
    const save = document.createElement("button");
    save.className = "pl-chip pl-save";
    save.innerHTML = `<span class="pl-icon">✎</span><span class="pl-name">Save current mix</span>`;
    save.addEventListener("click", saveCurrentMix);
    list.appendChild(save);
    // Edit handles on custom chips (click on the icon to edit)
    list.querySelectorAll(".pl-chip.is-custom").forEach(function (chip) {
      // Right-clicking or long-pressing isn't discoverable — add a subtle
      // "edit" pencil that appears on hover next to the count.
      const pid = chip.dataset.pid;
      const storageId = pid.replace(/^custom-/, "");
      const editBtn = document.createElement("span");
      editBtn.className = "pl-edit";
      editBtn.textContent = "✎";
      editBtn.setAttribute("aria-label", "Edit");
      editBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        const found = customPlaylists.find(function (p) { return p.id === storageId; });
        if (found) openEditor(found);
      });
      // Insert before the remove handle
      const remove = chip.querySelector(".pl-remove");
      if (remove) chip.insertBefore(editBtn, remove);
      else chip.appendChild(editBtn);
    });
    refreshCards();
  }

  function chooseSolo(id) {
    const s = SOUNDSCAPES.find((x) => x.id === id);
    if (!s) return;
    currentPlaylistId = null;

    AudioEngine.select(id);
    PixelScene.set(id);

    // Now-playing pill = the soundscape
    setNowPlaying(s.icon, s.name);
    setPlayingUI(true);
    refreshCards();
  }

  function toggleLayer(id) {
    const s = SOUNDSCAPES.find((x) => x.id === id);
    if (!s) return;
    // Toggling breaks the "current playlist" concept
    currentPlaylistId = null;
    AudioEngine.toggleLayer(id);
    const active = AudioEngine.activeLayers();
    if (active.length === 0) {
      PixelScene.set("idle");
      setPlayingUI(false);
      hideNowPlaying();
    } else {
      // Match the scene to the most recently activated soundscape (last in list)
      const focusId = active[active.length - 1];
      const focus = SOUNDSCAPES.find((x) => x.id === focusId);
      PixelScene.set(focusId);
      const label = active.length === 1
        ? focus.name
        : focus.name + " · +" + (active.length - 1) + " more";
      setNowPlaying("🎧", label);
      setPlayingUI(true);
    }
    refreshCards();
  }

  function playPlaylist(p) {
    currentPlaylistId = p.id;
    AudioEngine.setLayers(p.layers);
    PixelScene.set(p.scene || p.layers[0].id);
    setNowPlaying(p.icon, p.name);
    setPlayingUI(true);
    refreshCards();
  }

  function saveCurrentMix() {
    const active = AudioEngine.activeLayers();
    if (active.length < 2) {
      alert("Layer at least two soundscapes first (shift+click a card to add).");
      return;
    }
    const name = prompt("Name this playlist:", "My mix");
    if (!name) return;
    const id = String(Date.now()).slice(-8);
    // Save the actual mix, giving each layer a gain of 1 for now.
    customPlaylists.push({
      id: id,
      name: name.slice(0, 32),
      layers: active.map(function (a) { return { id: a, gain: 1 }; }),
      scene: active[active.length - 1]
    });
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customPlaylists)); } catch (_) {}
    renderPlaylistBar();
  }

  function removeCustomPlaylist(storageId) {
    customPlaylists = customPlaylists.filter(function (p) { return p.id !== storageId; });
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customPlaylists)); } catch (_) {}
    renderPlaylistBar();
  }

  function refreshCards() {
    const activeIds = AudioEngine.activeLayers();
    document.querySelectorAll(".card").forEach(function (c) {
      c.classList.toggle("active", activeIds.indexOf(c.dataset.id) !== -1);
    });
    // Highlight active playlist chip if any
    document.querySelectorAll(".pl-chip[data-pid]").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.pid === currentPlaylistId);
    });
  }

  function setNowPlaying(icon, name) {
    const np = $("nowPlaying");
    np.hidden = false;
    $("npIcon").textContent = icon;
    $("npName").textContent = name;
  }
  function hideNowPlaying() { $("nowPlaying").hidden = true; }

  function wireControls() {
    $("playToggle").disabled = true;

    const toggle = () => {
      if (!AudioEngine.hasSelection()) {
        // No selection yet — start the first curated playlist as a friendly default.
        playPlaylist(PLAYLISTS[0]);
        return;
      }
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
      if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
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

  // ---------- Custom playlist editor ----------
  // Opens the modal for a new playlist (existing == null) or edits an existing
  // custom playlist (existing == { id, name, layers, scene? }).
  let editingId = null;                  // null when creating
  let editState = new Map();             // id -> gain (only present when checked)
  let previewingEdit = false;

  function openEditor(existing) {
    editingId = existing ? existing.id : null;
    editState = new Map();
    if (existing) {
      existing.layers.forEach(function (l) { editState.set(l.id, l.gain != null ? l.gain : 1); });
    }
    $("plModalTitle").textContent = existing ? "Edit playlist" : "New playlist";
    $("plName").value = existing ? existing.name : "";
    renderEditorLayers();
    const modal = $("plModal");
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    setTimeout(function () { $("plName").focus(); }, 20);
  }
  function closeEditor() {
    // Stop preview mix if it's still running
    if (previewingEdit) {
      AudioEngine.pause();
      previewingEdit = false;
      $("plPreview").textContent = "Preview";
    }
    const modal = $("plModal");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    editingId = null;
    editState = new Map();
  }

  function renderEditorLayers() {
    const wrap = $("plLayers");
    wrap.innerHTML = "";
    SOUNDSCAPES.forEach(function (s) {
      const active = editState.has(s.id);
      const gain = editState.has(s.id) ? editState.get(s.id) : 1;
      const row = document.createElement("div");
      row.className = "pl-layer" + (active ? " is-on" : "");
      row.innerHTML =
        `<button class="pl-layer-toggle" data-id="${s.id}" aria-pressed="${active ? "true" : "false"}">
           <span class="pl-layer-check">${active ? "✓" : ""}</span>
           <span class="pl-layer-icon">${s.icon}</span>
           <span class="pl-layer-name">${s.name}</span>
         </button>
         <input class="pl-layer-gain" type="range" min="0" max="100" value="${Math.round(gain * 100)}" data-id="${s.id}" ${active ? "" : "disabled"} aria-label="${s.name} volume">
         <span class="pl-layer-gain-val" data-id="${s.id}">${Math.round(gain * 100)}%</span>`;
      wrap.appendChild(row);
    });
    // Wire toggles + sliders
    wrap.querySelectorAll(".pl-layer-toggle").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const id = btn.dataset.id;
        if (editState.has(id)) editState.delete(id);
        else editState.set(id, 1);
        renderEditorLayers();
        if (previewingEdit) refreshPreview();
      });
    });
    wrap.querySelectorAll(".pl-layer-gain").forEach(function (slider) {
      slider.addEventListener("input", function () {
        const id = slider.dataset.id;
        const v = parseInt(slider.value, 10) / 100;
        editState.set(id, v);
        const label = wrap.querySelector('.pl-layer-gain-val[data-id="' + id + '"]');
        if (label) label.textContent = Math.round(v * 100) + "%";
        if (previewingEdit) refreshPreview();
      });
    });
  }

  function currentEditorLayers() {
    const list = [];
    editState.forEach(function (gain, id) { list.push({ id: id, gain: gain }); });
    return list;
  }

  function refreshPreview() {
    const list = currentEditorLayers();
    if (list.length === 0) {
      AudioEngine.pause();
      return;
    }
    AudioEngine.setLayers(list);
    setPlayingUI(true);
  }
  function togglePreview() {
    const list = currentEditorLayers();
    if (list.length === 0) return;
    if (previewingEdit) {
      AudioEngine.pause();
      previewingEdit = false;
      $("plPreview").textContent = "Preview";
      setPlayingUI(false);
    } else {
      previewingEdit = true;
      $("plPreview").textContent = "Stop preview";
      // Show a scene appropriate to the last-added layer
      const lastId = list[list.length - 1].id;
      PixelScene.set(lastId);
      setNowPlaying("🎧", "Preview · " + list.length + (list.length === 1 ? " layer" : " layers"));
      refreshPreview();
    }
  }
  function saveFromEditor() {
    const name = ($("plName").value || "").trim();
    if (!name) { $("plName").focus(); return; }
    const layers = currentEditorLayers();
    if (layers.length === 0) {
      $("plPreviewHint").textContent = "Pick at least one soundscape to save";
      return;
    }
    if (editingId) {
      const idx = customPlaylists.findIndex(function (p) { return p.id === editingId; });
      if (idx >= 0) {
        customPlaylists[idx].name = name.slice(0, 32);
        customPlaylists[idx].layers = layers;
        customPlaylists[idx].scene = layers[layers.length - 1].id;
      }
    } else {
      customPlaylists.push({
        id: String(Date.now()).slice(-8),
        name: name.slice(0, 32),
        layers: layers,
        scene: layers[layers.length - 1].id
      });
    }
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customPlaylists)); } catch (_) {}
    closeEditor();
    renderPlaylistBar();
  }

  function wireEditor() {
    document.querySelectorAll("#plModal [data-close]").forEach(function (el) {
      el.addEventListener("click", closeEditor);
    });
    $("plSave").addEventListener("click", saveFromEditor);
    $("plPreview").addEventListener("click", togglePreview);
    document.addEventListener("keydown", function (e) {
      if (!$("plModal").hidden && e.code === "Escape") closeEditor();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(); wireEditor(); });
  } else {
    init(); wireEditor();
  }
})();
