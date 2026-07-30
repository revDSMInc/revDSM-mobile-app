import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from '../../hooks/useAuth';
import { useSecureLogo } from '../../hooks/useSecureLogo';
import { useTheme } from '../../theme/ThemeProvider';
import { AccountPopover } from '../components/AccountPopover';
import { ChatThreadsManager } from './ChatThreadsManager';
import { useNavigation } from '@react-navigation/native';
import Logo from '../../assets/svgs/light-logo';
import { GlobalModal } from '../common/modal/GlobalModal';

import { createContext, useContext } from 'react';

export interface HeaderContextType {
  onFilterPress?: (() => void) | null;
  onListPress?: (() => void) | null;
  onNavigate?: ((route: any) => void) | null;
  /** Number of filters currently applied — shown as a badge on the filter icon. */
  filterCount?: number | null;
  setHeaderActions: (actions: {
    onFilterPress?: (() => void) | null;
    onListPress?: (() => void) | null;
    onNavigate?: ((route: any) => void) | null;
    filterCount?: number | null;
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
  filterCount?: number;
}

export function Header({
  onNavigate: parentOnNavigate,
  onFilterPress: parentOnFilterPress,
  onListPress: parentOnListPress,
  filterCount: parentFilterCount,
}: HeaderProps) {
  const { colors, isDark } = useTheme();
  const { user, logout } = useAuth();
  const navigation = useNavigation<any>();
  const ctx = useContext(HeaderContext);
  const [popoverVisible, setPopoverVisible] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  // Multi-tenant dynamic branding (web parity — `account-popover.js` renders the
  // company logo via `useSecureLogo`): the header brand button shows the tenant's
  // company logo (`user.companyLogo`, falling back to `user.profilePicture`),
  // presigned per session. Falls back to the rep's initials when neither resolves.
  const secureLogo = useSecureLogo();

  const activeOnNavigate = parentOnNavigate || ctx?.onNavigate;
  const activeOnFilterPress = parentOnFilterPress || ctx?.onFilterPress;
  const activeOnListPress = parentOnListPress || ctx?.onListPress;
  const activeFilterCount = parentFilterCount ?? ctx?.filterCount ?? 0;

  const onNavigate = (route: any) => {
    if (activeOnNavigate) activeOnNavigate(route);
    else navigation.navigate(route);
  };

  const initials = `${user?.firstName?.[0] || 'U'}${user?.lastName?.[0] || ''}`;

  // Reset the image-error flag whenever a new logo URL resolves so a transient
  // failure doesn't permanently pin the avatar to initials.
  useEffect(() => {
    setAvatarError(false);
  }, [secureLogo]);

  return (
    <View
      style={{ backgroundColor: isDark ? colors.background : '#0E2A1C' }}
    >
      <View
        className="py-3 flex-row items-center justify-between px-5 border-b"
        style={{
          backgroundColor: isDark ? colors.background : '#0E2A1C',
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
              {/* Solid funnel + applied-filter badge, matching the web header
                  (`header-filter.js`: filter-alt-sharp inside an error Badge). */}
              <Icon name="filter" size={22} color="white" />
              {activeFilterCount > 0 && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>
                    {activeFilterCount > 9 ? '9+' : activeFilterCount}
                  </Text>
                </View>
              )}
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
            {secureLogo && !avatarError ? (
              <Image
                source={{ uri: secureLogo }}
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

      <AccountPopover
        visible={popoverVisible}
        onClose={() => setPopoverVisible(false)}
        onNavigate={onNavigate}
        onLogoutRequest={() => {
          setPopoverVisible(false);
          setShowLogoutModal(true);
        }}
      />

      <GlobalModal
        visible={showLogoutModal}
        type="error"
        title="Logout"
        message="Are you sure want to Logout?"
        confirmText="Logout"
        cancelText="Cancel"
        onConfirm={async () => {
          setShowLogoutModal(false);
          await logout();
        }}
        onCancel={() => setShowLogoutModal(false)}
        onClose={() => setShowLogoutModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Applied-filter count. Web parity: MUI <Badge color="error" max={9} />.
  // Geometry matches the chat unread badge next to it (ChatThreadsManager).
  filterBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#FF5630',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  filterBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
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
