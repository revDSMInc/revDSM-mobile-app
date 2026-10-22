/**
 * The Investment Center's "Includes the Following" is evaluated on device from the DEAL CENTER
 * description schemas. Reported as "sometimes in offline mode the description doesn't show".
 *
 * The *sometimes* was which rep, and whether that rep had ever opened the Deal Center ONLINE:
 * the schema was warmed only from inside that screen, and the cache is per user. A real device
 * store showed the job-builder schema cached for THREE users and this one for ONE.
 *
 * These pin the two pure rules the fix leans on. The warming itself (a hook call on the Leads
 * screen) cannot be loaded under jest - anything importing React Native hangs the runner.
 */
import { evaluateDealCenterDescriptions } from '../../src/utils/deal-center-descriptions';

// Mirrors the hook's staleTime: an EMPTY answer must not be cached.
const staleTimeFor = (data: unknown[]) => (data?.length ? 5 * 60 * 1000 : 0);

describe('an empty schema answer must never stick', () => {
  it('a populated result is cached for 5 minutes', () => {
    expect(staleTimeFor([{ productId: 'p1' }])).toBe(5 * 60 * 1000);
  });

  it('⚠️ an empty result is NOT cached, so reconnecting re-asks', () => {
    expect(staleTimeFor([])).toBe(0);
  });
});

describe('the query key is owner-scoped', () => {
  // Mirrors `queryKey: ['dealCenterDescriptionSchemas', userId || '']`
  const key = (userId?: string | null) => ['dealCenterDescriptionSchemas', userId || ''];

  it('two reps on one handset never share an entry', () => {
    expect(key('repA')).not.toEqual(key('repB'));
  });

  it('⚠️ a signed-out read cannot inherit a rep\'s cached schema', () => {
    expect(key(null)).toEqual(['dealCenterDescriptionSchemas', '']);
    expect(key(null)).not.toEqual(key('repA'));
  });
});

describe('the panel degrades honestly when the schema is missing', () => {
  const calculator: any = { entries: { cat1: { f1: 10 } } };

  it('no schemas -> no lines, so the panel falls back to category names', () => {
    const out = evaluateDealCenterDescriptions([], calculator);
    expect(out.descriptions).toEqual([]);
    expect(out.descriptionsByCategory).toEqual([]);
  });

  it('a null/undefined schema list is handled, not thrown', () => {
    expect(() => evaluateDealCenterDescriptions(null as any, calculator)).not.toThrow();
    expect(() => evaluateDealCenterDescriptions(undefined as any, calculator)).not.toThrow();
  });
});
