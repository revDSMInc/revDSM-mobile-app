import React, { useLayoutEffect, useRef } from 'react';
import { DynamicOptionField } from './DynamicOptionField';
import { DropdownSelect } from './DropdownSelect';
import { useFieldNotice } from './FieldNoticeModal';
import { LockedField } from './LockedField';
import { resolveDropdownSync } from '../../../utils/dynamic-job-builder/engine/dropdown-state-sync';

interface DropdownFieldProps {
  field: any;
  label?: string;
  options: string[];
  value?: string | string[];
  onChange?: (val: any) => void;
  color?: string;
  columns?: number;
  isMulti?: boolean;
  disabled?: boolean;
  boxLabel?: string;
  defaultValue?: string;
  fallbackValue?: string;
  readOnly?: boolean;
}

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

  const { noticeModal, handleValueChange } = useFieldNotice(field);

  const optionsKey = visibleOptions.join(' ');
  const singleValue = typeof value === 'string' ? value : '';

  const configValue = defaultValue || fallbackValue || '';
  const seedable = !!configValue && visibleOptions.includes(configValue);

  useLayoutEffect(() => {
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

  const shownValue = isMulti
    ? Array.isArray(value)
      ? value
      : []
    : (visibleOptions.includes(singleValue) && singleValue) ||
      (seedable && configValue) ||
      '';

  if (disabled) {
    const boxValue = fallbackValue || (seedable ? configValue : '') || singleValue || undefined;
    return <LockedField label={boxLabel || field?.label || field?.title} value={boxValue} />;
  }

  if (!isMulti) {
    return (
      <>
        <DropdownSelect
          label={label}
          options={visibleOptions}
          value={shownValue as string}
          onChange={(val) => {
            onChange?.(val);
            handleValueChange(val);
          }}
          accentColor={color}
        />
        {noticeModal}
      </>
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
