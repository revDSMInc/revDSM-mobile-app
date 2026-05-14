import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { paymentPlans } from '../../../utils/calculator/payment-plans';
import { AppointmentSchedulerModal } from '../../modals/job-builder/AppointmentSchedulerModal';

interface EditContractDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  outcomeData: any;
  onUpdate: (payload: any) => Promise<void>;
  lead: any;
}

const downPaymentMethods = [
  { label: 'Check (0% Fee)', value: 'check' },
  { label: 'MC/VISA/DSCVR (3.00% Fee)', value: 'card' },
  { label: 'AMEX (5.00% Fee)', value: 'amex' },
];

export const EditContractDetailsModal: React.FC<EditContractDetailsModalProps> = ({
  visible,
  onClose,
  outcomeData,
  onUpdate,
  lead,
}) => {
  const { colors, isDark } = useTheme();
  const [view, setView] = useState<'menu' | 'pricing' | 'schedule'>('menu');
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    originalContractPrice: '0',
    downPayment: '0',
    downPaymentMethod: 'check',
    balance: '0',
    balancePaymentMethod: 'check',
  });

  // Sync with current data whenever modal opens
  React.useEffect(() => {
    if (visible) {
      const price = outcomeData?.originalContractPrice || outcomeData?.leadData?.originalContractPrice || lead?.originalContractPrice || 0;
      const dp = outcomeData?.downPayment || outcomeData?.leadData?.downPayment || lead?.downPayment || 0;
      const dpMethod = outcomeData?.paymentMethod || outcomeData?.leadData?.paymentMethod || lead?.paymentMethod || 'check';
      const bal = outcomeData?.balance || outcomeData?.leadData?.balance || lead?.balance || 0;
      const balMethod = outcomeData?.balancePaymentMethod || outcomeData?.leadData?.balancePaymentMethod || lead?.balancePaymentMethod || 'check';

      setFormData({
        originalContractPrice: String(price),
        downPayment: String(dp),
        downPaymentMethod: dpMethod,
        balance: String(bal),
        balancePaymentMethod: balMethod,
      });
    }
  }, [visible, outcomeData, lead]);

  // Auto-calculate balance when price or down payment changes
  React.useEffect(() => {
    const price = Number(formData.originalContractPrice) || 0;
    const dp = Number(formData.downPayment) || 0;
    const newBalance = Math.max(0, price - dp);
    if (newBalance !== Number(formData.balance)) {
      setFormData(prev => ({ ...prev, balance: String(newBalance) }));
    }
  }, [formData.originalContractPrice, formData.downPayment]);

  const handleSavePricing = async () => {
    setLoading(true);
    try {
      // Matching web app ResultLeadModal payload structure for PUT /outcome
      await onUpdate({
        oneLeg: outcomeData?.oneLeg || lead?.oneLeg || 'No',
        result: outcomeData?.result || lead?.result || outcomeData?.status || lead?.status || '',
        reason: outcomeData?.reason || lead?.reason || '',
        explain: outcomeData?.explain || lead?.explain || '',
        lastPriceQuoted: String(formData.originalContractPrice),
        originalContractPrice: String(formData.originalContractPrice),
        downPayment: String(formData.downPayment),
        paymentMethod: formData.downPaymentMethod,
        balancePaymentMethod: formData.balancePaymentMethod,
        balance: String(formData.balance),
        selectedCalculatorId: outcomeData?.selectedCalculatorId || lead?.selectedCalculatorId || null,
        selectedAppointmentId: outcomeData?.selectedAppointmentId || lead?.selectedAppointmentId || null,
      });
      onClose();
    } catch (error) {
      console.error('Failed to save pricing:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleScheduleConfirm = async (data: any) => {
    setLoading(true);
    try {
      // Create a Date object from the M/d/yyyy string if possible
      let apiDate = data.date;
      if (data.date && data.date !== 'TBD') {
        const [m, d, y] = data.date.split('/');
        const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
        if (!isNaN(dateObj.getTime())) {
          apiDate = `${m}/${d}/${y}`; // Keep as M/d/yyyy which is common in this backend
        }
      }

      // Matching web app structure (specifically contract-details.js handleUpdateContract)
      const payload = {
        installDate: apiDate,
        timeWindow: data.timeWindow,
        leadData: {
          ...lead?.leadData,
          installDate: apiDate,
          timeWindow: data.timeWindow,
        },
        jobBuilder: {
          ...lead?.jobBuilder,
          scheduleTime: {
            customerName: `${lead?.customerDetails?.firstName} ${lead?.customerDetails?.lastName}`,
            date: apiDate,
            timeWindow: data.timeWindow,
            reason: data.reason || ''
          }
        },
        // Ensure result/status are preserved
        result: lead?.result || lead?.status || outcomeData?.result || '',
        status: lead?.status || lead?.result || outcomeData?.status || '',
      };
      
      await onUpdate(payload);
      setSchedulerOpen(false);
      onClose();
    } catch (error) {
      console.error('Failed to save schedule:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleExpand = (field: string) => {
    const isExpanding = expanded !== field;
    setExpanded(isExpanding ? field : null);

    if (isExpanding) {
      setTimeout(() => {
        const positions: Record<string, number> = {
          downPaymentMethod: 150,
          balancePaymentMethod: 350,
        };
        if (positions[field] !== undefined) {
          scrollRef.current?.scrollTo({ y: positions[field], animated: true });
        }
      }, 150);
    }
  };

  const renderDropdown = (label: string, value: string, items: any[], field: string, zIndex: number) => {
    const isExpanded = expanded === field;
    return (
      <View className="mb-4" style={{ zIndex }}>
        <Text className="text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">{label}</Text>
        <TouchableOpacity
          onPress={() => handleToggleExpand(field)}
          className="flex-row items-center justify-between bg-white border border-[#919EAB33] rounded-lg h-12 px-3"
          style={{ backgroundColor: isDark ? '#1C252E' : '#FFFFFF' }}
        >
          <Text className="text-[13px] font-semibold" style={{ color: isDark ? '#FFFFFF' : '#1C252E' }}>
            {value}
          </Text>
          <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={20} color="#637381" />
        </TouchableOpacity>
        {isExpanded && (
          <View className="z-[100] mt-1 bg-white border border-[#1C252E] rounded-lg shadow-sm overflow-hidden"
            style={{ backgroundColor: isDark ? '#1C252E' : '#FFFFFF' }}
          >
            <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
              {items.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  onPress={() => {
                    setFormData({ ...formData, [field]: item.value });
                    setExpanded(null);
                  }}
                  className={`px-4 py-3 flex-row items-center justify-between border-b border-[#919EAB14] ${
                    formData[field as keyof typeof formData] === item.value ? 'bg-gray-50' : ''
                  }`}
                  style={formData[field as keyof typeof formData] === item.value ? { backgroundColor: isDark ? '#FFFFFF10' : '#F4F6F8' } : {}}
                >
                  <Text className={`text-[13px] font-semibold ${
                    formData[field as keyof typeof formData] === item.value ? 'text-[#1C252E]' : 'text-[#637381]'
                  }`} style={{ color: formData[field as keyof typeof formData] === item.value ? (isDark ? '#FFFFFF' : '#1C252E') : '#637381' }}>
                    {item.label}
                  </Text>
                  {formData[field as keyof typeof formData] === item.value && (
                    <Ionicons name="checkmark" size={16} color={isDark ? '#FFFFFF' : '#1C252E'} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  const renderBalanceDropdown = (zIndex: number) => {
    const isExpanded = expanded === 'balancePaymentMethod';
    const currentValue = paymentPlans[formData.balancePaymentMethod]?.label || 'Select';

    return (
      <View className="mb-4" style={{ zIndex }}>
        <Text className="text-[10px] font-black text-gray-400 mb-1 uppercase tracking-widest">Payment Method (Balance)</Text>
        <TouchableOpacity
          onPress={() => handleToggleExpand('balancePaymentMethod')}
          className="flex-row items-center justify-between bg-white border border-[#919EAB33] rounded-lg h-12 px-3"
          style={{ backgroundColor: isDark ? '#1C252E' : '#FFFFFF' }}
        >
          <Text className="text-[13px] font-semibold flex-1" numberOfLines={1} style={{ color: isDark ? '#FFFFFF' : '#1C252E' }}>
            {currentValue}
          </Text>
          <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={20} color="#637381" />
        </TouchableOpacity>
        {isExpanded && (
          <View className="z-[100] mt-1 bg-white border border-[#1C252E] rounded-lg shadow-sm overflow-hidden"
            style={{ backgroundColor: isDark ? '#1C252E' : '#FFFFFF' }}
          >
            <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
              {/* Categories */}
              {[
                { title: 'Standard Methods', items: ['check', 'mcVisaDscvr', 'amex'] },
                { title: 'GreenSky Plans', filter: (k: string) => k.startsWith('greensky') },
                { title: 'Wells Fargo Plans', filter: (k: string) => k.startsWith('wf') },
                { title: 'Other Plans', filter: (k: string) => !k.startsWith('greensky') && !k.startsWith('wf') && !['check', 'mcVisaDscvr', 'amex'].includes(k) },
              ].map((cat, idx) => {
                const planKeys = cat.items || Object.keys(paymentPlans).filter(cat.filter!);
                if (planKeys.length === 0) return null;

                return (
                  <View key={idx}>
                    <View className="px-4 py-2" style={{ backgroundColor: idx % 2 === 0 ? '#d9ead3' : '#f4cccc' }}>
                      <Text className="text-[10px] font-bold text-black uppercase">{cat.title}</Text>
                    </View>
                    {planKeys.map((key) => {
                      const plan = paymentPlans[key];
                      return (
                        <TouchableOpacity
                          key={key}
                          onPress={() => {
                            setFormData({ ...formData, balancePaymentMethod: key });
                            setExpanded(null);
                          }}
                          className={`px-4 py-3 flex-row items-center justify-between border-b border-[#919EAB14] ${
                            formData.balancePaymentMethod === key ? 'bg-gray-50' : ''
                          }`}
                          style={formData.balancePaymentMethod === key ? { backgroundColor: isDark ? '#FFFFFF10' : '#F4F6F8' } : {}}
                        >
                          <View className="flex-1">
                            <Text className={`text-[13px] font-semibold ${
                              formData.balancePaymentMethod === key ? 'text-[#1C252E]' : 'text-[#637381]'
                            }`} style={{ color: formData.balancePaymentMethod === key ? (isDark ? '#FFFFFF' : '#1C252E') : '#637381' }}>
                              {plan.label}
                            </Text>
                            {plan.displayMonths && (
                              <Text className="text-[10px] text-[#919EAB]">{plan.displayMonths}</Text>
                            )}
                          </View>
                          {formData.balancePaymentMethod === key && (
                            <Ionicons name="checkmark" size={16} color={isDark ? '#FFFFFF' : '#1C252E'} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-center px-4">
        <View className="bg-white rounded-[12px] overflow-hidden" style={{ backgroundColor: isDark ? colors.card : '#FFFFFF' }}>
          
          {view === 'menu' && (
            <View className="p-8">
              <View className="flex-row justify-between items-start mb-1">
                <View>
                  <Text className="text-xl font-black text-[#1C252E]" style={{ color: colors.text }}>Edit Contract Details</Text>
                  <Text className="text-sm text-gray-400 font-medium mb-8">Select what to edit</Text>
                </View>
                <TouchableOpacity onPress={onClose}>
                  <Icon name="close" size={24} color="#637381" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity 
                onPress={() => setView('pricing')}
                className="flex-row items-center justify-between py-6 border-b border-gray-100"
              >
                <Text className="text-base font-bold text-[#1C252E]" style={{ color: colors.text }}>Contract Pricing</Text>
                <Icon name="chevron-right" size={24} color="#637381" />
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={() => setSchedulerOpen(true)}
                className="flex-row items-center justify-between py-6"
              >
                <View>
                  <Text className="text-base font-bold text-[#1C252E]" style={{ color: colors.text }}>Schedule Date</Text>
                  <Text className="text-[12px] text-gray-400">
                    {(() => {
                      const schedule = outcomeData?.jobBuilder?.scheduleTime || outcomeData?.jobState?.scheduleTime || outcomeData?.leadData?.scheduleTime;
                      const date = schedule?.date || outcomeData?.installDate || outcomeData?.leadData?.installDate;
                      const time = schedule?.timeWindow || outcomeData?.timeWindow || outcomeData?.leadData?.timeWindow;
                      if (!date) return 'Not Scheduled';
                      if (date === 'TBD') return 'TBD';
                      
                      const dateObj = new Date(date);
                      if (!isNaN(dateObj.getTime())) {
                        const formatted = dateObj.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
                        return `${formatted}${time ? ` • ${time}` : ''}`;
                      }
                      return `${date}${time ? ` • ${time}` : ''}`;
                    })()}
                  </Text>
                </View>
                <Icon name="chevron-right" size={24} color="#637381" />
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={onClose}
                className="mt-8 h-14 bg-[#4CBB17] rounded-2xl items-center justify-center"
              >
                <Text className="text-white font-black text-sm">Close</Text>
              </TouchableOpacity>
            </View>
          )}

          {view === 'pricing' && (
            <ScrollView 
              ref={scrollRef}
              className="p-8" 
              contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              <View className="flex-row justify-between items-center mb-1">
                <Text className="text-xl font-black text-[#1C252E]" style={{ color: colors.text }}>Edit Contract Pricing</Text>
                <TouchableOpacity onPress={() => setView('menu')}>
                  <Icon name="close" size={24} color="#637381" />
                </TouchableOpacity>
              </View>
              <Text className="text-sm text-gray-400 font-medium mb-8">All financial terms</Text>

              {/* Original Contract Price */}
              <View className="mb-6">
                <Text className="text-[11px] font-black text-gray-500 mb-2 uppercase tracking-widest">Original Contract Price</Text>
                <View className="flex-row items-center bg-gray-50 rounded-2xl border border-gray-100 px-4 h-14" style={{ backgroundColor: isDark ? '#FFFFFF05' : '#F9FAFB' }}>
                  <Text className="text-gray-400 mr-2 text-lg">$</Text>
                  <TextInput 
                    value={formData.originalContractPrice}
                    onChangeText={(t) => setFormData({ ...formData, originalContractPrice: t })}
                    keyboardType="numeric"
                    className="flex-1 font-bold text-base"
                    style={{ color: colors.text }}
                  />
                </View>
              </View>

              {/* Down Payment Group Box */}
              <View className="border border-[#919EAB33] rounded-2xl p-4 mb-6" style={{ backgroundColor: isDark ? '#FFFFFF02' : '#FFFFFF' }}>
                <View className="mb-4">
                  <Text className="text-[11px] font-black text-gray-500 mb-2 uppercase tracking-widest">Down Payment</Text>
                  <View className="flex-row items-center bg-gray-50 rounded-lg border border-[#919EAB33] px-3 h-12" style={{ backgroundColor: isDark ? '#FFFFFF05' : '#F9FAFB' }}>
                    <Text className="text-gray-400 mr-2">$</Text>
                    <TextInput 
                      value={formData.downPayment}
                      onChangeText={(t) => setFormData({ ...formData, downPayment: t })}
                      keyboardType="numeric"
                      className="flex-1 font-bold text-sm"
                      style={{ color: colors.text }}
                    />
                  </View>
                </View>
                {renderDropdown('Payment Method', downPaymentMethods.find(m => m.value === formData.downPaymentMethod)?.label || 'Select', downPaymentMethods, 'downPaymentMethod', 90)}
              </View>

              {/* Balance Group Box */}
              <View className="border border-[#919EAB33] rounded-2xl p-4 mb-6" style={{ backgroundColor: isDark ? '#FFFFFF02' : '#FFFFFF' }}>
                <View className="mb-4">
                  <Text className="text-[11px] font-black text-gray-500 mb-2 uppercase tracking-widest">Balance</Text>
                  <View className="flex-row items-center bg-gray-100 rounded-lg border border-[#919EAB33] px-3 h-12" style={{ backgroundColor: isDark ? '#FFFFFF05' : '#F4F6F8' }}>
                    <Text className="text-gray-400 mr-2">$</Text>
                    <TextInput 
                      value={formData.balance}
                      editable={false}
                      className="flex-1 font-bold text-sm text-gray-400"
                    />
                  </View>
                </View>
                {renderBalanceDropdown(80)}
              </View>

              <View className="flex-row gap-3 mb-8">
                <TouchableOpacity 
                  onPress={() => setView('menu')}
                  className="flex-1 h-14 border border-gray-200 rounded-2xl items-center justify-center"
                >
                  <Text className="font-black text-sm text-[#637381]">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={handleSavePricing}
                  disabled={loading}
                  className="flex-[1.5] h-14 bg-[#4CBB17] rounded-2xl items-center justify-center shadow-lg shadow-green-500/30"
                  style={{ opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-black text-sm">Save Changes</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </View>
      </View>

      <AppointmentSchedulerModal 
        visible={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        onConfirm={handleScheduleConfirm}
        customerName={`${lead?.customerDetails?.firstName} ${lead?.customerDetails?.lastName}`}
        isEdit={true}
        initialDate={outcomeData?.jobBuilder?.scheduleTime?.date || outcomeData?.jobState?.scheduleTime?.date || outcomeData?.installDate}
        initialTimeWindow={outcomeData?.jobBuilder?.scheduleTime?.timeWindow || outcomeData?.jobState?.scheduleTime?.timeWindow || outcomeData?.timeWindow}
      />
    </Modal>
  );
};
