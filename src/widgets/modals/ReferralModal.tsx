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
  isMyJob?: boolean;
}

export const ReferralModal = ({ visible, onClose, selectedJob, isMyJob }: ReferralModalProps) => {
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
      Alert.alert('Error', 'Failed to submit referral');
    } finally {
      setLoading(false);
    }
  };

  const FormField = ({ label, icon, children }: any) => (
    <View className="mb-4">
      <View className="flex-row items-center mb-2">
        <View className="w-6 h-6 rounded-md bg-green-50 items-center justify-center mr-2">
          <Icon name={icon} size={14} color="#4CBB17" />
        </View>
        <Text className="text-[11px] font-black text-slate-400  tracking-widest">{label}</Text>
      </View>
      <View className="bg-slate-50 rounded-2xl border border-slate-100 p-4">{children}</View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 justify-end bg-black/60">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="bg-white rounded-t-[40px] h-[85%]"
        >
           {/* Header */}
          <View className="p-4 border-b border-slate-50 flex-row justify-between items-center">
            <View>
              <Text className="text-[17px] font-black text-slate-800">
                {isMyJob ? 'Referral Management' : 'View Referrals'}
              </Text>
              <Text className="text-[11px] font-bold text-slate-400">
                Job #{selectedJob?.jobNumber}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-1.5 bg-slate-50 rounded-full">
              <Icon name="close" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

           <ScrollView className="p-4" showsVerticalScrollIndicator={false}>
            {/* Existing Referrals Section */}
            {selectedJob?.jobReferrals?.length > 0 && (
              <View className="mb-6">
                <Text className="text-[11px] font-black text-slate-400 tracking-widest mb-3 uppercase">
                  Existing Referrals ({selectedJob.jobReferrals.length})
                </Text>
                {selectedJob.jobReferrals.map((ref: any, idx: number) => (
                  <View key={idx} className="bg-slate-50 rounded-2xl p-4 border border-slate-100 mb-3">
                    <View className="flex-row justify-between items-start mb-2">
                      <View>
                        <Text className="text-sm font-black text-slate-800">{ref.firstName}</Text>
                        <Text className="text-[11px] font-bold text-slate-400">{ref.phoneNumber}</Text>
                      </View>
                      <View className="bg-green-100 px-2 py-0.5 rounded-md">
                        <Text className="text-[9px] font-black text-green-700 uppercase">{ref.preferredContactMethod}</Text>
                      </View>
                    </View>
                    {ref.notes && (
                      <Text className="text-[11px] text-slate-500 italic mt-1 bg-white/50 p-2 rounded-lg">
                        "{ref.notes}"
                      </Text>
                    )}
                    {ref.items?.length > 0 && (
                      <View className="flex-row flex-wrap gap-1 mt-2">
                        {ref.items.map((item: string, i: number) => (
                          <View key={i} className="bg-slate-200 px-2 py-0.5 rounded-md">
                            <Text className="text-[8px] font-bold text-slate-600">{item}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Creation Form - Only for Owner */}
            {isMyJob ? (
              <>
                <View className="h-[1px] bg-slate-100 mb-6" />
                <Text className="text-[11px] font-black text-slate-400 tracking-widest mb-4 uppercase">
                  Add New Referral
                </Text>
                
                <FormField label="Full Name" icon="account-outline">
                  <TextInput
                    placeholder="Enter customer name"
                    className="font-bold text-slate-700 p-0 text-[13px]"
                    value={form.firstName}
                    onChangeText={(t) => setForm((f) => ({ ...f, firstName: t }))}
                  />
                </FormField>

                <FormField label="Phone Number" icon="phone-outline">
                  <TextInput
                    placeholder="Enter phone number"
                    keyboardType="phone-pad"
                    className="font-bold text-slate-700 p-0 text-[13px]"
                    value={form.phoneNumber}
                    onChangeText={(t) => setForm((f) => ({ ...f, phoneNumber: t }))}
                  />
                </FormField>

                <View className="flex-row gap-4">
                  <View className="flex-1">
                    <FormField label="Method" icon="message-outline">
                      <View className="flex-row gap-4">
                        {['call', 'text'].map((m) => (
                          <TouchableOpacity
                            key={m}
                            onPress={() => setForm((f) => ({ ...f, preferredContactMethod: m }))}
                            className="flex-row items-center"
                          >
                            <View
                              className={`w-4 h-4 rounded-full border-2 items-center justify-center ${
                                form.preferredContactMethod === m
                                  ? 'border-green-500'
                                  : 'border-slate-300'
                              }`}
                            >
                              {form.preferredContactMethod === m && (
                                <View className="w-2 h-2 rounded-full bg-green-500" />
                              )}
                            </View>
                            <Text
                              className={`ml-2 text-[12px] font-bold capitalize ${
                                form.preferredContactMethod === m ? 'text-slate-800' : 'text-slate-400'
                              }`}
                            >
                              {m}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </FormField>
                  </View>
                  <View className="flex-1">
                    <FormField label="Zip Code" icon="map-marker-outline">
                      <TextInput
                        placeholder="Zip"
                        className="font-bold text-slate-700 p-0"
                        value={form.zipCode}
                        onChangeText={(t) => setForm((f) => ({ ...f, zipCode: t }))}
                      />
                    </FormField>
                  </View>
                </View>

                <FormField label="Notes" icon="text-box-outline">
                  <TextInput
                    placeholder="Any special instructions..."
                    multiline
                    numberOfLines={3}
                    className="font-bold text-slate-700 p-0"
                    value={form.note}
                    onChangeText={(t) => setForm((f) => ({ ...f, note: t }))}
                  />
                </FormField>

                <View className="mb-10">
                  <Text className="text-[11px] font-black text-slate-400  tracking-widest mb-3">
                    Products Interested
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {products.map((p) => (
                      <TouchableOpacity
                        key={p}
                        onPress={() => toggleProduct(p)}
                        className={`px-4 py-2 rounded-xl border ${
                          form.items.includes(p)
                            ? 'bg-green-600 border-green-600'
                            : 'bg-slate-50 border-slate-100'
                        }`}
                      >
                        <Text
                          className={`font-black text-[11px]  tracking-wider ${
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
                  className="bg-green-600 h-12 rounded-xl items-center justify-center shadow-lg shadow-green-100 mb-10"
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-black tracking-widest text-base">
                      Submit Referral
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <View className="py-10 items-center justify-center">
                <Icon name="lock-outline" size={48} color="#94a3b8" />
                <Text className="text-slate-400 mt-2 text-center font-bold">
                  Read-only Access{'\n'}
                  <Text className="font-normal text-xs">You can only view referrals for jobs assigned to other reps.</Text>
                </Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};
