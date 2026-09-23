import React, { useLayoutEffect, useRef } from 'react';
import { DynamicOptionField } from './DynamicOptionField';
import { DropdownSelect } from './DropdownSelect';
import { LockedField } from './LockedField';
import { resolveDropdownSync } from '../../../utils/dynamic-job-builder/engine/dropdown-state-sync';

interface DropdownFieldProps {
  field: any;
  label?: string;
  /** Options remaining after `getVisibleFieldOptions` (already rule-filtered). */
  options: string[];
  value?: string | string[];
  onChange?: (val: any) => void;
  color?: string;
  columns?: number;
  isMulti?: boolean;
  /**
   * `field.disabled` — "Rep can use this dropdown → No". Renders the VALUE, not a
   * chooser (spec §2.3: "greyed out: shows its value, cannot be opened").
   */
  disabled?: boolean;
  /**
   * Title for the DISABLED value box. Resolved by the renderer's `boxTitleFor`,
   * which falls back to the containing stack's label — a field authored without one
   * otherwise renders a completely untitled box.
   */
  boxLabel?: string;
  /** Already resolved by `resolveEffectiveDefaultValue`; '' when none applies. */
  defaultValue?: string;
  /**
   * What to show when job state holds nothing — `resolveLockedValue(field,
   * dealCenterData)`, i.e. the config / calculator snapshot. Display only; it is
   * never written back into job state.
   */
  fallbackValue?: string;
  /**
   * View-only render — the effect must never write to job state. Belt-and-braces:
   * `renderField` short-circuits `readOnly` into the locked row BEFORE the
   * dropdown case, so today this never arrives true. It is honoured anyway so a
   * future caller that renders the chip grid read-only cannot start writing.
   */
  readOnly?: boolean;
}

/**
 * RN port of web `field-registry.js` `PreviewDropdownField` (ticket 1063).
 *
 * Mobile renders a "dropdown" as the same chip grid as `optionList`, so this is
 * the dropdown twin of `OptionToggleField`: it owns the three behaviours that
 * cannot live in `renderField` (a plain function, so no hooks) —
 *
 *   - **no visible options → render nothing** (parity with toggle/optionList,
 *     instead of an empty selector the rep cannot answer);
 *   - **seed the configured default INTO STATE**, not just into the render.
 *     This is the load-bearing half: other fields' `optionVisibility` rules read
 *     `state[field.id]`, so a default that is only render-resolved is invisible
 *     to them and rules their options out — the field looks answered while
 *     everything downstream behaves as if it were blank;
 *   - **clear a selection the config no longer offers** (a field this one
 *     depends on changed).
 *
 * ⚠️ Deliberate divergence from the portal spec: a stale value is NOT cleared
 * when ZERO options are visible. `OptionToggleField` takes the same early return
 * for the same reason — on mobile the rule context settles across several
 * renders (`dealCenterData` and the outcome draft arrive asynchronously; see
 * `useDynamicJobBuilderSession`), so a momentarily-empty option list is not
 * proof the answer is stale, and clearing on it would destroy a saved selection
 * that the very next render offers again. A field with no visible options is
 * hidden and exempt from the required check anyway, so nothing is gained by
 * blanking it.
 */
