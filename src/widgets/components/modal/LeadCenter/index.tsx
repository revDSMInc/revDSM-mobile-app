import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';
import { GlobalKeyboardAvoidingView } from '../../../common/keyboard/GlobalKeyboard';
import { CustomInput } from '../../../controls/input/CustomInput';
import { CustomButton } from '../../../controls/button/CustomButton';
import { FlashMessage } from '../../../../config/message';
import { IMAGE_CATEGORIES, ONE_LEG_OPTIONS } from './constants';
import { useUpdateLeadOutcomeMutation, useSubmitJobBuilderMutation } from '../../../../hooks/useLeadMutation';
import { useAuth } from '../../../../hooks/useAuth';
import { launchCamera } from 'react-native-image-picker';
import JobBuilder from './JobBuilder';

interface Props {
  visible: boolean;
  onClose: () => void;
  lead: any;
}

export default function LeadCenterModal({ visible, onClose, lead }: Props) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const updateOutcomeMutation = useUpdateLeadOutcomeMutation();
  const submitJobBuilderMutation = useSubmitJobBuilderMutation();
  const [activeTab, setActiveTab] = useState<'info' | 'outcome' | 'photos' | 'tools' | 'pitchbook'>('info');
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const [showJobBuilder, setShowJobBuilder] = useState(false);

  const [formData, setFormData] = useState({
    oneLeg: 'no',
    result: 'noDemo',
    reason: '',
    contractPrice: '',
    downPayment: '',
    paymentMethod: 'check',
    balancePaymentMethod: 'check',
  });

  useEffect(() => {
    if (visible && lead?.outcome) {
      setFormData({
        oneLeg: lead.outcome.oneLeg || 'no',
        result: lead.outcome.result || 'noDemo',
        reason: lead.outcome.reason || '',
        contractPrice: lead.outcome.contractPrice?.toString() || '',
        downPayment: lead.outcome.downPayment?.toString() || '',
        paymentMethod: lead.outcome.paymentMethod || 'check',
        balancePaymentMethod: lead.outcome.balancePaymentMethod || 'check',
      });
    }
  }, [visible, lead]);

  const handleSubmitOutcome = async () => {
    try {
      await updateOutcomeMutation.mutateAsync({
        leadId: lead._id,
        data: formData
      });
      FlashMessage.success('Success', 'Outcome updated successfully');
    } catch (err: any) {
      FlashMessage.error('Error', err?.message || 'Failed to update outcome');
    }
  };

  const handleCapture = async (catId: string, subId: string) => {
    const result = await launchCamera({
      mediaType: 'photo',
      quality: 0.8,
      saveToPhotos: true,
    });
    
    if (result.assets && result.assets.length > 0) {
      FlashMessage.success('Captured', `Photo added to ${catId}`);
    }
  };

  const handleSubmitJobBuilder = async (payload: any) => {
    try {
      await submitJobBuilderMutation.mutateAsync({
        leadId: lead._id,
        payload: {
          ...payload,
          updatedAt: new Date().toISOString(),
        }
      });
      FlashMessage.success('Success', 'Job Builder data submitted successfully');
      setShowJobBuilder(false);
    } catch (err: any) {
      FlashMessage.error('Error', err?.message || 'Failed to submit Job Builder');
    }
  };

  if (!lead) return null;

  const tabs = [
    { id: 'info', label: 'INFO' },
    { id: 'outcome', label: 'OUTCOME' },
    { id: 'photos', label: 'PHOTOS' },
    { id: 'tools', label: 'TOOLS' },
    { id: 'pitchbook', label: 'PITCHBOOK' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent={Platform.OS === 'android'}>
      <View className="flex-1 bg-black/40 justify-end">
        <GlobalKeyboardAvoidingView
          isModal
          className="rounded-t-[32px] max-h-[95%] overflow-hidden flex-1"
          style={{ backgroundColor: isDark ? colors.surface : '#fff' }}
        >
          {/* Header */}
          <View className="p-6 flex-row justify-between items-center border-b" style={{ borderBottomColor: isDark ? colors.border : colors.grey[200] }}>
            <View>
              <Text className="text-xl font-black" style={{ color: colors.text }}>Lead Center</Text>
              <Text className="text-[11px] font-bold mt-1 opacity-60" style={{ color: colors.textSecondary }}>
                {lead.leadCode || 'NEW'} | {lead.customerDetails?.firstName} {lead.customerDetails?.lastName}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-2">
              <Text className="text-3xl font-light" style={{ color: colors.textSecondary }}>×</Text>
            </TouchableOpacity>
          </View>

          {/* Tab Navigation */}
          <View className="border-b" style={{ borderBottomColor: isDark ? colors.border : colors.grey[200] }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-4">
              {tabs.map((tab) => (
                <TouchableOpacity 
                   key={tab.id} 
                   onPress={() => setActiveTab(tab.id as any)} 
                   className={`py-4 mr-6 border-b-2 ${activeTab === tab.id ? '' : 'border-transparent'}`}
                   style={{ borderBottomColor: activeTab === tab.id ? colors.primary.main : 'transparent' }}
                >
                  <Text className={`text-[11px] font-black tracking-widest uppercase ${activeTab === tab.id ? '' : 'opacity-40'}`} style={{ color: activeTab === tab.id ? colors.primary.main : colors.text }}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Content Area */}
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerClassName="pb-20">
            {activeTab === 'info' && (
              <View className="p-6">
                <InfoItem label="Client Name" value={`${lead.customerDetails?.firstName} ${lead.customerDetails?.lastName}`} icon="👤" />
                <InfoItem label="Phone" value={lead.customerDetails?.phone || 'N/A'} icon="📞" color={colors.primary.main} />
                <InfoItem label="Email" value={lead.customerDetails?.email || 'N/A'} icon="✉️" color={colors.primary.main} />
                <InfoItem label="Address" value={lead.fullAddress || lead.customerDetails?.address} icon="📍" color={colors.primary.main} underline />
                <InfoItem label="Lead Date" value={lead.leadDate || 'N/A'} icon="📅" />
                <InfoItem label="Lead Time" value={lead.leadTime || 'N/A'} icon="🕒" />
                
                {formData.result === 'sale' && (
                  <CustomButton 
                    title="Open Job Builder" 
                    onPress={() => setShowJobBuilder(true)} 
                    variant="primary"
                    style={{ marginTop: 24 }}
                  />
                )}
              </View>
            )}

            {activeTab === 'outcome' && (
              <View className="p-6">
                <View className="mb-6 p-5 rounded-3xl border" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : colors.grey[100], borderColor: isDark ? colors.border : colors.grey[200] }}>
                   <Text className="text-[10px] font-black uppercase mb-4 tracking-tighter opacity-60" style={{ color: colors.textSecondary }}>Initial Qualifications</Text>
                   <Text className="text-[13px] font-bold mb-3" style={{ color: colors.textSecondary }}>Is this a one-leg?</Text>
                   <View className="flex-row gap-3">
                     {ONE_LEG_OPTIONS.map(opt => (
                       <TouchableOpacity 
                         key={opt.value} 
                         onPress={() => setFormData({...formData, oneLeg: opt.value})}
                         className="px-6 py-2.5 rounded-2xl border"
                         style={{ 
                           backgroundColor: formData.oneLeg === opt.value ? `${colors.primary.main}15` : (isDark ? colors.surface : '#fff'),
                           borderColor: formData.oneLeg === opt.value ? colors.primary.main : (isDark ? colors.border : colors.grey[300]),
                         }}
                       >
                         <Text className="text-[11px] font-black" style={{ color: formData.oneLeg === opt.value ? colors.primary.main : colors.textSecondary }}>{opt.label.toUpperCase()}</Text>
                       </TouchableOpacity>
                     ))}
                   </View>
                </View>

                <CustomInput label="Lead Outcome" value={formData.result} onChangeText={(v) => setFormData({...formData, result: v})} placeholder="e.g. Sale, No Demo..." />
                <CustomInput label="Reason (If applicable)" value={formData.reason} onChangeText={(v) => setFormData({...formData, reason: v})} multiline />
                
                {formData.result === 'sale' && (
                  <View className="flex-row gap-4">
                     <View className="flex-1"><CustomInput label="Contract Price ($)" value={formData.contractPrice} onChangeText={(v) => setFormData({...formData, contractPrice: v})} keyboardType="numeric" /></View>
                     <View className="flex-1"><CustomInput label="Down Payment ($)" value={formData.downPayment} onChangeText={(v) => setFormData({...formData, downPayment: v})} keyboardType="numeric" /></View>
                  </View>
                )}

                <CustomButton 
                  title="Update Lead Status" 
                  onPress={handleSubmitOutcome} 
                  loading={updateOutcomeMutation.isPending}
                  style={{ marginTop: 24 }}
                />
              </View>
            )}

            {activeTab === 'photos' && (
              <View className="p-6">
                 {/* Progress Bar */}
                 <View className="mb-8 p-6 rounded-3xl border shadow-sm" style={{ backgroundColor: isDark ? colors.surface : '#fff', borderColor: isDark ? colors.border : colors.grey[200] }}>
                    <View className="flex-row justify-between items-center mb-3">
                       <Text className="text-[10px] font-black tracking-widest uppercase" style={{ color: colors.primary.main }}>Job Documentation</Text>
                       <Text className="text-[10px] font-black opacity-30" style={{ color: colors.textSecondary }}>45% COMPLETE</Text>
                    </View>
                    <View className="h-2 w-full rounded-full overflow-hidden" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : colors.grey[200] }}>
                       <View className="h-full rounded-full" style={{ width: '45%', backgroundColor: colors.primary.main }} />
                    </View>
                 </View>

                 {IMAGE_CATEGORIES.map((cat) => (
                   <View key={cat.id} className="mb-6">
                      <TouchableOpacity 
                        onPress={() => setExpandedCats({...expandedCats, [cat.id]: !expandedCats[cat.id]})}
                        className="flex-row justify-between items-center px-2 py-3"
                      >
                         <Text className="text-sm font-black" style={{ color: colors.text }}>{cat.name.toUpperCase()}</Text>
                         <Text className="text-lg font-black opacity-40" style={{ color: colors.textSecondary }}>{expandedCats[cat.id] ? '−' : '+'}</Text>
                      </TouchableOpacity>
                      
                      {expandedCats[cat.id] && (
                        <View className="flex-row flex-wrap gap-4 mt-3 pl-2">
                           {cat.subCategories.map((sub) => (
                             <TouchableOpacity 
                               key={sub.id} 
                               onPress={() => handleCapture(cat.id, sub.id)}
                               className="w-[100px] mb-4 items-center"
                             >
                                <View className="w-[84px] h-[84px] rounded-3xl border border-dashed items-center justify-center" style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.05)' : colors.grey[100], borderColor: isDark ? colors.border : colors.grey[400] }}>
                                   <Text className="text-2xl opacity-40">📸</Text>
                                </View>
                                <Text className="text-[10px] font-black text-center mt-2 opacity-70" style={{ color: colors.text }} numberOfLines={2}>{sub.name}</Text>
                             </TouchableOpacity>
                           ))}
                        </View>
                      )}
                   </View>
                 ))}
              </View>
            )}

            {activeTab === 'tools' && (
              <View className="p-6">
                <View className="gap-4">
                  <ToolCard label="LF Calculator" icon="🧮" onOpen={() => {}} />
                  <ToolCard label="Customer Consent Form" icon="📝" onOpen={() => {}} />
                  <ToolCard label="Roof Waiver" icon="🏠" onOpen={() => {}} />
                </View>
              </View>
            )}

            {activeTab === 'pitchbook' && (
              <View className="p-12 items-center">
                <Text className="text-5xl mb-6">📖</Text>
                <Text className="text-xl font-black text-center" style={{ color: colors.text }}>Pitch Book View</Text>
                <Text className="text-sm text-center mt-2 opacity-50 font-bold" style={{ color: colors.textSecondary }}>Engage clients with professional visual presentations.</Text>
              </View>
            )}
          </ScrollView>

          {showJobBuilder && (
            <View className="absolute inset-0 z-50 rounded-t-[32px] overflow-hidden" style={{ backgroundColor: isDark ? colors.surface : '#fff' }}>
              <JobBuilder 
                lead={lead} 
                onClose={() => setShowJobBuilder(false)} 
                onSubmit={handleSubmitJobBuilder} 
              />
              {submitJobBuilderMutation.isPending && (
                <View className="absolute inset-0 bg-white/60 items-center justify-center">
                   <ActivityIndicator size="large" color={colors.primary.main} />
                   <Text className="mt-4 font-black" style={{ color: colors.text }}>Finalizing Job Details...</Text>
                </View>
              )}
            </View>
          )}
        </GlobalKeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function InfoItem({ label, value, icon, color, underline }: any) {
  const { colors, isDark } = useTheme();
  return (
    <View className="flex-row items-center mb-6">
      <View className="w-11 h-11 rounded-full items-center justify-center" style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : colors.grey[200] }}>
        <Text className="text-xl">{icon}</Text>
      </View>
      <View className="ml-5 flex-1">
        <Text className="text-[10px] font-black uppercase tracking-widest opacity-60" style={{ color: colors.textSecondary }}>{label}</Text>
        <Text 
           className={`text-[15px] font-black mt-0.5 ${underline ? 'underline' : ''}`}
           style={{ color: color || colors.text }}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function ToolCard({ label, icon, onOpen, disabled }: any) {
  const { colors, isDark } = useTheme();
  return (
    <TouchableOpacity 
      onPress={onOpen}
      disabled={disabled}
      className={`p-5 rounded-[24px] flex-row items-center border shadow-sm ${disabled ? 'opacity-40' : ''}`}
      style={{ 
        backgroundColor: isDark ? colors.surface : '#fff', 
        borderColor: isDark ? colors.border : colors.grey[200],
      }}
    >
      <View className="w-12 h-12 rounded-2xl items-center justify-center" style={{ backgroundColor: `${colors.primary.main}12` }}>
         <Text className="text-2xl">{icon}</Text>
      </View>
      <Text className="ml-5 text-sm font-black" style={{ color: colors.text }}>{label}</Text>
      <View className="ml-auto">
         <Text className="text-lg font-black opacity-30" style={{ color: colors.textSecondary }}>→</Text>
      </View>
    </TouchableOpacity>
  );
}
