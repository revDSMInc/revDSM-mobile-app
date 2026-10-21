/**
 * console-noise.ts - a dropped connection is not an app crash.
 *
 * `console.error` raises React Native's red LogBox screen over the whole app in dev (and is reported as an error), so every
 * `catch (e) { console.error('Failed to ...', e) }` turned "I walked into a lift" into a full-screen "Console Error ...
 * Network Error". There are hundreds of those catches; this is the one global rule: an error call whose payload is a TRANSPORT
 * failure (no HTTP answer: Network Error / timeout / aborted / no internet) is logged quietly instead. A real server answer
 * (a 500 with a body) still goes through `console.error` untouched.
 *
 * Pure so it can be tested; installed once from index.js.
 */

const TRANSPORT_RE =
  /network error|network request failed|timeout of \d+\s?ms exceeded|\btimed? ?out\b|econnaborted|err_network|etimedout|enotfound|unable to resolve host|software caused connection abort|failed to connect|no internet/i;

const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');

const isTransportShape = (v: any): boolean => {
  if (!v) return false;
  if (typeof v === 'string') return TRANSPORT_RE.test(v);
  if (typeof v !== 'object') return false;
  // A server answer is never transport noise, whatever its message says.
  if (typeof v.httpStatus === 'number' || typeof v.response?.status === 'number' || typeof v.status === 'number') return false;
  return (
    v.code === 'ECONNABORTED' ||
    v.code === 'ERR_NETWORK' ||
    v.code === 'ETIMEDOUT' ||
    TRANSPORT_RE.test(textOf(v.message)) ||
    TRANSPORT_RE.test(textOf(v.error))
  );
};

/** True when every error-like argument of a `console.error` call is a transport failure (and at least one is). */
export const isTransportNoise = (args: unknown[]): boolean => {
  const errorLike = args.filter((a) => a && (typeof a === 'object' || (typeof a === 'string' && TRANSPORT_RE.test(a))));
  return errorLike.length > 0 && errorLike.some(isTransportShape) && !errorLike.some((a: any) => typeof a === 'object' && !isTransportShape(a));
};

let installed = false;

/** Wraps `console.error` once. Call AFTER React Native has installed LogBox (i.e. from index.js). */
export const installNetworkErrorDowngrade = (target: Console = console): void => {
  if (installed) return;
  installed = true;
  const original = target.error.bind(target);
  target.error = (...args: unknown[]) => {
    if (isTransportNoise(args)) {
      target.log('[network]', ...args);
      return;
    }
    original(...args);
  };
};
