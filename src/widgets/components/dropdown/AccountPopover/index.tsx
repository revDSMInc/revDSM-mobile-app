import React from 'react';
import { View, Text, Modal, TouchableOpacity, Pressable } from 'react-native';
import { useAuth } from '../../../../hooks/useAuth';
import { useTheme } from '../../../../theme/ThemeProvider';

interface AccountPopoverProps {
  visible: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
}

export function AccountPopover({ visible, onClose, onNavigate }: AccountPopoverProps) {
  const { user, logout } = useAuth();
  const { colors, isDark } = useTheme();

  const hasLmsPermission = user?.permissions?.LMS?.includes('view_lms') || false;

  const handleLogout = async () => {
    onClose();
    await logout();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/30 items-end pr-5 pt-20" onPress={onClose}>
        <View 
          className="w-56 rounded-3xl overflow-hidden shadow-2xl" 
          style={{ backgroundColor: isDark ? colors.surface : '#fff' }}
        >
          {/* User Profile Info */}
          <View className="p-5 pb-4">
            <Text className="text-sm font-black" style={{ color: colors.text }} numberOfLines={1}>
              {user ? `${user.firstName} ${user.lastName}` : ''}
            </Text>
            <Text className="text-[11px] mt-1 opacity-60 font-bold" style={{ color: colors.textSecondary }} numberOfLines={1}>
              {user?.email}
            </Text>
          </View>

          <View className="h-[1px] mx-2" style={{ backgroundColor: isDark ? colors.border : '#E5E8EB' }} />

          {/* Menu Items */}
          <View className="p-3">
            <TouchableOpacity 
              onPress={() => { onClose(); onNavigate('Profile'); }} 
              className="p-3 rounded-2xl"
            >
              <Text className="text-[13px] font-black" style={{ color: colors.text }}>Account Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={() => { onClose(); onNavigate('JobTracker'); }} 
              className="p-3 rounded-2xl"
            >
              <Text className="text-[13px] font-black" style={{ color: colors.text }}>Job Tracker</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={() => { onClose(); onNavigate('Learning'); }} 
              className={`p-3 rounded-2xl ${hasLmsPermission ? '' : 'opacity-40'}`}
            >
              <Text className="text-[13px] font-black" style={{ color: colors.text }}>My Learning</Text>
            </TouchableOpacity>
          </View>

          <View className="h-[1px] mx-2" style={{ backgroundColor: isDark ? colors.border : '#E5E8EB' }} />

          {/* Logout Button */}
          <TouchableOpacity onPress={handleLogout} className="p-4 m-2 items-center rounded-2xl bg-red-500/10">
            <Text className="text-[13px] font-black" style={{ color: colors.error.main }}>Logout</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}
