import Geolocation from 'react-native-geolocation-service';

export interface Coords {
  latitude: number;
  longitude: number;
}

export const LOCATION_TTL_MS = 60_000;

let cached: { latitude: number; longitude: number; at: number } | null = null;

export const lastKnownCoords = (): Coords | null =>
  cached ? { latitude: cached.latitude, longitude: cached.longitude } : null;

export const getCaptureCoords = (): Promise<Coords | null> =>
  new Promise((resolve) => {
    if (cached && Date.now() - cached.at < LOCATION_TTL_MS) {
      resolve({ latitude: cached.latitude, longitude: cached.longitude });
      return;
    }
    Geolocation.getCurrentPosition(
      (pos) => {
        cached = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          at: Date.now(),
        };
        resolve({ latitude: cached.latitude, longitude: cached.longitude });
      },
      (err) => {
        console.warn('[captureLocation] no fix:', err?.message || err);
        resolve(lastKnownCoords());
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: LOCATION_TTL_MS }
    );
  });

export const warmCaptureCoords = (): void => {
  void getCaptureCoords();
};

export const __resetCaptureCoordsCache = (): void => {
  cached = null;
};
