import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import YearDropdown from '../../components/YearDropdown';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useRevRenderRunsQuery } from '../../../hooks/useLeadQuery';
import { RevRenderHistoryModal } from '../../modals/lead-center/RevRenderHistoryModal';

export const ToolsSection = ({
  lead,
  onAction,
  secureUrls = {},
  riskJob,
  onShowJobBuilder,
  onShowCalculator,
  onShowPitchbook,
}: any) => {
  const { colors, isDark } = useTheme();
  const { data: runs, isLoading } = useRevRenderRunsQuery(lead?._id || '');

  const [historyModal, setHistoryModal] = useState({ visible: false, index: 0 });
  const [selectedYear, setSelectedYear] = useState(3);
  const [resetView, setResetView] = useState(false);

  const findReport = (type: string) => {
    const keyword = type.split('_')[0]; // 'consent', 'waiver', 'risk'
    return lead?.generatedReports?.find(
      (r: any) =>
        (r.reportType === type ||
          r.reportName?.toLowerCase().includes(keyword) ||
          r.reportPath?.toLowerCase().includes(keyword)) &&
        !r.isReset
    );
  };

  const consentReport = findReport('consent_form');
  const waiverReport = findReport('waiver_form');
  const inspectionReport = findReport('inspection_report');
  const riskReport = findReport('risk_report');

  useEffect(() => {
    if (!riskReport) {
      setResetView(false);
    }
  }, [riskReport]);

  const handleConsentPress = () => onAction('consent');
  const handleWaiverPress = () => onAction('waiver');

  return (
    <View className="px-4 py-3">
      <ToolCard
        title="Customer Consent Form"
        desc={consentReport ? 'View Uploaded PDF' : 'Customer consent agreements'}
        icon={consentReport ? 'file-check' : 'file-document-edit'}
        onPress={handleConsentPress}
        isGenerated={!!consentReport}
      />
      <ToolCard
        title="Deal Center"
        desc="Gutter measurements helper"
        icon="handshake"
        onPress={onShowCalculator}
      />
      <TouchableOpacity
        onPress={() => onAction('revrender')}
        className="p-3 rounded-lg flex-col mb-4 border"
        style={{
          borderColor: '#919EAB33',
          backgroundColor: isDark ? colors.surface : '#919EAB14',
        }}
      >
        <View className="flex-row justify-between mb-4">
          <View
            className="w-12 h-12 rounded-md items-center justify-center"
            style={{ backgroundColor: '#FFFFFF' }}
          >
            <Ionicons name="image" size={16} color={'#637381'} />
          </View>
          <View className="flex-1 justify-between gap-2 ml-2">
            <View className="flex-row items-center gap-3">
              <Text className="text-sm font-semibold" style={{ color: '#1C252E' }}>
                revRender
              </Text>
              <View className="bg-[#1C252E] rounded-md">
                <Text className="px-3 py-0.5 text-xs font-semibold" style={{ color: '#ffffff' }}>
                  {runs?.length || 0} Runs
                </Text>
              </View>
            </View>
            <Text className="text-xs">Select a photo to render</Text>
          </View>
          <View>
            <View className="rounded-md" style={{ backgroundColor: colors.primary.main }}>
              <Text className="text-sm font-semibold px-2" style={{ color: '#ffffff' }}>
                AI
              </Text>
            </View>
          </View>
        </View>

        {isLoading ? (
          <ActivityIndicator size="small" color={colors.primary.main} />
        ) : runs && runs.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
            {runs.map((run: any, idx: number) => (
              <TouchableOpacity
                key={idx}
                onPress={() => setHistoryModal({ visible: true, index: idx })}
                className="mr-3 items-center"
              >
                <Image
                  source={{ uri: run.generatedUrl || run.s3UrlGenerated }}
                  className="w-20 h-16 rounded-xl border-2"
                  style={{ borderColor: colors.border }}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : (
          <Text className="text-xs font-light mt-2" style={{ color: '#637381' }}>
            No generated images found in revRender runs.
          </Text>
        )}
      </TouchableOpacity>
      <ToolCard
        title="Pitch Book"
        desc="Presentation materials"
        icon="book-open-page-variant"
        onPress={onShowPitchbook}
      />
      <View
        className="p-3 rounded-lg flex-col mb-4 border"
        style={{
          borderColor: '#919EAB33',
          backgroundColor: colors.background,
        }}
      >
        <View className="flex-row justify-between items-center">
          <View
            className="w-8 h-8 rounded-full items-center justify-center"
            style={{ backgroundColor: '#919EAB1F' }}
          >
            <Icon name="alert" size={16} color={'#637381'} />
          </View>
          <View className="flex-1 ml-4">
            <Text className="text-sm font-semibold" style={{ color: '#1C252E' }}>
              Risk Report
            </Text>
          </View>
          <View className="flex-row items-center gap-3">
            {riskReport && !resetView && !riskJob && (
              <View className="flex-row items-center gap-2">
                <TouchableOpacity
                  onPress={() =>
                    onAction(
                      'risk-preview',
                      secureUrls[riskReport.reportPath] || riskReport.fileUrl
                    )
                  }
                  className="w-8 h-8 rounded-full items-center justify-center bg-violet-500"
                >
                  <Icon name="eye" size={16} color={'#ffffff'} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    onAction(
                      'risk-download',
                      secureUrls[riskReport.reportPath] || riskReport.fileUrl
                    )
                  }
                  className="w-8 h-8 rounded-full items-center justify-center bg-emerald-500"
                >
                  <Icon name="download" size={16} color={'#ffffff'} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setResetView(true);
                    onAction('risk-reset', riskReport._id);
                  }}
                  className="w-8 h-8 rounded-full items-center justify-center bg-amber-500"
                >
                  <Icon name="refresh" size={16} color={'#ffffff'} />
                </TouchableOpacity>
              </View>
            )}
            {(!riskReport || resetView) && !riskJob && (
              <>
                <YearDropdown
                  defaultValue={selectedYear}
                  min={1}
                  max={5}
                  onChange={(val: number) => setSelectedYear(val)}
                />
                <TouchableOpacity
                  onPress={() => {
                    onAction('risk-generate', selectedYear);
                    setResetView(false);
                  }}
                  className="w-8 h-8 rounded-full items-center justify-center"
                  style={{ backgroundColor: colors.primary.main }}
                >
                  <Icon name="download" size={16} color={'#ffffff'} />
                </TouchableOpacity>
              </>
            )}
            {riskJob && riskJob.status !== 'completed' && (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator size="small" color={colors.primary.main} />
                <Text className="text-[10px] font-bold text-slate-500 ">{riskJob.progress}%</Text>
              </View>
            )}
          </View>
        </View>

        {/* Progress Bar for Risk Job */}
        {riskJob && riskJob.status !== 'completed' && (
          <View className="mt-3 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <View className="h-full bg-[#4CBB17]" style={{ width: `${riskJob.progress}%` }} />
          </View>
        )}
        {riskJob && riskJob.status !== 'completed' && (
          <Text className="text-[10px] text-slate-400 mt-1 italic">
            {riskJob.step || 'Processing...'}
          </Text>
        )}
      </View>
      <ToolCard
        title="Inspection Report"
        desc="Detailed inspection logs"
        icon="clipboard-text"
        onPress={() => onAction('inspection')}
      />
      <ToolCard
        title="Roof Waiver"
        desc={waiverReport ? 'View Signed Waiver' : 'Roof waiver documents'}
        icon={waiverReport ? 'file-check' : 'home-roof'}
        onPress={handleWaiverPress}
        isGenerated={!!waiverReport}
      />

      <RevRenderHistoryModal
        visible={historyModal.visible}
        onClose={() => setHistoryModal({ ...historyModal, visible: false })}
        runs={runs || []}
        initialIndex={historyModal.index}
      />

      <TouchableOpacity
        className="p-3 rounded-lg flex-row items-center mb-4 border"
        style={{
          borderColor: '#919EAB33',
          backgroundColor: colors.background,
        }}
      >
        <View
          className="w-8 h-8 rounded-full items-center justify-center opacity-40"
          style={{ backgroundColor: '#919EAB1F' }}
        >
          <Icon name="home-roof" size={16} color={'#637381'} />
        </View>
        <View className="flex-1 ml-4 opacity-40">
          <Text className="text-sm font-semibold" style={{ color: '#1C252E' }}>
            Hover
          </Text>
        </View>
        <View className="p-1 rounded-md" style={{ backgroundColor: '#C684FF66' }}>
          <Text className="text-[10px] font-medium" style={{ color: '#ffffff' }}>
            Coming soon
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
};

const ToolCard = ({ title, blur, icon, onPress, isGenerated }: any) => {
  const { colors, isDark } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      className="p-3 rounded-lg flex-row items-center mb-4 border"
      style={{
        borderColor: '#919EAB33',
        backgroundColor: isDark ? colors.surface : colors.background,
      }}
    >
      <View
        className="w-8 h-8 rounded-full items-center justify-center"
        style={{ backgroundColor: isDark ? colors.grey[800] : '#919EAB1F' }}
      >
        <Icon name={icon} size={16} color={isDark ? colors.grey[0] : '#637381'} />
      </View>
      <View className="flex-1 ml-4">
        <Text
          className="text-sm font-semibold"
          style={{ color: isGenerated ? colors.primary.main : '#1C252E' }}
        >
          {title}
        </Text>
      </View>
      {isGenerated && (
        <View className="bg-violet-100 px-3 py-1.5 rounded-xl border border-violet-200 shadow-sm">
          <Text className="text-[10px] font-semibold text-violet-700">Already Generated</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

import { useNavigation } from '@react-navigation/native';
import { LeadMap } from './LeadMap';

export const MapSection = ({ lead }: any) => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();

  return (
    <View className="px-5 py-4">
      <View className="flex-row items-center justify-between mb-5">
        <Text
          className="text-[14px] font-black  tracking-widest"
          style={{ color: colors.textSecondary }}
        >
          Active Job Location
        </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('MapDetail', { currentLead: lead })}
          className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex-row items-center"
        >
          <Icon name="check-decagram" size={12} color="#10B981" />
          <Text className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 ml-1 ">
            Expand Map
          </Text>
        </TouchableOpacity>
      </View>

      <Text className="text-[14px] font-bold mb-4" style={{ color: colors.text }}>
        📍 {lead?.fullAddress || lead?.customerDetails?.address || 'Address not available'}
      </Text>

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => navigation.navigate('MapDetail', { currentLead: lead })}
      >
        <LeadMap currentLead={lead} />
      </TouchableOpacity>
    </View>
  );
};
