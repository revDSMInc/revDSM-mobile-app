import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { useUnreadNotificationCount } from '../../hooks/useNotifications';

interface Props {
  onNavigate?: (route: any) => void;
}

export function NotificationBell({ onNavigate }: Props) {
  const { colors, isDark } = useTheme();
  const { unreadCount } = useUnreadNotificationCount();

  return (
    <TouchableOpacity
      onPress={() => onNavigate?.('Notifications')}
      accessibilityRole="button"
      accessibilityLabel={
        unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
      }
      style={[
        styles.bellBtn,
        { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.primary.main },
      ]}
    >
      <Icon name="bell-outline" size={20} color={isDark ? colors.text : colors.grey[0]} />
      {unreadCount > 0 && (
        <View style={[styles.badge, { backgroundColor: '#D32F2F' }]}>
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    marginRight: 16,
    width: 32,
    height: 32,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
  },
});

export default NotificationBell;
