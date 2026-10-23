// PPG processing: samples are {t: seconds, v: mean red}. Returns BPM or null.
const MIN_BPM = 45;
const MAX_BPM = 190;

function movingAverage(values, win) {
  const out = new Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= win) sum -= values[i - win];
    out[i] = sum / Math.min(i + 1, win);
  }
  return out;
}

export function estimateBpm(samples) {
  if (samples.length < 60) return null;
  const span = samples[samples.length - 1].t - samples[0].t;
  if (span < 6) return null;
  const fps = (samples.length - 1) / span;

  // Band-pass: remove slow drift (~1s mean), then smooth (~0.15s).
  const raw = samples.map((s) => s.v);
  const slow = movingAverage(raw, Math.round(fps));
  const detrended = raw.map((v, i) => v - slow[i]);
  const sig = movingAverage(detrended, Math.max(2, Math.round(fps * 0.15)));

  // Peak detection with adaptive threshold.
  let sumSq = 0;
  for (const v of sig) sumSq += v * v;
  const thr = Math.sqrt(sumSq / sig.length) * 0.4;
  const minGap = 60 / MAX_BPM;
  const peaks = [];
  for (let i = 2; i < sig.length - 2; i++) {
    const isPeak = sig[i] > thr && sig[i] >= sig[i - 1] && sig[i] > sig[i + 1];
    if (!isPeak) continue;
    const t = samples[i].t;
    const last = peaks.length ? peaks[peaks.length - 1] : null;
    if (last === null || t - last.t >= minGap) peaks.push({ t, v: sig[i] });
    else if (sig[i] > last.v) peaks[peaks.length - 1] = { t, v: sig[i] };
  }
  if (peaks.length < 5) return null;

  const intervals = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i].t - peaks[i - 1].t);
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // Drop outliers (missed or double beats) before averaging.
  const good = intervals.filter((d) => Math.abs(d - median) < median * 0.25);
  if (good.length < 3) return null;
  const mean = good.reduce((a, b) => a + b, 0) / good.length;
  const bpm = 60 / mean;
  return bpm >= MIN_BPM && bpm <= MAX_BPM ? Math.round(bpm) : null;
}
