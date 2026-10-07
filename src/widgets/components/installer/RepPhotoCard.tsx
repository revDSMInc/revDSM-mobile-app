import React, { useMemo } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { resolveS3Url } from '../../../utils/s3-utils';
import { productColor } from '../../../constants/installer';
import type { PreInstallPhotos, RepPhoto, PhotoSlot } from '../../../config/types/installer';

interface Props {
  photos?: PreInstallPhotos;
  onOpenMatch?: () => void;
}

const photoUri = (p: RepPhoto) =>
  p.bucketName && !p.s3url.startsWith('http')
    ? `https://${p.bucketName}.s3.amazonaws.com/${p.s3url.replace(/^\//, '')}`
    : resolveS3Url(p.s3url);

export function RepPhotoCard({ photos, onOpenMatch }: Props) {
  const { colors, isDark } = useTheme();
  const surface = isDark ? colors.surface : '#F4F6F8';

  const totalSlots = useMemo(
    () =>
      (photos?.products ?? []).reduce(
        (n, prod) => n + prod.categories.reduce((m, c) => m + c.slots.length, 0),
        0
      ),
    [photos]
  );

  if (!photos || !photos.products?.length) return null;

  return (
    <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: surface }}>
      <View className="flex-row items-center justify-between mb-0.5">
        <Text className="text-base font-black" style={{ color: colors.text }}>
          Rep Photos
        </Text>
        {!!onOpenMatch && (
          <TouchableOpacity onPress={onOpenMatch} className="flex-row items-center">
            <Text className="text-xs font-bold mr-1" style={{ color: colors.primary.main }}>
              Match
            </Text>
            <Icon name="chevron-right" size={16} color={colors.primary.main} />
          </TouchableOpacity>
        )}
      </View>
      <Text className="text-[11px] font-semibold mb-2" style={{ color: colors.textSecondary }}>
        {photos.filledSlots} of {totalSlots} slots shot at sale · {photos.totalPhotos} photo
        {photos.totalPhotos === 1 ? '' : 's'}
      </Text>

      {photos.products.map((prod, idx) => {
        const accent = productColor(idx);
        const withShots = prod.categories.filter((c) =>
          c.slots.some((s) => s.photos.length > 0)
        );
        const emptyCount = prod.categories.length - withShots.length;

        return (
          <View key={prod.product} className="mb-1.5">
            <View className="flex-row items-center mb-1.5">
              <Icon name="camera-outline" size={14} color={accent} />
              <Text className="ml-1.5 text-sm font-bold" style={{ color: colors.text }}>
                {prod.product}
              </Text>
            </View>

            {withShots.map((cat) => {
              const shot = cat.slots.filter((s) => s.photos.length > 0);
              return (
                <View key={cat.label} className="mb-2">
                  <Text
                    className="text-[11px] font-bold tracking-wide mb-1"
                    style={{ color: colors.textSecondary }}
                  >
                    {cat.label.toUpperCase()} · {shot.length}/{cat.slots.length}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {shot.map((slot) => (
                      <Thumb key={slot.id} slot={slot} accent={accent} />
                    ))}
                  </ScrollView>
                </View>
              );
            })}

            {emptyCount > 0 && (
              <Text className="text-[11px] font-semibold" style={{ color: colors.textSecondary }}>
                {emptyCount} more {emptyCount === 1 ? 'area' : 'areas'} with no rep shots
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Thumb({ slot, accent }: { slot: PhotoSlot; accent: string }) {
  const { colors } = useTheme();
  const extra = slot.photos.length - 1;

  return (
    <View className="mr-2" style={{ width: 84 }}>
      <View
        className="rounded-xl overflow-hidden border"
        style={{ height: 84, borderColor: accent + '55', backgroundColor: colors.background }}
      >
        <Image
          source={{ uri: photoUri(slot.photos[0]) }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
        {extra > 0 && (
          <View
            className="absolute bottom-1 right-1 rounded px-1.5 py-0.5"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          >
            <Text className="text-white text-[10px] font-black">+{extra}</Text>
          </View>
        )}
      </View>
      <Text
        numberOfLines={1}
        className="text-[10px] font-bold mt-1 text-center"
        style={{ color: colors.textSecondary }}
      >
        {slot.name}
      </Text>
    </View>
  );
}
