/*
 * audio.js — every soundscape is synthesized live with the Web Audio API.
 *
 * The recipe for ambient sound is almost always "shaped noise": generate a
 * buffer of noise (white / pink / brown), push it through filters, and sprinkle
 * scheduled one-shot events on top (rain pings, fire crackles, bird chirps).
 * No audio files are loaded, so the whole thing is a few kB and works offline.
 */
(function () {
  "use strict";

  let ctx = null;
  let master = null;       // master gain -> destination
  let current = null;      // { stop() } for the playing soundscape
  let userVol = 0.7;       // 0..1 from the slider
  let muted = true;        // start "paused"

  function ensureCtx() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return ctx;
  }

  // ---- noise buffer factory ----
  function makeNoise(type, seconds) {
    seconds = seconds || 2.2;
    const len = (ctx.sampleRate * seconds) | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (type === "pink") {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (type === "brown") {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    } else {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  // small helpers
  function gain(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function filter(type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    return f;
  }
  // a slow control oscillator added onto an AudioParam around a center value
  function lfo(param, rate, depth, center, type) {
    const o = ctx.createOscillator();
    o.type = type || "sine";
    o.frequency.value = rate;
    const g = gain(depth);
    o.connect(g).connect(param);
    if (center != null) param.value = center;
    o.start();
    return [o, g];
  }

  // =========================================================================
  //  SOUNDSCAPES — each returns { stop() }
  // =========================================================================
  const Sounds = {};

  Sounds.rain = function (out) {
    const nodes = [];
    // steady hiss
    const hiss = makeNoise("white");
    hiss.connect(filter("bandpass", 1900, 0.7)).connect(gain(0.5)).connect(out);
    hiss.start(); nodes.push(hiss);
    // low rumble underneath
    const rumble = makeNoise("brown");
    rumble.connect(filter("lowpass", 420)).connect(gain(0.28)).connect(out);
    rumble.start(); nodes.push(rumble);

    let running = true;
    function ping() {
      if (!running) return;
      const t = ctx.currentTime;
      const f = 1600 + Math.random() * 2600;
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = f;
      const bp = filter("bandpass", f, 9);
      const g = gain(0);
      const v = 0.015 + Math.random() * 0.05;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(bp).connect(g).connect(out);
      o.start(t); o.stop(t + 0.18);
      setTimeout(ping, 35 + Math.random() * 150);
    }
    ping();
    return { stop() { running = false; nodes.forEach(stopNode); } };
  };

  Sounds.fire = function (out) {
    const nodes = [];
    // low roar
    const roar = makeNoise("brown");
    const roarGain = gain(0.5);
    roar.connect(filter("lowpass", 480)).connect(roarGain).connect(out);
    roar.start(); nodes.push(roar);
    nodes.push(lfo(roarGain.gain, 0.5, 0.15, 0.5)[0]); // gentle breathing

    // airy hiss
    const hiss = makeNoise("pink");
    hiss.connect(filter("bandpass", 1200, 0.8)).connect(gain(0.08)).connect(out);
    hiss.start(); nodes.push(hiss);

    let running = true;
    function crackle() {
      if (!running) return;
      const t = ctx.currentTime;
      const burst = makeNoise("white", 0.12); burst.loop = false;
      const v = 0.05 + Math.random() * 0.22;
      const g = gain(v);
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + Math.random() * 0.05);
      burst.connect(filter("highpass", 1000 + Math.random() * 2200)).connect(g).connect(out);
      burst.start(t);
      setTimeout(crackle, 25 + Math.random() * 380);
    }
    crackle();
    return { stop() { running = false; nodes.forEach(stopNode); } };
  };

  Sounds.ocean = function (out) {
    const nodes = [];
    const noise = makeNoise("pink");
    const lp = filter("lowpass", 600);
    const g = gain(0);
    noise.connect(lp).connect(g).connect(out);
    noise.start(); nodes.push(noise);
    // one slow LFO drives both loudness and brightness -> waves rolling in
    const wave = ctx.createOscillator(); wave.type = "sine"; wave.frequency.value = 0.12;
    wave.connect(gain(0.3)).connect(g.gain); g.gain.value = 0.36;
    wave.connect(gain(360)).connect(lp.frequency); lp.frequency.value = 700;
    wave.start(); nodes.push(wave);
    return { stop() { nodes.forEach(stopNode); } };
  };

  Sounds.wind = function (out) {
    const nodes = [];
    const noise = makeNoise("pink");
    const bp = filter("bandpass", 520, 2.5);
    const g = gain(0.4);
    noise.connect(bp).connect(g).connect(out);
    noise.start(); nodes.push(noise);
    nodes.push(lfo(bp.frequency, 0.07, 320, 540)[0]); // pitch of the gust
    nodes.push(lfo(g.gain, 0.05, 0.22, 0.38)[0]);     // gust loudness
    return { stop() { nodes.forEach(stopNode); } };
  };

  Sounds.forest = function (out) {
    const nodes = [];
    const breeze = makeNoise("pink");
    const bp = filter("bandpass", 820, 1.0);
    const g = gain(0.16);
    breeze.connect(bp).connect(g).connect(out);
    breeze.start(); nodes.push(breeze);
    nodes.push(lfo(g.gain, 0.06, 0.06, 0.16)[0]);

    let running = true;
    function chirp() {
      if (!running) return;
      const t0 = ctx.currentTime;
      const base = 2000 + Math.random() * 2200;
      const notes = 2 + (Math.random() * 3 | 0);
      let t = t0;
      for (let i = 0; i < notes; i++) {
        const f = base * (0.9 + Math.random() * 0.4);
        const o = ctx.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(f, t);
        o.frequency.linearRampToValueAtTime(f * 1.25, t + 0.05);
        const g2 = gain(0);
        g2.gain.setValueAtTime(0, t);
        g2.gain.linearRampToValueAtTime(0.05, t + 0.012);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g2).connect(out);
        o.start(t); o.stop(t + 0.12);
        t += 0.08 + Math.random() * 0.06;
      }
      setTimeout(chirp, 700 + Math.random() * 3200);
    }
    chirp();
    return { stop() { running = false; nodes.forEach(stopNode); } };
  };

  Sounds.night = function (out) {
    const nodes = [];
    const amb = makeNoise("brown");
    amb.connect(filter("lowpass", 220)).connect(gain(0.22)).connect(out);
    amb.start(); nodes.push(amb);

    let running = true;
    function cricket() {
      if (!running) return;
      const t0 = ctx.currentTime;
      const f = 4400 + Math.random() * 600;
      const reps = 10 + (Math.random() * 9 | 0);
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = gain(0);
      o.connect(g).connect(out); o.start(t0);
      let t = t0;
      for (let i = 0; i < reps; i++) {
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.035, t + 0.004);
        g.gain.linearRampToValueAtTime(0, t + 0.02);
        t += 0.03;
      }
      o.stop(t + 0.05);
      setTimeout(cricket, 350 + Math.random() * 1500);
    }
    cricket();
    cricket(); // a couple of overlapping crickets
    return { stop() { running = false; nodes.forEach(stopNode); } };
  };

  Sounds.storm = function (out) {
    const nodes = [];
    // heavy rain
    const hiss = makeNoise("white");
    const hg = gain(0.55);
    hiss.connect(filter("bandpass", 1500, 0.6)).connect(hg).connect(out);
    hiss.start(); nodes.push(hiss);
    nodes.push(lfo(hg.gain, 0.08, 0.12, 0.55)[0]); // the downpour swells
    const rumble = makeNoise("brown");
    rumble.connect(filter("lowpass", 360)).connect(gain(0.34)).connect(out);
    rumble.start(); nodes.push(rumble);

    let running = true;
    function thunder() {
      if (!running) return;
      const t = ctx.currentTime;
      const src = makeNoise("brown", 3); src.loop = false;
      const lp = filter("lowpass", 700);
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.exponentialRampToValueAtTime(90, t + 2.2);
      const g = gain(0);
      const v = 0.4 + Math.random() * 0.5;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.08 + Math.random() * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2 + Math.random() * 1.5);
      src.connect(lp).connect(g).connect(out);
      src.start(t);
      setTimeout(thunder, 6000 + Math.random() * 13000);
    }
    setTimeout(thunder, 1500 + Math.random() * 4000);
    return { stop() { running = false; nodes.forEach(stopNode); } };
  };

  Sounds.stream = function (out) {
    const nodes = [];
    // rushing water bed
    const water = makeNoise("pink");
    water.connect(filter("bandpass", 1100, 0.8)).connect(gain(0.32)).connect(out);
    water.start(); nodes.push(water);
    const high = makeNoise("white");
    high.connect(filter("highpass", 4200)).connect(gain(0.05)).connect(out);
    high.start(); nodes.push(high);

    let running = true;
    function gurgle() {
      if (!running) return;
      const t = ctx.currentTime;
      const f = 280 + Math.random() * 520;
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(f * (1.25 + Math.random() * 0.4), t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05 + Math.random() * 0.05);
      const g = gain(0);
      const v = 0.02 + Math.random() * 0.04;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08 + Math.random() * 0.08);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.22);
      setTimeout(gurgle, 45 + Math.random() * 160);
    }
    gurgle();
    return { stop() { running = false; nodes.forEach(stopNode); } };
  };

  Sounds.chimes = function (out) {
    const nodes = [];
    // soft breeze bed
    const breeze = makeNoise("pink");
    const bg = gain(0.1);
    breeze.connect(filter("bandpass", 600, 1)).connect(bg).connect(out);
    breeze.start(); nodes.push(breeze);
    nodes.push(lfo(bg.gain, 0.05, 0.05, 0.1)[0]);

    const scale = [523.25, 587.33, 698.46, 783.99, 880.0, 1046.5]; // C D F G A C
    function bell(t, freq, vol) {
      // a few inharmonic partials with a long decay = bell-ish
      const partials = [[1, vol], [2.76, vol * 0.4], [5.4, vol * 0.15]];
      for (const pr of partials) {
        const o = ctx.createOscillator(); o.type = "sine";
        o.frequency.value = freq * pr[0];
        const g = gain(0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(pr[1], t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2 + Math.random() * 1.5);
        o.connect(g).connect(out);
        o.start(t); o.stop(t + 4);
      }
    }
    let running = true;
    function gust() {
      if (!running) return;
      const t0 = ctx.currentTime;
      const n = 1 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) {
        const f = scale[(Math.random() * scale.length) | 0];
        bell(t0 + i * (0.08 + Math.random() * 0.18), f, 0.08 + Math.random() * 0.06);
      }
      setTimeout(gust, 900 + Math.random() * 3400);
    }
    gust();
    return { stop() { running = false; nodes.forEach(stopNode); } };
  };

  Sounds.snow = function (out) {
    const nodes = [];
    // a soft, muffled hush
    const hush = makeNoise("pink");
    const g = gain(0.18);
    hush.connect(filter("lowpass", 470)).connect(g).connect(out);
    hush.start(); nodes.push(hush);
    nodes.push(lfo(g.gain, 0.04, 0.08, 0.18)[0]);
    const air = makeNoise("white");
    air.connect(filter("bandpass", 820, 0.5)).connect(gain(0.03)).connect(out);
    air.start(); nodes.push(air);
    return { stop() { nodes.forEach(stopNode); } };
  };

  function stopNode(n) { try { n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} }

  // smoothly ramp the master toward the target loudness
  function applyMaster() {
    if (!ctx) return;
    const target = muted ? 0 : userVol * 0.9;
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
  }

  // =========================================================================
  //  PUBLIC API
  // =========================================================================
  window.AudioEngine = {
    // start (or switch to) a soundscape and unmute
    select(id) {
      if (!Sounds[id]) return;
      ensureCtx();
      if (ctx.state === "suspended") ctx.resume();
      if (current) { current.stop(); current = null; }
      current = Sounds[id](master);
      muted = false;
      applyMaster();
    },
    pause() { muted = true; applyMaster(); },
    resume() {
      if (!current) return false;
      ensureCtx();
      if (ctx.state === "suspended") ctx.resume();
      muted = false; applyMaster();
      return true;
    },
    isPlaying() { return !!current && !muted; },
    hasSelection() { return !!current; },
    setVolume(v) { userVol = Math.max(0, Math.min(1, v)); if (!muted) applyMaster(); },
  };
})();
