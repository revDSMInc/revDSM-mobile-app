import {
  calculatorLogTitle,
  isFullPackageTitle,
} from '../../src/utils/activity-log/calculator-log-title';

describe('isFullPackageTitle', () => {
  it('recognises the box marker the tab prepends', () => {
    expect(isFullPackageTitle('📦 +G+Versa+S+FWrap+Light')).toBe(true);
  });

  it('a plain tab name is not a package', () => {
    expect(isFullPackageTitle('FWrap+Light (SM)')).toBe(false);
    expect(isFullPackageTitle('')).toBe(false);
    expect(isFullPackageTitle(null)).toBe(false);
  });
});

describe('calculatorLogTitle — the log must match the tab chip', () => {
  /**
   * ⚠️ THE REPORTED CASE, verbatim from the client's DevTools payload:
   * `"calculatorTitle": "📦 +G+Versa+S+FWrap+Light+Light Misc"` while the chip read
   * `+Light+Light Misc`.
   */
  it('sends what the rep sees, not the stored expansion', () => {
    expect(calculatorLogTitle('📦 +G+Versa+S+FWrap+Light+Light Misc')).toBe(
      '📦 +Light+Light Misc'
    );
  });

  it('drops every key the cube glyph already stands for, keeping the glyph', () => {
    expect(calculatorLogTitle('📦 +G+VMax+S+FWrap+Light')).toBe('📦 +Light');
    expect(calculatorLogTitle('📦 +G+Guard+S+FWrap+Light')).toBe('📦 +Light');
    expect(calculatorLogTitle('📦 +G+SpecGuard+S+FWrap+Light')).toBe('📦 +Light');
  });

  /** ⚠️ The rank is the only thing separating two packages quoted at different prices. */
  it('keeps the size rank, which the chip also shows', () => {
    expect(calculatorLogTitle('📦 +G+Versa+S+FWrap+Light (LG)')).toBe('📦 +Light (LG)');
    expect(calculatorLogTitle('📦 +G+Versa+S+FWrap+Light+Light Misc (XXL-2)')).toBe(
      '📦 +Light+Light Misc (XXL-2)'
    );
  });

  /** A bare package is the glyph ALONE on the chip, and that is what goes out. */
  it('sends the glyph alone for a package with no extras', () => {
    expect(calculatorLogTitle('📦 +G+Versa+S+FWrap')).toBe('📦');
    expect(calculatorLogTitle('📦 +G+Versa+S+FWrap (SM)')).toBe('📦 (SM)');
  });

  /** ⚠️ A non-package name is already what the rep sees — it must pass through. */
  it('leaves an ordinary tab name alone', () => {
    expect(calculatorLogTitle('FWrap+Light (SM)')).toBe('FWrap+Light (SM)');
    expect(calculatorLogTitle('Gutters only')).toBe('Gutters only');
  });

  it('strips the duplicate-warning glyphs the old sanitizer stripped', () => {
    expect(calculatorLogTitle('⚠️ FWrap+Light (LG) ⚠️')).toBe('FWrap+Light (LG)');
  });

  it('strips the literal words a freshly created tab carries', () => {
    expect(calculatorLogTitle('New Tab')).toBe('');
  });

  it('is safe on junk', () => {
    expect(calculatorLogTitle('')).toBe('');
    expect(calculatorLogTitle(null)).toBe('');
    expect(calculatorLogTitle(undefined)).toBe('');
  });

  /**
   * ⚠️ The glyph is the package MARKER and must survive every path - without it a package
   * reads as an ordinary tab that happens to carry those extras.
   */
  it('always keeps the box glyph on a package', () => {
    [
      '📦 +G+Versa+S+FWrap+Light+Light Misc',
      '📦 +G+Versa+S+FWrap (LG)',
      '📦 +G+Versa+S+FWrap',
    ].forEach((t) => expect(calculatorLogTitle(t)).toMatch(/\u{1F4E6}/u));
  });

  /** ⚠️ ...and never adds one to a tab that is not a package. */
  it('never adds a glyph to an ordinary tab', () => {
    expect(calculatorLogTitle('FWrap+Light (SM)')).not.toMatch(/\u{1F4E6}/u);
  });

  it('is idempotent — re-logging an already-formatted title does not strip it again', () => {
    const once = calculatorLogTitle('📦 +G+Versa+S+FWrap+Light+Light Misc');
    expect(calculatorLogTitle(once)).toBe(once);
  });
});
