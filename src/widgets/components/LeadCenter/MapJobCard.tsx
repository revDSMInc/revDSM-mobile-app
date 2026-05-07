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
  onGalleryPress,
  onCameraPress,
  onReferencePress,
}: MapJobCardProps) => {
  const { colors, isDark } = useTheme();

  if (!job) return null;

  const formattedDate = job.installationDate
    ? format(new Date(job.installationDate), 'MM/dd/yyyy')
    : 'N/A';

  return (
    <View
      className="bg-white rounded-[20px] overflow-hidden"
      style={{
        width: 260,
        backgroundColor: 'white',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 10,
      }}
    >
      {/* Top Accent Bar */}
      <View className="h-1 bg-green-500 w-full" />

      <View className="p-3">
        {/* Header */}
        <View className="flex-row justify-between items-start mb-2">
          <View>
            <Text className="text-[15px] font-black text-green-600">
              Job#{job.jobNumber || 'N/A'}
            </Text>
            <View className="flex-row items-center mt-0.5">
              <Icon name="calendar-blank" size={14} color="#4CBB17" />
              <Text className="text-[11px] text-slate-400 ml-1 font-bold">{formattedDate}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} className="p-1">
            <Icon name="close" size={18} color="#64748b" />
          </TouchableOpacity>
        </View>

        {/* Price & Sales Rep Row */}
        <View className="flex-row gap-2 mb-3">
          <View className="flex-1 bg-slate-50 rounded-lg p-2.5">
            <Text className="text-[10px] text-slate-400 font-bold tracking-wider mb-0.5">
              Price
            </Text>
            <Text className="text-[16px] font-black text-green-600">
              ${(job.price || 0).toLocaleString()}
            </Text>
          </View>
          {isMyJob && (
            <View className="flex-1 bg-slate-50 rounded-lg p-2.5">
              <Text className="text-[10px] text-slate-400 font-bold tracking-wider mb-0.5">
                Sales Rep
              </Text>
              <Text className="text-[12px] font-black text-green-600" numberOfLines={1}>
                {job.salesRepName || job.salesRep?.name || 'Me'}
              </Text>
            </View>
          )}
        </View>

        {/* Address Section */}
        <View className="mb-3">
          <Text className="text-[10px] text-slate-400 font-bold tracking-wider mb-1.5">
            Property Address
          </Text>
          <View className="flex-row items-center">
            <View className="w-7 h-7 rounded-full bg-slate-200 items-center justify-center mr-2 overflow-hidden">
              <Icon name="map-marker-radius" size={16} color="#94a3b8" />
            </View>
            <View className="flex-1">
              <Text className="text-[11px] font-bold text-slate-700 leading-4" numberOfLines={2}>
                <Text style={{ backgroundColor: '#e2e8f0', color: 'transparent', borderRadius: 2 }}>
                  {job.fullAddress?.substring(0, 5) || '12345'}
                </Text>
                {job.fullAddress?.substring(5) || job.address?.streetName || 'Address Pending'}
              </Text>
            </View>
          </View>
        </View>

        <View className="flex-row items-center mb-3">
          <Text className="text-[10px] text-slate-400 font-bold tracking-wider">Product:</Text>
          <Text className="text-[11px] font-black text-slate-700 ml-2">{job.product || 'N/A'}</Text>
        </View>

        {/* Action Row */}
        <View className="flex-row pt-3 border-t border-slate-50">
          <TouchableOpacity className="w-8 h-8 rounded-lg bg-slate-50 items-center justify-center border border-slate-100">
            <Icon
              name={job.isFavourite || job.isFavorite ? 'star' : 'star-outline'}
              size={16}
              color={job.isFavourite || job.isFavorite ? '#f59e0b' : '#94a3b8'}
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => onGalleryPress?.(job)}
            className="w-8 h-8 rounded-lg bg-slate-50 items-center justify-center border border-slate-100 ml-2"
          >
            <Icon name="image-multiple-outline" size={16} color="#94a3b8" />
          </TouchableOpacity>

          {isMyJob && (
            <TouchableOpacity
              onPress={() => onCameraPress?.(job)}
              className="w-8 h-8 rounded-lg bg-slate-50 items-center justify-center border border-slate-100 ml-2"
            >
              <Icon name="camera-plus-outline" size={16} color="#94a3b8" />
            </TouchableOpacity>
          )}

          {(isMyJob || (job.jobReferrals?.length > 0 && job.jobReferrals[0]?.referralToggle)) && (
            <TouchableOpacity
              onPress={() => onReferencePress?.(job)}
              className="w-8 h-8 rounded-lg bg-slate-50 items-center justify-center border border-slate-100 ml-2"
            >
              <Icon
                name="account-group-outline"
                size={16}
                color={job.jobReferrals?.length > 0 ? '#10b981' : '#94a3b8'}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};
