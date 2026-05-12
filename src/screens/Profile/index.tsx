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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { SettingsService } from '../../services/api/SettingsService';
import { AuthService } from '../../services/api/auth';
import { LeadService } from '../../services/api/leads';
import Clipboard from '@react-native-clipboard/clipboard';
import RNFS from 'react-native-fs';
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
  const [imageLoading, setImageLoading] = useState(false);

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

  const { refreshUser } = useAuth();

  // Sync formData with user from auth hook
  useEffect(() => {
    if (user) {
      setFormData((prev) => ({
        ...prev,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        userName: user.userName || user.username || '',
        phoneNumber: user.phoneNo || user.phoneNumber || '',
        city: user.city || '',
        street: user.address || user.street || '',
        zipCode: user.zipCode || '',
        email: user.email || '',
        avatarUrl: user.profilePicture || '',
      }));
    }
  }, [user]);

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

  // New Modal States
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [backupCodesModalVisible, setBackupCodesModalVisible] = useState(false);
  const [disableModalVisible, setDisableModalVisible] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const fetchSecureAvatarUrl = useCallback(async (pic: any) => {
    if (!pic || typeof pic !== 'object' || !pic.filePath) return;
    
    setImageLoading(true);
    try {
      const res = await LeadService.getSecureUrls([{
        bucketName: pic.bucketName || 'np-revdsm-staging',
        filePath: pic.filePath
      }]);
      const secureData = res.data?.data || res.data || [];
      if (secureData[0]?.secureUrl) {
        setFormData(prev => ({ ...prev, avatarUrl: secureData[0].secureUrl }));
      }
    } catch (err) {
      console.error('Fetch Secure Avatar Error:', err);
    } finally {
      setImageLoading(false);
    }
  }, []);

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
        }));

        if (u.profilePicture) {
          if (typeof u.profilePicture === 'string' && u.profilePicture.startsWith('http')) {
            setFormData(prev => ({ ...prev, avatarUrl: u.profilePicture }));
          } else {
            fetchSecureAvatarUrl(u.profilePicture);
          }
        }
      }
    } catch (err) {
      console.error('Fetch Profile Error:', err);
    }
  }, [fetchSecureAvatarUrl]);

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
      const data = new FormData();
      
      // Append fields similar to web app logic
      data.append('firstName', formData.firstName);
      data.append('lastName', formData.lastName);
      data.append('phoneNo', formData.phoneNumber);
      data.append('city', formData.city);
      data.append('street', formData.street);
      data.append('zipCode', formData.zipCode);
      
      if (formData.password) {
        data.append('password', formData.password);
      }

      // Handle Avatar Upload
      if (formData.avatarUrl && formData.avatarUrl.startsWith('file://')) {
        const uriParts = formData.avatarUrl.split('.');
        const fileExtension = uriParts[uriParts.length - 1];
        
        data.append('file', {
          uri: formData.avatarUrl,
          name: `profile.${fileExtension}`,
          type: `image/${fileExtension}`,
        } as any);
      }

      const res = await SettingsService.updateProfile(data);
      const updatedUser = res.data?.data?.data || res.data?.data || res.data;

      // If response has new profile picture, fetch its secure URL
      if (updatedUser?.profilePicture) {
        await fetchSecureAvatarUrl(updatedUser.profilePicture);
      }
      
      // Refresh global user state to sync across app
      await refreshUser();
      
      Alert.alert('Success', 'Profile updated successfully', [
        {
          text: 'OK',
          onPress: () => navigation.navigate('Leads')
        }
      ]);
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
        setDisableModalVisible(true);
      } else {
        if (selectionMethod === 'email') {
          setEmailModalVisible(true);
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

  const handleConfirmEnableEmail = async () => {
    setLoading(true);
    try {
      const res = await SettingsService.setupEmail();
      setEmailModalVisible(false);
      
      const setupData = res.data?.data;
      
      if (setupData?.backupCodes) {
        setBackupCodes(setupData.backupCodes);
        setBackupCodesModalVisible(true);
        fetchTfaSettings();
      } else {
        // Fallback if setup didn't return codes
        const backupRes = await SettingsService.regenerateBackupCodes();
        if (backupRes.data?.data) {
          setBackupCodes(backupRes.data.data);
          setBackupCodesModalVisible(true);
        } else {
          Alert.alert('Enabled', 'Email OTP Authentication is now active.');
        }
        fetchTfaSettings();
      }
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || 'Failed to enable Email OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDisable = async () => {
    setLoading(true);
    try {
      await SettingsService.disableTfa();
      setDisableModalVisible(false);
      Alert.alert('Disabled', 'Two-Factor Authentication has been disabled.');
      fetchTfaSettings();
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || 'Failed to disable 2FA');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    setLoading(true);
    try {
      const res = await SettingsService.regenerateBackupCodes();
      const codes = res.data?.data?.backupCodes || res.data?.data;
      
      if (Array.isArray(codes)) {
        setBackupCodes(codes);
        setBackupCodesModalVisible(true);
      } else {
        Alert.alert('Success', 'Backup codes regenerated successfully.');
      }
      fetchTfaSettings();
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || 'Failed to regenerate codes');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyBackupCodes = () => {
    const text = backupCodes.join('\n');
    Clipboard.setString(text);
    Alert.alert('Copied', 'Backup codes copied to clipboard');
  };

  const handleDownloadBackupCodes = async () => {
    try {
      const path = `${RNFS.DocumentDirectoryPath}/revdsm_backup_codes.txt`;
      await RNFS.writeFile(path, backupCodes.join('\n'), 'utf8');
      Alert.alert('Downloaded', `Backup codes saved to: ${path}`);
    } catch (err) {
      Alert.alert('Error', 'Failed to save codes to file');
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
              <TouchableOpacity
                onPress={() => navigation.navigate('Leads')}
                className="flex-row items-center"
              >
                <Icon
                  name="menu"
                  size={14}
                  color={colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text className="text-[11px] font-bold" style={{ color: colors.textSecondary }}>
                  Map View
                </Text>
              </TouchableOpacity>
              <Text className="text-[11px] font-bold mx-2" style={{ color: colors.textSecondary }}>
                •
              </Text>
              <Text className="text-[11px] font-bold " style={{ color: colors.textSecondary }}>
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
                  className={`font-black  tracking-widest text-[11px] ${
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
                  className={`font-black  tracking-widest text-[11px] ${
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
                  {imageLoading ? (
                    <ActivityIndicator color={colors.primary.main} />
                  ) : formData.avatarUrl ? (
                    <Image source={{ uri: formData.avatarUrl }} className="w-full h-full" />
                  ) : (
                    <View className="items-center">
                      <Icon name="camera-outline" size={28} color={colors.textSecondary} />
                      <Text
                        className="text-[10px] mt-1 font-bold "
                        style={{ color: colors.textSecondary }}
                      >
                        Upload photo
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                <Text
                  className="text-[10px] mt-6 font-bold text-center  tracking-wide"
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
                  editable={false}
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
                  editable={false}
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
                  Password must be at least 8 characters long, include one letter, and contain one
                  special character.
                </Text>

                <TouchableOpacity
                  onPress={handleUpdateProfile}
                  disabled={loading}
                  className="bg-grey-900 py-4 rounded-xl items-center self-end px-8"
                >
                  {loading ? (
                    <ActivityIndicator color={colors.background} />
                  ) : (
                    <Text className="text-grey-0 font-black  text-[11px] tracking-widest">
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
                    <Text className="ml-3 text-[11px] font-black text-[#FFAB00]  tracking-wider">
                      2FA is {tfaSettings.enabled ? 'Active' : 'Disabled'}
                    </Text>
                  </View>
                  <View
                    className={`px-3 py-1.5 rounded-lg ${
                      tfaSettings.enabled ? 'bg-[#72BD00]' : 'bg-[#FF5630]'
                    }`}
                  >
                    <Text className="text-[9px] font-black text-white ">
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
                  className="mt-8 mb-4 text-[11px] font-black "
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

                {tfaSettings.enabled && (
                  <View className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-100 mb-4">
                    <View className="flex-row items-center justify-between mb-3">
                      <View className="flex-row items-center">
                        <Icon name="key-outline" size={16} color={colors.textSecondary} />
                        <Text className="ml-2 text-[11px] font-black text-slate-600">Backup Codes</Text>
                      </View>
                      <View className="px-2 py-0.5 bg-slate-200 rounded-md">
                        <Text className="text-[9px] font-black text-slate-500">
                          {tfaSettings.unusedBackupCodesCount || 0} REMAINING
                        </Text>
                      </View>
                    </View>
                    <Text className="text-[10px] text-slate-400 font-bold mb-4 leading-4">
                      Regenerating backup codes will invalidate your current codes. Use them if you've lost your codes or they've been compromised.
                    </Text>
                    <TouchableOpacity
                      onPress={handleRegenerateBackupCodes}
                      className="flex-row items-center justify-center py-3 bg-white border border-slate-200 rounded-xl"
                    >
                      <Icon name="refresh" size={14} color="#6366f1" />
                      <Text className="ml-2 font-black text-[10px] text-[#6366f1] tracking-widest uppercase">
                        Regenerate Codes
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

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
                    <Text className="text-grey-0 font-black  text-[11px] tracking-widest">
                      {tfaSettings.enabled ? 'Disable 2FA' : 'Enable Two-Factor Authentication'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
          <View className="h-20" />
        </ScrollView>

        {/* 1. Setup Email OTP Modal */}
        <Modal visible={emailModalVisible} transparent animationType="fade">
          <View className="flex-1 bg-black/60 items-center justify-center px-6">
            <View className="bg-white w-full rounded-[32px] overflow-hidden shadow-2xl">
              <View className="p-8 pb-4">
                <View className="flex-row items-center mb-6">
                  <View className="w-10 h-10 rounded-xl bg-slate-900 items-center justify-center mr-4">
                    <Icon name="mail-unread" size={20} color="white" />
                  </View>
                  <Text className="text-xl font-black text-slate-900 tracking-tighter">Setup Email OTP</Text>
                </View>

                {/* Info Alert */}
                <View className="bg-[#E6FFFA] p-4 rounded-2xl flex-row items-center mb-6 border border-[#B2F5EA]">
                  <Icon name="information-circle" size={20} color="#319795" />
                  <Text className="ml-3 flex-1 text-[11px] font-bold text-[#285E61] leading-4">
                    When Email OTP is enabled, you'll receive a one-time password via email whenever you sign in.
                  </Text>
                </View>

                {/* Email Display */}
                <View className="bg-slate-50 p-6 rounded-3xl border border-slate-100 items-center mb-6 border-dashed">
                  <View className="w-12 h-12 rounded-2xl bg-emerald-500 items-center justify-center mb-4">
                    <Icon name="mail" size={24} color="white" />
                  </View>
                  <View className="items-center">
                    <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Email Address</Text>
                    <Text className="text-sm font-black text-slate-900">{formData.email}</Text>
                  </View>
                  <Text className="mt-4 text-[11px] text-center text-slate-400 font-bold leading-4">
                    A verification code will be sent to this email address each time you sign in.
                  </Text>
                </View>

                {/* Warning Alert */}
                <View className="bg-[#FFF9E6] p-4 rounded-2xl flex-row items-center border border-[#FEF3C7]">
                  <Icon name="warning" size={20} color="#D97706" />
                  <Text className="ml-3 flex-1 text-[11px] font-bold text-[#92400E]">
                    Make sure you have access to this email address. You'll need it to sign in.
                  </Text>
                </View>
              </View>

              <View className="p-6 flex-row gap-4">
                <TouchableOpacity 
                  onPress={() => setEmailModalVisible(false)}
                  className="flex-1 py-4 items-center"
                >
                  <Text className="font-black text-[11px] text-slate-500 tracking-widest">CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={handleConfirmEnableEmail}
                  disabled={loading}
                  className="flex-[1.5] bg-slate-900 py-4 rounded-2xl items-center shadow-lg shadow-slate-200"
                >
                  {loading ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Text className="font-black text-[11px] text-white tracking-widest">ENABLE EMAIL OTP</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* 2. Backup Codes Modal */}
        <Modal visible={backupCodesModalVisible} transparent animationType="fade">
          <View className="flex-1 bg-black/60 items-center justify-center px-6">
            <View className="bg-white w-full rounded-[32px] overflow-hidden shadow-2xl">
              <View className="p-8">
                <View className="flex-row items-center mb-6">
                  <View className="w-10 h-10 rounded-xl bg-slate-900 items-center justify-center mr-4">
                    <Icon name="shield-half" size={20} color="white" />
                  </View>
                  <Text className="text-xl font-black text-slate-900 tracking-tighter">Backup Codes</Text>
                </View>

                <View className="bg-[#FFF9E6] p-4 rounded-2xl flex-row border border-[#FEF3C7] mb-6">
                  <Icon name="warning" size={20} color="#D97706" />
                  <View className="ml-3 flex-1">
                    <Text className="text-[11px] font-bold text-[#92400E] leading-4">
                      <Text className="font-black">Important:</Text> Save these backup codes in a safe place. Each code can only be used once. If you lose access to your authenticator, you can use these codes to sign in.
                    </Text>
                  </View>
                </View>

                {/* Codes Grid */}
                <View className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                  <View className="flex-row flex-wrap justify-between">
                    {backupCodes.map((code, idx) => (
                      <View key={idx} className="w-[48%] bg-white p-3 mb-2 rounded-xl border border-slate-100 items-center">
                        <Text className="text-[11px] font-black text-slate-900 tracking-widest">{code}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                <View className="flex-row gap-3 mt-6">
                  <TouchableOpacity 
                    onPress={handleCopyBackupCodes}
                    className="flex-1 flex-row items-center justify-center py-4 bg-white border border-slate-200 rounded-2xl"
                  >
                    <Icon name="copy-outline" size={16} color="#475569" />
                    <Text className="ml-2 font-black text-[10px] text-slate-600 tracking-widest">COPY CODES</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={handleDownloadBackupCodes}
                    className="flex-1 flex-row items-center justify-center py-4 bg-white border border-slate-200 rounded-2xl"
                  >
                    <Icon name="download-outline" size={16} color="#475569" />
                    <Text className="ml-2 font-black text-[10px] text-slate-600 tracking-widest">DOWNLOAD</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View className="p-6 bg-slate-50 items-center">
                <TouchableOpacity 
                  onPress={() => {
                    setBackupCodesModalVisible(false);
                    fetchTfaSettings();
                  }}
                  className="w-full bg-slate-900 py-4 rounded-2xl items-center"
                >
                  <Text className="font-black text-[11px] text-white tracking-widest">I'VE SAVED MY CODES</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* 3. Disable 2FA Modal */}
        <Modal visible={disableModalVisible} transparent animationType="fade">
          <View className="flex-1 bg-black/60 items-center justify-center px-6">
            <View className="bg-white w-full rounded-[32px] overflow-hidden shadow-2xl">
              <View className="p-8">
                <View className="flex-row items-center mb-6">
                  <View className="w-10 h-10 rounded-xl bg-red-100 items-center justify-center mr-4">
                    <Icon name="alert-circle" size={24} color="#EF4444" />
                  </View>
                  <Text className="text-xl font-black text-slate-900 tracking-tighter">Disable 2FA?</Text>
                </View>

                <View className="bg-red-50 p-6 rounded-3xl border border-red-100 mb-2">
                  <View className="flex-row items-center mb-4">
                    <Icon name="warning" size={20} color="#EF4444" />
                    <Text className="ml-3 font-black text-[13px] text-red-700">Are you sure?</Text>
                  </View>
                  <Text className="text-[11px] font-bold text-red-600 mb-4 leading-4">
                    Disabling two-factor authentication will:
                  </Text>
                  <View className="gap-y-2 ml-1">
                    <View className="flex-row items-center">
                      <View className="w-1.5 h-1.5 rounded-full bg-red-400 mr-3" />
                      <Text className="text-[11px] font-bold text-red-600">Remove the extra security layer</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View className="w-1.5 h-1.5 rounded-full bg-red-400 mr-3" />
                      <Text className="text-[11px] font-bold text-red-600">Revoke all trusted devices</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View className="w-1.5 h-1.5 rounded-full bg-red-400 mr-3" />
                      <Text className="text-[11px] font-bold text-red-600">Invalidate all backup codes</Text>
                    </View>
                  </View>
                </View>
              </View>

              <View className="p-6 flex-row gap-4">
                <TouchableOpacity 
                  onPress={() => setDisableModalVisible(false)}
                  className="flex-1 py-4 items-center"
                >
                  <Text className="font-black text-[11px] text-slate-500 tracking-widest">CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={handleConfirmDisable}
                  disabled={loading}
                  className="flex-[1.5] bg-red-600 py-4 rounded-2xl items-center shadow-lg shadow-red-100"
                >
                  {loading ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Text className="font-black text-[11px] text-white tracking-widest">DISABLE 2FA</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
