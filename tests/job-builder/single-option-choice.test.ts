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


/**
 * Client: *"if we saved nothing by default Fascia should be unselected, you can see currently it's
 * selected by default"*.
 *
 * `OptionToggleField` used to SEED the lone option of the clearable field once per option list, so
 * opening Lighting on a job with nothing saved showed Fascia already chosen under Mounting
 * Substrate - a value the rep never picked, which then reads as their answer downstream.
 *
 * The component itself cannot be rendered here (it imports React Native - CLAUDE.md section 6), so
 * this pins the RULE the effect now follows. The branch is chosen by `allowsSingleOptionChoice`:
 *
 *   canClear === true   -> never seeded; an empty value stays empty
 *   canClear === false  -> lone option still PINNED (imposed by the schema)
 */
describe('seeding a single-option field', () => {
  /** The rule as implemented: seed only when the field is NOT clearable. */
  const seedsLoneOption = (label?: string): boolean => !allowsSingleOptionChoice(label);

  it('⚠️ never seeds Mounting Substrate — nothing saved means nothing selected', () => {
    expect(seedsLoneOption('Mounting Substrate')).toBe(false);
  });

  /** ⚠️ The padlocked fields must KEEP their imposed value - this ticket must not reach them. */
  it('still pins the lone option on padlocked fields', () => {
    ['Gutter', 'Gutters', 'Track Material', 'Soffit', 'Fascia'].forEach((label) => {
      expect(seedsLoneOption(label)).toBe(true);
    });
  });

  it('an unlabelled field keeps the padlocked behaviour', () => {
    expect(seedsLoneOption(undefined)).toBe(true);
    expect(seedsLoneOption('')).toBe(true);
  });
});
