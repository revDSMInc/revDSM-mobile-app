/**
 * useLeadPhotosWithPending — a lead's photos INCLUDING the ones still in the upload queue.
 *
 * ⚠️ The Pitch Book and the Roofline Deck both built their photo list as
 * `fullLeadData?.outcome?.salesPhotos || fullLeadData?.salesPhotos || lead?.salesPhotos || []`,
 * which is the SERVER's list. A photo shot at a door with no signal is not in it — it is in
 * `uploadQueueManager` until it uploads. So the rep captured three inspection photos, saw them in
 * Manage Photos marked "Saved on device", opened the Roofline Deck to present them, and got
 * "No inspection photos available".
 *
 * One hook for both screens so they cannot drift again: the merge rule lives in
 * `utils/pending-inspection-photos.ts` (testable), the queue subscription lives here.
 */

import { useEffect, useMemo, useState } from 'react';
import { uploadQueueManager } from '../utils/uploadQueue';
import { salesPhotosWithPending } from '../utils/pending-inspection-photos';

export function useLeadPhotosWithPending<T extends Record<string, any>>(
  serverPhotos: T[] | null | undefined,
  leadId: string | null | undefined
): Array<T | Record<string, unknown>> {
  const [pending, setPending] = useState(() => uploadQueueManager.getQueue());

  useEffect(() => {
    setPending([...uploadQueueManager.getQueue()]);
    return uploadQueueManager.addListener(() => {
      setPending([...uploadQueueManager.getQueue()]);
    });
  }, []);

  return useMemo(
    () => salesPhotosWithPending(serverPhotos, pending as any, leadId),
    [serverPhotos, pending, leadId]
  );
}
