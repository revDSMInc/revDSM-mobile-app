/**
 * capture-location.ts — a shared, short-lived GPS fix.
 *
 * ⚠️ Why a photo's coordinates must be taken AT CAPTURE, not at upload.
 *
 * `uploadQueue.uploadItem` fetches `getCurrentPosition` immediately before the PUT and stamps that
 * onto the image metadata. Online those are the same place, so nobody noticed. Offline they are
 * not: a photo shot at a customer's house and uploaded hours later from the office is filed with
 * the OFFICE's coordinates. The record then says the rep documented a roof from a car park, which
 * is wrong on a document that can end up in a claim.
 *
 * The honest value is where the rep stood when the shutter fired. That is knowable only then, so
 * it is captured then and carried on the queue item.
 *
 * Extracted from `services/api/LoggerService.ts`, which had this cache for a different reason (a
 * uniform pre-POST delay so logs arrive in fire order). Both callers want the same thing — a fast
 * fix that does not power up GPS per call — so they now share one, and one warm-up serves both.
 */

import Geolocation from 'react-native-geolocation-service';

export interface Coords {
  latitude: number;
  longitude: number;
}

/** How long a fix is reused. Matches `LoggerService`'s original window. */
export const LOCATION_TTL_MS = 60_000;

let cached: { latitude: number; longitude: number; at: number } | null = null;

/** The last fix, however old — for callers that prefer a stale answer to none. */
export const lastKnownCoords = (): Coords | null =>
  cached ? { latitude: cached.latitude, longitude: cached.longitude } : null;

/**
 * A recent fix, or null.
 *
 * ⚠️ Never rejects and never blocks longer than the timeout. A photo must be capturable with
 * location denied, GPS off, or indoors with no fix — losing the shot because the OS could not
 * place it would be a far worse failure than filing it without coordinates.
 *
 * Low accuracy with a generous `maximumAge` on purpose: the OS hands back a cached fix straight
 * away instead of spinning up the GPS radio, which is what keeps the shutter responsive.
 */
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

/**
 * Warm the cache so the next read is instant.
 *
 * Called when a capture surface opens: the fix lands while the rep is still framing the shot, so
 * `getCaptureCoords` answers from cache at the moment of the tap rather than making the queue
 * wait on the radio.
 */
export const warmCaptureCoords = (): void => {
  void getCaptureCoords();
};

/** Test seam. */
export const __resetCaptureCoordsCache = (): void => {
  cached = null;
};
