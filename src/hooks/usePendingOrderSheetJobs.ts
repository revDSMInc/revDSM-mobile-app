import { useEffect, useState } from 'react';
import { addAnnotationJobListener, getAnnotationJobs } from '../services/annotationSaveService';

const idsFor = (leadId: string | null | undefined): Set<string> => {
  const out = new Set<string>();
  if (!leadId) return out;
  getAnnotationJobs().forEach((j) => {
    if (j.leadId === leadId && j.annotation.mode === 'orderSheet') out.add(String(j.annotation.orderSheetDocumentId));
  });
  return out;
};

/**
 * The order-sheet documents of this lead whose annotation is saved on the phone but not on the server yet (offline, or still
 * uploading). The Job-docs row shows "Syncing..." for these, and never offers a second annotate over one in flight.
 */
export function usePendingOrderSheetJobs(leadId: string | null | undefined): Set<string> {
  const [ids, setIds] = useState(() => idsFor(leadId));
  useEffect(() => {
    setIds(idsFor(leadId));
    return addAnnotationJobListener(() => setIds(idsFor(leadId)));
  }, [leadId]);
  return ids;
}
