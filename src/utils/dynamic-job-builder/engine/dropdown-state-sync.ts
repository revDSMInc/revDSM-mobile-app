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
}): DropdownSync {
  const { value, defaultValue, isMulti, readOnly } = params;
  const options = Array.isArray(params.options) ? params.options : [];

  // A multi-select dropdown holds an array and has no single default to seed.
  if (isMulti || readOnly) return NO_WRITE;

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

  // Exactly ONE option left and nothing chosen → that option IS the answer.
  //
  // Parity with `OptionToggleField`, which has always done this for toggle /
  // optionList. Its docstring explains why it is load-bearing rather than
  // cosmetic, and the same applies here: the value has to be WRITTEN, because
  // other fields read it. A LeafFilter combination whose profile dropdown offers
  // only "Versa Max" but holds no value rules out every option of the width
  // dropdown that depends on it — so the width field renders nothing, the
  // allocation card stays at "Used 0ft", and Next is disabled with nothing on
  // screen to fix. It matters most when the field is `disabled`: the rep cannot
  // select it themselves, so nothing else would ever fill it in.
  if (options.length === 1) {
    return { write: true, value: options[0] };
  }

  return NO_WRITE;
}
