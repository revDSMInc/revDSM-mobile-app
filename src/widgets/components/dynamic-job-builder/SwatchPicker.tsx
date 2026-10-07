import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Image, ActivityIndicator, StyleSheet } from 'react-native';
import Svg, { Rect, Polygon } from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { GUTTER_COLORS } from '../../../utils/dynamic-job-builder/constants/color-palettes';
import { LeadService } from '../../../services/api/leads';

interface SwatchColor {
  name: string;
  hex: string;
  hex2?: string;
  imageUrl?: string;
  bucketName?: string;
  filePath?: string;
}

function isDualColor(c?: SwatchColor): boolean {
  return Boolean(c && c.hex2);
}

function DiagonalSplit({ topLeft, bottomRight }: { topLeft: string; bottomRight: string }) {
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={StyleSheet.absoluteFill}
    >
      <Rect x="0" y="0" width="100" height="100" fill={topLeft || '#FFFFFF'} />
      <Polygon points="100,0 100,100 0,100" fill={bottomRight} />
    </Svg>
  );
}

interface SwatchPickerProps {
  label?: string;
  value?: string;
  onChange?: (val: string) => void;
  colors?: SwatchColor[];
  showMoreColors?: boolean;
  accentColor?: string;
  compact?: boolean;
}

function useColorSecureImages(colors: SwatchColor[]) {
  const [urlByName, setUrlByName] = useState<Record<string, string>>({});

  const signature = useMemo(
    () => colors.map((c) => `${c.name}:${c.bucketName || ''}:${c.filePath || ''}:${c.imageUrl || ''}`).join('|'),
    [colors],
  );

  useEffect(() => {
    let cancelled = false;
    const direct: Record<string, string> = {};
    const toFetch = colors.filter((c) => {
      if (c.imageUrl) {
        direct[c.name] = c.imageUrl;
        return false;
      }
      return Boolean(c.bucketName && c.filePath);
    });

    if (!toFetch.length) {
      setUrlByName(direct);
      return;
    }

    (async () => {
      try {
        const res = await LeadService.getSecureUrls(
          toFetch.map((c) => ({ bucketName: c.bucketName || '', filePath: c.filePath || '' })),
        );
        const secured = (res.data?.data || res.data || []) as any[];
        const map: Record<string, string> = { ...direct };
        toFetch.forEach((c) => {
          const hit = secured.find((s) => s.filePath === c.filePath || s.s3url === c.filePath);
          if (hit?.secureUrl || hit?.url) map[c.name] = hit.secureUrl || hit.url;
        });
        if (!cancelled) setUrlByName(map);
      } catch {
        if (!cancelled) setUrlByName(direct);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return urlByName;
}

function isLightHex(hex?: string): boolean {
  const m = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return false;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

export function SwatchPicker({
  label,
  value,
  onChange,
  colors,
  showMoreColors = true,
  accentColor = '#22C55E',
  compact = false,
}: SwatchPickerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const palette: SwatchColor[] = colors && colors.length ? colors : GUTTER_COLORS;
  const preview = palette.slice(0, 4);
  const selectedColor = palette.find((c) => c.name === value);
  const selectedHex = selectedColor?.hex;

  const urlByName = useColorSecureImages(palette);
  const selectedImageUrl = value ? urlByName[value] : undefined;

  const renderSwatch = (c: SwatchColor, size: 'grid' | 'modal') => {
    const selected = value === c.name;
    const both = isDualColor(c);
    const isLight = c.name?.toLowerCase() === 'white';
    return (
      <TouchableOpacity
        key={c.name}
        onPress={() => {
          onChange?.(selected ? '' : c.name);
          if (size === 'modal') setModalOpen(false);
        }}
        className={size === 'grid' ? 'w-[23%] h-14 rounded-xl items-center justify-center' : 'w-[30%] items-center mb-4'}
      >
        <View
          className={size === 'grid' ? 'w-full h-full rounded-xl items-center justify-center' : 'w-full h-14 rounded-xl items-center justify-center'}
          style={{
            backgroundColor: both ? (c.hex || '#FFFFFF') : c.hex,
            borderWidth: 4,
            borderColor: selected ? accentColor : '#E2E8F0',
            overflow: 'hidden',
          }}
        >
          {both && <DiagonalSplit topLeft={c.hex || '#FFFFFF'} bottomRight={c.hex2 as string} />}
          {/* Green check on the combo swatch stays legible over both halves. */}
          {selected && <Icon name="check" size={22} color={both || isLight ? accentColor : '#fff'} />}
        </View>
        {size === 'modal' && (
          <Text className="text-[9px] font-bold text-slate-500 mt-1 text-center" numberOfLines={1}>{c.name}</Text>
        )}
      </TouchableOpacity>
    );
  };

  const colorModal = (
    <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
      <View className="flex-1 bg-black/40 justify-end">
        <View className="bg-white rounded-t-3xl p-6 max-h-[75%]">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-[16px] font-black text-slate-900">Select Color</Text>
            <TouchableOpacity onPress={() => setModalOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={22} color="#64748B" />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View className="flex-row flex-wrap justify-between">
              {palette.map((c) => renderSwatch(c, 'modal'))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  if (compact) {
    const onSelectedColor = isLightHex(selectedHex) ? '#000' : '#fff';
    return (
      <View className="mb-5">
        {label && (
          <Text className="text-[11px] font-black text-slate-400 mb-2">{label}</Text>
        )}
        <TouchableOpacity
          onPress={() => setModalOpen(true)}
          className="flex-row items-center justify-center rounded-lg border-2 px-3"
          style={{
            minHeight: 44,
            borderColor: '#E2E8F0',
            backgroundColor: value && selectedHex ? selectedHex : 'transparent',
          }}
        >
          {value ? (
            <>
              <Icon name="pencil" size={14} color={onSelectedColor} />
              <Text className="text-[12px] font-black ml-1.5" style={{ color: onSelectedColor }} numberOfLines={1}>{value}</Text>
            </>
          ) : (
            <>
              <Icon name="plus" size={16} color="#64748B" />
              <Text className="text-[12px] font-black text-slate-500 ml-1.5">Color</Text>
            </>
          )}
        </TouchableOpacity>
        {colorModal}
      </View>
    );
  }

  return (
    <View className="mb-5">
      {label && (
        <Text className="text-[11px] font-black text-slate-400 mb-2">{label}</Text>
      )}
      {showMoreColors && palette.length > 4 && (
        <View className="items-end mb-2">
          <TouchableOpacity onPress={() => setModalOpen(true)} className="flex-row items-center">
            <Text className="text-[10px] font-black text-slate-500 mr-1">More Colors</Text>
            <Icon name="arrow-right" size={12} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      )}
      <View className="flex-row flex-wrap gap-2">
        {preview.map((c) => renderSwatch(c, 'grid'))}
      </View>

      {/* Selected color: confirmation chip (left) + product image (right, small). */}
      {value && (
        <View className="mt-3 flex-row items-center gap-2">
          <View
            className="flex-row items-center rounded-full py-2 px-4"
            style={{ backgroundColor: accentColor }}
          >
            {isDualColor(selectedColor) ? (
              <View className="w-4 h-4 rounded-full border border-white/20 mr-2" style={{ overflow: 'hidden' }}>
                <DiagonalSplit topLeft={selectedColor?.hex || '#FFFFFF'} bottomRight={selectedColor?.hex2 as string} />
              </View>
            ) : selectedHex ? (
              <View
                className="w-4 h-4 rounded-full border border-white/20 mr-2"
                style={{ backgroundColor: selectedHex }}
              />
            ) : null}
            <Icon name="check" size={12} color="#fff" />
            <Text className="text-white text-[10px] font-black ml-1">{value}</Text>
          </View>
          {selectedImageUrl ? (
            <Image
              source={{ uri: selectedImageUrl }}
              className="w-11 h-11 rounded-lg bg-slate-100"
              resizeMode="cover"
            />
          ) : (selectedColor?.bucketName && selectedColor?.filePath) ? (
            <View className="w-11 h-11 rounded-lg bg-slate-100 items-center justify-center">
              <ActivityIndicator size="small" color={accentColor} />
            </View>
          ) : null}
        </View>
      )}

      {/* Full "Select Color" modal listing every color (web ColorPicker dialog). */}
      {colorModal}
    </View>
  );
}
