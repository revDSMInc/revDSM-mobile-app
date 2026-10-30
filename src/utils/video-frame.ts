import { NativeModules } from 'react-native';

export interface FrameRequest {
  url: string;
  /** Milliseconds into the clip. */
  timeStamp: number;
  format: 'jpeg' | 'png';
  maxWidth: number;
  maxHeight: number;
  cacheName: string;
  onlySyncedFrames: boolean;
}

export interface FrameResult {
  path: string;
  width: number;
  height: number;
}

/**
 * Pull one frame out of a video through `react-native-create-thumbnail`'s native module.
 * ⚠️ Do NOT `import 'react-native-create-thumbnail'`: its index.js destructures `NativeModules.CreateThumbnail` at import time,
 * so a binary built before the library was added crashes the whole screen with "Cannot read property 'create' of null".
 * Going through NativeModules here lets the caller show a "rebuild the app" message instead.
 */
export const isFrameExtractorAvailable = (): boolean => !!NativeModules.CreateThumbnail?.create;

export const extractVideoFrame = (req: FrameRequest): Promise<FrameResult> => {
  const mod = NativeModules.CreateThumbnail;
  if (!mod?.create) {
    return Promise.reject(new Error('Frame extraction is not in this build. Rebuild the app (yarn android / yarn ios).'));
  }
  return mod.create(req);
};
