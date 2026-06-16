import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  TextInput,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import { FlashMessage } from '../../config/message';
import { useTheme } from '../../theme/ThemeProvider';
import { GlobalKeyboardAvoidingView } from '../../widgets/common/keyboard/GlobalKeyboard';
import { CustomInput } from '../../widgets/common/CustomInput';
import { CustomButton } from '../../widgets/common/CustomButton';
import Logo from '../../assets/svgs/logo';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation';
import Icon from 'react-native-vector-icons/Ionicons';
import { AuthService } from '../../services/api/auth';
import { validatePassword } from '../../utils/validation';

export default function ResetPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'ResetPassword'>>();
  const { email, companyId, companyName } = route.params;
  const { colors } = useTheme();

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const otpInputs = useRef<(TextInput | null)[]>(new Array(6).fill(null));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCountdown = () => {
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleOtpChange = (text: string, index: number) => {
    const newOtp = [...otp];
    newOtp[index] = text;
    setOtp(newOtp);

    if (text && index < 5) {
      otpInputs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputs.current[index - 1]?.focus();
    }
  };

  const handleUpdatePassword = async () => {
    const otpCode = otp.join('');

    if (otpCode.length < 6) {
      FlashMessage.error('Invalid Code', 'Please enter the 6-digit code');
      return;
    }

    if (!password) {
      FlashMessage.error('Missing Info', 'Please enter a new password');
      return;
    }

    if (password.length < 8) {
      FlashMessage.error('Weak Password', 'Password must be at least 8 characters long');
      return;
    }
    if (!/[A-Z]/.test(password)) {
      FlashMessage.error('Weak Password', 'Password must contain at least 1 uppercase letter');
      return;
    }
    if (!/[a-z]/.test(password)) {
      FlashMessage.error('Weak Password', 'Password must contain at least 1 lowercase letter');
      return;
    }
    if (!/\d/.test(password)) {
      FlashMessage.error('Weak Password', 'Password must contain at least 1 number');
      return;
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
      FlashMessage.error('Weak Password', 'Password must contain at least 1 special character');
      return;
    }

    if (password !== confirmPassword) {
      FlashMessage.error('Error', 'Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await AuthService.resetPassword({
        email,
        companyId,
        otpCode,
        password,
      });
      FlashMessage.success('Success', 'Password reset successfully');
      navigation.navigate('Login');
    } catch (err: any) {
      const serverMsg = err?.message || err?.response?.data?.message || '';
      let errorMsg = serverMsg || 'Could not reset password';

      if (serverMsg.toLowerCase().includes('expired') || serverMsg.toLowerCase().includes('expire')) {
        errorMsg = 'The verification code has expired. Please request a new code.';
      }

      FlashMessage.error('Reset Failed', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || resending) return;

    setResending(true);
    try {
      await AuthService.forgotPassword(email, companyId);
      FlashMessage.success('Resent', 'A new code has been sent to your email');
      startCountdown();
    } catch (err: any) {
      FlashMessage.error('Resend Failed', err?.response?.data?.message || 'Could not resend code');
    } finally {
      setResending(false);
    }
  };

  return (
    <ImageBackground
      source={require('../../assets/images/home/login_bg.webp')}
      style={{ flex: 1, backgroundColor: colors.background }}
      imageStyle={{ opacity: 0.1 }}
    >
      <View style={{ flex: 1 }}>
        <View className="items-center" style={{ marginTop: '20%', height: 60 }}>
          <Logo className="h-12 object-contain" />
        </View>

        <GlobalKeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View className="flex-1 px-6">
              <View className="items-center mb-6">
                <Text className="text-2xl font-bold text-center mb-2" style={{ color: colors.text }}>
                  Request sent successfully!
                </Text>
                <Text className="text-sm text-[#637381] text-center px-4">
                  We've sent a 6-digit confirmation email to your email. Please enter the code in below box to verify your email.
                </Text>
              </View>

              <View className="mb-4">
                <CustomInput
                  label="Email"
                  value={email}
                  editable={false}
                  containerStyle={{ backgroundColor: '#F4F6F8', opacity: 0.8 }}
                />
              </View>

              <View className="mb-6">
                <CustomInput
                  label="Company Name"
                  value={companyName}
                  editable={false}
                  containerStyle={{ backgroundColor: '#F4F6F8', opacity: 0.8 }}
                />
              </View>

              <View className="flex-row justify-between mb-8">
                {otp.map((digit, i) => (
                  <TextInput
                    key={i}
                    ref={(el) => {
                      otpInputs.current[i] = el;
                    }}
                    style={{
                      width: 48,
                      height: 56,
                      borderWidth: 1,
                      borderRadius: 12,
                      textAlign: 'center',
                      fontSize: 20,
                      fontWeight: '700',
                      borderColor: digit ? colors.text : '#919EAB33',
                      backgroundColor: 'white',
                      color: colors.text,
                    }}
                    placeholder="-"
                    placeholderTextColor="#919EAB"
                    value={digit}
                    onChangeText={(text) => handleOtpChange(text, i)}
                    onKeyPress={(e) => handleOtpKeyPress(e, i)}
                    keyboardType="number-pad"
                    maxLength={1}
                    selectTextOnFocus
                  />
                ))}
              </View>

              <View className="mb-4">
                <CustomInput
                  label="Password"
                  placeholder="Enter new password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  rightIcon={showPassword ? 'eye-off' : 'eye'}
                  onRightIconPress={() => setShowPassword(!showPassword)}
                />
              </View>

              <View className="mb-8">
                <CustomInput
                  label="Confirm New Password"
                  placeholder="Confirm your new password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  rightIcon={showConfirmPassword ? 'eye-off' : 'eye'}
                  onRightIconPress={() => setShowConfirmPassword(!showConfirmPassword)}
                />
              </View>

              <CustomButton
                title="Update Password"
                onPress={handleUpdatePassword}
                loading={loading}
                style={{ backgroundColor: '#212B36', borderRadius: 8, height: 52 }}
              />

              <View className="mt-6 items-center">
                <Text className="text-sm text-[#637381]">
                  Don't have a code?{' '}
                  <Text
                    className="font-bold"
                    style={{
                      color: (countdown > 0 || resending) ? '#919EAB' : '#00C853',
                      fontWeight: '700'
                    }}
                    onPress={handleResend}
                  >
                    Resend code {countdown > 0 ? `(${countdown}s)` : ''}
                  </Text>
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => navigation.navigate('Login')}
                className="mt-8 flex-row items-center justify-center"
              >
                <Icon name="chevron-back" size={16} color={colors.text} />
                <Text className="text-sm font-bold ml-1" style={{ color: colors.text }}>
                  Return to login
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </GlobalKeyboardAvoidingView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingBottom: 40,
  },
});