export function DropdownField({
  field,
  label,
  options,
  value,
  onChange,
  color,
  columns,
  isMulti,
  disabled,
  boxLabel,
  defaultValue,
  fallbackValue,
  readOnly,
}: DropdownFieldProps) {
  const visibleOptions = Array.isArray(options) ? options : [];

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Keyed on the option VALUES, not the array identity: `getVisibleFieldOptions`
  // returns a fresh array every render, which would re-run this on every render.
  const optionsKey = visibleOptions.join(' ');
  const singleValue = typeof value === 'string' ? value : '';

  // ⚠️ THE CONFIG-RESOLVED VALUE MUST REACH JOB STATE — displaying it is not enough.
  //
  // Spec §2.4: "the default is written into STATE, not just displayed … because
  // rules on OTHER fields read state. A defaulted dropdown that is only
  // render-resolved is invisible to `optionVisibility`, so a rule pointing at it
  // evaluates as empty and silently rules every option out."
  //
  // That is not theoretical — it was reported three separate ways on the LeafFilter
  // tab, all one cause: a profile box that DISPLAYED "Versa" while state held
  // nothing. The width dropdown's options are each gated on that profile, so every
  // rule failed and the whole field vanished from the combination; the Job Builder
  // Summary dropped its row; and the value would not have been saved.
  //
  // So the seed candidate is the same chain the box displays: the active default
  // first, then `fallbackValue` (the deal-center / config answer). Whatever the rep
  // is shown is what the rest of the engine gets to read.
  const configValue = defaultValue || fallbackValue || '';
  const seedable = !!configValue && visibleOptions.includes(configValue);

  useLayoutEffect(() => {
    // The decision itself lives in `dropdown-state-sync.ts` so it can be unit
    // tested; this effect only commits it.
    const sync = resolveDropdownSync({
      options: visibleOptions,
      value: singleValue,
      defaultValue: configValue,
      isMulti,
      readOnly,
      disabled,
    });
    if (sync.write) onChangeRef.current?.(sync.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey, singleValue, configValue, isMulti, readOnly, disabled]);

  if (!visibleOptions.length) return null;

  // Resolved during render AS WELL AS in the effect, deliberately (web parity):
  //   - the field never paints one frame as empty-and-incomplete before the
  //     default lands, and
  //   - ⚠️ a value whose option is currently HIDDEN reads as empty rather than as
  //     a selected chip the rep cannot see the basis for. That is why this checks
  //     `visibleOptions.includes(singleValue)` instead of just using `singleValue`.
  const shownValue = isMulti
    ? Array.isArray(value)
      ? value
      : []
    : (visibleOptions.includes(singleValue) && singleValue) ||
      (seedable && configValue) ||
      '';

  // ⚠️ DISABLED RENDERS THE VALUE, NOT THE OPTIONS.
  //
  // Spec §2.3: "Greyed out on Sales: SHOWS ITS VALUE, cannot be opened." On web
  // that is automatic — a disabled `<Select>` only ever shows its selection. Mobile
  // draws a dropdown as a chip grid, so the literal translation (grey out every
  // chip) wrongly leaves the whole option list on screen: a LeafFilter combination
  // rendered `< 2.5 | 2.5 - 3.4 | > 7` side by side with no label and nothing
  // visibly chosen, while the combination beside it — whose equivalent fields are
  // `locked` — showed a tidy "Gutter Opening Width / 7\"" box. Same data, two
  // different-looking cards.
  //
  // `LockedField` IS that box, so reusing it makes the two presentations identical
  // instead of merely similar.
  //
  // ⚠️ This must stay INSIDE the component, after the hooks. Rendering the box from
  // `renderField` instead would unmount the effect above, and that effect is what
  // writes the value other fields' `optionVisibility` rules read — which is exactly
  // what left the width dropdown with no selectable option and hid it entirely.
  if (disabled) {
    // ⚠️ `field.label`, NOT the `label` prop. `label` has already been through the
    // renderer's `showLabel` / `repeatsParentLabel` suppression, which is a rule for
    // an inline CHIP GRID sitting under a heading that already names it. The locked
    // branch has always passed `field.label` straight through, so honouring the
    // suppression here would print a label in one card and none in the next — the
    // exact mismatch this box exists to remove.
    // ⚠️ Falls back to `fallbackValue` — the deal-center / config resolution — when
    // job state holds nothing. Without it a disabled dropdown that the CALCULATOR
    // answers (rather than the rep) rendered a bare "—", while the locked field in
    // the card beside it showed the same class of value fine. That is the whole
    // point of `resolveLockedValue`: it is combination-independent, so it answers
    // for every combination, not only the one that happens to carry state.
    //
    // ⚠️ `field.label || field.title` — the fallback this engine already uses
    // (`dependency-engine` collectFieldRefs, `field-value-utils`). A field authored
    // with only `title` otherwise renders a label-less box beside a labelled one.
    // ⚠️ RESOLUTION ORDER MATTERS. The CONFIG wins over saved state here — the
    // opposite of both `shownValue` and the usual "never clobber what is stored".
    //
    // A `disabled` field's value was never the rep's to set; the portal answers it.
    // So when the portal's answer and the saved draft disagree, the portal is right
    // and the draft is simply out of date.
    //
    // This is also the fix for a specific reported symptom: the box showed the
    // CORRECT (new) value for a moment and then reverted to an old one. The config
    // resolves synchronously on mount, but the saved draft arrives later from the
    // outcome GET (`useDynamicJobBuilderSession` applies it when `draftToken` /
    // `draftSettled` settle) — so with state first in this chain, the late write
    // visibly overwrote the fresh value a second after the screen opened.
    //
    // `fallbackValue` is the portal-derived answer: `resolveLockedValue` reads the
    // field's `dcField`/`dcFields` out of the quote and falls back to the config's
    // own `defaultValue`. Saved state stays last, so a field the config cannot
    // answer at all still shows what the deal holds rather than going blank.
    //
    // ⚠️ DISPLAY ONLY — job state is deliberately NOT rewritten. Showing the
    // portal's current answer is safe; silently re-saving every already-submitted
    // deal because someone edited a default is not.
    const boxValue = fallbackValue || (seedable ? configValue : '') || singleValue || undefined;
    return <LockedField label={boxLabel || field?.label || field?.title} value={boxValue} />;
  }

  // Editable + single-select → a REAL dropdown, which is what the ticket asks for
  // ("never text inputs — always a drop down with all options"). The collapsed
  // control shows the current selection, so the value already in job state is the
  // one the control opens on.
  //
  // ⚠️ Why this is not the chip grid: with conditions lifted in the deal-edit
  // wizard a LeafFilter width field offers all seven options at once, which drew a
  // four-row block of chips per combination and pushed the rest of the card off
  // screen. A dropdown collapses that to one row.
  //
  // Multi-select keeps the chip grid: a collapsed control cannot show several
  // selections at once, and `field.multiSelect` dropdowns are authored to behave
  // like an optionList.
  if (!isMulti) {
    return (
      <DropdownSelect
        label={label}
        options={visibleOptions}
        value={shownValue as string}
        onChange={onChange}
        accentColor={color}
      />
    );
  }

  return (
    <DynamicOptionField
      field={field}
      label={label}
      options={visibleOptions}
      value={shownValue}
      onChange={onChange}
      color={color}
      columns={columns}
      isMulti={isMulti}
      disabled={disabled}
    />
  );
}
