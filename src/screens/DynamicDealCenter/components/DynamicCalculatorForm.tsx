import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { InputField } from '../../../widgets/components/dynamic-job-builder';
import { OptionList } from '../../../widgets/components/dynamic-job-builder';
import { ToggleGroup } from '../../../widgets/components/dynamic-job-builder';
import { LockedField } from '../../../widgets/components/dynamic-job-builder';

interface CalculatorField {
  id: string;
  type: string;
  label?: string;
  placeholder?: string;
  options?: any[];
  value?: any;
  readOnly?: boolean;
  unit?: string;
}

interface DynamicCalculatorFormProps {
  fields?: CalculatorField[];
  onFieldChange?: (fieldId: string, value: any) => void;
  readOnly?: boolean;
}

export function DynamicCalculatorForm({ fields = [], onFieldChange, readOnly = false }: DynamicCalculatorFormProps) {
  const renderField = (field: CalculatorField) => {
    if (field.readOnly) {
      return <LockedField key={field.id} label={field.label} value={field.value} />;
    }

    switch (field.type) {
      case 'text':
      case 'number':
        return (
          <InputField
            key={field.id}
            label={field.label}
            placeholder={field.placeholder}
            value={field.value}
            onChange={(val) => onFieldChange?.(field.id, val)}
            unit={field.unit}
          />
        );
      case 'select':
        return (
          <OptionList
            key={field.id}
            label={field.label}
            options={field.options || []}
            value={field.value}
            onChange={(val) => onFieldChange?.(field.id, val)}
          />
        );
      case 'toggle':
        return (
          <ToggleGroup
            key={field.id}
            label={field.label}
            options={field.options || []}
            value={field.value}
            onChange={(val) => onFieldChange?.(field.id, val)}
          />
        );
      default:
        return (
          <InputField
            key={field.id}
            label={field.label}
            value={field.value}
            onChange={(val) => onFieldChange?.(field.id, val)}
          />
        );
    }
  };

  return (
    <View className="p-3">
      {fields.map((field) => renderField(field))}
    </View>
  );
}
