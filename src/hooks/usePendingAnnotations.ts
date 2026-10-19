import { useEffect, useMemo, useRef, useState } from 'react';
import { uploadQueueManager } from '../utils/uploadQueue';
import { addAnnotationJobListener, getAnnotationJobs } from '../services/annotationSaveService';
import {
  annotationIdentity,
  buildPendingAnnotations,
  type PendingAnnotation,
} from '../utils/pending-annotations';

/** How long a finished upload's card is kept waiting for the server copy to take over. */
const GHOST_MS = 12_000;

/**
 * Annotated photos of this lead that are saved on the device but not on the server yet (jobs + queued uploads).
 *
 * ⚠️ When a NEW annotation finishes uploading its queue item is dropped, but the server card only appears once the
 * lead has refreshed AND the capture hook has rebuilt - a moment later. Dropping the pending card straight away left a
 * gap (the photo vanished, then came back). So a finished upload lingers as a GHOST until the server copy arrives; the
 * view hides it as soon as that card exists (and swaps the image under the SAME React key, so nothing remounts).
 */
export function usePendingAnnotations(leadId: string | null | undefined) {
  const [jobs, setJobs] = useState(() => getAnnotationJobs());
  const [queue, setQueue] = useState(() => uploadQueueManager.getQueue());
  const [ghosts, setGhosts] = useState<PendingAnnotation[]>([]);
  const mounted = useRef(true);
  const prevList = useRef<PendingAnnotation[]>([]);

  useEffect(() => {
    mounted.current = true;
    const offJobs = addAnnotationJobListener(() => setJobs(getAnnotationJobs()));
    const offQueue = uploadQueueManager.addListener(() => setQueue([...uploadQueueManager.getQueue()]));
    setJobs(getAnnotationJobs());
    setQueue([...uploadQueueManager.getQueue()]);
    return () => {
      mounted.current = false;
      offJobs();
      offQueue();
    };
  }, []);

  const list = useMemo(() => buildPendingAnnotations(jobs as any, queue as any, leadId), [jobs, queue, leadId]);

  useEffect(() => {
    const before = prevList.current;
    prevList.current = list;
    const gone = before.filter(
      (p) =>
        p.mode === 'new' &&
        !!p.previewUri &&
        !list.some((l) => annotationIdentity(l.categoryName, l.baseSubcategory) === annotationIdentity(p.categoryName, p.baseSubcategory)),
    );
    if (!gone.length) return;
    const stamped = gone.map((g) => ({ ...g, ghost: true, key: `ghost-${g.key}` }));
    setGhosts((cur) => [
      ...cur.filter((c) => !stamped.some((s) => annotationIdentity(s.categoryName, s.baseSubcategory) === annotationIdentity(c.categoryName, c.baseSubcategory))),
      ...stamped,
    ]);
    setTimeout(() => {
      if (mounted.current) setGhosts((cur) => cur.filter((c) => !stamped.some((s) => s.key === c.key)));
    }, GHOST_MS);
  }, [list]);

  return useMemo(
    () => [
      ...list,
      ...ghosts.filter(
        (g) => !list.some((l) => annotationIdentity(l.categoryName, l.baseSubcategory) === annotationIdentity(g.categoryName, g.baseSubcategory)),
      ),
    ],
    [list, ghosts],
  );
}
