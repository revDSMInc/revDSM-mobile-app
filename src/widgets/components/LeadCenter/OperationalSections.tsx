import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator, Animated } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import YearDropdown from '../../components/YearDropdown';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useRevRenderRunsQuery } from '../../../hooks/useLeadQuery';
import { useLeadCalculatorStatus } from '../../../hooks/useLeadCalculatorStatus';
import { useFocusEffect } from '@react-navigation/native';
import { FlashMessage } from '../../../config/message';
import { RevRenderHistoryModal, prefetchToLocalCache } from '../../modals/lead-center/RevRenderHistoryModal';

export const ToolsSection = ({
  lead,
  onAction,
  secureUrls = {},
  riskJob,
  onShowJobBuilder,
  onShowCalculator,
  onShowDynamicDealCenter,
  onShowInvestmentCenter,
  onShowPitchbook,
  onShowRooflineDeck,
  revRenderJobs = [],
  isConsentGenerating,
  isWaiverGenerating,
  isInspectionGenerating,
  isCalculatorLoading,
}: any) => {
  const { colors, isDark } = useTheme();

  // Calculator/rollout status for the Deal Center + Investment Center tiles.
  // `allConfirmed` (web `allJobsConfirmed`) gates the Investment Center. Refetch on
  // focus so returning from the Deal Center reflects a newly-confirmed rollout.
  const { data: calcStatus, refetch: refetchCalcStatus, isFetching: isCalcStatusFetching } =
    useLeadCalculatorStatus(lead);
  const hasCalc = !!calcStatus?.hasCalculator;
  const isLeadSold = lead?.status === 'sale';
  const allConfirmed = !!calcStatus?.allConfirmed || isLeadSold;
  // Only while the tile is still locked — once it's open the rep has what they came
  // for and a spinner would just be noise on a card they can already use.
  const investmentStatusPending = isCalcStatusFetching && !allConfirmed;
  useFocusEffect(
    React.useCallback(() => {
      refetchCalcStatus?.();
    }, [refetchCalcStatus]),
  );

  const buildRevRenderPairs = (rawRuns: any[]) => {
    if (!Array.isArray(rawRuns)) return [];
    return Array.from(
      new Map(
        rawRuns
          .map((r) => ({
            originalUrl: typeof r?.originalUrl === 'string' ? r.originalUrl.trim() : '',
            generatedUrl: typeof r?.generatedUrl === 'string' ? r.generatedUrl.trim() : '',
            createdAt: r?.createdAt || null,
            runId: r?.runId || r?._id || null,
            originalS3url: r?.s3UrlOriginal || null,
            generatedS3url: r?.s3UrlGenerated || null,
            s3url: r?.s3url || null,
            bucketName: r?.bucketName || null,
            category: r?.category || null,
            subcategory: r?.subcategory || null,
            viewLabel: r?.viewLabel || null,
            // Color/component selections chosen when the render was created, so the
            // before/after modal can show which colors were applied. Different
            // backend shapes are all carried through; the modal picks whichever exists.
            selections: r?.selections || null,
            textureImageUrls: r?.textureImageUrls || r?.textureImages || null,
            components: r?.components || null,
            summary: r?.summary || null,
          }))
          .filter((p) => p.originalUrl && p.generatedUrl)
          .map((p) => [p.generatedUrl, p])
      ).values()
    );
  };

  const hasActiveJobs = revRenderJobs.some(
    (j: any) => j.status !== 'completed' && j.status !== 'failed'
  );
  const { data: runs, isLoading, refetch: refetchRuns } = useRevRenderRunsQuery(
    lead?._id || ''
  );

  const orderedRuns = React.useMemo(() => {
    const pairs = buildRevRenderPairs(runs || []);
    return [...pairs].reverse();
  }, [runs]);

  // Pre-fetch all images into persistent filesystem cache early when lead is loaded
  React.useEffect(() => {
    if (orderedRuns && orderedRuns.length > 0) {
      orderedRuns.forEach((run: any) => {
        const before = run.originalUrl || run.originalS3url;
        const after = run.generatedUrl || run.generatedS3url;
        if (before) {
          prefetchToLocalCache(before);
        }
        if (after) {
          prefetchToLocalCache(after);
        }
      });
    }
  }, [orderedRuns]);

  const [historyModal, setHistoryModal] = useState({ visible: false, index: 0 });
  const [selectedYear, setSelectedYear] = useState(3);
  const [resetView, setResetView] = useState(false);

  const findReport = (type: string) => {
    const keyword = type.split('_')[0].toLowerCase(); // 'consent', 'waiver', 'risk'
    // Search in lead top-level, and common nested outcome paths
    const reports = [
      ...(lead?.generatedReports || []),
      ...(lead?.outcomeData?.generatedReports || []),
      ...(lead?.leadData?.generatedReports || []),
      ...(lead?.outcome?.generatedReports || []),
    ];

    return reports.find(
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
      {/* Dynamic is now the primary Deal Center (schema-driven, backend config).
          The classic calculator stays as an inert fallback directly below — used
          when the backend hasn't published a dynamic config yet. */}
      {/* <ToolCard
        title="Deal Center"
        desc="Legacy calculator (fallback)"
        icon="handshake"
        onPress={onShowCalculator}
        isLoading={isCalculatorLoading}
      /> */}
      <ToolCard
        title="Deal Center"
        desc=''
        // Green status: "Calculator created" once a real calc exists, then
        // "All jobs built" once every rollout is confirmed (web parity).
        statusText={allConfirmed ? 'All jobs built' : hasCalc ? '' : undefined}
        icon="cog"
        onPress={onShowDynamicDealCenter}
      />
      <ToolCard
        title="Investment Center"
        // Locked until every rollout is confirmed (web `allJobsConfirmed`). Tapping
        // while locked warns instead of opening.
        desc={isLeadSold ? 'View finalized proposal details' : (investmentStatusPending ? 'Checking job status…' : !allConfirmed ? 'Please Fully Build ALL jobs first' : 'Present quote & 1-yr free quote')}
        statusText={allConfirmed ? (isLeadSold ? 'Sale finalized' : (consentReport ? 'Consent on file — present quote' : 'Ready to present')) : undefined}
        // "SOLD" (green) once finalized, else an "Already Generated" pill — same
        // violet design as the Customer Consent Form tag — once consent is on file.
        badgeText={isLeadSold ? 'SOLD' : (allConfirmed && consentReport ? 'Already Generated' : undefined)}
        badgeVariant={isLeadSold ? undefined : 'violet'}
        locked={!allConfirmed}
        busy={investmentStatusPending}
        icon="chart-line"
        onPress={() => {
          if (investmentStatusPending) {
            // Mid-check, so "you haven't built the jobs" would be a guess — and often
            // a wrong one, since this is exactly the window after a confirm.
            FlashMessage.info('Investment Center', 'Checking job status — one moment.');
            return;
          }
          if (!allConfirmed) {
            FlashMessage.warning('Investment Center', 'Please build and confirm all rollouts first.');
            return;
          }
          onShowInvestmentCenter();
        }}
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
              <Text className="text-base font-semibold" style={{ color: '#1C252E' }}>
                revRender
              </Text>
              {orderedRuns.length > 0 && (
                <View className="bg-[#1C252E] rounded-md">
                  <Text className="px-3 py-0.5 text-base font-semibold" style={{ color: '#ffffff' }}>
                    {orderedRuns.length} Runs
                  </Text>
                </View>
              )}
            </View>
            <Text className="text-base">Select a photo to render</Text>
          </View>
          <View>
            <View className="rounded-md" style={{ backgroundColor: colors.primary.main }}>
              <Text className="text-base font-semibold px-2" style={{ color: '#ffffff' }}>
                AI
              </Text>
            </View>
          </View>
        </View>

        {/* Progress Bar for RevRender */}
        {revRenderJobs.some((j: any) => j.status !== 'completed' && j.status !== 'failed') && (
          <View className="mb-4">
            <View className="flex-row justify-between items-center mb-1.5">
              <Text className="text-[12px] font-black text-slate-400">
                {Math.round(revRenderJobs.reduce((acc: number, j: any) => acc + (j.progress || 0), 0) / revRenderJobs.length)}%
              </Text>
            </View>
            <View className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <View
                className="h-full bg-[#2EDE56] shadow-sm shadow-[#2EDE56CC]"
                style={{ width: `${Math.round(revRenderJobs.reduce((acc: number, j: any) => acc + (j.progress || 0), 0) / revRenderJobs.length)}%` }}
              />
            </View>
          </View>
        )}

        {isLoading ? (
          <View className="flex-row">
            {[1, 2, 3].map((i) => (
              <PulsingSkeleton
                key={i}
                isDark={isDark}
                label=""
              />
            ))}
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
            {/* One skeleton PER RENDER still generating. A single job (payload) can be a
                backend batch that produces several renders (`job.total`), so render that
                many placeholders — otherwise a 2-render batch showed a single "AI
                RENDERING" tile yet finished as "2 Runs". */}
            {revRenderJobs
              .filter((j: any) => j.status !== 'completed' && j.status !== 'failed')
              .flatMap((job: any, jIdx: number) =>
                Array.from({ length: Math.max(1, Number(job.total) || 1) }).map((_, sIdx) => (
                  <PulsingSkeleton key={`skeleton-${jIdx}-${sIdx}`} isDark={isDark} />
                ))
              )}

            {orderedRuns && orderedRuns.length > 0 ? (
              orderedRuns.map((run: any, idx: number) => (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setHistoryModal({ visible: true, index: idx })}
                  className="mr-3 items-center"
                >
                  <View className="w-20 h-16 rounded-xl overflow-hidden border-2" style={{ borderColor: colors.border }}>
                    <ImageWithLoader
                      uri={run.generatedUrl || run.s3UrlGenerated}
                      colors={colors}
                    />
                  </View>
                </TouchableOpacity>
              ))
            ) : revRenderJobs.length === 0 ? (
              <Text className="text-base font-light mt-2" style={{ color: '#637381' }}>
                No generated images found in revRender runs.
              </Text>
            ) : null}
          </ScrollView>
        )}
      </TouchableOpacity>
      <ToolCard
        title="Pitch Book"
        icon="book-open-page-variant"
        onPress={onShowPitchbook}
      />
      <ToolCard
        title="Roofline Deck"
        icon="home-roof"
        onPress={onShowRooflineDeck}
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
            <Text className="text-base font-semibold" style={{ color: '#1C252E' }}>
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
                <Text className="text-[12px] font-bold text-slate-500 ">{riskJob.progress}%</Text>
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
          <Text className="text-[12px] text-slate-400 mt-1 italic">
            {riskJob.step || 'Processing...'}
          </Text>
        )}
      </View>
      <ToolCard
        title="Inspection Report"
        icon="clipboard-text"
        onPress={() => {
          onAction('inspection');
        }}
        isGenerated={false}
        isLoading={isInspectionGenerating}
      />
      <ToolCard
        title="Roof Waiver"
        // desc={waiverReport ? 'View Signed Waiver' : 'Roof waiver documents'}
        icon={waiverReport ? 'file-check' : 'home-roof'}
        onPress={handleWaiverPress}
        isGenerated={!!waiverReport}
        isLoading={isWaiverGenerating}
      />
      <ToolCard
        title="Customer Consent Form"
        desc=''
        icon={consentReport ? 'file-check' : 'file-document-edit'}
        onPress={handleConsentPress}
        isGenerated={!!consentReport}
        isLoading={isConsentGenerating}
      />

      <RevRenderHistoryModal
        visible={historyModal.visible}
        onClose={() => setHistoryModal({ ...historyModal, visible: false })}
        runs={orderedRuns}
        initialIndex={historyModal.index}
        leadId={lead?._id}
        onDeleteSuccess={refetchRuns}
      />
    </View>
  );
};

