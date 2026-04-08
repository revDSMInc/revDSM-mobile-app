import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { useAuth } from '../../../../hooks/useAuth';
import { useTheme } from '../../../../theme/ThemeProvider';
import { AccountPopover } from '../../dropdown/AccountPopover';
import { ChatThreadsManager } from './ChatThreadsManager';

interface HeaderProps {
  onNavigate: (route: any) => void;
}

export function Header({ onNavigate }: HeaderProps) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const [popoverVisible, setPopoverVisible] = useState(false);

  const initials = `${user?.firstName?.[0] || 'U'}${user?.lastName?.[0] || ''}`;

  return (
    <>
      <View
        className="h-16 flex-row items-center justify-between px-5 border-b"
        style={{
          backgroundColor: colors.background,
          borderBottomColor: isDark ? colors.border : '#F4F6F8',
        }}
      >
        <View className="flex-row items-center">
          {/* RevDSM Logo with Navigation */}
          <TouchableOpacity onPress={() => onNavigate('Leads')} style={styles.logo}>
            <Text
              className="text-[22px] font-black tracking-tighter"
              style={{ color: isDark ? '#fff' : '#212B36' }}
            >
              Rev
            </Text>
            <Text
              className="text-[22px] font-black tracking-tighter"
              style={{ color: colors.primary.main }}
            >
              DSM
            </Text>
          </TouchableOpacity>
        </View>

        <View className="flex-row items-center">
          <ChatThreadsManager onNavigate={onNavigate} />

          {/* Profile Avatar */}
          <TouchableOpacity
            onPress={() => setPopoverVisible(true)}
            style={[
              styles.avatarBtn,
              { backgroundColor: colors.surface, borderColor: colors.primary.main },
            ]}
          >
            <Text className="text-[13px] font-black" style={{ color: colors.text }}>
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
    </>
  );
}

const styles = StyleSheet.create({
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chatBtn: {
    marginRight: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBtn: {
    width: 40,
    height: 40,
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
