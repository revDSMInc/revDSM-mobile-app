import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, ActivityIndicator, Animated } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import YearDropdown from '../../components/YearDropdown';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useRevRenderRunsQuery } from '../../../hooks/useLeadQuery';
import { useLeadCalculatorStatus } from '../../../hooks/useLeadCalculatorStatus';
import { usePitchBooks } from '../../../hooks/usePitchBooks';
import { useQueuedConsentForms } from '../../../hooks/useQueuedConsentForms';
import type { PitchBookSummary } from '../../../utils/pitch-book';
import { useFocusEffect } from '@react-navigation/native';
import { FlashMessage } from '../../../config/message';
import { RevRenderHistoryModal } from '../../modals/lead-center/RevRenderHistoryModal';
import { getWarmedLocalUri, warmToLocalCache } from '../../../utils/imageFileCache';

/**
 * Stands in for a server report on a form this device is still holding.
 *
 * ⚠️ It carries NO `reportPath`, deliberately — there is no filed document to open yet, and the
 * tool-action guard tells the rep so rather than handing a viewer an empty url.
 */
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
            // Keep the backend's own key names too (`RevRenderHistoryModal`'s view-logged
            // event reads these) — this pair shape used to drop them, so that log's
            // originalS3url/generatedS3url fields always came back null on this screen.
            s3UrlOriginal: r?.s3UrlOriginal || null,
            s3UrlGenerated: r?.s3UrlGenerated || null,
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

  // Pre-fetch all images into the persistent filesystem cache early when the lead loads.
  //
  // ⚠️ `warmToLocalCache`, NOT `prefetchToLocalCache`. Both write the same file, but only
  // this one records it in the warmed-uri memo, which is what lets `ImageWithLoader` name
  // the local copy SYNCHRONOUSLY on a remount. With the bare prefetch the strip still had
  // to rediscover the file asynchronously every time, so it re-armed its spinners on every
  // tab switch — the "the renders load again each time I come into Tools" report.
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

  /**
   * ⚠️ A form signed at a door counts as ON FILE here, exactly as it does for the Investment
   * Center's own gate. `findReport` reads the SERVER's `generatedReports`, which offline says no
   * however many forms are queued — so the rep signed a consent, walked back to Tools, and was
   * shown an un-badged **Customer Consent Form** that re-opened blank when tapped. In front of
   * the customer who had just signed it.
   */
  const queuedForms = useQueuedConsentForms(lead);
  const consentReport = findReport('consent_form') || (queuedForms.consent ? QUEUED_FORM : undefined);
  const waiverReport = findReport('waiver_form') || (queuedForms.waiver ? QUEUED_FORM : undefined);
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

/**
 * A render thumbnail in the revRender strip, served from the local file cache.
 *
 * ⚠️ It must NOT render the `uri` it is handed. Render urls are pre-signed S3 links with
 * no cache headers, so the OS image cache refuses to store them and every mount
 * re-downloads — and the Tools tab unmounts entirely on a switch to Job docs
 * (`activeTab === 'tools' && <ToolsSection/>`), so coming back re-downloaded every
 * render. Worse, the runs query re-signs the urls, so even RN's in-memory cache misses
 * on the way back. The file cache keys on the url with the query stripped, which is what
 * makes the second visit a hit.
 *
 * ⚠️ No `onLoadStart={() => setLoading(true)}` either. It re-armed the spinner on every
 * remount over an image that was about to paint from disk, which is most of what the rep
 * actually saw.
 */
const ImageWithLoader = ({ uri, colors }: { uri: string; colors: any }) => {
  // Seeded synchronously: a warmed render paints on the first frame, with no spinner.
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


/**
 * Pitch Book tile — the entry point for the PORTAL-AUTHORED pitch books.
 *
 * A manager can now publish several books (uploaded as PDFs and parsed into slides
 * on the portal), so the rep has to choose one before presenting. The tile keeps the
 * usual `ToolCard` frame and adds a chevron that expands the published list in
 * place; picking a book hands its `bookId` to the Pitchbook screen.
 *
 * With nothing published — a company that hasn't configured any, or a failed list
 * read — the tile behaves exactly as it did before: one tap opens the bundled deck.
 * The dynamic list is an addition, never a way to end up with no pitch book at all.
 */
/**
 * Every Tools tile is the same card: 12pt inner padding on all four sides, a 16pt gap
 * below, and this minimum height so a one-line tile (Roofline Deck) is not shorter than
 * a two-line one (Deal Center, Pitch Book). The content row inside is centred.
 */
const TOOL_CARD_MIN_HEIGHT = 68;

/**
 * The ONE icon badge every Tools tile uses (32pt grey circle). revRender used to draw its
 * own 48pt white square, so it was the odd one out in the list - route every tile through
 * this so the shape, size and colour cannot drift again.
 */
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

  // A failed list read must NOT read as "nothing published" — the fallback below is
  // deliberately quiet (it still opens the bundled deck), so without this the two are
  // indistinguishable on screen and a 404 looks like an empty, correctly-working card.
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
  // A locked card stays tappable on purpose — the parent's onPress shows a toast
  // (web parity: tapping the locked Investment Center warns "build all jobs first").
  const disabled = isLoading;
  // The pills sit flush with the card's right padding (the same edge the revRender "AI"
  // badge and the Pitch Book chevron end on). The old fixed `mr-2` pushed them 8pt in; a gap
  // is only needed when the download button follows.
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
            // `self-start` aligns the pill with the title line (the row is
            // items-center, which would otherwise centre it against the 2-line block).
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
