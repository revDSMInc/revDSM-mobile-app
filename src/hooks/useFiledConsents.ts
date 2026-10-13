import { useEffect, useState } from 'react';
import { getFiledConsents, subscribeConsentFiled } from '../services/consentFiledStore';
import { hasFiledLocally } from '../utils/consent-filed-log';

/**
 * Whether each consent form has already been filed for this lead ON THIS DEVICE.
 *
 * ⚠️ This is the source that survives going offline after an ONLINE submission - the case that
 * let a rep collect a second signature for the same consent.
 */
export const useFiledConsents = (lead: any): { consent: boolean; waiver: boolean } => {
  const [log, setLog] = useState(getFiledConsents);
  useEffect(() => subscribeConsentFiled(() => setLog([...getFiledConsents()])), []);

  const leadId = String(lead?._id || lead?.id || '');
  return {
    consent: hasFiledLocally(log, leadId, 'consent'),
    waiver: hasFiledLocally(log, leadId, 'waiver'),
  };
};
