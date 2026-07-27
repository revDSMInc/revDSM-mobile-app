import { countAppliedMapFilters } from '../../src/widgets/modals/MapFiltersModal';
import type { FilterState } from '../../src/widgets/modals/MapFiltersModal';

const base: FilterState = {
  jobNumber: '',
  sortOrder: 'date-desc',
  radius: 0,
  minPrice: '',
  maxPrice: '',
  startDate: null,
  endDate: null,
  myJobsOnly: false,
  isFavoriteOnly: false,
  isReferralOnly: false,
  isHeatMap: false,
  showRoute: false,
  showProduct: true,
};

describe('countAppliedMapFilters', () => {
  test('counts nothing on a fresh filter set', () => {
    expect(countAppliedMapFilters(base)).toBe(0);
  });

  test('handles a missing filter object', () => {
    expect(countAppliedMapFilters(null)).toBe(0);
    expect(countAppliedMapFilters(undefined)).toBe(0);
  });

  test('min price + max price + date range counts 3', () => {
    expect(
      countAppliedMapFilters({
        ...base,
        minPrice: '22',
        maxPrice: '255',
        startDate: new Date('2026-01-01').toISOString(),
        endDate: new Date('2026-02-01').toISOString(),
      })
    ).toBe(3);
  });

  test('max price + date range counts 2', () => {
    expect(
      countAppliedMapFilters({
        ...base,
        maxPrice: '255',
        startDate: new Date('2026-01-01').toISOString(),
      })
    ).toBe(2);
  });

  test('counts each of distance, favourites and location', () => {
    expect(
      countAppliedMapFilters({
        ...base,
        radius: 5,
        isFavoriteOnly: true,
        centerCoords: { latitude: 27.95, longitude: -82.45 },
      })
    ).toBe(3);
  });

  test('a geocoded location counts once, not twice', () => {
    // The modal writes the typed text into `jobNumber` for both search modes,
    // so a location search sets the text AND the coords.
    expect(
      countAppliedMapFilters({
        ...base,
        jobNumber: '123 Main St, Tampa, FL',
        centerCoords: { latitude: 27.95, longitude: -82.45 },
      })
    ).toBe(1);
  });

  test('a job-number search counts once', () => {
    expect(countAppliedMapFilters({ ...base, jobNumber: 'J-4821' })).toBe(1);
  });

  test('whitespace-only text is not a filter', () => {
    expect(countAppliedMapFilters({ ...base, jobNumber: '   ', minPrice: ' ' })).toBe(0);
  });

  test('display toggles are not counted (web parity)', () => {
    expect(
      countAppliedMapFilters({ ...base, showProduct: true, showRoute: true, isHeatMap: true })
    ).toBe(0);
  });

  // 6, not 7: the location text and its coords are one filter, so the maximum
  // reachable count is location + distance + min + max + dates + favourites.
  test('everything at once counts 6', () => {
    expect(
      countAppliedMapFilters({
        ...base,
        centerCoords: { latitude: 27.95, longitude: -82.45 },
        jobNumber: 'Tampa, FL',
        radius: 10,
        minPrice: '100',
        maxPrice: '9000',
        startDate: new Date('2026-01-01').toISOString(),
        endDate: new Date('2026-02-01').toISOString(),
        isFavoriteOnly: true,
      })
    ).toBe(6);
  });
});
