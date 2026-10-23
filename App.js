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
import { PulseEngine } from './ppg';

const MEASURE_SECONDS = 25;

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [{ videoResolution: { width: 640, height: 480 } }, { fps: 30 }]);
  const [running, setRunning] = useState(false);
  const [bpm, setBpm] = useState(null);
  const [fingerOn, setFingerOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const [hrv, setHrv] = useState(null);
  const engine = useRef(new PulseEngine());
  const latest = useRef(null);
  const measureStart = useRef(null);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // Called from the frame processor thread at camera rate; keep it cheap.
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

  // Poll the engine twice a second for UI updates.
  useEffect(() => {
    if (!running) return undefined;
    engine.current.reset();
    latest.current = null;
    measureStart.current = null;
    const id = setInterval(() => {
      const s = latest.current;
      if (!s) return;
      setFingerOn(s.finger);
      if (s.state === 0) measureStart.current = null;
      else if (measureStart.current === null) measureStart.current = Date.now();
      const secs = measureStart.current ? (Date.now() - measureStart.current) / 1000 : 0;
      setElapsed(secs);
      if (s.bpm) setBpm(s.bpm);
      if (secs >= MEASURE_SECONDS && s.bpm) {
        setHrv(engine.current.hrv());
        setRunning(false);
        setDone(true);
      }
    }, 500);
    return () => clearInterval(id);
  }, [running]);

  const start = () => {
    setBpm(null);
    setHrv(null);
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
      ? 'Hold your finger still...'
      : 'Cover the camera AND the flash with your fingertip.';

  return (
    <View style={styles.container}>
      <Camera
        style={styles.preview}
        device={device}
        format={format}
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
      {done && hrv && (
        <Text style={styles.hrv}>
          SDNN {hrv.sdnn} ms · RMSSD {hrv.rmssd} ms · pNN50 {hrv.pnn50}%
        </Text>
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
  hrv: { color: '#9a9aa5', fontSize: 14, marginBottom: 24 },
  msg: { color: '#d8d8e0', fontSize: 16, marginBottom: 16 },
  track: { width: '80%', height: 6, backgroundColor: '#23232c', borderRadius: 3, marginBottom: 32, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#ff4d5e' },
  btn: { backgroundColor: '#ff4d5e', paddingVertical: 14, paddingHorizontal: 48, borderRadius: 28 },
  btnStop: { backgroundColor: '#3a3a46' },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  disclaimer: { position: 'absolute', bottom: 32, color: '#6a6a75', fontSize: 12 },
});
