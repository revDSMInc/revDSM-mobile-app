import {
  isDeviceLeadId,
  resolvedLeadIdFor,
} from '../../src/utils/lead-id-rekey';

const REAL = '6ae8382cfc35b02ff9263c3c';
const CLIENT = 'lead-1793600795495-ab12';

describe('isDeviceLeadId', () => {
  it('recognises every device-minted prefix', () => {
    ['lead-1', 'appt-1', 'calc-1', 'work-1'].forEach((id) =>
      expect(isDeviceLeadId(id)).toBe(true)
    );
  });

  it('a real ObjectId is not device-minted', () => {
    expect(isDeviceLeadId(REAL)).toBe(false);
  });

  it('is safe on junk', () => {
    expect(isDeviceLeadId(null)).toBe(false);
    expect(isDeviceLeadId(undefined)).toBe(false);
    expect(isDeviceLeadId('')).toBe(false);
    expect(isDeviceLeadId(42)).toBe(false);
  });
});

/**
 * Client: *"I uploaded 3 images in offline, become online and stayed in Lead Center screen —
 * images gone and become 0"*. The header read **Lead ID: N/A**, i.e. a lead created offline whose
 * create had not drained.
 *
 * On reconnect the queues are rekeyed onto the real server id but the OPEN screen kept the client
 * id, so `JobDocsSection`'s `it.leadId === lead?._id` matched nothing and the count fell to 0.
 */
describe('resolvedLeadIdFor', () => {
  it('⚠️ THE REPORTED CASE: adopts the real id once the create lands', () => {
    const work = [{ clientId: CLIENT, serverIds: { leadId: REAL } }];
    expect(resolvedLeadIdFor(CLIENT, work)).toBe(REAL);
  });

  it('matches on the lead payload id too, not only the work clientId', () => {
    const work = [{ clientId: 'work-999', serverIds: { leadId: REAL }, lead: { _id: CLIENT } }];
    expect(resolvedLeadIdFor(CLIENT, work)).toBe(REAL);
  });

  /** ⚠️ A real id is NEVER replaced - that would hijack a synced lead. */
  it('leaves a real server id alone', () => {
    const work = [{ clientId: CLIENT, serverIds: { leadId: 'other-real-id' } }];
    expect(resolvedLeadIdFor(REAL, work)).toBeNull();
  });

  it('waits while the create has not landed yet', () => {
    expect(resolvedLeadIdFor(CLIENT, [{ clientId: CLIENT, serverIds: {} }])).toBeNull();
    expect(resolvedLeadIdFor(CLIENT, [{ clientId: CLIENT }])).toBeNull();
  });

  /** ⚠️ Another lead's work must never rename this screen. */
  it('ignores work for a different lead', () => {
    const work = [{ clientId: 'lead-OTHER', serverIds: { leadId: REAL } }];
    expect(resolvedLeadIdFor(CLIENT, work)).toBeNull();
  });

  it('picks the matching entry out of several', () => {
    const work = [
      { clientId: 'lead-AAA', serverIds: { leadId: 'id-aaa' } },
      { clientId: CLIENT, serverIds: { leadId: REAL } },
      { clientId: 'lead-ZZZ', serverIds: { leadId: 'id-zzz' } },
    ];
    expect(resolvedLeadIdFor(CLIENT, work)).toBe(REAL);
  });

  /** ⚠️ A serverId that is itself a client id is not a resolution. */
  it('refuses a device-minted "server" id', () => {
    const work = [{ clientId: CLIENT, serverIds: { leadId: 'lead-still-local' } }];
    expect(resolvedLeadIdFor(CLIENT, work)).toBeNull();
  });

  it('is a no-op when the ids already agree', () => {
    const work = [{ clientId: CLIENT, serverIds: { leadId: CLIENT } }];
    expect(resolvedLeadIdFor(CLIENT, work)).toBeNull();
  });

  it('accepts a single work object as well as a list', () => {
    expect(resolvedLeadIdFor(CLIENT, { clientId: CLIENT, serverIds: { leadId: REAL } })).toBe(REAL);
  });

  it('is safe on an empty or missing work set', () => {
    expect(resolvedLeadIdFor(CLIENT, [])).toBeNull();
    expect(resolvedLeadIdFor(CLIENT, null)).toBeNull();
    expect(resolvedLeadIdFor(CLIENT, undefined)).toBeNull();
    expect(resolvedLeadIdFor(CLIENT, [null as any, undefined as any])).toBeNull();
  });

  it('is safe when the screen has no id at all', () => {
    const work = [{ clientId: CLIENT, serverIds: { leadId: REAL } }];
    expect(resolvedLeadIdFor(null, work)).toBeNull();
    expect(resolvedLeadIdFor(undefined, work)).toBeNull();
  });

  /** ⚠️ Idempotent: once adopted, the next tick must not keep firing. */
  it('does not resolve again after the id has been adopted', () => {
    const work = [{ clientId: CLIENT, serverIds: { leadId: REAL } }];
    const once = resolvedLeadIdFor(CLIENT, work);
    expect(once).toBe(REAL);
    expect(resolvedLeadIdFor(once, work)).toBeNull();
  });
});

/**
 * ⚠️ THE ORPHANED-PHOTO CASE, found on a real device with two items stuck 9 hours apart.
 *
 * `rekeyLead` runs ONCE, from `offlineLeadStore`, the moment a lead's create lands. A photo
 * queued AFTER that moment - while the open screen still held the client id - is stamped with an
 * id nothing will ever rekey again. `canDrain` refuses a client id, so the item can never upload
 * and is never retried, parked or failed: it just sits there, counted from the queue, with no
 * server row ever arriving. That is the "Manage Photos (0)" report.
 *
 * `uploadQueue.healOrphanedLeadIds` resolves these at drain time using exactly this rule.
 */
describe('resolvedLeadIdFor — healing an orphaned queue item', () => {
  const work = [
    {
      clientId: 'work-1793597890377-pcq9tigns',
      serverIds: { leadId: '6ae821da5a3c8efb33c84bb7' },
    },
    {
      clientId: 'work-1793630913048-z1pvcutrk',
      serverIds: { leadId: '6ae8a2dc4971001114744226' },
    },
  ];

  it('resolves a work- prefixed id stamped on a photo', () => {
    expect(resolvedLeadIdFor('work-1793597890377-pcq9tigns', work)).toBe(
      '6ae821da5a3c8efb33c84bb7'
    );
  });

  it('resolves each stuck id to its own lead, not the first match', () => {
    expect(resolvedLeadIdFor('work-1793630913048-z1pvcutrk', work)).toBe(
      '6ae8a2dc4971001114744226'
    );
  });

  it('leaves a real server id alone, so healing is idempotent', () => {
    expect(resolvedLeadIdFor('6ae821da5a3c8efb33c84bb7', work)).toBeNull();
  });

  it('returns null when the lead has not landed yet, so nothing is drained early', () => {
    expect(resolvedLeadIdFor('work-1793597890377-pcq9tigns', [])).toBeNull();
  });

  it('treats every client prefix as device-minted', () => {
    ['lead-1793000000000-a', 'appt-1793000000000-b', 'calc-1793000000000-c', 'work-1793000000000-d']
      .forEach((id) => expect(isDeviceLeadId(id)).toBe(true));
    expect(isDeviceLeadId('6ae821da5a3c8efb33c84bb7')).toBe(false);
  });
});
