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
  Share,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { useDispatch } from 'react-redux';
import { setInitial } from '../../redux/reducer/auth.reducer';
import { store } from '../../redux/store';
import { SettingsService } from '../../services/api/SettingsService';
import { AuthService } from '../../services/api/auth';
import { LeadService } from '../../services/api/leads';
import Clipboard from '@react-native-clipboard/clipboard';
import RNFS from 'react-native-fs';
import { ENV } from '../../config/env';

import ReactNativeBlobUtil from 'react-native-blob-util';

import { useTheme } from '../../theme/ThemeProvider';
import { Header } from '../../widgets/common/MainHeader';
import { CustomInput } from '../../widgets/common/CustomInput';
import { CustomButton } from '../../widgets/common/CustomButton';
import { useNavigation } from '@react-navigation/native';
import { GlobalKeyboardAvoidingView } from '../../widgets/common/keyboard/GlobalKeyboard';

import Icon from 'react-native-vector-icons/Ionicons';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useUserRole } from '../../hooks/useUserRole';
import { launchImageLibrary } from 'react-native-image-picker';
import FlashMessage from 'react-native-flash-message';
import { formatUSPhoneNumber, getRawPhoneNumber } from '../../utils/phone-util';


import { AxiosResponse } from 'axios';

type TabType = 'profile' | '2fa';

