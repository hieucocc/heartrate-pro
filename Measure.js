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
import { Heart, Ring, TabIcon, Wave } from './ui';

const MEASURE_SECONDS = 20;
const GIVE_UP_SECONDS = 60;
const ACCENT = '#FF4D6A';
const DARK = { accent: ACCENT, soft: '#2B1A20', text: '#fff' };

// Clip spikes so one outlier does not flatten the drawn wave.
function displayWave(points) {
  const v = points.slice(-150).map((p) => p.y);
  if (v.length < 2) return v;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
  return v.map((y) => Math.max(m - 3 * sd, Math.min(m + 3 * sd, y)));
}

export default function Measure({ onClose, onDone, haptics }) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [{ videoResolution: { width: 640, height: 480 } }, { fps: 30 }]);
  const engine = useRef(new PulseEngine());
  const latest = useRef(null);
  const measureStart = useRef(null);
  const openedAt = useRef(Date.now());
  const ticks = useRef(0);
  const [ui, setUi] = useState({ finger: false, bpm: null, strength: 0, progress: 0, wave: [], dbg: '' });
  const [expo, setExpo] = useState(0);
  const expoRef = useRef(0);
  expoRef.current = expo;
  const [debug, setDebug] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const onSample = useCallback((t, r, g, b) => {
    latest.current = engine.current.push(t, r, g, b);
  }, []);
  const onSampleJS = Worklets.createRunOnJS(onSample);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      // iOS 'rgb' frames are BGRA, 4 bytes per pixel. Average the whole frame on a coarse grid.
      const buf = new Uint8Array(frame.toArrayBuffer());
      const w = frame.width;
      const h = frame.height;
      const stride = frame.bytesPerRow;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = 0; y < h; y += 8) {
        for (let x = 0; x < w; x += 8) {
          const i = y * stride + x * 4;
          b += buf[i];
          g += buf[i + 1];
          r += buf[i + 2];
          n++;
        }
      }
      if (n > 0) onSampleJS(Date.now() / 1000, r / n, g / n, b / n);
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

      // Keep the red channel away from clipping: lower exposure when it saturates, raise it when too dark.
      if (device && ticks.current % 3 === 0 && s.finger && (s.state < 2 || s.rgb[0] > 250)) {
        const step = (device.maxExposure - device.minExposure) / 24;
        if (s.rgb[0] > 238) setExpo((e) => Math.max(device.minExposure, e - step));
        else if (s.rgb[0] < 140) setExpo((e) => Math.min(device.maxExposure, e + step));
      }

      if (s.state === 0) measureStart.current = null;
      else if (measureStart.current === null) measureStart.current = Date.now();
      const secs = measureStart.current ? (Date.now() - measureStart.current) / 1000 : 0;
      if (ticks.current % 3 === 0) {
        // Streams to the Metro terminal when running the dev client.
        console.log(
          `[PPG] finger=${s.finger} st=${s.state} R=${s.rgb[0].toFixed(0)} G=${s.rgb[1].toFixed(0)} B=${s.rgb[2].toFixed(0)} ` +
            `fps=${s.fps.toFixed(1)} beats=${s.beats} bpm=${s.bpm} q=${s.strength.toFixed(2)} expo=${expoRef.current.toFixed(1)}`,
        );
      }
      setUi({
        finger: s.finger,
        bpm: s.bpm,
        strength: s.strength,
        progress: secs / MEASURE_SECONDS,
        wave: displayWave(s.wave),
        dbg: `R${Math.round(s.rgb[0])} G${Math.round(s.rgb[1])} B${Math.round(s.rgb[2])}  ${s.fps.toFixed(0)}fps  st${s.state}  beats ${s.beats}  q${s.strength.toFixed(2)}`,
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
    }, 400);
    return () => clearInterval(id);
  }, [active, haptics, onDone, device]);

  const retry = () => {
    engine.current.reset();
    latest.current = null;
    measureStart.current = null;
    openedAt.current = Date.now();
    setFailed(false);
    setUi({ finger: false, bpm: null, strength: 0, progress: 0, wave: [], dbg: '' });
    setActive(true);
  };

  const quality = !ui.finger
    ? null
    : !ui.bpm
      ? { label: 'Reading signal...', color: '#B5B5BF' }
      : ui.strength >= 0.5
        ? { label: 'Signal Good', color: '#34D27A' }
        : { label: 'Weak Signal', color: '#FFAA33' };
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
        <Ring size={250} stroke={7} progress={ui.progress} color={ACCENT} track="#2A2A31" />
        <View style={styles.ringInner}>
          <Heart size={64} t={DARK} bare animate />
          <Text style={styles.bpm}>{ui.bpm ?? '--'}</Text>
          <Text style={styles.unit}>BPM</Text>
        </View>
      </View>

      <Wave values={ui.wave} width={300} height={56} color={ACCENT} />

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
