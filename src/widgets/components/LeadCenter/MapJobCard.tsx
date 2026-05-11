import React from 'react';
import { View, Text, TouchableOpacity, Dimensions, StyleSheet } from 'react-native';
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

  const formatAddress = (addr: any) => {
    if (typeof addr === 'string') return addr;
    if (!addr || typeof addr !== 'object') return 'Address not provided';
    const { houseNumber, streetName, city, state, zip } = addr;
    return [houseNumber, streetName, city, state, zip].filter(Boolean).join(', ');
  };

  const formattedDate = job.installationDate
    ? format(new Date(job.installationDate), 'MM/dd/yyyy')
    : job.createdAt ? format(new Date(job.createdAt), 'MM/dd/yyyy') : 'N/A';

  return (
    <View
      className="bg-white rounded-[24px] overflow-hidden"
      style={{
        width: 280,
        backgroundColor: 'white',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 10,
      }}
    >
      {/* Top Accent Bar */}
      <View className="h-[5px] bg-[#4CBB17] w-full" />

      <View className="p-4">
        {/* Header */}
        <View className="flex-row justify-between items-start mb-1">
          <View>
            <Text className="text-[17px] font-black text-[#4CBB17]">
              Job#{job.jobNumber || 'N/A'}
            </Text>
            <View className="flex-row items-center mt-1">
              <Icon name="calendar-blank" size={16} color="#4CBB17" />
              <Text className="text-[13px] text-slate-500 ml-1 font-bold">{formattedDate}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} className="p-1">
            <Icon name="close" size={24} color="#000" />
          </TouchableOpacity>
        </View>

        {/* Price & Rep Row */}
        <View className="flex-row gap-2 mt-3 mb-4">
          <View className="flex-1 bg-[#f8f9fa] rounded-[12px] p-2">
            <Text className="text-[10px] text-slate-400 font-bold mb-1 uppercase tracking-wider">
              Price
            </Text>
            <Text className="text-[16px] font-black text-[#4CBB17]">
              ${(job.price || 0).toLocaleString()}
            </Text>
          </View>
          <View className="flex-1 bg-[#f8f9fa] rounded-[12px] p-2">
            <Text className="text-[10px] text-slate-400 font-bold mb-1 uppercase tracking-wider">
              Sales Rep
            </Text>
            <Text className="text-[14px] font-bold text-slate-700" numberOfLines={1}>
              {job.salesRep?.fullName || job.salesRep?.firstName || 'Unknown'}
            </Text>
          </View>
        </View>

        {/* Property Address */}
        <View className="mb-4">
          <Text className="text-[10px] text-slate-400 font-bold mb-2 uppercase tracking-wider">
            Property Address
          </Text>
          <View className="flex-row">
            <View className="w-8 h-8 rounded-full bg-slate-100 items-center justify-center mr-2">
              <Icon name="map-marker-radius" size={18} color="#94a3b8" />
            </View>
            <Text className="flex-1 text-[12px] font-bold text-slate-700 leading-5">
              {job.fullAddress || formatAddress(job.address)}
            </Text>
          </View>
        </View>

        {/* Product Row */}
        <View className="flex-row items-center mb-5">
          <Text className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Product:</Text>
          <Text className="text-[12px] font-black text-slate-700 ml-2">{job.product || 'N/A'}</Text>
        </View>

        {/* Action Row */}
        <View className="flex-row items-center gap-3">
          <TouchableOpacity 
            className="w-10 h-10 rounded-xl bg-slate-50 items-center justify-center border border-slate-100"
          >
            <Icon
              name={job.isFavourite || job.isFavorite ? 'star' : 'star-outline'}
              size={20}
              color={job.isFavourite || job.isFavorite ? '#f59e0b' : '#94a3b8'}
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => onGalleryPress?.(job)}
            className="w-10 h-10 rounded-xl bg-slate-50 items-center justify-center border border-slate-100"
          >
            <Icon name="image-multiple-outline" size={20} color="#94a3b8" />
          </TouchableOpacity>

          {isMyJob && (
            <>
              <TouchableOpacity
                onPress={() => onCameraPress?.(job)}
                className="w-10 h-10 rounded-xl bg-slate-50 items-center justify-center border border-slate-100"
              >
                <Icon name="camera-plus-outline" size={20} color="#94a3b8" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => onReferencePress?.(job)}
                className="w-10 h-10 rounded-xl bg-slate-50 items-center justify-center border border-slate-100"
              >
                <Icon
                  name="account-group-outline"
                  size={20}
                  color={job.jobReferrals?.length > 0 ? '#10b981' : '#94a3b8'}
                />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
};
