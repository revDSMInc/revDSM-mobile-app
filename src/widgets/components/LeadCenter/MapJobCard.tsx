import React from 'react';
import { View, Text, TouchableOpacity, Dimensions, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import IonIcon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { format } from 'date-fns';
import { getOfflineImagesForJob } from '../../../services/api/offlineUploadManager';

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
  onFavoritePress?: (job: any) => void;
  showProduct?: boolean;
}

export const MapJobCard = ({
  job,
  onClose,
  isMyJob,
  onGalleryPress,
  onCameraPress,
  onReferencePress,
  onFavoritePress,
  showProduct = true,
}: MapJobCardProps) => {
  const { colors, isDark } = useTheme();

  if (!job) return null;

  const parseAddress = (addr: any): { houseNum: string; rest: string } => {
    let street = '';
    let cityStateZip = '';

    if (typeof addr === 'string') {
      const parts = addr.split(', ');
      street = parts[0] || '';
      cityStateZip = parts.slice(1).join(', ');
    } else if (addr && typeof addr === 'object') {
      if (addr.houseNumber) {
        const rest = [addr.streetName, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
        return { houseNum: String(addr.houseNumber), rest };
      }
      street = addr.streetName || '';
      cityStateZip = [addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
    } else {
      return { houseNum: '', rest: 'Address not provided' };
    }

    const streetParts = street.trim().split(' ');
    const firstToken = streetParts[0] || '';
    const isNumeric = /^\d/.test(firstToken);

    if (isNumeric && streetParts.length > 1) {
      const houseNum = firstToken;
      const streetName = streetParts.slice(1).join(' ');
      const rest = [streetName, cityStateZip].filter(Boolean).join(', ');
      return { houseNum, rest };
    }

    const rest = [street, cityStateZip].filter(Boolean).join(', ');
    return { houseNum: '', rest };
  };

  const formattedDate = job.installationDate
    ? format(new Date(job.installationDate), 'MM/dd/yyyy')
    : job.leadDate ? format(new Date(job.leadDate), 'MM/dd/yyyy')
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
              <Text className="text-[13px] text-[#4CBB17] ml-1 font-bold">{formattedDate}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} className="p-1">
            <Icon name="close" size={24} color="#000" />
          </TouchableOpacity>
        </View>

        {/* Price & Rep Row */}
        <View className="flex-row gap-2 mt-3 mb-4">
          {isMyJob && (
            <View className="flex-1 bg-[#f8f9fa] rounded-[12px] p-2">
              <Text className="text-[10px] text-slate-400 font-bold mb-1 uppercase tracking-wider">
                Sales Rep
              </Text>
              <Text className="text-[14px] font-bold text-slate-700" numberOfLines={1}>
                {job.userName || job.salesRepName || job.salesRep?.fullName || job.salesRep?.firstName || 'Unknown'}
              </Text>
            </View>
          )}
          <View className="flex-1 bg-[#f8f9fa] rounded-[12px] p-2">
            <Text className="text-[10px] text-slate-400 font-bold mb-1 uppercase tracking-wider">
              Price
            </Text>
            <Text className="text-[16px] font-black text-[#4CBB17]">
              ${(job.price || 0).toLocaleString()}
            </Text>
          </View>
        </View>

        {/* Property Address */}
        <View className="mb-4">
          <Text className="text-[10px] text-slate-400 font-bold mb-2 uppercase tracking-wider">
            Property Address
          </Text>
          <View className="mt-1">
            {(() => {
              const { houseNum, rest } = parseAddress(job.address || job);
              return (
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#334155', lineHeight: 20 }}>
                  {houseNum !== '' && (
                    <Text style={{
                      backgroundColor: 'rgba(148, 163, 184, 0.35)',
                      color: 'rgba(51, 65, 85, 0.01)',
                      borderRadius: 12,
                    }}>
                      {houseNum}
                    </Text>
                  )}
                  {houseNum !== '' ? ' ' : ''}
                  {rest}
                </Text>
              );
            })()}
          </View>
        </View>

        {/* Product Row */}
        {showProduct && (
          <View className="flex-row items-center mb-5">
            <Text className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Product:</Text>
            <Text className="text-[12px] font-black text-slate-700 ml-2">{job.product || 'N/A'}</Text>
          </View>
        )}

        {/* Action Row */}
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            onPress={() => onFavoritePress?.(job)}
            className="w-10 h-10 rounded-xl bg-slate-50 items-center justify-center border border-slate-100"
          >
            <Icon
              name={job.isFavourite || job.isFavorite ? 'star' : 'star-outline'}
              size={20}
              color={job.isFavourite || job.isFavorite ? '#f59e0b' : '#94a3b8'}
            />
          </TouchableOpacity>

          {/* Show Gallery only if images exist */}
          {(() => {
            const offlineBefore = getOfflineImagesForJob(job.jobNumber, 'before');
            const offlineAfter = getOfflineImagesForJob(job.jobNumber, 'after');
            const hasBefore = (job.images?.beforeImages?.length > 0) || (offlineBefore.length > 0);
            const hasAfter = (job.images?.afterImages?.length > 0) || (offlineAfter.length > 0);
            const hasImages = hasBefore || hasAfter;
            return hasImages && (
              <TouchableOpacity
                onPress={() => onGalleryPress?.(job)}
                className="w-10 h-10 rounded-xl bg-slate-50 items-center justify-center border border-slate-100"
              >
                <IonIcon name="image" size={20} color="#333333" />
              </TouchableOpacity>
            );
          })()}

          {/* Upload: Only for Owner and if no images yet */}
          {isMyJob &&
            (() => {
              const offlineBefore = getOfflineImagesForJob(job.jobNumber, 'before');
              const offlineAfter = getOfflineImagesForJob(job.jobNumber, 'after');
              const hasBefore = (job.images?.beforeImages?.length > 0) || (offlineBefore.length > 0);
              const hasAfter = (job.images?.afterImages?.length > 0) || (offlineAfter.length > 0);
              return !(hasBefore && hasAfter) && (
                <TouchableOpacity
                  onPress={() => onCameraPress?.(job)}
                  className="w-10 h-10 rounded-xl bg-slate-50 items-center justify-center border border-slate-100"
                >
                  <Icon name="camera" size={20} color="#000000ff" />
                </TouchableOpacity>
              );
            })()}


          {/* Reference: Always for Owner, Only if exists for others */}
          {(isMyJob || job.jobReferrals?.some((r: any) => r.referralToggle)) && (() => {
            const hasReferral = job.jobReferrals?.some((r: any) => r.referralToggle);
            const isLocked = !isMyJob && hasReferral;
            return (
              <TouchableOpacity
                onPress={() => onReferencePress?.(job)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: '#f8fafc',
                  borderWidth: 1,
                  borderColor: '#f1f5f9',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: isLocked ? 0.8 : 1,
                }}
              >
                <Icon
                  name="account-group"
                  size={20}
                  color={hasReferral ? '#4CBB17' : '#94a3b8'}
                />
                {/* Lock badge for non-owner jobs */}
                {isLocked && (
                  <View style={{
                    position: 'absolute',
                    top: -3,
                    right: -3,
                    backgroundColor: '#64748b',
                    borderRadius: 8,
                    width: 14,
                    height: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Icon name="lock" size={8} color="white" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })()}
        </View>
      </View>
    </View>
  );
};
