import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { estimateBpm } from './ppg';

const MEASURE_SECONDS = 25;
const WINDOW_SECONDS = 15;

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [running, setRunning] = useState(false);
  const [bpm, setBpm] = useState(null);
  const [fingerOn, setFingerOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const samples = useRef([]);
  const startedAt = useRef(0);
  const lastFingerAt = useRef(0);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const onSample = useCallback((t, red, green) => {
    // Finger over the lens with torch on: image is strongly red, little green.
    const finger = red > 120 && green < red * 0.6;
    setFingerOn(finger);
    if (!finger) {
      samples.current = [];
      startedAt.current = Date.now();
      return;
    }
    lastFingerAt.current = t;
    samples.current.push({ t, v: red });
    const cutoff = t - WINDOW_SECONDS;
    while (samples.current.length && samples.current[0].t < cutoff) samples.current.shift();
  }, []);
  const onSampleJS = Worklets.createRunOnJS(onSample);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      // iOS 'rgb' frames are BGRA, 4 bytes per pixel.
      const buf = new Uint8Array(frame.toArrayBuffer());
      const w = frame.width;
      const h = frame.height;
      const stride = frame.bytesPerRow;
      const x0 = Math.floor(w * 0.3);
      const x1 = Math.floor(w * 0.7);
      const y0 = Math.floor(h * 0.3);
      const y1 = Math.floor(h * 0.7);
      let r = 0;
      let g = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 6) {
        for (let x = x0; x < x1; x += 6) {
          const i = y * stride + x * 4;
          g += buf[i + 1];
          r += buf[i + 2];
          n++;
        }
      }
      if (n > 0) onSampleJS(Date.now() / 1000, r / n, g / n);
    },
    [onSampleJS],
  );

  // Recompute BPM and progress twice a second while measuring.
  useEffect(() => {
    if (!running) return undefined;
    startedAt.current = Date.now();
    const id = setInterval(() => {
      const secs = (Date.now() - startedAt.current) / 1000;
      setElapsed(secs);
      const est = estimateBpm(samples.current);
      if (est) setBpm(est);
      if (secs >= MEASURE_SECONDS) {
        setRunning(false);
        setDone(true);
      }
    }, 500);
    return () => clearInterval(id);
  }, [running]);

  const start = () => {
    samples.current = [];
    setBpm(null);
    setDone(false);
    setElapsed(0);
    setRunning(true);
  };

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>Camera permission is required.</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant access</Text>
        </Pressable>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>No camera found.</Text>
      </View>
    );
  }

  const hint = !running
    ? done
      ? 'Done. Measure again any time.'
      : 'Press Start, then cover the rear camera and flash with your fingertip.'
    : fingerOn
      ? 'Hold still, light pressure...'
      : 'Cover the camera AND the flash with your fingertip.';

  return (
    <View style={styles.container}>
      <Camera
        style={styles.preview}
        device={device}
        isActive={running}
        torch={running ? 'on' : 'off'}
        pixelFormat="rgb"
        fps={30}
        frameProcessor={frameProcessor}
      />
      <Text style={styles.bpm}>{bpm ?? '--'}</Text>
      <Text style={styles.unit}>BPM</Text>
      <Text style={styles.hint}>{hint}</Text>
      {running && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.min(100, (elapsed / MEASURE_SECONDS) * 100)}%` }]} />
        </View>
      )}
      <Pressable
        style={[styles.btn, running && styles.btnStop]}
        onPress={running ? () => setRunning(false) : start}
      >
        <Text style={styles.btnText}>{running ? 'Stop' : 'Start'}</Text>
      </Pressable>
      <Text style={styles.disclaimer}>For wellness reference only. Not a medical device.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f', alignItems: 'center', justifyContent: 'center', padding: 24 },
  center: { flex: 1, backgroundColor: '#0b0b0f', alignItems: 'center', justifyContent: 'center', padding: 24 },
  // Tiny preview: the camera must render for frames to flow, but the user's finger covers it anyway.
  preview: { width: 64, height: 64, borderRadius: 32, marginBottom: 32, overflow: 'hidden' },
  bpm: { color: '#ff4d5e', fontSize: 96, fontWeight: '700' },
  unit: { color: '#9a9aa5', fontSize: 18, letterSpacing: 4, marginBottom: 24 },
  hint: { color: '#d8d8e0', fontSize: 16, textAlign: 'center', marginBottom: 24, minHeight: 44 },
  msg: { color: '#d8d8e0', fontSize: 16, marginBottom: 16 },
  track: { width: '80%', height: 6, backgroundColor: '#23232c', borderRadius: 3, marginBottom: 32, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#ff4d5e' },
  btn: { backgroundColor: '#ff4d5e', paddingVertical: 14, paddingHorizontal: 48, borderRadius: 28 },
  btnStop: { backgroundColor: '#3a3a46' },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  disclaimer: { position: 'absolute', bottom: 32, color: '#6a6a75', fontSize: 12 },
});
