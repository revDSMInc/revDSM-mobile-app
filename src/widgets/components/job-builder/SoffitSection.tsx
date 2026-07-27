import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal } from 'react-native';
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
  onValidationError?: (error: string) => void;
}

export const SoffitSection = ({
  jobState,
  onUpdate,
  calculatorData,
  onValidationError,
}: SoffitSectionProps) => {
  const { colors, isDark } = useTheme();
  const vinylImage = useProductImage('soffit');
  const porchImage = useProductImage('soffit');

  const [colorModal, setColorModal] = React.useState<{
    visible: boolean;
    sectionKey: string;
  } | null>(null);

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
      <Text className="text-[11px] font-black text-amber-700 ml-2">{message}</Text>
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
        className={`text-[10px] font-black mb-4 ${
          incomplete ? 'text-amber-600' : 'text-slate-400'
        }`}
      >
        {label}
      </Text>
      <View className="flex-row flex-wrap justify-between gap-y-2">
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
              // Fixed 48.5% inline width → exactly two option boxes per row (a clean
              // 2-column grid). The old NativeWind `w-[48.5%]` arbitrary class (decimal
              // percent) didn't reliably compile, so buttons fell back to content width
              // and packed 3 short options into one row.
              style={{ width: '48.5%' }}
              className={`py-3 rounded-xl border-2 items-center justify-center flex-row ${
                selected ? 'bg-[#22C55E] border-[#22C55E]' : 'bg-white border-slate-100'
              }`}
            >
              <Text
                className={`text-[11px] font-black ${selected ? 'text-white' : 'text-slate-500'}`}
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
    sectionKey: string,
    imageState: any,
    fetchFunc: (hex: string, name?: string) => void,
    incomplete = false
  ) => {
    const list =
      soffitType === 'PINHOLE VINYL' ? COLORS['Soffit(Pinhole)'] : COLORS['Soffit(Hidden vent)'];
    const upfrontColors = list.slice(0, 4);
    const selectedHex = list.find((c) => c.name === selectedColor)?.hex?.toUpperCase() || '';

    return (
      <View
        className={`p-4 rounded-[24px] mb-4 ${
          incomplete
            ? 'border-2 border-amber-200 bg-amber-50/30'
            : 'bg-white border border-slate-100'
        }`}
      >
        {incomplete && renderWarning('Incomplete - Color Required')}
        <View className="flex-row justify-between items-center mb-4">
          <Text
            className={`text-[11px] font-black ${incomplete ? 'text-amber-600' : 'text-slate-800'}`}
          >
            {label}
          </Text>
          <TouchableOpacity
            onPress={() => setColorModal({ visible: true, sectionKey })}
            className="flex-row items-center"
          >
            <Text className="text-[11px] font-black text-slate-800 mr-1">More Colors</Text>
            <Icon name="arrow-right" size={14} color="#000" />
          </TouchableOpacity>
        </View>

        <View className="flex-row justify-between mb-4">
          {upfrontColors.map((c) => {
            const isSelected = selectedColor === c.name;
            return (
              <TouchableOpacity
                key={c.name}
                onPress={() => {
                  onSelect(c.name);
                  fetchFunc(c.hex, soffitType === 'PINHOLE VINYL' ? 'soffit Pinhole' : 'soffit ');
                }}
                className={`relative rounded-xl overflow-hidden border-2 h-14 w-[23%] ${
                  isSelected ? 'border-emerald-500' : 'border-slate-100'
                }`}
                style={{
                  backgroundColor: c.hex,
                }}
              >
                {isSelected && (
                  <View className="absolute top-1 right-1 bg-emerald-500 rounded-full p-0.5">
                    <Icon name="check" size={10} color="white" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {selectedColor && (
          <View className="flex-row items-center mt-3 gap-2">
            <View className="flex-row items-center bg-[#22C55E] rounded-full py-1 px-3 border border-emerald-600 shadow-sm">
              <View
                style={{ backgroundColor: selectedHex }}
                className="w-4 h-4 rounded-[6px] mr-2 border border-white/20"
              />
              <Text className="text-[10px] font-black text-white">{selectedColor}</Text>
            </View>

            {imageState.imageUrl && imageState.color?.toUpperCase() === selectedHex && (
              <View className="w-10 h-10 rounded-[6px] bg-slate-100 items-center justify-center overflow-hidden border-2 border-white shadow-sm">
                <Image
                  key={imageState.imageUrl}
                  source={{ uri: imageState.imageUrl }}
                  style={{ width: 40, height: 40 }}
                  resizeMode="contain"
                />
              </View>
            )}
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
        className="mb-8 p-1 rounded-[24px] bg-white border border-slate-100 shadow-sm"
      >
        <View className="p-4">
          <Text className="text-[11px] font-black text-emerald-700 mb-4">{title}</Text>

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

          <View className="p-4 rounded-xl bg-slate-50 border border-slate-100 mb-4 flex-row justify-between items-center">
            <View>
              <Text className="text-[8px] font-black text-slate-400 mb-1">{title} Footage</Text>
              <Text className="text-sm font-black text-slate-900">{footage}</Text>
            </View>
            <Icon name="lock" size={16} color="#94A3B8" />
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
                sectionKey,
                sectionKey === 'vinyl' ? vinylImage.image : porchImage.image,
                sectionKey === 'vinyl'
                  ? vinylImage.fetchProductImage
                  : porchImage.fetchProductImage,
                !sectionData.color
              )}
            </>
          )}
        </View>
      </View>
    );
  };

  React.useEffect(() => {
    // Fetch images for existing colors independently
    if (data.vinyl.color) {
      const hex =
        COLORS['Soffit(Hidden vent)'].find((c) => c.name === data.vinyl.color)?.hex ||
        COLORS['Soffit(Pinhole)'].find((c) => c.name === data.vinyl.color)?.hex ||
        '';
      if (hex)
        vinylImage.fetchProductImage(
          hex,
          data.vinyl.soffitType === 'PINHOLE VINYL' ? 'soffit Pinhole' : 'soffit '
        );
    }
    if (data.porch.color) {
      const hex =
        COLORS['Soffit(Hidden vent)'].find((c) => c.name === data.porch.color)?.hex ||
        COLORS['Soffit(Pinhole)'].find((c) => c.name === data.porch.color)?.hex ||
        '';
      if (hex)
        porchImage.fetchProductImage(
          hex,
          data.porch.soffitType === 'PINHOLE VINYL' ? 'soffit Pinhole' : 'soffit '
        );
    }
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-5 py-5 pb-24 bg-white">
          {n(data.vinyl.footage) > 0 && renderSubSection('Vinyl Soffit', 'vinyl', data.vinyl)}
          {n(data.porch.footage) > 0 && renderSubSection('Porch Ceiling SqFT', 'porch', data.porch)}
          {n(data.nailer.footage) > 0 &&
            renderSubSection('Nailer Build Out', 'nailer', data.nailer)}

          {n(data.vinyl.footage) === 0 &&
            n(data.porch.footage) === 0 &&
            n(data.nailer.footage) === 0 && (
              <View className="p-4 rounded-xl border-2 border-amber-200 bg-amber-50/30">
                {renderWarning('INCOMPLETE - No valid footage found for Soffit section')}
                <View className="p-4 mt-4 rounded-lg bg-white border border-amber-100 flex-row justify-between items-center">
                  <View>
                    <Text className="text-[9px] font-black text-slate-400 mb-1">Total Footage</Text>
                    <Text className="text-sm font-black text-slate-900">0</Text>
                  </View>
                  <Icon name="lock" size={16} color="#919EAB" />
                </View>
              </View>
            )}
        </View>
      </ScrollView>

      {/* ── Color Picker Modal ── */}
      <Modal visible={!!colorModal} transparent animationType="slide">
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-[32px] p-8 max-h-[80%] shadow-2xl">
            <View className="flex-row justify-between items-center mb-8">
              <View>
                <Text className="text-xl font-black text-slate-800">Select Soffit Color</Text>
                <Text className="text-[12px] font-medium text-slate-400 mt-1">
                  {colorModal?.sectionKey} Colors
                </Text>
              </View>
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => setColorModal(null)}
                className="bg-slate-50 p-2 rounded-full border border-slate-100"
              >
                <Icon name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="flex-row flex-wrap gap-4 justify-between">
                {(colorModal
                  ? (data[colorModal.sectionKey as keyof typeof data] as any).soffitType ===
                    'PINHOLE VINYL'
                    ? COLORS['Soffit(Pinhole)']
                    : COLORS['Soffit(Hidden vent)']
                  : []
                ).map((c) => (
                  <TouchableOpacity
                    key={c.name}
                    onPress={() => {
                      const sectionKey = colorModal!.sectionKey;
                      const soffitType = (data[sectionKey as keyof typeof data] as any).soffitType;
                      const fetchFunc =
                        sectionKey === 'vinyl'
                          ? vinylImage.fetchProductImage
                          : porchImage.fetchProductImage;
                      handleSubUpdate(sectionKey, 'color', c.name);
                      fetchFunc(
                        c.hex,
                        soffitType === 'PINHOLE VINYL' ? 'soffit Pinhole' : 'soffit '
                      );
                      setColorModal(null);
                    }}
                    className="items-center w-[22%] mb-4"
                  >
                    <View
                      style={{ backgroundColor: c.hex }}
                      className="w-14 h-14 rounded-2xl border border-slate-100 shadow-sm mb-2"
                    />
                    <Text
                      className="text-[9px] font-black text-center text-slate-600"
                      numberOfLines={1}
                    >
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};
