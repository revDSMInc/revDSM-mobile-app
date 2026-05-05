import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  Platform,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import JobService, { JobEntry } from '../../../services/api/JobService';
import { format } from 'date-fns';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  job?: JobEntry | null;
}

const PAYMENT_METHODS = [
  { label: 'Check (0% Fee)', value: 'Check' },
  { label: 'MC/VISA/DSCVR (3.00% Fee)', value: 'Credit Card' },
  { label: 'AMEX (5.00% Fee)', value: 'AMEX' },
  { label: 'GreenSky Plans', value: 'GreenSky' },
];

export const AddEditJobModal = ({ visible, onClose, onSuccess, job }: Props) => {
  const { colors, isDark } = useTheme();

  const [formData, setFormData] = useState<Partial<JobEntry>>({
    jobNumber: '',
    customerName: '',
    salesPrice: 0,
    paymentMethod: 'Check',
    commission: 0,
    installDate: null,
    soldDate: format(new Date(), 'yyyy-MM-dd'),
    toBeDetermined: false,
    isManual: true,
  });

  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (job) {
      setFormData(job);
    } else {
      setFormData({
        jobNumber: '',
        customerName: '',
        salesPrice: 0,
        paymentMethod: 'Check',
        commission: 0,
        installDate: null,
        soldDate: format(new Date(), 'yyyy-MM-dd'),
        toBeDetermined: false,
        isManual: true,
      });
    }
  }, [job, visible]);

  const handleSave = async () => {
    setLoading(true);
    try {
      if (job?.id || job?._id) {
        await JobService.updateJob((job.id || job._id)!, formData);
      } else {
        await JobService.createJob(formData as JobEntry);
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Save Job Error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View
            className="flex-row items-center justify-between p-6"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Text className="text-white text-base font-semibold">
              {job ? 'Edit Job' : 'Add This Job to Job Tracker'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color="white" />
            </TouchableOpacity>
          </View>

          <ScrollView className="px-6 py-8" showsVerticalScrollIndicator={false}>
            <View style={styles.fieldWrap}>
              <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.floatingLabelText, { color: colors.textSecondary }]}>
                  Job Number
                </Text>
              </View>
              <View style={[styles.fieldBox, { borderColor: colors.border }]}>
                <TextInput
                  value={formData.jobNumber}
                  onChangeText={(t) => setFormData({ ...formData, jobNumber: t })}
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="e.g. 12345"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>

            <View style={styles.fieldWrap}>
              <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.floatingLabelText, { color: colors.textSecondary }]}>
                  Customer Name
                </Text>
              </View>
              <View style={[styles.fieldBox, { borderColor: colors.border }]}>
                <TextInput
                  value={formData.customerName}
                  onChangeText={(t) => setFormData({ ...formData, customerName: t })}
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="Full Name"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>

            <View style={styles.fieldWrap}>
              <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.floatingLabelText, { color: colors.textSecondary }]}>
                  Sales Price
                </Text>
              </View>
              <View style={[styles.fieldBox, { borderColor: colors.border }]}>
                <TextInput
                  value={formData.salesPrice === 0 ? '' : formData.salesPrice?.toString()}
                  keyboardType="numeric"
                  onChangeText={(t) => setFormData({ ...formData, salesPrice: parseFloat(t) || 0 })}
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="0.00"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>

            <View style={styles.fieldWrap}>
              <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.floatingLabelText, { color: colors.textSecondary }]}>
                  Select Payment Method
                </Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setShowPicker(!showPicker)}
                style={[styles.fieldBox, { borderColor: showPicker ? '#72BD00' : colors.border }]}
              >
                <Text style={[styles.fieldInput, { color: colors.text }]}>
                  {PAYMENT_METHODS.find((m) => m.value === formData.paymentMethod)?.label ||
                    'Select Method'}
                </Text>
                <Icon
                  name={showPicker ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>

              {showPicker && (
                <View
                  style={[
                    styles.pickerList,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <TouchableOpacity
                      key={method.value}
                      className="py-4 px-4"
                      style={{
                        backgroundColor:
                          formData.paymentMethod === method.value ? '#72BD0010' : 'transparent',
                      }}
                      onPress={() => {
                        setFormData({ ...formData, paymentMethod: method.value });
                        setShowPicker(false);
                      }}
                    >
                      <Text
                        style={{
                          color: formData.paymentMethod === method.value ? '#72BD00' : colors.text,
                          fontWeight: 'semibold',
                          fontSize: 13,
                        }}
                      >
                        {method.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.fieldWrap}>
              <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.floatingLabelText, { color: colors.textSecondary }]}>
                  Commission
                </Text>
              </View>
              <View style={[styles.fieldBox, { borderColor: colors.border }]}>
                <TextInput
                  value={formData.commission === 0 ? '' : formData.commission?.toString()}
                  keyboardType="numeric"
                  onChangeText={(t) => setFormData({ ...formData, commission: parseFloat(t) || 0 })}
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="0.00"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>

            <View className="relative">
              <View style={styles.fieldWrap}>
                <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                  <Text style={[styles.floatingLabelText, { color: colors.textSecondary }]}>
                    Install Date
                  </Text>
                </View>
                <View style={[styles.fieldBox, { borderColor: colors.border }]}>
                  <TextInput
                    value={formData.installDate || ''}
                    onChangeText={(t: string) => setFormData({ ...formData, installDate: t })}
                    editable={!formData.toBeDetermined}
                    style={[styles.fieldInput, { color: colors.text }]}
                    placeholder="MM/DD/YYYY"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <Icon name="calendar" size={20} color={colors.textSecondary} />
                </View>
              </View>
              <View className="flex-row items-center mb-6 px-1">
                <Switch
                  value={formData.toBeDetermined}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      toBeDetermined: v,
                      installDate: v ? null : formData.installDate,
                    })
                  }
                  trackColor={{ true: '#72BD00', false: '#F4F6F8' }}
                  thumbColor="#fff"
                  style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                />
                <Text
                  className="text-[12px] font-semibold uppercase ml-1 opacity-60"
                  style={{ color: colors.text }}
                >
                  TBD Install Date
                </Text>
              </View>
            </View>

            <View style={styles.fieldWrap}>
              <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.floatingLabelText, { color: colors.textSecondary }]}>
                  Date Sold
                </Text>
              </View>
              <View style={[styles.fieldBox, { borderColor: colors.border }]}>
                <TextInput
                  value={formData.soldDate}
                  onChangeText={(t: string) => setFormData({ ...formData, soldDate: t })}
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="MM/DD/YYYY"
                  placeholderTextColor={colors.textSecondary}
                />
                <Icon name="calendar" size={20} color={colors.textSecondary} />
              </View>
            </View>

            <View className="flex-row gap-4 mb-14 mt-4 justify-end">
              <TouchableOpacity
                onPress={onClose}
                className="px-6 py-2.5 items-center rounded-lg border"
                style={{ borderColor: colors.border }}
              >
                <Text style={{ color: colors.text, fontWeight: 'semibold', fontSize: 13 }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={loading}
                className="px-6 py-2.5 items-center rounded-lg bg-[#72BD00]"
              >
                <Text className="font-semibold text-white text-[13px]">
                  {loading ? '...' : job ? 'Update' : 'Submit'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  content: {
    borderRadius: 20,
    maxHeight: '85%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  fieldWrap: { marginBottom: 24, position: 'relative' },
  floatingLabel: {
    position: 'absolute',
    top: -8,
    left: 14,
    zIndex: 10,
    paddingHorizontal: 4,
  },
  floatingLabelText: { fontSize: 11, fontWeight: '600' },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#919EAB33',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldInput: { flex: 1, fontSize: 12, padding: 0, color: '#1C252E', fontWeight: '500' },
  pickerList: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    zIndex: 100,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(145, 158, 171, 0.24)',
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
    overflow: 'hidden',
  },
});
