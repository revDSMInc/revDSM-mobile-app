import React from 'react';
import { View, Text, Modal, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useUserRole } from '../../hooks/useUserRole';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../i18n/LanguageProvider';

interface AccountPopoverProps {
  visible: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
  onLogoutRequest: () => void;
}

export function AccountPopover({ visible, onClose, onNavigate, onLogoutRequest }: AccountPopoverProps) {
  const { user } = useAuth();
  const { isInstaller } = useUserRole();
  const { colors, isDark } = useTheme();
  const { t, toggleLanguage, isSpanish, canSwitchLanguage } = useTranslation();

  const hasLmsPermission = user?.permissions?.LMS?.includes('view_lms') || false;

  return (
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
                {t('account.settings')}
              </Text>
            </TouchableOpacity>

            {/* Job Tracker is a sales surface — installers have no route for it. */}
            {!isInstaller && (
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
                  {t('account.jobTracker')}
                </Text>
              </TouchableOpacity>
            )}

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
                {t('account.myLearning')}
              </Text>
            </TouchableOpacity>
          </View>

          <View
            className="h-px mx-2"
            style={{ backgroundColor: isDark ? colors.border : '#E5E8EB' }}
          />

          {/* Language — INSTALLERS ONLY, sitting directly above Logout.
              Spanish is an installer feature; the sales side stays English, and
              `canSwitchLanguage` is what says so (`LanguageProvider` enforces the same
              rule on `t()`, so hiding this row can't leave anyone stranded in a language
              they can no longer change).

              The menu stays OPEN on tap: the row's own label switches with everything
              else, which is the confirmation that the tap worked. Closing here would hide
              the one thing that proves it. The label always names the language the tap
              switches TO, written in that language — "Español" reads as an offer to a
              Spanish speaker in a way "Spanish" does not. */}
          {canSwitchLanguage && (
            <TouchableOpacity
              onPress={toggleLanguage}
              className="flex-row items-center justify-between px-4 py-3 mx-2 my-1 rounded-2xl"
              style={{ backgroundColor: isDark ? colors.background : '#F4F6F8' }}
              accessibilityRole="button"
              accessibilityLabel={`${t('account.languageLabel')}: ${
                isSpanish ? t('account.switchToEnglish') : t('account.switchToSpanish')
              }`}
            >
              <Text
                className="text-[13px] font-medium tracking-widest"
                style={{ color: colors.textSecondary }}
              >
                {t('account.languageLabel')}
              </Text>
              <Text
                className="text-[13px] font-black tracking-widest"
                style={{ color: colors.primary.main }}
              >
                {isSpanish ? t('account.switchToEnglish') : t('account.switchToSpanish')}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={onLogoutRequest}
            style={[styles.logoutBtn, { backgroundColor: '#FF563020' }]}
          >
            <Text
              className="text-[13px] font-black  tracking-widest"
              style={{ color: '#FF5630' }}
            >
              {t('account.logout')}
            </Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
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
