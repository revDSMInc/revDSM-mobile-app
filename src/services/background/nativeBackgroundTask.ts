import { NativeModules, Platform } from 'react-native';

interface BackgroundUploadTaskModule {
  begin(): Promise<boolean>;
  end(): Promise<void>;
  remainingSeconds(): Promise<number>;
}

const getModule = (): BackgroundUploadTaskModule | null => {
  if (Platform.OS !== 'ios') return null;
  return (NativeModules.BackgroundUploadTask as BackgroundUploadTaskModule | undefined) ?? null;
};

export const beginBackgroundGrace = async (): Promise<boolean> => {
  const mod = getModule();
  if (!mod) return false;
  try {
    return await mod.begin();
  } catch (e) {
    console.warn('[background] could not begin a background task', e);
    return false;
  }
};

export const endBackgroundGrace = async (): Promise<void> => {
  const mod = getModule();
  if (!mod) return;
  try {
    await mod.end();
  } catch (e) {
    console.warn('[background] could not end the background task', e);
  }
};

export const remainingGraceSeconds = async (): Promise<number> => {
  const mod = getModule();
  if (!mod) return Number.POSITIVE_INFINITY;
  try {
    return await mod.remainingSeconds();
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};
