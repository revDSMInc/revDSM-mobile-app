import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  StyleSheet,
  Animated,
  Platform,
  Modal,
  StatusBar,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import pitchBookImagesDefault from '../../constants/pitchbook-images';
import greenRooflinesImages, {
  GREEN_ROOFLINES_COMPANY_ID,
  GREEN_ROOFLINES_CATEGORIES,
} from '../../constants/green-rooflines-pitchbook';
import { InspectionPhotosPanel } from '../../widgets/components/InspectionPhotosPanel';
import { buildInspectionSections } from '../../utils/inspection-photos';
import { ZoomableImage } from '../../widgets/common/ZoomableImage';
import { getWarmedLocalUri } from '../../utils/imageFileCache';
import { PresentationGesturesTutorial } from '../../widgets/components/pitchbook/PresentationGesturesTutorial';
import {
  PresentationDock,
  GREEN as DOCK_TAB_GREEN,
  type DockMode,
} from '../../widgets/components/pitchbook/PresentationDock';
import { PresentationTopBar } from '../../widgets/components/pitchbook/PresentationTopBar';
import { SlideArrows } from '../../widgets/components/pitchbook/SlideArrows';
import {
  PRESENTATION_TUTORIAL_SEEN_KEY,
  PRESENTATION_TUTORIAL_SEEN_VALUE,
  CHROME_AUTO_HIDE_MS,
  shouldShowPresentationTutorial,
  swipeDirection,
} from '../../utils/presentation-tutorial';
import { Storage } from '../../utils/storage';
import {
  PhotoPeekScrollLockProvider,
  PeekAwareScrollView,
} from '../../widgets/common/PhotoPeekScrollLock';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import IonIcon from 'react-native-vector-icons/Ionicons';
import { Header } from '../../widgets/common/MainHeader';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation';
import { LeadService } from '../../services/api/leads';
import { ActivityIndicator, Linking, Alert } from 'react-native';
import { useLeadReports } from '../../hooks/useLeadReports';
import YearDropdown from '../../widgets/components/YearDropdown';
import { ENV } from '../../config/env';

import { PdfPreviewModal } from '../../widgets/modals/PdfPreviewModal';
import { downloadPdfToDevice } from '../../utils/download-utils';
import { storage } from '../../utils/storage';
import { triggerLightTap, prepareHaptic } from '../../utils/haptics';
import { useSecureUrls } from '../../hooks/useSecureUrls';
import { usePitchBookDeck } from '../../hooks/usePitchBooks';
import { useIsOnline } from '../../hooks/useIsOnline';
import { useTabStripAutoScroll } from '../../hooks/useTabStripAutoScroll';
import Feather from 'react-native-vector-icons/Feather';
import { useAuth } from '../../hooks/useAuth';
import { logEvent } from '../../services/api/LoggerService';
import { reportDisplayName } from '../../utils/report-name';

const { width } = Dimensions.get('window');

const progressKey = (leadId?: string | null, bookId?: string | null) =>
  `pitchbook-progress-${leadId || 'default'}${bookId ? `-${bookId}` : ''}`;

const DEFAULT_CATEGORIES = [
  { id: 'leafFilter_story', label: 'LeafFilter Story' },
  { id: 'problems_risk', label: 'Problems & Risk' },
  { id: 'rules_elimination', label: 'Rules & Elimination' },
  { id: 'product_testing', label: 'Products' },
  { id: 'our_process', label: 'Process' },
  { id: 'summary', label: 'Summary' },
];

