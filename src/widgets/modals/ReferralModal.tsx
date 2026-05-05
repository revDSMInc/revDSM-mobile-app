import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { LeadService } from '../../services/api/leads';

interface ReferralModalProps {
  visible: boolean;
  onClose: () => void;
  selectedJob: any;
}

export const ReferralModal = ({ visible, onClose, selectedJob }: ReferralModalProps) => {
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    firstName: '',
    phoneNumber: '',
    preferredContactMethod: 'call',
    bestTimeToContact: 'anytime',
    zipCode: '',
    note: '',
    items: [] as string[],
  });

  const products = ['Fascia Wrap', 'Soffit', 'Gutter', 'Leaf Filter'];

  const toggleProduct = (product: string) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.includes(product)
        ? prev.items.filter((i) => i !== product)
        : [...prev.items, product],
    }));
  };

  const handleSubmit = async () => {
    if (!form.phoneNumber) {
      Alert.alert('Error', 'Phone number is required');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        jobId: selectedJob?.jobNumber,
        companyId: selectedJob?.companyId,
        repName: selectedJob?.userName,
        firstName: form.firstName,
        phoneNumber: form.phoneNumber,
        preferredContactMethod: form.preferredContactMethod,
        bestTimeToContact: form.bestTimeToContact,
        notes: form.note,
        zipCode: form.zipCode,
        items: form.items,
      };

      await LeadService.createReferral(payload);

      Alert.alert('Success', 'Referral submitted successfully');
      onClose();
    } catch (error) {
      console.error('Referral Error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 justify-end bg-black/50">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="bg-white dark:bg-zinc-900 rounded-t-[40px] h-[85%]"
        >
          <View className="p-6 border-b border-slate-100 dark:border-zinc-800 flex-row justify-between items-center">
            <Text className="text-[20px] font-black dark:text-white">Add Reference</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color={isDark ? 'white' : 'black'} />
            </TouchableOpacity>
          </View>

          <ScrollView className="p-6">
            <View className="mb-4">
              <Text className="text-[12px] font-black text-slate-400 uppercase mb-2">
                Full Name
              </Text>
              <TextInput
                className="bg-slate-50 dark:bg-zinc-800 p-4 rounded-2xl dark:text-white font-bold"
                placeholder="Enter full name"
                placeholderTextColor="#94a3b8"
                value={form.firstName}
                onChangeText={(t) => setForm((f) => ({ ...f, firstName: t }))}
              />
            </View>

            <View className="mb-4">
              <Text className="text-[12px] font-black text-slate-400 uppercase mb-2">
                Phone Number *
              </Text>
              <TextInput
                className="bg-slate-50 dark:bg-zinc-800 p-4 rounded-2xl dark:text-white font-bold"
                placeholder="Enter phone number"
                keyboardType="phone-pad"
                placeholderTextColor="#94a3b8"
                value={form.phoneNumber}
                onChangeText={(t) => setForm((f) => ({ ...f, phoneNumber: t }))}
              />
            </View>

            <View className="flex-row gap-4 mb-4">
              <View className="flex-1">
                <Text className="text-[12px] font-black text-slate-400 uppercase mb-2">
                  Contact Method
                </Text>
                <View className="flex-row bg-slate-50 dark:bg-zinc-800 rounded-2xl p-1">
                  {['call', 'text'].map((m) => (
                    <TouchableOpacity
                      key={m}
                      onPress={() => setForm((f) => ({ ...f, preferredContactMethod: m }))}
                      className={`flex-1 py-3 rounded-xl items-center ${
                        form.preferredContactMethod === m ? 'bg-white shadow-sm' : ''
                      }`}
                    >
                      <Text
                        className={`font-black uppercase text-[10px] ${
                          form.preferredContactMethod === m ? 'text-blue-600' : 'text-slate-400'
                        }`}
                      >
                        {m}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View className="flex-1">
                <Text className="text-[12px] font-black text-slate-400 uppercase mb-2">
                  Best Time
                </Text>
                <View className="bg-slate-50 dark:bg-zinc-800 rounded-2xl">
                  {/* Simplification: Just show a cycle button or similar since Picker is separate */}
                  <TouchableOpacity
                    onPress={() => {
                      const times = ['morning', 'afternoon', 'evening', 'anytime'];
                      const next =
                        times[(times.indexOf(form.bestTimeToContact) + 1) % times.length];
                      setForm((f) => ({ ...f, bestTimeToContact: next }));
                    }}
                    className="p-4 items-center"
                  >
                    <Text className="font-black text-blue-600 uppercase text-[10px]">
                      {form.bestTimeToContact}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View className="mb-4">
              <Text className="text-[12px] font-black text-slate-400 uppercase mb-2">Zip Code</Text>
              <TextInput
                className="bg-slate-50 dark:bg-zinc-800 p-4 rounded-2xl dark:text-white font-bold"
                placeholder="Enter zip code"
                placeholderTextColor="#94a3b8"
                value={form.zipCode}
                onChangeText={(t) => setForm((f) => ({ ...f, zipCode: t }))}
              />
            </View>

            <View className="mb-4">
              <Text className="text-[12px] font-black text-slate-400 uppercase mb-2">Note</Text>
              <TextInput
                className="bg-slate-50 dark:bg-zinc-800 p-4 rounded-2xl dark:text-white font-bold"
                placeholder="Enter notes"
                multiline
                numberOfLines={3}
                placeholderTextColor="#94a3b8"
                value={form.note}
                onChangeText={(t) => setForm((f) => ({ ...f, note: t }))}
              />
            </View>

            <View className="mb-8">
              <Text className="text-[12px] font-black text-slate-400 uppercase mb-3">
                Select Products
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {products.map((p) => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => toggleProduct(p)}
                    className={`px-4 py-2 rounded-full border ${
                      form.items.includes(p) ? 'bg-blue-500 border-blue-500' : 'border-slate-200'
                    }`}
                  >
                    <Text
                      className={`font-bold text-[12px] ${
                        form.items.includes(p) ? 'text-white' : 'text-slate-500'
                      }`}
                    >
                      {p}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={loading}
              className="bg-blue-600 h-16 rounded-2xl items-center justify-center shadow-xl shadow-blue-200 mb-10"
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-black uppercase tracking-widest">
                  Submit Reference
                </Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};
