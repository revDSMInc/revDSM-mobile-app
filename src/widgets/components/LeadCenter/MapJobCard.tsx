import React from 'react';
import { View, Text, TouchableOpacity, Dimensions } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { format } from 'date-fns';

const { width } = Dimensions.get('window');

interface MapJobCardProps {
  job: any;
  userLocation?: { latitude: number; longitude: number } | null;
  onClose: () => void;
  onRefresh?: () => void;
  isMyJob?: boolean;
  onCameraPress?: (job: any) => void;
  onReferencePress?: (job: any) => void;
  onGalleryPress?: (job: any) => void;
}

export const MapJobCard = ({
  job,
  onClose,
  isMyJob,
  onCameraPress,
  onReferencePress,
  onGalleryPress,
}: MapJobCardProps) => {
  const { colors, isDark } = useTheme();

  if (!job) return null;

  const formattedDate = job.installationDate
    ? format(new Date(job.installationDate), 'MM/dd/yyyy')
    : 'N/A';

  return (
    <View
      className="bg-white dark:bg-zinc-900 rounded-[32px] overflow-hidden shadow-2xl w-full max-w-[340px]"
      style={{ alignSelf: 'center' }}
    >
      <View className="p-6">
        {/* Header */}
        <View className="flex-row justify-between items-start mb-6">
          <View>
            <Text className="text-[22px] font-bold text-green-600 mb-1">
              Job#{job.jobNumber || 'N/A'}
            </Text>
            <View className="flex-row items-center">
              <Icon name="calendar" size={18} color="#4CBB17" />
              <Text className="text-[14px] text-slate-500 ml-2 font-medium">{formattedDate}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} className="p-1">
            <Icon name="close" size={24} color={isDark ? '#fff' : '#000'} />
          </TouchableOpacity>
        </View>

        {/* Sales Rep & Price Box */}
        <View className="bg-slate-50 dark:bg-zinc-800/50 rounded-2xl p-4 mb-6">
          <View className="flex-row justify-between items-center mb-1">
            <Text className="text-[12px] text-slate-400 font-bold uppercase">Sales Rep</Text>
            <Text className="text-[12px] text-slate-400 font-bold uppercase">Price</Text>
          </View>
          <View className="flex-row justify-between items-center">
            <Text className="text-[16px] font-bold text-green-600">
              {job.salesRep?.firstName || 'sr'}
            </Text>
            <Text className="text-[22px] font-black text-green-600">
              ${(job.price || 0).toLocaleString()}
            </Text>
          </View>
        </View>

        {/* Info Section */}
        <View className="mb-4">
          <Text className="text-[12px] text-slate-400 font-bold mb-2">Property Address</Text>
          <View className="flex-row">
            <View className="w-6 h-6 items-center justify-center mr-2">
              <Icon name="map-marker" size={18} color="#94a3b8" />
            </View>
            <Text
              className="text-[14px] font-bold dark:text-white flex-1 leading-5"
              numberOfLines={2}
            >
              {job.fullAddress || 'Address Pending'}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center">
          <Text className="text-[12px] text-slate-400 font-bold">Product:</Text>
          <Text className="text-[12px] font-bold dark:text-white ml-2">{job.product || 'N/A'}</Text>
        </View>
      </View>

      {/* Footer Area with Buttons */}
      <View className="bg-slate-50 dark:bg-zinc-800/80 p-4 px-6">
        <View className="flex-row gap-3 mb-4">
          {/* Favorite */}
          <TouchableOpacity 
            className="w-11 h-11 rounded-xl bg-white dark:bg-zinc-800 items-center justify-center border border-slate-200 dark:border-zinc-700 shadow-sm"
          >
            <Icon
              name={job.isFavourite ? 'star' : 'star-outline'}
              size={22}
              color={job.isFavourite ? '#f59e0b' : '#94a3b8'}
            />
          </TouchableOpacity>

          {/* Gallery (View Images) */}
          {(job.images?.beforeImages?.length > 0 || job.images?.afterImages?.length > 0) && (
            <TouchableOpacity
              onPress={() => onGalleryPress?.(job)}
              className="w-11 h-11 rounded-xl bg-white dark:bg-zinc-800 items-center justify-center border border-slate-200 dark:border-zinc-700 shadow-sm"
            >
              <Icon name="image-multiple" size={22} color="#4CBB17" />
            </TouchableOpacity>
          )}

          {/* Camera (Upload) */}
          {isMyJob && (
              <TouchableOpacity
                onPress={() => onCameraPress?.(job)}
                className="w-11 h-11 rounded-xl bg-white dark:bg-zinc-800 items-center justify-center border border-slate-200 dark:border-zinc-700 shadow-sm"
              >
                <Icon name="camera-plus" size={22} color="#94a3b8" />
              </TouchableOpacity>
            )}

          {/* Referral */}
          {isMyJob && (
            <TouchableOpacity
              onPress={() => onReferencePress?.(job)}
              className="w-11 h-11 rounded-xl bg-white dark:bg-zinc-800 items-center justify-center border border-slate-200 dark:border-zinc-700 shadow-sm"
            >
              <Icon
                name="account-group"
                size={22}
                color={job.jobReferrals?.length > 0 ? '#4CBB17' : '#94a3b8'}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* <TouchableOpacity
          onPress={onClose}
          className="bg-green-600 h-12 rounded-2xl items-center justify-center shadow-lg shadow-green-200"
        >
          <Text className="text-white font-black text-[16px]">View Job Details</Text>
        </TouchableOpacity> */}
      </View>
    </View>
  );
};