export default function PitchbookScreen() {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const isGreenRooflines = (user?.companyId || '') === GREEN_ROOFLINES_COMPANY_ID;
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;
  const landscapeRightInset = Platform.OS === 'android' ? Math.max(insets.right || 0, 48) : (insets.right || 0);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { lead, bookId, bookName } = (route.params as any) || {};
  const leadId = lead?._id || lead?.id || null;

  const {
    data: remoteDeck,
    isLoading: isDeckLoading,
    isError: isDeckError,
    refetch: refetchDeck,
  } = usePitchBookDeck(bookId);
  const isRemoteDeck = !!bookId;
  const isPitchbookOnline = useIsOnline();

  const CATEGORIES = useMemo(
    () =>
      isRemoteDeck
        ? remoteDeck?.categories || []
        : isGreenRooflines
        ? GREEN_ROOFLINES_CATEGORIES
        : DEFAULT_CATEGORIES,
    [isRemoteDeck, remoteDeck, isGreenRooflines]
  );
  const pitchBookImages: Record<string, Record<string, any>> = useMemo(
    () =>
      isRemoteDeck
        ? remoteDeck?.images || {}
        : isGreenRooflines
        ? greenRooflinesImages
        : pitchBookImagesDefault,
    [isRemoteDeck, remoteDeck, isGreenRooflines]
  );
  const defaultCategoryId = isRemoteDeck
    ? remoteDeck?.categories?.[0]?.id || ''
    : isGreenRooflines
    ? 'green_rooflines'
    : 'leafFilter_story';
  const deckTitle = (isRemoteDeck && (remoteDeck?.bookName || bookName)) || 'Pitch Book';

  const savedProgress = useMemo(() => {
    try {
      const raw = storage.getString(progressKey(leadId, bookId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.category === 'string' && typeof parsed.slideIndex === 'number') {
        return parsed as { category: string; slideIndex: number };
      }
    } catch (e) { }
    return null;
  }, [leadId, bookId]);

  const [viewMode, setViewMode] = useState<'rep' | 'homeowner'>('rep');
  const [activeCategory, setActiveCategory] = useState(() => {
    const saved = savedProgress?.category;
    return saved && CATEGORIES.some((c) => c.id === saved) ? saved : defaultCategoryId;
  });
  const [currentSlideIndex, setCurrentSlideIndex] = useState(savedProgress?.slideIndex || 0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showTools, setShowTools] = useState(false);

  const [showGestureTutorial, setShowGestureTutorial] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  const [chromeNudge, setChromeNudge] = useState(0);

  const [dockMode, setDockMode] = useState<DockMode>('slides');

  const chromeShown = chromeVisible && !showGestureTutorial;

  useEffect(() => {
    if (!isFullscreen || !chromeVisible || showGestureTutorial || dockMode === 'tools') return;
    const timer = setTimeout(() => setChromeVisible(false), CHROME_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [isFullscreen, chromeVisible, showGestureTutorial, dockMode, chromeNudge]);

  const toggleChrome = useCallback(() => {
    if (showGestureTutorial) return;
    if (chromeVisible) {
      setChromeVisible(false);
      return;
    }
    setChromeVisible(true);
    setChromeNudge((n) => n + 1);
  }, [showGestureTutorial, chromeVisible]);

  const keepChromeAlive = useCallback(() => setChromeNudge((n) => n + 1), []);

  const fullscreenTopInset = (isLandscape ? 12 : Math.max(insets.top, 44)) + 8;

  const fullscreenLeftInset = isLandscape ? Math.max(insets.left || 0, 44) : 12;
  const fullscreenRightInset = isLandscape ? Math.max(landscapeRightInset, 44) : 12;

  const fullscreenBottomInset = Math.max(insets.bottom, isLandscape ? 12 : 24);
  const [activeToolTab, setActiveToolTab] = useState('inspection');
  const [loading, setLoading] = useState(true);
  const [fullLeadData, setFullLeadData] = useState<any>(null);

  const activePhotos = useMemo(() => {
    return fullLeadData?.outcome?.salesPhotos || fullLeadData?.salesPhotos || lead?.salesPhotos || [];
  }, [fullLeadData, lead]);

  const { data: secureImages = {} } = useSecureUrls(activePhotos);

  const hasInspectionPhotos = useMemo(
    () => buildInspectionSections(activePhotos, secureImages).length > 0,
    [activePhotos, secureImages]
  );

  const toolsAnim = useRef(new Animated.Value(0)).current;

  const logTool = (
    action: string,
    meta: Record<string, unknown> = {},
    surface: 'sheet' | 'dock' = isFullscreen ? 'dock' : 'sheet'
  ) => {
    const userId = user?._id || user?.id;
    if (!userId) return;
    const eventType =
      action === 'sheet_opened' || action === 'dock_opened'
        ? 'view'
        : action === 'sheet_closed' || action === 'dock_closed'
          ? 'close'
          : 'click';
    logEvent(eventType, {
      user_id: userId,
      module_type: 'interactive_tool',
      created_by: userId,
      meta: {
        leadId,
        bookId: bookId || null,
        action: `interactive_tool_${action}`,
        surface,
        activeToolTab,
        slideTab: activeCategory,
        currentSlide: currentGlobalPageNumber,
        currentSlideName: getCurrentSlideName(activeCategory, currentSlideIndex),
        totalSlides: totalGlobalPages,
        ...meta,
      },
    });
  };

  const toggleTools = (source: string) => {
    logTool(showTools ? 'sheet_closed' : 'sheet_opened', { source }, 'sheet');
    const toValue = showTools ? 0 : 1;
    Animated.spring(toolsAnim, {
      toValue,
      useNativeDriver: true,
      friction: 8,
      tension: 40,
    }).start();
    setShowTools(!showTools);
  };

  useEffect(() => {
    if (!isFullscreen) return;

    StatusBar.setHidden(true, 'fade');
    setChromeVisible(true);
    setDockMode('slides');
    if (shouldShowPresentationTutorial(Storage.getItem(PRESENTATION_TUTORIAL_SEEN_KEY))) {
      setShowGestureTutorial(true);
    }

    return () => StatusBar.setHidden(false, 'fade');
  }, [isFullscreen]);

  const dismissGestureTutorial = useCallback(() => setShowGestureTutorial(false), []);

  const neverShowGestureTutorial = useCallback(() => {
    Storage.setItem(PRESENTATION_TUTORIAL_SEEN_KEY, PRESENTATION_TUTORIAL_SEEN_VALUE);
    setShowGestureTutorial(false);
  }, []);

  const handleArrowPrev = useCallback(() => {
    keepChromeAlive();
    handlePrev();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepChromeAlive, activeCategory, currentSlideIndex]);

  const handleArrowNext = useCallback(() => {
    keepChromeAlive();
    handleNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepChromeAlive, activeCategory, currentSlideIndex]);

  const handleDockCategory = useCallback(
    (id: string) => {
      keepChromeAlive();
      handleTabChange(id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keepChromeAlive, activeCategory, currentSlideIndex]
  );

  const selectSheetTab = (id: string) => {
    if (id !== activeToolTab) logTool('tab_selected', { fromTab: activeToolTab, toTab: id, activeToolTab: id }, 'sheet');
    setActiveToolTab(id);
  };

  const handleDockMode = useCallback(
    (mode: DockMode) => {
      keepChromeAlive();
      logTool(mode === 'tools' ? 'dock_opened' : 'dock_closed', { toMode: mode, fromMode: dockMode }, 'dock');
      setDockMode(mode);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keepChromeAlive, dockMode, activeToolTab, activeCategory, currentSlideIndex]
  );

  const handleDockTool = useCallback(
    (id: string) => {
      keepChromeAlive();
      logTool('tab_selected', { fromTab: activeToolTab, toTab: id, activeToolTab: id }, 'dock');
      setActiveToolTab(id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keepChromeAlive, activeToolTab, activeCategory, currentSlideIndex]
  );

  const inlineTabStrip = useTabStripAutoScroll(activeCategory);

  const handleSlideSwipe = useCallback(
    (dx: number, dy: number) => {
      const direction = swipeDirection(dx, dy);
      if (direction === 'next') handleNext();
      else if (direction === 'prev') handlePrev();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCategory, currentSlideIndex]
  );

  const getGlobalPosition = useCallback((categoryId: string, slideIndex: number) => {
    let count = 0;
    for (const cat of CATEGORIES) {
      if (cat.id === categoryId) {
        count += slideIndex + 1;
        break;
      }
      count += Object.keys(pitchBookImages[cat.id] || {}).length;
    }
    return count;
  }, [CATEGORIES, pitchBookImages]);

  const getCurrentSlideName = useCallback((categoryId: string, slideIndex: number): string => {
    const imagesObj = pitchBookImages[categoryId] || {};
    return Object.keys(imagesObj)[slideIndex] || '';
  }, [pitchBookImages]);

  const currentCategoryImages = useMemo(() => {
    const imagesObj = pitchBookImages[activeCategory] || {};
    return Object.values(imagesObj).map((source: any) => {
      if (!source || typeof source !== 'object' || typeof source.uri !== 'string') return source;
      const local = getWarmedLocalUri(source.uri);
      return local ? { ...source, uri: local } : source;
    });
  }, [activeCategory, pitchBookImages]);

  const totalGlobalPages = useMemo(() => {
    return Object.values(pitchBookImages).reduce((acc, cat) => acc + Object.keys(cat).length, 0);
  }, [pitchBookImages]);

  const currentGlobalPageNumber = useMemo(() => {
    return getGlobalPosition(activeCategory, currentSlideIndex);
  }, [activeCategory, currentSlideIndex, getGlobalPosition]);

  const slideResetKey = `${activeCategory}:${currentSlideIndex}`;

  useEffect(() => {
    if (!CATEGORIES.length) return;
    if (CATEGORIES.some((c) => c.id === activeCategory)) return;
    const saved = savedProgress?.category;
    const restorable = !!saved && CATEGORIES.some((c) => c.id === saved);
    setActiveCategory(restorable ? (saved as string) : CATEGORIES[0].id);
    setCurrentSlideIndex(restorable ? savedProgress?.slideIndex || 0 : 0);
  }, [CATEGORIES, activeCategory, savedProgress]);

  useEffect(() => {
    if (!currentCategoryImages.length) return;
    if (currentSlideIndex < currentCategoryImages.length) return;
    setCurrentSlideIndex(currentCategoryImages.length - 1);
  }, [currentCategoryImages, currentSlideIndex]);

  const activeCategoryRef = useRef(activeCategory);
  const currentSlideIndexRef = useRef(currentSlideIndex);

  useEffect(() => {
    activeCategoryRef.current = activeCategory;
  }, [activeCategory]);

  useEffect(() => {
    currentSlideIndexRef.current = currentSlideIndex;
  }, [currentSlideIndex]);

  useEffect(() => {
    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('view', {
        user_id: userId,
        module_type: 'pitch_book',
        created_by: userId,
        meta: {
          leadId,
          bookId: bookId || null,
          action: 'pitch_book_opened',
          totalSlides: totalGlobalPages,
        },
      });
    }

    return () => {
      if (userId) {
        logEvent('close', {
          user_id: userId,
          module_type: 'pitch_book',
          created_by: userId,
          meta: {
            leadId,
            slideTab: activeCategoryRef.current,
            currentSlideName: getCurrentSlideName(activeCategoryRef.current, currentSlideIndexRef.current),
            currentSlide: currentSlideIndexRef.current + 1,
            totalSlides: totalGlobalPages,
            action: 'pitch_book_close',
          },
        });
      }
    };
  }, [user?._id, user?.id, leadId, bookId, totalGlobalPages, getCurrentSlideName]);

  useEffect(() => {
    if (!activeCategory) return;
    try {
      storage.set(
        progressKey(leadId, bookId),
        JSON.stringify({ category: activeCategory, slideIndex: currentSlideIndex })
      );
    } catch (e) { }
  }, [leadId, bookId, activeCategory, currentSlideIndex]);

  useEffect(() => {
    prepareHaptic('impact');
  }, []);


  const pollInterval = useRef<any>(null);

  const refetch = async () => {
    const lid = lead?._id || lead?.id;
    if (!lid) return;
    try {
      const response = await LeadService.getSalesPortalLeadById(lid);
      const data = response.data?.data?.lead || response.data?.lead;
      if (data) {
        setFullLeadData(data);
        return;
      }
    } catch {
    }
    try {
      const response = await LeadService.getSalesDealById(lid);
      const body = response.data;
      setFullLeadData(body?.data?.lead || body?.data || body?.lead || body);
    } catch {
    }
  };

  useEffect(() => {
    refetch();
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [lead?.id, lead?._id, lead?.result, lead?.status]);


  useEffect(() => {
    if (isFullscreen && isLandscape) {
      StatusBar.setHidden(true, 'fade');
    } else {
      StatusBar.setHidden(false, 'fade');
    }
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, [isFullscreen, isLandscape]);

  const [showPdfModal, setShowPdfModal] = useState(false);
  const [pdfPreviewData, setPdfPreviewData] = useState({ url: '', title: '' });

  const riskReports = useMemo(() => {
    const activeLead = fullLeadData || lead;
    const reports = [
      ...(activeLead?.generatedReports || []),
      ...(activeLead?.outcomeData?.generatedReports || []),
      ...(activeLead?.leadData?.generatedReports || []),
      ...(activeLead?.outcome?.generatedReports || []),
      ...(lead?.generatedReports || []),
      ...(lead?.outcomeData?.generatedReports || []),
      ...(lead?.leadData?.generatedReports || []),
      ...(lead?.outcome?.generatedReports || []),
    ];

    const uniqueMap = new Map();
    reports.forEach((report: any) => {
      const key = report?._id || report?.reportName || report?.url || report?.filePath;
      if (key && !uniqueMap.has(key)) {
        uniqueMap.set(key, report);
      }
    });
    const uniqueReports = Array.from(uniqueMap.values());

    return uniqueReports.filter((report: any) => {
      const name = report?.reportName || '';
      const type = report?.reportType || '';
      return name.toLowerCase().includes('risk') || type.toLowerCase().includes('risk');
    });
  }, [fullLeadData, lead]);

  const handleDownloadReport = async (report: any, index: number, isDownload: boolean = false) => {
    try {
      let url = '';
      if (report?.bucketName && report?.reportPath) {
        const response = await LeadService.getSecureUrls([
          { bucketName: report.bucketName, filePath: report.reportPath },
        ]);
        const secureData = response.data?.data || response.data || [];
        url = secureData[0]?.secureUrl;
      } else {
        url = report?.url || report?.fileUrl || report?.secureUrl;
      }

      if (url) {
        if (
          !isDownload &&
          (url.toLowerCase().includes('.pdf') || report?.reportName?.toLowerCase().includes('.pdf'))
        ) {
          setPdfPreviewData({ url, title: reportDisplayName(report, 'Report Preview') });
          setShowPdfModal(true);
        } else {
          downloadPdfToDevice(url, reportDisplayName(report, 'Risk Report'));
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to open report');
    }
  };

  const handleNext = () => {
    triggerLightTap();
    const userId = user?._id || user?.id;
    if (currentSlideIndex < currentCategoryImages.length - 1) {
      const nextSlideIdx = currentSlideIndex + 1;
      if (userId) {
        logEvent('navigate', {
          user_id: userId,
          module_type: 'pitch_book',
          created_by: userId,
          meta: {
            leadId,
            fromTab: activeCategory,
            toTab: activeCategory,
            fromSlideName: getCurrentSlideName(activeCategory, currentSlideIndex),
            fromSlide: currentGlobalPageNumber,
            toSlideName: getCurrentSlideName(activeCategory, nextSlideIdx),
            toSlide: currentGlobalPageNumber + 1,
            totalSlides: totalGlobalPages,
            action: 'pitch_book_slide_next',
          },
        });
      }
      setCurrentSlideIndex(nextSlideIdx);
    } else {
      const catIdx = CATEGORIES.findIndex((c) => c.id === activeCategory);
      if (catIdx < CATEGORIES.length - 1) {
        const nextCat = CATEGORIES[catIdx + 1].id;
        if (userId) {
          logEvent('navigate', {
            user_id: userId,
            module_type: 'pitch_book',
            created_by: userId,
            meta: {
              leadId,
              fromTab: activeCategory,
              toTab: nextCat,
              fromSlideName: getCurrentSlideName(activeCategory, currentSlideIndex),
              fromSlide: currentGlobalPageNumber,
              toSlideName: getCurrentSlideName(nextCat, 0),
              toSlide: currentGlobalPageNumber + 1,
              totalSlides: totalGlobalPages,
              action: 'pitch_book_slide_next',
            },
          });
        }
        setActiveCategory(nextCat);
        setCurrentSlideIndex(0);
      }
    }
  };

  const handlePrev = () => {
    triggerLightTap();
    const userId = user?._id || user?.id;
    if (currentSlideIndex > 0) {
      const prevSlideIdx = currentSlideIndex - 1;
      if (userId) {
        logEvent('navigate', {
          user_id: userId,
          module_type: 'pitch_book',
          created_by: userId,
          meta: {
            leadId,
            fromTab: activeCategory,
            toTab: activeCategory,
            fromSlideName: getCurrentSlideName(activeCategory, currentSlideIndex),
            fromSlide: currentGlobalPageNumber,
            toSlideName: getCurrentSlideName(activeCategory, prevSlideIdx),
            toSlide: currentGlobalPageNumber - 1,
            totalSlides: totalGlobalPages,
            action: 'pitch_book_slide_previous',
          },
        });
      }
      setCurrentSlideIndex(prevSlideIdx);
    } else {
      const catIdx = CATEGORIES.findIndex((c) => c.id === activeCategory);
      if (catIdx > 0) {
        const prevCat = CATEGORIES[catIdx - 1].id;
        const prevCatImagesCount = Object.keys(pitchBookImages[prevCat] || {}).length;
        if (userId) {
          logEvent('navigate', {
            user_id: userId,
            module_type: 'pitch_book',
            created_by: userId,
            meta: {
              leadId,
              fromTab: activeCategory,
              toTab: prevCat,
              fromSlideName: getCurrentSlideName(activeCategory, currentSlideIndex),
              fromSlide: currentGlobalPageNumber,
              toSlideName: getCurrentSlideName(prevCat, prevCatImagesCount - 1),
              toSlide: currentGlobalPageNumber - 1,
              totalSlides: totalGlobalPages,
              action: 'pitch_book_slide_previous',
            },
          });
        }
        setActiveCategory(prevCat);
        setCurrentSlideIndex(prevCatImagesCount - 1);
      }
    }
  };

  const handleTabChange = (tabId: string) => {
    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('navigate', {
        user_id: userId,
        module_type: 'pitch_book',
        created_by: userId,
        meta: {
          leadId,
          fromSlideTab: activeCategory,
          toSlideTab: tabId,
          fromSlide: currentGlobalPageNumber,
          fromSlideName: getCurrentSlideName(activeCategory, currentSlideIndex),
          toSlide: getGlobalPosition(tabId, 0),
          toSlideName: getCurrentSlideName(tabId, 0),
          totalSlides: totalGlobalPages,
          action: 'pitch_book_tab_changed',
        },
      });
    }
    setActiveCategory(tabId);
    setCurrentSlideIndex(0);
  };

  const handleSetViewMode = (mode: 'rep' | 'homeowner') => {
    setViewMode(mode);
    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('mode', {
        user_id: userId,
        module_type: 'pitch_book',
        created_by: userId,
        meta: {
          leadId,
          viewMode: mode,
          action: 'pitch_book_view_mode_changed',
        },
      });
    }
  };

  const renderDockToolContent = () => (
    <PhotoPeekScrollLockProvider>
      <PeekAwareScrollView
        showsVerticalScrollIndicator={false}
        style={dockStyles.toolScroll}
        contentContainerStyle={dockStyles.toolScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {activeToolTab === 'inspection' && (
          <View>
            <Text style={dockStyles.heading}>Property Inspection Photos</Text>
            {hasInspectionPhotos ? (
              <InspectionPhotosPanel photos={activePhotos} secureImages={secureImages} onAction={logTool} />
            ) : (
              <DockEmptyState
                icon="image-off"
                title="No inspection photos available"
                hint="Photos added in Job Docs will appear here."
              />
            )}
          </View>
        )}

        {activeToolTab === 'risk' && (
          <RiskContent
            lead={lead}
            refetch={refetch}
            reports={riskReports}
            onDownload={handleDownloadReport}
            onAction={logTool}
            dark
          />
        )}

        {activeToolTab === 'notes' && (
          <View>
            <Text style={dockStyles.heading}>Lead Notes</Text>
            <View style={dockStyles.notesCard}>
              <Text style={dockStyles.bodyText}>
                {fullLeadData?.notes ||
                  fullLeadData?.customerDetails?.notes ||
                  'No specific notes available for this lead.'}
              </Text>
            </View>
          </View>
        )}

        {activeToolTab === 'videos' && (
          <View>
            <Text style={dockStyles.heading}>Educational Videos</Text>
            <DockEmptyState
              icon="video-off"
              title="No videos available"
              hint="Video content goes here. This area is scrollable."
            />
          </View>
        )}
      </PeekAwareScrollView>
    </PhotoPeekScrollLockProvider>
  );

  const renderInteractiveTools = (asModal = false) => {
    if (viewMode !== 'rep' || !showTools) return null;
    const drawerHeight = isLandscape
      ? winHeight - insets.top
      : winHeight * 0.7;

    const drawer = (
      <View style={[{ zIndex: 1000 }, StyleSheet.absoluteFill]}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
          activeOpacity={1}
          onPress={() => toggleTools('backdrop')}
        />
        <Animated.View
          className="w-full bg-background rounded-t-[32px] shadow-2xl"
          style={{
            position: 'absolute',
            bottom: 0,
            left: isLandscape ? insets.left : 0,
            right: isLandscape ? landscapeRightInset : 0,
            width: isLandscape ? undefined : '100%',
            height: drawerHeight,
            paddingLeft: isLandscape ? 16 : 0,
            paddingRight: isLandscape ? 16 : 0,
            paddingBottom: insets.bottom,
            transform: [
              {
                translateY: toolsAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [drawerHeight, 0],
                }),
              },
            ],
          }}
        >
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 rounded-full bg-gray-300" />
          </View>

          <View className="px-6 pt-4 pb-4 border-b border-border">
            <View className="flex-row items-center justify-between">
              <Text className="text-text-primary text-lg font-bold">Details</Text>
              <TouchableOpacity onPress={() => toggleTools('close_button')}>
                <IonIcon name="close" size={24} color="#919EAB" />
              </TouchableOpacity>
            </View>

            <View className="flex-row gap-6 mt-6">
              <ToolTab
                label="Inspection"
                icon="camera"
                active={activeToolTab === 'inspection'}
                onPress={() => selectSheetTab('inspection')}
              />
              <ToolTab
                label="Risk"
                icon="alert"
                active={activeToolTab === 'risk'}
                onPress={() => selectSheetTab('risk')}
              />
              <ToolTab
                label="Videos"
                icon="video"
                active={activeToolTab === 'videos'}
                onPress={() => selectSheetTab('videos')}
              />
              <ToolTab
                label="Notes"
                icon="file-document-outline"
                active={activeToolTab === 'notes'}
                onPress={() => selectSheetTab('notes')}
              />
            </View>
          </View>
          <View className="flex-1">
            {/* The peek holds the finger down over an enlarged preview; without
                the lock a stray drag scrolls this list, steals the touch and
                dismisses the peek mid-hold. */}
            <PhotoPeekScrollLockProvider>
            <PeekAwareScrollView className="p-6" showsVerticalScrollIndicator={false}>
              {activeToolTab === 'inspection' && (
                <View>
                  <Text className="text-text-primary font-bold text-base mb-4">
                    Property Inspection Photos
                  </Text>
                  <InspectionPhotosPanel
                    photos={activePhotos}
                    secureImages={secureImages}
                    onAction={logTool}
                  />
                </View>
              )}

              {activeToolTab === 'risk' && (
                <RiskContent
                  lead={lead}
                  refetch={refetch}
                  reports={riskReports}
                  onDownload={handleDownloadReport}
                  onAction={logTool}
                />
              )}

              {activeToolTab === 'notes' && (
                <View>
                  <Text className="text-text-primary font-bold text-base mb-4">Lead Notes</Text>
                  <View className="bg-surface p-4 rounded-xl border border-border">
                    <Text className="text-text-primary text-sm leading-6">
                      {fullLeadData?.notes ||
                        fullLeadData?.customerDetails?.notes ||
                        'No specific notes available for this lead.'}
                    </Text>
                  </View>
                </View>
              )}

              {activeToolTab === 'videos' && (
                <View>
                  <Text className="text-text-primary font-bold text-base mb-4">
                    Educational Videos
                  </Text>
                  <View className="items-center justify-center py-12 opacity-50">
                    <Icon name="video-off" size={48} color="#919EAB" />
                    <Text className="text-text-secondary mt-4">
                      Video content goes here. This area is scrollable.
                    </Text>
                  </View>
                </View>
              )}
            </PeekAwareScrollView>
            </PhotoPeekScrollLockProvider>
          </View>
        </Animated.View>
      </View>
    );

    if (!asModal) return drawer;

    return (
      <Modal
        visible
        transparent
        statusBarTranslucent
        animationType="none"
        onRequestClose={() => toggleTools('back_button')}
        supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
      >
        {drawer}
        {/* The Risk tab's report opener is the ONLY way to reach the PDF viewer,
            and it lives inside this drawer - so while the drawer is a Modal the
            preview has to be presented from INSIDE it. Presenting it from the
            screen's own tree would be a second modal presented from a root that
            is already presenting this one. */}
        <PdfPreviewModal
          visible={showPdfModal}
          onClose={() => setShowPdfModal(false)}
          uri={pdfPreviewData.url}
          title={pdfPreviewData.title}
        />
      </Modal>
    );
  };

  const notDownloaded = !isPitchbookOnline && !isDeckError && !CATEGORIES.length;

  if (isRemoteDeck && (isDeckLoading || isDeckError || !CATEGORIES.length)) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['bottom', 'left', 'right']}>
        <View className="flex-row items-center gap-3 px-4 pt-6 bg-background">
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            className="p-1 items-center justify-center border border-border rounded-lg"
            style={{ width: 32, height: 32 }}
          >
            <Feather name="arrow-left" size={14} color={isDark ? colors.text : colors.textSecondary} />
          </TouchableOpacity>
          <Text className="text-text-primary text-sm font-medium">{deckTitle}</Text>
        </View>

        <View className="flex-1 items-center justify-center px-10">
          {isDeckLoading ? (
            <>
              <ActivityIndicator size="large" color={colors.primary.main} />
              <Text className="text-text-secondary text-sm mt-4">Loading pitch book…</Text>
            </>
          ) : (
            <>
              <Icon
                name={isDeckError || notDownloaded ? 'cloud-off-outline' : 'book-open-page-variant'}
                size={48}
                color="#919EAB"
              />
              <Text className="text-text-primary text-base font-semibold mt-4 text-center">
                {isDeckError
                  ? "Couldn't load this pitch book"
                  : notDownloaded
                    ? 'Not downloaded yet'
                    : 'No slides published yet'}
              </Text>
              <Text className="text-text-secondary text-sm mt-1 text-center">
                {isDeckError
                  ? isPitchbookOnline
                    ? 'Check your connection and try again.'
                    : // A book is kept for offline use the first time it is OPENED with signal, so
                      "You're offline and this book hasn't been downloaded yet. Open it once with a connection and it will be available here."
                  : notDownloaded
                    ? "You're offline and this book hasn't been downloaded to this device. Open it once with a connection and it will be available at every door after that."
                    : 'This pitch book has no published slides. Ask your manager to publish it.'}
              </Text>
              {isDeckError && (
                <TouchableOpacity
                  onPress={() => refetchDeck()}
                  className="mt-5 px-5 py-2.5 rounded-lg"
                  style={{ backgroundColor: colors.primary.main }}
                >
                  <Text className="text-white text-sm font-bold">Try Again</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom', 'left', 'right']}>

      {/* Pitch Book Toolbar */}
      <View className="flex-row items-center justify-between px-4 pt-6 bg-background">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            className="p-1 items-center justify-center border border-border rounded-lg"
            style={{
              width: 32,
              height: 32,
            }}
          >
            <Feather
              name="arrow-left"
              size={14}
              color={isDark ? colors.text : colors.textSecondary}
            />
          </TouchableOpacity>
          <Text className="text-text-primary text-sm font-medium" numberOfLines={1}>
            {deckTitle}
          </Text>
        </View>

        {/* Fullscreen Button */}
        <TouchableOpacity
          onPress={() => setIsFullscreen(true)}
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            backgroundColor: isDark ? '#2D3A24' : '#F0FAE8',
            borderWidth: 1,
            borderColor: colors.primary.main,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IonIcon name="expand" size={16} color={colors.primary.main} />
        </TouchableOpacity>
      </View>

      <View className="flex-1">
        {/* Toggle Mode */}
        <View className="px-4 pt-3">
          <View
            className="flex-row gap-3 p-2 rounded-lg border"
            style={{ borderColor: '#919EAB33', backgroundColor: '' }}
          >
            <TouchableOpacity
              onPress={() => handleSetViewMode('rep')}
              className="flex-1 py-2 items-center rounded-lg"
              style={{ backgroundColor: viewMode === 'rep' ? colors.primary.main : 'transparent' }}
            >
              <Text
                className={`text-sm font-medium ${viewMode === 'rep' ? 'text-white' : 'text-text-secondary'
                  }`}
              >
                Rep Mode
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleSetViewMode('homeowner')}
              className="flex-1 py-2 items-center rounded-l"
              style={{
                backgroundColor: viewMode === 'homeowner' ? colors.primary.main : 'transparent',
              }}
            >
              <Text
                className={`text-sm font-medium ${viewMode === 'homeowner' ? 'text-white' : 'text-text-secondary'
                  }`}
              >
                Homeowner View
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Categories Tab Bar */}
        <View className="bg-background shadow-sm pb-4">
          <ScrollView
            ref={inlineTabStrip.ref}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 0 }}
            onLayout={inlineTabStrip.onLayout}
            onContentSizeChange={inlineTabStrip.onContentSizeChange}
          >
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => handleTabChange(cat.id)}
                  onLayout={inlineTabStrip.onTabLayout(cat.id)}
                  className="mr-5 pt-3 pb-1"
                  style={{
                    borderBottomWidth: isActive ? 2 : 0,
                    borderBottomColor: colors.primary.main,
                  }}
                >
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: isActive ? colors.primary.main : colors.textSecondary }}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Presentation Area */}
        <View className="px-4 py-4 flex-1">
          <View className="flex-row items-center justify-between mb-4">
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              className="flex-row items-center p-1.5 rounded-md"
              style={{
                backgroundColor: '#F9FFF6',
                borderColor: colors.primary.main,
                borderWidth: 1,
              }}
            >
              <IonIcon
                name="location"
                size={18}
                color={colors.primary.main}
                style={{ marginRight: 6 }}
              />
              <Text className="font-bold text-sm" style={{ color: colors.primary.main }}>
                Back to Map
              </Text>
            </TouchableOpacity>
            <View className="bg-[#4CBB17] p-1.5 rounded-md">
              <Text className="text-white text-xs font-bold">
                {currentSlideIndex + 1} of {currentCategoryImages.length}
              </Text>
            </View>
          </View>
          <View className="">
            <View
              className="w-full aspect-[4/3] bg-card rounded-2xl shadow-sm border border-border overflow-hidden elevation-2"
              style={{
                position: 'relative',
                justifyContent: 'center',
                alignItems: 'center',
                paddingHorizontal: 2,
                paddingVertical: 3,
              }}
            >
              <ZoomableImage
                source={currentCategoryImages[currentSlideIndex]}
                containerStyle={{ width: '100%', height: '100%' }}
                style={{ width: '100%', height: '100%' }}
                resetKey={slideResetKey}
                onSwipe={handleSlideSwipe}
              />

              {/* The page count, in the same place the fullscreen slide carries it —
                  *"when the app is in full screen mode OR normal mode"*.

                  ⚠️ **No ✕ here.** It shipped with one and it was a control with nothing
                  of its own to do: this screen already has the toolbar's back arrow
                  ABOVE the slide and a "Back to Map" button directly beside it, so a
                  third way out sat on the artwork earning nothing.

                  ⚠️ `compact`, because the fullscreen pill is deliberately large — it is
                  read from across a customer's living room — and that same size on this
                  4:3 card reads as an oversized box on a thumbnail.

                  ⚠️ Deliberately NOT gated on `chromeShown`: that flag belongs to the
                  fullscreen centre tap, and there is no centre tap out here to bring the
                  controls back with. */}
              <PresentationTopBar
                current={currentGlobalPageNumber}
                total={totalGlobalPages}
                showClose={false}
                compact
                top={10}
                left={10}
                right={10}
              />

              {/* *"User can change slides by swiping or tapping arrows."* Fullscreen had
                  both already; this card had NEITHER — a rep presenting without going
                  fullscreen could only move with the buttons under the progress bar.

                  ⚠️ Same border strips as fullscreen, not a full-width swipe: the middle
                  belongs to `ZoomableImage`'s pinch, and the strips are what the gesture
                  tutorial promises. The pan needs 15pt of HORIZONTAL travel before it
                  activates, so a vertical drag still scrolls this screen. */}

              <SlideArrows
                onPrev={handlePrev}
                onNext={handleNext}
                canPrev={currentGlobalPageNumber > 1}
                canNext={currentGlobalPageNumber < totalGlobalPages}
              />
            </View>
          </View>
        </View>

        {/* Navigation & Progress */}
        <View className="px-5 pt-4 mb-4 bg-background border-t border-border">
          <View className="flex-row items-center mb-3">
            <Text className="text-text-secondary text-xs mr-2">
              {currentGlobalPageNumber} of {totalGlobalPages}
            </Text>
            <View
              className="flex-1 h-2 rounded-full overflow-hidden"
              style={{ backgroundColor: '#919EAB29' }}
            >
              <View
                style={{
                  width: `${(currentGlobalPageNumber / totalGlobalPages) * 100}%`,
                  height: '100%',
                  backgroundColor: colors.primary.main,
                }}
              />
            </View>
          </View>
          <View className="flex-row gap-4">
            <TouchableOpacity
              onPress={handlePrev}
              disabled={currentGlobalPageNumber === 1}
              className={`flex-1 flex-row gap-1 items-center justify-center py-2 rounded-lg`}
              style={{
                backgroundColor: currentGlobalPageNumber === 1 ? '#637381' : colors.primary.main,
              }}
            >
              <IonIcon name="chevron-back" size={16} color="white" />
              <Text className="text-white font-bold text-sm">Previous</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleNext}
              disabled={currentGlobalPageNumber === totalGlobalPages}
              className={`flex-1 flex-row gap-1 items-center justify-center py-2 rounded-lg`}
              style={{
                backgroundColor:
                  currentGlobalPageNumber === totalGlobalPages ? '#637381' : colors.primary.main,
              }}
            >
              <Text className="text-white font-bold text-sm">Next</Text>
              <IonIcon name="chevron-forward" size={16} color="white" />
            </TouchableOpacity>
          </View>
        </View>
        {/* Persistent Interactive Tools Toggle Bar (Rep Mode only) */}
        {viewMode === 'rep' && (
          <View className="pt-4">
            <TouchableOpacity
              onPress={() => toggleTools('interactive_tools_button')}
              activeOpacity={0.9}
              className="flex-row items-center justify-center py-4"
              style={{
                paddingBottom: Platform.OS === 'ios' ? 16 : 16,
                borderTopLeftRadius: 8,
                borderTopRightRadius: 8,
                backgroundColor: '#F9FFF6',
                borderWidth: 1,
                borderColor: colors.primary.main,
              }}
            >
              <IonIcon
                name={showTools ? 'chevron-down' : 'chevron-up'}
                size={20}
                color={colors.primary.main}
                style={{ marginRight: 8 }}
              />
              <Text className="font-bold text-sm" style={{ color: colors.primary.main }}>
                {showTools ? 'Hide Tools' : 'Interactive Tools'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Fullscreen Presentation Modal ── */}
        <Modal
          visible={isFullscreen}
          animationType="fade"
          statusBarTranslucent
          supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
          onRequestClose={() => setIsFullscreen(false)}
        >
          {/* A Modal is its own native view tree on Android, so the app-root
              GestureHandlerRootView in App.tsx does not reach it — without this one the
              slide's pinch/pan gestures never fire in fullscreen. */}
          {/*
            ⚠️ KEYED ON THE ORIENTATION, which remounts this subtree when the device is
            turned.

            Reported: rotating portrait → landscape with fullscreen ALREADY OPEN left the
            chrome clipped at the edge, while closing and reopening in landscape was
            correct. That asymmetry is the whole tell — the values are right either way,
            so what is stale is the LAYOUT the modal is holding: a `Modal` is presented by
            its own native controller and does not reliably re-measure its subtree on a
            rotation, so the absolute chrome kept positions computed against the previous
            frame until the modal was torn down and rebuilt.

            The key does that teardown on every rotation instead of waiting for the rep to
            do it by hand.

            ⚠️ It resets the slide's ZOOM and the dock's scroll offset on rotation. That
            is acceptable and arguably right — the slide re-fits to the new frame anyway —
            but it is the cost, so do not extend this key to anything whose state has to
            survive a turn. `chromeVisible`, `dockMode` and the tutorial flag all live on
            the SCREEN, above this, and are untouched.
          */}
          <GestureHandlerRootView
            key={isLandscape ? 'fs-landscape' : 'fs-portrait'}
            style={{ flex: 1, backgroundColor: '#000' }}
          >
            {/* Hide status bar in landscape */}
            {/* ⚠️ Hidden in BOTH orientations. It was `hidden={isLandscape}`, so a
                portrait presentation still showed the clock, wifi and battery over the
                slide — and the rep is showing this to a customer. Requested directly:
                *"when this full screen is open, make sure the bar in which time, battery
                and other details are shown is hidden."* */}
            <StatusBar hidden backgroundColor="transparent" translucent />

            {isLandscape ? (
              <View style={{ flex: 1, backgroundColor: '#000', position: 'relative' }}>

                {/* ── Centre: image area + category tabs below image ── */}
                <View style={{ flex: 1, flexDirection: 'column' }}>

                  {/* Upper part: Image and top buttons */}
                  <View style={{ flex: 1, position: 'relative', justifyContent: 'center', alignItems: 'center' }}>
                    {/* Image */}
                    <ZoomableImage
                      source={currentCategoryImages[currentSlideIndex]}
                      containerStyle={{ ...StyleSheet.absoluteFillObject }}
                      style={{ width: '100%', height: '100%' }}
                      resetKey={slideResetKey}
                      onSingleTap={toggleChrome}
                      onSwipe={handleSlideSwipe}
                    />


                    {/* Everything from here to the end of this block is the presentation
                        CHROME the centre tap toggles — counter, exit, both arrows. They
                        are the run of siblings that follow the image, so one fragment
                        gates them all rather than ten separate conditions. */}
                    {chromeShown && (
                      <>
                    <PresentationTopBar
                      current={currentGlobalPageNumber}
                      total={totalGlobalPages}
                      onClose={() => setIsFullscreen(false)}
                      closeLabel="Exit fullscreen"
                      top={fullscreenTopInset}
                      left={fullscreenLeftInset}
                      right={fullscreenRightInset}
                    />


                    {/* ⚠️ Shared component. The old next arrow carried
                        `landscapeRightInset + 48` to clear the right-edge Interactive
                        Tools tab — a control that no longer exists, so the offset only
                        pushed it inward (and, with a large inset, off the slide). Each
                        side now takes its OWN real inset: the cutout is on one side and
                        the Android nav bar on the other. */}
                    <SlideArrows
                      onPrev={handleArrowPrev}
                      onNext={handleArrowNext}
                      canPrev={currentGlobalPageNumber > 1}
                      canNext={currentGlobalPageNumber < totalGlobalPages}
                      leftInset={fullscreenLeftInset}
                      rightInset={fullscreenRightInset}
                    />
                      </>
                    )}
                  </View>

                </View>

              </View>
            ) : (
              <View style={{ flex: 1, backgroundColor: '#000' }}>
                {/* ⚠️ The page count and the exit control are an OVERLAY here now, not a
                    flow row at the top — they used to push the slide down by their own
                    height. `PresentationTopBar` floats over the image inside the block
                    below, so both orientations frame the slide identically and the pair
                    is gated with the rest of the chrome. */}

                {/* Image with prev/next arrows */}
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  {currentCategoryImages[currentSlideIndex] && (
                    <ZoomableImage
                      source={currentCategoryImages[currentSlideIndex]}
                      containerStyle={{ ...StyleSheet.absoluteFillObject }}
                      style={{ width: '100%', height: '100%' }}
                      resetKey={slideResetKey}
                      onSingleTap={toggleChrome}
                      onSwipe={handleSlideSwipe}
                    />
                  )}


                  {chromeShown && (
                    <>
                  <PresentationTopBar
                    current={currentGlobalPageNumber}
                    total={totalGlobalPages}
                    onClose={() => setIsFullscreen(false)}
                    closeLabel="Exit fullscreen"
                    top={fullscreenTopInset}
                    left={16}
                    right={16}
                  />

                  {/* ⚠️ Shared component, not two inline `TouchableOpacity`s. The pair
                      here carried NO `top` at all, so each fell back to its static flow
                      position inside a `justifyContent: center` container — which is why
                      the forward arrow landed off the slide. `SlideArrows` pins both to
                      the true vertical centre. */}
                  <SlideArrows
                    onPrev={handleArrowPrev}
                    onNext={handleArrowNext}
                    canPrev={currentGlobalPageNumber > 1}
                    canNext={currentGlobalPageNumber < totalGlobalPages}
                    inset={12}
                  />
                    </>
                  )}
                </View>

              </View>
            )}

            {/* ── The dock: section tabs and the interactive tools, in ONE bar ──
                Rendered once for BOTH orientations rather than inside each layout
                branch, so the two can never drift apart — only its insets differ.
                Part of the chrome, so the centre tap hides it with everything else. */}
            {chromeShown && (
              <PresentationDock
                mode={dockMode}
                onModeChange={handleDockMode}
                categories={CATEGORIES}
                activeCategory={activeCategory}
                onSelectCategory={handleDockCategory}
                activeTool={activeToolTab}
                onSelectTool={handleDockTool}
                toolContent={renderDockToolContent()}
                showTools={viewMode === 'rep'}
                toolHeight={isLandscape ? winHeight * 0.52 : winHeight * 0.46}
                left={fullscreenLeftInset}
                right={fullscreenRightInset}
                bottom={fullscreenBottomInset}
              />
            )}

            <PdfPreviewModal
              visible={showPdfModal && isFullscreen}
              onClose={() => setShowPdfModal(false)}
              uri={pdfPreviewData.url}
              title={pdfPreviewData.title}
            />

            {/* ⚠️ LAST child of the fullscreen modal, and not a Modal of its own —
                stacking a second native modal over one already up is unreliable on both
                platforms. Rendered here it covers the slide, its chrome and the tools
                drawer. */}
            <PresentationGesturesTutorial
              visible={showGestureTutorial}
              onDismiss={dismissGestureTutorial}
              onNeverAgain={neverShowGestureTutorial}
            />
          </GestureHandlerRootView>
        </Modal>

        {!isFullscreen && renderInteractiveTools(true)}

        <PdfPreviewModal
          visible={showPdfModal && !isFullscreen && !showTools}
          onClose={() => setShowPdfModal(false)}
          uri={pdfPreviewData.url}
          title={pdfPreviewData.title}
        />
      </View>
    </SafeAreaView>
  );
}

