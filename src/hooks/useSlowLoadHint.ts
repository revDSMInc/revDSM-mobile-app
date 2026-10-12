import { useEffect, useState } from 'react';
import { SLOW_UI_HINT_MS } from '../utils/slow-request';

/**
 * True once a load has been running long enough that the rep deserves to be told.
 *
 * ⚠️ A bare spinner is a promise the app cannot keep. On one bar the Deal Center held
 * "Loading calculator..." for two minutes with no message and no way out, which is the
 * complaint this exists to answer. Resets whenever loading restarts.
 */
export const useSlowLoadHint = (loading: boolean, delayMs: number = SLOW_UI_HINT_MS): boolean => {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(t);
  }, [loading, delayMs]);

  return slow;
};
