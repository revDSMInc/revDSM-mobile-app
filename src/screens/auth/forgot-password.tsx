import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
} from 'react-native';
import { FlashMessage } from '../../config/message';
import { useTheme } from '../../theme/ThemeProvider';
import { GlobalKeyboardAvoidingView } from '../../widgets/common/keyboard/GlobalKeyboard';
import { CustomInput } from '../../widgets/common/CustomInput';
import { CustomButton } from '../../widgets/common/CustomButton';
import Logo from '../../assets/svgs/logo';
import { validateEmail } from '../../utils/validation';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation';
import Icon from 'react-native-vector-icons/Ionicons';

export default function ForgotPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendRequest = async () => {
    if (!email) {
      FlashMessage.error('Missing Info', 'Please enter your email address');
      return;
    }

    if (!validateEmail(email.trim())) {
      FlashMessage.error('Invalid Email', 'Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      // API call would go here
      await new Promise((resolve) => setTimeout(() => resolve(undefined), 1500));
      FlashMessage.success('Email Sent', 'Please check your inbox for reset instructions');
      navigation.navigate('EmailOTP', { email: email.trim() });
    } catch (err: any) {
      FlashMessage.error('Request Failed', err?.message || 'Something went wrong');
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
                  Back to login
                </Text>
              </TouchableOpacity>

              <Text className="text-2xl font-semibold mb-2" style={{ color: colors.text }}>
                Forgot your password?
              </Text>
              <Text className="text-sm text-[#637381] mb-8">
                Please enter the email address associated with your account and we will email you an
                OTP to reset your password.
              </Text>

              <CustomInput
                label="Email"
                placeholder="Enter Your Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                rightIcon="mail"
                returnKeyType="done"
                onSubmitEditing={handleSendRequest}
              />

              <CustomButton
                title="Send Request"
                onPress={handleSendRequest}
                loading={loading}
                style={{ marginTop: 12 }}
              />
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
