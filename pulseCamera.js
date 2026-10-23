// InPulse-style native capture bridge (modules/pulse-camera). Older builds lack it, so it is optional.
import { requireOptionalNativeModule } from 'expo-modules-core';

const mod = requireOptionalNativeModule('PulseCamera');

export const hasPulseCamera = () => !!mod;

// Starts capture; onSample gets { t, r, g, b, clip, v, thr, w, h } per frame. Returns a stop function.
export function startPulseCamera(fps, onSample) {
  const sub = mod.addListener('onSample', onSample);
  mod.start(fps).catch(() => {});
  return () => {
    sub.remove();
    mod.stop().catch(() => {});
  };
}
