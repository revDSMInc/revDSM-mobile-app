import React from 'react';
import { View } from 'react-native';
import { OptionList } from './OptionList';
import { useFieldNotice } from './FieldNoticeModal';

interface DynamicOptionFieldProps {
  field: any;
  label?: string;
  options?: string[];
  value?: string | string[];
  onChange?: (val: string | string[]) => void;
  color?: string;
  columns?: number;
  isMulti?: boolean;
}

/**
 * OptionList wrapper that wires the field's "Important Notice" popup (web
 * `field-registry.js` DropdownField + `useFieldNotice`). It exists as a component
 * because `useFieldNotice` is a hook and `renderField` is a plain function — the
 * hook must live in a component boundary. On every user change it fires the
 * original onChange, then `handleValueChange` (which opens the notice iff the new
 * value matches `field.notice.triggerValue`, e.g. gutter opening width `< 2.5`).
 */
export function DynamicOptionField({
  field,
  label,
  options,
  value,
  onChange,
  color,
  columns,
  isMulti,
}: DynamicOptionFieldProps) {
  const { noticeModal, handleValueChange } = useFieldNotice(field);

  return (
    <View>
      <OptionList
        label={label}
        options={options}
        value={value}
        onChange={(val) => {
          onChange?.(val);
          handleValueChange(val);
        }}
        color={color}
        columns={columns}
        isMulti={isMulti}
      />
      {noticeModal}
    </View>
  );
}
