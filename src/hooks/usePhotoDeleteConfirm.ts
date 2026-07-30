import { useCallback, useState } from 'react';

/**
 * Confirm-then-delete for a photo tile's ✕.
 *
 * Deleting a shot is destructive twice over — it drops the local capture AND the S3
 * object behind it (`DELETE installer/v1/{jobId}/images`) — and on a phone held with
 * gloves at arm's length, a 20 px button is easy to hit by accident. So the ✕ opens a
 * dialog rather than acting, and the dialog stays up with a spinner until the request
 * settles, because "did that delete or not?" is the worst state to leave an installer
 * in when they are about to walk out of signal.
 *
 * Shared across the material, PEC and CoC steps so all three behave identically; only
 * the target shape and the wording differ.
 *
 * `remove` must not reject — the JobDetail handlers already swallow API failures and
 * log them, since the photo is gone from the installer's screen either way. `finally`
 * clears the dialog regardless, so a throw can't strand it in a permanent spinner.
 */
export function usePhotoDeleteConfirm<T>(remove: (target: T) => void | Promise<void>) {
  const [target, setTarget] = useState<T | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** Tapping the ✕ — opens the dialog, does nothing else. */
  const request = useCallback((next: T) => setTarget(next), []);

  /** Ignored mid-request, so the dialog can't be dismissed out from under the spinner. */
  const cancel = useCallback(() => {
    if (deleting) return;
    setTarget(null);
  }, [deleting]);

  const confirm = useCallback(async () => {
    if (!target || deleting) return;
    setDeleting(true);
    try {
      await remove(target);
    } finally {
      setDeleting(false);
      setTarget(null);
    }
  }, [target, deleting, remove]);

  return { target, visible: !!target, deleting, request, cancel, confirm };
}
