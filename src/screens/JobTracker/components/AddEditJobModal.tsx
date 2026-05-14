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
import { format, parseISO } from 'date-fns';
import { CustomDatePicker } from './CustomDatePicker';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  job?: JobEntry | null;
}

const PAYMENT_GROUPS = [
  {
    title: 'Basic Options',
    options: [
      { label: 'Check (0% Fee)', value: 'check' },
      { label: 'MC/VISA/DSCVR (3.00% Fee)', value: 'mcVisaDscvr' },
      { label: 'AMEX (5.00% Fee)', value: 'amex' },
    ],
  },
  {
    title: 'GreenSky Plans',
    options: [
      { label: '2511 (6 Months 0% Interest)', value: 'greensky2511' },
      { label: '2521 (12 Months 0% Interest)', value: 'greensky2521' },
      { label: '2531 (18 Months 0% Interest)', value: 'greensky2531' },
      { label: '1599 (Fixed Rate 9.99% APR)', value: 'greensky1599' },
    ],
  },
  {
    title: 'Wells Fargo Plans',
    options: [
      { label: '1148 (6 Months no interest)', value: 'wf1148' },
      { label: '1019 (12 Months no interest)', value: 'wf1019' },
      { label: '1157 (6.9% APR, 1/50th)', value: 'wf1157' },
      { label: '1197 (9.99% APR, 3.5% payment)', value: 'wf1197' },
      { label: '2225 (12.9% APR, 1/50th)', value: 'wf2225' },
      { label: '3198 (5.99% APR, 60 payments)', value: 'wf3198' },
      { label: '1529 (8.99% APR, 84 payments)', value: 'wf1529' },
      { label: '4073 (18 Months, 0% interest)', value: 'wf4073' },
      { label: '4079 (24 Months, 0% interest)', value: 'wf4079' },
      { label: '4091 (36 Months, 0% interest)', value: 'wf4091' },
      { label: '4103 (48 Months, 0% interest)', value: 'wf4103' },
      { label: '4115 (60 Months, 0% interest)', value: 'wf4115' },
    ],
  },
  {
    title: 'Wells Fargo Plans (Jobs over $7,500)',
    options: [
      { label: '3672 (7.99% APR, 96 payments)', value: 'wf3672' },
      { label: '3667 (7.99% APR, 108 payments)', value: 'wf3667' },
      { label: '3668 (7.99% APR, 120 payments)', value: 'wf3668' },
      { label: '3669 (9.99% APR, 96 payments)', value: 'wf3669' },
      { label: '3670 (9.99% APR, 108 payments)', value: 'wf3670' },
      { label: '3671 (9.99% APR, 120 payments)', value: 'wf3671' },
    ],
  },
  {
    title: 'Concora Credit',
    options: [{ label: 'Concora (19.9% APR)', value: 'concora' }],
  },
];

const ALL_PAYMENT_METHODS = PAYMENT_GROUPS.flatMap((g) => g.options);

