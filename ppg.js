// Streaming PPG engine: finger gating -> uniform resample -> band-pass -> beat detection + autocorrelation -> BPM/HRV.
// Red and green are tracked separately; whichever has the clearer periodic signal drives the result
// (under the torch red often clips while green still carries the pulse).

const FS = 30;                    // target sample rate (Hz)
const BAND = [0.5, 3.6];          // pass band (Hz)
const SECTIONS_Q = [0.5176, 0.7071, 1.9319]; // Butterworth order-6 section Qs
const LAG = FS * 4;               // z-score window (samples)
const Z_THRESHOLD = 0.1;
const Z_INFLUENCE = 0.5;
const MIN_RUN = 4;                // samples a run must exceed to count as a beat
const MIN_FPS = 10;
const MAX_GAP = 2;                // seconds between frames before we reset
const MIN_BEATS = 5;
const INTERVAL_TOL = 0.2;         // seconds around the central interval
const BPM_RANGE = [40, 200];
const LOST_FINGER_FRAMES = FS * 0.5;
const DC_ALPHA = 0.02;            // slow mean used to normalise each channel (AC/DC)

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
export const isFinger = (r, g, b) => r > 80 && g < r * 0.75 && b < r * 0.6;

// One colour channel: filter, peak finder and autocorrelation.
class Track {
  constructor() {
    this.sections = [
      ...SECTIONS_Q.map((q) => biquad('hp', BAND[0], q)),
      ...SECTIONS_Q.map((q) => biquad('lp', BAND[1], q)),
    ];
    this.dc = null;
    this.filtered = [];
    this.raw = [];
    this.run = [];
    this.peaks = [];
    this.peakBpm = null;
    this.acBpm = null;
    this.strength = 0;
  }

  filter(x) {
    if (this.dc === null) this.dc = x;
    this.dc += DC_ALPHA * (x - this.dc);
    // Normalised and inverted so systole (less light through the finger) reads as a peak.
    let y = -(x / (this.dc || 1) - 1);
    for (const s of this.sections) y = step(s, y);
    return y;
  }

  push(y, t, n) {
    this.raw.push({ t, y });
    if (this.raw.length > FS * 12) this.raw.shift();
    if (n % (FS / 2) === 0) this.autocorr();

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
      if (this.peaks.length > 60) this.peaks.shift();
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
    const iv = this.intervals().slice(-15);
    const c = mean(iv);
    const kept = iv.filter((d) => d > c - INTERVAL_TOL && d < c + INTERVAL_TOL);
    if (kept.length < 3) return;
    const bpm = 60 / mean(kept);
    if (bpm >= BPM_RANGE[0] && bpm <= BPM_RANGE[1]) this.peakBpm = Math.round(bpm);
  }

  // Dominant period of the band-passed signal over the last ~8 s. Robust when individual peaks are noisy.
  autocorr() {
    const n = Math.min(this.raw.length, FS * 8);
    if (n < FS * 3) return;
    const x = this.raw.slice(-n).map((p) => p.y);
    const m = mean(x);
    const v = x.map((a) => a - m);
    const var0 = v.reduce((s, a) => s + a * a, 0) / n;
    if (var0 < 1e-12) return;
    const minLag = Math.floor((FS * 60) / BPM_RANGE[1]);
    const maxLag = Math.min(Math.ceil((FS * 60) / BPM_RANGE[0]), n - FS);
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
    if (!maxima.length) {
      this.strength *= 0.8;
      return;
    }
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

  bpm() {
    if (this.acBpm && this.peakBpm) {
      return Math.abs(this.peakBpm - this.acBpm) / this.acBpm < 0.08 ? this.peakBpm : this.acBpm;
    }
    return this.acBpm || this.peakBpm;
  }
}

export class PulseEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.stable = 0;
    this.bad = 0;
    this.state = 0;            // 0 no finger, 1 warming up, 2 measuring
    this.startT = null;
    this.times = [];           // recent raw frame times (fps estimate)
    this.fps = 0;
    this.rgb = [0, 0, 0];
    this.resetSignal();
  }

  // Drop filter state but keep finger/timing state, e.g. after an exposure change.
  resetSignal() {
    this.tracks = [new Track(), new Track()]; // red, green
    this.prev = null;
    this.nextGrid = null;
    this.warm = 0;
    this.smoothBpm = null;
  }

  // A camera exposure step looks like a huge pulse to the filters: restart the signal and the warm-up.
  exposureChanged() {
    this.resetSignal();
    if (this.state !== 0) {
      this.state = 1;
      this.startT = this.times[this.times.length - 1];
    }
  }

  get best() {
    const [r, g] = this.tracks;
    return g.strength > r.strength ? g : r;
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
    this.feed(t, [r, g]);
    if (this.state === 1 && t - this.startT > 3) this.state = 2;
    return this.status(true);
  }

  // Linear resample to the fixed grid, then filter and run each track.
  feed(t, v) {
    if (!this.prev) {
      // Settle the filters on the first level so there is no start-up transient.
      this.tracks.forEach((tr, k) => {
        for (let i = 0; i < 300; i++) tr.filter(v[k]);
      });
      this.prev = { t, v };
      this.nextGrid = t;
      return;
    }
    const { t: t0, v: v0 } = this.prev;
    while (this.nextGrid <= t) {
      const f = t > t0 ? (this.nextGrid - t0) / (t - t0) : 1;
      this.warm++;
      this.tracks.forEach((tr, k) => {
        const y = tr.filter(v0[k] + f * (v[k] - v0[k]));
        if (this.warm > FS / 2) tr.push(y, this.nextGrid, this.warm);
      });
      this.nextGrid += 1 / FS;
    }
    this.prev = { t, v };
  }

  // Time-domain HRV from the kept beat-to-beat intervals (ms).
  hrv() {
    const iv = this.best.intervals();
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
    const tr = this.best;
    const raw = tr.bpm();
    // Light smoothing so the displayed number does not jump between estimates.
    if (raw) this.smoothBpm = this.smoothBpm ? this.smoothBpm + 0.05 * (raw - this.smoothBpm) : raw;
    const bpm = this.smoothBpm ? Math.round(this.smoothBpm) : null;
    return {
      finger,
      state: this.state,
      bpm,
      strength: tr.strength,
      confidence: bpm ? Math.min(99, Math.round(tr.strength * 130)) : 0,
      beats: tr.peaks.length,
      channel: tr === this.tracks[1] ? 'G' : 'R',
      fps: this.fps,
      rgb: this.rgb,
      wave: tr.raw,
      lastPeak: tr.peaks[tr.peaks.length - 1] || null,
    };
  }
}
