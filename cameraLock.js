// Exposure lock bridge (modules/camera-lock). Older builds lack the native module, so it is optional.
import { requireOptionalNativeModule } from 'expo-modules-core';

const mod = requireOptionalNativeModule('CameraLock');

export const canLockCamera = () => !!mod;

export const setCameraLocked = (locked) => (mod ? mod.setLocked(locked) : Promise.resolve(null));
