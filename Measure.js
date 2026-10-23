import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { Worklets, useSharedValue } from 'react-native-worklets-core';
import * as Haptics from 'expo-haptics';
import { PulseEngine } from './ppg';
import { Heart, Ring, TabIcon, Wave } from './ui';

const MODES = [
  { long: false, label: 'Quick', secs: 20 },
  { long: true, label: '1 min', secs: 60 },
];
const GIVE_UP_SECONDS = 60;       // without any BPM
const ACCENT = '#FF4D6A';
const DARK = { accent: ACCENT, soft: '#2B1A20', text: '#fff' };

const TICK_MS = 66;               // UI refresh (~15 fps)
const WAVE_SAMPLES = 120;         // 4 s of signal on screen

// Scale from a robust spread so one outlier does not flatten the drawn wave; eased by the caller.
function waveSpan(v) {
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
  return sd ? [m - 2.5 * sd, m + 2.5 * sd] : null;
}

export default function Measure({ onClose, onDone, haptics, long = false, onLongChange }) {
  const measureSeconds = MODES.find((m) => m.long === long).secs;
  const secsRef = useRef(measureSeconds);
  secsRef.current = measureSeconds;
  const { hasPermission, requestPermission } = useCameraPermission();
  // The plain wide-angle lens sits next to the torch, and it is the device the exposure lock targets.
  const device = useCameraDevice('back', { physicalDevices: ['wide-angle-camera'] });
  // Like InPulse (AVCaptureSessionPresetLow): the smallest format at 30 fps; a finger fills any frame.
  const format = useCameraFormat(device, [{ fps: 30 }, { videoResolution: { width: 192, height: 144 } }]);
  const engine = useRef(new PulseEngine());
  const latest = useRef(null);
  const measureStart = useRef(null);
  const openedAt = useRef(Date.now());
  const ticks = useRef(0);
  const domain = useRef(null);
  const [ui, setUi] = useState({ finger: false, bpm: null, strength: 0, progress: 0, wave: [], domain: null, dbg: '' });
  const [debug, setDebug] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const vThreshold = useSharedValue(170);
  const rawLog = useRef([]);
  const onSample = useCallback((t, r, g, b, clip, v, thr) => {
    latest.current = { ...engine.current.push(t, r, g, b, v), clip };
    // Raw frames streamed to Metro in chunks so the pipeline can be tuned offline on real recordings.
    const buf = rawLog.current;
    buf.push(`${t.toFixed(3)},${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)},${clip.toFixed(2)},${v.toFixed(4)},${thr}`);
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
      // InPulse's signal: the share of pixels whose HSV value (max channel) is above a threshold that is
      // nudged by 1 each frame to keep that share within 40-60%, clamped to 100-230.
      const thr = vThreshold.value;
      let above = 0;
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const i = y * stride + x * 4;
          const pb = buf[i];
          const pg = buf[i + 1];
          const pr = buf[i + 2];
          ab += pb;
          ag += pg;
          ar += pr;
          all++;
          if (pr < 250 && pg < 250) {
            // Torch-saturated pixels sit above any threshold and would pin the share; count unclipped ones only.
            if (Math.max(pr, pg, pb) > thr) above++;
            b += pb;
            g += pg;
            r += pr;
            n++;
          }
        }
      }
      // Camera presentation time (ms): monotonic and exact per frame, unlike the worklet's Date.now().
      const t = frame.timestamp / 1000;
      if (all === 0) return;
      const v = n ? above / n : 0;
      vThreshold.value = Math.min(230, Math.max(100, thr + (v > 0.6 ? 1 : v < 0.4 ? -1 : 0)));
      onSampleJS(t, ar / all, ag / all, ab / all, 1 - n / all, v, thr);
    },
    [onSampleJS, vThreshold],
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


      // InPulse leaves the camera on continuous auto-exposure with the torch at full power; locking or
      // stepping the exposure ourselves gave far weaker pulses on real recordings, so we do not touch it.

      // Like InPulse, the ring runs from the moment the finger is steady; the number appears once beats are trusted.
      if (s.state < 1) measureStart.current = null;
      else if (measureStart.current === null) measureStart.current = Date.now();
      const secs = measureStart.current ? (Date.now() - measureStart.current) / 1000 : 0;
      if (ticks.current % 15 === 0) {
        // Streams to the Metro terminal when running the dev client.
        console.log(
          `[PPG] finger=${s.finger} st=${s.state} R=${s.rgb[0].toFixed(0)} G=${s.rgb[1].toFixed(0)} B=${s.rgb[2].toFixed(0)} ` +
            `fps=${s.fps.toFixed(1)} ch=${s.channel} beats=${s.beats} bpm=${s.bpm} q=${s.strength.toFixed(2)}`,
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
        progress: secs / secsRef.current,
        wave,
        domain: domain.current,
        dbg: `R${Math.round(s.rgb[0])} G${Math.round(s.rgb[1])} B${Math.round(s.rgb[2])}  ${s.fps.toFixed(0)}fps  st${s.state}  ${s.channel}  beats ${s.beats}  q${s.strength.toFixed(2)}`,
      });
      // Finish when the ring completes; a weak reading still ends here and shows its lower confidence.
      if (secs >= secsRef.current && s.bpm) {
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
          pixelFormat="rgb"
          // Any frame-to-frame image processing smears or cancels the tiny pulse brightness change.
          videoStabilizationMode="off"
          videoHdr={false}
          lowLightBoost={false}
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
      {debug && <Text style={styles.dbg}>{ui.dbg}</Text>}

      <View style={styles.ringBox}>
        <Ring size={250} stroke={7} progress={ui.progress} color={ACCENT} track="#2A2A31" duration={TICK_MS} />
        <View style={styles.ringInner}>
          <Heart size={64} t={DARK} bare animate bpm={ui.bpm} />
          <Text style={styles.bpm}>{ui.bpm ?? '--'}</Text>
          <Text style={styles.unit}>BPM</Text>
        </View>
      </View>

      <View style={styles.modes}>
        {MODES.map((m) => (
          <Pressable
            key={m.label}
            onPress={() => onLongChange?.(m.long)}
            style={[styles.mode, m.long === long && styles.modeOn]}
          >
            <Text style={[styles.modeText, m.long === long && styles.modeTextOn]}>{m.label}</Text>
          </Pressable>
        ))}
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
  modes: { flexDirection: 'row', backgroundColor: '#1A1A20', borderRadius: 18, padding: 3, marginTop: 18, marginBottom: 14 },
  mode: { paddingVertical: 7, paddingHorizontal: 18, borderRadius: 15 },
  modeOn: { backgroundColor: '#2B1A20' },
  modeText: { color: '#8A8A94', fontSize: 13, fontWeight: '600' },
  modeTextOn: { color: ACCENT },
  quality: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 24, marginTop: 20 },
  qText: { fontSize: 13 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1A1A20',
    paddingVertical: 14, paddingHorizontal: 34, borderRadius: 30, marginTop: 'auto', marginBottom: 56,
  },
  pillText: { color: '#fff', fontSize: 16, fontWeight: '500' },
});
