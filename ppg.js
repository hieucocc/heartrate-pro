// Streaming PPG engine modelled on InPulse's PPGEstimator (studied from its shipped binary):
//   signal  = share of frame pixels brighter than an adaptive threshold (computed in the frame processor)
//   gate    = steady finger for 1 s, then 8 s of samples are collected before the first analysis
//   filter  = uniform resample at FS, order-6 Butterworth band-pass 0.4-3.6 Hz
//   beats   = smoothed z-score (lag 4 s, threshold 0.1, influence 0.5); each run of "above" samples
//             longer than 5 samples is one beat, placed at its highest sample
//   BPM     = our change: autocorrelation of the last 8 s of the filtered signal, median of recent
//             estimates. InPulse instead takes 60 / median of median-gated beat intervals, which on
//             our weaker camera signal misses beats; its beat list is kept for HRV.

const FS = 30;
const BAND = [0.4, 3.6];
const BUTTER6_Q = [0.5176, 0.7071, 1.9319]; // order-6 Butterworth section Qs
const MIN_FPS = 13;
const MAX_GAP = 2;              // s between frames before we restart
const JITTER_GAP = 0.2;         // s; more than 5 such gaps in a row also restarts
const FINGER_SECONDS = 1;       // steady finger before collecting
const WARM_SECONDS = 8;         // collected before the first analysis
const LOST_FINGER = 0.15;       // s of bad frames before a restart
const LAG = FS * 4;             // z-score window
const Z_THRESHOLD = 0.1;
const Z_INFLUENCE = 0.5;
const MIN_RUN = 5;              // samples above before a run counts as a beat
const RR_BAND = 0.2;            // s around the median interval
const BPM_RANGE = [40, 240];
const REFRACTORY = 60 / 180;    // s; closer beats are merged (our addition)
const AC_SECONDS = 8;           // autocorrelation window (our addition)
const AC_MIN = 0.15;            // weaker periodicity is not reported
const HISTORY = 10;             // estimates in the reported median

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
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const std = (a) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

// Camera exposure varies, so judge "finger" by colour ratios rather than InPulse's fixed R>170, G/B<100:
// with our exposure lock a covered lens often reads R 120-160.
export const isFinger = (r, g, b) => r > 60 && g < r * 0.75 && b < r * 0.75;

