import React from 'react';
import { View, Text, TextInput } from 'react-native';

interface DynamicTabRendererProps {
  tab: any;
  tabState: any;
  onStateChange?: (tabState: any) => void;
  dealCenterData?: any;
  readOnly?: boolean;
  applyConditions?: boolean;
}

function renderField(field: any, value: any, onChange: (val: any) => void) {
  if (field.locked) {
    return (
      <View key={field.id} className="mb-4">
        <Text className="text-xs text-gray-400 mb-1">{field.label}</Text>
        <View className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 flex-row items-center justify-between">
          <Text className="text-sm font-semibold text-gray-400">{value ?? field.defaultValue ?? '—'}</Text>
          <Text className="text-sm text-gray-300">🔒</Text>
        </View>
      </View>
    );
  }

  switch (field.type) {
    case 'text':
    case 'number':
      return (
        <View key={field.id} className="mb-4">
          <Text className="text-xs text-gray-500 font-semibold mb-1">{field.label}</Text>
          <View className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
            <TextInput
              className="text-sm text-gray-800"
              value={value != null ? String(value) : ''}
              onChangeText={onChange}
              placeholder={field.placeholder || '0'}
              keyboardType={field.type === 'number' ? 'numeric' : 'default'}
            />
          </View>
        </View>
      );

    case 'toggle':
      return (
        <View key={field.id} className="mb-4">
          <Text className="text-xs text-gray-500 font-semibold mb-2">{field.label}</Text>
          <View className="flex-row flex-wrap gap-2">
            {(field.options || []).map((opt: string) => {
              const isActive = value === opt;
              return (
                <View
                  key={opt}
                  className={`px-4 py-2 rounded-xl ${isActive ? 'bg-blue-500' : 'bg-gray-100 border border-gray-200'}`}
                >
                  <Text className={`text-xs font-semibold ${isActive ? 'text-white' : 'text-gray-600'}`}>{opt}</Text>
                </View>
              );
            })}
          </View>
        </View>
      );

    case 'swatch':
      return (
        <View key={field.id} className="mb-4">
          <Text className="text-xs text-gray-500 font-semibold mb-2">{field.label}</Text>
          <View className="flex-row flex-wrap gap-2">
            {(field.colors || ['#FFFFFF', '#000000', '#808080', '#C0C0C0']).map((color: string) => (
              <View
                key={color}
                className="w-8 h-8 rounded-full border-2"
                style={{ backgroundColor: color, borderColor: value === color ? '#3b82f6' : '#e5e5ea' }}
              />
            ))}
          </View>
        </View>
      );

    case 'locationGrid':
      return (
        <View key={field.id} className="mb-4">
          <Text className="text-xs text-gray-500 font-semibold mb-2">{field.label}</Text>
          <View className="bg-gray-50 rounded-xl p-3 border border-gray-200">
            <Text className="text-xs text-gray-400">Location grid — enter measurements</Text>
          </View>
        </View>
      );

    case 'sectionLabel':
      return (
        <View key={field.id} className="mb-2 mt-4">
          <Text className="text-xs font-bold text-gray-400 uppercase tracking-wider">{field.title || field.label}</Text>
          <View className="h-px bg-gray-200 mt-2" />
        </View>
      );

    case 'textarea':
      return (
        <View key={field.id} className="mb-4">
          <Text className="text-xs text-gray-500 font-semibold mb-1">{field.label}</Text>
          <View className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
            <TextInput
              className="text-sm text-gray-800"
              value={value != null ? String(value) : ''}
              onChangeText={onChange}
              placeholder={field.placeholder || 'Enter text...'}
              multiline
              numberOfLines={field.rows || 3}
              textAlignVertical="top"
            />
          </View>
        </View>
      );

    default:
      return (
        <View key={field.id} className="mb-4">
          <Text className="text-xs text-gray-500 font-semibold mb-1">{field.label}</Text>
          <View className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
            <TextInput
              className="text-sm text-gray-800"
              value={value != null ? String(value) : ''}
              onChangeText={onChange}
              placeholder={field.placeholder || ''}
            />
          </View>
        </View>
      );
  }
}

export function DynamicTabRenderer({
  tab,
  tabState,
  onStateChange,
  readOnly = false,
}: DynamicTabRendererProps) {
  if (tab.isSummary) {
    return (
      <View className="p-4 items-center">
        <Text className="text-gray-400 text-sm">Summary tab</Text>
      </View>
    );
  }

  const sections = tab.sections || [];
  const fields = tab.fields || [];

  const handleFieldChange = (fieldId: string, val: any) => {
    if (readOnly || !onStateChange) return;
    onStateChange({ ...tabState, [fieldId]: val });
  };

  return (
    <View className="p-4">
      {sections.length > 0 ? (
        sections.map((section: any) => (
          <View key={section.id} className="mb-4">
            {section.label && (
              <Text className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{section.label}</Text>
            )}
            {(section.fields || []).map((field: any) =>
              renderField(field, tabState?.[field.id], (val) => handleFieldChange(field.id, val))
            )}
          </View>
        ))
      ) : (
        fields.map((field: any) =>
          renderField(field, tabState?.[field.id], (val) => handleFieldChange(field.id, val))
        )
      )}

      {sections.length === 0 && fields.length === 0 && (
        <View className="py-8 items-center">
          <Text className="text-gray-400 text-sm">No fields in this tab</Text>
        </View>
      )}
    </View>
  );
}
