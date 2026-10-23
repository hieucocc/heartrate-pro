import React from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Heart, TabIcon } from './ui';
import { healthAvailable, requestHealth } from './health';

// [setting value, icon, label]
const THEMES = [
  ['system', 'system', 'System'],
  ['light', 'sun', 'Light'],
  ['dark', 'moon', 'Dark'],
];

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
  const toggleHealth = async (on) => {
    if (!on) return onChange({ ...s, health: false });
    try {
      await requestHealth();
      onChange({ ...s, health: true });
    } catch (e) {
      Alert.alert('Apple Health', `Could not connect: ${e.message}`);
    }
  };
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 24 }}>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '700' }}>Settings</Text>

      <View style={{ marginTop: 16, backgroundColor: t.card, borderRadius: 16, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          <Heart size={36} t={t} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 15 }}>Apple Health</Text>
            <Text style={{ color: t.sub, fontSize: 11 }}>
              {healthAvailable() ? 'Save each measurement to Health' : 'Needs the latest app build'}
            </Text>
          </View>
          <Switch value={s.health} onValueChange={toggleHealth} trackColor={{ true: t.accent }} disabled={!healthAvailable()} />
        </View>
      </View>

      <Section t={t} title="Appearance">
        <View style={{ flexDirection: 'row', padding: 6, gap: 6 }}>
          {THEMES.map(([key, icon, label]) => {
            const on = s.theme === key;
            return (
              <Pressable
                key={key}
                onPress={() => onChange({ ...s, theme: key })}
                style={{
                  flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 12,
                  backgroundColor: on ? t.soft : 'transparent',
                }}
              >
                <TabIcon name={icon} color={on ? t.accent : t.sub} size={22} />
                <Text style={{ color: on ? t.accent : t.text, fontSize: 13, fontWeight: on ? '600' : '400' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

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
            Alert.alert('Pulse', 'Version 1.0.0\nMade by @hieucocc\n\nCamera-based heart rate measurements are for wellness tracking and are not a substitute for medical evaluation.')
          }
        />
      </Section>

      <Pressable onPress={() => Linking.openURL('https://github.com/hieucocc')} style={{ alignItems: 'center', marginTop: 28 }}>
        <Text style={{ color: t.sub, fontSize: 12 }}>
          Made with <Text style={{ color: t.accent }}>♥</Text> by <Text style={{ color: t.text, fontWeight: '600' }}>@hieucocc</Text>
        </Text>
        <Text style={{ color: t.sub, fontSize: 11, marginTop: 4 }}>Pulse v1.0.0</Text>
      </Pressable>
    </ScrollView>
  );
}
