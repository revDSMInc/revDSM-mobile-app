import React, { useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { COLORS } from './color-constant';
import { useProductImage } from '../../../hooks/useProductImage';
import { validateLeafFilter } from '../../../utils/job-builder-validation';

const LOCATIONS = ['LEFT SIDE', 'RIGHT SIDE', 'FRONT', 'REAR', 'GARAGE', 'OTHER'];
const STORIES = ['1st Story', '2nd Story', '3rd Story'];
const WIDTH_OPTIONS = ['6"', '7"', '4 & 5"'];
const PROFILE_OPTIONS = ['Versa', 'Versa Max'];
const VERSA_MAX_WIDTHS = ['< 2.5', '2.5 - 3.4', '> 7'];

interface LeafFilterSectionProps {
  jobState: any;
  onUpdate: (section: string, field: string, value: any) => void;
  calculatorData: any;
}

export const LeafFilterSection = ({
  jobState,
  onUpdate,
  calculatorData,
}: LeafFilterSectionProps) => {
  const { colors, isDark } = useTheme();
  const data = jobState.leaffilter || {
    combinations: [],
    extras: { csr: 0, cornersFilter: 0, sawzallHanger: 0, removeProtection: 0, ribbedRoof: 0 },
  };

  const n = (v: any) => parseFloat(v) || 0;

  const handleUpdate = useCallback(
    (field: string, value: any) => {
      onUpdate('leaffilter', field, value);
    },
    [onUpdate]
  );

  // 1. Calculate Available Footage (Parity with web app logic)
  const availableFootage = useMemo(
    () => ({
      '6"': [
        n(calculatorData?.versa6ft1),
        n(calculatorData?.versa6ft2),
        n(calculatorData?.versa6ft3),
      ],
      '7"': [
        n(calculatorData?.versa7ft1),
        n(calculatorData?.versa7ft2),
        n(calculatorData?.versa7ft3),
      ],
      '4 & 5"': [
        n(calculatorData?.filter45ft1),
        n(calculatorData?.filter45ft2),
        n(calculatorData?.filter45ft3),
      ],
      'Versa Max': n(calculatorData?.versaMaxFt1 || calculatorData?.versaMax),
    }),
    [calculatorData]
  );

  // Sync initial state alignment with web app
  useEffect(() => {
    if (data.combinations.length === 0) {
      // Find first available width/profile from calculatorData
      let initialWidth = '';
      let initialProfile = 'Versa';

      if (availableFootage['6"'].some((v) => v > 0)) initialWidth = '6"';
      else if (availableFootage['7"'].some((v) => v > 0)) initialWidth = '7"';
      else if (availableFootage['4 & 5"'].some((v) => v > 0)) initialWidth = '4 & 5"';
      else if (availableFootage['Versa Max'] > 0) {
        initialWidth = '< 2.5';
        initialProfile = 'Versa Max';
      }

      if (initialWidth || initialProfile === 'Versa Max') {
        handleUpdate('combinations', [
          {
            id: Date.now(),
            gutterProfile: 'K-Style',
            lfProfile: initialProfile,
            gutterOpeningWidth: initialWidth,
            lfColor: 'White',
            measurements: Array(18).fill(''),
            isLocked: false,
          },
        ]);
      }
    }
  }, [availableFootage, data.combinations.length, handleUpdate]);

  const { fetchProductImage, image, loading: imageLoading } = useProductImage('leaffilter');

  // 2. Calculate Allocated (Used) Footage per Story/Width
  const getAllocatedForWidth = useCallback(
    (width: string, storyIdx: number) => {
      return data.combinations.reduce((total: number, combo: any) => {
        if (combo.lfProfile === 'Versa Max') return total;
        if (combo.gutterOpeningWidth !== width) return total;
        let storySum = 0;
        for (let l = 0; l < 6; l++) storySum += n(combo.measurements[l * 3 + storyIdx]);
        return total + storySum;
      }, 0);
    },
    [data.combinations]
  );

  const getVersaMaxAllocated = useCallback(() => {
    return data.combinations.reduce((total: number, combo: any) => {
      if (combo.lfProfile !== 'Versa Max') return total;
      return total + combo.measurements.reduce((sum: number, v: any) => sum + n(v), 0);
    }, 0);
  }, [data.combinations]);

  const updateCombo = (idx: number, updates: any) => {
    const next = [...data.combinations];
    next[idx] = { ...next[idx], ...updates };
    handleUpdate('combinations', next);
  };

  const renderAllocationCard = (title: string, avail: number, used: number, totalCount: number) => {
    const left = avail - used;
    const isPerfect = Math.abs(left) < 0.1 && avail > 0;
    const isOver = left < -0.1;
    const isSingle = totalCount === 1;

    return (
      <View
        key={title}
        className={`p-4 rounded-2xl border-2 ${isSingle ? 'w-full' : 'w-44 mr-3'}`}
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
          className="text-[12px] font-black text-[#0EA5E9] uppercase mb-4 text-center tracking-tight"
          numberOfLines={1}
        >
          {title}
        </Text>

        <View className="flex-row justify-between mb-4 px-1">
          <View className="items-center">
            <Text className="text-[9px] font-bold text-slate-400 uppercase mb-1">Avail</Text>
            <Text className="text-sm font-black text-[#0EA5E9]">{avail.toFixed(0)}ft</Text>
          </View>
          <View className="items-center">
            <Text className="text-[9px] font-bold text-slate-400 uppercase mb-1">Used</Text>
            <Text className="text-sm font-black text-amber-500">{used.toFixed(0)}ft</Text>
          </View>
          <View className="items-center">
            <Text className="text-[9px] font-bold text-slate-400 uppercase mb-1">Left</Text>
            <Text
              className={`text-sm font-black ${
                isOver
                  ? 'text-red-500'
                  : isPerfect
                  ? 'text-emerald-500'
                  : isDark
                  ? 'text-white'
                  : 'text-slate-800'
              }`}
            >
              {left.toFixed(0)}ft
            </Text>
          </View>
        </View>

        {isPerfect && (
          <View className="bg-emerald-500 rounded-xl py-2.5 px-2 mt-1 flex-row items-center justify-center">
            <Text className="text-white text-[11px] font-black uppercase tracking-tight">
              ✓ Perfectly allocated!
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {/* ── Fixed Footage Allocation Tracker ── */}
      <View
        style={{
          backgroundColor: isDark ? '#0F0F0F' : '#F0F9FF',
          borderBottomWidth: 1,
          borderBottomColor: isDark ? '#2C2C2E' : '#BAE6FD',
          paddingHorizontal: 20,
          paddingTop: 14,
          paddingBottom: 12,
        }}
      >
        <Text className="text-[10px] font-black text-text-secondary uppercase tracking-widest mb-3 ml-1">
          Footage Allocation
        </Text>
        {(() => {
          const cards = [];
          if (availableFootage['6"'].some((v: number) => v > 0)) {
            STORIES.forEach((s, i) => {
              if (availableFootage['6"'][i] > 0)
                cards.push(
                  renderAllocationCard(
                    `${s} 6"`,
                    availableFootage['6"'][i],
                    getAllocatedForWidth('6"', i),
                    0
                  )
                );
            });
          }
          if (availableFootage['7"'].some((v: number) => v > 0)) {
            STORIES.forEach((s, i) => {
              if (availableFootage['7"'][i] > 0)
                cards.push(
                  renderAllocationCard(
                    `${s} 7"`,
                    availableFootage['7"'][i],
                    getAllocatedForWidth('7"', i),
                    0
                  )
                );
            });
          }
          if (availableFootage['4 & 5"'].some((v: number) => v > 0)) {
            STORIES.forEach((s, i) => {
              if (availableFootage['4 & 5"'][i] > 0)
                cards.push(
                  renderAllocationCard(
                    `${s} 4 & 5"`,
                    availableFootage['4 & 5"'][i],
                    getAllocatedForWidth('4 & 5"', i),
                    0
                  )
                );
            });
          }
          if (availableFootage['Versa Max'] > 0) {
            cards.push(
              renderAllocationCard(
                'Versa Max',
                availableFootage['Versa Max'],
                getVersaMaxAllocated(),
                0
              )
            );
          }

          const finalCards = cards.map((c) => React.cloneElement(c, { totalCount: cards.length }));

          return cards.length === 1 ? (
            <View>{finalCards}</View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {finalCards}
            </ScrollView>
          );
        })()}
      </View>

      {/* ── Scrollable Content ── */}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-5 py-5 pb-24 bg-background">
        <Text className="text-[10px] font-black text-text-secondary uppercase tracking-widest mb-4 ml-1">
          Configurations
        </Text>
        {data.combinations.map((combo: any, idx: number) => {
          const isVersaMax = combo.lfProfile === 'Versa Max';
          const validation = validateLeafFilter(data, calculatorData);
          const isIncomplete =
            !validation.valid &&
            (validation.error?.includes('remaining') ||
              validation.error?.includes('Over-allocated'));

          return (
            <View key={combo.id} className="mb-8">
              {isIncomplete && (
                <View className="flex-row items-center bg-[#FEF3C7] border border-[#FDE68A] rounded-t-2xl px-5 py-3 -mb-1">
                  <Icon name="alert-circle" size={16} color="#D97706" />
                  <Text className="text-[10px] font-black text-[#D97706] ml-2 uppercase tracking-tight">
                    {validation.error}
                  </Text>
                </View>
              )}
              <View
                className={`bg-card rounded-3xl border-2 overflow-hidden shadow-sm ${
                  isIncomplete ? 'rounded-t-none border-[#FDE68A]' : 'border-[#E2E8F0]'
                }`}
                style={!isIncomplete ? { borderColor: '#E2E8F0' } : {}}
              >
                <View className="bg-[#38BDF8] px-6 py-4 flex-row justify-between items-center">
                  <View className="flex-row items-center">
                    <Icon name="numeric" size={18} color="white" />
                    <Text className="text-white font-black text-[10px] ml-2 uppercase tracking-widest">
                      Config #{idx + 1}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() =>
                      handleUpdate(
                        'combinations',
                        data.combinations.filter((c: any) => c.id !== combo.id)
                      )
                    }
                  >
                    <Icon name="close-circle" size={20} color="white" />
                  </TouchableOpacity>
                </View>

                <View className="p-6">
                  {/* Profile Selection - Locked Logic Parity */}
                  <View className="mb-8">
                    <Text className="text-[10px] font-black text-text-secondary uppercase tracking-widest mb-4">
                      Filtration Profile Selection
                    </Text>
                    <View className="flex-row gap-2">
                      {PROFILE_OPTIONS.map((p) => (
                        <TouchableOpacity
                          key={p}
                          onPress={() => updateCombo(idx, { lfProfile: p, gutterOpeningWidth: '' })}
                          className={`flex-1 h-12 rounded-2xl items-center justify-center border-2 ${
                            combo.lfProfile === p
                              ? 'bg-[#38BDF8] border-[#38BDF8]'
                              : isDark
                              ? 'bg-[#1C1C1E] border-[#2C2C2E]'
                              : 'bg-white border-slate-100'
                          }`}
                        >
                          <Text
                            className={`font-black text-[11px] uppercase tracking-wider ${
                              combo.lfProfile === p ? 'text-white' : 'text-slate-400'
                            }`}
                          >
                            {p}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Gutter Opening Width */}
                  <View className="mb-8">
                    {(() => {
                      const widths = isVersaMax ? VERSA_MAX_WIDTHS : WIDTH_OPTIONS;
                      const availableWidths = widths.filter((w) => {
                        const footage = availableFootage[w as keyof typeof availableFootage];
                        return isVersaMax || (Array.isArray(footage) && footage.some((v) => v > 0));
                      });

                      if (availableWidths.length <= 1 && !isVersaMax) {
                        return (
                          <View className="flex-row justify-between items-center bg-slate-50/50 p-1.5 rounded-2xl border border-slate-100">
                            <View className="flex-row items-center bg-[#38BDF8] px-4 py-2.5 rounded-xl shadow-sm">
                              <Icon name="briefcase" size={14} color="#FFFFFF" />
                              <Text className="ml-2 text-[11px] font-black text-white uppercase tracking-tight">
                                Width: {combo.gutterOpeningWidth || availableWidths[0]}
                              </Text>
                            </View>
                            <Text className="mr-3 text-[11px] italic text-slate-400 font-bold uppercase tracking-tighter">
                              Only option available
                            </Text>
                          </View>
                        );
                      }

                      return (
                        <>
                          <Text className="text-[10px] font-black text-text-secondary uppercase tracking-widest mb-4">
                            Opening Width Selection
                          </Text>
                          <View className="flex-row gap-2">
                            {widths.map((w) => {
                              const isSelected = combo.gutterOpeningWidth === w;
                              const footage = availableFootage[w as keyof typeof availableFootage];
                              const isLocked =
                                !isVersaMax &&
                                Array.isArray(footage) &&
                                (footage as number[]).every((v: number) => v === 0);

                              return (
                                <TouchableOpacity
                                  key={w}
                                  disabled={isLocked}
                                  onPress={() => updateCombo(idx, { gutterOpeningWidth: w })}
                                  className={`flex-1 h-12 rounded-2xl items-center justify-center border-2 ${
                                    isSelected
                                      ? 'bg-[#38BDF8] border-[#38BDF8]'
                                      : isDark
                                      ? 'bg-[#1C1C1E] border-[#2C2C2E]'
                                      : 'bg-white border-slate-100'
                                  } ${isLocked ? 'opacity-30' : 'opacity-100'}`}
                                >
                                  <Text
                                    className={`font-black text-[11px] ${
                                      isSelected ? 'text-white' : 'text-slate-400'
                                    }`}
                                  >
                                    {w}
                                  </Text>
                                  {isLocked && (
                                    <View className="absolute top-1 right-1">
                                      <Icon
                                        name="lock"
                                        size={8}
                                        color={isSelected ? 'white' : '#94A3B8'}
                                      />
                                    </View>
                                  )}
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </>
                      );
                    })()}
                  </View>

                  {/* Color Selection */}
                  <View className="mb-6">
                    <View className="flex-row justify-between items-center mb-3">
                      <Text className="text-[10px] font-black text-text-secondary uppercase tracking-widest">
                        LeafFilter Color
                      </Text>
                      {image.imageUrl && image.color === combo.lfColor && (
                        <View className="w-8 h-8 rounded-lg overflow-hidden border border-border">
                          <Image
                            source={{ uri: image.imageUrl }}
                            className="w-full h-full"
                            resizeMode="cover"
                          />
                        </View>
                      )}
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View className="flex-row gap-2.5">
                        {COLORS.LeafFilter.map((c) => (
                          <TouchableOpacity
                            key={c.name}
                            onPress={() => {
                              updateCombo(idx, { lfColor: c.name });
                              fetchProductImage(c.name);
                            }}
                            style={{ backgroundColor: c.hex }}
                            className={`w-10 h-10 rounded-full border-2 ${
                              combo.lfColor === c.name
                                ? 'border-emerald-500 scale-110'
                                : 'border-white shadow-sm'
                            }`}
                          />
                        ))}
                      </View>
                    </ScrollView>
                  </View>

                  {/* Matrix and Totals */}
                  <View className="bg-surface rounded-2xl p-4 mb-4">
                    <View className="flex-row mb-3 px-1">
                      <View className="flex-[1.5]">
                        <Text className="text-[8px] font-black text-text-secondary uppercase">
                          Location
                        </Text>
                      </View>
                      {STORIES.map((s) => (
                        <View key={s} className="flex-1 items-center">
                          <Text className="text-[8px] font-black text-text-secondary uppercase">
                            {s.split(' ')[0]}
                          </Text>
                        </View>
                      ))}
                    </View>
                    {LOCATIONS.map((loc, lIdx) => (
                      <View key={loc} className="flex-row items-center mb-1.5">
                        <View className="flex-[1.5]">
                          <Text className="text-[8px] font-black text-text-primary uppercase">
                            {loc}
                          </Text>
                        </View>
                        {STORIES.map((_, sIdx) => (
                          <View key={sIdx} className="flex-1 px-1">
                            <TextInput
                              value={String(combo.measurements[lIdx * 3 + sIdx] || '')}
                              onChangeText={(v) => {
                                const nextMeas = [...(combo.measurements || Array(18).fill(''))];
                                nextMeas[lIdx * 3 + sIdx] = v;
                                updateCombo(idx, { measurements: nextMeas });
                              }}
                              keyboardType="numeric"
                              placeholder="0"
                              className="h-10 bg-card rounded-lg text-center font-black text-[11px] border border-border"
                            />
                          </View>
                        ))}
                      </View>
                    ))}
                    <View className="mt-4 bg-emerald-500 h-10 rounded-xl items-center justify-center">
                      <Text className="text-white font-black text-[10px] uppercase tracking-widest">
                        Subtotal:{' '}
                        {combo.measurements
                          .reduce((sum: number, v: any) => sum + n(v), 0)
                          .toFixed(0)}{' '}
                        FT
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          );
        })}

        <TouchableOpacity
          onPress={() =>
            handleUpdate('combinations', [
              ...data.combinations,
              {
                id: Date.now(),
                gutterProfile: 'K-Style',
                lfProfile: 'Versa',
                gutterOpeningWidth: '',
                lfColor: '',
                measurements: Array(18).fill(''),
                isLocked: false,
              },
            ])
          }
          className="mb-10 py-5 rounded-3xl border border-dashed border-border items-center justify-center flex-row bg-surface"
        >
          <Icon name="plus" size={18} color="#64748B" />
          <Text className="text-text-secondary font-black text-xs uppercase ml-2 tracking-widest">
            Add Config
          </Text>
        </TouchableOpacity>

        {/* Extras Locked Section */}
        <View className="bg-surface p-6 rounded-[32px] border border-border">
          <View className="flex-row justify-between items-center mb-6">
            <Text className="text-text-primary font-black text-xs uppercase tracking-[2px]">
              Specialized Extras
            </Text>
            <View className="bg-card px-2 py-1 rounded-lg border border-border flex-row items-center">
              <Icon name="lock" size={12} color="#94A3B8" />
              <Text className="text-[8px] font-black text-text-secondary uppercase ml-1">
                Locked
              </Text>
            </View>
          </View>
          <View className="flex-row flex-wrap justify-between">
            {[
              { label: 'CSR', key: 'csr' },
              { label: 'Corners Filter', key: 'cornersFilter' },
              { label: 'Sawzall Hanger', key: 'sawzallHanger' },
              { label: 'Remove Protection', key: 'removeProtection' },
              { label: 'Ribbed Roof', key: 'ribbedRoof' },
            ].map((item) => (
              <View
                key={item.key}
                className="w-[48%] mb-3 bg-card p-4 rounded-2xl border border-border shadow-sm"
              >
                <Text className="text-[8px] font-black text-text-secondary uppercase mb-1">
                  {item.label}
                </Text>
                <TextInput
                  value={String(data.extras[item.key] || '')}
                  onChangeText={(v) => handleUpdate('extras', { ...data.extras, [item.key]: v })}
                  keyboardType="numeric"
                  placeholder="0"
                  className="p-0 font-black text-text-primary text-sm"
                />
              </View>
            ))}
          </View>
        </View>
        </View>
      </ScrollView>
    </View>
  );
};