export const AddEditJobModal = ({ visible, onClose, onSuccess, job }: Props) => {
  const { colors, isDark } = useTheme();

  const [formData, setFormData] = useState<Partial<JobEntry>>({
    jobNumber: '',
    customerName: '',
    title: '',
    salesPrice: 0,
    paymentMethod: 'check',
    commission: 0,
    installDate: null,
    soldDate: format(new Date(), 'yyyy-MM-dd'),
    toBeDetermined: false,
    isManual: false,
    appointmentId: '',
    calculatorId: '',
  });

  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    if (job) {
      setFormData({
        ...formData,
        ...job,
        jobNumber: job.jobNumber || '',
        customerName: job.customerName || '',
        title: job.title || '',
        salesPrice: job.salesPrice || 0,
        paymentMethod: job.paymentMethod || 'check',
        commission: job.commission || 0,
        installDate: job.installDate || null,
        soldDate: job.soldDate || format(new Date(), 'yyyy-MM-dd'),
        toBeDetermined: job.toBeDetermined ?? false,
        isManual: job.isManual ?? false,
        appointmentId: job.appointmentId || '',
        calculatorId: job.calculatorId || '',
      });
    }
  }, [job, visible]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const payload = {
        jobNumber: formData.jobNumber?.trim() || '',
        customerName: formData.customerName?.trim() || '',
        title: formData.title || '',
        salesPrice: formData.salesPrice || 0,
        paymentMethod: formData.paymentMethod || 'check',
        installDate: formData.toBeDetermined
          ? null
          : formData.installDate
          ? new Date(formData.installDate).toISOString()
          : null,
        soldDate: formData.soldDate
          ? new Date(formData.soldDate).toISOString()
          : new Date().toISOString(),
        toBeDetermined: formData.toBeDetermined || false,
        commission: formData.commission || 0,
        appointmentId: formData.appointmentId || '',
        calculatorId: formData.calculatorId || '',
        isManual: formData.isManual || false,
      };

      if (job?.id || job?._id) {
        await JobService.updateJob((job.id || job._id)!, payload);
      } else {
        await JobService.createJob(payload as JobEntry);
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
          <ScrollView className="px-8 py-8" showsVerticalScrollIndicator={false}>
            <Text className="text-[22px] font-black text-[#1C252E] mb-10 mt-2">
              Add This Job to Job Tracker
            </Text>

            {/* Job Number */}
            <View style={styles.fieldWrap}>
              <View style={[styles.fieldBox, { borderColor: colors.border }]}>
                <TextInput
                  value={formData.jobNumber}
                  onChangeText={(t) => setFormData({ ...formData, jobNumber: t })}
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="Job Number"
                  placeholderTextColor="#919EAB"
                />
              </View>
            </View>

            {/* Sales Price */}
            <View style={styles.fieldWrap}>
              <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.floatingLabelText, { color: '#919EAB' }]}>Sales Price</Text>
              </View>
              <View style={[styles.fieldBox, { borderColor: colors.border }]}>
                <TextInput
                  value={formData.salesPrice === 0 ? '' : formData.salesPrice?.toString()}
                  keyboardType="numeric"
                  onChangeText={(t) => setFormData({ ...formData, salesPrice: parseFloat(t) || 0 })}
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="0"
                  placeholderTextColor="#919EAB"
                />
              </View>
            </View>

            {/* Payment Method */}
            <View style={styles.fieldWrap}>
              <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.floatingLabelText, { color: '#919EAB' }]}>
                  Select Payment Method
                </Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setShowPicker(!showPicker)}
                style={[styles.fieldBox, { borderColor: showPicker ? '#4CBB17' : colors.border }]}
              >
                <Text style={[styles.fieldInput, { color: colors.text }]}>
                  {ALL_PAYMENT_METHODS.find((m) => m.value === formData.paymentMethod)?.label ||
                    'Select Method'}
                </Text>
                <Icon name={showPicker ? 'chevron-up' : 'chevron-down'} size={20} color="#919EAB" />
              </TouchableOpacity>

              {showPicker && (
                <View
                  style={[
                    styles.pickerList,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={true}>
                    {PAYMENT_GROUPS.map((group) => (
                      <View key={group.title}>
                        <View
                          style={[
                            styles.pickerHeader,
                            { backgroundColor: isDark ? '#1a1a1a' : '#f8f9fa' },
                          ]}
                        >
                          <Text style={[styles.pickerHeaderText, { color: '#919EAB' }]}>
                            {group.title}
                          </Text>
                        </View>
                        {group.options.map((method) => (
                          <TouchableOpacity
                            key={method.value}
                            className="py-4 px-4"
                            style={{
                              backgroundColor:
                                formData.paymentMethod === method.value
                                  ? '#4CBB1710'
                                  : 'transparent',
                            }}
                            onPress={() => {
                              setFormData({ ...formData, paymentMethod: method.value });
                              setShowPicker(false);
                            }}
                          >
                            <Text
                              style={{
                                color:
                                  formData.paymentMethod === method.value ? '#4CBB17' : colors.text,
                                fontWeight: '600',
                                fontSize: 13,
                              }}
                            >
                              {method.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            {/* Install Date */}
            <View style={styles.fieldWrap}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  if (!formData.toBeDetermined) {
                    setShowDatePicker(true);
                  }
                }}
                style={[
                  styles.fieldBox,
                  { borderColor: colors.border, opacity: formData.toBeDetermined ? 0.5 : 1 },
                ]}
              >
                <TextInput
                  value={
                    formData.installDate ? format(parseISO(formData.installDate), 'MM/dd/yyyy') : ''
                  }
                  editable={false}
                  pointerEvents="none"
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="Install Date"
                  placeholderTextColor="#919EAB"
                />
              </TouchableOpacity>
            </View>

            {/* TBD Install Date */}
            <View className="flex-row items-center mb-10 px-1">
              <Switch
                value={formData.toBeDetermined}
                onValueChange={(v) =>
                  setFormData({
                    ...formData,
                    toBeDetermined: v,
                    installDate: v ? null : formData.installDate,
                  })
                }
                trackColor={{ true: '#4CBB17', false: '#F4F6F8' }}
                thumbColor="#fff"
                style={{ transform: [{ scaleX: 1.1 }, { scaleY: 1.1 }] }}
              />
              <Text className="text-[14px] font-black ml-3" style={{ color: '#1C252E' }}>
                TBD Install Date
              </Text>
            </View>

            {/* Action Buttons */}
            <View className="flex-row gap-3 mb-10 justify-end items-center">
              <TouchableOpacity
                onPress={onClose}
                className="flex-1 h-12 items-center justify-center rounded-xl border-2 border-[#919EAB33]"
              >
                <Text style={{ color: '#1C252E', fontWeight: 'bold', fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={loading}
                className="flex-[1.5] h-12 items-center justify-center rounded-xl bg-[#4CBB17] shadow-lg shadow-green-600/20"
              >
                <Text className="font-bold text-white text-[15px]">
                  {loading ? '...' : job ? 'Update' : 'Add to Job Tracker'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>

      <CustomDatePicker
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        initialDate={formData.installDate || undefined}
        onSelect={(date) => {
          setFormData({ ...formData, installDate: date });
        }}
      />
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
  floatingLabelText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  placeholderContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 14,
    justifyContent: 'center',
    zIndex: 1,
  },
  placeholderText: {
    color: '#919EAB',
    fontSize: 14,
    fontWeight: '500',
  },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#919EAB33',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 16 : 14,
    minHeight: 56,
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
  pickerHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(145, 158, 171, 0.12)',
  },
  pickerHeaderText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
