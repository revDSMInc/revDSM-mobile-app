import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../theme/ThemeProvider';
import { AccountPopover } from '../components/AccountPopover';
import { ChatThreadsManager } from './ChatThreadsManager';
import { useNavigation } from '@react-navigation/native';
import { LeadService } from '../../services/api/leads';
import Logo from '../../assets/svgs/light-logo';
import { ENV } from '../../config/env';

import { createContext, useContext } from 'react';

export interface HeaderContextType {
  onFilterPress?: (() => void) | null;
  onListPress?: (() => void) | null;
  onNavigate?: ((route: any) => void) | null;
  setHeaderActions: (actions: {
    onFilterPress?: (() => void) | null;
    onListPress?: (() => void) | null;
    onNavigate?: ((route: any) => void) | null;
  }) => void;
}

export const HeaderContext = createContext<HeaderContextType | null>(null);

export const useHeader = () => {
  const ctx = useContext(HeaderContext);
  if (!ctx) {
    return {
      setHeaderActions: () => {},
    };
  }
  return ctx;
};

interface HeaderProps {
  onNavigate?: (route: any) => void;
  onFilterPress?: () => void;
  onListPress?: () => void;
}

export function Header({
  onNavigate: parentOnNavigate,
  onFilterPress: parentOnFilterPress,
  onListPress: parentOnListPress,
}: HeaderProps) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const ctx = useContext(HeaderContext);
  const [popoverVisible, setPopoverVisible] = useState(false);
  const [resolvedAvatarUrl, setResolvedAvatarUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);

  const activeOnNavigate = parentOnNavigate || ctx?.onNavigate;
  const activeOnFilterPress = parentOnFilterPress || ctx?.onFilterPress;
  const activeOnListPress = parentOnListPress || ctx?.onListPress;

  const onNavigate = (route: any) => {
    if (activeOnNavigate) activeOnNavigate(route);
    else navigation.navigate(route);
  };

  const initials = `${user?.firstName?.[0] || 'U'}${user?.lastName?.[0] || ''}`;


  useEffect(() => {
    const pic = user?.profilePicture;
    if (!pic) {
      setResolvedAvatarUrl(null);
      return;
    }

    setAvatarError(false);

    if (typeof pic === 'string' && pic.startsWith('http')) {
      setResolvedAvatarUrl(pic);
      return;
    }

    let filePath = '';
    let bucketName = ENV.S3_BUCKET;

    if (typeof pic === 'string') {
      filePath = pic;
    } else if (typeof pic === 'object' && pic?.filePath) {
      filePath = pic.filePath;
      bucketName = pic.bucketName || bucketName;
    }


    if (!filePath) {
      setResolvedAvatarUrl(null);
      return;
    }

    LeadService.getSecureUrls([{ bucketName, filePath }])
      .then((res: any) => {
        const secureData = res.data?.data || res.data || [];
        if (secureData[0]?.secureUrl) {
          setResolvedAvatarUrl(secureData[0].secureUrl);
        }
      })
      .catch((err: any) => console.warn('Header avatar resolve failed', err));
  }, [user?.profilePicture?.filePath, user?.profilePicture]);

  return (
    <View
      style={{ backgroundColor: isDark ? colors.background : '#101828' }}
    >
      <View
        className="py-3 flex-row items-center justify-between px-5 border-b"
        style={{
          backgroundColor: isDark ? colors.background : '#101828',
          borderBottomColor: isDark ? colors.border : '#F4F6F8',
        }}
      >
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => onNavigate('Leads')} style={styles.logo}>
            <Logo />
          </TouchableOpacity>
        </View>

        <View className="flex-row items-center">
          {activeOnFilterPress && (
            <TouchableOpacity
              onPress={activeOnFilterPress}
              className="w-9 h-9 rounded-full bg-[#4CBB17] items-center justify-center mr-3 shadow-sm"
            >
              <Icon name="filter-variant" size={22} color="white" />
            </TouchableOpacity>
          )}

          {activeOnListPress && (
            <TouchableOpacity
              onPress={activeOnListPress}
              className="w-9 h-9 rounded-full bg-[#4CBB17] items-center justify-center mr-3 shadow-sm"
            >
              <Icon name="format-list-bulleted" size={22} color="white" />
            </TouchableOpacity>
          )}

          <ChatThreadsManager onNavigate={onNavigate} />

          <TouchableOpacity
            onPress={() => setPopoverVisible(true)}
            style={[
              styles.avatarBtn,
              { backgroundColor: colors.surface, borderColor: colors.primary.main },
            ]}
          >
            {resolvedAvatarUrl && !avatarError ? (
              <Image
                source={{ uri: resolvedAvatarUrl }}
                style={{ width: 28, height: 28, borderRadius: 14 }}
                resizeMode="cover"
                onError={() => setAvatarError(true)}
              />
            ) : (
              <Text className="text-xs font-black" style={{ color: colors.text }}>
                {initials}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {popoverVisible && (
        <AccountPopover
          visible={popoverVisible}
          onClose={() => setPopoverVisible(false)}
          onNavigate={onNavigate}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarBtn: {
    width: 32,
    height: 32,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
