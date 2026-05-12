import React, { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Modal,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const LOCATIONS = ['LEFT SIDE', 'RIGHT SIDE', 'FRONT', 'REAR', 'GARAGE', 'OTHER'];
const STORIES = ['1st Story', '2nd Story', '3rd Story'];
const GUTTER_PROFILES = ['K-Style', 'Half-Round', 'Fascia'];
const GUTTER_OPENING_WIDTH_OPTIONS = ['6"', '7"', '4 & 5"'];
const VERSA_MAX_WIDTH_OPTS = ['< 2.5', '2.5 - 3.4', '> 7'];
const EXACT_SIZE_OPTS = ['4"', '5"'];

const LEAFFILTER_COLORS = [
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Clay', hex: '#D2B48C' },
  { name: 'Bronze', hex: '#6F4E37' },
  { name: 'Cream', hex: '#FFFDD0' },
  { name: 'Grey', hex: '#808080' },
  { name: 'Silver', hex: '#C0C0C0' },
  { name: 'Wicker', hex: '#F5F5DC' },
  { name: 'Black', hex: '#000000' },
];

const COMBO_COLORS = ['#A855F7', '#0EA5E9', '#F43F5E', '#EAB308', '#22C55E'];

interface LeafFilterSectionProps {
  jobState: any;
  onUpdate: (section: string, field: string, value: any) => void;
  calculatorData: any;
  onFieldChange?: (data: any) => void;
  onValidationError?: (error: string) => void;
  outcomeForm?: any;
}

export const LeafFilterSection = ({
  jobState,
  onUpdate,
  calculatorData,
  onFieldChange,
  onValidationError,
  outcomeForm,
}: LeafFilterSectionProps) => {
  const { isDark } = useTheme();
  const [colorModal, setColorModal] = useState<{ visible: boolean; comboIdx: number } | null>(null);
  const [noticeModal, setNoticeModal] = useState(false);
  const [trackerExpanded, setTrackerExpanded] = useState(false);
  const lockedComboLoggedRef = useRef(new Set());

  const n = (v: any) => parseFloat(v) || 0;

  const normalizeWidth = useCallback((width: string) => {
    if (!width) return '';
    const clean = width.replace(/\s+/g, '').toLowerCase();
    if (clean === '4&5"' || (clean.includes('4') && clean.includes('5') && !clean.includes('.'))) return '4 & 5"';
    if (clean === '4"' || clean === '5"') return '4 & 5"';
    return clean;
  }, []);

  const getVal = useCallback(
    (baseKey: string) => {
      if (!calculatorData) return 0;
      const lowerKey = baseKey.toLowerCase();
      // Check root level
      const topKey = Object.keys(calculatorData).find((k) => k.toLowerCase() === lowerKey);
      const topVal = topKey ? n(calculatorData[topKey]) : 0;
      if (topVal > 0) return topVal;
      // Check inputs (LF footage keys: versa6Ft1, versa7Ft1, etc.)
      const inputs = calculatorData.inputs || {};
      const inputKey = Object.keys(inputs).find((k) => k.toLowerCase() === lowerKey);
      const inputVal = inputKey ? n(inputs[inputKey]) : 0;
      if (inputVal > 0) return inputVal;
      // Check extras (csr, cornersFilter, sawzallHanger, removeProtection, ribbedRoof)
      const extras = calculatorData.extras || {};
      const extrasKey = Object.keys(extras).find((k) => k.toLowerCase() === lowerKey);
      return extrasKey ? n(extras[extrasKey]) : 0;
    },
    [calculatorData]
  );

  // Extract story-based footage per gutter opening width
  const storyFootageByWidth = useMemo(() => {
    const footage: any = { '6"': [0, 0, 0], '7"': [0, 0, 0], '4 & 5"': [0, 0, 0], 'Versa Max': 0 };
    for (let s = 1; s <= 3; s++) {
      footage['6"'][s - 1] = getVal(`versa6ft${s}`) || getVal(`versa6${s}`);
      footage['7"'][s - 1] = getVal(`versa7ft${s}`) || getVal(`versa7${s}`);
      footage['4 & 5"'][s - 1] =
        getVal(`filter45ft${s}`) ||
        (getVal(`filter${s}`) > 0 && !`filter${s}`.includes('corners') ? getVal(`filter${s}`) : 0);
    }
    footage['Versa Max'] = getVal('versaMaxFt1') || getVal('versaMax') || getVal('versaMax1');
    return footage;
  }, [getVal]);

  const availableSizes = useMemo(() => {
    const sizes: any[] = [];
    if (!calculatorData) return sizes;
    const widthsByStory: Record<number, string[]> = { 1: [], 2: [], 3: [] };

    ['6"', '7"', '4 & 5"'].forEach((w) => {
      for (let s = 1; s <= 3; s++) if (storyFootageByWidth[w][s - 1] > 0) widthsByStory[s].push(w);
    });

    const widthMap = new Map<string, number[]>();
    for (let s = 1; s <= 3; s++) {
      widthsByStory[s].forEach((w) => {
        if (!widthMap.has(w)) widthMap.set(w, []);
        widthMap.get(w)?.push(s);
      });
    }

    ['6"', '7"', '4 & 5"'].forEach((w) => {
      if (widthMap.has(w)) sizes.push({ width: w, profile: 'Versa', stories: widthMap.get(w) });
    });

    if (storyFootageByWidth['Versa Max'] > 0)
      sizes.push({ width: '', profile: 'Versa Max', stories: [1, 2, 3] });
    return sizes;
  }, [storyFootageByWidth]);

  const leaffilterState = jobState?.leaffilter || {
    combinations: [],
    extras: { csr: 0, cornersFilter: 0, sawzallHanger: 0, removeProtection: 0, ribbedRoof: 0 },
  };

  const calculateAllocated = useCallback(
    (width: string, storyIdx: number) => {
      const targetW = normalizeWidth(width);
      return (leaffilterState.combinations || []).reduce((total: number, combo: any) => {
        const comboW = normalizeWidth(combo.gutterOpeningWidth || '');
        if (comboW !== targetW) return total;
        if (!combo.stories?.includes(storyIdx + 1)) return total;
        const storyMeas = combo.measurements.slice(storyIdx * 6, (storyIdx + 1) * 6);
        return total + storyMeas.reduce((sum: number, val: any) => sum + n(val), 0);
      }, 0);
    },
    [leaffilterState.combinations, normalizeWidth]
  );

  const allocatedVersaMax = useMemo(() => {
    return (leaffilterState.combinations || []).reduce((total: number, combo: any) => {
      if (combo.lfProfile !== 'Versa Max') return total;
      const w = normalizeWidth(combo.gutterOpeningWidth || '');
      // If width is standard, it already counted in calculateAllocated
      if (['4&5"', '6"', '7"'].includes(w)) return total;
      return total + combo.measurements.reduce((sum: number, val: any) => sum + n(val), 0);
    }, 0);
  }, [leaffilterState.combinations, normalizeWidth]);

  const isComplete = useMemo(() => {
    const hasAnyLF = Object.values(storyFootageByWidth).some((v: any) =>
      Array.isArray(v) ? v.some((x: any) => x > 0) : v > 0
    );
    if (!hasAnyLF) return true;

    for (const w of ['6"', '7"', '4 & 5"']) {
      for (let s = 0; s < 3; s++) {
        const avail = storyFootageByWidth[w][s];
        if (avail > 0 && Math.abs(avail - calculateAllocated(w, s)) > 0.1) return false;
      }
    }
    if (
      storyFootageByWidth['Versa Max'] > 0 &&
      Math.abs(storyFootageByWidth['Versa Max'] - allocatedVersaMax) > 0.1
    )
      return false;

    return (leaffilterState.combinations || []).every((c: any) => {
      const subtotal = (c.measurements || []).reduce((s: number, v: any) => s + n(v), 0);
      if (subtotal === 0) return true;
      const comboW = normalizeWidth(c.gutterOpeningWidth || '');
      const is45 = comboW === '4 & 5"';
      return (
        !!c.lfProfile &&
        !!c.lfColor &&
        !!c.gutterProfile &&
        !!c.gutterOpeningWidth &&
        (!is45 || !!c.exactSize)
      );
    });
  }, [storyFootageByWidth, calculateAllocated, allocatedVersaMax, leaffilterState.combinations]);

  useEffect(() => {
    onUpdate('leaffilter', 'isComplete', isComplete);
  }, [isComplete, onUpdate]);

  // Exact Web Logic: Initialization and Smart Preservation
  useEffect(() => {
    if (!calculatorData || Object.keys(calculatorData).length === 0) return;
    const current = leaffilterState.combinations || [];
    const lockedCombos = current.filter((c: any) => c.isLocked);
    const manualCombos = current.filter((c: any) => !c.isLocked);

    const initialLocked = availableSizes.map((size: any, index: number) => {
      const existing = current.find(
        (c: any) =>
          c.isLocked &&
          c.lfProfile === size.profile &&
          (size.profile === 'Versa Max' || c.gutterOpeningWidth === size.width)
      );
      if (existing) return { ...existing, id: index + 1, stories: size.stories || [] };
      return {
        id: index + 1,
        gutterOpeningWidth: size.profile === 'Versa Max' ? '' : size.width,
        lfProfile: size.profile,
        gutterProfile: '',
        lfColor: '',
        measurements: Array(18).fill(''),
        isLocked: true,
        stories: size.stories || [],
        exactSize: '',
      };
    });

    const nextCombinations = [...initialLocked, ...manualCombos];

    // Only update if there's a structural change or story mapping change
    const hasChanged =
      nextCombinations.length !== current.length ||
      initialLocked.some((c: any, i: number) => {
        const oldC = lockedCombos[i];
        if (!oldC) return true;
        return JSON.stringify(c.stories) !== JSON.stringify(oldC.stories);
      });

    if (hasChanged) {
      onUpdate('leaffilter', 'combinations', nextCombinations);
    }
  }, [availableSizes, onUpdate, leaffilterState.combinations]);

  // Sync extras from calculatorData
  useEffect(() => {
    if (!calculatorData) return;
    const extras = {
      csr: getVal('csr'),
      cornersFilter: getVal('cornersFilter'),
      sawzallHanger: getVal('sawzallHanger'),
      removeProtection: getVal('removeProtection'),
      ribbedRoof: getVal('ribbedRoof'),
    };

    // Only update if changed to avoid loop
    if (JSON.stringify(extras) !== JSON.stringify(leaffilterState.extras)) {
      onUpdate('leaffilter', 'extras', extras);
    }
  }, [calculatorData, getVal, leaffilterState.extras, onUpdate]);

  const activeTrackerCards = useMemo(() => {
    const cards: any[] = [];
    ['6"', '7"', '4 & 5"'].forEach((w) => {
      STORIES.forEach((_, sIdx) => {
        if (storyFootageByWidth[w][sIdx] > 0) {
          cards.push({
            title: `${sIdx + 1}${sIdx === 0 ? 'st' : sIdx === 1 ? 'nd' : 'rd'} Story ${w}`,
            avail: storyFootageByWidth[w][sIdx],
            used: calculateAllocated(w, sIdx),
          });
        }
      });
    });
    if (storyFootageByWidth['Versa Max'] > 0) {
      cards.push({
        title: 'Versa Max',
        avail: storyFootageByWidth['Versa Max'],
        used: allocatedVersaMax,
      });
    }
    return cards;
  }, [storyFootageByWidth, calculateAllocated, allocatedVersaMax]);

  const updateCombo = (idx: number, updates: any) => {
    const next = [...leaffilterState.combinations];
    next[idx] = { ...next[idx], ...updates };
    onUpdate('leaffilter', 'combinations', next);
  };

  const renderAllocationCard = (
    title: string,
    avail: number,
    used: number,
    widthClass: string = 'w-[48%]'
  ) => {
    if (avail === 0) return null;
    const remaining = avail - used;
    const isPerfect = Math.abs(remaining) <= 0.1;
    return (
      <View
        key={title}
        className={`bg-white border border-[#A5E1ED] rounded-xl p-2 mb-2 ${widthClass}`}
      >
        <Text className="text-[9px] font-black text-sky-500 text-center mb-1">{title}</Text>
        <View className="flex-row justify-between px-1">
          <View className="items-center">
            <Text className="text-[7px] text-slate-400 font-bold">AVAIL</Text>
            <Text className="text-[10px] font-black text-sky-500">{avail.toFixed(0)}ft</Text>
          </View>
          <View className="items-center">
            <Text className="text-[7px] text-slate-400 font-bold">USED</Text>
            <Text className="text-[10px] font-black text-amber-500">{used.toFixed(0)}ft</Text>
          </View>
          <View className="items-center">
            <Text className="text-[7px] text-slate-400 font-bold">LEFT</Text>
            <Text
              className={`text-[10px] font-black ${
                remaining < -0.1 ? 'text-red-500' : 'text-slate-800'
              }`}
            >
              {remaining.toFixed(0)}ft
            </Text>
          </View>
        </View>
        {isPerfect && (
          <View className="mt-1 bg-emerald-500 rounded-lg py-0.5 items-center">
            <Text className="text-[6px] font-black text-white">✓ Perfectly Allotted</Text>
          </View>
        )}
        {remaining < -0.1 && (
          <View className="mt-1 bg-red-500 rounded-lg py-0.5 items-center">
            <Text className="text-[6px] font-black text-white">
              ⚠ Over by {Math.abs(remaining).toFixed(0)}ft
            </Text>
          </View>
        )}
      </View>
    );
  };

  const perfectlyAllocatedCount = activeTrackerCards.filter(
    (c) => Math.abs(c.avail - c.used) <= 0.1
  ).length;

  return (
    <View style={{ flex: 1 }}>
      <View className="bg-white px-4 pt-2 pb-2 shadow-sm z-50 border-b border-slate-100">
        {/* ── Tracker ── */}
        {activeTrackerCards.length > 0 && activeTrackerCards.length <= 4 && (
          <View className="flex-row flex-wrap justify-between">
            {activeTrackerCards.map((card, idx) => {
              const isLast = idx === activeTrackerCards.length - 1;
              const isOdd = activeTrackerCards.length % 2 !== 0;
              const width = isLast && isOdd ? 'w-[100%]' : 'w-[48%]';
              return renderAllocationCard(card.title, card.avail, card.used, width);
            })}
          </View>
        )}

        {activeTrackerCards.length > 4 && (
          <View className="bg-white border border-[#A5E1ED] rounded-2xl overflow-hidden shadow-sm">
            <TouchableOpacity
              className="flex-row items-center justify-between p-3 bg-[#F0F9FF]"
              style={{ borderBottomWidth: trackerExpanded ? 1 : 0, borderBottomColor: '#A5E1ED' }}
              onPress={() => setTrackerExpanded(!trackerExpanded)}
            >
              <View className="flex-row items-center">
                <Icon name="chart-bar" size={18} color="#0EA5E9" />
                <Text className="text-[13px] font-black text-[#0EA5E9] ml-2 tracking-tight">
                  Footage Allocation Tracker
                </Text>
                <View className="bg-amber-500 px-2 py-0.5 rounded-full ml-3">
                  <Text className="text-[10px] font-black text-slate-900">
                    {perfectlyAllocatedCount}/{activeTrackerCards.length} Done
                  </Text>
                </View>
              </View>
              <Icon
                name={trackerExpanded ? 'chevron-up' : 'chevron-down'}
                size={20}
                color="#0EA5E9"
              />
            </TouchableOpacity>

            {trackerExpanded && (
              <View className="p-3 bg-white flex-row flex-wrap justify-between">
                {activeTrackerCards.map((card, idx) => {
                  const isLast = idx === activeTrackerCards.length - 1;
                  const isOdd = activeTrackerCards.length % 2 !== 0;
                  const width = isLast && isOdd ? 'w-[100%]' : 'w-[48%]';
                  return renderAllocationCard(card.title, card.avail, card.used, width);
                })}
              </View>
            )}
          </View>
        )}
      </View>

      <ScrollView className="flex-1 px-4 py-4" showsVerticalScrollIndicator={false}>
        {leaffilterState.combinations.map((combo: any, idx: number) => {
          const subtotal = combo.measurements.reduce((s: number, v: any) => s + n(v), 0);
          const isVersaMax = combo.lfProfile === 'Versa Max';
          const comboW = normalizeWidth(combo.gutterOpeningWidth || '');
          const is45 = comboW === '4 & 5"';
          const isCompleteCombo =
            !!combo.lfProfile &&
            !!combo.lfColor &&
            !!combo.gutterProfile &&
            !!combo.gutterOpeningWidth &&
            (!is45 || !!combo.exactSize);

          const showIncomplete = subtotal > 0 && !isCompleteCombo;
          const comboColor = COMBO_COLORS[idx % COMBO_COLORS.length];

          return (
            <View
              key={combo.id}
              className={`mb-6 bg-white rounded-[24px] border-2 p-5 shadow-sm ${
                showIncomplete ? 'border-amber-400' : 'border-slate-100'
              }`}
            >
              <View className="flex-row justify-between items-center mb-4">
                <View
                  style={{ backgroundColor: comboColor + '15' }}
                  className="px-3 py-1 rounded-lg"
                >
                  <Text style={{ color: comboColor }} className="text-[10px] font-black">
                    Combination #{idx + 1}
                  </Text>
                </View>
                {!combo.isLocked && (
                  <TouchableOpacity
                    onPress={() =>
                      onUpdate(
                        'leaffilter',
                        'combinations',
                        leaffilterState.combinations.filter((c: any) => c.id !== combo.id)
                      )
                    }
                  >
                    <Icon name="close-circle" size={24} color="#EF4444" />
                  </TouchableOpacity>
                )}
              </View>

              <View className="gap-3 mb-6">
                <View className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <Text className="text-[9px] font-black text-slate-400 mb-2">
                    Gutter Opening Width {is45 ? '(4&5)' : ''}
                  </Text>
                  {isVersaMax ? (
                    <>
                      <View className="flex-row gap-2">
                        {VERSA_MAX_WIDTH_OPTS.map((o) => (
                          <TouchableOpacity
                            key={o}
                             onPress={() => {
                               if (o === '< 2.5' && outcomeForm?.result?.toLowerCase() !== 'demo') {
                                 setNoticeModal(true);
                               }
                               updateCombo(idx, {
                                 gutterOpeningWidth: o,
                                 exactSize: '',
                               });
                             }}
                            className={`flex-1 h-10 rounded-xl items-center justify-center border-2 ${
                              combo.gutterOpeningWidth === o
                                ? 'bg-[#22C55E] border-[#22C55E]'
                                : 'bg-white border-slate-100'
                            }`}
                          >
                            <Text
                              className={`text-[10px] font-black ${
                                combo.gutterOpeningWidth === o ? 'text-white' : 'text-slate-500'
                              }`}
                            >
                              {o}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  ) : combo.isLocked && combo.gutterOpeningWidth !== '4 & 5"' ? (
                    <View className="flex-row items-center bg-slate-100 h-11 rounded-xl px-4 justify-between">
                      <Text className="text-[11px] font-black text-slate-400">
                        {combo.gutterOpeningWidth}
                      </Text>
                      <Icon name="lock" size={14} color="#94A3B8" />
                    </View>
                  ) : (
                    <View className="flex-row gap-2">
                      {(combo.isLocked && combo.gutterOpeningWidth === '4 & 5"'
                        ? ['4"', '5"']
                        : combo.lfProfile === 'Versa'
                        ? ['4"', '5"', '6"', '7"']
                        : GUTTER_OPENING_WIDTH_OPTIONS
                      ).map((o) => (
                        <TouchableOpacity
                          key={o}
                          onPress={() =>
                            updateCombo(idx, {
                              gutterOpeningWidth: combo.isLocked ? combo.gutterOpeningWidth : o,
                              exactSize: o === '4"' || o === '5"' ? o : '',
                            })
                          }
                          className={`flex-1 h-10 rounded-xl items-center justify-center border-2 ${
                            (
                              combo.isLocked && combo.gutterOpeningWidth === '4 & 5"'
                                ? combo.exactSize === o
                                : combo.gutterOpeningWidth === o
                            )
                              ? 'bg-[#22C55E] border-[#22C55E]'
                              : 'bg-white border-slate-100'
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-black ${
                              (
                                combo.isLocked && combo.gutterOpeningWidth === '4 & 5"'
                                  ? combo.exactSize === o
                                  : combo.gutterOpeningWidth === o
                              )
                                ? 'text-white'
                                : 'text-slate-500'
                            }`}
                          >
                            {o}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                <View className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <Text className="text-[9px] font-black text-slate-400 mb-2">
                    LeafFilter Profile
                  </Text>
                  {combo.isLocked ? (
                    <View className="flex-row items-center bg-slate-100 h-11 rounded-xl px-4 justify-between">
                      <Text className="text-[11px] font-black text-slate-400">
                        {combo.lfProfile}
                      </Text>
                      <Icon name="lock" size={14} color="#94A3B8" />
                    </View>
                  ) : (
                    <View className="flex-row gap-2">
                      {['Versa', 'Versa Max'].map((p) => (
                        <TouchableOpacity
                          key={p}
                          onPress={() =>
                            updateCombo(idx, {
                              lfProfile: p,
                              gutterOpeningWidth: '', // Reset width when profile changes
                              exactSize: '',
                            })
                          }
                          className={`flex-1 h-10 rounded-xl items-center justify-center border-2 ${
                            combo.lfProfile === p
                              ? 'bg-[#22C55E] border-[#22C55E]'
                              : 'bg-white border-slate-100'
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-black ${
                              combo.lfProfile === p ? 'text-white' : 'text-slate-500'
                            }`}
                          >
                            {p}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                <View
                  className={`p-3 rounded-xl ${
                    !combo.gutterProfile
                      ? 'border-2 border-amber-400 bg-amber-50/20'
                      : 'bg-white border border-slate-100'
                  }`}
                >
                  <Text className="text-[9px] font-black text-slate-500 mb-3">
                    Existing Gutter Profile{' '}
                    {!combo.gutterProfile && <Text className="text-amber-600">⚠ REQUIRED</Text>}
                  </Text>
                  <View className="flex-row gap-2">
                    {GUTTER_PROFILES.map((p) => (
                      <TouchableOpacity
                        key={p}
                        onPress={() => updateCombo(idx, { gutterProfile: p })}
                        className={`flex-1 h-10 rounded-xl items-center justify-center border-2 ${
                          combo.gutterProfile === p
                            ? 'bg-[#22C55E] border-[#22C55E]'
                            : 'bg-white border-slate-100'
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-black ${
                            combo.gutterProfile === p ? 'text-white' : 'text-slate-500'
                          }`}
                        >
                          {p}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View
                  className={`p-4 rounded-xl ${
                    !combo.lfColor
                      ? 'border-2 border-amber-400 bg-amber-50/10'
                      : 'bg-white border border-slate-100'
                  }`}
                >
                  {!combo.lfColor && (
                    <View className="flex-row items-center mb-3">
                      <Icon name="alert" size={12} color="#F59E0B" />
                      <Text className="text-[9px] font-black text-amber-500 ml-1">
                        INCOMPLETE - Color Required
                      </Text>
                    </View>
                  )}
                  <Text className="text-[10px] font-black text-slate-800 mb-3">
                    LeafFilter Color
                  </Text>
                  <View className="flex-row gap-2 mb-3">
                    {LEAFFILTER_COLORS.slice(0, 3).map((c) => (
                      <TouchableOpacity
                        key={c.name}
                        onPress={() => updateCombo(idx, { lfColor: c.name })}
                        style={{ backgroundColor: c.hex }}
                        className={`w-[30%] h-14 rounded-xl border-2 ${
                          combo.lfColor === c.name ? 'border-[#22C55E]' : 'border-slate-100'
                        }`}
                      />
                    ))}
                  </View>
                  {combo.lfColor && (
                    <View className="flex-row items-center bg-[#22C55E] rounded-full py-1.5 px-3 self-start border border-emerald-600">
                      <View
                        style={{
                          backgroundColor:
                            LEAFFILTER_COLORS.find((c) => c.name === combo.lfColor)?.hex || '#000',
                        }}
                        className="w-3 h-3 rounded-full mr-2 border border-white/20"
                      />
                      <Text className="text-white text-[10px] font-black">{combo.lfColor}</Text>
                    </View>
                  )}
                </View>
              </View>

              <View>
                <View className="flex-row items-center mb-4">
                  <Text className="text-[11px] font-black text-amber-500">
                    {isVersaMax ? 'Versa Max' : 'LeafFilter'} Measurements{' '}
                    {subtotal === 0 && (
                      <Text className="text-amber-600">⚠ ALLOCATE REMAINING FOOTAGE</Text>
                    )}
                  </Text>
                </View>
                <View className="flex-row mb-2">
                  <View className="flex-[1.2]">
                    <Text className="text-[8px] font-black text-slate-400">Location</Text>
                  </View>
                  {(() => {
                    const maxStory = Math.max(...(combo.stories || [1]));
                    return STORIES.map((s, sIdx) => {
                      if (!isVersaMax && sIdx + 1 > maxStory) return null;
                      return (
                        <View key={s} className="flex-1">
                          <Text className="text-[8px] font-black text-center text-slate-400">
                            {s}
                          </Text>
                        </View>
                      );
                    });
                  })()}
                </View>
                {LOCATIONS.map((loc) => (
                  <View key={loc} className="flex-row items-center mb-2">
                    <View className="flex-[1.2]">
                      <Text className="text-[9px] font-black text-slate-600">{loc}</Text>
                    </View>
                    {(() => {
                      const maxStory = Math.max(...(combo.stories || [1]));
                      return STORIES.map((_, sIdx) => {
                        if (!isVersaMax && sIdx + 1 > maxStory) return null;
                        return (
                          <View key={sIdx} className="flex-1 px-1">
                            <TextInput
                              value={String(
                                combo.measurements[sIdx * 6 + LOCATIONS.indexOf(loc)] ?? ''
                              )}
                              onChangeText={(v) => {
                                const next = [...combo.measurements];
                                next[sIdx * 6 + LOCATIONS.indexOf(loc)] = v.replace(/[^0-9]/g, '');
                                updateCombo(idx, { measurements: next });
                              }}
                              onBlur={() => {
                                const val = n(
                                  combo.measurements[sIdx * 6 + LOCATIONS.indexOf(loc)]
                                );
                                if (val > 0) {
                                  const comboW = normalizeWidth(combo.gutterOpeningWidth || '');
                                  const avail =
                                    storyFootageByWidth[comboW]?.[sIdx] ||
                                    (combo.lfProfile === 'Versa Max'
                                      ? storyFootageByWidth['Versa Max']
                                      : 0);

                                  if (avail === 0) {
                                    const storyLabel =
                                      sIdx === 0 ? '1st' : sIdx === 1 ? '2nd' : '3rd';
                                    const typeLabel =
                                      combo.lfProfile === 'Versa Max'
                                        ? 'Versa Max'
                                        : `${comboW} Story ${storyLabel}`;
                                    onValidationError?.(
                                      `${typeLabel} not assigned in calculator. Please remove the value from this column.`
                                    );
                                  }
                                }
                              }}
                              keyboardType="number-pad"
                              placeholder="0"
                              className="h-10 bg-slate-50 rounded-xl border border-slate-200 text-center text-[12px] font-black text-black"
                            />
                          </View>
                        );
                      });
                    })()}
                  </View>
                ))}
                <TouchableOpacity
                  style={{ backgroundColor: '#22C55E' }}
                  className="mt-4 h-10 rounded-full items-center justify-center self-end px-6 shadow-sm"
                >
                  <Text className="text-white font-black text-[10px]">
                    Combination Total: {subtotal.toFixed(0)} FT
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        <TouchableOpacity
          onPress={() =>
            onUpdate('leaffilter', 'combinations', [
              ...leaffilterState.combinations,
              {
                id: Date.now(),
                gutterOpeningWidth: '',
                lfProfile: 'Versa',
                gutterProfile: '',
                lfColor: '',
                measurements: Array(18).fill(''),
                isLocked: false,
                stories: [1, 2, 3],
                exactSize: '',
              },
            ])
          }
          className="h-14 rounded-2xl border border-slate-200 items-center justify-center flex-row bg-white mb-8"
        >
          <Icon name="plus" size={16} color="#94A3B8" />
          <Text className="text-slate-400 font-black text-[11px] ml-2">Add Combination</Text>
        </TouchableOpacity>

        <View className="bg-white rounded-[32px] p-6 border border-emerald-100 mb-10">
          <Text className="text-[12px] font-black text-[#22C55E] mb-6">
            Grand Total - All Combinations
          </Text>
          {leaffilterState.combinations.map((c: any, i: number) => {
            const tot = c.measurements.reduce((s: number, v: any) => s + n(v), 0);
            return (
              <View
                key={c.id}
                className="w-[100%] mb-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100"
              >
                <View
                  style={{ backgroundColor: COMBO_COLORS[i % COMBO_COLORS.length] + '20' }}
                  className="px-2 py-0.5 rounded-lg self-start mb-4"
                >
                  <Text
                    style={{ color: COMBO_COLORS[i % COMBO_COLORS.length] }}
                    className="text-[10px] font-black"
                  >
                    #{i + 1}
                  </Text>
                </View>
                <View className="flex-row flex-wrap justify-between gap-y-3">
                  <View className="w-[45%]">
                    <Text className="text-[8px] font-bold text-slate-400">Gutter Profile</Text>
                    <Text className="text-[10px] font-black text-slate-800">
                      {c.gutterProfile || 'Not Selected'}
                    </Text>
                  </View>
                  <View className="w-[45%]">
                    <Text className="text-[8px] font-bold text-slate-400">LeafFilter Color</Text>
                    <Text className="text-[10px] font-black text-slate-800">
                      {c.lfColor || 'Not Selected'}
                    </Text>
                  </View>
                  <View className="w-[45%]">
                    <Text className="text-[8px] font-bold text-slate-400">LeafFilter Profile</Text>
                    <Text className="text-[10px] font-black text-black">{c.lfProfile}</Text>
                  </View>
                  <View className="w-[45%]">
                    <Text className="text-[8px] font-bold text-slate-400">
                      Gutter Opening Width
                    </Text>
                    <Text className="text-[10px] font-black text-black">
                      {(c.gutterOpeningWidth === '4 & 5"' ? c.exactSize : c.gutterOpeningWidth) ||
                        'Not Selected'}
                    </Text>
                  </View>
                </View>
                <View className="mt-3 pt-3 border-t border-slate-100 flex-row justify-between items-center">
                  <Text className="text-[10px] font-black text-slate-400">Total Footage</Text>
                  <Text className="text-[12px] font-black text-[#22C55E]">{tot.toFixed(0)} FT</Text>
                </View>
              </View>
            );
          })}
          <View className="mt-4 pt-4 border-t-2 border-[#22C55E] flex-row justify-between items-center px-2">
            <Text className="text-[14px] font-black text-[#22C55E]">Total LeafFilter:</Text>
            <Text className="text-[20px] font-black text-[#22C55E]">
              {leaffilterState.combinations
                .reduce(
                  (s: number, c: any) =>
                    s + c.measurements.reduce((m: number, v: any) => m + n(v), 0),
                  0
                )
                .toFixed(0)}{' '}
              FT
            </Text>
          </View>
        </View>

        <View className="bg-white rounded-[24px] border border-slate-100 shadow-sm overflow-hidden mb-40">
          <View className="px-5 py-4 flex-row justify-between items-center bg-slate-50 border-b border-slate-100">
            <Text className="text-[14px] font-black text-slate-500">Extras</Text>
            <View className="bg-slate-800 px-3 py-1.5 rounded-lg">
              <Text className="text-[9px] font-black text-white">Locked from Job Summary</Text>
            </View>
          </View>
          <View className="p-5 gap-4">
            {[
              { l: 'C-S-R', v: getVal('csr') },
              { l: 'Corners (Filter)', v: getVal('cornersFilter') },
              { l: 'Sawzall Hanger', v: getVal('sawzallHanger') },
              { l: 'Remove Protection', v: getVal('removeProtection') },
              { l: 'Ribbed Roof', v: getVal('ribbedRoof') },
            ].map((it) => (
              <View
                key={it.l}
                className="flex-row justify-between items-center border-b border-slate-50 pb-4"
              >
                <View>
                  <Text className="text-[10px] font-black text-slate-400 mb-1">{it.l}</Text>
                  <Text className="text-xs font-black text-slate-800">{it.v}</Text>
                </View>
                <Icon name="lock" size={18} color="#CBD5E1" />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <ImportantNoticeModal visible={noticeModal} onClose={() => setNoticeModal(false)} />
    </View>
  );
};

const ImportantNoticeModal = ({ visible, onClose }: { visible: boolean; onClose: () => void }) => {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.4)',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 20,
        }}
      >
        <View
          style={{
            backgroundColor: 'white',
            borderRadius: 24,
            padding: 32,
            width: '100%',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.2,
            shadowRadius: 15,
            elevation: 10,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 20,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#1E293B' }}>
              Important Notice
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={20} color="#64748B" />
            </TouchableOpacity>
          </View>
          <Text
            style={{
              fontSize: 14,
              color: '#475569',
              lineHeight: 22,
              marginBottom: 30,
              fontWeight: '500',
            }}
          >
            Ensure Agreement has Special Can't Guarantee Cleaning or Sealing Clause
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={{
              backgroundColor: '#4CBB17',
              height: 48,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'flex-end',
              paddingHorizontal: 32,
            }}
          >
            <Text style={{ color: 'white', fontWeight: '900', fontSize: 14 }}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};
