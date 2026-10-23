import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Heart, TabIcon, Wave } from './ui';
import { fmtDay, startOfDay } from './storage';

const DAY = 86400000;
const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function History({ t, state, onOpen }) {
  const [selected, setSelected] = useState(startOfDay(Date.now()));
  const today = startOfDay(Date.now());
  const dow = (new Date(today).getDay() + 6) % 7; // Monday = 0
  const week = Array.from({ length: 7 }, (_, i) => today - (dow - i) * DAY);
  const hasData = (d) => state.history.some((r) => r.ts >= d && r.ts < d + DAY);
  const rows = state.history.filter((r) => r.ts >= selected && r.ts < selected + DAY);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 24 }}>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '700', marginBottom: 16 }}>History</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {week.map((d, i) => {
          const on = d === selected;
          return (
            <Pressable key={d} onPress={() => setSelected(d)} style={{ alignItems: 'center', width: 42 }}>
              <Text style={{ color: t.sub, fontSize: 11 }}>{NAMES[i]}</Text>
              <View style={{ width: 34, height: 34, borderRadius: 17, marginTop: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.accent : 'transparent' }}>
                <Text style={{ color: on ? '#fff' : t.text, fontSize: 15, fontWeight: on ? '700' : '400' }}>{new Date(d).getDate()}</Text>
              </View>
              <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 4, backgroundColor: hasData(d) ? t.accent : 'transparent' }} />
            </Pressable>
          );
        })}
      </View>

      <View style={{ marginTop: 18, gap: 10 }}>
        {rows.length === 0 && <Text style={{ color: t.sub, textAlign: 'center', marginTop: 30 }}>No measurements on this day.</Text>}
        {rows.map((r) => (
          <Pressable
            key={r.id}
            onPress={() => onOpen(r)}
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 16, padding: 12, gap: 12 }}
          >
            <Heart size={40} t={t} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>{r.bpm} <Text style={{ fontSize: 11, color: t.sub, fontWeight: '500' }}>BPM</Text></Text>
              <Text style={{ color: t.sub, fontSize: 11 }}>{fmtDay(r.ts)}</Text>
            </View>
            <Wave values={r.wave} width={70} height={28} color={t.accent} />
            <TabIcon name="chevron" color={t.sub} size={16} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
