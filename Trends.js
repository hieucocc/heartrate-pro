import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Card, Chart, Segmented, BigBpm } from './ui';
import { startOfDay, stats } from './storage';

const DAY = 86400000;
const PERIODS = { Day: 1, Week: 7, Month: 30, Year: 365 };

function ticks(period, from, to) {
  const n = 5;
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(from + ((to - from) * i) / (n - 1));
    if (period === 'Day') return d.toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '');
    if (period === 'Year') return d.toLocaleDateString([], { month: 'short' });
    return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
  });
}

export default function Trends({ t, state }) {
  const [period, setPeriod] = useState('Day');
  const days = PERIODS[period];
  const to = period === 'Day' ? startOfDay(Date.now()) + DAY : Date.now();
  const from = period === 'Day' ? to - DAY : to - days * DAY;
  const inRange = state.history.filter((r) => r.ts >= from && r.ts <= to);
  const prevRange = state.history.filter((r) => r.ts >= from - days * DAY && r.ts < from);
  const s = stats(inRange);
  const p = stats(prevRange);

  let insight = 'Take a few measurements to see insights here.';
  if (s && p) {
    const diff = s.avg - p.avg;
    insight =
      diff === 0
        ? `Your average is the same as the previous ${period.toLowerCase()}.`
        : `Your average is ${Math.abs(diff)} BPM ${diff < 0 ? 'lower' : 'higher'} than the previous ${period.toLowerCase()}.`;
  } else if (s) {
    insight = `Your lowest reading was ${s.min} BPM and your highest was ${s.max} BPM.`;
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 24 }}>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '700', marginBottom: 16 }}>Trends</Text>
      <Segmented t={t} options={Object.keys(PERIODS)} value={period} onChange={setPeriod} />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 }}>
        <View>
          <Text style={{ color: t.sub, fontSize: 12 }}>Average</Text>
          <BigBpm t={t} value={s?.avg} size={38} />
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: t.sub, fontSize: 12 }}>Range</Text>
          <BigBpm t={t} value={s ? `${s.min}-${s.max}` : null} size={38} />
        </View>
      </View>

      <View style={{ marginTop: 14 }}>
        <Chart
          t={t}
          points={inRange.map((r) => ({ x: r.ts, y: r.bpm }))}
          xDomain={[from, to]}
          xLabels={ticks(period, from, to)}
          height={140}
        />
      </View>

      <Card t={t} style={{ marginTop: 22, backgroundColor: t.soft }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 20 }}>{'💡'}</Text>
          <Text style={{ color: t.text, fontSize: 14, flex: 1 }}>{insight}</Text>
        </View>
      </Card>

      <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', marginTop: 22 }}>Key Insights</Text>
      <Text style={{ color: t.sub, fontSize: 13, marginTop: 6 }}>
        {inRange.length} measurement{inRange.length === 1 ? '' : 's'} in this period.
        {s ? ` Resting rate (lowest): ${s.min} BPM.` : ''}
      </Text>
    </ScrollView>
  );
}