const PulsingSkeleton = ({ isDark, label = 'AI\nRendering' }: { isDark: boolean; label?: string }) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      className="w-20 h-16 rounded-xl mr-3 items-center justify-center"
      style={{
        backgroundColor: isDark ? '#1e293b' : '#f1f5f9',
        opacity: opacity
      }}
    >
      {label ? (
        <Text className="text-[10px] font-black text-slate-400 uppercase tracking-tighter text-center">{label}</Text>
      ) : null}
    </Animated.View>
  );
};

const ImageWithLoader = ({ uri, colors }: { uri: string; colors: any }) => {
  const [loading, setLoading] = useState(true);

  return (
    <View style={{ width: '100%', height: '100%', backgroundColor: '#f1f5f9' }}>
      {uri ? (
        <Image
          source={{ uri }}
          className="w-full h-full"
          resizeMode="cover"
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => setLoading(false)}
        />
      ) : null}
      {loading && (
        <View
          className="absolute inset-0 items-center justify-center bg-slate-100/50"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <ActivityIndicator size="small" color={colors.primary.main} />
        </View>
      )}
    </View>
  );
};


const ToolCard = ({ title, desc, statusText, statusColor, badgeText, badgeBg, badgeColor, badgeVariant, locked, blur, icon, onPress, onDownload, isGenerated, isLoading, busy }: any) => {
  const { colors, isDark } = useTheme();
  const green = statusColor || '#16A34A';
  // A locked card stays tappable on purpose — the parent's onPress shows a toast
  // (web parity: tapping the locked Investment Center warns "build all jobs first").
  const disabled = isLoading;
  return (
    <View
      className="mb-4 flex-row items-center p-3 rounded-lg border"
      style={{
        borderColor: '#919EAB33',
        backgroundColor: isDark ? colors.surface : colors.background,
        opacity: isLoading ? 0.6 : locked ? 0.55 : 1,
      }}
    >
      <TouchableOpacity onPress={onPress} disabled={disabled} className="flex-1 flex-row items-center">
        <View
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: isDark ? colors.grey[800] : '#919EAB1F' }}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary.main} />
          ) : (
            <Icon name={locked ? 'lock' : icon} size={16} color={isDark ? colors.grey[0] : '#637381'} />
          )}
        </View>
        <View className="flex-1 ml-4">
          <Text
            className="text-base font-semibold"
            style={{ color: locked ? '#919EAB' : isGenerated ? colors.primary.main : '#1C252E' }}
          >
            {title}
          </Text>
          {/* Green status line (e.g. "Calculator created" / "Rollout confirmed") wins
              over the plain grey subtitle when present. */}
          {statusText ? (
            <View className="flex-row items-center mt-0.5">
              <Icon name="check-circle" size={12} color={green} />
              <Text className="text-[12px] font-semibold ml-1" style={{ color: green }}>{statusText}</Text>
            </View>
          ) : desc ? (
            <Text className="text-[12px] mt-0.5" style={{ color: '#919EAB' }}>{desc}</Text>
          ) : null}
        </View>
        {/* `busy` is a LIGHT variant of `isLoading`: a small right-side spinner only,
            with the card left at full opacity and still tappable. It reports that a
            background status read is in flight (e.g. the Investment Center checking
            whether every rollout is confirmed) — `isLoading` would dim and disable the
            card, which is wrong for a refresh the rep isn't waiting on. */}
        {(isLoading || busy) && (
          <ActivityIndicator size="small" color={colors.primary.main} style={{ marginRight: 8 }} />
        )}
        {locked && !isLoading && !busy && (
            <Icon name="lock" size={12} color={'#919EAB'} style={{marginRight:8}} />
        )}
        {/* Right-side status pill. `badgeVariant: 'violet'` renders the exact same
            "Already Generated" style as the isGenerated pill below; otherwise a
            green tag (e.g. "SOLD"). */}
        {!!badgeText && !isLoading && (
          badgeVariant === 'violet' ? (
            // `self-start` aligns the pill with the title line (the row is
            // items-center, which would otherwise centre it against the 2-line block).
            <View className="bg-violet-100 px-3 py-1.5 rounded-xl border border-violet-200 shadow-sm mr-2 self-start" style={{ bottom: 2 }}>
              <Text className="text-[12px] font-semibold text-violet-700">{badgeText}</Text>
            </View>
          ) : (
            <View className="px-3 py-1.5 rounded-xl mr-2" style={{ backgroundColor: badgeBg || '#EBF9E1' }}>
              <Text className="text-[12px] font-black tracking-wide" style={{ color: badgeColor || '#16A34A' }}>{badgeText}</Text>
            </View>
          )
        )}
        {isGenerated && !isLoading && (
          <View className="bg-violet-100 px-3 py-1.5 rounded-xl border border-violet-200 shadow-sm mr-2">
            <Text className="text-[12px] font-semibold text-violet-700">Already Generated</Text>
          </View>
        )}
      </TouchableOpacity>

      {onDownload && !isLoading && (
        <TouchableOpacity
          onPress={onDownload}
          className="w-8 h-8 rounded-full items-center justify-center bg-emerald-500"
        >
          <Icon name="download" size={16} color="white" />
        </TouchableOpacity>
      )}
    </View>
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
          className="text-base font-black  tracking-widest"
          style={{ color: colors.textSecondary }}
        >
          Active Job Location
        </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('MapDetail', { currentLead: lead })}
          className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex-row items-center"
        >
          <Icon name="check-decagram" size={12} color="#10B981" />
          <Text className="text-[12px] font-black text-emerald-600 dark:text-emerald-400 ml-1 ">
            Expand Map
          </Text>
        </TouchableOpacity>
      </View>

      <Text className="text-base font-bold mb-4" style={{ color: colors.text }}>
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
