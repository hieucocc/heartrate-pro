import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BigBpm, Card, Chart, Heart, PrimaryButton, TabIcon, Wave } from './ui';
import { rangeOf } from './theme';
import { fmtDay, startOfDay, stats } from './storage';

const DAY = 86400000;

export default function Home({ t, state, onMeasure, onSettings }) {
  const last = state.history[0];
  const day0 = startOfDay(Date.now());
  const today = state.history.filter((r) => r.ts >= day0);
  const s = stats(today);
  const range = last ? rangeOf(t, last.bpm) : null;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 24 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: t.text, fontSize: 26, fontWeight: '700' }}>Pulse</Text>
        <Pressable onPress={onSettings} hitSlop={12}>
          <TabIcon name="settings" color={t.text} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 24, gap: 20 }}>
        <Heart size={104} t={t} animate={state.settings.animations} />
        <BigBpm t={t} value={last?.bpm} size={64} />
      </View>
      <View style={{ alignItems: 'center', marginTop: 10, minHeight: 20 }}>
        {range && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: range.color }} />
            <Text style={{ color: t.text, fontSize: 14 }}>{range.label}</Text>
          </View>
        )}
      </View>

      <View style={{ alignItems: 'center', marginTop: 8 }}>
        <Wave values={last?.wave} width={330} height={60} color={t.accent} fade />
      </View>
      <Text style={{ color: t.sub, fontSize: 12, textAlign: 'center', marginVertical: 12 }}>
        {last ? `Last Measured • ${fmtDay(last.ts)}` : 'No measurements yet'}
      </Text>

      <PrimaryButton t={t} label="Measure Heart Rate" onPress={onMeasure} icon={<TabIcon name="pulse" color="#fff" size={20} />} />

      <Card t={t} style={{ marginTop: 22 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>Today's Overview</Text>
        </View>
        <Chart
          t={t}
          points={today.map((r) => ({ x: r.ts, y: r.bpm }))}
          xDomain={[day0, day0 + DAY]}
          xLabels={['12AM', '6AM', '12PM', '6PM', '12AM']}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 16 }}>
          <Stat t={t} label="Resting" value={s ? s.min : '--'} />
          <Stat t={t} label="Average" value={s ? s.avg : '--'} />
          <Stat t={t} label="Range" value={s ? `${s.min}-${s.max}` : '--'} />
        </View>
      </Card>
    </ScrollView>
  );
}

const Stat = ({ t, label, value }) => (
  <View style={{ alignItems: 'center' }}>
    <Text style={{ color: t.sub, fontSize: 12 }}>{label}</Text>
    <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', marginTop: 2 }}>
      {value} <Text style={{ color: t.sub, fontSize: 10, fontWeight: '500' }}>BPM</Text>
    </Text>
  </View>
);