export default function ProfilePage() {
  const { user } = useAuth();
  const dispatch = useDispatch();
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const { isInstaller } = useUserRole();
  const [activeTab, setActiveTab] = useState<TabType>('profile');

  // This screen is shared by both dashboards, but the sales landing route is NOT
  // registered in the installer stack (`navigation/index.tsx`), so the hardcoded
  // `navigate('Leads')` this screen used to do was a dead end for an installer —
  // and the global `<Header />` carries no back affordance, so there was no way
  // out of Account Settings at all. Prefer popping the stack (the screen is
  // always pushed from the header popover); fall back to whichever landing route
  // the signed-in account actually has.
  const homeRoute = isInstaller ? 'InstallerDashboard' : 'Leads';
  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate(homeRoute);
  }, [navigation, homeRoute]);
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
    avatarAsset: null as any,
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
        avatarUrl: typeof user.profilePicture === 'string' ? user.profilePicture : '',
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

  // Authenticator Setup State
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [authStep, setAuthStep] = useState(0); // 0: Scan, 1: Verify
  const [authQrCode, setAuthQrCode] = useState('');
  const [authSecret, setAuthSecret] = useState('');
  const [authCode, setAuthCode] = useState('');

  // Trusted Devices State
  const [trustedDevicesModalVisible, setTrustedDevicesModalVisible] = useState(false);
  const [trustedDevices, setTrustedDevices] = useState<any[]>([]);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);

  const resolveAvatarUrl = useCallback(async (pic: any) => {
    if (!pic) return;
    if (typeof pic === 'string') {
      if (pic.startsWith('http')) {
        setFormData(prev => ({ ...prev, avatarUrl: pic }));
        return pic;
      }
      setImageLoading(true);
      try {
        const res = await LeadService.getSecureUrls([{
          bucketName: ENV.S3_BUCKET,
          filePath: pic
        }]);
        const secureData = res.data?.data || res.data || [];
        if (secureData[0]?.secureUrl) {
          setFormData(prev => ({ ...prev, avatarUrl: secureData[0].secureUrl }));
          return secureData[0].secureUrl;
        }
      } catch (err) {
        console.error('Fetch Secure Avatar Error:', err);
      } finally {
        setImageLoading(false);
      }
      return;
    }
    if (typeof pic === 'object' && pic?.filePath) {
      setImageLoading(true);
      try {
        const res = await LeadService.getSecureUrls([{
          bucketName: pic.bucketName || ENV.S3_BUCKET,
          filePath: pic.filePath
        }]);
        const secureData = res.data?.data || res.data || [];
        if (secureData[0]?.secureUrl) {
          setFormData(prev => ({ ...prev, avatarUrl: secureData[0].secureUrl }));
          return secureData[0].secureUrl;
        }
      } catch (err) {
        console.error('Fetch Secure Avatar Error:', err);
      } finally {
        setImageLoading(false);
      }
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
          resolveAvatarUrl(u.profilePicture);
        }
      }
    } catch (err) {
      console.error('Fetch Profile Error:', err);
    }
  }, [resolveAvatarUrl]);

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
      const isUploadingImage = formData.avatarUrl && (formData.avatarUrl.startsWith('file://') || formData.avatarUrl.startsWith('content://'));

      let payload: any;
      const headers: any = {};

      if (isUploadingImage) {
        // Use FormData for image upload
        const data = new FormData();
        data.append('firstName', formData.firstName);
        data.append('lastName', formData.lastName);
        data.append('userName', formData.userName);
        data.append('phoneNo', getRawPhoneNumber(formData.phoneNumber));
        data.append('city', formData.city);
        data.append('street', formData.street);
        data.append('zipCode', formData.zipCode);

        if (formData.password && formData.password.trim() !== '') {
          data.append('password', formData.password);
        }

        const fileExtension = formData.avatarAsset?.type?.split('/')[1] || 'jpg';
        const fileName = formData.avatarAsset?.fileName || `profile.${fileExtension}`;
        const fileType = formData.avatarAsset?.type || `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`;

        data.append('file', {
          uri: Platform.OS === 'android' ? formData.avatarUrl : formData.avatarUrl.replace('file://', ''),
          name: fileName,
          type: fileType,
        } as any);

        payload = data;
        headers['Content-Type'] = 'multipart/form-data';
      } else {
        // Use JSON for simple field updates (more reliable on some Android environments)
        payload = {
          firstName: formData.firstName,
          lastName: formData.lastName,
          userName: formData.userName,
          phoneNo: getRawPhoneNumber(formData.phoneNumber),
          city: formData.city,
          street: formData.street,
          zipCode: formData.zipCode,
        };

        if (formData.password && formData.password.trim() !== '') {
          payload.password = formData.password;
        }
      }

      const res = await SettingsService.updateProfile(payload, headers);


      // Check for backend-specific success code if returned as 200 OK body
      if (res.data?.code && res.data.code !== 200) {
        throw res.data;
      }

      const updatedUser = res.data?.data?.data || res.data?.data || res.data;

      // Resolve profile picture to a usable URL from the upload response
      if (updatedUser?.profilePicture) {
        await resolveAvatarUrl(updatedUser.profilePicture);
      }

      // Refresh global user state to sync across app
      await refreshUser();

      // Check if the user's profilePicture needs resolving, then update Redux
      const freshUser = store.getState().auth.user;
      const pic = freshUser?.profilePicture;
      if (pic && !(typeof pic === 'string' && pic.startsWith('http'))) {
        const resolvedUrl = await resolveAvatarUrl(pic);
        if (resolvedUrl) {
          dispatch(setInitial({
            user: { ...store.getState().auth.user, profilePicture: resolvedUrl }
          }));
        }
      }

      Alert.alert('Success', 'Profile updated successfully', [
        {
          text: 'OK',
          onPress: handleBack
        }
      ]);
    } catch (error: any) {
      console.error('Update Profile Error:', error);
      // The interceptor rejects error.response.data, so 'error' is the payload
      const errorMessage = error?.message || error?.error || 'Update failed';
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handlePickImage = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        includeBase64: false,
        maxHeight: 500,
        maxWidth: 500,
        quality: 0.8,
      });

      if (result.didCancel) {
        return;
      }

      if (result.errorMessage) {
        Alert.alert('Error', result.errorMessage);
        return;
      }

      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];

        // Check file size (max 3.1 MB as mentioned in UI)
        if (asset.fileSize && asset.fileSize > 3100000) {
          Alert.alert('Error', 'Image size exceeds 3.1 MB limit');
          return;
        }

        setFormData({
          ...formData,
          avatarUrl: asset.uri || '',
          avatarAsset: asset
        });
      }
    } catch (error) {
      console.error('Image picker error:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
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
          const { secret, qrCode } = setupRes.data?.data || {};
          setAuthSecret(secret);
          setAuthQrCode(qrCode);
          setAuthStep(0);
          setAuthModalVisible(true);
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
      const fileName = 'revdsm_backup_codes.txt';
      const content = backupCodes.join('\n');

      if (Platform.OS === 'android') {
        const path = `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/${fileName}`;

        // Write the file first
        await ReactNativeBlobUtil.fs.writeFile(path, content, 'utf8');

        // Add to Download Manager to make it appear in the Downloads app and notifications
        ReactNativeBlobUtil.android.addCompleteDownload({
          title: fileName,
          description: 'RevDSM Backup Codes',
          mime: 'text/plain',
          path: path,
          showNotification: true,
        });

        // No alert as requested
      } else {

        // On iOS, we write to a temp file and share it so user can "Save to Files"
        const path = `${RNFS.TemporaryDirectoryPath}/${fileName}`;
        await RNFS.writeFile(path, content, 'utf8');

        await Share.share({
          url: `file://${path}`,
          title: 'Save Backup Codes',
        });
      }
    } catch (err) {
      console.error('Download error:', err);
      Alert.alert('Error', 'Failed to save or share backup codes');
    }
  };



  const handleVerifyAuthenticator = async () => {
    if (authCode.length !== 6) {
      Alert.alert('Error', 'Please enter a valid 6-digit code');
      return;
    }
    setLoading(true);
    try {
      const response = await SettingsService.verifyAuthenticator(authCode, authSecret);
      if (response.data?.data?.backupCodes) {
        setBackupCodes(response.data.data.backupCodes);
        setAuthModalVisible(false);
        setBackupCodesModalVisible(true);
        Alert.alert('Success', 'Google Authenticator enabled successfully!');
      }
      fetchTfaSettings();
    } catch (error: any) {
      Alert.alert('Error', error?.response?.data?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const fetchTrustedDevices = async () => {
    setLoading(true);
    try {
      const res = await SettingsService.getTrustedDevices();
      setTrustedDevices(res.data?.data?.devices || res.data?.data || []);
      setTrustedDevicesModalVisible(true);
    } catch (err) {
      console.error('Fetch Devices Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    setRevokingDeviceId(deviceId);
    try {
      await SettingsService.revokeDevice(deviceId);
      setTrustedDevices(prev => prev.filter(d => d.deviceId !== deviceId));
    } catch (err) {
      Alert.alert('Error', 'Failed to revoke device');
    } finally {
      setRevokingDeviceId(null);
    }
  };

  // Web parity: trusted-devices-dialog.js "Revoke All" (confirm → revokeAllTrustedDevices → refresh)
  const handleRevokeAllDevices = () => {
    Alert.alert(
      'Revoke All Devices?',
      "This will revoke trust from all devices. You'll need to verify 2FA on your next login from any device.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke All',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await SettingsService.revokeAllTrustedDevices();
              setTrustedDevices([]);
              Alert.alert('Success', 'All devices revoked successfully');
            } catch (err) {
              Alert.alert('Error', 'Failed to revoke devices');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleCopySecret = () => {
    Clipboard.setString(authSecret);
    Alert.alert('Copied', 'Secret key copied to clipboard');
  };

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: isDark ? colors.background : '#F8FAFC' }]}
      edges={['bottom', 'left', 'right']}
    >
      <View style={[styles.root, { backgroundColor: isDark ? colors.background : '#F8FAFC' }]}>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Title & Breadcrumbs */}
          <View className="px-5 py-6">
            <View className="flex-row items-center">
              {/* Same bordered-square back button the installer screens use
                  (`widgets/components/installer/InstallerSubScreen.tsx`). */}
              <TouchableOpacity
                onPress={handleBack}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                className="mr-3 p-1 items-center justify-center rounded-lg"
                style={{ width: 32, height: 32, borderWidth: 1, borderColor: colors.border }}
              >
                <Feather
                  name="arrow-left"
                  size={14}
                  color={isDark ? colors.text : colors.textSecondary}
                />
              </TouchableOpacity>
              <View className="flex-1" style={{alignItems:'center'}}>
                <Text className="text-xl font-black" style={{ color: colors.text }}>
                  Account Settings
                </Text>
    
              </View>
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
                className={`flex-1 flex-row items-center justify-center py-3.5 rounded-xl ${activeTab === 'profile' ? 'bg-[#4CBB17]' : ''
                  }`}
              >
                <Icon
                  name="person"
                  size={18}
                  color={activeTab === 'profile' ? '#fff' : colors.textSecondary}
                  className="mr-2"
                />
                <Text
                  className={`font-black  tracking-widest text-[11px] ${activeTab === 'profile' ? 'text-white' : ''
                    }`}
                  style={{ color: activeTab === 'profile' ? '#fff' : colors.textSecondary }}
                >
                  Profile
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setActiveTab('2fa')}
                className={`flex-1 flex-row items-center justify-center py-3.5 rounded-xl ${activeTab === '2fa' ? 'bg-[#4CBB17]' : ''
                  }`}
              >
                <Icon
                  name="shield-checkmark"
                  size={18}
                  color={activeTab === '2fa' ? '#fff' : colors.textSecondary}
                  className="mr-2"
                />
                <Text
                  className={`font-black  tracking-widest text-[11px] ${activeTab === '2fa' ? 'text-white' : ''
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
                  className="w-28 h-28 rounded-full items-center justify-center overflow-hidden border-2 border-dashed border-gray-300"
                  style={{ backgroundColor: isDark ? colors.background : '#F8FAFC' }}
                >
                  {imageLoading ? (
                    <ActivityIndicator color={colors.primary.main} />
                  ) : formData.avatarUrl ? (
                    <>
                      <Image source={{ uri: formData.avatarUrl }} className="absolute w-full h-full" />
                      <View className="absolute inset-0 bg-black/40 items-center justify-center">
                        <Icon name="camera-outline" size={22} color="white" />
                        <Text className="text-[9px] mt-1 font-bold text-white">
                          Upload photo
                        </Text>
                      </View>
                    </>
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
              {/* 2FA Card Container */}
              <View
                className="p-6 rounded-[32px] border mb-6"
                style={{
                  backgroundColor: isDark ? colors.surface : colors.card,
                  borderColor: colors.border,
                }}
              >
                <View className="flex-row items-center mb-6">
                  <View
                    className="w-10 h-10 rounded-xl items-center justify-center mr-4"
                    style={{ backgroundColor: isDark ? colors.background : '#F8FAFC' }}
                  >
                    <Icon name="shield-checkmark" size={20} color={colors.text} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xl font-black tracking-tight" style={{ color: colors.text }}>
                      Two-Factor Authentication
                    </Text>
                    <Text className="text-[11px] font-bold mt-0.5" style={{ color: colors.textSecondary }}>
                      Add an extra layer of security to your account
                    </Text>
                  </View>
                </View>

                {/* Status Card */}
                {tfaSettings.enabled ? (
                  <View className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex-row items-center justify-between mb-6">
                    <View className="flex-row items-center">
                      <View className="w-10 h-10 bg-emerald-500 rounded-full items-center justify-center">
                        <Icon name="checkmark-circle" size={24} color="white" />
                      </View>
                      <View className="ml-3">
                        <Text className="text-sm font-black text-emerald-900">2FA is Enabled</Text>
                        <Text className="text-[10px] font-bold text-emerald-600">
                          Method: {tfaSettings.method === 'email' ? 'Email OTP' : 'Authenticator App'}
                        </Text>
                      </View>
                    </View>
                    <View className="bg-emerald-500 px-3 py-1 rounded-lg">
                      <Text className="text-[9px] font-black text-white uppercase">Active</Text>
                    </View>
                  </View>
                ) : (
                  <View className="bg-orange-50 border border-orange-100 p-4 rounded-2xl flex-row items-center justify-between mb-6">
                    <View className="flex-row items-center">
                      <View className="w-10 h-10 bg-orange-500 rounded-full items-center justify-center">
                        <Icon name="alert-circle" size={24} color="white" />
                      </View>
                      <View className="ml-3">
                        <Text className="text-sm font-black text-orange-900">2FA is Disabled</Text>
                        <Text className="text-[10px] font-bold text-orange-600">Protect your account with 2FA</Text>
                      </View>
                    </View>
                    <View className="bg-orange-500 px-3 py-1 rounded-lg">
                      <Text className="text-[9px] font-black text-white uppercase">Inactive</Text>
                    </View>
                  </View>
                )}

                {/* Conditional Content */}
                {tfaSettings.enabled ? (
                  <View className="gap-y-4">
                    {/* Backup Codes Section */}
                    <View className="bg-white border border-slate-100 p-5 rounded-2xl shadow-sm">
                      <View className="flex-row items-center justify-between mb-4">
                        <View className="flex-row items-center">
                          <Icon name="key-outline" size={20} color="#1E293B" />
                          <Text className="ml-3 text-sm font-black text-slate-900">Backup Codes</Text>
                        </View>
                        <View className="bg-slate-900 px-2 py-1 rounded-lg">
                          <Text className="text-[10px] font-black text-white">
                            {tfaSettings.unusedBackupCodesCount || 0} remaining
                          </Text>
                        </View>
                      </View>
                      <Text className="text-[11px] font-bold text-slate-400 mb-6 leading-4">
                        Use backup codes to sign in if you lose access to your 2FA method
                      </Text>
                      <TouchableOpacity
                        onPress={handleRegenerateBackupCodes}
                        className="bg-slate-50 py-3 px-4 rounded-xl items-center border border-slate-100"
                      >
                        <Text className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Regenerate Codes</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Trusted Devices Section */}
                    <View className="bg-white border border-slate-100 p-5 rounded-2xl shadow-sm">
                      <View className="flex-row items-center mb-4">
                        <Icon name="phone-portrait-outline" size={20} color="#1E293B" />
                        <Text className="ml-3 text-sm font-black text-slate-900">Trusted Devices</Text>
                      </View>
                      <Text className="text-[11px] font-bold text-slate-400 mb-6 leading-4">
                        Manage devices that can skip 2FA verification for 10 days
                      </Text>
                      <TouchableOpacity
                        onPress={fetchTrustedDevices}
                        className="bg-slate-50 py-3 px-4 rounded-xl items-center border border-slate-100"
                      >
                        <Text className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Manage Devices</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Warning/Disable Section */}
                    <View className="bg-amber-50 border border-amber-100 p-5 rounded-2xl mt-4">
                      <View className="flex-row items-center mb-3">
                        <Icon name="warning" size={20} color="#D97706" />
                        <Text className="ml-3 text-[11px] font-black text-amber-900 leading-4 flex-1">
                          Disabling 2FA will make your account less secure. All trusted devices will also be revoked.
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={handleToggle2FA}
                        disabled={loading}
                        className="bg-white border border-amber-200 py-3 px-6 rounded-xl items-center mt-2"
                      >
                        {loading ? (
                          <ActivityIndicator color="#D97706" />
                        ) : (
                          <Text className="text-[11px] font-black text-amber-600 uppercase tracking-widest">Disable 2FA</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View>
                    <Text className="mb-4 text-[11px] font-black text-slate-400 uppercase tracking-widest">
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
                      className="bg-slate-900 py-4 rounded-2xl items-center mt-8 shadow-lg shadow-slate-200"
                    >
                      {loading ? (
                        <ActivityIndicator color="white" />
                      ) : (
                        <Text className="text-white font-black text-[11px] tracking-widest uppercase">
                          Enable Two-Factor
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
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
        {/* 4. Authenticator Setup Modal */}
        <Modal visible={authModalVisible} transparent animationType="fade">
          <View className="flex-1 bg-black/60 px-6">
            <GlobalKeyboardAvoidingView isModal style={{ justifyContent: 'center' }}>

              <View className="bg-white rounded-[32px] p-8 shadow-2xl overflow-hidden">
                <View className="flex-row items-center mb-6">
                  <View className="w-10 h-10 rounded-xl bg-slate-900 items-center justify-center mr-4">
                    <Icon name="shield-checkmark" size={20} color="white" />
                  </View>
                  <Text className="text-xl font-black text-slate-900 tracking-tighter">Setup Authenticator</Text>
                </View>

                {/* Stepper Header */}
                <View className="flex-row items-center mb-8 px-2">
                  <View className="flex-row items-center">
                    <View className={`w-6 h-6 rounded-full items-center justify-center ${authStep >= 0 ? 'bg-slate-900' : 'bg-slate-200'}`}>
                      <Text className="text-[10px] font-black text-white">1</Text>
                    </View>
                    <Text className={`ml-2 text-[11px] font-black ${authStep === 0 ? 'text-slate-900' : 'text-slate-400'}`}>Scan QR Code</Text>
                  </View>
                  <View className="flex-1 h-[1px] bg-slate-100 mx-4" />
                  <View className="flex-row items-center">
                    <View className={`w-6 h-6 rounded-full items-center justify-center ${authStep >= 1 ? 'bg-slate-900' : 'bg-slate-200'}`}>
                      <Text className="text-[10px] font-black text-white">2</Text>
                    </View>
                    <Text className={`ml-2 text-[11px] font-black ${authStep === 1 ? 'text-slate-900' : 'text-slate-400'}`}>Verify Code</Text>
                  </View>
                </View>

                {authStep === 0 ? (
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <View className="bg-[#E0F2FE] p-4 rounded-2xl flex-row items-center mb-6 border border-[#BAE6FD]">
                      <Icon name="information-circle" size={20} color="#0284C7" />
                      <View className="ml-3 flex-1">
                        <Text className="text-[11px] font-bold text-[#0369A1] leading-4">
                          1. Download Google Authenticator or similar app{'\n'}
                          2. Scan the QR code below or enter the key manually{'\n'}
                          3. Click "Next" to verify the code
                        </Text>
                      </View>
                    </View>

                    <View className="items-center mb-6">
                      <View className="p-4 bg-white border border-slate-100 rounded-3xl shadow-sm">
                        {authQrCode ? (
                          <Image source={{ uri: authQrCode }} style={{ width: 180, height: 180 }} />
                        ) : (
                          <ActivityIndicator color="#000" />
                        )}
                      </View>
                    </View>

                    <View className="mb-8">
                      <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Can't scan? Enter key manually:</Text>
                      <View className="flex-row gap-2">
                        <View className="flex-1 bg-slate-50 border border-slate-100 px-4 py-3 rounded-xl justify-center">
                          <Text className="text-[12px] font-black text-slate-700 tracking-wider" numberOfLines={1}>{authSecret}</Text>
                        </View>
                        <TouchableOpacity
                          onPress={handleCopySecret}
                          className="bg-slate-900 px-4 py-3 rounded-xl items-center justify-center"
                        >
                          <Icon name="copy" size={18} color="white" />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View className="flex-row gap-4">
                      <TouchableOpacity
                        onPress={() => setAuthModalVisible(false)}
                        className="flex-1 py-4 items-center"
                      >
                        <Text className="font-black text-[11px] text-slate-500 tracking-widest">CANCEL</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setAuthStep(1)}
                        className="flex-[1.5] bg-slate-900 py-4 rounded-2xl items-center shadow-lg shadow-slate-200"
                      >
                        <Text className="font-black text-[11px] text-white tracking-widest">NEXT</Text>
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                ) : (
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <View className="bg-[#E0F2FE] p-4 rounded-2xl flex-row items-center mb-8 border border-[#BAE6FD]">
                      <Icon name="information-circle" size={20} color="#0284C7" />
                      <Text className="ml-3 flex-1 text-[11px] font-bold text-[#0369A1] leading-4">
                        Enter the 6-digit code from your authenticator app to verify the setup.
                      </Text>
                    </View>

                    <CustomInput
                      label="Verification Code"
                      placeholder="000 000"
                      value={authCode}
                      onChangeText={(t) => setAuthCode(t.replace(/[^0-9]/g, ''))}
                      keyboardType="numeric"
                      maxLength={6}
                    />

                    <View className="flex-row gap-4 mt-8">
                      <TouchableOpacity
                        onPress={() => setAuthStep(0)}
                        className="flex-1 py-4 items-center"
                      >
                        <Text className="font-black text-[11px] text-slate-500 tracking-widest">BACK</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleVerifyAuthenticator}
                        disabled={loading || authCode.length !== 6}
                        className="flex-[1.5] bg-slate-900 py-4 rounded-2xl items-center shadow-lg shadow-slate-200"
                        style={{ opacity: loading || authCode.length !== 6 ? 0.6 : 1 }}
                      >
                        {loading ? (
                          <ActivityIndicator color="white" size="small" />
                        ) : (
                          <Text className="font-black text-[11px] text-white tracking-widest">VERIFY & ENABLE</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                )}
              </View>
            </GlobalKeyboardAvoidingView>
          </View>
        </Modal>


        {/* 5. Trusted Devices Modal */}
        <Modal visible={trustedDevicesModalVisible} transparent animationType="fade">
          <View className="flex-1 bg-black/60 items-center justify-center px-6">
            <View className="bg-white w-full rounded-[32px] overflow-hidden shadow-2xl max-h-[80%]">
              <View className="p-8 pb-4">
                <View className="flex-row items-center justify-between mb-6">
                  <View className="flex-row items-center">
                    <View className="w-10 h-10 rounded-xl bg-indigo-900 items-center justify-center mr-4">
                      <MaterialCommunityIcons name="devices" size={20} color="white" />
                    </View>
                    <Text className="text-xl font-black text-slate-900 tracking-tighter">Trusted Devices</Text>
                  </View>
                  <View className="flex-row items-center">
                    {trustedDevices.length > 0 && (
                      <TouchableOpacity
                        onPress={handleRevokeAllDevices}
                        disabled={loading}
                        className="flex-row items-center mr-2 px-3 py-1.5 rounded-xl border border-red-200 bg-red-50"
                      >
                        <MaterialCommunityIcons name="trash-can-outline" size={14} color="#DC2626" />
                        <Text className="ml-1.5 text-[11px] font-black text-red-600">Revoke All</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => setTrustedDevicesModalVisible(false)} className="p-2">
                      <Icon name="close" size={24} color="#64748b" />
                    </TouchableOpacity>
                  </View>
                </View>

                <View className="bg-indigo-50 p-4 rounded-2xl flex-row items-center mb-6 border border-indigo-100">
                  <Icon name="information-circle" size={20} color="#4F46E5" />
                  <Text className="ml-3 flex-1 text-[11px] font-bold text-indigo-700 leading-4">
                    Trusted devices skip 2FA verification for 10 days. You can revoke access at any time.
                  </Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} className="mb-4">
                  {trustedDevices.length === 0 ? (
                    <View className="items-center py-10">
                      <Icon name="devices-outline" size={64} color="#e2e8f0" />
                      <Text className="mt-4 text-sm font-black text-slate-400">No Trusted Devices</Text>
                    </View>
                  ) : (
                    <View className="gap-y-4">
                      {trustedDevices.map((device: any) => (
                        <View key={device.id || device._id || device.deviceId} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex-row items-center">
                          <View className="w-10 h-10 rounded-xl bg-white items-center justify-center border border-slate-100">
                            <Icon
                              name={device.userAgent?.toLowerCase().includes('mobile') || device.browser?.toLowerCase().includes('mobile') ? 'phone-portrait' : 'desktop'}
                              size={20}
                              color="#4F46E5"
                            />
                          </View>
                          <View className="ml-4 flex-1">
                            <View className="flex-row items-center">
                              <Text className="text-[13px] font-black text-slate-900" numberOfLines={1}>
                                {device.deviceName || device.browser || 'Unknown Device'}
                              </Text>
                              {device.isActive && (
                                <View className="ml-2 bg-emerald-100 px-1.5 py-0.5 rounded-md">
                                  <Text className="text-[8px] font-black text-emerald-700 uppercase">Active</Text>
                                </View>
                              )}
                            </View>

                            <View className="mt-1 gap-y-0.5">
                              {device.trustedAt && (
                                <Text className="text-[9px] font-bold text-slate-400">
                                  Trusted on: {new Date(device.trustedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                                </Text>
                              )}
                              {device.expiresAt && (
                                <Text className="text-[9px] font-bold text-slate-400">
                                  Expires on: {new Date(device.expiresAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                                </Text>
                              )}
                              {device.lastUsedAt && (
                                <Text className="text-[9px] font-bold text-slate-400">
                                  Last used: {new Date(device.lastUsedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                                </Text>
                              )}
                              <Text className="text-[9px] font-bold text-slate-400">IP: {device.ipAddress || 'Unknown IP'}</Text>
                            </View>
                          </View>
                          <TouchableOpacity
                            onPress={() => handleRevokeDevice(device.deviceId || device.id || device._id)}
                            disabled={revokingDeviceId === (device.deviceId || device.id || device._id)}
                            className="p-2 ml-2"
                          >
                            {revokingDeviceId === (device.deviceId || device.id || device._id) ? (
                              <ActivityIndicator color="#EF4444" size="small" />
                            ) : (
                              <Icon name="trash-outline" size={18} color="#EF4444" />
                            )}
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </ScrollView>
              </View>

              <View className="p-6 bg-slate-50">
                <TouchableOpacity
                  onPress={() => setTrustedDevicesModalVisible(false)}
                  className="w-full bg-slate-900 py-4 rounded-2xl items-center"
                >
                  <Text className="font-black text-[11px] text-white tracking-widest uppercase">Close</Text>
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
        className={`w-5 h-5 rounded-full border-2 items-center justify-center ${selected ? 'border-[#00A76F]' : 'border-gray-300'
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
