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
  disabled?: boolean;
}

export function DynamicOptionField({
  field,
  label,
  options,
  value,
  onChange,
  color,
  columns,
  isMulti,
  disabled,
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
        disabled={disabled}
      />
      {noticeModal}
    </View>
  );
}
