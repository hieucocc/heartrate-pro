// Apple Health bridge. The native module only exists in builds made after react-native-health was added,
// so every call checks for it first.
import { NativeModules, Platform } from 'react-native';

const kit = Platform.OS === 'ios' ? NativeModules.AppleHealthKit : null;

export const healthAvailable = () => !!kit;

const call = (fn, ...args) =>
  new Promise((resolve, reject) => {
    if (!kit) return reject(new Error('Apple Health is not available in this build'));
    kit[fn](...args, (err, res) => (err ? reject(new Error(String(err.message || err))) : resolve(res)));
  });

export const requestHealth = () =>
  call('initHealthKit', { permissions: { read: ['HeartRate'], write: ['HeartRate'] } });

export const saveHeartRate = (bpm, ts) => {
  const date = new Date(ts).toISOString();
  return call('saveHeartRateSample', { value: bpm, startDate: date, endDate: date });
};