export class PulseEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = 0;            // 0 no finger, 1 collecting, 2 measuring
    this.good = 0;
    this.bad = 0;
    this.jitter = 0;
    this.times = [];
    this.fps = 0;
    this.rgb = [0, 0, 0];
    this.startT = null;
    this.resetSignal();
  }

  resetSignal() {
    this.sections = [
      ...BUTTER6_Q.map((q) => biquad('hp', BAND[0], q)),
      ...BUTTER6_Q.map((q) => biquad('lp', BAND[1], q)),
    ];
    this.collected = [];       // raw {t, v} while warming up
    this.prev = null;
    this.raw = [];             // filtered, resampled {t, y} for display
    this.z = null;             // z-score state
    this.run = [];             // current run of "above" samples
    this.peaks = [];
    this.rr = [];
    this.bpmValue = null;
    this.recent = [];
    this.history = [];
    this.acStrength = 0;
    this.sinceEstimate = 0;
    this.shown = null;
    this.kept = 0;
  }

  // A camera exposure step looks like a huge pulse to the filters: restart the signal and the warm-up.
  exposureChanged() {
    this.resetSignal();
    if (this.state !== 0) {
      this.state = 1;
      this.startT = this.times[this.times.length - 1];
    }
  }

  // r, g, b: mean 0..255 over the frame; v: share of pixels above the adaptive threshold (0..1).
  push(t, r, g, b, v) {
    this.rgb = [r, g, b];
    const last = this.times[this.times.length - 1];
    if (last !== undefined) {
      const gap = t - last;
      if (gap > MAX_GAP) this.reset();
      else if (gap > JITTER_GAP && ++this.jitter > 5) this.reset();
      else if (gap <= JITTER_GAP) this.jitter = 0;
    }
    this.times.push(t);
    if (this.times.length > 60) this.times.shift();
    if (this.times.length >= 11) this.fps = (this.times.length - 1) / (t - this.times[0]);
    const fps = this.fps || FS;
    if (this.fps && this.fps < MIN_FPS) this.reset();

    if (!isFinger(r, g, b)) {
      this.bad++;
      if (this.state !== 0 && this.bad > fps * LOST_FINGER) this.reset();
      return this.status(false);
    }
    this.bad = 0;
    this.good++;
    if (this.state === 0) {
      if (this.good >= fps * FINGER_SECONDS) {
        this.state = 1;
        this.startT = t;
      }
      return this.status(true);
    }

    if (this.state === 1) {
      this.collected.push({ t, v });
      if (this.collected.length > fps * WARM_SECONDS) {
        this.state = 2;
        for (const s of this.collected) this.feed(s.t, s.v);
        this.collected = [];
        this.estimate();
      }
      return this.status(true);
    }

    if (this.feed(t, v)) this.estimate();
    return this.status(true);
  }

  // Linear resample to the FS grid, filter, then beat detection. Returns true when a new estimate is due.
  feed(t, v) {
    if (!this.prev) {
      // Settle the filters on the first level so there is no start-up transient.
      for (let i = 0; i < 600; i++) this.filter(v);
      this.prev = { t, v };
      this.nextGrid = t;
      return false;
    }
    const { t: t0, v: v0 } = this.prev;
    let beat = false;
    while (this.nextGrid <= t) {
      const tg = this.nextGrid;
      const y = this.filter(t > t0 ? v0 + ((tg - t0) / (t - t0)) * (v - v0) : v);
      this.raw.push({ t: tg, y });
      if (this.raw.length > FS * 12) this.raw.shift();
      if (this.detect(y, tg)) beat = true;
      if (++this.sinceEstimate >= FS / 2) {
        this.sinceEstimate = 0;
        beat = true;
      }
      this.nextGrid += 1 / FS;
    }
    this.prev = { t, v };
    return beat;
  }

  filter(x) {
    let y = x * 1000;
    for (const s of this.sections) y = step(s, y);
    return y;
  }

  // Smoothed z-score peak signal (Brakel); the beat is the highest sample of each long enough run.
  detect(y, t) {
    if (!this.z) this.z = { seed: [], filtered: [] };
    const z = this.z;
    if (z.seed.length < LAG) {
      z.seed.push(y);
      z.filtered.push(y);
      if (z.seed.length === LAG) {
        z.avg = mean(z.filtered);
        z.sd = std(z.filtered);
      }
      return false;
    }
    let signal = 0;
    let fy = y;
    if (Math.abs(y - z.avg) > Z_THRESHOLD * z.sd) {
      signal = y > z.avg ? 1 : -1;
      fy = Z_INFLUENCE * y + (1 - Z_INFLUENCE) * z.filtered[z.filtered.length - 1];
    }
    z.filtered.push(fy);
    if (z.filtered.length > LAG) z.filtered.shift();
    z.avg = mean(z.filtered);
    z.sd = std(z.filtered);

    if (signal === 1) {
      this.run.push({ t, y });
      return false;
    }
    const run = this.run;
    this.run = [];
    if (run.length <= MIN_RUN) return false;
    const top = run.reduce((a, b) => (b.y > a.y ? b : a));
    // Our camera signal is weaker than InPulse's, so noise can split one beat into two runs. Two beats
    // closer than a 180 BPM period are one beat: keep the taller.
    const prev = this.peaks[this.peaks.length - 1];
    const refractory = this.rr.length >= 5 ? Math.max(REFRACTORY, 0.6 * median(this.rr)) : REFRACTORY;
    if (prev !== undefined && top.t - prev < refractory) {
      if (top.y <= this.lastPeakY) return false;
      this.peaks.pop();
      this.rr.pop();
    }
    const before = this.peaks[this.peaks.length - 1];
    this.peaks.push(top.t);
    this.lastPeakY = top.y;
    if (before !== undefined) this.rr.push(top.t - before);
    return true;
  }

  // Dominant pulse period of the last 8 s of filtered signal by normalised autocorrelation. InPulse
  // counts single beats here instead, but on our weaker camera signal that misses beats while the
  // waveform's periodicity stays clear. A peak at half the lag that is nearly as strong wins, so a run of
  // alternating beat shapes cannot halve the rate.
  autocorr() {
    const x = this.raw.slice(-FS * AC_SECONDS).map((p) => p.y);
    if (x.length < FS * 5) return null;
    // Remove the slow wander (breathing, threshold steps) the 0.4 Hz band edge lets through: it otherwise
    // dominates the autocorrelation at 1.5 s lags. Subtract a 1 s moving mean, then smooth over 5 samples.
    const hw = FS / 2;
    const hp = x.map((v, i) => v - mean(x.slice(Math.max(0, i - hw), i + hw + 1)));
    const d = hp.map((_, i) => mean(hp.slice(Math.max(0, i - 2), i + 3)));
    const e = d.reduce((a, v) => a + v * v, 0) || 1;
    const r = [];
    for (let lag = 0; lag <= FS * 1.6; lag++) {
      let a = 0;
      for (let i = 0; i + lag < d.length; i++) a += d[i] * d[i + lag];
      r.push(a / e);
    }
    const lo = Math.round(FS * 0.3);
    let best = null;
    for (let lag = lo; lag < r.length - 1; lag++) {
      if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && (!best || r[lag] > r[best])) best = lag;
    }
    if (best === null) return null;
    const half = Math.round(best / 2);
    for (const h of [half - 1, half, half + 1]) {
      if (h > lo && h < r.length - 1 && r[h] > r[h - 1] && r[h] >= r[h + 1] && r[h] > 0.6 * r[best]) best = h;
    }
    // Parabolic interpolation between lags for sub-sample precision.
    const den = r[best - 1] - 2 * r[best] + r[best + 1];
    const lag = best + (den ? (0.5 * (r[best - 1] - r[best + 1])) / den : 0);
    return { period: lag / FS, strength: r[best] };
  }

  estimate() {
    const ac = this.autocorr();
    if (!ac || ac.strength < AC_MIN) return;
    const bpm = 60 / ac.period;
    if (bpm < BPM_RANGE[0] || bpm > BPM_RANGE[1]) return;
    this.history = [...this.history, bpm].slice(-HISTORY);
    this.acStrength = ac.strength;
    this.bpmValue = median(this.history);
    // Show a number only once three successive estimates agree within 4 BPM, then glide toward new ones,
    // so the screen does not flash an early 100 before settling on 78.
    this.recent = [...this.recent, bpm].slice(-3);
    const steady = this.recent.length === 3 && Math.max(...this.recent) - Math.min(...this.recent) <= 4;
    if (this.shown === null && steady) this.shown = this.bpmValue;
    else if (this.shown !== null) this.shown += 0.3 * (this.bpmValue - this.shown);
  }

  // 0..1 from how strongly the waveform repeats at the reported period.
  quality() {
    if (!this.bpmValue) return 0;
    return Math.max(0, Math.min(1, (this.acStrength - AC_MIN) / (0.6 - AC_MIN)));
  }

  // Time-domain HRV from the accepted beat-to-beat intervals (ms).
  hrv() {
    if (this.rr.length < 5) return null;
    const m = median(this.rr);
    const rr = this.rr.filter((d) => Math.abs(d - m) < RR_BAND).map((d) => d * 1000);
    if (rr.length < 5) return null;
    const avg = mean(rr);
    const diffs = rr.slice(1).map((d, i) => d - rr[i]);
    return {
      sdnn: Math.round(Math.sqrt(mean(rr.map((d) => (d - avg) ** 2)))),
      rmssd: Math.round(Math.sqrt(mean(diffs.map((d) => d * d)))),
      pnn50: Math.round((diffs.filter((d) => Math.abs(d) > 50).length / diffs.length) * 100),
    };
  }

  status(finger) {
    const bpm = this.shown !== null ? Math.round(this.shown) : null;
    const strength = this.quality();
    return {
      finger,
      state: this.state,
      bpm,
      strength,
      confidence: bpm ? Math.min(99, Math.round(strength * 100)) : 0,
      beats: this.peaks.length,
      channel: 'V',
      fps: this.fps,
      rgb: this.rgb,
      wave: this.raw,
      lastPeak: this.peaks[this.peaks.length - 1] || null,
    };
  }
}
