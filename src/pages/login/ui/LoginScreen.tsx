import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { useAuth } from '../../../shared';
import { useTheme } from '../../../app/providers/ThemeProvider';

export default function LoginScreen() {
  const { login } = useAuth();
  const { colors, isDark } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    try {
      setLoading(true);
      await login(email.trim(), password);
    } catch (err: any) {
      Alert.alert('Login Failed', err?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand */}
        <View style={{ alignItems: 'center', marginBottom: 40 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              backgroundColor: '#4CBB17',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800' }}>R</Text>
          </View>
          <Text
            style={{ color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}
          >
            revDSM
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>
            Sales Representative Portal
          </Text>
        </View>

        {/* Form Card */}
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 20,
            padding: 24,
            shadowColor: '#000',
            shadowOpacity: isDark ? 0 : 0.08,
            shadowRadius: 16,
            elevation: 4,
            borderWidth: isDark ? 1 : 0,
            borderColor: colors.border,
          }}
        >
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 0.8,
              marginBottom: 8,
              textTransform: 'uppercase',
            }}
          >
            Email
          </Text>
          <TextInput
            style={{
              backgroundColor: colors.surface,
              color: colors.text,
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 14,
              fontSize: 14,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: 18,
            }}
            placeholder="your@email.com"
            placeholderTextColor={colors.textSecondary}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 0.8,
              marginBottom: 8,
              textTransform: 'uppercase',
            }}
          >
            Password
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: 28,
            }}
          >
            <TextInput
              style={{
                flex: 1,
                color: colors.text,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 14,
              }}
              placeholder="••••••••"
              placeholderTextColor={colors.textSecondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity
              onPress={() => setShowPassword((p) => !p)}
              style={{ paddingHorizontal: 14 }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
                {showPassword ? 'Hide' : 'Show'}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={{
              backgroundColor: loading ? '#5BE49B' : '#4CBB17',
              borderRadius: 12,
              paddingVertical: 16,
              alignItems: 'center',
            }}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Login</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
