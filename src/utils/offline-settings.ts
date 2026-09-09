/**
 * offline-settings.ts — the rules for a rep default set with no signal.
 *
 * "Set as Default" on the rollout writes a USER preference
 * (`PUT /company/user/update-default-lf-calculator-settings`), and offline both halves of it were
 * broken, not just the write:
 *
 *   1. the PUT failed, so nothing was saved; and
 *   2. the toggle's own state is derived from `user.defaultPaymentMethod`, which is only ever
 *      refreshed FROM THE SERVER — so the switch could not move, and the rep tapped it again.
 *
 * So the fix is a local override that the UI reads immediately, plus a pending write replayed on
 * reconnect. Replay is free: this is a whole-value PUT of a preference, so sending it twice lands
 * the same state.
 *
 * ⚠️ `null` IS A VALUE HERE. `defaultPaymentMethod: null` means "clear my default", which is a
 * different instruction from "I did not touch this". Every rule below therefore tests for the KEY
 * BEING PRESENT, never for truthiness — a `if (patch.defaultPaymentMethod)` would silently turn
 * every clear into a no-op, and the rep's toggle would spring back on at the next refresh.
 *
 * Pure and RN-free so the rules are testable; `services/offlineSettings` is the storage and replay.
 */

export interface PendingCalculatorSettings {
  /** The plan key, or `null` to clear. Absent when untouched. */
  defaultPaymentMethod?: string | null;
  /** The pre-order percentage, or `null` to clear. Absent when untouched. */
  defaultPercentage?: number | null;
  updatedAt: string;
}

export type CalculatorSettingsPatch = Omit<Partial<PendingCalculatorSettings>, 'updatedAt'>;

const FIELDS = ['defaultPaymentMethod', 'defaultPercentage'] as const;

/**
 * Fold a new choice into what is already waiting.
 *
 * Per FIELD, last write wins — the two settings are independent, so setting a default discount
 * must not drop a pending payment-method change made a minute earlier.
 */
export const mergePendingSettings = (
  current: PendingCalculatorSettings | null | undefined,
  patch: CalculatorSettingsPatch,
  now: number = Date.now()
): PendingCalculatorSettings => {
  const next: PendingCalculatorSettings = { ...(current || {}), updatedAt: new Date(now).toISOString() };
  FIELDS.forEach((f) => {
    if (Object.prototype.hasOwnProperty.call(patch, f)) {
      (next as any)[f] = (patch as any)[f];
    }
  });
  return next;
};

/** The request body — only the fields actually chosen, `null`s included. */
export const pendingSettingsPayload = (
  pending: PendingCalculatorSettings | null | undefined
): CalculatorSettingsPatch => {
  const out: CalculatorSettingsPatch = {};
  FIELDS.forEach((f) => {
    if (pending && Object.prototype.hasOwnProperty.call(pending, f)) {
      (out as any)[f] = (pending as any)[f];
    }
  });
  return out;
};

export const hasPendingSettings = (pending: PendingCalculatorSettings | null | undefined): boolean =>
  Object.keys(pendingSettingsPayload(pending)).length > 0;

/**
 * Lay the rep's un-synced choice over a user record.
 *
 * ⚠️ Applied on EVERY read of the user, including straight after a `getMe`. Without that, any
 * refresh — a reconnect, a screen that calls `refreshUser`, a relaunch — would serve the server's
 * older value and the toggle would visibly flip back to what the rep just changed it away from.
 * The override stops mattering the moment the pending write lands and is cleared.
 */
export const applyPendingSettingsToUser = <T extends Record<string, any>>(
  user: T | null | undefined,
  pending: PendingCalculatorSettings | null | undefined
): T | null | undefined => {
  if (!user || !hasPendingSettings(pending)) return user;
  return { ...user, ...pendingSettingsPayload(pending) } as T;
};
