// Streaming PPG engine: finger gating -> uniform resample -> band-pass -> z-score peak finder -> BPM/HRV.
// Parameters follow what static analysis of a reference app showed (see notes in the project README).

const FS = 30;                    // target sample rate (Hz)
const BAND = [0.4, 3.6];          // pass band (Hz)
const SECTIONS_Q = [0.5176, 0.7071, 1.9319]; // Butterworth order-6 section Qs
const LAG = FS * 4;               // z-score window (samples)
const Z_THRESHOLD = 0.1;
const Z_INFLUENCE = 0.5;
const MIN_RUN = 5;                // samples a run must exceed to count as a beat
const MIN_FPS = 13;
const MAX_GAP = 2;                // seconds between frames before we reset
const MIN_BEATS = 6;
const INTERVAL_TOL = 0.2;         // seconds around the central interval
const BPM_RANGE = [40, 240];

function biquad(type, f, q) {
  const w = (2 * Math.PI * f) / FS;
  const c = Math.cos(w);
  const a = Math.sin(w) / (2 * q);
  const a0 = 1 + a;
  const k = type === 'lp' ? (1 - c) / 2 : (1 + c) / 2;
  const b1 = type === 'lp' ? 1 - c : -(1 + c);
  return { b0: k / a0, b1: b1 / a0, b2: k / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0, z1: 0, z2: 0 };
}

function step(s, x) {
  const y = s.b0 * x + s.z1;
  s.z1 = s.b1 * x - s.a1 * y + s.z2;
  s.z2 = s.b2 * x - s.a2 * y;
  return y;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

export class PulseEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.sections = [
      ...SECTIONS_Q.map((q) => biquad('hp', BAND[0], q)),
      ...SECTIONS_Q.map((q) => biquad('lp', BAND[1], q)),
    ];
    this.stable = 0;
    this.bad = 0;
    this.state = 0;            // 0 no finger, 1 warming up, 2 measuring
    this.startT = null;
    this.times = [];           // recent raw frame times (fps estimate)
    this.prev = null;          // previous raw sample {t, v}
    this.nextGrid = null;
    this.filtered = [];        // z-score working copy of the filtered signal
    this.raw = [];             // band-passed signal with times (for display)
    this.run = [];             // current run of signal===1 {t, y}
    this.peaks = [];           // beat times (s)
    this.bpm = null;
    this.warm = 0;             // filtered samples produced so far
  }

  // r, g, b: mean 0..255 over the frame. Returns a status snapshot.
  push(t, r, g, b) {
    const finger = r > 170 && g < 100 && b < 100;
    if (this.times.length && t - this.times[this.times.length - 1] > MAX_GAP) this.reset();
    this.times.push(t);
    if (this.times.length > 60) this.times.shift();

    if (!finger) {
      this.stable = 0;
      this.bad++;
      if (this.state !== 0 && this.bad > 0.15 * FS) this.reset();
      return this.status(false);
    }
    this.bad = 0;
    this.stable++;
    if (this.state === 0 && this.stable > FS) {
      this.state = 1;
      this.startT = t;
    }
    if (this.state === 0) return this.status(true);

    if (this.times.length >= 10) {
      const fps = (this.times.length - 1) / (t - this.times[0]);
      if (fps < MIN_FPS) {
        this.reset();
        return this.status(true);
      }
    }
    this.feed(t, r);
    if (this.state === 1 && t - this.startT > 8) this.state = 2;
    return this.status(true);
  }

  // Linear resample to the fixed grid, then filter and run the peak finder.
  feed(t, v) {
    if (!this.prev) {
      this.prev = { t, v };
      this.nextGrid = t;
      return;
    }
    const { t: t0, v: v0 } = this.prev;
    while (this.nextGrid <= t) {
      const x = t > t0 ? v0 + ((this.nextGrid - t0) / (t - t0)) * (v - v0) : v;
      let y = x;
      for (const s of this.sections) y = step(s, y);
      this.warm++;
      // Skip the filter's start-up transient.
      if (this.warm > FS * 2) this.detect(y, this.nextGrid);
      // detect() may have reset the engine; stop feeding the old stream.
      if (this.nextGrid === null) return;
      this.nextGrid += 1 / FS;
    }
    this.prev = { t, v };
  }

  detect(y, t) {
    const f = this.filtered;
    this.raw.push({ t, y });
    if (this.raw.length > FS * 10) this.raw.shift();
    if (f.length < LAG) {
      f.push(y);
      return;
    }
    const win = f.slice(-LAG);
    const avg = mean(win);
    const sd = Math.sqrt(mean(win.map((x) => (x - avg) ** 2)));
    if (Math.abs(y - avg) <= Z_THRESHOLD * sd) {
      f.push(y);
      this.endRun();
      return;
    }
    f.push(Z_INFLUENCE * y + (1 - Z_INFLUENCE) * f[f.length - 1]);
    if (y > avg) this.run.push({ t, y });
    else this.endRun();
    if (f.length > LAG * 3) f.splice(0, f.length - LAG * 2);
  }

  endRun() {
    if (this.run.length > MIN_RUN) {
      const top = this.run.reduce((m, p) => (p.y > m.y ? p : m));
      this.peaks.push(top.t);
      this.updateBpm();
    }
    this.run = [];
  }

  intervals() {
    const out = [];
    for (let i = 1; i < this.peaks.length; i++) out.push(this.peaks[i] - this.peaks[i - 1]);
    return out;
  }

  updateBpm() {
    if (this.peaks.length <= MIN_BEATS) return;
    const iv = this.intervals().slice(-20);
    const c = mean(iv);
    const kept = iv.filter((d) => d > c - INTERVAL_TOL && d < c + INTERVAL_TOL);
    if (kept.length < 3) return;
    const bpm = 60 / mean(kept);
    if (bpm < BPM_RANGE[0] || bpm > BPM_RANGE[1]) {
      this.reset();
      return;
    }
    this.bpm = Math.round(bpm);
    const m = mean(kept);
    const sd = Math.sqrt(mean(kept.map((d) => (d - m) ** 2)));
    this.confidence = Math.round(Math.max(0, 1 - (sd / m) * 4) * 100);
  }

  // Time-domain HRV from the kept beat-to-beat intervals (ms).
  hrv() {
    const iv = this.intervals();
    if (iv.length < 5) return null;
    const c = mean(iv);
    const rr = iv.filter((d) => Math.abs(d - c) < INTERVAL_TOL).map((d) => d * 1000);
    if (rr.length < 5) return null;
    const m = mean(rr);
    const diffs = rr.slice(1).map((d, i) => d - rr[i]);
    return {
      sdnn: Math.round(Math.sqrt(mean(rr.map((d) => (d - m) ** 2)))),
      rmssd: Math.round(Math.sqrt(mean(diffs.map((d) => d * d)))),
      pnn50: Math.round((diffs.filter((d) => Math.abs(d) > 50).length / diffs.length) * 100),
    };
  }

  status(finger) {
    return {
      finger,
      state: this.state,
      bpm: this.bpm,
      confidence: this.confidence ?? 0,
      beats: this.peaks.length,
      wave: this.raw,
    };
  }
}
