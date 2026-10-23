import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StatusBar, Text, View } from 'react-native';
import { useTheme } from './theme';
import { TabIcon } from './ui';
import { load, save } from './storage';
import Home from './Home';
import Trends from './Trends';
import History from './History';
import Settings from './Settings';
import Measure from './Measure';
import Result from './Result';

const TABS = [
  ['home', 'Home'],
  ['trends', 'Trends'],
  ['history', 'History'],
  ['settings', 'Settings'],
];

export default function App() {
  const t = useTheme();
  const [state, setState] = useState(null);
  const [tab, setTab] = useState('home');
  const [measuring, setMeasuring] = useState(false);
  const [result, setResult] = useState(null); // {reading, saved}

  useEffect(() => {
    load().then(setState);
  }, []);

  const update = useCallback((fn) => {
    setState((s) => {
      const next = fn(s);
      save(next);
      return next;
    });
  }, []);

  const onDone = useCallback((reading) => {
    setMeasuring(false);
    setResult({ reading, saved: false });
  }, []);

  if (!state) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const body = {
    home: <Home t={t} state={state} onMeasure={() => setMeasuring(true)} onSettings={() => setTab('settings')} />,
    trends: <Trends t={t} state={state} />,
    history: <History t={t} state={state} onOpen={(r) => setResult({ reading: r, saved: true })} />,
    settings: (
      <Settings
        t={t}
        state={state}
        onChange={(settings) => update((s) => ({ ...s, settings }))}
        onClear={() => update((s) => ({ ...s, history: [] }))}
      />
    ),
  }[tab];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar barStyle={t.dark ? 'light-content' : 'dark-content'} />
      <View style={{ flex: 1, paddingTop: 54 }}>{body}</View>

      <View
        style={{
          flexDirection: 'row', backgroundColor: t.card, borderTopWidth: 1, borderTopColor: t.line,
          paddingTop: 8, paddingBottom: 26,
        }}
      >
        {TABS.map(([key, label]) => {
          const on = tab === key;
          return (
            <Pressable key={key} onPress={() => setTab(key)} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
              <TabIcon name={key} color={on ? t.accent : t.sub} />
              <Text style={{ fontSize: 10, color: on ? t.accent : t.sub, fontWeight: on ? '600' : '400' }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Modal visible={measuring} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setMeasuring(false)}>
        {measuring && <Measure haptics={state.settings.haptics} onClose={() => setMeasuring(false)} onDone={onDone} />}
      </Modal>

      <Modal visible={!!result} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setResult(null)}>
        {result && (
          <View style={{ flex: 1, backgroundColor: t.bg }}>
            <Result
              t={t}
              result={result.reading}
              saved={result.saved}
              prev={
                result.saved
                  ? state.history[state.history.findIndex((r) => r.id === result.reading.id) + 1]
                  : state.history[0]
              }
              onBack={() => setResult(null)}
              onSave={(note) => {
                update((s) => ({ ...s, history: [{ ...result.reading, id: String(result.reading.ts), note }, ...s.history] }));
                setResult(null);
                setTab('home');
              }}
              onDelete={() => {
                update((s) => ({ ...s, history: s.history.filter((r) => r.id !== result.reading.id) }));
                setResult(null);
              }}
            />
          </View>
        )}
      </Modal>
    </View>
  );
}
