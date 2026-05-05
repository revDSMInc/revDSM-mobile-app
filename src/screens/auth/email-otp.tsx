import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  TextInput,
} from 'react-native';
import { FlashMessage } from '../../config/message';
import { useTheme } from '../../theme/ThemeProvider';
import { GlobalKeyboardAvoidingView } from '../../widgets/common/keyboard/GlobalKeyboard';
import { CustomButton } from '../../widgets/common/CustomButton';
import Logo from '../../assets/svgs/logo';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation';
import Icon from 'react-native-vector-icons/Ionicons';

export default function EmailOTPScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'EmailOTP'>>();
  const { email } = route.params;
  const { colors } = useTheme();

  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const inputs = useRef<(TextInput | null)[]>(new Array(6).fill(null));

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
    const fullCode = code.join('');
    if (fullCode.length < 6) {
      FlashMessage.error('Invalid Code', 'Please enter the 6-digit code');
      return;
    }

    setLoading(true);
    try {
      // API call would go here
      await new Promise((resolve) => setTimeout(() => resolve(undefined), 1500));
      FlashMessage.success('Verified', 'Email verified successfully');
      // For now just go back or to login, usually this would lead to password reset or home
      navigation.navigate('Login');
    } catch (err: any) {
      FlashMessage.error('Verification Failed', err?.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ImageBackground
      source={require('../../assets/images/home/login_bg.webp')}
      style={{ flex: 1, backgroundColor: colors.background }}
      imageStyle={{ opacity: 0.1 }}
    >
      <View style={{ flex: 1 }}>
        <View className="items-center" style={{ marginTop: '25%', height: 60 }}>
          <Logo className="h-12 object-contain" />
        </View>

        <GlobalKeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View className="flex-1 justify-center px-6">
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                className="flex-row items-center mb-6"
              >
                <Icon name="chevron-back" size={20} color={colors.text} />
                <Text className="text-sm font-medium ml-1" style={{ color: colors.text }}>
                  Back
                </Text>
              </TouchableOpacity>

              <Text className="text-2xl font-semibold mb-2" style={{ color: colors.text }}>
                Please check your email!
              </Text>
              <Text className="text-sm text-[#637381] mb-8">
                We have emailed a 6-digit confirmation code to {email}, please enter the code below
                to verify your email.
              </Text>

              <View className="flex-row justify-between mb-8">
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
                  />
                ))}
              </View>

              <CustomButton title="Verify" onPress={handleVerify} loading={loading} />

              <View className="mt-8 items-center">
                <Text className="text-sm text-[#637381]">
                  Don't have a code?{' '}
                  <Text
                    className="font-bold"
                    style={{ color: colors.primary.main }}
                    onPress={() =>
                      FlashMessage.success('Resent', 'Code has been resent to your email')
                    }
                  >
                    Resend code
                  </Text>
                </Text>
              </View>
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
