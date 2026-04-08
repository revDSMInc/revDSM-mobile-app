import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ImageBackground } from 'react-native';
import { FlashMessage } from '../../config/message';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../theme/ThemeProvider';
import { GlobalKeyboardAvoidingView } from '../../widgets/common/keyboard/GlobalKeyboard';
import { CustomInput } from '../../widgets/controls/input/CustomInput';
import { CustomButton } from '../../widgets/controls/button/CustomButton';
import Logo from '../../assets/svgs/logo';
import { useLoginMutation } from '../../hooks/useAuthMutation';
import { validateEmail } from '../../utils/validation';

export default function LoginScreen() {
  const loginMutation = useLoginMutation();
  const { colors, isDark } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      FlashMessage.error('Missing Info', 'Please enter both email and password');
      return;
    }

    if (!validateEmail(email.trim())) {
      FlashMessage.error('Invalid Email', 'Please enter a valid email address');
      return;
    }

    try {
      await loginMutation.mutateAsync({ email: email.trim(), password });
    } catch (err: any) {
      FlashMessage.error('Login Failed', err?.message || 'Invalid credentials');
    }
  };

  return (
    <ImageBackground
      style={[
        {
          flexGrow: 1,
          justifyContent: 'center',
          backgroundColor: colors.background,
        },
      ]}
      source={require('../../assets/images/home/login_bg.webp')}
      imageStyle={{ opacity: 0.06, objectFit: 'cover' }}
    >
      <GlobalKeyboardAvoidingView style={styles.root}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand */}
          <View className="items-center mt-[30%]">
            <Logo className="h-12 object-contain" />
          </View>

          {/* Form Card */}
          <View className="flex-1 justify-center">
            <Text className="text-2xl font-semibold mb-8" style={{ color: colors.text }}>
              Sign in to <Text style={{ color: colors.primary.main }}>rev</Text>DSM
            </Text>
            <CustomInput
              label="Email"
              placeholder="Enter Your Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              rightIcon="mail-outline"
            />

            <CustomInput
              label="Password"
              placeholder="Enter your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              rightIcon={showPassword ? 'eye-off-outline' : 'eye-outline'}
              onRightIconPress={() => setShowPassword((p) => !p)}
            />

            <CustomButton
              title="Login"
              onPress={handleLogin}
              loading={loginMutation.isPending}
              style={{ marginTop: 12 }}
            />
          </View>
        </ScrollView>
      </GlobalKeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 24,
  },
});
