import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { BigBpm, Card, Heart, PrimaryButton, TabIcon, Wave } from './ui';
import { rangeOf } from './theme';
import { ago, fmtDay } from './storage';

// result: the reading; prev: the previous saved reading; saved: viewing an existing history entry.
export default function Result({ t, result, prev, saved, onBack, onSave, onDelete }) {
  const [note, setNote] = useState(result.note || '');
  const range = rangeOf(t, result.bpm);
  const delta = prev ? result.bpm - prev.bpm : null;
  const share = () =>
    Share.share({ message: `My heart rate: ${result.bpm} BPM (${fmtDay(result.ts)}) - measured with Pulse` }).catch(() => {});
  const confirmDelete = () =>
    Alert.alert('Delete measurement?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 60, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' }}>
          <Pressable onPress={onBack} hitSlop={14}>
            <TabIcon name="back" color={t.text} size={26} />
          </Pressable>
          <Pressable onPress={share} hitSlop={14}>
            <TabIcon name="share" color={t.text} size={24} />
          </Pressable>
        </View>

        <View style={{ marginTop: 10 }}>
          <Heart size={84} t={t} />
        </View>
        <View style={{ marginTop: 12 }}>
          <BigBpm t={t} value={result.bpm} size={64} />
        </View>
        <Text style={{ color: t.sub, fontSize: 12, marginTop: 6 }}>
          {fmtDay(result.ts)}
          {result.confidence ? ` • ${result.confidence}% Confidence` : ''}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.soft, paddingVertical: 9, paddingHorizontal: 20, borderRadius: 20, marginTop: 16 }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: range.color }} />
          <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{range.label}</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.soft, borderRadius: 14, padding: 14, marginTop: 18, alignSelf: 'stretch' }}>
          <Heart size={28} t={t} bare />
          <Text style={{ color: t.text, fontSize: 14, flex: 1 }}>{range.text}</Text>
        </View>

        <Card t={t} style={{ alignSelf: 'stretch', marginTop: 14 }}>
          <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>Compared to Previous</Text>
          {prev ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <View>
                <Text style={{ color: delta <= 0 ? t.good : t.amber, fontSize: 22, fontWeight: '700' }}>
                  {delta === 0 ? '=' : delta < 0 ? '↓' : '↑'}{Math.abs(delta)} <Text style={{ fontSize: 11 }}>BPM</Text>
                </Text>
                <Text style={{ color: t.sub, fontSize: 11 }}>{ago(prev.ts)}</Text>
              </View>
              <Wave values={result.wave} width={150} height={44} color={t.accent} />
            </View>
          ) : (
            <Text style={{ color: t.sub, fontSize: 13, marginTop: 8 }}>This is your first measurement.</Text>
          )}
        </Card>

        {result.hrv && (
          <Card t={t} style={{ alignSelf: 'stretch', marginTop: 14 }}>
            <Text style={{ color: t.text, fontSize: 14, fontWeight: '600', marginBottom: 8 }}>Heart Rate Variability</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              {[['SDNN', result.hrv.sdnn, 'ms'], ['RMSSD', result.hrv.rmssd, 'ms'], ['pNN50', result.hrv.pnn50, '%']].map(([l, v, u]) => (
                <View key={l} style={{ alignItems: 'center' }}>
                  <Text style={{ color: t.sub, fontSize: 11 }}>{l}</Text>
                  <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{v}<Text style={{ fontSize: 10, color: t.sub }}> {u}</Text></Text>
                </View>
              ))}
            </View>
            <Text style={{ color: t.sub, fontSize: 10, marginTop: 8 }}>Estimated from camera pulses; approximate.</Text>
          </Card>
        )}

        <Text style={{ color: t.text, fontSize: 13, fontWeight: '500', alignSelf: 'flex-start', marginTop: 18, marginBottom: 6 }}>Note (Optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          editable={!saved}
          placeholder="Add a note..."
          placeholderTextColor={t.sub}
          style={{ alignSelf: 'stretch', backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.line, padding: 12, color: t.text, fontSize: 14 }}
        />

        <View style={{ alignSelf: 'stretch', marginTop: 22 }}>
          {saved ? (
            <PrimaryButton t={t} label="Delete" onPress={confirmDelete} />
          ) : (
            <PrimaryButton t={t} label="Save to History" onPress={() => onSave(note.trim())} />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
