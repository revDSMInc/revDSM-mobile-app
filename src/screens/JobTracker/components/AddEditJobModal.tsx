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
import { format, parseISO, isValid } from 'date-fns';
import { parseSafeISO } from '../../../utils/date-util';
import { CustomDatePicker } from './CustomDatePicker';
import { calculateCommission } from '../../../utils/calculator/commission-utils';
import { paymentPlans } from '../../../utils/calculator/payment-plans';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  job?: JobEntry | null;
  isLowesLead?: boolean;
}

const basicKeys = ['check', 'mcVisaDscvr', 'amex'];
const basicOptions = basicKeys.map((k) => ({
  label: paymentPlans[k]?.label || k,
  value: k,
}));

const greenskyOptions = Object.keys(paymentPlans)
  .filter((k) => k.startsWith('greensky'))
  .map((k) => ({ label: paymentPlans[k]?.label || k, value: k }));

const wfNormalOptions = Object.keys(paymentPlans)
  .filter((k) => k.startsWith('wf') && !k.startsWith('wf36'))
  .map((k) => ({ label: paymentPlans[k]?.label || k, value: k }));

const wfOver7500Options = Object.keys(paymentPlans)
  .filter((k) => k.startsWith('wf36'))
  .map((k) => ({ label: paymentPlans[k]?.label || k, value: k }));

const concoraOptions = Object.keys(paymentPlans)
  .filter((k) => k === 'concora')
  .map((k) => ({ label: paymentPlans[k]?.label || k, value: k }));

const lowesOptions = Object.keys(paymentPlans)
  .filter((k) => k.startsWith('lowes_'))
  .map((k) => ({ label: paymentPlans[k]?.label || k, value: k }));

