// Streaming PPG engine: finger gating -> uniform resample -> band-pass -> beat detection -> RR intervals -> BPM/HRV.
// Like InPulse, the rate comes from beat-to-beat (RR) intervals: outliers are rejected against the running median
// and the shown BPM is the median of the recent intervals, so single bad beats do not move it.
// Red and green are tracked separately; whichever beats more regularly drives the result.

const FS = 30;                    // target sample rate (Hz)
const BAND = [0.6, 3.0];          // pass band (Hz); a low top edge keeps the dicrotic bump small
const SECTIONS_Q = [0.5412, 1.3066]; // Butterworth order-4 section Qs
const MIN_FPS = 10;
const MAX_GAP = 2;                // seconds between frames before we reset
const RR_RANGE = [0.3, 1.4];      // seconds (200-43 BPM)
const RR_TOL = 0.22;              // max relative deviation from the running median
const RR_WINDOW = 12;             // intervals in the median
const MIN_RR = 3;                 // intervals before a BPM is shown
const FINGER_FRAMES = 6;          // frames of finger before we start (0.2 s)
const LOST_FINGER_FRAMES = FS * 0.5;
const WARM = FS;                  // filter settling samples
const PEAK_HALF = 9;              // samples each side a beat must dominate (0.3 s)
const DC_ALPHA = 0.05;           // slow mean used to normalise each channel (AC/DC)

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

// Camera exposure varies, so judge "finger" by colour ratios rather than absolute levels.
export const isFinger = (r, g, b) => r > 60 && g < r * 0.75 && b < r * 0.75;

// One colour channel: filter, beat detector and RR intervals.
class Track {
  constructor() {
    this.sections = [
      ...SECTIONS_Q.map((q) => biquad('hp', BAND[0], q)),
      ...SECTIONS_Q.map((q) => biquad('lp', BAND[1], q)),
    ];
    this.dc = null;
    this.raw = [];             // band-passed signal with times
    this.lastBeat = null;
    this.peaks = [];           // accepted beat times
    this.rr = [];              // accepted intervals (s)
    this.tried = 0;
    this.kept = 0;
  }

  filter(x) {
    if (this.dc === null) this.dc = x;
    this.dc += DC_ALPHA * (x - this.dc);
    // Normalised and inverted so systole (less light through the finger) reads as a peak.
    let y = -(x / (this.dc || 1) - 1) * 1000;
    for (const s of this.sections) y = step(s, y);
    return y;
  }

  push(y, t) {
    this.raw.push({ t, y });
    if (this.raw.length > FS * 12) this.raw.shift();
    const n = this.raw.length;
    if (n % (FS / 2) === 0) this.spectral();
    // Once the dominant rate is known a beat must dominate 40% of a period either side, else 0.3 s.
    const half = this.specHz ? Math.max(6, Math.min(18, Math.round((0.4 * FS) / this.specHz))) : PEAK_HALF;
    if (n < 2 * half + 1) return;
    // The sample `half` back is a beat if it is the maximum of its +-half neighbourhood,
    // which also skips the smaller dicrotic bump that follows each beat.
    const c = this.raw[n - 1 - half];
    for (let i = n - 1 - 2 * half; i < n; i++) if (this.raw[i].y > c.y) return;
    // Interpolate the peak position between samples for finer intervals.
    const a = this.raw[n - 2 - half].y;
    const b = this.raw[n - half].y;
    const den = a - 2 * c.y + b;
    const tb = c.t + (den ? (0.5 * (a - b)) / den / FS : 0);
    if (c.y <= 0) return;
    // Gate against the tallest recent peak, so dicrotic bumps cannot drag the threshold down.
    this.heights = (this.heights || []).filter((h) => tb - h.t < 1.5);
    const top = Math.max(0, ...this.heights.map((h) => h.y));
    this.heights.push({ t: tb, y: c.y });
    if (c.y < top * 0.35) return;
    if (this.lastBeat !== null) this.addInterval(tb - this.lastBeat);
    this.lastBeat = tb;
    this.peaks.push(tb);
    if (this.peaks.length > 60) this.peaks.shift();
  }

  addInterval(d) {
    // A gap of about two beats means one weak beat was missed: keep it as one interval instead of losing the run.
    if (d > RR_RANGE[1] && d / 2 >= 0.4 && d / 2 <= RR_RANGE[1]) d /= 2;
    else if (this.rr.length >= MIN_RR) {
      const m = median(this.rr.slice(-RR_WINDOW));
      if (Math.abs(d / 2 - m) / m < RR_TOL) d /= 2;
    }
    if (d < RR_RANGE[0] || d > RR_RANGE[1]) return;
    this.tried++;
    if (this.rr.length >= MIN_RR) {
      const m = median(this.rr.slice(-RR_WINDOW));
      if (Math.abs(d - m) / m > RR_TOL) {
        // A run of rejected beats means the rate itself changed: start over from the new rhythm.
        this.misses = (this.misses || 0) + 1;
        if (this.misses >= 4) {
          this.rr = [d];
          this.misses = 0;
        }
        return;
      }
    }
    this.misses = 0;
    this.kept++;
    this.rr.push(d);
    if (this.rr.length > 60) this.rr.shift();
  }

