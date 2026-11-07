import { countQueuedFrames, reviewTileSize } from '../../src/utils/camera-video';

const slot = (key: string) => ({ target: { kind: 'slot', key } });
const extra = { target: { kind: 'extra' } };

describe('countQueuedFrames', () => {
  it('counts only frames tagged to this slot', () => {
    expect(countQueuedFrames([slot('a'), slot('b'), slot('a')], 'a')).toBe(2);
  });

  it('does not count an Extra as a slot', () => {
    expect(countQueuedFrames([extra, slot('a')], 'a')).toBe(1);
  });

  it('is safe on nothing and on junk', () => {
    expect(countQueuedFrames(null, 'a')).toBe(0);
    expect(countQueuedFrames(undefined, 'a')).toBe(0);
    expect(countQueuedFrames([{ target: null }, null as any], 'a')).toBe(0);
  });
});

describe('reviewTileSize', () => {
  it('fits two columns inside the gutters on an iPhone', () => {
    const { width } = reviewTileSize(390);
    expect(width).toBe(167);
    expect(width * 2 + 8 + 48).toBeLessThanOrEqual(390);
  });

  it('keeps the mockup frame ratio', () => {
    const { width, height } = reviewTileSize(390);
    expect(height / width).toBeCloseTo(948 / 804, 2);
  });

  it('never returns a zero tile, which is what an empty grid looks like', () => {
    expect(reviewTileSize(0).width).toBeGreaterThan(0);
    expect(reviewTileSize(0).height).toBeGreaterThan(0);
  });
});
