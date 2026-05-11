import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { COLORS } from './color-constant';
import { useProductImage } from '../../../hooks/useProductImage';
import { Image, ActivityIndicator } from 'react-native';

const SIZES = ['1X4', '1X6', '1X8', '1X10'];
const BOARD_TYPES = ['PINE', 'CEDAR'];
const TYPE_OPTIONS = ['PARTIAL', 'FULL'];

interface FasciaSectionProps {
  jobState: any;
  onUpdate: (section: string, field: string, value: any) => void;
  calculatorData: any;
  onValidationError?: (error: string) => void;
}

export const FasciaSection = ({
  jobState,
  onUpdate,
  calculatorData,
  onValidationError,
}: FasciaSectionProps) => {
  const { colors, isDark } = useTheme();
  const { fetchProductImage, image, loading: imageLoading } = useProductImage('fascia');
  const [colorModal, setColorModal] = React.useState(false);

  const n = (v: any) => parseFloat(v) || 0;
  const getVal = (baseKey: string) => {
    if (!calculatorData) return 0;
    const lowerKey = baseKey.toLowerCase();
    // Check root
    const topKey = Object.keys(calculatorData).find((k) => k.toLowerCase() === lowerKey);
    const topVal = topKey ? n(calculatorData[topKey]) : 0;
    if (topVal > 0) return topVal;
    // Check extras (fascia/soffit keys live here)
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
    wrap: {
      type: jobState.fascia?.wrap?.type || '',
      footage: jobState.fascia?.wrap?.footage || getVal('trimWrap') || '',
      size: jobState.fascia?.wrap?.size || '',
      color: jobState.fascia?.wrap?.color || '',
    },
    boards: {
      type: jobState.fascia?.boards?.type || '',
      footage: jobState.fascia?.boards?.footage || getVal('fasciaBoard') || '',
      size: jobState.fascia?.boards?.size || '',
      boardType: jobState.fascia?.boards?.boardType || '',
    },
    aluminumBoards: {
      footage: jobState.fascia?.aluminumBoards?.footage || getVal('aluminumFasciaBoard') || '',
    },
  };

  React.useEffect(() => {
    if (data.wrap.color) {
      const hex = COLORS.Fascia.find((c) => c.name === data.wrap.color)?.hex || '';
      if (hex) fetchProductImage(hex);
    }
  }, []);

  const handleSubUpdate = (section: string, field: string, value: any) => {
    onUpdate('fascia', section, { ...data[section as keyof typeof data], [field]: value });
  };

  const isSubSectionComplete = (sectionData: any, sectionKey: string) => {
    const footage = n(sectionData.footage);
    if (footage <= 0) return true;
    if (sectionKey === 'wrap')
      return sectionData.type !== '' && sectionData.size !== '' && sectionData.color !== '';
    if (sectionKey === 'boards')
      return sectionData.type !== '' && sectionData.size !== '' && sectionData.boardType !== '';
    return true;
  };

  const isComplete = React.useMemo(() => {
    const wF = n(data.wrap.footage);
    const bF = n(data.boards.footage);
    const aF = n(data.aluminumBoards.footage);
    if (wF === 0 && bF === 0 && aF === 0) return false;
    return (
      isSubSectionComplete(data.wrap, 'wrap') &&
      isSubSectionComplete(data.boards, 'boards') &&
      isSubSectionComplete(data.aluminumBoards, 'aluminumBoards')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobState.fascia, calculatorData]);

  React.useEffect(() => {
    onUpdate('fascia', 'isComplete', isComplete);
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
    incomplete = false,
    warningMsg = '',
    sectionColor = '#3B82F6'
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
          const selected = currentValue === opt;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onChange(opt)}
              className={`py-3 rounded-xl border-2 items-center justify-center flex-row ${
                selected ? 'bg-[#22C55E] border-[#22C55E]' : 'bg-white border-slate-100'
              }`}
              style={{ width: options.length > 3 ? '31%' : '48.5%' }}
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
      {currentValue && (
        <View className="flex-row items-center mt-3 ml-1">
          <Icon name="check" size={14} color="#10B981" />
          <Text className="text-emerald-500 font-black text-[11px] ml-1 ">{currentValue}</Text>
        </View>
      )}
    </View>
  );

  const renderColorPicker = (
    label: string,
    selectedColor: string,
    onSelect: (c: string) => void,
    incomplete = false
  ) => {
    const upfrontColors = COLORS.Fascia.slice(0, 4);
    const selectedHex =
      COLORS.Fascia.find((c) => c.name === selectedColor)?.hex?.toUpperCase() || '';

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
          <TouchableOpacity onPress={() => setColorModal(true)} className="flex-row items-center">
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
                  fetchProductImage(c.hex);
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

            {image.imageUrl && image.color?.toUpperCase() === selectedHex && (
              <View className="w-10 h-10 rounded-[6px] bg-slate-100 items-center justify-center overflow-hidden border-2 border-white shadow-sm">
                <Image
                  key={image.imageUrl}
                  source={{ uri: image.imageUrl }}
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

  const renderSubSection = (
    title: string,
    sectionKey: string,
    sectionData: any,
    sectionColor = '#3B82F6',
    lightBg = 'bg-blue-50/20',
    borderColor = 'border-blue-100/50'
  ) => {
    const footage = parseFloat(sectionData.footage || '0');

    return (
      <View
        key={sectionKey}
        className="mb-8 p-1 rounded-[24px] bg-white border border-slate-100 shadow-sm"
      >
        <View className="p-4">
          <Text style={{ color: sectionColor }} className="text-[11px] font-black mb-4">
            {title}
          </Text>

          {sectionKey !== 'aluminumBoards' && (
            <View>
              {renderOptionSelector(
                'Type',
                TYPE_OPTIONS,
                sectionData.type,
                (v) => handleSubUpdate(sectionKey, 'type', v),
                !sectionData.type,
                'Incomplete-Type Required',
                sectionColor
              )}
            </View>
          )}

          <View className="p-4 rounded-xl bg-slate-50 border border-slate-100 mb-4 flex-row justify-between items-center">
            <View>
              <Text className="text-[8px] font-black text-slate-400 mb-1">{title} Footage</Text>
              <Text className="text-sm font-black text-slate-900">{footage}</Text>
            </View>
            <Icon name="lock" size={16} color="#94A3B8" />
          </View>

          {sectionKey !== 'aluminumBoards' && (
            <View>
              {renderOptionSelector(
                'Size',
                SIZES,
                sectionData.size,
                (v) => handleSubUpdate(sectionKey, 'size', v),
                !sectionData.size,
                'Incomplete-Size Required',
                sectionColor
              )}

              {sectionKey === 'wrap'
                ? renderColorPicker(
                    'Wrap Color',
                    sectionData.color,
                    (v) => handleSubUpdate(sectionKey, 'color', v),
                    !sectionData.color
                  )
                : renderOptionSelector(
                    'Board Type',
                    BOARD_TYPES,
                    sectionData.boardType,
                    (v) => handleSubUpdate(sectionKey, 'boardType', v),
                    !sectionData.boardType,
                    'Incomplete-Board Type Required',
                    sectionColor
                  )}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-5 py-5 pb-24 bg-white">
          {n(data.wrap.footage) > 0 &&
            renderSubSection(
              'Fascia Wrap',
              'wrap',
              data.wrap,
              '#3B82F6',
              'bg-blue-50/20',
              'border-blue-100/50'
            )}
          {n(data.boards.footage) > 0 &&
            renderSubSection(
              'Fascia Boards',
              'boards',
              data.boards,
              '#F59E0B',
              'bg-amber-50/20',
              'border-amber-100/50'
            )}
          {n(data.aluminumBoards.footage) > 0 &&
            renderSubSection(
              'Aluminum 2"x2" Fascia Board',
              'aluminumBoards',
              data.aluminumBoards,
              '#10B981',
              'bg-emerald-50/20',
              'border-emerald-100/50'
            )}

          {n(data.wrap.footage) === 0 &&
            n(data.boards.footage) === 0 &&
            n(data.aluminumBoards.footage) === 0 && (
              <View className="p-4 rounded-xl border-2 border-amber-200 bg-amber-50/30">
                {renderWarning('INCOMPLETE - No valid footage found for Fascia section')}
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
      <Modal visible={colorModal} transparent animationType="slide">
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-[32px] p-8 max-h-[80%] shadow-2xl">
            <View className="flex-row justify-between items-center mb-8">
              <View>
                <Text className="text-xl font-black text-slate-800">Select Fascia Color</Text>
                <Text className="text-[12px] font-medium text-slate-400 mt-1">
                  Available Colors
                </Text>
              </View>
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => setColorModal(false)}
                className="bg-slate-50 p-2 rounded-full border border-slate-100"
              >
                <Icon name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="flex-row flex-wrap gap-4 justify-between">
                {COLORS.Fascia.map((c) => (
                  <TouchableOpacity
                    key={c.name}
                    onPress={() => {
                      handleSubUpdate('wrap', 'color', c.name);
                      fetchProductImage(c.hex);
                      setColorModal(false);
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
