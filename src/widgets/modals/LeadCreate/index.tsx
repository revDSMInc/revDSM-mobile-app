import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { GlobalKeyboardAvoidingView } from '../../common/keyboard/GlobalKeyboard';
import { CustomInput } from '../../controls/input/CustomInput';
import { CustomButton } from '../../controls/button/CustomButton';
import { FlashMessage } from '../../../config/message';
import { useCreateLeadMutation } from '../../../hooks/useLeadMutation';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  user: any;
}

export default function LeadCreateModal({ visible, onClose, onSuccess, user }: Props) {
  const { colors, isDark } = useTheme();
  const createLeadMutation = useCreateLeadMutation();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    address: '',
    leadType: 'selfGen',
    lfLeadTime: '9am',
    lfLeadId: '',
    leadCode: '',
    lfLeadDate: new Date().toISOString().split('T')[0],
  });

  const handleSubmit = async () => {
    if (!form.firstName || !form.lastName || !form.phone || !form.address) {
      FlashMessage.error('Missing Info', 'Please fill all required fields marked with *');
      return;
    }

    try {
      const payload =
        form.leadType === 'lf_lead'
          ? {
              leadType: 'lfLead',
              lfLeadTime: form.lfLeadTime,
              lfLeadId: form.lfLeadId,
              leadCode: form.leadCode,
              lfLeadDate: form.lfLeadDate,
              fullAddress: form.address,
              customer: {
                firstName: form.firstName,
                lastName: form.lastName,
                phone: form.phone,
                email: form.email,
                address: form.address,
              },
            }
          : {
              leadType: 'selfGen',
              repId: user?._id,
              fullAddress: form.address,
              customer: {
                firstName: form.firstName,
                lastName: form.lastName,
                phone: form.phone,
                email: form.email,
                address: form.address,
              },
            };

      await createLeadMutation.mutateAsync(payload);
      FlashMessage.success('Success', 'Lead created successfully');
      onSuccess();
      onClose();
    } catch (err: any) {
      FlashMessage.error('Error', err?.message || 'Failed to create lead');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <GlobalKeyboardAvoidingView
          isModal
          style={[styles.modalContainer, { backgroundColor: isDark ? colors.surface : '#fff' }]}
        >
          {/* Header */}
          <View
            className="p-6 flex-row justify-between items-center border-b"
            style={{ borderBottomColor: isDark ? colors.border : colors.grey[200] }}
          >
            <View>
              <Text className="text-xl font-black" style={{ color: colors.text }}>
                Add New Lead
              </Text>
              <Text
                className="text-[11px] font-bold mt-1 opacity-60"
                style={{ color: colors.textSecondary }}
              >
                Fill in the customer details below
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-2">
              <Text className="text-3xl font-light" style={{ color: colors.textSecondary }}>
                ×
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            className="px-6 py-6"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 80 }}
          >
            <View className="gap-5">
              <View className="flex-row gap-4">
                <View className="flex-1">
                  <CustomInput
                    label="First Name*"
                    value={form.firstName}
                    onChangeText={(t) => setForm({ ...form, firstName: t })}
                    placeholder="Jane"
                  />
                </View>
                <View className="flex-1">
                  <CustomInput
                    label="Last Name*"
                    value={form.lastName}
                    onChangeText={(t) => setForm({ ...form, lastName: t })}
                    placeholder="Doe"
                  />
                </View>
              </View>

              <CustomInput
                label="Phone Number*"
                value={form.phone}
                onChangeText={(t) => setForm({ ...form, phone: t })}
                placeholder="123-456-7890"
                keyboardType="phone-pad"
              />
              <CustomInput
                label="Email Address"
                value={form.email}
                onChangeText={(t) => setForm({ ...form, email: t })}
                placeholder="jane@example.com"
                keyboardType="email-address"
              />
              <CustomInput
                label="Full Address*"
                value={form.address}
                onChangeText={(t) => setForm({ ...form, address: t })}
                placeholder="123 Main St, City, State"
              />

              {/* Lead Type Toggle */}
              <View className="mt-4 mb-6">
                <Text
                  className="text-[10px] font-black tracking-widest uppercase mb-3 opacity-60"
                  style={{ color: colors.textSecondary }}
                >
                  Lead Classification
                </Text>
                <View
                  className="flex-row gap-3 p-1 rounded-2xl"
                  style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : colors.grey[200] }}
                >
                  {['selfGen', 'lf_lead'].map((type) => (
                    <TouchableOpacity
                      key={type}
                      onPress={() => setForm({ ...form, leadType: type })}
                      className={`flex-1 py-3 items-center rounded-xl border ${
                        form.leadType === type ? 'shadow-sm' : 'border-transparent'
                      }`}
                      style={{
                        backgroundColor:
                          form.leadType === type
                            ? isDark
                              ? colors.surface
                              : '#fff'
                            : 'transparent',
                        borderColor:
                          form.leadType === type ? `${colors.primary.main}25` : 'transparent',
                      }}
                    >
                      <Text
                        className="text-[11px] font-black"
                        style={{
                          color:
                            form.leadType === type ? colors.primary.main : colors.textSecondary,
                          opacity: form.leadType === type ? 1 : 0.4,
                        }}
                      >
                        {type === 'selfGen' ? 'SELF GEN' : 'LF LEAD'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {form.leadType === 'lf_lead' && (
                <View
                  className="p-5 rounded-[24px] border mb-6 shadow-sm"
                  style={{
                    backgroundColor: isDark ? colors.surface : '#fff',
                    borderColor: isDark ? colors.border : colors.grey[200],
                  }}
                >
                  <View className="flex-row items-center mb-4">
                    <View
                      className="w-1.5 h-6 rounded-full mr-3"
                      style={{ backgroundColor: colors.primary.main }}
                    />
                    <Text
                      className="text-[10px] font-black tracking-widest uppercase"
                      style={{ color: colors.primary.main }}
                    >
                      Lead Force Synchronization
                    </Text>
                  </View>

                  <CustomInput
                    label="Lead ID*"
                    value={form.lfLeadId}
                    onChangeText={(t) => setForm({ ...form, lfLeadId: t })}
                    placeholder="Enter ID"
                  />
                  <CustomInput
                    label="Lead Code*"
                    value={form.leadCode}
                    onChangeText={(t) => setForm({ ...form, leadCode: t })}
                    placeholder="Enter Code"
                  />

                  <View className="mt-4">
                    <Text
                      className="text-[11px] font-bold mb-3"
                      style={{ color: colors.textSecondary }}
                    >
                      Preferred Time Slot*
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingRight: 16 }}
                    >
                      {['9am', '11am', '1pm', '3pm', '5pm', '7pm', '9pm'].map((time) => (
                        <TouchableOpacity
                          key={time}
                          onPress={() => setForm({ ...form, lfLeadTime: time })}
                          className="px-5 py-2.5 rounded-xl mr-3 border"
                          style={{
                            backgroundColor:
                              form.lfLeadTime === time
                                ? `${colors.primary.main}15`
                                : isDark
                                ? 'rgba(255,255,255,0.05)'
                                : colors.grey[200],
                            borderColor:
                              form.lfLeadTime === time ? colors.primary.main : 'transparent',
                          }}
                        >
                          <Text
                            className="text-[10px] font-black"
                            style={{
                              color:
                                form.lfLeadTime === time
                                  ? colors.primary.main
                                  : colors.textSecondary,
                              opacity: form.lfLeadTime === time ? 1 : 0.4,
                            }}
                          >
                            {time.toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>

                  <View className="mt-5">
                    <CustomInput
                      label="Appointment Date*"
                      value={form.lfLeadDate}
                      onChangeText={(t) => setForm({ ...form, lfLeadDate: t })}
                      placeholder="YYYY-MM-DD"
                    />
                  </View>
                </View>
              )}

              <CustomButton
                title="Save & Submit Lead"
                onPress={handleSubmit}
                loading={createLeadMutation.isPending}
                style={{ marginTop: 12, marginBottom: 40 }}
              />
            </View>
          </ScrollView>
        </GlobalKeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: '90%',
    overflow: 'hidden',
  },
});
