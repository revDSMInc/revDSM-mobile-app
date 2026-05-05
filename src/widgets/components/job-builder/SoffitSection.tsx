import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { COLORS } from './color-constant';
import { useProductImage } from '../../../hooks/useProductImage';
import { Image, ActivityIndicator } from 'react-native';

const LOCATIONS = ['FRONT', 'REAR', 'LEFT', 'RIGHT'];
const TYPE_OPTIONS = ['PARTIAL', 'FULL'];
const SOFFIT_TYPES = ['HIDDEN VENT VINYL', 'PINHOLE VINYL', 'ALUMINUM', 'WOOD'];

interface SoffitSectionProps {
  jobState: any;
  onUpdate: (section: string, field: string, value: any) => void;
  calculatorData: any;
}

export const SoffitSection = ({ jobState, onUpdate, calculatorData }: SoffitSectionProps) => {
  const { colors, isDark } = useTheme();
  const { fetchProductImage, image, loading: imageLoading } = useProductImage('soffit');

  const data = {
    vinyl: {
      type: jobState.soffit?.vinyl?.type || '',
      footage: jobState.soffit?.vinyl?.footage || calculatorData?.vinylSoffit || '',
      soffitType: jobState.soffit?.vinyl?.soffitType || '',
      color: jobState.soffit?.vinyl?.color || '',
    },
    porch: {
      location: jobState.soffit?.porch?.location || [],
      footage: jobState.soffit?.porch?.footage || calculatorData?.porchCeiling || '',
      soffitType: jobState.soffit?.porch?.soffitType || '',
      color: jobState.soffit?.porch?.color || '',
    },
    nailer: {
      type: jobState.soffit?.nailer?.type || '',
      footage: jobState.soffit?.nailer?.footage || calculatorData?.nailerBuildOut || '',
      soffitType: jobState.soffit?.nailer?.soffitType || '',
      color: jobState.soffit?.nailer?.color || '',
    },
  };

  const handleSubUpdate = (section: string, field: string, value: any) => {
    onUpdate('soffit', section, { ...data[section as keyof typeof data], [field]: value });
  };

  const renderWarning = (message: string) => (
    <View className="flex-row items-center bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
      <Icon name="alert" size={18} color="#D97706" />
      <Text className="text-[11px] font-black text-amber-700 ml-2 uppercase tracking-tight">
        {message}
      </Text>
    </View>
  );

  const renderOptionSelector = (
    label: string,
    options: string[],
    currentValue: any,
    onChange: (val: any) => void,
    isMulti = false,
    incomplete = false,
    warningMsg = ''
  ) => (
    <View
      className={`p-4 rounded-lg mb-4 ${
        incomplete ? 'border-2 border-amber-200 bg-amber-50/30' : 'bg-white border border-slate-100'
      }`}
    >
      {incomplete && renderWarning(warningMsg)}
      <Text
        className={`text-[10px] font-black uppercase tracking-widest mb-4 ${
          incomplete ? 'text-amber-600' : 'text-slate-400'
        }`}
      >
        {label}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((opt) => {
          const selected = isMulti ? currentValue?.includes(opt) : currentValue === opt;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => {
                if (isMulti) {
                  const next = currentValue.includes(opt)
                    ? currentValue.filter((l: any) => l !== opt)
                    : [...currentValue, opt];
                  onChange(next);
                } else {
                  onChange(opt);
                }
              }}
              className={`py-3 rounded-lg border-2 items-center justify-center flex-row ${
                selected ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-slate-100'
              }`}
              style={{ width: '48%' }}
            >
              <Text
                className={`text-[11px] font-black uppercase tracking-widest ${
                  selected ? 'text-white' : 'text-slate-900'
                }`}
              >
                {opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {currentValue && (Array.isArray(currentValue) ? currentValue.length > 0 : true) && (
        <View className="flex-row items-center mt-3 ml-1">
          <Icon name="check" size={14} color="#10B981" />
          <Text className="text-emerald-500 font-black text-[11px] ml-1 uppercase">
            {Array.isArray(currentValue) ? currentValue.join(', ') : currentValue}
          </Text>
        </View>
      )}
    </View>
  );

  const renderColorPicker = (
    label: string,
    soffitType: string,
    selectedColor: string,
    onSelect: (c: string) => void,
    incomplete = false
  ) => {
    const list =
      soffitType === 'PINHOLE VINYL' ? COLORS['Soffit(Pinhole)'] : COLORS['Soffit(Hidden vent)'];

    return (
      <View
        className={`p-4 rounded-lg mb-4 ${
          incomplete
            ? 'border-2 border-amber-200 bg-amber-50/30'
            : 'bg-white border border-slate-100'
        }`}
      >
        {incomplete && renderWarning('Incomplete-Color Required')}
        <View className="flex-row justify-between items-center mb-4">
          <Text
            className={`text-[10px] font-black uppercase tracking-widest ${
              incomplete ? 'text-amber-600' : 'text-slate-400'
            }`}
          >
            {label}
          </Text>
          {image.imageUrl && image.color === selectedColor && (
            <View className="w-12 h-12 rounded-lg overflow-hidden border border-slate-100">
              <Image
                source={{ uri: image.imageUrl }}
                className="w-full h-full"
                resizeMode="cover"
              />
            </View>
          )}
          {imageLoading && <ActivityIndicator size="small" color="#10B981" />}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-3">
            {list.map((c) => (
              <TouchableOpacity
                key={c.name}
                onPress={() => {
                  onSelect(c.name);
                  fetchProductImage(
                    c.name,
                    soffitType === 'PINHOLE VINYL' ? 'soffit Pinhole' : 'soffit '
                  );
                }}
                style={{
                  width: 50,
                  height: 40,
                  backgroundColor: c.hex,
                  borderRadius: 8,
                  borderWidth: 2,
                  borderColor:
                    selectedColor === c.name ? '#10B981' : isDark ? '#404040' : '#E2E8F0',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selectedColor === c.name && <Icon name="check-circle" size={16} color="white" />}
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        {selectedColor && (
          <View className="flex-row items-center mt-4 bg-emerald-50 self-start px-2 py-1 rounded-lg">
            <Icon name="check" size={12} color="#10B981" />
            <Text className="text-[10px] font-black text-emerald-600 ml-1 uppercase">
              {selectedColor}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderSubSection = (title: string, sectionKey: string, sectionData: any) => {
    const footage = parseFloat(sectionData.footage || '0');
    if (footage <= 0) return null;

    return (
      <View
        key={sectionKey}
        className="mb-6 p-1 rounded-lg bg-emerald-50/20 border border-emerald-100/50"
      >
        <View className="p-4">
          <Text className="text-[12px] font-black text-emerald-700 uppercase mb-4 tracking-wider">
            {title}
          </Text>

          {sectionKey === 'porch'
            ? renderOptionSelector(
                'Location',
                LOCATIONS,
                sectionData.location,
                (v) => handleSubUpdate(sectionKey, 'location', v),
                true,
                !sectionData.location || sectionData.location.length === 0,
                'Incomplete-Location Required'
              )
            : renderOptionSelector(
                'Type',
                TYPE_OPTIONS,
                sectionData.type,
                (v) => handleSubUpdate(sectionKey, 'type', v),
                false,
                !sectionData.type,
                'Incomplete-Type Required'
              )}

          <View className="p-4 rounded-lg bg-slate-50 border border-slate-100 mb-4 flex-row justify-between items-center">
            <View>
              <Text className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">
                {title} Footage
              </Text>
              <Text className="text-sm font-black text-slate-900">{footage} FT</Text>
            </View>
            <Icon name="lock" size={16} color="#919EAB" />
          </View>

          {sectionKey !== 'nailer' && (
            <>
              {renderOptionSelector(
                'Soffit Type',
                SOFFIT_TYPES,
                sectionData.soffitType,
                (v) => handleSubUpdate(sectionKey, 'soffitType', v),
                false,
                !sectionData.soffitType,
                'Incomplete-Soffit Type Required'
              )}
              {renderColorPicker(
                'Soffit Color',
                sectionData.soffitType,
                sectionData.color,
                (v) => handleSubUpdate(sectionKey, 'color', v),
                !sectionData.color
              )}
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View className="px-5 py-5 pb-24 bg-white">
        {renderSubSection('Vinyl Soffit', 'vinyl', data.vinyl)}
        {renderSubSection('Porch Ceiling SqFT', 'porch', data.porch)}
        {renderSubSection('Nailer Build Out', 'nailer', data.nailer)}

        {!(
          parseFloat(data.vinyl.footage) > 0 ||
          parseFloat(data.porch.footage) > 0 ||
          parseFloat(data.nailer.footage) > 0
        ) && (
          <View className="items-center py-20 bg-white rounded-lg border border-dashed border-slate-200">
            <Icon name="information-outline" size={48} color="#CBD5E1" />
            <Text className="text-slate-400 font-bold mt-4">No Soffit Requirements Found</Text>
            <Text className="text-slate-300 text-[10px] uppercase font-black tracking-widest mt-1">
              Check Calculator Data
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
};
