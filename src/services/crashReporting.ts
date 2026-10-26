/**
 * Firebase Crashlytics wrapper. Every call is a no-op when the native module is missing (jest, a build made before the
 * pod/gradle change) and never throws, so reporting can never be the thing that crashes the app.
 *
 * The library installs its own `ErrorUtils` global handler and unhandled-promise-rejection tracking the moment the module
 * loads, so `initCrashReporting()` only has to load it and decide whether collection is on. Native crashes need nothing.
 */
import { Platform } from 'react-native';
import { sanitizeForLog } from '../utils/sanitize-for-log';
import { resolveCrashEnvironment } from '../utils/crash-environment';

type CrashlyticsApi = typeof import('@react-native-firebase/crashlytics');

let api: CrashlyticsApi | null = null;
let instance: any = null;

const load = (): { api: CrashlyticsApi; instance: any } | null => {
  if (api && instance) return { api, instance };
  try {
    // eslint-disable-next-line global-require
    const mod = require('@react-native-firebase/crashlytics') as CrashlyticsApi;
    // eslint-disable-next-line global-require
    const { getApp } = require('@react-native-firebase/app');
    api = mod;
    instance = mod.getCrashlytics(getApp());
    return { api, instance };
  } catch {
    return null;
  }
};

const safe = (fn: (c: { api: CrashlyticsApi; instance: any }) => unknown) => {
  try {
    const c = load();
    if (c) fn(c);
  } catch {
    // Reporting must never throw into app code.
  }
};

const MAX_ATTR = 1000;
const clip = (v: string) => (v.length > MAX_ATTR ? v.slice(0, MAX_ATTR) : v);

/**
 * Release builds report, from production AND non-production backends; every report is tagged with custom keys
 * `environment` (production | non-production), `api_host`, `build` and `platform` so the Firebase console can filter on
 * them. Only a Metro/dev-client build (`__DEV__`) stays out of the dashboard.
 */
export const initCrashReporting = () =>
  safe(({ api: a, instance: i }) => {
    void a.setCrashlyticsCollectionEnabled(i, !__DEV__).catch(() => {});
    let apiUrl = '';
    try {
      // eslint-disable-next-line global-require
      apiUrl = require('../config/env').ENV.API_URL;
    } catch {
      // env missing (tests) - reported as non-production / unknown host.
    }
    const { environment, host } = resolveCrashEnvironment(apiUrl);
    void a
      .setAttributes(i, { environment, api_host: host, build: __DEV__ ? 'debug' : 'release', platform: Platform.OS })
      .catch(() => {});
  });

/** A handled error worth seeing in the dashboard (non-fatal). `context` is sanitized and attached as a breadcrumb first. */
export const recordError = (error: unknown, context?: string, extra?: unknown) =>
  safe(({ api: a, instance: i }) => {
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : safeJson(error));
    if (context) a.log(i, clip(`${context}${extra !== undefined ? ` ${safeJson(sanitizeForLog(extra))}` : ''}`));
    a.recordError(i, err, context);
  });

/** Breadcrumb attached to the next report. Never pass tokens, document payloads or base64. */
export const logBreadcrumb = (message: string) => safe(({ api: a, instance: i }) => a.log(i, clip(message)));

export const setCrashAttribute = (name: string, value: string | null | undefined) =>
  safe(({ api: a, instance: i }) => void a.setAttribute(i, name, clip(value ?? '')).catch(() => {}));

/** Opaque ids only - no email, name or phone. Pass null on logout. */
export const setCrashUser = (user: { id?: string | null; role?: string | null; company?: string | null } | null) =>
  safe(({ api: a, instance: i }) => {
    void a.setUserId(i, user?.id ?? '').catch(() => {});
    void a.setAttributes(i, { role: user?.role ?? '', company: user?.company ?? '' }).catch(() => {});
  });

const safeJson = (v: unknown) => {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

/** Verification helpers for the non-production test panel. Release builds only: collection is off under __DEV__. */
export const sendTestNonFatal = () => recordError(new Error('Crashlytics test: non-fatal error'), 'crashlytics-test');

export const forceTestCrash = () => {
  logBreadcrumb('crashlytics-test: forcing a native crash');
  safe(({ api: a, instance: i }) => a.crash(i));
};
