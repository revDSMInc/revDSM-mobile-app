import { getJobSummaryItems, getAvailableSteps } from '../../src/utils/job-builder-util';

describe('getJobSummaryItems', () => {
  test('returns empty array for null/empty data', () => {
    expect(getJobSummaryItems(null)).toEqual([]);
    expect(getJobSummaryItems({})).toEqual([]);
  });

  test('detects gutter items from inputs', () => {
    const items = getJobSummaryItems({ inputs: { gutter6Ft1: '50' } });
    expect(items.some((i: any) => i.category === 'Gutters')).toBe(true);
  });

  test('detects gutter items from extras', () => {
    const items = getJobSummaryItems({ extras: { wedges: '10' } });
    expect(items.some((i: any) => i.category === 'Gutters')).toBe(true);
  });

  test('detects LeafFilter items from inputs', () => {
    const items = getJobSummaryItems({ inputs: { versa6Ft1: '30' } });
    expect(items.some((i: any) => i.category === 'LeafFilter')).toBe(true);
  });

  test('detects Soffit items', () => {
    const items = getJobSummaryItems({ extras: { vinylSoffit: '20' } });
    expect(items.some((i: any) => i.category === 'Soffit')).toBe(true);
  });

  test('detects Fascia items', () => {
    const items = getJobSummaryItems({ extras: { trimWrap: '15' } });
    expect(items.some((i: any) => i.category === 'Fascia')).toBe(true);
  });

  test('detects Lighting items from extras', () => {
    const items = getJobSummaryItems({ extras: { lighting1stStory: '10' } });
    expect(items.some((i: any) => i.category === 'Lighting')).toBe(true);
  });

  test('detects Lighting items from root', () => {
    const items = getJobSummaryItems({ lightingControlBox: '1' });
    expect(items.some((i: any) => i.category === 'Lighting')).toBe(true);
  });

  test('detects Additional items', () => {
    const items = getJobSummaryItems({ inputs: { extraLabor: '5' } });
    expect(items.some((i: any) => i.category === 'Additional')).toBe(true);
  });

  test('detects ckToInstallers as Additional', () => {
    const items = getJobSummaryItems({ inputs: { ckToInstallers: '20' } });
    expect(items.some((i: any) => i.category === 'Additional')).toBe(true);
  });
});

describe('getAvailableSteps', () => {
  test('returns all 7 steps for complete data', () => {
    const data = {
      inputs: { gutter6Ft1: '50', versa6Ft1: '30' },
      extras: { vinylSoffit: '20', trimWrap: '15', lighting1stStory: '10' },
    };
    const steps = getAvailableSteps(data);
    expect(steps.length).toBe(7);
  });

  test('locks categories not present in data', () => {
    const data = { inputs: { gutter6Ft1: '50' } };
    const steps = getAvailableSteps(data);
    const gutterStep = steps.find((s: any) => s.category === 'gutter');
    const lfStep = steps.find((s: any) => s.category === 'leaffilter');
    expect(gutterStep.isLocked).toBe(false);
    expect(lfStep.isLocked).toBe(true);
  });

  test('misc and summary steps are always unlocked', () => {
    const steps = getAvailableSteps({});
    const misc = steps.find((s: any) => s.category === 'additional');
    const summary = steps.find((s: any) => s.category === 'summary');
    expect(misc.isLocked).toBe(false);
    expect(summary.isLocked).toBe(false);
  });

  test('steps are in order: gutter, leaffilter, soffit, fascia, lighting, additional, summary', () => {
    const steps = getAvailableSteps({});
    expect(steps[0].category).toBe('gutter');
    expect(steps[1].category).toBe('leaffilter');
    expect(steps[2].category).toBe('soffit');
    expect(steps[3].category).toBe('fascia');
    expect(steps[4].category).toBe('lighting');
    expect(steps[5].category).toBe('additional');
    expect(steps[6].category).toBe('summary');
  });
});
