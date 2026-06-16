import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  ActivityIndicator,
  Modal,
  FlatList,
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
import { AuthService } from '../../services/api/auth';

export default function ForgotPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<any>(null);
  const [showCompanyModal, setShowCompanyModal] = useState(false);

  const fetchCompanies = async () => {
    if (!email) {
      FlashMessage.error('Missing Info', 'Please enter your email address');
      return;
    }

    if (!validateEmail(email.trim())) {
      FlashMessage.error('Invalid Email', 'Please enter a valid email address');
      return;
    }

    setCheckingEmail(true);
    try {
      const response = await AuthService.getCompanyNames(email.trim());
      const data = response.data?.data?.data || response.data?.data || [];

      if (data.length === 0) {
        FlashMessage.error('Not Found', 'No company associated with this email address');
        setCompanies([]);
      } else {
        setCompanies(data);
        if (data.length === 1) {
          setSelectedCompany(data[0]);
        } else {
          setShowCompanyModal(true);
        }
      }
    } catch (err: any) {
      FlashMessage.error('Lookup Failed', err?.response?.data?.message || 'Could not fetch companies');
    } finally {
      setCheckingEmail(false);
    }
  };

  const handleSendRequest = async () => {
    if (!email || !selectedCompany) {
      FlashMessage.error('Missing Info', 'Please select your company');
      return;
    }

    setLoading(true);
    try {
      await AuthService.forgotPassword(email.trim(), selectedCompany.companyId);
      FlashMessage.success('Email Sent', 'Please check your inbox for reset instructions');

      navigation.navigate('ResetPassword', {
        email: email.trim(),
        companyId: selectedCompany.companyId,
        companyName: selectedCompany.companyName
      });
    } catch (err: any) {
      FlashMessage.error('Request Failed', err?.response?.data?.message || 'Something went wrong');
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
                Enter your email to find your company and reset your password.
              </Text>

              <View className="mb-4">
                <CustomInput
                  label="Email"
                  placeholder="Enter your email"
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    setCompanies([]);
                    setSelectedCompany(null);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  rightIcon={checkingEmail ? undefined : "mail"}
                  onRightIconPress={fetchCompanies}
                  onSubmitEditing={fetchCompanies}
                />
                {checkingEmail && (
                  <View className="absolute right-4 top-10">
                    <ActivityIndicator size="small" color={colors.primary.main} />
                  </View>
                )}
              </View>

              {companies.length > 0 && (
                <TouchableOpacity
                  onPress={() => setShowCompanyModal(true)}
                  className="mb-8 p-4 rounded-xl border border-[#919EAB33] bg-white/50 flex-row justify-between items-center"
                >
                  <View>
                    <Text className="text-[10px] font-bold text-[#637381] uppercase mb-1">
                      Selected Company
                    </Text>
                    <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                      {selectedCompany?.companyName || 'Select Company'}
                    </Text>
                  </View>
                  <Icon name="chevron-down" size={20} color="#637381" />
                </TouchableOpacity>
              )}

              <CustomButton
                title={companies.length === 0 ? "Check Email" : "Send Reset Link"}
                onPress={companies.length === 0 ? fetchCompanies : handleSendRequest}
                loading={loading || checkingEmail}
                style={{ marginTop: 12 }}
              />
            </View>
          </ScrollView>
        </GlobalKeyboardAvoidingView>

        {/* Company Selection Modal */}
        <Modal visible={showCompanyModal} transparent animationType="slide">
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-white rounded-t-[32px] p-6 max-h-[70%]">
              <View className="flex-row justify-between items-center mb-6">
                <Text className="text-xl font-bold">Select Your Company</Text>
                <TouchableOpacity onPress={() => setShowCompanyModal(false)}>
                  <Icon name="close" size={24} color="#637381" />
                </TouchableOpacity>
              </View>

              <FlatList
                data={companies}
                keyExtractor={(item) => item.companyId}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedCompany(item);
                      setShowCompanyModal(false);
                    }}
                    className={`p-4 rounded-xl mb-3 flex-row items-center justify-between ${selectedCompany?.companyId === item.companyId
                      ? 'bg-[#43A756]10 border border-[#43A756]'
                      : 'bg-[#F4F6F8]'
                      }`}
                  >
                    <Text className={`font-semibold ${selectedCompany?.companyId === item.companyId ? 'text-[#43A756]' : 'text-black'
                      }`}>
                      {item.companyName}
                    </Text>
                    {selectedCompany?.companyId === item.companyId && (
                      <Icon name="checkmark-circle" size={20} color="#43A756" />
                    )}
                  </TouchableOpacity>
                )}
                contentContainerStyle={{ paddingBottom: 20 }}
              />
            </View>
          </View>
        </Modal>
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
