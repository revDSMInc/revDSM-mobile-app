import { useEffect, useState } from 'react';
import { getOfflineWork, subscribeOfflineWork } from '../services/offlineLeadStore';
import { hasPendingConsent, hasQueuedConsent } from '../utils/offline-lead-work';

/**
 * Has the customer signed a consent / roof waiver this device is still holding?
 *
 * ⚠️ Shared by the Tools list and the tool-action guard on purpose. Those two disagreeing is not a
 * cosmetic bug: the card would show **Already Generated** while tapping it re-opened a blank form
 * for a customer who had just signed one — which is precisely what QA reported on the pair of
 * screenshots for this ticket.
 *
 * The Investment Center reads the same rule for its own gate (`hasQueuedConsent`); it keeps its
 * bespoke wiring because it also folds in a `localConsentSigned` flag this hook has no business
 * knowing about.
 */
export const useQueuedConsentForms = (
  lead: any
): { consent: boolean; waiver: boolean; consentPending: boolean; waiverPending: boolean } => {
  const [work, setWork] = useState(getOfflineWork);
  useEffect(() => subscribeOfflineWork(() => setWork([...getOfflineWork()])), []);

  const leadId = String(lead?._id || lead?.id || '');
  return {
    consent: hasQueuedConsent(work, leadId, 'consent'),
    waiver: hasQueuedConsent(work, leadId, 'waiver'),
    // Signed here and not filed yet — what tapping the card reports on.
    consentPending: hasPendingConsent(work, leadId, 'consent'),
    waiverPending: hasPendingConsent(work, leadId, 'waiver'),
  };
};
