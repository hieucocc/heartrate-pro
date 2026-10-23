import React from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Heart, TabIcon } from './ui';

const Section = ({ t, title, children }) => (
  <>
    <Text style={{ color: t.sub, fontSize: 13, fontWeight: '600', marginTop: 22, marginBottom: 8, marginLeft: 4 }}>{title}</Text>
    <View style={{ backgroundColor: t.card, borderRadius: 16, overflow: 'hidden' }}>{children}</View>
  </>
);

const Row = ({ t, label, sub, right, onPress, last, disabled }) => (
  <Pressable
    onPress={onPress}
    disabled={!onPress}
    style={{
      flexDirection: 'row', alignItems: 'center', padding: 14, minHeight: 52, opacity: disabled ? 0.5 : 1,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: t.line,
    }}
  >
    <View style={{ flex: 1 }}>
      <Text style={{ color: t.text, fontSize: 15 }}>{label}</Text>
      {sub ? <Text style={{ color: t.sub, fontSize: 11, marginTop: 2 }}>{sub}</Text> : null}
    </View>
    {right}
  </Pressable>
);

export default function Settings({ t, state, onChange, onClear }) {
  const s = state.settings;
  const sw = (key) => (
    <Switch value={s[key]} onValueChange={(v) => onChange({ ...s, [key]: v })} trackColor={{ true: t.accent }} />
  );
  const soon = <Text style={{ color: t.sub, fontSize: 12 }}>Coming soon</Text>;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 24 }}>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '700' }}>Settings</Text>

      <View style={{ marginTop: 16, backgroundColor: t.card, borderRadius: 16, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, opacity: 0.6 }}>
          <Heart size={36} t={t} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 15 }}>Health Integration</Text>
            <Text style={{ color: t.sub, fontSize: 11 }}>Sync with Apple Health</Text>
          </View>
          {soon}
        </View>
      </View>

      <Section t={t} title="Reminders">
        <Row t={t} label="Heart Rate Reminder" right={soon} disabled />
        <Row t={t} label="Remind Me" right={<Text style={{ color: t.sub, fontSize: 13 }}>Every Day, 9 AM</Text>} last disabled />
      </Section>

      <Section t={t} title="Preferences">
        <Row t={t} label="Haptics" right={sw('haptics')} />
        <Row t={t} label="Animations" right={sw('animations')} />
        <Row
          t={t}
          label="Privacy & Data"
          right={<TabIcon name="chevron" color={t.sub} size={16} />}
          onPress={() =>
            Alert.alert('Privacy & Data', 'Your measurements are stored only on this device. Nothing is uploaded.', [
              { text: 'OK' },
              {
                text: 'Delete all data',
                style: 'destructive',
                onPress: () =>
                  Alert.alert('Delete all data?', 'All saved measurements will be removed.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: onClear },
                  ]),
              },
            ])
          }
        />
        <Row
          t={t}
          label="About Pulse"
          right={<TabIcon name="chevron" color={t.sub} size={16} />}
          last
          onPress={() =>
            Alert.alert('Pulse', 'Version 1.0.0\n\nCamera-based heart rate measurements are for wellness tracking and are not a substitute for medical evaluation.')
          }
        />
      </Section>
    </ScrollView>
  );
}
