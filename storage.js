import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pulse.v1';
export const DEFAULTS = { history: [], settings: { haptics: true, animations: true, theme: 'system', health: false, longMeasure: false } };

export async function load() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const d = raw ? JSON.parse(raw) : {};
    return { history: d.history || [], settings: { ...DEFAULTS.settings, ...(d.settings || {}) } };
  } catch {
    return DEFAULTS;
  }
}

export function save(state) {
  return AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}

export const startOfDay = (ts) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function fmtDay(ts) {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
  const time = fmtTime(ts);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  return `${new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

export function ago(ts) {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function stats(list) {
  if (!list.length) return null;
  const v = list.map((r) => r.bpm);
  return {
    avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
    min: Math.min(...v),
    max: Math.max(...v),
  };
}
