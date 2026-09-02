/**
 * Safe accessor for the native push SDKs.
 *
 * ⚠️ WHY THIS EXISTS. `@notifee/react-native` resolves its native module at
 * IMPORT time and throws when it is missing — the same trap
 * `react-native-document-scanner-plugin` sets, which is why that component cannot
 * be loaded under jest. A static `import` of it therefore takes down every module
 * that transitively imports it.
 *
 * That is not hypothetical: `hooks/useAuth.ts` calls into the push service on
 * logout, so a static chain made SIGN-IN depend on a native module being present.
 * A JS-only reload against a binary built before `yarn add` — which is what every
 * teammate gets when they pull this branch — bricked the app with
 * "Cannot read property 'useAuth' of undefined".
 *
 * Everything native is therefore reached through here, lazily and inside a
 * try/catch. When the modules are unavailable the whole feature degrades to
 * "no push" and the rest of the app is untouched.
 *
 * Cases this covers, all real:
 *   - a JS reload against a stale native binary (needs `yarn android`)
 *   - iOS before GoogleService-Info.plist is added to the Xcode target
 *   - a build where the Firebase config file was never bundled
 */

export interface NativePush {
  app: any;
  messaging: any;
  notifee: any;
  AndroidImportance: any;
  EventType: any;
  AuthorizationStatus: any;
}

let cached: NativePush | null | undefined;

/**
 * Resolves the SDKs once. Returns null — never throws — when they are missing.
 *
 * ⚠️ Callers MUST null-check. That check is the degradation path, not a formality.
 */
export function getNativePush(): NativePush | null {
  if (cached !== undefined) return cached;

  try {
    /* eslint-disable global-require */
    const app = require('@react-native-firebase/app');
    const messaging = require('@react-native-firebase/messaging');
    const notifeeModule = require('@notifee/react-native');
    /* eslint-enable global-require */

    cached = {
      app,
      messaging,
      // Interop: the package ships a default export under CJS.
      notifee: notifeeModule?.default || notifeeModule,
      AndroidImportance: notifeeModule?.AndroidImportance,
      EventType: notifeeModule?.EventType,
      AuthorizationStatus: notifeeModule?.AuthorizationStatus,
    };
  } catch (err: any) {
    console.warn(
      '[Push] native modules unavailable — push is disabled for this build. ' +
        'Rebuild with `yarn android` / `yarn ios` after installing the packages. ' +
        `(${err?.message || err})`
    );
    cached = null;
  }

  return cached;
}

/** True when push can actually run. Cheap after the first call. */
export const isPushAvailable = (): boolean => getNativePush() !== null;
