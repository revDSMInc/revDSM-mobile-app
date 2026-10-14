import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import type { NativeSyntheticEvent, TextInputProps } from 'react-native';

type WithText<E> = (e: NativeSyntheticEvent<E>, text: string) => void;

type Props = Omit<TextInputProps, 'value' | 'onBlur' | 'onSubmitEditing' | 'onEndEditing'> & {
  value: string;
  debounceMs?: number;
  onBlur?: WithText<any>;
  onSubmitEditing?: WithText<any>;
  onEndEditing?: WithText<any>;
};

export const BufferedTextInput = forwardRef<TextInput, Props>(
  (
    { value, onChangeText, onBlur, onSubmitEditing, onEndEditing, debounceMs = 180, ...rest },
    ref,
  ) => {
    const [local, setLocal] = useState(value);
    const text = useRef(value);
    const dirty = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const parent = useRef(onChangeText);
    parent.current = onChangeText;

    useEffect(() => {
      if (dirty.current) return;
      text.current = value;
      setLocal(value);
    }, [value]);

    const flush = useCallback(() => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (dirty.current) {
        dirty.current = false;
        parent.current?.(text.current);
      }
      return text.current;
    }, []);
    useEffect(
      () => () => {
        flush();
      },
      [flush],
    );

    const handleChange = useCallback(
      (t: string) => {
        text.current = t;
        dirty.current = true;
        setLocal(t);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, debounceMs);
      },
      [flush, debounceMs],
    );

    return (
      <TextInput
        {...rest}
        ref={ref}
        value={local}
        onChangeText={handleChange}
        onBlur={onBlur ? (e) => onBlur(e, flush()) : () => flush()}
        onSubmitEditing={onSubmitEditing ? (e) => onSubmitEditing(e, flush()) : undefined}
        onEndEditing={onEndEditing ? (e) => onEndEditing(e, flush()) : undefined}
      />
    );
  },
);
BufferedTextInput.displayName = 'BufferedTextInput';
