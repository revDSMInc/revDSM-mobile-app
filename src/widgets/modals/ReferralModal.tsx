import React, { useState, useEffect } from 'react';
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
  Switch,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { LeadService } from '../../services/api/leads';
import { useAuth } from '../../hooks/useAuth';

interface ReferralModalProps {
  visible: boolean;
  onClose: () => void;
  selectedJob: any;
  isMyJob?: boolean;
  onSuccess?: () => void;
}

const InputField = ({ label, value, onChangeText, onPress, placeholder, keyboardType = 'default', multiline = false, dropdown = false, required = false, isDark, editable = true }: any) => (
  <View className="mb-5 relative">
    <View className="absolute -top-2.5 left-3 bg-white px-1 z-10">
      <Text className="text-[11px] font-bold text-slate-400">
        {label}{required && <Text className="text-red-500">*</Text>}
      </Text>
    </View>
    <TouchableOpacity 
      activeOpacity={dropdown ? 0.7 : 1}
      onPress={onPress}
      className={`flex-row items-center border border-slate-200 rounded-xl px-4 ${multiline ? 'py-2' : 'h-[52px]'}`}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        keyboardType={keyboardType}
        multiline={multiline}
        editable={!dropdown && editable}
        pointerEvents={dropdown ? 'none' : 'auto'}
        className={`flex-1 font-bold text-[13px] ${isDark ? 'text-white' : 'text-slate-700'}`}
        style={{ textAlignVertical: multiline ? 'top' : 'center' }}
      />
      {dropdown && <Icon name="chevron-down" size={20} color="#94a3b8" />}
    </TouchableOpacity>
  </View>
);

const Checkbox = ({ label, checked, onPress }: any) => (
  <TouchableOpacity 
    onPress={onPress}
    className="flex-row items-center w-[48%] mb-3"
    activeOpacity={0.7}
  >
    <View className={`w-5 h-5 rounded border items-center justify-center ${checked ? 'bg-[#4CBB17] border-[#4CBB17]' : 'bg-white border-slate-300'}`}>
      {checked && <Icon name="check" size={14} color="white" />}
    </View>
    <Text className="ml-3 text-[13px] font-bold text-slate-700 dark:text-zinc-300">{label}</Text>
  </TouchableOpacity>
);

