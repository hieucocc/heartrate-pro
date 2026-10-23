import { useColorScheme } from 'react-native';

const light = {
  dark: false, bg: '#F6F6F9', card: '#FFFFFF', text: '#15151B', sub: '#8A8A95',
  accent: '#FF3355', soft: '#FFE9EE', line: '#EDEDF1', good: '#22B861', blue: '#4C8DFF', amber: '#FF9500',
};
const dark = {
  dark: true, bg: '#0B0B0F', card: '#17171D', text: '#F5F5F7', sub: '#9A9AA5',
  accent: '#FF4D6A', soft: '#2B1A20', line: '#26262E', good: '#34D27A', blue: '#6AA3FF', amber: '#FFAA33',
};

export const useTheme = () => (useColorScheme() === 'dark' ? dark : light);

export const rangeOf = (t, bpm) =>
  bpm < 60
    ? { label: 'Low Range', color: t.blue, text: 'Your heart rate is below the typical resting range of 60-100 BPM.' }
    : bpm > 100
      ? { label: 'High Range', color: t.amber, text: 'Your heart rate is above the typical resting range of 60-100 BPM.' }
      : { label: 'Normal Range', color: t.good, text: 'Your heart rate is within a normal range.' };
