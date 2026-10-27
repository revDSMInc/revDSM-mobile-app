import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator, Animated } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { useIsOnline } from '../../../hooks/useIsOnline';
import YearDropdown from '../../components/YearDropdown';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { jobWaitState, WAITING_AMBER, WAITING_LABEL } from '../../../utils/report-job-connectivity';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useRevRenderRunsQuery } from '../../../hooks/useLeadQuery';
import { useLeadCalculatorStatus } from '../../../hooks/useLeadCalculatorStatus';
import { calcGateState } from '../../../utils/lead-calc-status';
import { isClientId } from '../../../utils/offline-lead-work';
import { runsBelongingToLead } from '../../../utils/revrender-attribution';
import { useFiledConsents } from '../../../hooks/useFiledConsents';
import { consentAlreadyFiled } from '../../../utils/consent-filed-log';
import { usePitchBooks } from '../../../hooks/usePitchBooks';
import { useQueuedConsentForms } from '../../../hooks/useQueuedConsentForms';
import type { PitchBookSummary } from '../../../utils/pitch-book';
import { useFocusEffect } from '@react-navigation/native';
import { FlashMessage } from '../../../config/message';
import { RevRenderHistoryModal } from '../../modals/lead-center/RevRenderHistoryModal';
import { getWarmedLocalUri, warmToLocalCache } from '../../../utils/imageFileCache';
import { queueCounts, queueProgress } from '../../../utils/revrender-jobs';
import { revRenderStageWord, stepShownPercent } from '../../../utils/revrender-stage';

