import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import * as Haptics from 'expo-haptics';
import { PulseEngine } from './ppg';
import { canLockCamera, setCameraLocked } from './cameraLock';
import { Heart, Ring, TabIcon, Wave } from './ui';

const MEASURE_SECONDS = 20;
const GIVE_UP_SECONDS = 60;
const ACCENT = '#FF4D6A';
const DARK = { accent: ACCENT, soft: '#2B1A20', text: '#fff' };

const TICK_MS = 66;               // UI refresh (~15 fps)
const WAVE_SAMPLES = 120;         // 4 s of signal on screen
const EXPOSURE_WINDOW = 3000;     // only tune exposure bias in the first ms after the finger lands
const LOCK_AFTER_MS = 700;        // auto-exposure settling time before the lock

// Scale from a robust spread so one outlier does not flatten the drawn wave; eased by the caller.
function waveSpan(v) {
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
  return sd ? [m - 2.5 * sd, m + 2.5 * sd] : null;
}

export default function Measure({ onClose, onDone, haptics }) {
  const { hasPermission, requestPermission } = useCameraPermission();
  // The plain wide-angle lens sits next to the torch, and it is the device the exposure lock targets.
  const device = useCameraDevice('back', { physicalDevices: ['wide-angle-camera'] });
  const locked = useRef(false);
  const format = useCameraFormat(device, [{ videoResolution: { width: 640, height: 480 } }, { fps: 30 }]);
  const engine = useRef(new PulseEngine());
  const latest = useRef(null);
  const measureStart = useRef(null);
  const openedAt = useRef(Date.now());
  const ticks = useRef(0);
  const fingerSince = useRef(null);
  const domain = useRef(null);
  const [ui, setUi] = useState({ finger: false, bpm: null, strength: 0, progress: 0, wave: [], domain: null, dbg: '' });
  const [expo, setExpo] = useState(0);
  const expoRef = useRef(0);
  expoRef.current = expo;
  const [debug, setDebug] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => () => {
    if (locked.current) setCameraLocked(false).catch(() => {});
  }, []);

  const rawLog = useRef([]);
  const onSample = useCallback((t, r, g, b, clip) => {
    latest.current = { ...engine.current.push(t, r, g, b), clip };
    // Raw frames streamed to Metro in chunks so the pipeline can be tuned offline on real recordings.
    const buf = rawLog.current;
    buf.push(`${t.toFixed(3)},${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)},${clip.toFixed(2)}`);
    if (buf.length >= 60) {
      console.log(`[RAW] ${buf.join(';')}`);
      rawLog.current = [];
    }
  }, []);
  const onSampleJS = Worklets.createRunOnJS(onSample);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      // iOS 'rgb' frames are BGRA, 4 bytes per pixel. Average on a coarse grid, skipping pixels the torch
      // blows out: a clipped pixel cannot change with the pulse and only dilutes it.
      const buf = new Uint8Array(frame.toArrayBuffer());
      const w = frame.width;
      const h = frame.height;
      const stride = frame.bytesPerRow;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let all = 0;
      for (let y = 0; y < h; y += 6) {
        for (let x = 0; x < w; x += 6) {
          const i = y * stride + x * 4;
          const pb = buf[i];
          const pg = buf[i + 1];
          const pr = buf[i + 2];
          ab += pb;
          ag += pg;
          ar += pr;
          all++;
          if (pr < 250 && pg < 250) {
            b += pb;
            g += pg;
            r += pr;
            n++;
          }
        }
      }
      const t = Date.now() / 1000;
      if (n > all * 0.1) onSampleJS(t, r / n, g / n, b / n, 1 - n / all);
      else if (all > 0) onSampleJS(t, ar / all, ag / all, ab / all, 1 - n / all);
    },
    [onSampleJS],
  );

  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      const s = latest.current;
      if (Date.now() - openedAt.current > GIVE_UP_SECONDS * 1000 && !(s && s.bpm)) {
        setActive(false);
        setFailed(true);
        return;
      }
      if (!s) return;
      ticks.current++;

      if (!s.finger) fingerSince.current = null;
      else if (fingerSince.current === null) fingerSince.current = Date.now();

      // Like InPulse: let auto-exposure settle on the lit finger, then lock it, because a live auto-exposure
      // brightens and darkens the frame against every heartbeat. Builds without the lock module instead
      // nudge the exposure bias, only in the first seconds since every step restarts the signal.
      const since = fingerSince.current === null ? null : Date.now() - fingerSince.current;
      if (canLockCamera()) {
        if (since !== null && since > LOCK_AFTER_MS && !locked.current) {
          locked.current = true;
          setCameraLocked(true)
            .then(() => engine.current.exposureChanged())
            .catch(() => {});
        } else if (since === null && locked.current) {
          locked.current = false;
          setCameraLocked(false).catch(() => {});
        }
      } else if (device && since !== null && since < EXPOSURE_WINDOW && ticks.current % 5 === 0) {
        const step = (device.maxExposure - device.minExposure) / 16;
        const e = expoRef.current;
        const next = s.clip > 0.3 ? Math.max(device.minExposure, e - step) : s.rgb[0] < 110 ? Math.min(device.maxExposure, e + step) : e;
        if (next !== e) {
          setExpo(next);
          engine.current.exposureChanged();
        }
      }

      if (s.state < 2) measureStart.current = null;
      else if (measureStart.current === null) measureStart.current = Date.now();
      const secs = measureStart.current ? (Date.now() - measureStart.current) / 1000 : 0;
      if (ticks.current % 15 === 0) {
        // Streams to the Metro terminal when running the dev client.
        console.log(
          `[PPG] finger=${s.finger} st=${s.state} R=${s.rgb[0].toFixed(0)} G=${s.rgb[1].toFixed(0)} B=${s.rgb[2].toFixed(0)} ` +
            `fps=${s.fps.toFixed(1)} ch=${s.channel} beats=${s.beats} bpm=${s.bpm} q=${s.strength.toFixed(2)} expo=${expoRef.current.toFixed(1)}`,
        );
      }
      const wave = s.wave.slice(-WAVE_SAMPLES).map((p) => p.y);
      const target = waveSpan(wave);
      if (target) {
        const d = domain.current;
        domain.current = d ? [d[0] + 0.12 * (target[0] - d[0]), d[1] + 0.12 * (target[1] - d[1])] : target;
      } else domain.current = null;
      setUi({
        finger: s.finger,
        bpm: s.bpm,
        strength: s.strength,
        progress: secs / MEASURE_SECONDS,
        wave,
        domain: domain.current,
        dbg: `R${Math.round(s.rgb[0])} G${Math.round(s.rgb[1])} B${Math.round(s.rgb[2])}  ${s.fps.toFixed(0)}fps  st${s.state}  ${s.channel}  beats ${s.beats}  q${s.strength.toFixed(2)}`,
      });
      if (secs >= MEASURE_SECONDS && s.bpm && s.strength >= 0.3) {
        setActive(false);
        if (haptics) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        const step = Math.max(1, Math.floor(s.wave.length / 60));
        onDone({
          bpm: s.bpm,
          confidence: s.confidence,
          ts: Date.now(),
          hrv: engine.current.hrv(),
          wave: s.wave.filter((_, i) => i % step === 0).map((p) => +p.y.toFixed(3)),
        });
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [active, haptics, onDone, device]);

  const retry = () => {
    engine.current.reset();
    latest.current = null;
    measureStart.current = null;
    fingerSince.current = null;
    domain.current = null;
    openedAt.current = Date.now();
    setFailed(false);
    setUi({ finger: false, bpm: null, strength: 0, progress: 0, wave: [], domain: null, dbg: '' });
    setActive(true);
  };

  const quality = !ui.finger
    ? null
    : !ui.bpm
      ? { label: 'Reading signal...', color: '#B5B5BF' }
      : ui.strength >= 0.45
        ? { label: 'Signal Good', color: '#34D27A' }
        : ui.strength >= 0.25
          ? { label: 'Signal Fair', color: '#FFD23F' }
          : { label: 'Weak Signal · press lightly, keep still', color: '#FFAA33' };
  const title = failed
    ? "Couldn't get a clear reading"
    : ui.finger
      ? 'Hold still...'
      : 'Place your finger\nover the camera and flash';

  return (
    <View style={styles.root}>
      {hasPermission && device && (
        <Camera
          style={styles.camera}
          device={device}
          format={format}
          isActive={active}
          torch={active ? 'on' : 'off'}
          exposure={expo}
          pixelFormat="rgb"
          fps={30}
          frameProcessor={frameProcessor}
        />
      )}
      <Pressable onPress={onClose} hitSlop={14} style={styles.close}>
        <TabIcon name="close" color="#fff" size={26} />
      </Pressable>

      <Pressable onPress={() => setDebug((d) => !d)}>
        <Text style={styles.title}>{hasPermission ? title : 'Camera access is required'}</Text>
      </Pressable>
      {debug && <Text style={styles.dbg}>{ui.dbg} exp{expo.toFixed(1)}</Text>}

      <View style={styles.ringBox}>
        <Ring size={250} stroke={7} progress={ui.progress} color={ACCENT} track="#2A2A31" duration={TICK_MS} />
        <View style={styles.ringInner}>
          <Heart size={64} t={DARK} bare animate bpm={ui.bpm} />
          <Text style={styles.bpm}>{ui.bpm ?? '--'}</Text>
          <Text style={styles.unit}>BPM</Text>
        </View>
      </View>

      <Wave values={ui.wave} domain={ui.domain} width={300} height={56} color={ACCENT} />

      <View style={styles.quality}>
        {quality && (
          <>
            <TabIcon name="trends" color={quality.color} size={14} />
            <Text style={[styles.qText, { color: quality.color }]}>{quality.label}</Text>
          </>
        )}
      </View>

      {failed ? (
        <Pressable onPress={retry} style={styles.pill}>
          <Text style={styles.pillText}>Try again</Text>
        </Pressable>
      ) : (
        <View style={styles.pill}>
          <TabIcon name="pulse" color={ACCENT} size={18} />
          <Text style={styles.pillText}>{ui.finger ? 'Measuring...' : 'Waiting for finger'}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07070A', alignItems: 'center', paddingTop: 64 },
  camera: { position: 'absolute', top: 0, left: 0, width: 16, height: 16, opacity: 0.02 },
  close: { position: 'absolute', top: 58, left: 20, zIndex: 2 },
  title: { color: '#fff', fontSize: 19, textAlign: 'center', lineHeight: 26, marginTop: 8, minHeight: 56 },
  dbg: { color: '#7a7a85', fontSize: 11, marginTop: 2 },
  ringBox: { width: 250, height: 250, marginTop: 30, alignItems: 'center', justifyContent: 'center' },
  ringInner: { position: 'absolute', alignItems: 'center' },
  bpm: { color: '#fff', fontSize: 52, fontWeight: '700', marginTop: 6 },
  unit: { color: '#B5B5BF', fontSize: 14, marginTop: -2 },
  quality: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 24, marginTop: 20 },
  qText: { fontSize: 13 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1A1A20',
    paddingVertical: 14, paddingHorizontal: 34, borderRadius: 30, marginTop: 'auto', marginBottom: 56,
  },
  pillText: { color: '#fff', fontSize: 16, fontWeight: '500' },
});
