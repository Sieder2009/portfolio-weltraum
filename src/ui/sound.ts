// Optional sound, off by default. Everything is synthesised with Web Audio: no audio files.

const KEY = "portfolio-sound";

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastBlip = 0;
  private lastShot = 0;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private rumble: { gain: GainNode; filter: BiquadFilterNode; oscs: OscillatorNode[] } | null = null;
  enabled = false;

  /** The saved choice (only "on" if it was switched on before). */
  get wanted() {
    try {
      return localStorage.getItem(KEY) === "on";
    } catch {
      return false;
    }
  }

  private remember(on: boolean) {
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      /* private mode */
    }
  }

  /** Must be called from a user gesture (browsers only allow audio after one). */
  enable() {
    if (this.enabled) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.build();
    }
    void this.ctx.resume();
    this.enabled = true;
    this.remember(true);
    const t = this.ctx.currentTime;
    this.master!.gain.cancelScheduledValues(t);
    this.master!.gain.setTargetAtTime(0.55, t, 0.6);
  }

  disable() {
    this.enabled = false;
    this.remember(false);
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.15);
    const ctx = this.ctx;
    window.setTimeout(() => {
      if (!this.enabled) void ctx.suspend();
    }, 700);
  }

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
    return this.enabled;
  }

  private build() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // White noise, reused by the hiss and the whooshes.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // A low, slowly breathing pad.
    const pad = ctx.createGain();
    pad.gain.value = 0.07;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    filter.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.045;
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    for (const [freq, type, detune] of [
      [55, "sine", 0],
      [82.41, "triangle", 4],
      [110, "sine", -6],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(filter);
      o.start();
    }
    filter.connect(pad).connect(this.master);

    // Faint space hiss.
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 900;
    band.Q.value = 0.5;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.01;
    hiss.connect(band).connect(hissGain).connect(this.master);
    hiss.start();

    // Wind of the flight: louder and brighter the faster you scroll.
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noise;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 300;
    windFilter.Q.value = 1.2;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(this.master);
    windSrc.start();
    this.wind = { gain: windGain, filter: windFilter };

    // The hum of hyperspace: two detuned low saws through a lowpass that opens with the warp.
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 160;
    rumbleFilter.Q.value = 3;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    const oscs = [41, 41.6, 82.7].map((f) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(rumbleFilter);
      o.start();
      return o;
    });
    rumbleFilter.connect(rumbleGain).connect(this.master);
    this.rumble = { gain: rumbleGain, filter: rumbleFilter, oscs };
  }

  /** How deep in hyperspace (0…1). */
  warp(amount: number) {
    if (!this.enabled || !this.ctx || !this.rumble) return;
    const t = this.ctx.currentTime;
    const r = this.rumble;
    r.gain.gain.setTargetAtTime(amount * 0.08, t, 0.15);
    r.filter.frequency.setTargetAtTime(150 + amount * 1100, t, 0.2);
    r.oscs.forEach((o, i) => o.frequency.setTargetAtTime([41, 41.6, 82.7][i] * (1 + amount * 0.5), t, 0.3));
  }

  /** The jump to lightspeed: a rising sweep with a burst of noise. */
  jump() {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(620, t + 0.5);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.45);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.75);
    this.whoosh(1.1);
  }

  /** Effects for the mini game (quiet; only while sound is on). */
  sfx(kind: "shot" | "hit" | "boom" | "bigboom" | "power" | "hurt" | "wave") {
    if (!this.enabled || !this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const now = performance.now();
    if (kind === "shot" || kind === "hit") {
      // (the guns fire ten times a second: only every third shot clicks)
      if (now - this.lastShot < (kind === "shot" ? 260 : 70)) return;
      this.lastShot = now;
    }
    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, gain: number, at = 0) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + at);
      o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(gain, t + at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(this.master!);
      o.start(t + at);
      o.stop(t + at + dur + 0.02);
    };
    const noise = (dur: number, f0: number, f1: number, gain: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.master!);
      src.start(t, Math.random());
      src.stop(t + dur + 0.02);
    };
    switch (kind) {
      case "shot":
        tone("square", 1500, 700, 0.05, 0.012);
        break;
      case "hit":
        noise(0.05, 3000, 1200, 0.04);
        break;
      case "boom":
        noise(0.35, 1800, 160, 0.12);
        tone("sine", 140, 45, 0.25, 0.08);
        break;
      case "bigboom":
        noise(1.1, 1400, 60, 0.2);
        tone("sine", 110, 30, 0.8, 0.14);
        break;
      case "power":
        tone("sine", 660, 680, 0.08, 0.06);
        tone("sine", 880, 900, 0.08, 0.06, 0.07);
        tone("sine", 1320, 1340, 0.14, 0.06, 0.14);
        break;
      case "hurt":
        tone("sawtooth", 320, 70, 0.45, 0.07);
        noise(0.5, 1200, 100, 0.12);
        break;
      case "wave":
        tone("triangle", 440, 445, 0.16, 0.05);
        tone("triangle", 660, 665, 0.24, 0.05, 0.12);
        break;
    }
  }

  /** Dropping out of hyperspace: a soft low thump. */
  dropOut() {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.6);
  }

  /** How fast the camera travels (journey stops per second). */
  flight(speed: number) {
    if (!this.enabled || !this.ctx || !this.wind) return;
    const t = this.ctx.currentTime;
    const s = Math.min(Math.abs(speed), 3);
    this.wind.gain.gain.setTargetAtTime(Math.min(s * 0.05, 0.11), t, 0.12);
    this.wind.filter.frequency.setTargetAtTime(280 + s * 700, t, 0.15);
  }

  /** A soft tick for hovering a planet. */
  blip(pitch = 1) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = performance.now();
    if (now - this.lastBlip < 60) return;
    this.lastBlip = now;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(720 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(1080 * pitch, t + 0.06);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** A filtered sweep for a flight between planets. */
  whoosh(duration = 1.8) {
    if (!this.enabled || !this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + duration * 0.45);
    f.frequency.exponentialRampToValueAtTime(220, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + duration * 0.4);
    g.gain.linearRampToValueAtTime(0, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.1);
  }
}