const QUEUED_FORM = { reportType: 'queued-offline', __queuedOffline: true } as const;

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
  onRetryAllRevRenders,
  onDismissAllRevRenders,
  isConsentGenerating,
  isWaiverGenerating,
  isInspectionGenerating,
  isCalculatorLoading,
}: any) => {
  const { colors, isDark } = useTheme();

  const {
    data: calcStatus,
    refetch: refetchCalcStatus,
    isFetching: isCalcStatusFetching,
    isSuccess: hasCalcStatusAnswered,
  } = useLeadCalculatorStatus(lead);
  const hasCalc = !!calcStatus?.hasCalculator;
  const isLeadSold = lead?.status === 'sale';
  const allConfirmed = !!calcStatus?.allConfirmed || isLeadSold;

  /**
   * ⚠️ "Don't know" is NOT "not built". `calcStatus` is null when every attempt to read the
   * status failed and nothing was cached; locking on that is what showed a rep "Please Fully
   * Build ALL jobs first" seconds after they had built them. Unknown stays unlocked and says
   * it is still checking - a wrong lock costs a sale, a wrong unlock costs one tap.
   */
  /**
   * ⚠️ A lead created OFFLINE has no server record, so the status read always fails. Without
   * this it resolved to "unknown", which does not lock - and a rep could open the Investment
   * Center seconds after creating a lead, before building a single rollout.
   */
  const isDeviceOnlyLead = isClientId(String(lead?._id || lead?.id || ''));
  const isOnlineNow = useIsOnline();
  const gate = calcGateState(calcStatus, {
    isSold: isLeadSold,
    isDeviceOnlyLead,
    isOffline: !isOnlineNow,
    hasAnswered: hasCalcStatusAnswered,
  });
  const investmentLocked = gate === 'locked';
  // The background refetch spinner only matters when jobs EXIST but are not confirmed yet (the post-confirm window);
  // a lead with no calculators has nothing to wait for, so it must not flash "Checking job status..." on every visit.
  const investmentStatusPending = gate === 'unknown' || (isCalcStatusFetching && !allConfirmed && hasCalc);
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
            s3UrlOriginal: r?.s3UrlOriginal || null,
            s3UrlGenerated: r?.s3UrlGenerated || null,
            originalS3url: r?.s3UrlOriginal || null,
            generatedS3url: r?.s3UrlGenerated || null,
            s3url: r?.s3url || null,
            bucketName: r?.bucketName || null,
            category: r?.category || null,
            subcategory: r?.subcategory || null,
            viewLabel: r?.viewLabel || null,
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

  const renderCounts = queueCounts(revRenderJobs);
  // Real-time bar: re-evaluate the estimate twice a second while anything is still rendering (nothing ticks otherwise).
  const [renderNow, setRenderNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!revRenderJobs.some((j: any) => j.status === 'running' || j.status === 'pending')) return;
    const t = setInterval(() => setRenderNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [revRenderJobs]);
  const renderPercent = queueProgress(revRenderJobs, renderNow);
  // DISPLAYED percent: steps one stage per tick so every word is seen, and after the server says done the bar runs to 100 and
  // plays any remaining words before the card hides.
  const hasActiveNow = revRenderJobs.some((j: any) => j.status !== 'completed' && j.status !== 'failed');
  const anyFailedNow = revRenderJobs.some((j: any) => j.status === 'failed');
  const [sequenceOn, setSequenceOn] = React.useState(false);
  const [shownPercent, setShownPercent] = React.useState(0);
  const stageTarget = hasActiveNow ? renderPercent : sequenceOn ? 100 : 0;
  React.useEffect(() => {
    if (hasActiveNow) setSequenceOn(true);
    else if (anyFailedNow) {
      setSequenceOn(false);
      setShownPercent(0);
    }
  }, [hasActiveNow, anyFailedNow]);
  React.useEffect(() => {
    if (!sequenceOn) return;
    const t = setInterval(() => setShownPercent((s) => stepShownPercent(s, stageTarget)), 700);
    return () => clearInterval(t);
  }, [sequenceOn, stageTarget]);
  React.useEffect(() => {
    if (hasActiveNow || !sequenceOn || shownPercent < 100) return;
    const t = setTimeout(() => {
      setSequenceOn(false);
      setShownPercent(0);
    }, 1200);
    return () => clearTimeout(t);
  }, [hasActiveNow, sequenceOn, shownPercent]);
  const showRevRenderProgress = sequenceOn || hasActiveNow;
  const hasActiveJobs = revRenderJobs.some(
    (j: any) => j.status !== 'completed' && j.status !== 'failed'
  );
  /**
   * Every render that failed, shown as ONE row rather than one card each - a batch of views
   * fails together and the rep's action is the same for all of them.
   */
  const failedRenders = revRenderJobs.filter((j: any) => j.status === 'failed');
  /** Any still-running render whose last status poll could not reach the server. */
  const revRenderWaiting = revRenderJobs.some(
    (j: any) => j.waiting && j.status !== 'completed' && j.status !== 'failed'
  );
  const { data: runs, isLoading, refetch: refetchRuns } = useRevRenderRunsQuery(
    lead?._id || ''
  );

  const orderedRuns = React.useMemo(() => {
    /**
     * ⚠️ Filtered AGAIN here, although the query already does it. A cache written before that
     * guard existed still holds another lead's runs, and a device-only lead must show none
     * whatever is on disk. `buildRevRenderPairs` drops each run's `leadId`, so this is the last
     * point where ownership can still be checked.
     */
    const owned = isDeviceOnlyLead ? [] : runsBelongingToLead(runs || [], lead?._id);
    const pairs = buildRevRenderPairs(owned);
    return [...pairs].reverse();
  }, [runs, lead?._id, isDeviceOnlyLead]);

  React.useEffect(() => {
    if (orderedRuns && orderedRuns.length > 0) {
      orderedRuns.forEach((run: any) => {
        const before = run.originalUrl || run.originalS3url;
        const after = run.generatedUrl || run.generatedS3url;
        if (before) {
          warmToLocalCache(before).catch(() => {});
        }
        if (after) {
          warmToLocalCache(after).catch(() => {});
        }
      });
    }
  }, [orderedRuns]);

  const [historyModal, setHistoryModal] = useState({ visible: false, index: 0 });
  const [selectedYear, setSelectedYear] = useState(3);
  const [resetView, setResetView] = useState(false);

  const findReport = (type: string) => {
    const keyword = type.split('_')[0].toLowerCase(); // 'consent', 'waiver', 'risk'
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

  const queuedForms = useQueuedConsentForms(lead);
  /**
   * ⚠️ THREE sources, not one. Each alone has a blind spot, and the gap between them let a rep
   * take a SECOND signature for a consent they had already filed:
   *  - the generatedReport is server data, absent whenever the lead came from an older cache;
   *  - the queue only ever knows about forms submitted OFFLINE;
   *  - the local log is the one that covers "submitted online, read back offline".
   */
  const filedLocally = useFiledConsents(lead);
  const consentReport =
    findReport('consent_form') ||
    (consentAlreadyFiled({ queued: queuedForms.consent, filedLocally: filedLocally.consent })
      ? QUEUED_FORM
      : undefined);
  const waiverReport =
    findReport('waiver_form') ||
    (consentAlreadyFiled({ queued: queuedForms.waiver, filedLocally: filedLocally.waiver })
      ? QUEUED_FORM
      : undefined);
  const inspectionReport = findReport('inspection_report');
  const riskReport = findReport('risk_report');

  useEffect(() => {
    if (!riskReport) {
      setResetView(false);
    }
  }, [riskReport]);

  /**
   * ⚠️ Both of these just dispatch. The "already filed" decision belongs in ONE place -
   * `useLeadCenterModals`'s `onToolAction`, which already opens the filed PDF, or says the PDF
   * needs a connection when offline. Re-deciding it here is what produced three separate rounds
   * of this bug; do not add a second gate to these handlers.
   */
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
        statusText={allConfirmed ? 'All jobs built' : hasCalc ? '' : undefined}
        icon="cog"
        onPress={onShowDynamicDealCenter}
      />
      <ToolCard
        title="Investment Center"
        desc={isLeadSold ? 'View finalized proposal details' : (investmentStatusPending ? 'Checking job status…' : investmentLocked ? 'Please Fully Build ALL jobs first' : 'Present quote & 1-yr free quote')}
        statusText={allConfirmed ? (isLeadSold ? 'Sale finalized' : (consentReport ? 'Consent on file — present quote' : 'Ready to present')) : undefined}
        badgeText={isLeadSold ? 'SOLD' : (allConfirmed && consentReport ? 'Already Generated' : undefined)}
        badgeVariant={isLeadSold ? undefined : 'violet'}
        locked={investmentLocked}
        busy={investmentStatusPending}
        icon="chart-line"
        onPress={() => {
          // ⚠️ Only a DEFINITE "not built" refuses. When the status is unknown (every read
          // failed and nothing is cached) the rep goes through: a stale lock in front of a
          // customer is far more expensive than opening a screen that turns out to be empty.
          if (gate === 'locked') {
            FlashMessage.warning('Investment Center', 'Please build and confirm all rollouts first.');
            return;
          }
          if (gate === 'unknown') refetchCalcStatus?.();
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
        <View className="flex-row items-center justify-between mb-4" style={{ minHeight: TOOL_CARD_MIN_HEIGHT - 24 }}>
          <ToolIconCircle isDark={isDark} colors={colors}>
            <Ionicons name="image" size={16} color={isDark ? colors.grey[0] : '#637381'} />
          </ToolIconCircle>
          <View className="flex-1 ml-4">
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
            <Text className="text-[12px] mt-0.5" style={{ color: '#919EAB' }}>
              Select a photo to render
            </Text>
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
        {showRevRenderProgress && (
          <View className="mb-4">
            <View className="flex-row justify-between items-center mb-1.5">
              <View className="flex-row items-center">
                <ActivityIndicator size="small" color={revRenderWaiting ? WAITING_AMBER : colors.primary.main} />
                <Text className="text-[12px] font-black ml-2" style={{ color: revRenderWaiting ? WAITING_AMBER : '#637381' }}>
                  {revRenderWaiting ? 'Paused' : revRenderStageWord(shownPercent)} {renderCounts.label ? `· ${renderCounts.label}` : ''}
                </Text>
              </View>
              <Text className="text-[12px] font-black text-slate-400">{shownPercent}%</Text>
            </View>
            <View className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <View
                className={`h-full ${
                  revRenderWaiting ? 'bg-amber-500' : 'bg-[#2EDE56] shadow-sm shadow-[#2EDE56CC]'
                }`}
                style={{ width: `${shownPercent}%` }}
              />
            </View>
            {/* The bar is a live ESTIMATE (`estimateJobProgress`): eased from the moment each render was sent, capped below 100 until
                the server says done, raised by any real batch progress, and FROZEN while the status check cannot reach the server. */}
            {revRenderWaiting && (
              <View className="flex-row items-center gap-1.5 mt-1.5">
                <Icon name="cloud-off-outline" size={14} color={WAITING_AMBER} />
                <Text className="text-[12px] text-amber-700 font-semibold flex-1">
                  {WAITING_LABEL}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Renders that did NOT start / finish keep their payload until the rep retries or
            dismisses them - a failed batch never wipes the queue.

            ⚠️ ONE ROW FOR THE WHOLE BATCH, not one card each. A batch fails as a batch: five
            views of one house lose the same download and produced five identical cards
            ("Front - not rendered / Failed to download house image"), which filled the Tools
            panel and buried the controls under it. The per-view detail said nothing the rep
            could act on differently - the action is the same for all of them. */}
        {failedRenders.length > 0 && (
          <View
            className="mb-3 px-3 py-2.5 rounded-xl border flex-row items-center"
            style={{ borderColor: '#FECACA', backgroundColor: '#FEF2F2' }}
          >
            <Icon
              name={failedRenders[0].errorKind === 'network' ? 'wifi-off' : 'alert-circle-outline'}
              size={16}
              color="#B91C1C"
            />
            <Text
              className="text-[13px] font-bold flex-1 ml-2"
              style={{ color: '#991B1B' }}
              numberOfLines={1}
            >
              {failedRenders.length === 1
                ? 'RevRender failed'
                : `RevRender failed (${failedRenders.length})`}
            </Text>
            <TouchableOpacity
              onPress={() => onDismissAllRevRenders?.()}
              className="px-2.5 py-1.5 rounded-lg"
              accessibilityLabel="Dismiss failed renders"
            >
              <Text className="text-[12px] font-bold" style={{ color: '#991B1B' }}>
                Dismiss
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onRetryAllRevRenders?.()}
              className="px-3 py-1.5 rounded-lg ml-1"
              style={{ backgroundColor: '#B91C1C' }}
              accessibilityLabel={failedRenders.length === 1 ? 'Retry render' : 'Retry all renders'}
            >
              <Text className="text-[12px] font-bold" style={{ color: '#FFFFFF' }}>
                {failedRenders.length === 1 ? 'Retry' : 'Retry all'}
              </Text>
            </TouchableOpacity>
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
      <PitchBookCard onOpen={onShowPitchbook} />
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
                {/* ⚠️ No spinner while waiting — a spinning indicator beside "waiting for signal"
                    contradicts the sentence next to it and reads as work in progress. */}
                {riskJob.waiting ? (
                  <Icon name="cloud-off-outline" size={16} color={WAITING_AMBER} />
                ) : (
                  <ActivityIndicator size="small" color={colors.primary.main} />
                )}
                <Text className="text-[12px] font-bold text-slate-500 ">{riskJob.progress}%</Text>
              </View>
            )}
          </View>
        </View>

        {/* Progress Bar for Risk Job */}
        {riskJob && riskJob.status !== 'completed' && (
          <View className="mt-3 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <View
              className={`h-full ${riskJob.waiting ? 'bg-amber-500' : 'bg-[#4CBB17]'}`}
              style={{ width: `${riskJob.progress}%` }}
            />
          </View>
        )}
        {riskJob && riskJob.status !== 'completed' && (
          <Text
            className={`text-[12px] mt-1 ${
              riskJob.waiting ? 'text-amber-700 font-semibold' : 'text-slate-400 italic'
            }`}
          >
            {jobWaitState(riskJob.step, !!riskJob.waiting).label}
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
  const seeded = getWarmedLocalUri(uri);
  const [localUri, setLocalUri] = useState<string | null>(seeded);
  const [loading, setLoading] = useState(!seeded);

  useEffect(() => {
    if (!uri) return;
    const known = getWarmedLocalUri(uri);
    if (known) {
      setLocalUri(known);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    warmToLocalCache(uri)
      .then((file) => {
        if (!cancelled) setLocalUri(file || uri);
      })
      .catch(() => {
        if (!cancelled) setLocalUri(uri);
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <View style={{ width: '100%', height: '100%', backgroundColor: '#f1f5f9' }}>
      {localUri ? (
        <Image
          source={{ uri: localUri }}
          className="w-full h-full"
          resizeMode="cover"
          fadeDuration={0}
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


const TOOL_CARD_MIN_HEIGHT = 68;

const ToolIconCircle = ({ isDark, colors, children }: any) => (
  <View
    className="w-8 h-8 rounded-full items-center justify-center"
    style={{ backgroundColor: isDark ? colors.grey[800] : '#919EAB1F' }}
  >
    {children}
  </View>
);

const PitchBookCard = ({ onOpen }: { onOpen: (book?: PitchBookSummary) => void }) => {
  const { colors, isDark } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { data: books = [], isLoading, isError, refetch, isFetching } = usePitchBooks();
  const hasBooks = books.length > 0;

  const subtitle = hasBooks
    ? `${books.length} pitch book${books.length === 1 ? '' : 's'} available`
    : isLoading || isFetching
    ? 'Loading pitch books…'
    : isError
    ? "Couldn't load pitch books — tap ↻ to retry"
    : '';

  return (
    <View
      className="mb-4 rounded-lg border"
      style={{
        minHeight: TOOL_CARD_MIN_HEIGHT,
        justifyContent: 'center',
        borderColor: '#919EAB33',
        backgroundColor: isDark ? colors.surface : colors.background,
      }}
    >
      <TouchableOpacity
        onPress={() => (hasBooks ? setExpanded((v) => !v) : onOpen())}
        className="flex-row items-center p-3"
      >
        <ToolIconCircle isDark={isDark} colors={colors}>
          <Icon
            name="book-open-page-variant"
            size={16}
            color={isDark ? colors.grey[0] : '#637381'}
          />
        </ToolIconCircle>
        <View className="flex-1 ml-4">
          <Text className="text-base font-semibold" style={{ color: '#1C252E' }}>
            Pitch Book
          </Text>
          {!!subtitle && (
            <Text className="text-[12px] mt-0.5" style={{ color: '#919EAB' }}>
              {subtitle}
            </Text>
          )}
        </View>
        {(isLoading || isFetching) && !hasBooks ? (
          <ActivityIndicator size="small" color={colors.primary.main} />
        ) : hasBooks ? (
          <Icon
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={isDark ? colors.grey[0] : '#637381'}
          />
        ) : null}
      </TouchableOpacity>

      {/* Retry sits OUTSIDE the row's press target so the row keeps opening the
          bundled deck — a rep mid-pitch must never be blocked by a failed list. */}
      {isError && !hasBooks && !isFetching && (
        <TouchableOpacity
          onPress={() => refetch()}
          className="absolute right-3 top-3 w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: isDark ? colors.grey[800] : '#919EAB1F' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="refresh" size={16} color={isDark ? colors.grey[0] : '#637381'} />
        </TouchableOpacity>
      )}

      {expanded && hasBooks && (
        <View className="px-3 pb-3">
          {books.map((book) => (
            <TouchableOpacity
              key={book.bookId}
              onPress={() => onOpen(book)}
              className="flex-row items-center p-2 mt-2 rounded-lg border"
              style={{
                borderColor: '#919EAB33',
                backgroundColor: isDark ? colors.background : '#919EAB14',
              }}
            >
              <View
                className="w-12 h-9 rounded-md overflow-hidden items-center justify-center"
                style={{ backgroundColor: isDark ? colors.grey[800] : '#FFFFFF' }}
              >
                {book.thumbnailUri ? (
                  <Image
                    source={{ uri: book.thumbnailUri }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                ) : (
                  <Icon name="file-image-outline" size={16} color="#919EAB" />
                )}
              </View>
              <View className="flex-1 ml-3">
                <Text
                  className="text-sm font-semibold"
                  style={{ color: '#1C252E' }}
                  numberOfLines={1}
                >
                  {book.bookName}
                </Text>
                <Text className="text-[12px] mt-0.5" style={{ color: '#919EAB' }}>
                  {book.slideCount} slide{book.slideCount === 1 ? '' : 's'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#919EAB" />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

const ToolCard = ({ title, desc, statusText, statusColor, badgeText, badgeBg, badgeColor, badgeVariant, locked, blur, icon, onPress, onDownload, isGenerated, isLoading, busy }: any) => {
  const { colors, isDark } = useTheme();
  const green = statusColor || '#16A34A';
  const disabled = isLoading;
  const pillGap = onDownload ? 8 : 0;
  return (
    <View
      className="mb-4 flex-row items-center p-3 rounded-lg border"
      style={{
        minHeight: TOOL_CARD_MIN_HEIGHT,
        borderColor: '#919EAB33',
        backgroundColor: isDark ? colors.surface : colors.background,
        opacity: isLoading ? 0.6 : locked ? 0.55 : 1,
      }}
    >
      <TouchableOpacity onPress={onPress} disabled={disabled} className="flex-1 flex-row items-center">
        <ToolIconCircle isDark={isDark} colors={colors}>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary.main} />
          ) : (
            <Icon name={locked ? 'lock' : icon} size={16} color={isDark ? colors.grey[0] : '#637381'} />
          )}
        </ToolIconCircle>
        <View className="flex-1 ml-4" style={{ minWidth: 0 }}>
          <Text
            className="text-base font-semibold"
            style={{ color: locked ? '#919EAB' : isGenerated ? colors.primary.main : '#1C252E' }}
          >
            {title}
          </Text>
          {/* Green status line (e.g. "Calculator created" / "Rollout confirmed") wins
              over the plain grey subtitle when present. */}
          {statusText ? (
            <View className="flex-row items-center mt-0.5 pr-1">
              <Icon name="check-circle" size={12} color={green} />
              {/* `shrink`: a Text in a row does NOT shrink by default, so a long status
                  ("Consent on file - present quote") ran on under the right-side pill. */}
              <Text className="shrink text-[12px] font-semibold ml-1" style={{ color: green }}>{statusText}</Text>
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
            <View className="bg-violet-100 px-2.5 py-1 rounded-xl border border-violet-200 shadow-sm" style={{ flexShrink: 0, marginRight: pillGap }}>
              <Text className="text-[11px] font-semibold text-violet-700" maxFontSizeMultiplier={1.1}>{badgeText}</Text>
            </View>
          ) : (
            <View className="px-2.5 py-1 rounded-xl" style={{ backgroundColor: badgeBg || '#EBF9E1', flexShrink: 0, marginRight: pillGap }}>
              <Text className="text-[11px] font-black tracking-wide" maxFontSizeMultiplier={1.1} style={{ color: badgeColor || '#16A34A' }}>{badgeText}</Text>
            </View>
          )
        )}
        {isGenerated && !isLoading && (
          <View className="bg-violet-100 px-2.5 py-1 rounded-xl border border-violet-200 shadow-sm" style={{ flexShrink: 0, marginRight: pillGap }}>
            <Text className="text-[11px] font-semibold text-violet-700" maxFontSizeMultiplier={1.1}>Already Generated</Text>
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
