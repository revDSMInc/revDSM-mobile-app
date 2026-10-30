import React, { useLayoutEffect, useRef } from 'react';
import { LockedSingleOption } from './LockedSingleOption';

interface OptionToggleFieldProps {
  /**
   * The field's own label, used ONLY to scope the unlocked behaviour - see
   * `allowsSingleOptionChoice`. Callers pass `field.label`, NOT the screen's `visibleLabel`:
   * that one is undefined when the label is hidden, which would silently un-scope the match.
   */
  fieldLabel?: string;
  options: string[];
  value?: string | string[];
  onChange?: (val: any) => void;
  isMulti?: boolean;
  children: React.ReactNode;
}

/**
 * Which field may show its ONE option as a normal, deselectable button?
 *
 * ⚠️ DELIBERATELY NARROW. The ask was Mounting Substrate only - "I told you to implement
 * for Fascia only, it's also impacting the other product single values, like Gutter etc".
 * Every other single-option field keeps the padlock, because a lone option there is an
 * imposed value the rep should not be able to clear.
 *
 * ⚠️ Matched on the LABEL because this field is portal-authored: there is no id or flag in
 * the app that names it, and the label is the only stable thing the schema gives us. That makes
 * it fragile - if the portal renames the field, this silently reverts to the padlock. The
 * durable fix is a schema flag (e.g. `allowClear: true`) the portal sets on the field; ask the
 * backend for one before adding a second name to this list.
 */
const SINGLE_OPTION_CHOICE_LABELS = ['mounting substrate'];

export const allowsSingleOptionChoice = (label?: string): boolean =>
  SINGLE_OPTION_CHOICE_LABELS.includes(String(label || '').trim().toLowerCase());

export function OptionToggleField({
  fieldLabel,
  options,
  value,
  onChange,
  isMulti,
  children,
}: OptionToggleFieldProps) {
  const visibleOptions = Array.isArray(options) ? options : [];

  const prevVisibleCountRef = useRef(visibleOptions.length);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // \u0000 as an ESCAPE, never a raw byte: a literal NUL makes git and grep treat this file
  // as binary (CLAUDE.md section 6). Only a separator that cannot occur in an option label.
  const optionsKey = visibleOptions.join('\u0000');

  /**
   * ⚠️ Has the lone option been offered to this field ALREADY?
   *
   * The auto-select below must seed a one-option field once, then stop. Without this it runs
   * on every render, so clearing the value re-picks it instantly and the rep's tap looks
   * broken - they tap to deselect and it comes straight back. Keyed by the option list, so a
   * field whose options CHANGE (a dependency switched) is seeded again for the new list.
   */
  const seededForRef = useRef<string | null>(null);
  const canClear = allowsSingleOptionChoice(fieldLabel);

  useLayoutEffect(() => {
    const prevCount = prevVisibleCountRef.current;
    const count = visibleOptions.length;
    prevVisibleCountRef.current = count;

    if (!count || isMulti) return;

    if (count === 1) {
      const only = visibleOptions[0];
      if (!only) return;
      if (!canClear) {
        // Padlocked field: the lone option IS the value, so keep it pinned as before.
        if (value !== only) onChangeRef.current?.(only);
        return;
      }
      // Clearable field: seed once per option list; after that an empty value is the rep's choice.
      if (!value && seededForRef.current !== optionsKey) {
        seededForRef.current = optionsKey;
        onChangeRef.current?.(only);
      }
      return;
    }

    seededForRef.current = null;

    if (!value) return;

    if (prevCount === 1 || !visibleOptions.includes(value as string)) {
      onChangeRef.current?.('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey, value, isMulti]);

  if (!visibleOptions.length) return null;

  /**
   * Only the scoped field (see `allowsSingleOptionChoice`) shows its lone option as a normal,
   * deselectable button. Everything else keeps the padlock it always had.
   */
  if (visibleOptions.length === 1 && !isMulti && !canClear) {
    return <LockedSingleOption label={fieldLabel} option={visibleOptions[0]} />;
  }

  /**
   * The scoped field renders its NORMAL button, selectable and deselectable.
   *
   * It used to render `LockedSingleOption` - a padlock chip plus "Only option available" -
   * which reads as "you may not touch this". Reported against Lighting -> Mounting Substrate:
   * "Fascia is showing locked, it should be selectable like Soffit below", then "allow me to
   * unselect as well". Two fields in the same card looked like two different kinds of control
   * when they are the same kind of choice.
   *
   * ⚠️ This is the SINGLE-OPTION case only - "this lock part only came when we have single
   * thing". A field the schema genuinely locks (a deal-center-driven value) still renders
   * `LockedField` / `LockedFieldWithColor` from `DynamicTabRenderer`, and must: there the value
   * really is not the rep's to change. Don't wire `LockedSingleOption` back to an option count.
   */
  return <>{children}</>;
}
