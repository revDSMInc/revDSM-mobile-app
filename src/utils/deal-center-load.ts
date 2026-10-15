/**
 * What the online Deal Center load is allowed to conclude from a read that did not answer.
 *
 * ⚠️ The rule these encode, learned three times over in this app: **an unanswered question is
 * not a negative answer.** `isOnline()` is true on one bar of LTE right up to the 15 s timeout,
 * so the online loader runs, every read times out, and the screen concluded "this lead has no
 * appointment and no calculators" - showing a blank calculator over a confirmed rollout that was
 * sitting in the cache the whole time. Worse, the empty branch POSTed a brand-new calculator.
 *
 * The offline branch of `useDynamicCalculators` already does the right thing (it reads the
 * snapshot). These helpers give the ONLINE branch the same discipline.
 */

/** Did the read come back at all, and if so with what? */
export type ReadOutcome =
  /** The server answered and gave us rows. */
  | 'answered-rows'
  /** The server answered and genuinely has nothing. Only this may mint. */
  | 'answered-empty'
  /** Timeout, transport error, 5xx - we never learned anything. */
  | 'unanswered';

export const readOutcome = (input: {
  threw?: boolean;
  rows?: unknown[] | null;
}): ReadOutcome => {
  if (input.threw) return 'unanswered';
  if (Array.isArray(input.rows) && input.rows.length > 0) return 'answered-rows';
  return 'answered-empty';
};

export type DealCenterLoadSource =
  /** Use the rows the server just returned. */
  | 'server'
  /** Use the cached snapshot from a previous good connection. */
  | 'cache'
  /** Genuinely nothing anywhere: create the first calculator on the server. */
  | 'mint'
  /** Nothing to show and nothing proved - keep what is on screen, do not write. */
  | 'hold';

/**
 * ⚠️ `mint` is the only outcome that WRITES. It therefore requires a definite
 * `answered-empty` AND no cached rows. Anything less holds.
 */
export const resolveOnlineLoadSource = (input: {
  outcome: ReadOutcome;
  cachedRows?: number | null;
}): DealCenterLoadSource => {
  const hasCache = (input.cachedRows || 0) > 0;
  if (input.outcome === 'answered-rows') return 'server';
  if (input.outcome === 'unanswered') return hasCache ? 'cache' : 'hold';
  // answered-empty: the server really has nothing for this appointment.
  return hasCache ? 'cache' : 'mint';
};

/**
 * The appointment lookup is a read like any other.
 *
 * ⚠️ `resolveAppointmentId` returns `null` both when a lead truly has no appointment and when
 * every call in it timed out. Only the first may drop the screen into local-only mode; the
 * second must fall back to the cached appointment id so the cached calculators can be shown.
 */
export const resolveAppointmentFallback = (input: {
  resolvedId?: string | null;
  lookupFailed?: boolean;
  cachedAppointmentId?: string | null;
}): { appointmentId: string | null; source: 'server' | 'cache' | 'none' } => {
  const resolved = String(input.resolvedId ?? '').trim();
  if (resolved) return { appointmentId: resolved, source: 'server' };
  const cached = String(input.cachedAppointmentId ?? '').trim();
  if (input.lookupFailed && cached) return { appointmentId: cached, source: 'cache' };
  return { appointmentId: null, source: 'none' };
};

/**
 * May the loader fall through to "local-only mode" (a blank calculator, no cache read)?
 *
 * Only when we actually ASKED and the answer was no appointment, and there is no snapshot.
 */
export const canUseLocalOnlyMode = (input: {
  lookupFailed?: boolean;
  cachedRows?: number | null;
}): boolean => !input.lookupFailed && (input.cachedRows || 0) === 0;