function ToolTab({ label, icon, active, onPress }: any) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="items-center pb-2"
      style={{ borderBottomWidth: active ? 2 : 0, borderBottomColor: '#72BD00' }}
    >
      <View className="flex-row items-center">
        <Icon
          name={icon}
          size={20}
          color={active ? '#72BD00' : '#919EAB'}
          style={{ marginRight: 6 }}
        />
        <Text className={`text-sm font-bold ${active ? 'text-primary' : 'text-text-secondary'}`}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const RiskContent = ({ lead, refetch, reports, onDownload, onAction, dark = false }: any) => {
  const { colors, isDark } = useTheme();
  const { riskJob, handleStartRiskReport, handleResetRiskReport } = useLeadReports(lead, refetch);
  const [selectedYear, setSelectedYear] = useState(3);
  const [resetView, setResetView] = useState(false);
  const [reportExpanded, setReportExpanded] = useState(true);

  const riskReport = reports.find(
    (r: any) => r.reportName?.toLowerCase().includes('risk') || r.reportType?.includes('risk')
  );

  const t = dark
    ? {
        surface: DOCK_TEXT.surface,
        border: DOCK_TEXT.surfaceBorder,
        heading: DOCK_TEXT.heading,
        body: DOCK_TEXT.body,
        hint: DOCK_TEXT.hint,
        glyphWell: DOCK_TEXT.glyphWell,
        glyph: DOCK_TEXT.glyph,
        track: 'rgba(255,255,255,0.12)',
      }
    : {
        surface: colors.background,
        border: '#919EAB33',
        heading: colors.text,
        body: colors.text,
        hint: '#919EAB',
        glyphWell: '#919EAB1F',
        glyph: '#637381',
        track: '#F1F5F9',
      };

  return (
    <View>
      <View className="flex-row justify-between items-center mb-4">
        {/* The dock's other three tabs each open with one heading; this is Risk's, and it
            takes the same style so the four cannot read as different typography. */}
        <Text
          style={dark ? dockStyles.headingRow : undefined}
          className={dark ? undefined : 'text-text-primary font-bold text-base'}
        >
          Report
        </Text>
        <TouchableOpacity
          onPress={() => {
            onAction?.(reportExpanded ? 'risk_report_collapsed' : 'risk_report_expanded');
            setReportExpanded(!reportExpanded);
          }}
        >
          <IonIcon
            name={reportExpanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={dark ? DOCK_TEXT.glyph : '#919EAB'}
          />
        </TouchableOpacity>
      </View>

      {reportExpanded && (
        <View
          className="p-3 rounded-lg flex-col mb-4 border"
          style={{
            borderColor: t.border,
            backgroundColor: t.surface,
          }}
        >
          <View className="flex-row justify-between items-center">
            <View
              className="w-8 h-8 rounded-full items-center justify-center"
              style={{ backgroundColor: t.glyphWell }}
            >
              <Icon name="alert" size={16} color={t.glyph} />
            </View>
            <View className="flex-1 ml-4">
              <Text className="text-sm font-semibold" style={{ color: t.body }}>
                Risk Report
              </Text>
            </View>
            <View className="flex-row items-center gap-3">
              {riskReport && !resetView && !riskJob ? (
                <View className="flex-row items-center gap-2">
                  <TouchableOpacity
                    onPress={() => {
                      onAction?.('risk_report_viewed', {
                        reportName: riskReport.reportName,
                        displayName: reportDisplayName(riskReport, 'Risk Report'),
                      });
                      onDownload(riskReport, 0);
                    }}
                    className="w-8 h-8 rounded-full items-center justify-center bg-violet-500"
                  >
                    <Icon name="eye" size={16} color={'#ffffff'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      onAction?.('risk_report_downloaded', {
                        reportName: riskReport.reportName,
                        displayName: reportDisplayName(riskReport, 'Risk Report'),
                      });
                      onDownload(riskReport, 0, true);
                    }}
                    className="w-8 h-8 rounded-full items-center justify-center bg-emerald-500"
                  >
                    <Icon name="download" size={16} color={'#ffffff'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      onAction?.('risk_report_reset', {
                        reportName: riskReport.reportName,
                        displayName: reportDisplayName(riskReport, 'Risk Report'),
                      });
                      setResetView(true);
                      handleResetRiskReport(riskReport._id);
                    }}
                    className="w-8 h-8 rounded-full items-center justify-center bg-amber-500"
                  >
                    <Icon name="refresh" size={16} color={'#ffffff'} />
                  </TouchableOpacity>
                </View>
              ) : (
                !riskJob && (
                  <View className="flex-row items-center gap-2">
                    <YearDropdown
                      defaultValue={selectedYear}
                      min={1}
                      max={5}
                      dark={dark}
                      onChange={(val: number) => {
                        onAction?.('risk_report_year_changed', { fromYear: selectedYear, toYear: val });
                        setSelectedYear(val);
                      }}
                    />
                    <TouchableOpacity
                      onPress={() => {
                        onAction?.('risk_report_generate_started', { years: selectedYear });
                        handleStartRiskReport(selectedYear);
                        setResetView(false);
                      }}
                      className="w-8 h-8 rounded-full items-center justify-center"
                      style={{ backgroundColor: colors.primary.main }}
                    >
                      <Icon name="download" size={16} color={'#ffffff'} />
                    </TouchableOpacity>
                  </View>
                )
              )}
              {riskJob && riskJob.status !== 'completed' && (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color={colors.primary.main} />
                  <Text className="text-[10px] font-bold" style={{ color: t.hint }}>
                    {riskJob.progress}%
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Progress Bar for Risk Job */}
          {riskJob && riskJob.status !== 'completed' && (
            <View
              className="mt-3 h-1.5 w-full rounded-full overflow-hidden"
              style={{ backgroundColor: t.track }}
            >
              <View
                className="h-full"
                style={{ width: `${riskJob.progress}%`, backgroundColor: DOCK_TAB_GREEN }}
              />
            </View>
          )}
          {riskJob && riskJob.status !== 'completed' && (
            <Text className="text-[10px] mt-1 italic" style={{ color: t.hint }}>
              {riskJob.step || 'Processing...'}
            </Text>
          )}
        </View>
      )}
      {reports.length > 1 && (
        <View className="mt-2 gap-3">
          <Text className="text-xs font-black tracking-widest mb-1" style={{ color: t.hint }}>
            Generated History
          </Text>
          {reports.map((report: any, idx: number) => (
            <TouchableOpacity
              key={idx}
              onPress={() => {
                onAction?.('risk_report_history_opened', {
                  reportName: report.reportName,
                  displayName: reportDisplayName(report, 'Risk Report'),
                  historyIndex: idx,
                });
                onDownload(report, idx);
              }}
              className="flex-row items-center p-4 rounded-xl border shadow-sm"
              style={{
                backgroundColor: dark ? t.surface : '#FFFFFF',
                borderColor: dark ? t.border : '#F1F5F9',
              }}
            >
              <View
                className="w-10 h-10 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: dark ? 'rgba(239,68,68,0.16)' : '#FEF2F2' }}
              >
                <Icon name="file-pdf-box" size={24} color="#EF4444" />
              </View>
              <View className="flex-1">
                <Text className="font-bold text-sm" numberOfLines={1} style={{ color: t.body }}>
                  {reportDisplayName(report, 'Risk Report')}
                </Text>
                <Text className="text-[10px]" style={{ color: t.hint }}>
                  {new Date(report.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color={dark ? DOCK_TEXT.glyph : '#919EAB'} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

export const DOCK_TEXT = {
  heading: '#FFFFFF',
  body: 'rgba(255,255,255,0.86)',
  hint: 'rgba(255,255,255,0.55)',
  surface: 'rgba(255,255,255,0.06)',
  surfaceBorder: 'rgba(255,255,255,0.10)',
  glyphWell: 'rgba(255,255,255,0.10)',
  glyph: 'rgba(255,255,255,0.72)',
} as const;

const DOCK_HEADING_TEXT = {
  color: DOCK_TEXT.heading,
  fontSize: 15,
  fontWeight: '700',
} as const;

const DOCK_HINT_TEXT = { color: DOCK_TEXT.hint, fontSize: 13, lineHeight: 20 } as const;

function DockEmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <View style={dockStyles.emptyState}>
      <Icon name={icon} size={44} color={DOCK_TEXT.hint} />
      <Text style={dockStyles.emptyTitle}>{title}</Text>
      {hint ? <Text style={dockStyles.emptyText}>{hint}</Text> : null}
    </View>
  );
}

const dockStyles = StyleSheet.create({
  toolScroll: { flex: 1 },
  toolScrollContent: { padding: 16, flexGrow: 1 },
  heading: { ...DOCK_HEADING_TEXT, marginBottom: 14 },
  headingRow: DOCK_HEADING_TEXT,
  notesCard: {
    backgroundColor: DOCK_TEXT.surface,
    borderWidth: 1,
    borderColor: DOCK_TEXT.surfaceBorder,
    borderRadius: 12,
    padding: 14,
  },
  bodyText: { color: DOCK_TEXT.body, fontSize: 13.5, lineHeight: 22 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 44 },
  emptyTitle: {
    color: DOCK_TEXT.body,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 14,
    textAlign: 'center',
  },
  emptyText: { ...DOCK_HINT_TEXT, marginTop: 4, textAlign: 'center' },
});
