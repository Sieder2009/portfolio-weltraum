// Optional sound, off by default. Everything is synthesised with Web Audio: no audio files.

const KEY = "portfolio-sound";

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastBlip = 0;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
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
