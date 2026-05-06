import React, { useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  FlatList,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useProductImage } from '../../../hooks/useProductImage';
import { COLORS } from './color-constant';
import { validateGutter } from '../../../utils/job-builder-validation';

const LOCATIONS = ['LEFT SIDE', 'RIGHT SIDE', 'FRONT', 'REAR', 'GARAGE', 'OTHER'];
const STORIES = ['1st Story', '2nd Story', '3rd Story'];
const DOWNSPOUT_TYPES = [
  '2 X 3',
  '3 X 3 (alt)',
  '3 Round (alt)',
  '3 X 4',
  '4 Round (alt)',
  '4 X 5',
];

const autoSelectedDownspoutTypes: any = {
  '5" K-Style': '2 X 3',
  '6" K-Style': '3 X 4',
  '7" K-Style': '4 X 5',
  '8" K-Style': '4 X 5',
};

const downspoutTypeToGutterSize: any = {
  '2 X 3': '5" K-Style',
  '3 X 3 (alt)': '5" K-Style',
  '3 Round (alt)': '5" K-Style',
  '3 X 4': '6" K-Style',
  '4 Round (alt)': '6" K-Style',
  '4 X 5': '7" K-Style',
};

interface GutterSectionProps {
  jobState: any;
  onUpdate: (section: string, field: string, value: any) => void;
  calculatorData: any;
}

