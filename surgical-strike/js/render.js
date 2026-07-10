// Canvas renderer. Reads app state, never mutates the sim.
const Renderer = (() => {
  const S = 20; // pixels per meter at zoom 1
  const W = 960, H = 640;

  const fogCanvas = document.createElement("canvas");
  fogCanvas.width = WORLD.fogW;
  fogCanvas.height = WORLD.fogH;
  let fogVersionDrawn = -1;
  let fogSrcDrawn = null;

  function rebuildFog(intel) {
    const fctx = fogCanvas.getContext("2d");
    const img = fctx.createImageData(WORLD.fogW, WORLD.fogH);
    for (let i = 0; i < intel.grid.length; i++) {
      const o = i * 4;
      img.data[o] = 4; img.data[o + 1] = 7; img.data[o + 2] = 13;
      img.data[o + 3] = intel.grid[i] ? 0 : 240;
    }
    fctx.putImageData(img, 0, 0);
    fogVersionDrawn = intel.revealVersion;
  }

  // --- camera ---------------------------------------------------------
  function applyCam(ctx, cam, shake, shakePhase) {
    ctx.translate(W / 2, H / 2);
    if (shake > 0.01) {
      ctx.translate(Math.sin(shakePhase * 61) * shake * 14, Math.cos(shakePhase * 47) * shake * 11);
    }
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x * S, -cam.y * S);
  }
  const px = m => m * S;

  // Is a scheduled blackout window active at preview time t (planning only)?
  function plannedBlackoutAt(app, t) {
    return (app.plan.blackouts || []).some(b => t >= b.t && t <= b.t + app.perks.blackoutDur);
  }
  function visionMult(app) {
    if (app.sim) return app.sim.isBlackout() ? TUNING.blackoutVision : 1;
    return plannedBlackoutAt(app, app.previewT) ? TUNING.blackoutVision : 1;
  }

  // Dev "see the whole building": fog off, every hostile drawn.
  function devRevealOn(app) {
    return !!(app.save && app.save.dev && app.save.devOpts && app.save.devOpts.revealMap);
  }

  // --- world pieces ---------------------------------------------------
  function drawGround(ctx, level) {
    ctx.fillStyle = "#0d1420";
    ctx.fillRect(0, 0, px(WORLD.w), px(WORLD.h));
    // Interior floors read slightly warmer than the grounds.
    ctx.fillStyle = "#161e2d";
    for (const r of level.rooms || []) ctx.fillRect(px(r.x), px(r.y), px(r.w), px(r.h));
    ctx.strokeStyle = "rgba(120,150,190,0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD.w; x += 2) {
      ctx.beginPath(); ctx.moveTo(px(x), 0); ctx.lineTo(px(x), px(WORLD.h)); ctx.stroke();
    }
    for (let y = 0; y <= WORLD.h; y += 2) {
      ctx.beginPath(); ctx.moveTo(0, px(y)); ctx.lineTo(px(WORLD.w), px(y)); ctx.stroke();
    }
  }

  function drawWalls(ctx, level) {
    for (const w of level.walls) {
      if (w.prop) continue; // furniture/cover is drawn by drawProps
      if (w.doorId != null) continue; // locked doors get their own pass
      ctx.strokeStyle = w.window ? "#7dd3fc" : "#c3cede";
      ctx.lineWidth = w.window ? 3 : 5;
      ctx.beginPath();
      ctx.moveTo(px(w.x1), px(w.y1));
      ctx.lineTo(px(w.x2), px(w.y2));
      ctx.stroke();
    }
  }

  const PROP_STYLE = {
    desk: { fill: "#6b4f2e", edge: "#8a6a40" },
    table: { fill: "#5d452a", edge: "#7a5c38" },
    shelf: { fill: "#4a3620", edge: "#6b4f2e" },
    cabinet: { fill: "#3f4a5a", edge: "#5a6a80" },
    bed: { fill: "#3a4a66", edge: "#546a90" },
    sofa: { fill: "#553a56", edge: "#755278" },
    crate: { fill: "#7a6434", edge: "#9a8148" },
    planter: { fill: "#2e4a2e", edge: "#3f663f" },
    car: { fill: "#3c4450", edge: "#59667a" },
  };

  function drawProps(ctx, level) {
    for (const p of level.props || []) {
      if (p.kind === "tree") {
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
        ctx.fillStyle = "#274a2b";
        ctx.beginPath();
        ctx.arc(px(cx), px(cy), px(1.25), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#3a6b40";
        ctx.beginPath();
        ctx.arc(px(cx) - 3, px(cy) - 3, px(0.8), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1c331f";
        ctx.beginPath();
        ctx.arc(px(cx), px(cy), px(0.22), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const st = PROP_STYLE[p.kind] || PROP_STYLE.crate;
        ctx.fillStyle = st.fill;
        ctx.strokeStyle = st.edge;
        ctx.lineWidth = 1.5;
        ctx.fillRect(px(p.x), px(p.y), px(p.w), px(p.h));
        ctx.strokeRect(px(p.x), px(p.y), px(p.w), px(p.h));
        if (p.kind === "car") {
          ctx.fillStyle = "rgba(125,180,220,0.35)";
          ctx.fillRect(px(p.x) + 3, px(p.y) + px(p.h) * 0.22, px(p.w) - 6, px(p.h) * 0.18);
          ctx.fillRect(px(p.x) + 3, px(p.y) + px(p.h) * 0.62, px(p.w) - 6, px(p.h) * 0.16);
        }
      }
    }
  }

  function drawJunctionBoxes(ctx, app) {
    if (!app.unitsAvail.hacker) return;
    for (const j of app.level.junctionBoxes || []) {
      ctx.fillStyle = "#0a0f18";
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 1.5;
      ctx.fillRect(px(j.x) - 7, px(j.y) - 7, 14, 14);
      ctx.strokeRect(px(j.x) - 7, px(j.y) - 7, 14, 14);
      ctx.fillStyle = "#facc15";
      ctx.font = "10px monospace";
      ctx.fillText("⚡", px(j.x) - 5, px(j.y) + 4);
    }
  }

  function drawPerches(ctx, app) {
    const selected = app.plan.perchIndex;
    // No perch chosen yet? Pulse them so the next step is obvious (hit mode,
    // and only once the rifle is actually on the crew).
    const pulse = !app.sim && selected == null && app.mode !== "recon" && app.unitsAvail.sniper
      ? 3 + 2.5 * Math.sin(performance.now() / 220) : 0;
    app.level.perches.forEach((p, i) => {
      const sel = i === selected;
      ctx.strokeStyle = sel ? "#f87171" : "#8a6d6d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px(p.x), px(p.y), 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px(p.x) - 13, px(p.y)); ctx.lineTo(px(p.x) + 13, px(p.y));
      ctx.moveTo(px(p.x), px(p.y) - 13); ctx.lineTo(px(p.x), px(p.y) + 13);
      ctx.stroke();
      if (pulse) {
        ctx.strokeStyle = "rgba(248,113,113,0.6)";
        ctx.beginPath();
        ctx.arc(px(p.x), px(p.y), 12 + pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = sel ? "#f87171" : "#8a6d6d";
      ctx.font = "10px monospace";
      ctx.fillText(`P${i + 1}`, px(p.x) + 11, px(p.y) - 11);
    });
  }

  // First solid wall along a ray from `from` toward `dir` (bullet rules: windows
  // pass, Penetrator skips one wall). Returns the stop distance.
  function shotStop(app, from, dir) {
    const range = 80;
    const hits = [];
    for (const w of app.level.walls) {
      if (w.window) continue;
      const t = G.segIntersect(from.x, from.y, from.x + dir.x * range, from.y + dir.y * range, w.x1, w.y1, w.x2, w.y2);
      if (t !== null) hits.push(t * range);
    }
    hits.sort((a, b) => a - b);
    let pierceLeft = app.perks.pierce ? 1 : 0;
    for (const h of hits) {
      if (pierceLeft > 0) { pierceLeft--; continue; }
      return h;
    }
    return range;
  }

  // Vision cones are shadow-cast: each ray stops at the first wall or prop,
  // so what's drawn is exactly what the enemy can actually see.
  function drawCone(ctx, x, y, facing, fovRad, range, color, walls) {
    const steps = Math.max(10, Math.ceil(fovRad / 0.09));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px(x), px(y));
    for (let i = 0; i <= steps; i++) {
      const a = facing - fovRad / 2 + (i / steps) * fovRad;
      const dx = Math.cos(a), dy = Math.sin(a);
      const hit = G.raycast(x, y, x + dx * range, y + dy * range, walls, w => !w.window);
      const d = hit ? hit.t * range : range;
      ctx.lineTo(px(x + dx * d), px(y + dy * d));
    }
    ctx.closePath();
    ctx.fill();
  }

  // Wall-clipped sight boundary for ground units (the drone flies, so its
  // aerial reveal stays a plain circle too).
  function drawSightBoundary(ctx, x, y, range, walls, color) {
    const steps = 56;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      const hit = G.raycast(x, y, x + dx * range, y + dy * range, walls, w => !w.window);
      const d = hit ? hit.t * range : range;
      const sx = px(x + dx * d), sy = px(y + dy * d);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.stroke();
  }

  function drawEnemyBody(ctx, x, y, def, ghost, alive = true, rough = false) {
    const r = 7;
    // Rough optics: you can tell someone's there and roughly what kind, but not
    // a crisp fix — a soft blob and a "?", no clean outline or name. Buy the
    // Scout's optics or run a drone to sharpen it up.
    if (rough && alive) {
      const col = def.isTarget ? "251,191,36" : def.civilian ? "148,163,184" : "248,113,113";
      ctx.save();
      ctx.globalAlpha = ghost ? 0.7 : 1;
      for (let k = 3; k >= 1; k--) {
        ctx.fillStyle = `rgba(${col},0.1)`;
        ctx.beginPath();
        ctx.arc(px(x), px(y), 4 + k * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(${col},0.85)`;
      ctx.font = "bold 12px monospace";
      ctx.fillText("?", px(x) - 3, px(y) + 4);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalAlpha = ghost ? 0.55 : 1;
    ctx.fillStyle = !alive ? "#57324a" : def.isTarget ? "#fbbf24" : def.civilian ? "#cbd5e1" : "#f87171";
    if (ghost) {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
    }
    ctx.beginPath();
    if (def.isTarget) {
      ctx.moveTo(px(x), px(y) - r - 2);
      ctx.lineTo(px(x) + r, px(y));
      ctx.lineTo(px(x), px(y) + r + 2);
      ctx.lineTo(px(x) - r, px(y));
      ctx.closePath();
    } else {
      ctx.arc(px(x), px(y), r, 0, Math.PI * 2);
    }
    if (ghost) ctx.stroke(); else ctx.fill();
    ctx.setLineDash([]);
    ctx.fillStyle = ghost ? "rgba(200,210,230,0.6)" : "#e8eef8";
    ctx.font = "10px monospace";
    ctx.fillText(def.name + (def.keyHolder ? " 🔑" : "") + (def.jammer ? " 📡" : ""), px(x) + 10, px(y) + 3);
    // A live jammer pulses concentric rings — the source of the comms blackout.
    if (def.jammer && alive) {
      ctx.strokeStyle = "rgba(96,165,250,0.5)";
      ctx.lineWidth = 1;
      for (let k = 1; k <= 2; k++) {
        ctx.beginPath();
        ctx.arc(px(x), px(y), r + k * 5, -0.9, 0.9);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // A red dashed ring + blade on whoever the assassin is hunting.
  function drawMarkRing(ctx, x, y) {
    ctx.save();
    ctx.strokeStyle = "#f43f5e";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(px(x), px(y), 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#f43f5e";
    ctx.font = "bold 11px monospace";
    ctx.fillText("⚔", px(x) - 5, px(y) - 15);
    ctx.restore();
  }

  function drawEnemies(ctx, app) {
    const level = app.level, intel = app.intel, perks = app.perks;
    const executing = !!app.sim;
    const rough = !perks.sharpVisuals;
    const marked = app.plan ? app.plan.assassinMark : null;
    const vm = visionMult(app) * heatAlertMult(intel.heat);
    const shift = heatShift(intel.heat);

    level.enemies.forEach((def, i) => {
      const known = intel.known.has(i);

      if (executing) {
        const e = app.sim.enemies[i];
        const visible = devRevealOn(app) || app.sim.view.grid[fogIndex(e.x, e.y)];
        if (!visible) return;
        const coneColor = def.civilian
          ? (e.seesUnit ? "rgba(203,213,225,0.28)" : "rgba(148,163,184,0.07)")
          : e.seesUnit ? "rgba(248,113,113,0.30)"
          : e.mode.startsWith("react") ? "rgba(251,191,36,0.16)"
          : "rgba(251,191,36,0.08)";
        if (e.alive) drawCone(ctx, e.x, e.y, e.facing, def.fovRad, def.vision * vm * 0.9, coneColor, app.sim ? app.sim.walls : level.walls);
        if (e.alive && perks.showHearing) {
          ctx.strokeStyle = "rgba(125,211,252,0.25)";
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.arc(px(e.x), px(e.y), px(6.5 * def.hearingMult), 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        drawEnemyBody(ctx, e.x, e.y, def, false, e.alive, rough);
        if (i === marked && e.alive) drawMarkRing(ctx, e.x, e.y);
        if (e.seesUnit) {
          ctx.fillStyle = "#f87171";
          ctx.font = "bold 16px monospace";
          ctx.fillText("!", px(e.x) - 3, px(e.y) - 12);
        }
        if (e.mode.startsWith("react") && e.alive) {
          ctx.fillStyle = "#fbbf24";
          ctx.font = "bold 14px monospace";
          ctx.fillText("?", px(e.x) + 6, px(e.y) - 10);
        }
      } else if (known || devRevealOn(app)) {
        // Poisonable routine stops (once the Toxin Kit is owned).
        if (def.isTarget && perks.poison) {
          for (const w of def.patrol) {
            if ((w.wait || 0) < 3) continue;
            ctx.strokeStyle = "rgba(163,230,53,0.6)";
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.arc(px(w.x), px(w.y), px(TUNING.poisonReach), 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "rgba(163,230,53,0.9)";
            ctx.font = "10px monospace";
            ctx.fillText("☠", px(w.x) - 4, px(w.y) + 4);
          }
        }
        // Planning: predicted position at the preview time, assuming undisturbed
        // patrol (heated targets run a shifted routine — the ghosts show it).
        const g = patrolPosAt(def, app.previewT + (def.isTarget ? shift : 0));
        if (perks.showPatrols) {
          ctx.strokeStyle = "rgba(248,113,113,0.25)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 5]);
          ctx.beginPath();
          def.patrol.forEach((wp, k) => k === 0 ? ctx.moveTo(px(wp.x), px(wp.y)) : ctx.lineTo(px(wp.x), px(wp.y)));
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
        }
        drawCone(ctx, g.x, g.y, g.facing, def.fovRad, def.vision * vm * 0.9, "rgba(251,191,36,0.07)", level.walls);
        if (perks.showHearing) {
          ctx.strokeStyle = "rgba(125,211,252,0.2)";
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.arc(px(g.x), px(g.y), px(6.5 * def.hearingMult), 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        drawEnemyBody(ctx, g.x, g.y, def, true, true, rough);
        if (i === marked) drawMarkRing(ctx, g.x, g.y);

        // Ballistic computer: where this target should be at each shot's fire time.
        if (def.isTarget && perks.fireGhost) {
          const shots = app.plan.shots || [];
          shots.forEach((shot, si) => {
            if (shot.fireTime == null) return;
            // Only ghost the target this shot is plausibly meant for.
            if (shot.aim) {
              let bestIdx = -1, bestD = Infinity;
              level.enemies.forEach((d2, i2) => {
                if (!d2.isTarget || !intel.known.has(i2)) return;
                const g2 = patrolPosAt(d2, shot.fireTime + shift);
                const d = G.dist(g2.x, g2.y, shot.aim.x, shot.aim.y);
                if (d < bestD) { bestD = d; bestIdx = i2; }
              });
              if (bestIdx !== i) return;
            }
            const f = patrolPosAt(def, shot.fireTime + shift);
            ctx.strokeStyle = "rgba(251,191,36,0.8)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px(f.x), px(f.y), 10, 0, Math.PI * 2);
            ctx.moveTo(px(f.x) - 14, px(f.y)); ctx.lineTo(px(f.x) + 14, px(f.y));
            ctx.moveTo(px(f.x), px(f.y) - 14); ctx.lineTo(px(f.x), px(f.y) + 14);
            ctx.stroke();
            ctx.fillStyle = "rgba(251,191,36,0.8)";
            ctx.font = "9px monospace";
            ctx.fillText(shots.length > 1 ? `@F${si + 1}` : "@FIRE", px(f.x) + 12, px(f.y) + 14);
          });
        }
      }
    });
  }

  // --- crew -----------------------------------------------------------
  function unitPathFor(app, kind) {
    if (kind === "lockpick") return app.plan.lockpickPath;
    if (kind === "sapper") return app.plan.sapperPath;
    if (kind === "gunner") return app.plan.gunnerPath;
    if (kind === "assassin") return app.plan.assassinPath;
    if (kind === "spotter") return app.plan.spotterPath;
    if (kind === "drone") return app.plan.dronePath;
    if (kind === "decoy") return app.plan.decoyPath;
    if (kind === "hacker") return app.plan.hackerPath;
    return app.plan.scoutPath;
  }

  function drawUnitMarker(ctx, kind, x, y, ghost, dead) {
    const color = dead ? "#3d4a5f" : UNIT_INFO[kind].color;
    ctx.save();
    ctx.globalAlpha = ghost ? 0.7 : 1;
    if (kind === "drone") {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px(x), px(y), 6, 0, Math.PI * 2);
      ctx.moveTo(px(x) - 9, px(y) - 9); ctx.lineTo(px(x) + 9, px(y) + 9);
      ctx.moveTo(px(x) + 9, px(y) - 9); ctx.lineTo(px(x) - 9, px(y) + 9);
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px(x), px(y), 6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (dead) {
      ctx.fillStyle = "#f87171";
      ctx.font = "9px monospace";
      ctx.fillText("DOWN", px(x) + 10, px(y) - 8);
    }
    ctx.fillStyle = ghost ? "rgba(200,210,230,0.7)" : "#e8eef8";
    ctx.font = "10px monospace";
    ctx.fillText(UNIT_INFO[kind].label, px(x) + 9, px(y) + 3);
    ctx.restore();
  }

  function drawCrew(ctx, app) {
    const order = ["gunner", "sapper", "lockpick", "hacker", "decoy", "drone", "spotter", "assassin", "scout"]; // scout drawn last (on top)
    for (const kind of order) {
      if (!app.unitsAvail[kind]) continue;
      const path = unitPathFor(app, kind) || [];
      const active = app.activeUnit === kind;
      const color = UNIT_INFO[kind].color;
      const spawn = unitSpawn(app.level, kind);
      const speedFor = unitSpeedFor(kind);

      // Planned path.
      if (path.length) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = active ? 0.6 : 0.22;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(px(spawn.x), px(spawn.y));
        for (const wp of path) ctx.lineTo(px(wp.x), px(wp.y));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        if (active && !app.sim) {
          const iv = pathIntervals(spawn, path, speedFor);
          path.forEach((wp, i) => {
            ctx.fillStyle = wp.mode === "walk" ? "#a3e635" : wp.mode === "cover" ? "#f0d264" : color;
            ctx.beginPath();
            ctx.arc(px(wp.x), px(wp.y), 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(220,230,245,0.85)";
            ctx.font = "9px monospace";
            let label = `${i + 1} · ${iv[i].arrive.toFixed(1)}s`;
            if (wp.mode === "cover") label += " 🕶";
            if (wp.hold) label += ` ⏸${wp.hold}s`;
            if (wp.tap) label += " ♪";
            if (wp.poison) label += " ☠";
            if (wp.smoke) label += " 💨";
            if (wp.breach) label += " 💥";
            ctx.fillText(label, px(wp.x) + 7, px(wp.y) - 5);
          });
        }
      }

      // Unit marker: live during execution, ghost at preview time while planning.
      let ux, uy, ghost = false, dead = false;
      if (app.sim) {
        const u = app.sim.units[kind];
        if (!u) continue; // not deployed this run
        ux = u.x; uy = u.y; dead = u.dead;
      } else {
        if (kind !== "scout" && !path.length &&
            !(kind === "decoy" && (app.plan.throws || []).length) &&
            !(kind === "hacker" && (app.plan.blackouts || []).length) &&
            !(kind === "assassin" && (app.plan.assassinMark != null || app.plan.assassinGuard))) continue; // no orders: stay off-map
        const g = pathPosAt(spawn, path, app.previewT, speedFor);
        ux = g.x; uy = g.y; ghost = app.previewT > 0;
      }

      // Sight/reveal boundaries. The scout's clips against walls; the drone
      // looks straight down, so its circle ignores them.
      ctx.globalAlpha = ghost ? 0.7 : 1;
      if (kind === "drone") {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.18;
        ctx.beginPath();
        ctx.arc(px(ux), px(uy), px(app.perks.droneReveal), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = ghost ? 0.7 : 1;
      } else if (kind === "scout" || kind === "spotter") {
        ctx.globalAlpha = 0.22;
        drawSightBoundary(ctx, ux, uy,
          kind === "spotter" ? app.perks.spotterVision : app.perks.scoutVision,
          app.sim ? app.sim.walls : app.level.walls, color);
        ctx.globalAlpha = ghost ? 0.7 : 1;
      } else if (kind === "assassin" && !app.sim) {
        // Striking reach — anything on a routine that crosses this circle dies.
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(px(ux), px(uy), px(app.perks.strikeRange), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = ghost ? 0.7 : 1;
      }
      drawUnitMarker(ctx, kind, ux, uy, ghost, dead);

      // Live suspicion arc: how close this unit is to being made.
      if (app.sim) {
        const u = app.sim.units[kind];
        if (u && !u.dead) {
          if (kind === "scout" && u.coverMode) {
            ctx.strokeStyle = "#f0d264";
            ctx.lineWidth = 2;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.arc(px(ux), px(uy), 9, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#f0d264";
            ctx.font = "8px monospace";
            ctx.fillText("COVER", px(ux) - 12, px(uy) + 17);
          }
          const limit = kind === "drone" ? app.perks.droneTough : u.exposureLimit;
          if (u.exposure > 0.04 && limit) {
            const frac = Math.min(1, u.exposure / limit);
            ctx.strokeStyle = frac > 0.7 ? "#f87171" : "#fbbf24";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(px(ux), px(uy), 12, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // Throw orders on the map (noise reach shown while the decoy is selected).
    if (app.unitsAvail.decoy) {
      for (const th of app.plan.throws || []) {
        if (app.activeUnit === "decoy" && !app.sim) {
          ctx.strokeStyle = "rgba(192,132,252,0.18)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 6]);
          ctx.beginPath();
          ctx.arc(px(th.x), px(th.y), px(app.perks.throwNoise), 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px(th.x) - 6, px(th.y) - 6); ctx.lineTo(px(th.x) + 6, px(th.y) + 6);
        ctx.moveTo(px(th.x) + 6, px(th.y) - 6); ctx.lineTo(px(th.x) - 6, px(th.y) + 6);
        ctx.stroke();
        ctx.fillStyle = "#c084fc";
        ctx.font = "9px monospace";
        ctx.fillText(`♪ ${th.t.toFixed(1)}s`, px(th.x) + 8, px(th.y) - 6);
      }
    }

    // Scheduled suppression points.
    if (app.unitsAvail.gunner) {
      for (const sp of app.plan.suppresses || []) {
        ctx.strokeStyle = "#a78bfa";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px(sp.x), px(sp.y), px(app.perks.cowerRadius ?? 4), 0, Math.PI * 2);
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#a78bfa";
        ctx.font = "9px monospace";
        ctx.fillText(`🔫 ${sp.t.toFixed(1)}s`, px(sp.x) + 8, px(sp.y) - 6);
      }
    }

    // Armed wall-taps: show how far the knock will carry.
    if (app.activeUnit === "scout" && !app.sim) {
      for (const wp of app.plan.scoutPath) {
        if (!wp.tap) continue;
        ctx.strokeStyle = "rgba(74,222,128,0.15)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.arc(px(wp.x), px(wp.y), px(TUNING.tapNoise), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawAim(ctx, app) {
    const plan = app.plan;
    if (plan.perchIndex == null) return;
    const p = app.level.perches[plan.perchIndex];
    const shots = plan.shots || [];
    shots.forEach((shot, i) => {
      if (!shot.aim) return;
      const active = i === app.activeShot;
      const dir = G.norm(shot.aim.x - p.x, shot.aim.y - p.y);
      const stop = shotStop(app, p, dir);
      const aimDist = G.dist(p.x, p.y, shot.aim.x, shot.aim.y);
      const reaches = aimDist <= stop + 0.01;

      ctx.strokeStyle = reaches ? `rgba(74,222,128,${active ? 0.6 : 0.3})` : `rgba(248,113,113,${active ? 0.6 : 0.3})`;
      ctx.lineWidth = active ? 1.5 : 1;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(px(p.x), px(p.y));
      ctx.lineTo(px(p.x + dir.x * Math.min(stop, aimDist)), px(p.y + dir.y * Math.min(stop, aimDist)));
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = reaches ? "#4ade80" : "#f87171";
      ctx.lineWidth = active ? 1.5 : 1;
      ctx.beginPath();
      ctx.arc(px(shot.aim.x), px(shot.aim.y), px(app.perks.hitRadius + 0.35), 0, Math.PI * 2);
      ctx.moveTo(px(shot.aim.x) - 10, px(shot.aim.y)); ctx.lineTo(px(shot.aim.x) + 10, px(shot.aim.y));
      ctx.moveTo(px(shot.aim.x), px(shot.aim.y) - 10); ctx.lineTo(px(shot.aim.x), px(shot.aim.y) + 10);
      ctx.stroke();
      ctx.fillStyle = reaches ? "#4ade80" : "#f87171";
      ctx.font = "10px monospace";
      const tag = shots.length > 1 ? `S${i + 1} ` : "";
      ctx.fillText(`${tag}${reaches ? "" : "BLOCKED"}`, px(shot.aim.x) + 12, px(shot.aim.y) - 10);
    });
  }

  // When a throw would actually happen: never before the decoy finishes walking.
  function throwEffTime(app) {
    const arrive = pathIntervals(unitSpawn(app.level, "decoy"), app.plan.decoyPath, unitSpeedFor("decoy")).total;
    return Math.max(app.previewT, Math.round(arrive * 10) / 10);
  }

  // Decoy in THROW mode: show how far the arm reaches from wherever the
  // decoy will be standing when the throw happens.
  function drawThrowRing(ctx, app) {
    if (app.activeUnit !== "decoy" || app.decoyOrder !== "throw" || !app.unitsAvail.decoy) return;
    const pos = pathPosAt(unitSpawn(app.level, "decoy"), app.plan.decoyPath, throwEffTime(app), unitSpeedFor("decoy"));
    ctx.strokeStyle = "rgba(192,132,252,0.5)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(px(pos.x), px(pos.y), px(app.perks.throwRange), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(192,132,252,0.8)";
    ctx.font = "9px monospace";
    ctx.fillText("THROW RANGE", px(pos.x) + px(app.perks.throwRange) * 0.72, px(pos.y) - px(app.perks.throwRange) * 0.72);
  }

  function hoverLabel(ctx, x, y, text, color) {
    ctx.fillStyle = color;
    ctx.font = "10px monospace";
    ctx.fillText(text, px(x) + 12, px(y) - 10);
  }

  // Show what a click would do, before it's clicked.
  function drawHoverPreview(ctx, app) {
    if (app.sim || !app.hover) return;
    const h = app.hover;

    // Hovering a perch? (irrelevant during recon or without a hired sniper)
    const pi = (app.mode === "recon" || !app.unitsAvail.sniper) ? -1
      : app.level.perches.findIndex(pc => G.dist(pc.x, pc.y, h.x, h.y) < 1.3);
    if (pi >= 0) {
      const p = app.level.perches[pi];
      ctx.strokeStyle = "#f87171";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px(p.x), px(p.y), 14, 0, Math.PI * 2);
      ctx.stroke();
      hoverLabel(ctx, p.x, p.y - 0.6, "SELECT PERCH", "#f87171");
      return;
    }

    if (app.activeUnit === "sniper") {
      if (app.plan.perchIndex == null) return; // perches are already pulsing
      const p = app.level.perches[app.plan.perchIndex];
      const d = G.dist(p.x, p.y, h.x, h.y);
      if (d < 0.5) return;
      const dir = G.norm(h.x - p.x, h.y - p.y);
      const stop = shotStop(app, p, dir);
      const reaches = d <= stop + 0.01;
      ctx.strokeStyle = reaches ? "rgba(74,222,128,0.35)" : "rgba(248,113,113,0.35)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(px(p.x), px(p.y));
      ctx.lineTo(px(p.x + dir.x * Math.min(stop, d)), px(p.y + dir.y * Math.min(stop, d)));
      ctx.stroke();
      ctx.setLineDash([]);
      hoverLabel(ctx, h.x, h.y, reaches ? "AIM HERE" : "BLOCKED", reaches ? "#4ade80" : "#f87171");
      return;
    }

    if (app.activeUnit === "decoy" && app.decoyOrder === "throw") {
      const eff = throwEffTime(app);
      const pos = pathPosAt(unitSpawn(app.level, "decoy"), app.plan.decoyPath, eff, unitSpeedFor("decoy"));
      const ok = G.dist(pos.x, pos.y, h.x, h.y) <= app.perks.throwRange;
      if (ok) {
        // Preview how far the bang will carry.
        ctx.fillStyle = "rgba(192,132,252,0.06)";
        ctx.strokeStyle = "rgba(192,132,252,0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.arc(px(h.x), px(h.y), px(app.perks.throwNoise), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        // Arc from thrower to landing spot.
        ctx.strokeStyle = "rgba(192,132,252,0.4)";
        ctx.beginPath();
        ctx.moveTo(px(pos.x), px(pos.y));
        ctx.lineTo(px(h.x), px(h.y));
        ctx.stroke();
      }
      ctx.strokeStyle = ok ? "#c084fc" : "#f87171";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px(h.x) - 6, px(h.y) - 6); ctx.lineTo(px(h.x) + 6, px(h.y) + 6);
      ctx.moveTo(px(h.x) + 6, px(h.y) - 6); ctx.lineTo(px(h.x) - 6, px(h.y) + 6);
      ctx.stroke();
      hoverLabel(ctx, h.x, h.y, ok ? `THROW @ ${eff.toFixed(1)}s` : "OUT OF RANGE — MOVE CLOSER", ok ? "#c084fc" : "#f87171");
      return;
    }

    // Path units: preview the leg you'd add, with its arrival time.
    const path = unitPathFor(app, app.activeUnit);
    if (!path) return;
    const spawn = unitSpawn(app.level, app.activeUnit);
    const last = path.length ? path[path.length - 1] : spawn;
    const blocked = app.activeUnit !== "drone" &&
      G.losBlocked(last.x, last.y, h.x, h.y, app.level.walls, false);
    const color = blocked ? "#f87171" : UNIT_INFO[app.activeUnit].color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(px(last.x), px(last.y));
    ctx.lineTo(px(h.x), px(h.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px(h.x), px(h.y), 4, 0, Math.PI * 2);
    ctx.fill();
    if (blocked) {
      hoverLabel(ctx, h.x, h.y, "BLOCKED — USE A DOOR", "#f87171");
    } else {
      const speedFor = unitSpeedFor(app.activeUnit);
      const speed = app.activeUnit === "scout" ? speedFor({ mode: app.legMode }) : speedFor({});
      const eta = pathIntervals(spawn, path, speedFor).total + G.dist(last.x, last.y, h.x, h.y) / speed;
      hoverLabel(ctx, h.x, h.y, `+WP · arrives ${eta.toFixed(1)}s`, color);
    }
  }

  function drawSmokes(ctx, sim) {
    for (const s of sim.smokes) {
      const age = (sim.t - s.t0) / TUNING.smokeDur;
      if (age >= 1) continue;
      const fade = age < 0.8 ? 1 : (1 - age) / 0.2;
      ctx.fillStyle = `rgba(148,163,184,${0.42 * fade})`;
      ctx.beginPath();
      ctx.arc(px(s.x), px(s.y), px(TUNING.smokeRadius), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(203,213,225,${0.25 * fade})`;
      ctx.beginPath();
      ctx.arc(px(s.x) - 6, px(s.y) - 5, px(TUNING.smokeRadius * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawNoises(ctx, sim) {
    for (const n of sim.noises) {
      const age = (sim.t - n.t0) / 0.9;
      ctx.strokeStyle = `rgba(226,232,240,${0.5 * (1 - age)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px(n.x), px(n.y), px(n.r * age), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawBullet(ctx, app) {
    const sim = app.sim;
    const b = sim.bullet;
    if (!b) return;

    // Muzzle flash for the first meters of flight.
    if (sim.phase === "cam" && b.dist < 4) {
      const perch = app.level.perches[app.plan.perchIndex];
      const a = 1 - b.dist / 4;
      ctx.fillStyle = `rgba(255,230,150,${0.9 * a})`;
      ctx.beginPath();
      ctx.arc(px(perch.x), px(perch.y), 6 + 10 * a, 0, Math.PI * 2);
      ctx.fill();
    }

    if (b.trail.length > 1) {
      ctx.strokeStyle = "rgba(255,220,150,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px(b.trail[0].x), px(b.trail[0].y));
      for (const t of b.trail) ctx.lineTo(px(t.x), px(t.y));
      ctx.lineTo(px(b.x), px(b.y));
      ctx.stroke();
    }
    ctx.fillStyle = "#ffe9b0";
    ctx.beginPath();
    ctx.arc(px(b.x), px(b.y), 3, 0, Math.PI * 2);
    ctx.fill();

    // Impact: expanding ring + deterministic sparks driven by app.impactAge.
    if (sim.phase === "done" && sim.result && app.impactAge > 0) {
      const age = app.impactAge;
      const hit = !!b.hitEnemy;
      const col = hit ? "248,113,113" : "226,232,240";
      if (age < 0.8) {
        ctx.strokeStyle = `rgba(${col},${0.9 * (1 - age / 0.8)})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px(b.impact.x), px(b.impact.y), px(0.3 + age * 2.2), 0, Math.PI * 2);
        ctx.stroke();
      }
      if (age < 0.6) {
        ctx.fillStyle = `rgba(${col},${1 - age / 0.6})`;
        for (let i = 0; i < 10; i++) {
          const ang = i * 2.39996; // golden-angle spread, no randomness needed
          const d = age * (2 + (i % 3));
          ctx.fillRect(px(b.impact.x + Math.cos(ang) * d) - 1.5, px(b.impact.y + Math.sin(ang) * d) - 1.5, 3, 3);
        }
      }
    }
  }

  // --- main draw ------------------------------------------------------
  function draw(ctx, app) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#05070b";
    ctx.fillRect(0, 0, W, H);

    if (!app.level) return;

    ctx.save();
    applyCam(ctx, app.cam, app.shake || 0, app.impactAge || 0);

    const liveWalls = app.sim ? app.sim.walls : app.level.walls;
    drawGround(ctx, app.level);
    drawProps(ctx, app.level);
    drawWalls(ctx, { walls: liveWalls });
    // Locked doors: amber bars until opened (sim state during execution).
    const doorList = app.sim ? app.sim.doors : (app.level.doors || []).map(d => ({ ...d, open: false }));
    for (const d of doorList) {
      if (d.open) continue;
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(px(d.x1), px(d.y1));
      ctx.lineTo(px(d.x2), px(d.y2));
      ctx.stroke();
      ctx.fillStyle = "#f59e0b";
      ctx.font = "10px monospace";
      const mx = (d.x1 + d.x2) / 2, my = (d.y1 + d.y2) / 2;
      ctx.fillText(d.keyTaken ? "🔑" : "🔒", px(mx) - 5, px(my) - 6);
      if (d.progress > 0 && !d.open) {
        ctx.fillStyle = "#fbbf24";
        ctx.fillRect(px(mx) - 10, px(my) + 5, 20 * Math.min(1, d.progress), 3);
      }
    }
    drawJunctionBoxes(ctx, app);
    drawEnemies(ctx, app);
    drawCrew(ctx, app);
    drawPerches(ctx, app);
    if (!app.sim || (app.sim.phase !== "cam" && app.sim.phase !== "done")) drawAim(ctx, app);
    if (app.sim) {
      for (const h of app.sim.holes) {
        ctx.fillStyle = "rgba(120,110,95,0.8)";
        for (let i = 0; i < 7; i++) {
          const a = i * 0.9;
          ctx.fillRect(px(h.x + Math.cos(a) * 0.5) - 2, px(h.y + Math.sin(a) * 0.5) - 2, 4, 4);
        }
      }
      drawSmokes(ctx, app.sim);
      drawNoises(ctx, app.sim);
    }

    // Blackout tint (live during execution, previewed while planning).
    const blackout = app.sim ? app.sim.isBlackout() : plannedBlackoutAt(app, app.previewT);
    if (blackout) {
      ctx.fillStyle = "rgba(10,16,40,0.32)";
      ctx.fillRect(0, 0, px(WORLD.w), px(WORLD.h));
    }

    // Fog of war on top of the world, under the bullet. During a run we draw the
    // sim's live view (committed intel + what watchers currently see, even
    // undelivered); while planning we draw only what's been delivered.
    const fogSrc = app.sim ? app.sim.view : app.intel;
    if (fogSrc !== fogSrcDrawn || fogSrc.revealVersion !== fogVersionDrawn) {
      rebuildFog(fogSrc);
      fogSrcDrawn = fogSrc;
    }
    ctx.imageSmoothingEnabled = true;
    // Dev "see building": skip the fog entirely so the whole map is exposed.
    if (!devRevealOn(app)) ctx.drawImage(fogCanvas, 0, 0, px(WORLD.w), px(WORLD.h));

    if (!app.sim) {
      drawThrowRing(ctx, app);
      drawHoverPreview(ctx, app);
    }
    if (app.sim) drawBullet(ctx, app);
    ctx.restore();

    // Vignette.
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if (blackout) {
      ctx.fillStyle = "#60a5fa";
      ctx.font = "bold 13px monospace";
      ctx.fillText("■ BLACKOUT", W - 130, 30);
    }

    // Bullet-cam letterbox.
    if (app.sim && app.sim.bullet && (app.sim.phase === "cam" || app.sim.phase === "done")) {
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillRect(0, 0, W, 70);
      ctx.fillRect(0, H - 70, W, 70);
      ctx.fillStyle = "#ffe9b0";
      ctx.font = "14px monospace";
      ctx.fillText("● BULLET CAM", 20, 42);
      if (app.sim.phase === "done" && app.sim.result) {
        ctx.font = "bold 20px monospace";
        if (app.sim.result.success) {
          ctx.fillStyle = "#4ade80";
          ctx.fillText("TARGET DOWN", W / 2 - 70, H - 30);
        } else if (app.sim.result.missDist != null) {
          ctx.fillStyle = "#f87171";
          ctx.fillText(`MISSED BY ${(Math.round(app.sim.result.missDist * 10) / 10).toFixed(1)}m`, W / 2 - 110, H - 30);
        }
      }
    }

    // Execution HUD.
    if (app.sim && app.sim.phase === "run") {
      ctx.fillStyle = "#e8eef8";
      ctx.font = "bold 18px monospace";
      ctx.fillText(`T+${app.sim.t.toFixed(1)}s`, 18, 30);
      const next = (app.sim.shots || []).find(s => !s.fired);
      if (next) {
        const toFire = next.fireTime - app.sim.t;
        if (toFire > 0) {
          ctx.fillStyle = toFire < 3 ? "#f87171" : "#7b8ba3";
          ctx.font = "13px monospace";
          const idx = app.sim.shots.indexOf(next);
          ctx.fillText(`${app.sim.shots.length > 1 ? `SHOT ${idx + 1}` : "FIRE"} IN ${toFire.toFixed(1)}s`, 18, 52);
        }
      }
    }
  }

  // --- timeline -------------------------------------------------------
  const TL = { left: 58, rowH: 22, top: 16 };

  function timelineRows(app) {
    const kinds = app.mode === "recon"
      ? RECON_UNITS
      : ["scout", "assassin", "spotter", "drone", "decoy", "hacker", "lockpick", "sapper", "gunner", "sniper"];
    return kinds.filter(k => app.unitsAvail[k]);
  }

  function timelineHeight(app) {
    return TL.top + timelineRows(app).length * TL.rowH + 18;
  }

  function drawTimeline(tctx, app) {
    const canvas = tctx.canvas;
    const w = canvas.width, h = canvas.height;
    const dur = app.level.duration;
    const tx = t => TL.left + (t / dur) * (w - TL.left - 8);

    tctx.clearRect(0, 0, w, h);
    tctx.fillStyle = "#0a0f18";
    tctx.fillRect(0, 0, w, h);

    // Time axis.
    tctx.font = "9px monospace";
    for (let t = 0; t <= dur; t += 10) {
      tctx.strokeStyle = "rgba(120,150,190,0.12)";
      tctx.beginPath();
      tctx.moveTo(tx(t), TL.top - 4);
      tctx.lineTo(tx(t), h - 14);
      tctx.stroke();
      tctx.fillStyle = "#5b6b83";
      tctx.fillText(`${t}s`, tx(t) - 6, h - 4);
    }

    const rows = timelineRows(app);
    rows.forEach((kind, r) => {
      const y = TL.top + r * TL.rowH;
      const mid = y + TL.rowH / 2;
      const color = UNIT_INFO[kind].color;
      tctx.fillStyle = color;
      tctx.font = "9px monospace";
      tctx.fillText(UNIT_INFO[kind].label, 4, mid + 3);
      tctx.strokeStyle = "rgba(120,150,190,0.10)";
      tctx.beginPath();
      tctx.moveTo(TL.left, mid);
      tctx.lineTo(w - 8, mid);
      tctx.stroke();

      if (kind === "sniper") {
        (app.plan.shots || []).forEach((shot, i) => {
          if (shot.fireTime == null) return;
          const active = i === app.activeShot;
          tctx.fillStyle = active ? color : "rgba(248,113,113,0.55)";
          tctx.beginPath();
          tctx.moveTo(tx(shot.fireTime), mid - 7);
          tctx.lineTo(tx(shot.fireTime) + 6, mid + 6);
          tctx.lineTo(tx(shot.fireTime) - 6, mid + 6);
          tctx.closePath();
          tctx.fill();
          tctx.fillText(app.plan.shots.length > 1 ? `F${i + 1}` : "FIRE ⇔", tx(shot.fireTime) + 8, mid + 4);
        });
        return;
      }

      const path = unitPathFor(app, kind) || [];
      if (path.length) {
        const iv = pathIntervals(unitSpawn(app.level, kind), path, unitSpeedFor(kind));
        for (const seg of iv) {
          // Travel bar (gold tint = undercover leg).
          tctx.fillStyle = seg.wp.mode === "cover" ? "#d9c26a" : color;
          tctx.globalAlpha = seg.wp.mode === "walk" ? 0.95 : seg.wp.mode === "cover" ? 0.9 : 0.55;
          tctx.fillRect(tx(seg.start), mid - 4, Math.max(1.5, tx(seg.arrive) - tx(seg.start)), 8);
          // Hold block.
          if (seg.depart > seg.arrive) {
            tctx.globalAlpha = 0.25;
            tctx.fillRect(tx(seg.arrive), mid - 4, tx(seg.depart) - tx(seg.arrive), 8);
            tctx.globalAlpha = 0.9;
            tctx.fillText("⏸", tx(seg.arrive) + 1, mid - 6);
          }
          tctx.globalAlpha = 1;
          if (seg.wp.tap) {
            tctx.fillStyle = "#fff";
            tctx.fillText("♪", tx(seg.arrive) - 3, mid - 6);
          }
          if (seg.wp.poison) {
            tctx.fillStyle = "#a3e635";
            tctx.fillText("☠", tx(seg.arrive) - 3, mid - 6);
          }
        }
      }
      if (kind === "decoy") {
        for (const th of app.plan.throws || []) {
          // Draggable: draw with a grab ring.
          tctx.strokeStyle = color;
          tctx.beginPath();
          tctx.arc(tx(th.t), mid, 6, 0, Math.PI * 2);
          tctx.stroke();
          tctx.fillStyle = "#fff";
          tctx.beginPath();
          tctx.arc(tx(th.t), mid, 3.5, 0, Math.PI * 2);
          tctx.fill();
          tctx.fillStyle = color;
          tctx.fillText("♪", tx(th.t) + 8, mid - 4);
        }
      }
      if (kind === "drone") {
        for (const b of app.plan.blares || []) {
          tctx.strokeStyle = color;
          tctx.beginPath();
          tctx.arc(tx(b.t), mid, 6, 0, Math.PI * 2);
          tctx.stroke();
          tctx.fillStyle = "#fff";
          tctx.beginPath();
          tctx.arc(tx(b.t), mid, 3.5, 0, Math.PI * 2);
          tctx.fill();
          tctx.fillStyle = color;
          tctx.fillText("📢", tx(b.t) + 8, mid - 4);
        }
      }
      if (kind === "gunner") {
        for (const sp of app.plan.suppresses || []) {
          tctx.strokeStyle = color;
          tctx.beginPath();
          tctx.arc(tx(sp.t), mid, 6, 0, Math.PI * 2);
          tctx.stroke();
          tctx.fillStyle = "#fff";
          tctx.beginPath();
          tctx.arc(tx(sp.t), mid, 3.5, 0, Math.PI * 2);
          tctx.fill();
          tctx.fillStyle = color;
          tctx.fillText("🔫", tx(sp.t) + 8, mid - 4);
        }
      }
      if (kind === "hacker") {
        for (const b of app.plan.blackouts || []) {
          tctx.fillStyle = "rgba(96,165,250,0.35)";
          tctx.fillRect(tx(b.t), mid - 6, tx(Math.min(dur, b.t + app.perks.blackoutDur)) - tx(b.t), 12);
          // Draggable: draw the start with a grab ring.
          tctx.strokeStyle = "#facc15";
          tctx.beginPath();
          tctx.arc(tx(b.t), mid, 6, 0, Math.PI * 2);
          tctx.stroke();
          tctx.fillStyle = "#facc15";
          tctx.fillText("⚡", tx(b.t) - 3, mid - 8);
        }
      }
    });

    // Fire moment reference lines across all rows.
    if (app.mode !== "recon") {
      for (const shot of app.plan.shots || []) {
        if (shot.fireTime == null) continue;
        tctx.strokeStyle = "rgba(248,113,113,0.4)";
        tctx.setLineDash([3, 3]);
        tctx.beginPath();
        tctx.moveTo(tx(shot.fireTime), TL.top - 4);
        tctx.lineTo(tx(shot.fireTime), h - 14);
        tctx.stroke();
        tctx.setLineDash([]);
      }
    }

    // Preview cursor (or live clock during execution).
    const cur = app.sim ? app.sim.t : app.previewT;
    tctx.strokeStyle = "#e8eef8";
    tctx.beginPath();
    tctx.moveTo(tx(cur), TL.top - 8);
    tctx.lineTo(tx(cur), h - 14);
    tctx.stroke();
    tctx.fillStyle = "#e8eef8";
    tctx.fillText(`${cur.toFixed(1)}s`, Math.min(w - 34, tx(cur) + 3), TL.top - 6);
  }

  // Convert a timeline-canvas x pixel to a time in seconds.
  function timelineTimeAt(canvas, app, clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const dur = app.level.duration;
    const t = ((x - TL.left) / (canvas.width - TL.left - 8)) * dur;
    return Math.max(0, Math.min(dur, Math.round(t * 10) / 10));
  }

  // Canvas-pixel x of a given time on the timeline (for hit-testing the fire marker).
  function timelineXOf(canvas, app, t) {
    return TL.left + (t / app.level.duration) * (canvas.width - TL.left - 8);
  }

  return { draw, drawTimeline, timelineTimeAt, timelineXOf, timelineHeight, forceFogRedraw: () => { fogVersionDrawn = -1; } };
})();
