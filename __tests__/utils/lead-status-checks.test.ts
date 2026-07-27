/**
 * Web-parity lead status checks (Start / Resume / Review / Preview).
 * Mirrors mhalt-revDSM-sales-frontend/src/sections/map/utils/job-card-utils.js
 * (getJobStatus / getSelfGenJobStatus / getRegularJobStatus) via the mobile
 * dispatch `planStartAppointment` + the supporting predicates.
 */
// planStartAppointment lives in lead-activity-log, which transitively imports
// ChatService/LoggerService/Storage (native deps). None are used by the pure
// dispatch under test, so stub them to keep this a fast unit test.
jest.mock('../../src/services/api/ChatService', () => ({
  __esModule: true,
  default: { createChatForLead: jest.fn() },
}));
jest.mock('../../src/services/api/LoggerService', () => ({ logEvent: jest.fn() }));
jest.mock('../../src/utils/storage', () => ({
  Storage: { setItem: jest.fn(), getItem: jest.fn() },
}));

import {
  isBeforeTimeWindow,
  isWithinTimeWindow,
  isGpsBypassActive,
  isEarlyStartBypassActive,
} from '../../src/utils/location-util';
import { planStartAppointment, logLeadActionClick } from '../../src/utils/lead-activity-log';
import { logEvent } from '../../src/services/api/LoggerService';

const mockedLogEvent = logEvent as jest.Mock;

// GeoJSON coordinates are [lng, lat]
const NYC_COORDS = [-74.006, 40.7128];
const NYC = { latitude: 40.7128, longitude: -74.006 }; // on-site (same point)
const LA = { latitude: 34.0522, longitude: -118.2437 }; // ~2000 mi away → off-site

/** ISO string N days from now (hour-granular scheduled time is derived from leadTime). */
const dayOffset = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

describe('time-window predicates', () => {
  test('isBeforeTimeWindow: true when scheduled is >15 min in the future', () => {
    expect(isBeforeTimeWindow(new Date(Date.now() + 60 * 60 * 1000))).toBe(true);
  });
  test('isBeforeTimeWindow: false when scheduled is in the past', () => {
    expect(isBeforeTimeWindow(new Date(Date.now() - 60 * 60 * 1000))).toBe(false);
  });
  test('isBeforeTimeWindow: false for null', () => {
    expect(isBeforeTimeWindow(null)).toBe(false);
  });

  test('isWithinTimeWindow: true at the scheduled moment', () => {
    expect(isWithinTimeWindow(new Date(Date.now()))).toBe(true);
  });
  test('isWithinTimeWindow: false when >1 hr past', () => {
    expect(isWithinTimeWindow(new Date(Date.now() - 2 * 60 * 60 * 1000))).toBe(false);
  });
  test('isWithinTimeWindow: false when well before window', () => {
    expect(isWithinTimeWindow(new Date(Date.now() + 2 * 60 * 60 * 1000))).toBe(false);
  });
  test('isWithinTimeWindow: false for null', () => {
    expect(isWithinTimeWindow(null)).toBe(false);
  });
});

describe('bypass predicates', () => {
  test('isGpsBypassActive reflects bypass.gpsBypass', () => {
    expect(isGpsBypassActive({ bypass: { gpsBypass: true } })).toBe(true);
    expect(isGpsBypassActive({ bypass: { gpsBypass: false } })).toBe(false);
    expect(isGpsBypassActive({ bypass: {} })).toBe(false);
    expect(isGpsBypassActive({})).toBe(false);
  });
  test('isEarlyStartBypassActive reflects bypass.earlyStart', () => {
    expect(isEarlyStartBypassActive({ bypass: { earlyStart: true } })).toBe(true);
    expect(isEarlyStartBypassActive({ bypass: {} })).toBe(false);
    expect(isEarlyStartBypassActive({})).toBe(false);
  });
});

describe('planStartAppointment — self-generated leads (location only)', () => {
  const base = { leadTime: null, status: 'selfGenerated', location: { coordinates: NYC_COORDS } };

  test('on-site + never checked in → Start (check_in)', () => {
    const plan = planStartAppointment({ ...base, workflowState: 'preview' }, NYC);
    expect(plan.logModule).toBe('lead_check_in');
    expect(plan.shouldCallWork).toBe(true);
  });

  test('off-site + never checked in → Preview (no action, no work)', () => {
    const plan = planStartAppointment({ ...base, workflowState: 'preview' }, LA);
    expect(plan.logModule).toBe('');
    expect(plan.shouldCallWork).toBe(false);
  });

  test('on-site + resume → Resume', () => {
    const plan = planStartAppointment({ ...base, workflowState: 'resume' }, NYC);
    expect(plan.logModule).toBe('lead_resume');
  });

  test('off-site + resume → Review', () => {
    const plan = planStartAppointment({ ...base, workflowState: 'resume' }, LA);
    expect(plan.logModule).toBe('lead_review');
    expect(plan.shouldCallWork).toBe(true);
  });
});

