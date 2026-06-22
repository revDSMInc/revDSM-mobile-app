import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  TextInput,
  ImageBackground,
} from 'react-native';
import { FlashMessage } from '../../config/message';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../theme/ThemeProvider';
import { GlobalKeyboardAvoidingView } from '../../widgets/common/keyboard/GlobalKeyboard';
import { CustomInput } from '../../widgets/common/CustomInput';
import { CustomButton } from '../../widgets/common/CustomButton';
import Logo from '../../assets/svgs/logo';
import { useLoginMutation } from '../../hooks/useAuthMutation';
import { validateEmail } from '../../utils/validation';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation';
import { TouchableOpacity, Platform, PermissionsAndroid } from 'react-native';
import Geolocation from 'react-native-geolocation-service';


export default function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const loginMutation = useLoginMutation();
  const { colors, isDark } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [location, setLocation] = useState<{ lat: number; long: number } | null>(null);
  const passwordRef = useRef<TextInput>(null);

  React.useEffect(() => {
    const requestLocationPermission = async () => {
      if (Platform.OS === 'ios') {
        const auth = await Geolocation.requestAuthorization('whenInUse');
        if (auth === 'granted') {
          getCurrentLocation();
        }
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          getCurrentLocation();
        }
      }
    };

    requestLocationPermission();
  }, []);

  const getCurrentLocation = () => {
    Geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          long: position.coords.longitude,
        });
      },
      (error) => {
        console.log('Location error:', error.code, error.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };


  const handleLogin = async () => {
    if (!email || !password) {
      FlashMessage.error('Missing Info', 'Please enter both email and password');
      return;
    }

    if (!validateEmail(email)) {
      FlashMessage.error('Invalid Email', 'Please enter a valid email address');
      return;
    }

    try {
      const res: any = await loginMutation.mutateAsync({
        email: email,
        password,
        lat: location?.lat,
        long: location?.long
      });


      if (res?.twoFactorRequired) {
        if (res.method === 'authenticator') {
          navigation.navigate('AuthenticatorOTP', {
            email: email,
            password,
            lat: location?.lat,
            long: location?.long
          });
        } else {
          navigation.navigate('EmailOTP', {
            email: email,
            password,
            lat: location?.lat,
            long: location?.long
          });
        }
      }
    } catch (err: any) {
      const backendMsg = err?.message || err?.response?.data?.message || '';
      let cleanMsg = 'Incorrect email or password';
      if (backendMsg) {
        const lowerMsg = backendMsg.toLowerCase();
        if (
          lowerMsg.includes('password') ||
          lowerMsg.includes('credential') ||
          lowerMsg.includes('unauthorized') ||
          lowerMsg.includes('not found') ||
          lowerMsg.includes('validation')
        ) {
          cleanMsg = 'Incorrect email or password';
        } else {
          cleanMsg = backendMsg;
        }
      }
      FlashMessage.error('Login Failed', cleanMsg);
    }
  };


  return (
    <ImageBackground
      source={require('../../assets/images/home/login_bg.webp')}
      style={{ flex: 1, backgroundColor: colors.background }}
      imageStyle={{ opacity: 0.1 }}
    >
      <View style={{ flex: 1 }}>
        {/* Static Header: Logo won't move when keyboard opens */}
        <View className="items-center" style={{ marginTop: '25%', height: 60 }}>
          <Logo className="h-12 object-contain" />
        </View>

        {/* Shifting Content: Only the form lifting */}
        <GlobalKeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View className="flex-1 justify-center px-6">
              <Text className="text-2xl font-semibold mb-8" style={{ color: colors.text }}>
                Sign in to <Text style={{ color: colors.primary.main }}>rev</Text>DSM
              </Text>
              <CustomInput
                label="Email"
                placeholder="Enter your email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                rightIcon="mail"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                blurOnSubmit={false}
                textContentType="username"
                autoComplete="email"
              />

              <CustomInput
                ref={passwordRef}
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                rightIcon={showPassword ? 'eye-off' : 'eye'}
                onRightIconPress={() => setShowPassword((p) => !p)}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                textContentType="password"
                autoComplete="password"
              />

              <TouchableOpacity
                onPress={() => navigation.navigate('ForgotPassword')}
                className="self-end mb-6"
              >
                <Text className="text-sm font-semibold" style={{ color: colors.primary.main }}>Forgot password?</Text>
              </TouchableOpacity>

              <CustomButton
                title="Login"
                onPress={handleLogin}
                loading={loginMutation.isPending}
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
  root: {
    flex: 1,
  },
  backgroundImage: {
    flex: 1,
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
});
