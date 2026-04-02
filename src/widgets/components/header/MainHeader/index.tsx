import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { useAuth } from '../../../../hooks/useAuth';
import { useTheme } from '../../../../theme/ThemeProvider';
import { AccountPopover } from '../../dropdown/AccountPopover';

interface HeaderProps {
  onNavigate: (route: any) => void;
  onChatPress?: () => void;
}

export function Header({ onNavigate, onChatPress }: HeaderProps) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const [popoverVisible, setPopoverVisible] = useState(false);
  
  const initials = `${user?.firstName?.[0] || 'U'}${user?.lastName?.[0] || ''}`;

  return (
    <>
    <View 
      className="h-[64px] flex-row items-center justify-between px-5 border-b" 
      style={{ backgroundColor: colors.background, borderBottomColor: isDark ? colors.border : '#F4F6F8' }}
    >
      <View className="flex-row items-center">
        {/* RevDSM Logo with Navigation */}
        <TouchableOpacity onPress={() => onNavigate('Leads')} className="flex-row items-center">
          <Text className={`text-[22px] font-black tracking-tighter ${isDark ? 'text-white' : 'text-[#212B36]'}`}>Rev</Text>
          <Text className="text-[22px] font-black tracking-tighter" style={{ color: colors.primary.main }}>DSM</Text>
        </TouchableOpacity>
      </View>

      <View className="flex-row items-center">
        {/* Chat Icon - Glassmorphic feel */}
        <TouchableOpacity 
          onPress={onChatPress} 
          className="mr-4 w-10 h-10 rounded-full items-center justify-center bg-[#919EAB12]"
        >
          <Text className="text-xl">💬</Text>
        </TouchableOpacity>

        {/* Profile Avatar */}
        <TouchableOpacity 
          onPress={() => setPopoverVisible(true)} 
          className="w-10 h-10 rounded-full items-center justify-center border-2"
          style={{ backgroundColor: colors.surface, borderColor: colors.primary.main }}
        >
          <Text className="text-[13px] font-black" style={{ color: colors.text }}>{initials}</Text>
        </TouchableOpacity>
      </View>
    </View>

    <AccountPopover 
      visible={popoverVisible} 
      onClose={() => setPopoverVisible(false)} 
      onNavigate={onNavigate}
    />
    </>
  );
}
