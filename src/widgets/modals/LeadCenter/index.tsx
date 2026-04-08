import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/ThemeProvider';
import JobBuilder from './JobBuilder';
import LFCalculator from './LFCalculator';
import Pitchbook from './Pitchbook';
import { useSubmitJobBuilderMutation } from '../../../hooks/useLeadMutation';
import { useAuth } from '../../../hooks/useAuth';
import { ModalContainer, ModalHeader, ActionButton } from './components/SharedElements';
import { JobDocsSection } from './components/JobDocsSection';
import { ToolsSection, MapSection } from './components/OperationalSections';
import Chat from './components/Chat';
import Icon from 'react-native-vector-icons/Ionicons';

interface LeadCenterProps {
  visible: boolean;
  onClose: () => void;
  lead: any;
  initialTool?: 'job_builder' | 'calculator' | 'pitchbook' | 'chat';
  navigation?: any;
}

type TabType = 'job_docs' | 'map' | 'tools';

export default function LeadCenterModal({
  visible,
  onClose,
  lead,
  initialTool,
  navigation,
}: LeadCenterProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('job_docs');
  const [showJobBuilder, setShowJobBuilder] = useState(initialTool === 'job_builder');
  const [showCalculator, setShowCalculator] = useState(initialTool === 'calculator');
  const [showPitchbook, setShowPitchbook] = useState(initialTool === 'pitchbook');

  // Navigate to chat detail screen
  const handleOpenChat = () => {
    onClose();
    (navigation as any).navigate('ChatDetail', {
      leadId: lead._id,
      chatId: lead.chatId || '', // If available, otherwise it fetches
      customerName: `${lead.customerDetails?.firstName} ${lead.customerDetails?.lastName}`,
    });
  };

  React.useEffect(() => {
    if (initialTool === 'chat') {
      handleOpenChat();
    }
  }, [initialTool]);

  const submitJobBuilder = useSubmitJobBuilderMutation();

  const handleJobSubmit = async (payload: any) => {
    if (user?._id) {
      await submitJobBuilder.mutateAsync({ leadId: lead?._id, payload });
      setShowJobBuilder(false);
    }
  };

  if (!lead) return null;

  if (showJobBuilder)
    return (
      <Modal visible={visible} animationType="slide">
        <JobBuilder
          lead={lead}
          onClose={() => setShowJobBuilder(false)}
          onSubmit={handleJobSubmit}
        />
      </Modal>
    );

  if (showCalculator)
    return (
      <Modal visible={visible} animationType="slide">
        <LFCalculator lead={lead} onClose={() => setShowCalculator(false)} />
      </Modal>
    );

  if (showPitchbook)
    return (
      <Modal visible={visible} animationType="slide">
        <Pitchbook onClose={() => setShowPitchbook(false)} />
      </Modal>
    );

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <ModalContainer>
        <ModalHeader
          title="Lead Center"
          // subtitle={`Lead ID: ${lead?.leadId || '234'} • ${lead?.leadCode || 'REFERRAL'}`}
          onClose={onClose}
        >
          {/* <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: isDark ? colors.grey[800] : colors.grey[100] }}
          >
            <Text className="text-[10px] font-black" style={{ color: colors.text }}>
              REP
            </Text>
          </View> */}
        </ModalHeader>

        {/* Lead Identity Summary */}
        <View
          className="px-5 py-4 border-b"
          style={{
            backgroundColor: isDark ? colors.background : colors.grey[100],
            borderBottomColor: colors.border,
          }}
        >
          <View className="flex-row items-center mb-3">
            <View className="flex-row items-center mr-3">
              <Text className="text-sm font-black mr-1" style={{ color: colors.textSecondary }}>
                Lead ID:
              </Text>
              <Text className="text-sm font-black" style={{ color: colors.text }}>
                {lead?.leadId || 'N/A'}
              </Text>
            </View>
            <View className="flex-row items-center mr-3">
              <Text className="text-sm font-black mr-1" style={{ color: colors.textSecondary }}>
                Lead Code:
              </Text>
              <Text className="text-sm font-black" style={{ color: colors.text }}>
                {lead?.leadCode || 'N/A'}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center mb-3">
            <Text className="text-base font-black" style={{ color: colors.text }}>
              {lead?.customerDetails?.firstName} {lead?.customerDetails?.lastName}
            </Text>
          </View>
          <View className="flex-row items-center mb-3">
            <View className="px-3 py-1 bg-[#72BD0020] rounded-full mr-2 flex-row items-center">
              <Icon name="call" size={10} color="#72BD00" style={{ marginRight: 4 }} />
              <Text className="text-xs font-black uppercase text-[#72BD00]">
                {lead?.customerDetails?.phone}
              </Text>
            </View>
            <View
              className="px-3 py-1 rounded-full flex-row items-center"
              style={{ backgroundColor: isDark ? colors.grey[800] : colors.grey[100] }}
            >
              <Icon name="mail" size={10} color={colors.textSecondary} style={{ marginRight: 4 }} />
              <Text
                className="text-xs font-black uppercase"
                style={{ color: colors.textSecondary }}
              >
                {lead?.customerDetails?.email || 'N/A'}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center mb-3">
            <View className="flex-row items-center mr-3">
              <Text
                className="text-xs font-black uppercase mr-1"
                style={{ color: colors.textSecondary }}
              >
                Date:
              </Text>
              <Text className="text-xs font-black" style={{ color: colors.text }}>
                {lead?.leadDate ? new Date(lead.leadDate).toLocaleDateString() : 'N/A'}
              </Text>
            </View>
            <View className="flex-row items-center">
              <Text className="text-xs mr-1.5">🕒</Text>
              <Text className="text-xs font-black" style={{ color: colors.text }}>
                {lead?.leadTime || 'N/A'}
              </Text>
            </View>
          </View>
          <Text className="text-xs font-bold mb-3" style={{ color: colors.textSecondary }}>
            <Icon name="location-sharp" size={12} color={colors.textSecondary} />{' '}
            {lead?.fullAddress || lead?.customerDetails?.address || 'N/A'}
          </Text>
        </View>

        {/* Action Tabs */}
        <View
          className="flex-row px-4 py-3"
          style={{ backgroundColor: isDark ? colors.surface : '#fff' }}
        >
          <TabButton
            label="Job Docs"
            i="folder-open-outline"
            active={activeTab === 'job_docs'}
            onPress={() => setActiveTab('job_docs')}
          />
          <TabButton
            label="Map"
            i="map-outline"
            active={activeTab === 'map'}
            onPress={() => setActiveTab('map')}
          />
          <TabButton
            label="Tools"
            i="construct-outline"
            active={activeTab === 'tools'}
            onPress={() => setActiveTab('tools')}
          />
        </View>

        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
        >
          {activeTab === 'job_docs' && <JobDocsSection />}
          {activeTab === 'map' && <MapSection lead={lead} />}
          {activeTab === 'tools' && (
            <ToolsSection
              onShowJobBuilder={() => setShowJobBuilder(true)}
              onShowCalculator={() => setShowCalculator(true)}
              onShowPitchbook={() => setShowPitchbook(true)}
            />
          )}
        </ScrollView>

        {/* Global Footer Actions */}
        <View
          className="px-5 py-4 border-t flex-row gap-2"
          style={{
            backgroundColor: isDark ? colors.surface : colors.background,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 10,
          }}
        >
          <TouchableOpacity className="flex-1 h-12 rounded-xl items-center justify-center bg-orange-600 shadow-lg shadow-orange-500/30">
            <Text className="text-white text-[10px] font-black uppercase tracking-widest">
              No Demo
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 h-12 rounded-xl items-center justify-center shadow-lg"
            style={{
              backgroundColor: isDark ? colors.grey[700] : colors.grey[800],
              shadowColor: isDark ? '#000' : colors.grey[900],
            }}
          >
            <Text className="text-white text-[10px] font-black uppercase tracking-widest">
              Not Hit
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleOpenChat}
            className="flex-[2] h-12 rounded-xl items-center justify-center bg-blue-600 shadow-lg shadow-blue-500/30 flex-row"
          >
            <Icon
              name="chatbubble-ellipses"
              size={14}
              color="white"
              style={{ marginRight: 6, marginBottom: 2 }}
            />
            <Text className="text-white text-[10px] font-black uppercase tracking-widest">
              Msg Ops/IM
            </Text>
          </TouchableOpacity>
        </View>
      </ModalContainer>
    </Modal>
  );
}

function TabButton({ label, i, active, onPress }: any) {
  const { colors, isDark } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-1 items-center justify-center py-2.5 rounded-2xl mx-1.5"
      style={{
        backgroundColor: active
          ? colors.primary.main
          : isDark
          ? colors.grey[800]
          : colors.grey[200],
      }}
    >
      <Icon
        name={i}
        size={20}
        color={active ? 'white' : colors.textSecondary}
        style={{ marginBottom: 2 }}
      />
      <Text
        className="text-[9px] font-black uppercase tracking-widest"
        style={{ color: active ? 'white' : colors.textSecondary }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
