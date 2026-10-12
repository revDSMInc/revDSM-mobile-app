import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { usePendingUploads } from '../../hooks/usePendingUploads';

/** Entry to the Pending uploads screen. Shows what is queued on the device and what needs the rep. */
export const PendingUploadsCard: React.FC = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const { total, attention } = usePendingUploads();

  const subtitle =
    total === 0
      ? 'Everything is uploaded.'
      : attention > 0
        ? `${attention} ${attention === 1 ? 'item needs' : 'items need'} your attention · ${total} on this device`
        : `${total} ${total === 1 ? 'item' : 'items'} waiting to send`;

  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('PendingUploads')}
      accessibilityRole="button"
      className="p-6 rounded-[32px] border mt-6 flex-row items-center"
      style={{
        backgroundColor: isDark ? colors.surface : colors.card,
        borderColor: attention > 0 ? '#FCD34D' : colors.border,
      }}
    >
      <Icon
        name={attention > 0 ? 'alert-circle-outline' : 'cloud-upload-outline'}
        size={22}
        color={attention > 0 ? '#D97706' : colors.textSecondary}
      />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text
          className="font-black tracking-widest text-[11px]"
          style={{ color: colors.textSecondary }}
        >
          PENDING UPLOADS
        </Text>
        <Text className="text-[13px] font-bold mt-1" style={{ color: colors.text }}>
          {subtitle}
        </Text>
      </View>
      <Icon name="chevron-right" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );
};

export default PendingUploadsCard;
