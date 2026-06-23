import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../theme/ThemeProvider';
import { GlobalModal } from '../common/modal/GlobalModal';

interface AccountPopoverProps {
  visible: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
}

export function AccountPopover({ visible, onClose, onNavigate }: AccountPopoverProps) {
  const { user, logout } = useAuth();
  const { colors, isDark } = useTheme();
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const hasLmsPermission = user?.permissions?.LMS?.includes('view_lms') || false;

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.3)' }]} onPress={onClose}>
          <View
            style={[
              styles.container,
              {
                backgroundColor: isDark ? colors.surface : '#fff',
              },
            ]}
          >
            <View className="px-5 py-5 pb-4">
              <Text
                className="text-sm font-black  tracking-widest"
                style={{ color: colors.text }}
                numberOfLines={1}
              >
                {user ? `${user.firstName} ${user.lastName}` : ''}
              </Text>
              <Text
                className="text-[10px] font-bold mt-1 opacity-60"
                style={{ color: colors.textSecondary }}
                numberOfLines={1}
              >
                {user?.email}
              </Text>
            </View>

            <View
              className="h-px mx-2"
              style={{ backgroundColor: isDark ? colors.border : '#E5E8EB' }}
            />

            <View className="p-2">
              <TouchableOpacity
                onPress={() => {
                  onClose();
                  onNavigate('Profile');
                }}
                className="p-3 rounded-2xl"
              >
                <Text
                  className="text-[13px] font-medium  tracking-widest"
                  style={{ color: colors.text }}
                >
                  Account Settings
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  onClose();
                  onNavigate('JobTracker');
                }}
                className="p-3 rounded-2xl"
              >
                <Text
                  className="text-[13px] font-medium  tracking-widest"
                  style={{ color: colors.text }}
                >
                  Job Tracker
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  onClose();
                  onNavigate('MyLearning');
                }}
                className={`p-3 rounded-2xl ${hasLmsPermission ? '' : 'opacity-40'}`}
              >
                <Text
                  className="text-[13px] font-medium tracking-widest"
                  style={{ color: colors.text }}
                >
                  My Learning
                </Text>
              </TouchableOpacity>
            </View>

            <View
              className="h-px mx-2"
              style={{ backgroundColor: isDark ? colors.border : '#E5E8EB' }}
            />

            <TouchableOpacity
              onPress={handleLogout}
              style={[styles.logoutBtn, { backgroundColor: colors.error.main + '20' }]}
            >
              <Text
                className="text-[13px] font-black  tracking-widest"
                style={{ color: colors.error.main }}
              >
                Logout
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <GlobalModal
        visible={showLogoutModal}
        type="warning"
        title="Logout"
        message="Are you sure want to Logout?"
        confirmText="Logout"
        cancelText="Cancel"
        onConfirm={async () => {
          setShowLogoutModal(false);
          onClose();
          await logout();
        }}
        onCancel={() => setShowLogoutModal(false)}
        onClose={() => setShowLogoutModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'flex-end',
    paddingTop: 80,
    paddingRight: 20,
  },
  container: {
    width: 224,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  logoutBtn: {
    padding: 16,
    margin: 8,
    alignItems: 'center',
    borderRadius: 16,
  },
});
