import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { AuthService } from '../../services/api/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { Header } from '../../widgets/components/headers/MainHeader';
import { CustomInput } from '../../widgets/controls/input/CustomInput';
import { CustomButton } from '../../widgets/controls/button/CustomButton';
import { useNavigation } from '@react-navigation/native';
import { FlashMessage } from '../../config/message';
import { useUpdateProfileMutation, useToggle2FAMutation } from '../../hooks/useProfileMutation';

type TabType = 'profile' | '2fa';

export default function ProfilePage() {
  const { user } = useAuth();
  const updateMutation = useUpdateProfileMutation();
  const tfaMutation = useToggle2FAMutation();
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const [activeTab, setActiveTab] = useState<TabType>('profile');

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phoneNumber: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
  });

  const [tfaSettings, setTfaSettings] = useState({
    enabled: false,
    method: 'email',
  });

  useEffect(() => {
    if (user) {
      const phone = user.phoneNumber || (user as any).phone || '';
      setFormData({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        phoneNumber: phone,
        address: user.address || '',
        city: user.city || '',
        state: user.state || '',
        zipCode: user.zipCode || '',
      });
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === '2fa') fetchTfaSettings();
  }, [activeTab]);

  const fetchTfaSettings = async () => {
    try {
      const res = await AuthService.getTfaSettings();
      if (res.data?.data) {
        setTfaSettings(res.data.data);
      }
    } catch (err) {}
  };

  const handleUpdateProfile = async () => {
    try {
      await updateMutation.mutateAsync(formData);
      FlashMessage.success('Success', 'Profile updated successfully');
    } catch (error: any) {
      FlashMessage.error('Error', error?.message || 'Failed to update profile');
    }
  };

  const handleToggle2FA = async () => {
    try {
      if (tfaSettings.enabled) {
        await tfaMutation.mutateAsync({ enabled: false, method: tfaSettings.method });
        FlashMessage.success('Success', 'Two-factor authentication disabled');
      } else {
        await tfaMutation.mutateAsync({ enabled: true, method: tfaSettings.method });
        FlashMessage.info(
          'Setup Initialized',
          `Please check your ${tfaSettings.method} for verification.`
        );
      }
      fetchTfaSettings();
    } catch (error: any) {
      FlashMessage.error('Error', error?.message || 'Configuration failed');
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <Header onNavigate={(route) => navigation.navigate(route)} />

      {/* Tab Header */}
      <View className="flex-row px-5 border-b" style={{ borderBottomColor: colors.border }}>
        <TabItem
          label="Profile"
          active={activeTab === 'profile'}
          onPress={() => setActiveTab('profile')}
          icon="👤"
        />
        <TabItem
          label="2FA Settings"
          active={activeTab === '2fa'}
          onPress={() => setActiveTab('2fa')}
          icon="🛡️"
        />
      </View>

      <ScrollView contentContainerClassName="p-5">
        {activeTab === 'profile' ? (
          <View className="flex-1">
            <Text
              className="text-[10px] font-black uppercase tracking-widest mb-4 opacity-60"
              style={{ color: colors.textSecondary }}
            >
              Personal Information
            </Text>
            <CustomInput
              label="First Name"
              value={formData.firstName}
              onChangeText={(v: string) => setFormData({ ...formData, firstName: v })}
            />
            <CustomInput
              label="Last Name"
              value={formData.lastName}
              onChangeText={(v: string) => setFormData({ ...formData, lastName: v })}
            />
            <CustomInput
              label="Phone Number"
              value={formData.phoneNumber}
              onChangeText={(v: string) => setFormData({ ...formData, phoneNumber: v })}
            />

            <Text
              className="text-[10px] font-black uppercase tracking-widest mb-4 mt-6 opacity-60"
              style={{ color: colors.textSecondary }}
            >
              Address Details
            </Text>
            <CustomInput
              label="Street Address"
              value={formData.address}
              onChangeText={(v: string) => setFormData({ ...formData, address: v })}
            />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <CustomInput
                  label="City"
                  value={formData.city}
                  onChangeText={(v: string) => setFormData({ ...formData, city: v })}
                />
              </View>
              <View className="flex-1">
                <CustomInput
                  label="State"
                  value={formData.state}
                  onChangeText={(v: string) => setFormData({ ...formData, state: v })}
                />
              </View>
            </View>
            <CustomInput
              label="Zip Code"
              value={formData.zipCode}
              onChangeText={(v: string) => setFormData({ ...formData, zipCode: v })}
            />

            <CustomButton
              title="Save Changes"
              onPress={handleUpdateProfile}
              loading={updateMutation.isPending}
              style={{ marginTop: 12 }}
            />
          </View>
        ) : (
          <View className="flex-1">
            <Text
              className="text-[10px] font-black uppercase tracking-widest mb-4 opacity-60"
              style={{ color: colors.textSecondary }}
            >
              Two-Factor Authentication
            </Text>

            <View
              className="p-5 rounded-3xl border mb-6 flex-row items-center"
              style={{
                backgroundColor: tfaSettings.enabled
                  ? isDark
                    ? 'rgba(114,189,0,0.1)'
                    : '#E8F5E9'
                  : isDark
                  ? colors.surface
                  : colors.grey[200],
                borderColor: tfaSettings.enabled ? '#72BD00' : colors.border,
              }}
            >
              <Text className="text-3xl">{tfaSettings.enabled ? '🛡️' : '🔓'}</Text>
              <View className="ml-4 flex-1">
                <Text
                  className="text-base font-black uppercase tracking-widest"
                  style={{ color: tfaSettings.enabled ? '#72BD00' : colors.text }}
                >
                  2FA is {tfaSettings.enabled ? 'Enabled' : 'Disabled'}
                </Text>
                <Text
                  className="text-[13px] mt-1 opacity-60 leading-5"
                  style={{ color: colors.textSecondary }}
                >
                  {tfaSettings.enabled
                    ? `Verifying via ${
                        tfaSettings.method === 'email' ? 'Email Address' : 'Authenticator App'
                      }`
                    : 'Add an extra layer of security to your account.'}
                </Text>
              </View>
            </View>

            {!tfaSettings.enabled && (
              <View className="mt-2">
                <Text
                  className="text-sm font-black mb-4 uppercase tracking-widest opacity-60"
                  style={{ color: colors.text }}
                >
                  Choose Verification Method
                </Text>

                <MethodOption
                  label="Email OTP"
                  sub="Receive codes via your registered email"
                  selected={tfaSettings.method === 'email'}
                  onSelect={() => setTfaSettings({ ...tfaSettings, method: 'email' })}
                />

                <MethodOption
                  label="Google Authenticator"
                  sub="Use an authenticator app for codes"
                  selected={tfaSettings.method === 'authenticator'}
                  onSelect={() => setTfaSettings({ ...tfaSettings, method: 'authenticator' })}
                />
              </View>
            )}

            <CustomButton
              title={tfaSettings.enabled ? 'Disable 2FA' : 'Enable 2FA'}
              onPress={handleToggle2FA}
              loading={tfaMutation.isPending}
              variant={tfaSettings.enabled ? 'error' : 'primary'}
              style={{ marginTop: 24 }}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

function TabItem({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: string;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center py-4 mr-8 border-b-2"
      style={{
        borderBottomColor: active ? colors.primary.main : 'transparent',
      }}
    >
      <Text className="text-lg mr-2">{icon}</Text>
      <Text
        className="text-sm font-black uppercase tracking-widest"
        style={{ color: active ? colors.primary.main : colors.textSecondary }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function MethodOption({
  label,
  sub,
  selected,
  onSelect,
}: {
  label: string;
  sub: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onSelect}
      className="flex-row items-center p-5 rounded-2xl border mb-4 shadow-sm"
      style={{
        borderColor: selected ? colors.primary.main : colors.border,
        backgroundColor: selected ? `${colors.primary.main}10` : 'transparent',
      }}
    >
      <View
        className="w-5 h-5 rounded-full border-2 items-center justify-center p-0.5"
        style={{ borderColor: selected ? colors.primary.main : colors.textSecondary }}
      >
        {selected && (
          <View
            className="w-full h-full rounded-full"
            style={{ backgroundColor: colors.primary.main }}
          />
        )}
      </View>
      <View className="flex-1 ml-4">
        <Text
          className="text-sm font-black uppercase tracking-widest"
          style={{ color: colors.text }}
        >
          {label}
        </Text>
        <Text className="text-xs mt-1 opacity-60" style={{ color: colors.textSecondary }}>
          {sub}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
