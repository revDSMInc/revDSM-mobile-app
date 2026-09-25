/**
 * Ticket 1063 — the "keep Preview honest" rule for a `dropdown`, as a pure
 * function.
 *
 * A dropdown's configured default must be written into JOB STATE, not merely
 * resolved at render time: other fields' `optionVisibility` rules read
 * `state[field.id]`, so a render-only default is invisible to them and rules
 * their options out. The mirror case is a selection whose option the config no
 * longer offers (a field this one depends on changed), which must be cleared.
 *
 * It lives here rather than inside `DropdownField` so it can be tested — a
 * component cannot be loaded under jest in this repo (React 19 test-renderer
 * shim: `render` returns no queries), but a pure rule can.
 */

export type DropdownSync = { write: false } | { write: true; value: string };

const NO_WRITE: DropdownSync = { write: false };

export function resolveDropdownSync(params: {
  /** Options remaining after `getVisibleFieldOptions` (already rule-filtered). */
  options?: string[];
  /** Current value from job state. */
  value?: any;
  /** Output of `resolveEffectiveDefaultValue` — '' when no default applies. */
  defaultValue?: string;
  isMulti?: boolean;
  /** View-only render: never write to job state. */
  readOnly?: boolean;
  /** `field.disabled` — accepted for symmetry; see the note below, it does not gate writes. */
  disabled?: boolean;
}): DropdownSync {
  const { value, defaultValue, isMulti, readOnly } = params;
  const options = Array.isArray(params.options) ? params.options : [];

  // A multi-select dropdown holds an array and has no single default to seed.
  if (isMulti || readOnly) return NO_WRITE;

  // NOTE: `disabled` is deliberately NOT a no-write gate. The spec expects a
  // disabled dropdown's configured default to still be applied and written (it is
  // the answer the portal chose on the rep's behalf, and other fields' rules read
  // it). The corruption this guarded against came from the removed auto-select
  // below, not from seeding.

  // ⚠️ No options visible → write NOTHING, deliberately (see DropdownField).
  // On mobile the rule context settles across several renders (dealCenterData and
  // the saved draft both arrive async), so an empty option list is not proof the
  // stored answer is stale — clearing on it would destroy a saved selection the
  // next render offers again. The field is hidden and exempt from the required
  // check while empty, so nothing is gained by blanking it.
  if (!options.length) return NO_WRITE;

  const current = typeof value === 'string' ? value : '';

  // Clear a selection the config no longer offers.
  if (current) {
    return options.includes(current) ? NO_WRITE : { write: true, value: '' };
  }

  // Seed the active default — but only if it is actually on offer, so a default
  // that its own `optionVisibility` rule has hidden is never forced in.
  if (defaultValue && options.includes(defaultValue)) {
    return { write: true, value: defaultValue };
  }

  // ⚠️ DO NOT add a "lone visible option → select it" rule here.
  //
  // It was tried, to make a profile dropdown showing only "Versa Max" fill itself
  // in so the width field that depends on it would stop hiding. It WROTE
  // "Versa Max" into combinations whose real profile was "Versa" — the symptom
  // being a Job Builder disagreeing with the Deal Center over the same deal.
  //
  // The single option was itself the bug: an unauthored `optionVisibility` rule was
  // hiding "Versa" (see `ruleReferencesNoField` in dependency-engine). With that
  // fixed the list is complete and the configured default applies normally, so
  // there is nothing left for an auto-select to repair. `OptionToggleField` does
  // auto-select for toggle/optionList, but it owns its value; a dropdown here can
  // be answered by the calculator, and overwriting that is data loss.
  return NO_WRITE;
}