  // Dominant pulse frequency over the last 6 s. Each candidate also scores its second harmonic, and a
  // candidate at half the frequency wins when it explains the spectrum nearly as well, so a strong
  // dicrotic harmonic cannot double the rate.
  spectral() {
    const n = Math.min(this.raw.length, FS * 6);
    if (n < FS * 2) return;
    const x = this.raw.slice(-n).map((p) => p.y);
    const power = (f) => {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        const w = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))) * x[i];
        const ph = (2 * Math.PI * f * i) / FS;
        re += w * Math.cos(ph);
        im += w * Math.sin(ph);
      }
      return re * re + im * im;
    };
    let best = null;
    let total = 0;
    const scores = [];
    for (let f = BAND[0]; f <= BAND[1]; f += 0.025) {
      const p = power(f);
      total += p;
      scores.push({ f, p, s: p + 0.5 * power(2 * f) });
    }
    for (const c of scores) if (!best || c.s > best.s) best = c;
    const half = scores.find((c) => Math.abs(c.f - best.f / 2) < 0.03);
    // Only when the half-rate peak is itself strong: otherwise low-frequency drift halves the rate and the
    // wider beat window then swallows every other beat.
    if (half && half.p > best.p * 0.5) best = half;
    this.specHz = best.f;
    this.specShare = total ? best.p / total : 0;
  }

  bpm() {
    if (this.rr.length < MIN_RR) return null;
    return 60 / median(this.rr.slice(-RR_WINDOW));
  }

  // 0..1 from how regular the recent intervals are and how many beats were accepted.
  quality() {
    const iv = this.rr.slice(-RR_WINDOW);
    if (iv.length < MIN_RR) return 0;
    const m = mean(iv);
    const cv = Math.sqrt(mean(iv.map((d) => (d - m) ** 2))) / m;
    const regular = Math.max(0, 1 - cv * 6);
    const accepted = this.tried ? this.kept / this.tried : 0;
    return Math.max(0, Math.min(1, regular * (0.4 + 0.6 * accepted)));
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
    this.shown = null;
    this.ch = 0;
  }

  // A camera exposure step looks like a huge pulse to the filters: restart the signal and the warm-up.
  exposureChanged() {
    this.resetSignal();
    if (this.state !== 0) {
      this.state = 1;
      this.startT = this.times[this.times.length - 1];
    }
  }

  // Switch channel only on a clear margin, so the number does not hop between red and green estimates.
  get best() {
    const [r, g] = this.tracks;
    const cur = this.tracks[this.ch || 0];
    const other = this.tracks[1 - (this.ch || 0)];
    if (other.quality() > cur.quality() + 0.15) this.ch = other === g ? 1 : 0;
    return this.tracks[this.ch || 0] || r;
  }

  // r, g, b: mean 0..255 over the frame. Returns a status snapshot.
  push(t, r, g, b) {
    this.rgb = [r, g, b];
    const finger = isFinger(r, g, b);
    if (this.times.length && Math.abs(t - this.times[this.times.length - 1]) > MAX_GAP) this.reset();
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
    if (this.state === 0 && this.stable >= FINGER_FRAMES) {
      this.state = 1;
      this.startT = t;
    }
    if (this.state === 0) return this.status(true);

    if (this.fps && this.fps < MIN_FPS) {
      this.reset();
      return this.status(true);
    }
    this.feed(t, [r, g]);
    if (this.state === 1 && this.best.bpm()) this.state = 2;
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
        if (this.warm > WARM) tr.push(y, this.nextGrid);
      });
      this.nextGrid += 1 / FS;
    }
    this.prev = { t, v };
  }

  // Time-domain HRV from the accepted beat-to-beat intervals (ms).
  hrv() {
    const rr = this.best.rr.map((d) => d * 1000);
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
    // Ease toward the median so the number glides instead of stepping.
    if (raw) this.shown = this.shown ? this.shown + 0.04 * (raw - this.shown) : raw;
    const bpm = this.shown ? Math.round(this.shown) : null;
    const strength = tr.quality();
    return {
      finger,
      state: this.state,
      bpm,
      strength,
      confidence: bpm ? Math.min(99, Math.round(strength * 100)) : 0,
      beats: tr.peaks.length,
      channel: tr === this.tracks[1] ? 'G' : 'R',
      fps: this.fps,
      rgb: this.rgb,
      wave: tr.raw,
      lastPeak: tr.peaks[tr.peaks.length - 1] || null,
    };
  }
}
