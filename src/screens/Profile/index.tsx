import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { SettingsService } from '../../services/api/SettingsService';
import { AuthService } from '../../services/api/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { Header } from '../../widgets/common/MainHeader';
import { CustomInput } from '../../widgets/common/CustomInput';
import { CustomButton } from '../../widgets/common/CustomButton';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { launchImageLibrary } from 'react-native-image-picker';
import FlashMessage from 'react-native-flash-message';
import { formatUSPhoneNumber } from '../../utils/phone-util';

import { AxiosResponse } from 'axios';

type TabType = 'profile' | '2fa';

export default function ProfilePage() {
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [loading, setLoading] = useState(false);

  // Profile Form State
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    userName: '',
    phoneNumber: '',
    city: '',
    street: '',
    zipCode: '',
    email: '',
    password: '',
    avatarUrl: '',
  });

  // 2FA State from API
  const [tfaSettings, setTfaSettings] = useState({
    enabled: false,
    method: null as string | null,
    hasBackupCodes: false,
    backupCodesCount: 0,
    unusedBackupCodesCount: 0,
    usedBackupCodesCount: 0,
  });

  // Local state for choosing method before enabling
  const [selectionMethod, setSelectionMethod] = useState<'email' | 'authenticator'>('email');
  const [showPassword, setShowPassword] = useState(false);

  const fetchProfileData = useCallback(async () => {
    try {
      const res = await AuthService.getMe();
      if (res.data?.data) {
        const u = res.data.data;
        setFormData((prev) => ({
          ...prev,
          firstName: u.firstName || '',
          lastName: u.lastName || '',
          userName: u.userName || u.username || '',
          phoneNumber: u.phoneNo || u.phoneNumber || '',
          city: u.city || '',
          street: u.address || u.street || '',
          zipCode: u.zipCode || '',
          email: u.email || '',
          avatarUrl: u.profilePicture || '',
        }));
      }
    } catch (err) {
      console.error('Fetch Profile Error:', err);
    }
  }, []);

  const fetchTfaSettings = useCallback(async () => {
    try {
      const res: AxiosResponse<any> = await SettingsService.getTfaStatus();
      if (res.data?.data) {
        setTfaSettings(res.data.data);
        if (res.data.data.method) {
          setSelectionMethod(res.data.data.method);
        }
      }
    } catch (err) {
      console.error('Fetch TFA Error:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'profile') {
      fetchProfileData();
    } else {
      fetchTfaSettings();
    }
  }, [activeTab, fetchProfileData, fetchTfaSettings]);

  const handleUpdateProfile = async () => {
    setLoading(true);
    try {
      await SettingsService.updateProfile(formData);
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || 'Update failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePickImage = async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      includeBase64: false,
      maxHeight: 500,
      maxWidth: 500,
    });

    if (result.assets && result.assets.length > 0) {
      setFormData({ ...formData, avatarUrl: result.assets[0].uri || '' });
      // In real scenario, you'd upload this to S3 and then update profile
    }
  };

  const handleToggle2FA = async () => {
    setLoading(true);
    try {
      if (tfaSettings.enabled) {
        await SettingsService.disableTfa();
        Alert.alert('Disabled', 'Two-Factor Authentication has been disabled.');
      } else {
        if (selectionMethod === 'email') {
          await SettingsService.setupEmail();
          Alert.alert('Enabled', 'Email OTP Authentication is now active.');
        } else {
          const setupRes = await SettingsService.setupAuthenticator();
          const { secret } = setupRes.data?.data || {};

          if (Platform.OS === 'ios') {
            Alert.prompt(
              'Setup Authenticator',
              `Copy this key to your app: ${secret}\n\nEnter the 6-digit code from your app:`,
              async (token) => {
                if (token) {
                  try {
                    await SettingsService.verifyAuthenticator(token, secret);
                    Alert.alert('Success', 'Authenticator App enabled successfully!');
                    fetchTfaSettings();
                  } catch (e) {
                    Alert.alert('Error', 'Invalid token. Please try again.');
                  }
                }
              }
            );
          } else {
            // Android Prompt fallback
            Alert.alert(
              'Setup Authenticator',
              `Step 1: Copy this key to your app:\n\n${secret}\n\nStep 2: Enter the 6-digit code in the next pop-up.`,
              [
                {
                  text: 'Submit Code',
                  onPress: () => {
                    // In a production app, we would use a proper Modal for Android
                    // For now continuing with the document's logic
                    console.log('Authenticator Secret shown to user');
                  },
                },
              ]
            );
          }
        }
      }
      fetchTfaSettings();
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || '2FA operation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: isDark ? colors.background : '#F8FAFC' }]}
    >
      <View style={[styles.root, { backgroundColor: isDark ? colors.background : '#F8FAFC' }]}>
        <View style={{ height: 0, backgroundColor: isDark ? colors.surface : '#111827' }} />
        <Header onNavigate={(route) => navigation.navigate(route)} />

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Title & Breadcrumbs */}
          <View className="px-5 py-6">
            <Text className="text-xl font-black" style={{ color: colors.text }}>
              Account Settings
            </Text>
            <View className="flex-row items-center mt-1">
              <Text
                className="text-[11px] font-bold uppercase"
                style={{ color: colors.textSecondary }}
              >
                Map View
              </Text>
              <Text className="text-[11px] font-bold mx-2" style={{ color: colors.textSecondary }}>
                •
              </Text>
              <Text
                className="text-[11px] font-bold uppercase"
                style={{ color: colors.textSecondary }}
              >
                Account Settings
              </Text>
            </View>
          </View>

          {/* Custom Tabs Container */}
          <View className="px-5 mb-6">
            <View
              className="flex-row p-1.5 rounded-2xl"
              style={{
                backgroundColor: isDark ? colors.surface : colors.card,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <TouchableOpacity
                onPress={() => setActiveTab('profile')}
                className={`flex-1 flex-row items-center justify-center py-3.5 rounded-xl ${
                  activeTab === 'profile' ? 'bg-[#72BD00]' : ''
                }`}
              >
                <Icon
                  name="person"
                  size={18}
                  color={activeTab === 'profile' ? '#fff' : colors.textSecondary}
                  className="mr-2"
                />
                <Text
                  className={`font-black uppercase tracking-widest text-[11px] ${
                    activeTab === 'profile' ? 'text-white' : ''
                  }`}
                  style={{ color: activeTab === 'profile' ? '#fff' : colors.textSecondary }}
                >
                  Profile
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setActiveTab('2fa')}
                className={`flex-1 flex-row items-center justify-center py-3.5 rounded-xl ${
                  activeTab === '2fa' ? 'bg-[#72BD00]' : ''
                }`}
              >
                <Icon
                  name="shield-checkmark"
                  size={18}
                  color={activeTab === '2fa' ? '#fff' : colors.textSecondary}
                  className="mr-2"
                />
                <Text
                  className={`font-black uppercase tracking-widest text-[11px] ${
                    activeTab === '2fa' ? 'text-white' : ''
                  }`}
                  style={{ color: activeTab === '2fa' ? '#fff' : colors.textSecondary }}
                >
                  2FA settings
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {activeTab === 'profile' ? (
            <View className="px-5 pb-10">
              {/* Avatar Upload */}
              <View
                className="p-8 rounded-[32px] mb-8 items-center border border-dashed"
                style={{
                  backgroundColor: isDark ? colors.surface : colors.card,
                  borderColor: colors.border,
                }}
              >
                <TouchableOpacity
                  onPress={handlePickImage}
                  className="w-24 h-24 rounded-full items-center justify-center overflow-hidden border-2 border-dashed border-gray-300"
                  style={{ backgroundColor: isDark ? colors.background : '#F8FAFC' }}
                >
                  {formData.avatarUrl ? (
                    <Image source={{ uri: formData.avatarUrl }} className="w-full h-full" />
                  ) : (
                    <View className="items-center">
                      <Icon name="camera-outline" size={28} color={colors.textSecondary} />
                      <Text
                        className="text-[10px] mt-1 font-bold uppercase"
                        style={{ color: colors.textSecondary }}
                      >
                        Upload photo
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                <Text
                  className="text-[10px] mt-6 font-bold text-center uppercase tracking-wide"
                  style={{ color: colors.textSecondary }}
                >
                  Allowed *.jpeg, *.jpg, *.png, *.gif{'\n'}Max size of 3.1 MB
                </Text>
              </View>

              {/* Profile Fields */}
              <View
                className="p-5 rounded-[32px] border"
                style={{
                  backgroundColor: isDark ? colors.surface : colors.card,
                  borderColor: colors.border,
                }}
              >
                <CustomInput
                  label="First Name"
                  placeholder="Enter First Name"
                  value={formData.firstName}
                  onChangeText={(t) => setFormData({ ...formData, firstName: t })}
                />
                <CustomInput
                  label="Last Name"
                  placeholder="Enter Last Name"
                  value={formData.lastName}
                  onChangeText={(t) => setFormData({ ...formData, lastName: t })}
                />
                <CustomInput
                  label="User Name"
                  placeholder="Enter User Name"
                  value={formData.userName}
                  onChangeText={(t) => setFormData({ ...formData, userName: t })}
                />
                <CustomInput
                  label="Phone Number"
                  placeholder="+1 (123) 456-7890"
                  value={formData.phoneNumber}
                  onChangeText={(t) =>
                    setFormData({ ...formData, phoneNumber: formatUSPhoneNumber(t) })
                  }
                  keyboardType="phone-pad"
                  maxLength={17}
                />
                <CustomInput
                  label="City"
                  placeholder="Enter City Name"
                  value={formData.city}
                  onChangeText={(t) => setFormData({ ...formData, city: t })}
                />
                <CustomInput
                  label="Street"
                  placeholder="Enter Street"
                  value={formData.street}
                  onChangeText={(t) => setFormData({ ...formData, street: t })}
                />
                <CustomInput
                  label="Zip Code"
                  placeholder="Enter Zip Code"
                  value={formData.zipCode}
                  onChangeText={(t) => setFormData({ ...formData, zipCode: t })}
                />
                <CustomInput
                  label="Email"
                  placeholder="Enter Email"
                  value={formData.email}
                  onChangeText={(t) => setFormData({ ...formData, email: t })}
                />
                <CustomInput
                  label="Password"
                  placeholder="Enter Password"
                  value={formData.password}
                  secureTextEntry={!showPassword}
                  rightIcon={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  onRightIconPress={() => setShowPassword(!showPassword)}
                  onChangeText={(t) => setFormData({ ...formData, password: t })}
                />

                <Text
                  className="text-[10px] font-bold mb-6"
                  style={{ color: colors.textSecondary }}
                >
                  Password must be at least 8 characters long, include one uppercase letter, and
                  contain one special character.
                </Text>

                <TouchableOpacity
                  onPress={handleUpdateProfile}
                  disabled={loading}
                  className="bg-grey-900 py-4 rounded-xl items-center self-end px-8"
                >
                  {loading ? (
                    <ActivityIndicator color={colors.background} />
                  ) : (
                    <Text className="text-grey-0 font-black uppercase text-[11px] tracking-widest">
                      Update Profile
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View className="px-5 pb-10">
              {/* 2FA Header Information */}
              <View
                className="p-6 rounded-[32px] border mb-6"
                style={{
                  backgroundColor: isDark ? colors.surface : colors.card,
                  borderColor: colors.border,
                }}
              >
                <View className="flex-row items-center mb-4">
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: isDark ? colors.background : '#F8FAFC' }}
                  >
                    <Icon name="shield-checkmark" size={20} color={colors.text} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-black" style={{ color: colors.text }}>
                      Two-Factor Authentication
                    </Text>
                    <Text className="text-[11px] font-bold" style={{ color: colors.textSecondary }}>
                      Add an extra layer of security to your account
                    </Text>
                  </View>
                </View>

                {/* Status Box */}
                <View
                  className="p-4 rounded-2xl flex-row items-center justify-between mt-2"
                  style={{
                    backgroundColor: isDark ? colors.background : '#FFF9F5',
                    borderWidth: 1,
                    borderColor: '#FFAB0040',
                  }}
                >
                  <View className="flex-row items-center">
                    <Icon name="alert-circle" size={20} color="#FFAB00" />
                    <Text className="ml-3 text-[11px] font-black text-[#FFAB00] uppercase tracking-wider">
                      2FA is {tfaSettings.enabled ? 'Active' : 'Disabled'}
                    </Text>
                  </View>
                  <View
                    className={`px-3 py-1.5 rounded-lg ${
                      tfaSettings.enabled ? 'bg-[#72BD00]' : 'bg-[#FF5630]'
                    }`}
                  >
                    <Text className="text-[9px] font-black text-white uppercase">
                      {tfaSettings.enabled ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>

                {/* Info Alert */}
                <View
                  className="mt-6 p-4 rounded-2xl flex-row bg-[#CAFDF5]"
                  style={{ backgroundColor: isDark ? '#1C3D38' : '#CAFDF5' }}
                >
                  <Icon name="information-circle" size={20} color="#00B8D9" />
                  <Text
                    className="ml-3 flex-1 text-[11px] leading-4 font-bold"
                    style={{ color: isDark ? '#00B8D9' : '#006C7F' }}
                  >
                    Enable two-factor authentication to add an extra layer of security to your
                    account. You'll need to verify your identity with a code in addition to your
                    password.
                  </Text>
                </View>

                <Text
                  className="mt-8 mb-4 text-[11px] font-black uppercase"
                  style={{ color: colors.textSecondary }}
                >
                  Choose 2FA Method
                </Text>

                <MethodRadio
                  label="Email OTP"
                  sub="Receive verification codes via email"
                  selected={selectionMethod === 'email'}
                  onPress={() => setSelectionMethod('email')}
                  colors={colors}
                />
                <MethodRadio
                  label="Google Authenticator"
                  sub="Use Google Authenticator or similar app"
                  selected={selectionMethod === 'authenticator'}
                  onPress={() => setSelectionMethod('authenticator')}
                  colors={colors}
                />

                <TouchableOpacity
                  onPress={handleToggle2FA}
                  disabled={loading}
                  className="bg-grey-900 py-4 rounded-xl items-center mt-6 flex-row justify-center"
                >
                  <Icon
                    name="shield-checkmark"
                    size={18}
                    color={isDark ? colors.background : '#fff'}
                    className="mr-2"
                  />
                  {loading ? (
                    <ActivityIndicator color={colors.background} />
                  ) : (
                    <Text className="text-grey-0 font-black uppercase text-[11px] tracking-widest">
                      {tfaSettings.enabled ? 'Disable 2FA' : 'Enable Two-Factor Authentication'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
          <View className="h-20" />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function MethodRadio({ label, sub, selected, onPress, colors }: any) {
  return (
    <TouchableOpacity onPress={onPress} className="flex-row items-center mb-6">
      <View
        className={`w-5 h-5 rounded-full border-2 items-center justify-center ${
          selected ? 'border-[#00A76F]' : 'border-gray-300'
        }`}
      >
        {selected && <View className="w-2.5 h-2.5 rounded-full bg-[#00A76F]" />}
      </View>
      <View className="ml-4">
        <Text className="text-[13px] font-black" style={{ color: colors.text }}>
          {label}
        </Text>
        <Text className="text-[11px] font-bold" style={{ color: colors.textSecondary }}>
          {sub}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