describe('planStartAppointment — regular (issued/LF) leads', () => {
  const coords = { location: { coordinates: NYC_COORDS } };

  test('resume ignores the time window: off-site → Review even before window', () => {
    const lead = { ...coords, status: 'lfLead', leadTime: '9am', leadDate: dayOffset(2), workflowState: 'resume' };
    expect(planStartAppointment(lead, LA).logModule).toBe('lead_review');
  });

  test('resume ignores the time window: on-site → Resume even before window', () => {
    const lead = { ...coords, status: 'lfLead', leadTime: '9am', leadDate: dayOffset(2), workflowState: 'resume' };
    expect(planStartAppointment(lead, NYC).logModule).toBe('lead_resume');
  });

  test('never checked in + before window + on-site → Preview (no action)', () => {
    const lead = { ...coords, status: 'lfLead', leadTime: '9am', leadDate: dayOffset(2), workflowState: 'preview' };
    expect(planStartAppointment(lead, NYC).logModule).toBe('');
  });

  test('never checked in + time passed + on-site → Start (check_in)', () => {
    const lead = { ...coords, status: 'lfLead', leadTime: '9am', leadDate: dayOffset(-2), workflowState: 'preview' };
    expect(planStartAppointment(lead, NYC).logModule).toBe('lead_check_in');
  });

  test('never checked in + off-site → Preview (NEVER Review)', () => {
    const lead = { ...coords, status: 'lfLead', leadTime: '9am', leadDate: dayOffset(-2), workflowState: 'preview' };
    expect(planStartAppointment(lead, LA).logModule).toBe('');
  });

  // Ticket QA criterion: a lead left untouched 5+ hours past appt time with zero
  // check-in must remain "Preview Appointment", NOT "Review". Time NEVER triggers Review.
  test('QA: 5+ hours past appt, zero check-in, off-site → Preview (no action)', () => {
    const scheduled = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago
    const leadTime = `${((scheduled.getHours() + 11) % 12) + 1}${scheduled.getHours() < 12 ? 'am' : 'pm'}`;
    const lead = {
      ...coords,
      status: 'lfLead',
      leadTime,
      leadDate: scheduled.toISOString(),
      workflowState: 'preview',
    };
    const plan = planStartAppointment(lead, LA);
    expect(plan.logModule).toBe(''); // Preview → no check-in/resume/review action
    expect(plan.shouldCallWork).toBe(false);
  });
});

describe('planStartAppointment — manager bypass overrides', () => {
  test('gpsBypass treats a physically off-site lead as on-site → check_in', () => {
    const lead = {
      leadTime: null,
      status: 'selfGenerated',
      workflowState: 'preview',
      location: { coordinates: NYC_COORDS },
      bypass: { gpsBypass: true },
    };
    const plan = planStartAppointment(lead, LA);
    expect(plan.logModule).toBe('lead_check_in');
    expect(plan.isInRange).toBe(true);
  });

  test('earlyStart bypass lets an on-site rep start before the window opens', () => {
    const lead = {
      status: 'lfLead',
      leadTime: '9am',
      leadDate: dayOffset(2),
      workflowState: 'preview',
      location: { coordinates: NYC_COORDS },
      bypass: { earlyStart: true },
    };
    expect(planStartAppointment(lead, NYC).logModule).toBe('lead_check_in');
  });
});

describe('logLeadActionClick — Forever Record bypass meta (web parity)', () => {
  const user = { id: 'u1' };
  const leadWithBypass = {
    _id: 'lead1',
    salesPhotos: [],
    status: 'lfLead',
    leadTime: '9am',
    bypass: {
      gpsBypass: true,
      gpsBypassReason: 'GPS/signal not registering (dead zone, building interference)',
      earlyStart: true,
      earlyStartReason: 'Homeowner requested earlier start, available now',
    },
  };

  beforeEach(() => mockedLogEvent.mockClear());

  test('check-in attaches usedGpsBypass + usedEarlyStartBypass + reasons', async () => {
    await logLeadActionClick(user, 'lead_check_in', leadWithBypass);
    expect(mockedLogEvent).toHaveBeenCalledTimes(1);
    const meta = mockedLogEvent.mock.calls[0][1].meta;
    expect(meta.usedGpsBypass).toBe(true);
    expect(meta.gpsBypassReason).toBe('GPS/signal not registering (dead zone, building interference)');
    expect(meta.usedEarlyStartBypass).toBe(true);
    expect(meta.earlyStartBypassReason).toBe('Homeowner requested earlier start, available now');
  });

  test('resume attaches the bypass meta too', async () => {
    await logLeadActionClick(user, 'lead_resume', leadWithBypass);
    const meta = mockedLogEvent.mock.calls[0][1].meta;
    expect(meta.usedGpsBypass).toBe(true);
    expect(meta.usedEarlyStartBypass).toBe(true);
  });

  test('review carries NO bypass meta (matches web — off-site, no override used)', async () => {
    await logLeadActionClick(user, 'lead_review', leadWithBypass);
    const meta = mockedLogEvent.mock.calls[0][1].meta;
    expect(meta.usedGpsBypass).toBeUndefined();
    expect(meta.usedEarlyStartBypass).toBeUndefined();
  });

  test('no active bypass → no bypass meta on check-in', async () => {
    await logLeadActionClick(user, 'lead_check_in', {
      _id: 'lead2',
      salesPhotos: [],
      status: 'lfLead',
      leadTime: '9am',
    });
    const meta = mockedLogEvent.mock.calls[0][1].meta;
    expect(meta.usedGpsBypass).toBeUndefined();
    expect(meta.usedEarlyStartBypass).toBeUndefined();
  });
});
