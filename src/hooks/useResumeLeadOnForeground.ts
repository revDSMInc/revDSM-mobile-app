import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { LeadService } from '../services/api/leads';
import SocketManager from '../services/SocketManager';
import { isOnline } from '../services/connectivity';
import { isClientId } from '../utils/offline-lead-work';
import { getActiveLeadWorkSession } from '../utils/lead-work-session';
import { isForegroundReturn, resumeDecision } from '../utils/lead-session-resume';
import { logLeadActionClick } from '../utils/lead-activity-log';

/**
 * Put the rep back ON SITE when they return to a lead they never left.
 *
 * ⚠️ WHY THIS IS NEEDED. A socket disconnect now PAUSES the work server-side - that is what stops
 * a killed app leaving a lead "ON SITE" on the ops board for ever. But a plain background drops
 * the socket too, so a rep who glances at a text and comes back five seconds later is standing at
 * the same door, looking at the same open lead, while the server has them paused. Nothing else
 * re-asserts it: `useLeadCenterData`'s work call is keyed on `lead._id`/`user._id`, which do not
 * change on a foreground.
 *
 * ⚠️ It logs `lead_resume`, never `lead_check_in`. The rep never left; a second check-in would
 * double-count the visit.
 */
export const useResumeLeadOnForeground = (lead: any, user: any): void => {
  const previousState = useRef<AppStateStatus>(AppState.currentState);
  const backgroundedAt = useRef<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const previous = previousState.current;
      previousState.current = next;

      if (next === 'background') {
        backgroundedAt.current = Date.now();
        return;
      }

      if (!isForegroundReturn(previous, next)) return;

      const since = backgroundedAt.current;
      backgroundedAt.current = null;

      const session = getActiveLeadWorkSession();
      const visibleLeadId = String(lead?._id || lead?.id || '');
      const sessionLeadId = session?.leadId ? String(session.leadId) : '';

      const decision = resumeDecision({
        sessionLeadId,
        visibleLeadId,
        online: isOnline(),
        isOfflineLead: !!sessionLeadId && isClientId(sessionLeadId),
        backgroundedForMs: since ? Date.now() - since : Number.MAX_SAFE_INTEGER,
      });

      if (decision !== 'resume') {
        if (decision !== 'skip-no-session') {
          console.log(`[LeadWork] Foreground resume skipped: ${decision}`);
        }
        return;
      }

      // ⚠️ A slow network can leave one of these in flight while the rep backgrounds again.
      // Re-entering would send a second claim for the same lead.
      if (inFlight.current) return;
      inFlight.current = true;

      const userId = String(user?._id || user?.id || '');
      if (!userId) {
        inFlight.current = false;
        return;
      }

      void (async () => {
        try {
          await LeadService.workLead(sessionLeadId, userId);
          // The watch was dropped with the socket; the pause explicitly left it.
          SocketManager.joinLeadOnsiteWatch(sessionLeadId);
          await logLeadActionClick(user, 'lead_resume', lead);
          console.log(`[LeadWork] Re-claimed ${sessionLeadId} after returning to the foreground.`);
        } catch (e) {
          // Nothing queued on purpose: being ON SITE is a statement about RIGHT NOW. Replaying it
          // later would put the rep at a door they have long since left.
          console.warn('[LeadWork] Foreground resume failed:', e);
        } finally {
          inFlight.current = false;
        }
      })();
    });

    return () => sub.remove();
  }, [lead, user]);
};
