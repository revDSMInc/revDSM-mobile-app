/**
 * The rep opens their lead on phone 1, then logs in on phone 2. Phone 1 is signed out by the
 * next 401 - and used to go silent: no `work` release and no `session_pause` log, so the portal
 * showed the rep ON SITE at a door they had already left.
 *
 * `src/services/api/index.ts` cannot be loaded here (it pulls in NetInfo via queryClient), so
 * these cover the half that IS pure: that ending the session from a non-UI caller releases BOTH
 * facts, and that a release the dead token cannot complete is queued rather than dropped.
 */
jest.mock('../../src/utils/storage', () => {
  const mem: Record<string, string> = {};
  return {
    Storage: {
      getItem: (k: string) => (k in mem ? mem[k] : null),
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
      removeItem: (k: string) => {
        delete mem[k];
      },
    },
  };
});

const mockEndWorkLead = jest.fn();
jest.mock('../../src/services/api/leads', () => ({
  LeadService: {
    endWorkLead: (id: string) => mockEndWorkLead(id),
  },
}));

const mockPauseLog = jest.fn();
jest.mock('../../src/utils/lead-activity-log', () => ({
  logLeadSessionPause: (u: any, l: any) => mockPauseLog(u, l),
}));

import {
  beginLeadWorkSession,
  endActiveLeadWorkSession,
  getActiveLeadWorkSession,
  setWorkReleaseQueue,
} from '../../src/utils/lead-work-session';

const queued: string[] = [];

beforeEach(() => {
  mockEndWorkLead.mockReset().mockResolvedValue(undefined);
  mockPauseLog.mockReset().mockResolvedValue(undefined);
  queued.length = 0;
  setWorkReleaseQueue((leadId) => {
    queued.push(leadId);
  });
});

const SERVER_LEAD = { _id: '507f1f77bcf86cd799439011', leadId: 'L-900' };

describe('forced sign-out releases the lead the rep still had open', () => {
  it('sends BOTH the pause log and the work release', async () => {
    beginLeadWorkSession(SERVER_LEAD, { _id: 'user-1' });
    expect(getActiveLeadWorkSession()?.leadId).toBe(SERVER_LEAD._id);

    await endActiveLeadWorkSession();

    expect(mockPauseLog).toHaveBeenCalledTimes(1);
    expect(mockEndWorkLead).toHaveBeenCalledWith(SERVER_LEAD._id);
    // Cleared, so a later stale-launch sweep does not release it a second time.
    expect(getActiveLeadWorkSession()).toBeNull();
  });

  it('queues the release when the dead token cannot complete the PUT', async () => {
    mockEndWorkLead.mockRejectedValue({ httpStatus: 401 });
    beginLeadWorkSession(SERVER_LEAD, { _id: 'user-1' });

    await endActiveLeadWorkSession();

    // The 401 that signed us out also kills this PUT - it must survive to the next login.
    expect(queued).toEqual([SERVER_LEAD._id]);
  });

  it('queues an offline-created lead instead of PUTting a client id', async () => {
    beginLeadWorkSession({ _id: 'lead-1792000000-ab12', leadId: 'N/A' }, { _id: 'user-1' });

    await endActiveLeadWorkSession();

    expect(mockEndWorkLead).not.toHaveBeenCalled();
    expect(queued).toEqual(['lead-1792000000-ab12']);
  });

  it('no-ops when the rep had no lead open', async () => {
    await endActiveLeadWorkSession();

    expect(mockPauseLog).not.toHaveBeenCalled();
    expect(mockEndWorkLead).not.toHaveBeenCalled();
    expect(queued).toEqual([]);
  });

  it('does not log a pause for a DEAL session, but still releases it', async () => {
    beginLeadWorkSession(SERVER_LEAD, { _id: 'user-1' }, true);

    await endActiveLeadWorkSession();

    expect(mockPauseLog).not.toHaveBeenCalled();
    expect(mockEndWorkLead).toHaveBeenCalledWith(SERVER_LEAD._id);
  });
});
