import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Polyline, Stop } from 'react-native-svg';

const HEART =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

// Heart with an ECG line, on a soft circle.
export function Heart({ size = 48, t, bare = false, animate = false }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!animate) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.1, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 650, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, scale]);
  const icon = (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24">
        <Path d={HEART} fill={t.accent} />
        <Polyline points="5.5,12 8.5,12 10,8.5 12.5,15.5 14,12 18.5,12" fill="none" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  );
  if (bare) return icon;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}>
      {icon}
    </View>
  );
}

function smooth(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const mx = (p.x + c.x) / 2;
    d += ` C${mx},${p.y} ${mx},${c.y} ${c.x},${c.y}`;
  }
  return d;
}

let uid = 0;

// Axis chart: points are {x, y} in data space.
export function Chart({ t, points, xDomain, yDomain = [40, 120], yTicks = [120, 80, 40], xLabels = [], height = 110 }) {
  const [w, setW] = useState(0);
  const id = useRef(`g${uid++}`).current;
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const px = (x) => ((x - x0) / (x1 - x0)) * w;
  const py = (y) => height - ((Math.min(y1, Math.max(y0, y)) - y0) / (y1 - y0)) * height;
  const pts = [...points].sort((a, b) => a.x - b.x).map((p) => ({ x: px(p.x), y: py(p.y) }));
  const line = smooth(pts);
  const last = pts[pts.length - 1];
  return (
    <View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 30, height, justifyContent: 'space-between' }}>
          {yTicks.map((v) => (
            <Text key={v} style={{ fontSize: 11, color: t.sub }}>{v}</Text>
          ))}
        </View>
        <View style={{ flex: 1, height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {w > 0 && (
            <Svg width={w} height={height}>
              <Defs>
                <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={t.accent} stopOpacity="0.22" />
                  <Stop offset="1" stopColor={t.accent} stopOpacity="0" />
                </LinearGradient>
              </Defs>
              {yTicks.map((v) => (
                <Path key={v} d={`M0,${py(v)} L${w},${py(v)}`} stroke={t.line} strokeWidth={1} />
              ))}
              {pts.length > 1 && <Path d={`${line} L${last.x},${height} L${pts[0].x},${height} Z`} fill={`url(#${id})`} />}
              {pts.length > 1 && <Path d={line} stroke={t.accent} strokeWidth={2} fill="none" strokeLinecap="round" />}
              {last && <Circle cx={last.x} cy={last.y} r={4} fill={t.accent} stroke={t.card} strokeWidth={2} />}
            </Svg>
          )}
          {points.length === 0 && (
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: t.sub, fontSize: 13 }}>No measurements yet</Text>
            </View>
          )}
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginLeft: 30, marginTop: 6 }}>
        {xLabels.map((l, i) => (
          <Text key={i} style={{ fontSize: 10, color: t.sub }}>{l}</Text>
        ))}
      </View>
    </View>
  );
}

// Plain wave line from a list of numbers (no axes).
export function Wave({ values, width, height, color, fade = false }) {
  const id = useRef(`w${uid++}`).current;
  const v = values && values.length > 1 ? values : null;
  if (!v) return <View style={{ width, height }} />;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((y, i) => ({ x: (i / (v.length - 1)) * width, y: height - 4 - ((y - lo) / span) * (height - 8) }));
  const d = smooth(pts);
  return (
    <Svg width={width} height={height}>
      {fade && (
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.25" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </LinearGradient>
        </Defs>
      )}
      {fade && <Path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />}
      <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

export function Ring({ size, stroke, progress, color, track }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${c * Math.min(1, Math.max(0.01, progress))} ${c}`}
        rotation="-90"
        origin={`${size / 2},${size / 2}`}
      />
    </Svg>
  );
}

export function TabIcon({ name, color, size = 24 }) {
  const p = { stroke: color, strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'home' && <Path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" {...p} fill={color} fillOpacity={0.15} />}
      {name === 'trends' && <Path d="M5 20v-8M12 20V5M19 20v-5" {...p} strokeWidth={2.6} />}
      {name === 'history' && (
        <>
          <Circle cx="12" cy="12" r="8.5" {...p} />
          <Path d="M12 7v5l3 2" {...p} />
        </>
      )}
      {name === 'settings' && (
        <>
          <Circle cx="12" cy="12" r="3" {...p} />
          <Path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" {...p} />
        </>
      )}
      {name === 'close' && <Path d="M6 6l12 12M18 6L6 18" {...p} strokeWidth={2} />}
      {name === 'back' && <Path d="M15 5l-7 7 7 7" {...p} strokeWidth={2} />}
      {name === 'chevron' && <Path d="M9 5l7 7-7 7" {...p} strokeWidth={2} />}
      {name === 'share' && <Path d="M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" {...p} />}
      {name === 'pulse' && <Polyline points="2,12 7,12 9.5,6 14,18 16.5,12 22,12" {...p} strokeWidth={2} />}
      {name === 'bolt' && <Path d="M13 3L5 14h6l-1 7 8-11h-6z" {...p} fill={color} />}
    </Svg>
  );
}

export const Card = ({ t, style, children }) => (
  <View style={[{ backgroundColor: t.card, borderRadius: 18, padding: 16 }, style]}>{children}</View>
);

export function Segmented({ t, options, value, onChange }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.dark ? '#1E1E26' : '#E9E9EE', borderRadius: 10, padding: 3 }}>
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onChange(o)}
          style={{ flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center', backgroundColor: o === value ? t.card : 'transparent' }}
        >
          <Text style={{ color: t.text, fontSize: 13, fontWeight: o === value ? '600' : '400' }}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const BigBpm = ({ t, value, size = 56 }) => (
  <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
    <Text style={{ color: t.text, fontSize: size, fontWeight: '700', lineHeight: size * 1.05 }}>{value ?? '--'}</Text>
    <Text style={{ color: t.sub, fontSize: size * 0.28, fontWeight: '600', marginLeft: 6, marginBottom: size * 0.12 }}>BPM</Text>
  </View>
);

export const PrimaryButton = ({ t, label, onPress, icon }) => (
  <Pressable
    onPress={onPress}
    style={{ backgroundColor: t.accent, borderRadius: 26, paddingVertical: 15, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}
  >
    {icon}
    <Text style={{ color: '#fff', fontSize: 17, fontWeight: '600' }}>{label}</Text>
  </Pressable>
);
