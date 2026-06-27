/* ============================================================
   audio.js — Sound effects, fully synthesized with the Web Audio API.
   No audio files: every sound is generated from oscillators and
   noise at runtime, so there's nothing to download or commit.

   Browsers won't let audio start until the user interacts with the
   page, so we create the AudioContext lazily on the first sound.
   ============================================================ */

(function () {
  "use strict";

  const MUTE_KEY = "emberhollow_muted_v1";
  let ctx = null;          // created lazily on first play
  let master = null;       // master volume node
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "true"; } catch (e) {}

  // Create (or resume) the audio context. Safe to call repeatedly.
  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Play a single shaped tone. Returns the time it finishes.
  function tone(opts) {
    const t0 = ctx.currentTime + (opts.when || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + opts.dur);
    }
    const vol = opts.vol == null ? 0.2 : opts.vol;
    // Quick attack, then exponential decay to near-silence (a "pluck").
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.005));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
    return opts.dur + (opts.when || 0);
  }

  // Play a burst of filtered white noise (impacts, dice rattle).
  function noise(opts) {
    const t0 = ctx.currentTime + (opts.when || 0);
    const dur = opts.dur || 0.12;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter || "lowpass";
    filter.frequency.value = opts.freq || 1000;
    const gain = ctx.createGain();
    const vol = opts.vol == null ? 0.18 : opts.vol;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---- Named sounds: each is a tiny "score" of tones/noise. ----
  const SOUNDS = {
    click() { tone({ freq: 320, type: "triangle", dur: 0.06, vol: 0.08 }); },
    dice() {
      // A short rattle of noise ticks, like dice tumbling.
      for (let i = 0; i < 5; i++) noise({ when: i * 0.06, dur: 0.04, freq: 2600, vol: 0.12 });
    },
    ding() { tone({ freq: 660, type: "sine", dur: 0.18, vol: 0.16 }); },
    hit() {
      noise({ dur: 0.1, freq: 1800, vol: 0.2 });
      tone({ freq: 160, slideTo: 60, type: "square", dur: 0.14, vol: 0.18 });
    },
    crit() {
      tone({ freq: 523, type: "square", dur: 0.1, vol: 0.16 });
      tone({ freq: 784, type: "square", dur: 0.1, vol: 0.16, when: 0.08 });
      tone({ freq: 1047, type: "square", dur: 0.16, vol: 0.16, when: 0.16 });
    },
    miss() { tone({ freq: 200, slideTo: 120, type: "sine", dur: 0.16, vol: 0.12 }); },
    hurt() { tone({ freq: 90, type: "sawtooth", dur: 0.22, vol: 0.18 }); },
    heal() {
      [523, 659, 784].forEach((f, i) => tone({ freq: f, type: "sine", dur: 0.18, vol: 0.14, when: i * 0.09 }));
    },
    magic() { tone({ freq: 300, slideTo: 1200, type: "sine", dur: 0.35, vol: 0.14 }); },
    coin() {
      tone({ freq: 988, type: "square", dur: 0.07, vol: 0.12 });
      tone({ freq: 1319, type: "square", dur: 0.1, vol: 0.12, when: 0.07 });
    },
    levelup() {
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.2, vol: 0.16, when: i * 0.11 }));
    },
    victory() {
      [523, 659, 784].forEach((f) => tone({ freq: f, type: "triangle", dur: 1.1, vol: 0.12 }));
      tone({ freq: 1047, type: "triangle", dur: 1.1, vol: 0.12, when: 0.18 });
    },
    defeat() {
      [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, type: "sawtooth", dur: 0.45, vol: 0.14, when: i * 0.22 }));
    },
  };

  function play(name) {
    if (muted) return;
    if (!ensureCtx()) return;
    const fn = SOUNDS[name];
    if (fn) { try { fn(); } catch (e) {} }
  }

  function setMuted(value) {
    muted = !!value;
    try { localStorage.setItem(MUTE_KEY, String(muted)); } catch (e) {}
    if (!muted) ensureCtx(); // unlock audio on the unmuting gesture
  }

  window.GameAudio = {
    play,
    setMuted,
    isMuted: () => muted,
    toggle() { setMuted(!muted); return muted; },
    resume: ensureCtx, // call on a user gesture to unlock playback
  };
})();
