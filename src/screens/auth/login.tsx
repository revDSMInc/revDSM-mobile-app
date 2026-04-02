import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { FlashMessage } from '../../config/message';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../theme/ThemeProvider';
import { GlobalKeyboardAvoidingView } from '../../widgets/common/keyboard/GlobalKeyboard';
import { CustomInput } from '../../widgets/controls/input/CustomInput';
import { CustomButton } from '../../widgets/controls/button/CustomButton';

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
    <GlobalKeyboardAvoidingView className="flex-1" style={{ backgroundColor: colors.background }}>
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6"
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand */}
        <View className="items-center mb-10">
          <View
            className="w-16 h-16 rounded-2xl items-center justify-center mb-4 shadow-lg"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Text className="text-white text-3xl font-black">R</Text>
          </View>
          <Text className="text-3xl font-black tracking-tighter" style={{ color: colors.text }}>
            revDSM
          </Text>
          <Text className="text-xs mt-1 font-bold opacity-60" style={{ color: colors.textSecondary }}>
            Sales Representative Portal
          </Text>
        </View>

        {/* Form Card */}
        <View
          className="rounded-3xl p-6 shadow-xl border"
          style={{
            backgroundColor: isDark ? colors.surface : colors.card,
            shadowColor: '#000',
            shadowOpacity: isDark ? 0 : 0.08,
            shadowRadius: 20,
            elevation: 8,
            borderColor: isDark ? colors.border : 'transparent',
          }}
        >
          <CustomInput
            label="Email"
            placeholder="your@email.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <View className="relative">
            <CustomInput
              label="Password"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity
              onPress={() => setShowPassword((p) => !p)}
              className="absolute right-3 top-10 p-1"
            >
              <Text className="text-[11px] font-black" style={{ color: colors.primary.main }}>
                {showPassword ? 'HIDE' : 'SHOW'}
              </Text>
            </TouchableOpacity>
          </View>

          <CustomButton
            title="Login"
            onPress={handleLogin}
            loading={loginMutation.isPending}
            style={{ marginTop: 12 }}
          />
        </View>
      </ScrollView>
    </GlobalKeyboardAvoidingView>
  );
}
