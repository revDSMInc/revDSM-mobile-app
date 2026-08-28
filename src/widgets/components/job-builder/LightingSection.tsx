import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { COLORS } from './color-constant';
import { NUMERIC_KEYBOARD } from '../../../utils/keyboard-type';

const LOCATIONS = ['LEFT SIDE', 'RIGHT SIDE', 'FRONT', 'REAR', 'GARAGE', 'OTHER'];
const TRACK_MATERIALS = ['Acrylic', 'Aluminum', 'Special Order'];
const MOUNTING_LOCATIONS = ['Soffit', 'Fascia', 'Mixed'];
const SUBSTRATES = ['Vinyl', 'Aluminum', 'Wood', 'Other'];

const WIRE_COLORS = [
  { label: 'White', hex: '#FFFFFF' },
  { label: 'Black', hex: '#1D1D1D' },
  { label: 'Both', hex: 'both' },
];

const COMBINATION_COLORS = ['#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#8E33FF'];

interface LightingSectionProps {
  jobState: any;
  onUpdate: (section: string, field: string, value: any) => void;
  calculatorData: any;
  onValidationError?: (error: string) => void;
}

export const LightingSection = ({
  jobState,
  onUpdate,
  calculatorData,
  onValidationError,
}: LightingSectionProps) => {
  const { colors, isDark } = useTheme();

  const n = (v: any) => parseFloat(v) || 0;
  const getVal = (baseKey: string) => {
    if (!calculatorData) return 0;
    const lowerKey = baseKey.toLowerCase();
    const rk = Object.keys(calculatorData).find((k) => k.toLowerCase() === lowerKey);
    const rv = rk ? n(calculatorData[rk]) : 0;
    if (rv > 0) return rv;
    const extras = calculatorData.extras || {};
    const ek = Object.keys(extras).find((k) => k.toLowerCase() === lowerKey);
    const ev = ek ? n(extras[ek]) : 0;
    if (ev > 0) return ev;
    const inputs = calculatorData.inputs || {};
    const ik = Object.keys(inputs).find((k) => k.toLowerCase() === lowerKey);
    return ik ? n(inputs[ik]) : 0;
  };

  const story1Footage = getVal('lighting1stStory');
  const story2Footage = getVal('lighting2ndStory');
  const story3Footage = getVal('lighting3rdStory');

  const lockedExtras = {
    boosterBox: getVal('lightingBoosterBox'),
    controlBox: getVal('lightingControlBox'),
    electricalOutlet: getVal('lightingElectricalOutlet'),
    wifiExtender: getVal('lightingWifiExtender'),
  };

  const hasExtrasValue = Object.values(lockedExtras).some((v) => v > 0);

  const availableStories = React.useMemo(() => {
    const stories = [];
    if (story1Footage > 0) stories.push({ index: 0, label: '1st Story', footage: story1Footage });
    if (story2Footage > 0) stories.push({ index: 1, label: '2nd Story', footage: story2Footage });
    if (story3Footage > 0) stories.push({ index: 2, label: '3rd Story', footage: story3Footage });
    return stories;
  }, [story1Footage, story2Footage, story3Footage]);

  const hasLightingFootage = availableStories.length > 0;

  const lightingState = jobState.lighting || {
    combinations: [],
    extras: { boosterBox: 0, controlBox: 0, electricalOutlet: 0, wifiExtender: 0 },
  };

  const combinations = lightingState.combinations || [];

  // Initialize combinations
  React.useEffect(() => {
    if (combinations.length === 0 && hasLightingFootage) {
      onUpdate('lighting', 'combinations', [
        {
          id: 1,
          trackColor: '',
          wireColor: '',
          trackMaterial: '',
          mountingLocation: '',
          substrate: '',
          measurements: Array(18).fill(''),
        },
      ]);
      onUpdate('lighting', 'extras', {
        boosterBox: lockedExtras.boosterBox,
        controlBox: lockedExtras.controlBox,
        electricalOutlet: lockedExtras.electricalOutlet,
        wifiExtender: lockedExtras.wifiExtender,
      });
    }
  }, [hasLightingFootage, combinations.length]);

  // Sync locked extras
  React.useEffect(() => {
    const currentExtras = lightingState.extras || {};
    const needsSync = Object.keys(lockedExtras).some((key) => {
      const calcVal = lockedExtras[key as keyof typeof lockedExtras];
      const stateVal = n(currentExtras[key]);
      return calcVal !== stateVal;
    });

    if (needsSync) {
      onUpdate('lighting', 'extras', {
        boosterBox: lockedExtras.boosterBox,
        controlBox: lockedExtras.controlBox,
        electricalOutlet: lockedExtras.electricalOutlet,
        wifiExtender: lockedExtras.wifiExtender,
      });
    }
  }, [calculatorData, lightingState.extras]);

  // Calculate allocated footage per story across all combinations
  const calculateAllocatedFootage = React.useCallback(
    (storyIndex: number) => {
      return combinations.reduce((total: number, combo: any) => {
        const storyMeasurements = (combo.measurements || []).slice(storyIndex * 6, (storyIndex + 1) * 6);
        return total + storyMeasurements.reduce((sum: number, val: any) => sum + n(val), 0);
      }, 0);
    },
    [combinations]
  );

  const story1Allocated = useMemoAllocated(0);
  const story2Allocated = useMemoAllocated(1);
  const story3Allocated = useMemoAllocated(2);

  function useMemoAllocated(storyIdx: number) {
    return React.useMemo(() => calculateAllocatedFootage(storyIdx), [combinations, calculateAllocatedFootage]);
  }

  const story1Remaining = story1Footage - story1Allocated;
  const story2Remaining = story2Footage - story2Allocated;
  const story3Remaining = story3Footage - story3Allocated;

  const flatAllocationCards = React.useMemo(() => {
    const cards = [];
    if (story1Footage > 0)
      cards.push({
        key: 'story-1',
        title: '1st Story',
        available: story1Footage,
        allocated: story1Allocated,
        remaining: story1Remaining,
      });
    if (story2Footage > 0)
      cards.push({
        key: 'story-2',
        title: '2nd Story',
        available: story2Footage,
        allocated: story2Allocated,
        remaining: story2Remaining,
      });
    if (story3Footage > 0)
      cards.push({
        key: 'story-3',
        title: '3rd Story',
        available: story3Footage,
        allocated: story3Allocated,
        remaining: story3Remaining,
      });
    return cards;
  }, [
    story1Footage,
    story2Footage,
    story3Footage,
    story1Allocated,
    story2Allocated,
    story3Allocated,
    story1Remaining,
    story2Remaining,
    story3Remaining,
  ]);

  const updateCombination = (comboId: number, field: string, value: any) => {
    onUpdate(
      'lighting',
      'combinations',
      combinations.map((c: any) => (c.id === comboId ? { ...c, [field]: value } : c))
    );
  };

  const updateCombinationMeasurement = (comboId: number, index: number, value: string) => {
    onUpdate(
      'lighting',
      'combinations',
      combinations.map((combo: any) => {
        if (combo.id !== comboId) return combo;
        const meas = Array(18).fill('');
        (combo.measurements || []).forEach((m: any, i: number) => {
          if (i < 18) meas[i] = m;
        });
        meas[index] = value;
        return { ...combo, measurements: meas };
      })
    );
  };

  const addCombination = () => {
    const newId = Math.max(...combinations.map((c: any) => c.id), 0) + 1;
    onUpdate('lighting', 'combinations', [
      ...combinations,
      {
        id: newId,
        trackColor: '',
        wireColor: '',
        trackMaterial: '',
        mountingLocation: '',
        substrate: '',
        measurements: Array(18).fill(''),
      },
    ]);
  };

  const removeCombination = (comboId: number) => {
    if (combinations.length <= 1) return;
    onUpdate(
      'lighting',
      'combinations',
      combinations.filter((c: any) => c.id !== comboId)
    );
  };

  const getCombinationTotal = (combo: any) => {
    return (combo.measurements || []).reduce((sum: number, val: any) => sum + n(val), 0);
  };

  // Check complete
  const isComplete = React.useMemo(() => {
    if (!hasLightingFootage && hasExtrasValue) return true;
    if (!hasLightingFootage && !hasExtrasValue) return false;
    if (combinations.length === 0) return false;

    const allCombosComplete = combinations.every(
      (combo: any) =>
        combo.trackColor !== '' &&
        combo.wireColor !== '' &&
        combo.trackMaterial !== '' &&
        combo.mountingLocation !== '' &&
        combo.substrate !== ''
    );

    const allAllocated = flatAllocationCards.every((card) => Math.abs(card.remaining) < 0.1);

    return allCombosComplete && allAllocated;
  }, [hasLightingFootage, hasExtrasValue, combinations, flatAllocationCards]);

  React.useEffect(() => {
    onUpdate('lighting', 'isComplete', isComplete);
  }, [isComplete]);

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
    warningMsg = ''
  ) => (
    <View
      className={`p-4 rounded-lg mb-4 ${incomplete ? 'border border-amber-200 bg-amber-50/10' : 'bg-white border border-slate-100'
        }`}
    >
      {incomplete && renderWarning(warningMsg)}
      <Text
        className={`text-[10px] font-black mb-4 ${incomplete ? 'text-amber-600' : 'text-slate-400'
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
              className={`py-3 rounded-xl border-2 items-center justify-center flex-row ${selected ? 'bg-[#22C55E] border-[#22C55E]' : 'bg-white border-slate-100'
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
      {currentValue ? (
        <View className="flex-row items-center mt-3 ml-1">
          <Icon name="check" size={14} color="#10B981" />
          <Text className="text-emerald-500 font-black text-[11px] ml-1">{currentValue}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderColorPicker = (
    label: string,
    selectedColor: string,
    onSelect: (c: string) => void,
    incomplete = false
  ) => {
    const pickerColors = COLORS.Lighting || [
      { name: 'White', hex: '#FFFFFF' },
      { name: 'Black', hex: '#1D1D1D' },
      { name: 'Light Brown', hex: '#C4A882' },
      { name: 'Dark Brown', hex: '#7B4F2E' },
    ];

    return (
      <View
        className={`p-4 rounded-[24px] mb-4 ${incomplete ? 'border border-amber-200 bg-amber-50/10' : 'bg-white border border-slate-100'
          }`}
      >
        {incomplete && renderWarning('Incomplete - Color Required')}
        <Text
          className={`text-[11px] font-black mb-4 ${incomplete ? 'text-amber-600' : 'text-slate-800'
            }`}
        >
          {label}
        </Text>

        <View className="flex-row justify-between mb-2">
          {pickerColors.map((c) => {
            const isSelected = selectedColor === c.name;
            return (
              <TouchableOpacity
                key={c.name}
                onPress={() => onSelect(c.name)}
                className={`relative rounded-xl overflow-hidden border-2 h-14 w-[23%] ${isSelected ? 'border-emerald-500' : 'border-slate-100'
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

        {selectedColor ? (
          <View className="flex-row items-center mt-3 gap-2">
            <View className="flex-row items-center bg-[#22C55E] rounded-full py-1 px-3 border border-emerald-600 shadow-sm">
              <View
                style={{
                  backgroundColor: pickerColors.find((c) => c.name === selectedColor)?.hex || '#FFFFFF',
                }}
                className="w-4 h-4 rounded-[6px] mr-2 border border-white/20"
              />
              <Text className="text-[10px] font-black text-white">{selectedColor}</Text>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const renderWireColorPicker = (
    label: string,
    selectedColor: string,
    onSelect: (c: string) => void,
    incomplete = false
  ) => {
    return (
      <View
        className={`p-4 rounded-[24px] mb-4 ${incomplete ? 'border border-amber-200 bg-amber-50/10' : 'bg-white border border-slate-100'
          }`}
      >
        {incomplete && renderWarning('Incomplete - Wire Color Required')}
        <Text
          className={`text-[11px] font-black mb-4 ${incomplete ? 'text-amber-600' : 'text-slate-800'
            }`}
        >
          {label}
        </Text>

        <View className="flex-row justify-between mb-2">
          {WIRE_COLORS.map((wc) => {
            const isSelected = selectedColor === wc.label;
            const isBoth = wc.hex === 'both';
            return (
              <TouchableOpacity
                key={wc.label}
                onPress={() => onSelect(wc.label)}
                className={`relative rounded-xl overflow-hidden border-2 h-14 w-[31%] items-center justify-center ${isSelected ? 'border-emerald-500' : 'border-slate-100'
                  }`}
                style={
                  isBoth
                    ? { backgroundColor: '#F4F6F8' }
                    : { backgroundColor: wc.hex }
                }
              >
                {isBoth && (
                  <View style={StyleSheet.absoluteFill} className="flex-row">
                    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />
                    <View style={{ flex: 1, backgroundColor: '#1D1D1D' }} />
                  </View>
                )}
                {isSelected && (
                  <View className="absolute top-1 right-1 bg-emerald-500 rounded-full p-0.5 z-10">
                    <Icon name="check" size={10} color="white" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {selectedColor ? (
          <View className="flex-row items-center mt-3 gap-2">
            <View className="flex-row items-center bg-[#22C55E] rounded-full py-1 px-3 border border-emerald-600 shadow-sm">
              <Text className="text-[10px] font-black text-white">{selectedColor}</Text>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const renderSubSection = (combo: any, index: number) => {
    const comboTotal = getCombinationTotal(combo);
    const borderColor = COMBINATION_COLORS[index % COMBINATION_COLORS.length];

    const isComboIncomplete =
      combo.trackColor === '' ||
      combo.wireColor === '' ||
      combo.trackMaterial === '' ||
      combo.mountingLocation === '' ||
      combo.substrate === '';

    return (
      <View
        key={combo.id}
        className="mb-8 p-1 rounded-[24px] bg-white border shadow-sm"
        style={{ borderColor: isComboIncomplete ? '#D97706' : borderColor, borderWidth: 2 }}
      >
        <View className="p-4">
          <View className="flex-row justify-between items-center mb-4">
            <View
              className="px-3 py-1 rounded-lg"
              style={{ backgroundColor: `${borderColor}20` }}
            >
              <Text style={{ color: borderColor }} className="text-[11px] font-black">
                Combination #{index + 1}
              </Text>
            </View>
            {combinations.length > 1 && (
              <TouchableOpacity
                onPress={() => removeCombination(combo.id)}
                className="p-1 rounded-lg bg-red-50 border border-red-100"
              >
                <Icon name="delete-outline" size={18} color="#EF4444" />
              </TouchableOpacity>
            )}
          </View>

          {renderColorPicker(
            'Track Color',
            combo.trackColor,
            (c) => updateCombination(combo.id, 'trackColor', c),
            !combo.trackColor
          )}

          {renderWireColorPicker(
            'Wire Color',
            combo.wireColor,
            (c) => updateCombination(combo.id, 'wireColor', c),
            !combo.wireColor
          )}

          {renderOptionSelector(
            'Track Material',
            TRACK_MATERIALS,
            combo.trackMaterial,
            (v) => updateCombination(combo.id, 'trackMaterial', v),
            !combo.trackMaterial,
            'Incomplete - Track Material Required'
          )}

          {renderOptionSelector(
            'Mounting Location',
            MOUNTING_LOCATIONS,
            combo.mountingLocation,
            (v) => updateCombination(combo.id, 'mountingLocation', v),
            !combo.mountingLocation,
            'Incomplete - Mounting Location Required'
          )}

          {renderOptionSelector(
            'Substrate',
            SUBSTRATES,
            combo.substrate,
            (v) => updateCombination(combo.id, 'substrate', v),
            !combo.substrate,
            'Incomplete - Substrate Required'
          )}

          {/* Measurements grid */}
          <View className="mt-4 p-4 rounded-xl border border-slate-100 bg-slate-50/50">
            <Text className="text-[11px] font-black text-slate-800 mb-4">
              Lighting Measurements
            </Text>

            {/* Grid Header */}
            <View className="flex-row mb-2 border-b border-slate-100 pb-2">
              <View style={{ flex: 1.5 }}>
                <Text className="text-[9px] font-black text-slate-400">Location</Text>
              </View>
              {availableStories.map((story) => (
                <View key={story.index} style={{ flex: 1 }} className="items-center">
                  <Text className="text-[9px] font-black text-slate-400">{story.label}</Text>
                </View>
              ))}
            </View>

            {/* Grid Rows */}
            {LOCATIONS.map((loc, locIndex) => (
              <View key={loc} className="flex-row items-center mb-3">
                <View style={{ flex: 1.5 }}>
                  <Text className="text-[10px] font-black text-slate-700">{loc}</Text>
                </View>
                {availableStories.map((story) => {
                  const measurementIndex = locIndex + story.index * 6;
                  const value = String(combo.measurements[measurementIndex] || '');
                  return (
                    <View key={story.index} style={{ flex: 1, paddingHorizontal: 4 }}>
                      <TextInput
                        className="bg-white border border-slate-200 rounded-lg text-center font-bold text-xs py-2 text-slate-850"
                        keyboardType={NUMERIC_KEYBOARD}
                        returnKeyType="done"
                        placeholder="0"
                        value={value}
                        onChangeText={(text) => {
                          const clean = text.replace(/[^0-9]/g, '');
                          updateCombinationMeasurement(combo.id, measurementIndex, clean);
                        }}
                      />
                    </View>
                  );
                })}
              </View>
            ))}

            <View className="border-t border-slate-100 pt-3 mt-3 items-end">
              <View
                className="px-3 py-1 rounded-lg"
                style={{ backgroundColor: `${borderColor}20` }}
              >
                <Text style={{ color: borderColor }} className="text-[10px] font-black">
                  Combo Total: {comboTotal} FT
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const renderGrandTotalSummary = () => {
    if (!hasLightingFootage || combinations.length === 0) return null;

    const hasAnyData = combinations.some(
      (c: any) =>
        c.trackColor || c.wireColor || c.trackMaterial || c.mountingLocation || getCombinationTotal(c) > 0
    );
    if (!hasAnyData) return null;

    const totalLighting = combinations.reduce(
      (sum: number, combo: any) => sum + getCombinationTotal(combo),
      0
    );

    const lightingColors = COLORS.Lighting || [];
    const wireColorHexMap: Record<string, string> = {
      White: '#FFFFFF',
      Black: '#1D1D1D',
      Both: 'both',
    };

    return (
      <View
        className="rounded-2xl mb-8 overflow-hidden"
        style={{
          borderWidth: 2,
          borderColor: 'rgba(34,197,94,0.4)',
          backgroundColor: 'rgba(34,197,94,0.04)',
        }}
      >
        {/* Header */}
        <View className="px-4 pt-4 pb-3">
          <Text className="text-xs font-black text-[#16A34A] tracking-wide">
            GRAND TOTAL - ALL COMBINATIONS
          </Text>
        </View>

        {/* Combination rows */}
        <View className="px-4 gap-3">
          {combinations.map((combo: any, idx: number) => {
            const comboTotal = getCombinationTotal(combo);
            const borderColor = COMBINATION_COLORS[idx % COMBINATION_COLORS.length];
            const trackColorEntry = lightingColors.find((c: any) => c.name === combo.trackColor);
            const wireHex = wireColorHexMap[combo.wireColor] || null;

            return (
              <View
                key={combo.id}
                className="rounded-xl p-3 bg-white mb-3"
                style={{ borderWidth: 1, borderColor: `${borderColor}33` }}
              >
                {/* Combo badge */}
                <View
                  className="self-start px-3 py-0.5 rounded-md mb-3"
                  style={{ backgroundColor: `${borderColor}18` }}
                >
                  <Text style={{ color: borderColor }} className="text-[10px] font-black">
                    #{idx + 1}
                  </Text>
                </View>

                {/* 2-column grid */}
                <View className="flex-row flex-wrap">
                  {/* Track Color */}
                  <View className="w-1/2 mb-2 pr-2">
                    <Text className="text-[8px] font-black text-slate-400 mb-0.5">Track Color</Text>
                    <View className="flex-row items-center">
                      {trackColorEntry && (
                        <View
                          className="w-3 h-3 rounded-sm mr-1.5"
                          style={{
                            backgroundColor: (trackColorEntry as any).hex,
                            borderWidth: 1,
                            borderColor: '#E2E8F0',
                          }}
                        />
                      )}
                      <Text className="text-[11px] font-black text-slate-800">
                        {combo.trackColor || '—'}
                      </Text>
                    </View>
                  </View>

                  {/* Wire Color */}
                  <View className="w-1/2 mb-2">
                    <Text className="text-[8px] font-black text-slate-400 mb-0.5">Wire Color</Text>
                    <View className="flex-row items-center">
                      {wireHex ? (
                        wireHex === 'both' ? (
                          <View
                            className="w-3 h-3 rounded-sm mr-1.5 overflow-hidden"
                            style={{ borderWidth: 1, borderColor: '#E2E8F0' }}
                          >
                            <View style={StyleSheet.absoluteFill} className="flex-row">
                              <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />
                              <View style={{ flex: 1, backgroundColor: '#1D1D1D' }} />
                            </View>
                          </View>
                        ) : (
                          <View
                            className="w-3 h-3 rounded-sm mr-1.5"
                            style={{
                              backgroundColor: wireHex,
                              borderWidth: 1,
                              borderColor: '#E2E8F0',
                            }}
                          />
                        )
                      ) : null}
                      <Text className="text-[11px] font-black text-slate-800">
                        {combo.wireColor || '—'}
                      </Text>
                    </View>
                  </View>

                  {/* Track Material */}
                  <View className="w-1/2 mb-2 pr-2">
                    <Text className="text-[8px] font-black text-slate-400 mb-0.5">Track Material</Text>
                    <Text className="text-[11px] font-black text-slate-800">
                      {combo.trackMaterial || '—'}
                    </Text>
                  </View>

                  {/* Mounting Location */}
                  <View className="w-1/2 mb-2">
                    <Text className="text-[8px] font-black text-slate-400 mb-0.5">Mounting Location</Text>
                    <Text className="text-[11px] font-black text-slate-800">
                      {combo.mountingLocation || '—'}
                    </Text>
                  </View>

                  {/* Total Footage */}
                  <View className="w-full">
                    <Text className="text-[8px] font-black text-slate-400 mb-0.5">Total Footage</Text>
                    <Text className="text-[13px] font-black text-[#16A34A]">
                      {comboTotal.toFixed(0)} FT
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {/* Grand total footer */}
        <View
          className="mx-4 mt-1 mb-4 pt-3"
          style={{ borderTopWidth: 1, borderTopColor: 'rgba(34,197,94,0.25)' }}
        >
          <Text className="text-sm font-black text-[#16A34A]">
            TOTAL LIGHTING: {totalLighting.toFixed(0)} FT
          </Text>
        </View>
      </View>
    );
  };

  const renderLockedExtras = () => {

    return (
      <View className="p-5 rounded-[24px] bg-slate-50 border border-slate-100 mb-8">
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-xs font-black text-slate-800">Extras</Text>
          <View className="bg-slate-200 px-2 py-0.5 rounded-md">
            <Text className="text-[8px] font-black text-slate-500">Locked from Job summary</Text>
          </View>
        </View>

        <View className="flex-row flex-wrap justify-between gap-y-3">
          {[
            { label: 'Control Box', value: lockedExtras.controlBox },
            { label: 'Booster Box', value: lockedExtras.boosterBox },
            { label: 'Electrical Outlet', value: lockedExtras.electricalOutlet },
            { label: 'WiFi Extender', value: lockedExtras.wifiExtender },
          ].map((item) => (
            <View
              key={item.label}
              className="bg-white border border-slate-100 p-3 rounded-xl flex-row justify-between items-center"
              style={{ width: '48.5%' }}
            >
              <View>
                <Text className="text-[8px] font-black text-slate-400 mb-0.5">{item.label}</Text>
                <Text className="text-sm font-black text-slate-900">{item.value}</Text>
              </View>
              <Icon name="lock" size={14} color="#94A3B8" />
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderTrackerCard = (card: {
    key: string;
    title: string;
    available: number;
    allocated: number;
    remaining: number;
  }) => {
    const isPerfect = Math.abs(card.remaining) < 0.1 && card.allocated > 0;
    const isOver = card.remaining < -0.1;
    return (
      <View
        key={card.key}
        className="py-1 rounded-2xl border-2 flex-1 mx-1"
        style={{
          borderColor: '#A5E1ED',
          backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.05,
          shadowRadius: 15,
          elevation: 2,
        }}
      >
        <Text
          className="text-[8px] font-black text-[#0EA5E9] mb-1 text-center tracking-tight"
          numberOfLines={1}
        >
          {card.title}
        </Text>
        <View className="flex-row justify-between px-1">
          <View className="items-center">
            <Text className="text-[6px] font-bold text-slate-400 mb-1">Avail</Text>
            <Text className="text-sm font-black text-[#7DD3FC]">{card.available.toFixed(0)}</Text>
          </View>
          <View className="items-center">
            <Text className="text-[6px] font-bold text-slate-400 mb-1">Used</Text>
            <Text className="text-sm font-black text-[#F59E0B]">{card.allocated.toFixed(0)}</Text>
          </View>
          <View className="items-center">
            <Text className="text-[6px] font-bold text-slate-400 mb-1">Left</Text>
            <Text
              className={`text-sm font-black ${isOver ? 'text-red-500' : isDark ? 'text-white' : 'text-slate-800'
                }`}
            >
              {card.remaining.toFixed(0)}
            </Text>
          </View>
        </View>
        {isPerfect && (
          <View className="bg-[#22C55E] rounded-xl py-2.5 px-2 mt-1 flex-row items-center justify-center mx-1">
            <Text className="text-white text-[8px] font-black tracking-tight">
              ✓ Perfectly allocated!
            </Text>
          </View>
        )}
        {isOver && (
          <View className="bg-red-500 rounded-xl py-2.5 px-2 mt-1 flex-row items-center justify-center mx-1">
            <Text className="text-white text-[8px] font-black tracking-tight">
              ⚠ Over by {Math.abs(card.remaining).toFixed(0)}ft
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {/* ── Fixed Tracker Strip (same pattern as GutterSection) ── */}
      {hasLightingFootage && flatAllocationCards.length > 0 && (
        <View
          style={{
            backgroundColor: isDark ? '#0F0F0F' : '#F8FAFC',
            paddingHorizontal: 12,
            paddingVertical: 12,
          }}
        >
          <View className="flex-row justify-between">
            {flatAllocationCards.map((card) => renderTrackerCard(card))}
          </View>
        </View>
      )}

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-5 py-5 pb-24 bg-white">
          {/* Tracker is now fixed above — no inline cards here */}

          {/* Render Combinations */}
          {hasLightingFootage && combinations.length > 0 ? (
            <View>
              {combinations.map((combo: any, idx: number) => renderSubSection(combo, idx))}

              <TouchableOpacity
                onPress={addCombination}
                className="py-4 border-2 border-dashed border-sky-400 rounded-2xl items-center justify-center flex-row mb-4"
              >
                <Icon name="plus" size={18} color="#0EA5E9" />
                <Text className="text-sky-500 font-black text-xs ml-2">Add Combination</Text>
              </TouchableOpacity>

              {/* Grand Total Summary — matches web app */}
              {renderGrandTotalSummary()}
            </View>
          ) : null}

          {/* Locked Extras */}
          {hasExtrasValue ? renderLockedExtras() : null}

          {/* Optional Message if no footage and no extras */}
          {!hasLightingFootage && !hasExtrasValue && (
            <View className="p-4 rounded-xl border-2 border-amber-200 bg-amber-50/30">
              {renderWarning('INCOMPLETE - No valid lighting footage found in calculator')}
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
    </View>
  );
};
