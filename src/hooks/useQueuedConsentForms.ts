import { useEffect, useState } from 'react';
import { getOfflineWork, subscribeOfflineWork } from '../services/offlineLeadStore';
import { hasPendingConsent, hasQueuedConsent } from '../utils/offline-lead-work';

export const useQueuedConsentForms = (
  lead: any
): { consent: boolean; waiver: boolean; consentPending: boolean; waiverPending: boolean } => {
  const [work, setWork] = useState(getOfflineWork);
  useEffect(() => subscribeOfflineWork(() => setWork([...getOfflineWork()])), []);

  const leadId = String(lead?._id || lead?.id || '');
  return {
    consent: hasQueuedConsent(work, leadId, 'consent'),
    waiver: hasQueuedConsent(work, leadId, 'waiver'),
    consentPending: hasPendingConsent(work, leadId, 'consent'),
    waiverPending: hasPendingConsent(work, leadId, 'waiver'),
  };
};