export const AddEditJobModal = ({ visible, onClose, onSuccess, job, isLowesLead = false }: Props) => {
  const { colors, isDark } = useTheme();

  // Dynamically group payment methods based on isLowesLead, matching rollout summary
  const PAYMENT_GROUPS = isLowesLead
    ? [
        {
          title: "Lowe's Plans",
          bg: '#e6f7ff',
          options: lowesOptions,
        },
      ]
    : [
        {
          title: 'Basic Options',
          bg: '#F8FAFC',
          options: basicOptions,
        },
        {
          title: 'GreenSky Plans',
          bg: '#d9ead3',
          options: greenskyOptions,
        },
        {
          title: 'Wells Fargo Plans',
          bg: '#f4cccc',
          options: wfNormalOptions,
        },
        {
          title: 'Wells Fargo Plans (Jobs over $7,500)',
          bg: '#f4cccc',
          options: wfOver7500Options,
        },
        {
          title: 'Concora Credit',
          bg: '#c9daf8',
          options: concoraOptions,
        },
      ].filter((g) => g.options.length > 0);

  const ALL_PAYMENT_METHODS = PAYMENT_GROUPS.flatMap((g) => g.options);

  const [formData, setFormData] = useState<Partial<JobEntry>>({
    jobNumber: '',
    customerName: '',
    title: '',
    salesPrice: 0,
    paymentMethod: 'check',
    commission: 0,
    installDate: null,
    soldDate: '',
    toBeDetermined: false,
    isManual: false,
    appointmentId: '',
    calculatorId: '',
  });

  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerType, setDatePickerType] = useState<'install' | 'sold'>('install');

  // Auto-calculate commission whenever salesPrice or paymentMethod changes
  useEffect(() => {
    // Only auto-calculate commission for calculator-originated jobs (non-manual)
    if (!formData.isManual && formData.salesPrice !== undefined && formData.paymentMethod) {
      const comm = calculateCommission(formData.salesPrice, formData.paymentMethod);
      setFormData(prev => ({
        ...prev,
        commission: Math.round(comm.amount * 100) / 100
      }));
    }
  }, [formData.salesPrice, formData.paymentMethod, formData.isManual]);

  useEffect(() => {
    if (visible) {
      if (job && (job.id || job._id)) {
        // Edit mode - load existing data
        setFormData({
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
      } else {
        // New job mode - "nothing pre-added" rule
        setFormData({
          jobNumber: '',
          customerName: job?.customerName || '',
          title: job?.title || '',
          salesPrice: 0,
          paymentMethod: job?.paymentMethod || 'check',
          commission: 0,
          installDate: null,
          soldDate: '',
          toBeDetermined: false,
          isManual: job?.isManual ?? false,
          appointmentId: job?.appointmentId || '',
          calculatorId: job?.calculatorId || '',
        });
      }
    }
  }, [job, visible]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const payload: any = {
        jobNumber: formData.jobNumber?.trim() || '',
        customerName: formData.customerName?.trim() || '',
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
        isManual: formData.isManual || false,
      };

      if (formData.title) payload.title = formData.title;
      if (formData.appointmentId) payload.appointmentId = formData.appointmentId;
      if (formData.calculatorId) payload.calculatorId = formData.calculatorId;

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
            <Text className="text-lg font-black text-[#1C252E] mb-6 mt-2">
              {job?.id || job?._id ? 'Edit Job' : 'Add This Job to Job Tracker'}
            </Text>

            {/* Job Number */}
            <View style={styles.fieldWrap}>
              <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.floatingLabelText, { color: !formData.jobNumber ? '#EF4444' : '#919EAB' }]}>
                  Job Number {!formData.jobNumber && '*'}
                </Text>
              </View>
              <View style={[styles.fieldBox, { borderColor: !formData.jobNumber ? '#EF4444' : colors.border }]}>
                <TextInput
                  value={formData.jobNumber}
                  onChangeText={(t) => setFormData({ ...formData, jobNumber: t })}
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="Job Number"
                  placeholderTextColor="#919EAB"
                />
              </View>
            </View>

            {/* Customer Name (Manual Entry only) */}
            {formData.isManual && (
              <View style={styles.fieldWrap}>
                <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                  <Text style={[styles.floatingLabelText, { color: !formData.customerName ? '#EF4444' : '#919EAB' }]}>
                    Customer Name {!formData.customerName && '*'}
                  </Text>
                </View>
                <View style={[styles.fieldBox, { borderColor: !formData.customerName ? '#EF4444' : colors.border }]}>
                  <TextInput
                    value={formData.customerName}
                    onChangeText={(t) => setFormData({ ...formData, customerName: t })}
                    style={[styles.fieldInput, { color: colors.text }]}
                    placeholder="Customer Name"
                    placeholderTextColor="#919EAB"
                  />
                </View>
              </View>
            )}

            {/* Sales Price */}
            <View style={styles.fieldWrap}>
              <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.floatingLabelText, { color: !formData.salesPrice ? '#EF4444' : '#919EAB' }]}>
                  Sales Price {!formData.salesPrice && '*'}
                </Text>
              </View>
              <View style={[styles.fieldBox, { borderColor: !formData.salesPrice ? '#EF4444' : colors.border }]}>
                <TextInput
                  value={formData.salesPrice === 0 ? '0' : formData.salesPrice?.toString()}
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
                <Modal visible={showPicker} transparent animationType="fade">
                  <View style={styles.overlay}>
                    <View className="bg-white rounded-[32px] overflow-hidden max-h-[80%] shadow-2xl">
                      <View className="p-6 border-b border-slate-100 flex-row justify-between items-center bg-slate-50">
                        <Text className="text-lg font-black text-slate-900">Select Payment Method</Text>
                        <TouchableOpacity onPress={() => setShowPicker(false)} className="p-2">
                          <Icon name="close" size={24} color="#637381" />
                        </TouchableOpacity>
                      </View>
                      <ScrollView className="p-4" showsVerticalScrollIndicator={false}>
                        {PAYMENT_GROUPS.map((group) => (
                          <View key={group.title} className="mb-4">
                            <View className="px-4 py-2 mb-2 rounded-lg" style={{ backgroundColor: group.bg }}>
                              <Text className="text-[10px] font-black tracking-widest text-slate-900">
                                {group.title}
                              </Text>
                            </View>
                            {group.options.map((method) => (
                              <TouchableOpacity
                                key={method.value}
                                className="px-4 py-3.5 mb-2 rounded-xl border border-slate-200"
                                style={{
                                  backgroundColor:
                                    formData.paymentMethod === method.value
                                      ? '#4CBB1710'
                                      : 'white',
                                  borderColor:
                                    formData.paymentMethod === method.value
                                      ? '#4CBB17'
                                      : 'rgba(145,158,171,0.24)',
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
                  </View>
                </Modal>
              )}
            </View>

            {/* Commission (Manual only) */}
            {formData.isManual && (
              <View style={styles.fieldWrap}>
                <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                  <Text style={[styles.floatingLabelText, { color: '#919EAB' }]}>Commission</Text>
                </View>
                <View style={[styles.fieldBox, { borderColor: colors.border }]}>
                  <TextInput
                    value={formData.commission?.toString() || '0'}
                    keyboardType="numeric"
                    onChangeText={(t) => setFormData({ ...formData, commission: parseFloat(t) || 0 })}
                    style={[styles.fieldInput, { color: colors.text }]}
                    placeholder="0"
                    placeholderTextColor="#919EAB"
                  />
                </View>
              </View>
            )}

            {/* Install Date */}
            <View style={styles.fieldWrap}>
              <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.floatingLabelText, { color: (!formData.toBeDetermined && !formData.installDate) ? '#EF4444' : '#919EAB' }]}>
                  Install Date {!formData.toBeDetermined && !formData.installDate && '*'}
                </Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  if (!formData.toBeDetermined) {
                    setDatePickerType('install');
                    setShowDatePicker(true);
                  }
                }}
                style={[
                  styles.fieldBox,
                  {
                    borderColor: (!formData.toBeDetermined && !formData.installDate) ? '#EF4444' : colors.border,
                    opacity: formData.toBeDetermined ? 0.5 : 1
                  },
                ]}
              >
                <TextInput
                  value={
                    formData.installDate ? format(parseSafeISO(formData.installDate), 'MM/dd/yyyy') : ''
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
              <TouchableOpacity
                onPress={() =>
                  setFormData((prev) => ({
                    ...prev,
                    toBeDetermined: !prev.toBeDetermined,
                    installDate: !prev.toBeDetermined ? null : prev.installDate,
                  }))
                }
                className={`w-7 h-4 rounded-full justify-center px-0.5 ${
                  formData.toBeDetermined ? 'bg-green-500 items-end' : 'bg-slate-300 items-start'
                }`}
              >
                <View className="w-3 h-3 bg-white rounded-full" />
              </TouchableOpacity>
              <Text className="text-[14px] font-black ml-3" style={{ color: '#1C252E' }}>
                TBD Install Date
              </Text>
            </View>

            {/* Date Sold (Manual only) */}
            {formData.isManual && (
              <View style={styles.fieldWrap}>
                <View style={[styles.floatingLabel, { backgroundColor: colors.card }]}>
                  <Text style={[styles.floatingLabelText, { color: !formData.soldDate ? '#EF4444' : '#919EAB' }]}>
                    Date Sold {!formData.soldDate && '*'}
                  </Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    setDatePickerType('sold');
                    setShowDatePicker(true);
                  }}
                  style={[styles.fieldBox, { borderColor: !formData.soldDate ? '#EF4444' : colors.border }]}
                >
                  <TextInput
                    value={
                      formData.soldDate ? format(parseSafeISO(formData.soldDate), 'MM/dd/yyyy') : ''
                    }
                    editable={false}
                    pointerEvents="none"
                    style={[styles.fieldInput, { color: colors.text }]}
                    placeholder="Date Sold"
                    placeholderTextColor="#919EAB"
                  />
                </TouchableOpacity>
              </View>
            )}

            {/* Action Buttons */}
            <View className="flex-row gap-3 justify-end items-center">
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
                  {loading
                    ? '...'
                    : job?.id || job?._id
                      ? 'Update Job'
                      : 'Add to Job Tracker'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>

      <CustomDatePicker
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        initialDate={
          datePickerType === 'install'
            ? formData.installDate || undefined
            : formData.soldDate || undefined
        }
        onSelect={(date) => {
          if (datePickerType === 'install') {
            setFormData({ ...formData, installDate: date });
          } else {
            setFormData({ ...formData, soldDate: date });
          }
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