export const GutterSection = ({ jobState, onUpdate, calculatorData }: GutterSectionProps) => {
  const { colors, isDark } = useTheme();
  const { fetchProductImage, image, loading: imageLoading } = useProductImage('gutter');
  const [colorModal, setColorModal] = React.useState<{
    show: boolean;
    type: 'gutter' | 'downspout';
    index: number;
  }>({ show: false, type: 'gutter', index: 0 });

  const gutterState = jobState.gutter || {
    partial: '',
    gutterColorsMulti: [],
    downspoutsMulti: [],
    extrasColors: {
      replaceCorner: '',
      extendedSplashGuard: '',
      extendedSplashGuard032: '',
      groundSpout: 'Black',
    },
    modifyHeightLocations: [],
  };

  const handleUpdate = useCallback(
    (updates: any) => {
      onUpdate('gutter', '', { ...gutterState, ...updates });
    },
    [gutterState, onUpdate]
  );

  const n = (v: any) => parseFloat(v) || 0;

  // Helper for case-insensitive key lookup (Parity with web app)
  const getVal = useCallback(
    (baseKey: string) => {
      if (!calculatorData) return 0;
      const lowerKey = baseKey.toLowerCase();
      const key = Object.keys(calculatorData).find((k) => k.toLowerCase() === lowerKey);
      return key ? n(calculatorData[key]) : 0;
    },
    [calculatorData]
  );

  // Footage Calculations (Parity with web app logic)
  const fiveInchFeet = getVal('gutter5Inch');
  const sixInchFeet = getVal('gutter6Inch');
  const sevenInchFeet = getVal('gutter7Inch');
  const eightInchFeet = getVal('gutter8Inch');
  const dsFootageAvail = getVal('downspoutFootage');

  const availableSizes = [
    { label: '5" K-Style', footage: fiveInchFeet },
    { label: '6" K-Style', footage: sixInchFeet },
    { label: '7" K-Style', footage: sevenInchFeet },
    { label: '8" K-Style', footage: eightInchFeet },
  ].filter((s) => s.footage > 0);

  const isMultipleSizes = availableSizes.length > 1;

  const totalAvailableAll =
    fiveInchFeet + sixInchFeet + sevenInchFeet + eightInchFeet + dsFootageAvail;
  const totalAllocatedAll =
    (gutterState.gutterColorsMulti || []).reduce(
      (sum: number, combo: any) =>
        sum + (combo.measurements || []).reduce((s: number, v: any) => s + (parseFloat(v) || 0), 0),
      0
    ) +
    (gutterState.downspoutsMulti || []).reduce(
      (sum: number, ds: any) =>
        sum +
        (parseFloat(ds.footage) || 0) +
        (parseFloat(ds.aElbows) || 0) +
        (parseFloat(ds.bElbows) || 0),
      0
    );

  // Sync initial state alignment with web app
  useEffect(() => {
    if (gutterState.gutterColorsMulti.length === 0 && availableSizes.length > 0) {
      const initialSize = availableSizes[0].label;
      handleUpdate({
        gutterColorsMulti: [
          {
            id: Date.now(),
            size: initialSize,
            color: 'White',
            measurements: Array(18).fill(''),
            mitersOutside: '',
            mitersInside: '',
            endCapsRights: '',
            endCapsLefts: '',
          },
        ],
      });
    }
  }, [availableSizes.length, gutterState.gutterColorsMulti.length, handleUpdate]);

  useEffect(() => {
    if (gutterState.downspoutsMulti.length === 0 && availableSizes.length > 0) {
      const initialSize = availableSizes[0].label;
      const initialType = autoSelectedDownspoutTypes[initialSize] || '2 X 3';
      handleUpdate({
        downspoutsMulti: [
          {
            id: Date.now() + 1,
            type: initialType,
            color: 'White',
            footage: '',
            aElbows: '',
            bElbows: '',
            roundElbow: '',
            offsetElbows: '',
            spoutSavers: '',
          },
        ],
      });
    }
  }, [availableSizes.length, gutterState.downspoutsMulti.length, handleUpdate]);
  const getStoryAllocation = (size: string) => {
    const gutterFeet = (gutterState.gutterColorsMulti || []).reduce((sum: number, combo: any) => {
      if (combo.size !== size) return sum;
      return (
        sum + (combo.measurements || []).reduce((s: number, v: any) => s + (parseFloat(v) || 0), 0)
      );
    }, 0);

    const dsFeet = (gutterState.downspoutsMulti || []).reduce((sum: number, ds: any) => {
      const dsGutterSize = downspoutTypeToGutterSize[ds.type];
      if (dsGutterSize !== size) return sum;
      return (
        sum +
        (parseFloat(ds.footage) || 0) +
        (parseFloat(ds.aElbows) || 0) +
        (parseFloat(ds.bElbows) || 0)
      );
    }, 0);

    return gutterFeet + dsFeet;
  };

  const renderAllocationCard = (size: string, available: number) => {
    const allocated = getStoryAllocation(size);
    // Add DS pool to available if this is the only size or if mapped
    const totalAvail = available + (availableSizes.length === 1 ? dsFootageAvail : 0);
    const remaining = totalAvail - allocated;
    const isSingle = availableSizes.length === 1;

    return (
      <View
        key={size}
        className={`py-1 rounded-2xl border-2 ${isSingle ? 'w-full' : 'flex-1'}`}
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
          className="text-[8px] font-black text-[#0EA5E9]  mb-1 text-center tracking-tight"
          numberOfLines={1}
        >
          {size}
        </Text>

        <View className="flex-row justify-between px-1">
          <View className="items-center">
            <Text className="text-[6px] font-bold text-slate-400  mb-1">Avail</Text>
            <Text className="text-sm font-black text-[#7DD3FC]">{totalAvail.toFixed(0)}ft</Text>
          </View>
          <View className="items-center">
            <Text className="text-[6px] font-bold text-slate-400  mb-1">Used</Text>
            <Text className="text-sm font-black text-[#F59E0B]">{allocated.toFixed(0)}ft</Text>
          </View>
          <View className="items-center">
            <Text className="text-[6px] font-bold text-slate-400  mb-1">Left</Text>
            <Text
              className={`text-sm font-black ${
                remaining < -0.1 ? 'text-red-500' : isDark ? 'text-white' : 'text-slate-800'
              }`}
            >
              {remaining.toFixed(1)}ft
            </Text>
          </View>
        </View>

        {Math.abs(remaining) <= 0.1 && totalAvail > 0 && isSingle && (
          <View className="bg-[#22C55E] rounded-xl py-2.5 px-2 mt-1 flex-row items-center justify-center">
            <Text className="text-white text-[8px] font-black  tracking-tight">
              ✓ Perfectly allocated!
            </Text>
          </View>
        )}

        {remaining < -0.1 && (
          <View className="bg-[#FF4D4F] rounded-xl py-2.5 px-2 mt-1 flex-row items-center justify-center">
            <Icon name="alert" size={14} color="white" />
            <Text className="text-white text-[10px] font-black  tracking-tight ml-2">
              OVER {Math.abs(remaining).toFixed(1)}ft
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
        className="bg-background"
        style={{
          paddingHorizontal: 20,
          paddingTop: 8,
        }}
      >
        {availableSizes.length === 1 ? (
          <View>{availableSizes.map((s) => renderAllocationCard(s.label, s.footage))}</View>
        ) : (
          <View className="flex-row gap-2 justify-between">
            {availableSizes.map((s) => renderAllocationCard(s.label, s.footage))}
          </View>
        )}
      </View>

      {/* ── Validation Summary Section ── */}
      {(() => {
        const errors: string[] = [];

        // 1. Partial Check
        const hasPartial =
          gutterState.partial || (gutterState.gutterColorsMulti || []).some((c: any) => c.partial);
        if (!hasPartial) errors.push('Partial selection required');

        // 2. Footage checks
        availableSizes.forEach((s) => {
          const allocated = getStoryAllocation(s.label);
          const totalAvail = s.footage + (availableSizes.length === 1 ? dsFootageAvail : 0);
          const remaining = totalAvail - allocated;
          if (Math.abs(remaining) > 0.1) {
            if (remaining > 0) {
              errors.push(`${s.label}: ${remaining.toFixed(1)}ft unallocated`);
            } else {
              errors.push(`${s.label}: Over-allocated by ${Math.abs(remaining).toFixed(1)}ft`);
            }
          }
        });

        // 3. Combos check (colors, miters, endcaps)
        (gutterState.gutterColorsMulti || []).forEach((combo: any, idx: number) => {
          const comboTotal = (combo.measurements || []).reduce((s: number, v: any) => s + n(v), 0);
          if (comboTotal > 0) {
            if (!combo.color) errors.push(`Combo #${idx + 1}: No color`);
            if (
              combo.mitersOutside === '' ||
              combo.mitersInside === '' ||
              combo.endCapsRights === '' ||
              combo.endCapsLefts === ''
            ) {
              errors.push(`Combo #${idx + 1}: Missing Miters/Endcaps`);
            }
          }
        });

        // 4. Downspouts check
        (gutterState.downspoutsMulti || []).forEach((ds: any, idx: number) => {
          const dsTotal = n(ds.footage) + n(ds.aElbows) + n(ds.bElbows);
          if (dsTotal > 0) {
            if (!ds.type) errors.push(`DS #${idx + 1}: No type`);
            if (!ds.color) errors.push(`DS #${idx + 1}: No color`);
          }
        });

        if (errors.length === 0) return null;

        return (
          <View className="px-5 py-3 bg-amber-50/50 border-b border-amber-100">
            <View className="flex-row items-center mb-2">
              <Icon name="alert-circle" size={14} color="#D97706" />
              <Text className="text-[10px] font-black text-amber-700 ml-2  tracking-widest">
                Incomplete Requirements
              </Text>
            </View>
            <View className="flex-row flex-wrap gap-2">
              {errors.map((err, i) => (
                <View
                  key={i}
                  className="bg-white border border-amber-200 px-3 py-1.5 rounded-lg shadow-sm"
                >
                  <Text className="text-[10px] font-bold text-amber-800">{err}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      })()}

      {/* ── Scrollable Content ── */}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-5 py-5 pb-24 bg-background">
          {/* Warnings moved inside Combination cards for better context parity */}

          {/* Gutter Combinations */}
          <Text className="text-[10px] font-black text-text-secondary  tracking-widest mb-4 ml-1">
            Combinations
          </Text>
          {(gutterState.gutterColorsMulti || []).map((combo: any, idx: number) => {
            const validation = validateGutter(gutterState, calculatorData);
            const isIncomplete =
              !validation.valid &&
              (validation.error?.includes('remaining') ||
                validation.error?.includes('Over-allocated'));

            return (
              <View key={combo.id} className="mb-8">
                {isIncomplete && (
                  <View className="flex-row items-center bg-[#FEF3C7] border-x-2 border-t-2 border-[#FDE68A] rounded-t-[32px] px-6 py-3.5 -mb-1">
                    <Icon name="alert-circle" size={18} color="#D97706" />
                    <Text className="text-[11px] font-black text-[#D97706] ml-2  tracking-tight">
                      {validation.error}
                    </Text>
                  </View>
                )}
                <View
                  className={`bg-card rounded-[32px] border-2 overflow-hidden shadow-sm ${
                    isIncomplete ? 'rounded-t-none border-[#FDE68A]' : 'border-[#6366F122]'
                  }`}
                  style={!isIncomplete ? { borderColor: 'rgba(99, 102, 241, 0.15)' } : {}}
                >
                  <View className="px-6 py-4 flex-row justify-between items-center bg-white border-b border-slate-50">
                    <View className="flex-row items-center">
                      {availableSizes.length === 1 && (
                        <View className="bg-[#7DD3FC] px-4 py-2.5 rounded-2xl flex-row items-center shadow-sm">
                          <Icon name="lock" size={14} color="white" />
                          <Text className="text-white font-black text-[10px] ml-2  tracking-tight">
                            {combo.size}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View className="flex-row items-center">
                      {availableSizes.length === 1 && (
                        <Text className="text-[10px] italic text-slate-400 font-bold  tracking-tighter mr-3">
                          Only option available
                        </Text>
                      )}
                      {gutterState.gutterColorsMulti.length > 1 && (
                        <TouchableOpacity
                          onPress={() =>
                            handleUpdate({
                              gutterColorsMulti: gutterState.gutterColorsMulti.filter(
                                (c: any) => c.id !== combo.id
                              ),
                            })
                          }
                        >
                          <Icon name="close-circle" size={20} color="#94A3B8" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  <View className="p-6">
                    {/* Gutter Partial Selector - Screenshot Parity */}
                    <View className="mb-8">
                      <Text className="text-[10px] font-black text-text-secondary mb-3  tracking-widest">
                        Gutter Partial?
                      </Text>
                      <View className="flex-row gap-4">
                        {['Yes', 'No'].map((val) => (
                          <TouchableOpacity
                            key={val}
                            onPress={() => {
                              const newCombos = [...gutterState.gutterColorsMulti];
                              newCombos[idx].partial = val;
                              handleUpdate({ gutterColorsMulti: newCombos });
                            }}
                            className={`flex-1 h-12 rounded-2xl items-center justify-center border-2 ${
                              combo.partial === val
                                ? 'bg-[#82D995] border-[#82D995]'
                                : isDark
                                ? 'bg-[#1C1C1E] border-[#2C2C2E]'
                                : 'bg-white border-slate-100'
                            }`}
                          >
                            <Text
                              className={`font-black  text-[11px] tracking-widest ${
                                combo.partial === val ? 'text-white' : 'text-slate-400'
                              }`}
                            >
                              {val}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {combo.partial === 'Yes' && (
                        <Text className="mt-2 text-[#82D995] text-[10px] font-bold ml-1">
                          ✓ Yes
                        </Text>
                      )}
                    </View>
                    <View className="mb-8">
                      {availableSizes.length > 1 && (
                        <>
                          <Text className="text-[10px] font-black text-text-secondary  tracking-widest mb-4">
                            Gutter Size Selection
                          </Text>
                          <View className="flex-row gap-2">
                            {availableSizes.map((s) => (
                              <TouchableOpacity
                                key={s.label}
                                onPress={() => {
                                  const newCombos = [...gutterState.gutterColorsMulti];
                                  newCombos[idx].size = s.label;
                                  handleUpdate({ gutterColorsMulti: newCombos });
                                }}
                                className={`flex-1 h-12 rounded-2xl items-center justify-center border-2 ${
                                  combo.size === s.label
                                    ? 'bg-[#22C55E] border-[#22C55E]'
                                    : isDark
                                    ? 'bg-[#1C1C1E] border-[#2C2C2E]'
                                    : 'bg-white border-slate-100'
                                }`}
                              >
                                <Text
                                  className={`font-black text-[11px]  tracking-wider ${
                                    combo.size === s.label ? 'text-white' : 'text-slate-400'
                                  }`}
                                >
                                  {s.label}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </>
                      )}
                    </View>

                    {/* Color Picker */}
                    <View className="mb-6">
                      <View className="flex-row justify-between items-center mb-3">
                        <Text className="text-[10px] font-black text-text-secondary  tracking-widest">
                          Color
                        </Text>
                        <TouchableOpacity
                          onPress={() => setColorModal({ show: true, type: 'gutter', index: idx })}
                          className="flex-row items-center"
                        >
                          <Text className="text-[#38BDF8] text-[10px] font-bold  mr-1">
                            More Colors
                          </Text>
                          <Icon name="arrow-right" size={12} color="#38BDF8" />
                        </TouchableOpacity>
                      </View>
                      <View>
                        <View className="flex-row gap-2.5">
                          {COLORS.Gutter.slice(0, 4).map((c) => (
                            <TouchableOpacity
                              key={c.name}
                              onPress={() => {
                                const newCombos = [...gutterState.gutterColorsMulti];
                                newCombos[idx].color = c.name;
                                handleUpdate({ gutterColorsMulti: newCombos });
                                fetchProductImage(c.name);
                              }}
                              style={{ backgroundColor: c.hex }}
                              className={`w-[23%] h-12 rounded-lg border-2 ${
                                combo.color === c.name
                                  ? 'border-[#22C55E]'
                                  : 'border-white shadow-sm'
                              }`}
                            >
                              {combo.color === c.name && (
                                <View className="absolute top-1 right-1 bg-[#22C55E] w-5 h-5 rounded-full items-center justify-center">
                                  <Icon name="check" size={10} color="white" />
                                </View>
                              )}
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                      {combo.color !== '' && (
                        <View className="mt-3 flex-row items-center">
                          <View className="bg-[#DCFCE7] px-3 py-1.5 rounded-xl flex-row items-center border border-[#BBF7D0]">
                            <View
                              style={{
                                backgroundColor:
                                  COLORS.Gutter.find((c) => c.name === combo.color)?.hex || '#000',
                              }}
                              className="w-3 h-3 rounded-full mr-2 border border-white"
                            />
                            <Text className="text-[#166534] text-[10px] font-black ">
                              ✓ {combo.color}
                            </Text>
                          </View>
                        </View>
                      )}
                    </View>

                    {/* Measurements Matrix - Web App Style */}
                    <View className="bg-surface rounded-2xl p-4 mb-4">
                      <View className="flex-row mb-3 px-1">
                        <View className="flex-[1.5]">
                          <Text className="text-[8px] font-black text-text-secondary ">
                            Location
                          </Text>
                        </View>
                        {STORIES.map((s) => (
                          <View key={s} className="flex-1 items-center">
                            <Text className="text-[8px] font-black text-text-secondary ">
                              {s.split(' ')[0]}
                            </Text>
                          </View>
                        ))}
                      </View>
                      {LOCATIONS.map((loc, lIdx) => (
                        <View key={loc} className="flex-row items-center mb-1.5">
                          <View className="flex-[1.5]">
                            <Text className="text-[8px] font-black text-text-primary ">{loc}</Text>
                          </View>
                          {STORIES.map((_, sIdx) => (
                            <View key={sIdx} className="flex-1 px-1">
                              <TextInput
                                value={String(combo.measurements[lIdx * 3 + sIdx] || '')}
                                onChangeText={(v) => {
                                  const newCombos = [...gutterState.gutterColorsMulti];
                                  newCombos[idx].measurements[lIdx * 3 + sIdx] = v;
                                  handleUpdate({ gutterColorsMulti: newCombos });
                                }}
                                keyboardType="numeric"
                                placeholder="0"
                                placeholderTextColor="#CBD5E1"
                                className="h-10 bg-white rounded-lg text-center font-black text-[11px] border border-slate-100"
                              />
                            </View>
                          ))}
                        </View>
                      ))}
                      <View className="flex-row items-center mt-3 pt-3 border-t border-slate-100">
                        <View className="flex-[1.5]">
                          <Text className="text-[8px] font-black text-text-primary ">TOTAL</Text>
                        </View>
                        {STORIES.map((_, sIdx) => {
                          const storyTotal = LOCATIONS.reduce(
                            (sum, __, lIdx) =>
                              sum + parseFloat(combo.measurements[lIdx * 3 + sIdx] || '0'),
                            0
                          );
                          return (
                            <View key={sIdx} className="flex-1 px-1">
                              <View className="h-10 bg-[#E0F2FE] rounded-lg items-center justify-center border border-[#BAE6FD]">
                                <Text className="text-[10px] font-black text-[#0369A1]">
                                  {storyTotal}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>

                    <TouchableOpacity className="bg-[#82D995] h-12 rounded-[20px] items-center justify-center mb-8 shadow-sm">
                      <Text className="text-white font-black text-[13px]  tracking-tight">
                        Grand Total:{' '}
                        {combo.measurements?.reduce(
                          (s: number, d: any) => s + (parseFloat(d) || 0),
                          0
                        ) || 0}{' '}
                        ft
                      </Text>
                    </TouchableOpacity>

                    {/* Accessories Grid - Screenshot 2 Parity */}
                    <View className="mb-2">
                      <Text className="text-[11px] font-black text-[#64748B] mb-4 ml-1  tracking-widest">
                        Miters & End Caps
                      </Text>
                      {[
                        { label: '# of Miters (Outside) *', key: 'mitersOutside' },
                        { label: '# of Miters (Inside) *', key: 'mitersInside' },
                        { label: '# End Caps (Rights) *', key: 'endCapsRights' },
                        { label: '# End Caps (Lefts) *', key: 'endCapsLefts' },
                      ].map((item) => {
                        const hasMeas = (combo.measurements || []).some(
                          (m: any) => parseFloat(m) > 0
                        );
                        const isMissing =
                          hasMeas && (combo[item.key] === '' || combo[item.key] === undefined);

                        return (
                          <View key={item.key} className="mb-4">
                            <TextInput
                              value={String(combo[item.key] || '')}
                              onChangeText={(v) => {
                                const newCombos = [...gutterState.gutterColorsMulti];
                                newCombos[idx][item.key] = v;
                                handleUpdate({ gutterColorsMulti: newCombos });
                              }}
                              keyboardType="numeric"
                              placeholder={item.label}
                              placeholderTextColor="#94A3B8"
                              className={`h-14 px-6 rounded-2xl font-black text-slate-800 text-[13px] border-2 ${
                                isMissing
                                  ? 'bg-[#FFF1F0] border-[#FF4D4F]'
                                  : isDark
                                  ? 'bg-[#1C1C1E] border-[#2C2C2E]'
                                  : 'bg-white border-slate-100'
                              }`}
                            />
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>
              </View>
            );
          })}

          <TouchableOpacity
            onPress={() => {
              const defaultSize = availableSizes[0]?.label || '6" K-Style';
              handleUpdate({
                gutterColorsMulti: [
                  ...(gutterState.gutterColorsMulti || []),
                  {
                    id: Date.now(),
                    size: defaultSize,
                    color: '',
                    measurements: Array(18).fill(''),
                    mitersOutside: '',
                    mitersInside: '',
                    endCapsRights: '',
                    endCapsLefts: '',
                  },
                ],
              });
            }}
            className="mb-10 py-5 rounded-3xl border border-dashed border-border items-center justify-center flex-row bg-surface"
          >
            <Icon name="plus" size={18} color="#64748B" />
            <Text className="text-text-secondary font-black text-xs  ml-2 tracking-widest">
              Add Combination
            </Text>
          </TouchableOpacity>

          {/* Downspouts Header with Dashed Lines */}
          <View className="flex-row items-center mb-8 mt-4 px-2">
            <View
              className="flex-1 h-[1px] bg-slate-200"
              style={{ borderStyle: 'dashed', borderWidth: 1 }}
            />
            <Text className="mx-4 text-[10px] font-black text-slate-500  tracking-[3px]">
              Downspouts & Accessories
            </Text>
            <View
              className="flex-1 h-[1px] bg-slate-200"
              style={{ borderStyle: 'dashed', borderWidth: 1 }}
            />
          </View>

          {(gutterState.downspoutsMulti || []).map((ds: any, idx: number) => (
            <View key={ds.id} className="mb-8">
              <View
                className={`bg-card rounded-[32px] border-2 overflow-hidden shadow-sm border-[#6366F111]`}
              >
                <View className="px-6 py-4 flex-row justify-between items-center bg-white border-b border-slate-50">
                  <Text className="text-slate-800 font-black text-[10px]  tracking-widest">
                    Downspout #{idx + 1}
                  </Text>
                  {gutterState.downspoutsMulti.length > 1 && (
                    <TouchableOpacity
                      onPress={() =>
                        handleUpdate({
                          downspoutsMulti: gutterState.downspoutsMulti.filter(
                            (d: any) => d.id !== ds.id
                          ),
                        })
                      }
                    >
                      <Icon name="close-circle" size={20} color="#94A3B8" />
                    </TouchableOpacity>
                  )}
                </View>
                <View className="p-6">
                  <Text className="text-[10px] font-black text-text-secondary  tracking-widest mb-3">
                    Type
                  </Text>
                  <View className="flex-row gap-2 mb-3">
                    {DOWNSPOUT_TYPES.slice(0, 2).map((type) => (
                      <TouchableOpacity
                        key={type}
                        onPress={() => {
                          const newDS = [...gutterState.downspoutsMulti];
                          newDS[idx].type = type;
                          handleUpdate({ downspoutsMulti: newDS });
                        }}
                        className={`flex-1 h-12 rounded-2xl items-center justify-center border-2 ${
                          ds.type === type
                            ? 'bg-[#22C55E] border-[#22C55E]'
                            : isDark
                            ? 'bg-[#1C1C1E] border-[#2C2C2E]'
                            : 'bg-white border-slate-100'
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-black  tracking-tight ${
                            ds.type === type ? 'text-white' : 'text-slate-400'
                          }`}
                        >
                          {type}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      const newDS = [...gutterState.downspoutsMulti];
                      newDS[idx].type = DOWNSPOUT_TYPES[2];
                      handleUpdate({ downspoutsMulti: newDS });
                    }}
                    className={`h-12 rounded-2xl items-center justify-center border-2 mb-6 ${
                      ds.type === DOWNSPOUT_TYPES[2]
                        ? 'bg-[#22C55E] border-[#22C55E]'
                        : isDark
                        ? 'bg-[#1C1C1E] border-[#2C2C2E]'
                        : 'bg-white border-slate-100'
                    }`}
                  >
                    <Text
                      className={`text-[10px] font-black  tracking-tight ${
                        ds.type === DOWNSPOUT_TYPES[2] ? 'text-white' : 'text-slate-400'
                      }`}
                    >
                      {DOWNSPOUT_TYPES[2]}
                    </Text>
                  </TouchableOpacity>

                  {/* Color Grid for DS */}
                  <View className="mb-6">
                    <View className="flex-row justify-between items-center mb-3">
                      <Text className="text-[10px] font-black text-text-secondary  tracking-widest">
                        Downspout Color
                      </Text>
                      <TouchableOpacity
                        onPress={() => setColorModal({ show: true, type: 'downspout', index: idx })}
                        className="flex-row items-center"
                      >
                        <Text className="text-[#38BDF8] text-[10px] font-bold  mr-1">
                          More Colors
                        </Text>
                        <Icon name="arrow-right" size={12} color="#38BDF8" />
                      </TouchableOpacity>
                    </View>
                    <View>
                      <View className="flex-row gap-2.5">
                        {COLORS.Gutter.slice(0, 4).map((c) => (
                          <TouchableOpacity
                            key={c.name}
                            onPress={() => {
                              const newDS = [...gutterState.downspoutsMulti];
                              newDS[idx].color = c.name;
                              handleUpdate({ downspoutsMulti: newDS });
                            }}
                            style={{ backgroundColor: c.hex }}
                            className={`w-[23%] h-12 rounded-lg border-2 ${
                              ds.color === c.name ? 'border-[#22C55E]' : 'border-white shadow-sm'
                            }`}
                          >
                            {ds.color === c.name && (
                              <View className="absolute top-1 right-1 bg-[#22C55E] w-5 h-5 rounded-full items-center justify-center">
                                <Icon name="check" size={10} color="white" />
                              </View>
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  </View>

                  <View className="gap-3">
                    {[
                      { label: 'Downspout Footage (ft)', key: 'footage' },
                      { label: '# of A Elbows (1=1FT)', key: 'aElbows' },
                      { label: '# of B Elbows', key: 'bElbows' },
                      { label: '# of Round Elbow', key: 'roundElbow' },
                      { label: '# of Offset Elbows', key: 'offsetElbows' },
                      { label: '# of Spout Savers', key: 'spoutSavers' },
                    ].map((item) => (
                      <View key={item.key} className="mb-0">
                        <TextInput
                          value={String(ds[item.key] || '')}
                          onChangeText={(v) => {
                            const newDS = [...gutterState.downspoutsMulti];
                            newDS[idx][item.key] = v;
                            handleUpdate({ downspoutsMulti: newDS });
                          }}
                          keyboardType="numeric"
                          placeholder={item.label}
                          placeholderTextColor="#94A3B8"
                          className={`h-14 px-5 rounded-2xl font-black text-slate-800 text-[13px] border-2 ${
                            isDark ? 'bg-[#1C1C1E] border-[#2C2C2E]' : 'bg-white border-slate-100'
                          }`}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          ))}

          <TouchableOpacity
            onPress={() =>
              handleUpdate({
                downspoutsMulti: [
                  ...(gutterState.downspoutsMulti || []),
                  {
                    id: Date.now(),
                    type: '2 X 3',
                    color: '',
                    footage: '',
                    aElbows: '',
                    bElbows: '',
                    roundElbow: '',
                    offsetElbows: '',
                    spoutSavers: '',
                  },
                ],
              })
            }
            className="mb-10 py-5 rounded-3xl border border-dashed border-border items-center justify-center flex-row bg-surface"
          >
            <Icon name="plus" size={18} color="#64748B" />
            <Text className="text-text-secondary font-black text-xs  ml-2 tracking-widest">
              Add Downspout
            </Text>
          </TouchableOpacity>

          {/* Extras Locked Section - Screenshot 2 Parity */}
          <View
            className={`rounded-[32px] border-2 overflow-hidden shadow-sm mb-10 ${
              isDark ? 'bg-[#1C1C1E] border-[#2C2C2E]' : 'bg-white border-slate-50'
            }`}
          >
            <View className="px-6 py-5 flex-row justify-between items-center border-b border-slate-50 bg-[#F8FAFC]">
              <Text className="text-[12px] font-black text-[#22C55E]  tracking-widest">Extras</Text>
              <View className="bg-black px-4 py-2 rounded-xl flex-row items-center">
                <Text className="text-white text-[9px] font-black  tracking-tight">
                  Locked from Job Summary
                </Text>
              </View>
            </View>

            <View>
              {[
                { label: 'Wedges', val: calculatorData?.wedges, unit: 'QTY' },
                { label: 'Straps', val: calculatorData?.straps, unit: 'QTY' },
                {
                  label: 'Modify Height/R&R',
                  val: calculatorData?.modifyHeight,
                  unit: 'FT',
                  key: 'modifyHeight',
                },
                {
                  label: 'GroundSpout',
                  val: calculatorData?.groundSpout,
                  unit: 'FT',
                  key: 'groundSpout',
                  hasColor: true,
                },
                {
                  label: 'Replace Corner Miter',
                  val: calculatorData?.replaceCorner,
                  unit: 'FT',
                  key: 'replaceCorner',
                  hasColor: true,
                },
                {
                  label: 'Extended Splash Guard',
                  val: calculatorData?.extendedSplashGuard,
                  unit: 'FT',
                  key: 'extendedSplashGuard',
                  hasColor: true,
                },
                {
                  label: 'Extended .032 Splash Guard',
                  val: calculatorData?.extendedSplashGuard032,
                  unit: 'FT',
                  key: 'extendedSplashGuard032',
                  hasColor: true,
                },
              ].map((item, i, arr) => {
                const val = parseFloat(item.val || '0');
                const isLast = i === arr.length - 1;
                const hasColor = item.hasColor;

                return (
                  <View
                    key={item.label}
                    className={`flex-row ${!isLast ? 'border-b' : ''} border-slate-50`}
                  >
                    <View className={`flex-1 p-6 ${hasColor ? 'border-r border-slate-50' : ''}`}>
                      <View className="flex-row justify-between items-center">
                        <View>
                          <Text className="text-[10px] font-black text-slate-400  mb-2 tracking-tight">
                            {item.label}
                          </Text>
                          <Text className="text-xl font-black text-slate-800">{val || 0}</Text>
                        </View>
                        <Icon name="lock" size={18} color="#CBD5E1" />
                      </View>
                    </View>

                    {hasColor && (
                      <View className="flex-1 p-6">
                        <View className="flex-row justify-between items-center">
                          <View>
                            <Text className="text-[10px] font-black text-slate-400  mb-2 tracking-tight">
                              Color
                            </Text>
                            <Text className="text-xl font-black text-slate-800">
                              {gutterState.extrasColors?.[item.key!] || '—'}
                            </Text>
                          </View>
                          <Icon name="lock" size={18} color="#CBD5E1" />
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          {/* Premium Select Color Modal */}
          <Modal
            visible={colorModal.show}
            animationType="slide"
            transparent={true}
            onRequestClose={() => setColorModal({ ...colorModal, show: false })}
          >
            <View className="flex-1 bg-black/40 justify-end">
              <View className="bg-white rounded-t-[40px] h-[90%] shadow-2xl">
                <View className="p-8 flex-row justify-between items-center border-b border-slate-50">
                  <Text className="text-xl font-black text-slate-800">Select Color</Text>
                  <TouchableOpacity
                    onPress={() => setColorModal({ ...colorModal, show: false })}
                    className="p-2"
                  >
                    <Icon name="close" size={24} color="#64748B" />
                  </TouchableOpacity>
                </View>

                <FlatList
                  data={COLORS.Gutter}
                  numColumns={3}
                  contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
                  keyExtractor={(item) => item.name}
                  renderItem={({ item }) => {
                    const combo =
                      colorModal.type === 'gutter'
                        ? gutterState.gutterColorsMulti[colorModal.index]
                        : gutterState.downspoutsMulti[colorModal.index];
                    const isSelected = combo?.color === item.name;

                    return (
                      <TouchableOpacity
                        onPress={() => {
                          if (colorModal.type === 'gutter') {
                            const newCombos = [...gutterState.gutterColorsMulti];
                            newCombos[colorModal.index].color = item.name;
                            handleUpdate({ gutterColorsMulti: newCombos });
                            fetchProductImage(item.name);
                          } else {
                            const newDS = [...gutterState.downspoutsMulti];
                            newDS[colorModal.index].color = item.name;
                            handleUpdate({ downspoutsMulti: newDS });
                          }
                        }}
                        className={`flex-1 m-1.5 p-3 rounded-2xl border-2 items-center ${
                          isSelected ? 'border-[#22C55E] bg-[#F0FDF4]' : 'border-slate-100 bg-white'
                        }`}
                      >
                        <View
                          style={{ backgroundColor: item.hex }}
                          className="w-14 h-14 rounded-xl mb-3 shadow-sm relative border border-black/5"
                        >
                          {isSelected && (
                            <View className="absolute -top-1.5 -right-1.5 bg-[#22C55E] w-6 h-6 rounded-full items-center justify-center border-2 border-white">
                              <Icon name="check" size={12} color="white" />
                            </View>
                          )}
                        </View>
                        <Text
                          className={`text-[10px] font-black text-center  tracking-tight ${
                            isSelected ? 'text-[#166534]' : 'text-slate-500'
                          }`}
                        >
                          {item.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  }}
                />

                <View className="absolute bottom-10 left-8 right-8">
                  <TouchableOpacity
                    onPress={() => setColorModal({ ...colorModal, show: false })}
                    className="bg-[#1E293B] h-14 rounded-2xl items-center justify-center shadow-lg"
                  >
                    <Text className="text-white font-black  tracking-widest text-[13px]">Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </View>
      </ScrollView>
    </View>
  );
};
