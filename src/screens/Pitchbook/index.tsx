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
import { ZoomableImage } from '../../widgets/common/ZoomableImage';
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
import Feather from 'react-native-vector-icons/Feather';
import { useAuth } from '../../hooks/useAuth';
import { logEvent } from '../../services/api/LoggerService';

const { width } = Dimensions.get('window');

// Persisted slide position per lead, so the pitchbook resumes where the rep left off.
// A portal-authored book is scoped by its id as well: its sections are unrelated to
// the bundled deck's (and to another book's), so one shared key would restore a rep
// into a tab that doesn't exist in the deck they just opened.
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
  // Company-scoped deck swap — web parity (`pitch-book.js` `isGreenRooflines`). For
  // the Green Rooflines company the pitchbook is a single-tab 12-slide deck; every
  // other company keeps the default LeafFilter deck. `CATEGORIES` and
  // `pitchBookImages` below shadow the module defaults so all downstream reads are
  // deck-aware with no further changes. No schema/API — the choice is companyId only.
  const isGreenRooflines = (user?.companyId || '') === GREEN_ROOFLINES_COMPANY_ID;
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;
  const landscapeRightInset = Platform.OS === 'android' ? Math.max(insets.right || 0, 48) : (insets.right || 0);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { lead, bookId, bookName } = (route.params as any) || {};
  const leadId = lead?._id || lead?.id || null;

  // A `bookId` param means the rep picked a PORTAL-AUTHORED book from the Lead
  // Center card; without one the screen keeps its previous behaviour and serves the
  // bundled deck. `deck.images` / `deck.categories` arrive in exactly the static
  // decks' shape, so everything below reads from one pair of variables either way.
  const {
    data: remoteDeck,
    isLoading: isDeckLoading,
    isError: isDeckError,
    refetch: refetchDeck,
  } = usePitchBookDeck(bookId);
  const isRemoteDeck = !!bookId;

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
  // Remote decks have no fixed first tab — it is whatever the portal ordered first,
  // and it isn't known until the fetch lands (see the reconcile effect below).
  const defaultCategoryId = isRemoteDeck
    ? remoteDeck?.categories?.[0]?.id || ''
    : isGreenRooflines
    ? 'green_rooflines'
    : 'leafFilter_story';
  const deckTitle = (isRemoteDeck && (remoteDeck?.bookName || bookName)) || 'Pitch Book';

  // Restore the last viewed slide for this lead (if any).
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
    // Only restore a saved tab that exists in THIS deck — a lead pitched on the
    // default deck must not restore into a Green Rooflines-only tab (or vice versa),
    // which would render a blank slide. Otherwise start on the deck's first tab.
    const saved = savedProgress?.category;
    return saved && CATEGORIES.some((c) => c.id === saved) ? saved : defaultCategoryId;
  });
  const [currentSlideIndex, setCurrentSlideIndex] = useState(savedProgress?.slideIndex || 0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [activeToolTab, setActiveToolTab] = useState('inspection');
  const [loading, setLoading] = useState(true);
  const [fullLeadData, setFullLeadData] = useState<any>(null);

  const activePhotos = useMemo(() => {
    return fullLeadData?.outcome?.salesPhotos || fullLeadData?.salesPhotos || lead?.salesPhotos || [];
  }, [fullLeadData, lead]);

  const { data: secureImages = {} } = useSecureUrls(activePhotos);

  // Animation for tools drawer
  const toolsAnim = useRef(new Animated.Value(0)).current;

  const toggleTools = () => {
    const toValue = showTools ? 0 : 1;
    Animated.spring(toolsAnim, {
      toValue,
      useNativeDriver: true,
      friction: 8,
      tension: 40,
    }).start();
    setShowTools(!showTools);
  };

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
    return Object.values(imagesObj);
  }, [activeCategory, pitchBookImages]);

  const totalGlobalPages = useMemo(() => {
    return Object.values(pitchBookImages).reduce((acc, cat) => acc + Object.keys(cat).length, 0);
  }, [pitchBookImages]);

  const currentGlobalPageNumber = useMemo(() => {
    return getGlobalPosition(activeCategory, currentSlideIndex);
  }, [activeCategory, currentSlideIndex, getGlobalPosition]);

  // Identity of the slide on screen. Handed to every `ZoomableImage` so moving to the
  // next slide snaps it back to 1x — otherwise the rep advances mid-pitch and lands on
  // a slide already scrolled to some corner of the previous one's zoom.
  const slideResetKey = `${activeCategory}:${currentSlideIndex}`;

  // Reconcile the selected tab with the deck actually in hand. A remote deck's
  // sections aren't known at mount, so `activeCategory` starts empty and lands here
  // once the fetch resolves; this also covers a book EDITED on the portal since the
  // rep last presented it (saved tab deleted → fall back to the first one).
  useEffect(() => {
    if (!CATEGORIES.length) return;
    if (CATEGORIES.some((c) => c.id === activeCategory)) return;
    const saved = savedProgress?.category;
    const restorable = !!saved && CATEGORIES.some((c) => c.id === saved);
    setActiveCategory(restorable ? (saved as string) : CATEGORIES[0].id);
    setCurrentSlideIndex(restorable ? savedProgress?.slideIndex || 0 : 0);
  }, [CATEGORIES, activeCategory, savedProgress]);

  // …and with the slides in that tab. Restoring slide 8 of a section the portal has
  // since trimmed to 5 would leave the rep on a blank frame with working arrows.
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

  // Persist the current slide position for this lead whenever it changes. Skipped
  // while the tab is still empty (a remote deck's first render), otherwise opening a
  // book would immediately overwrite the position saved on the last visit.
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

  // Hydrate the FULL lead — `salesPhotos` and `notes` are what this screen renders, and
  // the lead it is navigated with now comes from the SLIM list (`view=summary`), which
  // carries `salesPhotos: []`. Without this the Inspection tab is empty.
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
      // Fall through to the deal endpoint below. This is NOT only the documented
      // "rep isn't assigned to this lead" 404 — an API host that predates the
      // sales-portal optimization has no such ROUTE and answers with an HTML error
      // page, which is exactly what a not-yet-deployed environment does.
    }
    try {
      // Fallback: what this screen read before the detail endpoint existed. Keeps the
      // Inspection tab populated on an API that hasn't shipped the optimization yet,
      // so preferring the new route can never be a regression.
      const response = await LeadService.getSalesDealById(lid);
      const body = response.data;
      setFullLeadData(body?.data?.lead || body?.data || body?.lead || body);
    } catch {
      // Non-fatal: the deck still presents, falling back to whatever the navigation
      // param carried.
    }
  };

  useEffect(() => {
    // ⚠️ Runs for EVERY lead, not just sold/demo ones. It was gated on
    // `result === 'sale' || 'demo'` back when the list row already carried the photos
    // and this call only added outcome data — under `view=summary` that gate left every
    // non-resulted lead with no photos at all.
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

  // Removed artificial loading state that caused permanent loaders for local images

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
          setPdfPreviewData({ url, title: report.reportName || 'Report Preview' });
          setShowPdfModal(true);
        } else {
          downloadPdfToDevice(url, report.reportName || 'Risk Report');
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

  // `asModal` renders the drawer inside its OWN full-screen Modal. Outside
  // fullscreen the drawer is mounted inside the screen's flex-1 body, so its
  // StyleSheet.absoluteFill backdrop only ever reached the slide area - the
  // pitch-book toolbar and the navigator's MainHeader above it stayed undimmed
  // while the sheet was open. A Modal is its own view tree over the whole
  // window, so the backdrop now covers the header too. The FULLSCREEN path
  // passes nothing: the drawer is already inside a Modal there (stacked native
  // modals are unreliable) and that modal already owns the whole screen.
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
          onPress={toggleTools}
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
              <TouchableOpacity onPress={toggleTools}>
                <IonIcon name="close" size={24} color="#919EAB" />
              </TouchableOpacity>
            </View>

            <View className="flex-row gap-6 mt-6">
              <ToolTab
                label="Inspection"
                icon="camera"
                active={activeToolTab === 'inspection'}
                onPress={() => setActiveToolTab('inspection')}
              />
              <ToolTab
                label="Risk"
                icon="alert"
                active={activeToolTab === 'risk'}
                onPress={() => setActiveToolTab('risk')}
              />
              <ToolTab
                label="Videos"
                icon="video"
                active={activeToolTab === 'videos'}
                onPress={() => setActiveToolTab('videos')}
              />
              <ToolTab
                label="Notes"
                icon="file-document-outline"
                active={activeToolTab === 'notes'}
                onPress={() => setActiveToolTab('notes')}
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
                  />
                </View>
              )}

              {activeToolTab === 'risk' && (
                <RiskContent
                  lead={lead}
                  refetch={refetch}
                  reports={riskReports}
                  onDownload={handleDownloadReport}
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
        onRequestClose={toggleTools}
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

  // A portal-authored deck has to be fetched (and its slides signed) before any of
  // the presentation UI means anything — page counters, tabs and the fullscreen
  // viewer all read the same two variables. Gating the whole screen here covers all
  // of them at once rather than teaching each render site an empty state.
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
                name={isDeckError ? 'cloud-off-outline' : 'book-open-page-variant'}
                size={48}
                color="#919EAB"
              />
              <Text className="text-text-primary text-base font-semibold mt-4 text-center">
                {isDeckError ? "Couldn't load this pitch book" : 'No slides published yet'}
              </Text>
              <Text className="text-text-secondary text-sm mt-1 text-center">
                {isDeckError
                  ? 'Check your connection and try again.'
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
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 0 }}
          >
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => handleTabChange(cat.id)}
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
              onPress={toggleTools}
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
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
            {/* Hide status bar in landscape */}
            <StatusBar hidden={isLandscape} backgroundColor="transparent" translucent />

            {isLandscape ? (
              /* ════════════════════════════════════════
                 LANDSCAPE LAYOUT
                 ════════════════════════════════════════ */
              <View style={{ flex: 1, backgroundColor: '#000', position: 'relative', paddingTop: insets.top }}>

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
                    />

                    {/* ── Overlay: page counter top-left ── */}
                    <View
                      style={{
                        position: 'absolute',
                        top: Math.max(insets.top + 10, 24),
                        left: 16,
                        backgroundColor: 'rgba(0,0,0,0.50)',
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 12,
                        zIndex: 10,
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
                        {currentGlobalPageNumber} / {totalGlobalPages}
                      </Text>
                    </View>

                    {/* ── Overlay: compress button top-right ── */}
                    <TouchableOpacity
                      onPress={() => setIsFullscreen(false)}
                      style={{
                        position: 'absolute',
                        top: Math.max(insets.top + 8, 20),
                        right: Math.max(landscapeRightInset, 16),
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: 'rgba(255,255,255,0.15)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10,
                      }}
                    >
                      <IonIcon name="contract" size={20} color="#fff" />
                    </TouchableOpacity>

                    {/* Prev Arrow (Floating next to image) */}
                    <TouchableOpacity
                      onPress={handlePrev}
                      disabled={currentGlobalPageNumber === 1}
                      style={{
                        position: 'absolute',
                        left: Math.max((insets.left || 0) + 24, 48),
                        top: '50%',
                        transform: [{ translateY: -20 }],
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: 'rgba(255,255,255,0.22)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: currentGlobalPageNumber === 1 ? 0.25 : 1,
                        zIndex: 10,
                      }}
                    >
                      <IonIcon
                        name="chevron-back"
                        size={22}
                        color="#fff"
                      />
                    </TouchableOpacity>

                    {/* Next Arrow (Floating next to image, adjusted to clear tools tab) */}
                    <TouchableOpacity
                      onPress={handleNext}
                      disabled={currentGlobalPageNumber === totalGlobalPages}
                      style={{
                        position: 'absolute',
                        right: viewMode === 'rep' ? Math.max(landscapeRightInset + 48, 48) : Math.max(landscapeRightInset + 24, 48),
                        top: '50%',
                        transform: [{ translateY: -20 }],
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: 'rgba(255,255,255,0.22)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: currentGlobalPageNumber === totalGlobalPages ? 0.25 : 1,
                        zIndex: 10,
                      }}
                    >
                      <IonIcon
                        name="chevron-forward"
                        size={22}
                        color="#fff"
                      />
                    </TouchableOpacity>
                  </View>

                  {/* Bottom part: category tabs (sits below image, not overlayed) */}
                  <View
                    style={{
                      backgroundColor: '#111',
                      paddingTop: 10,
                      paddingBottom: Math.max(insets.bottom, 10),
                      paddingLeft: Math.max(insets.left, 8),
                      paddingRight: Math.max(landscapeRightInset, 8),
                      borderTopWidth: 1,
                      borderTopColor: 'rgba(255,255,255,0.08)',
                    }}
                  >
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{
                        flexGrow: 1,
                        justifyContent: 'center',
                        paddingHorizontal: 8,
                      }}
                    >
                      {CATEGORIES.map((cat) => {
                        const isActive = activeCategory === cat.id;
                        return (
                          <TouchableOpacity
                            key={cat.id}
                            onPress={() => handleTabChange(cat.id)}
                            style={{
                              marginHorizontal: 4,
                              paddingHorizontal: 14,
                              paddingVertical: 6,
                              borderRadius: 20,
                              backgroundColor: isActive
                                ? colors.primary.main
                                : 'rgba(255,255,255,0.12)',
                              borderWidth: isActive ? 0 : 1,
                              borderColor: 'rgba(255,255,255,0.18)',
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: '600',
                                color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
                              }}
                            >
                              {cat.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                </View>

                {/* ── Interactive Tools: right-edge vertical tab (Rep Mode only) ── */}
                {viewMode === 'rep' && (
                  <TouchableOpacity
                    onPress={toggleTools}
                    style={{
                      position: 'absolute',
                      right: landscapeRightInset,
                      top: '50%',
                      transform: [{ translateY: -40 }],
                      width: 32,
                      height: 80,
                      backgroundColor: '#72BD00',
                      borderTopLeftRadius: 16,
                      borderBottomLeftRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 99,
                    }}
                  >
                    <IonIcon name="chevron-back" size={20} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              /* ════════════════════════════════════════
                 PORTRAIT LAYOUT  (unchanged)
                 ════════════════════════════════════════ */
              <View style={{ flex: 1, backgroundColor: '#000' }}>
                {/* Top bar: page counter + exit button */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 16,
                    paddingTop: insets.top + 40,
                    paddingBottom: 5,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                    {currentGlobalPageNumber} / {totalGlobalPages}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setIsFullscreen(false)}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: 'rgba(255,255,255,0.15)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <IonIcon name="contract" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>

                {/* Image with prev/next arrows */}
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  {currentCategoryImages[currentSlideIndex] && (
                    <ZoomableImage
                      source={currentCategoryImages[currentSlideIndex]}
                      containerStyle={{ ...StyleSheet.absoluteFillObject }}
                      style={{ width: '100%', height: '100%' }}
                      resetKey={slideResetKey}
                    />
                  )}

                  {/* Prev Arrow */}
                  <TouchableOpacity
                    onPress={handlePrev}
                    disabled={currentGlobalPageNumber === 1}
                    style={{
                      position: 'absolute',
                      left: 12,
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor:
                        currentGlobalPageNumber === 1
                          ? 'rgba(255,255,255,0.10)'
                          : 'rgba(255,255,255,0.22)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <IonIcon
                      name="chevron-back"
                      size={22}
                      color={currentGlobalPageNumber === 1 ? 'rgba(255,255,255,0.35)' : '#fff'}
                    />
                  </TouchableOpacity>

                  {/* Next Arrow */}
                  <TouchableOpacity
                    onPress={handleNext}
                    disabled={currentGlobalPageNumber === totalGlobalPages}
                    style={{
                      position: 'absolute',
                      right: 12,
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor:
                        currentGlobalPageNumber === totalGlobalPages
                          ? 'rgba(255,255,255,0.10)'
                          : 'rgba(255,255,255,0.22)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <IonIcon
                      name="chevron-forward"
                      size={22}
                      color={
                        currentGlobalPageNumber === totalGlobalPages
                          ? 'rgba(255,255,255,0.35)'
                          : '#fff'
                      }
                    />
                  </TouchableOpacity>
                </View>

                {/* Bottom: category tabs + interactive tools button */}
                <View
                  style={{
                    backgroundColor: '#111',
                    paddingBottom: insets.bottom + 4,
                    borderTopWidth: 1,
                    borderTopColor: 'rgba(255,255,255,0.08)',
                  }}
                >
                  {/* Category tab strip */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}
                  >
                    {CATEGORIES.map((cat) => {
                      const isActive = activeCategory === cat.id;
                      return (
                        <TouchableOpacity
                          key={cat.id}
                          onPress={() => handleTabChange(cat.id)}
                          style={{
                            marginRight: 8,
                            paddingHorizontal: 14,
                            paddingVertical: 7,
                            borderRadius: 20,
                            backgroundColor: isActive ? colors.primary.main : 'rgba(255,255,255,0.10)',
                            borderWidth: isActive ? 0 : 1,
                            borderColor: 'rgba(255,255,255,0.15)',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: '600',
                              color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
                            }}
                          >
                            {cat.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* Interactive Tools button (Rep Mode only) */}
                  {viewMode === 'rep' && (
                    <TouchableOpacity
                      onPress={toggleTools}
                      style={{
                        marginHorizontal: 12,
                        marginBottom: 6,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingVertical: 12,
                        borderRadius: 10,
                        backgroundColor: '#F0FAE8',
                        borderWidth: 1,
                        borderColor: colors.primary.main,
                      }}
                    >
                      <IonIcon
                        name="chevron-up"
                        size={18}
                        color={colors.primary.main}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={{ color: colors.primary.main, fontWeight: '700', fontSize: 13 }}>
                        Interactive Tools
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
            {renderInteractiveTools()}

            <PdfPreviewModal
              visible={showPdfModal && isFullscreen}
              onClose={() => setShowPdfModal(false)}
              uri={pdfPreviewData.url}
              title={pdfPreviewData.title}
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

const RiskContent = ({ lead, refetch, reports, onDownload }: any) => {
  const { colors, isDark } = useTheme();
  const { riskJob, handleStartRiskReport, handleResetRiskReport } = useLeadReports(lead, refetch);
  const [selectedYear, setSelectedYear] = useState(3);
  const [resetView, setResetView] = useState(false);
  const [reportExpanded, setReportExpanded] = useState(true);

  const riskReport = reports.find(
    (r: any) => r.reportName?.toLowerCase().includes('risk') || r.reportType?.includes('risk')
  );

  return (
    <View>
      <View className="flex-row justify-between items-center mb-4">
        <Text className="text-text-primary font-bold text-base">Report</Text>
        <TouchableOpacity onPress={() => setReportExpanded(!reportExpanded)}>
          <IonIcon
            name={reportExpanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color="#919EAB"
          />
        </TouchableOpacity>
      </View>

      {reportExpanded && (
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
              <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                Risk Report
              </Text>
            </View>
            <View className="flex-row items-center gap-3">
              {riskReport && !resetView && !riskJob ? (
                <View className="flex-row items-center gap-2">
                  <TouchableOpacity
                    onPress={() => onDownload(riskReport, 0)}
                    className="w-8 h-8 rounded-full items-center justify-center bg-violet-500"
                  >
                    <Icon name="eye" size={16} color={'#ffffff'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onDownload(riskReport, 0, true)}
                    className="w-8 h-8 rounded-full items-center justify-center bg-emerald-500"
                  >
                    <Icon name="download" size={16} color={'#ffffff'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
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
                      onChange={(val: number) => setSelectedYear(val)}
                    />
                    <TouchableOpacity
                      onPress={() => {
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
                  <Text className="text-[10px] font-bold text-slate-500 ">{riskJob.progress}%</Text>
                </View>
              )}
            </View>
          </View>

          {/* Progress Bar for Risk Job */}
          {riskJob && riskJob.status !== 'completed' && (
            <View className="mt-3 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <View className="h-full bg-emerald-500" style={{ width: `${riskJob.progress}%` }} />
            </View>
          )}
          {riskJob && riskJob.status !== 'completed' && (
            <Text className="text-[10px] text-slate-400 mt-1 italic">
              {riskJob.step || 'Processing...'}
            </Text>
          )}
        </View>
      )}
      {reports.length > 1 && (
        <View className="mt-2 gap-3">
          <Text className="text-xs font-black  text-gray-400 tracking-widest mb-1">
            Generated History
          </Text>
          {reports.map((report: any, idx: number) => (
            <TouchableOpacity
              key={idx}
              onPress={() => onDownload(report, idx)}
              className="flex-row items-center p-4 bg-white rounded-xl border border-slate-100 shadow-sm"
            >
              <View className="w-10 h-10 bg-red-50 rounded-full items-center justify-center mr-3">
                <Icon name="file-pdf-box" size={24} color="#EF4444" />
              </View>
              <View className="flex-1">
                <Text className="text-text-primary font-bold text-sm" numberOfLines={1}>
                  {report.reportName}
                </Text>
                <Text className="text-text-secondary text-[10px]">
                  {new Date(report.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color="#919EAB" />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};
