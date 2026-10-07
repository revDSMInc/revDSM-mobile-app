import { useCallback, useState } from 'react';

export function usePhotoDeleteConfirm<T>(remove: (target: T) => void | Promise<void>) {
  const [target, setTarget] = useState<T | null>(null);
  const [deleting, setDeleting] = useState(false);

  const request = useCallback((next: T) => setTarget(next), []);

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
