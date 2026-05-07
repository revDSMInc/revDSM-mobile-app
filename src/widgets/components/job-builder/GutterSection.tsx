import React, { useMemo, useCallback, useEffect, useState } from 'react';
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
import { COLORS } from './color-constant';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const LOCATIONS = ['LEFT SIDE', 'RIGHT SIDE', 'FRONT', 'REAR', 'GARAGE', 'OTHER'];
const STORIES = ['1ST STORY', '2ND STORY', '3RD STORY'];

const ALL_DOWNSPOUT_TYPES = [
  { name: '2 X 3', size: '5" K-Style' },
  { name: '3 X 3 (alt)', size: '5" K-Style' },
  { name: '3 Round (alt)', size: '5" K-Style' },
  { name: '3 X 4', size: '6" K-Style' },
  { name: '4 Round (alt)', size: '6" K-Style' },
  { name: '4 X 5', size: '7" K-Style' },
];

interface GutterSectionProps {
  jobState: any;
  onUpdate: (section: string, field: string, value: any) => void;
  calculatorData: any;
  jobSummaryItems?: any[];
}

export const GutterSection = ({
  jobState,
  onUpdate,
  calculatorData,
  jobSummaryItems,
}: GutterSectionProps) => {
  const { isDark } = useTheme();
  const [colorModal, setColorModal] = useState<{ visible: boolean; target: any } | null>(null);

  const data = jobState?.gutter || {
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
    modifyHeight: 0,
  };

  const n = (v: any) => parseFloat(v) || 0;

  const getVal = useCallback(
    (key: string) => {
      const inputs = calculatorData?.inputs || {};
      const extras = calculatorData?.extras || {};
      return (
        n(inputs[key]) ||
        n(extras[key]) ||
        n(calculatorData?.[key])
      );
    },
    [calculatorData]
  );

  const dsFootageAvail = getVal('downspoutFootage');

  const availableFootageRaw = useMemo(
    () => ({
      '5" K-Style': getVal('gutter5DsE'),
      '6" K-Style': getVal('gutter6Ft1'),
      '7" K-Style': getVal('gutter7DsE'),
      '8" K-Style': getVal('gutter8Inch'),
    }),
    [getVal]
  );

  const availableSizes = useMemo(
    () =>
      Object.keys(availableFootageRaw).filter(
        (s) => availableFootageRaw[s as keyof typeof availableFootageRaw] > 0
      ),
    [availableFootageRaw]
  );

  // Auto-set size if only one available
  useEffect(() => {
    if (availableSizes.length === 1 && data.gutterColorsMulti?.length > 0) {
      const needsUpdate = data.gutterColorsMulti.some((c: any) => c.size !== availableSizes[0]);
      if (needsUpdate) {
        const next = data.gutterColorsMulti.map((c: any) => ({ ...c, size: availableSizes[0] }));
        onUpdate('gutter', 'gutterColorsMulti', next);
      }
    }
  }, [availableSizes, data.gutterColorsMulti, onUpdate]);

  const filteredDownspoutTypes = useMemo(() => {
    if (availableSizes.length === 0) return ALL_DOWNSPOUT_TYPES;
    return ALL_DOWNSPOUT_TYPES.filter(
      (dt) =>
        availableSizes.includes(dt.size) ||
        (dt.size === '7" K-Style' && availableSizes.includes('8" K-Style'))
    );
  }, [availableSizes]);

  const getStoryAllocation = useCallback(
    (sizeFilter: string | null = null) => {
      const gutterFeet = (data.gutterColorsMulti || []).reduce((sum: number, combo: any) => {
        if (sizeFilter && combo.size !== sizeFilter) return sum;
        return sum + (combo.measurements || []).reduce((s: number, v: any) => s + n(v), 0);
      }, 0);

      const dsFeet = (data.downspoutsMulti || []).reduce((sum: number, ds: any) => {
        const dsTypeInfo = ALL_DOWNSPOUT_TYPES.find((t) => t.name === ds.type);
        const dsGutterSize = dsTypeInfo?.size || '';

        const isMatch =
          !sizeFilter ||
          dsGutterSize === sizeFilter ||
          (sizeFilter === '8" K-Style' && dsGutterSize === '7" K-Style');
        if (!isMatch) return sum;
        return (
          sum +
          n(ds.footage) +
          n(ds.aElbows) +
          n(ds.bElbows) +
          n(ds.roundElbow) +
          n(ds.offsetElbows) +
          n(ds.spoutSavers)
        );
      }, 0);

      return gutterFeet + dsFeet;
    },
    [data.gutterColorsMulti, data.downspoutsMulti]
  );

  const totalAvail = Math.round(
    Object.values(availableFootageRaw).reduce((a, b) => a + b, 0) + dsFootageAvail
  );
  const allocatedTotal = Math.round(getStoryAllocation());
  const remainingTotal = totalAvail - allocatedTotal;

  const extrasValues = useMemo(
    () => ({
      wedges: getVal('wedges'),
      straps: getVal('straps'),
      modifyHeight: getVal('modifyHeight'),
      groundSpout: getVal('groundSpout'),
      replaceCorner: getVal('replaceCorner'),
      extendedSplashGuard: getVal('extendedSplashGuard'),
      extendedSplashGuard032: getVal('extendedSplashGuard032'),
    }),
    [calculatorData, data.modifyHeight, getVal]
  );

  const isComplete = useMemo(() => {
    if (totalAvail === 0) return true;
    if (allocatedTotal > 0 && !data.partial) return false;
    if (Math.abs(remainingTotal) > 0.1) return false;

    const combosOk = (data.gutterColorsMulti || []).every((c: any) => {
      const hasMeas = (c.measurements || []).some((m: any) => m !== '' && n(m) > 0);
      if (!hasMeas) return true;
      return (
        !!c.color &&
        c.mitersOutside !== '' &&
        c.mitersInside !== '' &&
        c.endCapsRights !== '' &&
        c.endCapsLefts !== ''
      );
    });
    if (!combosOk) return false;

    const dsOk = (data.downspoutsMulti || []).every((ds: any) => {
      const hasVal = [
        'footage',
        'aElbows',
        'bElbows',
        'roundElbow',
        'offsetElbows',
        'spoutSavers',
      ].some((f) => n(ds[f]) > 0);
      if (!hasVal) return true;
      return !!ds.type && !!ds.color;
    });
    if (!dsOk) return false;

    const extrasOk =
      (extrasValues.replaceCorner === 0 || !!data.extrasColors?.replaceCorner) &&
      (extrasValues.extendedSplashGuard === 0 || !!data.extrasColors?.extendedSplashGuard) &&
      (extrasValues.extendedSplashGuard032 === 0 || !!data.extrasColors?.extendedSplashGuard032);
    if (!extrasOk) return false;

    const modifyOk = !extrasValues.modifyHeight || (data.modifyHeightLocations || []).length > 0;
    if (!modifyOk) return false;

    return true;
  }, [totalAvail, allocatedTotal, remainingTotal, data, extrasValues]);

  useEffect(() => {
    onUpdate('gutter', 'isComplete', isComplete);
  }, [isComplete, onUpdate]);

  useEffect(() => {
    if (totalAvail > 0 && (!data.gutterColorsMulti || data.gutterColorsMulti.length === 0)) {
      onUpdate('gutter', 'gutterColorsMulti', [
        {
          id: Date.now() + Math.random(),
          size: availableSizes[0] || '6" K-Style',
          color: '',
          measurements: Array(18).fill(''),
          mitersOutside: '',
          mitersInside: '',
          endCapsRights: '',
          endCapsLefts: '',
        },
      ]);
    }
    if (totalAvail > 0 && (!data.downspoutsMulti || data.downspoutsMulti.length === 0)) {
      onUpdate('gutter', 'downspoutsMulti', [
        {
          id: Date.now() + Math.random(),
          type: '',
          color: '',
          footage: '',
          aElbows: '',
          bElbows: '',
          roundElbow: '',
          offsetElbows: '',
          spoutSavers: '',
        },
      ]);
    }
  }, [
    totalAvail,
    data.gutterColorsMulti?.length,
    data.downspoutsMulti?.length,
    onUpdate,
    availableSizes,
  ]);

  const updateCombo = (idx: number, updates: any) => {
    const next = [...(data.gutterColorsMulti || [])];
    next[idx] = { ...next[idx], ...updates };
    onUpdate('gutter', 'gutterColorsMulti', next);
  };

  const updateDS = (idx: number, updates: any) => {
    const next = [...(data.downspoutsMulti || [])];
    next[idx] = { ...next[idx], ...updates };
    onUpdate('gutter', 'downspoutsMulti', next);
  };

  const updateExtrasColor = (field: string, color: string) => {
    onUpdate('gutter', 'extrasColors', { ...data.extrasColors, [field]: color });
  };

  const toggleModifyLoc = (loc: string) => {
    const current = data.modifyHeightLocations || [];
    const next = current.includes(loc)
      ? current.filter((l: string) => l !== loc)
      : [...current, loc];
    onUpdate('gutter', 'modifyHeightLocations', next);
  };

  const renderAllocationCard = (size: string, available: number) => {
    const allocated = getStoryAllocation(size);
    const totalAvailSize = available + (availableSizes.length === 1 ? dsFootageAvail : 0);
    const remaining = totalAvailSize - allocated;

    return (
      <View
        key={size}
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
          className="text-[8px] font-black text-[#0EA5E9]  mb-1 text-center tracking-tight"
          numberOfLines={1}
        >
          {size}
        </Text>
        <View className="flex-row justify-between px-1">
          <View className="items-center">
            <Text className="text-[6px] font-bold text-slate-400  mb-1">Avail</Text>
            <Text className="text-sm font-black text-[#7DD3FC]">{totalAvailSize.toFixed(0)}ft</Text>
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
              {remaining.toFixed(0)}ft
            </Text>
          </View>
        </View>
        {Math.abs(remaining) <= 0.1 && totalAvailSize > 0 && (
          <View className="bg-[#22C55E] rounded-xl py-2.5 px-2 mt-1 flex-row items-center justify-center mx-1">
            <Text className="text-white text-[8px] font-black  tracking-tight">
              ✓ Perfectly allocated!
            </Text>
          </View>
        )}
        {remaining < -0.1 && (
          <View className="bg-red-500 rounded-xl py-2.5 px-2 mt-1 flex-row items-center justify-center mx-1">
            <Text className="text-white text-[8px] font-black  tracking-tight">
              ⚠ Over by {Math.abs(remaining).toFixed(0)}ft
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {/* ── Tracker ── */}
      <View
        style={{
          backgroundColor: isDark ? '#0F0F0F' : '#F8FAFC',
          paddingHorizontal: 12,
          paddingVertical: 12,
        }}
      >
        <View className="flex-row justify-between">
          {availableSizes.map((size) =>
            renderAllocationCard(
              size,
              availableFootageRaw[size as keyof typeof availableFootageRaw]
            )
          )}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-4 py-6 pb-40">
          <View className="rounded-[32px] p-1 mb-10 border-2 border-slate-200">

            {(data.gutterColorsMulti || []).map((combo: any, idx: number) => {
              const hasMeas = (combo.measurements || []).some((m: any) => m !== '' && n(m) > 0);
              const subtotal = (combo.measurements || []).reduce(
                (s: number, v: any) => s + n(v),
                0
              );
              const selectedColorObj = COLORS.Gutter.find((c) => c.name === combo.color);
              const colorMissing = hasMeas && !combo.color;

              return (
                <View
                  key={combo.id}
                  className="mb-4 bg-white rounded-[24px] border border-slate-200 p-5 shadow-sm"
                >
                  <View className="flex-row items-center gap-2 mb-6">
                    <View className="flex-1 flex-row gap-2">
                      {availableSizes.length === 1 ? (
                        <View className="flex-1 h-11 rounded-xl items-center justify-center bg-sky-500 flex-row px-4">
                          <Icon name="lock" size={14} color="white" className="mr-2" />
                          <Text className="text-[11px] font-black text-white">
                            {availableSizes[0]}
                          </Text>
                        </View>
                      ) : (
                        availableSizes.map((s) => {
                          const isSelected = combo.size === s;
                          return (
                            <TouchableOpacity
                              activeOpacity={1}
                              key={s}
                              onPress={() => updateCombo(idx, { size: s })}
                              className={`flex-1 h-11 rounded-xl items-center justify-center border-2 ${
                                isSelected
                                  ? 'bg-[#22C55E] border-[#22C55E]'
                                  : 'border-slate-100 bg-white'
                              }`}
                            >
                              <Text
                                className={`text-[11px] font-black ${
                                  isSelected ? 'text-white' : 'text-slate-500'
                                }`}
                              >
                                {s}
                              </Text>
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </View>
                    {data.gutterColorsMulti.length > 1 && (
                      <TouchableOpacity
                        activeOpacity={1}
                        onPress={() =>
                          onUpdate(
                            'gutter',
                            'gutterColorsMulti',
                            data.gutterColorsMulti.filter((c: any) => c.id !== combo.id)
                          )
                        }
                      >
                        <Icon
                          name="close"
                          size={24}
                          color="#EF4444"
                          className="bg-red-50 p-1 rounded-full"
                        />
                      </TouchableOpacity>
                    )}
                  </View>

                  <View
                    className={`mb-6 p-3 rounded-2xl ${
                      allocatedTotal > 0 && !data.partial
                        ? 'border-2 border-amber-400 bg-amber-50/20'
                        : ''
                    }`}
                  >
                    <View className="flex-row items-center mb-3">
                      <Text className="text-[11px] font-black text-slate-500">Gutter Partial?</Text>
                      {allocatedTotal > 0 && !data.partial && (
                        <Text className="text-[8px] font-black text-amber-600 ml-2 uppercase">
                          Selection Required
                        </Text>
                      )}
                    </View>
                    <View className="flex-row gap-2">
                      {['Yes', 'No'].map((opt) => {
                        const isSelected = data.partial === opt;
                        return (
                          <TouchableOpacity
                            activeOpacity={1}
                            key={opt}
                            onPress={() => onUpdate('gutter', 'partial', opt)}
                            className={`flex-1 h-11 rounded-xl items-center justify-center border-2 ${
                              isSelected
                                ? 'bg-[#22C55E] border-[#22C55E]'
                                : 'border-slate-100 bg-white'
                            }`}
                          >
                            <Text
                              className={`text-[11px] font-black ${
                                isSelected ? 'text-white' : 'text-slate-500'
                              }`}
                            >
                              {opt}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  <View
                    className={`mb-6 p-3 rounded-2xl ${
                      colorMissing ? 'border-2 border-amber-400 bg-amber-50/20' : ''
                    }`}
                  >
                    <View className="flex-row justify-between items-center mb-3">
                      <View className="flex-row items-center">
                        <Text className="text-[11px] font-black text-amber-500 uppercase tracking-tight">
                          {combo.size} Color
                        </Text>
                        {colorMissing && (
                          <Text className="text-[8px] font-black text-amber-600 ml-2 uppercase">
                            Required
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity
                        activeOpacity={1}
                        onPress={() =>
                          setColorModal({ visible: true, target: { type: 'combo', idx } })
                        }
                        className="flex-row items-center"
                      >
                        <Text className="text-[10px] font-black text-slate-500 mr-1">
                          More Colors
                        </Text>
                        <Icon name="arrow-right" size={12} color="#94A3B8" />
                      </TouchableOpacity>
                    </View>
                    <View className="flex-row justify-between mb-4">
                      {COLORS.Gutter.slice(0, 4).map((c) => {
                        const isSelected = combo.color === c.name;
                        return (
                          <TouchableOpacity
                            key={c.name}
                            activeOpacity={1}
                            onPress={() => updateCombo(idx, { color: c.name })}
                            style={{ backgroundColor: c.hex }}
                            className={`w-[23%] h-14 rounded-xl border-4 items-center justify-center ${
                              isSelected ? 'border-emerald-500' : 'border-white'
                            }`}
                          >
                            {isSelected && (
                              <Icon
                                name="check"
                                size={24}
                                color={c.name === 'White' ? '#22C55E' : 'white'}
                              />
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {combo.color && selectedColorObj && (
                      <View className="bg-[#22C55E] rounded-full py-2 px-4 self-start flex-row items-center">
                        <View
                          style={{ backgroundColor: selectedColorObj.hex }}
                          className="w-4 h-4 rounded-full border border-white/20 mr-2"
                        />
                        <Icon name="check" size={12} color="white" className="mr-1" />
                        <Text className="text-white text-[10px] font-black">{combo.color}</Text>
                      </View>
                    )}
                  </View>

                  <View className="mb-6">
                    <Text className="text-[11px] font-black text-amber-500 uppercase tracking-tight mb-4">
                      {combo.size} Gutter Measurements
                    </Text>
                    <View className="flex-row items-center mb-2">
                      <View className="flex-[1.5] items-start pl-1">
                        <Text className="text-[7px] font-black text-slate-400 uppercase">
                          Locations
                        </Text>
                      </View>
                      {STORIES.map((story) => (
                        <View key={story} className="flex-1 items-center">
                          <Text className="text-[7px] font-black text-slate-400 uppercase">
                            {story}
                          </Text>
                        </View>
                      ))}
                    </View>
                    {LOCATIONS.map((loc, lIdx) => (
                      <View key={loc} className="flex-row items-center mb-2">
                        <View className="flex-[1.5]">
                          <Text className="text-[9px] font-black text-slate-600 uppercase">
                            {loc}
                          </Text>
                        </View>
                        {[0, 1, 2].map((sIdx) => (
                          <View key={sIdx} className="flex-1 px-1">
                            <TextInput
                              value={String(combo.measurements[lIdx * 3 + sIdx] ?? '')}
                              onChangeText={(v) => {
                                const next = [...combo.measurements];
                                next[lIdx * 3 + sIdx] = v;
                                updateCombo(idx, { measurements: next });
                              }}
                              keyboardType="numeric"
                              placeholder="0"
                              className="h-10 bg-slate-50 rounded-xl border border-slate-200 text-center text-[12px] font-black text-black"
                            />
                          </View>
                        ))}
                      </View>
                    ))}
                    <TouchableOpacity
                      activeOpacity={1}
                      disabled
                      className="mt-4 bg-[#63D88E] h-12 rounded-2xl items-center justify-center"
                    >
                      <Text className="text-white font-black text-[12px]">
                        Grand Total: {subtotal.toFixed(0)} ft
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View>
                    <Text className="text-[12px] font-black text-slate-500 mb-4">
                      Miters & End Caps
                    </Text>
                    <View className="gap-2">
                      {[
                        { label: '# of Miters (Outside)', field: 'mitersOutside' },
                        { label: '# of Miters (Inside)', field: 'mitersInside' },
                        { label: '# End Caps (Rights)', field: 'endCapsRights' },
                        { label: '# End Caps (Lefts)', field: 'endCapsLefts' },
                      ].map((f) => {
                        const val = combo[f.field as keyof typeof combo];
                        const isError =
                          hasMeas && (val === '' || val === undefined || val === null);
                        return (
                          <View key={f.field} className="relative mb-1">
                            <Text
                              className={`text-[9px] font-black absolute -top-1.5 left-4 bg-white px-1 z-10 ${
                                isError ? 'text-red-500' : 'text-slate-400'
                              }`}
                            >
                              {f.label} *
                            </Text>
                            <TextInput
                              value={String(val ?? '')}
                              onChangeText={(v) => updateCombo(idx, { [f.field]: v })}
                              keyboardType="numeric"
                              className={`h-12 rounded-2xl border-2 px-5 text-[12px] font-black text-black ${
                                isError
                                  ? 'border-red-500 bg-red-50/10'
                                  : 'border-slate-300 bg-white'
                              }`}
                            />
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>
              );
            })}
            <TouchableOpacity
              activeOpacity={1}
              onPress={() =>
                onUpdate('gutter', 'gutterColorsMulti', [
                  ...(data.gutterColorsMulti || []),
                  {
                    id: Date.now() + Math.random(),
                    size: availableSizes[0] || '6" K-Style',
                    color: '',
                    measurements: Array(18).fill(''),
                    mitersOutside: '',
                    mitersInside: '',
                    endCapsRights: '',
                    endCapsLefts: '',
                  },
                ])
              }
              className="h-16 rounded-[24px] border-2 border-dashed border-indigo-200 items-center justify-center flex-row bg-white mt-2 mb-4 mx-1"
            >
              <Icon name="plus" size={16} color="#6366F1" />
              <Text className="text-indigo-500 font-black text-[11px] ml-2 uppercase">
                + Add Combination
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── DOWNSPOUTS & ACCESSORIES ── */}
          <View className="mb-10">
            <View className="flex-row items-center mb-8">
              <View className="flex-1 h-[1px] bg-slate-200" />
              <Text className="mx-4 text-[11px] font-black text-slate-500 tracking-widest uppercase">
                DOWNSPOUTS & ACCESSORIES
              </Text>
              <View className="flex-1 h-[1px] bg-slate-200" />
            </View>

            <View className="border-2 border-[#A5B4FC] rounded-[32px] p-2">
              {(data.downspoutsMulti || []).map((ds: any, dsIdx: number) => {
                const hasVal = [
                  'footage',
                  'aElbows',
                  'bElbows',
                  'roundElbow',
                  'offsetElbows',
                  'spoutSavers',
                ].some((f) => n(ds[f]) > 0);
                const dsColorObj = COLORS.Gutter.find((c) => c.name === ds.color);
                const dsColorMissing = hasVal && !ds.color;

                return (
                  <View
                    key={ds.id}
                    className="mb-4 bg-white rounded-[24px] border border-indigo-100 p-5 shadow-sm"
                  >
                    <View className="flex-row justify-between items-center mb-6">
                      <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Downspout #{dsIdx + 1}
                      </Text>
                      {data.downspoutsMulti.length > 1 && (
                        <TouchableOpacity
                          activeOpacity={1}
                          onPress={() =>
                            onUpdate(
                              'gutter',
                              'downspoutsMulti',
                              data.downspoutsMulti.filter((d: any) => d.id !== ds.id)
                            )
                          }
                        >
                          <Icon name="close" size={18} color="#EF4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                    <View className="flex-row flex-wrap gap-2 mb-6">
                      {filteredDownspoutTypes.map((it) => {
                        const isSelected = ds.type === it.name;
                        return (
                          <TouchableOpacity
                            activeOpacity={1}
                            key={it.name}
                            onPress={() => updateDS(dsIdx, { type: it.name })}
                            className={`w-[48%] h-11 rounded-xl items-center justify-center border-2 ${
                              isSelected
                                ? 'bg-[#22C55E] border-[#22C55E]'
                                : 'border-slate-100 bg-white'
                            }`}
                          >
                            <Text
                              className={`text-[10px] font-black ${
                                isSelected ? 'text-white' : 'text-slate-700'
                              }`}
                            >
                              {it.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View
                      className={`mb-6 p-3 rounded-2xl ${
                        dsColorMissing ? 'border-2 border-amber-400 bg-amber-50/20' : ''
                      }`}
                    >
                      <View className="flex-row justify-between items-center mb-3">
                        <View className="flex-row items-center">
                          <Text className="text-[11px] font-black text-indigo-500 uppercase tracking-tight">
                            Downspout Color
                          </Text>
                          {dsColorMissing && (
                            <Text className="text-[8px] font-black text-amber-600 ml-2 uppercase">
                              Required
                            </Text>
                          )}
                        </View>
                        <TouchableOpacity
                          activeOpacity={1}
                          onPress={() =>
                            setColorModal({ visible: true, target: { type: 'ds', idx: dsIdx } })
                          }
                          className="flex-row items-center"
                        >
                          <Text className="text-[10px] font-black text-slate-500 mr-1">
                            More Colors
                          </Text>
                          <Icon name="arrow-right" size={12} color="#94A3B8" />
                        </TouchableOpacity>
                      </View>
                      <View className="flex-row justify-between mb-4">
                        {COLORS.Gutter.slice(0, 4).map((c) => {
                          const isSel = ds.color === c.name;
                          return (
                            <TouchableOpacity
                              key={c.name}
                              activeOpacity={1}
                              onPress={() => updateDS(dsIdx, { color: c.name })}
                              style={{ backgroundColor: c.hex }}
                              className={`w-[23%] h-14 rounded-xl border-4 items-center justify-center ${
                                isSel ? 'border-emerald-500' : 'border-white'
                              }`}
                            >
                              {isSel && (
                                <Icon
                                  name="check"
                                  size={24}
                                  color={c.name === 'White' ? '#22C55E' : 'white'}
                                />
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {ds.color && dsColorObj && (
                        <View className="bg-[#22C55E] rounded-full py-2 px-4 self-start flex-row items-center">
                          <View
                            style={{ backgroundColor: dsColorObj.hex }}
                            className="w-4 h-4 rounded-full border border-white/20 mr-2"
                          />
                          <Icon name="check" size={12} color="white" className="mr-1" />
                          <Text className="text-white text-[10px] font-black">{ds.color}</Text>
                        </View>
                      )}
                    </View>
                    <View className="gap-2">
                      {[
                        { label: 'Downspout Footage (ft)', field: 'footage' },
                        { label: '# of A Elbows (1=1FT)', field: 'aElbows' },
                        { label: '# of B Elbows', field: 'bElbows' },
                        { label: '# of Round Elbow', field: 'roundElbow' },
                        { label: '# of Offset Elbows', field: 'offsetElbows' },
                        { label: '# of Spout Savers', field: 'spoutSavers' },
                      ].map((f) => (
                        <View key={f.field} className="relative mb-1">
                          <Text className="text-[9px] font-black absolute -top-1.5 left-4 bg-white px-1 z-10 text-slate-400 uppercase">
                            {f.label}
                          </Text>
                          <TextInput
                            value={String(ds[f.field] ?? '')}
                            onChangeText={(v) => updateDS(dsIdx, { [f.field]: v })}
                            keyboardType="numeric"
                            className="h-12 bg-white rounded-2xl border-2 border-slate-100 px-5 text-[12px] font-black text-black"
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
              <TouchableOpacity
                activeOpacity={1}
                onPress={() =>
                  onUpdate('gutter', 'downspoutsMulti', [
                    ...(data.downspoutsMulti || []),
                    {
                      id: Date.now() + Math.random(),
                      type: '',
                      color: '',
                      footage: '',
                      aElbows: '',
                      bElbows: '',
                      roundElbow: '',
                      offsetElbows: '',
                      spoutSavers: '',
                    },
                  ])
                }
                className="h-14 rounded-[24px] border-2 border-dashed border-indigo-200 items-center justify-center flex-row bg-white mx-1 mb-2"
              >
                <Icon name="plus" size={16} color="#6366F1" />
                <Text className="text-indigo-500 font-black text-[11px] ml-2 uppercase">
                  + Add Downspout
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── EXTRAS (LOCKED) ── */}
          <View className="bg-white rounded-[24px] border border-slate-100 overflow-hidden shadow-sm">
            <View className="px-5 py-4 flex-row justify-between items-center border-b border-slate-100">
              <Text className="text-[14px] font-black text-[#22C55E] uppercase">Extras</Text>
              <View className="bg-black px-3 py-1.5 rounded-lg">
                <Text className="text-[9px] font-black text-white">Locked from Job Summary</Text>
              </View>
            </View>

            <View className="p-4 gap-4">
              {[
                { label: 'Wedges', val: extrasValues.wedges },
                { label: 'Straps', val: extrasValues.straps },
              ].map((it) => (
                <View
                  key={it.label}
                  className="flex-row justify-between items-center border-b border-slate-50 pb-4"
                >
                  <View>
                    <Text className="text-[10px] font-black text-slate-400 uppercase mb-1">
                      {it.label}
                    </Text>
                    <Text className="text-xs font-black text-slate-800">{it.val}</Text>
                  </View>
                  <Icon name="lock" size={18} color="#CBD5E1" />
                </View>
              ))}

              <View
                className={`border-b border-slate-50 pb-4 p-2 rounded-xl ${
                  extrasValues.modifyHeight > 0 && (data.modifyHeightLocations || []).length === 0
                    ? 'bg-amber-50/50 border border-amber-400'
                    : ''
                }`}
              >
                <View className="flex-row justify-between items-center mb-3">
                  <View>
                    <View className="flex-row items-center">
                      <Text className="text-[10px] font-black text-slate-400 uppercase mb-1">
                        Modify Height/R&R
                      </Text>
                      {extrasValues.modifyHeight > 0 &&
                        (data.modifyHeightLocations || []).length === 0 && (
                          <Text className="text-[8px] font-black text-amber-600 ml-2 uppercase">
                            Loc Required
                          </Text>
                        )}
                    </View>
                    <Text className="text-xs font-black text-slate-800">
                      {extrasValues.modifyHeight}
                    </Text>
                  </View>
                  <Icon name="lock" size={18} color="#CBD5E1" />
                </View>
                {extrasValues.modifyHeight > 0 && (
                  <View className="flex-row flex-wrap gap-2">
                    {['Front', 'Rear', 'Left', 'Right'].map((loc) => {
                      const isSel = data.modifyHeightLocations?.includes(loc);
                      return (
                        <TouchableOpacity
                          key={loc}
                          onPress={() => toggleModifyLoc(loc)}
                          className={`w-[48%] h-10 rounded-xl items-center justify-center border-2 ${
                            isSel ? 'bg-emerald-500 border-emerald-500' : 'border-slate-200'
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-black ${
                              isSel ? 'text-white' : 'text-slate-500'
                            }`}
                          >
                            {loc}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>

              <View className="flex-row border-b border-slate-50 pb-4">
                <View className="flex-1 border-r border-slate-50 pr-4">
                  <View className="flex-row justify-between items-center mb-1">
                    <Text className="text-[10px] font-black text-slate-400 uppercase">
                      GroundSpout
                    </Text>
                    <Icon name="lock" size={14} color="#CBD5E1" />
                  </View>
                  <Text className="text-xs font-black text-slate-800">
                    {extrasValues.groundSpout}
                  </Text>
                </View>
                <View className="flex-1 pl-4">
                  <View className="flex-row justify-between items-center mb-1">
                    <Text className="text-[10px] font-black text-slate-400 uppercase">Color</Text>
                    <Icon name="lock" size={14} color="#CBD5E1" />
                  </View>
                  <Text
                    className={`text-[14px] font-black ${
                      extrasValues.groundSpout > 0 ? 'text-slate-800' : 'text-slate-300'
                    }`}
                  >
                    {extrasValues.groundSpout > 0 ? 'Black' : '—'}
                  </Text>
                </View>
              </View>

              {[
                {
                  label: 'Replace Corner Miter',
                  val: extrasValues.replaceCorner,
                  field: 'replaceCorner',
                },
                {
                  label: 'Extended Splash Guard',
                  val: extrasValues.extendedSplashGuard,
                  field: 'extendedSplashGuard',
                },
                {
                  label: 'Extended .032 Splash Guard',
                  val: extrasValues.extendedSplashGuard032,
                  field: 'extendedSplashGuard032',
                },
              ].map((it) => (
                <View key={it.label} className="flex-row border-b border-slate-50 pb-4">
                  <View className="flex-1 border-r border-slate-50 pr-4">
                    <View className="flex-row justify-between items-center mb-1">
                      <Text className="text-[10px] font-black text-slate-400 uppercase">
                        {it.label}
                      </Text>
                      <Icon name="lock" size={14} color="#CBD5E1" />
                    </View>
                    <Text className="text-xs font-black text-slate-800">{it.val}</Text>
                  </View>
                  <View className="flex-1 pl-4">
                    <View className="flex-row justify-between items-center mb-2">
                      <Text className="text-[10px] font-black text-slate-400 uppercase">Color</Text>
                    </View>
                    {it.val > 0 ? (
                      <TouchableOpacity
                        activeOpacity={1}
                        onPress={() =>
                          setColorModal({ visible: true, target: { type: 'extras', field: it.field } })
                        }
                        className={`flex-row items-center p-2 rounded-xl border ${
                          !data.extrasColors?.[it.field]
                            ? 'border-amber-400 bg-amber-50/50'
                            : 'border-slate-100 bg-slate-50'
                        }`}
                      >
                        {data.extrasColors?.[it.field] ? (
                          <>
                            <View
                              style={{
                                backgroundColor:
                                  COLORS.Gutter.find((c) => c.name === data.extrasColors[it.field])?.hex || '#000',
                              }}
                              className="w-4 h-4 rounded-full mr-2 border border-black/10"
                            />
                            <Text className="text-[10px] font-black text-slate-700 flex-1">
                              {data.extrasColors[it.field]}
                            </Text>
                            <Icon name="chevron-right" size={14} color="#94A3B8" />
                          </>
                        ) : (
                          <>
                            <Text className="text-[10px] font-black text-amber-600 flex-1">
                              Select Color
                            </Text>
                            <Icon name="plus" size={14} color="#F59E0B" />
                          </>
                        )}
                      </TouchableOpacity>
                    ) : (
                      <Text className="text-[14px] font-black text-slate-300">—</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* ── Color Picker Modal ── */}
      <Modal visible={!!colorModal} transparent animationType="slide">
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white rounded-t-[32px] p-6 max-h-[70%]">
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-lg font-black">Select Gutter Color</Text>
              <TouchableOpacity activeOpacity={1} onPress={() => setColorModal(null)}>
                <Icon name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="flex-row flex-wrap gap-4 justify-center">
                {COLORS.Gutter.map((c) => (
                  <TouchableOpacity
                    key={c.name}
                    onPress={() => {
                      if (colorModal?.target.type === 'combo')
                        updateCombo(colorModal.target.idx, { color: c.name });
                      else if (colorModal?.target.type === 'ds')
                        updateDS(colorModal.target.idx, { color: c.name });
                      else if (colorModal?.target.type === 'extras')
                        updateExtrasColor(colorModal.target.field, c.name);
                      setColorModal(null);
                    }}
                    className="items-center w-[20%]"
                  >
                    <View
                      style={{ backgroundColor: c.hex }}
                      className="w-12 h-12 rounded-xl border border-slate-100 shadow-sm mb-1"
                    />
                    <Text
                      className="text-[8px] font-bold text-center text-slate-500"
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
