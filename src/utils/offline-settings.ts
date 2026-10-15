export interface PendingCalculatorSettings {
  defaultPaymentMethod?: string | null;
  defaultPercentage?: number | null;
  /** REVUIUX-444: the rep's 1 Year Program default plan key (sibling of `defaultPaymentMethod`, never a reuse of it). */
  defaultOneYearPaymentMethod?: string | null;
  updatedAt: string;
}

export type CalculatorSettingsPatch = Omit<Partial<PendingCalculatorSettings>, 'updatedAt'>;

const FIELDS = ['defaultPaymentMethod', 'defaultPercentage', 'defaultOneYearPaymentMethod'] as const;

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

export const applyPendingSettingsToUser = <T extends Record<string, any>>(
  user: T | null | undefined,
  pending: PendingCalculatorSettings | null | undefined
): T | null | undefined => {
  if (!user || !hasPendingSettings(pending)) return user;
  return { ...user, ...pendingSettingsPayload(pending) } as T;
};
