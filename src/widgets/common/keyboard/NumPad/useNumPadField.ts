import { useCallback, useEffect, useRef } from 'react';
import { Keyboard, Platform, TextInput } from 'react-native';
import type { KeyboardTypeOptions, TextInputProps } from 'react-native';
import { numPadModeFor, type NumPadMode } from '../../../../utils/numpad';
import { useNumPad, type NumPadTarget } from './index';

type FieldProps = Pick<
  TextInputProps,
  | 'keyboardType'
  | 'value'
  | 'defaultValue'
  | 'maxLength'
  | 'onChangeText'
  | 'onSubmitEditing'
  | 'onKeyPress'
  | 'onFocus'
  | 'onBlur'
  | 'showSoftInputOnFocus'
> & { numPad?: NumPadMode | false; keyboardType?: KeyboardTypeOptions };

/**
 * Wires one TextInput to the nearest in-app number pad. Called from the global TextInput
 * wrapper in index.js, so EVERY numeric field in the app gets it with no per-file change.
 *
 * Returns the props to spread LAST on the native input, or `null` when the field needs the
 * system keyboard (non-numeric type, `numPad={false}`, or no provider above it).
 *
 * Cost: one `useContext` + a few refs per input. The context value is stable, so inputs do
 * NOT re-render when the pad opens or closes.
 */
export function useNumPadField(props: FieldProps) {
  const pad = useNumPad();
  // ⚠️ Android only: iOS/iPad keep the system keyboard (see `NumPadProvider`).
  const mode = pad && Platform.OS === 'android' ? numPadModeFor(props.keyboardType, props.numPad) : null;

  // Everything the pad reads at key-press time lives in a ref, so it never goes stale and the
  // registered target never has to be rebuilt after a keystroke.
  const latest = useRef(props);
  latest.current = props;
  // Uncontrolled fields (no `value`) have nowhere else to read the text from.
  const typed = useRef<string>(props.defaultValue ?? '');
  const target = useRef<NumPadTarget | null>(null);

  const release = useCallback(() => {
    if (target.current && pad) pad.detach(target.current);
    target.current = null;
  }, [pad]);
  useEffect(() => release, [release]);

  const onFocus = useCallback(
    (e: any) => {
      latest.current.onFocus?.(e);
      if (!mode || !pad) return;
      const t: NumPadTarget = {
        getValue: () => {
          const p = latest.current;
          return p.value !== undefined ? String(p.value ?? '') : typed.current;
        },
        setValue: (next) => {
          const p = latest.current;
          typed.current = next;
          if (p.value === undefined) {
            (TextInput as any).State?.currentlyFocusedInput?.()?.setNativeProps?.({ text: next });
          } else {
            // Read at once, not on the next render: two quick taps must not see a stale value.
            latest.current = { ...p, value: next };
          }
          p.onChangeText?.(next);
        },
        mode,
        maxLength: latest.current.maxLength,
        onBackspaceEmpty: () => latest.current.onKeyPress?.({ nativeEvent: { key: 'Backspace' } } as any),
        dismiss: () => {
          const p = latest.current;
          // Same order as the system Done key: submit, then blur. A field that commits on
          // onSubmitEditing (Android/iPad path) never saw one before the pad existed.
          p.onSubmitEditing?.({ nativeEvent: { text: t.getValue() } } as any);
          Keyboard.dismiss();
        },
      };
      target.current = t;
      pad.attach(t);
    },
    [mode, pad],
  );

  const onBlur = useCallback(
    (e: any) => {
      release();
      latest.current.onBlur?.(e);
    },
    [release],
  );

  if (!mode) return null;
  return { showSoftInputOnFocus: false, onFocus, onBlur };
}
