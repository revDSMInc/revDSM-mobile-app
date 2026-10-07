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

export function useNumPadField(props: FieldProps) {
  const pad = useNumPad();
  // ⚠️ Android only: iOS/iPad keep the system keyboard (see `NumPadProvider`).
  const mode = pad && Platform.OS === 'android' ? numPadModeFor(props.keyboardType, props.numPad) : null;

  const latest = useRef(props);
  latest.current = props;
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
            latest.current = { ...p, value: next };
          }
          p.onChangeText?.(next);
        },
        mode,
        maxLength: latest.current.maxLength,
        onBackspaceEmpty: () => latest.current.onKeyPress?.({ nativeEvent: { key: 'Backspace' } } as any),
        dismiss: () => {
          const p = latest.current;
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
