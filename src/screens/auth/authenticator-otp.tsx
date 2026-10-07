import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  TextInput,
  Keyboard,
} from 'react-native';
import { FlashMessage } from '../../config/message';
import { useTheme } from '../../theme/ThemeProvider';
import { GlobalKeyboardAvoidingView } from '../../widgets/common/keyboard/GlobalKeyboard';
import { CustomButton } from '../../widgets/common/CustomButton';
import Logo from '../../assets/svgs/logo';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation';
import { useVerifyOtpMutation } from '../../hooks/useAuthMutation';
import {
  isMobileAccessDenied,
  NO_MOBILE_ACCESS_MESSAGE,
} from '../../utils/auth/dashboard-access';
import { isNetworkError, isTimeoutError } from '../../utils/network-error';
import Icon from 'react-native-vector-icons/Ionicons';

export default function AuthenticatorOTPScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AuthenticatorOTP'>>();
  const { email, password, lat, long } = route.params;

  const { colors } = useTheme();

  const [code, setCode] = useState(['', '', '', '', '', '']);
  const inputs = useRef<(TextInput | null)[]>(new Array(6).fill(null));
  const verifyOtpMutation = useVerifyOtpMutation();
  const [trustDevice, setTrustDevice] = useState(false);

  const handleTextChange = (text: string, index: number) => {
    const newCode = [...code];
    newCode[index] = text;
    setCode(newCode);

    if (text && index < 5) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    if (verifyOtpMutation.isPending) return;

    const fullCode = code.join('');
    if (fullCode.length < 6) {
      FlashMessage.error('Invalid PIN', 'Please enter the 6-digit authenticator PIN');
      return;
    }

    Keyboard.dismiss();

    try {
      await verifyOtpMutation.mutateAsync({ 
        email, 
        code: fullCode, 
        password, 
        trustDevice,
        lat,
        long
      });
      FlashMessage.success('Verified', 'Authenticator PIN verified');
    } catch (err: any) {
      if (isMobileAccessDenied(err)) {
        FlashMessage.error('Access Denied', NO_MOBILE_ACCESS_MESSAGE);
        navigation.navigate('Login');
        return;
      }
      if (isNetworkError(err)) {
        FlashMessage.error(
          'Verification Failed',
          isTimeoutError(err)
            ? 'The request timed out. Check your connection and try again.'
            : 'No internet connection. Check your network and try again.'
        );
        return;
      }
      FlashMessage.error('Verification Failed', err?.message || 'Invalid PIN');
    }
  };

  return (
    <ImageBackground
      source={require('../../assets/images/home/login_bg.webp')}
      style={{ flex: 1, backgroundColor: colors.background }}
      imageStyle={{ opacity: 0.1 }}
    >
      <View style={{ flex: 1 }}>
        <View className="items-center" style={{ marginTop: '15%', height: 60 }}>
          <Logo className="h-12 object-contain" />
        </View>

        <GlobalKeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View className="flex-1 px-6">
              <Text className="text-2xl font-bold mb-3" style={{ color: colors.text }}>
                Two-Factor Authentication
              </Text>
              <Text className="text-sm text-[#637381] mb-6 leading-5">
                Please enter the 6-digit code from your authenticator app for {'\n'}
                <Text className="font-bold text-slate-800">{email}</Text>.
              </Text>

              {/* Banner */}
              <View className="bg-[#D1FAE5] p-4 rounded-xl flex-row items-center mb-10 border border-[#A7F3D0]">
                <Icon name="shield-checkmark-outline" size={20} color="#059669" />
                <Text className="ml-3 text-[13px] font-bold text-[#059669]">
                  Check your app for the verification code
                </Text>
              </View>

              <View className="flex-row justify-between mb-10">
                {code.map((digit, i) => (
                  <TextInput
                    key={i}
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    style={{
                      width: 48,
                      height: 56,
                      borderWidth: 1,
                      borderRadius: 12,
                      textAlign: 'center',
                      fontSize: 20,
                      fontWeight: '700',
                      borderColor: digit ? colors.primary.main : '#919EAB33',
                      backgroundColor: 'white',
                      color: colors.text,
                    }}
                    value={digit}
                    onChangeText={(text) => handleTextChange(text, i)}
                    onKeyPress={(e) => handleKeyPress(e, i)}
                    keyboardType="number-pad"
                    maxLength={1}
                    selectTextOnFocus
                    returnKeyType={i === 5 ? 'done' : 'next'}
                    onSubmitEditing={i === 5 ? handleVerify : () => inputs.current[i+1]?.focus()}
                  />
                ))}
              </View>

              <TouchableOpacity
                onPress={() => {/* TODO: Implement backup code flow */}}
                className="flex-row items-center mb-8"
              >
                <Icon name="shield-outline" size={20} color={colors.text} />
                <Text className="ml-2 text-sm font-bold" style={{ color: colors.text }}>
                  Use backup code
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setTrustDevice(!trustDevice)}
                className="flex-row items-center mb-10"
              >
                <View
                  className="w-5 h-5 rounded-md border items-center justify-center mr-3"
                  style={{
                    borderColor: trustDevice ? colors.primary.main : '#919EAB4D',
                    backgroundColor: trustDevice ? colors.primary.main : 'transparent',
                  }}
                >
                  {trustDevice && <Icon name="checkmark" size={14} color="white" />}
                </View>
                <Text className="text-sm font-bold text-[#637381]">
                  Trust this device for 10 days
                </Text>
              </TouchableOpacity>

              <CustomButton 
                title="Verify Code" 
                onPress={handleVerify} 
                disabled={code.join('').length !== 6}
                loading={verifyOtpMutation.isPending} 
              />

              <View className="mt-8 items-center">
                <TouchableOpacity onPress={() => navigation.navigate('EmailOTP', { email, password, lat, long })}>
                  <Text className="text-sm font-bold" style={{ color: colors.primary.main }}>
                    Try another way
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={() => navigation.goBack()}
                className="mt-8 flex-row items-center justify-center"
              >
                <Icon name="chevron-back" size={16} color={colors.text} />
                <Text className="ml-1 text-sm font-bold" style={{ color: colors.text }}>
                  Back to login
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
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
});
