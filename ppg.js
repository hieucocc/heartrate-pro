// Streaming PPG engine: finger gating -> uniform resample -> band-pass -> beat detection + autocorrelation -> BPM/HRV.
// Filter band, z-score peak finder and interval rejection follow static analysis of a reference app.

const FS = 30;                    // target sample rate (Hz)
const BAND = [0.4, 3.6];          // pass band (Hz)
const SECTIONS_Q = [0.5176, 0.7071, 1.9319]; // Butterworth order-6 section Qs
const LAG = FS * 4;               // z-score window (samples)
const Z_THRESHOLD = 0.1;
const Z_INFLUENCE = 0.5;
const MIN_RUN = 5;                // samples a run must exceed to count as a beat
const MIN_FPS = 10;
const MAX_GAP = 2;                // seconds between frames before we reset
const MIN_BEATS = 6;
const INTERVAL_TOL = 0.2;         // seconds around the central interval
const BPM_RANGE = [40, 220];
const LOST_FINGER_FRAMES = FS * 0.5;

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

// Camera exposure varies, so judge "finger" by colour ratios rather than absolute levels.
export const isFinger = (r, g, b) => r > 90 && g < r * 0.6 && b < r * 0.6;

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
    this.raw = [];             // band-passed signal with times
    this.run = [];             // current run of signal===1 {t, y}
    this.peaks = [];           // beat times (s)
    this.peakBpm = null;
    this.peakConf = 0;
    this.acBpm = null;
    this.strength = 0;
    this.warm = 0;             // filtered samples produced so far
    this.fps = 0;
  }

  // r, g, b: mean 0..255 over the frame. Returns a status snapshot.
  push(t, r, g, b) {
    this.rgb = [r, g, b];
    const finger = isFinger(r, g, b);
    if (this.times.length && t - this.times[this.times.length - 1] > MAX_GAP) this.reset();
    this.times.push(t);
    if (this.times.length > 60) this.times.shift();
    if (this.times.length >= 10) this.fps = (this.times.length - 1) / (t - this.times[0]);

    if (!finger) {
      this.stable = 0;
      this.bad++;
      if (this.state !== 0 && this.bad > LOST_FINGER_FRAMES) this.reset();
      return this.status(false);
    }
    this.bad = 0;
    this.stable++;
    if (this.state === 0 && this.stable > FS / 2) {
      this.state = 1;
      this.startT = t;
    }
    if (this.state === 0) return this.status(true);

    if (this.fps && this.fps < MIN_FPS) {
      this.reset();
      return this.status(true);
    }
    this.feed(t, r);
    if (this.state === 1 && t - this.startT > 6) this.state = 2;
    return this.status(true);
  }

  // Linear resample to the fixed grid, then filter and run the peak finder.
  feed(t, v) {
    if (!this.prev) {
      // Settle the filters on the first level so there is no start-up transient.
      for (let i = 0; i < 900; i++) {
        let y = v;
        for (const s of this.sections) y = step(s, y);
      }
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
      if (this.warm > FS / 2) this.detect(y, this.nextGrid);
      // detect() may have reset the engine; stop feeding the old stream.
      if (this.nextGrid === null) return;
      this.nextGrid += 1 / FS;
    }
    this.prev = { t, v };
  }

  detect(y, t) {
    this.raw.push({ t, y });
    if (this.raw.length > FS * 12) this.raw.shift();
    if (this.warm % FS === 0) this.autocorr();

    const f = this.filtered;
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
    if (bpm < BPM_RANGE[0] || bpm > BPM_RANGE[1]) return;
    this.peakBpm = Math.round(bpm);
    const m = mean(kept);
    const sd = Math.sqrt(mean(kept.map((d) => (d - m) ** 2)));
    this.peakConf = Math.round(Math.max(0, 1 - (sd / m) * 4) * 100);
  }

  // Dominant period of the band-passed signal over the last ~8 s. Robust when individual peaks are noisy.
  autocorr() {
    const n = Math.min(this.raw.length, FS * 8);
    if (n < FS * 5) return;
    const x = this.raw.slice(-n).map((p) => p.y);
    const m = mean(x);
    const v = x.map((a) => a - m);
    const var0 = v.reduce((s, a) => s + a * a, 0) / n;
    if (var0 < 1e-12) return;
    const minLag = Math.floor((FS * 60) / BPM_RANGE[1]);
    const maxLag = Math.ceil((FS * 60) / BPM_RANGE[0]);
    const r = {};
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += v[i] * v[i + lag];
      r[lag] = s / (n - lag) / var0;
    }
    const maxima = [];
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1]) maxima.push(lag);
    }
    if (!maxima.length) return;
    const best = Math.max(...maxima.map((l) => r[l]));
    // Smallest lag that is nearly as strong as the best one (avoids picking a sub-harmonic).
    const lag = maxima.find((l) => r[l] >= best * 0.85);
    const a = r[lag - 1];
    const b = r[lag];
    const c = r[lag + 1];
    const denom = a - 2 * b + c;
    const shift = denom ? (0.5 * (a - c)) / denom : 0;
    this.acBpm = Math.round((60 * FS) / (lag + shift));
    this.strength = Math.max(0, Math.min(1, b));
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
    // Prefer the beat-count estimate when it agrees with autocorrelation; otherwise trust autocorrelation.
    let bpm = null;
    if (this.acBpm && this.peakBpm) {
      bpm = Math.abs(this.peakBpm - this.acBpm) / this.acBpm < 0.08 ? this.peakBpm : this.acBpm;
    } else {
      bpm = this.acBpm || this.peakBpm;
    }
    return {
      finger,
      state: this.state,
      bpm,
      strength: this.strength,
      confidence: bpm ? Math.min(99, Math.round(this.strength * 130)) : 0,
      beats: this.peaks.length,
      fps: this.fps,
      rgb: this.rgb,
      wave: this.raw,
    };
  }
}
