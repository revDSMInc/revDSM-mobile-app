import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Pressable, Image } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import Pin from '../../../assets/svgs/icons/pin';
import { useLeadPreviewUrl } from '../../../hooks/useLeadPreviewUrl';
import { PhotoPeekPressable } from '../../common/PhotoPeekPressable';
import { ImageGalleryModal } from '../../modals/ImageGalleryModal';

const CHANNEL_SCHEMES: Record<string, { icon: string; color: string }> = {
  Announcements: { icon: '📢', color: '#FF6B6B' },
  'Sales Wins': { icon: '🎉', color: '#51CF66' },
  General: { icon: '💬', color: '#748FFC' },
  Files: { icon: '📁', color: '#339AF0' },
  Commission: { icon: '💰', color: '#FFC107' },
  'Commission Sheets': { icon: '💰', color: '#FFC107' },
  Questions: { icon: '❓', color: '#9775FA' },
};

/**
 * Lead preview thumbnail shown before the title in a lead chat header — the same
 * street-view image as the Recent-Leads row, resolved via the shared hook. Falls
 * back to a home-outline glyph, matching web's `quick-chat-dialog.js` header.
 *
 * The thumbnail is previewable: HOLD peeks it enlarged (instant, because
 * `PhotoPeekPressable` warms a local `file://` copy — see the "Hold-to-peek
 * previews" note in CLAUDE.md), and a TAP opens the same full-screen
 * `ImageGalleryModal` the chat's image messages use. It was previously an inert
 * `<Image>` with no press handling at all, so the rep could not open it.
 */
function LeadHeaderThumbnail({ leadPreview, title }: { leadPreview: any; title?: string }) {
  const thumbnailUrl = useLeadPreviewUrl(leadPreview);
  const [preview, setPreview] = useState<string | null>(null);

  if (thumbnailUrl) {
    return (
      <>
        <PhotoPeekPressable
          uri={thumbnailUrl}
          label={title}
          // `onPress` hands back the WARMED uri, so the gallery opens on the local
          // file rather than re-fetching the pre-signed S3 object.
          onPress={(peekUri) => setPreview(peekUri || thumbnailUrl)}
          className="w-10 h-10 rounded-xl mr-3 overflow-hidden"
          style={{ backgroundColor: '#F1F5F9' }}
        >
          <Image
            source={{ uri: thumbnailUrl }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        </PhotoPeekPressable>
        <ImageGalleryModal
          visible={!!preview}
          images={preview ? [{ uri: preview, label: title }] : []}
          onClose={() => setPreview(null)}
        />
      </>
    );
  }

  return (
    <View
      className="w-10 h-10 rounded-xl items-center justify-center mr-3"
      style={{ backgroundColor: '#F1F5F9' }}
    >
      <MaterialCommunityIcon name="home-outline" size={22} color="#919EAB" />
    </View>
  );
}

export const ChatHeader = ({
  customerName,
  description,
  leadPreview,
  isChannel,
  isViewOnly,
  colors,
  isDark,
  isSearching,
  setIsSearching,
  searchQuery,
  setSearchQuery,
  pinnedMessages,
  setShowPinned,
  participants,
  setParticipantModalVisible,
  searchIndex,
  totalResults,
  onPrev,
  onNext,
}: any) => {
  const navigation = useNavigation<any>();

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      if (isChannel) {
        navigation.navigate('ChatThreads');
      } else {
        navigation.navigate('Leads');
      }
    }
  };

  return (
    <View
      className="px-4 pt-3 pb-4 border-b"
      style={{ backgroundColor: isDark ? '#1A1A1A' : '#fff', borderBottomColor: colors.border }}
    >
      <Pressable
        onPress={handleBack}
        className="flex-row items-center mb-4"
        hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
        style={{ zIndex: 9999 }}
      >
        <View
          className="w-8 h-8 rounded-full items-center justify-center mr-2"
          style={{ backgroundColor: isDark ? '#242424' : '#F1F5F9' }}
        >
          <Icon name="arrow-back" size={18} color={colors.text} />
        </View>
        <Text className="font-bold text-sm" style={{ color: isDark ? '#A3E635' : '#65A30D' }}>
          Back to {isChannel ? 'Channels' : 'Leads'}
        </Text>
      </Pressable>

      <View className="flex-row items-center justify-between mb-4">
        <View className="flex-row items-center flex-1">
          {isChannel ? (
            <View
              className="w-10 h-10 rounded-xl items-center justify-center mr-3"
              style={{
                backgroundColor: (CHANNEL_SCHEMES[customerName]?.color || '#748FFC') + '33',
              }}
            >
              <Text className="text-md">{CHANNEL_SCHEMES[customerName]?.icon || '💬'}</Text>
            </View>
          ) : (
            <LeadHeaderThumbnail leadPreview={leadPreview} title={customerName} />
          )}
          <View className="flex-1">
            <Text
              className="text-base font-bold"
              style={{ color: '#1C252E' }}
              numberOfLines={1}
            >
              {customerName || (isChannel ? 'Announcements' : 'Lead Conversation')}
            </Text>
            {isChannel && (
              <Text className="text-[11px] font-medium" style={{ color: '#637381' }}>
                {customerName?.toLowerCase().includes('announcement')
                  ? 'Management Announcements (View only)'
                  : description || 'Team Communication Channel'}
              </Text>
            )}
          </View>
        </View>

        <View className="flex-row items-center gap-3">
          <TouchableOpacity onPress={() => setShowPinned(true)} className="relative">
            <Pin width={30} height={30} />
            {pinnedMessages.length > 0 && (
              <View className="absolute -top-1.5 -right-1.5 bg-amber-500 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 items-center justify-center">
                <Text className="text-[8px] text-white font-bold">{pinnedMessages.length}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setParticipantModalVisible(true)} className="relative">
            <Icon name="people" size={30} color="#94a3b8" />
            <View className="absolute -top-1 -right-1 bg-green-500 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 items-center justify-center">
              <Text className="text-[8px] text-white font-bold">{participants.length}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <View
        className="h-11 rounded-full border flex-row items-center px-4"
        style={{
          backgroundColor: isDark ? '#121212' : '#F9FBFC',
          borderColor: isDark ? '#2A2A2A' : '#E2E8F0',
        }}
      >
        <Icon name="search" size={18} color="#94a3b8" />
        <TextInput
          className="flex-1 ml-3 text-sm font-medium"
          placeholder="Search messages...."
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={{ color: colors.text }}
        />
        {searchQuery.length > 0 && (
          <View className="flex-row items-center">
            <Text className="text-[11px] font-bold opacity-50 mr-2" style={{ color: colors.text }}>
              {totalResults > 0 ? `${searchIndex + 1}/${totalResults}` : '0/0'}
            </Text>

            <View className="flex-row items-center gap-1 border-l pl-2 border-gray-200 dark:border-zinc-800">
              <TouchableOpacity onPress={onPrev} className="p-1" disabled={totalResults === 0}>
                <Icon
                  name="chevron-up"
                  size={20}
                  color={totalResults > 0 ? colors.text : colors.textSecondary + '40'}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={onNext} className="p-1" disabled={totalResults === 0}>
                <Icon
                  name="chevron-down"
                  size={20}
                  color={totalResults > 0 ? colors.text : colors.textSecondary + '40'}
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => setSearchQuery('')} className="ml-2 p-1">
              <Icon name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
};
