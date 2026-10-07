import { ENV } from '../config/env';

const HEALTH_URL = `${ENV.API_URL.replace(/\/+$/, '')}/health`;

export const PROBE_TIMEOUT_MS = 2_000;

export const PROBE_MIN_INTERVAL_MS = 20_000;

let lastProbeAt = 0;
let inFlight: Promise<boolean> | null = null;

let clockSkewMs: number | null = null;

export const getClockSkewMs = (): number | null => clockSkewMs;

export const CLOCK_SKEW_WARN_MS = 5 * 60 * 1000;

export const isClockSkewed = (): boolean =>
  clockSkewMs !== null && Math.abs(clockSkewMs) > CLOCK_SKEW_WARN_MS;

export const probeHealth = async (): Promise<boolean> => {
  if (inFlight) return inFlight;

  const run = (async (): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(HEALTH_URL, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
      });
      if (res.status !== 200) return false;

      const body = await res.json().catch(() => null);
      if (body?.ok !== true) return false; // captive portal, or something else answering

      if (typeof body.ts === 'number') clockSkewMs = body.ts - Date.now();
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
  })();

  inFlight = run;
  return run;
};

export const probeHealthThrottled = async (
  now: number = Date.now()
): Promise<boolean | null> => {
  if (now - lastProbeAt < PROBE_MIN_INTERVAL_MS) return null;
  lastProbeAt = now;
  return probeHealth();
};

export const probeHealthNow = async (): Promise<boolean> => {
  lastProbeAt = Date.now();
  return probeHealth();
};

export const __resetHealthProbe = (): void => {
  lastProbeAt = 0;
  inFlight = null;
  clockSkewMs = null;
};
