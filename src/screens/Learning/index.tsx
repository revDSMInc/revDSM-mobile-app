import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { FlashMessage } from '../../config/message';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../hooks/useAuth';
import { Storage } from '../../utils/storage';
import { ENV } from '../../config/env';
import { logEvent } from '../../services/api/LoggerService';

export default function LearningPage() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [opening, setOpening] = useState(false);

  const hasLmsPermission = user?.permissions?.LMS?.includes('view_lms') || false;

  const handleOpenLearning = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const userId = user?._id || user?.id;

      // Log LMS login event (web parity: account-popover logs a `login` / `lms` event)
      if (userId) {
        try {
          await logEvent('login', {
            user_id: userId,
            module_type: 'lms',
            created_by: userId,
            meta: {
              email: user?.email,
              firstName: user?.firstName,
              lastName: user?.lastName,
            },
          });
        } catch (err) {
          // Log silently so we never block the redirect
          console.error('Failed to log LMS login event:', err);
        }
      }

      // Build the redirect URL exactly like web: ?token=<jwt>&redirectingFrom=<origin>
      const token = Storage.getItem('accessToken');
      const base = ENV.LMS_REDIRECT_URL;
      let fullPath = base;
      if (token) {
        fullPath += `${base.includes('?') ? '&' : '?'}token=${token}`;
      }
      fullPath += `${fullPath.includes('?') ? '&' : '?'}redirectingFrom=revdsm-sales-mobile`;

      const canOpen = await Linking.canOpenURL(fullPath);
      if (!canOpen) {
        FlashMessage.error('Unable to open My Learning portal');
        return;
      }
      await Linking.openURL(fullPath);
    } catch (err) {
      console.error('Failed to open LMS portal:', err);
      FlashMessage.error('Unable to open My Learning portal');
    } finally {
      setOpening(false);
    }
  }, [opening, user]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['bottom', 'left', 'right']}>
      <View className="flex-1 items-center justify-center -mt-20 px-8">
        <Text className="text-[60px] opacity-40">📚</Text>
        <Text className="text-xl font-black  tracking-widest mt-6" style={{ color: colors.text }}>
          My Learning
        </Text>

        {hasLmsPermission ? (
          <>
            <Text
              className="mt-2 opacity-50 font-black  text-[10px] tracking-widest text-center"
              style={{ color: colors.textSecondary }}
            >
              Open the LMS portal to access your training materials and courses.
            </Text>

            <TouchableOpacity
              onPress={handleOpenLearning}
              disabled={opening}
              activeOpacity={0.85}
              style={[styles.button, opening && { opacity: 0.6 }]}
            >
              {opening ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <MaterialCommunityIcons name="open-in-new" size={18} color="#FFFFFF" />
              )}
              <Text style={styles.buttonText}>Open My Learning</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text
            className="mt-2 opacity-50 font-black  text-[10px] tracking-widest text-center"
            style={{ color: colors.textSecondary }}
          >
            You don't have access to My Learning. Please contact your administrator.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  button: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4CBB17',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
