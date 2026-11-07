import {
  downloadsBeforeRowReady,
  warmOrderForPairs,
} from '../../src/utils/warm-queue-order';

const runs = [
  { before: 'b1', after: 'a1' },
  { before: 'b2', after: 'a2' },
  { before: 'b3', after: 'a3' },
  { before: 'b4', after: 'a4' },
];

describe('warmOrderForPairs', () => {
  it('finishes a row before starting the next one', () => {
    expect(warmOrderForPairs(runs)).toEqual([
      'b1', 'a1', 'b2', 'a2', 'b3', 'a3', 'b4', 'a4',
    ]);
  });

  it('keeps the row order it was given', () => {
    const out = warmOrderForPairs([{ after: 'newest' }, { after: 'older' }]);
    expect(out).toEqual(['newest', 'older']);
  });

  it('drops empty urls and never queues the same picture twice', () => {
    const out = warmOrderForPairs([
      { before: '', after: 'a1' },
      { before: 'a1', after: '  ' },
      { before: null, after: undefined },
    ]);
    expect(out).toEqual(['a1']);
  });

  it('survives no rows at all', () => {
    expect(warmOrderForPairs(null)).toEqual([]);
    expect(warmOrderForPairs([])).toEqual([]);
  });
});

/**
 * The regression: the OLD order was every before, then every after. The first run could not be
 * opened until almost everything had downloaded, which is what the client saw.
 */
describe('downloadsBeforeRowReady', () => {
  it('makes the first run openable after one batch', () => {
    expect(downloadsBeforeRowReady(runs, 0, 3)).toBe(1);
  });

  it('is much worse under the old column-first order', () => {
    // Simulates the old loop: all befores, then all afters.
    const columnFirst = [
      { before: 'b1' }, { before: 'b2' }, { before: 'b3' }, { before: 'b4' },
      { after: 'a1' }, { after: 'a2' }, { after: 'a3' }, { after: 'a4' },
    ];
    const order = warmOrderForPairs(columnFirst);
    // run 1 needs b1 (first) AND a1 (fifth) -> waits for 5 downloads, not 2.
    expect(order.indexOf('a1')).toBe(4);
  });

  it('counts both pictures of the row, not just one', () => {
    expect(downloadsBeforeRowReady([{ before: 'b1', after: 'a1' }], 0, 1)).toBe(2);
  });

  it('is zero for a row with no pictures', () => {
    expect(downloadsBeforeRowReady([{}], 0)).toBe(0);
    expect(downloadsBeforeRowReady(runs, 99)).toBe(0);
  });
});