export const ReferralModal = ({ visible, onClose, selectedJob, isMyJob, onSuccess }: ReferralModalProps) => {

  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  
  // Mode detection
  const existingReferral = selectedJob?.jobReferrals?.[0];
  const mode = !existingReferral ? 'ADD' : isMyJob ? 'EDIT' : 'VIEW';

  const [form, setForm] = useState({
    firstName: '',
    phoneNumber: '',
    preferredContactMethod: 'call',
    bestTimeToContact: 'morning',
    zipCode: '',
    note: '',
    items: [] as string[],
    referralToggle: false,
  });

  const [showMethodDropdown, setShowMethodDropdown] = useState(false);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);

  const products = ['Fascia Wrap', 'Soffit', 'Gutter', 'Leaf Filter'];
  const contactMethods = [
    { label: 'Phone Call', value: 'call' },
    { label: 'SMS / Text', value: 'text' },
    { label: 'Email', value: 'email' },
  ];

  const timeOptions = [
    { label: 'Morning', value: 'morning' },
    { label: 'Afternoon', value: 'afternoon' },
    { label: 'Evening', value: 'evening' },
  ];

  useEffect(() => {
    if (visible && existingReferral) {
      setForm({
        firstName: existingReferral.firstName || '',
        phoneNumber: existingReferral.phoneNumber || '',
        preferredContactMethod: existingReferral.preferredContactMethod || 'call',
        bestTimeToContact: existingReferral.bestTimeToContact || 'morning',
        zipCode: existingReferral.zipCode || '',
        note: existingReferral.notes || '',
        items: existingReferral.items || [],
        referralToggle: existingReferral.referralToggle || false,
      });
    }
  }, [visible, existingReferral]);

  const toggleProduct = (product: string) => {
    if (mode === 'VIEW') return;
    setForm((prev) => ({
      ...prev,
      items: prev.items.includes(product)
        ? prev.items.filter((i) => i !== product)
        : [...prev.items, product],
    }));
  };

  const handleSubmit = async () => {
    if (mode === 'VIEW') return;
    
    setLoading(true);
    try {
      const payload: any = {
        companyId: selectedJob?.companyId,
        repName: selectedJob?.userName,
        firstName: form.firstName,
        phoneNumber: form.phoneNumber,
        preferredContactMethod: form.preferredContactMethod,
        bestTimeToContact: form.bestTimeToContact,
        notes: form.note,
        zipCode: form.zipCode,
        items: form.items,
        referralToggle: form.referralToggle,
      };

      if (mode === 'ADD') {
        payload.jobId = selectedJob?.jobNumber;
      }

      const activityPayload = {
        user_id: user?._id || user?.id,
        action_type: mode === 'ADD' ? 'create' : 'update',
        module_type: 'referral',
        created_by: user?._id || user?.id,
        meta: {
          value: { ...form },
          leadId: selectedJob?._id,
          lat: selectedJob?.location?.coordinates?.[1] || 0,
          long: selectedJob?.location?.coordinates?.[0] || 0,
        }
      };

      LeadService.logUserActivity(activityPayload).catch(e => console.log('Activity Log Error:', e));

      if (mode === 'EDIT' && existingReferral?._id) {
        await LeadService.updateReferral(existingReferral._id, payload);
      } else {
        await LeadService.createReferral(payload);
      }

      Alert.alert('Success', `Referral ${mode === 'EDIT' ? 'updated' : 'added'} successfully`);
      if (onSuccess) onSuccess();
      onClose();

    } catch (error) {
      console.error('Referral Error:', error);
      Alert.alert('Error', 'Failed to save referral');
    } finally {
      setLoading(false);
    }
  };

  const getTitle = () => {
    if (mode === 'ADD') return 'Add Reference';
    if (mode === 'EDIT') return 'Update Reference';
    return 'Reference';
  };

  const isViewMode = mode === 'VIEW';

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View className="flex-1 justify-center items-center bg-black/50 px-6">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
          style={{ width: '100%', alignItems: 'center', justifyContent: 'center' }}
        >
          <View className="bg-white rounded-[32px] w-full max-h-[85%]">
          <View className="p-6 pb-2 flex-row justify-between items-center">
            <Text className="text-[20px] font-black text-slate-800">{getTitle()}</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color="#000" />
            </TouchableOpacity>
          </View>

          <ScrollView 
            className="px-6" 
            contentContainerStyle={{ paddingBottom: 30 }}
            showsVerticalScrollIndicator={false}
          >
            <View className="mt-4">
              <InputField 
                label="Full Name" 
                value={form.firstName} 
                onChangeText={(t: string) => setForm({...form, firstName: t})}
                placeholder="Full Name"
                isDark={isDark}
                editable={!isViewMode}
              />
              <InputField 
                label="Phone Number" 
                value={form.phoneNumber} 
                onChangeText={(t: string) => setForm({...form, phoneNumber: t})}
                placeholder="Phone Number"
                keyboardType="phone-pad"
                required
                isDark={isDark}
                editable={!isViewMode}
              />
              
              <View className="flex-row gap-4" style={{ zIndex: 100 }}>
                <View className="flex-1" style={{ zIndex: 100 }}>
                  <InputField 
                    label="Method" 
                    value={contactMethods.find(m => m.value === form.preferredContactMethod)?.label || form.preferredContactMethod} 
                    dropdown
                    required
                    isDark={isDark}
                    editable={!isViewMode}
                    onPress={() => !isViewMode && setShowMethodDropdown(!showMethodDropdown)}
                  />
                  {showMethodDropdown && (
                    <View 
                      style={{
                        position: 'absolute',
                        top: 55,
                        left: 0,
                        right: 0,
                        backgroundColor: 'white',
                        borderWidth: 1,
                        borderColor: '#f1f5f9',
                        borderRadius: 12,
                        elevation: 20,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.15,
                        shadowRadius: 8,
                        zIndex: 9999,
                      }}
                    >
                      {contactMethods.map(m => (
                        <TouchableOpacity 
                          key={m.value}
                          style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#f8fafc' }}
                          onPress={() => {
                            setForm({...form, preferredContactMethod: m.value});
                            setShowMethodDropdown(false);
                          }}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>{m.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
                <View className="flex-1" style={{ zIndex: 90 }}>
                  <InputField 
                    label="Zip Code" 
                    value={form.zipCode} 
                    onChangeText={(t: string) => setForm({...form, zipCode: t})}
                    placeholder="Zip Code"
                    keyboardType="numeric"
                    isDark={isDark}
                    editable={!isViewMode}
                  />
                </View>
              </View>

              <View style={{ zIndex: 80 }}>
                <InputField 
                  label="Best Time to Contact" 
                  value={timeOptions.find(o => o.value === form.bestTimeToContact)?.label || form.bestTimeToContact} 
                  dropdown
                  required
                  isDark={isDark}
                  editable={!isViewMode}
                  onPress={() => !isViewMode && setShowTimeDropdown(!showTimeDropdown)}
                />
                {showTimeDropdown && (
                  <View 
                    style={{
                      position: 'absolute',
                      top: 55,
                      left: 0,
                      right: 0,
                      backgroundColor: 'white',
                      borderWidth: 1,
                      borderColor: '#f1f5f9',
                      borderRadius: 12,
                      elevation: 20,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.15,
                      shadowRadius: 8,
                      zIndex: 9999,
                    }}
                  >
                    {timeOptions.map(o => (
                      <TouchableOpacity 
                        key={o.value}
                        style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#f8fafc' }}
                        onPress={() => {
                          setForm({...form, bestTimeToContact: o.value});
                          setShowTimeDropdown(false);
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>{o.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
              
              <InputField 
                label="Note" 
                value={form.note} 
                onChangeText={(t: string) => setForm({...form, note: t})}
                placeholder="Note"
                multiline
                isDark={isDark}
                editable={!isViewMode}
              />

              <View className="mt-2 mb-6">
                <Text className="text-slate-400 font-bold text-[13px] mb-4">Select Products</Text>
                <View className="flex-row flex-wrap justify-between">
                  {products.map(p => (
                    <Checkbox 
                      key={p} 
                      label={p} 
                      checked={form.items.includes(p)} 
                      onPress={() => toggleProduct(p)}
                    />
                  ))}
                </View>
              </View>

              <View className="flex-row items-center justify-end mb-6">
                 <Switch
                  value={form.referralToggle}
                  onValueChange={(v) => {
                    if (mode !== 'VIEW') setForm({...form, referralToggle: v});
                  }}
                  trackColor={{ false: '#e2e8f0', true: '#4CBB17' }}
                  thumbColor="white"
                />
                <Text className="ml-3 text-[14px] font-bold text-slate-400">Reference</Text>
              </View>
            </View>
          </ScrollView>

          <View className="p-6 pt-0 flex-row justify-end gap-3">
            <TouchableOpacity 
              onPress={onClose}
              className="px-6 h-12 rounded-xl items-center justify-center border border-slate-200"
            >
              <Text className="font-black text-slate-700">Cancel</Text>
            </TouchableOpacity>
            
            {mode !== 'VIEW' && (
              <TouchableOpacity 
                onPress={handleSubmit}
                disabled={loading}
                className="px-8 h-12 rounded-xl items-center justify-center bg-[#212B36] shadow-lg shadow-slate-200"
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-white font-black">{mode === 'ADD' ? 'Submit' : 'Update'}</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};
