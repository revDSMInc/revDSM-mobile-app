import { allowsSingleOptionChoice } from '../../src/widgets/components/dynamic-job-builder/OptionToggleField';

/**
 * Scope guard for the deselectable single-option field.
 * "I told you to implement for Fascia only, it's also impacting the other product single
 * values, like Gutter etc" - so this list must stay narrow.
 */
describe('allowsSingleOptionChoice', () => {
  it('allows the Mounting Substrate field', () => {
    expect(allowsSingleOptionChoice('Mounting Substrate')).toBe(true);
  });

  it('ignores case and surrounding spaces, as the schema supplies the label', () => {
    expect(allowsSingleOptionChoice('mounting substrate')).toBe(true);
    expect(allowsSingleOptionChoice('  Mounting Substrate  ')).toBe(true);
  });

  // The regression this exists to prevent: other one-option fields keep the padlock.
  it('does NOT allow other product fields', () => {
    expect(allowsSingleOptionChoice('Gutter')).toBe(false);
    expect(allowsSingleOptionChoice('Gutters')).toBe(false);
    expect(allowsSingleOptionChoice('Track Material')).toBe(false);
    expect(allowsSingleOptionChoice('Soffit')).toBe(false);
    expect(allowsSingleOptionChoice('Fascia')).toBe(false);
  });

  it('is false for a missing or empty label', () => {
    expect(allowsSingleOptionChoice(undefined)).toBe(false);
    expect(allowsSingleOptionChoice('')).toBe(false);
  });
});
