/**
 * Where the "this consent is already filed" record lives on the device.
 *
 * ⚠️ Written the moment a submission SUCCEEDS, online or offline. The whole point is that the
 * fact must outlive the app's ability to ask the server about it - see `consent-filed-log.ts`
 * for the duplicate-signature bug this prevents.
 */
import { readOfflineCache, writeOfflineCache } from '../utils/offline-query-cache';
import { getSessionOwner } from './sessionScope';
import {
  CONSENT_FILED_CACHE,
  addFiledConsent,
  hasFiledLocally,
  removeFiledConsent,
  type FiledConsentEntry,
} from '../utils/consent-filed-log';
import type { ConsentFormKind } from '../utils/consent-forms';

const listeners = new Set<() => void>();

const read = (): FiledConsentEntry[] =>
  readOfflineCache<FiledConsentEntry[]>(CONSENT_FILED_CACHE, { userId: getSessionOwner() })?.data ?? [];

const write = (next: FiledConsentEntry[]): void => {
  writeOfflineCache(CONSENT_FILED_CACHE, next, getSessionOwner());
  listeners.forEach((l) => {
    try {
      l();
    } catch (e) {
      console.warn('[consentFiled] listener threw:', e);
    }
  });
};

export const getFiledConsents = (): FiledConsentEntry[] => read();

export const markConsentFiled = (leadId: string, kind: ConsentFormKind): void => {
  if (!leadId) return;
  write(addFiledConsent(read(), leadId, kind));
};

/** Only for a deliberate reset - never after a failed read. */
export const clearConsentFiled = (leadId: string, kind: ConsentFormKind): void => {
  if (!leadId) return;
  write(removeFiledConsent(read(), leadId, kind));
};

export const isConsentFiledLocally = (leadId: string, kind: ConsentFormKind): boolean =>
  hasFiledLocally(read(), leadId, kind);

export const subscribeConsentFiled = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
