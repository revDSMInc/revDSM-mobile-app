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

  const n = (v: any) => parseFloat(v) || 0;
  const getVal = (baseKey: string) => {
    if (!calculatorData) return 0;
    const lowerKey = baseKey.toLowerCase();
    // Check root
    const topKey = Object.keys(calculatorData).find((k) => k.toLowerCase() === lowerKey);
    const topVal = topKey ? n(calculatorData[topKey]) : 0;
    if (topVal > 0) return topVal;
    // Check extras (soffit/fascia keys live here)
    const extras = calculatorData.extras || {};
    const extrasKey = Object.keys(extras).find((k) => k.toLowerCase() === lowerKey);
    const extrasVal = extrasKey ? n(extras[extrasKey]) : 0;
    if (extrasVal > 0) return extrasVal;
    // Check inputs
    const inputs = calculatorData.inputs || {};
    const inputKey = Object.keys(inputs).find((k) => k.toLowerCase() === lowerKey);
    return inputKey ? n(inputs[inputKey]) : 0;
  };

  const data = {
    vinyl: {
      type: jobState.soffit?.vinyl?.type || '',
      footage: jobState.soffit?.vinyl?.footage || getVal('vinylSoffit') || '',
      soffitType: jobState.soffit?.vinyl?.soffitType || '',
      color: jobState.soffit?.vinyl?.color || '',
    },
    porch: {
      location: jobState.soffit?.porch?.location || [],
      footage: jobState.soffit?.porch?.footage || getVal('porchCeiling') || '',
      soffitType: jobState.soffit?.porch?.soffitType || '',
      color: jobState.soffit?.porch?.color || '',
    },
    nailer: {
      type: jobState.soffit?.nailer?.type || '',
      footage: jobState.soffit?.nailer?.footage || getVal('nailerBuildOut') || '',
      soffitType: jobState.soffit?.nailer?.soffitType || '',
      color: jobState.soffit?.nailer?.color || '',
    },
  };

  const handleSubUpdate = (section: string, field: string, value: any) => {
    onUpdate('soffit', section, { ...data[section as keyof typeof data], [field]: value });
  };

  const isSubSectionComplete = (sectionData: any, sectionKey: string) => {
    const footage = n(sectionData.footage);
    if (footage <= 0) return true;
    const locOk =
      sectionKey === 'porch'
        ? Array.isArray(sectionData.location)
          ? sectionData.location.length > 0
          : sectionData.location !== ''
        : true;
    const typeOk = sectionKey !== 'porch' ? sectionData.type !== '' : true;
    const colorOk =
      sectionKey !== 'nailer' ? sectionData.soffitType !== '' && sectionData.color !== '' : true;
    return locOk && typeOk && colorOk;
  };

  const isComplete = React.useMemo(() => {
    const vF = n(data.vinyl.footage);
    const pF = n(data.porch.footage);
    const nF = n(data.nailer.footage);
    if (vF === 0 && pF === 0 && nF === 0) return false;
    return (
      isSubSectionComplete(data.vinyl, 'vinyl') &&
      isSubSectionComplete(data.porch, 'porch') &&
      isSubSectionComplete(data.nailer, 'nailer')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobState.soffit, calculatorData]);

  React.useEffect(() => {
    onUpdate('soffit', 'isComplete', isComplete);
  }, [isComplete, onUpdate]);

  const renderWarning = (message: string) => (
    <View className="flex-row items-center bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
      <Icon name="alert" size={18} color="#D97706" />
      <Text className="text-[11px] font-black text-amber-700 ml-2  tracking-tight">{message}</Text>
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
        className={`text-[10px] font-black  tracking-widest mb-4 ${
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
                className={`text-[11px] font-black  tracking-widest ${
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
          <Text className="text-emerald-500 font-black text-[11px] ml-1 ">
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
    const selectedHex = list.find((c) => c.name === selectedColor)?.hex || '';

    return (
      <View
        className={`p-4 rounded-lg mb-4 ${
          incomplete
            ? 'border-2 border-amber-200 bg-amber-50/30'
            : 'bg-white border border-slate-100'
        }`}
      >
        {incomplete && renderWarning('Incomplete-Color Required')}
        <View className="flex-row justify-between items-center mb-3">
          <Text
            className={`text-[10px] font-black tracking-widest ${
              incomplete ? 'text-amber-600' : 'text-slate-400'
            }`}
          >
            {label}
          </Text>
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
                    c.hex,
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
          <View className="flex-row items-center mt-3 bg-emerald-50 self-start px-2 py-1 rounded-lg">
            <Icon name="check" size={12} color="#10B981" />
            <Text className="text-[10px] font-black text-emerald-600 ml-1">{selectedColor}</Text>
          </View>
        )}
        {image.imageUrl && image.color === selectedHex && (
          <View
            className="mt-3 rounded-xl overflow-hidden border border-slate-100"
            style={{ height: 120 }}
          >
            <Image
              source={{ uri: image.imageUrl }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          </View>
        )}
      </View>
    );
  };

  const renderSubSection = (title: string, sectionKey: string, sectionData: any) => {
    const footage = parseFloat(sectionData.footage || '0');

    return (
      <View
        key={sectionKey}
        className="mb-6 p-1 rounded-lg bg-emerald-50/20 border border-emerald-100/50"
      >
        <View className="p-4">
          <Text className="text-[12px] font-black text-emerald-700  mb-4 tracking-wider">
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
              <Text className="text-[9px] font-black text-slate-400  tracking-widest mb-1">
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
        {n(data.vinyl.footage) > 0 && renderSubSection('Vinyl Soffit', 'vinyl', data.vinyl)}
        {n(data.porch.footage) > 0 && renderSubSection('Porch Ceiling SqFT', 'porch', data.porch)}
        {n(data.nailer.footage) > 0 && renderSubSection('Nailer Build Out', 'nailer', data.nailer)}

        {n(data.vinyl.footage) === 0 &&
          n(data.porch.footage) === 0 &&
          n(data.nailer.footage) === 0 && (
            <View className="p-4 rounded-xl border-2 border-amber-200 bg-amber-50/30">
              {renderWarning('INCOMPLETE - No valid footage found for Soffit section')}
              <View className="p-4 mt-4 rounded-lg bg-white border border-amber-100 flex-row justify-between items-center">
                <View>
                  <Text className="text-[9px] font-black text-slate-400 tracking-widest mb-1">
                    Total Footage
                  </Text>
                  <Text className="text-sm font-black text-slate-900">0 FT</Text>
                </View>
                <Icon name="lock" size={16} color="#919EAB" />
              </View>
            </View>
          )}
      </View>
    </ScrollView>
  );
};
