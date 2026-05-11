import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../theme/ThemeProvider';
import { AccountPopover } from '../components/AccountPopover';
import { ChatThreadsManager } from './ChatThreadsManager';
import { useNavigation } from '@react-navigation/native';

interface HeaderProps {
  onNavigate?: (route: any) => void;
  onFilterPress?: () => void;
  onListPress?: () => void;
}

export function Header({
  onNavigate: parentOnNavigate,
  onFilterPress,
  onListPress,
}: HeaderProps) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [popoverVisible, setPopoverVisible] = useState(false);

  const onNavigate = (route: any) => {
    if (parentOnNavigate) parentOnNavigate(route);
    else navigation.navigate(route);
  };

  const initials = `${user?.firstName?.[0] || 'U'}${user?.lastName?.[0] || ''}`;

  return (
    <SafeAreaView
      edges={['top']}
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
            <Text className="text-[22px] font-black" style={{ color: isDark ? '#fff' : '#2EDE56' }}>
              rev
            </Text>
            <Text className="text-[22px] font-black" style={{ color: colors.primary.contrastText }}>
              DSM
            </Text>
          </TouchableOpacity>
        </View>

        <View className="flex-row items-center">
          {onFilterPress && (
            <TouchableOpacity
              onPress={onFilterPress}
              className="w-10 h-10 rounded-xl bg-[#2EDE56] items-center justify-center mr-2 shadow-sm"
            >
              <Icon name="filter-variant" size={22} color="white" />
            </TouchableOpacity>
          )}

          {onListPress && (
            <TouchableOpacity
              onPress={onListPress}
              className="w-10 h-10 rounded-xl bg-[#2EDE56] items-center justify-center mr-2 shadow-sm"
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
            <Text className="text-xs font-black" style={{ color: colors.text }}>
              {initials}
            </Text>
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
    </SafeAreaView>
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
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
